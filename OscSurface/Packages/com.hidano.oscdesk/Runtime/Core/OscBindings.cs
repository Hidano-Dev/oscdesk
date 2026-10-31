using System;
using System.Collections.Generic;
using System.Globalization;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 対応表の 1 行が受け取る引数の型。Trigger は引数の有無を問わず発火する。
    /// Record はレコードの行(先頭 s のキー + フィールドの列、D-063)。
    /// Strings は s だけの引数 0 個以上をまとめて受ける(UI で管理するキーの一覧、D-075)。0 個(全部消した)でも発火する。
    /// 値はシーンに整数で保存されるので、既存の値の番号を変えず末尾に足す。
    /// </summary>
    public enum OscBindingKind
    {
        Trigger,
        Int,
        Float,
        String,
        Bool,
        Record,
        Strings
    }

    /// <summary>対応表の 1 行の、振り分けと検査に必要な部分だけ(UnityEvent は持たない)。</summary>
    public readonly struct OscBindingRow
    {
        private static readonly string[] NoIds = new string[0];
        private readonly IReadOnlyList<string> fieldIds;

        public string Address { get; }
        public OscBindingKind Kind { get; }
        public int ListenerCount { get; }

        /// <summary>Record の行のフィールド id(宣言順)。空ならフィールドの数を検査しない。Record 以外では使わない。</summary>
        public IReadOnlyList<string> FieldIds => fieldIds ?? NoIds;

        /// <summary>
        /// Record の行が [s:行 ID, s:名前, フィールド…] を受けるか(keysFrom.source "ui" のレコード、HID-323)。
        /// Record 以外では使わない。
        /// </summary>
        public bool RecordRowIds { get; }

        public OscBindingRow(string address, OscBindingKind kind, int listenerCount, IReadOnlyList<string> fieldIds = null, bool recordRowIds = false)
        {
            Address = address ?? string.Empty;
            Kind = kind;
            ListenerCount = listenerCount;
            this.fieldIds = fieldIds;
            RecordRowIds = recordRowIds;
        }
    }

    /// <summary>振り分けの結果 1 件。アダプタは RowIndex の行のイベントを Kind に応じた値で呼ぶ。</summary>
    public readonly struct OscInvocation
    {
        public int RowIndex { get; }
        public OscBindingKind Kind { get; }
        public int IntValue { get; }
        public float FloatValue { get; }
        public string StringValue { get; }
        public bool BoolValue { get; }
        /// <summary>Record の行のときだけ値を持つ。</summary>
        public OscRecord RecordValue { get; }
        /// <summary>Strings の行のときだけ値を持つ(引数の並びのまま。0 個なら空の配列)。</summary>
        public string[] StringsValue { get; }

        public OscInvocation(int rowIndex, OscBindingKind kind, int intValue, float floatValue, string stringValue, bool boolValue,
            OscRecord recordValue = null, string[] stringsValue = null)
        {
            RowIndex = rowIndex;
            Kind = kind;
            IntValue = intValue;
            FloatValue = floatValue;
            StringValue = stringValue;
            BoolValue = boolValue;
            RecordValue = recordValue;
            StringsValue = stringsValue;
        }
    }

    /// <summary>
    /// 届いたアドレスで行を引き、受信引数を行の型へ変換する。
    /// アドレスが OSC 1.0 のパターン(`*` `?` `[...]` `{a,b}`)なら一致した行をすべて、そうでなければ完全一致の行を引く(D-106)。
    /// 型が合わない行は発火させず Mismatches に残す(黙って別の値で呼ぶと利用者のスクリプトが誤動作するため)。
    /// 同じアドレスの行が複数あれば、一致した行をすべて呼ぶ。
    /// </summary>
    public sealed class OscDispatcher
    {
        /// <summary>
        /// パターン 1 つで振り分ける行の上限(D-106)。認証の無い LAN から `/*/*/*` のような 1 通で全行を呼ばせることはできるが、
        /// 行の数は利用者が組んだ対応表で決まるので、増幅はその数で止まる。それでも大きな対応表で 1 通が 1 フレームを占めないよう、
        /// これを超えた分は対応表の並びの後ろから呼ばずに数だけ返す(呼び出し側が警告する)。
        /// </summary>
        public const int MaxPatternMatches = 256;

        private readonly Dictionary<string, List<int>> rowsByAddress = new Dictionary<string, List<int>>(StringComparer.Ordinal);
        private readonly List<string> addresses = new List<string>(); // パターンの突き合わせで回す、重複の無いアドレス(対応表の並び順)
        private readonly OscBindingRow[] rows;
        private readonly List<int> patternMatches = new List<int>();

        // 直近に読んだパターン。同じパターンが続けて届く(フェーダーの連続送信など)ときに読み直さないため
        private string lastPatternText;
        private OscAddressPattern lastPattern;

        public OscDispatcher(IEnumerable<OscBindingRow> rows)
        {
            this.rows = new List<OscBindingRow>(rows ?? Array.Empty<OscBindingRow>()).ToArray();
            for (var i = 0; i < this.rows.Length; i++)
            {
                var address = this.rows[i].Address;
                if (address.Length == 0)
                {
                    continue;
                }

                if (!rowsByAddress.TryGetValue(address, out var list))
                {
                    list = new List<int>();
                    rowsByAddress.Add(address, list);
                    addresses.Add(address);
                }

                list.Add(i);
            }
        }

        /// <summary>対応表の行(Dispatch の Mismatches・OscInvocation.RowIndex の番号で引く)。</summary>
        public OscBindingRow RowAt(int index)
        {
            return rows[index];
        }

        /// <summary>
        /// 対応表にそのアドレスに当たる行があるか(型の適否は問わない)。パターンなら 1 行でも一致すれば true。
        /// </summary>
        public bool HasAddress(string address)
        {
            if (address == null)
            {
                return false;
            }

            if (rowsByAddress.ContainsKey(address))
            {
                return true;
            }

            var pattern = PatternFor(address);
            if (pattern == null)
            {
                return false;
            }

            foreach (var candidate in addresses)
            {
                if (pattern.IsMatch(candidate))
                {
                    return true;
                }
            }

            return false;
        }

        /// <summary>
        /// 振り分ける。戻り値は発火する行の数。行の無いアドレスは 0 で、Mismatches も空。
        /// invocations / mismatches は呼び出し側が毎回渡す(受信ごとの確保を避ける)。
        /// </summary>
        public int Dispatch(string address, IReadOnlyList<object> args, List<OscInvocation> invocations, List<int> mismatches)
        {
            return Dispatch(address, args, invocations, mismatches, out _);
        }

        /// <summary>
        /// 振り分ける。skipped は、パターンに一致したが MaxPatternMatches を超えたので呼ばなかった行の数(パターンでなければ 0)。
        /// </summary>
        public int Dispatch(string address, IReadOnlyList<object> args, List<OscInvocation> invocations, List<int> mismatches, out int skipped)
        {
            invocations.Clear();
            mismatches.Clear();
            skipped = 0;
            if (address == null)
            {
                return 0;
            }

            IReadOnlyList<int> indices;
            var pattern = PatternFor(address);
            if (pattern == null)
            {
                // パターンでない(または読めないパターンの)アドレスは今までどおり完全一致だけで引く
                if (!rowsByAddress.TryGetValue(address, out var exact))
                {
                    return 0;
                }

                indices = exact;
            }
            else
            {
                patternMatches.Clear();
                foreach (var candidate in addresses)
                {
                    // 記法の文字を含む行のアドレスも、同じ文字列が届けば今までどおり当たるようにする(OSC 1.0 では登録側に使えない文字だが、
                    // 既存のシーンの行を黙って届かなくしないため)
                    if (string.Equals(candidate, address, StringComparison.Ordinal) || pattern.IsMatch(candidate))
                    {
                        patternMatches.AddRange(rowsByAddress[candidate]);
                    }
                }

                // 対応表の並び順で呼ぶ(パターンでない受信で同じアドレスの行を並び順に呼ぶのと揃える)
                patternMatches.Sort();
                if (patternMatches.Count > MaxPatternMatches)
                {
                    skipped = patternMatches.Count - MaxPatternMatches;
                    patternMatches.RemoveRange(MaxPatternMatches, skipped);
                }

                indices = patternMatches;
            }

            for (var n = 0; n < indices.Count; n++)
            {
                var index = indices[n];
                if (TryConvert(index, rows[index], args, out var invocation))
                {
                    invocations.Add(invocation);
                }
                else
                {
                    mismatches.Add(index);
                }
            }

            return invocations.Count;
        }

        /// <summary>
        /// 届いたアドレスをパターンとして読む。パターンの記法を含まない・読めない・長すぎるときは null(完全一致で引く)。
        /// 読めないパターンをエラーにしないのは、未登録のアドレスと同じく「何もしない」が受け口の約束だから(UNITY_PROTOCOL §2)。
        /// </summary>
        private OscAddressPattern PatternFor(string address)
        {
            if (!OscAddressPattern.ContainsPatternChars(address))
            {
                return null;
            }

            if (string.Equals(lastPatternText, address, StringComparison.Ordinal))
            {
                return lastPattern;
            }

            OscAddressPattern.TryParse(address, out var parsed, out _);
            lastPatternText = address;
            lastPattern = parsed;
            return parsed;
        }

        private static bool TryConvert(int index, OscBindingRow row, IReadOnlyList<object> args, out OscInvocation invocation)
        {
            var kind = row.Kind;
            var first = args != null && args.Count > 0 ? args[0] : null;
            switch (kind)
            {
                case OscBindingKind.Trigger:
                    invocation = new OscInvocation(index, kind, 0, 0f, null, false);
                    return true;

                case OscBindingKind.Int:
                    if (OscValueConvert.TryInt(first, out var i))
                    {
                        invocation = new OscInvocation(index, kind, i, 0f, null, false);
                        return true;
                    }

                    break;

                case OscBindingKind.Float:
                    if (OscValueConvert.TryFloat(first, out var f))
                    {
                        invocation = new OscInvocation(index, kind, 0, f, null, false);
                        return true;
                    }

                    break;

                case OscBindingKind.String:
                    if (OscValueConvert.TryString(first, out var s))
                    {
                        invocation = new OscInvocation(index, kind, 0, 0f, s, false);
                        return true;
                    }

                    break;

                case OscBindingKind.Bool:
                    if (OscValueConvert.TryBool(first, out var b))
                    {
                        invocation = new OscInvocation(index, kind, 0, 0f, null, b);
                        return true;
                    }

                    break;

                case OscBindingKind.Record:
                    // フィールドの型はここでは見ない(行は id しか持たない)。取り出し時に OscRecord が型を検査する
                    if (OscRecord.TryCreate(args, row.FieldIds, row.RecordRowIds, out var record, out _))
                    {
                        invocation = new OscInvocation(index, kind, 0, 0f, null, false, record);
                        return true;
                    }

                    break;

                case OscBindingKind.Strings:
                    // 一覧は全量なので、1 つでも s でない引数があれば一覧ごと受けない(半端な一覧で行を消さない)
                    var count = args?.Count ?? 0;
                    var strings = new string[count];
                    var allStrings = true;
                    for (var n = 0; n < count; n++)
                    {
                        if (!(args[n] is string text))
                        {
                            allStrings = false;
                            break;
                        }

                        strings[n] = text;
                    }

                    if (allStrings)
                    {
                        invocation = new OscInvocation(index, kind, 0, 0f, null, false, null, strings);
                        return true;
                    }

                    break;
            }

            invocation = default;
            return false;
        }

        /// <summary>行が受信引数を受けなかった理由(ログ用)。</summary>
        public static string ExplainMismatch(OscBindingRow row, IReadOnlyList<object> args)
        {
            if (row.Kind == OscBindingKind.Record)
            {
                return OscRecord.TryCreate(args, row.FieldIds, row.RecordRowIds, out _, out var reason) ? "一致しています" : reason;
            }

            return "引数の型が合いません";
        }

        /// <summary>受信値をそのまま返すためのエコー用正規化。bool は i の 0/1 にする(T/F タグを使わない)。</summary>
        public static object NormalizeForEcho(object value)
        {
            if (value is bool flag)
            {
                return flag ? 1 : 0;
            }

            return value;
        }

        public static string Describe(OscBindingRow row)
        {
            return row.Address + " (" + row.Kind.ToString().ToLower(CultureInfo.InvariantCulture) + ")";
        }
    }
}
