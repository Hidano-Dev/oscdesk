// OscLink.cs — 接続確認(/sys/ping・/sys/stats)とエコーの組み立て(DESIGN.md D-108)。UnityEngine に依存しない。
using System;
using System.Collections.Generic;
using System.Globalization;

namespace OscDesk.Receiver
{
    /// <summary>
    /// Link。受信 1 件ごとに、`/sys/*` への応答と、振り分ける受信のエコーを決める。送信(Transport)と振り分け(Router)は持たない。
    /// 途絶の判定(OscLinkMonitor)は受信時刻だけを見る別の部品で、ここでは扱わない。
    /// </summary>
    public sealed class OscLink
    {
        public const string PingAddress = "/sys/ping";
        public const string PongAddress = "/sys/pong";
        public const string StatsRequestAddress = "/sys/stats/request";
        public const string StatsAddress = "/sys/stats";

        /// <summary>受けたメッセージの数(/sys/* を含む)。</summary>
        public int Received { get; private set; }

        /// <summary>読めずに捨てたデータグラムの数(受け口が数える)。</summary>
        public int ParseErrors { get; private set; }

        public void CountParseError()
        {
            ParseErrors += 1;
        }

        /// <summary>
        /// 受信 1 件を数え、`/sys/*` なら true を返す(振り分けもエコーもしない)。応答があれば replyAddress / replyArgs に入れる
        /// (`/sys/ping` に同じ seq の `/sys/pong`、`/sys/stats/request` に `/sys/stats`。それ以外の `/sys/*` は数えるだけ)。
        /// oversized は大きすぎて受けられなかったデータグラムの数(stats の parseErrors に足す)。
        /// </summary>
        public bool TryHandleSystem(string address, IReadOnlyList<object> values, int oversized, DateTime utcNow,
            out string replyAddress, out object[] replyArgs)
        {
            Received += 1;
            replyAddress = null;
            replyArgs = null;
            if (address == null)
            {
                return false;
            }

            switch (address)
            {
                case PingAddress:
                    if (values != null && values.Count > 0 && values[0] is int seq)
                    {
                        replyAddress = PongAddress;
                        replyArgs = new object[] { seq };
                    }

                    return true;
                case StatsRequestAddress:
                    replyAddress = StatsAddress;
                    replyArgs = new object[] { BuildStatsJson(oversized, utcNow) };
                    return true;
            }

            return address.StartsWith("/sys/", StringComparison.Ordinal);
        }

        /// <summary>受信値をそのまま返すエコーの引数(bool は i の 0/1。UNITY_PROTOCOL §2)。</summary>
        public static object[] BuildEcho(IReadOnlyList<object> values)
        {
            var count = values?.Count ?? 0;
            var echoed = new object[count];
            for (var i = 0; i < count; i++)
            {
                echoed[i] = OscDispatcher.NormalizeForEcho(values[i]);
            }

            return echoed;
        }

        /// <summary>/sys/stats の JSON。parseErrors は読めずに捨てたデータグラム(大きすぎて受けられなかったものを含む)の数。</summary>
        public string BuildStatsJson(int oversized, DateTime utcNow)
        {
            var errors = ParseErrors + oversized;
            return "{\"received\":" + Received.ToString(CultureInfo.InvariantCulture)
                + ",\"parseErrors\":" + errors.ToString(CultureInfo.InvariantCulture) + ",\"lastReceivedAt\":\""
                + utcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture) + "\"}";
        }
    }
}
