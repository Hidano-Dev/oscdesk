// OscReceiverEditor.cs — OscReceiver のインスペクタ。定義 JSON の読み込みと対応表の検査を足す。
// エディタ表示のみの補助で、実行時の動作には関与しない。
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using OscDesk.Receiver;

[CustomEditor(typeof(OscReceiver))]
public sealed class OscReceiverEditor : Editor
{
    private TextAsset definitionAsset;
    private List<OscDefinitionParameter> parameters;
    private string readError;

    public override void OnInspectorGUI()
    {
        var receiver = (OscReceiver)target;

        EditorGUILayout.HelpBox(
            "受信したアドレスと完全一致する行の UnityEvent を呼びます。値は同じアドレスへエコーバックされ、"
            + "OscDesk の画面に反映されます。定義 JSON(OscDesk のサーフェス定義)を読み込むと、"
            + "アドレスの一覧から行を作れ、定義にないアドレスや未設定の行を警告します。",
            MessageType.Info);

        DrawDefaultInspector();

        EditorGUILayout.Space();
        EditorGUILayout.LabelField("定義 JSON", EditorStyles.boldLabel);
        EditorGUI.BeginChangeCheck();
        definitionAsset = (TextAsset)EditorGUILayout.ObjectField("定義ファイル(.json)", definitionAsset, typeof(TextAsset), false);
        if (EditorGUI.EndChangeCheck())
        {
            Load();
        }

        if (readError != null)
        {
            EditorGUILayout.HelpBox(readError, MessageType.Error);
        }

        using (new EditorGUI.DisabledScope(parameters == null))
        {
            if (GUILayout.Button("定義にあって行が無いアドレスの行を追加"))
            {
                AddMissingRows(receiver);
            }
        }

        DrawWarnings(receiver);
    }

    private void Load()
    {
        parameters = null;
        readError = null;
        if (definitionAsset == null)
        {
            return;
        }

        if (OscDefinitionReader.TryRead(definitionAsset.text, out var read, out var error))
        {
            parameters = read;
        }
        else
        {
            readError = error;
        }
    }

    private void AddMissingRows(OscReceiver receiver)
    {
        Undo.RecordObject(receiver, "Add OSC bindings from definition");
        var existing = new HashSet<string>();
        foreach (var binding in receiver.bindings)
        {
            existing.Add(binding.address);
        }

        foreach (var parameter in parameters)
        {
            if (existing.Add(parameter.Address))
            {
                receiver.bindings.Add(new OscReceiver.Binding { address = parameter.Address, kind = parameter.SuggestKind() });
            }
        }

        EditorUtility.SetDirty(receiver);
    }

    private void DrawWarnings(OscReceiver receiver)
    {
        var rows = new List<OscBindingRow>(receiver.bindings.Count);
        foreach (var binding in receiver.bindings)
        {
            rows.Add(binding.ToRow());
        }

        HashSet<string> addresses = null;
        if (parameters != null)
        {
            addresses = new HashSet<string>();
            foreach (var parameter in parameters)
            {
                addresses.Add(parameter.Address);
            }
        }

        foreach (var warning in OscBindingAudit.Audit(addresses, rows))
        {
            EditorGUILayout.HelpBox(warning.Message, MessageType.Warning);
        }
    }
}
