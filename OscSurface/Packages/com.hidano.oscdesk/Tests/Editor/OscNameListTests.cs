using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    // 移植元のホスト(フォーク a8-oscdesk)の 3 つの正規化を、設定だけを変えた OscNameList で再現する(D-098)。
    // 固定候補つきの 1 本の一覧(100 件・256 文字)、固定候補つきの複数ソースの結合(100 件・128 文字)、
    // 固定候補なしの 1 本の一覧(64 件、長さは見ない)の 3 通り
    public sealed class OscNameListTests
    {
        private const string None = "(none)";

        private static OscNameListOptions SingleWithReserved()
        {
            return new OscNameListOptions { Reserved = new[] { None }, MaxCount = 100, MaxLength = 256, Label = "device" };
        }

        private static OscNameListOptions MultiSource()
        {
            return new OscNameListOptions { Reserved = new[] { None }, MaxCount = 100, MaxLength = 128, Label = "source item" };
        }

        private static OscNameListOptions NoReserved()
        {
            return new OscNameListOptions { MaxCount = 64 };
        }

        private static OscNameListIssue[] Issues(OscNameListResult result)
        {
            return result.Warnings.Select(warning => warning.Issue).ToArray();
        }

        // ---- 固定候補つきの 1 本の一覧 ----

        [Test]
        public void Empty_input_gives_an_empty_list_without_placeholder()
        {
            var result = OscNameList.Normalize(null, SingleWithReserved());

            // 「割り当てなし」は定義の静的な固定候補が表すので、0 件のプレースホルダは置かない
            Assert.That(result.Names, Is.Empty);
            Assert.That(result.Warnings, Is.Empty);
            Assert.That(result.SourceCount, Is.EqualTo(1));
            Assert.That(OscNameList.Normalize(new string[0], SingleWithReserved()).Names, Is.Empty);
        }

        [Test]
        public void Excludes_blank_control_reserved_and_ordinal_duplicates_keeping_order()
        {
            var result = OscNameList.Normalize(new[] { "  ", "Mic\u0001", "Mic", "(none)", "Mic", "mic", "Headset" }, SingleWithReserved());

            Assert.That(result.Names, Is.EqualTo(new[] { "Mic", "mic", "Headset" }));
            Assert.That(Issues(result), Is.EqualTo(new[]
            {
                OscNameListIssue.Blank, OscNameListIssue.ControlCharacter, OscNameListIssue.Reserved, OscNameListIssue.Duplicate,
            }));
            Assert.That(result.Warnings.Select(warning => warning.Index), Is.EqualTo(new[] { 0, 1, 3, 4 }));
            Assert.That(result.Warnings.All(warning => warning.SourceIndex == -1), Is.True);
            Assert.That(result.Warnings[0].Message, Is.EqualTo("deviceの0 番目を除きました: 空または空白のみです。"));
            Assert.That(result.Warnings[2].Message, Does.Contain("固定候補 \"(none)\""));
            Assert.That(result.Warnings[3].Value, Is.EqualTo("Mic"));
        }

        [Test]
        public void Warns_only_beyond_the_guides_and_still_keeps_the_names()
        {
            var hundred = new List<string>();
            for (var i = 0; i < 100; i++) hundred.Add("Mic " + i);
            var hundredOne = new List<string>(hundred) { "Mic 100" };

            Assert.That(OscNameList.Normalize(hundred, SingleWithReserved()).Warnings, Is.Empty);
            var over = OscNameList.Normalize(hundredOne, SingleWithReserved());
            Assert.That(over.Names, Has.Count.EqualTo(101));
            Assert.That(Issues(over), Is.EqualTo(new[] { OscNameListIssue.CountExceeded }));

            Assert.That(OscNameList.Normalize(new[] { new string('x', 256) }, SingleWithReserved()).Warnings, Is.Empty);
            var longName = OscNameList.Normalize(new[] { "a", new string('x', 257) }, SingleWithReserved());
            Assert.That(longName.Names, Has.Count.EqualTo(2));
            Assert.That(Issues(longName), Is.EqualTo(new[] { OscNameListIssue.LengthExceeded }));
            Assert.That(longName.Warnings[0].Index, Is.EqualTo(1));
        }

        [Test]
        public void SequenceEqual_requires_same_order_count_and_casing()
        {
            Assert.That(OscNameList.SequenceEqual(new[] { "A", "B" }, new[] { "A", "B" }), Is.True);
            Assert.That(OscNameList.SequenceEqual(new[] { "A", "B" }, new[] { "B", "A" }), Is.False);
            Assert.That(OscNameList.SequenceEqual(new[] { "A" }, new[] { "A", "B" }), Is.False);
            Assert.That(OscNameList.SequenceEqual(new[] { "A" }, new[] { "a" }), Is.False);
            // まだ送っていない(null)と空の一覧は違う。初回は空でも送る
            Assert.That(OscNameList.SequenceEqual(new string[0], null), Is.False);
            Assert.That(OscNameList.SequenceEqual(null, null), Is.True);
        }

        // ---- 固定候補つきの複数ソースの結合 ----

        [Test]
        public void Sources_are_joined_in_order_with_first_wins_and_report_positions()
        {
            var result = OscNameList.NormalizeSources(new IReadOnlyList<string>[]
            {
                new[] { "  ", "A\u0001", "A", "A", "(none)" },
                null,
                new[] { "B", "a", "B" },
            }, MultiSource());

            Assert.That(result.Names, Is.EqualTo(new[] { "A", "B", "a" }));
            Assert.That(result.SourceCount, Is.EqualTo(3));
            Assert.That(result.Warnings.Select(warning => (warning.Issue, warning.SourceIndex, warning.Index)), Is.EqualTo(new[]
            {
                (OscNameListIssue.Blank, 0, 0),
                (OscNameListIssue.ControlCharacter, 0, 1),
                (OscNameListIssue.Duplicate, 0, 3),
                (OscNameListIssue.Reserved, 0, 4),
                (OscNameListIssue.Duplicate, 2, 2),
            }));
            Assert.That(result.Warnings[0].Message, Is.EqualTo("source itemのソース 0 の 0 番目を除きました: 空または空白のみです。"));
        }

        [Test]
        public void Null_sources_and_null_input_give_empty_lists()
        {
            var none = OscNameList.NormalizeSources(null, MultiSource());
            Assert.That(none.Names, Is.Empty);
            Assert.That(none.SourceCount, Is.EqualTo(0));

            var result = OscNameList.NormalizeSources(new IReadOnlyList<string>[] { null }, MultiSource());
            Assert.That(result.Names, Is.Empty);
            Assert.That(result.SourceCount, Is.EqualTo(1));
            Assert.That(result.Warnings, Is.Empty);
        }

        [Test]
        public void Joined_list_warns_for_count_and_length_without_excluding()
        {
            var names = new List<string>();
            for (var i = 0; i < 101; i++) names.Add("Item" + i);
            names.Add(new string('x', 129));

            var result = OscNameList.NormalizeSources(new[] { (IReadOnlyList<string>)names }, MultiSource());

            Assert.That(result.Names, Has.Count.EqualTo(102));
            Assert.That(Issues(result), Is.EqualTo(new[] { OscNameListIssue.CountExceeded, OscNameListIssue.LengthExceeded }));
            Assert.That(result.Warnings[1].Index, Is.EqualTo(101));
        }

        // ---- 固定候補なしの 1 本の一覧 ----

        [Test]
        public void Without_reserved_names_only_blank_control_and_duplicates_are_excluded()
        {
            var result = OscNameList.Normalize(new[] { "Alpha", "", null, "  ", "B\tC", "Bravo", "Alpha", "(none)" }, NoReserved());

            // 固定候補を設定しなければ「(none)」も普通の名前
            Assert.That(result.Names, Is.EqualTo(new[] { "Alpha", "Bravo", "(none)" }));
            Assert.That(result.Warnings.Select(warning => (warning.Issue, warning.Index)), Is.EqualTo(new[]
            {
                (OscNameListIssue.Blank, 1),
                (OscNameListIssue.Blank, 2),
                (OscNameListIssue.Blank, 3),
                (OscNameListIssue.ControlCharacter, 4),
                (OscNameListIssue.Duplicate, 6),
            }));
            Assert.That(result.Warnings[4].Message, Is.EqualTo("名前の6 番目を除きました: \"Alpha\" が重複しています。"));
        }

        [Test]
        public void Without_reserved_names_more_than_the_guide_is_kept_with_a_warning()
        {
            var names = new List<string>();
            for (var i = 0; i < 65; i++) names.Add("n" + i);

            var result = OscNameList.Normalize(names, NoReserved());

            Assert.That(result.Names, Has.Count.EqualTo(65));
            Assert.That(Issues(result), Is.EqualTo(new[] { OscNameListIssue.CountExceeded }));
            Assert.That(result.Warnings[0].Message, Does.Contain("65 件").And.Contain("64 件"));
            // 長さの目安を 0 にすると長さは見ない
            Assert.That(OscNameList.Normalize(new[] { new string('x', 10000) }, NoReserved()).Warnings, Is.Empty);
        }

        // ---- ホストに無かった除外(送れない・見分けられない名前) ----

        [Test]
        public void Names_with_lone_surrogates_are_excluded_but_pairs_are_kept()
        {
            var result = OscNameList.Normalize(new[] { "Cam\uD83D", "\uDE00x", "Smile😀" });

            // 対になっていないサロゲートは厳密な UTF-8 にできず、混じると一覧ごと送れない
            Assert.That(result.Names, Is.EqualTo(new[] { "Smile😀" }));
            Assert.That(Issues(result), Is.EqualTo(new[] { OscNameListIssue.InvalidText, OscNameListIssue.InvalidText }));
        }

        [Test]
        public void Names_of_only_invisible_format_characters_are_blank()
        {
            var result = OscNameList.Normalize(new[] { "​", " ﻿ ", "Mic​", "👩‍💻" });

            // 書式文字だけの名前は空に見えるので除き、書式文字を含むだけの名前(ZWJ でつないだ絵文字など)は残す
            Assert.That(result.Names, Is.EqualTo(new[] { "Mic​", "👩‍💻" }));
            Assert.That(Issues(result), Is.EqualTo(new[] { OscNameListIssue.Blank, OscNameListIssue.Blank }));

            // 補助平面の書式文字(サロゲートの対)だけの名前も空白扱い
            var supplementary = OscNameList.Normalize(new[] { "\U000E0001", " \U000E0001​" });
            Assert.That(supplementary.Names, Is.Empty);
            Assert.That(Issues(supplementary), Is.EqualTo(new[] { OscNameListIssue.Blank, OscNameListIssue.Blank }));
        }

        [Test]
        public void Names_are_case_sensitive()
        {
            Assert.That(OscNameList.Normalize(new[] { "Bravo", "bravo" }, NoReserved()).Names, Has.Count.EqualTo(2));
        }

        // ---- 設定の既定 ----

        [Test]
        public void Default_options_have_no_reserved_names_and_no_guides()
        {
            var names = new List<string> { "(none)" };
            for (var i = 0; i < 1000; i++) names.Add("n" + i);

            var result = OscNameList.Normalize(names);

            Assert.That(result.Names, Has.Count.EqualTo(1001));
            Assert.That(result.Warnings, Is.Empty);
            var options = new OscNameListOptions { Reserved = null, Label = "" };
            Assert.That(options.Reserved, Is.Empty);
            Assert.That(options.Label, Is.EqualTo("名前"));
        }

        [Test]
        public void Null_entries_in_reserved_names_are_ignored()
        {
            var result = OscNameList.Normalize(new[] { "A" }, new OscNameListOptions { Reserved = new string[] { null } });
            Assert.That(result.Names, Is.EqualTo(new[] { "A" }));
        }
    }
}
