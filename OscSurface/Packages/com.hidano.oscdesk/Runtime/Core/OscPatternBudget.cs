// OscPatternBudget.cs — 1 フレームでパターン(D-106)に振り分ける量の枠。UnityEngine に依存しない。
using System;

namespace OscDesk.Receiver
{
    /// <summary>
    /// パターンの受信は 1 通で多数の受け手を呼べ、bundle に何千通も詰められる(1 データグラムで 100 万回を超える呼び出しになり得る。
    /// PR #97 の Codex セキュリティレビュー)。メッセージ 1 通あたりの上限(MaxPatternMatches)だけでは bundle で累積するので、
    /// 受け口は 1 フレームに振り分けるパターンのメッセージの数と、それで呼ぶ受け手の数の合計にも枠を置く。
    /// 枠を超えたパターンのメッセージは、突き合わせ(登録の数 × パターンの判定)もせずに捨てる。パターンでない受信は数えない。
    /// </summary>
    public sealed class OscPatternBudget
    {
        /// <summary>1 フレームに振り分けるパターンのメッセージの上限。</summary>
        public const int MaxMessagesPerFrame = 64;

        /// <summary>1 フレームにパターンで呼ぶ受け手(行・登録)の合計の上限。</summary>
        public const int MaxTargetsPerFrame = 1024;

        /// <summary>
        /// 1 フレームにパターンの判定で埋める表のマスの合計の上限。一致しないパターンでも登録をすべて走査し、判定 1 回は
        /// (トークン数 + 1)×(アドレスの長さ + 1)のマスを埋めるので、登録の数でなくマスの数で数える(PR #97 のセキュリティレビュー)。
        /// 1 フレームの最初のパターンにも効かせる(登録の数・アドレスの長さ・パターンの長さを掛けた 1 通だけで止まらないように)。
        /// 2^21 は、20 トークンのパターンを 25 文字のアドレス 3,800 件ほどと突き合わせられる量で、1 フレームの判定を数 ms に抑える目安。
        /// </summary>
        public const long MaxCellsPerFrame = 1L << 21;

        private int messages;
        private int targets;
        private long cells;

        /// <summary>このフレームで枠を超えて捨てたパターンのメッセージの数。</summary>
        public int Dropped { get; private set; }

        /// <summary>フレームの初めに呼ぶ。</summary>
        public void Reset()
        {
            messages = 0;
            targets = 0;
            cells = 0;
            Dropped = 0;
        }

        /// <summary>
        /// 判定で埋める表のマスの数(cellCost。OscRouter.TryGetPatternCost)も枠に数えて、パターンのメッセージ 1 通を振り分けてよいか。
        /// フレームの残りのマスより多ければ、フレームの最初の 1 通でも振り分けない。
        /// </summary>
        public bool TryBegin(long cellCost, out int allowedTargets)
        {
            var cost = Math.Max(0L, cellCost);
            if (cost > MaxCellsPerFrame - cells)
            {
                Dropped += 1;
                allowedTargets = 0;
                return false;
            }

            if (!TryBegin(out allowedTargets))
            {
                return false;
            }

            cells += cost;
            return true;
        }

        /// <summary>
        /// パターンのメッセージ 1 通を振り分けてよいか。よければ true と、呼んでよい受け手の数(1 通の上限とは別に、フレームの残り)を返す。
        /// 枠が無ければ false(Dropped を数える)。
        /// </summary>
        public bool TryBegin(out int allowedTargets)
        {
            if (messages >= MaxMessagesPerFrame || targets >= MaxTargetsPerFrame)
            {
                Dropped += 1;
                allowedTargets = 0;
                return false;
            }

            messages += 1;
            allowedTargets = MaxTargetsPerFrame - targets;
            return true;
        }

        /// <summary>振り分けた受け手の数を差し引く。</summary>
        public void Consume(int count)
        {
            if (count > 0)
            {
                targets += count;
            }
        }
    }
}
