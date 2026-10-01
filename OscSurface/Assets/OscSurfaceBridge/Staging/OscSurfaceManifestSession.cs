using System;
using System.Collections.Generic;

namespace OscDesk.Staging
{
    public enum ManifestSessionState
    {
        Uninitialized,
        NoValidManifest,
        Suppressed,
        Ready
    }

    public enum ManifestChangeFailure
    {
        None,
        NotInitialized,
        Inactive,
        Suppressed,
        InvalidManifest,
        ProjectIdMismatch,
        AddressReused,
        StagingCompileFailed,
        PayloadTooLarge,
        StructuralChangeRequiresReinject
    }

    public sealed class ManifestChangeResult
    {
        public ManifestChangeResult(
            ManifestChangeFailure failure,
            IReadOnlyList<ManifestIssue> issues,
            int payloadBytes,
            int structureGeneration,
            bool generationAdvanced,
            bool stateChangedSinceCheck = false)
        {
            Failure = failure;
            Issues = issues ?? Array.Empty<ManifestIssue>();
            PayloadBytes = payloadBytes;
            StructureGeneration = structureGeneration;
            GenerationAdvanced = generationAdvanced;
            StateChangedSinceCheck = stateChangedSinceCheck;
        }

        public bool Succeeded => Failure == ManifestChangeFailure.None;
        public ManifestChangeFailure Failure { get; }

        /// <summary>事前検査の後の状態変化で判定が変わった。</summary>
        public bool StateChangedSinceCheck { get; }

        /// <summary>測っていなければ -1。</summary>
        public int PayloadBytes { get; }

        public IReadOnlyList<ManifestIssue> Issues { get; }

        /// <summary>操作後の世代。</summary>
        public int StructureGeneration { get; }

        public bool GenerationAdvanced { get; }
    }

    public sealed class ManifestInitResult
    {
        public ManifestInitResult(
            ManifestSessionState state,
            IReadOnlyList<ManifestIssue> issues,
            IReadOnlyList<string> unseededAddresses)
        {
            State = state;
            Issues = issues ?? Array.Empty<ManifestIssue>();
            UnseededAddresses = unseededAddresses ?? Array.Empty<string>();
        }

        public ManifestSessionState State { get; }
        public IReadOnlyList<ManifestIssue> Issues { get; }
        public IReadOnlyList<string> UnseededAddresses { get; }
    }

    /// <summary>
    /// 現在のスナップショット・計画と現在値・起動の識別子・構造の世代・アドレスと識別子の対応表を持つ。
    /// すべての操作はメインスレッドから呼ぶ前提で、ロックは持たない。
    /// </summary>
    public sealed class ManifestSession
    {
        private const string NotReadyCode = "NotReady";
        private const string ContentUpdateCode = "F6";

        private readonly string bootId;
        private readonly Dictionary<string, string> idByAddress = new Dictionary<string, string>(StringComparer.Ordinal);
        private ManifestSnapshot snapshot;
        private StagingEngine engine = new StagingEngine(StagingPlan.Empty);
        private int structureGeneration = 1;
        private int stateVersion;

        public ManifestSession(string bootId)
        {
            // 組の検証(1〜64 文字)をここで行い、不正な値を持ち込ませない
            new ManifestOrigin(bootId, 1);
            this.bootId = bootId;
        }

        public ManifestSessionState State { get; private set; } = ManifestSessionState.Uninitialized;

        public ManifestOrigin Origin => new ManifestOrigin(bootId, structureGeneration);

        /// <summary>projectId の基準。検証が通った初期化で記録し、無ければ null。</summary>
        public string ProjectId { get; private set; }

        /// <summary>値の記録・確定・内容の公開で進む状態の版。</summary>
        public int StateVersion => stateVersion;

        public IReadOnlyDictionary<string, string> AddressToId => idByAddress;

