using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    public readonly struct OscBindingWarning
    {
        /// <summary>A1 定義に無いアドレス / A2 アドレスが不正 / A3 同じアドレスと型の重複 / A4 リスナー未設定 / A5 定義にあるのに行が無い</summary>
        public string Code { get; }
        public string Address { get; }
        public string Message { get; }

        public OscBindingWarning(string code, string address, string message)
        {
            Code = code;
            Address = address;
            Message = message;
        }
    }

    /// <summary>OscDesk の定義 JSON から読んだパラメータ 1 件(アドレスと、行の型の提案に使う属性)。</summary>
    public readonly struct OscDefinitionParameter
    {
        public string Address { get; }
        public string Type { get; }
        public string Kind { get; }

        public OscDefinitionParameter(string address, string type, string kind)
        {
            Address = address ?? string.Empty;
            Type = type ?? string.Empty;
            Kind = kind ?? string.Empty;
        }

        /// <summary>定義の type / kind から対応表の行の型を提案する。trigger は引数を使わない Trigger にする。</summary>
        public OscBindingKind SuggestKind()
        {
            if (Kind == "trigger")
            {
                return OscBindingKind.Trigger;
            }

            switch (Type)
            {
                case "i": return OscBindingKind.Int;
                case "f": return OscBindingKind.Float;
                case "bool": return OscBindingKind.Bool;
                default: return OscBindingKind.String;
            }
        }
    }

    /// <summary>対応表の検査。定義を読み込んでいなければ definitionAddresses に null を渡す(A1 / A5 を出さない)。</summary>
    public static class OscBindingAudit
    {
        public static List<OscBindingWarning> Audit(ISet<string> definitionAddresses, IReadOnlyList<OscBindingRow> rows)
        {
            var warnings = new List<OscBindingWarning>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var covered = new HashSet<string>(StringComparer.Ordinal);

            foreach (var row in rows)
            {
                if (!IsValidAddress(row.Address))
                {
                    warnings.Add(new OscBindingWarning("A2", row.Address,
                        "アドレスが不正です(空、/ で始まらない、空白やワイルドカードを含む、または /sys・/oscdesk 配下): \"" + row.Address + "\""));
                    continue;
                }

                covered.Add(row.Address);

                if (!seen.Add(row.Address + "|" + row.Kind))
                {
                    warnings.Add(new OscBindingWarning("A3", row.Address,
                        "同じアドレスと型の行が重複しています: " + OscDispatcher.Describe(row)));
                }

                if (row.ListenerCount == 0)
                {
                    warnings.Add(new OscBindingWarning("A4", row.Address,
                        "イベントに関数が登録されていません: " + OscDispatcher.Describe(row)));
                }

                if (definitionAddresses != null && !definitionAddresses.Contains(row.Address))
                {
                    warnings.Add(new OscBindingWarning("A1", row.Address,
                        "読み込んだ定義にないアドレスです: " + row.Address));
                }
            }

            if (definitionAddresses != null)
            {
                foreach (var address in definitionAddresses)
                {
                    if (!covered.Contains(address))
                    {
                        warnings.Add(new OscBindingWarning("A5", address, "定義にあるアドレスに対応する行がありません: " + address));
                    }
                }
            }

            return warnings;
        }

        public static bool IsValidAddress(string address)
        {
            if (string.IsNullOrEmpty(address) || address[0] != '/' || address.Length == 1)
            {
                return false;
            }

            foreach (var c in address)
            {
                if (char.IsWhiteSpace(c) || c == '*' || c == '?' || c == '[' || c == ']' || c == '{' || c == '}' || c == ',')
                {
                    return false;
                }
            }

            if (address.EndsWith("/", StringComparison.Ordinal) || address.Contains("//"))
            {
                return false;
            }

            return !IsUnder(address, "/sys") && !IsUnder(address, "/oscdesk");
        }

        private static bool IsUnder(string address, string prefix)
        {
            return address == prefix || address.StartsWith(prefix + "/", StringComparison.Ordinal);
        }
    }
}
