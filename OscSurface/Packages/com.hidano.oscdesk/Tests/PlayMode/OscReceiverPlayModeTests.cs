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
        public IEnumerator Mismatch_on_another_receivers_row_is_logged_once_by_the_row_owner()
        {
            // B の行の不一致を A のポートへ送ると、B の対応表の処理が警告を出す(A のリストに溜めて捨てない。PR #103 の指摘)
            MakeReceiver(null); // A(listenPort)
            var portB = FreePort();
            var objectB = new GameObject("receiverB");
            created.Add(objectB);
            objectB.SetActive(false);
            var receiverB = objectB.AddComponent<OscReceiver>();
            receiverB.ListenPort = portB;
            receiverB.ReplyHost = "127.0.0.1";
            receiverB.ReplyPort = ((IPEndPoint)bridge.Client.LocalEndPoint).Port;
            var level = Row("/mix/level", OscBindingKind.Float);
            level.onFloat.AddListener(_ => { });
            receiverB.bindings.Add(level);
            objectB.SetActive(true);

            LogAssert.Expect(LogType.Warning, new Regex("argument type mismatch for /mix/level"));
            var replies = new List<OscMessage>();
            Send("/mix/level", "text");
            yield return Collect(replies, "/sys/failed");
            Assert.That(Find(replies, "/sys/failed").Values, Is.EqualTo(new object[] { "/mix/level", OscDeliveryReport.ReasonTypeMismatch }));
        }

        [UnityTest]
        public IEnumerator Pattern_messages_beyond_the_frame_budget_are_dropped()
        {
            var fired = 0;
            MakeReceiver(receiver =>
            {
                var row = Row("/fx/a/stop", OscBindingKind.Trigger);
                row.onTrigger.AddListener(() => fired += 1);
                receiver.bindings.Add(row);
            });

            // 1 フレームで読まれるよう、枠を超える数のパターンを一度に送る(UDP のキューに溜まり、次の Update でまとめて処理される)
            LogAssert.Expect(LogType.Warning, new Regex("1 フレームに振り分けるパターンの上限"));
            var total = OscPatternBudget.MaxMessagesPerFrame + 20;
            for (var i = 0; i < total; i++)
            {
                Send("/fx/*/stop");
            }

            Send("/done");
            System.Threading.Thread.Sleep(300); // 受信のスレッドがすべてをキューに積むまで Update を回さない(1 フレームでまとめて処理させる)
            var replies = new List<OscMessage>();
            yield return Collect(replies, "/done");
            yield return null;
            Assert.That(fired, Is.LessThan(total));
            Assert.That(fired, Is.GreaterThanOrEqualTo(OscPatternBudget.MaxMessagesPerFrame));
        }

        [UnityTest]
        public IEnumerator Catalog_is_sent_in_full_on_start_and_on_request()
        {
            MakeReceiver(receiver =>
            {
                receiver.CatalogName = "Stage PC";
                var level = Row("/mix/level", OscBindingKind.Float);
                level.onFloat.AddListener(_ => { });
                receiver.bindings.Add(level);
            });

            var replies = new List<OscMessage>();
            yield return Collect(replies, "/sys/catalog/end");
            Assert.That(Find(replies, "/sys/catalog/begin").Values, Is.EqualTo(new object[] { "Stage PC", 1 }));
            Assert.That(Find(replies, "/sys/catalog/add").Values, Is.EqualTo(new object[] { "/mix/level", "state", "f" }));
            var expected = new List<OscCatalogItem> { new OscCatalogItem("/mix/level", "state", "f") };
            OscCatalogDigest.Compute(expected, out var count, out var crc);
            Assert.That(Find(replies, "/sys/catalog/end").Values, Is.EqualTo(new object[] { count, crc }));

            // Sync の要求で全体を送り直す(1 秒に 1 回までなので、間隔が空いてから届く)
            replies.Clear();
            Send("/sys/catalog/request");
            yield return Collect(replies, "/sys/catalog/end");
            Assert.That(Find(replies, "/sys/catalog/begin"), Is.Not.Null);
            Assert.That(Find(replies, "/sys/catalog/request"), Is.Null); // /sys/* にはエコーを返さない
        }

        [UnityTest]
        public IEnumerator Catalog_follows_spawn_and_destroy_in_one_datagram_per_frame()
        {
            MakeReceiver(null);
            var templateObject = new GameObject("Spark");
            created.Add(templateObject);
            templateObject.SetActive(false); // ひな形は登録しない
            templateObject.AddComponent<OscTestEffect>();
            var spawnerObject = new GameObject("spawner");
            created.Add(spawnerObject);
            var spawner = spawnerObject.AddComponent<OscSpawner>();
            spawner.PackageName = "fx";
            spawner.Prefab = templateObject;

            var replies = new List<OscMessage>();
            yield return Collect(replies, "/sys/catalog/end"); // 起動時の全体
            var spawn = replies.Find(m => m.Address == "/sys/catalog/add" && (string)m.Values[0] == "/fx/spawner/spawn");
            Assert.That(spawn, Is.Not.Null, "生成担当の操作は全体に載る(Play の開始と同じフレームで登録されたもの)");
            Assert.That(spawn.Values, Is.EqualTo(new object[] { "/fx/spawner/spawn", "trigger", "s" }));

            replies.Clear();
            Send("/fx/spawner/spawn", "spark1");
            yield return Collect(replies, "/sys/catalog/digest");
            var adds = replies.FindAll(m => m.Address == "/sys/catalog/add").ConvertAll(m => (string)m.Values[0]);
            Assert.That(adds, Is.EqualTo(new[] { "/fx/spark1/level", "/fx/spark1/stop" }));
            Assert.That(replies.FindAll(m => m.Address == "/sys/catalog/digest").Count, Is.EqualTo(1));

            replies.Clear();
            Send("/fx/spawner/destroy", "spark1");
            yield return Collect(replies, "/sys/catalog/digest");
            var removes = replies.FindAll(m => m.Address == "/sys/catalog/remove").ConvertAll(m => (string)m.Values[0]);
            Assert.That(removes, Is.EqualTo(new[] { "/fx/spark1/level", "/fx/spark1/stop" }));
        }

        [UnityTest]
        public IEnumerator Row_listener_delivering_to_another_row_does_not_disturb_the_outer_rows()
        {
            // 行の関数が中から別のアドレスの行へ渡しても、外側の残りの行は今までどおり呼ばれる(PR #103 の再レビュー)
            var first = 0;
            var second = 0;
            var inner = 0;
            MakeReceiver(receiver =>
            {
                var a1 = Row("/a", OscBindingKind.Trigger);
                a1.onTrigger.AddListener(() =>
                {
                    first += 1;
                    OscRegistry.Shared.Deliver("/b", new object[0], out _);
                });
                var a2 = Row("/a", OscBindingKind.Trigger);
                a2.onTrigger.AddListener(() => second += 1);
                var b = Row("/b", OscBindingKind.Trigger);
                b.onTrigger.AddListener(() => inner += 1);
                receiver.bindings.Add(a1);
                receiver.bindings.Add(a2);
                receiver.bindings.Add(b);
            });

            var replies = new List<OscMessage>();
            Send("/a");
            yield return Collect(replies, "/a");
            Assert.That(first, Is.EqualTo(1));
            Assert.That(second, Is.EqualTo(1));
            Assert.That(inner, Is.EqualTo(1));
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
