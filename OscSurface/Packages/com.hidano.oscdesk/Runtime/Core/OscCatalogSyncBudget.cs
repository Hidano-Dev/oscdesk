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
    /// 全体の予定もここで持つ。Sync の要求への答えは、要求の到着から <see cref="RequestAnswerDeadlineSeconds"/> の内に送れる場合だけ送り、
    /// 送れない要求は保留せずに捨てる(遅れた答えをブリッジが起動の合図と取り違えるため。PR #113 のレビュー)。
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

        // 全体を送る予定があるか。期限が有限なら Sync の要求への答えだけの予定で、期限を過ぎたら送らずに取り下げる
        private bool pending;
        private double pendingDeadline = double.PositiveInfinity;

        /// <summary>全体を送る予定があるか(呼び出し側はその間、差分を送らずに全体に含める)。</summary>
        public bool Pending => pending;

        /// <summary>答えられずに捨てた Sync の要求の数(到着時に期限内に送れないと分かったもの、予定のまま期限を過ぎたもの)。</summary>
        public int DroppedRequests { get; private set; }

        /// <summary>
        /// 要求の答えではない全体の予定を立てる(待ち受けの開始・送れなかった間の取り直し・利用側の明示の呼び出し)。期限は無く、
        /// 予算が許すまで待って送る(ブリッジはこの begin を起動の合図とみなしてよい)。
        /// </summary>
        public void ScheduleFull()
        {
            pending = true;
            pendingDeadline = double.PositiveInfinity;
        }

        /// <summary>
        /// now に Sync の要求(/sys/catalog/request)が届いた。<see cref="RequestAnswerDeadlineSeconds"/> の内に全体を送れるなら予定を立てて true、
        /// 送れないなら捨てて false(保留して遅れて答えると、ブリッジはその begin を起動の合図と取り違える。D-120)。
        /// すでに予定があればそれに相乗りする(同じフレームに何通来ても 1 回。期限は先の要求のものを保つ)。
        /// </summary>
        public bool NoteRequest(double now)
        {
            if (pending)
            {
                return true;
            }

            if (!CanAnswerRequest(now))
            {
                DroppedRequests += 1;
                return false;
            }

            pending = true;
            pendingDeadline = now + RequestAnswerDeadlineSeconds;
            return true;
        }

        /// <summary>
        /// 毎フレーム呼ぶ。予定があり、今送ってよいなら true(呼び出し側は全体を送って <see cref="NoteSent"/> を呼ぶ)。
        /// 要求の答えの予定が期限を過ぎていたら(フレームの詰まり・Editor の Pause など)送らずに取り下げて false。
        /// </summary>
        public bool TryBeginFull(double now)
        {
            if (!pending)
            {
                return false;
            }

            if (now > pendingDeadline)
            {
                pending = false;
                pendingDeadline = double.PositiveInfinity;
                DroppedRequests += 1;
                return false;
            }

            return CanSend(now);
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

        /// <summary>
        /// Sync の要求に答えてよい期限(要求の到着からの秒)。ブリッジは要求を送ってから 5 秒以内に届いた begin を答えとみなし、
        /// それより遅い begin をその PC の起動の合図として生成の送り直しと保持値の再送を行う(catalog-manager の
        /// REQUEST_ANSWER_WINDOW_MS、D-115)。予算で遅らせた答えが窓を過ぎると、稼働中の Unity へ重複の spawn が飛ぶので、
        /// フレームの刻み・ネットワークの遅れを見込んで 1 秒短くし、この期限の内に送れない要求には答えない(D-120)。
        /// </summary>
        public const double RequestAnswerDeadlineSeconds = 4;

        /// <summary>今から待つとして、最も早く全体を送れる時刻(最短の間隔と、貯金が 0 に戻る時刻の遅い方)。</summary>
        public double NextSendAt(double now)
        {
            if (!lastSentAt.HasValue)
            {
                return now;
            }

            var at = Math.Max(now, lastSentAt.Value + minIntervalSeconds);
            var current = CreditAt(now);
            if (current < 0)
            {
                at = Math.Max(at, now + (-current) / bytesPerSecond);
            }

            return at;
        }

        /// <summary>now に届いた Sync の要求に、<see cref="RequestAnswerDeadlineSeconds"/> の内に答えられるか。</summary>
        public bool CanAnswerRequest(double now)
        {
            return NextSendAt(now) - now <= RequestAnswerDeadlineSeconds;
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
            pending = false;
            pendingDeadline = double.PositiveInfinity;
            credit = CreditAt(now) - bytes;
            if (!lastSentAt.HasValue || now > creditAt)
            {
                creditAt = now;
            }

            lastSentAt = now;
        }
    }
}
