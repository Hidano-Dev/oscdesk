// OscCatalog.cs — Registry に沿って設計図(Catalog)を作り、/sys/catalog/* のデータグラムにする(DESIGN.md D-104 / D-114)。
// UnityEngine に依存しない。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace OscDesk.Receiver
{
    /// <summary>設計図の項目のキーと値の組。値は int / float / string(OSC の i / f / s)。</summary>
    public readonly struct OscCatalogProp
    {
        public string Key { get; }
        public object Value { get; }

        public OscCatalogProp(string key, object value)
        {
            Key = key ?? string.Empty;
            Value = value;
        }
    }

    /// <summary>設計図の項目 1 つ(packages/shared/src/catalog.ts の CatalogItem と同じ形)。</summary>
    public sealed class OscCatalogItem
    {
        public string Address { get; }
        public string Kind { get; }
        public string Type { get; }
        public IReadOnlyList<OscCatalogProp> Props { get; }

        public OscCatalogItem(string address, string kind, string type, IReadOnlyList<OscCatalogProp> props = null)
        {
            Address = address ?? string.Empty;
            Kind = kind ?? string.Empty;
            Type = type ?? string.Empty;
            Props = props ?? Array.Empty<OscCatalogProp>();
        }

        /// <summary>/sys/catalog/add の引数(アドレス, kind, type, [キー, 値]…)。</summary>
        public object[] ToAddArgs()
        {
            var args = new object[3 + Props.Count * 2];
            args[0] = Address;
            args[1] = Kind;
            args[2] = Type;
            for (var i = 0; i < Props.Count; i++)
            {
                args[3 + i * 2] = Props[i].Key;
                args[4 + i * 2] = Props[i].Value;
            }

            return args;
        }
    }

    /// <summary>
    /// 設計図の要約値(件数と CRC32)。docs/UNITY_PROTOCOL.md「設計図の要約値」と packages/shared/src/catalog.ts の
    /// canonicalCatalogText / catalogDigest と同じ規則で、protocol/catalog-samples.json の見本で両者を縛る。
    /// </summary>
    public static class OscCatalogDigest
    {
        private static readonly uint[] Table = BuildTable();
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, false);

        private static uint[] BuildTable()
        {
            var table = new uint[256];
            for (uint n = 0; n < 256; n++)
            {
                var c = n;
                for (var k = 0; k < 8; k++)
                {
                    c = (c & 1) == 1 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
                }

                table[n] = c;
            }

            return table;
        }

        /// <summary>CRC-32(IEEE 802.3)を符号付き int32 で(OSC の i にそのまま載せるため)。</summary>
        public static int Crc32(byte[] bytes)
        {
            var crc = 0xFFFFFFFFu;
            foreach (var b in bytes)
            {
                crc = Table[(crc ^ b) & 0xFF] ^ (crc >> 8);
            }

            return unchecked((int)(crc ^ 0xFFFFFFFFu));
        }

        public static int Crc32(string text)
        {
            return Crc32(Utf8.GetBytes(text ?? string.Empty));
        }

        /// <summary>
        /// 正規形のテキスト。アドレスの UTF-8 バイト順に並べ、1 項目 1 行(末尾 LF)。行は アドレス TAB kind TAB type に、
        /// キーの UTF-8 バイト順(同じキーは送った順)の キー=型:値 を TAB で続ける。f は float32 のビット列を 8 桁の小文字 16 進、
        /// 文字列は % TAB LF CR だけを %XX にする(10 進の最短表記は C# と TS で違うため)。
        /// </summary>
        public static string Canonical(IEnumerable<OscCatalogItem> items)
        {
            var sorted = new List<OscCatalogItem>(items ?? Array.Empty<OscCatalogItem>());
            sorted.Sort((a, b) => CompareUtf8(a.Address, b.Address));
            var text = new StringBuilder();
            foreach (var item in sorted)
            {
                text.Append(Escape(item.Address)).Append('\t').Append(Escape(item.Kind)).Append('\t').Append(Escape(item.Type));
                var order = new List<int>(item.Props.Count);
                for (var i = 0; i < item.Props.Count; i++)
                {
                    order.Add(i);
                }

                // 同じキーは送った順(安定な並べ替え)
                order.Sort((x, y) =>
                {
                    var byKey = CompareUtf8(item.Props[x].Key, item.Props[y].Key);
                    return byKey != 0 ? byKey : x.CompareTo(y);
                });
                foreach (var index in order)
                {
                    text.Append('\t').Append(PropText(item.Props[index]));
                }

                text.Append('\n');
            }

            return text.ToString();
        }

        public static void Compute(IReadOnlyCollection<OscCatalogItem> items, out int count, out int crc)
        {
            count = items?.Count ?? 0;
            crc = Crc32(Canonical(items));
        }

        private static string PropText(OscCatalogProp prop)
        {
            switch (prop.Value)
            {
                case int i:
                    return prop.Key + "=i:" + i.ToString(CultureInfo.InvariantCulture);
                case float f:
                    var bits = unchecked((uint)new FloatBits { Float = f }.Int);
                    return prop.Key + "=f:" + bits.ToString("x8", CultureInfo.InvariantCulture);
                default:
                    return prop.Key + "=s:" + Escape(prop.Value as string ?? string.Empty);
            }
        }

        private static string Escape(string text)
        {
            return (text ?? string.Empty).Replace("%", "%25").Replace("\t", "%09").Replace("\n", "%0A").Replace("\r", "%0D");
        }

        /// <summary>UTF-8 のバイト順の比較(TS の Buffer.compare と同じ順)。</summary>
        public static int CompareUtf8(string a, string b)
        {
            var left = Utf8.GetBytes(a ?? string.Empty);
            var right = Utf8.GetBytes(b ?? string.Empty);
            var length = Math.Min(left.Length, right.Length);
            for (var i = 0; i < length; i++)
            {
                if (left[i] != right[i])
                {
                    return left[i].CompareTo(right[i]);
                }
            }

            return left.Length.CompareTo(right.Length);
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct FloatBits
        {
            [FieldOffset(0)] public float Float;
            [FieldOffset(0)] public int Int;
        }
    }

    /// <summary>
    /// Catalog。Registry の変化を購読し、変わったアドレスを溜めて、まとめて add / remove と digest のデータグラムにする(1 フレーム 1 回は
    /// 呼び出し側が守る)。全体は begin … end で送る。受け付けなかった重複は、登録された項目にキー duplicate(持ち主の名前)で載せる。
    /// </summary>
    public sealed class OscCatalog
    {
        public const string BeginAddress = "/sys/catalog/begin";
        public const string AddAddress = "/sys/catalog/add";
        public const string RemoveAddress = "/sys/catalog/remove";
        public const string EndAddress = "/sys/catalog/end";
        public const string DigestAddress = "/sys/catalog/digest";
        public const string RequestAddress = "/sys/catalog/request";

        /// <summary>1 データグラムの上限(UNITY_PROTOCOL の「60 KiB を超えるときは分ける」)。</summary>
        public const int MaxDatagramBytes = 60 * 1024;

        // 受け側(packages/shared/src/catalog.ts の CATALOG)の上限に合わせて、受け付けられない項目を作らない
        public const int MaxNameChars = 64;
        public const int MaxStringChars = 1024;
        public const int MaxPropsPerItem = 32;
        public const int MaxItemBytes = 8 * 1024;

        /// <summary>
        /// 1 PC の項目の上限(受け側の CATALOG.MAX_ITEMS_PER_PC)。超える分を送ると受け側で捨てられ、件数と要約値が二度と合わないので、
        /// 送る側も登録の順の先頭からこの数だけを設計図にする(PR #107 の指摘)。
        /// </summary>
        public const int MaxItems = 4096;

        /// <summary>
        /// 設計図全体の大きさの上限(受け側の CATALOG.MAX_TOTAL_BYTES。項目を JSON にした大きさの合計)。超える分は受け側で捨てられ、
        /// 件数と要約値が合わなくなるので、送る側も登録の順に EstimateBytes(受け側の値を上回る見積もり)の合計がこれに収まる分だけを載せる
        /// (PR #107 の指摘)。受け側の上限は全 PC の合計なので、ほかの PC の設計図が大きいときは、これに収まっていても受け側で捨てられ得る。
        /// </summary>
        public const int MaxTotalBytes = 8 * 1024 * 1024;

        /// <summary>PC 名が空、または OSC で送れる文字が残らないときの名前。</summary>
        public const string DefaultPcName = "unity";

        public const string KindState = "state";
        public const string KindTrigger = "trigger";
        public const string DuplicateKey = "duplicate";

        private readonly OscRegistry registry;
        private readonly Func<object, string> describeOwner;
        private readonly HashSet<string> dirty = new HashSet<string>(StringComparer.Ordinal);
        // 最後に送った(相手が持っているはずの)項目。差分の add / remove を決めるのに使う
        private readonly Dictionary<string, OscCatalogItem> sent = new Dictionary<string, OscCatalogItem>(StringComparer.Ordinal);
        private bool attached;

        public OscCatalog(OscRegistry registry, Func<object, string> describeOwner = null)
        {
            this.registry = registry ?? throw new ArgumentNullException(nameof(registry));
            this.describeOwner = describeOwner ?? (owner => owner != null ? owner.ToString() : string.Empty);
        }

        public OscRegistry Registry => registry;

        /// <summary>前回の送信の後に変わったアドレスがあるか。</summary>
        public bool HasChanges => dirty.Count > 0;

        /// <summary>溜めた変化を捨てる(送らない間に溜め続けないため)。次は BuildFullSync で全体を送ること。</summary>
        public void DiscardChanges()
        {
            dirty.Clear();
        }

        public void Attach()
        {
            if (attached)
            {
                return;
            }

            attached = true;
            registry.Registered += OnRegistered;
            registry.Unregistered += OnUnregistered;
            registry.Rejected += OnRejected;
            registry.RejectionWithdrawn += OnRejectionWithdrawn;
        }

        public void Detach()
        {
            if (!attached)
            {
                return;
            }

            attached = false;
            registry.Registered -= OnRegistered;
            registry.Unregistered -= OnUnregistered;
            registry.Rejected -= OnRejected;
            registry.RejectionWithdrawn -= OnRejectionWithdrawn;
        }

        private void OnRegistered(OscRegistryEntry entry) { dirty.Add(entry.Address); }
        private void OnUnregistered(OscRegistryEntry entry) { dirty.Add(entry.Address); }
        private void OnRejected(OscRegistryEntry entry, OscRegistryEntry existing) { dirty.Add(entry.Address); }
        private void OnRejectionWithdrawn(OscRegistryEntry entry) { dirty.Add(entry.Address); }

        /// <summary>今の設計図(Registry の登録の順)。設計図に載せられない登録(不正なアドレス・送れない文字)は含まない。</summary>
        public List<OscCatalogItem> CurrentItems()
        {
            var items = new List<OscCatalogItem>();
            var omitted = 0;
            var omittedBySize = 0;
            long bytes = 0;
            foreach (var entry in registry.Ordered)
            {
                var item = CreateItem(entry, registry.RejectedFor(entry.Address));
                if (item == null)
                {
                    continue;
                }

                if (items.Count >= MaxItems)
                {
                    omitted += 1;
                    continue;
                }

                // 全量・差分・digest は同じこの一覧から作るので、大きさの上限もここで 1 回だけ効かせる
                var size = EstimateBytes(item);
                if (bytes + size > MaxTotalBytes)
                {
                    omitted += 1;
                    omittedBySize += 1;
                    continue;
                }

                bytes += size;
                items.Add(item);
            }

            Omitted = omitted;
            OmittedBySize = omittedBySize;
            return items;
        }

        /// <summary>直近に作った設計図で、上限(MaxItems・MaxTotalBytes)を超えたので載せなかった登録の数(受け口が警告に使う)。</summary>
        public int Omitted { get; private set; }

        /// <summary>Omitted のうち、大きさの上限(MaxTotalBytes)で載せなかった数。</summary>
        public int OmittedBySize { get; private set; }

        /// <summary>
        /// PC 名を OSC で送れる文字列にする。NUL と単独のサロゲートを除き、MaxNameChars に切る。何も残らなければ DefaultPcName
        /// (送れない名前のまま符号化すると例外で全体の Sync が送れなくなるため。PR #107 の指摘)。
        /// </summary>
        public static string NormalizePcName(string name)
        {
            if (string.IsNullOrEmpty(name))
            {
                return DefaultPcName;
            }

            var clean = new StringBuilder(name.Length);
            for (var i = 0; i < name.Length; i++)
            {
                var c = name[i];
                if (c == '\0')
                {
                    continue;
                }

                if (char.IsHighSurrogate(c))
                {
                    if (i + 1 < name.Length && char.IsLowSurrogate(name[i + 1]))
                    {
                        clean.Append(c).Append(name[i + 1]);
                        i += 1;
                    }

                    continue;
                }

                if (char.IsLowSurrogate(c))
                {
                    continue;
                }

                clean.Append(c);
            }

            var clipped = Clip(clean.ToString(), MaxNameChars);
            return clipped.Trim().Length == 0 ? DefaultPcName : clipped;
        }

        /// <summary>
        /// 全体を begin … end で送るデータグラム(60 KiB を超えるときは複数の bundle。最初に begin、最後に end)。
        /// 呼ぶと、溜めていた変化は全体に含まれたものとして消す。
        /// </summary>
        public List<byte[]> BuildFullSync(string pcName)
        {
            var items = CurrentItems();
            OscCatalogDigest.Compute(items, out var count, out var crc);
            var messages = new List<byte[]>(items.Count + 2)
            {
                OscCodec.EncodeMessage(BeginAddress, new object[] { NormalizePcName(pcName), count })
            };
            foreach (var item in items)
            {
                messages.Add(OscCodec.EncodeMessage(AddAddress, item.ToAddArgs()));
            }

            messages.Add(OscCodec.EncodeMessage(EndAddress, new object[] { count, crc }));

            sent.Clear();
            foreach (var item in items)
            {
                sent[item.Address] = item;
            }

            dirty.Clear();
            return Pack(messages);
        }

        /// <summary>
        /// 前回の送信からの差分を add / remove にし、最後にその時点の digest を付けたデータグラム(変化が無ければ空)。
        /// 呼ぶと溜めていた変化を消す。
        /// </summary>
        public List<byte[]> BuildDiff()
        {
            if (dirty.Count == 0)
            {
                return new List<byte[]>();
            }

            // 上限(MaxItems)で載せる項目が入れ替わり得る(先頭の登録が消えると、載せていなかった登録が載る)ので、
            // 変わったアドレスだけでなく、今の設計図全体と送った内容を比べる。内容の比較は変わったアドレスだけにする
            var changedSet = new HashSet<string>(dirty, StringComparer.Ordinal);
            dirty.Clear();
            var current = new Dictionary<string, OscCatalogItem>(StringComparer.Ordinal);
            foreach (var item in CurrentItems())
            {
                current[item.Address] = item;
            }

            var addresses = new List<string>();
            foreach (var address in sent.Keys)
            {
                if (!current.ContainsKey(address))
                {
                    addresses.Add(address);
                }
            }

            foreach (var pair in current)
            {
                if (!sent.TryGetValue(pair.Key, out var previous)
                    || (changedSet.Contains(pair.Key) && OscCatalogDigest.Canonical(new[] { previous }) != OscCatalogDigest.Canonical(new[] { pair.Value })))
                {
                    addresses.Add(pair.Key);
                }
            }

            // remove を先に、add を後に送る。受け側は add の時点で件数(4096)・大きさの上限を見るので、上限で入れ替わる項目の add を
            // remove より先に送ると、空きができる前に捨てられる(PR #107 の指摘)。それぞれの中はアドレスの順(同じ変化から同じデータグラムを作る)
            addresses.Sort(OscCatalogDigest.CompareUtf8);
            var messages = new List<byte[]>();
            foreach (var address in addresses)
            {
                if (!current.ContainsKey(address))
                {
                    sent.Remove(address);
                    messages.Add(OscCodec.EncodeMessage(RemoveAddress, new object[] { address }));
                }
            }

            // add の中も、同じアドレスの置き換えで小さくなるものを先に送る(受け側は合計の大きさを add の時点で見るので、
            // 大きくなる置き換えが先に届くと、最後には上限に収まる差分でも捨てられる。PR #107 の再レビュー)
            var shrinking = new List<OscCatalogItem>();
            var others = new List<OscCatalogItem>();
            foreach (var address in addresses)
            {
                if (current.TryGetValue(address, out var item))
                {
                    var smaller = sent.TryGetValue(address, out var previous) && EstimateBytes(item) < EstimateBytes(previous);
                    (smaller ? shrinking : others).Add(item);
                }
            }

            foreach (var item in shrinking)
            {
                sent[item.Address] = item;
                messages.Add(OscCodec.EncodeMessage(AddAddress, item.ToAddArgs()));
            }

            foreach (var item in others)
            {
                sent[item.Address] = item;
                messages.Add(OscCodec.EncodeMessage(AddAddress, item.ToAddArgs()));
            }

            if (messages.Count == 0)
            {
                return new List<byte[]>();
            }

            OscCatalogDigest.Compute(sent.Values, out var count, out var crc);
            messages.Add(OscCodec.EncodeMessage(DigestAddress, new object[] { count, crc }));
            return Pack(messages);
        }

        /// <summary>登録 1 件を設計図の項目にする。載せられなければ null。</summary>
        public OscCatalogItem CreateItem(OscRegistryEntry entry, IReadOnlyList<OscRegistryEntry> duplicates = null)
        {
            if (entry == null || !OscBindingAudit.IsValidAddress(entry.Address) || entry.Address.Length > MaxStringChars
                || entry.Address.IndexOf('\0') >= 0 || HasLoneSurrogate(entry.Address))
            {
                return null;
            }

            var operation = entry.Operation;
            if (operation.ValueType != null)
            {
                return CreateCompositeItem(entry, operation, duplicates);
            }

            var type = TypeOf(operation.Kind);
            var props = new List<OscCatalogProp>();
            var asInt = operation.Kind == OscBindingKind.Int;
            AddNumber(props, "min", operation.Min, asInt);
            AddNumber(props, "max", operation.Max, asInt);
            AddNumber(props, "step", operation.Step, asInt);
            AddString(props, "label", operation.Label);
            AddString(props, "widget", operation.Widget);
            foreach (var option in operation.Options)
            {
                AddString(props, "options", option, true); // 空の選択肢も選べる値なので落とさない(PR #107 の指摘)
            }

            if (duplicates != null)
            {
                foreach (var duplicate in duplicates)
                {
                    AddString(props, DuplicateKey, Describe(duplicate.Owner));
                }
            }

            if (props.Count > MaxPropsPerItem)
            {
                props.RemoveRange(MaxPropsPerItem, props.Count - MaxPropsPerItem);
            }

            var item = new OscCatalogItem(entry.Address, operation.IsCommand ? KindTrigger : KindState, type, props);
            // 1 項目を 1 メッセージで送るので、大きすぎる項目は後ろの組から削って収める(受け側は 8 KiB を超える項目を捨てる)
            while (item.Props.Count > 0 && EstimateBytes(item) > MaxItemBytes)
            {
                var trimmed = new List<OscCatalogProp>(item.Props);
                trimmed.RemoveAt(trimmed.Count - 1);
                item = new OscCatalogItem(item.Address, item.Kind, item.Type, trimmed);
            }

            // 組を全部削っても収まらない(アドレスそのものが大きい)項目は、受け側で捨てられるので載せない
            return EstimateBytes(item) > MaxItemBytes ? null : item;
        }

        /// <summary>設計図の項目の type(組み合わせの型。HID-380・D-121)と、型のスキーマを運ぶキー。</summary>
        public const string TypeComposite = "composite";
        public const string SchemaKey = "schema";

        // 組み合わせの型の項目。スキーマは JSON の文字列を 1024 文字ごとのキー schema に分けて載せる(受け側は順に連結して読む)。
        // スキーマは削ると読めなくなるので、組の数・大きさの上限に収まらなければ項目ごと載せない(重複の印・ラベルは先に削る)
        private OscCatalogItem CreateCompositeItem(OscRegistryEntry entry, OscOperation operation, IReadOnlyList<OscRegistryEntry> duplicates)
        {
            var schema = operation.ValueType.ToSchemaJson();
            if (HasLoneSurrogate(schema) || schema.IndexOf('\0') >= 0)
            {
                return null;
            }

            var schemaProps = new List<OscCatalogProp>();
            for (var start = 0; start < schema.Length;)
            {
                var length = Math.Min(MaxStringChars, schema.Length - start);
                if (start + length < schema.Length && char.IsHighSurrogate(schema[start + length - 1]))
                {
                    length -= 1; // サロゲートの組の間で切らない
                }

                schemaProps.Add(new OscCatalogProp(SchemaKey, schema.Substring(start, length)));
                start += length;
            }

            var extras = new List<OscCatalogProp>();
            AddString(extras, "label", operation.Label);
            if (duplicates != null)
            {
                foreach (var duplicate in duplicates)
                {
                    AddString(extras, DuplicateKey, Describe(duplicate.Owner));
                }
            }

            var kind = operation.IsCommand ? KindTrigger : KindState;
            while (true)
            {
                var props = new List<OscCatalogProp>(extras);
                props.AddRange(schemaProps);
                var item = new OscCatalogItem(entry.Address, kind, TypeComposite, props);
                if (props.Count <= MaxPropsPerItem && EstimateBytes(item) <= MaxItemBytes)
                {
                    return item;
                }

                if (extras.Count == 0)
                {
                    return null;
                }

                extras.RemoveAt(extras.Count - 1);
            }
        }

        private string Describe(object owner)
        {
            string name;
            try
            {
                name = describeOwner(owner);
            }
            catch (Exception)
            {
                name = null; // 名前を引けない持ち主でも設計図は送る
            }

            return string.IsNullOrEmpty(name) ? "?" : name;
        }

        private static string TypeOf(OscBindingKind kind)
        {
            switch (kind)
            {
                case OscBindingKind.Int: return "i";
                case OscBindingKind.Float: return "f";
                case OscBindingKind.String: return "s";
                case OscBindingKind.Bool: return "bool";
                case OscBindingKind.Record: return "record";
                case OscBindingKind.Strings: return "strings";
                default: return "trigger";
            }
        }

        private static void AddNumber(List<OscCatalogProp> props, string key, float? value, bool asInt)
        {
            if (!value.HasValue || float.IsNaN(value.Value) || float.IsInfinity(value.Value))
            {
                return; // 受け側は有限の数だけを受ける
            }

            // int32 の範囲は double で比べる(float の int.MaxValue は 2147483648 に丸まり、範囲外の値を int にしてしまうため。PR #107 の指摘)
            var rounded = Math.Round((double)value.Value);
            if (asInt && rounded >= int.MinValue && rounded <= int.MaxValue && Math.Abs(value.Value - rounded) < 1e-6)
            {
                props.Add(new OscCatalogProp(key, (int)rounded));
            }
            else
            {
                props.Add(new OscCatalogProp(key, value.Value));
            }
        }

        private static void AddString(List<OscCatalogProp> props, string key, string value, bool keepEmpty = false)
        {
            // label / widget の空は「指定なし」なので省く。options の空は値そのもの(keepEmpty)
            if (value == null || (value.Length == 0 && !keepEmpty))
            {
                return;
            }

            var clean = value.Replace("\0", string.Empty);
            if (HasLoneSurrogate(clean))
            {
                return; // UTF-8 にできない文字列は OSC で送れない
            }

            props.Add(new OscCatalogProp(key, Clip(clean, MaxStringChars)));
        }

        private static string Clip(string text, int max)
        {
            if (text.Length <= max)
            {
                return text;
            }

            var length = max;
            if (char.IsHighSurrogate(text[length - 1]))
            {
                length -= 1;
            }

            return text.Substring(0, length);
        }

        private static bool HasLoneSurrogate(string text)
        {
            for (var i = 0; i < text.Length; i++)
            {
                if (char.IsHighSurrogate(text[i]))
                {
                    if (i + 1 >= text.Length || !char.IsLowSurrogate(text[i + 1]))
                    {
                        return true;
                    }

                    i += 1;
                }
                else if (char.IsLowSurrogate(text[i]))
                {
                    return true;
                }
            }

            return false;
        }

        // 受け側は項目を JSON にした大きさで数える(packages/shared の catalogItemBytes)。文字列は JSON のエスケープ後の大きさ
        // (制御文字は \u00XX の 6 バイト、" と \ は 2 バイト)で数え、キーと値の枠組みには余裕を足して、受け側の値を必ず上回る見積もりにする
        // (UTF-8 の長さの 2 倍では制御文字だけの文字列を少なく見積もり、受け側で項目ごと捨てられていた。PR #107 の指摘)
        internal static int EstimateBytes(OscCatalogItem item)
        {
            var bytes = 64 + JsonStringBytes(item.Address) + JsonStringBytes(item.Kind) + JsonStringBytes(item.Type);
            foreach (var prop in item.Props)
            {
                // {"key":"…","arg":{"type":"s","value":…}}, の枠組みは 40 バイト未満
                bytes += 48 + JsonStringBytes(prop.Key);
                bytes += prop.Value is string s ? JsonStringBytes(s) : 32;
            }

            return bytes;
        }

        internal static int JsonStringBytes(string text)
        {
            var bytes = 2; // 引用符
            foreach (var c in text ?? string.Empty)
            {
                if (c < 0x20)
                {
                    bytes += 6;
                }
                else if (c == '"' || c == '\\')
                {
                    bytes += 2;
                }
                else if (c < 0x80)
                {
                    bytes += 1;
                }
                else if (c < 0x800 || char.IsSurrogate(c))
                {
                    bytes += 2; // サロゲートは対で 4 バイト
                }
                else
                {
                    bytes += 3;
                }
            }

            return bytes;
        }

        /// <summary>メッセージを順に、1 データグラム MaxDatagramBytes 以下の bundle に詰める。</summary>
        public static List<byte[]> Pack(IReadOnlyList<byte[]> messages)
        {
            var datagrams = new List<byte[]>();
            var current = new List<byte[]>();
            var size = OscCodec.BundleHeaderBytes;
            foreach (var message in messages)
            {
                var add = OscCodec.BundleElementOverheadBytes + message.Length;
                if (current.Count > 0 && size + add > MaxDatagramBytes)
                {
                    datagrams.Add(OscCodec.EncodeBundle(current));
                    current = new List<byte[]>();
                    size = OscCodec.BundleHeaderBytes;
                }

                current.Add(message);
                size += add;
            }

            if (current.Count > 0)
            {
                datagrams.Add(OscCodec.EncodeBundle(current));
            }

            return datagrams;
        }
    }
}
