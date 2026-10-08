// OscReceiver.cs — 汎用の OSC 受け口(uOSC 2.2.0)。docs/UNITY_PROTOCOL.md「汎用レシーバ」参照。
// 使い方: 空の GameObject に追加し(uOscServer / uOscClient は自動追加される)、
//   - uOscServer.port   = Surface config の unity.sendPort(既定 7090)
//   - uOscClient.address/port = Surface ホスト : unity.receivePort(既定 127.0.0.1 : 7091)
// を設定し、対応表に「アドレス → 型 → UnityEvent」を並べる。振り分けと検査は OscDesk.Receiver(UnityEngine 非依存)が持つ。
using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;
using UnityEngine.Events;
using uOSC;
using OscDesk.Receiver;

[RequireComponent(typeof(uOscServer), typeof(uOscClient))]
public sealed class OscReceiver : MonoBehaviour
{
    [Serializable] public sealed class IntEvent : UnityEvent<int> { }
    [Serializable] public sealed class FloatEvent : UnityEvent<float> { }
    [Serializable] public sealed class StringEvent : UnityEvent<string> { }
    [Serializable] public sealed class BoolEvent : UnityEvent<bool> { }

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
                    default: return onTrigger.GetPersistentEventCount();
                }
            }
        }

        public OscBindingRow ToRow()
        {
            return new OscBindingRow(address, kind, ListenerCount);
        }
    }

    [Tooltip("アドレス → 型 → UnityEvent の対応表。受信したアドレスと完全一致する行のイベントを呼ぶ。")]
    public List<Binding> bindings = new List<Binding>();

    [Tooltip("OscDesk のサーフェス定義 JSON(.json)。インスペクタでの警告と行の作成に使うだけで、実行時の動作には関与しない。")]
    [HideInInspector] public TextAsset definitionFile; // カスタムインスペクタが描画する

    [Tooltip("定義にないアドレスの受信や、型が合わない受信をログに出す。")]
    [SerializeField] private bool logUnhandled = true;

    private uOscServer server;
    private uOscClient client; // 全送信の出口 = 設定された返信先
    private OscDispatcher dispatcher;
    private int received;

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

        server.onDataReceived.AddListener(OnDataReceived);
    }

    private void OnDisable()
    {
        server.onDataReceived.RemoveListener(OnDataReceived);
    }

    private void OnDataReceived(Message message)
    {
        received += 1;

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
                Debug.LogWarning("OscReceiver: argument type mismatch for " + OscDispatcher.Describe(bindings[index].ToRow()), this);
            }
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
