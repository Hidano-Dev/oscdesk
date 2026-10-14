using System;

namespace OscDesk.Receiver
{
    /// <summary>受信の途絶・再開の判定で起きた状態の変化。</summary>
    public enum OscReceiveTransition
    {
        None,
        /// <summary>受信が始まった(起動後の最初の受信)か、途絶の後に再開した。</summary>
        Resumed,
        /// <summary>受信していた状態から、しきい値の間なにも届かなくなった。</summary>
        Stalled
    }

    /// <summary>
    /// 最後の受信時刻と、受信の途絶・再開の判定(HID-209、D-063)。時刻は呼び出し側が渡す単調時刻(秒)で、
    /// UnityEngine の時計に依存しない。ブリッジは 2 秒ごとに /sys/ping を送るので、/sys/ping を含む全受信を数えれば、
    /// 操作が無い間も「つながっている」と判定できる。
    /// 判定は受け口の外への通知だけで、エコーや振り分け(D-052 の「受けて返すだけ」)には関与しない。
    /// </summary>
    public sealed class OscReceiveMonitor
    {
        /// <summary>しきい値の既定値。ping 間隔 2 秒の 3 倍で、1〜2 回の喪失では途絶にしない。</summary>
        public const double DefaultStallSeconds = 6.0;

        private double stallSeconds;

        public OscReceiveMonitor(double stallSeconds = DefaultStallSeconds)
        {
            StallSeconds = stallSeconds;
        }

        /// <summary>途絶とみなすまでの無受信の秒数。0 以下・非数は既定値に置き換える(判定が常に途絶になるのを防ぐ)。</summary>
        public double StallSeconds
        {
            get => stallSeconds;
            set => stallSeconds = value > 0 && !double.IsNaN(value) && !double.IsInfinity(value) ? value : DefaultStallSeconds;
        }

        /// <summary>一度でも受信したか。</summary>
        public bool HasReceived { get; private set; }

        /// <summary>最後に受信した時刻(呼び出し側の時計の秒)。未受信なら double.NaN。</summary>
        public double LastReceiveTime { get; private set; } = double.NaN;

        /// <summary>受信している状態か(受信済みで、途絶と判定されていない)。</summary>
        public bool IsReceiving { get; private set; }

        /// <summary>最後の受信からの経過秒数。未受信なら正の無限大。</summary>
        public double SecondsSinceLastReceive(double now)
        {
            return HasReceived ? Math.Max(0.0, now - LastReceiveTime) : double.PositiveInfinity;
        }

        /// <summary>受信を記録する。最初の受信と、途絶の後の受信では Resumed を返す。</summary>
        public OscReceiveTransition MarkReceived(double now)
        {
            HasReceived = true;
            LastReceiveTime = now;
            if (IsReceiving)
            {
                return OscReceiveTransition.None;
            }

            IsReceiving = true;
            return OscReceiveTransition.Resumed;
        }

        /// <summary>時間の経過を見る(毎フレーム呼ぶ)。受信中にしきい値以上なにも届いていなければ Stalled を返す。</summary>
        public OscReceiveTransition Poll(double now)
        {
            if (!IsReceiving || now - LastReceiveTime < stallSeconds)
            {
                return OscReceiveTransition.None;
            }

            IsReceiving = false;
            return OscReceiveTransition.Stalled;
        }
    }
}
