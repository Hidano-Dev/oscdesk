using System;
using System.Collections;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace OscDesk.Receiver.Tests
{
    // OscReceiver の受信を Registry 経由にしても、対応表の行・エコー・pong・/sys/ignored・/sys/failed が今と同じであること(D-108)。
    // ループバックの UDP で実際に送受信する
    public sealed class OscReceiverPlayModeTests
    {
        private const float TimeoutSeconds = 3f;

        private readonly List<GameObject> created = new List<GameObject>();
        private UdpClient bridge; // ブリッジ役。返信(pong・エコー・報告)を受ける
        private int listenPort;

        [SetUp]
        public void SetUp()
        {
            OscRegistry.ResetShared();
            bridge = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
            listenPort = FreePort();
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var gameObject in created)
            {
                if (gameObject != null)
                {
                    UnityEngine.Object.DestroyImmediate(gameObject);
                }
            }

            created.Clear();
            bridge.Dispose();
            OscRegistry.ResetShared();
        }

        private static int FreePort()
        {
            using (var probe = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0)))
            {
                return ((IPEndPoint)probe.Client.LocalEndPoint).Port;
            }
        }

        private OscReceiver MakeReceiver(Action<OscReceiver> configure)
        {
            var gameObject = new GameObject("receiver");
            created.Add(gameObject);
            gameObject.SetActive(false); // 既定のポートで待ち受けないよう、設定してから有効にする
            var receiver = gameObject.AddComponent<OscReceiver>();
            receiver.ListenPort = listenPort;
            receiver.ReplyHost = "127.0.0.1";
            receiver.ReplyPort = ((IPEndPoint)bridge.Client.LocalEndPoint).Port;
            configure?.Invoke(receiver);
            gameObject.SetActive(true);
            Assert.That(receiver.IsListening, Is.True);
            return receiver;
        }

        private static OscReceiver.Binding Row(string address, OscBindingKind kind)
        {
            return new OscReceiver.Binding { address = address, kind = kind };
        }

        private void Send(string address, params object[] args)
        {
            var bytes = OscCodec.EncodeMessage(address, args);
            bridge.Send(bytes, bytes.Length, new IPEndPoint(IPAddress.Loopback, listenPort));
        }

        // 返信を address が来るまで(または時間切れまで)集める。フレームを進めないと OscReceiver の Update が回らない
        private IEnumerator Collect(List<OscMessage> into, string until)
        {
            var deadline = Time.realtimeSinceStartup + TimeoutSeconds;
            while (Time.realtimeSinceStartup < deadline)
            {
                while (bridge.Available > 0)
                {
                    IPEndPoint remote = null;
                    var data = bridge.Receive(ref remote);
                    var messages = new List<OscMessage>();
                    Assert.That(OscCodec.TryDecode(data, 0, data.Length, messages, out var error), Is.True, error);
                    into.AddRange(messages);
                }

                if (into.Exists(m => m.Address == until))
                {
                    yield break;
                }

                yield return null;
            }
        }

        private static OscMessage Find(List<OscMessage> messages, string address)
        {
            return messages.Find(m => m.Address == address);
        }

        [UnityTest]
        public IEnumerator Table_rows_are_dispatched_through_the_registry_and_echo_and_pong_are_unchanged()
        {
            var floats = new List<float>();
            var triggers = 0;
            MakeReceiver(receiver =>
            {
                var level = Row("/mix/level", OscBindingKind.Float);
                level.onFloat.AddListener(floats.Add);
                var go = Row("/cue/go", OscBindingKind.Trigger);
                go.onTrigger.AddListener(() => triggers += 1);
                receiver.bindings.Add(level);
                receiver.bindings.Add(go);
            });
            Assert.That(OscRegistry.Shared.TryGet("/mix/level", out _), Is.True);

            var replies = new List<OscMessage>();
            Send("/sys/ping", 42);
            yield return Collect(replies, "/sys/pong");
            Assert.That(Find(replies, "/sys/pong").Values, Is.EqualTo(new object[] { 42 }));

            Send("/mix/level", 0.5f);
            yield return Collect(replies, "/mix/level");
            Assert.That(Find(replies, "/mix/level").Values, Is.EqualTo(new object[] { 0.5f }));
            Assert.That(floats, Is.EqualTo(new[] { 0.5f }));

            Send("/cue/go");
            yield return Collect(replies, "/cue/go");
            Assert.That(triggers, Is.EqualTo(1));
            Assert.That(Find(replies, "/sys/ignored"), Is.Null);
            Assert.That(Find(replies, "/sys/failed"), Is.Null);
        }

        [UnityTest]
        public IEnumerator Unknown_address_is_ignored_and_type_mismatch_is_failed()
        {
            MakeReceiver(receiver =>
            {
                var level = Row("/mix/level", OscBindingKind.Float);
                level.onFloat.AddListener(_ => { });
                receiver.bindings.Add(level);
            });

            var replies = new List<OscMessage>();
            Send("/nobody/here", 1);
            yield return Collect(replies, "/sys/ignored");
            Assert.That(Find(replies, "/nobody/here"), Is.Not.Null); // エコーは返す
            Assert.That(Find(replies, "/sys/ignored").Values, Is.EqualTo(new object[] { "/nobody/here" }));

            LogAssert.Expect(LogType.Warning, new Regex("argument type mismatch for /mix/level"));
            Send("/mix/level", "text");
            yield return Collect(replies, "/sys/failed");
            Assert.That(Find(replies, "/sys/failed").Values, Is.EqualTo(new object[] { "/mix/level", OscDeliveryReport.ReasonTypeMismatch }));
        }

        [UnityTest]
        public IEnumerator Listener_exception_is_failed_and_other_rows_still_fire()
        {
            var fired = 0;
            MakeReceiver(receiver =>
            {
                var boom = Row("/v", OscBindingKind.Int);
                boom.onInt.AddListener(_ => throw new InvalidOperationException("boom"));
                var ok = Row("/v", OscBindingKind.Float);
                ok.onFloat.AddListener(_ => fired += 1);
                receiver.bindings.Add(boom);
                receiver.bindings.Add(ok);
            });

            LogAssert.Expect(LogType.Exception, new Regex("boom"));
            var replies = new List<OscMessage>();
            Send("/v", 3);
            yield return Collect(replies, "/sys/failed");
            Assert.That(fired, Is.EqualTo(1));
            Assert.That(Find(replies, "/sys/failed").Values, Is.EqualTo(new object[] { "/v", OscDeliveryReport.ReasonException }));
        }

        [UnityTest]
        public IEnumerator Osc_target_and_spawner_are_reached_through_the_receiver()
        {
            MakeReceiver(null);
            var templateObject = new GameObject("Spark");
            created.Add(templateObject);
            templateObject.AddComponent<OscTestEffect>().TargetName = "template";
            var spawnerObject = new GameObject("spawner");
            created.Add(spawnerObject);
            var spawner = spawnerObject.AddComponent<OscSpawner>();
            spawner.PackageName = "fx";
            spawner.Prefab = templateObject;

            var replies = new List<OscMessage>();
            Send("/fx/spawner/spawn", "spark1");
            yield return Collect(replies, "/fx/spawner/spawn");
            Assert.That(spawner.Spawned.ContainsKey("spark1"), Is.True);
            var effect = spawner.Spawned["spark1"].GetComponent<OscTestEffect>();
            created.Add(effect.gameObject);

            // パターンで、生成したものと最初からあるものの両方に届く
            Send("/fx/*/stop");
            yield return Collect(replies, "/fx/*/stop");
            Assert.That(effect.Stops, Is.EqualTo(1));
            Assert.That(templateObject.GetComponent<OscTestEffect>().Stops, Is.EqualTo(1));

            // 使用中の名前での生成は /sys/failed で返る
            LogAssert.Expect(LogType.Warning, new Regex("failed for /fx/spawner/spawn \\(string\\): name in use"));
            Send("/fx/spawner/spawn", "spark1");
            yield return Collect(replies, "/sys/failed");
            Assert.That(Find(replies, "/sys/failed").Values, Is.EqualTo(new object[] { "/fx/spawner/spawn", OscSpawner.ReasonNameInUse }));
        }

        [UnityTest]
        public IEnumerator Table_row_that_collides_with_a_target_is_not_accepted()
        {
            var effectObject = new GameObject("hero");
            created.Add(effectObject);
            var effect = effectObject.AddComponent<OscTestEffect>();

            var rowFired = 0;
            LogAssert.Expect(LogType.Warning, new Regex("対応表の行 /fx/hero/stop は既に登録されている"));
            MakeReceiver(receiver =>
            {
                var row = Row("/fx/hero/stop", OscBindingKind.Trigger);
                row.onTrigger.AddListener(() => rowFired += 1);
                receiver.bindings.Add(row);
            });

            var replies = new List<OscMessage>();
            Send("/fx/hero/stop");
            yield return Collect(replies, "/fx/hero/stop");
            Assert.That(effect.Stops, Is.EqualTo(1));
            Assert.That(rowFired, Is.EqualTo(0));
        }

        [UnityTest]
        public IEnumerator Disabling_the_receiver_unregisters_its_table()
        {
            var receiver = MakeReceiver(r =>
            {
                var row = Row("/cue/go", OscBindingKind.Trigger);
                row.onTrigger.AddListener(() => { });
                r.bindings.Add(row);
            });
            Assert.That(OscRegistry.Shared.TryGet("/cue/go", out _), Is.True);

            receiver.enabled = false;
            Assert.That(OscRegistry.Shared.TryGet("/cue/go", out _), Is.False);
            receiver.enabled = true;
            Assert.That(OscRegistry.Shared.TryGet("/cue/go", out _), Is.True);
            yield return null;
        }
    }
}
