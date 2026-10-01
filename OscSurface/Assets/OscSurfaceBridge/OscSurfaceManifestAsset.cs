using System;
using System.Collections.Generic;
using OscDesk.Staging;
using UnityEngine;

[CreateAssetMenu(menuName = "OSCDesk/Manifest Asset", fileName = "OscDeskManifest")]
public sealed class OscSurfaceManifestAsset : ScriptableObject
{
    public string projectId = "";
    public List<Entry> entries = new List<Entry>();
    public List<OptionList> optionLists = new List<OptionList>();

    /// <summary>
    /// アセットの現在の内容を、UnityEngine に依存しない不変なスナップショットへ写す。
    /// 列挙型は整数で写し(範囲外の値は中核の検証で拒否される)、ラベルと文字列の既定値の
    /// {characterName} はこの時点で置換する。null のリストや要素は検証で理由を返せるよう保持する。
    /// </summary>
    public ManifestSnapshot ToSnapshot(string characterName)
    {
        List<ManifestSnapshotEntry> snapshotEntries = null;
        if (entries != null)
        {
            snapshotEntries = new List<ManifestSnapshotEntry>(entries.Count);
            foreach (var entry in entries)
            {
                snapshotEntries.Add(entry == null ? null : entry.ToSnapshotEntry(characterName));
            }
        }

        List<ManifestSnapshotOptionList> snapshotOptionLists = null;
        if (optionLists != null)
        {
            snapshotOptionLists = new List<ManifestSnapshotOptionList>(optionLists.Count);
            foreach (var optionList in optionLists)
            {
                snapshotOptionLists.Add(
                    optionList == null ? null : new ManifestSnapshotOptionList(optionList.key, optionList.values));
            }
        }

        return new ManifestSnapshot(projectId, snapshotEntries, snapshotOptionLists);
    }

    private static string ReplaceCharacterName(string template, string characterName)
    {
        return template == null
            ? string.Empty
            : template.Replace("{characterName}", characterName ?? string.Empty);
    }

    public enum EntryType
    {
        Int,
        Float,
        String,
        Blob,
        Bool,
    }

    public enum WidgetType
    {
        Fader,
        Button,
        Toggle,
        Xy,
        Text,
        Input,
        Select,
    }

    public enum DefaultKind
    {
        None,
        Int,
        Float,
        String,
        Bool,
    }

    [Serializable]
    public sealed class OptionList
    {
        public string key = "";
        public List<string> values = new List<string>();
    }

    [Serializable]
    public sealed class Entry
    {
        // 任意の安定した識別子。空なら address が識別子になる(既存のアセットは空として読まれる)
        public string id = "";
        public string address = "";
        public string label = "";
        public EntryType type;
        public WidgetType widget;
        public bool hasRange;
        public float rangeMin;
        public float rangeMax;
        public DefaultKind defaultKind;
        public int defaultInt;
        public float defaultFloat;
        public string defaultString = "";
        public bool defaultBool;
        public string group = "";
        public bool hasOptions;
        public List<string> options = new List<string>();
        public string optionsRef = "";
        public string pattern = "";
        public bool staged;
        public List<string> appliesTo = new List<string>();
        public List<string> expandsTo = new List<string>();

        public ManifestSnapshotEntry ToSnapshotEntry(string characterName)
        {
            return new ManifestSnapshotEntry(
                id,
                address,
                ReplaceCharacterName(label, characterName),
                (StagingEntryType)(int)type,
                (ManifestWidgetKind)(int)widget,
                hasRange,
                rangeMin,
                rangeMax,
                (ManifestDefaultKind)(int)defaultKind,
                defaultInt,
                defaultFloat,
                ReplaceCharacterName(defaultString, characterName),
                defaultBool,
                group,
                hasOptions,
                options,
                optionsRef,
                pattern,
                staged,
                appliesTo,
                expandsTo);
        }
    }
}
