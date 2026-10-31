// OscReceiverWiring.cs — 定義の行と、利用側のメソッドに付けた [OscAddress] の宣言から、OscReceiver の永続リスナーを組む(D-100)。
// 実行時の AddListener は A4 の警告になりインスペクタからも見えないので、UnityEventTools で永続リスナーとしてシーンに保存する。
// 登録の仕組みは案件に依存しないので受け口に持ち、利用側は「どのアドレスをどのメソッドで受けるか」を属性で書くだけにする。
using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEditor.Events;
using UnityEngine;
using UnityEngine.Events;
using Object = UnityEngine.Object;

namespace OscDesk.Receiver
{
    /// <summary>配線の結果。Changes は行った変更、Warnings は配線できなかった・対応の無い宣言や行。</summary>
    public sealed class OscWiringReport
    {
        public List<string> Changes { get; } = new List<string>();
        public List<string> Warnings { get; } = new List<string>();

        /// <summary>Console へ出す。変更は 1 件にまとめて Log、警告は 1 件ずつ LogWarning(Console から対象を選べるよう context を付ける)。</summary>
        public void LogToConsole(Object context)
        {
            var name = context != null ? context.name : "OscReceiver";
            if (Changes.Count == 0 && Warnings.Count == 0)
            {
                Debug.Log("OscReceiver の配線(" + name + "): 変更はありません。", context);
                return;
            }

            if (Changes.Count != 0)
            {
                Debug.Log("OscReceiver の配線(" + name + "): " + Changes.Count + " 件の変更\n" + string.Join("\n", Changes), context);
            }

            foreach (var warning in Warnings)
            {
                Debug.LogWarning("OscReceiver の配線(" + name + "): " + warning, context);
            }
        }
    }

    /// <summary>
    /// OscReceiver の対応表を定義に合わせ、[OscAddress] を付けたメソッドを行のイベントへ永続リスナーとして登録する。
    /// 何度実行しても同じ結果になる(既にある行・同じ関数のリスナーは足さない)。手で登録したリスナーと、宣言の無い行は消さない。
    /// </summary>
    public static class OscReceiverWiring
    {
        private const BindingFlags DeclaredMethods =
            BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;

        // 型ごとの宣言の一覧。インスペクタのボタンのたびに子のコンポーネントすべてを反射で舐め直さないため
        private static readonly Dictionary<Type, Declaration[]> DeclarationsByType = new Dictionary<Type, Declaration[]>();

        /// <summary>
        /// 定義から配線する: 定義にあって行が無いアドレスの行を足し、既存の Record の行のフィールド id と Record Row Ids を定義に揃え、
        /// targets の [OscAddress] のメソッドを定義にある行へ登録する。
        /// 行の取捨を自分で行いたい利用側(旧方式の行を除くなど)は、AddMissingRows / SyncRecordRows を使わずに WireListeners だけを呼ぶ。
        /// </summary>
        public static OscWiringReport WireFromDefinition(OscReceiver receiver, IEnumerable<Object> targets,
            IReadOnlyList<OscDefinitionParameter> parameters, IReadOnlyList<OscDefinitionRecord> records, OscWiringReport report = null)
        {
            if (receiver == null) throw new ArgumentNullException(nameof(receiver));
            if (parameters == null) throw new ArgumentNullException(nameof(parameters));
            report = report ?? new OscWiringReport();
            var expected = OscDefinitionRows.ExpectedBindings(parameters, records ?? Array.Empty<OscDefinitionRecord>());

            Undo.RecordObject(receiver, "Wire OSC bindings from definition");
            AddMissingRows(receiver, expected, report);
            SyncRecordRows(receiver, expected, report);
            WireListeners(receiver, targets, expected, report);
            return report;
        }

