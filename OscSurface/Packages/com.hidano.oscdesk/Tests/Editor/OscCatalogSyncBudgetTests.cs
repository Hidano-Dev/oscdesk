using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    /// <summary>設計図の全体の送り直しの予算(D-120、HID-394)。時刻は引数で渡すので、連打を秒単位で再現する。</summary>
    public sealed class OscCatalogSyncBudgetTests
    {
        // 約 60 fps。2 進で割り切れる刻みにして、1 秒ちょうどのフレームが浮動小数の誤差で 1 フレーム遅れないようにする
        private const double Frame = 1.0 / 64;

        // 毎フレーム要求が来ている(pending が立ち続ける)状況を、受け口と同じ「送れるなら送る」で回して送った時刻を返す
        private static List<double> Flood(OscCatalogSyncBudget budget, long bytesPerFullSync, double seconds)
        {
            var sentAt = new List<double>();
            var frames = (int)Math.Round(seconds / Frame);
            for (var i = 0; i <= frames; i++)
            {
                var now = i * Frame;
                if (budget.CanSend(now))
                {
                    budget.NoteSent(now, bytesPerFullSync);
                    sentAt.Add(now);
                }
            }

            return sentAt;
        }

        [Test]
        public void SmallCatalogStillAnswersOncePerSecond()
        {
            // 1 回の全体が戻る速さより小さい設計図は、連打されても従来どおり 1 秒ごとに応じる
            var budget = new OscCatalogSyncBudget();
            var sentAt = Flood(budget, 100 * 1024, 30);

            Assert.That(sentAt.Count, Is.EqualTo(31));
            for (var i = 1; i < sentAt.Count; i++)
            {
                Assert.That(sentAt[i] - sentAt[i - 1], Is.EqualTo(1.0).Within(1e-9));
            }
        }

        [Test]
        public void FirstRequestIsAnsweredImmediately()
        {
            var budget = new OscCatalogSyncBudget();
            Assert.That(budget.CanSend(0), Is.True);
            Assert.That(budget.CanSend(123.4), Is.True);
        }

        [Test]
        public void LargeCatalogFloodIsHeldToTheByteRate()
        {
            // 上限近くの設計図(約 7.6 MiB)を 10 分間連打されても、送る量は貯金の上限 + 戻る速さ × 時間に収まる
            const long full = 7_600_000;
            const double seconds = 600;
            var budget = new OscCatalogSyncBudget();
            var sentAt = Flood(budget, full, seconds);

            long total = sentAt.Count * full;
            var allowed = budget.CapacityBytes + budget.BytesPerSecond * seconds + full;
            Assert.That(total, Is.LessThanOrEqualTo(allowed));
            // 1 秒に 1 回のままなら 601 回送っていた
            Assert.That(sentAt.Count, Is.LessThan(60));

            // 貯金を使い切った後は、1 回の大きさに比例した間隔(約 14.5 秒)で送る
            var expected = (double)full / budget.BytesPerSecond;
            for (var i = 4; i < sentAt.Count; i++)
            {
                Assert.That(sentAt[i] - sentAt[i - 1], Is.EqualTo(expected).Within(Frame * 1.01));
            }
        }

        [Test]
        public void LargeCatalogSyncRightAfterStartIsNotDelayed()
        {
            // 待ち受けの開始で全体を送った直後に Sync ボタンを押しても、上限いっぱいの設計図で待たせない(貯金は全体の 2 回分)
            var budget = new OscCatalogSyncBudget();
            budget.NoteSent(0, OscCatalog.MaxTotalBytes);

            Assert.That(budget.CanSend(0.5), Is.False, "最短の間隔は守る");
            Assert.That(budget.CanSend(1.0), Is.True);
        }

        [Test]
        public void DebtDelaysTheNextFullSyncInProportionToItsSize()
        {
            var budget = new OscCatalogSyncBudget(1, 1000, 1000);
            budget.NoteSent(0, 1000);
            budget.NoteSent(1, 5000); // 1 秒で 1000 戻った貯金から 5000 を引いて -4000(戻るのに 4 秒)

            Assert.That(budget.CreditAt(1), Is.EqualTo(-4000).Within(1e-9));
            Assert.That(budget.CanSend(4.9), Is.False);
            Assert.That(budget.CanSend(5.0), Is.True);
            Assert.That(budget.CreditAt(5.0), Is.EqualTo(0).Within(1e-9));
            Assert.That(budget.CreditAt(1000), Is.EqualTo(1000), "貯金は上限まで");
        }

        [Test]
        public void ClockGoingBackwardDoesNotRefillOrUnlock()
        {
            var budget = new OscCatalogSyncBudget(1, 1000, 1000);
            budget.NoteSent(10, 3000);

            Assert.That(budget.CanSend(5), Is.False);
            Assert.That(budget.CreditAt(5), Is.EqualTo(-2000).Within(1e-9));
            Assert.That(budget.CanSend(12), Is.True);
        }

        // ---- Sync の要求への答えの期限(ブリッジの答えの窓 5 秒より短い 4 秒。PR #113 のレビュー) ----

        [Test]
        public void RequestThatCannotBeAnsweredInTimeIsDroppedAndNeverAnsweredLate()
        {
            // レビューの例: 7.6 MB の全体を 0・1・2 秒に送った後、3 秒の要求に答えられるのは約 11.5 秒(ブリッジの窓の外)
            const long full = 7_600_000;
            var budget = new OscCatalogSyncBudget();
            budget.NoteSent(0, full);
            budget.NoteSent(1, full);
            budget.NoteSent(2, full);
            Assert.That(budget.NextSendAt(3) - 3, Is.GreaterThan(5), "前提: 予算どおりに待てばブリッジの窓を超える");

            Assert.That(budget.NoteRequest(3), Is.False);
            Assert.That(budget.Pending, Is.False);
            Assert.That(budget.DroppedRequests, Is.EqualTo(1));

            // 遅れた全体は送らない(予算が戻った後も、要求が来ない限り全体の予定は立たない)
            for (var now = 3.0; now <= 60; now += Frame)
            {
                Assert.That(budget.TryBeginFull(now), Is.False, "t=" + now);
            }
        }

        [Test]
        public void AnsweredRequestsAreAlwaysAnsweredWithinTheDeadlineUnderFlood()
        {
            // 大きい設計図に毎フレーム要求が来ても、送った全体はどれも、その答えになった最初の要求から 4 秒の内
            const long full = 7_600_000;
            var budget = new OscCatalogSyncBudget();
            double? acceptedAt = null;
            var sends = 0;
            for (var i = 0; i <= (int)(600 / Frame); i++)
            {
                var now = i * Frame;
                if (budget.NoteRequest(now) && !acceptedAt.HasValue)
                {
                    acceptedAt = now;
                }

                if (budget.TryBeginFull(now))
                {
                    Assert.That(acceptedAt.HasValue, Is.True, "要求の答えでない全体は送らない");
                    Assert.That(now - acceptedAt.Value, Is.LessThanOrEqualTo(OscCatalogSyncBudget.RequestAnswerDeadlineSeconds));
                    budget.NoteSent(now, full);
                    acceptedAt = null;
                    sends += 1;
                }
            }

            Assert.That(sends, Is.GreaterThan(3).And.LessThan(60));
            Assert.That(budget.DroppedRequests, Is.GreaterThan(0));
        }

        [Test]
        public void SmallCatalogRequestRightAfterASyncIsAnsweredAtTheNextSecond()
        {
            var budget = new OscCatalogSyncBudget();
            budget.NoteSent(0, 100 * 1024);

            Assert.That(budget.NoteRequest(0.25), Is.True);
            Assert.That(budget.TryBeginFull(0.5), Is.False, "最短の間隔は守る");
            Assert.That(budget.TryBeginFull(1.0), Is.True);
            Assert.That(budget.DroppedRequests, Is.EqualTo(0));
        }

        [Test]
        public void AcceptedRequestPastItsDeadlineIsWithdrawnWithoutSending()
        {
            // 受け付けた後にフレームが詰まって(Editor の Pause など)期限を過ぎたら、送らずに取り下げる
            var budget = new OscCatalogSyncBudget(1, 1000, 1000);
            budget.NoteSent(0, 3000); // 貯金 -2000、送れるのは 2 秒後
            Assert.That(budget.NoteRequest(0.5), Is.True);

            Assert.That(budget.TryBeginFull(0.5 + OscCatalogSyncBudget.RequestAnswerDeadlineSeconds + 0.1), Is.False);
            Assert.That(budget.Pending, Is.False);
            Assert.That(budget.DroppedRequests, Is.EqualTo(1));
            Assert.That(budget.TryBeginFull(100), Is.False);
        }

        [Test]
        public void ScheduledFullThatIsNotAnAnswerWaitsForTheBudgetWithoutDeadline()
        {
            // 待ち受けの開始・送れなかった間の取り直しの全体は要求の答えではないので、4 秒を超えても取り下げない
            var budget = new OscCatalogSyncBudget(1, 1000, 1000);
            budget.NoteSent(0, 10_000); // 貯金 -9000、送れるのは 9 秒後
            budget.ScheduleFull();
            Assert.That(budget.NoteRequest(0.5), Is.True, "予定に相乗りする");

            Assert.That(budget.TryBeginFull(8.9), Is.False);
            Assert.That(budget.Pending, Is.True);
            Assert.That(budget.TryBeginFull(9.0), Is.True);
            budget.NoteSent(9.0, 10);
            Assert.That(budget.Pending, Is.False);
            Assert.That(budget.DroppedRequests, Is.EqualTo(0));
        }

        [Test]
        public void ScheduleFullTurnsAPendingAnswerIntoAnUndeadlinedFull()
        {
            var budget = new OscCatalogSyncBudget(1, 1000, 1000);
            budget.NoteSent(0, 4000); // 貯金 -3000、送れるのは 3 秒後
            Assert.That(budget.NoteRequest(0), Is.True);
            budget.ScheduleFull();

            Assert.That(budget.TryBeginFull(10), Is.True, "期限を外したので取り下げない");
        }

        [Test]
        public void RejectsInvalidSettings()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => new OscCatalogSyncBudget(-1, 1000, 1000));
            Assert.Throws<ArgumentOutOfRangeException>(() => new OscCatalogSyncBudget(double.NaN, 1000, 1000));
            Assert.Throws<ArgumentOutOfRangeException>(() => new OscCatalogSyncBudget(1, 0, 1000));
            Assert.Throws<ArgumentOutOfRangeException>(() => new OscCatalogSyncBudget(1, 1000, 0));
            Assert.Throws<ArgumentOutOfRangeException>(() => new OscCatalogSyncBudget().NoteSent(0, -1));
        }
    }
}
