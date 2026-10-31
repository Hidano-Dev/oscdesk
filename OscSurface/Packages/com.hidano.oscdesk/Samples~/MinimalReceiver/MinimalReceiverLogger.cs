// MinimalReceiverLogger.cs — サンプル「Minimal Receiver」の受け手。OscReceiver の対応表からインスペクタで登録した関数が、
// OscDesk の画面の操作で呼ばれることを Console で確かめるためだけのスクリプト。
using UnityEngine;

namespace OscDesk.Receiver.Samples
{
    public sealed class MinimalReceiverLogger : MonoBehaviour
    {
        // /sample/value の Float の行に Dynamic float で登録する
        public void OnValue(float value)
        {
            Debug.Log("[MinimalReceiver] /sample/value = " + value);
        }

        // /sample/hello の Trigger の行に登録する
        public void OnHello()
        {
            Debug.Log("[MinimalReceiver] /sample/hello");
        }
    }
}
