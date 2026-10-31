using System.Collections.Generic;
using NUnit.Framework;
using UnityEngine;

namespace OscDesk.Receiver.Tests
{
    /// <summary>
    /// 受けたが処理しなかったものの報告(/sys/ignored・/sys/failed。D-105)。未登録のアドレスは ignored、
    /// 型・Record の不一致と受け手の例外は failed。bundle の中身は 1 メッセージにまとめ、上限で切り捨てる。
    /// </summary>
    public sealed class OscDeliveryReportTests
    {
        private readonly List<OscInvocation> invocations = new List<OscInvocation>();
        private readonly List<int> mismatches = new List<int>();

        private static OscDispatcher Make()
        {
            return new OscDispatcher(new[]
            {
                new OscBindingRow("/count", OscBindingKind.Int, 1),
                new OscBindingRow("/vp/member", OscBindingKind.Record, 1, new[] { "active", "slot" }, false),
                new OscBindingRow("/go", OscBindingKind.Trigger, 1),
            });
        }

        private void Observe(OscDeliveryReport report, OscDispatcher dispatcher, string address, params object[] values)
        {
            dispatcher.Dispatch(address, values, invocations, mismatches);
            report.Observe(dispatcher, address, mismatches);
        }

        private static string[] Strings(object[] args)
        {
            var result = new string[args.Length];
            for (var i = 0; i < args.Length; i++) result[i] = (string)args[i];
            return result;
        }

        [Test]
        public void Handled_messages_report_nothing()
        {
            var report = new OscDeliveryReport();
            var dispatcher = Make();

            Observe(report, dispatcher, "/count", 3);
            Observe(report, dispatcher, "/go");

            Assert.That(report.IsEmpty, Is.True);
            Assert.That(report.TryBuildIgnored(out _), Is.False);
            Assert.That(report.TryBuildFailed(out _), Is.False);
        }

        [Test]
        public void Unbound_address_is_ignored()
        {
            var report = new OscDeliveryReport();

            Observe(report, Make(), "/pc2/charB/pose", 1f);

            Assert.That(report.TryBuildIgnored(out var args), Is.True);
            Assert.That(Strings(args), Is.EqualTo(new[] { "/pc2/charB/pose" }));
            Assert.That(report.TryBuildFailed(out _), Is.False);
        }

        [Test]
        public void Type_mismatch_is_failed()
        {
            var report = new OscDeliveryReport();

            Observe(report, Make(), "/count", "not a number");

            Assert.That(report.TryBuildFailed(out var args), Is.True);
            Assert.That(Strings(args), Is.EqualTo(new[] { "/count", "type mismatch" }));
            Assert.That(report.TryBuildIgnored(out _), Is.False);
        }

        [Test]
        public void Record_mismatch_is_failed_with_its_own_reason()
        {
            var report = new OscDeliveryReport();

            Observe(report, Make(), "/vp/member", "alice", 1); // フィールドは 2 つのはずが 1 つ

            Assert.That(report.TryBuildFailed(out var args), Is.True);
            Assert.That(Strings(args), Is.EqualTo(new[] { "/vp/member", "record mismatch" }));
        }

        [Test]
        public void Exception_is_failed()
        {
            var report = new OscDeliveryReport();

            report.AddFailed("/go", OscDeliveryReport.ReasonException);

            Assert.That(report.TryBuildFailed(out var args), Is.True);
            Assert.That(Strings(args), Is.EqualTo(new[] { "/go", "exception" }));
        }

        [Test]
        public void A_bundle_is_folded_into_one_message_per_kind()
        {
            var report = new OscDeliveryReport();
            var dispatcher = Make();

            for (var i = 0; i < 64; i++)
            {
                Observe(report, dispatcher, "/missing/" + (i % 4), 0);
            }

            Observe(report, dispatcher, "/count", "x");
            Observe(report, dispatcher, "/vp/member");

            Assert.That(report.TryBuildIgnored(out var ignored), Is.True);
            Assert.That(Strings(ignored), Is.EqualTo(new[] { "/missing/0", "/missing/1", "/missing/2", "/missing/3" }), "同じアドレスは 1 回");
            Assert.That(report.TryBuildFailed(out var failed), Is.True);
            Assert.That(Strings(failed), Is.EqualTo(new[] { "/count", "type mismatch", "/vp/member", "record mismatch" }));
        }

        [Test]
        public void Reports_are_capped_so_one_datagram_cannot_amplify()
        {
            var report = new OscDeliveryReport();
            var dispatcher = Make();

            for (var i = 0; i < OscDeliveryReport.MaxIgnored * 4; i++)
            {
                Observe(report, dispatcher, "/missing/" + i);
                report.AddFailed("/count", OscDeliveryReport.ReasonTypeMismatch);
            }

            Assert.That(report.TryBuildIgnored(out var ignored), Is.True);
            Assert.That(ignored.Length, Is.EqualTo(OscDeliveryReport.MaxIgnored));
            Assert.That(report.TryBuildFailed(out var failed), Is.True);
            Assert.That(failed.Length, Is.EqualTo(OscDeliveryReport.MaxFailed * 2));
        }

        [Test]
        public void Long_text_is_clipped_without_splitting_a_surrogate_pair()
        {
            var report = new OscDeliveryReport();
            var longAddress = "/" + new string('a', OscDeliveryReport.MaxTextLength - 2) + "\U0001F600tail";

            report.AddIgnored(longAddress);

            Assert.That(report.TryBuildIgnored(out var args), Is.True);
            var text = (string)args[0];
            Assert.That(text.Length, Is.LessThanOrEqualTo(OscDeliveryReport.MaxTextLength));
            Assert.That(char.IsHighSurrogate(text[text.Length - 1]), Is.False);
            Assert.DoesNotThrow(() => OscCodec.EncodeMessage(OscDeliveryReport.IgnoredAddress, args));
        }

        [Test]
        public void Clear_forgets_the_previous_datagram()
        {
            var report = new OscDeliveryReport();
            Observe(report, Make(), "/missing");

            report.Clear();

            Assert.That(report.IsEmpty, Is.True);
        }

        [Test]
        public void Receiver_reports_by_default_and_can_be_turned_off()
        {
            var gameObject = new GameObject("OscDeliveryReportTests") { hideFlags = HideFlags.HideAndDontSave };
            try
            {
                var receiver = gameObject.AddComponent<OscReceiver>();
                Assert.That(receiver.ReportOutcomes, Is.True);
                receiver.ReportOutcomes = false;
                Assert.That(receiver.ReportOutcomes, Is.False);
            }
            finally
            {
                Object.DestroyImmediate(gameObject);
            }
        }
    }
}
