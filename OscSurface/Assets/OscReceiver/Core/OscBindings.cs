using System;
using System.Collections.Generic;
using System.Globalization;

namespace OscDesk.Receiver
{
    /// <summary>対応表の 1 行が受け取る引数の型。Trigger は引数の有無を問わず発火する。</summary>
    public enum OscBindingKind
    {
        Trigger,
        Int,
        Float,
        String,
        Bool
    }

    /// <summary>対応表の 1 行の、振り分けと検査に必要な部分だけ(UnityEvent は持たない)。</summary>
    public readonly struct OscBindingRow
    {
        public string Address { get; }
        public OscBindingKind Kind { get; }
        public int ListenerCount { get; }

        public OscBindingRow(string address, OscBindingKind kind, int listenerCount)
        {
            Address = address ?? string.Empty;
            Kind = kind;
            ListenerCount = listenerCount;
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

        public OscInvocation(int rowIndex, OscBindingKind kind, int intValue, float floatValue, string stringValue, bool boolValue)
        {
            RowIndex = rowIndex;
            Kind = kind;
            IntValue = intValue;
            FloatValue = floatValue;
            StringValue = stringValue;
            BoolValue = boolValue;
        }
    }

    /// <summary>
    /// アドレス完全一致で行を引き、受信引数を行の型へ変換する。
    /// 型が合わない行は発火させず Mismatches に残す(黙って別の値で呼ぶと利用者のスクリプトが誤動作するため)。
    /// 同じアドレスの行が複数あれば、一致した行をすべて呼ぶ。
    /// </summary>
    public sealed class OscDispatcher
    {
        private readonly Dictionary<string, List<int>> rowsByAddress = new Dictionary<string, List<int>>(StringComparer.Ordinal);
        private readonly OscBindingRow[] rows;

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
                }

                list.Add(i);
            }
        }

        /// <summary>対応表にそのアドレスの行があるか(型の適否は問わない)。</summary>
        public bool HasAddress(string address)
        {
            return address != null && rowsByAddress.ContainsKey(address);
        }

        /// <summary>
        /// 振り分ける。戻り値は発火する行の数。行の無いアドレスは 0 で、Mismatches も空。
        /// invocations / mismatches は呼び出し側が毎回渡す(受信ごとの確保を避ける)。
        /// </summary>
        public int Dispatch(string address, IReadOnlyList<object> args, List<OscInvocation> invocations, List<int> mismatches)
        {
            invocations.Clear();
            mismatches.Clear();
            if (address == null || !rowsByAddress.TryGetValue(address, out var indices))
            {
                return 0;
            }

            foreach (var index in indices)
            {
                if (TryConvert(index, rows[index].Kind, args, out var invocation))
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

        private static bool TryConvert(int index, OscBindingKind kind, IReadOnlyList<object> args, out OscInvocation invocation)
        {
            var first = args != null && args.Count > 0 ? args[0] : null;
            switch (kind)
            {
                case OscBindingKind.Trigger:
                    invocation = new OscInvocation(index, kind, 0, 0f, null, false);
                    return true;

                case OscBindingKind.Int:
                    if (first is int i)
                    {
                        invocation = new OscInvocation(index, kind, i, 0f, null, false);
                        return true;
                    }

                    // 整数値の float(例: 3.0)は int として受ける。小数部があれば丸めず不一致にする
                    if (first is float f && f == (float)Math.Floor(f) && f >= int.MinValue && f <= int.MaxValue)
                    {
                        invocation = new OscInvocation(index, kind, (int)f, 0f, null, false);
                        return true;
                    }

                    break;

                case OscBindingKind.Float:
                    if (first is float ff)
                    {
                        invocation = new OscInvocation(index, kind, 0, ff, null, false);
                        return true;
                    }

                    if (first is int fi)
                    {
                        invocation = new OscInvocation(index, kind, 0, fi, null, false);
                        return true;
                    }

                    break;

                case OscBindingKind.String:
                    if (first is string s)
                    {
                        invocation = new OscInvocation(index, kind, 0, 0f, s, false);
                        return true;
                    }

                    break;

                case OscBindingKind.Bool:
                    // OscDesk は真偽値を i の 0/1 で送る(UNITY_PROTOCOL §4.4)。bool 型タグ・float も受ける
                    if (first is bool b)
                    {
                        invocation = new OscInvocation(index, kind, 0, 0f, null, b);
                        return true;
                    }

                    if (first is int bi)
                    {
                        invocation = new OscInvocation(index, kind, 0, 0f, null, bi != 0);
                        return true;
                    }

                    if (first is float bf)
                    {
                        invocation = new OscInvocation(index, kind, 0, 0f, null, bf != 0f);
                        return true;
                    }

                    break;
            }

            invocation = default;
            return false;
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
