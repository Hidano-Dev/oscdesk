using System.Collections.Generic;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    public sealed class OscReceiverCoreTests
    {
        private readonly List<OscInvocation> invocations = new List<OscInvocation>();
        private readonly List<int> mismatches = new List<int>();

        private OscDispatcher Make(params (string address, OscBindingKind kind)[] rows)
        {
            var list = new List<OscBindingRow>();
            foreach (var (address, kind) in rows)
            {
                list.Add(new OscBindingRow(address, kind, 1));
            }

            return new OscDispatcher(list);
        }

        [Test]
        public void Dispatch_matches_exact_address_only()
        {
            var dispatcher = Make(("/mix/master", OscBindingKind.Float));

            Assert.That(dispatcher.Dispatch("/mix/master", new object[] { 0.5f }, invocations, mismatches), Is.EqualTo(1));
            Assert.That(invocations[0].FloatValue, Is.EqualTo(0.5f));
            Assert.That(dispatcher.Dispatch("/mix/master/x", new object[] { 0.5f }, invocations, mismatches), Is.EqualTo(0));
            Assert.That(dispatcher.HasAddress("/mix/master"), Is.True);
            Assert.That(dispatcher.HasAddress("/mix"), Is.False);
        }

        [Test]
        public void Trigger_fires_with_or_without_arguments()
        {
            var dispatcher = Make(("/cue/go", OscBindingKind.Trigger));

            Assert.That(dispatcher.Dispatch("/cue/go", new object[0], invocations, mismatches), Is.EqualTo(1));
            Assert.That(dispatcher.Dispatch("/cue/go", new object[] { 1 }, invocations, mismatches), Is.EqualTo(1));
        }

        [Test]
        public void Int_accepts_int_and_whole_float_but_not_fraction()
        {
            var dispatcher = Make(("/count", OscBindingKind.Int));

            Assert.That(dispatcher.Dispatch("/count", new object[] { 3 }, invocations, mismatches), Is.EqualTo(1));
            Assert.That(invocations[0].IntValue, Is.EqualTo(3));
            Assert.That(dispatcher.Dispatch("/count", new object[] { 4f }, invocations, mismatches), Is.EqualTo(1));
            Assert.That(invocations[0].IntValue, Is.EqualTo(4));
            Assert.That(dispatcher.Dispatch("/count", new object[] { 4.5f }, invocations, mismatches), Is.EqualTo(0));
            CollectionAssert.AreEqual(new[] { 0 }, mismatches);
            Assert.That(dispatcher.Dispatch("/count", new object[] { "x" }, invocations, mismatches), Is.EqualTo(0));
            Assert.That(dispatcher.Dispatch("/count", new object[0], invocations, mismatches), Is.EqualTo(0));
        }

        [Test]
        public void Float_accepts_int_and_string_requires_string()
        {
            var dispatcher = Make(("/f", OscBindingKind.Float), ("/s", OscBindingKind.String));

            Assert.That(dispatcher.Dispatch("/f", new object[] { 2 }, invocations, mismatches), Is.EqualTo(1));
            Assert.That(invocations[0].FloatValue, Is.EqualTo(2f));
            Assert.That(dispatcher.Dispatch("/s", new object[] { "A" }, invocations, mismatches), Is.EqualTo(1));
            Assert.That(invocations[0].StringValue, Is.EqualTo("A"));
            Assert.That(dispatcher.Dispatch("/s", new object[] { 1 }, invocations, mismatches), Is.EqualTo(0));
        }

        [Test]
        public void Bool_accepts_zero_one_int_and_bool()
        {
            var dispatcher = Make(("/mute", OscBindingKind.Bool));

            dispatcher.Dispatch("/mute", new object[] { 1 }, invocations, mismatches);
            Assert.That(invocations[0].BoolValue, Is.True);
            dispatcher.Dispatch("/mute", new object[] { 0 }, invocations, mismatches);
            Assert.That(invocations[0].BoolValue, Is.False);
            dispatcher.Dispatch("/mute", new object[] { true }, invocations, mismatches);
            Assert.That(invocations[0].BoolValue, Is.True);
            Assert.That(dispatcher.Dispatch("/mute", new object[] { "on" }, invocations, mismatches), Is.EqualTo(0));
        }

        [Test]
        public void Same_address_rows_all_fire_and_mismatch_does_not_block_others()
        {
            var dispatcher = Make(("/v", OscBindingKind.String), ("/v", OscBindingKind.Int), ("/v", OscBindingKind.Float));

            Assert.That(dispatcher.Dispatch("/v", new object[] { 7 }, invocations, mismatches), Is.EqualTo(2));
            CollectionAssert.AreEqual(new[] { 1, 2 }, new[] { invocations[0].RowIndex, invocations[1].RowIndex });
            CollectionAssert.AreEqual(new[] { 0 }, mismatches);
        }

        [Test]
        public void NormalizeForEcho_turns_bool_into_int()
        {
            Assert.That(OscDispatcher.NormalizeForEcho(true), Is.EqualTo(1));
            Assert.That(OscDispatcher.NormalizeForEcho(false), Is.EqualTo(0));
            Assert.That(OscDispatcher.NormalizeForEcho(2.5f), Is.EqualTo(2.5f));
        }

        [Test]
        public void Audit_reports_each_warning_code()
        {
            var rows = new List<OscBindingRow>
            {
                new OscBindingRow("/ok", OscBindingKind.Int, 1),
                new OscBindingRow("/unlisted", OscBindingKind.Int, 1),
                new OscBindingRow("bad", OscBindingKind.Int, 1),
                new OscBindingRow("/sys/ping", OscBindingKind.Int, 1),
                new OscBindingRow("/dup", OscBindingKind.Int, 1),
                new OscBindingRow("/dup", OscBindingKind.Int, 1),
                new OscBindingRow("/empty", OscBindingKind.Trigger, 0)
            };
            var definition = new HashSet<string> { "/ok", "/dup", "/empty", "/missing" };

            var codes = new List<string>();
            foreach (var warning in OscBindingAudit.Audit(definition, rows))
            {
                codes.Add(warning.Code + ":" + warning.Address);
            }

            CollectionAssert.AreEquivalent(
                new[] { "A1:/unlisted", "A2:bad", "A2:/sys/ping", "A3:/dup", "A4:/empty", "A5:/missing" },
                codes);
        }

        [Test]
        public void Audit_without_definition_skips_definition_checks()
        {
            var rows = new List<OscBindingRow> { new OscBindingRow("/any", OscBindingKind.Int, 1) };

            Assert.That(OscBindingAudit.Audit(null, rows), Is.Empty);
        }

        [TestCase("/a", true)]
        [TestCase("/a/b-c_1", true)]
        [TestCase("", false)]
        [TestCase("/", false)]
        [TestCase("/a/", false)]
        [TestCase("/a//b", false)]
        [TestCase("/a/*", false)]
        [TestCase("/a b", false)]
        [TestCase("/sys", false)]
        [TestCase("/system/x", true)]
        [TestCase("/oscdesk/x", false)]
        public void IsValidAddress(string address, bool expected)
        {
            Assert.That(OscBindingAudit.IsValidAddress(address), Is.EqualTo(expected));
        }

        private const string Definition = @"{
  ""format"": ""oscdesk-surface"", ""version"": 1, ""name"": ""S \""x\"" あ"",
  ""parameters"": [
    { ""id"": ""m"", ""address"": ""/mix/master"", ""label"": ""M"", ""type"": ""f"", ""kind"": ""state"", ""range"": [0, 1], ""default"": 0.5 },
    { ""id"": ""b"", ""address"": ""/mix/mute"", ""label"": ""B"", ""type"": ""bool"", ""kind"": ""state"", ""default"": false },
    { ""id"": ""g"", ""address"": ""/cue/go"", ""label"": ""G"", ""type"": ""i"", ""kind"": ""trigger"", ""value"": 1 },
    { ""id"": ""s"", ""address"": ""/scene"", ""label"": ""S"", ""type"": ""s"", ""kind"": ""state"", ""options"": [""A"", ""B""], ""default"": null }
  ],
  ""screens"": []
}";

        [Test]
        public void Reader_reads_addresses_and_suggests_kinds()
        {
            Assert.That(OscDefinitionReader.TryRead(Definition, out var parameters, out var error), Is.True, error);

            Assert.That(parameters.Count, Is.EqualTo(4));
            Assert.That(parameters[0].Address, Is.EqualTo("/mix/master"));
            Assert.That(parameters[0].SuggestKind(), Is.EqualTo(OscBindingKind.Float));
            Assert.That(parameters[1].SuggestKind(), Is.EqualTo(OscBindingKind.Bool));
            Assert.That(parameters[2].SuggestKind(), Is.EqualTo(OscBindingKind.Trigger));
            Assert.That(parameters[3].SuggestKind(), Is.EqualTo(OscBindingKind.String));
        }

        [TestCase("")]
        [TestCase("not json")]
        [TestCase("[]")]
        [TestCase("{\"format\":\"other\",\"parameters\":[]}")]
        [TestCase("{\"format\":\"oscdesk-surface\"}")]
        [TestCase("{\"format\":\"oscdesk-surface\",\"parameters\":[{\"id\":\"x\"}]}")]
        [TestCase("{\"format\":\"oscdesk-surface\",\"parameters\":[]} trailing")]
        [TestCase("{\"format\":\"oscdesk-surface\",\"parameters\":[}")]
        [TestCase("{\"format\":t")]
        [TestCase("tru")]
        public void Reader_rejects_invalid_input_with_reason(string json)
        {
            Assert.That(OscDefinitionReader.TryRead(json, out var parameters, out var error), Is.False);
            Assert.That(error, Is.Not.Empty);
            Assert.That(parameters, Is.Empty);
        }

        private const string DefinitionWithOptionsFrom = @"{
  ""format"": ""oscdesk-surface"", ""version"": 1, ""name"": ""S"",
  ""parameters"": [
    { ""id"": ""seg"", ""address"": ""/member/1/segment"", ""label"": ""Seg"", ""type"": ""s"", ""kind"": ""state"",
      ""optionsFrom"": { ""address"": ""/mb/segments"", ""request"": ""/mb/segments/get"" } },
    { ""id"": ""seg2"", ""address"": ""/member/2/segment"", ""label"": ""Seg2"", ""type"": ""s"", ""kind"": ""state"",
      ""optionsFrom"": { ""address"": ""/mb/segments"", ""request"": ""/mb/segments/get"" } },
    { ""id"": ""seg3"", ""address"": ""/member/3/segment"", ""label"": ""Seg3"", ""type"": ""s"", ""kind"": ""state"",
      ""optionsFrom"": { ""address"": ""/mb/segments"" } }
  ],
  ""screens"": []
}";

        [Test]
        public void Reader_reads_options_from_request_and_suggests_a_trigger_row()
        {
            Assert.That(OscDefinitionReader.TryRead(DefinitionWithOptionsFrom, out var parameters, out var error), Is.True, error);
            Assert.That(parameters[0].OptionsFromRequest, Is.EqualTo("/mb/segments/get"));
            Assert.That(parameters[2].OptionsFromRequest, Is.Empty);

            var expected = OscDefinitionRows.Expected(parameters);
            var addresses = new List<string>();
            foreach (var row in expected)
            {
                addresses.Add(row.Key);
            }

            // 一覧の address(Unity が送る側)は行の不足にしない。request は重複せず Trigger で 1 行
            CollectionAssert.AreEqual(
                new[] { "/member/1/segment", "/member/2/segment", "/member/3/segment", "/mb/segments/get" }, addresses);
            Assert.That(expected[3].Value, Is.EqualTo(OscBindingKind.Trigger));
        }

        [Test]
        public void Audit_reports_a5_for_a_missing_request_row_but_not_for_the_list_address()
        {
            OscDefinitionReader.TryRead(DefinitionWithOptionsFrom, out var parameters, out _);
            var addresses = new HashSet<string>();
            foreach (var row in OscDefinitionRows.Expected(parameters))
            {
                addresses.Add(row.Key);
            }

            var rows = new List<OscBindingRow>
            {
                new OscBindingRow("/member/1/segment", OscBindingKind.String, 1),
                new OscBindingRow("/member/2/segment", OscBindingKind.String, 1),
                new OscBindingRow("/member/3/segment", OscBindingKind.String, 1)
            };

            var warnings = OscBindingAudit.Audit(addresses, rows);
            Assert.That(warnings.Count, Is.EqualTo(1));
            Assert.That(warnings[0].Code, Is.EqualTo("A5"));
            Assert.That(warnings[0].Address, Is.EqualTo("/mb/segments/get"));
        }

        [Test]
        public void StringList_accepts_a_normal_list_and_rejects_bad_address_or_null()
        {
            Assert.That(OscStringList.TryValidate("/mb/segments", new[] { "(none)", "Intro", "日本語" }, out _), Is.True);
            Assert.That(OscStringList.TryValidate("/mb/segments", new string[0], out _), Is.True);
            Assert.That(OscStringList.TryValidate("/sys/x", new[] { "a" }, out var reason), Is.False);
            Assert.That(reason, Is.Not.Empty);
            Assert.That(OscStringList.TryValidate("/mb/segments", null, out _), Is.False);
        }

        [Test]
        public void StringList_size_follows_osc_padding_and_enforces_the_datagram_limit()
        {
            // "/a" → 4、",s" → 4、"b" → 4
            Assert.That(OscStringList.EstimateSize("/a", new[] { "b" }), Is.EqualTo(12));
            // UTF-8 は文字数でなくバイト数で数える("あ" = 3 バイト → 4)
            Assert.That(OscStringList.EstimateSize("/a", new[] { "あ" }), Is.EqualTo(12));

            var many = new List<string>();
            for (var i = 0; i < 20000; i++)
            {
                many.Add("name" + i);
            }

            Assert.That(OscStringList.TryValidate("/mb/segments", many, out var reason), Is.False);
            StringAssert.Contains("大きすぎ", reason);
        }

        private static readonly string[] MemberFields = { "active", "slot", "ip", "segment" };

        [Test]
        public void Record_row_delivers_key_and_fields_by_index_and_id()
        {
            var dispatcher = new OscDispatcher(new[] { new OscBindingRow("/vp/member", OscBindingKind.Record, 1, MemberFields) });

            var fired = dispatcher.Dispatch("/vp/member", new object[] { "メンバーA", 1, 3, "192.168.0.21", "(none)" }, invocations, mismatches);

            Assert.That(fired, Is.EqualTo(1));
            var record = invocations[0].RecordValue;
            Assert.That(invocations[0].Kind, Is.EqualTo(OscBindingKind.Record));
            Assert.That(record.Key, Is.EqualTo("メンバーA"));
            Assert.That(record.Count, Is.EqualTo(4));
            CollectionAssert.AreEqual(MemberFields, record.FieldIds);
            Assert.That(record.GetBool("active"), Is.True);
            Assert.That(record.GetInt("slot"), Is.EqualTo(3));
            Assert.That(record.GetFloat(1), Is.EqualTo(3f));
            Assert.That(record.GetString("ip"), Is.EqualTo("192.168.0.21"));
            Assert.That(record.GetString(3), Is.EqualTo("(none)"));
            Assert.That(record.IndexOf("segment"), Is.EqualTo(3));
            Assert.That(record.IndexOf("nope"), Is.EqualTo(-1));
        }

        [Test]
        public void Record_row_copies_the_arguments()
        {
            var dispatcher = new OscDispatcher(new[] { new OscBindingRow("/r", OscBindingKind.Record, 1) });
            var args = new object[] { "k", 1 };

            dispatcher.Dispatch("/r", args, invocations, mismatches);
            args[1] = 2;

            // 受け取った関数が保持していても、後の受信や引数配列の使い回しで書き換わらない
            Assert.That(invocations[0].RecordValue.GetInt(0), Is.EqualTo(1));
        }

        [Test]
        public void Record_row_accepts_a_key_only_trigger_record()
        {
            var dispatcher = new OscDispatcher(new[] { new OscBindingRow("/vp/member/update", OscBindingKind.Record, 1) });

            Assert.That(dispatcher.Dispatch("/vp/member/update", new object[] { "メンバーA" }, invocations, mismatches), Is.EqualTo(1));
            Assert.That(invocations[0].RecordValue.Key, Is.EqualTo("メンバーA"));
            Assert.That(invocations[0].RecordValue.Count, Is.EqualTo(0));
        }

        [Test]
        public void Record_row_without_field_ids_accepts_any_field_count()
        {
            var dispatcher = new OscDispatcher(new[] { new OscBindingRow("/r", OscBindingKind.Record, 1) });

            Assert.That(dispatcher.Dispatch("/r", new object[] { "k", 1, 2f, "x" }, invocations, mismatches), Is.EqualTo(1));
            Assert.That(invocations[0].RecordValue.Count, Is.EqualTo(3));
            Assert.That(invocations[0].RecordValue.FieldIds, Is.Empty);
        }

        [Test]
        public void Record_row_rejects_missing_or_non_string_key_and_wrong_field_count()
        {
            var row = new OscBindingRow("/vp/member", OscBindingKind.Record, 1, MemberFields);
            var dispatcher = new OscDispatcher(new[] { row });

            Assert.That(dispatcher.Dispatch("/vp/member", new object[0], invocations, mismatches), Is.EqualTo(0));
            CollectionAssert.AreEqual(new[] { 0 }, mismatches);
            Assert.That(dispatcher.Dispatch("/vp/member", new object[] { 1, 1, 3, "ip", "(none)" }, invocations, mismatches), Is.EqualTo(0));
            CollectionAssert.AreEqual(new[] { 0 }, mismatches);
            Assert.That(dispatcher.Dispatch("/vp/member", new object[] { "k", 1, 3 }, invocations, mismatches), Is.EqualTo(0));
            CollectionAssert.AreEqual(new[] { 0 }, mismatches);

            StringAssert.Contains("先頭", OscDispatcher.ExplainMismatch(row, new object[] { 1 }));
            StringAssert.Contains("フィールドの数", OscDispatcher.ExplainMismatch(row, new object[] { "k", 1 }));
        }

        [Test]
        public void Record_getters_throw_and_try_getters_fail_on_missing_or_mismatched_fields()
        {
            var record = new OscRecord("k", new object[] { 1.5f, "s" }, new[] { "gain", "name" });

            Assert.Throws<System.InvalidCastException>(() => record.GetInt("gain"));
            Assert.Throws<System.InvalidCastException>(() => record.GetBool("name"));
            Assert.Throws<KeyNotFoundException>(() => record.GetString("missing"));
            Assert.Throws<System.ArgumentOutOfRangeException>(() => record.GetFloat(2));
            Assert.That(record.TryGetInt("gain", out _), Is.False);
            Assert.That(record.TryGetFloat("gain", out var gain), Is.True);
            Assert.That(gain, Is.EqualTo(1.5f));
            Assert.That(record.TryGetString("missing", out _), Is.False);
            Assert.That(record.TryGetBool(5, out _), Is.False);
            Assert.That(record.GetValue("name"), Is.EqualTo("s"));
            Assert.That(record.ToString(), Is.EqualTo("\"k\", gain=1.5, name=s"));
        }

        private const string DefinitionWithRecords = @"{
  ""format"": ""oscdesk-surface"", ""version"": 1, ""name"": ""VP"",
  ""parameters"": [
    { ""id"": ""m"", ""address"": ""/mix/master"", ""label"": ""M"", ""type"": ""f"", ""kind"": ""state"", ""range"": [0, 1], ""default"": 0.5 }
  ],
  ""records"": [
    {
      ""id"": ""member"", ""address"": ""/vp/member"", ""label"": ""メンバー"", ""kind"": ""state"",
      ""key"": { ""label"": ""メンバー名"" },
      ""keysFrom"": { ""address"": ""/vp/members/list"", ""request"": ""/vp/members/request"" },
      ""fields"": [
        { ""id"": ""active"",  ""label"": ""Active"",  ""type"": ""bool"", ""default"": false },
        { ""id"": ""slot"",    ""label"": ""Slot"",    ""type"": ""i"", ""range"": [1, 64], ""step"": 1, ""default"": 1 },
        { ""id"": ""ip"",      ""label"": ""IP"",      ""type"": ""s"", ""default"": """" },
        { ""id"": ""segment"", ""label"": ""Segment"", ""type"": ""s"", ""options"": [""(none)""],
          ""optionsFrom"": { ""address"": ""/vp/segments/list"", ""request"": ""/vp/segments/request"" }, ""default"": ""(none)"" }
      ]
    },
    {
      ""id"": ""memberUpdate"", ""address"": ""/vp/member/update"", ""label"": ""Update"", ""kind"": ""trigger"",
      ""keysFrom"": { ""address"": ""/vp/members/list"", ""request"": ""/vp/members/request"" },
      ""fields"": []
    }
  ],
  ""screens"": []
}";

        [Test]
        public void Reader_reads_records_and_suggests_record_and_request_rows()
        {
            Assert.That(OscDefinitionReader.TryRead(DefinitionWithRecords, out var parameters, out var records, out var error), Is.True, error);

            Assert.That(parameters.Count, Is.EqualTo(1));
            Assert.That(records.Count, Is.EqualTo(2));
            Assert.That(records[0].Id, Is.EqualTo("member"));
            Assert.That(records[0].Address, Is.EqualTo("/vp/member"));
            Assert.That(records[0].Kind, Is.EqualTo("state"));
            Assert.That(records[0].KeysFromAddress, Is.EqualTo("/vp/members/list"));
            Assert.That(records[0].KeysFromRequest, Is.EqualTo("/vp/members/request"));
            CollectionAssert.AreEqual(MemberFields, records[0].FieldIds());
            Assert.That(records[0].Fields[3].OptionsFromRequest, Is.EqualTo("/vp/segments/request"));
            Assert.That(records[1].Fields, Is.Empty);

            var expected = OscDefinitionRows.ExpectedBindings(parameters, records);
            var summary = new List<string>();
            foreach (var binding in expected)
            {
                summary.Add(binding.Address + ":" + binding.Kind + ":" + string.Join(",", binding.FieldIds));
            }

            // keysFrom.address / optionsFrom.address(Unity が送る側)は行にしない。request は Trigger で 1 行ずつ
            CollectionAssert.AreEqual(new[]
            {
                "/mix/master:Float:",
                "/vp/member:Record:active,slot,ip,segment",
                "/vp/member/update:Record:",
                "/vp/members/request:Trigger:",
                "/vp/segments/request:Trigger:"
            }, summary);
        }

        [Test]
        public void Reader_without_records_returns_an_empty_record_list()
        {
            Assert.That(OscDefinitionReader.TryRead(Definition, out _, out var records, out var error), Is.True, error);
            Assert.That(records, Is.Empty);
        }

        [TestCase("{\"format\":\"oscdesk-surface\",\"parameters\":[],\"records\":{}}")]
        [TestCase("{\"format\":\"oscdesk-surface\",\"parameters\":[],\"records\":[{\"id\":\"r\"}]}")]
        [TestCase("{\"format\":\"oscdesk-surface\",\"parameters\":[],\"records\":[{\"address\":\"/r\",\"fields\":{}}]}")]
        [TestCase("{\"format\":\"oscdesk-surface\",\"parameters\":[],\"records\":[{\"address\":\"/r\",\"fields\":[{\"type\":\"i\"}]}]}")]
        public void Reader_rejects_malformed_records_with_reason(string json)
        {
            Assert.That(OscDefinitionReader.TryRead(json, out var parameters, out var records, out var error), Is.False);
            Assert.That(error, Is.Not.Empty);
            Assert.That(parameters, Is.Empty);
            Assert.That(records, Is.Empty);
        }

        [Test]
        public void Audit_with_definition_covers_records_requests_and_field_ids()
        {
            OscDefinitionReader.TryRead(DefinitionWithRecords, out var parameters, out var records, out _);
            var expected = OscDefinitionRows.ExpectedBindings(parameters, records);
            var rows = new List<OscBindingRow>
            {
                new OscBindingRow("/mix/master", OscBindingKind.Float, 1),
                new OscBindingRow("/vp/member", OscBindingKind.Record, 1, new[] { "active", "slot", "ip" }),
                new OscBindingRow("/vp/member/update", OscBindingKind.Record, 0),
                new OscBindingRow("/vp/segments/request", OscBindingKind.Trigger, 1)
            };

            var codes = new List<string>();
            foreach (var warning in OscBindingAudit.AuditWithDefinition(expected, rows))
            {
                codes.Add(warning.Code + ":" + warning.Address);
            }

            // keysFrom.request の行が無い → A5。keysFrom.address は不足にしない。フィールド id の食い違い → A6
            CollectionAssert.AreEquivalent(
                new[] { "A4:/vp/member/update", "A5:/vp/members/request", "A6:/vp/member" },
                codes);
        }

        [Test]
        public void Audit_with_definition_accepts_matching_record_rows_and_null_definition()
        {
            OscDefinitionReader.TryRead(DefinitionWithRecords, out var parameters, out var records, out _);
            var rows = new List<OscBindingRow>
            {
                new OscBindingRow("/mix/master", OscBindingKind.Float, 1),
                new OscBindingRow("/vp/member", OscBindingKind.Record, 1, MemberFields),
                new OscBindingRow("/vp/member/update", OscBindingKind.Record, 1),
                new OscBindingRow("/vp/members/request", OscBindingKind.Trigger, 1),
                new OscBindingRow("/vp/segments/request", OscBindingKind.Trigger, 1)
            };

            Assert.That(OscBindingAudit.AuditWithDefinition(OscDefinitionRows.ExpectedBindings(parameters, records), rows), Is.Empty);
            Assert.That(OscBindingAudit.AuditWithDefinition(null, new List<OscBindingRow> { new OscBindingRow("/any", OscBindingKind.Record, 1) }), Is.Empty);
        }

        [Test]
        public void Record_kind_keeps_the_serialized_numbers_of_existing_kinds()
        {
            // シーンには整数で保存されている。既存の番号がずれると、保存済みの行の型が変わってしまう
            Assert.That((int)OscBindingKind.Trigger, Is.EqualTo(0));
            Assert.That((int)OscBindingKind.Bool, Is.EqualTo(4));
            Assert.That((int)OscBindingKind.Record, Is.EqualTo(5));
        }
    }
}