        /// <summary>1 回だけ呼ぶ。失敗しても受信とエコーは続けられる(従来の Awake と同じ)。</summary>
        public ManifestInitResult Initialize(ManifestSnapshot initial)
        {
            if (State != ManifestSessionState.Uninitialized)
            {
                throw new InvalidOperationException("ManifestSession is already initialized.");
            }

            var issues = new List<ManifestIssue>(ManifestValidator.Validate(initial));
            if (issues.Count > 0)
            {
                State = ManifestSessionState.NoValidManifest;
                return new ManifestInitResult(State, issues, null);
            }

            snapshot = initial;
            ProjectId = initial.ProjectId;
            foreach (var entry in initial.Entries)
            {
                idByAddress[entry.Address] = entry.EffectiveId;
            }

            if (StagingPlan.TryCompile(ToDeclaration(initial), out var plan, out var compileErrors))
            {
                engine = new StagingEngine(plan);
                State = ManifestSessionState.Ready;
            }
            else
            {
                foreach (var error in compileErrors)
                {
                    issues.Add(new ManifestIssue(error.Code, error.Address, error.Message));
                }

                // fail-safe: 不正な staging 宣言でも通常の OSC 処理は止めない
                engine = new StagingEngine(StagingPlan.Empty);
                State = ManifestSessionState.Suppressed;
            }

            var unseeded = new List<string>();
            foreach (var entry in initial.Entries)
            {
                if (!TryGetDefaultValue(entry, out var defaultValue))
                {
                    continue;
                }

                if (!engine.SeedInitialValue(entry.Address, defaultValue))
                {
                    unseeded.Add(entry.Address);
                }
            }

            return new ManifestInitResult(State, issues, unseeded);
        }

        /// <summary>受信値を中核へ渡す。記録できたら状態の版を進める。</summary>
        public StagingReaction Handle(string address, StagingValue value)
        {
            var reaction = engine.Handle(address, value);
            if (reaction.Recorded)
            {
                stateVersion++;
            }

            return reaction;
        }

        public bool TryGetCurrentValue(string address, out StagingValue value)
        {
            return engine.TryGetCurrentValue(address, out value);
        }

        /// <summary>準備完了のときだけ組み立てる。何度呼んでも世代は進まない。</summary>
        public bool TryBuildManifestJson(out string json, out int payloadBytes, out IReadOnlyList<ManifestIssue> issues)
        {
            json = null;
            payloadBytes = -1;
            if (State != ManifestSessionState.Ready)
            {
                issues = new[]
                {
                    new ManifestIssue(NotReadyCode, string.Empty, "The session is not ready: " + State + ".")
                };
                return false;
            }

            json = ManifestJsonWriter.WriteManifest(snapshot, engine, Origin);
            payloadBytes = ManifestJsonWriter.Utf8ByteCount(json);
            issues = Array.Empty<ManifestIssue>();
            return true;
        }

        public string BuildStatsJson(int received, int parseErrors, string lastReceivedAt)
        {
            return ManifestJsonWriter.WriteStats(received, parseErrors, lastReceivedAt, Origin);
        }

