using System;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    // 拡張パッケージが定義する型(HID-380・D-121)。スキーマの JSON は packages/shared/src/value-type.test.ts が同じ文字列を読む
    public sealed class OscValueTypeTests
    {
        // value-type.test.ts の「C# が書くスキーマ」と同じ文字列。どちらかを変えたら両方を揃える
        private const string ColorSchema =
            "{\"name\":\"color\",\"type\":\"record\",\"hint\":\"color\",\"fields\":["
            + "{\"id\":\"r\",\"label\":\"R\",\"type\":\"f\",\"range\":[0,1],\"default\":1},"
            + "{\"id\":\"g\",\"type\":\"f\",\"range\":[0,1],\"step\":0.5},"
            + "{\"id\":\"n\",\"type\":\"i\",\"range\":[0,10],\"default\":3},"
            + "{\"id\":\"mode\",\"type\":\"s\",\"options\":[\"a\",\"\\\"b\\\"\"],\"default\":\"a\"},"
            + "{\"id\":\"on\",\"type\":\"bool\",\"default\":true}]}";

        private static OscValueType Color()
        {
            return OscValueType.Record("color",
                    OscValueField.Of("r", OscValueType.Float().WithRange(0f, 1f).WithDefault(1f), "R"),
                    OscValueField.Of("g", OscValueType.Float().WithRange(0f, 1f).WithStep(0.5f)),
                    OscValueField.Of("n", OscValueType.Int().WithRange(0f, 10f).WithDefault(3)),
                    OscValueField.Of("mode", OscValueType.String().WithOptions("a", "\"b\"").WithDefault("a")),
                    OscValueField.Of("on", OscValueType.Bool().WithDefault(true)))
                .WithHint("color");
        }

        [Test]
        public void Schema_json_has_the_shared_shape()
        {
            Assert.That(Color().ToSchemaJson(), Is.EqualTo(ColorSchema));
            Assert.That(Color().IsFlatRecord, Is.True);
        }

        [Test]
        public void Nested_and_array_types_have_a_schema_but_are_not_flat()
        {
            var nested = OscValueType.Record("rig", OscValueField.Of("tint", Color()));
            Assert.That(nested.IsFlatRecord, Is.False);
            StringAssert.Contains("\"fields\":[{\"id\":\"tint\",\"type\":\"record\",\"hint\":\"color\",\"fields\":[", nested.ToSchemaJson());
            var list = OscValueType.Array("stops", OscValueType.Float(), 8);
            Assert.That(list.IsFlatRecord, Is.False);
            Assert.That(list.ToSchemaJson(), Is.EqualTo("{\"name\":\"stops\",\"type\":\"array\",\"items\":{\"type\":\"f\"},\"maxItems\":8}"));
        }

        [Test]
        public void Builders_reject_what_the_controller_would_not_read()
        {
            Assert.Throws<ArgumentException>(() => OscValueType.Record("1color", OscValueField.Of("r", OscValueType.Float())));
            Assert.Throws<ArgumentException>(() => OscValueType.Record("color"));
            Assert.Throws<ArgumentException>(() => OscValueType.Record("c", OscValueField.Of("r", OscValueType.Float()), OscValueField.Of("r", OscValueType.Int())));
            Assert.Throws<ArgumentException>(() => OscValueField.Of("1r", OscValueType.Float()));
            Assert.Throws<ArgumentException>(() => OscValueType.Float().WithRange(1f, 0f));
            Assert.Throws<ArgumentException>(() => OscValueType.Int().WithDefault("x"));
            Assert.Throws<InvalidOperationException>(() => OscValueType.Bool().WithRange(0f, 1f));
            Assert.Throws<InvalidOperationException>(() => OscValueType.Float().ToSchemaJson());
            var deep = OscValueType.Record("d0", OscValueField.Of("x", OscValueType.Float()));
            Assert.Throws<ArgumentException>(() =>
            {
                for (var n = 1; n <= OscValueType.MaxDepth + 1; n++) deep = OscValueType.Record("d" + n, OscValueField.Of("x", deep));
            });
        }

        [Test]
        public void TryRead_reads_the_fields_in_declaration_order()
        {
            Assert.That(Color().TryRead(new object[] { 0.5f, 1, 3, "a", 1 }, out var value, out var reason), Is.True, reason);
            Assert.That(value.Key, Is.Empty);
            Assert.That(value.GetFloat("r"), Is.EqualTo(0.5f));
            Assert.That(value.GetFloat("g"), Is.EqualTo(1f));
            Assert.That(value.GetInt("n"), Is.EqualTo(3));
            Assert.That(value.GetString("mode"), Is.EqualTo("a"));
            Assert.That(value.GetBool("on"), Is.True);

            Assert.That(Color().TryRead(new object[] { 0.5f, 1, 3, "a" }, out _, out reason), Is.False);
            Assert.That(reason, Does.Contain("expects 5 arguments"));
            Assert.That(Color().TryRead(new object[] { 0.5f, 1, 3.5f, "a", 1 }, out _, out reason), Is.False);
            Assert.That(reason, Does.Contain("field n"));
            Assert.That(OscValueType.Record("rig", OscValueField.Of("tint", Color())).TryRead(new object[] { 1f }, out _, out _), Is.False);
        }

        [Test]
        public void Composite_operation_delivers_a_record_and_reports_type_mismatch()
        {
            var registry = new OscRegistry();
            var received = new List<OscRecord>();
            var operations = new OscOperationList();
            var operation = operations.Composite("tint", Color(), received.Add).WithLabel("Tint");
            registry.Register(new OscRegistryEntry("/fx/light/tint", operation, null));

            Assert.That(registry.Deliver("/fx/light/tint", new object[] { 1f, 0f, 2, "a", 0 }, out var reason), Is.EqualTo(OscDeliveryOutcome.Delivered));
            Assert.That(reason, Is.Null);
            Assert.That(registry.Deliver("/fx/light/tint", new object[] { 1f }, out reason), Is.EqualTo(OscDeliveryOutcome.Failed));
            Assert.That(reason, Is.EqualTo(OscRegistry.ReasonTypeMismatch));
            Assert.That(received.Count, Is.EqualTo(1));
            Assert.That(received[0].GetBool("on"), Is.False);

            Assert.Throws<ArgumentException>(() => operations.Composite("rig", OscValueType.Record("rig", OscValueField.Of("tint", Color())), _ => { }));
        }

        [Test]
        public void Catalog_item_carries_the_schema_as_composite()
        {
            var operation = new OscOperationList().Composite("tint", Color(), _ => { }).WithLabel("Tint");
            var item = new OscCatalog(new OscRegistry()).CreateItem(new OscRegistryEntry("/fx/light/tint", operation, null));
            Assert.That(item, Is.Not.Null);
            Assert.That(item.Kind, Is.EqualTo(OscCatalog.KindState));
            Assert.That(item.Type, Is.EqualTo(OscCatalog.TypeComposite));
            Assert.That(item.Props.Select(prop => prop.Key), Is.EqualTo(new[] { "label", OscCatalog.SchemaKey }));
            Assert.That(item.Props[1].Value, Is.EqualTo(ColorSchema));

            var command = new OscOperationList().Composite("kick", Color(), _ => { }).AsCommand();
            Assert.That(new OscCatalog(new OscRegistry()).CreateItem(new OscRegistryEntry("/fx/light/kick", command, null)).Kind, Is.EqualTo(OscCatalog.KindTrigger));
        }

        [Test]
        public void Long_schemas_are_split_into_repeated_schema_props_that_join_back()
        {
            var fields = Enumerable.Range(0, 40)
                .Select(n => OscValueField.Of("field" + n, OscValueType.Float().WithRange(0f, 1f), new string('色', 10)))
                .ToArray();
            var type = OscValueType.Record("wide", fields);
            var item = new OscCatalog(new OscRegistry()).CreateItem(
                new OscRegistryEntry("/fx/light/wide", new OscOperationList().Composite("wide", type, _ => { }), null));
            Assert.That(item, Is.Not.Null);
            var parts = item.Props.Where(prop => prop.Key == OscCatalog.SchemaKey).Select(prop => (string)prop.Value).ToList();
            Assert.That(parts.Count, Is.GreaterThan(1));
            Assert.That(parts.All(part => part.Length <= OscCatalog.MaxStringChars), Is.True);
            Assert.That(string.Concat(parts), Is.EqualTo(type.ToSchemaJson()));
        }
    }
}
