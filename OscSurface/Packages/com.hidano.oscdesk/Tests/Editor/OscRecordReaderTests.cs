using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    /// <summary>レコードから利用側の値を読む補助(フィールド id があれば id、無ければ位置。D-099)。</summary>
    public sealed class OscRecordReaderTests
    {
        private static readonly string[] Fields = { "active", "kind", "address", "port" };

        private static bool TryReadRow(OscRecord record, out (bool Active, string Kind, string Address, int Port) row, out string problem)
        {
            var reader = new OscRecordReader(record, "row " + OscUiRowBook.Label(record) + " ");
            reader.TryBool("active", 0, out var active);
            reader.TryString("kind", 1, out var kind);
            reader.TryString("address", 2, out var address);
            reader.TryInt("port", 3, out var port);
            row = (active, kind, address, port);
            problem = reader.Problem;
            return !reader.HasProblems;
        }

        [Test]
        public void Fields_are_read_by_field_id_when_the_row_has_record_fields()
        {
            // 定義と違う並びの Record Fields でも id で読む
            var record = new OscRecord("Row 1", new object[] { "10.0.0.2", 1, 22001, "crescent" }, new[] { "address", "active", "port", "kind" }, "id-1");

            Assert.That(TryReadRow(record, out var row, out var problem), Is.True, problem);
            Assert.That(row, Is.EqualTo((true, "crescent", "10.0.0.2", 22001)));
            Assert.That(problem, Is.Null);
        }

        [Test]
        public void Fields_are_read_by_position_when_the_row_has_no_record_fields()
        {
            Assert.That(OscRecord.TryCreate(new object[] { "id-1", "Row 1", 1, "crescent", "10.0.0.2", 22001 }, null, true,
                out var record, out _), Is.True);

            Assert.That(TryReadRow(record, out var row, out _), Is.True);
            Assert.That(row.Port, Is.EqualTo(22001));
            Assert.That(OscRecordReader.IndexOf(record, "port", 3), Is.EqualTo(3));
        }

        [Test]
        public void A_fractional_float_for_an_int_field_says_why_it_was_rejected()
        {
            // int は整数値の float(22001.0)を受けるので、型名だけでは小数部が理由だと分からない
            var record = new OscRecord("Row 1", new object[] { 1, "crescent", "10.0.0.2", 22001.5f }, Fields, "id-1");
            var whole = new OscRecord("Row 1", new object[] { 1, "crescent", "10.0.0.2", 22001f }, Fields, "id-1");

            Assert.That(TryReadRow(record, out _, out var problem), Is.False);
            Assert.That(problem, Is.EqualTo("row \"Row 1\" port: expected int but got a non-integral float (22001.5)"));
            Assert.That(TryReadRow(whole, out var row, out _), Is.True);
            Assert.That(row.Port, Is.EqualTo(22001));
        }

        [Test]
        public void Every_unreadable_field_is_reported_at_once()
        {
            var record = new OscRecord("Row 1", new object[] { "yes", "crescent", "10.0.0.2", "22001" }, Fields, "id-1");

            Assert.That(TryReadRow(record, out _, out var problem), Is.False);
            Assert.That(problem, Is.EqualTo(
                "row \"Row 1\" active: expected bool but got String; row \"Row 1\" port: expected int but got String"));
        }

        [Test]
        public void A_field_id_missing_from_the_record_fields_does_not_fall_back_to_the_position()
        {
            // 定義と違う行を位置で読むと別のフィールドの値を黙って使うので、欠けとして扱う
            var record = new OscRecord("Row 1", new object[] { 1, "crescent", "10.0.0.2", 22001 }, new[] { "active", "kind", "host", "port" });

            Assert.That(OscRecordReader.IndexOf(record, "address", 2), Is.EqualTo(-1));
            Assert.That(TryReadRow(record, out _, out var problem), Is.False);
            Assert.That(problem, Is.EqualTo("row \"Row 1\" address: field is missing"));
        }

        [Test]
        public void A_row_wired_without_record_row_ids_does_not_read_as_valid_values()
        {
            // UI で管理する行を Record Row Ids オフで受けると、行 ID がキー、名前が最初のフィールドに見える。
            // Record Fields があれば数で受け口が弾き、無くても型が合わず読まない(保持値を書き換えない)
            var args = new object[] { "id-1", "Row 1", 1, "crescent", "10.0.0.2", 22001 };
            Assert.That(OscRecord.TryCreate(args, Fields, false, out _, out _), Is.False);

            Assert.That(OscRecord.TryCreate(args, null, false, out var record, out _), Is.True);
            Assert.That(TryReadRow(record, out _, out var problem), Is.False);
            Assert.That(problem, Does.Contain("active"));
        }

        [Test]
        public void Floats_and_extra_problems_use_the_same_label()
        {
            var record = new OscRecord("Alpha", new object[] { 2 }, new[] { "gain" });
            var reader = new OscRecordReader(record, "key \"Alpha\" ");

            Assert.That(reader.TryFloat("gain", 0, out var gain), Is.True);
            Assert.That(gain, Is.EqualTo(2f));
            Assert.That(reader.HasProblems, Is.False);

            reader.AddProblem("gain: must be at most 1");
            reader.AddProblem(null);
            Assert.That(reader.Problems, Is.EqualTo(new[] { "key \"Alpha\" gain: must be at most 1" }));
            Assert.Throws<System.ArgumentNullException>(() => new OscRecordReader(null));
        }
    }
}