        /// <summary>定義にあって行が無いアドレスの行を足す(インスペクタの「定義にあって行が無いアドレスの行を追加」と同じ規則)。</summary>
        public static void AddMissingRows(OscReceiver receiver, IReadOnlyList<OscExpectedBinding> expected, OscWiringReport report)
        {
            if (receiver == null) throw new ArgumentNullException(nameof(receiver));
            if (expected == null) throw new ArgumentNullException(nameof(expected));
            Undo.RecordObject(receiver, "Add OSC bindings from definition");
            var existing = new HashSet<string>(StringComparer.Ordinal);
            foreach (var binding in receiver.bindings)
            {
                existing.Add(binding.address);
            }

            var added = 0;
            foreach (var row in expected)
            {
                if (!existing.Add(row.Address))
                {
                    continue;
                }

                receiver.bindings.Add(new OscReceiver.Binding
                {
                    address = row.Address,
                    kind = row.Kind,
                    recordFields = new List<string>(row.FieldIds),
                    recordRowIds = row.Kind == OscBindingKind.Record && row.RecordRowIds
                });
                added++;
                report?.Changes.Add("行を追加: " + row.Address + " (" + row.Kind + ")");
            }

            if (added != 0)
            {
                MarkChanged(receiver);
            }
        }

        /// <summary>
        /// 既存の Record の行のフィールド id と Record Row Ids を定義に揃える(A6 / A7 の解消)。
        /// インスペクタの「Record の行のフィールド id を定義に合わせる」と同じ。イベントの登録は触らない。
        /// </summary>
        public static void SyncRecordRows(OscReceiver receiver, IReadOnlyList<OscExpectedBinding> expected, OscWiringReport report)
        {
            if (receiver == null) throw new ArgumentNullException(nameof(receiver));
            if (expected == null) throw new ArgumentNullException(nameof(expected));
            Undo.RecordObject(receiver, "Sync OSC record fields from definition");
            var recordsByAddress = OscDefinitionRows.RecordBindingsByAddress(expected);
            var changed = false;
            foreach (var binding in receiver.bindings)
            {
                if (binding.kind != OscBindingKind.Record || !recordsByAddress.TryGetValue(binding.address, out var row))
                {
                    continue;
                }

                if (!SameIds(binding.recordFields, row.FieldIds))
                {
                    binding.recordFields = new List<string>(row.FieldIds);
                    changed = true;
                    report?.Changes.Add("Record の行のフィールド id を定義に合わせた: " + row.Address
                        + " (" + (row.FieldIds.Count == 0 ? "なし" : string.Join(", ", row.FieldIds)) + ")");
                }

                if (binding.recordRowIds != row.RecordRowIds)
                {
                    binding.recordRowIds = row.RecordRowIds;
                    changed = true;
                    report?.Changes.Add("Record の行の Record Row Ids を定義に合わせた: " + row.Address
                        + " (" + (row.RecordRowIds ? "オン" : "オフ") + ")");
                }
            }

            if (changed)
            {
                MarkChanged(receiver);
            }
        }

