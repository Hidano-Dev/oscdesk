// OscReceiver.cs — 汎用の OSC 受け口。docs/UNITY_PROTOCOL.md「汎用レシーバ」参照。
// 使い方: 空の GameObject に追加し、
//   - Listen Port = OscDesk の config の unity.sendPort(既定 7090)
//   - Reply Host / Reply Port = OscDesk ホスト : bridge.oscListenPort(既定 127.0.0.1 : 7091)
// を設定し、対応表に「アドレス → 型 → UnityEvent」を並べる。振り分けと検査、OSC のエンコード・デコードと UDP は
// 中核(Core/、UnityEngine 非依存)が持ち、外部の OSC ライブラリには依存しない(D-095)。
// 名前空間 OscDesk.Receiver に置くのは、ホスト側の同名クラス(別ライブラリの OscReceiver)と衝突させないため(D-063)。
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.Serialization;

namespace OscDesk.Receiver
{
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

            [Tooltip("Record の行で、受信が [s:行 ID, s:名前, フィールド…] の形か。キーの一覧を OscDesk の UI で管理するレコード"
                + "(keysFrom.source ui)はオンにする。オンなら OscRecord.Id に不変の行 ID、Key に名前が入り、名前の変更は同じ Id で届く。"
                + "オフなら先頭の s がキーで、Id と Key は同じ。")]
            public bool recordRowIds;

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
                var isRecord = kind == OscBindingKind.Record;
                return new OscBindingRow(address, kind, ListenerCount, isRecord ? recordFields : null, isRecord && recordRowIds);
            }
        }

        [Tooltip("OSC を受ける UDP ポート。OscDesk の config の unity.sendPort(既定 7090)に合わせる。"
            + "0.0.0.0 で待ち受けるので、OscDesk の「全てのデバイス」(ブロードキャスト)も届く。")]
        [SerializeField] private int listenPort = 7090;

        [Tooltip("pong・エコー・一覧を返す先のホスト。OscDesk を動かす PC の IP(同じ PC なら 127.0.0.1)。ホスト名も書ける(有効化のときに引く)。")]
        [SerializeField] private string replyHost = "127.0.0.1";

        [Tooltip("返信先のポート。OscDesk の config の bridge.oscListenPort(既定 7091)に合わせる。")]
        [SerializeField] private int replyPort = 7091;

        [Tooltip("アドレス → 型 → UnityEvent の対応表。受信したアドレスと完全一致する行のイベントを呼ぶ。"
            + "受信したアドレスが OSC 1.0 のパターン(* ? [...] {a,b})なら、一致した行をすべて呼ぶ。")]
        public List<Binding> bindings = new List<Binding>();

        [Tooltip("OscDesk のサーフェス定義 JSON(.json)。インスペクタでの警告と行の作成に使うだけで、実行時の動作には関与しない。")]
        [HideInInspector] public TextAsset definitionFile; // カスタムインスペクタが描画する

        // 旧名 logUnhandled は「行の無いアドレス」も含めて出していた。意味を不一致と読めないデータに絞って名前を変え、
        // 既存のシーン・プレハブの値はそのまま引き継ぐ(D-102)
        [Tooltip("行はあるのに型が合わない受信・Record の形が合わない受信と、読めないデータグラムをログに出す。")]
        [FormerlySerializedAs("logUnhandled")]
        [SerializeField] private bool logMismatches = true;

        [Tooltip("行の無いアドレスの受信をログに出す(同じアドレスは 1 回だけ)。自分に無い対象への命令は通常の運用で届き、"
            + "受け口は黙って無視する(エコーは返す)ので、既定では出さない。行の登録漏れを調べるときに有効にする。")]
        [SerializeField] private bool logUnboundAddresses;

        [Tooltip("受けたが処理しなかったものを /sys/ignored(行の無いアドレス)・/sys/failed(型の不一致・Record の不一致・受け手の例外)で"
            + "OscDesk へ知らせる。エコーの後に、データグラム(bundle なら 1 個)につき各 1 メッセージまで返す。受け側の OscDesk が使うのは"
            + "送り先の表示だけで、オフにしても振り分けとエコーは変わらない。")]
        [SerializeField] private bool reportOutcomes = true;

        [Tooltip("この秒数を超えて受信(/sys/ping を含む)が無ければ「途絶」とみなし onLinkLost を呼ぶ。0 で判定しない。再開で onLinkResumed を呼ぶ。")]
        [SerializeField, Min(0f)] private float silenceTimeoutSeconds = 0f;

        [Tooltip("受信が silenceTimeoutSeconds を超えて途絶えたときに呼ぶ。")]
        public UnityEvent onLinkLost = new UnityEvent();

        [Tooltip("途絶の後に受信が再開したときに呼ぶ(ブリッジが保持値を再送し始める合図)。")]
        public UnityEvent onLinkResumed = new UnityEvent();

        private OscUdpTransport transport;
        private IPEndPoint replyEndPoint; // 全送信の出口 = 設定された返信先(受信データグラムの送信元へは返さない。UNITY_PROTOCOL §6.1)
        private bool sendFailureLogged;
        private OscDispatcher dispatcher;
        private int received;
        private int parseErrors;
        private OscLinkMonitor link;

        /// <summary>OSC を受ける UDP ポート。有効な間に変えると、待ち受けを開き直す。</summary>
        public int ListenPort
        {
            get { return listenPort; }
            set
            {
                if (listenPort != value)
                {
                    listenPort = value;
                    RestartIfRunning();
                }
            }
        }

        /// <summary>返信先のホスト(IP かホスト名)。有効な間に変えると、待ち受けを開き直す。</summary>
        public string ReplyHost
        {
            get { return replyHost; }
            set
            {
                if (replyHost != value)
                {
                    replyHost = value;
                    RestartIfRunning();
                }
            }
        }

        /// <summary>返信先のポート。有効な間に変えると、待ち受けを開き直す。</summary>
        public int ReplyPort
        {
            get { return replyPort; }
            set
            {
                if (replyPort != value)
                {
                    replyPort = value;
                    RestartIfRunning();
                }
            }
        }

        /// <summary>型・Record の不一致と、読めないデータグラムをログに出すか(既定 true)。</summary>
        public bool LogMismatches
        {
            get { return logMismatches; }
            set { logMismatches = value; }
        }

        /// <summary>行の無いアドレスの受信をログに出すか(既定 false)。同じアドレスはこのコンポーネントで 1 回だけ出す。</summary>
        public bool LogUnboundAddresses
        {
            get { return logUnboundAddresses; }
            set { logUnboundAddresses = value; }
        }

        /// <summary>処理しなかった受信を /sys/ignored・/sys/failed で知らせるか(既定 true)。</summary>
        public bool ReportOutcomes
        {
            get { return reportOutcomes; }
            set { reportOutcomes = value; }
        }

        /// <summary>UDP の待ち受けが動いているか(ポートが使用中などで開けなければ false)。</summary>
        public bool IsListening { get { return transport != null; } }

        /// <summary>何かを受信済みか(/sys/ping を含む)。</summary>
        public bool HasReceived { get { return link != null && link.HasReceived; } }

        /// <summary>最後に受信した時刻(Time.realtimeSinceStartup。受信前は負)。/sys/ping を含む。</summary>
        public float LastReceivedRealtime { get { return HasReceived ? (float)link.LastReceivedAt : -1f; } }

        /// <summary>最後の受信からの経過秒(受信前は無限大)。</summary>
        public float SecondsSinceLastReceive { get { return HasReceived ? Time.realtimeSinceStartup - (float)link.LastReceivedAt : float.PositiveInfinity; } }

        // 受信ごとの確保を避けるための使い回し
        private readonly List<OscInvocation> invocations = new List<OscInvocation>();
        private readonly List<int> mismatches = new List<int>();
        private readonly List<OscMessage> decoded = new List<OscMessage>();
        private readonly List<string> warningLines = new List<string>();
        private readonly OscReceiveWarnings warnings = new OscReceiveWarnings();
        private readonly OscDeliveryReport report = new OscDeliveryReport();

        private void OnEnable()
        {
            // 対応表の編集は Play 前のインスペクタで行う前提なので、有効化のたびに作り直す
            var rows = new List<OscBindingRow>(bindings.Count);
            foreach (var binding in bindings)
            {
                rows.Add(binding.ToRow());
            }

            dispatcher = new OscDispatcher(rows);
            warnings.ResetReported(); // 対応表が変わったので、行の無いアドレスの「出した」印を消す(D-102)
            foreach (var warning in OscBindingAudit.Audit(null, rows))
            {
                Debug.LogWarning("OscReceiver " + warning.Code + ": " + warning.Message, this);
            }

            link = new OscLinkMonitor(silenceTimeoutSeconds);
            StartTransport();
        }

        private void Update()
        {
            ReceivePending();
            if (link != null && link.PollLost(Time.realtimeSinceStartup))
            {
                InvokeLinkEvent(onLinkLost);
            }
        }

        private void OnDisable()
        {
            StopTransport();
        }

        private void StartTransport()
        {
            StopTransport();
            sendFailureLogged = false;
            replyEndPoint = ResolveReplyEndPoint();
            try
            {
                transport = new OscUdpTransport(listenPort);
            }
            catch (Exception exception) when (exception is SocketException || exception is ArgumentOutOfRangeException)
            {
                // 同じポートを別のアプリ(移行前に残った uOscServer を含む)が使っていると開けない
                Debug.LogError("OscReceiver: UDP ポート " + listenPort + " で待ち受けられません。ほかのアプリやコンポーネントが"
                    + "同じポートを使っていないか確かめてください: " + exception.Message, this);
            }
        }

        private void StopTransport()
        {
            if (transport != null)
            {
                transport.Dispose();
                transport = null;
            }
        }

        private void RestartIfRunning()
        {
            if (isActiveAndEnabled && Application.isPlaying)
            {
                StartTransport();
            }
        }

        private IPEndPoint ResolveReplyEndPoint()
        {
            if (replyPort < 1 || replyPort > 65535)
            {
                Debug.LogError("OscReceiver: 返信先のポートが不正です(" + replyPort + ")。pong とエコーを送れません。", this);
                return null;
            }

            var host = (replyHost ?? string.Empty).Trim();
            if (IPAddress.TryParse(host, out var address) && address.AddressFamily == AddressFamily.InterNetwork)
            {
                return new IPEndPoint(address, replyPort);
            }

            try
            {
                // ブリッジは IPv4 で待ち受けるので、IPv4 のアドレスだけを採る
                foreach (var candidate in Dns.GetHostAddresses(host))
                {
                    if (candidate.AddressFamily == AddressFamily.InterNetwork)
                    {
                        return new IPEndPoint(candidate, replyPort);
                    }
                }
            }
            catch (Exception exception) when (exception is SocketException || exception is ArgumentException)
            {
                Debug.LogError("OscReceiver: 返信先のホスト \"" + host + "\" を引けません: " + exception.Message, this);
                return null;
            }

            Debug.LogError("OscReceiver: 返信先のホスト \"" + host + "\" に IPv4 のアドレスがありません。pong とエコーを送れません。", this);
            return null;
        }

        private void ReceivePending()
        {
            if (transport == null)
            {
                return;
            }

            // 1 フレームで扱う数に上限を置く。送り手が速すぎても Update が戻らなくなることはない(残りは次のフレーム)
            var budget = OscUdpTransport.MaxQueuedDatagrams;
            while (budget-- > 0 && transport != null && transport.TryReceive(out var datagram))
            {
                decoded.Clear();
                if (!OscCodec.TryDecode(datagram.Data, 0, datagram.Data.Length, decoded, out var error))
                {
                    parseErrors += 1;
                    if (logMismatches)
                    {
                        Debug.LogWarning("OscReceiver: 読めないデータグラムを捨てました(" + datagram.Remote + "、"
                            + datagram.Data.Length + " バイト): " + error, this);
                    }

                    continue;
                }

                // bundle の中のメッセージは順に処理する。途中で購読者がこのコンポーネントを無効にしても振り分けは続け、
                // bundle を半端にしない(送信は待ち受けが閉じているので行わない)
                report.Clear();
                foreach (var message in decoded)
                {
                    OnDataReceived(message);
                }

                SendReport();
            }
        }

        // ローカルで分かった失敗(エンコードできない・ソケットが送れない)は false。UDP の到達は保証しない
        private bool Send(string address, object[] args)
        {
            if (transport == null || replyEndPoint == null)
            {
                return false; // 待ち受けや返信先の失敗は有効化のときにログへ出している
            }

            byte[] bytes;
            try
            {
                bytes = OscCodec.EncodeMessage(address, args);
            }
            catch (ArgumentException exception)
            {
                Debug.LogWarning("OscReceiver: 送れない値です(" + address + "): " + exception.Message, this);
                return false;
            }

            try
            {
                transport.Send(bytes, replyEndPoint);
                sendFailureLogged = false;
                return true;
            }
            catch (Exception exception) when (exception is SocketException || exception is ObjectDisposedException)
            {
                // 2 秒ごとの pong で同じ失敗を繰り返しログに出さない。成功したら次の失敗をまた出す
                if (!sendFailureLogged)
                {
                    sendFailureLogged = true;
                    Debug.LogWarning("OscReceiver: " + replyEndPoint + " へ送れませんでした(" + address + "): " + exception.Message, this);
                }

                return false;
            }
        }

        private void OnDataReceived(OscMessage message)
        {
            received += 1;
            if (link.NotifyReceived(Time.realtimeSinceStartup))
            {
                InvokeLinkEvent(onLinkResumed);
            }

            var values = message.Values;
            switch (message.Address)
            {
                case "/sys/ping":
                    if (values.Length > 0 && values[0] is int seq)
                    {
                        Send("/sys/pong", new object[] { seq });
                    }
                    return;
                case "/sys/stats/request":
                    Send("/sys/stats", new object[] { BuildStatsJson() });
                    return;
            }

            if (message.Address.StartsWith("/sys/", StringComparison.Ordinal))
            {
                return; // 上記以外の /sys/* は計数のみ。応答しない
            }

            // 先にエコーする。購読者の例外でエコーバックが止まると、UI が値を確定できなくなるため
            var echoed = new object[values.Length];
            for (var i = 0; i < values.Length; i++)
            {
                echoed[i] = OscDispatcher.NormalizeForEcho(values[i]);
            }

            Send(message.Address, echoed);

            // 購読者が有効化をやり直すと OnEnable が対応表を作り直すので、mismatches の番号を引くのは Dispatch に使ったものにする
            var current = dispatcher;
            current.Dispatch(message.Address, values, invocations, mismatches, out var skipped);
            for (var i = 0; i < invocations.Count; i++)
            {
                if (!Invoke(invocations[i]))
                {
                    report.AddFailed(message.Address, OscDeliveryReport.ReasonException);
                }
            }

            report.Observe(current, message.Address, mismatches);

            // 行の無いアドレス・不一致でもエコーは上で返している。イベントを呼ばないだけ(UNITY_PROTOCOL §2)。
            warningLines.Clear();
            warnings.Collect(current, message.Address, values, mismatches, logMismatches, logUnboundAddresses, warningLines);
            if (logMismatches)
            {
                warnings.CollectPatternOverflow(message.Address, skipped, warningLines);
            }

            foreach (var line in warningLines)
            {
                Debug.LogWarning("OscReceiver: " + line, this);
            }
        }

        /// <summary>
        /// 文字列の一覧を、`s` 引数 N 個の 1 メッセージとして OscDesk へ送る(定義の optionsFrom.address 宛て)。
        /// 要求(optionsFrom.request)に応える Trigger 行の関数から呼ぶほか、構成が変わったときの自発送信にも使える。
        /// 1 データグラムの上限を超える一覧は送らずにログへ出し false を返す。
        /// 無効な間(待ち受けていない間)・返信先を引けなかったとき・エンコードやソケットの送信に失敗したときも false を返す
        /// (true は送り出したことまでで、UDP なので届いたことは保証しない)。
        /// </summary>
        public bool SendStrings(string address, IReadOnlyList<string> values)
        {
            if (!OscStringList.TryValidate(address, values, out var reason))
            {
                Debug.LogWarning("OscReceiver: 一覧を送りませんでした(" + address + "): " + reason, this);
                return false;
            }

            if (transport == null || replyEndPoint == null)
            {
                Debug.LogWarning("OscReceiver: 一覧を送りませんでした(" + address + "): 待ち受けていないか、返信先を引けていません。", this);
                return false;
            }

            var args = new object[values.Count];
            for (var i = 0; i < args.Length; i++)
            {
                args[i] = values[i] ?? string.Empty;
                if (((string)args[i]).IndexOf('\0') >= 0)
                {
                    Debug.LogWarning("OscReceiver: 一覧を送りませんでした(" + address + "): NUL を含む名前は OSC で送れません。", this);
                    return false;
                }
            }

            return Send(address, args);
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

        // 受け手の例外は false(報告の failed に載せる)。他の行の発火は止めない
        private bool Invoke(OscInvocation invocation)
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

                return true;
            }
            catch (Exception exception)
            {
                // 利用者のスクリプトの例外で他の行の発火を止めない
                Debug.LogException(exception, this);
                return false;
            }
        }

        // エコー(各メッセージの処理で送り済み)の後に、データグラムごとにまとめて 1 回だけ送る。送れなくても受信は止めない
        private void SendReport()
        {
            if (!reportOutcomes || report.IsEmpty)
            {
                return;
            }

            if (report.TryBuildIgnored(out var ignoredArgs))
            {
                Send(OscDeliveryReport.IgnoredAddress, ignoredArgs);
            }

            if (report.TryBuildFailed(out var failedArgs))
            {
                Send(OscDeliveryReport.FailedAddress, failedArgs);
            }
        }

        private string BuildStatsJson()
        {
            // parseErrors は読めずに捨てたデータグラム(大きすぎて受けられなかったものを含む)の数
            var errors = parseErrors + (transport != null ? transport.Oversized : 0);
            return "{\"received\":" + received.ToString(CultureInfo.InvariantCulture)
                + ",\"parseErrors\":" + errors.ToString(CultureInfo.InvariantCulture) + ",\"lastReceivedAt\":\""
                + DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture) + "\"}";
        }
    }
}
