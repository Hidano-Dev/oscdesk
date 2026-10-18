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
            foreach (var binding in ExpectedBindings(parameters, null))
            {
                result.Add(new KeyValuePair<string, OscBindingKind>(binding.Address, binding.Kind));
            }

            return result;
        }

        /// <summary>
        /// パラメータとレコードから求める行。並びはパラメータ → レコード(Record の行、フィールド id つき)
        /// → OscDesk から受けるキーの一覧(keysFrom.source "ui" の keysFrom.address、Strings。D-075)→ 要求のアドレス
        /// (パラメータの optionsFrom.request → レコードの keysFrom.request → レコードのフィールドの optionsFrom.request、いずれも Trigger)。
        /// それ以外の keysFrom.address と optionsFrom.address は Unity が送る側なので行の不足として扱わない(D-057 と同じ)。
        /// 同じアドレスは先に現れたものを採る。
        /// </summary>
        public static List<OscExpectedBinding> ExpectedBindings(IEnumerable<OscDefinitionParameter> parameters, IEnumerable<OscDefinitionRecord> records)
        {
            var parameterList = new List<OscDefinitionParameter>(parameters ?? Array.Empty<OscDefinitionParameter>());
            var recordList = new List<OscDefinitionRecord>(records ?? Array.Empty<OscDefinitionRecord>());
            var result = new List<OscExpectedBinding>();
            var seen = new HashSet<string>(StringComparer.Ordinal);

            foreach (var parameter in parameterList)
            {
                if (seen.Add(parameter.Address))
                {
                    result.Add(new OscExpectedBinding(parameter.Address, parameter.SuggestKind()));
                }
            }

            foreach (var record in recordList)
            {
                if (seen.Add(record.Address))
                {
                    result.Add(new OscExpectedBinding(record.Address, OscBindingKind.Record, record.FieldIds()));
                }
            }

            foreach (var record in recordList)
            {
                if (record.ReceivesKeys && record.KeysFromAddress.Length > 0 && seen.Add(record.KeysFromAddress))
                {
                    result.Add(new OscExpectedBinding(record.KeysFromAddress, OscBindingKind.Strings));
                }
            }

            void AddRequest(string request)
            {
                if (request.Length > 0 && seen.Add(request))
                {
                    result.Add(new OscExpectedBinding(request, OscBindingKind.Trigger));
                }
            }

            foreach (var parameter in parameterList)
            {
                AddRequest(parameter.OptionsFromRequest);
            }

            foreach (var record in recordList)
            {
                AddRequest(record.KeysFromRequest);
            }

            foreach (var record in recordList)
            {
                foreach (var field in record.Fields)
                {
                    AddRequest(field.OptionsFromRequest);
                }
            }

            return result;
        }
    }
}
