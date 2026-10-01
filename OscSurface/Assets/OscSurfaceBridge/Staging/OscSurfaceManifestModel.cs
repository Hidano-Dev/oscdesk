using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace OscDesk.Staging
{
    // 列挙型の数値の並びは OscSurfaceManifestAsset の WidgetType / DefaultKind と一致させる。
    // アダプタは整数のキャストで写し、範囲外の値は検証(V9)で拒否する
    public enum ManifestWidgetKind
    {
        Fader,
        Button,
        Toggle,
        Xy,
        Text,
        Input,
        Select
    }

    public enum ManifestDefaultKind
    {
        None,
        Int,
        Float,
        String,
        Bool
    }

    /// <summary>起動の識別子と構造の世代の組。マニフェストと stats に載せる。</summary>
    public readonly struct ManifestOrigin
    {
        public const int MaxBootIdLength = 64;

        public ManifestOrigin(string bootId, int structureGeneration)
        {
            if (string.IsNullOrEmpty(bootId) || bootId.Length > MaxBootIdLength)
            {
                throw new ArgumentException("bootId must be 1 to 64 characters.", nameof(bootId));
            }

            if (structureGeneration < 1)
            {
                throw new ArgumentOutOfRangeException(nameof(structureGeneration), "structureGeneration must be 1 or greater.");
            }

            BootId = bootId;
            StructureGeneration = structureGeneration;
        }

        public string BootId { get; }
        public int StructureGeneration { get; }
    }

    public sealed class ManifestIssue
    {
        public ManifestIssue(string code, string address, string message)
        {
            Code = code ?? string.Empty;
            Address = address ?? string.Empty;
            Message = message ?? string.Empty;
        }

        /// <summary>"V1".. の検証コード、または staging の "S1".."S9"。</summary>
        public string Code { get; }

        /// <summary>対象のアドレス。無ければ空文字。</summary>
        public string Address { get; }

        public string Message { get; }
    }

    public sealed class ManifestSnapshotOptionList
    {
        public ManifestSnapshotOptionList(string key, IReadOnlyList<string> values)
        {
            Key = key;
            Values = ManifestModelCopy.List(values);
        }

        public string Key { get; }

        /// <summary>null を許す(検証で拒否する)。</summary>
        public IReadOnlyList<string> Values { get; }
    }

    public sealed class ManifestSnapshotEntry
    {
        public ManifestSnapshotEntry(
            string id,
            string address,
            string label,
            StagingEntryType type,
            ManifestWidgetKind widget,
            bool hasRange,
            float rangeMin,
            float rangeMax,
            ManifestDefaultKind defaultKind,
            int defaultInt,
            float defaultFloat,
            string defaultString,
            bool defaultBool,
            string group,
            bool hasOptions,
            IReadOnlyList<string> options,
            string optionsRef,
            string pattern,
            bool staged,
            IReadOnlyList<string> appliesTo,
            IReadOnlyList<string> expandsTo)
        {
            Id = id;
            Address = address;
            Label = label;
            Type = type;
            Widget = widget;
            HasRange = hasRange;
            RangeMin = rangeMin;
            RangeMax = rangeMax;
            DefaultKind = defaultKind;
            DefaultInt = defaultInt;
            DefaultFloat = defaultFloat;
            DefaultString = defaultString;
            DefaultBool = defaultBool;
            Group = group;
            HasOptions = hasOptions;
            Options = ManifestModelCopy.List(options);
            OptionsRef = optionsRef;
            Pattern = pattern;
            Staged = staged;
            AppliesTo = ManifestModelCopy.List(appliesTo);
            ExpandsTo = ManifestModelCopy.List(expandsTo);
        }

        public string Id { get; }
        public string Address { get; }
        public string Label { get; }
        public StagingEntryType Type { get; }
        public ManifestWidgetKind Widget { get; }
        public bool HasRange { get; }
        public float RangeMin { get; }
        public float RangeMax { get; }
        public ManifestDefaultKind DefaultKind { get; }
        public int DefaultInt { get; }
        public float DefaultFloat { get; }
        public string DefaultString { get; }
        public bool DefaultBool { get; }
        public string Group { get; }
        public bool HasOptions { get; }
        public IReadOnlyList<string> Options { get; }
        public string OptionsRef { get; }
        public string Pattern { get; }
        public bool Staged { get; }
        public IReadOnlyList<string> AppliesTo { get; }
        public IReadOnlyList<string> ExpandsTo { get; }

        /// <summary>id が null または空ならアドレス。</summary>
        public string EffectiveId => string.IsNullOrEmpty(Id) ? Address : Id;
    }

    /// <summary>アセットの不変な写し。構築時に全リストを複製し、以後変わらない。</summary>
    public sealed class ManifestSnapshot
    {
        public ManifestSnapshot(
            string projectId,
            IReadOnlyList<ManifestSnapshotEntry> entries,
            IReadOnlyList<ManifestSnapshotOptionList> optionLists)
        {
            ProjectId = projectId;
            Entries = ManifestModelCopy.List(entries);
            OptionLists = ManifestModelCopy.List(optionLists);
        }

        public string ProjectId { get; }

        /// <summary>null を許す(検証で拒否する)。null の要素も保持する。</summary>
        public IReadOnlyList<ManifestSnapshotEntry> Entries { get; }

        /// <summary>null を許す(検証で拒否する)。null の要素も保持する。</summary>
        public IReadOnlyList<ManifestSnapshotOptionList> OptionLists { get; }
    }

    internal static class ManifestModelCopy
    {
        // null は null のまま保持し、null でなければ要素ごと(null 要素を含めて)複製する
        public static IReadOnlyList<T> List<T>(IReadOnlyList<T> source)
        {
            if (source == null)
            {
                return null;
            }

            var copy = new T[source.Count];
            for (var i = 0; i < source.Count; i++)
            {
                copy[i] = source[i];
            }

            return copy;
        }
    }

    public static class ManifestLimits
    {
        /// <summary>shared の MANIFEST_SIZE.WARNING_BYTES と同値。付録一致ガードが照合する。</summary>
        public const int WarningBytes = 57344;

        /// <summary>shared の MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES と同値。付録一致ガードが照合する。</summary>
        public const int PracticalLimitBytes = 61440;
    }

    public static class ManifestValidator
    {
        /// <summary>妥当なら空のリスト。最初の違反で打ち切らず、従来の検証と同じ順で集める。</summary>
        public static IReadOnlyList<ManifestIssue> Validate(ManifestSnapshot snapshot)
        {
            var issues = new List<ManifestIssue>();
            if (snapshot == null)
            {
                issues.Add(new ManifestIssue("V1", string.Empty, "A manifest snapshot is required."));
                return issues;
            }

            if (string.IsNullOrWhiteSpace(snapshot.ProjectId))
            {
                issues.Add(new ManifestIssue("V2", string.Empty, "projectId must not be empty."));
            }

            if (snapshot.Entries == null)
            {
                issues.Add(new ManifestIssue("V3", string.Empty, "entries must not be null."));
            }

            if (snapshot.OptionLists == null)
            {
                issues.Add(new ManifestIssue("V4", string.Empty, "optionLists must not be null."));
            }

            var optionListKeys = new HashSet<string>(StringComparer.Ordinal);
            if (snapshot.OptionLists != null)
            {
                foreach (var optionList in snapshot.OptionLists)
                {
                    if (optionList == null || string.IsNullOrEmpty(optionList.Key))
                    {
                        issues.Add(new ManifestIssue("V5", string.Empty, "An option list has a null or empty key."));
                        continue;
                    }

                    if (!optionListKeys.Add(optionList.Key))
                    {
                        issues.Add(new ManifestIssue(
                            "V6", string.Empty, "Duplicate option list key \"" + optionList.Key + "\"."));
                    }

                    if (optionList.Values == null || ContainsNull(optionList.Values))
                    {
                        issues.Add(new ManifestIssue(
                            "V7", string.Empty, "Option list \"" + optionList.Key + "\" contains null values."));
                    }
                }
            }

            if (snapshot.Entries != null)
            {
                foreach (var entry in snapshot.Entries)
                {
                    ValidateEntry(entry, snapshot.OptionLists != null, optionListKeys, issues);
                }
            }

            return issues;
        }

        private static void ValidateEntry(
            ManifestSnapshotEntry entry,
            bool optionListsPresent,
            HashSet<string> optionListKeys,
            List<ManifestIssue> issues)
        {
            if (entry == null || string.IsNullOrWhiteSpace(entry.Address))
            {
                issues.Add(new ManifestIssue("V8", entry?.Address, "An entry is null or has an empty address."));
                return;
            }

            var address = entry.Address;

            if (!Enum.IsDefined(typeof(StagingEntryType), entry.Type)
                || !Enum.IsDefined(typeof(ManifestWidgetKind), entry.Widget)
                || !Enum.IsDefined(typeof(ManifestDefaultKind), entry.DefaultKind))
            {
                issues.Add(new ManifestIssue("V9", address, "The entry has an undefined enum value."));
                return;
            }

            if (entry.Widget == ManifestWidgetKind.Input
                && entry.Type != StagingEntryType.String
                && entry.Type != StagingEntryType.Int
                && entry.Type != StagingEntryType.Float)
            {
                issues.Add(new ManifestIssue("V10", address, "An input entry must use string, int, or float type."));
            }

            if (entry.Widget == ManifestWidgetKind.Select && entry.Type != StagingEntryType.String)
            {
                issues.Add(new ManifestIssue("V11", address, "A select entry must use string type."));
            }

            var hasOptionsRef = !string.IsNullOrEmpty(entry.OptionsRef);
            if (entry.Widget == ManifestWidgetKind.Select && entry.HasOptions == hasOptionsRef)
            {
                issues.Add(new ManifestIssue(
                    "V12", address, "A select entry must define exactly one of options or optionsRef."));
            }

            if (entry.HasOptions && (entry.Options == null || ContainsNull(entry.Options)))
            {
                issues.Add(new ManifestIssue("V13", address, "options must not contain null values."));
            }

            // optionLists 自体が null のときは V4 が原因なので、参照切れを重ねて報告しない
            if (hasOptionsRef && optionListsPresent && !optionListKeys.Contains(entry.OptionsRef))
            {
                issues.Add(new ManifestIssue(
                    "V14", address, "optionsRef references missing option list \"" + entry.OptionsRef + "\"."));
            }

            if (!string.IsNullOrEmpty(entry.Pattern))
            {
                if (entry.Type != StagingEntryType.String)
                {
                    issues.Add(new ManifestIssue("V15", address, "pattern requires string type."));
                }
                else
                {
                    try
                    {
                        new Regex(entry.Pattern);
                    }
                    catch (ArgumentException exception)
                    {
                        issues.Add(new ManifestIssue(
                            "V16", address, "Invalid pattern \"" + entry.Pattern + "\": " + exception.Message));
                    }
                }
            }

            if (!string.IsNullOrEmpty(entry.Id) && string.IsNullOrWhiteSpace(entry.Id))
            {
                issues.Add(new ManifestIssue("V17", address, "id must not be whitespace only."));
            }
        }

        private static bool ContainsNull(IReadOnlyList<string> values)
        {
            for (var i = 0; i < values.Count; i++)
            {
                if (values[i] == null)
                {
                    return true;
                }
            }

            return false;
        }
    }

    public static class ManifestJsonWriter
    {
        /// <summary>Validate が空を返したスナップショットにだけ使う。
        /// 同じスナップショット・同じ現在値・同じ組からは同じバイト列が出る。</summary>
        public static string WriteManifest(ManifestSnapshot snapshot, StagingEngine values, ManifestOrigin origin)
        {
            var sb = new StringBuilder();
            sb.Append("{\"version\":1,\"projectId\":").Append(Quote(snapshot.ProjectId));
            AppendOrigin(sb, origin);
            sb.Append(",\"entries\":[");

            for (var i = 0; i < snapshot.Entries.Count; i++)
            {
                var entry = snapshot.Entries[i];

                if (i > 0)
                {
                    sb.Append(',');
                }

                sb.Append("{\"address\":").Append(Quote(entry.Address));
                sb.Append(",\"label\":").Append(Quote(entry.Label));
                sb.Append(",\"type\":").Append(Quote(TypeName(entry.Type)));
                sb.Append(",\"widget\":").Append(Quote(WidgetName(entry.Widget)));

                if (entry.HasRange)
                {
                    sb.Append(",\"range\":[").Append(FormatNumber(entry.RangeMin))
                        .Append(',').Append(FormatNumber(entry.RangeMax)).Append(']');
                }

                if (values != null && values.TryGetCurrentValue(entry.Address, out var current))
                {
                    sb.Append(",\"default\":").Append(current.ToJsonLiteral());
                }

                if (!string.IsNullOrEmpty(entry.Group))
                {
                    sb.Append(",\"group\":").Append(Quote(entry.Group));
                }

                if (entry.HasOptions)
                {
                    sb.Append(",\"options\":");
                    AppendStringArray(sb, entry.Options);
                }

                if (!string.IsNullOrEmpty(entry.OptionsRef))
                {
                    sb.Append(",\"optionsRef\":").Append(Quote(entry.OptionsRef));
                }

                if (!string.IsNullOrEmpty(entry.Pattern))
                {
                    sb.Append(",\"pattern\":").Append(Quote(entry.Pattern));
                }

                if (entry.Staged)
                {
                    sb.Append(",\"staged\":true");
                }

                if (entry.Widget == ManifestWidgetKind.Button
                    && entry.AppliesTo != null
                    && entry.AppliesTo.Count > 0)
                {
                    sb.Append(",\"appliesTo\":");
                    AppendStringArray(sb, entry.AppliesTo);
                }

                sb.Append('}');
            }

            sb.Append(']');

            if (snapshot.OptionLists.Count > 0)
            {
                sb.Append(",\"optionLists\":{");
                for (var listIndex = 0; listIndex < snapshot.OptionLists.Count; listIndex++)
                {
                    if (listIndex > 0)
                    {
                        sb.Append(',');
                    }

                    var optionList = snapshot.OptionLists[listIndex];
                    sb.Append(Quote(optionList.Key)).Append(": ");
                    AppendStringArray(sb, optionList.Values);
                }

                sb.Append('}');
            }

            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>従来の stats JSON の末尾に bootId と structureGeneration を足す。</summary>
        public static string WriteStats(int received, int parseErrors, string lastReceivedAt, ManifestOrigin origin)
        {
            var sb = new StringBuilder();
            sb.Append("{\"received\":").Append(received.ToString(CultureInfo.InvariantCulture))
                .Append(",\"parseErrors\":").Append(parseErrors.ToString(CultureInfo.InvariantCulture))
                .Append(",\"lastReceivedAt\":").Append(Quote(lastReceivedAt ?? string.Empty));
            AppendOrigin(sb, origin);
            sb.Append('}');
            return sb.ToString();
        }

        public static int Utf8ByteCount(string json)
        {
            return Encoding.UTF8.GetByteCount(json ?? string.Empty);
        }

        private static void AppendOrigin(StringBuilder sb, ManifestOrigin origin)
        {
            sb.Append(",\"bootId\":").Append(Quote(origin.BootId))
                .Append(",\"structureGeneration\":")
                .Append(origin.StructureGeneration.ToString(CultureInfo.InvariantCulture));
        }

        private static void AppendStringArray(StringBuilder sb, IReadOnlyList<string> values)
        {
            sb.Append('[');
            for (var i = 0; i < values.Count; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }

                sb.Append(Quote(values[i]));
            }

            sb.Append(']');
        }

        private static string TypeName(StagingEntryType type)
        {
            switch (type)
            {
                case StagingEntryType.Int: return "i";
                case StagingEntryType.Float: return "f";
                case StagingEntryType.String: return "s";
                case StagingEntryType.Blob: return "b";
                case StagingEntryType.Bool: return "bool";
                default: return "";
            }
        }

        private static string WidgetName(ManifestWidgetKind widget)
        {
            switch (widget)
            {
                case ManifestWidgetKind.Fader: return "fader";
                case ManifestWidgetKind.Button: return "button";
                case ManifestWidgetKind.Toggle: return "toggle";
                case ManifestWidgetKind.Xy: return "xy";
                case ManifestWidgetKind.Text: return "text";
                case ManifestWidgetKind.Input: return "input";
                case ManifestWidgetKind.Select: return "select";
                default: return "";
            }
        }

        private static string FormatNumber(float value)
        {
            return value.ToString("R", CultureInfo.InvariantCulture);
        }

        private static string Quote(string value)
        {
            var sb = new StringBuilder(value.Length + 2);
            sb.Append('"');

            foreach (var ch in value)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < ' ')
                        {
                            sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(ch);
                        }
                        break;
                }
            }

            sb.Append('"');
            return sb.ToString();
        }
    }
}
