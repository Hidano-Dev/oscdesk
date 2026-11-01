using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;

namespace OscDesk.Receiver.Tests
{
    // Registry の中核(D-107)。Unity の有効化・無効化を通す確認は PlayMode の OscTargetPlayModeTests
    public sealed class OscRegistryTests
    {
        private static OscRegistryEntry Entry(string address, OscBindingKind kind, OscOperationHandler handler = null, object owner = null)
        {
            return new OscRegistryEntry(address, new OscOperation("op", kind, handler ?? (_ => null)), owner);
        }

        [Test]
        public void Register_and_unregister_raise_events()
        {
            var registry = new OscRegistry();
            var log = new List<string>();
            registry.Registered += e => log.Add("+" + e.Address);
            registry.Unregistered += e => log.Add("-" + e.Address);

            var entry = Entry("/fx/a/stop", OscBindingKind.Trigger);
            Assert.That(registry.Register(entry), Is.EqualTo(OscRegistrationResult.Registered));
            Assert.That(registry.Count, Is.EqualTo(1));
            Assert.That(registry.TryGet("/fx/a/stop", out var found), Is.True);
            Assert.That(found, Is.SameAs(entry));

            Assert.That(registry.Unregister(entry), Is.True);
            Assert.That(registry.Unregister(entry), Is.False);
            Assert.That(registry.Count, Is.EqualTo(0));
            Assert.That(log, Is.EqualTo(new[] { "+/fx/a/stop", "-/fx/a/stop" }));
        }

        [Test]
        public void Later_duplicate_is_rejected_and_its_unregister_keeps_the_first()
        {
            var registry = new OscRegistry();
            OscRegistryEntry rejected = null, kept = null;
            registry.Rejected += (r, existing) => { rejected = r; kept = existing; };

            var first = Entry("/fx/a/stop", OscBindingKind.Trigger);
            var second = Entry("/fx/a/stop", OscBindingKind.Trigger);
            registry.Register(first);
            Assert.That(registry.Register(second), Is.EqualTo(OscRegistrationResult.Duplicate));
            Assert.That(rejected, Is.SameAs(second));
            Assert.That(kept, Is.SameAs(first));

            Assert.That(registry.Unregister(second), Is.False);
            Assert.That(registry.TryGet("/fx/a/stop", out var found), Is.True);
            Assert.That(found, Is.SameAs(first));
        }

        [TestCase("")]
        [TestCase("fx/a")]
        [TestCase("/fx/a b")]
        [TestCase("/fx/*/stop")]
        [TestCase("/sys/ping")]
        [TestCase("/oscdesk/x")]
        [TestCase("/fx//stop")]
        public void Invalid_addresses_are_not_registered(string address)
        {
            var registry = new OscRegistry();
            Assert.That(registry.Register(Entry(address, OscBindingKind.Trigger)), Is.EqualTo(OscRegistrationResult.InvalidAddress));
            Assert.That(registry.Count, Is.EqualTo(0));
        }

        [Test]
        public void Deliver_converts_arguments_like_the_dispatcher()
        {
            var registry = new OscRegistry();
            var received = new List<float>();
            registry.Register(Entry("/mix/a/level", OscBindingKind.Float, i => { received.Add(i.FloatValue); return null; }));

            Assert.That(registry.Deliver("/mix/a/level", new object[] { 2 }, out var reason), Is.EqualTo(OscDeliveryOutcome.Delivered));
            Assert.That(reason, Is.Null);
            Assert.That(registry.Deliver("/mix/a/level", new object[] { "x" }, out reason), Is.EqualTo(OscDeliveryOutcome.Mismatch));
            Assert.That(reason, Is.EqualTo(OscRegistry.ReasonTypeMismatch));
            Assert.That(registry.Deliver("/mix/b/level", new object[] { 1f }, out reason), Is.EqualTo(OscDeliveryOutcome.NoTarget));
            Assert.That(received, Is.EqualTo(new[] { 2f }));
        }

