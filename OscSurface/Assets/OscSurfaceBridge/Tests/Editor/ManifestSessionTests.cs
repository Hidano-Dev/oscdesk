using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using NUnit.Framework;

namespace OscDesk.Staging.Tests
{
    // UnityEngine を参照しない(dotnet 経路: tests/csharp-core でも同じファイルを実行する)
    public sealed class ManifestSessionTests
    {
        private static readonly string[] None = new string[0];

        private sealed class E
        {
            public string Id = "";
            public string Address = "/a";
            public string Label = "A";
            public StagingEntryType Type = StagingEntryType.Float;
            public ManifestWidgetKind Widget = ManifestWidgetKind.Fader;
            public bool HasRange;
            public float RangeMin;
            public float RangeMax;
            public ManifestDefaultKind DefaultKind = ManifestDefaultKind.None;
            public int DefaultInt;
            public float DefaultFloat;
            public string DefaultString = "";
            public bool DefaultBool;
            public string Group = "";
            public bool HasOptions;
            public string[] Options = None;
            public string OptionsRef = "";
            public string Pattern = "";
            public bool Staged;
            public string[] AppliesTo = None;
            public string[] ExpandsTo = None;

            public ManifestSnapshotEntry Build()
            {
                return new ManifestSnapshotEntry(
                    Id, Address, Label, Type, Widget, HasRange, RangeMin, RangeMax,
                    DefaultKind, DefaultInt, DefaultFloat, DefaultString, DefaultBool,
                    Group, HasOptions, Options, OptionsRef, Pattern, Staged, AppliesTo, ExpandsTo);
            }
        }

        private static ManifestSnapshot Snap(string projectId, IReadOnlyList<ManifestSnapshotEntry> entries, IReadOnlyList<ManifestSnapshotOptionList> lists = null)
        {
            return new ManifestSnapshot(projectId, entries, lists ?? new ManifestSnapshotOptionList[0]);
        }

        private static ManifestSnapshot Snap(params E[] entries)
        {
            return Snap("proj", entries.Select(e => e.Build()).ToArray());
        }

        private static string Codes(IReadOnlyList<ManifestIssue> issues)
        {
            return string.Join(",", issues.Select(i => i.Code));
        }

        private static ManifestSession ReadySession(ManifestSnapshot snapshot)
        {
            var session = new ManifestSession("boot-1");
            var result = session.Initialize(snapshot);
            Assert.That(result.State, Is.EqualTo(ManifestSessionState.Ready), Codes(result.Issues));
            return session;
        }

        // ---------- 6.1 スナップショットと検証 ----------

        [Test]
        public void Snapshot_copies_lists_and_keeps_null_lists_and_elements()
        {
            var options = new List<string> { "x" };
            var entry = new E { Options = options.ToArray(), HasOptions = true }.Build();
            var entries = new List<ManifestSnapshotEntry> { entry, null };
            var snapshot = new ManifestSnapshot("p", entries, null);
            entries.Clear();

            Assert.That(snapshot.Entries.Count, Is.EqualTo(2));
            Assert.That(snapshot.Entries[1], Is.Null);
            Assert.That(snapshot.OptionLists, Is.Null);
        }

        [Test]
        public void EffectiveId_falls_back_to_address_when_id_is_empty()
        {
            Assert.That(new E { Id = "", Address = "/x" }.Build().EffectiveId, Is.EqualTo("/x"));
            Assert.That(new E { Id = null, Address = "/x" }.Build().EffectiveId, Is.EqualTo("/x"));
            Assert.That(new E { Id = "id1", Address = "/x" }.Build().EffectiveId, Is.EqualTo("id1"));
        }

        [Test]
        public void Validate_returns_empty_for_valid_snapshot()
        {
            var snapshot = Snap(
                new E { Address = "/a" },
                new E { Address = "/s", Type = StagingEntryType.String, Widget = ManifestWidgetKind.Select, OptionsRef = "k", Pattern = "^a" });
            var withList = Snap("p", snapshot.Entries, new[] { new ManifestSnapshotOptionList("k", new[] { "a", "b" }) });
            Assert.That(ManifestValidator.Validate(withList), Is.Empty);
        }

        private static IEnumerable<TestCaseData> ViolationCases()
        {
            yield return new TestCaseData("V1", null).SetName("V1_null_snapshot");
            yield return new TestCaseData("V2", new ManifestSnapshot(" ", new ManifestSnapshotEntry[0], new ManifestSnapshotOptionList[0])).SetName("V2_blank_project");
            yield return new TestCaseData("V3", new ManifestSnapshot("p", null, new ManifestSnapshotOptionList[0])).SetName("V3_null_entries");
            yield return new TestCaseData("V4", new ManifestSnapshot("p", new ManifestSnapshotEntry[0], null)).SetName("V4_null_option_lists");
            yield return new TestCaseData("V5", Snap("p", new ManifestSnapshotEntry[0], new ManifestSnapshotOptionList[] { null })).SetName("V5_null_list");
            yield return new TestCaseData("V5", Snap("p", new ManifestSnapshotEntry[0], new[] { new ManifestSnapshotOptionList("", new[] { "a" }) })).SetName("V5_empty_key");
            yield return new TestCaseData("V6", Snap("p", new ManifestSnapshotEntry[0], new[] { new ManifestSnapshotOptionList("k", new[] { "a" }), new ManifestSnapshotOptionList("k", new[] { "b" }) })).SetName("V6_duplicate_key");
            yield return new TestCaseData("V7", Snap("p", new ManifestSnapshotEntry[0], new[] { new ManifestSnapshotOptionList("k", new string[] { null }) })).SetName("V7_null_value");
            yield return new TestCaseData("V7", Snap("p", new ManifestSnapshotEntry[0], new[] { new ManifestSnapshotOptionList("k", null) })).SetName("V7_null_values_list");
            yield return new TestCaseData("V8", Snap("p", new ManifestSnapshotEntry[] { null })).SetName("V8_null_entry");
            yield return new TestCaseData("V8", Snap(new E { Address = "  " })).SetName("V8_blank_address");
            yield return new TestCaseData("V9", Snap(new E { Widget = (ManifestWidgetKind)99 })).SetName("V9_widget");
            yield return new TestCaseData("V9", Snap(new E { Type = (StagingEntryType)99 })).SetName("V9_type");
            yield return new TestCaseData("V9", Snap(new E { DefaultKind = (ManifestDefaultKind)99 })).SetName("V9_default_kind");
            yield return new TestCaseData("V10", Snap(new E { Widget = ManifestWidgetKind.Input, Type = StagingEntryType.Bool })).SetName("V10_input_type");
            yield return new TestCaseData("V11", Snap(new E { Widget = ManifestWidgetKind.Select, Type = StagingEntryType.Int, HasOptions = true, Options = new[] { "a" } })).SetName("V11_select_type");
            yield return new TestCaseData("V12", Snap(new E { Widget = ManifestWidgetKind.Select, Type = StagingEntryType.String })).SetName("V12_select_neither");
            yield return new TestCaseData("V12", Snap("p", new[] { new E { Widget = ManifestWidgetKind.Select, Type = StagingEntryType.String, HasOptions = true, Options = new[] { "a" }, OptionsRef = "k" }.Build() }, new[] { new ManifestSnapshotOptionList("k", new[] { "a" }) })).SetName("V12_select_both");
            yield return new TestCaseData("V13", Snap(new E { HasOptions = true, Options = new string[] { null } })).SetName("V13_null_option");
            yield return new TestCaseData("V13", Snap(new E { HasOptions = true, Options = null })).SetName("V13_null_options");
            yield return new TestCaseData("V14", Snap(new E { OptionsRef = "missing" })).SetName("V14_missing_ref");
            yield return new TestCaseData("V15", Snap(new E { Type = StagingEntryType.Int, Pattern = "a" })).SetName("V15_pattern_type");
            yield return new TestCaseData("V16", Snap(new E { Type = StagingEntryType.String, Pattern = "[bad" })).SetName("V16_bad_pattern");
            yield return new TestCaseData("V17", Snap(new E { Id = "  " })).SetName("V17_blank_id");
        }

