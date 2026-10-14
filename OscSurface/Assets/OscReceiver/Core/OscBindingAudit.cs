using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    public readonly struct OscBindingWarning
    {
        /// <summary>A1 定義に無いアドレス / A2 アドレスが不正 / A3 同じアドレスと型の重複 / A4 リスナー未設定 / A5 定義にあるのに行が無い / A6 レコードの行のフィールド id が定義と違う</summary>
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
        /// <summary>optionsFrom.request(Unity に一覧を求める通常アドレス)。無ければ空。</summary>
        public string OptionsFromRequest { get; }

        public OscDefinitionParameter(string address, string type, string kind, string optionsFromRequest = null)
        {
            Address = address ?? string.Empty;
            Type = type ?? string.Empty;
            Kind = kind ?? string.Empty;
            OptionsFromRequest = optionsFromRequest ?? string.Empty;
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

    /// <summary>OscDesk の定義 JSON から読んだレコードのフィールド 1 件。</summary>
    public readonly struct OscDefinitionRecordField
    {
        public string Id { get; }
        public string Type { get; }
        /// <summary>optionsFrom.request。無ければ空。</summary>
        public string OptionsFromRequest { get; }

        public OscDefinitionRecordField(string id, string type, string optionsFromRequest = null)
        {
            Id = id ?? string.Empty;
            Type = type ?? string.Empty;
            OptionsFromRequest = optionsFromRequest ?? string.Empty;
        }
    }

    /// <summary>OscDesk の定義 JSON の records から読んだレコード 1 件(D-059 / D-063)。</summary>
    public sealed class OscDefinitionRecord
    {
        public string Id { get; }
        public string Address { get; }
        /// <summary>state / trigger。どちらも受け口では Record の行で受ける。</summary>
        public string Kind { get; }
        /// <summary>keysFrom.address(Unity がキーの一覧を送る先)。無ければ空。</summary>
        public string KeysFromAddress { get; }
        /// <summary>keysFrom.request(Unity にキーの一覧を求める通常アドレス)。無ければ空。</summary>
        public string KeysFromRequest { get; }
        public IReadOnlyList<OscDefinitionRecordField> Fields { get; }

        public OscDefinitionRecord(string id, string address, string kind, string keysFromAddress, string keysFromRequest,
            IReadOnlyList<OscDefinitionRecordField> fields)
        {
            Id = id ?? string.Empty;
            Address = address ?? string.Empty;
            Kind = kind ?? string.Empty;
            KeysFromAddress = keysFromAddress ?? string.Empty;
            KeysFromRequest = keysFromRequest ?? string.Empty;
            Fields = fields ?? Array.Empty<OscDefinitionRecordField>();
        }

        /// <summary>フィールド id を宣言順に。対応表の Record の行の Record Fields に入れる値。</summary>
        public List<string> FieldIds()
        {
            var ids = new List<string>(Fields.Count);
            foreach (var field in Fields)
            {
                ids.Add(field.Id);
            }

            return ids;
        }
    }

    /// <summary>定義から求めた対応表の行 1 件(アドレス・型の提案・Record ならフィールド id)。</summary>
    public readonly struct OscExpectedBinding
    {
        private static readonly string[] NoIds = new string[0];
        private readonly IReadOnlyList<string> fieldIds;

        public string Address { get; }
        public OscBindingKind Kind { get; }
        public IReadOnlyList<string> FieldIds => fieldIds ?? NoIds;

        public OscExpectedBinding(string address, OscBindingKind kind, IReadOnlyList<string> fieldIds = null)
        {
            Address = address ?? string.Empty;
            Kind = kind;
            this.fieldIds = fieldIds;
        }
    }

    /// <summary>対応表の検査。定義を読み込んでいなければ definitionAddresses に null を渡す(A1 / A5 を出さない)。</summary>
    public static class OscBindingAudit
    {
        /// <summary>
        /// 定義から求めた行(OscDefinitionRows.ExpectedBindings)で検査する。Audit の A1〜A5 に加え、
        /// 定義のレコードのアドレスにある Record の行のフィールド id が定義と食い違えば A6 を出す
        /// (食い違ったままだと、数が違う受信はイベントを呼ばず、id での取り出しも外れるため)。
        /// expected が null なら定義を読み込んでいない扱い。
        /// </summary>
        public static List<OscBindingWarning> AuditWithDefinition(IReadOnlyList<OscExpectedBinding> expected, IReadOnlyList<OscBindingRow> rows)
        {
            if (expected == null)
            {
                return Audit(null, rows);
            }

            var addresses = new HashSet<string>(StringComparer.Ordinal);
            var recordFields = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
            foreach (var binding in expected)
            {
                addresses.Add(binding.Address);
                if (binding.Kind == OscBindingKind.Record && !recordFields.ContainsKey(binding.Address))
                {
                    recordFields.Add(binding.Address, binding.FieldIds);
                }
            }

            var warnings = Audit(addresses, rows);
            foreach (var row in rows)
            {
                if (row.Kind == OscBindingKind.Record
                    && recordFields.TryGetValue(row.Address, out var fields)
                    && !SameIds(fields, row.FieldIds))
                {
                    warnings.Add(new OscBindingWarning("A6", row.Address,
                        "レコードの行のフィールド id が定義と違います: " + row.Address
                        + "(行: " + Join(row.FieldIds) + " / 定義: " + Join(fields) + ")"));
                }
            }

            return warnings;
        }

        private static bool SameIds(IReadOnlyList<string> a, IReadOnlyList<string> b)
        {
            if (a.Count != b.Count)
            {
                return false;
            }

            for (var i = 0; i < a.Count; i++)
            {
                if (!string.Equals(a[i], b[i], StringComparison.Ordinal))
                {
                    return false;
                }
            }

            return true;
        }

        private static string Join(IReadOnlyList<string> ids)
        {
            return ids.Count == 0 ? "未設定" : string.Join(", ", ids);
        }

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
