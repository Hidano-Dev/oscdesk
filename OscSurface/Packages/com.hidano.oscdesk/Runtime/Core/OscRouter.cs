// OscRouter.cs — 届いたアドレスを Registry の登録へ振り分ける(DESIGN.md D-108)。UnityEngine に依存しない。
using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>振り分けた登録 1 件の結果。理由は Route に渡した failures の [FailureStart, FailureStart + FailureCount)。</summary>
    public readonly struct OscRouteResult
    {
        public OscRegistryEntry Entry { get; }
        public OscDeliveryOutcome Outcome { get; }
        /// <summary>処理が例外を投げた(Outcome は Failed、理由は "exception")。</summary>
        public bool Threw { get; }
        public int FailureStart { get; }
        public int FailureCount { get; }

        public OscRouteResult(OscRegistryEntry entry, OscDeliveryOutcome outcome, bool threw, int failureStart, int failureCount)
        {
            Entry = entry;
            Outcome = outcome;
            Threw = threw;
            FailureStart = failureStart;
            FailureCount = failureCount;
        }
    }

    /// <summary>
    /// Router。届いたアドレスが OSC 1.0 のパターン(D-106)なら一致した登録すべてへ(登録の順に、MaxPatternMatches 件まで)、
    /// そうでなければ完全一致の登録へ渡す。結果は /sys/ignored・/sys/failed の報告(D-105)に溜める。
    /// 受信(Transport)と接続確認・エコー(Link)は持たない。
    /// </summary>
    public sealed class OscRouter
    {
        /// <summary>パターン 1 つで振り分ける登録の上限(D-106 の行の上限を、Registry の登録の数として引き継ぐ)。</summary>
        public const int MaxPatternMatches = OscDispatcher.MaxPatternMatches;

        public const string ReasonException = OscDeliveryReport.ReasonException;

        private readonly OscRegistry fixedRegistry;
        private readonly List<OscRegistryEntry> targets = new List<OscRegistryEntry>();
        private string lastPatternText;
        private OscAddressPattern lastPattern;

        /// <summary>registry が null なら、振り分けのたびに OscRegistry.Shared を引く(Play の開始で作り直されても追う)。</summary>
        public OscRouter(OscRegistry registry = null)
        {
            fixedRegistry = registry;
        }

        public OscRegistry Registry => fixedRegistry ?? OscRegistry.Shared;

        /// <summary>
        /// 振り分ける。戻り値は当たった登録の数(0 なら report に ignored を足す)。
        /// results / failures は呼び出し側が渡して消さずに足す(受信ごとの確保を避ける)。report は null でもよい。
        /// 処理の例外は捕まえて onException に渡し、理由 "exception" の失敗として扱う(1 つの受け手の例外で他を止めない)。
        /// 処理の中で登録・解除してよい。先に当たる登録を決めてから渡し、渡す前に解除されたものには渡さない。
        /// </summary>
        public int Route(string address, IReadOnlyList<object> args, OscDeliveryReport report, List<OscRouteResult> results,
            List<string> failures, Action<OscRegistryEntry, Exception> onException, out int skipped)
        {
            return Route(address, args, report, results, failures, onException, MaxPatternMatches, out skipped);
        }

        /// <summary>
        /// 振り分ける。パターンのときに渡す登録を maxPatternMatches(MaxPatternMatches を超えない)までにする。
        /// 受け口は 1 フレームの残りの枠(OscPatternBudget、D-106)を渡す。
        /// </summary>
        public int Route(string address, IReadOnlyList<object> args, OscDeliveryReport report, List<OscRouteResult> results,
            List<string> failures, Action<OscRegistryEntry, Exception> onException, int maxPatternMatches, out int skipped)
        {
            var cap = Math.Max(0, Math.Min(maxPatternMatches, MaxPatternMatches));
            if (results == null) throw new ArgumentNullException(nameof(results));
            if (failures == null) throw new ArgumentNullException(nameof(failures));

            skipped = 0;
            var registry = Registry;
            targets.Clear();
            if (address != null)
            {
                var pattern = PatternFor(address);
                if (pattern == null)
                {
                    if (registry.TryGet(address, out var exact))
                    {
                        targets.Add(exact);
                    }
                }
                else
                {
                    var ordered = registry.Ordered;
                    for (var i = 0; i < ordered.Count; i++)
                    {
                        var candidate = ordered[i];
                        // 記法の文字を含むアドレスの行も、同じ文字列が届けば当たる(D-106)
                        if (string.Equals(candidate.Address, address, StringComparison.Ordinal) || pattern.IsMatch(candidate.Address))
                        {
                            if (targets.Count >= cap)
                            {
                                skipped += 1;
                                continue;
                            }

                            targets.Add(candidate);
                        }
                    }
                }
            }

            if (targets.Count == 0)
            {
                report?.AddIgnored(address);
                return 0;
            }

            // 処理の中の登録・解除で targets が変わらないよう、ここからは写しを持たない番号で回す(targets は Route の外へ出さない)
            var count = targets.Count;
            for (var i = 0; i < count; i++)
            {
                var entry = targets[i];
                if (!registry.TryGet(entry.Address, out var current) || !ReferenceEquals(current, entry))
                {
                    continue; // 先に呼んだ処理が解除した
                }

                var start = failures.Count;
                OscDeliveryOutcome outcome;
                var threw = false;
                try
                {
                    outcome = OscRegistry.DeliverTo(entry, args, failures);
                }
                catch (Exception exception)
                {
                    threw = true;
                    outcome = OscDeliveryOutcome.Failed;
                    failures.Add(ReasonException);
                    onException?.Invoke(entry, exception);
                }

                for (var n = start; n < failures.Count; n++)
                {
                    report?.AddFailed(address, failures[n]);
                }

                results.Add(new OscRouteResult(entry, outcome, threw, start, failures.Count - start));
            }

            return count;
        }

        /// <summary>パターンの記法を含まない・読めない・長すぎるときは null(完全一致で引く。D-106)。</summary>
        private OscAddressPattern PatternFor(string address)
        {
            if (!OscAddressPattern.ContainsPatternChars(address))
            {
                return null;
            }

            if (string.Equals(lastPatternText, address, StringComparison.Ordinal))
            {
                return lastPattern;
            }

            OscAddressPattern.TryParse(address, out var parsed, out _);
            lastPatternText = address;
            lastPattern = parsed;
            return parsed;
        }
    }
}
