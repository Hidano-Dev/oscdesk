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

                foreach (var item in items)
                {
                    if (!(item is Dictionary<string, object> map) || !(map.TryGetValue("address", out var address) && address is string addressText))
                    {
                        error = "address を持たないパラメータがあります。";
                        parameters.Clear();
                        return false;
                    }

                    map.TryGetValue("type", out var type);
                    map.TryGetValue("kind", out var kind);
                    parameters.Add(new OscDefinitionParameter(addressText, type as string, kind as string, RequestOf(map, "optionsFrom")));
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
                        if (!TryReadRecord(item, out var record, out error))
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

        private static bool TryReadRecord(object item, out OscDefinitionRecord record, out string error)
        {
            record = null;
            if (!(item is Dictionary<string, object> map) || !(map.TryGetValue("address", out var address) && address is string addressText))
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
                keysFromMap.TryGetValue("address", out var keysAddressValue);
                keysAddress = keysAddressValue as string;
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
                    fields.Add(new OscDefinitionRecordField(fieldIdText, fieldType as string, RequestOf(fieldMap, "optionsFrom")));
                }
            }

            record = new OscDefinitionRecord(id as string, addressText, kind as string, keysAddress, RequestOf(map, "keysFrom"), fields, keysSource);
            error = null;
            return true;
        }

        // optionsFrom / keysFrom の request(無ければ null)
        private static string RequestOf(Dictionary<string, object> map, string name)
        {
            if (map.TryGetValue(name, out var value) && value is Dictionary<string, object> inner && inner.TryGetValue("request", out var request))
            {
                return request as string;
            }

            return null;
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
