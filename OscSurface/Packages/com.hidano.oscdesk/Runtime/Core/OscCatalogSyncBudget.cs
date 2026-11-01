using System;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 設計図の全体の送り直し(begin … end)の予算(DESIGN.md D-120)。最短の間隔(既定 1 秒)に加えて、送ったバイト数を
    /// 貯金から引き、貯金は一定の速さで戻る(上限あり)。貯金が負の間は全体を送らない。
    /// /sys/catalog/request は認証が無く送信元も問わないので、LAN の別プロセスが要求を送り続けると、大きい設計図(上限内で約 8 MiB)では
    /// 1 秒に 1 回の全体の送信だけで Unity のフレーム時間・LAN・ブリッジに継続的な負荷がかかる(HID-394)。間隔を送った量に比例して延ばし、
    /// 続けて送れる量を <see cref="DefaultBytesPerSecond"/> に抑える。小さい設計図(1 回の全体がこの速さより小さい)は従来どおり 1 秒ごとに応じる。
    /// 貯金の上限は全体の上限 2 回分で、待ち受けの開始の全体の直後に押した Sync ボタンも、大きい設計図で待たせない。
    /// 送信元で絞らないのは、返信先と要求の送信元が一致しない正しい構成(返信先をホスト名・127.0.0.1 で設定したとき、ブリッジが別の NIC から
    /// 送るとき、「全てのデバイス」のブロードキャスト。D-078)を壊すため。
    /// 時刻は呼び出し側が渡す(秒、単調増加。OscReceiver は Time.realtimeSinceStartup)。UnityEngine に依存しないので EditMode で直接試す。
    /// </summary>
    public sealed class OscCatalogSyncBudget
    {
        /// <summary>全体を送り直す最短の間隔(秒)。</summary>
        public const double DefaultMinIntervalSeconds = 1;

        /// <summary>貯金が戻る速さ(バイト/秒)。続けて要求されたときの全体の送信量の上限になる。</summary>
        public const long DefaultBytesPerSecond = 512 * 1024;

        /// <summary>貯金の上限(バイト)。全体の上限(<see cref="OscCatalog.MaxTotalBytes"/>)の 2 回分。</summary>
        public const long DefaultCapacityBytes = 2L * OscCatalog.MaxTotalBytes;

        private readonly double minIntervalSeconds;
        private readonly long bytesPerSecond;
        private readonly long capacityBytes;
        private double credit;
        private double? lastSentAt;
        private double creditAt;

        public OscCatalogSyncBudget()
            : this(DefaultMinIntervalSeconds, DefaultBytesPerSecond, DefaultCapacityBytes)
        {
        }

        public OscCatalogSyncBudget(double minIntervalSeconds, long bytesPerSecond, long capacityBytes)
        {
            if (!(minIntervalSeconds >= 0)) throw new ArgumentOutOfRangeException(nameof(minIntervalSeconds), minIntervalSeconds, "must not be negative");
            if (bytesPerSecond <= 0) throw new ArgumentOutOfRangeException(nameof(bytesPerSecond), bytesPerSecond, "must be positive");
            if (capacityBytes <= 0) throw new ArgumentOutOfRangeException(nameof(capacityBytes), capacityBytes, "must be positive");
            this.minIntervalSeconds = minIntervalSeconds;
            this.bytesPerSecond = bytesPerSecond;
            this.capacityBytes = capacityBytes;
            credit = capacityBytes;
        }

        public double MinIntervalSeconds => minIntervalSeconds;

        public long BytesPerSecond => bytesPerSecond;

        public long CapacityBytes => capacityBytes;

        /// <summary>今の時刻での貯金(バイト。負なら借り)。</summary>
        public double CreditAt(double now)
        {
            if (!lastSentAt.HasValue)
            {
                return credit;
            }

            // 時計が戻っても貯金を減らさない(過去の時刻は経過 0 とみなす)
            var elapsed = Math.Max(0, now - creditAt);
            return Math.Min(capacityBytes, credit + elapsed * bytesPerSecond);
        }

        /// <summary>今、全体を送ってよいか(最短の間隔が過ぎていて、貯金が負でない)。</summary>
        public bool CanSend(double now)
        {
            if (!lastSentAt.HasValue)
            {
                return true;
            }

            if (now - lastSentAt.Value < minIntervalSeconds)
            {
                return false;
            }

            return CreditAt(now) >= 0;
        }

        /// <summary>全体を送った(bytes は送ったデータグラムの大きさの合計)。貯金から引く(負になってよい。その分だけ次の全体が遅れる)。</summary>
        public void NoteSent(double now, long bytes)
        {
            if (bytes < 0) throw new ArgumentOutOfRangeException(nameof(bytes), bytes, "must not be negative");
            credit = CreditAt(now) - bytes;
            if (!lastSentAt.HasValue || now > creditAt)
            {
                creditAt = now;
            }

            lastSentAt = now;
        }
    }
}