        [Test]
        public void Deliver_reports_record_mismatch_and_handler_failure()
        {
            var registry = new OscRegistry();
            var record = new OscOperation("row", OscBindingKind.Record, _ => null).WithRecordFields(new[] { "a", "b" });
            registry.Register(new OscRegistryEntry("/r/x/row", record, null));
            registry.Register(Entry("/r/x/fail", OscBindingKind.String, _ => "name in use"));

            Assert.That(registry.Deliver("/r/x/row", new object[] { "k", 1 }, out var reason), Is.EqualTo(OscDeliveryOutcome.Mismatch));
            Assert.That(reason, Is.EqualTo(OscRegistry.ReasonRecordMismatch));
            Assert.That(registry.Deliver("/r/x/row", new object[] { "k", 1, 2 }, out reason), Is.EqualTo(OscDeliveryOutcome.Delivered));
            Assert.That(registry.Deliver("/r/x/fail", new object[] { "s" }, out reason), Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(reason, Is.EqualTo("name in use"));
        }

        [Test]
        public void Handler_may_register_during_delivery()
        {
            var registry = new OscRegistry();
            registry.Register(Entry("/fx/spawner/spawn", OscBindingKind.String, i =>
                registry.Register(Entry("/fx/" + i.StringValue + "/stop", OscBindingKind.Trigger)) == OscRegistrationResult.Registered ? null : "name in use"));

            Assert.That(registry.Deliver("/fx/spawner/spawn", new object[] { "spark1" }, out _), Is.EqualTo(OscDeliveryOutcome.Delivered));
            Assert.That(registry.TryGet("/fx/spark1/stop", out _), Is.True);
            Assert.That(registry.Deliver("/fx/spawner/spawn", new object[] { "spark1" }, out var reason), Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(reason, Is.EqualTo("name in use"));
        }

        [Test]
        public void Shared_is_created_lazily_and_reset_clears_it()
        {
            OscRegistry.ResetShared();
            var first = OscRegistry.Shared;
            Assert.That(OscRegistry.Shared, Is.SameAs(first));
            first.Register(Entry("/fx/a/stop", OscBindingKind.Trigger));

            OscRegistry.ResetShared();
            Assert.That(OscRegistry.Shared, Is.Not.SameAs(first));
            Assert.That(OscRegistry.Shared.Count, Is.EqualTo(0));
            OscRegistry.ResetShared();
        }

        [Test]
        public void Shared_is_reset_at_subsystem_registration()
        {
            // ドメインのリロードを切った環境でも Play の開始ごとに空になるよう、SubsystemRegistration で捨てる
            var type = typeof(OscTarget).Assembly.GetType("OscDesk.Receiver.OscRegistryLifecycle");
            Assert.That(type, Is.Not.Null);
            var method = type.GetMethod("ResetOnPlay", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
            Assert.That(method, Is.Not.Null);
            var attribute = method.GetCustomAttribute<RuntimeInitializeOnLoadMethodAttribute>();
            Assert.That(attribute, Is.Not.Null);
            Assert.That(attribute.loadType, Is.EqualTo(RuntimeInitializeLoadType.SubsystemRegistration));

            OscRegistry.Shared.Register(Entry("/fx/a/stop", OscBindingKind.Trigger));
            method.Invoke(null, null);
            Assert.That(OscRegistry.Shared.Count, Is.EqualTo(0));
        }

        [Test]
        public void Address_helpers()
        {
            Assert.That(OscAddressNames.Build("effect", "spark1", "stop"), Is.EqualTo("/effect/spark1/stop"));
            Assert.That(OscAddressNames.Build("", "spark1", "stop"), Is.EqualTo("/spark1/stop"));
            Assert.That(OscAddressNames.StripClone("Spark(Clone)"), Is.EqualTo("Spark"));
            Assert.That(OscAddressNames.StripClone("Spark(Clone)(Clone)"), Is.EqualTo("Spark"));
            Assert.That(OscAddressNames.StripClone(" Spark "), Is.EqualTo("Spark"));
            Assert.That(OscAddressNames.IsValidSegment("spark1"), Is.True);
            Assert.That(OscAddressNames.IsValidSegment("キャラA"), Is.True);
            foreach (var bad in new[] { "", null, "a b", "a/b", "a*", "a?", "a[", "a]", "a{", "a}", "a,b", "#a", "a\tb" })
            {
                Assert.That(OscAddressNames.IsValidSegment(bad), Is.False, bad ?? "null");
            }
        }

        [Test]
        public void Operation_list_declares_kinds_constraints_and_hints()
        {
            var list = new OscOperationList();
            var calls = new List<string>();
            list.Float("level", v => calls.Add("level " + v)).WithRange(0f, 1f).WithStep(0.1f).WithWidget("slider");
            list.String("mode", v => calls.Add("mode " + v)).WithOptions("a", "b");
            list.Trigger("go", () => calls.Add("go"));

            Assert.That(list.Operations.Count, Is.EqualTo(3));
            var level = list.Operations[0];
            Assert.That(level.Kind, Is.EqualTo(OscBindingKind.Float));
            Assert.That(level.Min, Is.EqualTo(0f));
            Assert.That(level.Max, Is.EqualTo(1f));
            Assert.That(level.Step, Is.EqualTo(0.1f));
            Assert.That(level.Widget, Is.EqualTo("slider"));
            Assert.That(list.Operations[1].Options, Is.EqualTo(new[] { "a", "b" }));

            var registry = new OscRegistry();
            foreach (var operation in list.Operations)
            {
                registry.Register(new OscRegistryEntry(OscAddressNames.Build("p", "t", operation.Name), operation, null));
            }

            registry.Deliver("/p/t/level", new object[] { 0.5f }, out _);
            registry.Deliver("/p/t/mode", new object[] { "b" }, out _);
            registry.Deliver("/p/t/go", new object[0], out _);
            Assert.That(calls, Is.EqualTo(new[] { "level 0.5", "mode b", "go" }));
        }
    }
}
