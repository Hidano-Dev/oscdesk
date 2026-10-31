using UnityEngine;

namespace OscDesk.Receiver.Tests
{
    /// <summary>PlayMode テスト用の受け手。/fx/対象名/stop(Trigger)と /fx/対象名/level(Float)を受ける。</summary>
    [AddComponentMenu("")]
    public sealed class OscTestEffect : OscTarget
    {
        public int Stops;
        public float Level;

        protected override string DefaultPackageName => "fx";

        protected override void DeclareOperations(OscOperationList operations)
        {
            operations.Trigger("stop", () => Stops += 1);
            operations.Float("level", v => Level = v).WithRange(0f, 1f);
        }
    }
}
