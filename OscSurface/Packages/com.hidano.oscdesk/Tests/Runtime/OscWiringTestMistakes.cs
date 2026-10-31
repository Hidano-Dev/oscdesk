using UnityEngine;

namespace OscDesk.Receiver.Tests
{
    /// <summary>OscReceiverWiringTests の、登録できない宣言を集めた配線先。どれもリスナーにならず警告になる。</summary>
    public sealed class OscWiringTestMistakes : MonoBehaviour
    {
        // 行は Float なので、int を受ける関数は型が合わない
        [OscAddress("/app/volume")]
        public void VolumeAsInt(int value) { }

        [OscAddress("/app/unknown")]
        public void NotInDefinition() { }

        [OscAddress("/app/count")]
        private void NotPublic(int value) { }

        [OscAddress("/app/count")]
        public static void IsStatic(int value) { }

        [OscAddress("/app/count")]
        public int ReturnsValue(int value) { return value; }

        [OscAddress("/app/count")]
        public void TwoArguments(int a, int b) { }

        [OscAddress("/app/count")]
        public void UnsupportedArgument(double value) { }

        [OscAddress("no slash")]
        public void InvalidAddress() { }
    }
}
