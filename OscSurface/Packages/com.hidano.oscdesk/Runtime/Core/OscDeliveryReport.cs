// OscDeliveryReport.cs — 受けたが処理しなかったものの報告(/sys/ignored・/sys/failed。DESIGN.md D-105)。UnityEngine に依存しない。
using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 1 つのデータグラム(bundle なら中身すべて)の振り分けで「対象が無かった」「処理できなかった」ものを溜め、
    /// 送る引数を作る。1 データグラムにつき /sys/ignored・/sys/failed を最大 1 メッセージずつにまとめる(64 件の bundle で
    /// 64 データグラムを返さない)ための入れ物。認証の無い LAN で、受信 1 回が増幅して返らないように件数と文字数に上限を置く。
    /// 上限を超えた分は黙って切り捨てる(報告は任意の契約で、切り捨てても緑/黄/赤の判定の向きは変わらない)。
    /// </summary>
    public sealed class OscDeliveryReport
    {
        public const string IgnoredAddress = "/sys/ignored";
        public const string FailedAddress = "/sys/failed";

        public const string ReasonTypeMismatch = "type mismatch";
        public const string ReasonRecordMismatch = "record mismatch";
        public const string ReasonException = "exception";

        /// <summary>/sys/ignored に載せるアドレスの上限(同じアドレスは 1 回)。</summary>
        public const int MaxIgnored = 32;

        /// <summary>/sys/failed に載せる(アドレス, 理由)の組の上限。</summary>
        public const int MaxFailed = 16;

        /// <summary>1 つの文字列の上限(UTF-16 の文字数)。超えた分は切る。</summary>
        public const int MaxTextLength = 128;

        private readonly List<string> ignored = new List<string>();
        private readonly List<string> failed = new List<string>(); // [アドレス, 理由, アドレス, 理由, ...]

        public bool IsEmpty { get { return ignored.Count == 0 && failed.Count == 0; } }

        public void Clear()
        {
            ignored.Clear();
            failed.Clear();
        }

        public void AddIgnored(string address)
        {
            if (address == null || ignored.Count >= MaxIgnored)
            {
                return;
            }

            var text = Clip(address);
            if (!ignored.Contains(text))
            {
                ignored.Add(text);
            }
        }

        public void AddFailed(string address, string reason)
        {
            if (address == null || failed.Count >= MaxFailed * 2)
            {
                return;
            }

            failed.Add(Clip(address));
            failed.Add(Clip(reason ?? string.Empty));
        }

        /// <summary>
        /// 振り分け(Dispatch)の結果を溜める。行の無いアドレスは ignored、行はあるのに型・Record が合わなかった行は failed。
        /// dispatcher は Dispatch に使ったものを渡す(mismatches の番号はその対応表の行を指す)。
        /// </summary>
        public void Observe(OscDispatcher dispatcher, string address, List<int> mismatches)
        {
            if (dispatcher == null) throw new ArgumentNullException(nameof(dispatcher));

            if (!dispatcher.HasAddress(address))
            {
                AddIgnored(address);
                return;
            }

            if (mismatches == null)
            {
                return;
            }

            for (var i = 0; i < mismatches.Count; i++)
            {
                var kind = dispatcher.RowAt(mismatches[i]).Kind;
                AddFailed(address, kind == OscBindingKind.Record ? ReasonRecordMismatch : ReasonTypeMismatch);
            }
        }

        /// <summary>/sys/ignored の引数(s を N 個)。無ければ false。</summary>
        public bool TryBuildIgnored(out object[] args)
        {
            return TryBuild(ignored, out args);
        }

        /// <summary>/sys/failed の引数(s アドレス, s 理由 を N 組)。無ければ false。</summary>
        public bool TryBuildFailed(out object[] args)
        {
            return TryBuild(failed, out args);
        }

        private static bool TryBuild(List<string> source, out object[] args)
        {
            if (source.Count == 0)
            {
                args = null;
                return false;
            }

            args = new object[source.Count];
            for (var i = 0; i < args.Length; i++)
            {
                args[i] = source[i];
            }

            return true;
        }

        private static string Clip(string text)
        {
            if (text.Length <= MaxTextLength)
            {
                return text;
            }

            var length = MaxTextLength;
            if (char.IsHighSurrogate(text[length - 1]))
            {
                length -= 1; // サロゲートペアを割らない(割ると UTF-8 にできない)
            }

            return text.Substring(0, length);
        }
    }
}
