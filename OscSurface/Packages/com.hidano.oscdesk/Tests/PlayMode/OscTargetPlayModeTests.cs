using System.Collections;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace OscDesk.Receiver.Tests
{
    // 受け手の基底と生成担当を、実際の有効化・無効化・破棄で確かめる(D-107)
    public sealed class OscTargetPlayModeTests
    {
        private readonly List<GameObject> created = new List<GameObject>();

        private GameObject Make(string name)
        {
            var gameObject = new GameObject(name);
            created.Add(gameObject);
            return gameObject;
        }

        private static OscRegistry Registry => OscRegistry.Shared;

        [SetUp]
        public void SetUp()
        {
            OscRegistry.ResetShared();
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var gameObject in created)
            {
                if (gameObject != null)
                {
                    Object.DestroyImmediate(gameObject);
                }
            }

            created.Clear();
            OscRegistry.ResetShared();
        }

        [Test]
        public void Enabling_registers_and_disabling_unregisters()
        {
            var effect = Make("Spark").AddComponent<OscTestEffect>();

            Assert.That(effect.IsFullyRegistered, Is.True);
            Assert.That(Registry.Deliver("/fx/Spark/stop", new object[0], out _), Is.EqualTo(OscDeliveryOutcome.Delivered));
            Assert.That(Registry.Deliver("/fx/Spark/level", new object[] { 0.25f }, out _), Is.EqualTo(OscDeliveryOutcome.Delivered));
            Assert.That(effect.Stops, Is.EqualTo(1));
            Assert.That(effect.Level, Is.EqualTo(0.25f));

            effect.gameObject.SetActive(false);
            Assert.That(Registry.Deliver("/fx/Spark/stop", new object[0], out _), Is.EqualTo(OscDeliveryOutcome.NoTarget));
            Assert.That(effect.Stops, Is.EqualTo(1));

            effect.gameObject.SetActive(true);
            Assert.That(Registry.Deliver("/fx/Spark/stop", new object[0], out _), Is.EqualTo(OscDeliveryOutcome.Delivered));

            effect.enabled = false;
            Assert.That(Registry.Count, Is.EqualTo(0));
        }

        [UnityTest]
        public IEnumerator Destroying_unregisters()
        {
            var effect = Make("Spark").AddComponent<OscTestEffect>();
            Assert.That(Registry.TryGet("/fx/Spark/stop", out _), Is.True);

            Object.Destroy(effect.gameObject);
            yield return null;
            Assert.That(Registry.TryGet("/fx/Spark/stop", out _), Is.False);
        }

        [Test]
        public void Default_target_name_strips_clone_and_field_overrides_it()
        {
            var effect = Make("Spark(Clone)").AddComponent<OscTestEffect>();
            Assert.That(effect.TargetName, Is.EqualTo("Spark"));
            Assert.That(Registry.TryGet("/fx/Spark/stop", out _), Is.True);

            effect.TargetName = "Hero";
            Assert.That(Registry.TryGet("/fx/Spark/stop", out _), Is.False);
            Assert.That(Registry.TryGet("/fx/Hero/stop", out _), Is.True);

            effect.PackageName = "chara";
            Assert.That(Registry.TryGet("/chara/Hero/stop", out _), Is.True);
            Assert.That(Registry.Count, Is.EqualTo(2));
        }

        [Test]
        public void Later_duplicate_is_not_accepted_and_warns()
        {
            var first = Make("Spark").AddComponent<OscTestEffect>();
            LogAssert.Expect(LogType.Warning, new Regex("/fx/Spark/stop は既に登録されている"));
            LogAssert.Expect(LogType.Warning, new Regex("/fx/Spark/level は既に登録されている"));
            var second = Make("Spark").AddComponent<OscTestEffect>();

            Assert.That(first.IsFullyRegistered, Is.True);
            Assert.That(second.IsFullyRegistered, Is.False);
            Registry.Deliver("/fx/Spark/stop", new object[0], out _);
            Assert.That(first.Stops, Is.EqualTo(1));
            Assert.That(second.Stops, Is.EqualTo(0));

            // 後から来た方を無効にしても、先に登録した方は残る
            second.enabled = false;
            Assert.That(Registry.Deliver("/fx/Spark/stop", new object[0], out _), Is.EqualTo(OscDeliveryOutcome.Delivered));
            Assert.That(first.Stops, Is.EqualTo(2));
        }

        [Test]
        public void Invalid_target_name_is_not_registered_and_warns()
        {
            LogAssert.Expect(LogType.Warning, new Regex("が不正なので登録しませんでした"));
            LogAssert.Expect(LogType.Warning, new Regex("が不正なので登録しませんでした"));
            var effect = Make("Spark A").AddComponent<OscTestEffect>();
            Assert.That(effect.IsFullyRegistered, Is.False);
            Assert.That(Registry.Count, Is.EqualTo(0));
        }

        private OscSpawner MakeSpawner(out GameObject template)
        {
            template = Make("Spark");
            template.AddComponent<OscTestEffect>().TargetName = "template";
            var spawner = Make("spawner").AddComponent<OscSpawner>();
            spawner.PackageName = "fx";
            spawner.Prefab = template;
            return spawner;
        }

        [UnityTest]
        public IEnumerator Spawner_registers_spawned_objects_under_the_given_name_and_destroys_them_by_name()
        {
            var spawner = MakeSpawner(out _);

            Assert.That(Registry.Deliver("/fx/spawner/spawn", new object[] { "spark1" }, out var reason), Is.EqualTo(OscDeliveryOutcome.Delivered), reason);
            Assert.That(spawner.Spawned.ContainsKey("spark1"), Is.True);
            var instance = spawner.Spawned["spark1"];
            created.Add(instance);
            Assert.That(instance.GetComponent<OscTestEffect>().TargetName, Is.EqualTo("spark1"));
            Assert.That(Registry.Deliver("/fx/spark1/stop", new object[0], out _), Is.EqualTo(OscDeliveryOutcome.Delivered));
            Assert.That(instance.GetComponent<OscTestEffect>().Stops, Is.EqualTo(1));

            // 使用中の名前では生成しない
            Assert.That(Registry.Deliver("/fx/spawner/spawn", new object[] { "spark1" }, out reason), Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(reason, Is.EqualTo(OscSpawner.ReasonNameInUse));
            Assert.That(spawner.Spawned.Count, Is.EqualTo(1));

            // 名前で消すと、同じフレームのうちに登録も外れ、同じ名前でまた生成できる
            Assert.That(Registry.Deliver("/fx/spawner/destroy", new object[] { "spark1" }, out reason), Is.EqualTo(OscDeliveryOutcome.Delivered), reason);
            Assert.That(Registry.TryGet("/fx/spark1/stop", out _), Is.False);
            Assert.That(Registry.Deliver("/fx/spawner/spawn", new object[] { "spark1" }, out reason), Is.EqualTo(OscDeliveryOutcome.Delivered), reason);
            created.Add(spawner.Spawned["spark1"]);
            yield return null;
            Assert.That(instance == null, Is.True);
            Assert.That(Registry.TryGet("/fx/spark1/stop", out _), Is.True);

            Assert.That(Registry.Deliver("/fx/spawner/destroy", new object[] { "nothing" }, out reason), Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(reason, Is.EqualTo(OscSpawner.ReasonNotFound));
        }

        [Test]
        public void Spawner_fails_when_the_name_is_used_by_another_target()
        {
            var spawner = MakeSpawner(out _);
            Make("hero").AddComponent<OscTestEffect>(); // シーンに最初からある /fx/hero/*

            LogAssert.Expect(LogType.Warning, new Regex("/fx/hero/stop は既に登録されている"));
            LogAssert.Expect(LogType.Warning, new Regex("/fx/hero/level は既に登録されている"));
            Assert.That(Registry.Deliver("/fx/spawner/spawn", new object[] { "hero" }, out var reason), Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(reason, Is.EqualTo(OscSpawner.ReasonNameInUse));
            Assert.That(spawner.Spawned.Count, Is.EqualTo(0));
            Assert.That(Registry.Deliver("/fx/hero/stop", new object[0], out _), Is.EqualTo(OscDeliveryOutcome.Delivered));
        }

        [Test]
        public void Spawner_rejects_invalid_names_and_missing_prefab()
        {
            var spawner = MakeSpawner(out _);
            Assert.That(Registry.Deliver("/fx/spawner/spawn", new object[] { "a/b" }, out var reason), Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(reason, Is.EqualTo(OscSpawner.ReasonInvalidName));
            Assert.That(Registry.Deliver("/fx/spawner/spawn", new object[] { "spark*" }, out reason), Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(reason, Is.EqualTo(OscSpawner.ReasonInvalidName));
            Assert.That(Registry.Deliver("/fx/spawner/spawn", new object[] { 1 }, out reason), Is.EqualTo(OscDeliveryOutcome.Mismatch));

            spawner.Prefab = null;
            LogAssert.Expect(LogType.Warning, new Regex("Prefab が設定されていない"));
            Assert.That(Registry.Deliver("/fx/spawner/spawn", new object[] { "spark2" }, out reason), Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(reason, Is.EqualTo(OscSpawner.ReasonNoPrefab));
        }
    }
}
