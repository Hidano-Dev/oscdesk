// OscAddressPattern.cs — OSC 1.0 のアドレスのパターン指定(DESIGN.md D-106)。UnityEngine に依存しない。
using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>
    /// OSC 1.0 のアドレスのパターン(`?` `*` `[...]` `[!...]` `{a,b}`)。届いたアドレスを登録済みのアドレスと突き合わせるのに使う。
    /// どの記法も `/` には一致しないので、`/effect/*/stop` の `*` は対象名の 1 段だけに当たる(OSC 1.0 の「部分ごとの一致」と同じ)。
    /// </summary>
    public sealed class OscAddressPattern
    {
        /// <summary>
        /// パターンとして解釈する長さの上限。一致の判定は「パターンの長さ × アドレスの長さ」に比例するので、
        /// 認証の無い LAN から 64 KiB 近いパターンを送られても 1 件の判定が重くならないよう、これを超えるものはパターンとして扱わない。
        /// 登録するアドレスはこれより十分短い前提(推奨の規約 /パッケージ/対象/操作)。
        /// </summary>
        public const int MaxLength = 256;

        private enum TokenKind
        {
            Literal,
            AnyChar,
            AnyRun,
            Set,
            Alternatives
        }

        private readonly struct Token
        {
            public readonly TokenKind Kind;
            public readonly char Char;
            public readonly bool Negated;
            public readonly char[] Ranges; // Set: [from0, to0, from1, to1, ...]
            public readonly string[] Options; // Alternatives

            public Token(TokenKind kind, char c = '\0', bool negated = false, char[] ranges = null, string[] options = null)
            {
                Kind = kind;
                Char = c;
                Negated = negated;
                Ranges = ranges;
                Options = options;
            }
        }

        private readonly Token[] tokens;

        // 判定ごとの確保を避けるための使い回し(0 = 未計算、1 = 一致、2 = 不一致)。受信は 1 スレッドで処理する前提
        private byte[] memo = new byte[0];

        public string Pattern { get; }

        private OscAddressPattern(string pattern, Token[] tokens)
        {
            Pattern = pattern;
            this.tokens = tokens;
        }

        /// <summary>
        /// パターンの記法の文字(`*` `?` `[` `{`)を含むか。含まないアドレスは今までどおり完全一致で引く。
        /// `]` `}` `,` `!` `-` は開き記号の中でだけ意味を持つので、単独では普通の文字として扱う。
        /// </summary>
        public static bool ContainsPatternChars(string address)
        {
            if (address == null)
            {
                return false;
            }

            for (var i = 0; i < address.Length; i++)
            {
                switch (address[i])
                {
                    case '*':
                    case '?':
                    case '[':
                    case '{':
                        return true;
                }
            }

            return false;
        }

        /// <summary>
        /// パターンを読む。読めない(閉じていない `[` `{`、空の `[]`、`{` の入れ子、記法の中の `/`、長すぎる)ときは false と理由を返す。
        /// </summary>
        public static bool TryParse(string pattern, out OscAddressPattern result, out string error)
        {
            result = null;
            if (pattern == null)
            {
                error = "パターンがありません";
                return false;
            }

            if (pattern.Length > MaxLength)
            {
                error = "パターンが長すぎます(" + pattern.Length + " 文字。上限 " + MaxLength + ")";
                return false;
            }

            var list = new List<Token>(pattern.Length);
            var i = 0;
            while (i < pattern.Length)
            {
                var c = pattern[i];
                switch (c)
                {
                    case '?':
                        list.Add(new Token(TokenKind.AnyChar));
                        i += 1;
                        break;

                    case '*':
                        // 続く `*` は 1 個と同じ。まとめておくと判定の手数が増えない
                        if (list.Count == 0 || list[list.Count - 1].Kind != TokenKind.AnyRun)
                        {
                            list.Add(new Token(TokenKind.AnyRun));
                        }

                        i += 1;
                        break;

                    case '[':
                        if (!TryParseSet(pattern, ref i, out var set, out error))
                        {
                            return false;
                        }

                        list.Add(set);
                        break;

                    case '{':
                        if (!TryParseAlternatives(pattern, ref i, out var alternatives, out error))
                        {
                            return false;
                        }

                        list.Add(alternatives);
                        break;

                    default:
                        list.Add(new Token(TokenKind.Literal, c));
                        i += 1;
                        break;
                }
            }

            result = new OscAddressPattern(pattern, list.ToArray());
            error = null;
            return true;
        }

        private static bool TryParseSet(string pattern, ref int i, out Token token, out string error)
        {
            token = default;
            var start = i;
            i += 1; // '['
            var negated = false;
            if (i < pattern.Length && pattern[i] == '!')
            {
                negated = true;
                i += 1;
            }

            var ranges = new List<char>();
            while (i < pattern.Length && pattern[i] != ']')
            {
                var from = pattern[i];
                if (from == '/' || from == '[' || from == '{')
                {
                    error = "[...] の中に使えない文字 '" + from + "' があります(" + start + " 文字目から)";
                    return false;
                }

                // `a-z` は範囲。先頭・末尾の `-` は文字そのもの(OSC 1.0 の記述と一般的な実装に合わせる)
                if (i + 2 < pattern.Length && pattern[i + 1] == '-' && pattern[i + 2] != ']')
                {
                    var to = pattern[i + 2];
                    if (to == '/' || to == '[' || to == '{')
                    {
                        error = "[...] の中に使えない文字 '" + to + "' があります(" + start + " 文字目から)";
                        return false;
                    }

                    if (to < from)
                    {
                        // 逆向きの範囲は読み手で解釈が割れる。黙って空集合にすると「届かない」原因が見えなくなるので不正とする
                        error = "[...] の範囲 " + from + "-" + to + " が逆向きです";
                        return false;
                    }

                    ranges.Add(from);
                    ranges.Add(to);
                    i += 3;
                }
                else
                {
                    ranges.Add(from);
                    ranges.Add(from);
                    i += 1;
                }
            }

            if (i >= pattern.Length)
            {
                error = "[ が閉じていません(" + start + " 文字目)";
                return false;
            }

            if (ranges.Count == 0)
            {
                error = "[] の中が空です(" + start + " 文字目)";
                return false;
            }

            i += 1; // ']'
            token = new Token(TokenKind.Set, negated: negated, ranges: ranges.ToArray());
            error = null;
            return true;
        }

        private static bool TryParseAlternatives(string pattern, ref int i, out Token token, out string error)
        {
            token = default;
            var start = i;
            i += 1; // '{'
            var options = new List<string>();
            var current = new System.Text.StringBuilder();
            while (i < pattern.Length && pattern[i] != '}')
            {
                var c = pattern[i];
                switch (c)
                {
                    case ',':
                        options.Add(current.ToString());
                        current.Clear();
                        break;
                    case '{':
                    case '[':
                    case '*':
                    case '?':
                    case '/':
                        // OSC 1.0 の {} は文字列の並びで、入れ子や記法を含まない
                        error = "{...} の中に使えない文字 '" + c + "' があります(" + start + " 文字目から)";
                        return false;
                    default:
                        current.Append(c);
                        break;
                }

                i += 1;
            }

            if (i >= pattern.Length)
            {
                error = "{ が閉じていません(" + start + " 文字目)";
                return false;
            }

            options.Add(current.ToString());
            i += 1; // '}'
            token = new Token(TokenKind.Alternatives, options: options.ToArray());
            error = null;
            return true;
        }

        /// <summary>アドレスがパターンに一致するか(大文字と小文字は区別する。OSC のアドレスは区別するため)。</summary>
        public bool IsMatch(string address)
        {
            if (address == null)
            {
                return false;
            }

            var size = (tokens.Length + 1) * (address.Length + 1);
            if (memo.Length < size)
            {
                memo = new byte[size];
            }
            else
            {
                Array.Clear(memo, 0, size);
            }

            return Match(0, 0, address);
        }

        // (トークンの位置, アドレスの位置) ごとに結果を覚える。`*` と `{}` の組み合わせで判定が指数的に増えないようにするため
        private bool Match(int t, int s, string address)
        {
            var width = address.Length + 1;
            var slot = t * width + s;
            if (memo[slot] != 0)
            {
                return memo[slot] == 1;
            }

            var matched = MatchUncached(t, s, address);
            memo[slot] = matched ? (byte)1 : (byte)2;
            return matched;
        }

        private bool MatchUncached(int t, int s, string address)
        {
            if (t == tokens.Length)
            {
                return s == address.Length;
            }

            var token = tokens[t];
            switch (token.Kind)
            {
                case TokenKind.Literal:
                    return s < address.Length && address[s] == token.Char && Match(t + 1, s + 1, address);

                case TokenKind.AnyChar:
                    return s < address.Length && address[s] != '/' && Match(t + 1, s + 1, address);

                case TokenKind.AnyRun:
                    // 0 文字から、`/` の手前までの各長さを試す
                    for (var end = s; ; end++)
                    {
                        if (Match(t + 1, end, address))
                        {
                            return true;
                        }

                        if (end >= address.Length || address[end] == '/')
                        {
                            return false;
                        }
                    }

                case TokenKind.Set:
                    return s < address.Length && address[s] != '/' && InSet(token, address[s]) && Match(t + 1, s + 1, address);

                case TokenKind.Alternatives:
                    foreach (var option in token.Options)
                    {
                        if (s + option.Length <= address.Length
                            && string.CompareOrdinal(address, s, option, 0, option.Length) == 0
                            && Match(t + 1, s + option.Length, address))
                        {
                            return true;
                        }
                    }

                    return false;
            }

            return false;
        }

        private static bool InSet(Token token, char c)
        {
            var inside = false;
            var ranges = token.Ranges;
            for (var i = 0; i + 1 < ranges.Length; i += 2)
            {
                if (c >= ranges[i] && c <= ranges[i + 1])
                {
                    inside = true;
                    break;
                }
            }

            return inside != token.Negated;
        }
    }
}
