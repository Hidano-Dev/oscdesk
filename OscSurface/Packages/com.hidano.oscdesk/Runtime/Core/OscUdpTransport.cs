using System;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Threading;

namespace OscDesk.Receiver
{
    /// <summary>受信したデータグラム 1 個(受信スレッドで複製したバイト列と送信元)。</summary>
    public readonly struct OscDatagram
    {
        public byte[] Data { get; }
        public IPEndPoint Remote { get; }

        public OscDatagram(byte[] data, IPEndPoint remote)
        {
            Data = data;
            Remote = remote;
        }
    }

    /// <summary>
    /// 受け口の UDP トランスポート(D-095)。1 本のソケットで 0.0.0.0:port に待ち受け(ブロードキャストも届く)、
    /// 同じソケットから返信先へ送る。受信は専用スレッドの同期 ReceiveFrom で行い、ConcurrentQueue に積む。
    /// 取り出し(TryReceive)はメインスレッドの Update から呼ぶ想定で、UnityEngine には依存しない。
    /// </summary>
    public sealed class OscUdpTransport : IDisposable
    {
        /// <summary>UDP(IPv4)の 1 データグラムの最大のペイロード。</summary>
        public const int MaxDatagramBytes = 65507;

        /// <summary>取り出されないまま積める数。メインスレッドが長く止まっても(Editor の Pause 等)メモリを食い潰さない。</summary>
        public const int MaxQueuedDatagrams = 4096;

        // Windows の WSAIoctl SIO_UDP_CONNRESET(_WSAIOW(IOC_VENDOR, 12))
        private const int SioUdpConnReset = unchecked((int)0x9800000C);

        // Poll の待ち時間(マイクロ秒)。Close で ReceiveFrom が解けない実装でも、これだけ待てば停止の印に気づく
        private const int PollMicroseconds = 200 * 1000;

        private readonly Socket socket;
        private readonly Thread thread;
        private readonly ConcurrentQueue<OscDatagram> queue = new ConcurrentQueue<OscDatagram>();
        private volatile bool closed;
        private int queued;
        private int connectionResets;
        private int oversized;
        private int dropped;
        private int receiveErrors;

        /// <summary>port に待ち受ける(0 なら OS が空きポートを選ぶ)。bind に失敗したら SocketException を投げる。</summary>
        public OscUdpTransport(int port) : this(port, true)
        {
        }

        /// <summary>disableConnectionReset はテスト用(SIO_UDP_CONNRESET を切らずに、受信ループ側の備えだけを確かめる)。</summary>
        internal OscUdpTransport(int port, bool disableConnectionReset)
        {
            if (port < 0 || port > 65535)
            {
                throw new ArgumentOutOfRangeException(nameof(port), "ポートは 0〜65535 で指定します。");
            }

            socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            try
            {
                if (disableConnectionReset)
                {
                    ConnectionResetDisabled = TryDisableConnectionReset(socket);
                }

                // Mono の Unix 実装はソケットを作るたびに SO_REUSEADDR を付ける。UDP ではそのままだと同じポートに
                // 2 つ目の待ち受け(別の Unity や残った受け口)が黙って bind でき、どちらに届くか分からなくなるので外す
                try
                {
                    socket.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, false);
                }
                catch (SocketException)
                {
                }

                socket.Bind(new IPEndPoint(IPAddress.Any, port));
                LocalPort = ((IPEndPoint)socket.LocalEndPoint).Port;
            }
            catch
            {
                socket.Close();
                throw;
            }

            thread = new Thread(ReceiveLoop) { IsBackground = true, Name = "OscDesk.Receiver UDP" };
            thread.Start();
        }

        /// <summary>実際に待ち受けているポート。</summary>
        public int LocalPort { get; }

        /// <summary>SIO_UDP_CONNRESET を無効にできたか(Windows 以外や、対応しない実行環境では false)。</summary>
        public bool ConnectionResetDisabled { get; }

        /// <summary>ICMP Port Unreachable 由来の受信エラー(WSAECONNRESET)を読み流した回数。</summary>
        public int ConnectionResets => Volatile.Read(ref connectionResets);

