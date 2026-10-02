using OscDesk.Staging;
using UnityEngine;

/// <summary>
/// 手動検証(マニフェスト再注入。手順は大タスク 11 で docs/VERIFICATION.md に追記する)専用のプローブ。
/// Inspector で差し替え先のアセットを指定し、コンテキストメニューから
/// 「事前検査」「再注入」「SendManifestNow」を呼んで、結果をログに出す。
///
/// 検証が終わったらこのコンポーネントを外し、ファイルごと削除してよい。
/// 製品コードから参照しないこと。
/// </summary>
[RequireComponent(typeof(OscSurfaceBridge))]
public sealed class ManifestReinjectProbe : MonoBehaviour
{
    [Tooltip("再注入の差し替え先にするマニフェストアセット。")]
    [SerializeField] private OscSurfaceManifestAsset candidateAsset;

    private OscSurfaceBridge bridge;

    [ContextMenu("Precheck manifest asset")]
    private void Precheck()
    {
        var check = GetBridge().PrecheckManifestAsset(candidateAsset);
        Debug.Log("[ManifestReinjectProbe] precheck " + Describe(check.Result), this);
    }

    [ContextMenu("Reinject manifest asset")]
    private void Reinject()
    {
        var succeeded = GetBridge().TryReinjectManifestAsset(candidateAsset, out var result);
        Debug.Log("[ManifestReinjectProbe] reinject " + (succeeded ? "ok " : "failed ") + Describe(result), this);
    }

    [ContextMenu("Send manifest now")]
    private void SendNow()
    {
        var succeeded = GetBridge().SendManifestNow(out var result);
        Debug.Log("[ManifestReinjectProbe] sendNow " + (succeeded ? "ok " : "failed ") + Describe(result), this);
    }

    private OscSurfaceBridge GetBridge()
    {
        if (bridge == null)
        {
            bridge = GetComponent<OscSurfaceBridge>();
        }

        return bridge;
    }

    private static string Describe(ManifestChangeResult result)
    {
        var line = "failure=" + result.Failure
            + " bytes=" + result.PayloadBytes
            + " generation=" + result.StructureGeneration
            + " advanced=" + result.GenerationAdvanced
            + " stateChangedSinceCheck=" + result.StateChangedSinceCheck;
        foreach (var issue in result.Issues)
        {
            line += "\n  " + issue.Code
                + (string.IsNullOrEmpty(issue.Address) ? string.Empty : " at \"" + issue.Address + "\"")
                + ": " + issue.Message;
        }

        return line;
    }
}
