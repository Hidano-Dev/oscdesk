// OscRegistryLifecycle.cs — 共有の Registry を Play の開始ごとに空にする(DESIGN.md D-107)。
using UnityEngine;

namespace OscDesk.Receiver
{
    internal static class OscRegistryLifecycle
    {
        // ドメインのリロードを切った環境(Enter Play Mode Options)では静的な状態が前回の Play から残り、
        // 破棄済みの受け手の登録が重複として新しい受け手を拒んでしまう。SubsystemRegistration はシーンの読み込みと
        // どの Awake / OnEnable よりも先に呼ばれるので、ここで捨てれば登録の順序に関係なく空から始まる
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        internal static void ResetOnPlay()
        {
            OscRegistry.ResetShared();
        }
    }
}
