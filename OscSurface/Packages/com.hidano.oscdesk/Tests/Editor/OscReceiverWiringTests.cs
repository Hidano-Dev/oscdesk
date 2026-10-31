using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Events;
using UnityEngine;
using UnityEngine.Events;

namespace OscDesk.Receiver.Tests
{
    /// <summary>
    /// 定義と [OscAddress] の宣言からの配線(D-100)。利用側のホストがアドレスごとの switch で組んでいた配線
    /// (レコードの値と Update、UI が管理する行の ID の一覧、一覧の要求、単一値)を、宣言だけで同じに組めることを確かめる。
    /// </summary>
    public sealed class OscReceiverWiringTests
    {
        private const string Definition = @"{
  ""format"": ""oscdesk-surface"", ""version"": 1, ""name"": ""t"",
  ""parameters"": [
    { ""id"": ""volume"", ""address"": ""/app/volume"", ""kind"": ""state"", ""type"": ""f"" },
    { ""id"": ""count"", ""address"": ""/app/count"", ""kind"": ""state"", ""type"": ""i"" },
    { ""id"": ""title"", ""address"": ""/app/title"", ""kind"": ""state"", ""type"": ""s"" },
    { ""id"": ""mute"", ""address"": ""/app/mute"", ""kind"": ""state"", ""type"": ""bool"" }
  ],
  ""records"": [
    { ""id"": ""member"", ""address"": ""/app/member/values"", ""label"": ""Members"", ""kind"": ""state"",
      ""keysFrom"": { ""address"": ""/app/members/list"", ""request"": ""/app/members/request"" },
      ""fields"": [
        { ""id"": ""active"", ""label"": ""Active"", ""type"": ""bool"", ""default"": 0 },
        { ""id"": ""lip"", ""label"": ""LipSync"", ""type"": ""s"", ""default"": ""(none)"", ""options"": [""(none)""],
          ""optionsFrom"": { ""address"": ""/app/lipdevices/list"", ""request"": ""/app/lipdevices/request"" } },
        { ""id"": ""segment"", ""label"": ""Segment"", ""type"": ""s"", ""default"": ""(none)"", ""options"": [""(none)""],
          ""optionsFrom"": { ""address"": ""/app/segments/list"", ""request"": ""/app/segments/request"" } }
      ] },
    { ""id"": ""memberUpdate"", ""address"": ""/app/member/update"", ""label"": ""Update"", ""kind"": ""trigger"", ""fields"": [],
      ""keysFrom"": { ""address"": ""/app/members/list"", ""request"": ""/app/members/request"" } },
    { ""id"": ""device"", ""address"": ""/app/device/values"", ""label"": ""Devices"", ""kind"": ""state"",
      ""keysFrom"": { ""address"": ""/app/device/keys"", ""source"": ""ui"", ""max"": 4 },
      ""fields"": [
        { ""id"": ""active"", ""label"": ""Active"", ""type"": ""bool"", ""default"": true },
        { ""id"": ""port"", ""label"": ""Port"", ""type"": ""i"", ""default"": 22000 }
      ] },
    { ""id"": ""deviceUpdate"", ""address"": ""/app/device/update"", ""label"": ""Sync"", ""kind"": ""trigger"", ""fields"": [],
      ""keysFrom"": { ""address"": ""/app/device/keys"", ""source"": ""ui"", ""max"": 4 } }
  ]
}";

        // パラメータ 4 + レコード 4 + UI が管理する行の ID の一覧(Strings)1 + 要求 3
        private const int DefinitionRows = 12;

        private readonly List<GameObject> objects = new List<GameObject>();
        private OscReceiver receiver;
        private OscWiringTestHost host;
        private List<OscDefinitionParameter> parameters;
        private List<OscDefinitionRecord> records;

        [SetUp]
        public void SetUp()
        {
            // 利用側の testables で開いているシーンを汚さないよう、保存されない隠しオブジェクトにする
            var gameObject = NewObject("OscReceiverWiringTests");
            receiver = gameObject.AddComponent<OscReceiver>();
            host = gameObject.AddComponent<OscWiringTestHost>();
            Assert.That(OscDefinitionReader.TryRead(Definition, out parameters, out records, out var error), Is.True, error);
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var gameObject in objects)
            {
                if (gameObject != null) Object.DestroyImmediate(gameObject);
            }