        /// <summary>受信バッファに収まらず捨てたデータグラムの数。</summary>
        public int Oversized => Volatile.Read(ref oversized);

        /// <summary>キューが満杯で捨てたデータグラムの数。</summary>
        public int Dropped => Volatile.Read(ref dropped);

        /// <summary>それ以外の受信エラーの数(受信は続ける)。</summary>
        public int ReceiveErrors => Volatile.Read(ref receiveErrors);

        public bool IsClosed => closed;

        /// <summary>受信したデータグラムを 1 個取り出す。無ければ false。</summary>
        public bool TryReceive(out OscDatagram datagram)
        {
            if (queue.TryDequeue(out datagram))
            {
                Interlocked.Decrement(ref queued);
                return true;
            }

            return false;
        }

        /// <summary>待ち受けと同じソケットから送る。失敗は SocketException / ObjectDisposedException のまま投げる。</summary>
        public void Send(byte[] data, IPEndPoint destination)
        {
            if (data == null)
            {
                throw new ArgumentNullException(nameof(data));
            }

            if (destination == null)
            {
                throw new ArgumentNullException(nameof(destination));
            }

            socket.SendTo(data, destination);
        }

        /// <summary>ソケットを閉じて受信スレッドを止める。何度呼んでもよい。</summary>
        public void Dispose()
        {
            if (closed)
            {
                return;
            }

            closed = true;
            socket.Close(); // ブロック中の Poll / ReceiveFrom を解く
            if (thread != Thread.CurrentThread)
            {
                thread.Join(1000);
            }
        }

        /// <summary>
        /// Windows では、このソケットから送ったデータグラムに ICMP Port Unreachable が返ると(返信先のブリッジが止まっている等)、
        /// 次の ReceiveFrom が WSAECONNRESET(10054)で失敗する。受信を止めないよう、その通知自体を切る。
        /// Windows 以外には無い制御コードなので、失敗は握りつぶす(受信ループ側でも ConnectionReset を読み流す)。
        /// </summary>
        private static bool TryDisableConnectionReset(Socket target)
        {
            try
            {
                target.IOControl(SioUdpConnReset, new byte[] { 0, 0, 0, 0 }, null);
                return true;
            }
            catch (Exception exception) when (exception is SocketException || exception is NotSupportedException
                || exception is PlatformNotSupportedException || exception is InvalidOperationException)
            {
                return false;
            }
        }

        private void ReceiveLoop()
        {
            var buffer = new byte[MaxDatagramBytes + 1];
            while (!closed)
            {
                try
                {
                    if (!socket.Poll(PollMicroseconds, SelectMode.SelectRead))
                    {
                        continue;
                    }

                    EndPoint remote = new IPEndPoint(IPAddress.Any, 0);
                    var count = socket.ReceiveFrom(buffer, 0, buffer.Length, SocketFlags.None, ref remote);
                    if (count > MaxDatagramBytes)
                    {
                        Interlocked.Increment(ref oversized);
                        continue;
                    }

                    if (Volatile.Read(ref queued) >= MaxQueuedDatagrams)
                    {
                        Interlocked.Increment(ref dropped);
                        continue;
                    }

                    var data = new byte[count];
                    Buffer.BlockCopy(buffer, 0, data, 0, count);
                    queue.Enqueue(new OscDatagram(data, (IPEndPoint)remote));
                    Interlocked.Increment(ref queued);
                }
                catch (SocketException exception) when (!closed && exception.SocketErrorCode == SocketError.ConnectionReset)
                {
                    // SIO_UDP_CONNRESET を切れなかった環境の備え。通知を読み流せば次の受信は普通に届く
                    Interlocked.Increment(ref connectionResets);
                }
                catch (SocketException exception) when (!closed && exception.SocketErrorCode == SocketError.MessageSize)
                {
                    Interlocked.Increment(ref oversized);
                }
                catch (SocketException) when (!closed)
                {
                    // ネットワークの一時的な断など。受信は続けるが、同じ失敗で空回りしないよう少し待つ
                    Interlocked.Increment(ref receiveErrors);
                    Thread.Sleep(100);
                }
                catch (SocketException)
                {
                    break; // Dispose による中断
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
            }
        }
    }
}
