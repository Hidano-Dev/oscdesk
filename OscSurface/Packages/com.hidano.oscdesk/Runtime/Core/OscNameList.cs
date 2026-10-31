using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>名前の一覧から除いた理由、または目安を超えたことの種類(DESIGN.md D-098)。</summary>
    public enum OscNameListIssue
    {
        /// <summary>null・空・空白のみ(ゼロ幅スペースなどの書式文字だけの名前を含む)。除く。</summary>
        Blank,

        /// <summary>制御文字(char.IsControl)を含む。除く。</summary>
        ControlCharacter,

        /// <summary>対になっていないサロゲート(不正な UTF-16)を含む。UTF-8 にできず一覧ごと送れなくなるので除く。</summary>
        InvalidText,

        /// <summary>定義の静的な固定候補(例: 「(none)」)と同じ。除く。</summary>
        Reserved,

        /// <summary>前に出た名前と同じ(大文字小文字を区別する Ordinal)。後のものを除く。</summary>
        Duplicate,

        /// <summary>正規化後の件数が目安を超えた。除かずに知らせるだけ。</summary>
        CountExceeded,

        /// <summary>正規化後の名前の長さが目安を超えた。除かずに知らせるだけ。</summary>
        LengthExceeded,

        /// <summary>供給元(OscNameListFeed のソース)が例外を投げた。そのソースは空として扱う。</summary>
        SourceFailed,
    }

    /// <summary>一覧の正規化で出た警告 1 件。Message はそのままログに出せる文。</summary>
    public sealed class OscNameListWarning
    {
        internal OscNameListWarning(OscNameListIssue issue, int sourceIndex, int index, string value, string message)
        {
            Issue = issue;
            SourceIndex = sourceIndex;
            Index = index;
            Value = value;
            Message = message;
        }

        public OscNameListIssue Issue { get; }

        /// <summary>複数ソースの結合でのソースの番号(0 始まり)。1 本の一覧の正規化と CountExceeded では -1。</summary>
        public int SourceIndex { get; }

        /// <summary>
        /// 除いた名前のソースの中での番号(0 始まり)。LengthExceeded は正規化後の一覧での番号。
        /// CountExceeded と SourceFailed では -1。
        /// </summary>
        public int Index { get; }

        /// <summary>問題の名前(CountExceeded と SourceFailed では null)。制御文字を含むことがあるので、そのまま表示しない。</summary>
        public string Value { get; }

        public string Message { get; }

        public override string ToString()
        {
            return Message;
        }
    }

    /// <summary>正規化の結果。Names はそのまま OscReceiver.SendStrings に渡せる。</summary>
    public sealed class OscNameListResult
    {
        internal OscNameListResult(IReadOnlyList<string> names, IReadOnlyList<OscNameListWarning> warnings, int sourceCount)
        {
            Names = names;
            Warnings = warnings;
            SourceCount = sourceCount;
        }

        /// <summary>除いたあとの名前。入力順(複数ソースはソース順、同名は先勝ち)。</summary>
        public IReadOnlyList<string> Names { get; }

        public IReadOnlyList<OscNameListWarning> Warnings { get; }

        /// <summary>結合したソースの数(null のソースも数える)。1 本の一覧の正規化では 1(入力が null でも 1)。</summary>
        public int SourceCount { get; }
    }

    /// <summary>
    /// 正規化の設定。固定候補・目安・警告に出す呼び名だけが一覧ごとに違い、除く規則そのものは共通(D-098)。
    /// </summary>
    public sealed class OscNameListOptions
    {
        private IReadOnlyList<string> reserved = Array.Empty<string>();
        private string label = "名前";

        /// <summary>
        /// 一覧から除く固定候補(Ordinal で完全一致)。定義の静的な options に「割り当てなし」の「(none)」などを置き、
        /// 動的な一覧と和集合で見せるとき、同じ名前が二重に出ないように除く。null は空として扱う。
        /// </summary>
        public IReadOnlyList<string> Reserved
        {
            get { return reserved; }
            set { reserved = value ?? Array.Empty<string>(); }
        }

        /// <summary>
        /// 件数の目安。超えても除かず CountExceeded の警告だけを出す(0 以下で検査しない)。
        /// 送れるかどうかは OscStringList の 60 KiB の検査が決めるので、ここは「想定外に多い」ことを知らせるだけ。
        /// </summary>
        public int MaxCount { get; set; }

        /// <summary>名前の長さ(string.Length、UTF-16 のコード単位)の目安。超えても除かず LengthExceeded だけを出す(0 以下で検査しない)。</summary>
        public int MaxLength { get; set; }

        /// <summary>警告の文に出す一覧の呼び名(例: 「デバイス」)。null・空は「名前」。</summary>
        public string Label
        {
            get { return label; }
            set { label = string.IsNullOrEmpty(value) ? "名前" : value; }
        }
    }

    /// <summary>
    /// optionsFrom / keysFrom(D-053〜D-057・D-059)に返す名前の一覧の正規化と、前回送った一覧との比較(D-098)。
    /// 空白のみ・制御文字・不正な UTF-16・固定候補・重複(Ordinal)を除き、入力順を保つ。除いた理由と目安の超過は警告で返す。
    /// 空白や制御文字の名前は OscDesk の選択肢・行のキーとして見分けられず、照合でも取り違えるので送らない。
    /// ブリッジも空文字と重複を除く(D-062)が、ここで除けば理由をアプリのログに出せる。
    /// </summary>
    public static class OscNameList
    {
        /// <summary>1 本の一覧を正規化する。raw が null なら空の一覧。</summary>
        public static OscNameListResult Normalize(IReadOnlyList<string> raw, OscNameListOptions options = null)
        {
            return NormalizeCore(new[] { raw }, options, false);
        }

        /// <summary>
        /// 複数の一覧をソース順に結合して正規化する(同名は先に出たソースが勝つ)。sources と各ソースの null は空として扱う。
        /// </summary>
        public static OscNameListResult NormalizeSources(IReadOnlyList<IReadOnlyList<string>> sources, OscNameListOptions options = null)
        {
            return NormalizeCore(sources ?? Array.Empty<IReadOnlyList<string>>(), options, true);
        }

        /// <summary>
        /// 順序込みで同じか(Ordinal)。前回送った一覧と比べ、違うときだけ送るために使う(D-057 の間引き)。
        /// 一方だけが null なら違う(まだ送っていない状態の null と、空の一覧を区別し、初回は空でも送る)。
        /// </summary>
        public static bool SequenceEqual(IReadOnlyList<string> left, IReadOnlyList<string> right)
        {
            if (ReferenceEquals(left, right)) return true;
            if (left == null || right == null || left.Count != right.Count) return false;
            for (var i = 0; i < left.Count; i++)
            {
                if (!string.Equals(left[i], right[i], StringComparison.Ordinal)) return false;
            }

            return true;
        }

        // prior は先に積む警告(OscNameListFeed のソースの例外)。並びを「ソースの失敗 → 除外 → 目安」にそろえる
        internal static OscNameListResult NormalizeCore(
            IReadOnlyList<IReadOnlyList<string>> sources,
            OscNameListOptions options,
            bool multiSource,
            List<OscNameListWarning> prior = null)
        {
            options = options ?? new OscNameListOptions();
            var names = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var reserved = new HashSet<string>(StringComparer.Ordinal);
            foreach (var value in options.Reserved)
            {
                if (value != null) reserved.Add(value);
            }

            var warnings = prior ?? new List<OscNameListWarning>();
            var label = options.Label;

            for (var sourceIndex = 0; sourceIndex < sources.Count; sourceIndex++)
            {
                var source = sources[sourceIndex];
                if (source == null) continue;

                for (var index = 0; index < source.Count; index++)
                {
                    var name = source[index];
                    OscNameListIssue issue;
                    string reason;
                    if (IsBlank(name))
                    {
                        issue = OscNameListIssue.Blank;
                        reason = "空または空白のみです。";
                    }
                    else if (HasControlCharacter(name))
                    {
                        issue = OscNameListIssue.ControlCharacter;
                        reason = "制御文字を含みます。";
                    }
                    else if (HasLoneSurrogate(name))
                    {
                        issue = OscNameListIssue.InvalidText;
                        reason = "対になっていないサロゲートを含みます(UTF-8 にできず、一覧ごと送れなくなるため)。";
                    }
                    else if (reserved.Contains(name))
                    {
                        issue = OscNameListIssue.Reserved;
                        reason = "固定候補 \"" + name + "\" と同じです。";
                    }
                    else if (!seen.Add(name))
                    {
                        issue = OscNameListIssue.Duplicate;
                        reason = "\"" + name + "\" が重複しています。";
                    }
                    else
                    {
                        names.Add(name);
                        continue;
                    }

                    // 位置の文は除くときだけ作る(周期の作り直しで、警告の無い名前ごとに文字列を作らない)
                    var position = multiSource ? "ソース " + sourceIndex + " の " + index + " 番目" : index + " 番目";
                    warnings.Add(new OscNameListWarning(issue, multiSource ? sourceIndex : -1, index, name,
                        label + "の" + position + "を除きました: " + reason));
                }
            }

            if (options.MaxCount > 0 && names.Count > options.MaxCount)
            {
                warnings.Add(new OscNameListWarning(OscNameListIssue.CountExceeded, -1, -1, null,
                    label + "が " + names.Count + " 件あり、目安の " + options.MaxCount + " 件を超えています(除かずに送ります)。"));
            }

            if (options.MaxLength > 0)
            {
                for (var index = 0; index < names.Count; index++)
                {
                    if (names[index].Length > options.MaxLength)
                    {
                        warnings.Add(new OscNameListWarning(OscNameListIssue.LengthExceeded, -1, index, names[index],
                            label + "の正規化後の " + index + " 番目が " + names[index].Length + " 文字あり、目安の "
                            + options.MaxLength + " 文字を超えています(除かずに送ります)。"));
                    }
                }
            }

            return new OscNameListResult(names.AsReadOnly(), warnings.AsReadOnly(), sources.Count);
        }

        // 空白と書式文字(ゼロ幅スペース U+200B・BOM U+FEFF・方向の制御 U+200E など、Unicode の Cf)だけの名前は、
        // 画面で空に見えて選べないので空白のみと同じに扱う。書式文字を含むだけの名前(絵文字の ZWJ 連結など)は除かない
        private static bool IsBlank(string value)
        {
            if (value == null) return true;
            for (var i = 0; i < value.Length; i++)
            {
                if (!char.IsWhiteSpace(value[i])
                    && char.GetUnicodeCategory(value[i]) != System.Globalization.UnicodeCategory.Format)
                {
                    return false;
                }
            }

            return true;
        }

        private static bool HasControlCharacter(string value)
        {
            for (var i = 0; i < value.Length; i++)
            {
                if (char.IsControl(value[i])) return true;
            }

            return false;
        }

        // OscCodec は不正な UTF-16 で例外を投げる厳密な UTF-8 で書くので、1 つでも混じると一覧ごと送れない
        // (OscStringList の大きさの見積もりは置換で数えるので、送る前の検査では気づけない)
        private static bool HasLoneSurrogate(string value)
        {
            for (var i = 0; i < value.Length; i++)
            {
                if (char.IsHighSurrogate(value[i]))
                {
                    if (i + 1 >= value.Length || !char.IsLowSurrogate(value[i + 1])) return true;
                    i++;
                }
                else if (char.IsLowSurrogate(value[i]))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
