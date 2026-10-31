using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    /// <summary>キーの一覧を Unity が持つレコードの帳簿(D-099)。キーは Alpha / Bravo / Charlie のような仮の名前で代える。</summary>
    public sealed class OscKeyedBookTests
    {
        private sealed class Values
        {
            public Values(bool active, string target = "(none)")
            {
                Active = active;
                Target = target;
            }

            public bool Active { get; }
            public string Target { get; }
        }

        [Test]
        public void Latest_values_win_per_key()
        {
            var book = new OscKeyedBook<Values>();
            book.Store("Alpha", new Values(true), false);
            book.Store("Bravo", new Values(true), false);
            book.Store("Alpha", new Values(false), false);

            Assert.That(book.Count, Is.EqualTo(2));
            Assert.That(book.TryGet("Alpha", out var alpha), Is.True);
            Assert.That(alpha.Active, Is.False);
            Assert.That(book.TryGet("alpha", out _), Is.False);
            Assert.That(book.TryGet(null, out _), Is.False);
        }

        [Test]
        public void Values_can_be_value_types()
        {
            var book = new OscKeyedBook<int>();
            Assert.That(book.TryGet("Alpha", out var missing), Is.False);
            Assert.That(missing, Is.Zero);

            book.Store("Alpha", 3, false);
            Assert.That(book.TryGet("Alpha", out var value), Is.True);
            Assert.That(value, Is.EqualTo(3));
        }

        [Test]
        public void An_empty_key_is_rejected()
        {
            var book = new OscKeyedBook<int>();
            Assert.Throws<ArgumentNullException>(() => book.Store(null, 1, false));
            Assert.Throws<ArgumentException>(() => book.Store("", 1, true));
            Assert.That(book.Count, Is.Zero);
            Assert.That(book.Keys, Is.Empty);
        }

        [Test]
        public void Values_in_the_window_are_taken_in_first_seen_order()
        {
            var book = new OscKeyedBook<Values>();
            book.Store("Bravo", new Values(true), false);
            book.Store("Charlie", new Values(true), true);
            book.Store("Alpha", new Values(true), true);
            book.Store("Bravo", new Values(true), true);

            // Bravo は窓の外で先に受けたので、初めて受けた順では先頭になる
            Assert.That(book.IsTouched("Alpha"), Is.True);
            Assert.That(book.TakeTouched(), Is.EqualTo(new[] { "Bravo", "Charlie", "Alpha" }));
            Assert.That(book.TouchedCount, Is.Zero);
            Assert.That(book.IsTouched("Alpha"), Is.False);
            Assert.That(book.Keys, Is.EqualTo(new[] { "Bravo", "Charlie", "Alpha" }));
        }

        [Test]
        public void ClearTouched_forgets_the_window_but_keeps_values()
        {
            var book = new OscKeyedBook<Values>();
            book.Store("Alpha", new Values(true), true);
            book.ClearTouched();

            Assert.That(book.TakeTouched(), Is.Empty);
            Assert.That(book.TryGet("Alpha", out _), Is.True);
        }

        [Test]
        public void Awaiting_keys_are_released_when_they_appear()
        {
            var book = new OscKeyedBook<Values>();
            book.Await("Late");
            book.Await("Early");
            book.Await("");
            book.Await(null);

            Assert.That(book.AwaitingCount, Is.EqualTo(2));
            Assert.That(book.TakeAppeared(new HashSet<string> { "Other" }), Is.Empty);
            Assert.That(book.TakeAppeared(null), Is.Empty);

            var appeared = book.TakeAppeared(new HashSet<string> { "Early", "Late" });
            Assert.That(appeared, Is.EqualTo(new[] { "Late", "Early" }));
            Assert.That(book.AwaitingCount, Is.Zero);
            Assert.That(book.IsAwaiting("Late"), Is.False);
        }

        [Test]
        public void An_await_can_be_cancelled()
        {
            var book = new OscKeyedBook<Values>();
            book.Await("Alpha");

            Assert.That(book.CancelAwait("Alpha"), Is.True);
            Assert.That(book.CancelAwait("Alpha"), Is.False);
            Assert.That(book.CancelAwait(null), Is.False);
            Assert.That(book.TakeAppeared(new HashSet<string> { "Alpha" }), Is.Empty);
        }

        [Test]
        public void Absent_warning_is_given_once_until_the_key_appears()
        {
            var book = new OscKeyedBook<Values>();

            Assert.That(book.ShouldWarnAbsent("Ghost"), Is.True);
            Assert.That(book.ShouldWarnAbsent("Ghost"), Is.False);
            Assert.That(book.ShouldWarnAbsent(""), Is.False);

            book.ResetAbsentWarnings(new HashSet<string> { "Other" });
            Assert.That(book.ShouldWarnAbsent("Ghost"), Is.False);

            // 一度現れたら、また居なくなったときに 1 回警告する
            book.ResetAbsentWarnings(new HashSet<string> { "Ghost" });
            Assert.That(book.ShouldWarnAbsent("Ghost"), Is.True);
        }

        [Test]
        public void A_side_table_of_the_caller_follows_the_first_seen_order()
        {
            // 案件固有の待ち(例: 一覧に後から現れる名前への紐付け)は利用側が自前の表で持ち、帳簿の Keys の順で回す。
            // 値より先に待ちを覚えるキーは Track で並びに載せる
            var book = new OscKeyedBook<Values>();
            var pending = new Dictionary<string, string>(StringComparer.Ordinal);
            book.Store("Bravo", new Values(true, "targetX"), false);
            book.Track("Alpha");
            pending["Alpha"] = "targetY";
            pending["Bravo"] = "targetX";
            book.Track("");
            book.Track(null);

            var retried = new List<string>();
            foreach (var key in book.Keys)
            {
                if (pending.ContainsKey(key)) retried.Add(key);
            }

            Assert.That(retried, Is.EqualTo(new[] { "Bravo", "Alpha" }));
            Assert.That(book.Count, Is.EqualTo(1));
            Assert.That(book.TryGet("Alpha", out _), Is.False);
        }
    }
}
