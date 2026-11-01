using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    // Router と Link(D-108)。OscReceiver を通した確認は PlayMode の OscReceiverPlayModeTests
    public sealed class OscRouterTests
    {
        private readonly List<OscRouteResult> results = new List<OscRouteResult>();
        private readonly List<string> failures = new List<string>();
        private readonly OscDeliveryReport report = new OscDeliveryReport();

        private static OscRegistryEntry Trigger(string address, List<string> log, string fail = null)
        {
            return new OscRegistryEntry(address, new OscOperation("op", OscBindingKind.Trigger, _ => { log.Add(address); return fail; }), null);
        }

        private int Route(OscRouter router, string address, params object[] args)
        {
            results.Clear();
            failures.Clear();
            report.Clear();
            return router.Route(address, args, report, results, failures, null, out _);
        }

        private static string[] Strings(object[] args)
        {
            var list = new List<string>();
            foreach (var arg in args)
            {
                list.Add((string)arg);
            }

            return list.ToArray();
        }

        [Test]
        public void Exact_address_reaches_one_entry_and_unknown_is_ignored()
        {
            var registry = new OscRegistry();
            var log = new List<string>();
            registry.Register(Trigger("/fx/a/stop", log));
            var router = new OscRouter(registry);

            Assert.That(Route(router, "/fx/a/stop"), Is.EqualTo(1));
            Assert.That(log, Is.EqualTo(new[] { "/fx/a/stop" }));
            Assert.That(report.IsEmpty, Is.True);

            Assert.That(Route(router, "/fx/b/stop"), Is.EqualTo(0));
            Assert.That(report.TryBuildIgnored(out var ignored), Is.True);
            Assert.That(Strings(ignored), Is.EqualTo(new[] { "/fx/b/stop" }));
        }

        [Test]
        public void Pattern_reaches_every_matching_entry_in_registration_order()
        {
            var registry = new OscRegistry();
            var log = new List<string>();
            registry.Register(Trigger("/fx/spark2/stop", log));
            registry.Register(Trigger("/fx/smoke/stop", log));
            registry.Register(Trigger("/fx/spark1/stop", log));
            var router = new OscRouter(registry);

            Assert.That(Route(router, "/fx/spark*/stop"), Is.EqualTo(2));
            Assert.That(log, Is.EqualTo(new[] { "/fx/spark2/stop", "/fx/spark1/stop" }));

            log.Clear();
            Assert.That(Route(router, "/fx/{smoke,spark1}/stop"), Is.EqualTo(2));
            Assert.That(log, Is.EqualTo(new[] { "/fx/smoke/stop", "/fx/spark1/stop" }));

            // 読めないパターンは完全一致で引く
            Assert.That(Route(router, "/fx/spark[1/stop"), Is.EqualTo(0));
            Assert.That(report.TryBuildIgnored(out _), Is.True);
        }

        [Test]
        public void Pattern_matches_are_capped()
        {
            var registry = new OscRegistry();
            var log = new List<string>();
            for (var i = 0; i < OscRouter.MaxPatternMatches + 3; i++)
            {
                registry.Register(Trigger("/fx/t" + i + "/stop", log));
            }

            var router = new OscRouter(registry);
            results.Clear();
            failures.Clear();
            Assert.That(router.Route("/fx/*/stop", new object[0], null, results, failures, null, out var skipped), Is.EqualTo(OscRouter.MaxPatternMatches));
            Assert.That(skipped, Is.EqualTo(3));
            Assert.That(log[0], Is.EqualTo("/fx/t0/stop"));
        }

        [Test]
        public void Pattern_matches_respect_the_frame_budget_cap()
        {
            var registry = new OscRegistry();
            var log = new List<string>();
            for (var i = 0; i < 5; i++)
            {
                registry.Register(Trigger("/fx/t" + i + "/stop", log));
            }

            var router = new OscRouter(registry);
            results.Clear();
            failures.Clear();
            Assert.That(router.Route("/fx/*/stop", new object[0], null, results, failures, null, 2, out var skipped), Is.EqualTo(2));
            Assert.That(skipped, Is.EqualTo(3));
            // パターンでなければ枠は効かない
            Assert.That(router.Route("/fx/t4/stop", new object[0], null, results, failures, null, 0, out _), Is.EqualTo(1));
        }

        [Test]
        public void Mismatch_failure_and_exception_are_reported_as_failed()
        {
            var registry = new OscRegistry();
            registry.Register(new OscRegistryEntry("/a/x/level", new OscOperation("level", OscBindingKind.Float, _ => null), null));
            registry.Register(new OscRegistryEntry("/a/x/spawn", new OscOperation("spawn", OscBindingKind.String, _ => "name in use"), null));
            registry.Register(new OscRegistryEntry("/a/x/boom", new OscOperation("boom", OscBindingKind.Trigger, _ => throw new InvalidOperationException("boom")), null));
            var router = new OscRouter(registry);
            var thrown = new List<Exception>();

            results.Clear();
            failures.Clear();
            report.Clear();
            router.Route("/a/x/level", new object[] { "text" }, report, results, failures, (e, ex) => thrown.Add(ex), out _);
            router.Route("/a/x/spawn", new object[] { "spark1" }, report, results, failures, (e, ex) => thrown.Add(ex), out _);
            router.Route("/a/x/boom", new object[0], report, results, failures, (e, ex) => thrown.Add(ex), out _);

            Assert.That(results.Count, Is.EqualTo(3));
            Assert.That(results[0].Outcome, Is.EqualTo(OscDeliveryOutcome.Mismatch));
            Assert.That(results[1].Outcome, Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(results[2].Threw, Is.True);
            Assert.That(thrown.Count, Is.EqualTo(1));
            Assert.That(report.TryBuildFailed(out var failed), Is.True);
            Assert.That(Strings(failed), Is.EqualTo(new[]
            {
                "/a/x/level", OscDeliveryReport.ReasonTypeMismatch,
                "/a/x/spawn", "name in use",
                "/a/x/boom", OscDeliveryReport.ReasonException
            }));
        }

        [Test]
        public void Raw_entry_receives_arguments_unconverted_and_may_report_several_failures()
        {
            var registry = new OscRegistry();
            IReadOnlyList<object> seen = null;
            registry.Register(new OscRegistryEntry("/table/v", new OscOperation("/table/v", (args, list) =>
            {
                seen = args;
                list.Add(OscDeliveryReport.ReasonTypeMismatch);
                list.Add(OscDeliveryReport.ReasonException);
            }), null), OscAddressCheck.NonEmpty);
            var router = new OscRouter(registry);

            Route(router, "/table/v", 7, "x");
            Assert.That(seen, Is.EqualTo(new object[] { 7, "x" }));
            Assert.That(results[0].Outcome, Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(results[0].FailureCount, Is.EqualTo(2));
            Assert.That(report.TryBuildFailed(out var failed), Is.True);
            Assert.That(failed.Length, Is.EqualTo(4));
        }

        [Test]
        public void Non_empty_check_accepts_addresses_the_table_used_to_reach()
        {
            var registry = new OscRegistry();
            var raw = new OscOperation("x", (args, list) => { });
            Assert.That(registry.Register(new OscRegistryEntry("odd name", raw, null), OscAddressCheck.NonEmpty), Is.EqualTo(OscRegistrationResult.Registered));
            Assert.That(registry.Register(new OscRegistryEntry("", raw, null), OscAddressCheck.NonEmpty), Is.EqualTo(OscRegistrationResult.InvalidAddress));
            Assert.That(registry.Register(new OscRegistryEntry("odd name 2", raw, null)), Is.EqualTo(OscRegistrationResult.InvalidAddress));
        }

        [Test]
        public void Entry_unregistered_by_an_earlier_handler_is_skipped()
        {
            var registry = new OscRegistry();
            var log = new List<string>();
            var second = Trigger("/fx/b/stop", log);
            registry.Register(new OscRegistryEntry("/fx/a/stop", new OscOperation("stop", OscBindingKind.Trigger, _ =>
            {
                log.Add("/fx/a/stop");
                registry.Unregister(second);
                registry.Register(Trigger("/fx/c/stop", log)); // 振り分けの途中で足したものには、この受信は届かない
                return null;
            }), null));
            registry.Register(second);
            var router = new OscRouter(registry);

            Route(router, "/fx/*/stop");
            Assert.That(log, Is.EqualTo(new[] { "/fx/a/stop" }));
        }

        [Test]
        public void Nested_route_keeps_the_outer_targets()
        {
            // 処理の中から同じ Router へ別のパターンを振り分けても、外側のまだ呼んでいない登録は変わらない(PR #103 のレビュー)
            var registry = new OscRegistry();
            var log = new List<string>();
            var router = new OscRouter(registry);
            var innerResults = new List<OscRouteResult>();
            var innerFailures = new List<string>();
            registry.Register(new OscRegistryEntry("/fx/a/stop", new OscOperation("stop", OscBindingKind.Trigger, invocation =>
            {
                log.Add("/fx/a/stop");
                router.Route("/other/*/go", new object[0], null, innerResults, innerFailures, null, out var innerSkipped);
                return null;
            }), null));
            registry.Register(Trigger("/fx/b/stop", log));
            registry.Register(Trigger("/other/x/go", log));

            Assert.That(Route(router, "/fx/*/stop"), Is.EqualTo(2));
            Assert.That(log, Is.EqualTo(new[] { "/fx/a/stop", "/other/x/go", "/fx/b/stop" }));
            Assert.That(results.Count, Is.EqualTo(2));
            Assert.That(results[1].Entry.Address, Is.EqualTo("/fx/b/stop"));
        }

        [Test]
        public void Nested_deliver_keeps_the_outer_failure_reason()
        {
            // 処理の中から Registry.Deliver を呼び直しても、外側の失敗の理由が消えない(PR #103 のレビュー)
            var registry = new OscRegistry();
            registry.Register(new OscRegistryEntry("/a/x/inner", new OscOperation("inner", OscBindingKind.Trigger, _ => "inner failed"), null));
            string innerReason = null;
            registry.Register(new OscRegistryEntry("/a/x/outer", new OscOperation("outer", OscBindingKind.Trigger, _ =>
            {
                registry.Deliver("/a/x/inner", new object[0], out innerReason);
                return "outer failed";
            }), null));

            Assert.That(registry.Deliver("/a/x/outer", new object[0], out var reason), Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(reason, Is.EqualTo("outer failed"));
            Assert.That(innerReason, Is.EqualTo("inner failed"));
        }

        [Test]
        public void Pattern_cost_counts_table_cells_and_skips_exact_fallbacks()
        {
            var registry = new OscRegistry();
            var log = new List<string>();
            registry.Register(Trigger("/fx/a/stop", log)); // 10 文字
            registry.Register(Trigger("/fx/bb/stop", log)); // 11 文字
            var router = new OscRouter(registry);

            Assert.That(registry.PatternMatchWidth, Is.EqualTo(11 + 12));
            // "/fx/*/stop" は 10 トークン(1 文字 1 トークン、* も 1 個)
            Assert.That(router.TryGetPatternCost("/fx/*/stop", out var cells), Is.True);
            Assert.That(cells, Is.EqualTo((10 + 1) * (11 + 12)));

            // 記法を含まない・読めない・長すぎるアドレスは完全一致で引くので、パターンの枠を使わない(PR #97 のレビュー)
            Assert.That(router.TryGetPatternCost("/fx/a/stop", out _), Is.False);
            Assert.That(router.TryGetPatternCost("/fx/[a/stop", out _), Is.False);
            Assert.That(router.TryGetPatternCost("/" + new string('*', OscAddressPattern.MaxLength + 1), out _), Is.False);

            registry.Unregister(registry.Snapshot()[0]);
            Assert.That(registry.PatternMatchWidth, Is.EqualTo(12));
        }

        [Test]
        public void Registered_address_longer_than_the_pattern_limit_is_reached_only_exactly()
        {
            // 長すぎる登録のアドレスは判定の表を作らない(PR #103 のセキュリティレビュー)。同じ文字列なら当たる
            var registry = new OscRegistry();
            var log = new List<string>();
            var longAddress = "/fx/" + new string('a', OscAddressPattern.MaxLength) + "/stop";
            registry.Register(Trigger(longAddress, log), OscAddressCheck.NonEmpty);
            registry.Register(Trigger("/fx/b/stop", log));
            var router = new OscRouter(registry);

            Assert.That(registry.PatternMatchWidth, Is.EqualTo(11));
            Assert.That(Route(router, "/fx/*/stop"), Is.EqualTo(1));
            Assert.That(log, Is.EqualTo(new[] { "/fx/b/stop" }));
            Assert.That(Route(router, longAddress), Is.EqualTo(1));
        }

        [Test]
        public void Router_without_a_registry_follows_the_shared_one()
        {
            OscRegistry.ResetShared();
            var log = new List<string>();
            var router = new OscRouter();
            OscRegistry.Shared.Register(Trigger("/fx/a/stop", log));
            Assert.That(Route(router, "/fx/a/stop"), Is.EqualTo(1));

            OscRegistry.ResetShared();
            Assert.That(Route(router, "/fx/a/stop"), Is.EqualTo(0));
            OscRegistry.ResetShared();
        }

        [Test]
        public void Link_answers_ping_and_stats_and_swallows_other_sys()
        {
            var link = new OscLink();
            var now = new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Utc);

            Assert.That(link.TryHandleSystem("/sys/ping", new object[] { 5 }, 0, now, out var address, out var args), Is.True);
            Assert.That(address, Is.EqualTo("/sys/pong"));
            Assert.That(args, Is.EqualTo(new object[] { 5 }));

            Assert.That(link.TryHandleSystem("/sys/ping", new object[] { "x" }, 0, now, out address, out _), Is.True);
            Assert.That(address, Is.Null);

            Assert.That(link.TryHandleSystem("/sys/other", new object[0], 0, now, out address, out _), Is.True);
            Assert.That(address, Is.Null);

            Assert.That(link.TryHandleSystem("/fx/a/stop", new object[0], 0, now, out address, out _), Is.False);

            link.CountParseError();
            Assert.That(link.TryHandleSystem("/sys/stats/request", new object[0], 2, now, out address, out args), Is.True);
            Assert.That(address, Is.EqualTo("/sys/stats"));
            Assert.That(args[0], Is.EqualTo("{\"received\":5,\"parseErrors\":3,\"lastReceivedAt\":\"2026-11-01T00:00:00.000Z\"}"));
        }

        [Test]
        public void Link_echo_turns_bool_into_int()
        {
            Assert.That(OscLink.BuildEcho(new object[] { true, false, 1.5f, "s" }), Is.EqualTo(new object[] { 1, 0, 1.5f, "s" }));
            Assert.That(OscLink.BuildEcho(null), Is.Empty);
        }
    }
}
