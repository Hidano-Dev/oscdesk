using System;

namespace OscDesk.Receiver
{
    /// <summary><see cref="OscResendWindow"/> が開いた理由。</summary>
    public enum OscResendWindowReason
    {
        None,

        /// <summary>
        /// 呼び出し側が <see cref="OscResendWindow.Open"/> で明示的に開いた(Play 開始・受け手の有効化)。
        /// ブリッジは Unity の初めての pong・喪失からの回復で保持値を再送する(DESIGN.md D-045)。
        /// </summary>
        PlayStart,

        /// <summary>ブリッジからの受信が <see cref="OscResendWindow.GapSeconds"/> 以上途絶えた後の再開(ブリッジ・ネットワークの回復、Editor の Pause 明け)。</summary>
        ReceiveGap
    }

    /// <summary><see cref="OscResendWindow"/> が閉じた理由(閉じなかったら None)。</summary>
    public enum OscResendWindowClose
    {
        None,

        /// <summary>窓の中で値が届き、最後の値から静穏時間が過ぎた。呼び出し側は窓の中で値が届いた対象を、トリガを待たずに適用する。</summary>
        Quiet,

        /// <summary>窓の中でトリガが届いた。呼び出し側はトリガの範囲だけを通常どおり適用し、窓で集めた値の自動適用はしない。</summary>
        Trigger
    }

    /// <summary>
    /// 値を「届いた時点では保持だけ、適用はトリガを待つ」アプリで、ブリッジの再送をトリガなしで適用するための窓(DESIGN.md D-097)。
    /// 再送もふだんの操作も OSC 上では同じ「同じアドレスへの値」で区別できないので、再送が起きる契機(Play 開始と、受信の途絶からの再開)
    /// にだけ窓を開き、その中で届いた値を再送とみなす。窓の外の値はふだんの操作としてトリガまで適用しない。
    /// 時刻は呼び出し側が渡す(秒、単調増加。OscReceiver.LastReceivedRealtime と同じ Time.realtimeSinceStartup を使う)。
    /// UnityEngine に依存しないので EditMode で状態遷移を固定できる。使い方は docs/UNITY_PROTOCOL.md §5「トリガ待ちのアプリでの再送の扱い」。
    /// </summary>
    public sealed class OscResendWindow
    {
        /// <summary>
        /// 途絶とみなす受信の空きの既定値。ブリッジの ping 間隔(2 秒)の 3 倍で、ping を 2 回落としても誤検出しない。
        /// ブリッジは ping を 1 回取りこぼした後の pong(再起動後は初めての pong)でも再送するので、これより短い途絶の回復でも
        /// 再送は届くが、窓は開かない。そのような途絶では Unity は値を失っていない(Unity の再起動は Play 開始の窓が受ける)ので、
        /// 届くのは既に受けた値と同じで、トリガまで適用しなくても状態は変わらない(DESIGN.md D-097)。
        /// </summary>
        public const double DefaultGapSeconds = 6;

        /// <summary>
        /// 静穏時間の既定値。再送の burst(保持値ごとの個別メッセージの連続。100 件程度でも数 ms〜数十 ms)を待ち切る長さで、
        /// 操作者のトリガ(再送の直後に押されることもある)より先に閉じすぎない程度に短くしてある。
        /// </summary>
        public const double DefaultQuietSeconds = 0.75;

        private double? lastReceiveAt;
        private double? lastValueAt;
        private double gapSeconds;
        private double quietSeconds;

        public OscResendWindow()
            : this(DefaultGapSeconds, DefaultQuietSeconds)
        {
        }

        public OscResendWindow(double gapSeconds, double quietSeconds)
        {
            GapSeconds = gapSeconds;
            QuietSeconds = quietSeconds;
        }

        /// <summary>この秒数以上の受信の空きの後の最初の受信で窓を開く。0 以下は拒否する(毎回の受信で開いてしまうため)。</summary>
        public double GapSeconds
        {
            get { return gapSeconds; }
            set
            {
                if (!(value > 0)) throw new ArgumentOutOfRangeException(nameof(value), value, "GapSeconds must be positive");
                gapSeconds = value;
            }
        }

        /// <summary>窓の中の最後の値からこの秒数静かなら閉じる。0 以下は拒否する(burst の途中で閉じてしまうため)。</summary>
        public double QuietSeconds
        {
            get { return quietSeconds; }
            set
            {
                if (!(value > 0)) throw new ArgumentOutOfRangeException(nameof(value), value, "QuietSeconds must be positive");
                quietSeconds = value;
            }
        }

