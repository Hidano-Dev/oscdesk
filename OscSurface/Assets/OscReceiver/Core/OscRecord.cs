using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 受信引数 1 個を各型へ変換する規則。対応表の単一値の行(Int / Float / String / Bool)と、
    /// レコードのフィールドの取り出しで同じ規則を使う(行の種類で受け方が変わると利用者が混乱するため)。
    /// </summary>
    public static class OscValueConvert
    {
        /// <summary>int と、整数値の float(例: 3.0)を受ける。小数部があれば丸めず失敗にする。</summary>
        public static bool TryInt(object value, out int result)
        {
            if (value is int i)
            {
                result = i;
                return true;
            }

            if (value is float f && f == (float)Math.Floor(f) && f >= int.MinValue && f <= int.MaxValue)
            {
                result = (int)f;
                return true;
            }

            result = 0;
            return false;
        }

        /// <summary>float と int を受ける。</summary>
        public static bool TryFloat(object value, out float result)
        {
            if (value is float f)
            {
                result = f;
                return true;
            }

            if (value is int i)
            {
                result = i;
                return true;
            }

            result = 0f;
            return false;
        }

        /// <summary>string だけを受ける(数値を文字列にはしない)。</summary>
        public static bool TryString(object value, out string result)
        {
            result = value as string;
            return result != null;
        }

        /// <summary>OscDesk は真偽値を i の 0/1 で送る(UNITY_PROTOCOL §2「型」)。bool 型タグ・float(0 以外が true)も受ける。</summary>
        public static bool TryBool(object value, out bool result)
        {
            switch (value)
            {
                case bool b:
                    result = b;
                    return true;
                case int i:
                    result = i != 0;
                    return true;
                case float f:
                    result = f != 0f;
                    return true;
                default:
                    result = false;
                    return false;
            }
        }
    }

    /// <summary>
    /// レコードの 1 行(D-059 / D-063)。ワイヤでは `address` + [s:キー, フィールドを定義の宣言順に]。
    /// 受信のたびに新しいインスタンスを作るので、受け取った関数が保持し続けてもよい(後の受信で書き換わらない)。
    /// フィールドは番号(0 始まり、キーを除いた位置)か、対応表の行に設定したフィールド id で取り出す。
    /// Get 系は値が無い・型が合わないときに例外を投げ、TryGet 系は false を返す。
    /// </summary>
    [Serializable]
    public sealed class OscRecord
    {
        private static readonly string[] NoIds = new string[0];

        private readonly object[] fields;
        private readonly string[] fieldIds;

        public OscRecord(string key, IReadOnlyList<object> fields, IReadOnlyList<string> fieldIds = null)
        {
            Key = key ?? string.Empty;
            this.fields = new object[fields?.Count ?? 0];
            for (var i = 0; i < this.fields.Length; i++)
            {
                this.fields[i] = fields[i];
            }

            if (fieldIds == null || fieldIds.Count == 0)
            {
                this.fieldIds = NoIds;
            }
            else
            {
                this.fieldIds = new string[fieldIds.Count];
                for (var i = 0; i < this.fieldIds.Length; i++)
                {
                    this.fieldIds[i] = fieldIds[i] ?? string.Empty;
                }
            }
        }

        /// <summary>行のキー(先頭の s 引数)。</summary>
        public string Key { get; }

        /// <summary>フィールドの数(キーを除いた引数の数)。</summary>
        public int Count => fields.Length;

        /// <summary>対応表の行に設定したフィールド id(宣言順)。行に設定が無ければ空。</summary>
        public IReadOnlyList<string> FieldIds => fieldIds;

        /// <summary>
        /// 受信引数からレコードを作る。先頭が s でない・引数が無い、または fieldIds を設定しているのに
        /// フィールドの数が合わないときは作らず、理由を返す(呼び出し側はイベントを呼ばない)。
        /// </summary>
        public static bool TryCreate(IReadOnlyList<object> args, IReadOnlyList<string> fieldIds, out OscRecord record, out string reason)
        {
            record = null;
            if (args == null || args.Count == 0)
            {
                reason = "引数がありません(先頭にキーの s が必要です)";
                return false;
            }

            if (!(args[0] is string key))
            {
                reason = "先頭の引数がキーの s ではありません(" + DescribeType(args[0]) + ")";
                return false;
            }

            var count = args.Count - 1;
            if (fieldIds != null && fieldIds.Count > 0 && count != fieldIds.Count)
            {
                reason = "フィールドの数が行の設定と違います(受信 " + count + " 個、設定 " + fieldIds.Count + " 個)";
                return false;
            }

            var values = new object[count];
            for (var i = 0; i < count; i++)
            {
                values[i] = args[i + 1];
            }

            record = new OscRecord(key, values, fieldIds);
            reason = null;
            return true;
        }

        /// <summary>フィールド id の位置。見つからなければ -1。</summary>
        public int IndexOf(string fieldId)
        {
            return Array.IndexOf(fieldIds, fieldId);
        }

        /// <summary>そのフィールドの受信値をそのまま返す(int / float / string、ライブラリによっては bool や byte[])。</summary>
        public object GetValue(int index)
        {
            CheckIndex(index);
            return fields[index];
        }

        public object GetValue(string fieldId)
        {
            return GetValue(ResolveIndex(fieldId));
        }

        public bool TryGetInt(int index, out int value)
        {
            value = 0;
            return index >= 0 && index < fields.Length && OscValueConvert.TryInt(fields[index], out value);
        }

        public bool TryGetInt(string fieldId, out int value)
        {
            return TryGetInt(IndexOf(fieldId), out value);
        }

        public bool TryGetFloat(int index, out float value)
        {
            value = 0f;
            return index >= 0 && index < fields.Length && OscValueConvert.TryFloat(fields[index], out value);
        }

        public bool TryGetFloat(string fieldId, out float value)
        {
            return TryGetFloat(IndexOf(fieldId), out value);
        }

        public bool TryGetString(int index, out string value)
        {
            value = null;
            return index >= 0 && index < fields.Length && OscValueConvert.TryString(fields[index], out value);
        }

        public bool TryGetString(string fieldId, out string value)
        {
            return TryGetString(IndexOf(fieldId), out value);
        }

        public bool TryGetBool(int index, out bool value)
        {
            value = false;
            return index >= 0 && index < fields.Length && OscValueConvert.TryBool(fields[index], out value);
        }

        public bool TryGetBool(string fieldId, out bool value)
        {
            return TryGetBool(IndexOf(fieldId), out value);
        }

        public int GetInt(int index)
        {
            CheckIndex(index);
            return OscValueConvert.TryInt(fields[index], out var value) ? value : throw TypeMismatch(index, "int");
        }

        public int GetInt(string fieldId)
        {
            return GetInt(ResolveIndex(fieldId));
        }

        public float GetFloat(int index)
        {
            CheckIndex(index);
            return OscValueConvert.TryFloat(fields[index], out var value) ? value : throw TypeMismatch(index, "float");
        }

        public float GetFloat(string fieldId)
        {
            return GetFloat(ResolveIndex(fieldId));
        }

        public string GetString(int index)
        {
            CheckIndex(index);
            return OscValueConvert.TryString(fields[index], out var value) ? value : throw TypeMismatch(index, "string");
        }

        public string GetString(string fieldId)
        {
            return GetString(ResolveIndex(fieldId));
        }

        public bool GetBool(int index)
        {
            CheckIndex(index);
            return OscValueConvert.TryBool(fields[index], out var value) ? value : throw TypeMismatch(index, "bool");
        }

        public bool GetBool(string fieldId)
        {
            return GetBool(ResolveIndex(fieldId));
        }

        public override string ToString()
        {
            var builder = new StringBuilder();
            builder.Append('"').Append(Key).Append('"');
            for (var i = 0; i < fields.Length; i++)
            {
                builder.Append(", ");
                if (i < fieldIds.Length)
                {
                    builder.Append(fieldIds[i]).Append('=');
                }

                builder.Append(Convert.ToString(fields[i], CultureInfo.InvariantCulture));
            }

            return builder.ToString();
        }

        private int ResolveIndex(string fieldId)
        {
            var index = IndexOf(fieldId);
            if (index < 0)
            {
                throw new KeyNotFoundException(
                    "レコードにフィールド id \"" + fieldId + "\" がありません(対応表の行の Record Fields: "
                    + (fieldIds.Length == 0 ? "未設定" : string.Join(", ", fieldIds)) + ")。");
            }

            return index;
        }

        private void CheckIndex(int index)
        {
            if (index < 0 || index >= fields.Length)
            {
                throw new ArgumentOutOfRangeException(nameof(index), index,
                    "レコード \"" + Key + "\" のフィールドは " + fields.Length + " 個です。");
            }
        }

        private InvalidCastException TypeMismatch(int index, string type)
        {
            var name = index < fieldIds.Length ? fieldIds[index] : "#" + index;
            return new InvalidCastException(
                "レコード \"" + Key + "\" のフィールド " + name + " を " + type + " として読めません(" + DescribeType(fields[index]) + ")。");
        }

        private static string DescribeType(object value)
        {
            return value == null ? "null" : value.GetType().Name;
        }
    }
}
