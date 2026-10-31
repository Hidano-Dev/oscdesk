// OscReceiveWarnings.cs — 受信で出す警告の出し分け(DESIGN.md D-102)。UnityEngine に依存しない。
using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 振り分けの結果から、ログに出す警告の文を作る。
    /// 行の無いアドレス(自分に無い対象への命令)は、別プロジェクトの PC にも同じ命令を一括で送る通常の運用で届くので、
    /// 既定では出さない(出すと Console が埋まり、本当の問題が見えなくなる)。調べるために有効にしても、同じアドレスは 1 回だけ出す。
    /// 行はあるのに処理できない受信(型・Record の不一致)と読めないデータグラムは本当の問題なので、既定で出す。
    /// </summary>
    public sealed class OscReceiveWarnings
    {
        private readonly HashSet<string> reportedUnbound = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>型・Record の不一致と、読めないデータグラムを出すか(既定 true)。</summary>
        public bool LogMismatches { get; set; } = true;

        /// <summary>行の無いアドレスの受信を出すか(既定 false)。同じアドレスはこのインスタンスで 1 回だけ出す。</summary>
        public bool LogUnboundAddresses { get; set; }

        /// <summary>読めないデータグラムの警告を出すか。</summary>
        public bool ShouldReportParseError
        {
            get { return LogMismatches; }
        }

        /// <summary>
        /// Dispatch の結果(mismatches)に対する警告を output に足す。output は消さない。
        /// 行の無いアドレスで LogUnboundAddresses が false のときは、後で有効にしたときに出せるよう「出した」印も付けない。
        /// </summary>
        public void Collect(OscDispatcher dispatcher, string address, IReadOnlyList<object> values, IReadOnlyList<int> mismatches, List<string> output)
        {
            if (dispatcher == null) throw new ArgumentNullException(nameof(dispatcher));
            if (output == null) throw new ArgumentNullException(nameof(output));

            if (!dispatcher.HasAddress(address))
            {
                if (LogUnboundAddresses && address != null && reportedUnbound.Add(address))
                {
                    output.Add("no binding for " + address + "(このアドレスは以後出しません)");
                }

                return;
            }

            if (!LogMismatches || mismatches == null)
            {
                return;
            }

            foreach (var index in mismatches)
            {
                var row = dispatcher.RowAt(index);
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
    }
}