        /// <summary>
        /// true のときだけ受信の途絶からの再開で窓を開く(Play 開始の窓は <see cref="Open"/> で明示的に開くので関係しない)。既定は true。
        /// ブリッジは保持値をファイルに保存して再起動後も復元・再送する(D-058)ので、途絶後の自動適用でブリッジの再起動時に
        /// 定義の既定値が適用されることはない。
        /// </summary>
        public bool ReopenOnGap { get; set; } = true;

        public bool IsOpen { get; private set; }

        public OscResendWindowReason Reason { get; private set; }

        /// <summary>窓が開いていて、その中で値が届いたか(Tick が Quiet を返し得る状態か)。</summary>
        public bool HasValues { get { return IsOpen && lastValueAt.HasValue; } }

        /// <summary>最後に記録した受信の時刻(受信前は null)。</summary>
        public double? LastReceiveAt { get { return lastReceiveAt; } }

        /// <summary>窓を開く(開いていれば開き直し、前の窓で届いた値を忘れる)。</summary>
        public void Open(OscResendWindowReason reason)
        {
            IsOpen = true;
            Reason = reason;
            lastValueAt = null;
        }

        public void Close()
        {
            IsOpen = false;
            Reason = OscResendWindowReason.None;
            lastValueAt = null;
        }

        /// <summary>
        /// ブリッジから何かを受けた(/sys/ping を含む)。直前の受信から GapSeconds 以上空いていて、窓が閉じていれば
        /// ReceiveGap で開いて true を返す。開いていて窓の中で値が届いていれば、静穏時間を途絶の後から数え直す(false を返す)。
        /// ブリッジは 2 秒間隔で ping を送るので、動いている間は受信が途切れない。
        /// 途絶はブリッジの停止・再起動、ネットワーク断、Editor の Pause のいずれかで、どの回復でもブリッジは保持値を再送する。
        /// 過去の時刻(同じフレームで先に渡した現在時刻より前の受信時刻など)は最後の受信を巻き戻さない。
        /// </summary>
        public bool NoteReceive(double now)
        {
            var opened = false;
            if (lastReceiveAt.HasValue && now - lastReceiveAt.Value >= gapSeconds)
            {
                if (!IsOpen)
                {
                    if (ReopenOnGap)
                    {
                        Open(OscResendWindowReason.ReceiveGap);
                        opened = true;
                    }
                }
                else if (lastValueAt.HasValue)
                {
                    // 開いている窓の静穏時間を途絶の後から数え直す。そうしないと、窓の中の値の直後に Pause して再開したとき、
                    // 途絶の前の値の時刻で直ちに Quiet になり、再開の後に届く再送が窓の外(ふだんの操作)に落ちる
                    lastValueAt = now;
                }
            }

            if (!lastReceiveAt.HasValue || now > lastReceiveAt.Value) lastReceiveAt = now;
            return opened;
        }

        /// <summary>
        /// 保持して適用を待つ値を受けた。受信の記録も兼ねるので、途絶の後に最初に届いたのが値でも窓が開き、その値も窓の中に数える。
        /// 窓が開いていれば静穏時間の起点を更新する。窓を開いたら true(呼び出し側は前の窓で集めた対象を忘れる)。
        /// </summary>
        public bool NoteValue(double now)
        {
            var opened = NoteReceive(now);
            if (IsOpen) lastValueAt = now;
            return opened;
        }

        /// <summary>適用のトリガを受けた。窓が開いていれば閉じて Trigger を返す(トリガの範囲の適用は呼び出し側が通常どおり行う)。</summary>
        public OscResendWindowClose NoteTrigger(double now)
        {
            NoteReceive(now);
            if (!IsOpen) return OscResendWindowClose.None;
            Close();
            return OscResendWindowClose.Trigger;
        }

        /// <summary>
        /// 毎フレーム呼ぶ。窓の中で値が届き、最後の値から QuietSeconds が過ぎたら閉じて Quiet を返す。
        /// 値が届くまでは閉じない(ブリッジが pong を観測して再送するまでは ping しか届かないため)。
        /// 最後の受信から GapSeconds 以上経っている間も閉じない。Editor の Pause 明けの最初のフレームで、受け口がまだ受信を
        /// 処理しておらず(Update の順序次第)最後の受信が途絶の前のままでも、古い静穏時間で閉じないようにするため。
        /// 再開の受信(NoteReceive)が静穏時間を数え直す。
        /// </summary>
        public OscResendWindowClose Tick(double now)
        {
            if (!IsOpen || !lastValueAt.HasValue) return OscResendWindowClose.None;
            if (lastReceiveAt.HasValue && now - lastReceiveAt.Value >= gapSeconds) return OscResendWindowClose.None;
            if (now - lastValueAt.Value < quietSeconds) return OscResendWindowClose.None;
            Close();
            return OscResendWindowClose.Quiet;
        }
    }
}
