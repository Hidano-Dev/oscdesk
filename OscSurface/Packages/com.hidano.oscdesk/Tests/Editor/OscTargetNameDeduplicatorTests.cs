using System.Collections.Generic;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.TestTools;

namespace OscDesk.Receiver.Tests
{
    // 重複した対象名の付け直し(D-109)。編集モードでは OnEnable が呼ばれないので、Registry には何も載らない
    public sealed class OscTargetNameDeduplicatorTests
    {
        private const string TempScenePath = "Assets/__OscDeskDeduplicatorTest.unity";

        private readonly List<GameObject> created = new List<GameObject>();

        private OscFixtureTarget Make(string objectName, string targetName = null)
        {
            var gameObject = new GameObject(objectName);
            created.Add(gameObject);
            var target = gameObject.AddComponent<OscFixtureTarget>();
            if (targetName != null)
            {
                var serialized = new SerializedObject(target);
                serialized.FindProperty("targetName").stringValue = targetName;
                serialized.ApplyModifiedPropertiesWithoutUndo();
            }

            return target;
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var gameObject in created)
            {
                if (gameObject != null)
                {
                    Object.DestroyImmediate(gameObject);
                }
            }

            created.Clear();
        }

        private static void ExpectRenameWarnings(int count)
        {
            for (var i = 0; i < count; i++)
            {
                LogAssert.Expect(LogType.Warning, new Regex("に付け直しました"));
            }
        }

        [Test]
        public void Later_duplicates_get_a_suffix_and_the_first_keeps_its_name()
        {
            var first = Make("Spark");
            var second = Make("Spark");
            var third = Make("Spark(Clone)"); // 既定の対象名は (Clone) を除くので同じ Spark

            var renames = OscTargetNameDeduplicator.Deduplicate(SceneManager.GetActiveScene());

            Assert.That(renames.Count, Is.EqualTo(2));
            Assert.That(first.TargetName, Is.EqualTo("Spark"));
            Assert.That(second.TargetName, Is.EqualTo("Spark_2"));
            Assert.That(third.TargetName, Is.EqualTo("Spark_3"));
            Assert.That(renames[0].Address, Is.EqualTo("/fx/Spark/stop"));
            Assert.That(OscTargetNameDeduplicator.TryGetLastRename(second, out _), Is.False); // 記録は Report(保存時・Play の開始時)で付く
        }

        [Test]
        public void New_name_avoids_names_used_later_in_the_scene()
        {
            Make("a");
            var second = Make("a");
            var later = Make("x", "a_2");

            OscTargetNameDeduplicator.Deduplicate(SceneManager.GetActiveScene());

            Assert.That(second.TargetName, Is.EqualTo("a_3"));
            Assert.That(later.TargetName, Is.EqualTo("a_2"));
        }

        [Test]
        public void Different_packages_do_not_collide()
        {
            var first = Make("Spark");
            var second = Make("Spark");
            second.PackageName = "other";

            Assert.That(OscTargetNameDeduplicator.Deduplicate(SceneManager.GetActiveScene()), Is.Empty);
            Assert.That(first.TargetName, Is.EqualTo("Spark"));
            Assert.That(second.TargetNameField, Is.Empty);
        }

        [Test]
        public void Nothing_changes_without_duplicates()
        {
            var a = Make("a");
            var b = Make("b");
            var group = Undo.GetCurrentGroup();

            Assert.That(OscTargetNameDeduplicator.Deduplicate(SceneManager.GetActiveScene()), Is.Empty);
            Assert.That(a.TargetNameField, Is.Empty);
            Assert.That(b.TargetNameField, Is.Empty);
            Assert.That(Undo.GetCurrentGroup(), Is.EqualTo(group));
        }

        [Test]
        public void Rename_can_be_undone()
        {
            Make("Spark");
            var second = Make("Spark");
            var third = Make("Spark");

            OscTargetNameDeduplicator.Deduplicate(SceneManager.GetActiveScene());
            Assert.That(second.TargetName, Is.EqualTo("Spark_2"));
            Assert.That(third.TargetName, Is.EqualTo("Spark_3"));

            Undo.PerformUndo(); // 1 回の Undo で、まとめて付け直した分が戻る
            Assert.That(second.TargetNameField, Is.Empty);
            Assert.That(third.TargetNameField, Is.Empty);
            Assert.That(second.TargetName, Is.EqualTo("Spark"));
        }

        [Test]
        public void Play_start_renames_duplicates_and_records_them_for_the_inspector()
        {
            Make("Spark");
            var second = Make("Spark");

            ExpectRenameWarnings(1);
            OscTargetNameDeduplicator.OnPlayModeStateChanged(PlayModeStateChange.ExitingEditMode);

            Assert.That(second.TargetName, Is.EqualTo("Spark_2"));
            Assert.That(OscTargetNameDeduplicator.TryGetLastRename(second, out var message), Is.True);
            Assert.That(message, Does.Contain("Spark_2"));

            // Play の開始以外の変化では何もしない
            var third = Make("Spark");
            OscTargetNameDeduplicator.OnPlayModeStateChanged(PlayModeStateChange.EnteredEditMode);
            Assert.That(third.TargetNameField, Is.Empty);
        }

        [Test]
        public void The_rename_notice_survives_a_domain_reload()
        {
            Make("Spark");
            var second = Make("Spark");

            ExpectRenameWarnings(1);
            OscTargetNameDeduplicator.OnPlayModeStateChanged(PlayModeStateChange.ExitingEditMode);

            // ドメインリロードで static が消えた状態を、SessionState からの読み直しで再現する(HID-391)
            OscTargetNameDeduplicator.LoadLastRenames();

            Assert.That(OscTargetNameDeduplicator.TryGetLastRename(second, out var message), Is.True);
            Assert.That(message, Does.Contain("Spark_2"));
        }

        [Test]
        public void Saving_the_scene_renames_duplicates_and_saves_the_new_names()
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            try
            {
                Make("Spark");
                var second = Make("Spark");

                ExpectRenameWarnings(1);
                Assert.That(EditorSceneManager.SaveScene(scene, TempScenePath), Is.True);
                Assert.That(second.TargetName, Is.EqualTo("Spark_2"));

                // 保存したシーンを開き直しても付け直した名前が残っている
                created.Clear();
                var reopened = EditorSceneManager.OpenScene(TempScenePath, OpenSceneMode.Single);
                var names = new List<string>();
                foreach (var root in reopened.GetRootGameObjects())
                {
                    foreach (var target in root.GetComponentsInChildren<OscFixtureTarget>(true))
                    {
                        names.Add(target.TargetName);
                    }
                }

                names.Sort(System.StringComparer.Ordinal);
                Assert.That(names, Is.EqualTo(new[] { "Spark", "Spark_2" }));
            }
            finally
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                AssetDatabase.DeleteAsset(TempScenePath);
            }
        }
    }
}
