using System;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    // フォーク a8-oscdesk のホストの同期待ちの窓(FD-039)と同じ状態遷移を固定する(D-097)
    public sealed class OscResendWindowTests
    {
        private const double Gap = 6;
        private const double Quiet = 0.75;

        private static OscResendWindow OpenAtStart()
        {
            var window = new OscResendWindow(Gap, Quiet);
            window.Open(OscResendWindowReason.PlayStart);
            return window;
        }

        [Test]
        public void Defaults_follow_the_ping_interval_and_the_resend_burst()
        {
            var window = new OscResendWindow();
            Assert.That(window.GapSeconds, Is.EqualTo(OscResendWindow.DefaultGapSeconds));
            Assert.That(window.QuietSeconds, Is.EqualTo(OscResendWindow.DefaultQuietSeconds));
            Assert.That(OscResendWindow.DefaultGapSeconds, Is.EqualTo(6));
            Assert.That(OscResendWindow.DefaultQuietSeconds, Is.EqualTo(0.75));
            Assert.That(window.IsOpen, Is.False);
            Assert.That(window.Reason, Is.EqualTo(OscResendWindowReason.None));
            Assert.That(window.LastReceiveAt, Is.Null);
        }

        [Test]
        public void Play_start_window_waits_for_values_then_closes_after_quiet_time()
        {
            var window = OpenAtStart();

            // ブリッジが pong を観測するまでは ping だけが届く。値が無い間は閉じない
            window.NoteReceive(0.5);
            Assert.That(window.Tick(10), Is.EqualTo(OscResendWindowClose.None));
            Assert.That(window.IsOpen, Is.True);
            Assert.That(window.Reason, Is.EqualTo(OscResendWindowReason.PlayStart));

            window.NoteValue(10.0);
            window.NoteValue(10.01);
            Assert.That(window.HasValues, Is.True);
            Assert.That(window.Tick(10.5), Is.EqualTo(OscResendWindowClose.None));
            Assert.That(window.Tick(10.8), Is.EqualTo(OscResendWindowClose.Quiet));
            Assert.That(window.IsOpen, Is.False);
            Assert.That(window.Reason, Is.EqualTo(OscResendWindowReason.None));
            Assert.That(window.Tick(11), Is.EqualTo(OscResendWindowClose.None));
        }

        [Test]
        public void Each_value_extends_the_quiet_time()
        {
            var window = OpenAtStart();
            window.NoteValue(1.0);
            window.NoteValue(1.7);

            Assert.That(window.Tick(2.0), Is.EqualTo(OscResendWindowClose.None));
            Assert.That(window.Tick(2.5), Is.EqualTo(OscResendWindowClose.Quiet));
        }

        [Test]
        public void Values_outside_the_window_are_ordinary_operations()
        {
            var window = new OscResendWindow(Gap, Quiet);
            window.NoteReceive(0);
            window.NoteReceive(2);
            Assert.That(window.NoteValue(3), Is.False);

            Assert.That(window.IsOpen, Is.False);
            Assert.That(window.HasValues, Is.False);
            Assert.That(window.Tick(10), Is.EqualTo(OscResendWindowClose.None));
        }

        [Test]
        public void Trigger_inside_the_window_closes_it_without_auto_apply()
        {
            var window = OpenAtStart();
            window.NoteValue(1.0);

            Assert.That(window.NoteTrigger(1.1), Is.EqualTo(OscResendWindowClose.Trigger));
            Assert.That(window.IsOpen, Is.False);
            Assert.That(window.Tick(5), Is.EqualTo(OscResendWindowClose.None));
            Assert.That(window.NoteTrigger(6), Is.EqualTo(OscResendWindowClose.None));
        }

        [Test]
        public void Gap_reopening_is_on_by_default()
        {
            // ブリッジが保持値を保存・復元する(D-058)ので、途絶からの再開で既定どおり窓を開く
            var window = new OscResendWindow(Gap, Quiet);
            Assert.That(window.ReopenOnGap, Is.True);

            window.NoteReceive(0);
            Assert.That(window.NoteReceive(20), Is.True);
            Assert.That(window.IsOpen, Is.True);
            Assert.That(window.Reason, Is.EqualTo(OscResendWindowReason.ReceiveGap));
        }

        [Test]
        public void Receive_gap_reopens_the_window()
        {
            var window = OpenAtStart();
            window.NoteValue(1.0);
            Assert.That(window.Tick(2.0), Is.EqualTo(OscResendWindowClose.Quiet));

            // ping は 2 秒ごと。6 秒未満の空きは途絶とみなさない
            Assert.That(window.NoteReceive(3.0), Is.False);
            Assert.That(window.NoteReceive(8.9), Is.False);
            Assert.That(window.IsOpen, Is.False);

            // ブリッジ停止などで 6 秒以上何も届かず、再開した
            Assert.That(window.NoteReceive(15.0), Is.True);
            Assert.That(window.IsOpen, Is.True);
            Assert.That(window.Reason, Is.EqualTo(OscResendWindowReason.ReceiveGap));

            window.NoteValue(15.2);
            Assert.That(window.Tick(16.0), Is.EqualTo(OscResendWindowClose.Quiet));
        }

        [Test]
        public void Gap_of_exactly_gap_seconds_reopens()
        {
            var window = new OscResendWindow(Gap, Quiet);
            window.NoteReceive(10);
            Assert.That(window.NoteReceive(16), Is.True);
        }

        [Test]
        public void Value_arriving_first_after_a_gap_opens_the_window_and_counts()
        {
            var window = new OscResendWindow(Gap, Quiet);
            window.NoteReceive(0);

            Assert.That(window.NoteValue(20), Is.True);
            Assert.That(window.HasValues, Is.True);
            Assert.That(window.Tick(21), Is.EqualTo(OscResendWindowClose.Quiet));
        }

        [Test]
        public void Trigger_arriving_first_after_a_gap_opens_and_closes_the_window()
        {
            // 途絶明けの最初の受信がトリガなら、開いた窓をそのトリガで閉じる(再送を待たずに操作者が適用した)
            var window = new OscResendWindow(Gap, Quiet);
            window.NoteReceive(0);

            Assert.That(window.NoteTrigger(20), Is.EqualTo(OscResendWindowClose.Trigger));
            Assert.That(window.IsOpen, Is.False);
        }

        [Test]
        public void Gap_does_not_reopen_when_disabled_or_already_open()
        {
            var window = new OscResendWindow(Gap, Quiet) { ReopenOnGap = false };
            window.NoteReceive(0);
            Assert.That(window.NoteReceive(20), Is.False);
            Assert.That(window.IsOpen, Is.False);

            var open = OpenAtStart();
            open.NoteReceive(0);
            Assert.That(open.NoteReceive(20), Is.False);
            Assert.That(open.Reason, Is.EqualTo(OscResendWindowReason.PlayStart));
        }

        [Test]
        public void Value_after_a_gap_does_not_open_the_window_when_disabled()
        {
            // 途絶からの自動適用を切った利用側では、途絶後に値が先に届いても窓を開かない
            var window = new OscResendWindow(Gap, Quiet) { ReopenOnGap = false };
            window.NoteReceive(0);
            Assert.That(window.NoteValue(20), Is.False);
            Assert.That(window.IsOpen, Is.False);
            Assert.That(window.Tick(21), Is.EqualTo(OscResendWindowClose.None));

            // Play 開始の窓は ReopenOnGap に関係なく開ける
            window.Open(OscResendWindowReason.PlayStart);
            window.NoteValue(22);
            Assert.That(window.Tick(23), Is.EqualTo(OscResendWindowClose.Quiet));
        }

        [Test]
        public void Reopening_forgets_values_of_the_previous_window()
        {
            var window = OpenAtStart();
            window.NoteValue(1.0);
            window.Close();
            window.Open(OscResendWindowReason.PlayStart);

            Assert.That(window.HasValues, Is.False);
            Assert.That(window.Tick(100), Is.EqualTo(OscResendWindowClose.None));
        }

        [Test]
        public void Older_receive_time_does_not_rewind_the_last_receive()
        {
            // 受け口の LastReceivedRealtime(受信の時刻)は、同じフレームで先に渡した現在時刻より前になり得る
            var window = new OscResendWindow(Gap, Quiet);
            window.NoteValue(10.0);
            window.NoteReceive(9.99);
            Assert.That(window.LastReceiveAt, Is.EqualTo(10.0));

            // 巻き戻していれば 15.995 で 6 秒の空きに見えて開いてしまう
            Assert.That(window.NoteReceive(15.995), Is.False);
        }

        [Test]
        public void Rejects_non_positive_thresholds()
        {
            Assert.That(() => new OscResendWindow(0, 1), Throws.TypeOf<ArgumentOutOfRangeException>());
            Assert.That(() => new OscResendWindow(1, 0), Throws.TypeOf<ArgumentOutOfRangeException>());
            Assert.That(() => new OscResendWindow(double.NaN, 1), Throws.TypeOf<ArgumentOutOfRangeException>());

            var window = new OscResendWindow(Gap, Quiet);
            Assert.That(() => window.GapSeconds = -1, Throws.TypeOf<ArgumentOutOfRangeException>());
            Assert.That(() => window.QuietSeconds = 0, Throws.TypeOf<ArgumentOutOfRangeException>());
            Assert.That(window.GapSeconds, Is.EqualTo(Gap));
            Assert.That(window.QuietSeconds, Is.EqualTo(Quiet));
        }

        [Test]
        public void Thresholds_can_be_changed_while_running()
        {
            // インスペクタの値を有効化のたびに入れ直す使い方(GapSeconds / QuietSeconds は setter で変えられる)
            var window = OpenAtStart();
            window.QuietSeconds = 2;
            window.NoteValue(1.0);
            Assert.That(window.Tick(2.5), Is.EqualTo(OscResendWindowClose.None));
            Assert.That(window.Tick(3.0), Is.EqualTo(OscResendWindowClose.Quiet));

            window.GapSeconds = 3;
            Assert.That(window.NoteReceive(3.5), Is.False);
            Assert.That(window.NoteReceive(6.5), Is.True);
        }
    }
}