        [TestCaseSource(nameof(ViolationCases))]
        public void Validate_reports_each_violation(string code, ManifestSnapshot snapshot)
        {
            Assert.That(ManifestValidator.Validate(snapshot).Select(i => i.Code), Does.Contain(code));
        }

        [Test]
        public void Validate_collects_multiple_issues_in_legacy_order()
        {
            var snapshot = new ManifestSnapshot(
                "",
                new[] { new E { Id = " ", Widget = ManifestWidgetKind.Select, Type = StagingEntryType.Int }.Build() },
                new ManifestSnapshotOptionList[0]);
            Assert.That(Codes(ManifestValidator.Validate(snapshot)), Is.EqualTo("V2,V11,V12,V17"));
        }

        [Test]
        public void Size_constants_match_wire_limits()
        {
            Assert.That(ManifestLimits.WarningBytes, Is.EqualTo(56 * 1024));
            Assert.That(ManifestLimits.PracticalLimitBytes, Is.EqualTo(60 * 1024));
        }

        // ---------- 6.2 JSON の組み立て(移設前の出力を固定文字列で断言) ----------

        private static ManifestSnapshot GoldenSnapshot()
        {
            var entries = new[]
            {
                new E { Address = "/gain", Label = "Gain \"x\"", Type = StagingEntryType.Float, Widget = ManifestWidgetKind.Fader, HasRange = true, RangeMin = 0f, RangeMax = 1.5f, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 0.25f, Group = "Audio", Staged = true }.Build(),
                new E { Address = "/mode", Label = "Mode", Type = StagingEntryType.String, Widget = ManifestWidgetKind.Select, DefaultKind = ManifestDefaultKind.String, DefaultString = "b", HasOptions = true, Options = new[] { "a", "b" } }.Build(),
                new E { Address = "/dev", Label = "Dev", Type = StagingEntryType.String, Widget = ManifestWidgetKind.Select, OptionsRef = "devices", Pattern = "^d" }.Build(),
                new E { Address = "/apply", Label = "Apply", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button, AppliesTo = new[] { "/gain" } }.Build(),
                new E { Address = "/on", Label = "On", Type = StagingEntryType.Bool, Widget = ManifestWidgetKind.Toggle, DefaultKind = ManifestDefaultKind.Bool, DefaultBool = true, Id = "on-id" }.Build(),
            };
            return Snap("proj", entries, new[]
            {
                new ManifestSnapshotOptionList("devices", new[] { "cam1", "cam2" }),
                new ManifestSnapshotOptionList("empty", new string[0]),
            });
        }

        private const string GoldenBody =
            "\"entries\":[" +
            "{\"address\":\"/gain\",\"label\":\"Gain \\\"x\\\"\",\"type\":\"f\",\"widget\":\"fader\",\"range\":[0,1.5],\"default\":0.25,\"group\":\"Audio\",\"staged\":true}," +
            "{\"address\":\"/mode\",\"label\":\"Mode\",\"type\":\"s\",\"widget\":\"select\",\"default\":\"b\",\"options\":[\"a\",\"b\"]}," +
            "{\"address\":\"/dev\",\"label\":\"Dev\",\"type\":\"s\",\"widget\":\"select\",\"optionsRef\":\"devices\",\"pattern\":\"^d\"}," +
            "{\"address\":\"/apply\",\"label\":\"Apply\",\"type\":\"i\",\"widget\":\"button\",\"appliesTo\":[\"/gain\"]}," +
            "{\"address\":\"/on\",\"label\":\"On\",\"type\":\"bool\",\"widget\":\"toggle\",\"default\":1}" +
            "],\"optionLists\":{\"devices\": [\"cam1\",\"cam2\"],\"empty\": []}}";

        [Test]
        public void WriteManifest_matches_legacy_output_except_origin_fields()
        {
            var session = ReadySession(GoldenSnapshot());
            Assert.That(session.TryBuildManifestJson(out var json, out var bytes, out _), Is.True);

            const string legacyPrefix = "{\"version\":1,\"projectId\":\"proj\",";
            const string origin = "\"bootId\":\"boot-1\",\"structureGeneration\":1,";
            Assert.That(json, Is.EqualTo(legacyPrefix + origin + GoldenBody));
            Assert.That(bytes, Is.EqualTo(Encoding.UTF8.GetByteCount(json)));
            // 識別子は出力しない
            Assert.That(json, Does.Not.Contain("on-id"));
        }

