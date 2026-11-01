// OscValueType.cs — 拡張パッケージが定義する型(組み合わせの型。HID-380・DESIGN.md D-121)。UnityEngine に依存しない。
// 送受信の型は OSC 1.0 の標準の型だけで、独自の型タグは足さない。新しい型は「基本型(Int・Float・String・Bool)・Record・
// 配列の組み合わせ + 制約 + 表示ヒントの名前」で表し、その構造(スキーマ)を設計図(/sys/catalog/add の type composite、
// キー schema)でコントローラーへ送る。コントローラーは知っている表示ヒントなら専用の部品、知らなければスキーマから汎用の部品を組む。
// 型の仕組みは入れ子(Record の中の Record・配列)を表せるが、OSC の引数で受けられるのは基本型だけの Record(フラット)まで。
// 入れ子・可変長は将来 CBOR の Blob で送る方針(HID-397)。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace OscDesk.Receiver
{
    public enum OscValueTypeKind
    {
        Int,
        Float,
        String,
        Bool,
        Record,
        Array
    }

    /// <summary>
    /// 型 1 つ。基本型は <see cref="Int"/> などで作り、制約(範囲・刻み・選択肢・既定値)を足す。組み合わせの型は
    /// <see cref="Record(string, OscValueField[])"/> で名前とフィールドを決める。
    /// 例: <c>OscValueType.Record("color", OscValueField.Of("r", OscValueType.Float().WithRange(0, 1).WithDefault(1f)), …).WithHint("color")</c>
    /// </summary>
    public sealed class OscValueType
    {
        public const int MaxDepth = 8;
        public const int MaxFields = 64;
        public const int MaxNodes = 512;
        public const int MaxArrayItems = 1024;
        public const int MaxNameChars = 32;

        private static readonly OscValueField[] NoFields = new OscValueField[0];
        private static readonly string[] NoStrings = new string[0];

        private OscValueType(OscValueTypeKind kind)
        {
            Kind = kind;
        }

        public OscValueTypeKind Kind { get; }

        /// <summary>組み合わせの型の名前(最上位の Record・配列だけが持つ)。英字で始まる 32 文字まで。</summary>
        public string Name { get; private set; } = string.Empty;

        /// <summary>表示ヒントの名前(color など)。空なら指定なし。</summary>
        public string Hint { get; private set; } = string.Empty;

        public float? Min { get; private set; }
        public float? Max { get; private set; }
        public float? Step { get; private set; }
        public IReadOnlyList<string> Options { get; private set; } = NoStrings;

        /// <summary>既定値(int / float / string / bool)。無ければ null。</summary>
        public object Default { get; private set; }

        /// <summary>Record のフィールド(宣言順)。Record 以外では空。</summary>
        public IReadOnlyList<OscValueField> Fields { get; private set; } = NoFields;

        /// <summary>配列の要素の型。配列以外では null。</summary>
        public OscValueType Items { get; private set; }

        public int? MaxItemCount { get; private set; }

        public static OscValueType Int() => new OscValueType(OscValueTypeKind.Int);
        public static OscValueType Float() => new OscValueType(OscValueTypeKind.Float);
        public static OscValueType String() => new OscValueType(OscValueTypeKind.String);
        public static OscValueType Bool() => new OscValueType(OscValueTypeKind.Bool);

        /// <summary>名前付きの Record。name は組み合わせの型の名前(フィールドに入れ子で使うときも同じ規則)。</summary>
        public static OscValueType Record(string name, params OscValueField[] fields)
        {
            if (fields == null || fields.Length == 0) throw new ArgumentException("a record needs at least one field", nameof(fields));
            if (fields.Length > MaxFields) throw new ArgumentException("a record has at most " + MaxFields + " fields", nameof(fields));
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var field in fields)
            {
                if (field == null) throw new ArgumentNullException(nameof(fields));
                if (!seen.Add(field.Id)) throw new ArgumentException("duplicate field id: " + field.Id, nameof(fields));
            }

            var type = new OscValueType(OscValueTypeKind.Record) { Name = CheckName(name, nameof(name)), Fields = (OscValueField[])fields.Clone() };
            type.CheckSize();
            return type;
        }

        /// <summary>名前付きの配列(可変長)。スキーマとしては設計図に載せられるが、値を OSC で受けるのは HID-397 から。</summary>
        public static OscValueType Array(string name, OscValueType items, int? maxItems = null)
        {
            if (items == null) throw new ArgumentNullException(nameof(items));
            if (maxItems.HasValue && (maxItems.Value < 1 || maxItems.Value > MaxArrayItems))
            {
                throw new ArgumentOutOfRangeException(nameof(maxItems));
            }

            var type = new OscValueType(OscValueTypeKind.Array) { Name = CheckName(name, nameof(name)), Items = items, MaxItemCount = maxItems };
            type.CheckSize();
            return type;
        }

        public OscValueType WithHint(string hint)
        {
            Hint = string.IsNullOrEmpty(hint) ? string.Empty : CheckName(hint, nameof(hint));
            return this;
        }

        public OscValueType WithRange(float min, float max)
        {
            RequireNumber();
            if (!IsFinite(min) || !IsFinite(max) || min >= max) throw new ArgumentException("range needs finite min < max");
            Min = min;
            Max = max;
            return this;
        }

        public OscValueType WithStep(float step)
        {
            RequireNumber();
            if (!IsFinite(step) || step <= 0f) throw new ArgumentOutOfRangeException(nameof(step));
            Step = step;
            return this;
        }

        public OscValueType WithOptions(params string[] options)
        {
            if (Kind != OscValueTypeKind.String) throw new InvalidOperationException("options are for String");
            if (options == null || options.Length == 0) throw new ArgumentException("options need at least one item", nameof(options));
            Options = (string[])options.Clone();
            return this;
        }

        /// <summary>既定値。state の操作のフィールドで、コントローラーが最初に表示し送る値になる(無ければコントローラーが補う)。</summary>
        public OscValueType WithDefault(object value)
        {
            switch (Kind)
            {
                case OscValueTypeKind.Int when value is int:
                case OscValueTypeKind.String when value is string:
                case OscValueTypeKind.Bool when value is bool:
                    break;
                case OscValueTypeKind.Float when value is float f && IsFinite(f):
                    break;
                case OscValueTypeKind.Float when value is int i:
                    value = (float)i;
                    break;
                default:
                    throw new ArgumentException("default does not fit " + Kind, nameof(value));
            }

            Default = value;
            return this;
        }

        /// <summary>基本型だけを並べた Record か(OSC の引数の並びで受けられる形)。</summary>
        public bool IsFlatRecord
        {
            get
            {
                if (Kind != OscValueTypeKind.Record) return false;
                foreach (var field in Fields)
                {
                    if (field.Type.Kind == OscValueTypeKind.Record || field.Type.Kind == OscValueTypeKind.Array) return false;
                }

                return true;
            }
        }

        /// <summary>
        /// 設計図のキー schema に載せる JSON(packages/shared/src/value-type.ts の CompositeType と同じ形)。
        /// 最上位は name を持つ Record か配列。
        /// </summary>
        public string ToSchemaJson()
        {
            if (Kind != OscValueTypeKind.Record && Kind != OscValueTypeKind.Array)
            {
                throw new InvalidOperationException("only a named record or array has a schema");
            }

            var json = new StringBuilder();
            Write(json, null, true);
            return json.ToString();
        }

        private void Write(StringBuilder json, OscValueField field, bool top)
        {
            json.Append('{');
            var first = true;
            void Key(string key)
            {
                if (!first) json.Append(',');
                first = false;
                AppendString(json, key);
                json.Append(':');
            }

            if (top)
            {
                Key("name");
                AppendString(json, Name);
            }

            if (field != null)
            {
                Key("id");
                AppendString(json, field.Id);
                if (!string.IsNullOrEmpty(field.Label))
                {
                    Key("label");
                    AppendString(json, field.Label);
                }
            }

            Key("type");
            AppendString(json, KindName(Kind));
            if (Hint.Length > 0)
            {
                Key("hint");
                AppendString(json, Hint);
            }

            switch (Kind)
            {
                case OscValueTypeKind.Int:
                case OscValueTypeKind.Float:
                    if (Min.HasValue && Max.HasValue)
                    {
                        Key("range");
                        json.Append('[').Append(Number(Min.Value, Kind)).Append(',').Append(Number(Max.Value, Kind)).Append(']');
                    }

                    if (Step.HasValue)
                    {
                        Key("step");
                        json.Append(Number(Step.Value, Kind == OscValueTypeKind.Int && Step.Value == Math.Floor(Step.Value) ? Kind : OscValueTypeKind.Float));
                    }

                    if (Default != null)
                    {
                        Key("default");
                        json.Append(Default is int i ? i.ToString(CultureInfo.InvariantCulture) : Number((float)Default, OscValueTypeKind.Float));
                    }

                    break;
                case OscValueTypeKind.String:
                    if (Options.Count > 0)
                    {
                        Key("options");
                        json.Append('[');
                        for (var n = 0; n < Options.Count; n++)
                        {
                            if (n > 0) json.Append(',');
                            AppendString(json, Options[n] ?? string.Empty);
                        }

                        json.Append(']');
                    }

                    if (Default is string text)
                    {
                        Key("default");
                        AppendString(json, text);
                    }

                    break;
                case OscValueTypeKind.Bool:
                    if (Default is bool flag)
                    {
                        Key("default");
                        json.Append(flag ? "true" : "false");
                    }

                    break;
                case OscValueTypeKind.Record:
                    Key("fields");
                    json.Append('[');
                    for (var n = 0; n < Fields.Count; n++)
                    {
                        if (n > 0) json.Append(',');
                        Fields[n].Type.Write(json, Fields[n], false);
                    }

                    json.Append(']');
                    break;
                case OscValueTypeKind.Array:
                    Key("items");
                    Items.Write(json, null, false);
                    if (MaxItemCount.HasValue)
                    {
                        Key("maxItems");
                        json.Append(MaxItemCount.Value.ToString(CultureInfo.InvariantCulture));
                    }

                    break;
            }

            json.Append('}');
        }

        private static string Number(float value, OscValueTypeKind kind)
        {
            if (kind == OscValueTypeKind.Int && value == Math.Floor(value) && value >= int.MinValue && value <= int.MaxValue)
            {
                return ((long)value).ToString(CultureInfo.InvariantCulture);
            }

            // float を往復できる最短の表記(R)。受け側は JSON の数として読む
            return value.ToString("R", CultureInfo.InvariantCulture);
        }

        internal static string KindName(OscValueTypeKind kind)
        {
            switch (kind)
            {
                case OscValueTypeKind.Int: return "i";
                case OscValueTypeKind.Float: return "f";
                case OscValueTypeKind.String: return "s";
                case OscValueTypeKind.Bool: return "bool";
                case OscValueTypeKind.Record: return "record";
                default: return "array";
            }
        }

        internal static void AppendString(StringBuilder json, string text)
        {
            json.Append('"');
            foreach (var c in text)
            {
                switch (c)
                {
                    case '"': json.Append("\\\""); break;
                    case '\\': json.Append("\\\\"); break;
                    case '\n': json.Append("\\n"); break;
                    case '\r': json.Append("\\r"); break;
                    case '\t': json.Append("\\t"); break;
                    default:
                        if (c < 0x20) json.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else json.Append(c);
                        break;
                }
            }

            json.Append('"');
        }

        // 名前とヒントの規則(packages/shared の VALUE_HINT_PATTERN): 英字で始まり、英数字と _ . - の 32 文字まで
        internal static string CheckName(string name, string parameter)
        {
            if (string.IsNullOrEmpty(name) || name.Length > MaxNameChars || !IsAsciiLetter(name[0]))
            {
                throw new ArgumentException("name must start with a letter and be up to " + MaxNameChars + " characters: " + name, parameter);
            }

            foreach (var c in name)
            {
                if (!IsAsciiLetter(c) && !(c >= '0' && c <= '9') && c != '_' && c != '.' && c != '-')
                {
                    throw new ArgumentException("name may only contain letters, digits, '_', '.' and '-': " + name, parameter);
                }
            }

            return name;
        }

        private static bool IsAsciiLetter(char c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');

        private static bool IsFinite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);

        private void RequireNumber()
        {
            if (Kind != OscValueTypeKind.Int && Kind != OscValueTypeKind.Float) throw new InvalidOperationException("range and step are for Int and Float");
        }

        // 受け側は入れ子 8 段・要素 512 個までしか読まない(認証の無い LAN で深い木を受けないため)。送る側も同じ上限で作らせない
        private void CheckSize()
        {
            var nodes = 0;
            if (Depth(this, 0, ref nodes) > MaxDepth || nodes > MaxNodes)
            {
                throw new ArgumentException("a type has at most " + MaxDepth + " levels and " + MaxNodes + " nodes");
            }
        }

        private static int Depth(OscValueType type, int depth, ref int nodes)
        {
            nodes += 1;
            if (nodes > MaxNodes || depth > MaxDepth) return int.MaxValue;
            var deepest = depth;
            if (type.Kind == OscValueTypeKind.Record)
            {
                foreach (var field in type.Fields) deepest = Math.Max(deepest, Depth(field.Type, depth + 1, ref nodes));
            }
            else if (type.Kind == OscValueTypeKind.Array)
            {
                deepest = Math.Max(deepest, Depth(type.Items, depth + 1, ref nodes));
            }

            return deepest;
        }

        /// <summary>
        /// 受信引数をこの型(基本型だけの Record)の値として読む。数・型が合わなければ理由を返す。
        /// 値は Key が空の <see cref="OscRecord"/>(フィールド id で取り出せる)。範囲は見ない(受け手が判断する)。
        /// </summary>
        public bool TryRead(IReadOnlyList<object> args, out OscRecord value, out string reason)
        {
            value = null;
            if (!IsFlatRecord)
            {
                reason = "nested or variable-length types cannot be received yet";
                return false;
            }

            var count = args?.Count ?? 0;
            if (count != Fields.Count)
            {
                reason = "expects " + Fields.Count + " arguments, got " + count;
                return false;
            }

            var values = new object[count];
            var ids = new string[count];
            for (var n = 0; n < count; n++)
            {
                var field = Fields[n];
                ids[n] = field.Id;
                var arg = args[n];
                bool ok;
                switch (field.Type.Kind)
                {
                    case OscValueTypeKind.Int:
                        ok = OscValueConvert.TryInt(arg, out var i);
                        values[n] = i;
                        break;
                    case OscValueTypeKind.Float:
                        ok = OscValueConvert.TryFloat(arg, out var f);
                        values[n] = f;
                        break;
                    case OscValueTypeKind.String:
                        ok = OscValueConvert.TryString(arg, out var s);
                        values[n] = s;
                        break;
                    default:
                        ok = OscValueConvert.TryBool(arg, out var b);
                        values[n] = b;
                        break;
                }

                if (!ok)
                {
                    reason = "field " + field.Id + " does not fit " + KindName(field.Type.Kind);
                    return false;
                }
            }

            value = new OscRecord(string.Empty, values, ids);
            reason = null;
            return true;
        }
    }

    /// <summary>Record のフィールド 1 つ(id・表示名・型)。</summary>
    public sealed class OscValueField
    {
        private OscValueField(string id, string label, OscValueType type)
        {
            Id = id;
            Label = label ?? string.Empty;
            Type = type;
        }

        public string Id { get; }
        public string Label { get; }
        public OscValueType Type { get; }

        /// <summary>id は定義の識別子と同じ規則(英字で始まり、英数字と _ - の 64 文字まで)。</summary>
        public static OscValueField Of(string id, OscValueType type, string label = null)
        {
            if (type == null) throw new ArgumentNullException(nameof(type));
            if (!IsIdentifier(id)) throw new ArgumentException("field id must start with a letter and contain letters, digits, '_' and '-' (up to 64): " + id, nameof(id));
            return new OscValueField(id, label, type);
        }

        private static bool IsIdentifier(string id)
        {
            if (string.IsNullOrEmpty(id) || id.Length > 64) return false;
            for (var n = 0; n < id.Length; n++)
            {
                var c = id[n];
                var letter = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
                if (n == 0 ? !letter : !(letter || (c >= '0' && c <= '9') || c == '_' || c == '-')) return false;
            }

            return true;
        }
    }
}
