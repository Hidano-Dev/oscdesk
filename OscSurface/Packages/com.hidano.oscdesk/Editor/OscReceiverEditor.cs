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
                + "アドレスの一覧から行を作れ、定義にないアドレスや未設定の行を警告します。"
                + "スクリプトの関数に [OscAddress(\"/アドレス\")] を付けておくと、「定義から配線」で行のイベントに登録できます。",
                MessageType.Info);

            DrawLegacyTransport(receiver);
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
                    OscReceiverWiring.AddMissingRows(receiver, OscDefinitionRows.ExpectedBindings(parameters, records), null);
                }

                if (GUILayout.Button("Record の行のフィールド id を定義に合わせる"))
                {
                    // Row Ids も揃えるのは、HID-323 以前に作った UI 管理のレコードの行をこのボタン 1 つで新しい形に移せるようにするため
                    OscReceiverWiring.SyncRecordRows(receiver, OscDefinitionRows.ExpectedBindings(parameters, records), null);
                }

                if (GUILayout.Button(new GUIContent("定義から配線([OscAddress] の関数を登録)",
                    "行の追加と Record の行の揃えに続けて、この GameObject とその子のスクリプトの [OscAddress] を付けた関数を、"
                    + "宣言したアドレスの行のイベントへ登録します。手で登録した関数は消しません。")))
                {
                    lastReport = OscReceiverWiring.WireFromDefinition(receiver, OscReceiverWiring.FindTargets(receiver), parameters, records);
                    lastReport.LogToConsole(receiver);
                }
            }

            DrawReport();
            DrawWarnings(receiver);
        }

        // 直前の「定義から配線」の結果。押した後に何が変わり何が残ったかをその場で見せる(Console にも出す)
        private OscWiringReport lastReport;

        private void DrawReport()
        {
            if (lastReport == null)
            {
                return;
            }

            EditorGUILayout.HelpBox(lastReport.Changes.Count == 0
                    ? "定義から配線: 変更はありません。"
                    : "定義から配線: " + lastReport.Changes.Count + " 件の変更\n" + string.Join("\n", lastReport.Changes),
                MessageType.Info);
            foreach (var warning in lastReport.Warnings)
            {
                EditorGUILayout.HelpBox(warning, MessageType.Warning);
            }
        }

        // 旧版(uOSC 経由、D-095 より前)で同じ GameObject に付けていた uOscServer / uOscClient の設定を取り込んで外す。
        // uOSC の型を参照しないよう(受け口を依存ゼロに保つため)、型名で探して SerializedObject で読む。
        // 残すと uOscServer が同じポートを掴み、OscReceiver が待ち受けられない
        private const string LegacyServerType = "uOSC.uOscServer";
        private const string LegacyClientType = "uOSC.uOscClient";

        private void DrawLegacyTransport(OscReceiver receiver)
        {
            Component server = null;
            Component client = null;
            var missingScripts = false;
            foreach (var component in receiver.GetComponents<Component>())
            {
                missingScripts |= component == null;
                var typeName = component != null ? component.GetType().FullName : null;
                if (typeName == LegacyServerType)
                {
                    server = component;
                }
                else if (typeName == LegacyClientType)
                {
                    client = component;
                }
            }

            if (server == null && client == null)
            {
                if (missingScripts)
                {
                    // uOSC を先に外すと設定を読めない。黙って既定値(7090 / 127.0.0.1:7091)で動かないよう知らせる
                    EditorGUILayout.HelpBox(
                        "この GameObject に Missing Script があります。uOSC を外した後の uOscServer / uOscClient なら設定は読めないので、"
                        + "Listen Port / Reply Host / Reply Port を以前の値に合わせて手で入れ、Missing Script を外してください。",
                        MessageType.Warning);
                }

                return;
            }

            EditorGUILayout.HelpBox(
                "この GameObject に uOSC の uOscServer / uOscClient が残っています。OscReceiver は自分で UDP を扱うようになりました(D-095)。"
                + "下のボタンで待ち受け・返信先の設定を取り込み、uOSC のコンポーネントを外してください(残すと同じポートを奪い合います)。",
                MessageType.Warning);
            if (!GUILayout.Button("uOSC の設定を取り込んでコンポーネントを外す"))
            {
                return;
            }

            serializedObject.Update();
            if (server != null)
            {
                var port = new SerializedObject(server).FindProperty("port");
                if (port != null)
                {
                    serializedObject.FindProperty("listenPort").intValue = port.intValue;
                }
            }

            if (client != null)
            {
                var clientObject = new SerializedObject(client);
                var address = clientObject.FindProperty("address");
                var port = clientObject.FindProperty("port");
                if (address != null)
                {
                    serializedObject.FindProperty("replyHost").stringValue = address.stringValue;
                }

                if (port != null)
                {
                    serializedObject.FindProperty("replyPort").intValue = port.intValue;
                }
            }

            serializedObject.ApplyModifiedProperties();
            if (server != null)
            {
                Undo.DestroyObjectImmediate(server);
            }

            if (client != null)
            {
                Undo.DestroyObjectImmediate(client);
            }

            GUIUtility.ExitGUI(); // 外したコンポーネントの描画を続けない
        }

        private void Load(TextAsset asset)
        {
            loadedAsset = asset;
            parameters = null;
            records = null;
            readError = null;
            lastReport = null; // 別の定義の結果を残さない
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
