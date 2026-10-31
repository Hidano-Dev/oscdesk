using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace OscDesk.Receiver
{
    /// <summary>受信した OSC メッセージ 1 件。bundle は展開済みで、ここに来るのは中のメッセージだけ。</summary>
    public sealed class OscMessage
    {
        public string Address { get; }

        /// <summary>引数。i → int、f → float、s → string、b → byte[]、T / F → bool。それ以外の型タグの引数は含まない。</summary>
        public object[] Values { get; }

        public OscMessage(string address, object[] values)
        {
            Address = address ?? string.Empty;
            Values = values ?? Array.Empty<object>();
        }
    }

    /// <summary>
    /// 受け口が使う範囲だけの OSC 1.0 のエンコード・デコード(D-095)。特定の OSC ライブラリに依存しない。
    /// バイト列の見本は protocol/osc-binary-samples.json で、TS の osc-codec と同じ見本に縛る。
    /// </summary>
    public static class OscCodec
    {
        /// <summary>入れ子の bundle の深さの上限。悪意や壊れたデータで再帰が深くなりすぎないようにする。</summary>
        public const int MaxBundleDepth = 16;

        private const string BundleTag = "#bundle";
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly object[] NoValues = new object[0];

        /// <summary>
        /// 1 データグラムをデコードし、bundle を展開した中のメッセージを順に messages へ足す(timetag は読み捨てる)。
        /// 壊れたデータグラムは途中まで読めた分も含めて丸ごと捨て(messages を呼び出し前に戻す)、false と理由を返す。
        /// bundle の一部だけを処理すると、まとめ送りの一部だけが反映された半端な状態になるため。
        /// 大きさの分からない型タグ(配列 [ ] や未知のタグ)は以降の引数の位置を推測できないので、データグラムごと捨てる。
        /// 大きさの決まった未対応の型タグ(h d t c r m N I S)は引数を読み飛ばして含めない(UNITY_PROTOCOL §2)。
        /// </summary>
        public static bool TryDecode(byte[] data, int offset, int count, List<OscMessage> messages, out string error)
        {
            if (messages == null)
            {
                throw new ArgumentNullException(nameof(messages));
            }

            error = null;
            if (data == null || offset < 0 || count < 0 || offset + count > data.Length)
            {
                error = "データの範囲が不正です。";
                return false;
            }

            var start = messages.Count;
            try
            {
                if (count == 0 || count % 4 != 0)
                {
                    throw new FormatException("データグラムの大きさが 4 の倍数ではありません(" + count + " バイト)。");
                }

                ReadPacket(data, offset, offset + count, messages, 0);
                return true;
            }
            catch (FormatException exception)
            {
                messages.RemoveRange(start, messages.Count - start);
                error = exception.Message;
                return false;
            }
        }

        /// <summary>
        /// メッセージ 1 件をエンコードする。引数は int → i、float → f、string → s(UTF-8)、byte[] → b、bool → i の 0/1
        /// (T / F タグは使わない。UNITY_PROTOCOL §2「型」)。それ以外の型と、NUL を含む文字列は ArgumentException。
        /// </summary>
        public static byte[] EncodeMessage(string address, IReadOnlyList<object> args)
        {
            if (string.IsNullOrEmpty(address) || address[0] != '/')
            {
                throw new ArgumentException("アドレスは / で始まる必要があります: \"" + address + "\"", nameof(address));
            }

            var values = args ?? NoValues;
            var tags = new StringBuilder(values.Count + 1);
            tags.Append(',');
            foreach (var value in values)
            {
                tags.Append(TagOf(value));
            }

            var buffer = new List<byte>(64);
            WriteString(buffer, address);
            WriteString(buffer, tags.ToString());
            foreach (var value in values)
            {
                switch (value)
                {
                    case int i: WriteInt(buffer, i); break;
                    case bool b: WriteInt(buffer, b ? 1 : 0); break;
                    case float f: WriteInt(buffer, new FloatBits { Float = f }.Int); break;
                    case string s: WriteString(buffer, s); break;
                    case byte[] blob:
                        WriteInt(buffer, blob.Length);
                        buffer.AddRange(blob);
                        Pad(buffer);
                        break;
                }
            }

            return buffer.ToArray();
        }

        private static char TagOf(object value)
        {
            switch (value)
            {
                case int _:
                case bool _:
                    return 'i';
                case float _: return 'f';
                case string _: return 's';
                case byte[] _: return 'b';
                case null: throw new ArgumentException("null の引数は送れません。");
                default: throw new ArgumentException("送れない引数の型です: " + value.GetType().Name);
            }
        }

        private static void ReadPacket(byte[] data, int position, int end, List<OscMessage> messages, int depth)
        {
            if (position >= end)
            {
                throw new FormatException("空のパケットです。");
            }

            if (data[position] == (byte)'#')
            {
                ReadBundle(data, position, end, messages, depth);
                return;
            }

            messages.Add(ReadMessage(data, position, end));
        }

        private static void ReadBundle(byte[] data, int position, int end, List<OscMessage> messages, int depth)
        {
            if (depth >= MaxBundleDepth)
            {
                throw new FormatException("bundle の入れ子が深すぎます(上限 " + MaxBundleDepth + ")。");
            }

            if (ReadString(data, ref position, end) != BundleTag)
            {
                throw new FormatException("# で始まるが bundle ではありません。");
            }

            Require(data, position, 8, end, "timetag");
            position += 8; // timetag は読み捨てる(遅延実行は要求しない。UNITY_PROTOCOL 互換性ノート)

            while (position < end)
            {
                var size = ReadInt(data, ref position, end);
                if (size <= 0 || size % 4 != 0 || size > end - position)
                {
                    throw new FormatException("bundle の要素の大きさが不正です(" + size + " バイト)。");
                }

                ReadPacket(data, position, position + size, messages, depth + 1);
                position += size;
            }
        }

        private static OscMessage ReadMessage(byte[] data, int position, int end)
        {
            var address = ReadString(data, ref position, end);
            if (address.Length == 0 || address[0] != '/')
            {
                throw new FormatException("アドレスが / で始まりません: \"" + address + "\"");
            }

            if (position == end)
            {
                return new OscMessage(address, NoValues); // 型タグ文字列を省いた古い形式。引数なしとして扱う
            }

            var tags = ReadString(data, ref position, end);
            if (tags.Length == 0 || tags[0] != ',')
            {
                throw new FormatException("型タグ文字列が , で始まりません(" + address + ")。");
            }

            var values = new List<object>(tags.Length - 1);
            for (var n = 1; n < tags.Length; n++)
            {
                var tag = tags[n];
                switch (tag)
                {
                    case 'i': values.Add(ReadInt(data, ref position, end)); break;
                    case 'f': values.Add(new FloatBits { Int = ReadInt(data, ref position, end) }.Float); break;
                    case 's': values.Add(ReadString(data, ref position, end)); break;
                    case 'b': values.Add(ReadBlob(data, ref position, end)); break;
                    case 'T': values.Add(true); break;
                    case 'F': values.Add(false); break;

                    // 大きさの決まった未対応の型は読み飛ばし、値は含めない
                    case 'N':
                    case 'I':
                        break;
                    case 'c':
                    case 'r':
                    case 'm':
                        Skip(data, ref position, 4, end, tag);
                        break;
                    case 'h':
                    case 'd':
                    case 't':
                        Skip(data, ref position, 8, end, tag);
                        break;
                    case 'S':
                        ReadString(data, ref position, end);
                        break;

                    default:
                        throw new FormatException("未対応の型タグ '" + tag + "' です(" + address + ")。以降の引数の位置が分からないので捨てます。");
                }
            }

            if (position != end)
            {
                throw new FormatException("型タグと引数の大きさが合いません(" + address + "、余り " + (end - position) + " バイト)。");
            }

            return new OscMessage(address, values.Count == 0 ? NoValues : values.ToArray());
        }

        private static string ReadString(byte[] data, ref int position, int end)
        {
            var terminator = Array.IndexOf(data, (byte)0, position, end - position);
            if (terminator < 0)
            {
                throw new FormatException("文字列が NUL で終わっていません。");
            }

            string text;
            try
            {
                text = Utf8.GetString(data, position, terminator - position);
            }
            catch (ArgumentException)
            {
                throw new FormatException("文字列が UTF-8 として読めません。");
            }

            var next = position + PaddedSize(terminator - position + 1);
            if (next > end)
            {
                throw new FormatException("文字列の詰め物が途中で切れています。");
            }

            position = next;
            return text;
        }

        private static int ReadInt(byte[] data, ref int position, int end)
        {
            Require(data, position, 4, end, "int32");
            var value = (data[position] << 24) | (data[position + 1] << 16) | (data[position + 2] << 8) | data[position + 3];
            position += 4;
            return value;
        }

        private static byte[] ReadBlob(byte[] data, ref int position, int end)
        {
            var size = ReadInt(data, ref position, end);
            // 詰め物を足す前に大きさを比べる。0x7FFFFFFD 以上を PaddedSize に通すと負に回り、検査をすり抜けて巨大な確保になる
            if (size < 0 || size > end - position || PaddedSize(size) > end - position)
            {
                throw new FormatException("blob の大きさが不正です(" + size + " バイト)。");
            }

            var blob = new byte[size];
            Buffer.BlockCopy(data, position, blob, 0, size);
            position += PaddedSize(size);
            return blob;
        }

        private static void Skip(byte[] data, ref int position, int size, int end, char tag)
        {
            Require(data, position, size, end, "'" + tag + "'");
            position += size;
        }

        private static void Require(byte[] data, int position, int size, int end, string what)
        {
            if (size > end - position)
            {
                throw new FormatException(what + " の途中でデータが終わっています。");
            }
        }

        private static int PaddedSize(int size)
        {
            return (size + 3) & ~3;
        }

        private static void WriteString(List<byte> buffer, string text)
        {
            if (text.IndexOf('\0') >= 0)
            {
                throw new ArgumentException("NUL を含む文字列は OSC で送れません。");
            }

            buffer.AddRange(Utf8.GetBytes(text));
            buffer.Add(0);
            Pad(buffer);
        }

        private static void WriteInt(List<byte> buffer, int value)
        {
            buffer.Add((byte)(value >> 24));
            buffer.Add((byte)(value >> 16));
            buffer.Add((byte)(value >> 8));
            buffer.Add((byte)value);
        }

        private static void Pad(List<byte> buffer)
        {
            while (buffer.Count % 4 != 0)
            {
                buffer.Add(0);
            }
        }

        // float と int32 のビット列を確保もエンディアン判定もせずに読み替える(BitConverter.SingleToInt32Bits が無い API 互換レベルでも動く)
        [StructLayout(LayoutKind.Explicit)]
        private struct FloatBits
        {
            [FieldOffset(0)] public float Float;
            [FieldOffset(0)] public int Int;
        }
    }
}
