using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace OscDesk.Receiver
{
    /// <summary>
    /// OscDesk の定義 JSON(format: oscdesk-surface)から parameters を読む。
    /// 中核は UnityEngine を参照できず JsonUtility が使えないため、必要な範囲だけの最小の JSON 読み取りを持つ。
    /// 定義の厳密な検証はブリッジが行う。ここは「アドレスの一覧を取る」ことだけが目的で、読めなければ理由を返す。
    /// </summary>
    public static class OscDefinitionReader
    {
        public static bool TryRead(string json, out List<OscDefinitionParameter> parameters, out string error)
        {
            parameters = new List<OscDefinitionParameter>();
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
                    parameters.Add(new OscDefinitionParameter(addressText, type as string, kind as string));
                }

                return true;
            }
            catch (FormatException exception)
            {
                parameters.Clear();
                error = "JSON として読めません: " + exception.Message;
                return false;
            }
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
