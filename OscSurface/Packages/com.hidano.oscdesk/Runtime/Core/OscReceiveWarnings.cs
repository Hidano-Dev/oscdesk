// OscReceiveWarnings.cs — 受信で出す警告の出し分け(DESIGN.md D-102)。UnityEngine に依存しない。
using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 振り分けの結果から、ログに出す警告の文を作る。
    /// 行の無いアドレス(自分に無い対象への命令)は、別プロジェクトの PC にも同じ命令を一括で送る通常の運用で届くので、
    /// 呼び出し側は既定で出さない(出すと Console が埋まり、本当の問題が見えなくなる)。出すときも同じアドレスは 1 回だけにする。
    /// 行はあるのに処理できない受信(型・Record の不一致)は本当の問題なので、受けるたびに出す。
    /// 設定(出すかどうか)は呼び出し側が持ち、ここには「出した」印だけを持つ(写しを持つと設定とずれるため)。
    /// </summary>
    public sealed class OscReceiveWarnings
    {
        /// <summary>
        /// 行の無いアドレスとして覚えておく数の上限。届いたアドレスを無制限に覚えると、LAN から異なるアドレスを送り続けるだけで
        /// メモリを食い潰せる。上限に達したら以後の新しいアドレスは出さず、その旨を 1 回だけ出す(有効化で数え直す)。
        /// </summary>
        public const int MaxReportedUnbound = 256;

        private readonly HashSet<string> reportedUnbound = new HashSet<string>(StringComparer.Ordinal);
        private bool unboundLimitReported;
        private readonly HashSet<string> reportedOverflow = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>
        /// Dispatch の結果(mismatches)に対する警告を output に足す。output は消さない。
        /// dispatcher は Dispatch に使ったものを渡す(mismatches の番号はその対応表の行を指す)。
        /// 行の無いアドレスで logUnboundAddresses が false のときは、後で有効にしたときに出せるよう「出した」印も付けない。
        /// </summary>
        public void Collect(OscDispatcher dispatcher, string address, IReadOnlyList<object> values, List<int> mismatches,
            bool logMismatches, bool logUnboundAddresses, List<string> output)
        {
            if (dispatcher == null) throw new ArgumentNullException(nameof(dispatcher));
            if (output == null) throw new ArgumentNullException(nameof(output));

            if (!dispatcher.HasAddress(address))
            {
                if (!logUnboundAddresses || address == null || reportedUnbound.Contains(address))
                {
                    return;
                }

                if (reportedUnbound.Count >= MaxReportedUnbound)
                {
                    if (!unboundLimitReported)
                    {
                        unboundLimitReported = true;
                        output.Add("no binding for のアドレスが " + MaxReportedUnbound + " 個に達したので、以後の新しいアドレスは出しません(有効化をやり直すと数え直します)");
                    }

                    return;
                }

                reportedUnbound.Add(address);
                output.Add("no binding for " + address + "(このアドレスは以後出しません)");

                return;
            }

            if (!logMismatches || mismatches == null)
            {
                return;
            }

            // 受信ごとに通る経路なので、列挙子の確保を避けて番号で回す
            for (var i = 0; i < mismatches.Count; i++)
            {
                var row = dispatcher.RowAt(mismatches[i]);
                if (row.Kind == OscBindingKind.Record)
                {
                    // レコードの不正な形(先頭が s でない・行 ID と名前が揃わない・フィールド数の違い)
                    output.Add("record mismatch for " + OscDispatcher.Describe(row) + ": " + OscDispatcher.ExplainMismatch(row, values));
                }
                else
                {
                    output.Add("argument type mismatch for " + OscDispatcher.Describe(row));
                }
            }
        }

        /// <summary>
        /// パターンに一致した行が OscDispatcher.MaxPatternMatches を超えて、一部を呼ばなかったときの警告を output に足す(D-106)。
        /// 同じパターンは 1 回だけ出す(フェーダーの連続送信で Console を埋めないため)。覚える数の上限は行の無いアドレスと同じ。
        /// </summary>
        public void CollectPatternOverflow(string address, int skipped, List<string> output)
        {
            if (output == null) throw new ArgumentNullException(nameof(output));
            if (skipped <= 0 || address == null || reportedOverflow.Contains(address) || reportedOverflow.Count >= MaxReportedUnbound)
            {
                return;
            }

            reportedOverflow.Add(address);
            output.Add("pattern " + address + " に一致した行が多すぎるので、上限 " + OscDispatcher.MaxPatternMatches + " 行を超えた "
                + skipped + " 行を呼びませんでした(このパターンは以後出しません)");
        }

        /// <summary>
        /// 「出した」印を消す。対応表を作り直したとき(有効化)に呼ぶ。行を足して外したアドレスが、行の無いアドレスとしてまた出るようにする。
        /// </summary>
        public void ResetReported()
        {
            reportedUnbound.Clear();
            unboundLimitReported = false;
            reportedOverflow.Clear();
        }
    }
}
