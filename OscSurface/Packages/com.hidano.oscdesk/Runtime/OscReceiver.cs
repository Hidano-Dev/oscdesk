// OscReceiver.cs — 汎用の OSC 受け口。docs/UNITY_PROTOCOL.md「汎用レシーバ」参照。
// 使い方: 空の GameObject に追加し、
//   - Listen Port = OscDesk の config の unity.sendPort(既定 7090)
//   - Reply Host / Reply Port = OscDesk ホスト : bridge.oscListenPort(既定 127.0.0.1 : 7091)
// を設定し、対応表に「アドレス → 型 → UnityEvent」を並べる。振り分けと検査、OSC のエンコード・デコードと UDP は
// 中核(Core/、UnityEngine 非依存)が持ち、外部の OSC ライブラリには依存しない(D-095)。
// 対応表の行は Registry(OscRegistry.Shared)に載り、受信は対応表の行と OscTarget の登録の両方へ振り分ける(D-108)。
// 名前空間 OscDesk.Receiver に置くのは、ホスト側の同名クラス(別ライブラリの OscReceiver)と衝突させないため(D-063)。
using System;
using System.Collections.Generic;
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

        [Tooltip("UI の設計図(Registry に載った対応表の行と OscTarget の操作)を /sys/catalog/* で OscDesk へ送る。待ち受けを始めたときと"
            + " Sync の要求で全体を、実行中の変化はフレームごとにまとめて送る(D-114)。")]
        [SerializeField] private bool sendCatalog = true;

        [Tooltip("設計図に付ける PC 名(OscDesk の画面での見出し)。空なら SystemInfo.deviceName。64 文字まで。")]
        [SerializeField] private string catalogName = string.Empty;

        [Tooltip("この秒数を超えて受信(/sys/ping を含む)が無ければ「途絶」とみなし onLinkLost を呼ぶ。0 で判定しない。再開で onLinkResumed を呼ぶ。")]
        [SerializeField, Min(0f)] private float silenceTimeoutSeconds = 0f;

        [Tooltip("受信が silenceTimeoutSeconds を超えて途絶えたときに呼ぶ。")]
        public UnityEvent onLinkLost = new UnityEvent();

        [Tooltip("途絶の後に受信が再開したときに呼ぶ(ブリッジが保持値を再送し始める合図)。")]
        public UnityEvent onLinkResumed = new UnityEvent();

        private OscUdpTransport transport;
        private IPEndPoint replyEndPoint; // 全送信の出口 = 設定された返信先(受信データグラムの送信元へは返さない。UNITY_PROTOCOL §6.1)
        private bool sendFailureLogged;
        // 受信(Transport = OscUdpTransport)・接続確認とエコー(Link = OscLink)・振り分け(Router = OscRouter)を分け、
        // このコンポーネントはそれらを Unity のフレームとつなぐ(D-108)。対応表は「インスペクタで組む登録」として Registry に載せる
        private OscDispatcher dispatcher;
        private readonly OscLink sysLink = new OscLink();
        private readonly OscRouter router = new OscRouter();
        private readonly List<OscRegistryEntry> tableEntries = new List<OscRegistryEntry>();
        private bool receiving;
        private bool unregisterAfterReceive;
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
        private readonly List<OscMessage> decoded = new List<OscMessage>();
        private readonly List<string> warningLines = new List<string>();
        private readonly OscReceiveWarnings warnings = new OscReceiveWarnings();
        private readonly OscDeliveryReport report = new OscDeliveryReport();
        private readonly List<OscRouteResult> routeResults = new List<OscRouteResult>();
        private readonly List<string> routeFailures = new List<string>();
        private Action<OscRegistryEntry, Exception> onRouteException;
        private readonly OscPatternBudget patternBudget = new OscPatternBudget();

        /// <summary>設計図の全体を送り直す最短の間隔(秒)。</summary>
        public const float CatalogFullSyncIntervalSeconds = 1f;

        private OscCatalog catalog;
        private bool catalogFullSyncPending;
        private float lastCatalogFullSync = float.NegativeInfinity;

        /// <summary>設計図を送るか(既定 true)。</summary>
        public bool SendCatalogEnabled
        {
            get { return sendCatalog; }
            set { sendCatalog = value; }
        }

        /// <summary>設計図に付ける PC 名(空なら SystemInfo.deviceName)。</summary>
        public string CatalogName
        {
            get { return string.IsNullOrEmpty(catalogName) ? SystemInfo.deviceName : catalogName; }
            set { catalogName = value ?? string.Empty; }
        }

        /// <summary>次のフレームの終わりに、設計図の全体を送り直す(Sync の要求と同じ)。</summary>
        public void RequestCatalogSync()
        {
            catalogFullSyncPending = true;
        }

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

            // Catalog は対応表の登録より先に購読を始める(自分の行の登録も変化として拾えるように。全体は待ち受けの開始で送る)
            catalog?.Detach();
            catalog = new OscCatalog(OscRegistry.Shared, DescribeOwner);
            catalog.Attach();

            RegisterTable(dispatcher);
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

        // 設計図(D-114)。そのフレームの Registry の変化をまとめて送るので、ほかのスクリプトの Update(生成・破棄)の後に回す
        private void LateUpdate()
        {
            SendCatalog();
        }

        private void SendCatalog()
        {
            if (!sendCatalog || catalog == null || transport == null || replyEndPoint == null)
            {
                return;
            }

            if (catalogFullSyncPending)
            {
                // 全体の送り直しは 1 秒に 1 回まで(認証の無い LAN から /sys/catalog/request を浴びせられても、全体の送信で増幅しない)。
                // 間隔が空くまでは、溜めた変化の差分も送らずに待つ(全体に含めて送るため)
                if (Time.realtimeSinceStartup - lastCatalogFullSync < CatalogFullSyncIntervalSeconds)
                {
                    return;
                }

                catalogFullSyncPending = false;
                lastCatalogFullSync = Time.realtimeSinceStartup;
                SendDatagrams(catalog.BuildFullSync(CatalogName), OscCatalog.BeginAddress);
                return;
            }

            if (catalog.HasChanges)
            {
                SendDatagrams(catalog.BuildDiff(), OscCatalog.AddAddress);
            }
        }

        private void SendDatagrams(List<byte[]> datagrams, string label)
        {
            foreach (var datagram in datagrams)
            {
                try
                {
                    transport.Send(datagram, replyEndPoint);
                    sendFailureLogged = false;
                }
                catch (Exception exception) when (exception is SocketException || exception is ObjectDisposedException)
                {
                    if (!sendFailureLogged)
                    {
                        sendFailureLogged = true;
                        Debug.LogWarning("OscReceiver: " + replyEndPoint + " へ設計図を送れませんでした(" + label + "): " + exception.Message, this);
                    }

                    return; // 届かなかった分は digest の食い違いで相手が気づき、Sync で取り直す
                }
            }
        }

        private static string DescribeOwner(object owner)
        {
            return owner is UnityEngine.Object unityObject && unityObject != null ? unityObject.name : string.Empty;
        }

        private void OnDisable()
        {
            catalog?.Detach();
            StopTransport();
            if (receiving)
            {
                // bundle の途中で購読者がこのコンポーネントを無効にしても、そのデータグラムの残りは今までどおり振り分ける
                // (bundle を半端にしない)。対応表の登録はデータグラムを処理し終えてから外す
                unregisterAfterReceive = true;
            }
            else
            {
                UnregisterTable();
            }
        }

        // 対応表の行のアドレスごとに 1 件、引数を変換せずに受ける登録を Registry に載せる。同じアドレスに型の違う行が
        // 何本あっても今までどおりすべて呼ぶため、行ごとでなくアドレスごとにする(Registry はアドレス 1 つに受け手 1 つ)
        private void RegisterTable(OscDispatcher table)
        {
            UnregisterTable();
            unregisterAfterReceive = false;
            var registry = OscRegistry.Shared;
            foreach (var address in table.Addresses)
            {
                var rowAddress = address;
                // 型は設計図(D-114)に載せる目安。同じアドレスに型の違う行があれば、最初の行の型を載せる
                var operation = new OscOperation(rowAddress, (args, failures) => InvokeTable(table, rowAddress, args, failures),
                    table.FirstKind(rowAddress));
                var entry = new OscRegistryEntry(rowAddress, operation, this);
                OscRegistrationResult result;
                try
                {
                    // 不正なアドレスの行(A2)も、以前は完全一致で届いていたので登録する(警告は Audit が出している)
                    result = registry.Register(entry, OscAddressCheck.NonEmpty);
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception, this);
                    result = registry.TryGet(rowAddress, out var current) && ReferenceEquals(current, entry)
                        ? OscRegistrationResult.Registered
                        : OscRegistrationResult.Duplicate;
                }

                if (result == OscRegistrationResult.Registered)
                {
                    tableEntries.Add(entry);
                }
                else if (result == OscRegistrationResult.Duplicate)
                {
                    registry.TryGet(rowAddress, out var existing);
                    var owner = existing != null ? existing.Owner as UnityEngine.Object : null;
                    Debug.LogWarning("OscReceiver: 対応表の行 " + rowAddress + " は既に登録されているので、この行には届きません(先に登録: "
                        + (owner != null ? owner.name : "不明") + ")。同じアドレスを別の OscReceiver か OscTarget が受けていないか確かめてください。", this);
                }
            }
        }

        private void UnregisterTable()
        {
            if (tableEntries.Count == 0)
            {
                return;
            }

            // Play の開始で共有の登録簿が作り直されていても、Unregister は自分の登録でなければ何もしないので安全
            var registry = OscRegistry.Shared;
            foreach (var entry in tableEntries)
            {
                try
                {
                    registry.Unregister(entry);
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception, this);
                }
            }

            tableEntries.Clear();
        }

        // 対応表の 1 つのアドレスの行を呼ぶ。table は登録したときの対応表(購読者が有効化をやり直して対応表が作り直されても、
        // mismatches の番号はこの対応表の行を指す)。
        // 行の関数が中から Registry.Deliver などで別のアドレスへ送ると、ここへ入れ子で戻ってくる。使い回しのリストを 1 組だけにすると、
        // 外側の呼び出しの途中で中身を書き換えられて、外側が別の行を呼んだり番号が外れたりする(PR #103 の再レビュー)。深さごとに別の組を使う
        private void InvokeTable(OscDispatcher table, string address, IReadOnlyList<object> args, List<string> failures)
        {
            if (tableDepth >= MaxTableDepth)
            {
                // 行の関数どうしが互いに送り合うと際限なく深くなるので、ここで止める(スタックを食い潰さない)
                failures.Add(OscDeliveryReport.ReasonException);
                Debug.LogWarning("OscReceiver: 対応表の行の呼び出しが " + MaxTableDepth + " 段まで入れ子になったので、" + address + " を呼びませんでした。", this);
                return;
            }

            while (tableScratch.Count <= tableDepth)
            {
                tableScratch.Add(new TableScratch());
            }

            var scratch = tableScratch[tableDepth];
            tableDepth += 1;
            try
            {
                table.DispatchExact(address, args, scratch.Invocations, scratch.Mismatches);
                for (var i = 0; i < scratch.Invocations.Count; i++)
                {
                    if (!Invoke(scratch.Invocations[i]))
                    {
                        failures.Add(OscDeliveryReport.ReasonException);
                    }
                }

                for (var i = 0; i < scratch.Mismatches.Count; i++)
                {
                    failures.Add(table.RowAt(scratch.Mismatches[i]).Kind == OscBindingKind.Record
                        ? OscDeliveryReport.ReasonRecordMismatch
                        : OscDeliveryReport.ReasonTypeMismatch);
                }

                // 不一致の警告(D-102)。行の無いアドレスの警告は Router の結果で出す(ここへは行のあるアドレスしか来ない)。
                // 別の OscReceiver が受けた受信でもこの対応表の行が呼ばれるので、受けた側のリストには足さず、ここで出して空にする
                // (足すと受けた側では出ず、こちらのリストが受信のたびに増え続ける。PR #103 の指摘)
                scratch.WarningLines.Clear();
                warnings.Collect(table, address, args, scratch.Mismatches, logMismatches, false, scratch.WarningLines);
                foreach (var line in scratch.WarningLines)
                {
                    Debug.LogWarning("OscReceiver: " + line, this);
                }

                scratch.WarningLines.Clear();
            }
            finally
            {
                tableDepth -= 1;
            }
        }

        /// <summary>対応表の行の呼び出しの入れ子の上限。</summary>
        public const int MaxTableDepth = 8;

        private sealed class TableScratch
        {
            public readonly List<OscInvocation> Invocations = new List<OscInvocation>();
            public readonly List<int> Mismatches = new List<int>();
            public readonly List<string> WarningLines = new List<string>();
        }

        private readonly List<TableScratch> tableScratch = new List<TableScratch>();
        private int tableDepth;

        private void StartTransport()
        {
            StopTransport();
            sendFailureLogged = false;
            replyEndPoint = ResolveReplyEndPoint();
            try
            {
                transport = new OscUdpTransport(listenPort);
                // 待ち受けを始めたら設計図の全体を送る(D-114)。送るのはこのフレームの終わり(LateUpdate)
                catalogFullSyncPending = true;
                lastCatalogFullSync = float.NegativeInfinity;
            }
            catch (Exception exception) when (exception is SocketException || exception is ArgumentOutOfRangeException)
            {
                transport = null;
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
            patternBudget.Reset();
            while (budget-- > 0 && transport != null && transport.TryReceive(out var datagram))
            {
                decoded.Clear();
                if (!OscCodec.TryDecode(datagram.Data, 0, datagram.Data.Length, decoded, out var error))
                {
                    sysLink.CountParseError();
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
                receiving = true;
                try
                {
                    foreach (var message in decoded)
                    {
                        OnDataReceived(message);
                    }
                }
                finally
                {
                    receiving = false;
                    if (unregisterAfterReceive)
                    {
                        unregisterAfterReceive = false;
                        UnregisterTable();
                    }
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
            var values = message.Values;
            var isSystem = sysLink.TryHandleSystem(message.Address, values, transport != null ? transport.Oversized : 0, DateTime.UtcNow,
                out var replyAddress, out var replyArgs);
            if (link.NotifyReceived(Time.realtimeSinceStartup))
            {
                InvokeLinkEvent(onLinkResumed);
            }

            if (isSystem)
            {
                if (replyAddress != null)
                {
                    Send(replyAddress, replyArgs);
                }

                if (message.Address == OscCatalog.RequestAddress)
                {
                    // Sync の要求。応答はフレームの終わりにまとめて送る(同じフレームに何通来ても 1 回。D-114)
                    catalogFullSyncPending = true;
                }

                return; // ping・stats 以外の /sys/* は計数のみ。応答しない
            }

            // 先にエコーする。購読者の例外でエコーバックが止まると、UI が値を確定できなくなるため
            Send(message.Address, OscLink.BuildEcho(values));

            // パターンの受信は 1 フレームの枠(D-106)を使う。枠を超えたものは突き合わせもせずに捨てる(bundle で累積する増幅を止める)
            var maxPatternMatches = OscRouter.MaxPatternMatches;
            var isPattern = OscAddressPattern.ContainsPatternChars(message.Address);
            // 一致しないパターンでも Registry の登録をすべて走査するので、走査する数も枠に数える(PR #97 の再レビュー)
            if (isPattern && !patternBudget.TryBegin(router.Registry.Ordered.Count, out maxPatternMatches))
            {
                if (patternBudget.Dropped == 1 && logMismatches)
                {
                    Debug.LogWarning("OscReceiver: 1 フレームに振り分けるパターンの上限(" + OscPatternBudget.MaxMessagesPerFrame + " 通・"
                        + OscPatternBudget.MaxTargetsPerFrame + " 件)を超えたので、このフレームの残りのパターンの受信を振り分けません(" + message.Address + " から)", this);
                }

                return;
            }

            // 振り分けは Registry 経由(対応表の行と OscTarget の登録の両方。D-108)。結果は報告(D-105)に溜まる
            warningLines.Clear();
            routeResults.Clear();
            routeFailures.Clear();
            var matched = router.Route(message.Address, values, report, routeResults, routeFailures,
                onRouteException ?? (onRouteException = LogRouteException), maxPatternMatches, out var skipped);
            if (isPattern)
            {
                patternBudget.Consume(matched);
            }

            // 行の無いアドレス・不一致でもエコーは上で返している。イベントを呼ばないだけ(UNITY_PROTOCOL §2)。
            if (matched == 0 && logUnboundAddresses)
            {
                warnings.CollectUnbound(message.Address, warningLines);
            }

            if (logMismatches)
            {
                // 対応表の行の不一致は InvokeTable が出している。ここでは OscTarget などの登録の不一致と失敗を出す
                foreach (var result in routeResults)
                {
                    if (result.Entry.Operation.IsRaw || result.Threw || result.FailureCount == 0)
                    {
                        continue;
                    }

                    var reason = routeFailures[result.FailureStart];
                    var described = result.Entry.Address + " (" + result.Entry.Operation.Kind.ToString().ToLowerInvariant() + ")";
                    if (result.Outcome == OscDeliveryOutcome.Mismatch)
                    {
                        warningLines.Add((reason == OscRegistry.ReasonRecordMismatch ? "record mismatch for " : "argument type mismatch for ") + described);
                    }
                    else
                    {
                        warningLines.Add("failed for " + described + ": " + reason);
                    }
                }

                warnings.CollectPatternOverflow(message.Address, skipped, warningLines);
            }

            foreach (var line in warningLines)
            {
                Debug.LogWarning("OscReceiver: " + line, this);
            }
        }

        private void LogRouteException(OscRegistryEntry entry, Exception exception)
        {
            // 受け手のスクリプトの例外で他の受け手の処理・エコーを止めない。持ち主の GameObject を示してログに出す
            Debug.LogException(exception, entry.Owner as UnityEngine.Object ?? this);
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
    }
}
