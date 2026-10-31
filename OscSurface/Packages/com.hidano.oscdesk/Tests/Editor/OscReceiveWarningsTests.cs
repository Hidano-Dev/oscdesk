using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.Serialization;

namespace OscDesk.Receiver.Tests
{
    /// <summary>
    /// 受信の警告の出し分け(D-102)。行の無いアドレスは既定で黙り、有効にしても同じアドレスは 1 回。不一致は既定で出す。
    /// </summary>
    public sealed class OscReceiveWarningsTests
    {
        private readonly List<OscInvocation> invocations = new List<OscInvocation>();
        private readonly List<int> mismatches = new List<int>();
        private readonly List<string> output = new List<string>();

        private static OscDispatcher Make()
        {
            return new OscDispatcher(new[]
            {
                new OscBindingRow("/count", OscBindingKind.Int, 1),
                new OscBindingRow("/vp/member", OscBindingKind.Record, 1, new[] { "active", "slot" }, false),
            });
        }

        // 既定の引数は OscReceiver の既定(不一致はオン、行の無いアドレスはオフ)に合わせる
        private List<string> Receive(OscReceiveWarnings warnings, OscDispatcher dispatcher, string address, object[] values,
            bool logMismatches = true, bool logUnbound = false)
        {
            dispatcher.Dispatch(address, values, invocations, mismatches);
            output.Clear();
            warnings.Collect(dispatcher, address, values, mismatches, logMismatches, logUnbound, output);
            return output;
        }

        private static object[] Args(params object[] values)
        {
            return values;
        }

        [Test]
        public void Unbound_address_is_silent_by_default()
        {
            var warnings = new OscReceiveWarnings();
            var dispatcher = Make();

            CollectionAssert.IsEmpty(Receive(warnings, dispatcher, "/chara/b/visible", Args(1)));
            CollectionAssert.IsEmpty(Receive(warnings, dispatcher, "/chara/b/visible", Args(1)));
        }

        [Test]
        public void Unbound_address_is_reported_once_per_address_when_enabled()
        {
            var warnings = new OscReceiveWarnings();
            var dispatcher = Make();

            var first = Receive(warnings, dispatcher, "/chara/b/visible", Args(1), logUnbound: true);
            Assert.That(first, Has.Count.EqualTo(1));
            StringAssert.StartsWith("no binding for /chara/b/visible", first[0]);
            CollectionAssert.IsEmpty(Receive(warnings, dispatcher, "/chara/b/visible", Args(0), logUnbound: true));
            Assert.That(Receive(warnings, dispatcher, "/chara/c/visible", Args(1), logUnbound: true), Has.Count.EqualTo(1));
        }

        [Test]
        public void Unbound_address_silenced_while_disabled_is_reported_after_enabling()
        {
            var warnings = new OscReceiveWarnings();
            var dispatcher = Make();

            CollectionAssert.IsEmpty(Receive(warnings, dispatcher, "/x", Args(1)));
            Assert.That(Receive(warnings, dispatcher, "/x", Args(1), logUnbound: true), Has.Count.EqualTo(1));
        }

        [Test]
        public void Reset_reports_an_unbound_address_again()
        {
            // 行を足して外した(有効化で対応表を作り直した)アドレスは、また行の無いアドレスとして出す
            var warnings = new OscReceiveWarnings();
            var dispatcher = Make();

            Assert.That(Receive(warnings, dispatcher, "/a", Args(1), logUnbound: true), Has.Count.EqualTo(1));
            warnings.ResetReported();
            Assert.That(Receive(warnings, dispatcher, "/a", Args(1), logUnbound: true), Has.Count.EqualTo(1));
        }

