// OscReceiver.cs — 汎用の OSC 受け口(uOSC 2.2.0)。docs/UNITY_PROTOCOL.md「汎用レシーバ」参照。
// 使い方: 空の GameObject に追加し(uOscServer / uOscClient は自動追加される)、
//   - uOscServer.port   = Surface config の unity.sendPort(既定 7090)
//   - uOscClient.address/port = Surface ホスト : unity.receivePort(既定 127.0.0.1 : 7091)
// を設定し、対応表に「アドレス → 型 → UnityEvent」を並べる。振り分けと検査は中核(Core/、UnityEngine 非依存)が持つ。
// 名前空間 OscDesk.Receiver に置くのは、ホスト側の同名クラス(別ライブラリの OscReceiver)と衝突させないため(D-063)。
using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;
using UnityEngine.Events;
using uOSC;

namespace OscDesk.Receiver
{
    [RequireComponent(typeof(uOscServer), typeof(uOscClient))]
    public sealed class OscReceiver : MonoBehaviour
    {
        [Serializable] public sealed class IntEvent : UnityEvent<int> { }
        [Serializable] public sealed class FloatEvent : UnityEvent<float> { }
        [Serializable] public sealed class StringEvent : UnityEvent<string> { }
        [Serializable] public sealed class BoolEvent : UnityEvent<bool> { }
        [Serializable] public sealed class RecordEvent : UnityEvent<OscRecord> { }
        [Serializable] public sealed class StringsEvent : UnityEvent<string[]> { }

        /// <summary>対応表の 1 行。kind に対応するイベントだけが使われる(他は無視される)。</summary>
        [Serializable]
        public sealed class Binding
        {
            public string address = "/";
            public OscBindingKind kind = OscBindingKind.Trigger;
            public UnityEvent onTrigger = new UnityEvent();
            public IntEvent onInt = new IntEvent();
            public FloatEvent onFloat = new FloatEvent();
            public StringEvent onString = new StringEvent();
            public BoolEvent onBool = new BoolEvent();

            [Tooltip("Record の行で、先頭のキーを除いた引数を受けるイベント。void F(OscRecord) を Dynamic で登録する。")]
            public RecordEvent onRecord = new RecordEvent();

            [Tooltip("Record の行のフィールド id(定義の fields の宣言順)。OscRecord.GetInt(\"slot\") のような id での取り出しに使う。"
                + "設定すると、数が合わない受信ではイベントを呼ばない。空ならフィールドの数を検査せず、番号でだけ取り出せる。")]
            public List<string> recordFields = new List<string>();

            [Tooltip("Strings の行で、s の引数の並び(0 個以上)を受けるイベント。void F(string[]) を Dynamic で登録する。"
                + "UI で管理するキーの一覧(keysFrom.source ui)を受ける口で、全部消したときは空の配列で呼ぶ。")]
            public StringsEvent onStrings = new StringsEvent();

            public int ListenerCount
            {
                get
                {
                    switch (kind)
                    {
                        case OscBindingKind.Int: return onInt.GetPersistentEventCount();
                        case OscBindingKind.Float: return onFloat.GetPersistentEventCount();
                        case OscBindingKind.String: return onString.GetPersistentEventCount();
                        case OscBindingKind.Bool: return onBool.GetPersistentEventCount();
                        case OscBindingKind.Record: return onRecord.GetPersistentEventCount();
                        case OscBindingKind.Strings: return onStrings.GetPersistentEventCount();
                        default: return onTrigger.GetPersistentEventCount();
                    }
                }
            }

            public OscBindingRow ToRow()
            {
                return new OscBindingRow(address, kind, ListenerCount, kind == OscBindingKind.Record ? recordFields : null);
            }
        }

        [Tooltip("アドレス → 型 → UnityEvent の対応表。受信したアドレスと完全一致する行のイベントを呼ぶ。")]
        public List<Binding> bindings = new List<Binding>();