        /// <summary>
        /// targets の [OscAddress] のメソッドを、宣言したアドレスの行のうち型が引数と合う行のイベントへ永続リスナーとして登録する。
        /// expected を渡すと定義にあるアドレスの行だけを対象にし、定義にないアドレスの宣言は警告する(null なら対応表の行すべてが対象)。
        /// 行が無い・型が合わない・メソッドの形が登録できない宣言と、宣言も登録済みの関数も無い行は警告する。行は足さない。
        /// </summary>
        public static OscWiringReport WireListeners(OscReceiver receiver, IEnumerable<Object> targets,
            IReadOnlyList<OscExpectedBinding> expected = null, OscWiringReport report = null)
        {
            if (receiver == null) throw new ArgumentNullException(nameof(receiver));
            report = report ?? new OscWiringReport();

            HashSet<string> definitionAddresses = null;
            if (expected != null)
            {
                definitionAddresses = new HashSet<string>(StringComparer.Ordinal);
                foreach (var row in expected)
                {
                    definitionAddresses.Add(row.Address);
                }
            }

            Undo.RecordObject(receiver, "Wire OSC listeners");
            var declaredAddresses = new HashSet<string>(StringComparer.Ordinal);
            var seenTargets = new HashSet<Object>();
            var changed = false;
            foreach (var target in targets ?? Array.Empty<Object>())
            {
                // 破棄済み(Missing Script を含む)は == null になる。同じ対象を二度渡されても宣言を二度数えない
                if (target == null || !seenTargets.Add(target))
                {
                    continue;
                }

                foreach (var declaration in DeclarationsOf(target.GetType()))
                {
                    changed |= Wire(receiver, target, declaration, definitionAddresses, declaredAddresses, report);
                }
            }

            foreach (var binding in receiver.bindings)
            {
                if (definitionAddresses != null && !definitionAddresses.Contains(binding.address))
                {
                    continue; // 定義にない行は A1 としてインスペクタが警告する
                }

                if (!declaredAddresses.Contains(binding.address) && binding.ListenerCount == 0)
                {
                    report.Warnings.Add("行 " + binding.address + " (" + binding.kind + ") に登録する関数がありません。"
                        + "受けるメソッドに [OscAddress(\"" + binding.address + "\")] を付けるか、イベントに手で関数を登録してください。");
                }
            }

            if (changed)
            {
                MarkChanged(receiver);
            }

            return report;
        }

        /// <summary>
        /// インスペクタの「定義から配線」が対象にするオブジェクト: OscReceiver と同じ GameObject とその子の MonoBehaviour(OscReceiver 自身を除く)。
        /// </summary>
        public static List<Object> FindTargets(OscReceiver receiver)
        {
            if (receiver == null) throw new ArgumentNullException(nameof(receiver));
            var targets = new List<Object>();
            foreach (var behaviour in receiver.GetComponentsInChildren<MonoBehaviour>(true))
            {
                if (behaviour != null && !(behaviour is OscReceiver) && DeclarationsOf(behaviour.GetType()).Length != 0)
                {
                    targets.Add(behaviour);
                }
            }

            return targets;
        }

        /// <summary>
        /// メソッドの引数から、受けられる行の型を求める。引数なしは Trigger、int / float / string / bool / OscRecord / string[] の 1 個は
        /// それぞれ Int / Float / String / Bool / Record / Strings。それ以外(引数 2 個以上・ref / out・その他の型)は false。
        /// </summary>
        public static bool TryGetKind(MethodInfo method, out OscBindingKind kind)
        {
            if (method == null) throw new ArgumentNullException(nameof(method));
            kind = OscBindingKind.Trigger;
            var parameters = method.GetParameters();
            if (parameters.Length == 0)
            {
                return true;
            }

            if (parameters.Length != 1)
            {
                return false;
            }

            var type = parameters[0].ParameterType;
            if (type == typeof(int)) kind = OscBindingKind.Int;
            else if (type == typeof(float)) kind = OscBindingKind.Float;
            else if (type == typeof(string)) kind = OscBindingKind.String;
            else if (type == typeof(bool)) kind = OscBindingKind.Bool;
            else if (type == typeof(OscRecord)) kind = OscBindingKind.Record;
            else if (type == typeof(string[])) kind = OscBindingKind.Strings;
            else return false;
            return true;
        }

