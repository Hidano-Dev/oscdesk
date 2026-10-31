using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    public sealed class OscLinkMonitorTests
    {
        [Test]
        public void PollLost_is_false_before_first_receive()
        {
            var monitor = new OscLinkMonitor(5);
            Assert.IsFalse(monitor.PollLost(100));
            Assert.IsFalse(monitor.HasReceived);
        }

        [Test]
        public void PollLost_fires_once_after_timeout()
        {
            var monitor = new OscLinkMonitor(5);
            monitor.NotifyReceived(10);
            Assert.IsFalse(monitor.PollLost(15));
            Assert.IsTrue(monitor.PollLost(15.1));
            Assert.IsTrue(monitor.IsLost);
            Assert.IsFalse(monitor.PollLost(30));
        }

        [Test]
        public void NotifyReceived_reports_resume_only_after_lost()
        {
            var monitor = new OscLinkMonitor(5);
            Assert.IsFalse(monitor.NotifyReceived(1));
            Assert.IsFalse(monitor.NotifyReceived(2));
            monitor.PollLost(20);
            Assert.IsTrue(monitor.NotifyReceived(21));
            Assert.IsFalse(monitor.IsLost);
            Assert.AreEqual(21, monitor.LastReceivedAt);
            Assert.IsFalse(monitor.NotifyReceived(22));
        }

        [Test]
        public void Zero_timeout_never_reports_lost()
        {
            var monitor = new OscLinkMonitor(0);
            monitor.NotifyReceived(1);
            Assert.IsFalse(monitor.PollLost(1000));
        }
    }
}
