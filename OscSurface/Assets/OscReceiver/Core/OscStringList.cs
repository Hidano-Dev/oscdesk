using System;
using System.Collections.Generic;
using System.Text;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 文字列の一覧(optionsFrom.address へ返す `s` 引数 N 個の 1 メッセージ)を送る前の検査。
    /// OSC 1.0 にメッセージ分割の機構は無く、1 データグラムが大きすぎると届かないまま黙って失われるため、
    /// 上限(docs/UNITY_PROTOCOL.md の 60 KiB)を超える一覧は送らずに理由を返す。
    /// </summary>
    public static class OscStringList
    {
        public const int MaxDatagramBytes = 60 * 1024;

        public static bool TryValidate(string address, IReadOnlyList<string> values, out string reason)
        {
            reason = null;
            if (!OscBindingAudit.IsValidAddress(address))
            {
                reason = "アドレスが不正です(空、/ で始まらない、空白やワイルドカードを含む、または /sys・/oscdesk 配下): \"" + address + "\"";
                return false;
            }

            if (values == null)
            {
                reason = "一覧が null です。";
                return false;
            }

            var size = EstimateSize(address, values);
            if (size > MaxDatagramBytes)
            {
                reason = "一覧が大きすぎます(" + size + " バイト、上限 " + MaxDatagramBytes + " バイト)。";
                return false;
            }

            return true;
        }

        /// <summary>OSC メッセージのバイト数: アドレス + 型タグ(",s…s")+ 各文字列。いずれも NUL 終端のうえ 4 バイト境界へ詰める。</summary>
        public static int EstimateSize(string address, IReadOnlyList<string> values)
        {
            var size = PaddedStringSize(Encoding.UTF8.GetByteCount(address ?? string.Empty));
            size += PaddedStringSize(1 + values.Count);
            foreach (var value in values)
            {
                size += PaddedStringSize(Encoding.UTF8.GetByteCount(value ?? string.Empty));
            }

            return size;
        }

        private static int PaddedStringSize(int byteCount)
        {
            return (byteCount + 4) & ~3;
        }
    }

    /// <summary>定義から対応表に必要な行(アドレスと型の提案)を取り出す。</summary>
    public static class OscDefinitionRows
    {
        /// <summary>
        /// パラメータのアドレスに加え、optionsFrom.request は Trigger の行として求める(アプリが一覧を返す関数を登録する口)。
        /// optionsFrom.address は Unity が送る側なので行の不足として扱わない。
        /// 同じアドレスは先に現れたものを採る。
        /// </summary>
        public static List<KeyValuePair<string, OscBindingKind>> Expected(IEnumerable<OscDefinitionParameter> parameters)
        {
            var result = new List<KeyValuePair<string, OscBindingKind>>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var parameter in parameters)
            {
                if (seen.Add(parameter.Address))
                {
                    result.Add(new KeyValuePair<string, OscBindingKind>(parameter.Address, parameter.SuggestKind()));
                }
            }

            foreach (var parameter in parameters)
            {
                if (parameter.OptionsFromRequest.Length > 0 && seen.Add(parameter.OptionsFromRequest))
                {
                    result.Add(new KeyValuePair<string, OscBindingKind>(parameter.OptionsFromRequest, OscBindingKind.Trigger));
                }
            }

            return result;
        }
    }
}
