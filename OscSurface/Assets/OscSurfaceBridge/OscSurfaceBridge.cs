// OscSurfaceBridge.cs — docs/UNITY_PROTOCOL.md 付録 A.2 の参照実装(uOSC 2.2.0)
// 本文 §4(実装指針)の擬似コードを 1:1 で具体化した単一 MonoBehaviour。
// 使い方: 空の GameObject に本コンポーネントを追加し(uOscServer / uOscClient は自動追加される)、
//   - uOscServer.port   = Surface config の unity.sendPort(既定 7090)
//   - uOscClient.address/port = Surface ホスト : unity.receivePort(既定 127.0.0.1 : 7091)
// をインスペクタで設定する(§5.1 のポート対応)。
using System;
using System.Globalization;
using UnityEngine;
using uOSC;
using OscDesk.Staging;

[RequireComponent(typeof(uOscServer), typeof(uOscClient))]
public sealed class OscSurfaceBridge : MonoBehaviour
{
    /// <summary>適用トリガ受信時に、適用範囲のステージング値を通知する。</summary>
    public event Action<StagingApplyContext> ApplyRequested;

    // デモ用の表示名。エントリ定義中の {characterName} を置き換える
    [Tooltip("デモ・検証用の表示名。マニフェストエントリの label / string 初期値に含まれる {characterName} をこの値で置き換える。プレースホルダを使っていなければ動作に影響しない。")]
    [SerializeField] private string characterName = "UnityBridge";
    [Tooltip("Surface へ送るマニフェスト定義(必須)。projectId は Surface config の expectedProjectId と一致させること。")]
    [SerializeField] private OscSurfaceManifestAsset manifestAsset;

    // §4.1 受信統計
    private int received;
    private int parseErrors; // uOSC は decode 失敗を通知しないため常に 0 を報告する(付録 A.4)
    private string lastReceivedAt = "1970-01-01T00:00:00.000Z"; // ISO-8601 UTC(Z 終端)

    // 検証・計画・現在値・JSON 組み立て・起動の識別子と構造の世代は中核のセッションが持つ。
    // Awake で作る。Awake より前は null(F-5 の注入 API だけが使える)。
    private ManifestSession session;
    private bool manifestAssetConsumed; // Awake が manifestAsset を消費したら true。以後 SetManifestAsset は受け付けない
    private int lastWarnedManifestBytes = -1; // 警告閾値超過を同じバイト数で繰り返さないための記録

    private uOscServer server;
    private uOscClient client; // 全送信の出口 = 設定された返信先(§4.4)

    /// <summary>
    /// F-5。Awake の前だけ、マニフェストアセットを差し替える。
    /// null、または Awake で消費済みの場合は保持しているアセットを変えず、エラーログを残して false を返す。
    /// </summary>
    public bool SetManifestAsset(OscSurfaceManifestAsset asset)
    {
        if (asset == null)
        {
            Debug.LogError("OscSurfaceBridge.SetManifestAsset requires a non-null OscSurfaceManifestAsset.", this);
            return false;
        }

        if (manifestAssetConsumed)
        {
            Debug.LogError(
                "OscSurfaceBridge.SetManifestAsset was called after Awake consumed the manifest asset. "
                + "Inject the asset before the component is first activated.",
                this);
            return false;
        }

        manifestAsset = asset;
        return true;
    }

    /// <summary>F-6。フォークとの互換のため引数なしを残す。結果の詳細が要るときは out 付きを使う。</summary>
    public bool SendManifestNow()
    {
        return SendManifestNow(out _);
    }

