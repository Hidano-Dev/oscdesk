using System.Collections.Generic;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.TestTools;

namespace OscDesk.Receiver.Tests
{
    // 送り出しの成否は OscReceiver(UDP)の領分なので、ここでは部品のつなぎ(未設定・送れないときのログの重ね方)だけを見る。
    // 編集モードでは OnEnable も Update も呼ばれず、OscReceiver は待ち受けない
    public sealed class OscNameListPublisherTests
    {
        private GameObject gameObject;

        [SetUp]
        public void SetUp()
        {
            // 利用側の testables で開いているシーンを汚さないよう、保存されない隠しオブジェクトにする
            gameObject = EditorUtility.CreateGameObjectWithHideFlags("OscNameListPublisherTests", HideFlags.HideAndDontSave);
        }

        [TearDown]
        public void TearDown()
        {
            Object.DestroyImmediate(gameObject);
        }

        [Test]
        public void Missing_receiver_is_warned_once()
        {
            var publisher = gameObject.AddComponent<OscNameListPublisher>();
            publisher.Address = "/app/items";
            publisher.AddSource(() => new[] { "A" });

            LogAssert.Expect(LogType.Warning, new Regex("Receiver が未設定"));
            publisher.SendNow();
            Assert.That(publisher.RefreshIfChanged(), Is.False);
            LogAssert.NoUnexpectedReceived();
        }

        [Test]
        public void List_unsent_while_not_listening_is_not_recorded_and_is_retried()
        {
            var receiver = gameObject.AddComponent<OscReceiver>();
            var publisher = gameObject.AddComponent<OscNameListPublisher>();
            publisher.Receiver = receiver;
            publisher.Address = "/app/items";
            publisher.AddSource(() => new[] { "A", " " });
            var sentCount = 0;
            publisher.Sent += _ => sentCount++;

            // 正規化の警告(空白の除外)が出て、待ち受けていないので SendStrings が送らずに警告する
            LogAssert.Expect(LogType.Warning, new Regex("空または空白のみ"));
            LogAssert.Expect(LogType.Warning, new Regex("待ち受けていない"));
            Assert.That(publisher.RefreshIfChanged(), Is.False);

            // 送れなかったのは中身のせいではないので、同じ一覧でも次の作り直しでもう一度送ろうとする。正規化の警告は重ねない
            LogAssert.Expect(LogType.Warning, new Regex("待ち受けていない"));
            Assert.That(publisher.RefreshIfChanged(), Is.False);
            LogAssert.NoUnexpectedReceived();

            Assert.That(publisher.Feed.LastSent, Is.Null);
            Assert.That(sentCount, Is.EqualTo(0));
        }

        [Test]
        public void Oversized_list_is_rejected_before_sending_and_reported_once_per_list()
        {
            var receiver = gameObject.AddComponent<OscReceiver>();
            var publisher = gameObject.AddComponent<OscNameListPublisher>();
            publisher.Receiver = receiver;
            publisher.Address = "/app/items";
            var names = new List<string>();
            for (var i = 0; i < 700; i++) names.Add(i + new string('x', 100));
            publisher.AddSource(() => names);

            LogAssert.Expect(LogType.Warning, new Regex("件あり、目安の 100 件を超えて"));
            LogAssert.Expect(LogType.Warning, new Regex("大きすぎます"));
            Assert.That(publisher.RefreshIfChanged(), Is.False);

            // 同じ一覧の作り直しでは何も出さない(SendStrings も呼ばない)
            Assert.That(publisher.RefreshIfChanged(), Is.False);
            LogAssert.NoUnexpectedReceived();

            // 要求には毎回理由を出す
            LogAssert.Expect(LogType.Warning, new Regex("件あり、目安の 100 件を超えて"));
            LogAssert.Expect(LogType.Warning, new Regex("大きすぎます"));
            publisher.SendNow();
            LogAssert.NoUnexpectedReceived();
        }

        [Test]
        public void Disabled_publisher_does_not_answer_requests()
        {
            var publisher = gameObject.AddComponent<OscNameListPublisher>();
            publisher.Address = "/app/items";
            publisher.AddSource(() => new[] { "A" });
            publisher.enabled = false;

            publisher.SendNow();

            // Receiver が未設定の警告にも届かない
            LogAssert.NoUnexpectedReceived();
        }
    }
}
