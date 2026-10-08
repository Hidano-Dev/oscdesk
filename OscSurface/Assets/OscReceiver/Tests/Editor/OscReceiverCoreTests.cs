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
        public void Reader_rejects_invalid_input_with_reason(string json)
        {
            Assert.That(OscDefinitionReader.TryRead(json, out var parameters, out var error), Is.False);
            Assert.That(error, Is.Not.Empty);
            Assert.That(parameters, Is.Empty);
        }
    }
}