    /// <summary>
    /// F-6。保持しているアセットの現在の内容を公開して、/sys/manifest を 1 回送る。
    /// 非アクティブなら送らずに false。表示の項目・選択肢リストの更新だけなら構造の世代を 1 進めて送り、
    /// 構造の変更(エントリの集合・アドレス・型・staging の属性など)やサイズ超過は送らずに false を返す。
    /// 失敗の理由と問題はエラーログにも出す。
    /// </summary>
    public bool SendManifestNow(out ManifestChangeResult result)
    {
        if (session == null)
        {
            result = Rejected(ManifestChangeFailure.NotInitialized, "OscSurfaceBridge has not been initialized (Awake has not run).");
            LogChangeFailure("SendManifestNow", result);
            return false;
        }

        if (!isActiveAndEnabled || client == null)
        {
            result = Rejected(ManifestChangeFailure.Inactive, "OscSurfaceBridge is not active.");
            LogChangeFailure("SendManifestNow", result);
            return false;
        }

        var asset = manifestAsset;
        result = session.PublishContentUpdate(asset == null ? null : asset.ToSnapshot(characterName));
        if (!result.Succeeded)
        {
            LogChangeFailure("SendManifestNow", result);
            return false;
        }

        return SendManifest();
    }

    private void Awake()
    {
        // 起動時にアセット検証 → 宣言写像 → 計画コンパイル → シードを、中核のセッションで一度だけ行う。
        // 失敗しても通常のエコーと sys 系の生存性は維持する(マニフェストは送らない)。
        manifestAssetConsumed = true;
        session = new ManifestSession(Guid.NewGuid().ToString("N"));

        var asset = manifestAsset;
        var result = session.Initialize(asset == null ? null : asset.ToSnapshot(characterName));

        if (asset == null)
        {
            Debug.LogError("OscSurfaceBridge requires an OscSurfaceManifestAsset.", this);
        }
        else
        {
            foreach (var issue in result.Issues)
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset " + issue.Code
                    + (string.IsNullOrEmpty(issue.Address) ? string.Empty : " at \"" + issue.Address + "\"")
                    + ": " + issue.Message,
                    asset);
            }
        }

        // エントリ型と合わない既定値は投入されない。無言だと原因が追えないため警告に残す
        foreach (var address in result.UnseededAddresses)
        {
            Debug.LogWarning(
                "OscSurfaceManifestAsset default value at \"" + address
                + "\" does not match the entry type and was not seeded.",
                asset);
        }
    }

    private void OnEnable()
    {
        server = GetComponent<uOscServer>();
        client = GetComponent<uOscClient>();
        server.onDataReceived.AddListener(OnDataReceived);

        // 要求を受けていなくても起動時に自発送信してよい(§2 / §4.3 補足)
        SendManifest();
    }

    private void OnDisable()
    {
        server.onDataReceived.RemoveListener(OnDataReceived);
    }

    // §4.1 受信処理の骨格。uOSC は bundle を自動展開して展開後メッセージ単位で
    // このコールバックを呼ぶため、bundle 分岐は不要(§4.1 補足 / 付録 A.3)
    private void OnDataReceived(Message message)
    {
        // 計数と時刻更新はディスパッチより先(/sys/stats/request 自身も数える)
        received += 1;
        lastReceivedAt = NowIso8601();

        switch (message.address)
        {
            case "/sys/ping": // §4.2
                if (message.values.Length > 0 && message.values[0] is int seq)
                {
                    SendPong(seq);
                }
                return;
            case "/sys/stats/request": // §4.1
                SendStats();
                return;
            case "/sys/manifest/request": // §4.3
                SendManifest();
                return;
        }

        if (message.address.StartsWith("/sys/", StringComparison.Ordinal))
        {
            return; // 上記以外の /sys/* は計数のみ。応答しない
        }

        HandleNormalMessage(message);
    }

    // §4.2 受信した seq をそのまま即時返信。検査・保持・解釈はしない
    private void SendPong(int seq)
    {
        client.Send("/sys/pong", seq);
    }

    private void SendStats()
    {
        client.Send("/sys/stats", session.BuildStatsJson(received, parseErrors, lastReceivedAt));
    }

    // 起動時・有効化時・要求への応答の送信。準備完了のときだけ送り、サイズでは拒否しない(超過は警告ログ)
    private bool SendManifest()
    {
        if (session == null
            || !session.TryBuildManifestJson(out var json, out var payloadBytes, out _))
        {
            return false;
        }

        WarnIfManifestLarge(payloadBytes);
        client.Send("/sys/manifest", json);
        return true;
    }

    private void WarnIfManifestLarge(int payloadBytes)
    {
        if (payloadBytes <= ManifestLimits.WarningBytes)
        {
            lastWarnedManifestBytes = -1; // 閾値以下に戻ったら、再び超えたときに警告できるようにする
            return;
        }

        if (payloadBytes == lastWarnedManifestBytes)
        {
            return;
        }

        lastWarnedManifestBytes = payloadBytes;
        Debug.LogWarning(
            "OscSurfaceBridge /sys/manifest is " + payloadBytes.ToString(CultureInfo.InvariantCulture)
            + " bytes, over the warning threshold of "
            + ManifestLimits.WarningBytes.ToString(CultureInfo.InvariantCulture) + " bytes.",
            this);
    }

    private ManifestChangeResult Rejected(ManifestChangeFailure failure, string message)
    {
        return new ManifestChangeResult(
            failure,
            new[] { new ManifestIssue("F6", string.Empty, message) },
            -1,
            session != null ? session.Origin.StructureGeneration : 1,
            false);
    }

    // 失敗理由と問題をエラーログに残す(ホストが戻り値を捨てても原因が追えるようにする)
    private void LogChangeFailure(string api, ManifestChangeResult result)
    {
        var message = "OscSurfaceBridge." + api + " failed: " + result.Failure;
        foreach (var issue in result.Issues)
        {
            message += "\n  " + issue.Code
                + (string.IsNullOrEmpty(issue.Address) ? string.Empty : " at \"" + issue.Address + "\"")
                + ": " + issue.Message;
        }

        Debug.LogError(message, this);
    }

    // §4.3 通常メッセージ: 現在値の記録 + 同一アドレスへのエコーバック(§3)
    private void HandleNormalMessage(Message message)
    {
        var recordable = TryGetRecordableValue(message.values, out var stagingValue);
        var reaction = session.Handle(
            message.address,
            recordable ? stagingValue : StagingValue.None);

        var echoed = new object[message.values.Length];
        for (var i = 0; i < message.values.Length; i++)
        {
            echoed[i] = NormalizeValue(message.values[i]);
        }

        client.Send(message.address, echoed);

        foreach (var write in reaction.ExpansionWrites)
        {
            client.Send(write.Address, ToOscValue(write.Value));
        }

        if (reaction.ApplyTriggered)
        {
            RaiseApplyRequested(new StagingApplyContext(message.address, reaction.ApplyPayload));
        }
    }

    // 値として解釈できる最初の引数だけを取り出す。エントリ型との適否は中核が判定する(§4.3 / 要件 1.6)
    private static bool TryGetRecordableValue(object[] values, out StagingValue stagingValue)
    {
        stagingValue = StagingValue.None;
        if (values == null)
        {
            return false;
        }

        foreach (var value in values)
        {
            if (value is int intValue)
            {
                stagingValue = StagingValue.FromInt(intValue);
                return true;
            }

            if (value is float floatValue)
            {
                stagingValue = StagingValue.FromFloat(floatValue);
                return true;
            }

            if (value is string stringValue)
            {
                stagingValue = StagingValue.FromString(stringValue);
                return true;
            }
        }

        return false;
    }

    private void RaiseApplyRequested(StagingApplyContext context)
    {
        var handlers = ApplyRequested;
        if (handlers == null)
        {
            return;
        }

        foreach (Action<StagingApplyContext> handler in handlers.GetInvocationList())
        {
            try
            {
                handler(context);
            }
            catch (Exception exception)
            {
                Debug.LogException(exception, this);
            }
        }
    }

    private static object ToOscValue(StagingValue value)
    {
        switch (value.Kind)
        {
            case StagingValueKind.Int: return value.IntValue;
            case StagingValueKind.Float: return value.FloatValue;
            case StagingValueKind.String: return value.StringValue;
            default: return null;
        }
    }

    // §4.4 真偽値は i の 0/1 で送る(T/F タグを使わない)
    private static object NormalizeValue(object value)
    {
        if (value is bool flag)
        {
            return flag ? 1 : 0;
        }

        return value;
    }

    private static string NowIso8601()
    {
        return DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    }
}
