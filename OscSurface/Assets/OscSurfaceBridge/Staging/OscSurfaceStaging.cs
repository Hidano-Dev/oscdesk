using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace OscDesk.Staging
{
    public enum StagingValueKind
    {
        None,
        Int,
        Float,
        String
    }

    public readonly struct StagingValue : IEquatable<StagingValue>
    {
        public StagingValueKind Kind { get; }
        public int IntValue { get; }
        public float FloatValue { get; }
        public string StringValue { get; }

        public static StagingValue None => new StagingValue(StagingValueKind.None, 0, 0f, null);

        private StagingValue(StagingValueKind kind, int intValue, float floatValue, string stringValue)
        {
            Kind = kind;
            IntValue = intValue;
            FloatValue = floatValue;
            StringValue = stringValue;
        }

        public static StagingValue FromInt(int value)
        {
            return new StagingValue(StagingValueKind.Int, value, 0f, null);
        }

        public static StagingValue FromFloat(float value)
        {
            return new StagingValue(StagingValueKind.Float, 0, value, null);
        }

        public static StagingValue FromString(string value)
        {
            return new StagingValue(StagingValueKind.String, 0, 0f, value ?? string.Empty);
        }

        public bool IsTruthy
        {
            get
            {
                switch (Kind)
                {
                    case StagingValueKind.Int:
                        return IntValue != 0;
                    case StagingValueKind.Float:
                        return FloatValue != 0f;
                    case StagingValueKind.String:
                        return !string.IsNullOrEmpty(StringValue);
                    default:
                        return false;
                }
            }
        }

        public bool Equals(StagingValue other)
        {
            return Kind == other.Kind
                && IntValue == other.IntValue
                && FloatValue.Equals(other.FloatValue)
                && string.Equals(StringValue, other.StringValue, StringComparison.Ordinal);
        }

        public override bool Equals(object obj)
        {
            return obj is StagingValue && Equals((StagingValue)obj);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                var hash = (int)Kind;
                hash = (hash * 397) ^ IntValue;
                hash = (hash * 397) ^ FloatValue.GetHashCode();
                hash = (hash * 397) ^ (StringValue == null ? 0 : StringValue.GetHashCode());
                return hash;
            }
        }

        public static bool operator ==(StagingValue left, StagingValue right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(StagingValue left, StagingValue right)
        {
            return !left.Equals(right);
        }

        public string ToJsonLiteral()
        {
            switch (Kind)
            {
                case StagingValueKind.Int:
                    return IntValue.ToString(CultureInfo.InvariantCulture);
                case StagingValueKind.Float:
                    return FloatValue.ToString("R", CultureInfo.InvariantCulture);
                case StagingValueKind.String:
                    return Quote(StringValue);
                default:
                    throw new InvalidOperationException("A None staging value has no JSON literal.");
            }
        }

        private static string Quote(string value)
        {
            var builder = new StringBuilder(value.Length + 2);
            builder.Append('"');

            foreach (var character in value)
            {
                switch (character)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (character < ' ')
                        {
                            builder.Append("\\u")
                                .Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            builder.Append(character);
                        }
                        break;
                }
            }

            builder.Append('"');
            return builder.ToString();
        }
    }

    public enum StagingEntryType
    {
        Int,
        Float,
        String,
        Blob,
        Bool
    }

    public sealed class StagingEntryDeclaration
    {
        public string Address { get; }
        public StagingEntryType Type { get; }
        public bool IsButton { get; }
        public bool Staged { get; }
        public IReadOnlyList<string> AppliesTo { get; }
        public IReadOnlyList<string> ExpandsTo { get; }

        public StagingEntryDeclaration(
            string address,
            StagingEntryType type,
            bool isButton,
            bool staged,
            IReadOnlyList<string> appliesTo,
            IReadOnlyList<string> expandsTo)
        {
            Address = address;
            Type = type;
            IsButton = isButton;
            Staged = staged;
            AppliesTo = Copy(appliesTo);
            ExpandsTo = Copy(expandsTo);
        }

        private static IReadOnlyList<string> Copy(IReadOnlyList<string> values)
        {
            if (values == null || values.Count == 0)
            {
                return Array.Empty<string>();
            }

            var copy = new string[values.Count];
            for (var i = 0; i < values.Count; i++)
            {
                copy[i] = values[i];
            }

            return copy;
        }
    }

    public sealed class StagingDeclaration
    {
        public IReadOnlyList<StagingEntryDeclaration> Entries { get; }

        public StagingDeclaration(IReadOnlyList<StagingEntryDeclaration> entries)
        {
            Entries = entries ?? Array.Empty<StagingEntryDeclaration>();
        }
    }

    public sealed class StagingCompileError
    {
        public string Code { get; }
        public string Address { get; }
        public string Message { get; }

        public StagingCompileError(string code, string address, string message)
        {
            Code = code;
            Address = address ?? string.Empty;
            Message = message;
        }
    }

    public sealed class StagingCompiledEntry
    {
        public StagingEntryDeclaration Declaration { get; }
        public bool Staged { get; }

        internal StagingCompiledEntry(StagingEntryDeclaration declaration)
        {
            Declaration = declaration;
            Staged = declaration != null && declaration.Staged;
        }
    }

    public sealed class StagingCompiledTrigger
    {
        public string Address { get; }
        public IReadOnlyList<string> AppliesTo { get; }

        internal StagingCompiledTrigger(string address, IReadOnlyList<string> appliesTo)
        {
            Address = address;
            AppliesTo = appliesTo ?? Array.Empty<string>();
        }
    }

    public sealed class StagingCompiledExpansion
    {
        public string Address { get; }
        public IReadOnlyList<string> Targets { get; }

        internal StagingCompiledExpansion(string address, IReadOnlyList<string> targets)
        {
            Address = address;
            Targets = targets ?? Array.Empty<string>();
        }
    }

    public sealed class StagingPlan
    {
        private readonly Dictionary<string, StagingCompiledEntry> entriesByAddress;
        private readonly Dictionary<string, StagingCompiledTrigger> triggersByAddress;
        private readonly Dictionary<string, StagingCompiledExpansion> expansionsByAddress;

        public static StagingPlan Empty { get; } = new StagingPlan(
            Array.Empty<StagingCompiledEntry>(),
            new Dictionary<string, StagingCompiledTrigger>(StringComparer.Ordinal),
            new Dictionary<string, StagingCompiledExpansion>(StringComparer.Ordinal),
            false);

        public bool HasStagingDeclarations { get; }
        public IReadOnlyList<StagingCompiledEntry> Entries { get; }

        private StagingPlan(
            IReadOnlyList<StagingCompiledEntry> entries,
            Dictionary<string, StagingCompiledTrigger> triggers,
            Dictionary<string, StagingCompiledExpansion> expansions,
            bool hasStagingDeclarations)
        {
            Entries = entries;
            entriesByAddress = new Dictionary<string, StagingCompiledEntry>(StringComparer.Ordinal);
            foreach (var entry in entries)
            {
                entriesByAddress[entry.Declaration.Address] = entry;
            }

            triggersByAddress = triggers;
            expansionsByAddress = expansions;
            HasStagingDeclarations = hasStagingDeclarations;
        }

        public bool TryGetEntry(string address, out StagingCompiledEntry entry)
        {
            return entriesByAddress.TryGetValue(address, out entry);
        }

        public bool TryGetTrigger(string address, out StagingCompiledTrigger trigger)
        {
            return triggersByAddress.TryGetValue(address, out trigger);
        }

        public bool TryGetExpansion(string address, out StagingCompiledExpansion expansion)
        {
            return expansionsByAddress.TryGetValue(address, out expansion);
        }

        public static bool TryCompile(
            StagingDeclaration declaration,
            out StagingPlan plan,
            out IReadOnlyList<StagingCompileError> errors)
        {
            var found = new List<StagingCompileError>();
            var sourceEntries = declaration == null || declaration.Entries == null
                ? Array.Empty<StagingEntryDeclaration>()
                : declaration.Entries;
            var declared = new Dictionary<string, StagingEntryDeclaration>(StringComparer.Ordinal);

            for (var i = 0; i < sourceEntries.Count; i++)
            {
                var entry = sourceEntries[i];
                if (entry == null || string.IsNullOrEmpty(entry.Address))
                {
                    continue;
                }

                if (declared.ContainsKey(entry.Address))
                {
                    AddError(found, "S9", entry.Address, "The address is declared more than once.");
                }
                else
                {
                    declared.Add(entry.Address, entry);
                }
            }

            var validEntries = new List<StagingEntryDeclaration>();
            foreach (var entry in sourceEntries)
            {
                if (entry == null || string.IsNullOrEmpty(entry.Address) || !declared.ContainsKey(entry.Address))
                {
                    continue;
                }

                validEntries.Add(entry);
                if (entry.Staged && entry.Type == StagingEntryType.Blob)
                {
                    AddError(found, "S8", entry.Address, "A Blob entry cannot be staged.");
                }

                ValidatePatterns(entry.AppliesTo, entry.Address, found);
                ValidatePatterns(entry.ExpandsTo, entry.Address, found);

                if (entry.AppliesTo.Count > 0 && !entry.IsButton)
                {
                    AddError(found, "S1", entry.Address, "Only a button entry may declare AppliesTo.");
                }

                if (entry.AppliesTo.Count > 0 && entry.Staged)
                {
                    AddError(found, "S2", entry.Address, "An apply trigger cannot itself be staged.");
                }
            }

            var compiledTriggers = new Dictionary<string, StagingCompiledTrigger>(StringComparer.Ordinal);
            foreach (var entry in validEntries)
            {
                if (entry.AppliesTo.Count == 0 || compiledTriggers.ContainsKey(entry.Address))
                {
                    continue;
                }

                var resolved = ResolvePatterns(entry.AppliesTo, declared.Keys);
                var stagedResolved = FilterStaged(resolved, declared);
                if (resolved.Count == 0 || stagedResolved.Count == 0)
                {
                    AddError(found, "S4", entry.Address, "AppliesTo resolves to no staged address.");
                }

                compiledTriggers.Add(entry.Address, new StagingCompiledTrigger(entry.Address, stagedResolved));
            }

            var compiledExpansions = new Dictionary<string, StagingCompiledExpansion>(StringComparer.Ordinal);
            foreach (var entry in validEntries)
            {
                if (entry.ExpandsTo.Count == 0 || compiledExpansions.ContainsKey(entry.Address))
                {
                    continue;
                }

                var resolved = ResolvePatterns(entry.ExpandsTo, declared.Keys);
                if (resolved.Count == 0)
                {
                    AddError(found, "S5", entry.Address, "ExpandsTo resolves to no declared address.");
                }

                var targets = new List<string>();
                foreach (var target in resolved)
                {
                    if (string.Equals(target, entry.Address, StringComparison.Ordinal))
                    {
                        continue;
                    }

                    if (declared[target].Type != entry.Type)
                    {
                        AddError(found, "S6", entry.Address, "An expansion target has a different entry type.");
                    }
                    else
                    {
                        targets.Add(target);
                    }
                }

                if (targets.Count == 0)
                {
                    AddError(found, "S7", entry.Address, "Expansion resolves only to its source or to no target.");
                }

                compiledExpansions.Add(entry.Address, new StagingCompiledExpansion(entry.Address, targets));
            }

            if (found.Count > 0)
            {
                found.Sort((left, right) =>
                {
                    var code = string.CompareOrdinal(left.Code, right.Code);
                    return code != 0 ? code : string.CompareOrdinal(left.Address, right.Address);
                });
                plan = Empty;
                errors = found;
                return false;
            }

            var compiledEntries = new List<StagingCompiledEntry>();
            foreach (var entry in validEntries)
            {
                compiledEntries.Add(new StagingCompiledEntry(entry));
            }

            plan = new StagingPlan(
                compiledEntries,
                compiledTriggers,
                compiledExpansions,
                compiledTriggers.Count > 0 || compiledExpansions.Count > 0 || compiledEntries.Exists(e => e.Staged));
            errors = Array.Empty<StagingCompileError>();
            return true;
        }

        public static bool MatchesPattern(string pattern, string address)
        {
            if (!TrySplitAddress(pattern, out var patternParts) || !TrySplitAddress(address, out var addressParts)
                || patternParts.Length != addressParts.Length)
            {
                return false;
            }

            for (var i = 0; i < patternParts.Length; i++)
            {
                if (patternParts[i] != "*" && !string.Equals(patternParts[i], addressParts[i], StringComparison.Ordinal))
                {
                    return false;
                }
            }

            return true;
        }

        private static void ValidatePatterns(IReadOnlyList<string> patterns, string address, List<StagingCompileError> errors)
        {
            foreach (var pattern in patterns)
            {
                if (!TrySplitAddress(pattern, out _))
                {
                    AddError(errors, "S3", address, "A pattern has an invalid OSC address shape or wildcard syntax.");
                }
            }
        }

        private static List<string> ResolvePatterns(IReadOnlyList<string> patterns, IEnumerable<string> addresses)
        {
            var resolved = new List<string>();
            foreach (var address in addresses)
            {
                foreach (var pattern in patterns)
                {
                    if (MatchesPattern(pattern, address))
                    {
                        resolved.Add(address);
                        break;
                    }
                }
            }

            return resolved;
        }

        private static List<string> FilterStaged(IEnumerable<string> addresses, Dictionary<string, StagingEntryDeclaration> declared)
        {
            var staged = new List<string>();
            foreach (var address in addresses)
            {
                if (declared[address].Staged)
                {
                    staged.Add(address);
                }
            }

            return staged;
        }

        private static bool TrySplitAddress(string address, out string[] parts)
        {
            parts = null;
            if (string.IsNullOrEmpty(address) || address[0] != '/' || address.Length == 1
                || address[address.Length - 1] == '/' || address.IndexOf("//", StringComparison.Ordinal) >= 0
                || address.IndexOfAny(new[] { '?', '[', ']', '{', '}', ',' }) >= 0)
            {
                return false;
            }

            var split = address.Substring(1).Split('/');
            foreach (var part in split)
            {
                if (part.Length == 0 || (part.IndexOf('*') >= 0 && part != "*"))
                {
                    return false;
                }
            }

            parts = split;
            return true;
        }

        private static void AddError(List<StagingCompileError> errors, string code, string address, string message)
        {
            errors.Add(new StagingCompileError(code, address, message));
        }
    }

    public readonly struct StagingWrite
    {
        public string Address { get; }
        public StagingValue Value { get; }

        public StagingWrite(string address, StagingValue value)
        {
            Address = address;
            Value = value;
        }
    }

    public readonly struct StagingApplyContext
    {
        public string TriggerAddress { get; }
        public IReadOnlyDictionary<string, StagingValue> Values { get; }

        public StagingApplyContext(string triggerAddress, IReadOnlyList<StagingWrite> payload)
        {
            TriggerAddress = triggerAddress ?? string.Empty;
            var values = new Dictionary<string, StagingValue>(StringComparer.Ordinal);
            if (payload != null)
            {
                foreach (var write in payload)
                {
                    values[write.Address] = write.Value;
                }
            }

            Values = values;
        }

        public bool TryGetInt(string address, out int value)
        {
            if (Values.TryGetValue(address, out var stagingValue)
                && stagingValue.Kind == StagingValueKind.Int)
            {
                value = stagingValue.IntValue;
                return true;
            }

            value = 0;
            return false;
        }

        public bool TryGetFloat(string address, out float value)
        {
            if (Values.TryGetValue(address, out var stagingValue)
                && stagingValue.Kind == StagingValueKind.Float)
            {
                value = stagingValue.FloatValue;
                return true;
            }

            value = 0f;
            return false;
        }

        public bool TryGetString(string address, out string value)
        {
            if (Values.TryGetValue(address, out var stagingValue)
                && stagingValue.Kind == StagingValueKind.String)
            {
                value = stagingValue.StringValue;
                return true;
            }

            value = null;
            return false;
        }
    }

    public readonly struct StagingReaction
    {
        public bool Recorded { get; }
        public IReadOnlyList<StagingWrite> ExpansionWrites { get; }
        public bool ApplyTriggered { get; }
        public IReadOnlyList<StagingWrite> ApplyPayload { get; }

        public StagingReaction(
            bool recorded,
            IReadOnlyList<StagingWrite> expansionWrites,
            bool applyTriggered,
            IReadOnlyList<StagingWrite> applyPayload)
        {
            Recorded = recorded;
            ExpansionWrites = expansionWrites ?? Array.Empty<StagingWrite>();
            ApplyTriggered = applyTriggered;
            ApplyPayload = applyPayload ?? Array.Empty<StagingWrite>();
        }
    }

    public sealed class StagingEngine
    {
        private readonly StagingPlan plan;
        private readonly Dictionary<string, StagingValue> currentValues =
            new Dictionary<string, StagingValue>(StringComparer.Ordinal);

        public StagingEngine(StagingPlan plan)
        {
            this.plan = plan ?? StagingPlan.Empty;
        }

        public void SeedInitialValue(string address, StagingValue value)
        {
            if (string.IsNullOrEmpty(address) || !TryNormalizeForEntry(address, value, out var normalized))
            {
                return;
            }

            currentValues[address] = normalized;
        }

        public StagingReaction Handle(string address, StagingValue value)
        {
            if (string.IsNullOrEmpty(address)
                || !TryNormalizeForEntry(address, value, out var normalized))
            {
                return BuildReaction(address, false, StagingValue.None);
            }

            currentValues[address] = normalized;

            var expansionWrites = new List<StagingWrite>();
            if (plan.TryGetExpansion(address, out var expansion))
            {
                foreach (var target in expansion.Targets)
                {
                    if (!TryNormalizeForEntry(target, normalized, out var targetValue))
                    {
                        continue;
                    }

                    currentValues[target] = targetValue;
                    expansionWrites.Add(new StagingWrite(target, targetValue));
                }
            }

            var applyTriggered = plan.TryGetTrigger(address, out var trigger) && normalized.IsTruthy;
            var applyPayload = new List<StagingWrite>();
            if (applyTriggered)
            {
                foreach (var entry in plan.Entries)
                {
                    if (!entry.Staged || !Contains(trigger.AppliesTo, entry.Declaration.Address))
                    {
                        continue;
                    }

                    if (currentValues.TryGetValue(entry.Declaration.Address, out var current))
                    {
                        applyPayload.Add(new StagingWrite(entry.Declaration.Address, current));
                    }
                }
            }

            return new StagingReaction(true, expansionWrites, applyTriggered, applyPayload);
        }

        public bool TryGetCurrentValue(string address, out StagingValue value)
        {
            return currentValues.TryGetValue(address, out value);
        }

        public IReadOnlyDictionary<string, StagingValue> Snapshot()
        {
            return new Dictionary<string, StagingValue>(currentValues, StringComparer.Ordinal);
        }

        private StagingReaction BuildReaction(string address, bool recorded, StagingValue value)
        {
            var expansionWrites = new List<StagingWrite>();
            if (recorded && plan.TryGetExpansion(address, out var expansion))
            {
                foreach (var target in expansion.Targets)
                {
                    currentValues[target] = value;
                    expansionWrites.Add(new StagingWrite(target, value));
                }
            }

            return new StagingReaction(recorded, expansionWrites, false, Array.Empty<StagingWrite>());
        }

        private bool TryNormalizeForEntry(string address, StagingValue value, out StagingValue normalized)
        {
            normalized = StagingValue.None;
            if (!plan.TryGetEntry(address, out var entry) || value.Kind == StagingValueKind.None)
            {
                return false;
            }

            switch (entry.Declaration.Type)
            {
                case StagingEntryType.Int:
                    if (value.Kind == StagingValueKind.Int)
                    {
                        normalized = value;
                        return true;
                    }
                    return false;
                case StagingEntryType.Float:
                    if (value.Kind == StagingValueKind.Float)
                    {
                        normalized = value;
                        return true;
                    }
                    if (value.Kind == StagingValueKind.Int)
                    {
                        normalized = StagingValue.FromFloat(value.IntValue);
                        return true;
                    }
                    return false;
                case StagingEntryType.String:
                    if (value.Kind == StagingValueKind.String)
                    {
                        normalized = value;
                        return true;
                    }
                    return false;
                case StagingEntryType.Bool:
                    if (value.Kind == StagingValueKind.Int && (value.IntValue == 0 || value.IntValue == 1))
                    {
                        normalized = StagingValue.FromInt(value.IntValue);
                        return true;
                    }
                    return false;
                default:
                    return false;
            }
        }

        private static bool Contains(IReadOnlyList<string> values, string address)
        {
            for (var i = 0; i < values.Count; i++)
            {
                if (string.Equals(values[i], address, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
