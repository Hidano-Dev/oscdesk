using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace OscDesk.Receiver.Tests
{
    /// <summary>
    /// UPM パッケージ化(D-096)で守る約束を確かめる。利用側のプロジェクト(testables)でも同じに成り立つ。
    /// </summary>
    public sealed class OscReceiverPackageTests
    {
        // Assets/OscReceiver/ にあった頃からのスクリプトの GUID。シーン・プレハブのコンポーネントはこれで OscReceiver を指すので、
        // 変わると付けてあった OscReceiver が Missing Script になり、対応表と登録した関数が失われる
        private const string OscReceiverScriptGuid = "450301b3c49b4642936f40978a3fd642";

        [Test]
        public void OscReceiverKeepsItsScriptGuid()
        {
            var path = AssetDatabase.GUIDToAssetPath(OscReceiverScriptGuid);
            Assert.That(path, Is.EqualTo("Packages/com.hidano.oscdesk/Runtime/OscReceiver.cs"));
            var script = AssetDatabase.LoadAssetAtPath<MonoScript>(path);
            Assert.That(script, Is.Not.Null);
            Assert.That(script.GetClass(), Is.EqualTo(typeof(OscReceiver)));
        }

        [Test]
        public void AssembliesKeepTheirNamesAndNamespace()
        {
            Assert.That(typeof(OscReceiver).Assembly.GetName().Name, Is.EqualTo("OscDesk.Receiver.Runtime"));
            Assert.That(typeof(OscReceiver).Namespace, Is.EqualTo("OscDesk.Receiver"));
            Assert.That(typeof(OscCodec).Assembly.GetName().Name, Is.EqualTo("OscDesk.Receiver"));
            Assert.That(typeof(OscReceiverEditor).Assembly.GetName().Name, Is.EqualTo("OscDesk.Receiver.Editor"));
        }

        [Test]
        public void InspectorIsTheCustomEditor()
        {
            var gameObject = new GameObject("OscReceiverPackageTests");
            try
            {
                // 編集モードでは OnEnable が呼ばれないので、ポートは開かない
                var receiver = gameObject.AddComponent<OscReceiver>();
                var editor = UnityEditor.Editor.CreateEditor(receiver);
                try
                {
                    Assert.That(editor, Is.InstanceOf<OscReceiverEditor>());
                }
                finally
                {
                    Object.DestroyImmediate(editor);
                }
            }
            finally
            {
                Object.DestroyImmediate(gameObject);
            }
        }
    }
}
