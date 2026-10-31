// OscOperation.cs — 受け手が宣言する操作 1 つ(アドレスの末尾の名前・型・制約・表示ヒント・処理)。DESIGN.md D-107。
// UnityEngine に依存しない。
using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 操作の処理。成功なら null、処理できなかったら失敗の理由(/sys/failed に載せる短い英語。例 "name in use")を返す。
    /// 例外は呼び出し側(受け口)が捕まえて "exception" として扱う。
    /// </summary>
    public delegate string OscOperationHandler(OscInvocation invocation);

    /// <summary>
    /// 受け手(OscTarget など)が受け付ける操作 1 つ。アドレスは /パッケージ/対象/操作 の「操作」の部分だけを持ち、
    /// 対象名は受け手が決める(同じ宣言を、生成で名前が変わる受け手でも使い回すため)。
    /// 制約と表示ヒントは定義(D-103)と同じ軸で、今は宣言として持つだけ(設計図で送るのは HID-379)。
    /// </summary>
    public sealed class OscOperation
    {
        private static readonly string[] NoStrings = new string[0];

        public string Name { get; }
        public OscBindingKind Kind { get; }
        public OscOperationHandler Handler { get; }

        /// <summary>数値の範囲(D-103 の range)。無ければ null。</summary>
        public float? Min { get; private set; }
        public float? Max { get; private set; }

        /// <summary>数値の刻み(D-103 の step)。無ければ null。</summary>
        public float? Step { get; private set; }

        /// <summary>文字列の選択肢(D-103 の options)。無ければ空。</summary>
        public IReadOnlyList<string> Options { get; private set; } = NoStrings;

        /// <summary>表示ヒント(D-103 の widget。slider / input / switch / button / select)。無ければ空(型と制約から決める)。</summary>
        public string Widget { get; private set; } = string.Empty;

        /// <summary>Record の操作のフィールド id(宣言順)。Record 以外では空。</summary>
        public IReadOnlyList<string> RecordFields { get; private set; } = NoStrings;

        /// <summary>Record の操作が [s:行 ID, s:名前, フィールド…] を受けるか(D-087)。</summary>
        public bool RecordRowIds { get; private set; }

        public OscOperation(string name, OscBindingKind kind, OscOperationHandler handler)
        {
            Name = name ?? string.Empty;
            Kind = kind;
            Handler = handler ?? throw new ArgumentNullException(nameof(handler));
        }

        public OscOperation WithRange(float min, float max)
        {
            Min = min;
            Max = max;
            return this;
        }

        public OscOperation WithStep(float step)
        {
            Step = step;
            return this;
        }

        public OscOperation WithOptions(params string[] options)
        {
            Options = options ?? NoStrings;
            return this;
        }

        public OscOperation WithWidget(string widget)
        {
            Widget = widget ?? string.Empty;
            return this;
        }

        public OscOperation WithRecordFields(IReadOnlyList<string> fields, bool rowIds = false)
        {
            RecordFields = fields ?? NoStrings;
            RecordRowIds = rowIds;
            return this;
        }
    }

    /// <summary>
    /// 受け手が操作を宣言する入れ物。型ごとの短い書き方を用意し、拡張パッケージの実装者が OscInvocation を触らずに書けるようにする。
    /// </summary>
    public sealed class OscOperationList
    {
        private readonly List<OscOperation> operations = new List<OscOperation>();

        public IReadOnlyList<OscOperation> Operations => operations;

        public OscOperation Add(OscOperation operation)
        {
            operations.Add(operation ?? throw new ArgumentNullException(nameof(operation)));
            return operation;
        }

        public OscOperation Add(string name, OscBindingKind kind, OscOperationHandler handler)
        {
            return Add(new OscOperation(name, kind, handler));
        }

        public OscOperation Trigger(string name, Action action)
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            return Add(name, OscBindingKind.Trigger, _ => { action(); return null; });
        }

        public OscOperation Int(string name, Action<int> action)
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            return Add(name, OscBindingKind.Int, invocation => { action(invocation.IntValue); return null; });
        }

        public OscOperation Float(string name, Action<float> action)
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            return Add(name, OscBindingKind.Float, invocation => { action(invocation.FloatValue); return null; });
        }

        public OscOperation String(string name, Action<string> action)
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            return Add(name, OscBindingKind.String, invocation => { action(invocation.StringValue); return null; });
        }

        public OscOperation Bool(string name, Action<bool> action)
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            return Add(name, OscBindingKind.Bool, invocation => { action(invocation.BoolValue); return null; });
        }

        public OscOperation Strings(string name, Action<string[]> action)
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            return Add(name, OscBindingKind.Strings, invocation => { action(invocation.StringsValue); return null; });
        }

        public OscOperation Record(string name, IReadOnlyList<string> fields, bool rowIds, Action<OscRecord> action)
        {
            if (action == null) throw new ArgumentNullException(nameof(action));
            return Add(name, OscBindingKind.Record, invocation => { action(invocation.RecordValue); return null; })
                .WithRecordFields(fields, rowIds);
        }
    }
}
