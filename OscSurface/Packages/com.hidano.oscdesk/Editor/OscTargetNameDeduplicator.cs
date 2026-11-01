// OscTargetNameDeduplicator.cs — シーンに置いた OscTarget の対象名が重なったら、保存時と Play の開始時に付け直す(DESIGN.md D-109)。
using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 同じシーンの中で OscTarget のアドレスが重なったら、後に並ぶ方の対象名に接尾辞(_2, _3, …)を足して付け直す。
    /// 実行中に重なると後から有効になった方が受け付けられず(D-107)、どちらが残るかが有効化の順で決まってしまうため、
    /// 実行前にシーンの中で名前を決めておく。名前はシーンに保存されるので、同じシーンを使うすべての PC で同じになる。
    /// 見るのはシーンごと。シーンをまたいだ重複は付け直さず、Play の開始時に警告だけ出す(D-109)。
    /// </summary>
    [InitializeOnLoad]
    public static class OscTargetNameDeduplicator
    {
        /// <summary>接尾辞の番号の上限(これを超えて重なることは実用上ないので、見つからなければ付け直さずに警告する)。</summary>
        public const int MaxSuffix = 999;

        public const string UndoName = "OscDesk: 重複した対象名の付け直し";

        /// <summary>付け直し 1 件。</summary>
        public readonly struct Rename
        {
            public OscTarget Target { get; }
            public string OldName { get; }
            public string NewName { get; }
            /// <summary>重なったアドレス(付け直す前)。</summary>
            public string Address { get; }

            public Rename(OscTarget target, string oldName, string newName, string address)
            {
                Target = target;
                OldName = oldName;
                NewName = newName;
                Address = address;
            }
        }

        // インスペクタに「付け直した」を出すための記録(エディタのセッションの間だけ。インスタンス ID → 文)。
        // Play の開始(ExitingEditMode)で記録した直後にドメインリロードが走ると static は消えるので、SessionState にも写して復元する(HID-391)
        private static readonly Dictionary<int, string> lastRenames = new Dictionary<int, string>();

        private const string SessionKey = "OscDesk.OscTargetNameDeduplicator.LastRenames";

        [Serializable]
        private sealed class RenameRecord
        {
            public int id;
            public string message;
        }

        [Serializable]
        private sealed class RenameRecords
        {
            public List<RenameRecord> items = new List<RenameRecord>();
        }

        static OscTargetNameDeduplicator()
        {
            LoadLastRenames();
            EditorSceneManager.sceneSaving += OnSceneSaving;
            EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
        }

        internal static void LoadLastRenames()
        {
            lastRenames.Clear();
            try
            {
                var json = SessionState.GetString(SessionKey, "");
                if (string.IsNullOrEmpty(json))
                {
                    return;
                }

                var records = JsonUtility.FromJson<RenameRecords>(json);
                if (records?.items == null)
                {
                    return;
                }

                foreach (var record in records.items)
                {
                    lastRenames[record.id] = record.message;
                }
            }
            catch (Exception exception)
            {
                // 表示だけの記録なので、壊れていても読み捨てて続ける
                Debug.LogException(exception);
            }
        }

        private static void SaveLastRenames()
        {
            var records = new RenameRecords();
            foreach (var pair in lastRenames)
            {
                records.items.Add(new RenameRecord { id = pair.Key, message = pair.Value });
            }

            SessionState.SetString(SessionKey, JsonUtility.ToJson(records));
        }

        /// <summary>インスペクタに出す、この対象の直近の付け直し(無ければ false)。</summary>
        public static bool TryGetLastRename(OscTarget target, out string message)
        {
            message = null;
            return target != null && lastRenames.TryGetValue(target.GetInstanceID(), out message);
        }

        internal static void OnSceneSaving(Scene scene, string path)
        {
            Report(Deduplicate(scene));
        }

        internal static void OnPlayModeStateChanged(PlayModeStateChange change)
        {
            if (change != PlayModeStateChange.ExitingEditMode)
            {
                return;
            }

            DeduplicateOpenScenes();
        }

        /// <summary>開いているシーンをそれぞれ付け直し、シーンをまたいだ重複を警告する(Play の開始時と同じ処理)。</summary>
        public static List<Rename> DeduplicateOpenScenes()
        {
            var all = new List<Rename>();
            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (scene.isLoaded)
                {
                    all.AddRange(Deduplicate(scene));
                }
            }

            Report(all);
            WarnAcrossScenes();
            return all;
        }

        /// <summary>
        /// 1 つのシーンの OscTarget(非アクティブを含む)を階層の順に見て、先に並ぶ方を残し、後に並ぶ方を付け直す。
        /// 変更は Undo に 1 つの操作として記録する。重複が無ければ何も変えない。
        /// </summary>
        public static List<Rename> Deduplicate(Scene scene)
        {
            var renames = new List<Rename>();
            if (!scene.IsValid() || !scene.isLoaded)
            {
                return renames;
            }

            var targets = Collect(scene);
            var plans = new List<KeyValuePair<OscTarget, List<OscRegistryEntry>>>(targets.Count);
            // 付け直した名前が、後に並ぶ別の対象の元の名前と重ならないよう、元のアドレスをすべて先に集める
            var original = new HashSet<string>(StringComparer.Ordinal);
            foreach (var target in targets)
            {
                var entries = TryCreateEntries(target);
                plans.Add(new KeyValuePair<OscTarget, List<OscRegistryEntry>>(target, entries));
                foreach (var entry in entries)
                {
                    original.Add(entry.Address);
                }
            }

            var used = new HashSet<string>(StringComparer.Ordinal);
            var group = -1;
            foreach (var plan in plans)
            {
                var target = plan.Key;
                var entries = plan.Value;
                string collided = null;
                foreach (var entry in entries)
                {
                    if (used.Contains(entry.Address))
                    {
                        collided = entry.Address;
                        break;
                    }
                }

                if (collided == null)
                {
                    foreach (var entry in entries)
                    {
                        used.Add(entry.Address);
                    }

                    continue;
                }

                var oldName = target.TargetName;
                var newName = FindFreeName(oldName, entries, used, original);
                if (newName == null)
                {
                    Debug.LogWarning("OscTarget: " + collided + " が重なっていますが、付け直す名前が見つかりませんでした(" + oldName + "_2 〜 _"
                        + MaxSuffix + " がすべて使われています)。Target Name を手で変えてください。", target);
                    continue;
                }

                if (group < 0)
                {
                    Undo.IncrementCurrentGroup();
                    Undo.SetCurrentGroupName(UndoName);
                    group = Undo.GetCurrentGroup();
                }

                // SerializedObject を通すと Undo の記録とプレハブのインスタンスの上書きが Unity の通常の編集と同じになる
                var serialized = new SerializedObject(target);
                serialized.FindProperty("targetName").stringValue = newName;
                serialized.ApplyModifiedProperties();

                foreach (var entry in entries)
                {
                    used.Add(OscAddressNames.Build(entry.PackageName, newName, entry.Operation.Name));
                }

                renames.Add(new Rename(target, oldName, newName, collided));
            }

            if (group >= 0)
            {
                Undo.CollapseUndoOperations(group);
            }

            return renames;
        }

        private static List<OscTarget> Collect(Scene scene)
        {
            var targets = new List<OscTarget>();
            foreach (var root in scene.GetRootGameObjects())
            {
                foreach (var target in root.GetComponentsInChildren<OscTarget>(true))
                {
                    // エディタが保存しないもの(生成担当の入れ物など)は、シーンの名前として残らないので見ない
                    if ((target.gameObject.hideFlags & HideFlags.DontSaveInEditor) == 0)
                    {
                        targets.Add(target);
                    }
                }
            }

            return targets;
        }

        private static List<OscRegistryEntry> TryCreateEntries(OscTarget target)
        {
            try
            {
                var entries = target.CreateEntries();
                // 不正なアドレスは実行時に登録されないので、重なりの判定に入れない
                // (OscTarget と同じく名前も段ごとに見る。D-107 追記)
                entries.RemoveAll(entry => !OscBindingAudit.IsValidAddress(entry.Address)
                    || (entry.PackageName.Length > 0 && !OscAddressNames.IsValidSegment(entry.PackageName))
                    || !OscAddressNames.IsValidSegment(entry.TargetName)
                    || !OscAddressNames.IsValidSegment(entry.Operation.Name));
                return entries;
            }
            catch (Exception exception)
            {
                Debug.LogException(exception, target);
                return new List<OscRegistryEntry>();
            }
        }

        private static string FindFreeName(string baseName, List<OscRegistryEntry> entries, HashSet<string> used, HashSet<string> original)
        {
            for (var n = 2; n <= MaxSuffix; n++)
            {
                var candidate = baseName + "_" + n;
                if (!OscAddressNames.IsValidSegment(candidate))
                {
                    return null;
                }

                var free = true;
                foreach (var entry in entries)
                {
                    var address = OscAddressNames.Build(entry.PackageName, candidate, entry.Operation.Name);
                    if (used.Contains(address) || original.Contains(address))
                    {
                        free = false;
                        break;
                    }
                }

                if (free)
                {
                    return candidate;
                }
            }

            return null;
        }

        private static void Report(List<Rename> renames)
        {
            foreach (var rename in renames)
            {
                var message = "対象名を \"" + rename.OldName + "\" から \"" + rename.NewName + "\" に付け直しました(" + rename.Address
                    + " が同じシーンの別の対象と重なったため。シーンを保存すると残ります)";
                if (rename.Target != null)
                {
                    lastRenames[rename.Target.GetInstanceID()] = message;
                }

                Debug.LogWarning("OscTarget: " + message, rename.Target);
            }

            if (renames.Count > 0)
            {
                SaveLastRenames();
            }
        }

        // シーンをまたいだ重複は、開いているシーンの組み合わせで結果が変わるので付け直さない。実行中に後から有効になった方が
        // 受け付けられない(D-107)ことだけを先に知らせる
        private static void WarnAcrossScenes()
        {
            var owners = new Dictionary<string, OscTarget>(StringComparer.Ordinal);
            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.isLoaded)
                {
                    continue;
                }

                foreach (var target in Collect(scene))
                {
                    foreach (var entry in TryCreateEntries(target))
                    {
                        if (owners.TryGetValue(entry.Address, out var other))
                        {
                            if (other.gameObject.scene != target.gameObject.scene)
                            {
                                Debug.LogWarning("OscTarget: " + entry.Address + " がシーン " + other.gameObject.scene.name + " と "
                                    + target.gameObject.scene.name + " で重なっています。シーンをまたいだ重なりは付け直さないので、"
                                    + "実行中は後から有効になった方が受け付けられません。どちらかの Target Name を変えてください。", target);
                            }

                            continue;
                        }

                        owners.Add(entry.Address, target);
                    }
                }
            }
        }
    }
}
