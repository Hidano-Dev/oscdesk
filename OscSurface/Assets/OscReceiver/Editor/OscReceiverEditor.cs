// OscReceiverEditor.cs — OscReceiver のインスペクタ。定義 JSON の読み込みと対応表の検査を足す。
// エディタ表示のみの補助で、実行時の動作には関与しない。
// 名前空間を OscDesk.Receiver.Editor にしないのは、基底クラス UnityEditor.Editor の名前が名前空間に隠されるため。
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace OscDesk.Receiver
{
    [CustomEditor(typeof(OscReceiver))]
    public sealed class OscReceiverEditor : Editor
    {
        // 定義ファイルは OscReceiver.definitionFile に保存する。読み取り結果はそこから再構築できるキャッシュ
        private TextAsset loadedAsset;
        private List<OscDefinitionParameter> parameters;
        private List<OscDefinitionRecord> records;
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
            var selected = (TextAsset)EditorGUILayout.ObjectField("定義ファイル(.json)", receiver.definitionFile, typeof(TextAsset), false);
            if (EditorGUI.EndChangeCheck())
            {
                Undo.RecordObject(receiver, "Set OSC definition file");
                receiver.definitionFile = selected;
                EditorUtility.SetDirty(receiver);
            }

            // 選択の変更・再コンパイル・Unity 再起動のいずれの後でも、保存済みの参照から読み直す
            if (loadedAsset != receiver.definitionFile || (parameters == null && readError == null && receiver.definitionFile != null))
            {
                Load(receiver.definitionFile);
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

                if (GUILayout.Button("Record の行のフィールド id を定義に合わせる"))
                {
                    SyncRecordFields(receiver);
                }
            }

            DrawWarnings(receiver);
        }

        private void Load(TextAsset asset)
        {
            loadedAsset = asset;
            parameters = null;
            records = null;
            readError = null;
            if (asset == null)
            {
                return;
            }

            if (OscDefinitionReader.TryRead(asset.text, out var readParameters, out var readRecords, out var error))
            {
                parameters = readParameters;
                records = readRecords;
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

            foreach (var expected in OscDefinitionRows.ExpectedBindings(parameters, records))
            {
                if (existing.Add(expected.Address))
                {
                    receiver.bindings.Add(new OscReceiver.Binding
                    {
                        address = expected.Address,
                        kind = expected.Kind,
                        recordFields = new List<string>(expected.FieldIds)
                    });
                }
            }

            EditorUtility.SetDirty(receiver);
        }

        // 定義のフィールドを足し引きしたあと、既存の Record の行の id を定義に揃える(A6 の解消)。イベントの登録は触らない
        private void SyncRecordFields(OscReceiver receiver)
        {
            Undo.RecordObject(receiver, "Sync OSC record fields from definition");
            var fieldsByAddress = new Dictionary<string, IReadOnlyList<string>>();
            foreach (var expected in OscDefinitionRows.ExpectedBindings(parameters, records))
            {
                if (expected.Kind == OscBindingKind.Record)
                {
                    fieldsByAddress[expected.Address] = expected.FieldIds;
                }
            }

            foreach (var binding in receiver.bindings)
            {
                if (binding.kind == OscBindingKind.Record && fieldsByAddress.TryGetValue(binding.address, out var fields))
                {
                    binding.recordFields = new List<string>(fields);
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

            var expected = parameters != null ? OscDefinitionRows.ExpectedBindings(parameters, records) : null;
            foreach (var warning in OscBindingAudit.AuditWithDefinition(expected, rows))
            {
                EditorGUILayout.HelpBox(warning.Message, MessageType.Warning);
            }
        }
    }
}
