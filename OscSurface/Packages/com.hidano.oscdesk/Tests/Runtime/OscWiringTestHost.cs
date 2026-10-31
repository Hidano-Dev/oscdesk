using UnityEngine;

namespace OscDesk.Receiver.Tests
{
    /// <summary>
    /// OscReceiverWiringTests の配線先。利用側のホスト(アドレスごとの switch で関数を登録していたもの)と同じ形の受け口を、
    /// 属性の宣言だけで持つ。Editor のアセンブリの MonoBehaviour は AddComponent できないので、テスト専用の実行時のアセンブリ
    /// (OscDesk.Receiver.Tests.Fixtures、UNITY_INCLUDE_TESTS のときだけ入る)に、クラス名と同じ名前のファイルで置く。
    /// </summary>
    public sealed class OscWiringTestHost : MonoBehaviour
    {
        [OscAddress("/app/member/values")]
        public void ReceiveMemberValues(OscRecord record) { }

        [OscAddress("/app/member/update")]
        public void ReceiveMemberUpdate(OscRecord record) { }

        [OscAddress("/app/members/request")]
        public void SendMemberList() { }

        [OscAddress("/app/device/keys")]
        public void ReceiveDeviceKeys(string[] ids) { }

        [OscAddress("/app/device/values")]
        public void ReceiveDeviceValues(OscRecord record) { }

        [OscAddress("/app/device/update")]
        public void ReceiveDeviceUpdate(OscRecord record) { }

        // 1 つの関数で複数の一覧の要求を受ける
        [OscAddress("/app/segments/request")]
        [OscAddress("/app/lipdevices/request")]
        public void SendOptionLists() { }

        [OscAddress("/app/volume")]
        public void SetVolume(float value) { }

        [OscAddress("/app/count")]
        public void SetCount(int value) { }

        [OscAddress("/app/title")]
        public void SetTitle(string value) { }

        [OscAddress("/app/mute")]
        public void SetMute(bool value) { }

        // 宣言の無い関数。手で登録したリスナーが配線で消えないことを確かめる
        public void Manual() { }
    }
}
