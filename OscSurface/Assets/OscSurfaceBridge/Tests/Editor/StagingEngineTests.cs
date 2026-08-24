using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace OscSurfaceBridge.Staging.Tests
{
    public sealed class StagingEngineTests
    {
        [Test]
        public void MatchesPattern_respects_segment_boundaries()
        {
            Assert.That(StagingPlan.MatchesPattern("/vp/member/*/active", "/vp/member/01/active"), Is.True);
            Assert.That(StagingPlan.MatchesPattern("/vp/member/*/active", "/vp/member/01/name/active"), Is.False);
            Assert.That(StagingPlan.MatchesPattern("/vp/member/*/active", "/vp/member/01"), Is.False);
            Assert.That(StagingPlan.MatchesPattern("/vp/member/*/active", "/vp/member//active"), Is.False);
        }

        [Test]
        public void TryCompile_collects_all_validation_codes()
        {
            var entries = new List<StagingEntryDeclaration>
            {
                new StagingEntryDeclaration("/s1", StagingEntryType.Int, false, false, new[] { "/s1/*" }, Array.Empty<string>()),
                new StagingEntryDeclaration("/s2", StagingEntryType.Int, true, true, new[] { "/s2/*" }, Array.Empty<string>()),
                new StagingEntryDeclaration("/s3", StagingEntryType.Int, true, false, new[] { "/s3/[bad" }, Array.Empty<string>()),
                new StagingEntryDeclaration("/s4", StagingEntryType.Int, true, false, new[] { "/missing/*" }, Array.Empty<string>()),
                new StagingEntryDeclaration("/s5", StagingEntryType.Int, false, false, Array.Empty<string>(), new[] { "/missing/*" }),
                new StagingEntryDeclaration("/s6", StagingEntryType.Int, false, false, Array.Empty<string>(), new[] { "/s6-target" }),
                new StagingEntryDeclaration("/s6-target", StagingEntryType.String, false, false, Array.Empty<string>(), Array.Empty<string>()),
                new StagingEntryDeclaration("/s7", StagingEntryType.Int, false, false, Array.Empty<string>(), new[] { "/s7" }),
                new StagingEntryDeclaration("/s8", StagingEntryType.Blob, false, true, Array.Empty<string>(), Array.Empty<string>()),
                new StagingEntryDeclaration("/s9", StagingEntryType.Int, false, false, Array.Empty<string>(), Array.Empty<string>()),
                new StagingEntryDeclaration("/s9", StagingEntryType.Int, false, false, Array.Empty<string>(), Array.Empty<string>())
            };

            Assert.That(StagingPlan.TryCompile(new StagingDeclaration(entries), out _, out var errors), Is.False);
            var codes = new HashSet<string>();
            foreach (var error in errors) codes.Add(error.Code);
            CollectionAssert.IsSupersetOf(codes, new[] { "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9" });
        }

        [Test]
        public void Handle_records_values_and_triggers_only_on_nonzero()
        {
            var entries = new[]
            {
                new StagingEntryDeclaration("/value", StagingEntryType.Int, false, true, Array.Empty<string>(), Array.Empty<string>()),
                new StagingEntryDeclaration("/apply", StagingEntryType.Int, true, false, new[] { "/*" }, Array.Empty<string>())
            };
            Assert.That(StagingPlan.TryCompile(new StagingDeclaration(entries), out var plan, out _), Is.True);
            var engine = new StagingEngine(plan);
            Assert.That(engine.Handle("/value", StagingValue.FromInt(4)).Recorded, Is.True);
            Assert.That(engine.Handle("/apply", StagingValue.FromInt(0)).ApplyTriggered, Is.False);
            Assert.That(engine.Handle("/apply", StagingValue.FromInt(1)).ApplyTriggered, Is.True);
        }
    }
}