        [Test]
        public void Unbound_marks_are_bounded_and_the_limit_is_reported_once()
        {
            // 異なるアドレスを送り続けられても覚える数は上限で止まる(メモリを食い潰さない)
            var warnings = new OscReceiveWarnings();
            var dispatcher = Make();

            for (var i = 0; i < OscReceiveWarnings.MaxReportedUnbound; i++)
            {
                Assert.That(Receive(warnings, dispatcher, "/u/" + i, Args(1), logUnbound: true), Has.Count.EqualTo(1));
            }

            var limit = Receive(warnings, dispatcher, "/u/over-1", Args(1), logUnbound: true);
            Assert.That(limit, Has.Count.EqualTo(1));
            StringAssert.Contains(OscReceiveWarnings.MaxReportedUnbound.ToString(), limit[0]);
            for (var i = 0; i < 1000; i++)
            {
                CollectionAssert.IsEmpty(Receive(warnings, dispatcher, "/u/over-" + i, Args(1), logUnbound: true));
            }

            // 既に出したアドレスは上限の後も黙ったまま。数え直すとまた出る
            CollectionAssert.IsEmpty(Receive(warnings, dispatcher, "/u/0", Args(1), logUnbound: true));
            warnings.ResetReported();
            Assert.That(Receive(warnings, dispatcher, "/u/over-1", Args(1), logUnbound: true), Has.Count.EqualTo(1));
        }

        [Test]
        public void Mismatches_are_reported_by_default_every_time()
        {
            var warnings = new OscReceiveWarnings();
            var dispatcher = Make();

            var typeMismatch = Receive(warnings, dispatcher, "/count", Args("x"));
            Assert.That(typeMismatch, Has.Count.EqualTo(1));
            StringAssert.StartsWith("argument type mismatch for ", typeMismatch[0]);
            Assert.That(Receive(warnings, dispatcher, "/count", Args("x")), Has.Count.EqualTo(1));

            var recordMismatch = Receive(warnings, dispatcher, "/vp/member", Args("A", 1));
            Assert.That(recordMismatch, Has.Count.EqualTo(1));
            StringAssert.StartsWith("record mismatch for ", recordMismatch[0]);
        }

        [Test]
        public void Matching_receive_has_no_warning()
        {
            var warnings = new OscReceiveWarnings();
            var dispatcher = Make();

            CollectionAssert.IsEmpty(Receive(warnings, dispatcher, "/count", Args(3), logUnbound: true));
            CollectionAssert.IsEmpty(Receive(warnings, dispatcher, "/vp/member", Args("A", 1, 2), logUnbound: true));
        }

        [Test]
        public void Turning_off_mismatches_silences_mismatches_only()
        {
            var warnings = new OscReceiveWarnings();
            var dispatcher = Make();

            CollectionAssert.IsEmpty(Receive(warnings, dispatcher, "/count", Args("x"), logMismatches: false, logUnbound: true));
            Assert.That(Receive(warnings, dispatcher, "/x", Args(1), logMismatches: false, logUnbound: true), Has.Count.EqualTo(1));
        }

        [Test]
        public void Receiver_defaults_are_mismatches_on_and_unbound_off()
        {
            var gameObject = EditorUtility.CreateGameObjectWithHideFlags("OscReceiveWarningsTests", HideFlags.HideAndDontSave);
            try
            {
                // 編集モードでは OnEnable が呼ばれないので、ポートは開かない
                var receiver = gameObject.AddComponent<OscReceiver>();
                Assert.That(receiver.LogMismatches, Is.True);
                Assert.That(receiver.LogUnboundAddresses, Is.False);
            }
            finally
            {
                Object.DestroyImmediate(gameObject);
            }
        }

        [Test]
        public void Receiver_keeps_the_old_serialized_name()
        {
            // 旧フィールド名 logUnhandled で保存されたシーン・プレハブの値を引き継ぐ。FormerlySerializedAs はアセットの
            // 読み込みでだけ効き、EditorJsonUtility では確かめられないので、属性そのものを確かめる
            var field = typeof(OscReceiver).GetField("logMismatches", BindingFlags.Instance | BindingFlags.NonPublic);
            Assert.That(field, Is.Not.Null);
            var formerly = field.GetCustomAttributes(typeof(FormerlySerializedAsAttribute), false);
            Assert.That(formerly, Has.Length.EqualTo(1));
            Assert.That(((FormerlySerializedAsAttribute)formerly[0]).oldName, Is.EqualTo("logUnhandled"));
        }
    }
}
