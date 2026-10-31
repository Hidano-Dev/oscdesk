// OscPatternBudget.cs — 1 フレームでパターン(D-106)に振り分ける量の枠。UnityEngine に依存しない。
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

        private int messages;
        private int targets;

        /// <summary>このフレームで枠を超えて捨てたパターンのメッセージの数。</summary>
        public int Dropped { get; private set; }

        /// <summary>フレームの初めに呼ぶ。</summary>
        public void Reset()
        {
            messages = 0;
            targets = 0;
            Dropped = 0;
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
