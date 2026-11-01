using UnityEngine;

namespace OscDesk.Receiver.Tests
{
    /// <summary>
    /// EditMode テスト(重複した対象名の付け直し)が GameObject に付ける受け手。/fx/対象名/stop と /fx/対象名/level を宣言する。
    /// Editor のアセンブリの MonoBehaviour は AddComponent できないので、テスト専用の実行時のアセンブリに置く。
    /// </summary>
    [AddComponentMenu("")]
    public sealed class OscFixtureTarget : OscTarget
    {
        protected override string DefaultPackageName => "fx";

        protected override void DeclareOperations(OscOperationList operations)
        {
            operations.Trigger("stop", () => { });
            operations.Float("level", _ => { });
        }
    }
}
