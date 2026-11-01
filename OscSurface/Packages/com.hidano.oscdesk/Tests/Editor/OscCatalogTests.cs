using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace OscDesk.Receiver.Tests
{
    // 設計図の送信(Catalog、D-114)。要約値は protocol/catalog-samples.json(TS の shared も読む見本)で縛る
    public sealed class OscCatalogTests
    {
        // パッケージに同梱した写し。写しが protocol/ の原本と同じことは tests/guards/unity-package.test.ts が縛る
        private const string SamplesAssetPath = "Packages/com.hidano.oscdesk/Tests/Editor/catalog-samples.json";

        private static Dictionary<string, object> LoadSamples()
        {
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(SamplesAssetPath);
            Assert.That(asset, Is.Not.Null, SamplesAssetPath + " が読めません");
            return (Dictionary<string, object>)OscDefinitionReader.ReadJson(asset.text);
        }

        private static OscCatalogItem ToItem(Dictionary<string, object> json)
        {
            var props = new List<OscCatalogProp>();
            foreach (Dictionary<string, object> prop in (List<object>)json["props"])
            {
                var arg = (Dictionary<string, object>)prop["arg"];
                var type = (string)arg["type"];
                object value = type == "i" ? (object)(int)(double)arg["value"]
                    : type == "f" ? (object)(float)(double)arg["value"]
                    : (string)arg["value"];
                props.Add(new OscCatalogProp((string)prop["key"], value));
            }

            return new OscCatalogItem((string)json["address"], (string)json["kind"], (string)json["type"], props);
        }

        private static List<OscMessage> Decode(List<byte[]> datagrams)
        {
            var messages = new List<OscMessage>();
            foreach (var datagram in datagrams)
            {
                Assert.That(datagram.Length, Is.LessThanOrEqualTo(OscCatalog.MaxDatagramBytes));
                Assert.That(OscCodec.TryDecode(datagram, 0, datagram.Length, messages, out var error), Is.True, error);
            }

            return messages;
        }

        private static List<string> Addresses(List<OscMessage> messages)
        {
            return messages.ConvertAll(m => m.Address == OscCatalog.AddAddress || m.Address == OscCatalog.RemoveAddress
                ? m.Address + " " + m.Values[0]
                : m.Address);
        }

        private static OscRegistryEntry Entry(OscOperation operation, string address, object owner = null)
        {
            return new OscRegistryEntry(address, operation, owner);
        }

        private static OscOperation Op(OscBindingKind kind)
        {
            return new OscOperation("op", kind, _ => null);
        }

        [Test]
        public void Crc32_matches_the_shared_samples()
        {
            foreach (Dictionary<string, object> sample in (List<object>)LoadSamples()["crc32"])
            {
                Assert.That(OscCatalogDigest.Crc32((string)sample["text"]), Is.EqualTo((int)(double)sample["crc"]), (string)sample["text"]);
            }
        }

        [Test]
        public void Canonical_text_count_and_crc_match_the_shared_samples()
        {
            foreach (Dictionary<string, object> sample in (List<object>)LoadSamples()["catalogs"])
            {
                var name = (string)sample["name"];
                var items = new List<OscCatalogItem>();
                foreach (Dictionary<string, object> item in (List<object>)sample["items"])
                {
                    items.Add(ToItem(item));
                }

                Assert.That(OscCatalogDigest.Canonical(items), Is.EqualTo((string)sample["canonical"]), name);
                OscCatalogDigest.Compute(items, out var count, out var crc);
                Assert.That(count, Is.EqualTo((int)(double)sample["count"]), name);
                Assert.That(crc, Is.EqualTo((int)(double)sample["crc"]), name);
            }
        }

        [Test]
        public void Items_carry_kind_type_constraints_and_hints()
        {
            var catalog = new OscCatalog(new OscRegistry());

            var level = catalog.CreateItem(Entry(Op(OscBindingKind.Float).WithRange(0f, 1f).WithStep(0.1f).WithWidget("slider").WithLabel("Level"), "/fx/a/level"));
            Assert.That(level.Kind, Is.EqualTo("state"));
            Assert.That(level.Type, Is.EqualTo("f"));
            Assert.That(OscCatalogDigest.Canonical(new[] { level }),
                Is.EqualTo("/fx/a/level\tstate\tf\tlabel=s:Level\tmax=f:3f800000\tmin=f:00000000\tstep=f:3dcccccd\twidget=s:slider\n"));

            var count = catalog.CreateItem(Entry(Op(OscBindingKind.Int).WithRange(0f, 10f), "/fx/a/count"));
            Assert.That(count.Props[0].Value, Is.EqualTo(0)); // Int の範囲は i で送る
            Assert.That(count.Type, Is.EqualTo("i"));

            var mode = catalog.CreateItem(Entry(Op(OscBindingKind.String).WithOptions("a", "b"), "/fx/a/mode"));
            Assert.That(OscCatalogDigest.Canonical(new[] { mode }), Is.EqualTo("/fx/a/mode\tstate\ts\toptions=s:a\toptions=s:b\n"));

            var stop = catalog.CreateItem(Entry(Op(OscBindingKind.Trigger), "/fx/a/stop"));
            Assert.That(stop.Kind, Is.EqualTo("trigger"));
            Assert.That(stop.Type, Is.EqualTo("trigger"));

            // 生成担当の命令は kind trigger・type s(保持値として再送させない)
            var spawn = catalog.CreateItem(Entry(Op(OscBindingKind.String).AsCommand(), "/fx/spawner/spawn"));
            Assert.That(spawn.Kind, Is.EqualTo("trigger"));
            Assert.That(spawn.Type, Is.EqualTo("s"));

            // 設計図に載せられないアドレス(対応表の A2 の行など)は載せない
            Assert.That(catalog.CreateItem(Entry(new OscOperation("x", (a, f) => { }), "odd name")), Is.Null);
        }

        [Test]
        public void Changes_in_one_frame_become_one_datagram_of_adds_removes_and_a_digest()
        {
            var registry = new OscRegistry();
            var catalog = new OscCatalog(registry);
            catalog.Attach();
            var a = Entry(Op(OscBindingKind.Trigger), "/fx/a/stop");
            var b = Entry(Op(OscBindingKind.Trigger), "/fx/b/stop");
            var c = Entry(Op(OscBindingKind.Trigger), "/fx/c/stop");
            registry.Register(a);
            registry.Register(b);
            registry.Register(c);
            registry.Unregister(c); // 送る前に消えたものは add も remove も送らない

            var datagrams = catalog.BuildDiff();
            Assert.That(datagrams.Count, Is.EqualTo(1));
            var messages = Decode(datagrams);
            Assert.That(Addresses(messages), Is.EqualTo(new[] { "/sys/catalog/add /fx/a/stop", "/sys/catalog/add /fx/b/stop", "/sys/catalog/digest" }));
            OscCatalogDigest.Compute(catalog.CurrentItems(), out var count, out var crc);
            Assert.That(messages[2].Values, Is.EqualTo(new object[] { count, crc }));
            Assert.That(catalog.HasChanges, Is.False);
            Assert.That(catalog.BuildDiff(), Is.Empty);

            registry.Unregister(a);
            messages = Decode(catalog.BuildDiff());
            Assert.That(Addresses(messages), Is.EqualTo(new[] { "/sys/catalog/remove /fx/a/stop", "/sys/catalog/digest" }));
            Assert.That(messages[1].Values[0], Is.EqualTo(1));

            // 同じ内容で登録し直しただけなら送らない
            registry.Unregister(b);
            registry.Register(Entry(Op(OscBindingKind.Trigger), "/fx/b/stop"));
            Assert.That(catalog.BuildDiff(), Is.Empty);

            catalog.Detach();
            registry.Register(Entry(Op(OscBindingKind.Trigger), "/fx/d/stop"));
            Assert.That(catalog.HasChanges, Is.False);
        }

        [Test]
        public void Full_sync_sends_begin_items_and_end_with_count_and_crc()
        {
            var registry = new OscRegistry();
            registry.Register(Entry(Op(OscBindingKind.Float).WithRange(0f, 1f), "/fx/a/level"));
            registry.Register(Entry(Op(OscBindingKind.Trigger), "/fx/a/stop"));
            var catalog = new OscCatalog(registry);
            catalog.Attach();
            registry.Register(Entry(Op(OscBindingKind.Trigger), "/fx/b/stop"));

            var messages = Decode(catalog.BuildFullSync("Stage PC"));
            Assert.That(Addresses(messages), Is.EqualTo(new[]
            {
                "/sys/catalog/begin", "/sys/catalog/add /fx/a/level", "/sys/catalog/add /fx/a/stop", "/sys/catalog/add /fx/b/stop", "/sys/catalog/end"
            }));
            Assert.That(messages[0].Values, Is.EqualTo(new object[] { "Stage PC", 3 }));
            OscCatalogDigest.Compute(catalog.CurrentItems(), out var count, out var crc);
            Assert.That(messages[4].Values, Is.EqualTo(new object[] { count, crc }));
            Assert.That(catalog.HasChanges, Is.False); // 全体に含めたので、溜めた変化は送らない

            // add の引数(アドレス, kind, type, キー, 値…)を受け側と同じに読み直すと、同じ要約値になる
            var items = new List<OscCatalogItem>();
            foreach (var message in messages)
            {
                if (message.Address != OscCatalog.AddAddress)
                {
                    continue;
                }

                var props = new List<OscCatalogProp>();
                for (var i = 3; i + 1 < message.Values.Length; i += 2)
                {
                    props.Add(new OscCatalogProp((string)message.Values[i], message.Values[i + 1]));
                }

                items.Add(new OscCatalogItem((string)message.Values[0], (string)message.Values[1], (string)message.Values[2], props));
            }

            OscCatalogDigest.Compute(items, out _, out var received);
            Assert.That(received, Is.EqualTo(crc));
        }

        [Test]
        public void Large_catalogs_are_split_into_datagrams_under_the_limit()
        {
            var registry = new OscRegistry();
            var label = new string('x', 1000);
            for (var i = 0; i < 300; i++)
            {
                registry.Register(Entry(Op(OscBindingKind.Trigger).WithLabel(label), "/fx/t" + i.ToString("000") + "/stop"));
            }

            var catalog = new OscCatalog(registry);
            var datagrams = catalog.BuildFullSync("pc");
            Assert.That(datagrams.Count, Is.GreaterThan(1));
            var messages = Decode(datagrams);
            Assert.That(messages[0].Address, Is.EqualTo(OscCatalog.BeginAddress));
            Assert.That(messages[messages.Count - 1].Address, Is.EqualTo(OscCatalog.EndAddress));
            Assert.That(messages.FindAll(m => m.Address == OscCatalog.AddAddress).Count, Is.EqualTo(300));

            // 境界: ちょうど上限に収まる大きさの並びは 1 つ、1 バイトでも超えれば 2 つに分ける
            var unit = OscCodec.EncodeMessage("/a", new object[] { new string('y', 100) });
            var per = OscCodec.BundleElementOverheadBytes + unit.Length;
            var fit = (OscCatalog.MaxDatagramBytes - OscCodec.BundleHeaderBytes) / per;
            var list = new List<byte[]>();
            for (var i = 0; i < fit; i++)
            {
                list.Add(unit);
            }

            Assert.That(OscCatalog.Pack(list).Count, Is.EqualTo(1));
            list.Add(unit);
            Assert.That(OscCatalog.Pack(list).Count, Is.EqualTo(2));
        }

        [Test]
        public void Rejected_duplicates_are_listed_on_the_registered_item()
        {
            var registry = new OscRegistry();
            var catalog = new OscCatalog(registry, owner => (string)owner);
            catalog.Attach();
            registry.Register(Entry(Op(OscBindingKind.Trigger), "/fx/a/stop", "first"));
            catalog.BuildDiff();

            var second = Entry(Op(OscBindingKind.Trigger), "/fx/a/stop", "second");
            Assert.That(registry.Register(second), Is.EqualTo(OscRegistrationResult.Duplicate));
            var messages = Decode(catalog.BuildDiff());
            Assert.That(messages[0].Values, Is.EqualTo(new object[] { "/fx/a/stop", "trigger", "trigger", OscCatalog.DuplicateKey, "second" }));

            registry.Unregister(second); // 受け付けなかった方が無効になったら、重複の印も外す
            Assert.That(registry.RejectedFor("/fx/a/stop"), Is.Empty);
            messages = Decode(catalog.BuildDiff());
            Assert.That(messages[0].Values, Is.EqualTo(new object[] { "/fx/a/stop", "trigger", "trigger" }));
        }

        [Test]
        public void Items_beyond_the_receiver_limit_are_left_out_consistently()
        {
            // 受け側は 1 PC 4096 項目まで。超える分を送ると件数と要約値が二度と合わないので、送る側も先頭から 4096 件にする
            var registry = new OscRegistry();
            var entries = new List<OscRegistryEntry>();
            for (var i = 0; i < OscCatalog.MaxItems + 3; i++)
            {
                var entry = Entry(Op(OscBindingKind.Trigger), "/fx/t" + i.ToString("0000") + "/stop");
                entries.Add(entry);
                registry.Register(entry);
            }

            var catalog = new OscCatalog(registry);
            catalog.Attach();
            var messages = Decode(catalog.BuildFullSync("pc"));
            Assert.That(messages[0].Values[1], Is.EqualTo(OscCatalog.MaxItems));
            Assert.That(messages.FindAll(m => m.Address == OscCatalog.AddAddress).Count, Is.EqualTo(OscCatalog.MaxItems));
            Assert.That(catalog.Omitted, Is.EqualTo(3));

            // 先頭の登録が消えると、載せていなかった登録が繰り上がって載る
            registry.Unregister(entries[0]);
            messages = Decode(catalog.BuildDiff());
            Assert.That(Addresses(messages), Is.EqualTo(new[]
            {
                "/sys/catalog/remove /fx/t0000/stop", "/sys/catalog/add /fx/t4096/stop", "/sys/catalog/digest"
            }));
            Assert.That(messages[2].Values[0], Is.EqualTo(OscCatalog.MaxItems));
        }

        [Test]
        public void Empty_options_are_kept_and_int_ranges_stay_in_int32()
        {
            var catalog = new OscCatalog(new OscRegistry());
            var mode = catalog.CreateItem(Entry(Op(OscBindingKind.String).WithOptions("", "auto").WithLabel(""), "/fx/a/mode"));
            Assert.That(OscCatalogDigest.Canonical(new[] { mode }), Is.EqualTo("/fx/a/mode\tstate\ts\toptions=s:\toptions=s:auto\n"));

            // float の int.MaxValue は 2147483648 に丸まるので、int にせず f で送る(負の上限にしない)
            var count = catalog.CreateItem(Entry(Op(OscBindingKind.Int).WithRange(0f, int.MaxValue), "/fx/a/count"));
            Assert.That(count.Props[0].Value, Is.EqualTo(0));
            Assert.That(count.Props[1].Value, Is.TypeOf<float>());
            Assert.That((float)count.Props[1].Value, Is.GreaterThan(0f));
        }

        [Test]
        public void Size_estimate_counts_json_escapes()
        {
            // 制御文字は JSON で \u0001 の 6 バイトになる。UTF-8 の 2 倍では少なく見積もり、受け側で項目ごと捨てられていた
            var control = new string('\u0001', 1024);
            var catalog = new OscCatalog(new OscRegistry());
            var item = catalog.CreateItem(Entry(Op(OscBindingKind.String).WithOptions(control, control), "/fx/a/mode"));
            Assert.That(OscCatalog.JsonStringBytes(control), Is.EqualTo(2 + 6 * 1024));
            Assert.That(OscCatalog.EstimateBytes(item), Is.LessThanOrEqualTo(OscCatalog.MaxItemBytes));
            Assert.That(item.Props.Count, Is.EqualTo(1)); // 2 つ目の選択肢を削って 8 KiB に収める
            Assert.That(OscCatalog.JsonStringBytes("a\"\\é日"), Is.EqualTo(2 + 1 + 2 + 2 + 2 + 3));
        }

        [Test]
        public void Strings_are_clipped_and_unsendable_text_is_dropped()
        {
            var catalog = new OscCatalog(new OscRegistry());
            var item = catalog.CreateItem(Entry(Op(OscBindingKind.String).WithLabel(new string('z', 2000)).WithOptions("ok", "bad\uD800"), "/fx/a/mode"));
            Assert.That(((string)item.Props[0].Value).Length, Is.EqualTo(OscCatalog.MaxStringChars));
            Assert.That(item.Props.Count, Is.EqualTo(2)); // label と options=ok(単独のサロゲートは送れないので落とす)
            Assert.DoesNotThrow(() => OscCodec.EncodeMessage(OscCatalog.AddAddress, item.ToAddArgs()));
        }

        [Test]
        public void Diff_sends_removes_before_adds()
        {
            // 受け側が 4096 件を持っているときに入れ替わる項目は、remove を先に送らないと add が捨てられる(PR #107 の指摘)
            var registry = new OscRegistry();
            var entries = new List<OscRegistryEntry>();
            for (var i = 0; i < OscCatalog.MaxItems; i++)
            {
                var entry = Entry(Op(OscBindingKind.Trigger), "/fx/t" + i.ToString("0000") + "/stop");
                entries.Add(entry);
                registry.Register(entry);
            }

            var catalog = new OscCatalog(registry);
            catalog.Attach();
            catalog.BuildFullSync("pc");

            registry.Unregister(entries[OscCatalog.MaxItems - 1]);
            registry.Register(Entry(Op(OscBindingKind.Trigger), "/fx/a/stop"));
            registry.Unregister(entries[0]);
            registry.Register(Entry(Op(OscBindingKind.Trigger), "/fx/b/stop"));
            var messages = Decode(catalog.BuildDiff());
            Assert.That(Addresses(messages), Is.EqualTo(new[]
            {
                "/sys/catalog/remove /fx/t0000/stop", "/sys/catalog/remove /fx/t4095/stop",
                "/sys/catalog/add /fx/a/stop", "/sys/catalog/add /fx/b/stop", "/sys/catalog/digest"
            }));
            Assert.That(messages[4].Values[0], Is.EqualTo(OscCatalog.MaxItems));
        }

        [Test]
        public void Catalog_stays_under_the_receiver_total_size()
        {
            // 1 項目ずつは 8 KiB 以内でも、合計が受け側の 8 MiB を超える構成(PR #107 の指摘)。全量・差分・digest が同じ一覧に揃う
            var registry = new OscRegistry();
            var option = new string('o', OscCatalog.MaxStringChars);
            for (var i = 0; i < 1500; i++)
            {
                registry.Register(Entry(Op(OscBindingKind.String).WithOptions(option, option, option, option, option, option),
                    "/fx/t" + i.ToString("0000") + "/mode"));
            }

            var catalog = new OscCatalog(registry);
            catalog.Attach();
            var items = catalog.CurrentItems();
            long total = 0;
            foreach (var item in items)
            {
                total += OscCatalog.EstimateBytes(item);
            }

            Assert.That(total, Is.LessThanOrEqualTo(OscCatalog.MaxTotalBytes));
            Assert.That(catalog.OmittedBySize, Is.GreaterThan(0));
            Assert.That(catalog.Omitted, Is.EqualTo(1500 - items.Count));

            var messages = Decode(catalog.BuildFullSync("pc"));
            Assert.That(messages.FindAll(m => m.Address == OscCatalog.AddAddress).Count, Is.EqualTo(items.Count));
            Assert.That(messages[messages.Count - 1].Values[0], Is.EqualTo(items.Count));

            // 先頭の登録が消えると、大きさの上限で載せていなかった登録が差分で繰り上がり、digest も同じ一覧で数える
            registry.Unregister(registry.Snapshot()[0]);
            messages = Decode(catalog.BuildDiff());
            Assert.That(messages[0].Address, Is.EqualTo(OscCatalog.RemoveAddress));
            Assert.That(messages.FindAll(m => m.Address == OscCatalog.AddAddress).Count, Is.GreaterThan(0));
            Assert.That(messages[messages.Count - 1].Values[0], Is.EqualTo(catalog.CurrentItems().Count));
        }

        [Test]
        public void Pc_name_is_made_sendable()
        {
            // NUL・単独のサロゲートを含む名前で符号化が例外になると、全体の Sync が送れなくなる(PR #107 の指摘)
            Assert.That(OscCatalog.NormalizePcName("St\0age\uD800 PC\uDC00"), Is.EqualTo("Stage PC"));
            Assert.That(OscCatalog.NormalizePcName("ok😀"), Is.EqualTo("ok😀"));
            Assert.That(OscCatalog.NormalizePcName("\0\uD800"), Is.EqualTo(OscCatalog.DefaultPcName));
            Assert.That(OscCatalog.NormalizePcName("  "), Is.EqualTo(OscCatalog.DefaultPcName));
            Assert.That(OscCatalog.NormalizePcName(null), Is.EqualTo(OscCatalog.DefaultPcName));
            Assert.That(OscCatalog.NormalizePcName(new string('n', 100)).Length, Is.EqualTo(OscCatalog.MaxNameChars));

            var registry = new OscRegistry();
            registry.Register(Entry(Op(OscBindingKind.Trigger), "/fx/a/stop"));
            var messages = Decode(new OscCatalog(registry).BuildFullSync("bad\0name\uD800"));
            Assert.That(messages[0].Values[0], Is.EqualTo("badname"));
        }
    }
}