        /// <summary>
        /// F-6。許可リスト(表示の項目・トップレベルの選択肢リスト・button 以外どうしのウィジェットの種類)だけの
        /// 差分なら、スナップショットを差し替えて世代を 1 進める。成功時の送信はアダプタが行う。
        /// </summary>
        public ManifestChangeResult PublishContentUpdate(ManifestSnapshot current)
        {
            if (State == ManifestSessionState.Uninitialized)
            {
                return Fail(ManifestChangeFailure.NotInitialized);
            }

            if (State == ManifestSessionState.Suppressed)
            {
                return Fail(ManifestChangeFailure.Suppressed);
            }

            var validation = ManifestValidator.Validate(current);
            if (validation.Count > 0)
            {
                return Fail(ManifestChangeFailure.InvalidManifest, validation);
            }

            if (State == ManifestSessionState.NoValidManifest)
            {
                return Fail(
                    ManifestChangeFailure.StructuralChangeRequiresReinject,
                    Issue("There is no accepted manifest to compare with. Use reinject."));
            }

            if (!string.Equals(current.ProjectId, ProjectId, StringComparison.Ordinal))
            {
                return Fail(
                    ManifestChangeFailure.ProjectIdMismatch,
                    Issue("projectId differs from the accepted manifest."));
            }

            var structural = new List<ManifestIssue>();
            var hasContentChange = Diff(snapshot, current, structural);
            if (structural.Count > 0)
            {
                return Fail(ManifestChangeFailure.StructuralChangeRequiresReinject, structural);
            }

            if (!hasContentChange)
            {
                var sameJson = ManifestJsonWriter.WriteManifest(snapshot, engine, Origin);
                return new ManifestChangeResult(
                    ManifestChangeFailure.None,
                    null,
                    ManifestJsonWriter.Utf8ByteCount(sameJson),
                    structureGeneration,
                    false);
            }

            if (structureGeneration == int.MaxValue)
            {
                return Fail(
                    ManifestChangeFailure.StructuralChangeRequiresReinject,
                    Issue("structureGeneration cannot advance any further. Restart is required."));
            }

            var nextOrigin = new ManifestOrigin(bootId, structureGeneration + 1);
            var nextJson = ManifestJsonWriter.WriteManifest(current, engine, nextOrigin);
            var bytes = ManifestJsonWriter.Utf8ByteCount(nextJson);
            if (bytes > ManifestLimits.PracticalLimitBytes)
            {
                return new ManifestChangeResult(
                    ManifestChangeFailure.PayloadTooLarge,
                    Issue("The manifest would be " + bytes + " bytes, over the limit of "
                        + ManifestLimits.PracticalLimitBytes + " bytes."),
                    bytes,
                    structureGeneration,
                    false);
            }

            snapshot = current;
            structureGeneration++;
            stateVersion++;
            return new ManifestChangeResult(ManifestChangeFailure.None, null, bytes, structureGeneration, true);
        }

        private ManifestChangeResult Fail(ManifestChangeFailure failure, IReadOnlyList<ManifestIssue> issues = null)
        {
            return new ManifestChangeResult(failure, issues, -1, structureGeneration, false);
        }

        private static IReadOnlyList<ManifestIssue> Issue(string message)
        {
            return new[] { new ManifestIssue(ContentUpdateCode, string.Empty, message) };
        }

        // 構造の差分は structural に集め、許可リストの項目に差分があれば true を返す
        private static bool Diff(ManifestSnapshot before, ManifestSnapshot after, List<ManifestIssue> structural)
        {
            var changed = false;

            if (before.Entries.Count != after.Entries.Count)
            {
                structural.Add(new ManifestIssue(ContentUpdateCode, string.Empty, "The number of entries changed."));
                return false;
            }

            for (var i = 0; i < before.Entries.Count; i++)
            {
                var a = before.Entries[i];
                var b = after.Entries[i];
                var address = a.Address;

                if (!string.Equals(a.Address, b.Address, StringComparison.Ordinal))
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "The entry order or address changed."));
                    continue;
                }

