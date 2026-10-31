// OscTargetEditor.cs — OscTarget(と派生クラス)のインスペクタ。受け付けるアドレスと形の検査を見せる(DESIGN.md D-107)。
using System;
using UnityEditor;
using UnityEngine;

namespace OscDesk.Receiver
{
    [CustomEditor(typeof(OscTarget), true)]
    [CanEditMultipleObjects]
    public class OscTargetEditor : Editor
    {
        public override void OnInspectorGUI()
        {
            DrawDefaultInspector();

            if (targets.Length != 1)
            {
                return;
            }

            var component = (OscTarget)target;
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("受け付けるアドレス", EditorStyles.boldLabel);

            if (!OscAddressNames.IsValidSegment(component.TargetName))
            {
                EditorGUILayout.HelpBox("対象名 \"" + component.TargetName + "\" はアドレスに使えません(空白・/・* ? [ ] { } , # を含む、または空)。"
                    + "Target Name の欄に名前を入れてください。", MessageType.Warning);
            }

            if (component.PackageName.Length > 0 && !OscAddressNames.IsValidSegment(component.PackageName))
            {
                EditorGUILayout.HelpBox("パッケージ名 \"" + component.PackageName + "\" はアドレスに使えません。", MessageType.Warning);
            }

            try
            {
                foreach (var entry in component.CreateEntries())
                {
                    var valid = OscBindingAudit.IsValidAddress(entry.Address);
                    EditorGUILayout.LabelField(entry.Address, entry.Operation.Kind + (valid ? string.Empty : "(不正なアドレス)"));
                }
            }
            catch (Exception exception)
            {
                // 派生クラスの宣言が編集モードで例外を出しても、インスペクタの描画は止めない
                EditorGUILayout.HelpBox("操作の宣言で例外が出ました: " + exception.Message, MessageType.Error);
            }

            if (Application.isPlaying && component.isActiveAndEnabled && !component.IsFullyRegistered)
            {
                EditorGUILayout.HelpBox("登録できなかったアドレスがあります(同じアドレスが先に登録されているか、不正です)。Console の警告を見てください。",
                    MessageType.Warning);
            }
        }
    }
}