            objects.Clear();
        }

        private GameObject NewObject(string name)
        {
            var gameObject = EditorUtility.CreateGameObjectWithHideFlags(name, HideFlags.HideAndDontSave);
            objects.Add(gameObject);
            return gameObject;
        }

        private OscWiringReport Wire(params Object[] targets)
        {
            return OscReceiverWiring.WireFromDefinition(receiver, targets, parameters, records);
        }

        private List<OscExpectedBinding> Expected()
        {
            return OscDefinitionRows.ExpectedBindings(parameters, records);
        }

        private OscReceiver.Binding Row(string address)
        {
            return receiver.bindings.Find(binding => binding.address == address);
        }

        private static void AssertListener(UnityEventBase unityEvent, Object target, string method)
        {
            Assert.That(unityEvent.GetPersistentEventCount(), Is.EqualTo(1));
            Assert.That(unityEvent.GetPersistentTarget(0), Is.SameAs(target));
            Assert.That(unityEvent.GetPersistentMethodName(0), Is.EqualTo(method));
        }

        private static string Lines(IEnumerable<string> messages)
        {
            return string.Join("\n", messages);
        }

        private static void AssertWarning(OscWiringReport report, params string[] parts)
        {
            Assert.That(report.Warnings.Any(warning => parts.All(warning.Contains)), Is.True,
                "[" + string.Join(", ", parts) + "] を含む警告がありません:\n" + Lines(report.Warnings));
        }

        [Test]
        public void Declarations_alone_wire_every_row_of_the_definition()
        {
            var report = Wire(host);

            Assert.That(receiver.bindings, Has.Count.EqualTo(DefinitionRows));
            Assert.That(report.Warnings, Is.Empty, Lines(report.Warnings));

            AssertListener(Row("/app/member/values").onRecord, host, nameof(OscWiringTestHost.ReceiveMemberValues));
            AssertListener(Row("/app/member/update").onRecord, host, nameof(OscWiringTestHost.ReceiveMemberUpdate));
            AssertListener(Row("/app/members/request").onTrigger, host, nameof(OscWiringTestHost.SendMemberList));
            Assert.That(Row("/app/device/keys").kind, Is.EqualTo(OscBindingKind.Strings));
            AssertListener(Row("/app/device/keys").onStrings, host, nameof(OscWiringTestHost.ReceiveDeviceKeys));
            Assert.That(Row("/app/device/values").recordRowIds, Is.True);
            AssertListener(Row("/app/device/values").onRecord, host, nameof(OscWiringTestHost.ReceiveDeviceValues));
            AssertListener(Row("/app/device/update").onRecord, host, nameof(OscWiringTestHost.ReceiveDeviceUpdate));
            AssertListener(Row("/app/segments/request").onTrigger, host, nameof(OscWiringTestHost.SendOptionLists));
            AssertListener(Row("/app/lipdevices/request").onTrigger, host, nameof(OscWiringTestHost.SendOptionLists));
            AssertListener(Row("/app/volume").onFloat, host, nameof(OscWiringTestHost.SetVolume));
            AssertListener(Row("/app/count").onInt, host, nameof(OscWiringTestHost.SetCount));
            AssertListener(Row("/app/title").onString, host, nameof(OscWiringTestHost.SetTitle));
            AssertListener(Row("/app/mute").onBool, host, nameof(OscWiringTestHost.SetMute));

            // 受信値をそのまま渡す Dynamic で登録する(Static の固定値では受信値が届かない)
            Assert.That(Row("/app/volume").onFloat.GetPersistentListenerState(0), Is.EqualTo(UnityEventCallState.RuntimeOnly));
            Assert.That(report.Changes.Count(change => change.StartsWith("リスナーを登録")), Is.EqualTo(DefinitionRows));
            Assert.That(report.Changes.Count(change => change.StartsWith("行を追加")), Is.EqualTo(DefinitionRows));

            // 受け口の検査(A1〜A7)も通る
            var rows = receiver.bindings.Select(binding => binding.ToRow()).ToList();
            Assert.That(OscBindingAudit.AuditWithDefinition(Expected(), rows), Is.Empty);
        }

        [Test]
        public void Wiring_twice_changes_nothing()
        {
            Wire(host);
            var second = Wire(host, host);

            Assert.That(second.Changes, Is.Empty, Lines(second.Changes));
            Assert.That(second.Warnings, Is.Empty, Lines(second.Warnings));
            Assert.That(receiver.bindings, Has.Count.EqualTo(DefinitionRows));
            Assert.That(receiver.bindings.All(binding => binding.ListenerCount == 1), Is.True);
        }

        [Test]
        public void Listeners_registered_by_hand_are_kept()
        {
            var request = new OscReceiver.Binding { address = "/app/members/request", kind = OscBindingKind.Trigger };
            UnityEventTools.AddPersistentListener(request.onTrigger, host.Manual);
            receiver.bindings.Add(request);

            Wire(host);

            Assert.That(request.onTrigger.GetPersistentEventCount(), Is.EqualTo(2));
            Assert.That(request.onTrigger.GetPersistentMethodName(0), Is.EqualTo(nameof(OscWiringTestHost.Manual)));
            Assert.That(request.onTrigger.GetPersistentMethodName(1), Is.EqualTo(nameof(OscWiringTestHost.SendMemberList)));
            Assert.That(receiver.bindings.Count(binding => binding.address == "/app/members/request"), Is.EqualTo(1));
        }

        [Test]
        public void Record_rows_follow_the_definition_before_wiring()
        {
            // 定義のフィールドを変える前に作った行(フィールド id が古く、Record Row Ids もオフ)
            receiver.bindings.Add(new OscReceiver.Binding
            {
                address = "/app/device/values", kind = OscBindingKind.Record, recordFields = new List<string> { "active" }
            });

            var report = Wire(host);

            Assert.That(Row("/app/device/values").recordFields, Is.EqualTo(new[] { "active", "port" }));
            Assert.That(Row("/app/device/values").recordRowIds, Is.True);
            Assert.That(report.Changes, Has.Some.StartsWith("Record の行のフィールド id を定義に合わせた: /app/device/values"));
            Assert.That(report.Changes, Has.Some.StartsWith("Record の行の Record Row Ids を定義に合わせた: /app/device/values"));
            AssertListener(Row("/app/device/values").onRecord, host, nameof(OscWiringTestHost.ReceiveDeviceValues));
        }

        [Test]
        public void Rows_without_a_declaration_are_warned_unless_registered_by_hand()
        {
            var volume = new OscReceiver.Binding { address = "/app/volume", kind = OscBindingKind.Float };
            UnityEventTools.AddVoidPersistentListener(volume.onFloat, host.Manual);
            receiver.bindings.Add(volume);

            var report = Wire();

            Assert.That(report.Warnings, Has.Count.EqualTo(DefinitionRows - 1), Lines(report.Warnings));
            Assert.That(report.Warnings, Has.None.Contains("/app/volume"));
            Assert.That(report.Warnings, Has.Some.StartsWith("行 /app/device/keys (Strings) に登録する関数がありません"));
        }

        [Test]
        public void Declarations_that_cannot_be_registered_are_warned_and_not_wired()
        {
            var mistakes = receiver.gameObject.AddComponent<OscWiringTestMistakes>();

            var report = Wire(mistakes);

            Assert.That(Row("/app/volume").onFloat.GetPersistentEventCount(), Is.Zero);
            Assert.That(Row("/app/count").onInt.GetPersistentEventCount(), Is.Zero);
            Assert.That(report.Changes.Where(change => change.StartsWith("リスナーを登録")), Is.Empty);

            var warnings = Lines(report.Warnings);
            AssertWarning(report, "OscWiringTestMistakes.VolumeAsInt", "型は Float", "Int の行");
            AssertWarning(report, "OscWiringTestMistakes.NotInDefinition", "定義にありません");
            AssertWarning(report, "OscWiringTestMistakes.NotPublic", "public");
            AssertWarning(report, "OscWiringTestMistakes.IsStatic", "static");
            AssertWarning(report, "OscWiringTestMistakes.ReturnsValue", "void");
            AssertWarning(report, "OscWiringTestMistakes.TwoArguments", "引数");
            AssertWarning(report, "OscWiringTestMistakes.UnsupportedArgument", "引数");
            AssertWarning(report, "OscWiringTestMistakes.InvalidAddress", "no slash");

            // 宣言はあるので、その行には「登録する関数がありません」を重ねない
            Assert.That(report.Warnings, Has.None.StartsWith("行 /app/volume (Float) に登録する関数がありません"), warnings);
            Assert.That(report.Warnings, Has.None.StartsWith("行 /app/count (Int) に登録する関数がありません"), warnings);
        }

        [Test]
        public void Listeners_only_wiring_does_not_add_rows()
        {
            // 行の取捨を自分で行う利用側は WireListeners だけを呼ぶ。行は足さず、無い行への宣言を警告する
            receiver.bindings.Add(new OscReceiver.Binding { address = "/app/volume", kind = OscBindingKind.Float });

            var report = OscReceiverWiring.WireListeners(receiver, new Object[] { host }, Expected());

            Assert.That(receiver.bindings, Has.Count.EqualTo(1));
            AssertListener(Row("/app/volume").onFloat, host, nameof(OscWiringTestHost.SetVolume));
            AssertWarning(report, "OscWiringTestHost.SetCount", "/app/count の行がありません");
        }

        [Test]
        public void Without_a_definition_every_row_is_a_candidate()
        {
            receiver.bindings.Add(new OscReceiver.Binding { address = "/app/volume", kind = OscBindingKind.Float });

            var report = OscReceiverWiring.WireListeners(receiver, new Object[] { host });

            AssertListener(Row("/app/volume").onFloat, host, nameof(OscWiringTestHost.SetVolume));
            Assert.That(report.Warnings, Has.None.Contains("定義にありません"));
        }

        [Test]
        public void Targets_are_the_scripts_with_declarations_on_the_object_and_its_children()
        {
            var child = NewObject("child");
            child.transform.SetParent(receiver.transform, false);
            var mistakes = child.AddComponent<OscWiringTestMistakes>();
            child.AddComponent<BoxCollider>(); // 宣言の無い部品は含めない

            var targets = OscReceiverWiring.FindTargets(receiver);

            Assert.That(targets, Is.EquivalentTo(new Object[] { host, mistakes }));
        }

        [Test]
        public void Duplicate_rows_get_the_listener_once()
        {
            // 同じアドレスと型の行が 2 本(A3)。両方に登録すると 1 回の受信で 2 回呼ばれる
            receiver.bindings.Add(new OscReceiver.Binding { address = "/app/volume", kind = OscBindingKind.Float });
            receiver.bindings.Add(new OscReceiver.Binding { address = "/app/volume", kind = OscBindingKind.Float });

            var report = Wire(host);
            var second = Wire(host);

            var volumes = receiver.bindings.Where(binding => binding.address == "/app/volume").ToList();
            Assert.That(volumes.Sum(binding => binding.onFloat.GetPersistentEventCount()), Is.EqualTo(1));
            AssertWarning(report, "/app/volume", "2 本");
            Assert.That(second.Changes, Is.Empty, Lines(second.Changes));
        }

        [Test]
        public void Targets_under_a_nested_receiver_belong_to_that_receiver()
        {
            var child = NewObject("nested");
            child.transform.SetParent(receiver.transform, false);
            child.AddComponent<OscReceiver>();
            child.AddComponent<OscWiringTestMistakes>();

            Assert.That(OscReceiverWiring.FindTargets(receiver), Is.EquivalentTo(new Object[] { host }));
        }

        [Test]
        public void Kind_follows_the_method_arguments()
        {
            OscBindingKind Kind(string name)
            {
                Assert.That(OscReceiverWiring.TryGetKind(typeof(OscWiringTestHost).GetMethod(name), out var kind), Is.True, name);
                return kind;
            }

            Assert.That(Kind(nameof(OscWiringTestHost.SendMemberList)), Is.EqualTo(OscBindingKind.Trigger));
            Assert.That(Kind(nameof(OscWiringTestHost.SetCount)), Is.EqualTo(OscBindingKind.Int));
            Assert.That(Kind(nameof(OscWiringTestHost.SetVolume)), Is.EqualTo(OscBindingKind.Float));
            Assert.That(Kind(nameof(OscWiringTestHost.SetTitle)), Is.EqualTo(OscBindingKind.String));
            Assert.That(Kind(nameof(OscWiringTestHost.SetMute)), Is.EqualTo(OscBindingKind.Bool));
            Assert.That(Kind(nameof(OscWiringTestHost.ReceiveMemberValues)), Is.EqualTo(OscBindingKind.Record));
            Assert.That(Kind(nameof(OscWiringTestHost.ReceiveDeviceKeys)), Is.EqualTo(OscBindingKind.Strings));
            Assert.That(OscReceiverWiring.TryGetKind(typeof(OscWiringTestMistakes).GetMethod(nameof(OscWiringTestMistakes.TwoArguments)), out _), Is.False);
        }
    }
}
