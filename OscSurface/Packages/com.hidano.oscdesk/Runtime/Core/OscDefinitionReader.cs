using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace OscDesk.Receiver
{
    /// <summary>
    /// OscDesk の定義 JSON(format: oscdesk-surface)から parameters と records を読む。
    /// 中核は UnityEngine を参照できず JsonUtility が使えないため、必要な範囲だけの最小の JSON 読み取りを持つ。
    /// 定義の厳密な検証はブリッジが行う。ここは「アドレスの一覧を取る」ことだけが目的で、読めなければ理由を返す。
    /// 版 1(項目に address を直接書く)と版 2(本体と bindings.osc を分けた形。D-117。ブリッジが今保存・配布する形)の両方を読む。
    /// </summary>
    public static class OscDefinitionReader
    {
        public static bool TryRead(string json, out List<OscDefinitionParameter> parameters, out string error)
        {
            return TryRead(json, out parameters, out _, out error);
        }

        /// <summary>parameters に加えて、省略可能な records(D-059 のレコード)も読む。records が無い定義では空のリスト。</summary>
        public static bool TryRead(string json, out List<OscDefinitionParameter> parameters, out List<OscDefinitionRecord> records, out string error)
        {
            parameters = new List<OscDefinitionParameter>();
            records = new List<OscDefinitionRecord>();
            error = null;
            try
            {
                var reader = new JsonCursor(json ?? string.Empty);
                var root = reader.ReadValue() as Dictionary<string, object>;
                reader.ExpectEnd();
                if (root == null)
                {
                    error = "定義 JSON のルートがオブジェクトではありません。";
                    return false;
                }

                if (!root.TryGetValue("format", out var format) || !(format is string formatName) || formatName != "oscdesk-surface")
                {
                    error = "format が oscdesk-surface ではありません。OscDesk の定義 JSON ではないようです。";
                    return false;
                }

                if (!root.TryGetValue("parameters", out var list) || !(list is List<object> items))
                {
                    error = "parameters 配列がありません。";
                    return false;
                }

                // 版 2(D-117)はパラメータ・レコードに address を書かず、bindings.osc に id → アドレスの表を持つ。
                // 版 1 はパラメータ・レコードに address を直接書く。どちらの定義 JSON も取り込めるようにする
                var bindings = OscBindingsOf(root);

                foreach (var item in items)
                {
                    if (!(item is Dictionary<string, object> map) || !TryAddressOf(map, bindings?.Parameters, out var addressText))
                    {
                        error = "address を持たないパラメータがあります。";
                        parameters.Clear();
                        return false;
                    }

                    map.TryGetValue("type", out var type);
                    map.TryGetValue("kind", out var kind);
                    parameters.Add(new OscDefinitionParameter(addressText, type as string, kind as string, RequestOf(map, "optionsFrom", bindings)));
                }

                if (root.TryGetValue("records", out var recordList) && recordList != null)
                {
                    if (!(recordList is List<object> recordItems))
                    {
                        error = "records が配列ではありません。";
                        parameters.Clear();
                        return false;
                    }

                    foreach (var item in recordItems)
                    {
                        if (!TryReadRecord(item, bindings, out var record, out error))
                        {
                            parameters.Clear();
                            records.Clear();
                            return false;
                        }

                        records.Add(record);
                    }
                }

                return true;
            }
            catch (FormatException exception)
            {
                parameters.Clear();
                records.Clear();
                error = "JSON として読めません: " + exception.Message;
                return false;
            }
        }

        private static bool TryReadRecord(object item, DefinitionBindings bindings, out OscDefinitionRecord record, out string error)
        {
            record = null;
            if (!(item is Dictionary<string, object> map) || !TryAddressOf(map, bindings?.Records, out var addressText))
            {
                error = "address を持たないレコードがあります。";
                return false;
            }

            map.TryGetValue("id", out var id);
            map.TryGetValue("kind", out var kind);
            string keysAddress = null;
            string keysSource = null;
            if (map.TryGetValue("keysFrom", out var keysFrom) && keysFrom is Dictionary<string, object> keysFromMap)
            {
                keysAddress = ListOf(keysFromMap, bindings)?.Address;
                keysFromMap.TryGetValue("source", out var keysSourceValue);
                keysSource = keysSourceValue as string;
            }

            var fields = new List<OscDefinitionRecordField>();
            if (map.TryGetValue("fields", out var fieldList) && fieldList != null)
            {
                if (!(fieldList is List<object> fieldItems))
                {
                    error = "fields が配列ではないレコードがあります: " + addressText;
                    return false;
                }

                foreach (var fieldItem in fieldItems)
                {
                    if (!(fieldItem is Dictionary<string, object> fieldMap) || !(fieldMap.TryGetValue("id", out var fieldId) && fieldId is string fieldIdText))
                    {
                        error = "id を持たないフィールドがあります(レコード " + addressText + ")。";
                        return false;
                    }

                    fieldMap.TryGetValue("type", out var fieldType);
                    fields.Add(new OscDefinitionRecordField(fieldIdText, fieldType as string, RequestOf(fieldMap, "optionsFrom", bindings)));
                }
            }

            record = new OscDefinitionRecord(id as string, addressText, kind as string, keysAddress, RequestOf(map, "keysFrom", bindings), fields, keysSource);
            error = null;
            return true;
        }

        // optionsFrom / keysFrom の request(無ければ null)
        private static string RequestOf(Dictionary<string, object> map, string name, DefinitionBindings bindings)
        {
            return map.TryGetValue(name, out var value) && value is Dictionary<string, object> inner ? ListOf(inner, bindings)?.Request : null;
        }

        /// <summary>
        /// optionsFrom / keysFrom が指す一覧の受け口。版 1 は address と request を直接書き、版 2 は一覧の id(list)を書いて
        /// bindings.osc.lists に受け口を持つ。どちらでもなければ null
        /// </summary>
        private static ListBinding ListOf(Dictionary<string, object> source, DefinitionBindings bindings)
        {
            if (source.TryGetValue("list", out var list) && list is string listId)
            {
                return bindings != null && bindings.Lists.TryGetValue(listId, out var binding) ? binding : null;
            }

            source.TryGetValue("address", out var address);
            source.TryGetValue("request", out var request);
            return address is string addressText ? new ListBinding(addressText, request as string) : null;
        }

        // 版 1 は項目の address、版 2 は bindings.osc の id → アドレスの表から引く
        private static bool TryAddressOf(Dictionary<string, object> map, Dictionary<string, string> table, out string address)
        {
            address = null;
            if (map.TryGetValue("address", out var direct))
            {
                address = direct as string;
                return address != null;
            }

            return table != null && map.TryGetValue("id", out var id) && id is string idText && table.TryGetValue(idText, out address);
        }

        // bindings.osc を読む。無ければ null(版 1 の定義、または結び付けを含まない本体だけの定義)
        private static DefinitionBindings OscBindingsOf(Dictionary<string, object> root)
        {
            if (!root.TryGetValue("bindings", out var bindings) || !(bindings is Dictionary<string, object> bindingsMap)
                || !bindingsMap.TryGetValue("osc", out var osc) || !(osc is Dictionary<string, object> oscMap))
            {
                return null;
            }

            var result = new DefinitionBindings();
            ReadAddressTable(oscMap, "parameters", result.Parameters);
            ReadAddressTable(oscMap, "records", result.Records);
            if (oscMap.TryGetValue("lists", out var lists) && lists is List<object> listItems)
            {
                foreach (var item in listItems)
                {
                    if (item is Dictionary<string, object> entry && entry.TryGetValue("id", out var id) && id is string idText
                        && entry.TryGetValue("address", out var address) && address is string addressText && !result.Lists.ContainsKey(idText))
                    {
                        entry.TryGetValue("request", out var request);
                        result.Lists[idText] = new ListBinding(addressText, request as string);
                    }
                }
            }

            return result;
        }

        private static void ReadAddressTable(Dictionary<string, object> osc, string name, Dictionary<string, string> table)
        {
            if (!osc.TryGetValue(name, out var value) || !(value is List<object> items))
            {
                return;
            }

            foreach (var item in items)
            {
                // 同じ id が重なるのは不正な定義(ブリッジが拒否する)。ここでは先勝ちにする
                if (item is Dictionary<string, object> entry && entry.TryGetValue("id", out var id) && id is string idText
                    && entry.TryGetValue("address", out var address) && address is string addressText && !table.ContainsKey(idText))
                {
                    table[idText] = addressText;
                }
            }
        }

        private sealed class DefinitionBindings
        {
            public readonly Dictionary<string, string> Parameters = new Dictionary<string, string>(StringComparer.Ordinal);
            public readonly Dictionary<string, string> Records = new Dictionary<string, string>(StringComparer.Ordinal);
            public readonly Dictionary<string, ListBinding> Lists = new Dictionary<string, ListBinding>(StringComparer.Ordinal);
        }

        private sealed class ListBinding
        {
            public readonly string Address;
            public readonly string Request;

            public ListBinding(string address, string request)
            {
                Address = address;
                Request = request;
            }
        }

        /// <summary>
        /// JSON を読む(形は JsonCursor と同じ)。テストが protocol/ の見本を読むためのもので、UnityEngine の JsonUtility は
        /// 型の混じった配列を読めないため、定義の読み取りと同じ読み手を使う。壊れた JSON は FormatException。
        /// </summary>
        internal static object ReadJson(string json)
        {
            var reader = new JsonCursor(json ?? string.Empty);
            var value = reader.ReadValue();
            reader.ExpectEnd();
            return value;
        }

        // オブジェクト → Dictionary、配列 → List、文字列 → string、数値 → double、true/false → bool、null → null
        private sealed class JsonCursor
        {
            private readonly string text;
            private int position;

            public JsonCursor(string text)
            {
                this.text = text;
            }

            public void ExpectEnd()
            {
                SkipWhitespace();
                if (position != text.Length)
                {
                    throw new FormatException("末尾に余分な文字があります(位置 " + position + ")。");
                }
            }

            public object ReadValue()
            {
                SkipWhitespace();
                if (position >= text.Length)
                {
                    throw new FormatException("入力が途中で終わっています。");
                }

                var c = text[position];
                switch (c)
                {
                    case '{': return ReadObject();
                    case '[': return ReadArray();
                    case '"': return ReadString();
                    case 't': ExpectWord("true"); return true;
                    case 'f': ExpectWord("false"); return false;
                    case 'n': ExpectWord("null"); return null;
                    default: return ReadNumber();
                }
            }

            private Dictionary<string, object> ReadObject()
            {
                var result = new Dictionary<string, object>(StringComparer.Ordinal);
                position++;
                SkipWhitespace();
                if (Peek() == '}')
                {
                    position++;
                    return result;
                }

                while (true)
                {
                    SkipWhitespace();
                    if (Peek() != '"')
                    {
                        throw new FormatException("キーは文字列である必要があります(位置 " + position + ")。");
                    }

                    var key = ReadString();
                    SkipWhitespace();
                    Expect(':');
                    result[key] = ReadValue();
                    SkipWhitespace();
                    var next = Next();
                    if (next == '}')
                    {
                        return result;
                    }

                    if (next != ',')
                    {
                        throw new FormatException("オブジェクトの区切りが不正です(位置 " + (position - 1) + ")。");
                    }
                }
            }

            private List<object> ReadArray()
            {
                var result = new List<object>();
                position++;
                SkipWhitespace();
                if (Peek() == ']')
                {
                    position++;
                    return result;
                }

                while (true)
                {
                    result.Add(ReadValue());
                    SkipWhitespace();
                    var next = Next();
                    if (next == ']')
                    {
                        return result;
                    }

                    if (next != ',')
                    {
                        throw new FormatException("配列の区切りが不正です(位置 " + (position - 1) + ")。");
                    }
                }
            }

            private string ReadString()
            {
                Expect('"');
                var builder = new StringBuilder();
                while (true)
                {
                    var c = Next();
                    if (c == '"')
                    {
                        return builder.ToString();
                    }

                    if (c != '\\')
                    {
                        builder.Append(c);
                        continue;
                    }

                    var escaped = Next();
                    switch (escaped)
                    {
                        case '"': builder.Append('"'); break;
                        case '\\': builder.Append('\\'); break;
                        case '/': builder.Append('/'); break;
                        case 'b': builder.Append('\b'); break;
                        case 'f': builder.Append('\f'); break;
                        case 'n': builder.Append('\n'); break;
                        case 'r': builder.Append('\r'); break;
                        case 't': builder.Append('\t'); break;
                        case 'u':
                            if (position + 4 > text.Length
                                || !int.TryParse(text.Substring(position, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var code))
                            {
                                throw new FormatException("\\u エスケープが不正です(位置 " + position + ")。");
                            }

                            builder.Append((char)code);
                            position += 4;
                            break;
                        default:
                            throw new FormatException("未知のエスケープです(位置 " + (position - 1) + ")。");
                    }
                }
            }

            private double ReadNumber()
            {
                var start = position;
                while (position < text.Length && "+-0123456789.eE".IndexOf(text[position]) >= 0)
                {
                    position++;
                }

                if (position == start
                    || !double.TryParse(text.Substring(start, position - start), NumberStyles.Float, CultureInfo.InvariantCulture, out var value))
                {
                    throw new FormatException("値が読めません(位置 " + start + ")。");
                }

                return value;
            }

            private void ExpectWord(string word)
            {
                // 途中で切れた入力(例: tru)で CompareOrdinal が範囲外を読まないよう、残りの長さを先に見る
                if (position + word.Length > text.Length
                    || string.CompareOrdinal(text, position, word, 0, word.Length) != 0)
                {
                    throw new FormatException("値が読めません(位置 " + position + ")。");
                }

                position += word.Length;
            }

            private void Expect(char c)
            {
                if (Next() != c)
                {
                    throw new FormatException("'" + c + "' が必要です(位置 " + (position - 1) + ")。");
                }
            }

            private char Peek()
            {
                return position < text.Length ? text[position] : '\0';
            }

            private char Next()
            {
                if (position >= text.Length)
                {
                    throw new FormatException("入力が途中で終わっています。");
                }

                return text[position++];
            }

            private void SkipWhitespace()
            {
                while (position < text.Length && char.IsWhiteSpace(text[position]))
                {
                    position++;
                }
            }
        }
    }
}