        [Tooltip("OscDesk のサーフェス定義 JSON(.json)。インスペクタでの警告と行の作成に使うだけで、実行時の動作には関与しない。")]
        [HideInInspector] public TextAsset definitionFile; // カスタムインスペクタが描画する

        [Tooltip("定義にないアドレスの受信や、型が合わない受信をログに出す。")]
        [SerializeField] private bool logUnhandled = true;

        [Tooltip("この秒数を超えて受信(/sys/ping を含む)が無ければ「途絶」とみなし onLinkLost を呼ぶ。0 で判定しない。再開で onLinkResumed を呼ぶ。")]
        [SerializeField, Min(0f)] private float silenceTimeoutSeconds = 0f;

        [Tooltip("受信が silenceTimeoutSeconds を超えて途絶えたときに呼ぶ。")]
        public UnityEvent onLinkLost = new UnityEvent();

        [Tooltip("途絶の後に受信が再開したときに呼ぶ(ブリッジが保持値を再送し始める合図)。")]
        public UnityEvent onLinkResumed = new UnityEvent();

        private uOscServer server;
        private uOscClient client; // 全送信の出口 = 設定された返信先
        private OscDispatcher dispatcher;
        private int received;
        private OscLinkMonitor link;

        /// <summary>何かを受信済みか(/sys/ping を含む)。</summary>
        public bool HasReceived { get { return link != null && link.HasReceived; } }

        /// <summary>最後に受信した時刻(Time.realtimeSinceStartup。受信前は負)。/sys/ping を含む。</summary>
        public float LastReceivedRealtime { get { return HasReceived ? (float)link.LastReceivedAt : -1f; } }

        /// <summary>最後の受信からの経過秒(受信前は無限大)。</summary>
        public float SecondsSinceLastReceive { get { return HasReceived ? Time.realtimeSinceStartup - (float)link.LastReceivedAt : float.PositiveInfinity; } }

        // 受信ごとの確保を避けるための使い回し
        private readonly List<OscInvocation> invocations = new List<OscInvocation>();
        private readonly List<int> mismatches = new List<int>();

        private void OnEnable()
        {
            server = GetComponent<uOscServer>();
            client = GetComponent<uOscClient>();

            // 対応表の編集は Play 前のインスペクタで行う前提なので、有効化のたびに作り直す
            var rows = new List<OscBindingRow>(bindings.Count);
            foreach (var binding in bindings)
            {
                rows.Add(binding.ToRow());
            }

            dispatcher = new OscDispatcher(rows);
            foreach (var warning in OscBindingAudit.Audit(null, rows))
            {
                Debug.LogWarning("OscReceiver " + warning.Code + ": " + warning.Message, this);
            }

            link = new OscLinkMonitor(silenceTimeoutSeconds);
            server.onDataReceived.AddListener(OnDataReceived);
        }

        private void Update()
        {
            if (link != null && link.PollLost(Time.realtimeSinceStartup))
            {
                InvokeLinkEvent(onLinkLost);
            }
        }

        private void OnDisable()
        {
            server.onDataReceived.RemoveListener(OnDataReceived);
        }