                if (!string.Equals(a.EffectiveId, b.EffectiveId, StringComparison.Ordinal))
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "The entry id changed."));
                }

                if (a.Type != b.Type)
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "The entry type changed."));
                }

                if (a.Staged != b.Staged)
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "staged changed."));
                }

                if (!SameList(a.AppliesTo, b.AppliesTo))
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "appliesTo changed."));
                }

                if (!SameList(a.ExpandsTo, b.ExpandsTo))
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "expandsTo changed."));
                }

                if ((a.Widget == ManifestWidgetKind.Button) != (b.Widget == ManifestWidgetKind.Button))
                {
                    structural.Add(new ManifestIssue(
                        ContentUpdateCode, address, "The widget changed between button and a non-button kind."));
                }

                if (!SameDefault(a, b))
                {
                    structural.Add(new ManifestIssue(
                        ContentUpdateCode,
                        address,
                        "A default value change does not overwrite the current value of the same entity, "
                        + "so it would not appear in the table. Send the value over OSC or use F-7 (separate spec) "
                        + "to change it."));
                }

                if (a.Widget != b.Widget
                    || !string.Equals(a.Label, b.Label, StringComparison.Ordinal)
                    || a.HasRange != b.HasRange
                    || !a.RangeMin.Equals(b.RangeMin)
                    || !a.RangeMax.Equals(b.RangeMax)
                    || !string.Equals(a.Group, b.Group, StringComparison.Ordinal)
                    || a.HasOptions != b.HasOptions
                    || !SameList(a.Options, b.Options)
                    || !string.Equals(a.OptionsRef, b.OptionsRef, StringComparison.Ordinal)
                    || !string.Equals(a.Pattern, b.Pattern, StringComparison.Ordinal))
                {
                    changed = true;
                }
            }

            if (!SameOptionLists(before.OptionLists, after.OptionLists))
            {
                changed = true;
            }

            return changed;
        }

        private static bool SameDefault(ManifestSnapshotEntry a, ManifestSnapshotEntry b)
        {
            if (a.DefaultKind != b.DefaultKind)
            {
                return false;
            }

            switch (a.DefaultKind)
            {
                case ManifestDefaultKind.Int: return a.DefaultInt == b.DefaultInt;
                case ManifestDefaultKind.Float: return a.DefaultFloat.Equals(b.DefaultFloat);
                case ManifestDefaultKind.String: return string.Equals(a.DefaultString, b.DefaultString, StringComparison.Ordinal);
                case ManifestDefaultKind.Bool: return a.DefaultBool == b.DefaultBool;
                default: return true;
            }
        }

        // null と空は同じ扱い(アセットの未設定と空リストを区別しない)
        private static bool SameList(IReadOnlyList<string> a, IReadOnlyList<string> b)
        {
            var countA = a == null ? 0 : a.Count;
            var countB = b == null ? 0 : b.Count;
            if (countA != countB)
            {
                return false;
            }

            for (var i = 0; i < countA; i++)
            {
                if (!string.Equals(a[i], b[i], StringComparison.Ordinal))
                {
                    return false;
                }
            }

            return true;
        }

        // 出力は定義順なので、順序も含めて比べる
        private static bool SameOptionLists(
            IReadOnlyList<ManifestSnapshotOptionList> a,
            IReadOnlyList<ManifestSnapshotOptionList> b)
        {
            if (a.Count != b.Count)
            {
                return false;
            }

            for (var i = 0; i < a.Count; i++)
            {
                if (!string.Equals(a[i].Key, b[i].Key, StringComparison.Ordinal) || !SameList(a[i].Values, b[i].Values))
                {
                    return false;
                }
            }

            return true;
        }

        private static StagingDeclaration ToDeclaration(ManifestSnapshot source)
        {
            var declarations = new List<StagingEntryDeclaration>(source.Entries.Count);
            foreach (var entry in source.Entries)
            {
                declarations.Add(new StagingEntryDeclaration(
                    entry.Address,
                    entry.Type,
                    entry.Widget == ManifestWidgetKind.Button,
                    entry.Staged,
                    entry.AppliesTo,
                    entry.ExpandsTo));
            }

            return new StagingDeclaration(declarations);
        }

        // 型に合わない既定値は投入しない(従来どおり)。合否は engine のシードが判定する
        private static bool TryGetDefaultValue(ManifestSnapshotEntry entry, out StagingValue value)
        {
            switch (entry.DefaultKind)
            {
                case ManifestDefaultKind.Int:
                    value = StagingValue.FromInt(entry.DefaultInt);
                    return true;
                case ManifestDefaultKind.Float:
                    value = StagingValue.FromFloat(entry.DefaultFloat);
                    return true;
                case ManifestDefaultKind.String:
                    value = StagingValue.FromString(entry.DefaultString ?? string.Empty);
                    return true;
                case ManifestDefaultKind.Bool:
                    // bool の既定値は bool 型のエントリにだけ入る。他の型では None を渡してシード失敗として報告させる
                    value = entry.Type == StagingEntryType.Bool
                        ? StagingValue.FromInt(entry.DefaultBool ? 1 : 0)
                        : StagingValue.None;
                    return true;
                default:
                    value = StagingValue.None;
                    return false;
            }
        }
    }
}
