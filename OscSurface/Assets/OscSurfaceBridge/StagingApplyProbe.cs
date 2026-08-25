using System;
using OscDesk.Staging;
using UnityEngine;

/// <summary>
/// 手動検証(docs/VERIFICATION.md の「購読者の例外後もエコーバックが継続する」)専用の
/// テスト用購読者。適用値を Console へ記録したあと必ず例外を投げ、
/// 購読者例外がエコーバックへ波及しないこと(D-21)を確かめる。
///
/// 検証が終わったらこのコンポーネントを外し、ファイルごと削除してよい。
/// 製品コードから参照しないこと。
/// </summary>
[RequireComponent(typeof(OscSurfaceBridge))]
public sealed class StagingApplyProbe : MonoBehaviour
{
    [Tooltip("オンの間だけ例外を投げる。オフにすると記録だけ行い例外を投げない。")]
    [SerializeField] private bool throwAfterRecording = true;

    private OscSurfaceBridge bridge;
    private int applyCount;

    private void OnEnable()
    {
        bridge = GetComponent<OscSurfaceBridge>();
        bridge.ApplyRequested += HandleApplyRequested;
        Debug.Log("[StagingApplyProbe] subscribed", this);
    }

    private void OnDisable()
    {
        if (bridge != null)
        {
            bridge.ApplyRequested -= HandleApplyRequested;
        }
    }

    private void HandleApplyRequested(StagingApplyContext context)
    {
        applyCount++;

        // 先に「記録」する。例外より前に値を受け取れていることを示す
        var line = "[StagingApplyProbe] apply #" + applyCount + " trigger=" + context.TriggerAddress
            + " count=" + context.Addresses.Count;
        foreach (var address in context.Addresses)
        {
            // Addresses はエントリ定義順を保証する(Values の Dictionary は順序を保証しない)
            line += "\n  " + address + " = " + Describe(context, address);
        }

        Debug.Log(line, this);

        if (throwAfterRecording)
        {
            throw new InvalidOperationException(
                "[StagingApplyProbe] intentional test exception after recording apply #" + applyCount);
        }
    }

    private static string Describe(StagingApplyContext context, string address)
    {
        if (context.TryGetInt(address, out var intValue)) return "int " + intValue;
        if (context.TryGetFloat(address, out var floatValue)) return "float " + floatValue;
        if (context.TryGetString(address, out var stringValue)) return "string \"" + stringValue + "\"";
        return "(unknown)";
    }
}
