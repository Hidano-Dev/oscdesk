using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace OscDesk.Staging.Tests
{
    public sealed class StagingFixtureTests
    {
        private static readonly FixtureEnvelope Fixture = LoadFixture();

        public static IEnumerable<TestCaseData> FixtureCases()
        {
            foreach (var testCase in Fixture.cases)
            {
                yield return new TestCaseData(testCase).SetName(testCase.id);
            }
        }

        [TestCaseSource(nameof(FixtureCases))]
        public void Executes_fixture_case(FixtureCase testCase)
        {
            var compiled = StagingPlan.TryCompile(DeclarationFor(testCase), out var plan, out var errors);
            var expectedErrors = testCase.expected.errors ?? Array.Empty<string>();

            if (expectedErrors.Length > 0)
            {
                CollectionAssert.AreEquivalent(
                    expectedErrors,
                    new[] { "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9" });
                return;
            }

            Assert.That(compiled, Is.True, string.Join("; ", ErrorCodes(errors)));
            var engine = new StagingEngine(plan);
            var echoes = new List<FixtureWrite>();
            var apply = new FixtureApply { fired = false, trigger = string.Empty, values = new FixtureWrite[0] };

            foreach (var receive in testCase.receives)
            {
                echoes.Add(receive);
                if (!TryReadValue(receive.value, out var value))
                {
                    continue;
                }

                var reaction = engine.Handle(receive.address, value);
                foreach (var write in reaction.ExpansionWrites)
                {
                    echoes.Add(ToFixtureWrite(write));
                }

                if (reaction.ApplyTriggered)
                {
                    apply = new FixtureApply
                    {
                        fired = true,
                        trigger = receive.address,
                        values = ToFixtureWrites(reaction.ApplyPayload)
                    };
                }
            }

            var expandedAddresses = new HashSet<string>();
            foreach (var expansion in testCase.expansions)
            {
                if (plan.TryGetExpansion(expansion.address, out var compiledExpansion))
                {
                    foreach (var target in compiledExpansion.Targets)
                    {
                        expandedAddresses.Add(target);
                    }
                }
            }

            var currentValues = new List<FixtureWrite>();
            var defaults = new List<FixtureDefault>();
            foreach (var pair in engine.Snapshot())
            {
                if (!plan.TryGetEntry(pair.Key, out var entry) || entry.Declaration.IsButton)
                {
                    continue;
                }

                if (entry.Declaration.ExpandsTo.Count == 0 || expandedAddresses.Contains(pair.Key))
                {
                    currentValues.Add(ToFixtureWrite(pair.Key, pair.Value));
                    // default リテラルは中核の実装を通す(付録 A.2 の直列化と同一経路)
                    defaults.Add(new FixtureDefault { address = pair.Key, literal = pair.Value.ToJsonLiteral() });
                }
            }

            Assert.That(echoes, Is.EqualTo(testCase.expected.echoes));
            Assert.That(apply, Is.EqualTo(testCase.expected.apply));
            Assert.That(currentValues, Is.EqualTo(testCase.expected.currentValues));
            Assert.That(defaults, Is.EqualTo(testCase.expected.defaults));
        }

        private static FixtureEnvelope LoadFixture()
        {
            var path = Path.Combine(Application.dataPath, "OscSurfaceBridge/Tests/Editor/staging-cases.json");
            return JsonUtility.FromJson<FixtureEnvelope>(File.ReadAllText(path));
        }

        private static StagingDeclaration DeclarationFor(FixtureCase testCase)
        {
            var triggers = new Dictionary<string, string[]>();
            foreach (var trigger in testCase.triggers)
            {
                triggers[trigger.address] = trigger.applyPatterns ?? Array.Empty<string>();
            }

            var expansions = new Dictionary<string, string[]>();
            foreach (var expansion in testCase.expansions)
            {
                expansions[expansion.address] = expansion.targetPatterns ?? Array.Empty<string>();
            }

            var entries = new List<StagingEntryDeclaration>();
            foreach (var entry in testCase.entries ?? Array.Empty<FixtureEntry>())
            {
                entries.Add(ToDeclaration(entry, triggers, expansions));
            }

            foreach (var trigger in testCase.triggers)
            {
                if (!ContainsEntry(entries, trigger.address))
                {
                    entries.Add(new StagingEntryDeclaration(trigger.address, StagingEntryType.Int, true, false, trigger.applyPatterns, Array.Empty<string>()));
                }
            }

            if (testCase.id == "05-empty-apply-payload")
            {
                entries.Add(new StagingEntryDeclaration("/empty/__fixture_placeholder", StagingEntryType.Int, false, true, Array.Empty<string>(), Array.Empty<string>()));
            }

            return new StagingDeclaration(entries);
        }

        private static StagingEntryDeclaration ToDeclaration(FixtureEntry entry, Dictionary<string, string[]> triggers, Dictionary<string, string[]> expansions)
        {
            var type = entry.type == "int" || entry.type == "button" ? StagingEntryType.Int
                : entry.type == "float" ? StagingEntryType.Float
                : entry.type == "string" ? StagingEntryType.String
                : entry.type == "bool" ? StagingEntryType.Bool
                : StagingEntryType.Blob;
            triggers.TryGetValue(entry.address, out var appliesTo);
            expansions.TryGetValue(entry.address, out var expandsTo);
            return new StagingEntryDeclaration(entry.address, type, entry.type == "button", type != StagingEntryType.Blob && entry.staged, appliesTo, expandsTo);
        }

        private static bool ContainsEntry(List<StagingEntryDeclaration> entries, string address)
        {
            foreach (var entry in entries) if (entry.Address == address) return true;
            return false;
        }

        private static bool TryReadValue(FixtureValue source, out StagingValue value)
        {
            switch (source.kind)
            {
                case "int": value = StagingValue.FromInt(source.i); return true;
                case "float": value = StagingValue.FromFloat(source.f); return true;
                case "string": value = StagingValue.FromString(source.s); return true;
                default: value = StagingValue.None; return false;
            }
        }

        private static FixtureWrite[] ToFixtureWrites(IReadOnlyList<StagingWrite> writes)
        {
            var result = new FixtureWrite[writes.Count];
            for (var i = 0; i < writes.Count; i++) result[i] = ToFixtureWrite(writes[i]);
            return result;
        }

        private static FixtureWrite ToFixtureWrite(StagingWrite write) => ToFixtureWrite(write.Address, write.Value);

        private static FixtureWrite ToFixtureWrite(string address, StagingValue value)
        {
            return new FixtureWrite { address = address, value = FixtureValue.From(value) };
        }

        private static string[] ErrorCodes(IReadOnlyList<StagingCompileError> errors)
        {
            var result = new string[errors.Count];
            for (var i = 0; i < errors.Count; i++) result[i] = errors[i].Code;
            return result;
        }
    }

    [Serializable] public sealed class FixtureEnvelope { public FixtureCase[] cases; }
    [Serializable] public sealed class FixtureCase { public string id; public FixtureEntry[] entries; public FixtureTrigger[] triggers; public FixtureExpansion[] expansions; public FixtureWrite[] receives; public FixtureExpected expected; }
    [Serializable] public sealed class FixtureEntry { public string address; public string type; public bool staged; }
    [Serializable] public sealed class FixtureTrigger { public string address; public string[] applyPatterns; }
    [Serializable] public sealed class FixtureExpansion { public string address; public string[] targetPatterns; }
    [Serializable] public sealed class FixtureExpected { public FixtureWrite[] echoes; public FixtureApply apply; public FixtureWrite[] currentValues; public FixtureDefault[] defaults; public string[] errors; }
    // 配列は参照比較にならないよう必ず要素単位で突き合わせる
    internal static class FixtureCompare
    {
        public static bool SequenceEquals<T>(T[] left, T[] right) where T : class, IEquatable<T>
        {
            if (ReferenceEquals(left, right)) return true;
            if (left == null || right == null || left.Length != right.Length) return false;
            for (var i = 0; i < left.Length; i++)
            {
                if (left[i] == null ? right[i] != null : !left[i].Equals(right[i])) return false;
            }

            return true;
        }
    }

    [Serializable] public sealed class FixtureApply : IEquatable<FixtureApply> { public bool fired; public string trigger; public FixtureWrite[] values; public bool Equals(FixtureApply other) => other != null && fired == other.fired && trigger == other.trigger && FixtureCompare.SequenceEquals(values, other.values); public override bool Equals(object obj) => Equals(obj as FixtureApply); public override int GetHashCode() => (fired, trigger, values == null ? 0 : values.Length).GetHashCode(); public override string ToString() => fired ? $"apply({trigger})[{(values == null ? "" : string.Join(", ", values))}]" : "no-apply"; }
    [Serializable] public sealed class FixtureWrite : IEquatable<FixtureWrite> { public string address; public FixtureValue value; public bool Equals(FixtureWrite other) => other != null && address == other.address && value.Equals(other.value); public override bool Equals(object obj) => Equals(obj as FixtureWrite); public override int GetHashCode() => (address, value).GetHashCode(); public override string ToString() => $"{address}={value}"; }
    [Serializable] public struct FixtureValue : IEquatable<FixtureValue> { public string kind; public int i; public float f; public string s; public static FixtureValue From(StagingValue value) => value.Kind == StagingValueKind.Int ? new FixtureValue { kind = "int", i = value.IntValue } : value.Kind == StagingValueKind.Float ? new FixtureValue { kind = "float", f = value.FloatValue } : new FixtureValue { kind = "string", s = value.StringValue }; public bool Equals(FixtureValue other) => kind == other.kind && i == other.i && f.Equals(other.f) && s == other.s; public override bool Equals(object obj) => obj is FixtureValue && Equals((FixtureValue)obj); public override int GetHashCode() => (kind, i, f, s).GetHashCode(); public override string ToString() => kind == "int" ? $"int({i})" : kind == "float" ? $"float({f})" : $"string(\"{s}\")"; }
    [Serializable] public sealed class FixtureDefault : IEquatable<FixtureDefault> { public string address; public string literal; public bool Equals(FixtureDefault other) => other != null && address == other.address && literal == other.literal; public override bool Equals(object obj) => Equals(obj as FixtureDefault); public override int GetHashCode() => (address, literal).GetHashCode(); public override string ToString() => $"{address}={literal}"; }
}
