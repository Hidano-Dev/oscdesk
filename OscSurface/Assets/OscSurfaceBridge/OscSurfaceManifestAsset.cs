using System;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(menuName = "OSCDesk/Manifest Asset", fileName = "OscDeskManifest")]
public sealed class OscSurfaceManifestAsset : ScriptableObject
{
    public string projectId = "";
    public List<Entry> entries = new List<Entry>();
    public List<OptionList> optionLists = new List<OptionList>();

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
    }
}