        private void OnDataReceived(Message message)
        {
            received += 1;
            if (link.NotifyReceived(Time.realtimeSinceStartup))
            {
                InvokeLinkEvent(onLinkResumed);
            }

            switch (message.address)
            {
                case "/sys/ping":
                    if (message.values.Length > 0 && message.values[0] is int seq)
                    {
                        client.Send("/sys/pong", seq);
                    }
                    return;
                case "/sys/stats/request":
                    client.Send("/sys/stats", BuildStatsJson());
                    return;
            }

            if (message.address.StartsWith("/sys/", StringComparison.Ordinal))
            {
                return; // 上記以外の /sys/* は計数のみ。応答しない
            }

            // 先にエコーする。購読者の例外でエコーバックが止まると、UI が値を確定できなくなるため
            var echoed = new object[message.values.Length];
            for (var i = 0; i < message.values.Length; i++)
            {
                echoed[i] = OscDispatcher.NormalizeForEcho(message.values[i]);
            }

            client.Send(message.address, echoed);

            var fired = dispatcher.Dispatch(message.address, message.values, invocations, mismatches);
            for (var i = 0; i < invocations.Count; i++)
            {
                Invoke(invocations[i]);
            }

            if (logUnhandled)
            {
                if (fired == 0 && mismatches.Count == 0 && !dispatcher.HasAddress(message.address))
                {
                    Debug.LogWarning("OscReceiver: no binding for " + message.address, this);
                }

                foreach (var index in mismatches)
                {
                    var row = bindings[index].ToRow();
                    if (row.Kind == OscBindingKind.Record)
                    {
                        // レコードの不正な形(先頭が s でない・フィールド数の違い)でもエコーは上で返している。イベントだけ呼ばない
                        Debug.LogWarning("OscReceiver: record mismatch for " + OscDispatcher.Describe(row) + ": "
                            + OscDispatcher.ExplainMismatch(row, message.values), this);
                    }
                    else
                    {
                        Debug.LogWarning("OscReceiver: argument type mismatch for " + OscDispatcher.Describe(row), this);
                    }
                }
            }
        }

        /// <summary>
        /// 文字列の一覧を、`s` 引数 N 個の 1 メッセージとして OscDesk へ送る(定義の optionsFrom.address 宛て)。
        /// 要求(optionsFrom.request)に応える Trigger 行の関数から呼ぶほか、構成が変わったときの自発送信にも使える。
        /// 1 データグラムの上限を超える一覧は送らずにログへ出し false を返す。
        /// </summary>
        public bool SendStrings(string address, IReadOnlyList<string> values)
        {
            if (!OscStringList.TryValidate(address, values, out var reason))
            {
                Debug.LogWarning("OscReceiver: 一覧を送りませんでした(" + address + "): " + reason, this);
                return false;
            }

            if (client == null)
            {
                client = GetComponent<uOscClient>();
            }

            var args = new object[values.Count];
            for (var i = 0; i < args.Length; i++)
            {
                args[i] = values[i] ?? string.Empty;
            }

            client.Send(address, args);
            return true;
        }

        private void InvokeLinkEvent(UnityEvent linkEvent)
        {
            try
            {
                linkEvent.Invoke();
            }
            catch (Exception exception)
            {
                // 利用者の例外で受信処理(エコー・振り分け)を止めない
                Debug.LogException(exception, this);
            }
        }

        private void Invoke(OscInvocation invocation)
        {
            var binding = bindings[invocation.RowIndex];
            try
            {
                switch (invocation.Kind)
                {
                    case OscBindingKind.Int: binding.onInt.Invoke(invocation.IntValue); break;
                    case OscBindingKind.Float: binding.onFloat.Invoke(invocation.FloatValue); break;
                    case OscBindingKind.String: binding.onString.Invoke(invocation.StringValue); break;
                    case OscBindingKind.Bool: binding.onBool.Invoke(invocation.BoolValue); break;
                    case OscBindingKind.Record: binding.onRecord.Invoke(invocation.RecordValue); break;
                    case OscBindingKind.Strings: binding.onStrings.Invoke(invocation.StringsValue); break;
                    default: binding.onTrigger.Invoke(); break;
                }
            }
            catch (Exception exception)
            {
                // 利用者のスクリプトの例外で他の行の発火を止めない
                Debug.LogException(exception, this);
            }
        }

        private string BuildStatsJson()
        {
            return "{\"received\":" + received.ToString(CultureInfo.InvariantCulture)
                + ",\"parseErrors\":0,\"lastReceivedAt\":\""
                + DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture) + "\"}";
        }
    }
}
