namespace OscDesk.Receiver
{
    /// <summary>
    /// 受信の途絶と再開の判定(時刻は呼び出し側が渡す)。
    /// ホストは「ブリッジからの受信が一定時間途絶えた後の再開」で保持値の再送を検知して適用する。
    /// /sys/ping も受信に数えるのは、値が動かない間もブリッジの生存を示すのが ping だけだから。
    /// 数えないと、静かな現場で毎回「途絶」と誤判定する。
    /// </summary>
    public sealed class OscLinkMonitor
    {
        private readonly double timeoutSeconds;
        private bool hasReceived;
        private bool lost;
        private double lastReceivedAt;

        /// <param name="timeoutSeconds">この秒数を超えて受信が無ければ途絶。0 以下は判定しない。</param>
        public OscLinkMonitor(double timeoutSeconds)
        {
            this.timeoutSeconds = timeoutSeconds;
        }

        public bool HasReceived { get { return hasReceived; } }
        public bool IsLost { get { return lost; } }
        public double LastReceivedAt { get { return lastReceivedAt; } }

        /// <summary>受信を記録する。途絶からの復帰なら true。</summary>
        public bool NotifyReceived(double now)
        {
            hasReceived = true;
            lastReceivedAt = now;
            if (!lost)
            {
                return false;
            }

            lost = false;
            return true;
        }

        /// <summary>途絶を判定する。新たに途絶と判定した 1 回だけ true(受信前は判定しない)。</summary>
        public bool PollLost(double now)
        {
            if (timeoutSeconds <= 0 || !hasReceived || lost || now - lastReceivedAt <= timeoutSeconds)
            {
                return false;
            }

            lost = true;
            return true;
        }
    }
}
