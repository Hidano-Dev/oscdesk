using System;
using System.Collections.Generic;
using System.Globalization;

namespace OscDesk.Receiver
{
    /// <summary>
    /// <see cref="OscRecord"/> から利用側の値を組み立てるときの読み取りの補助(D-099)。フィールドを 1 つずつ読み、
    /// 読めなかったフィールドの理由を溜めて最後にまとめて返す(1 つ目で止めると、壊れた行の直すべき箇所が 1 回に 1 つしか分からないため)。
    /// <para>
    /// フィールドの位置は、行に Record Fields(フィールド id)が設定されていれば id で、無ければ契約の順の位置で決める。
    /// 設定があるのに id が見つからないときは位置に戻らず欠けとして扱う(定義と違う並びの行を位置で読むと、別のフィールドの値を
    /// 黙って使ってしまうため)。
    /// </para>
    /// 理由の文言は英語で、<c>label + fieldId + ": " + 理由</c> の形(利用側のログに混ぜて読むため)。
    /// </summary>
    /// <example>
    /// <code>
    /// var reader = new OscRecordReader(record, "row \"" + record.Key + "\" ");
    /// reader.TryBool("active", 0, out var active);
    /// reader.TryString("address", 1, out var address);
    /// if (reader.HasProblems) { Debug.LogWarning(reader.Problem); return; }
    /// </code>
    /// </example>
    public sealed class OscRecordReader
    {
        private readonly List<string> problems = new List<string>();
        private readonly string label;

        /// <param name="label">理由の前に付ける表記(例: <c>"row \"A\" "</c>)。null は空。</param>
        public OscRecordReader(OscRecord record, string label = null)
        {
            Record = record ?? throw new ArgumentNullException(nameof(record));
            this.label = label ?? string.Empty;
        }

        public OscRecord Record { get; }

        public IReadOnlyList<string> Problems => problems.AsReadOnly();

        public bool HasProblems => problems.Count != 0;

        /// <summary>溜めた理由を "; " でつないだもの。理由が無ければ null。</summary>
        public string Problem => problems.Count == 0 ? null : string.Join("; ", problems);

        /// <summary>
        /// フィールドの位置。行に Record Fields が無ければ <paramref name="position"/>、あれば <paramref name="fieldId"/> の位置
        /// (見つからなければ -1)。
        /// </summary>
        public static int IndexOf(OscRecord record, string fieldId, int position)
        {
            if (record == null) throw new ArgumentNullException(nameof(record));
            return record.FieldIds.Count == 0 ? position : record.IndexOf(fieldId);
        }

        public bool TryBool(string fieldId, int position, out bool value)
        {
            var index = IndexOf(Record, fieldId, position);
            return Check(Record.TryGetBool(index, out value), fieldId, index, "bool");
        }

        public bool TryInt(string fieldId, int position, out int value)
        {
            var index = IndexOf(Record, fieldId, position);
            return Check(Record.TryGetInt(index, out value), fieldId, index, "int");
        }

        public bool TryFloat(string fieldId, int position, out float value)
        {
            var index = IndexOf(Record, fieldId, position);
            return Check(Record.TryGetFloat(index, out value), fieldId, index, "float");
        }

        public bool TryString(string fieldId, int position, out string value)
        {
            var index = IndexOf(Record, fieldId, position);
            return Check(Record.TryGetString(index, out value), fieldId, index, "string");
        }

        /// <summary>フィールド以外の理由(空の Name・値域の外など)を同じ形で溜める。</summary>
        public void AddProblem(string problem)
        {
            if (!string.IsNullOrEmpty(problem)) problems.Add(label + problem);
        }

        // 読んだのと同じ位置を説明する(位置を引き直すと、読んだ位置と説明する位置が食い違い得る)
        private bool Check(bool ok, string fieldId, int index, string type)
        {
            if (!ok) problems.Add(label + fieldId + ": " + Explain(index, type));
            return ok;
        }

        private string Explain(int index, string type)
        {
            if (index < 0 || index >= Record.Count) return "field is missing";
            var value = Record.GetValue(index);
            // int は整数値の float も受けるので、型名だけ出すと小数部が理由だと分からない
            if (type == "int" && value is float f)
            {
                var text = f.ToString("R", CultureInfo.InvariantCulture);
                if (float.IsNaN(f) || float.IsInfinity(f)) return "expected int but got a non-finite float (" + text + ")";
                if (f != Math.Floor(f)) return "expected int but got a non-integral float (" + text + ")";
                return "expected int but got a float outside the int32 range (" + text + ")";
            }
            return "expected " + type + " but got " + (value == null ? "null" : value.GetType().Name);
        }
    }
}
