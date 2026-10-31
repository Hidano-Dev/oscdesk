using System.Collections.Generic;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    /// <summary>
    /// キーの一覧を OscDesk の画面で管理するレコードの帳簿(行 ID の一覧 + 行 ID ごとの値と名前。D-087 / D-099)。
    /// 行 ID は OscDesk が振る UUID の文字列で、テストでは読みやすい短い値で代える。
    /// </summary>
    public sealed class OscUiRowBookTests
    {
        private sealed class Endpoint
        {
            public Endpoint(bool active, string address, int port)
            {
                Active = active;
                Address = address;
                Port = port;
            }

            public bool Active { get; }
            public string Address { get; }
            public int Port { get; }
        }

        private static OscUiRowBook<Endpoint> Defaults()
        {
            var book = new OscUiRowBook<Endpoint>();
            book.SetIds(new[] { "id-1", "id-2", "id-3" });
            book.Store("id-1", "Row 1", new Endpoint(true, "192.168.101.11", 22000));
            book.Store("id-2", "Row 2", new Endpoint(true, "192.168.101.12", 22001));
            book.Store("id-3", "Row 3", new Endpoint(false, "192.168.101.11", 22000));
            return book;
        }

        // 利用側の適用の形: 一覧の順に値を読み、行 ID ごとの連番を付けて実体に割り当てる
        private static List<KeyValuePair<int, Endpoint>> Apply(OscUiRowBook<Endpoint> book)
        {
            var result = new List<KeyValuePair<int, Endpoint>>();
            foreach (var id in book.Ids)
            {
                if (book.TryGet(id, out var endpoint)) result.Add(new KeyValuePair<int, Endpoint>(book.SerialOf(id), endpoint));
            }

            return result;
        }

        [Test]
        public void Rows_are_read_in_the_order_of_the_id_list()
        {
            var book = Defaults();

            Assert.That(book.HasIds, Is.True);
            Assert.That(book.IsComplete, Is.True);
            Assert.That(book.Ids, Is.EqualTo(new[] { "id-1", "id-2", "id-3" }));
            Assert.That(book.Labels, Is.EqualTo(new[] { "\"Row 1\"", "\"Row 2\"", "\"Row 3\"" }));
            var applied = Apply(book);
            Assert.That(applied, Has.Count.EqualTo(3));
            Assert.That(applied[1].Value.Port, Is.EqualTo(22001));
            Assert.That(applied[2].Value.Active, Is.False);
            Assert.That(book.TryGetName("id-2", out var name), Is.True);
            Assert.That(name, Is.EqualTo("Row 2"));
        }

        [Test]
        public void An_id_keeps_its_serial_when_the_list_is_reordered_or_shrinks()
        {
            var book = Defaults();
            var before = Apply(book);
            var second = before[1].Key;

            Assert.That(book.SetIds(new[] { "id-2", "id-3" }), Is.True);
            var after = Apply(book);

            Assert.That(after[0].Key, Is.EqualTo(second));
            Assert.That(book.TryGetIdOfSerial(second, out var id), Is.True);
            Assert.That(id, Is.EqualTo("id-2"));
            // 消した行の値は捨てる。足し直すと新しい値が届くまで揃わない(名前が分からないので行 ID で示す)
            Assert.That(book.TryGet("id-1", out _), Is.False);
            book.SetIds(new[] { "id-2", "id-3", "id-1" });
            Assert.That(book.IsComplete, Is.False);
            Assert.That(book.LabelOf("id-1"), Is.EqualTo("[id-1]"));
            // 消した行の番号は振り直さず、足し直した行は元の番号のまま
            Assert.That(book.SerialOf("id-1"), Is.EqualTo(before[0].Key));
            Assert.That(book.SerialOf("id-4"), Is.EqualTo(4));
            Assert.That(book.NextSerial, Is.EqualTo(5));
        }

        [Test]
        public void Renaming_keeps_the_serial_values_and_order()
        {
            // 改名は同じ行 ID の行が新しい名前で届き直すだけ(D-087)。一覧は届かず、行は同じ連番のまま
            var book = Defaults();
            var before = Apply(book);

            Assert.That(book.Store("id-2", "Backup", new Endpoint(true, "192.168.101.12", 22001)), Is.True);
            Assert.That(book.Store("id-2", "Backup", new Endpoint(true, "192.168.101.12", 22001)), Is.False);
            var after = Apply(book);

            Assert.That(after, Has.Count.EqualTo(3));
            Assert.That(after[1].Key, Is.EqualTo(before[1].Key));
            Assert.That(book.Ids, Is.EqualTo(new[] { "id-1", "id-2", "id-3" }));
            Assert.That(book.LabelOf("id-2"), Is.EqualTo("\"Backup\""));
        }

        [Test]
        public void Two_rows_with_the_same_name_are_still_different_rows()
        {
            // 名前の重複は OscDesk が断るが、行は ID で区別するので、仮に同じ名前で届いても別の行のまま
            var book = new OscUiRowBook<Endpoint>();
            book.SetIds(new[] { "id-1", "id-2" });
            book.Store("id-1", "Row", new Endpoint(true, "192.168.101.11", 22000));
            book.Store("id-2", "Row", new Endpoint(true, "192.168.101.12", 22000));

            var applied = Apply(book);

            Assert.That(applied, Has.Count.EqualTo(2));
            Assert.That(applied[0].Key, Is.Not.EqualTo(applied[1].Key));
        }

        [Test]
        public void An_empty_list_is_complete_but_no_list_is_not()
        {
            var none = new OscUiRowBook<Endpoint>();
            Assert.That(none.HasIds, Is.False);
            Assert.That(none.IsComplete, Is.False);

            var book = Defaults();
            Assert.That(book.SetIds(new string[0]), Is.True);
            Assert.That(book.IsComplete, Is.True);
            Assert.That(book.Count, Is.Zero);
            Assert.That(Apply(book), Is.Empty);
        }

        [Test]
        public void Ids_drop_empty_and_duplicated_entries()
        {
            var book = new OscUiRowBook<Endpoint>();
            Assert.That(book.SetIds(new[] { "A", "", "A", null, "B" }), Is.True);
            Assert.That(book.Ids, Is.EqualTo(new[] { "A", "B" }));
            Assert.That(book.SetIds(new[] { "A", "B" }), Is.False);
            Assert.That(book.SetIds(new[] { "B", "A" }), Is.True);
            Assert.That(book.SetIds(null), Is.True);
            Assert.That(book.Ids, Is.Empty);
        }

        [Test]
        public void The_first_empty_list_counts_as_a_change()
        {
            // 受ける前と「空の一覧を受けた」は違う(後者は全行を外す適用につながる)
            var book = new OscUiRowBook<Endpoint>();
            Assert.That(book.SetIds(new string[0]), Is.True);
            Assert.That(book.SetIds(new string[0]), Is.False);
        }

        [Test]
        public void Values_that_arrive_before_the_list_are_kept_until_the_next_list()
        {
            var book = new OscUiRowBook<Endpoint>();
            book.Store("id-1", "Row 1", new Endpoint(true, "10.0.0.1", 1));
            book.Store("id-9", "Row 9", new Endpoint(true, "10.0.0.9", 9));
            Assert.That(book.Count, Is.EqualTo(2));
            Assert.That(book.IsComplete, Is.False);

            book.SetIds(new[] { "id-1" });
            Assert.That(book.IsComplete, Is.True);
            Assert.That(book.TryGet("id-9", out _), Is.False);
        }

        [Test]
        public void A_row_without_an_id_is_not_stored()
        {
            var book = new OscUiRowBook<Endpoint>();
            Assert.That(book.Store("", "Row", new Endpoint(true, "10.0.0.1", 1)), Is.False);
            Assert.That(book.Store((string)null, "Row", new Endpoint(true, "10.0.0.1", 1)), Is.False);
            Assert.That(book.Count, Is.Zero);
            Assert.That(book.TryGet(null, out _), Is.False);
            Assert.That(book.TryGetName(null, out _), Is.False);
            Assert.Throws<System.ArgumentException>(() => book.SerialOf(""));
            Assert.That(book.TryGetIdOfSerial(1, out _), Is.False);
        }

        [Test]
        public void A_record_with_row_ids_is_stored_by_its_id_and_name()
        {
            Assert.That(OscRecord.TryCreate(new object[] { "id-1", "Row 1", 1, "10.0.0.2", 22001 }, new[] { "active", "address", "port" }, true,
                out var record, out var reason), Is.True, reason);
            var book = new OscUiRowBook<int>();
            book.SetIds(new[] { "id-1" });

            Assert.That(book.Store(record, record.GetInt("port")), Is.False);
            Assert.That(book.TryGet("id-1", out var port), Is.True);
            Assert.That(port, Is.EqualTo(22001));
            Assert.That(book.LabelOf("id-1"), Is.EqualTo("\"Row 1\""));
            Assert.Throws<System.ArgumentNullException>(() => book.Store((OscRecord)null, 0));
        }

        [Test]
        public void Label_shows_the_id_when_the_name_is_unknown_or_empty()
        {
            Assert.That(OscUiRowBook.Label("id-1", null), Is.EqualTo("[id-1]"));
            Assert.That(OscUiRowBook.Label("id-1", ""), Is.EqualTo("[id-1]"));
            Assert.That(OscUiRowBook.Label("id-1", "Row"), Is.EqualTo("\"Row\""));
            Assert.That(OscUiRowBook.Label(new OscRecord("Row", new object[0], null, "id-1")), Is.EqualTo("\"Row\""));
            Assert.Throws<System.ArgumentNullException>(() => OscUiRowBook.Label(null));
        }

        [Test]
        public void Serials_follow_the_id_list_not_the_order_values_arrive()
        {
            // 値は UDP で届くので順序が入れ替わり得る。連番を値の届いた順で振ると、行と実体の割り当てが実行ごとに変わる
            var book = new OscUiRowBook<int>();
            book.Store("id-3", "Row 3", 3);
            book.Store("id-2", "Row 2", 2);
            book.SetIds(new[] { "id-1", "id-2", "id-3" });
            book.Store("id-1", "Row 1", 1);

            Assert.That(book.SerialOf("id-3"), Is.EqualTo(3));
            Assert.That(book.SerialOf("id-1"), Is.EqualTo(1));
            Assert.That(book.SerialOf("id-2"), Is.EqualTo(2));

            // 後から足した行は、一覧に現れた順に続きの番号をもらう
            book.SetIds(new[] { "id-5", "id-1", "id-4" });
            Assert.That(book.SerialOf("id-4"), Is.EqualTo(5));
            Assert.That(book.SerialOf("id-5"), Is.EqualTo(4));
        }
    }
}