        private static bool Wire(OscReceiver receiver, Object target, Declaration declaration, HashSet<string> definitionAddresses,
            HashSet<string> declaredAddresses, OscWiringReport report)
        {
            var method = declaration.Method;
            var label = target.GetType().Name + "." + method.Name;
            var address = declaration.Address;
            if (!OscBindingAudit.IsValidAddress(address))
            {
                report.Warnings.Add(label + " の [OscAddress(\"" + address + "\")] はアドレスとして使えません"
                    + "(空、/ で始まらない、空白やワイルドカードを含む、または /sys・/oscdesk 配下)。");
                return false;
            }

            // 形が登録できない宣言でも、行の「登録する関数がありません」は重ねて出さない(原因は宣言の側にあるため)
            declaredAddresses.Add(address);
            if (!CanRegister(method, out var kind, out var problem))
            {
                report.Warnings.Add(label + " を " + address + " に登録できません: " + problem);
                return false;
            }

            if (definitionAddresses != null && !definitionAddresses.Contains(address))
            {
                report.Warnings.Add(label + " の宣言したアドレス " + address + " は定義にありません(配線しません)。");
                return false;
            }

            var rows = new List<OscReceiver.Binding>();
            var kinds = new List<string>();
            foreach (var binding in receiver.bindings)
            {
                if (binding.address != address)
                {
                    continue;
                }

                kinds.Add(binding.kind.ToString());
                if (binding.kind == kind)
                {
                    rows.Add(binding);
                }
            }

            if (kinds.Count == 0)
            {
                report.Warnings.Add(label + " の宣言したアドレス " + address + " の行がありません。"
                    + "「定義にあって行が無いアドレスの行を追加」で行を作るか、行を手で足してください。");
                return false;
            }

            if (rows.Count == 0)
            {
                report.Warnings.Add("行 " + address + " の型は " + string.Join(" / ", kinds) + " ですが、" + label + " は " + kind
                    + " の行で受ける形(" + Signature(kind) + ")です。行の型かメソッドの引数を直してから再実行してください。");
                return false;
            }

            var changed = false;
            foreach (var binding in rows)
            {
                var unityEvent = EventOf(binding);
                if (HasListener(unityEvent, target, method.Name))
                {
                    continue;
                }

                AddListener(binding, target, method);
                changed = true;
                report.Changes.Add("リスナーを登録: " + address + " (" + kind + ") -> " + target.name + "." + method.Name);
            }

            return changed;
        }

        private static bool CanRegister(MethodInfo method, out OscBindingKind kind, out string problem)
        {
            kind = OscBindingKind.Trigger;
            if (method.IsStatic)
            {
                problem = "static のメソッドは永続リスナーにできません。インスタンスメソッドにしてください。";
                return false;
            }

            if (!method.IsPublic)
            {
                // インスペクタで見えて手でも選べる形にそろえる(public でないとイベントの関数の一覧に出ない)
                problem = "public にしてください。";
                return false;
            }

            if (method.ContainsGenericParameters)
            {
                problem = "ジェネリックメソッドは登録できません。";
                return false;
            }

            if (method.ReturnType != typeof(void))
            {
                problem = "戻り値は void にしてください。";
                return false;
            }

            if (!TryGetKind(method, out kind))
            {
                problem = "引数は無し(Trigger)か、int / float / string / bool / OscRecord / string[] の 1 個にしてください。";
                return false;
            }

            problem = null;
            return true;
        }

        private static string Signature(OscBindingKind kind)
        {
            switch (kind)
            {
                case OscBindingKind.Int: return "void F(int)";
                case OscBindingKind.Float: return "void F(float)";
                case OscBindingKind.String: return "void F(string)";
                case OscBindingKind.Bool: return "void F(bool)";
                case OscBindingKind.Record: return "void F(OscRecord)";
                case OscBindingKind.Strings: return "void F(string[])";
                default: return "void F()";
            }
        }

        private static UnityEventBase EventOf(OscReceiver.Binding binding)
        {
            switch (binding.kind)
            {
                case OscBindingKind.Int: return binding.onInt;
                case OscBindingKind.Float: return binding.onFloat;
                case OscBindingKind.String: return binding.onString;
                case OscBindingKind.Bool: return binding.onBool;
                case OscBindingKind.Record: return binding.onRecord;
                case OscBindingKind.Strings: return binding.onStrings;
                default: return binding.onTrigger;
            }
        }

