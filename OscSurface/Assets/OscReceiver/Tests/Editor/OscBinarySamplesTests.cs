using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    /// <summary>
    /// protocol/osc-binary-samples.json(TS の osc-codec も読む言語間の契約、D-095)を受け口のコーデックで確かめる。
    /// ブリッジが送るバイト列をそのまま読めること、受け口が返すバイト列がブリッジの期待と同じであることを、同じ見本で縛る。
    /// </summary>
    public sealed class OscBinarySamplesTests
    {
        private static Dictionary<string, object> samples;

        [OneTimeSetUp]
        public void LoadSamples()
        {
            var path = FindSamples();
            Assert.That(path, Is.Not.Null, "protocol/osc-binary-samples.json が見つかりません(リポジトリの外で開いた Unity プロジェクト?)");
            samples = (Dictionary<string, object>)OscDefinitionReader.ReadJson(File.ReadAllText(path));
        }

        // Unity の作業ディレクトリ(プロジェクトのフォルダ)から上へ辿る。UPM パッケージへ移しても変わらない
        private static string FindSamples()
        {
            var directory = new DirectoryInfo(Directory.GetCurrentDirectory());
            while (directory != null)
            {
                var candidate = Path.Combine(directory.FullName, "protocol", "osc-binary-samples.json");
                if (File.Exists(candidate))
                {
                    return candidate;
                }

                directory = directory.Parent;
            }

            return null;
        }

        private static List<object> Section(string name)
        {
            return (List<object>)samples[name];
        }

        [Test]
        public void MessagesDecodeToTheSamplePacket()
        {
            foreach (Dictionary<string, object> sample in Section("messages"))
            {
                var messages = DecodeHex((string)sample["hex"], (string)sample["name"]);
                Assert.That(messages, Has.Count.EqualTo(1), (string)sample["name"]);
                AssertMessage(messages[0], (Dictionary<string, object>)sample["packet"], (string)sample["name"]);
            }
        }

        [Test]
        public void MessagesEncodeToTheSampleBytes()
        {
            foreach (Dictionary<string, object> sample in Section("messages"))
            {
                var packet = (Dictionary<string, object>)sample["packet"];
                var args = new List<object>();
                foreach (Dictionary<string, object> arg in (List<object>)packet["args"])
                {
                    args.Add(ToValue(arg));
                }

                var bytes = OscCodec.EncodeMessage((string)packet["address"], args);
                Assert.That(ToHex(bytes), Is.EqualTo((string)sample["hex"]), (string)sample["name"]);
            }
        }

        [Test]
        public void BundlesExpandToTheirMessagesInOrder()
        {
            foreach (Dictionary<string, object> sample in Section("bundles"))
            {
                var name = (string)sample["name"];
                var expected = new List<Dictionary<string, object>>();
                Flatten((Dictionary<string, object>)sample["packet"], expected);

                var messages = DecodeHex((string)sample["hex"], name);

                Assert.That(messages, Has.Count.EqualTo(expected.Count), name);
                for (var i = 0; i < expected.Count; i++)
                {
                    AssertMessage(messages[i], expected[i], name + " #" + i);
                }
            }
        }

        [Test]
        public void ReceiverOnlyCasesDecodeOrReject()
        {
            foreach (Dictionary<string, object> sample in Section("receiverDecode"))
            {
                var name = (string)sample["name"];
                var bytes = FromHex((string)sample["hex"]);
                var messages = new List<OscMessage>();
                var ok = OscCodec.TryDecode(bytes, 0, bytes.Length, messages, out var error);

                if (sample.TryGetValue("error", out var isError) && isError is bool rejected && rejected)
                {
                    Assert.That(ok, Is.False, name);
                    Assert.That(messages, Is.Empty, name);
                    Assert.That(error, Is.Not.Empty, name);
                    continue;
                }

                Assert.That(ok, Is.True, name + ": " + error);
                var expected = (List<object>)sample["messages"];
                Assert.That(messages, Has.Count.EqualTo(expected.Count), name);
                for (var i = 0; i < expected.Count; i++)
                {
                    AssertMessage(messages[i], (Dictionary<string, object>)expected[i], name);
                }
            }
        }

        private static void Flatten(Dictionary<string, object> packet, List<Dictionary<string, object>> output)
        {
            if (!packet.ContainsKey("packets"))
            {
                output.Add(packet);
                return;
            }

            foreach (Dictionary<string, object> child in (List<object>)packet["packets"])
            {
                Flatten(child, output);
            }
        }

        private static List<OscMessage> DecodeHex(string hex, string name)
        {
            var bytes = FromHex(hex);
            var messages = new List<OscMessage>();
            Assert.That(OscCodec.TryDecode(bytes, 0, bytes.Length, messages, out var error), Is.True, name + ": " + error);
            return messages;
        }

        private static void AssertMessage(OscMessage actual, Dictionary<string, object> expected, string name)
        {
            Assert.That(actual.Address, Is.EqualTo((string)expected["address"]), name);
            var args = (List<object>)expected["args"];
            Assert.That(actual.Values, Has.Length.EqualTo(args.Count), name);
            for (var i = 0; i < args.Count; i++)
            {
                var value = ToValue((Dictionary<string, object>)args[i]);
                Assert.That(actual.Values[i], Is.TypeOf(value.GetType()), name + " arg " + i);
                Assert.That(actual.Values[i], Is.EqualTo(value), name + " arg " + i);
            }
        }

        private static object ToValue(Dictionary<string, object> arg)
        {
            var value = arg["value"];
            switch ((string)arg["type"])
            {
                case "i": return checked((int)(double)value);
                case "f": return (float)(double)value;
                case "s": return (string)value;
                case "b": return FromHex((string)value);
                case "bool": return (bool)value;
                default: throw new FormatException("見本の型が不明です: " + arg["type"]);
            }
        }

        private static byte[] FromHex(string hex)
        {
            var bytes = new byte[hex.Length / 2];
            for (var i = 0; i < bytes.Length; i++)
            {
                bytes[i] = byte.Parse(hex.Substring(i * 2, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
            }

            return bytes;
        }

        private static string ToHex(byte[] bytes)
        {
            return BitConverter.ToString(bytes).Replace("-", string.Empty).ToLowerInvariant();
        }
    }
}
