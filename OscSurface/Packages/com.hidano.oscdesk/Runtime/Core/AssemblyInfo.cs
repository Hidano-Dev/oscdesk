using System.Runtime.CompilerServices;

// EditMode テストから、テスト専用の口(OscUdpTransport の SIO_UDP_CONNRESET を切らない生成、JSON の読み取り)を使う
[assembly: InternalsVisibleTo("OscDesk.Receiver.Tests")]
