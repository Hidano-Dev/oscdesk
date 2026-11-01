using System.Collections.Generic;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    // OSC 1.0 のアドレスのパターン(D-106)
    public sealed class OscAddressPatternTests
    {
        private readonly List<OscInvocation> invocations = new List<OscInvocation>();
        private readonly List<int> mismatches = new List<int>();

        private static bool Matches(string pattern, string address)
        {
            Assert.That(OscAddressPattern.TryParse(pattern, out var parsed, out var error), Is.True, error);
            return parsed.IsMatch(address);
        }

        private static OscDispatcher Make(params string[] addresses)
        {
            var rows = new List<OscBindingRow>();
            foreach (var address in addresses)
            {
                rows.Add(new OscBindingRow(address, OscBindingKind.Trigger, 1));
            }

            return new OscDispatcher(rows);
        }

        private List<int> Fired()
        {
            var indices = new List<int>();
            foreach (var invocation in invocations)
            {
                indices.Add(invocation.RowIndex);
            }

            return indices;
        }

        [Test]
        public void Star_matches_any_run_within_one_part()
        {
            Assert.That(Matches("/effect/spark*/stop", "/effect/spark/stop"), Is.True);
            Assert.That(Matches("/effect/spark*/stop", "/effect/spark12/stop"), Is.True);
            Assert.That(Matches("/effect/spark*/stop", "/effect/smoke/stop"), Is.False);
            // `*` は `/` をまたがない
            Assert.That(Matches("/effect/*", "/effect/spark/stop"), Is.False);
            Assert.That(Matches("/*/*/stop", "/effect/spark/stop"), Is.True);
            Assert.That(Matches("/a**b", "/ab"), Is.True);
        }

        [Test]
        public void Question_mark_matches_one_char_but_not_slash()
        {
            Assert.That(Matches("/ch?", "/ch1"), Is.True);
            Assert.That(Matches("/ch?", "/ch"), Is.False);
            Assert.That(Matches("/ch?", "/ch12"), Is.False);
            Assert.That(Matches("/a?b", "/a/b"), Is.False);
        }

        [Test]
        public void Bracket_matches_set_range_and_negation()
        {
            Assert.That(Matches("/ch[123]", "/ch2"), Is.True);
            Assert.That(Matches("/ch[123]", "/ch4"), Is.False);
            Assert.That(Matches("/ch[1-3]", "/ch3"), Is.True);
            Assert.That(Matches("/ch[1-3]", "/ch0"), Is.False);
            Assert.That(Matches("/ch[!1-3]", "/ch4"), Is.True);
            Assert.That(Matches("/ch[!1-3]", "/ch2"), Is.False);
            // 先頭・末尾の `-` は文字そのもの
            Assert.That(Matches("/a[-x]", "/a-"), Is.True);
            Assert.That(Matches("/a[x-]", "/a-"), Is.True);
            // [!...] でも `/` には一致しない
            Assert.That(Matches("/a[!x]b", "/a/b"), Is.False);
        }

        [Test]
        public void Braces_match_any_listed_string()
        {
            Assert.That(Matches("/effect/{spark,smoke}/stop", "/effect/smoke/stop"), Is.True);
            Assert.That(Matches("/effect/{spark,smoke}/stop", "/effect/fire/stop"), Is.False);
            Assert.That(Matches("/x/{a,ab}c", "/x/abc"), Is.True); // 先の候補で外れても後の候補を試す
            Assert.That(Matches("/x/{,a}b", "/x/b"), Is.True); // 空の候補
        }

        [Test]
        public void Matching_is_case_sensitive_and_whole_string()
        {
            Assert.That(Matches("/Effect/*", "/effect/x"), Is.False);
            Assert.That(Matches("/effect/s*", "/effect/spark/stop"), Is.False);
            Assert.That(Matches("/e*", "/effect"), Is.True);
        }

        [TestCase("/ch[12")]
        [TestCase("/ch[]")]
        [TestCase("/ch[!]")]
        [TestCase("/ch[3-1]")]
        [TestCase("/ch[a/b]")]
        [TestCase("/x/{a,b")]
        [TestCase("/x/{a,{b}}")]
        [TestCase("/x/{a*,b}")]
        [TestCase("/x/{a/b,c}")]
        public void Malformed_patterns_are_rejected(string pattern)
        {
            Assert.That(OscAddressPattern.TryParse(pattern, out _, out var error), Is.False);
            Assert.That(error, Is.Not.Empty);
        }

        [Test]
        public void Too_long_patterns_are_rejected()
        {
            var pattern = "/" + new string('*', OscAddressPattern.MaxLength);
            Assert.That(OscAddressPattern.TryParse(pattern, out _, out _), Is.False);
        }

        [Test]
        public void Pattern_chars_are_detected()
        {
            Assert.That(OscAddressPattern.ContainsPatternChars("/a/b"), Is.False);
            Assert.That(OscAddressPattern.ContainsPatternChars("/a,b]}!-"), Is.False);
            Assert.That(OscAddressPattern.ContainsPatternChars("/a*"), Is.True);
            Assert.That(OscAddressPattern.ContainsPatternChars("/a?"), Is.True);
            Assert.That(OscAddressPattern.ContainsPatternChars("/a[1]"), Is.True);
            Assert.That(OscAddressPattern.ContainsPatternChars("/a{b}"), Is.True);
            Assert.That(OscAddressPattern.ContainsPatternChars(null), Is.False);
        }

        [Test]
        public void Dispatch_with_pattern_reaches_every_matching_row_in_table_order()
        {
            var dispatcher = Make("/effect/spark1/stop", "/effect/smoke/stop", "/effect/spark2/stop", "/effect/spark1/stop");

            Assert.That(dispatcher.Dispatch("/effect/spark*/stop", new object[0], invocations, mismatches, out var skipped), Is.EqualTo(3));
            Assert.That(Fired(), Is.EqualTo(new[] { 0, 2, 3 }));
            Assert.That(skipped, Is.EqualTo(0));
            Assert.That(dispatcher.HasAddress("/effect/spark*/stop"), Is.True);
            Assert.That(dispatcher.HasAddress("/effect/fire*/stop"), Is.False);
        }

        [Test]
        public void Dispatch_without_pattern_stays_exact_match()
        {
            var dispatcher = Make("/effect/spark/stop", "/effect/spark");

            Assert.That(dispatcher.Dispatch("/effect/spark", new object[0], invocations, mismatches), Is.EqualTo(1));
            Assert.That(Fired(), Is.EqualTo(new[] { 1 }));
            Assert.That(dispatcher.Dispatch("/effect", new object[0], invocations, mismatches), Is.EqualTo(0));
        }

        [Test]
        public void Pattern_respects_row_types_and_reports_mismatches()
        {
            var dispatcher = new OscDispatcher(new[]
            {
                new OscBindingRow("/mix/ch1/level", OscBindingKind.Float, 1),
                new OscBindingRow("/mix/ch2/level", OscBindingKind.String, 1)
            });

            Assert.That(dispatcher.Dispatch("/mix/ch?/level", new object[] { 0.5f }, invocations, mismatches), Is.EqualTo(1));
            Assert.That(invocations[0].RowIndex, Is.EqualTo(0));
            Assert.That(mismatches, Is.EqualTo(new[] { 1 }));
        }

        [Test]
        public void Malformed_pattern_falls_back_to_exact_match()
        {
            // 記法の文字を含む既存の行は、同じ文字列が届けば今までどおり当たる
            var dispatcher = Make("/odd[name", "/odd/x");

            Assert.That(dispatcher.Dispatch("/odd[name", new object[0], invocations, mismatches), Is.EqualTo(1));
            Assert.That(Fired(), Is.EqualTo(new[] { 0 }));
            Assert.That(dispatcher.Dispatch("/odd[x", new object[0], invocations, mismatches), Is.EqualTo(0));
            Assert.That(dispatcher.HasAddress("/odd[x"), Is.False);
        }

        [Test]
        public void Valid_pattern_still_reaches_a_row_with_the_same_literal_text()
        {
            var dispatcher = Make("/a[1]");

            Assert.That(dispatcher.Dispatch("/a[1]", new object[0], invocations, mismatches), Is.EqualTo(1));
        }

        [Test]
        public void Pattern_matches_are_capped()
        {
            var addresses = new List<string>();
            for (var i = 0; i < OscDispatcher.MaxPatternMatches + 5; i++)
            {
                addresses.Add("/fx/t" + i + "/stop");
            }

            var dispatcher = Make(addresses.ToArray());

            Assert.That(dispatcher.Dispatch("/fx/*/stop", new object[0], invocations, mismatches, out var skipped),
                Is.EqualTo(OscDispatcher.MaxPatternMatches));
            Assert.That(skipped, Is.EqualTo(5));
            Assert.That(invocations[0].RowIndex, Is.EqualTo(0)); // 並びの前から呼び、後ろを落とす

            var warnings = new OscReceiveWarnings();
            var lines = new List<string>();
            warnings.CollectPatternOverflow("/fx/*/stop", skipped, lines);
            warnings.CollectPatternOverflow("/fx/*/stop", skipped, lines);
            Assert.That(lines.Count, Is.EqualTo(1)); // 同じパターンは 1 回だけ
            warnings.ResetReported();
            warnings.CollectPatternOverflow("/fx/*/stop", skipped, lines);
            Assert.That(lines.Count, Is.EqualTo(2));
            warnings.CollectPatternOverflow("/fx/*/stop", 0, lines);
            Assert.That(lines.Count, Is.EqualTo(2));
        }

        [Test]
        public void Unbound_warning_considers_pattern_matches()
        {
            var dispatcher = Make("/fx/a/stop");
            var warnings = new OscReceiveWarnings();
            var lines = new List<string>();

            dispatcher.Dispatch("/fx/*/stop", new object[0], invocations, mismatches);
            warnings.Collect(dispatcher, "/fx/*/stop", new object[0], mismatches, true, true, lines);
            Assert.That(lines, Is.Empty);

            dispatcher.Dispatch("/fx/*/go", new object[0], invocations, mismatches);
            warnings.Collect(dispatcher, "/fx/*/go", new object[0], mismatches, true, true, lines);
            Assert.That(lines.Count, Is.EqualTo(1));
        }

        [Test]
        public void Star_matching_grows_linearly_with_the_address()
        {
            // 各位置から残りを全部試すと長さの 2 乗になる(PR #97 の指摘)。表を後ろから埋めれば トークン数 × 長さ で終わる
            var pattern = "/" + string.Concat(System.Linq.Enumerable.Repeat("*a", 120)) + "b";
            Assert.That(OscAddressPattern.TryParse(pattern, out var parsed, out _), Is.True);
            var address = "/" + new string('a', 20000);
            var watch = System.Diagnostics.Stopwatch.StartNew();
            for (var i = 0; i < 10; i++)
            {
                Assert.That(parsed.IsMatch(address), Is.False);
            }

            Assert.That(parsed.IsMatch("/" + new string('a', 200) + "b"), Is.True);
            Assert.That(watch.ElapsedMilliseconds, Is.LessThan(2000));
        }

        [Test]
        public void Dispatch_respects_a_smaller_cap()
        {
            var dispatcher = Make("/fx/a/stop", "/fx/b/stop", "/fx/c/stop");
            Assert.That(dispatcher.Dispatch("/fx/*/stop", new object[0], invocations, mismatches, 2, out var skipped), Is.EqualTo(2));
            Assert.That(skipped, Is.EqualTo(1));
            Assert.That(dispatcher.Dispatch("/fx/*/stop", new object[0], invocations, mismatches, 1000, out skipped), Is.EqualTo(3));
            Assert.That(dispatcher.Dispatch("/fx/a/stop", new object[0], invocations, mismatches, 0, out _), Is.EqualTo(1)); // パターンでなければ枠は効かない
        }

        [Test]
        public void Frame_budget_limits_pattern_messages_and_targets()
        {
            var budget = new OscPatternBudget();
            budget.Reset();
            for (var i = 0; i < OscPatternBudget.MaxMessagesPerFrame; i++)
            {
                Assert.That(budget.TryBegin(out var allowed), Is.True);
                Assert.That(allowed, Is.GreaterThan(0));
            }

            Assert.That(budget.TryBegin(out _), Is.False);
            Assert.That(budget.Dropped, Is.EqualTo(1));

            budget.Reset();
            Assert.That(budget.TryBegin(out var first), Is.True);
            Assert.That(first, Is.EqualTo(OscPatternBudget.MaxTargetsPerFrame));
            budget.Consume(OscPatternBudget.MaxTargetsPerFrame - 10);
            Assert.That(budget.TryBegin(out var rest), Is.True);
            Assert.That(rest, Is.EqualTo(10));
            budget.Consume(10);
            Assert.That(budget.TryBegin(out _), Is.False);
        }

        [Test]
        public void Frame_budget_counts_scanned_addresses()
        {
            var budget = new OscPatternBudget();
            budget.Reset();
            // 最初のパターンは走査の枠を超えても通す
            Assert.That(budget.TryBegin(OscPatternBudget.MaxScansPerFrame + 1, out _), Is.True);
            Assert.That(budget.TryBegin(1, out _), Is.False);
            Assert.That(budget.Dropped, Is.EqualTo(1));

            budget.Reset();
            Assert.That(budget.TryBegin(OscPatternBudget.MaxScansPerFrame / 2, out _), Is.True);
            Assert.That(budget.TryBegin(OscPatternBudget.MaxScansPerFrame / 2, out _), Is.True);
            Assert.That(budget.TryBegin(1, out _), Is.False);
        }

        [Test]
        public void HasAddress_reuses_the_last_pattern_dispatch()
        {
            var dispatcher = Make("/fx/a/stop", "/fx/b/stop");
            dispatcher.Dispatch("/fx/*/go", new object[0], invocations, mismatches);
            Assert.That(dispatcher.HasAddress("/fx/*/go"), Is.False);
            dispatcher.Dispatch("/fx/*/stop", new object[0], invocations, mismatches);
            Assert.That(dispatcher.HasAddress("/fx/*/stop"), Is.True);
            Assert.That(dispatcher.HasAddress("/fx/a*/stop"), Is.True); // 直前と違うパターンは走査する
            Assert.That(dispatcher.AddressCount, Is.EqualTo(2));
        }

        [Test]
        public void Pathological_pattern_finishes_quickly()
        {
            // `*` を並べたパターンで指数的に判定が増えないこと(メモ化の確認)
            var pattern = "/" + string.Concat(System.Linq.Enumerable.Repeat("*a", 60)) + "b";
            Assert.That(OscAddressPattern.TryParse(pattern, out var parsed, out _), Is.True);
            var address = "/" + new string('a', 200);
            var watch = System.Diagnostics.Stopwatch.StartNew();
            Assert.That(parsed.IsMatch(address), Is.False);
            Assert.That(watch.ElapsedMilliseconds, Is.LessThan(1000));
        }
    }
}
