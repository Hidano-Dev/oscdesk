using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    /// <summary>受け口の UDP トランスポートを、ループバックの実ソケットで確かめる(D-095)。</summary>
    public sealed class OscUdpTransportTests
    {
        private static readonly bool IsWindows = Environment.OSVersion.Platform == PlatformID.Win32NT;

        private static OscDatagram WaitForDatagram(OscUdpTransport transport, int timeoutMilliseconds = 3000)
        {
            var watch = Stopwatch.StartNew();
            while (watch.ElapsedMilliseconds < timeoutMilliseconds)
            {
                if (transport.TryReceive(out var datagram))
                {
                    return datagram;
                }

                Thread.Sleep(10);
            }

            Assert.Fail("データグラムが " + timeoutMilliseconds + " ms 以内に届きませんでした。");
            return default;
        }

        private static Socket CreateSocket()
        {
            var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            socket.Bind(new IPEndPoint(IPAddress.Loopback, 0));
            return socket;
        }

        // 誰も待ち受けていないループバックのポート(Windows ではここへ送ると ICMP Port Unreachable が返る)
        private static IPEndPoint ClosedEndPoint()
        {
            using (var socket = CreateSocket())
            {
                return new IPEndPoint(IPAddress.Loopback, ((IPEndPoint)socket.LocalEndPoint).Port);
            }
        }

        private static IPEndPoint EndPointOf(OscUdpTransport transport)
        {
            return new IPEndPoint(IPAddress.Loopback, transport.LocalPort);
        }

        [Test]
        public void ReceivesDatagramsWithTheirSource()
        {
            using (var transport = new OscUdpTransport(0))
            using (var sender = CreateSocket())
            {
                var bytes = OscCodec.EncodeMessage("/sys/ping", new object[] { 1 });
                sender.SendTo(bytes, EndPointOf(transport));

                var datagram = WaitForDatagram(transport);

                Assert.That(datagram.Data, Is.EqualTo(bytes));
                Assert.That(datagram.Remote.Port, Is.EqualTo(((IPEndPoint)sender.LocalEndPoint).Port));
            }
        }

        [Test]
        public void SendsFromTheListeningPort()
        {
            using (var transport = new OscUdpTransport(0))
            using (var receiver = CreateSocket())
            {
                receiver.ReceiveTimeout = 3000;
                var bytes = OscCodec.EncodeMessage("/sys/pong", new object[] { 1 });
                transport.Send(bytes, (IPEndPoint)receiver.LocalEndPoint);

                var buffer = new byte[1024];
                EndPoint remote = new IPEndPoint(IPAddress.Any, 0);
                var count = receiver.ReceiveFrom(buffer, ref remote);

                Assert.That(count, Is.EqualTo(bytes.Length));
                // 送信元のポートが待ち受けのポートと一致するので、ブリッジは送信元を Unity の host + sendPort と突き合わせられる
                Assert.That(((IPEndPoint)remote).Port, Is.EqualTo(transport.LocalPort));
            }
        }

        [Test]
        public void DisablesConnectionResetOnWindows()
        {
            using (var transport = new OscUdpTransport(0))
            {
                if (IsWindows)
                {
                    Assert.That(transport.ConnectionResetDisabled, Is.True);
                }
                else
                {
                    Assert.Pass("SIO_UDP_CONNRESET は Windows だけの制御(ここでは " + Environment.OSVersion.Platform + ")");
                }
            }
        }

        // 回帰: 返信先(ブリッジ)が止まっていて ICMP Port Unreachable が返った後も、受信が止まらない
        [Test]
        public void KeepsReceivingAfterIcmpPortUnreachable()
        {
            var resets = AssertKeepsReceivingAfterUnreachable(disableConnectionReset: true);
            if (IsWindows)
            {
                Assert.That(resets, Is.Zero, "SIO_UDP_CONNRESET を切ったのに WSAECONNRESET が届いた");
            }
        }

        // SIO_UDP_CONNRESET を切れない実行環境の備え: 受信ループが WSAECONNRESET を読み流して受け続ける
        [Test]
        public void KeepsReceivingAfterIcmpEvenWithoutTheIoctl()
        {
            var resets = AssertKeepsReceivingAfterUnreachable(disableConnectionReset: false);
            if (IsWindows)
            {
                Assert.That(resets, Is.GreaterThan(0), "Windows では ICMP が WSAECONNRESET として届くはず(届かないならこのテストは回帰を検出できていない)");
            }
        }

        private static int AssertKeepsReceivingAfterUnreachable(bool disableConnectionReset)
        {
            using (var transport = new OscUdpTransport(0, disableConnectionReset))
            using (var sender = CreateSocket())
            {
                var unreachable = ClosedEndPoint();
                for (var i = 0; i < 3; i++)
                {
                    transport.Send(OscCodec.EncodeMessage("/sys/pong", new object[] { i }), unreachable);
                    Thread.Sleep(50); // ICMP が返り、受信ループがそれを読むまで待つ
                }

                for (var i = 0; i < 3; i++)
                {
                    var bytes = OscCodec.EncodeMessage("/sys/ping", new object[] { i });
                    sender.SendTo(bytes, EndPointOf(transport));
                    Assert.That(WaitForDatagram(transport).Data, Is.EqualTo(bytes), "ICMP の後の受信 #" + i);
                }

                Assert.That(transport.IsClosed, Is.False);
                return transport.ConnectionResets;
            }
        }

        [Test]
        public void DisposeStopsQuicklyAndFreesThePort()
        {
            int port;
            var watch = Stopwatch.StartNew();
            using (var transport = new OscUdpTransport(0))
            {
                port = transport.LocalPort;
            }

            Assert.That(watch.ElapsedMilliseconds, Is.LessThan(1500));

            // 同じポートでもう一度待ち受けられる(Play の停止・再開や有効化のやり直しでポートが残らない)
            using (var again = new OscUdpTransport(port))
            using (var sender = CreateSocket())
            {
                var bytes = OscCodec.EncodeMessage("/again", new object[0]);
                sender.SendTo(bytes, EndPointOf(again));
                Assert.That(WaitForDatagram(again).Data, Is.EqualTo(bytes));
            }
        }

        [Test]
        public void BindingAPortInUseThrows()
        {
            using (var first = new OscUdpTransport(0))
            {
                Assert.Throws<SocketException>(() => new OscUdpTransport(first.LocalPort).Dispose());
            }
        }

        [Test]
        public void DisposeIsIdempotentAndSendAfterDisposeThrows()
        {
            var transport = new OscUdpTransport(0);
            transport.Dispose();
            transport.Dispose();

            Assert.Throws<ObjectDisposedException>(() => transport.Send(new byte[4], ClosedEndPoint()));
        }

        [Test]
        public void KeepsArrivalOrder()
        {
            using (var transport = new OscUdpTransport(0))
            using (var sender = CreateSocket())
            {
                var sent = new List<byte[]>();
                for (var i = 0; i < 20; i++)
                {
                    var bytes = OscCodec.EncodeMessage("/seq", new object[] { i });
                    sent.Add(bytes);
                    sender.SendTo(bytes, EndPointOf(transport));
                }

                foreach (var bytes in sent)
                {
                    Assert.That(WaitForDatagram(transport).Data, Is.EqualTo(bytes));
                }
            }
        }
    }
}