        [Test]
        public void WriteManifest_omits_optional_keys_and_option_lists_when_absent()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Label = "A" }));
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Is.EqualTo(
                "{\"version\":1,\"projectId\":\"proj\",\"bootId\":\"boot-1\",\"structureGeneration\":1," +
                "\"entries\":[{\"address\":\"/a\",\"label\":\"A\",\"type\":\"f\",\"widget\":\"fader\"}]}"));
        }

        [Test]
        public void WriteManifest_carries_current_value_as_default()
        {
            var session = ReadySession(Snap(new E { Address = "/a", DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 0.5f }));
            session.Handle("/a", StagingValue.FromFloat(0.75f));
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Does.Contain("\"default\":0.75"));
        }

        [Test]
        public void WriteManifest_origin_fields_follow_project_id()
        {
            var session = ReadySession(Snap(new E()));
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json.IndexOf("\"projectId\":\"proj\",\"bootId\":\"boot-1\",\"structureGeneration\":1,\"entries\"", StringComparison.Ordinal), Is.GreaterThan(0));
        }

        [Test]
        public void WriteStats_appends_origin_to_legacy_shape()
        {
            var session = ReadySession(Snap(new E()));
            Assert.That(
                session.BuildStatsJson(3, 1, "2026-01-01T00:00:00.000Z"),
                Is.EqualTo("{\"received\":3,\"parseErrors\":1,\"lastReceivedAt\":\"2026-01-01T00:00:00.000Z\",\"bootId\":\"boot-1\",\"structureGeneration\":1}"));
        }

        [Test]
        public void Utf8ByteCount_counts_bytes_not_chars()
        {
            Assert.That(ManifestJsonWriter.Utf8ByteCount("あa"), Is.EqualTo(4));
        }

        [Test]
        public void Same_inputs_produce_identical_bytes()
        {
            var a = ReadySession(GoldenSnapshot());
            var b = ReadySession(GoldenSnapshot());
            a.TryBuildManifestJson(out var ja, out _, out _);
            b.TryBuildManifestJson(out var jb, out _, out _);
            Assert.That(ja, Is.EqualTo(jb));
        }

        [Test]
        public void Origin_rejects_invalid_values()
        {
            Assert.Throws<ArgumentException>(() => new ManifestOrigin("", 1));
            Assert.Throws<ArgumentException>(() => new ManifestOrigin(new string('x', 65), 1));
            Assert.Throws<ArgumentOutOfRangeException>(() => new ManifestOrigin("b", 0));
            Assert.That(new ManifestOrigin(new string('x', 64), int.MaxValue).StructureGeneration, Is.EqualTo(int.MaxValue));
        }

        // ---------- 6.3 セッション ----------

        [Test]
        public void New_session_is_uninitialized_and_cannot_build()
        {
            var session = new ManifestSession("boot-1");
            Assert.That(session.State, Is.EqualTo(ManifestSessionState.Uninitialized));
            Assert.That(session.TryBuildManifestJson(out var json, out var bytes, out var issues), Is.False);
            Assert.That(json, Is.Null);
            Assert.That(bytes, Is.EqualTo(-1));
            Assert.That(issues, Is.Not.Empty);
            Assert.That(session.ProjectId, Is.Null);
        }

        [Test]
        public void Initialize_valid_manifest_becomes_ready_with_generation_1_and_records_project_and_ids()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Id = "ida" }, new E { Address = "/b" }));
            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(1));
            Assert.That(session.Origin.BootId, Is.EqualTo("boot-1"));
            Assert.That(session.ProjectId, Is.EqualTo("proj"));
            Assert.That(session.AddressToId["/a"], Is.EqualTo("ida"));
            Assert.That(session.AddressToId["/b"], Is.EqualTo("/b"));
        }

        [Test]
        public void Initialize_twice_throws()
        {
            var session = ReadySession(Snap(new E()));
            Assert.Throws<InvalidOperationException>(() => session.Initialize(Snap(new E())));
        }

        [Test]
        public void Initialize_invalid_manifest_gives_NoValidManifest_but_keeps_handling()
        {
            var session = new ManifestSession("boot-1");
            var result = session.Initialize(Snap("", new ManifestSnapshotEntry[0]));
            Assert.That(result.State, Is.EqualTo(ManifestSessionState.NoValidManifest));
            Assert.That(Codes(result.Issues), Is.EqualTo("V2"));
            Assert.That(session.ProjectId, Is.Null);
            Assert.That(session.TryBuildManifestJson(out _, out _, out _), Is.False);
            Assert.That(() => session.Handle("/a", StagingValue.FromInt(1)), Throws.Nothing);
            Assert.That(session.BuildStatsJson(1, 0, "t"), Does.Contain("\"bootId\":\"boot-1\""));
        }

        [Test]
        public void Initialize_null_snapshot_reports_V1()
        {
            var result = new ManifestSession("boot-1").Initialize(null);
            Assert.That(result.State, Is.EqualTo(ManifestSessionState.NoValidManifest));
            Assert.That(Codes(result.Issues), Is.EqualTo("V1"));
        }

        [Test]
        public void Initialize_with_staging_compile_error_is_Suppressed_but_records_project_id()
        {
            var session = new ManifestSession("boot-1");
            var result = session.Initialize(Snap(
                new E { Address = "/s", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Fader, AppliesTo = new[] { "/a" } },
                new E { Address = "/a", Type = StagingEntryType.Int }));
            Assert.That(result.State, Is.EqualTo(ManifestSessionState.Suppressed));
            Assert.That(result.Issues.Select(i => i.Code), Does.Contain("S1"));
            Assert.That(session.ProjectId, Is.EqualTo("proj"));
            Assert.That(session.AddressToId.ContainsKey("/s"), Is.True);
            Assert.That(session.TryBuildManifestJson(out _, out _, out var issues), Is.False);
            Assert.That(issues, Is.Not.Empty);
        }

        [Test]
        public void Initialize_reports_addresses_whose_default_could_not_be_seeded()
        {
            var session = new ManifestSession("boot-1");
            var result = session.Initialize(Snap(
                new E { Address = "/ok", Type = StagingEntryType.Float, DefaultKind = ManifestDefaultKind.Int, DefaultInt = 2 },
                new E { Address = "/bad", Type = StagingEntryType.Int, DefaultKind = ManifestDefaultKind.String, DefaultString = "x" },
                new E { Address = "/badbool", Type = StagingEntryType.Int, DefaultKind = ManifestDefaultKind.Bool, DefaultBool = true },
                new E { Address = "/bool", Type = StagingEntryType.Bool, DefaultKind = ManifestDefaultKind.Bool, DefaultBool = true }));
            Assert.That(result.State, Is.EqualTo(ManifestSessionState.Ready));
            Assert.That(result.UnseededAddresses, Is.EquivalentTo(new[] { "/bad", "/badbool" }));
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Does.Contain("\"default\":2"));
        }

        [Test]
        public void Repeated_builds_do_not_advance_generation()
        {
            var session = ReadySession(Snap(new E()));
            for (var i = 0; i < 3; i++)
            {
                Assert.That(session.TryBuildManifestJson(out var json, out _, out _), Is.True);
                Assert.That(json, Does.Contain("\"structureGeneration\":1,"));
                session.BuildStatsJson(i, 0, "t");
            }

            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(1));
        }

        [Test]
        public void Handle_advances_state_version_only_when_recorded()
        {
            var session = ReadySession(Snap(new E { Address = "/a" }));
            var before = session.StateVersion;
            session.Handle("/unknown", StagingValue.FromFloat(1f));
            Assert.That(session.StateVersion, Is.EqualTo(before));
            Assert.That(session.Handle("/a", StagingValue.FromFloat(1f)).Recorded, Is.True);
            Assert.That(session.StateVersion, Is.EqualTo(before + 1));
        }

        [Test]
        public void Constructor_rejects_invalid_boot_id()
        {
            Assert.Throws<ArgumentException>(() => new ManifestSession(""));
        }

        // ---------- 6.4 F-6 ----------

        private static ManifestSnapshot WithList(string key, params string[] values)
        {
            return Snap("proj",
                new[] { new E { Address = "/dev", Type = StagingEntryType.String, Widget = ManifestWidgetKind.Select, OptionsRef = key }.Build() },
                new[] { new ManifestSnapshotOptionList(key, values) });
        }

        [Test]
        public void PublishContentUpdate_option_list_change_advances_generation_by_one()
        {
            var session = ReadySession(WithList("devices", "a"));
            var result = session.PublishContentUpdate(WithList("devices", "a", "b"));
            Assert.That(result.Succeeded, Is.True, result.Failure.ToString());
            Assert.That(result.GenerationAdvanced, Is.True);
            Assert.That(result.StructureGeneration, Is.EqualTo(2));
            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(2));
            session.TryBuildManifestJson(out var json, out var bytes, out _);
            Assert.That(json, Does.Contain("\"devices\": [\"a\",\"b\"]"));
            Assert.That(json, Does.Contain("\"structureGeneration\":2,"));
            Assert.That(result.PayloadBytes, Is.EqualTo(bytes));
        }

        [Test]
        public void PublishContentUpdate_advances_state_version()
        {
            var session = ReadySession(WithList("devices", "a"));
            var before = session.StateVersion;
            session.PublishContentUpdate(WithList("devices", "b"));
            Assert.That(session.StateVersion, Is.EqualTo(before + 1));
        }

        [Test]
        public void PublishContentUpdate_without_diff_succeeds_without_advancing()
        {
            var session = ReadySession(WithList("devices", "a"));
            var before = session.StateVersion;
            var result = session.PublishContentUpdate(WithList("devices", "a"));
            Assert.That(result.Succeeded, Is.True);
            Assert.That(result.GenerationAdvanced, Is.False);
            Assert.That(result.StructureGeneration, Is.EqualTo(1));
            Assert.That(session.StateVersion, Is.EqualTo(before));
        }

        [Test]
        public void PublishContentUpdate_accepts_display_fields_and_non_button_widget_change()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Label = "A", Widget = ManifestWidgetKind.Fader, Type = StagingEntryType.Float }));
            var result = session.PublishContentUpdate(Snap(new E { Address = "/a", Label = "B", Widget = ManifestWidgetKind.Input, Type = StagingEntryType.Float, HasRange = true, RangeMin = 0, RangeMax = 2, Group = "g" }));
            Assert.That(result.Succeeded, Is.True, result.Failure.ToString());
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Does.Contain("\"label\":\"B\"").And.Contain("\"widget\":\"input\"").And.Contain("\"group\":\"g\""));
        }

        [Test]
        public void PublishContentUpdate_ignores_range_difference_when_range_is_not_emitted()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Widget = ManifestWidgetKind.Input, Type = StagingEntryType.Float, HasRange = false, RangeMin = 0, RangeMax = 1 }));
            var result = session.PublishContentUpdate(Snap(new E { Address = "/a", Widget = ManifestWidgetKind.Input, Type = StagingEntryType.Float, HasRange = false, RangeMin = 5, RangeMax = 9 }));
            Assert.That(result.Succeeded, Is.True);
            Assert.That(result.GenerationAdvanced, Is.False);
        }

        [Test]
        public void PublishContentUpdate_keeps_current_values_across_widget_change()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Widget = ManifestWidgetKind.Fader }));
            session.Handle("/a", StagingValue.FromFloat(0.5f));
            session.PublishContentUpdate(Snap(new E { Address = "/a", Widget = ManifestWidgetKind.Text }));
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Does.Contain("\"default\":0.5"));
        }

        private static IEnumerable<TestCaseData> StructuralCases()
        {
            var baseEntry = new Func<E>(() => new E { Address = "/a", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Fader });
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Snap(baseEntry(), new E { Address = "/b" }))).SetName("entry_added");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Snap())).SetName("entry_removed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Snap(new E { Address = "/z", Type = StagingEntryType.Int }))).SetName("address_changed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.Id = "other"; return Snap(e); })).SetName("id_changed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.Type = StagingEntryType.Float; return Snap(e); })).SetName("type_changed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.Staged = true; return Snap(e); })).SetName("staged_changed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.Widget = ManifestWidgetKind.Button; return Snap(e); })).SetName("to_button");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.ExpandsTo = new[] { "/a" }; return Snap(e); })).SetName("expandsTo_changed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.DefaultKind = ManifestDefaultKind.Int; e.DefaultInt = 5; return Snap(e); })).SetName("default_changed");
        }

        [TestCaseSource(nameof(StructuralCases))]
        public void PublishContentUpdate_rejects_structural_change_and_keeps_state(Func<ManifestSnapshot> candidate)
        {
            var session = ReadySession(Snap(new E { Address = "/a", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Fader }));
            session.TryBuildManifestJson(out var before, out _, out _);
            var version = session.StateVersion;

            var result = session.PublishContentUpdate(candidate());

            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.StructuralChangeRequiresReinject));
            Assert.That(result.GenerationAdvanced, Is.False);
            Assert.That(result.Issues, Is.Not.Empty);
            session.TryBuildManifestJson(out var after, out _, out _);
            Assert.That(after, Is.EqualTo(before));
            Assert.That(session.StateVersion, Is.EqualTo(version));
        }

        [Test]
        public void PublishContentUpdate_rejects_button_to_non_button_and_appliesTo_change()
        {
            var original = Snap(
                new E { Address = "/v", Type = StagingEntryType.Int, Staged = true },
                new E { Address = "/b", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button, AppliesTo = new[] { "/v" } });
            var session = ReadySession(original);
            var toToggle = Snap(
                new E { Address = "/v", Type = StagingEntryType.Int, Staged = true },
                new E { Address = "/b", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Toggle, AppliesTo = new[] { "/v" } });
            Assert.That(session.PublishContentUpdate(toToggle).Failure, Is.EqualTo(ManifestChangeFailure.StructuralChangeRequiresReinject));
            var noApplies = Snap(
                new E { Address = "/v", Type = StagingEntryType.Int, Staged = true },
                new E { Address = "/b", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button });
            Assert.That(session.PublishContentUpdate(noApplies).Failure, Is.EqualTo(ManifestChangeFailure.StructuralChangeRequiresReinject));
        }

        [Test]
        public void PublishContentUpdate_reports_default_change_reason()
        {
            var session = ReadySession(Snap(new E { Address = "/a", DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 1f }));
            var result = session.PublishContentUpdate(Snap(new E { Address = "/a", DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 2f }));
            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.StructuralChangeRequiresReinject));
            Assert.That(result.Issues.Single().Message, Does.Contain("current value").And.Contain("F-7"));
        }

        [Test]
        public void PublishContentUpdate_failure_order()
        {
            Assert.That(new ManifestSession("b").PublishContentUpdate(Snap(new E())).Failure, Is.EqualTo(ManifestChangeFailure.NotInitialized));

            var suppressed = new ManifestSession("b");
            suppressed.Initialize(Snap(new E { Address = "/s", Type = StagingEntryType.Int, AppliesTo = new[] { "/a" } }));
            Assert.That(suppressed.State, Is.EqualTo(ManifestSessionState.Suppressed));
            Assert.That(suppressed.PublishContentUpdate(null).Failure, Is.EqualTo(ManifestChangeFailure.Suppressed));

            var ready = ReadySession(Snap(new E()));
            Assert.That(ready.PublishContentUpdate(null).Failure, Is.EqualTo(ManifestChangeFailure.InvalidManifest));

            var none = new ManifestSession("b");
            none.Initialize(Snap("", new ManifestSnapshotEntry[0]));
            Assert.That(none.PublishContentUpdate(Snap(new E())).Failure, Is.EqualTo(ManifestChangeFailure.StructuralChangeRequiresReinject));
            Assert.That(none.PublishContentUpdate(Snap("", new ManifestSnapshotEntry[0])).Failure, Is.EqualTo(ManifestChangeFailure.InvalidManifest));

            Assert.That(ready.PublishContentUpdate(Snap("other", new[] { new E().Build() })).Failure, Is.EqualTo(ManifestChangeFailure.ProjectIdMismatch));
        }

        [Test]
        public void PublishContentUpdate_validates_changed_entry()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Type = StagingEntryType.Float }));
            var result = session.PublishContentUpdate(Snap(new E { Address = "/a", Type = StagingEntryType.Float, Widget = ManifestWidgetKind.Select }));
            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.InvalidManifest));
            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(1));
        }

        [Test]
        public void PublishContentUpdate_rejects_payload_over_limit_and_keeps_state()
        {
            var session = ReadySession(WithList("devices", "a"));
            session.TryBuildManifestJson(out var before, out _, out _);
            var huge = new string('x', ManifestLimits.PracticalLimitBytes);
            var result = session.PublishContentUpdate(WithList("devices", huge));
            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.PayloadTooLarge));
            Assert.That(result.PayloadBytes, Is.GreaterThan(ManifestLimits.PracticalLimitBytes));
            Assert.That(result.GenerationAdvanced, Is.False);
            session.TryBuildManifestJson(out var after, out _, out _);
            Assert.That(after, Is.EqualTo(before));
        }

        [Test]
        public void PublishContentUpdate_accepts_payload_exactly_at_limit()
        {
            var session = ReadySession(WithList("devices", "a"));
            var overhead = ManifestJsonWriter.Utf8ByteCount(ManifestJsonWriter.WriteManifest(WithList("devices", ""), null, new ManifestOrigin("boot-1", 2)));
            var result = session.PublishContentUpdate(WithList("devices", new string('x', ManifestLimits.PracticalLimitBytes - overhead)));
            Assert.That(result.Succeeded, Is.True, result.Failure.ToString());
            Assert.That(result.PayloadBytes, Is.EqualTo(ManifestLimits.PracticalLimitBytes));
        }

        // ---------- 9.1 / 9.2 / 9.3 F-8 事前検査と確定 ----------

        private static string Fingerprint(ManifestSession session, params string[] addresses)
        {
            session.TryBuildManifestJson(out var json, out _, out _);
            var values = string.Join(
                ";",
                addresses.Select(a => a + "=" + (session.TryGetCurrentValue(a, out var v) ? v.ToJsonLiteral() : "-")));
            return json + "|" + values + "|g" + session.Origin.StructureGeneration + "|" + string.Join(
                ",", session.AddressToId.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + ">" + p.Value));
        }

        private static E Fl(string address, string id = "", float? def = null)
        {
            return new E
            {
                Address = address,
                Id = id,
                Type = StagingEntryType.Float,
                DefaultKind = def.HasValue ? ManifestDefaultKind.Float : ManifestDefaultKind.None,
                DefaultFloat = def ?? 0f,
            };
        }

        private static ManifestSnapshot Rows(params E[] entries)
        {
            return Snap(entries);
        }

        [Test]
        public void Precheck_before_initialize_is_NotInitialized()
        {
            var candidate = new ManifestSession("boot-1").Precheck(Rows(Fl("/a")));
            Assert.That(candidate.Passed, Is.False);
            Assert.That(candidate.Result.Failure, Is.EqualTo(ManifestChangeFailure.NotInitialized));
        }

        [Test]
        public void Precheck_distinguishes_each_failure_reason()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f)));

            Assert.That(session.Precheck(null).Result.Failure, Is.EqualTo(ManifestChangeFailure.InvalidManifest));
            Assert.That(session.Precheck(Snap("other", new[] { Fl("/a", "ida").Build() })).Result.Failure,
                Is.EqualTo(ManifestChangeFailure.ProjectIdMismatch));
            Assert.That(session.Precheck(Rows(Fl("/a", "idb"))).Result.Failure,
                Is.EqualTo(ManifestChangeFailure.AddressReused));
            Assert.That(session.Precheck(Rows(Fl("/x", "same"), Fl("/x", "diff"))).Result.Failure,
                Is.EqualTo(ManifestChangeFailure.AddressReused));

            var badStaging = new E { Address = "/t", Type = StagingEntryType.Int, AppliesTo = new[] { "/a" } };
            var compile = session.Precheck(Rows(Fl("/a", "ida"), badStaging));
            Assert.That(compile.Result.Failure, Is.EqualTo(ManifestChangeFailure.StagingCompileFailed));
            Assert.That(compile.Result.Issues.Select(i => i.Code), Does.Contain("S1"));

            var big = session.Precheck(Rows(new E { Address = "/a", Id = "ida", Type = StagingEntryType.String, Label = new string('x', ManifestLimits.PracticalLimitBytes) }));
            Assert.That(big.Result.Failure, Is.EqualTo(ManifestChangeFailure.PayloadTooLarge));
            Assert.That(big.PayloadBytes, Is.GreaterThan(ManifestLimits.PracticalLimitBytes));
        }

        [Test]
        public void Precheck_failure_order_validation_before_project_before_reuse_before_compile()
        {
            var session = ReadySession(Rows(Fl("/a", "ida")));
            // projectId 違いと再利用が同時なら projectId が先
            var both = Snap("other", new[] { Fl("/a", "idb").Build() });
            Assert.That(session.Precheck(both).Result.Failure, Is.EqualTo(ManifestChangeFailure.ProjectIdMismatch));
            // 再利用とコンパイルエラーが同時なら再利用が先
            var reuseAndCompile = Rows(Fl("/a", "idb"), new E { Address = "/t", Type = StagingEntryType.Int, AppliesTo = new[] { "/a" } });
            Assert.That(session.Precheck(reuseAndCompile).Result.Failure, Is.EqualTo(ManifestChangeFailure.AddressReused));
            // 検証エラーが最優先
            var invalid = Snap("other", new[] { new E { Address = " " }.Build() });
            Assert.That(session.Precheck(invalid).Result.Failure, Is.EqualTo(ManifestChangeFailure.InvalidManifest));
        }

        [Test]
        public void Precheck_has_no_side_effects_on_success_or_failure()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f), Fl("/b", "idb", 2f)));
            session.Handle("/a", StagingValue.FromFloat(5f));
            var before = Fingerprint(session, "/a", "/b", "/c");
            var version = session.StateVersion;

            Assert.That(session.Precheck(Rows(Fl("/a", "ida", 9f), Fl("/c", "idc", 3f))).Passed, Is.True);
            Assert.That(session.Precheck(Rows(Fl("/a", "other"))).Passed, Is.False);
            Assert.That(session.Precheck(null).Passed, Is.False);

            Assert.That(Fingerprint(session, "/a", "/b", "/c"), Is.EqualTo(before));
            Assert.That(session.StateVersion, Is.EqualTo(version));
            Assert.That(session.State, Is.EqualTo(ManifestSessionState.Ready));
        }

        [Test]
        public void Precheck_skips_project_check_when_there_is_no_valid_manifest()
        {
            var session = new ManifestSession("boot-1");
            session.Initialize(Snap("", new ManifestSnapshotEntry[0]));
            var candidate = session.Precheck(Rows(Fl("/a")));
            Assert.That(candidate.Passed, Is.True, candidate.Result.Failure.ToString());
        }

        [Test]
        public void Precheck_carries_over_only_entries_matching_id_address_and_type()
        {
            var session = ReadySession(Rows(
                Fl("/keep", "k", 1f), Fl("/typed", "t", 1f), Fl("/renamed", "old", 1f), Fl("/gone", "g", 1f)));
            foreach (var a in new[] { "/keep", "/typed", "/renamed", "/gone" })
            {
                session.Handle(a, StagingValue.FromFloat(7f));
            }

            var next = Rows(
                Fl("/keep", "k", 0.5f),
                new E { Address = "/typed", Id = "t", Type = StagingEntryType.Int, DefaultKind = ManifestDefaultKind.Int, DefaultInt = 3 },
                Fl("/renamed", "old", 0.5f),
                Fl("/fresh", "f", 0.25f));
            var candidate = session.Precheck(next);
            Assert.That(candidate.Passed, Is.True, candidate.Result.Failure.ToString());
            var result = session.Commit(candidate);
            Assert.That(result.Succeeded, Is.True);

            session.TryGetCurrentValue("/keep", out var keep);
            session.TryGetCurrentValue("/typed", out var typed);
            session.TryGetCurrentValue("/fresh", out var fresh);
            Assert.That(keep, Is.EqualTo(StagingValue.FromFloat(7f)));
            Assert.That(typed, Is.EqualTo(StagingValue.FromInt(3)));
            Assert.That(fresh, Is.EqualTo(StagingValue.FromFloat(0.25f)));
            Assert.That(session.TryGetCurrentValue("/gone", out _), Is.False);
        }

        [Test]
        public void Precheck_does_not_seed_default_that_does_not_fit_type_and_reports_it()
        {
            var session = ReadySession(Rows(Fl("/a")));
            var candidate = session.Precheck(Rows(
                Fl("/a"),
                new E { Address = "/bad", Type = StagingEntryType.Int, DefaultKind = ManifestDefaultKind.String, DefaultString = "x" }));
            Assert.That(candidate.Passed, Is.True);
            Assert.That(candidate.UnseededAddresses, Is.EquivalentTo(new[] { "/bad" }));
            session.Commit(candidate);
            Assert.That(session.TryGetCurrentValue("/bad", out _), Is.False);
        }

        [Test]
        public void Precheck_measures_bytes_of_the_candidate_with_generation_plus_one()
        {
            var session = ReadySession(Rows(Fl("/a", "", 1f)));
            var candidate = session.Precheck(Rows(Fl("/a", "", 1f), Fl("/b", "", 2f)));
            Assert.That(candidate.Passed, Is.True);
            var expected = ManifestJsonWriter.Utf8ByteCount(
                ManifestJsonWriter.WriteManifest(
                    Rows(Fl("/a", "", 1f), Fl("/b", "", 2f)),
                    null,
                    new ManifestOrigin("boot-1", 2)));
            // default を含むため null engine より大きい。実際の確定後の JSON と一致することを見る
            Assert.That(candidate.PayloadBytes, Is.GreaterThan(expected));
            var committed = session.Commit(candidate);
            session.TryBuildManifestJson(out var json, out var bytes, out _);
            Assert.That(committed.PayloadBytes, Is.EqualTo(candidate.PayloadBytes));
            Assert.That(bytes, Is.EqualTo(candidate.PayloadBytes));
            Assert.That(json, Does.Contain("\"structureGeneration\":2,"));
            Assert.That(candidate.StateVersion, Is.LessThan(session.StateVersion));
        }

        [Test]
        public void Commit_swaps_plan_snapshot_map_and_advances_generation_and_version_once()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f)));
            var version = session.StateVersion;
            var result = session.Commit(session.Precheck(Rows(Fl("/b", "idb", 2f))));

            Assert.That(result.Succeeded, Is.True);
            Assert.That(result.GenerationAdvanced, Is.True);
            Assert.That(result.StructureGeneration, Is.EqualTo(2));
            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(2));
            Assert.That(session.StateVersion, Is.EqualTo(version + 1));
            Assert.That(session.TryGetCurrentValue("/a", out _), Is.False);
            Assert.That(session.TryGetCurrentValue("/b", out _), Is.True);
            // 消えた対も覚え続ける
            Assert.That(session.AddressToId["/a"], Is.EqualTo("ida"));
            Assert.That(session.AddressToId["/b"], Is.EqualTo("idb"));
        }

        [Test]
        public void Commit_can_be_repeated_any_number_of_times()
        {
            var session = ReadySession(Rows(Fl("/r0", "r0")));
            for (var i = 1; i <= 5; i++)
            {
                var result = session.Commit(session.Precheck(Rows(Fl("/r" + i, "r" + i))));
                Assert.That(result.Succeeded, Is.True);
                Assert.That(result.StructureGeneration, Is.EqualTo(i + 1));
            }
        }

        [Test]
        public void Commit_of_a_failed_candidate_returns_same_failure_and_changes_nothing()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f)));
            var before = Fingerprint(session, "/a");
            var candidate = session.Precheck(Rows(Fl("/a", "idb")));
            var result = session.Commit(candidate);
            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.AddressReused));
            Assert.That(result.StateChangedSinceCheck, Is.False);
            Assert.That(Fingerprint(session, "/a"), Is.EqualTo(before));
        }

        [Test]
        public void Commit_rejects_null_and_foreign_candidates_without_changes()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f)));
            var other = ReadySession(Rows(Fl("/a", "ida", 1f)));
            var before = Fingerprint(session, "/a");
            Assert.That(session.Commit(null).Succeeded, Is.False);
            Assert.That(session.Commit(other.Precheck(Rows(Fl("/b")))).Succeeded, Is.False);
            Assert.That(Fingerprint(session, "/a"), Is.EqualTo(before));
        }

        [Test]
        public void Commit_after_state_change_reuses_decision_when_still_acceptable_and_carries_latest_value()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f)));
            var candidate = session.Precheck(Rows(Fl("/a", "ida", 9f), Fl("/b", "idb", 2f)));
            session.Handle("/a", StagingValue.FromFloat(4f));

            var result = session.Commit(candidate);
            Assert.That(result.Succeeded, Is.True);
            session.TryGetCurrentValue("/a", out var a);
            Assert.That(a, Is.EqualTo(StagingValue.FromFloat(4f)));
            session.TryBuildManifestJson(out _, out var bytes, out _);
            Assert.That(result.PayloadBytes, Is.EqualTo(bytes));
        }

        [Test]
        public void Commit_reports_state_change_when_a_recorded_value_makes_the_candidate_too_large()
        {
            var session = ReadySession(Rows(new E { Address = "/s", Id = "ids", Type = StagingEntryType.String, DefaultKind = ManifestDefaultKind.String, DefaultString = "" }));
            var padding = new string('p', ManifestLimits.PracticalLimitBytes - 800);
            var next = Rows(
                new E { Address = "/s", Id = "ids", Type = StagingEntryType.String, DefaultKind = ManifestDefaultKind.String, DefaultString = "" },
                new E { Address = "/pad", Id = "pad", Type = StagingEntryType.String, Label = padding });
            var candidate = session.Precheck(next);
            Assert.That(candidate.Passed, Is.True, candidate.Result.Failure.ToString());

            session.Handle("/s", StagingValue.FromString(new string('v', 2000)));
            var before = Fingerprint(session, "/s");
            var result = session.Commit(candidate);

            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.PayloadTooLarge));
            Assert.That(result.StateChangedSinceCheck, Is.True);
            Assert.That(result.GenerationAdvanced, Is.False);
            Assert.That(Fingerprint(session, "/s"), Is.EqualTo(before));
            // 失敗の後も直前の成功状態で動く
            Assert.That(session.Handle("/s", StagingValue.FromString("ok")).Recorded, Is.True);
        }

        [Test]
        public void Commit_from_Suppressed_becomes_Ready_and_from_NoValidManifest_records_project()
        {
            var suppressed = new ManifestSession("boot-1");
            suppressed.Initialize(Snap(new E { Address = "/s", Type = StagingEntryType.Int, AppliesTo = new[] { "/a" } }));
            Assert.That(suppressed.State, Is.EqualTo(ManifestSessionState.Suppressed));
            Assert.That(suppressed.Commit(suppressed.Precheck(Rows(Fl("/s", "", 1f)))).Succeeded, Is.True);
            Assert.That(suppressed.State, Is.EqualTo(ManifestSessionState.Ready));
            Assert.That(suppressed.TryBuildManifestJson(out _, out _, out _), Is.True);

            var none = new ManifestSession("boot-1");
            none.Initialize(Snap("", new ManifestSnapshotEntry[0]));
            Assert.That(none.Commit(none.Precheck(Rows(Fl("/a")))).Succeeded, Is.True);
            Assert.That(none.State, Is.EqualTo(ManifestSessionState.Ready));
            Assert.That(none.ProjectId, Is.EqualTo("proj"));
            Assert.That(none.Precheck(Snap("elsewhere", new[] { Fl("/a").Build() })).Result.Failure,
                Is.EqualTo(ManifestChangeFailure.ProjectIdMismatch));
        }

        // ---------- 9.3 受け入れ条件 ----------

        private static IEnumerable<TestCaseData> FailureCandidates()
        {
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Rows(new E { Address = "/a", Id = "ida", Widget = ManifestWidgetKind.Select, Type = StagingEntryType.Float })), ManifestChangeFailure.InvalidManifest).SetName("invalid");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Rows(Fl("/a", "ida"), new E { Address = "/t", Type = StagingEntryType.Int, AppliesTo = new[] { "/a" } })), ManifestChangeFailure.StagingCompileFailed).SetName("compile");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Rows(new E { Address = "/a", Id = "ida", Type = StagingEntryType.String, Label = new string('x', ManifestLimits.PracticalLimitBytes) })), ManifestChangeFailure.PayloadTooLarge).SetName("size");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Snap("other", new[] { Fl("/a", "ida").Build() })), ManifestChangeFailure.ProjectIdMismatch).SetName("project");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Rows(Fl("/a", "different"))), ManifestChangeFailure.AddressReused).SetName("reuse");
        }

        [TestCaseSource(nameof(FailureCandidates))]
        public void Failed_reinject_keeps_old_snapshot_plan_values_and_generation(Func<ManifestSnapshot> candidate, ManifestChangeFailure expected)
        {
            var session = ReadySession(Rows(
                new E { Address = "/a", Id = "ida", Type = StagingEntryType.Float, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 1f, Staged = true },
                new E { Address = "/go", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button, AppliesTo = new[] { "/a" } }));
            session.Handle("/a", StagingValue.FromFloat(3f));
            var before = Fingerprint(session, "/a");

            var checkedCandidate = session.Precheck(candidate());
            var result = session.Commit(checkedCandidate);

            Assert.That(result.Failure, Is.EqualTo(expected));
            Assert.That(Fingerprint(session, "/a"), Is.EqualTo(before));
            // 旧い計画のまま適用が動く
            var reaction = session.Handle("/go", StagingValue.FromInt(1));
            Assert.That(reaction.ApplyTriggered, Is.True);
            Assert.That(reaction.ApplyPayload.Single().Value, Is.EqualTo(StagingValue.FromFloat(3f)));
        }

        [Test]
        public void Size_check_counts_carried_over_long_value_that_the_asset_alone_does_not_have()
        {
            // 資産単体は上限未満だが、引き継いだ長い文字列を含めると超過する
            var session = ReadySession(Rows(new E { Address = "/s", Id = "ids", Type = StagingEntryType.String, DefaultKind = ManifestDefaultKind.String, DefaultString = "" }));
            var next = Rows(
                new E { Address = "/s", Id = "ids", Type = StagingEntryType.String, DefaultKind = ManifestDefaultKind.String, DefaultString = "" },
                new E { Address = "/pad", Id = "pad", Type = StagingEntryType.String, Label = new string('p', ManifestLimits.PracticalLimitBytes - 1000) });
            var assetOnly = ManifestJsonWriter.Utf8ByteCount(
                ManifestJsonWriter.WriteManifest(next, new StagingEngine(StagingPlan.Empty), new ManifestOrigin("boot-1", 2)));
            Assert.That(assetOnly, Is.LessThan(ManifestLimits.PracticalLimitBytes));

            Assert.That(session.Precheck(next).Passed, Is.True);
            session.Handle("/s", StagingValue.FromString(new string('v', 3000)));

            var candidate = session.Precheck(next);
            Assert.That(candidate.Result.Failure, Is.EqualTo(ManifestChangeFailure.PayloadTooLarge));
            Assert.That(candidate.PayloadBytes, Is.GreaterThan(ManifestLimits.PracticalLimitBytes));
            Assert.That(session.Commit(candidate).Succeeded, Is.False);
            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(1));
        }

        [Test]
        public void Reinject_middle_row_removal_carries_only_matching_ids_and_no_stale_values_leak()
        {
            var session = ReadySession(Rows(Fl("/r1", "i1", 1f), Fl("/r2", "i2", 2f), Fl("/r3", "i3", 3f)));
            session.Handle("/r1", StagingValue.FromFloat(10f));
            session.Handle("/r2", StagingValue.FromFloat(20f));
            session.Handle("/r3", StagingValue.FromFloat(30f));

            Assert.That(session.Commit(session.Precheck(Rows(Fl("/r1", "i1", 1f), Fl("/r3", "i3", 3f)))).Succeeded, Is.True);

            session.TryGetCurrentValue("/r1", out var r1);
            session.TryGetCurrentValue("/r3", out var r3);
            Assert.That(r1, Is.EqualTo(StagingValue.FromFloat(10f)));
            Assert.That(r3, Is.EqualTo(StagingValue.FromFloat(30f)));
            Assert.That(session.TryGetCurrentValue("/r2", out _), Is.False);

            // 同じ識別子の同じアドレスへの復帰は受け付けるが、前の実体の値は残らない(既定値でシード)
            var back = session.Commit(session.Precheck(Rows(Fl("/r1", "i1", 1f), Fl("/r2", "i2", 2f), Fl("/r3", "i3", 3f))));
            Assert.That(back.Succeeded, Is.True);
            session.TryGetCurrentValue("/r2", out var r2);
            Assert.That(r2, Is.EqualTo(StagingValue.FromFloat(2f)));
        }

        [Test]
        public void Reinject_type_change_and_id_change_do_not_carry_values()
        {
            var session = ReadySession(Rows(Fl("/t", "it", 1f), Fl("/i", "oldid", 1f)));
            session.Handle("/t", StagingValue.FromFloat(8f));
            session.Handle("/i", StagingValue.FromFloat(8f));

            // 型の変更(識別子・アドレスは同じ)
            var typed = Rows(
                new E { Address = "/t", Id = "it", Type = StagingEntryType.Int, DefaultKind = ManifestDefaultKind.Int, DefaultInt = 4 },
                Fl("/i", "oldid", 1f));
            Assert.That(session.Commit(session.Precheck(typed)).Succeeded, Is.True);
            session.TryGetCurrentValue("/t", out var t);
            session.TryGetCurrentValue("/i", out var kept);
            Assert.That(t, Is.EqualTo(StagingValue.FromInt(4)));
            Assert.That(kept, Is.EqualTo(StagingValue.FromFloat(8f)));

            // 識別子の変更は同じアドレスの再利用として拒否され、新しいアドレスの新しい識別子は既定値で始まる
            Assert.That(session.Precheck(Rows(Fl("/i", "newid", 6f))).Result.Failure, Is.EqualTo(ManifestChangeFailure.AddressReused));
            Assert.That(session.Commit(session.Precheck(Rows(Fl("/i2", "newid", 6f)))).Succeeded, Is.True);
            session.TryGetCurrentValue("/i2", out var fresh);
            Assert.That(fresh, Is.EqualTo(StagingValue.FromFloat(6f)));
            Assert.That(session.TryGetCurrentValue("/i", out _), Is.False);
        }

        [Test]
        public void Staged_pending_value_carried_over_matches_json_default_and_apply_payload_and_resolves_against_new_plan()
        {
            var session = ReadySession(Rows(
                new E { Address = "/v1", Id = "v1", Staged = true, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 1f },
                new E { Address = "/v2", Id = "v2", Staged = true, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 2f },
                new E { Address = "/go", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button, AppliesTo = new[] { "/v*" } }));
            session.Handle("/v2", StagingValue.FromFloat(22f));

            // /v1 を消し、/v3 を足す。appliesTo は新しい計画のアドレス集合で解決される
            var next = Rows(
                new E { Address = "/v2", Id = "v2", Staged = true, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 2f },
                new E { Address = "/v3", Id = "v3", Staged = true, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 3f },
                new E { Address = "/go", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button, AppliesTo = new[] { "/v*" } });
            Assert.That(session.Commit(session.Precheck(next)).Succeeded, Is.True);

            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Does.Contain("\"address\":\"/v2\"").And.Contain("\"default\":22"));

            var reaction = session.Handle("/go", StagingValue.FromInt(1));
            Assert.That(reaction.ApplyTriggered, Is.True);
            var payload = reaction.ApplyPayload.ToDictionary(w => w.Address, w => w.Value);
            Assert.That(payload.Keys, Is.EquivalentTo(new[] { "/v2", "/v3" }));
            Assert.That(payload["/v2"], Is.EqualTo(StagingValue.FromFloat(22f)));
            Assert.That(payload["/v3"], Is.EqualTo(StagingValue.FromFloat(3f)));
            Assert.That(json, Does.Contain("\"default\":3"));
        }

        [Test]
        public void Late_send_to_removed_address_is_not_recorded_and_does_not_touch_other_entities()
        {
            var session = ReadySession(Rows(Fl("/old", "iold", 1f), Fl("/keep", "ik", 2f)));
            session.Commit(session.Precheck(Rows(Fl("/keep", "ik", 2f), Fl("/new", "inew", 5f))));
            var version = session.StateVersion;

            var reaction = session.Handle("/old", StagingValue.FromFloat(99f));

            Assert.That(reaction.Recorded, Is.False);
            Assert.That(session.StateVersion, Is.EqualTo(version));
            Assert.That(session.TryGetCurrentValue("/old", out _), Is.False);
            session.TryGetCurrentValue("/keep", out var keep);
            session.TryGetCurrentValue("/new", out var fresh);
            Assert.That(keep, Is.EqualTo(StagingValue.FromFloat(2f)));
            Assert.That(fresh, Is.EqualTo(StagingValue.FromFloat(5f)));

            // 消えたアドレスは別の識別子では使えない(遅れた送信が別の実体に入らない)
            Assert.That(session.Precheck(Rows(Fl("/keep", "ik"), Fl("/old", "someone-else"))).Result.Failure,
                Is.EqualTo(ManifestChangeFailure.AddressReused));
        }
    }
}