        private static bool HasListener(UnityEventBase unityEvent, Object target, string method)
        {
            for (var i = 0; i < unityEvent.GetPersistentEventCount(); i++)
            {
                if (unityEvent.GetPersistentTarget(i) == target && unityEvent.GetPersistentMethodName(i) == method)
                {
                    return true;
                }
            }

            return false;
        }

        private static void AddListener(OscReceiver.Binding binding, Object target, MethodInfo method)
        {
            // Dynamic(受信値をそのまま渡す)で登録する。型は CanRegister で行の型と合わせてある
            switch (binding.kind)
            {
                case OscBindingKind.Int:
                    UnityEventTools.AddPersistentListener(binding.onInt, Create<UnityAction<int>>(target, method));
                    break;
                case OscBindingKind.Float:
                    UnityEventTools.AddPersistentListener(binding.onFloat, Create<UnityAction<float>>(target, method));
                    break;
                case OscBindingKind.String:
                    UnityEventTools.AddPersistentListener(binding.onString, Create<UnityAction<string>>(target, method));
                    break;
                case OscBindingKind.Bool:
                    UnityEventTools.AddPersistentListener(binding.onBool, Create<UnityAction<bool>>(target, method));
                    break;
                case OscBindingKind.Record:
                    UnityEventTools.AddPersistentListener(binding.onRecord, Create<UnityAction<OscRecord>>(target, method));
                    break;
                case OscBindingKind.Strings:
                    UnityEventTools.AddPersistentListener(binding.onStrings, Create<UnityAction<string[]>>(target, method));
                    break;
                default:
                    UnityEventTools.AddPersistentListener(binding.onTrigger, Create<UnityAction>(target, method));
                    break;
            }
        }

        private static T Create<T>(Object target, MethodInfo method) where T : Delegate
        {
            return (T)Delegate.CreateDelegate(typeof(T), target, method);
        }

        private static Declaration[] DeclarationsOf(Type type)
        {
            if (DeclarationsByType.TryGetValue(type, out var cached))
            {
                return cached;
            }

            var declarations = new List<Declaration>();
            var seen = new HashSet<MethodInfo>();
            // 基底の private のメソッドの宣言も拾う(警告するため)。override は最も派生した 1 つだけを数える
            var engineAssembly = typeof(MonoBehaviour).Assembly;
            for (var current = type; current != null && current.Assembly != engineAssembly; current = current.BaseType)
            {
                foreach (var method in current.GetMethods(DeclaredMethods))
                {
                    if (!seen.Add(method.GetBaseDefinition()))
                    {
                        continue;
                    }

                    var addresses = new HashSet<string>(StringComparer.Ordinal);
                    foreach (var attribute in method.GetCustomAttributes<OscAddressAttribute>(true))
                    {
                        if (addresses.Add(attribute.Address))
                        {
                            declarations.Add(new Declaration(method, attribute.Address));
                        }
                    }
                }
            }

            var result = declarations.ToArray();
            DeclarationsByType[type] = result;
            return result;
        }

        private static bool SameIds(IReadOnlyList<string> a, IReadOnlyList<string> b)
        {
            var left = a ?? Array.Empty<string>();
            var right = b ?? Array.Empty<string>();
            if (left.Count != right.Count)
            {
                return false;
            }

            for (var i = 0; i < left.Count; i++)
            {
                if (!string.Equals(left[i], right[i], StringComparison.Ordinal))
                {
                    return false;
                }
            }

            return true;
        }

        private static void MarkChanged(OscReceiver receiver)
        {
            EditorUtility.SetDirty(receiver);
            // プレハブのインスタンスでは、記録しないとリスナーの追加がシーンに保存されない
            PrefabUtility.RecordPrefabInstancePropertyModifications(receiver);
        }

        private readonly struct Declaration
        {
            public MethodInfo Method { get; }
            public string Address { get; }

            public Declaration(MethodInfo method, string address)
            {
                Method = method;
                Address = address;
            }
        }
    }
}
