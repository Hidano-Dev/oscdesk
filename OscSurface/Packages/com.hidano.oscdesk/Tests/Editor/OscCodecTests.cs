using System;
using System.Collections.Generic;
using System.Text;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    public sealed class OscCodecTests
    {
        private static List<OscMessage> Decode(byte[] data)
        {
            var messages = new List<OscMessage>();
            Assert.That(OscCodec.TryDecode(data, 0, data.Length, messages, out var error), Is.True, error);
            return messages;
        }

        private static byte[] Message(string address, string tags, params byte[][] args)
        {
            var bytes = new List<byte>();
            bytes.AddRange(Str(address));
            bytes.AddRange(Str(tags));
            foreach (var arg in args)
            {
                bytes.AddRange(arg);
            }

            return bytes.ToArray();
        }

        private static byte[] Str(string text)
        {
            var raw = Encoding.UTF8.GetBytes(text);
            var padded = new byte[(raw.Length + 4) & ~3];
            Array.Copy(raw, padded, raw.Length);
            return padded;
        }

        private static byte[] Int(int value)
        {
            return new[] { (byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value };
        }

        [Test]
        public void EncodeThenDecodeKeepsEveryValueType()
        {
            var blob = new byte[] { 9, 8, 7 };
            var bytes = OscCodec.EncodeMessage("/demo/all", new object[] { 3, 0.5f, "メンバーA", blob, true, false });

            var messages = Decode(bytes);

            Assert.That(messages, Has.Count.EqualTo(1));
            Assert.That(messages[0].Address, Is.EqualTo("/demo/all"));
            // bool は i の 0/1 で送る(T / F タグは使わない)
            Assert.That(messages[0].Values, Is.EqualTo(new object[] { 3, 0.5f, "メンバーA", blob, 1, 0 }));
        }

        [Test]
        public void EncodedMessagesAreFourByteAligned()
        {
            foreach (var text in new[] { "", "a", "ab", "abc", "abcd" })
            {
                var bytes = OscCodec.EncodeMessage("/s", new object[] { text });
                Assert.That(bytes.Length % 4, Is.Zero, text);
                Assert.That(Decode(bytes)[0].Values, Is.EqualTo(new object[] { text }));
            }
        }

        [Test]
        public void EncodeRejectsUnsupportedValues()
        {
            Assert.Throws<ArgumentException>(() => OscCodec.EncodeMessage("/a", new object[] { 1.5 }));
            Assert.Throws<ArgumentException>(() => OscCodec.EncodeMessage("/a", new object[] { null }));
            Assert.Throws<ArgumentException>(() => OscCodec.EncodeMessage("/a", new object[] { "a\0b" }));
            Assert.Throws<ArgumentException>(() => OscCodec.EncodeMessage("a", new object[0]));
        }

        [Test]
        public void NestedBundlesExpandInOrder()
        {
            var inner = new List<byte>();
            inner.AddRange(Str("#bundle"));
            inner.AddRange(new byte[8]);
            var b = OscCodec.EncodeMessage("/b", new object[] { 2 });
            inner.AddRange(Int(b.Length));
            inner.AddRange(b);

            var outer = new List<byte>();
            outer.AddRange(Str("#bundle"));
            outer.AddRange(new byte[] { 0, 0, 0, 0, 0, 0, 0, 1 });
            foreach (var element in new[] { OscCodec.EncodeMessage("/a", new object[] { 1 }), inner.ToArray(), OscCodec.EncodeMessage("/c", new object[0]) })
            {
                outer.AddRange(Int(element.Length));
                outer.AddRange(element);
            }

            var messages = Decode(outer.ToArray());

            Assert.That(messages.ConvertAll(m => m.Address), Is.EqualTo(new[] { "/a", "/b", "/c" }));
            Assert.That(messages[1].Values, Is.EqualTo(new object[] { 2 }));
        }

        [Test]
        public void EmptyBundleHasNoMessages()
        {
            var bytes = new List<byte>(Str("#bundle"));
            bytes.AddRange(new byte[8]);

            Assert.That(Decode(bytes.ToArray()), Is.Empty);
        }

        [Test]
        public void TooDeepBundlesAreRejected()
        {
            var packet = OscCodec.EncodeMessage("/deep", new object[0]);
            for (var depth = 0; depth <= OscCodec.MaxBundleDepth; depth++)
            {
                var wrapped = new List<byte>(Str("#bundle"));
                wrapped.AddRange(new byte[8]);
                wrapped.AddRange(Int(packet.Length));
                wrapped.AddRange(packet);
                packet = wrapped.ToArray();
            }

            var messages = new List<OscMessage>();
            Assert.That(OscCodec.TryDecode(packet, 0, packet.Length, messages, out var error), Is.False);
            Assert.That(error, Does.Contain("bundle"));
        }

        private static byte[] BundleOf(int count)
        {
            var one = OscCodec.EncodeMessage("/t", new object[0]);
            var bundle = new List<byte>(Str("#bundle"));
            bundle.AddRange(new byte[8]);
            for (var i = 0; i < count; i++)
            {
                bundle.AddRange(Int(one.Length));
                bundle.AddRange(one);
            }

            return bundle.ToArray();
        }

        [Test]
        public void BundleAtTheMessageLimitIsAccepted()
        {
            Assert.That(Decode(BundleOf(OscCodec.MaxMessagesPerDatagram)), Has.Count.EqualTo(OscCodec.MaxMessagesPerDatagram));
        }

        [Test]
        public void BundleOverTheMessageLimitIsRejectedWholeAndLeavesTheListAlone()
        {
            var bytes = BundleOf(OscCodec.MaxMessagesPerDatagram + 1);
            var messages = new List<OscMessage> { new OscMessage("/keep", new object[0]) };

            Assert.That(OscCodec.TryDecode(bytes, 0, bytes.Length, messages, out var error), Is.False);
            Assert.That(error, Does.Contain("多すぎ"));
            Assert.That(messages.ConvertAll(m => m.Address), Is.EqualTo(new[] { "/keep" }));
        }

        [Test]
        public void FailedDecodeLeavesEarlierMessagesInTheListAlone()
        {
            var messages = new List<OscMessage> { new OscMessage("/kept", new object[0]) };
            var broken = Message("/x", ",i");

            Assert.That(OscCodec.TryDecode(broken, 0, broken.Length, messages, out _), Is.False);
            Assert.That(messages, Has.Count.EqualTo(1));
            Assert.That(messages[0].Address, Is.EqualTo("/kept"));
        }

        [Test]
        public void BlobSizeBeyondTheDatagramIsRejected()
        {
            var bytes = Message("/b", ",b", Int(100), new byte[4]);
            var messages = new List<OscMessage>();

            Assert.That(OscCodec.TryDecode(bytes, 0, bytes.Length, messages, out _), Is.False);
            Assert.That(messages, Is.Empty);
        }

        [Test]
        public void StringWithoutTerminatorIsRejected()
        {
            var bytes = Encoding.ASCII.GetBytes("/abc");
            var messages = new List<OscMessage>();

            Assert.That(OscCodec.TryDecode(bytes, 0, bytes.Length, messages, out _), Is.False);
        }

        [Test]
        public void DecodeHonoursOffsetAndCount()
        {
            var message = OscCodec.EncodeMessage("/sys/ping", new object[] { 7 });
            var framed = new byte[message.Length + 8];
            Array.Copy(message, 0, framed, 4, message.Length);
            var messages = new List<OscMessage>();

            Assert.That(OscCodec.TryDecode(framed, 4, message.Length, messages, out var error), Is.True, error);
            Assert.That(messages[0].Values, Is.EqualTo(new object[] { 7 }));
        }

        [Test]
        public void FloatBitsSurviveTheRoundTrip()
        {
            foreach (var value in new[] { 0f, -0f, 1e-38f, float.MaxValue, float.MinValue, float.PositiveInfinity, -1.25f })
            {
                var decoded = (float)Decode(OscCodec.EncodeMessage("/f", new object[] { value }))[0].Values[0];
                Assert.That(BitConverter.GetBytes(decoded), Is.EqualTo(BitConverter.GetBytes(value)), value.ToString("R"));
            }
        }
    }
}
