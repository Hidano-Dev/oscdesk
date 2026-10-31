using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace OscDesk.Receiver.Tests
{
    public sealed class OscNameListFeedTests
    {
        private readonly List<IReadOnlyList<string>> sent = new List<IReadOnlyList<string>>();

        private bool Send(IReadOnlyList<string> names)
        {
            sent.Add(names);
            return true;
        }

        [SetUp]
        public void SetUp()
        {
            sent.Clear();
        }

        [Test]
        public void First_publish_sends_even_an_empty_list()
        {
            var feed = new OscNameListFeed();
            feed.AddSource(() => new string[0]);

            var result = feed.Publish(Send, onlyIfChanged: true);

            Assert.That(result.Attempted, Is.True);
            Assert.That(result.Sent, Is.True);
            Assert.That(sent, Has.Count.EqualTo(1));
            Assert.That(feed.LastSent, Is.Empty);
        }

        [Test]
        public void Only_if_changed_skips_the_same_list_and_sends_on_order_change()
        {
            var names = new List<string> { "A", "B" };
            var feed = new OscNameListFeed();
            feed.AddSource(() => names);

            feed.Publish(Send, true);
            Assert.That(feed.Publish(Send, true).Attempted, Is.False);

            names.Reverse();
            var changed = feed.Publish(Send, true);
            Assert.That(changed.Sent, Is.True);
            Assert.That(sent, Has.Count.EqualTo(2));
            Assert.That(sent[1], Is.EqualTo(new[] { "B", "A" }));
        }

        [Test]
        public void Request_style_publish_sends_even_when_unchanged()
        {
            var feed = new OscNameListFeed();
            feed.AddSource(() => new[] { "A" });

            feed.Publish(Send, false);
            feed.Publish(Send, false);

            Assert.That(sent, Has.Count.EqualTo(2));
        }

        [Test]
        public void Failed_send_is_not_recorded_so_the_next_refresh_retries()
        {
            var feed = new OscNameListFeed();
            feed.AddSource(() => new[] { "A" });

            var failed = feed.Publish(_ => false, true);
            Assert.That(failed.Attempted, Is.True);
            Assert.That(failed.Sent, Is.False);
            Assert.That(feed.LastSent, Is.Null);

            Assert.That(feed.Publish(Send, true).Sent, Is.True);
        }

        [Test]
        public void Last_sent_is_a_copy_not_the_source_list()
        {
            var names = new List<string> { "A" };
            var feed = new OscNameListFeed();
            feed.AddSource(() => names);
            feed.Publish(Send, true);

            names.Add("B");

            Assert.That(feed.LastSent, Is.EqualTo(new[] { "A" }));
            Assert.That(feed.IsChanged(feed.Build().Names), Is.True);
        }

        [Test]
        public void Reset_makes_the_next_change_only_publish_send()
        {
            var feed = new OscNameListFeed();
            feed.AddSource(() => new[] { "A" });
            feed.Publish(Send, true);

            feed.Reset();

            Assert.That(feed.Publish(Send, true).Sent, Is.True);
            Assert.That(sent, Has.Count.EqualTo(2));
        }

        [Test]
        public void Multiple_sources_join_in_order_with_first_wins()
        {
            var feed = new OscNameListFeed(new OscNameListOptions { Reserved = new[] { "(none)" } });
            feed.AddSource(() => new[] { "A", "(none)" });
            feed.AddSource(() => null);
            feed.AddSource(() => new[] { "B", "A" });

            var result = feed.Build();

            Assert.That(result.Names, Is.EqualTo(new[] { "A", "B" }));
            Assert.That(result.SourceCount, Is.EqualTo(3));
            Assert.That(result.Warnings[1].SourceIndex, Is.EqualTo(2));
        }

        [Test]
        public void A_throwing_source_counts_as_empty_and_others_still_publish()
        {
            var feed = new OscNameListFeed(new OscNameListOptions { Label = "item" });
            feed.AddSource(() => new[] { "A" });
            feed.AddSource(() => throw new InvalidOperationException("not ready"));
            feed.AddSource(() => new[] { "B" });

            var result = feed.Publish(Send, true);

            Assert.That(result.Sent, Is.True);
            Assert.That(result.List.Names, Is.EqualTo(new[] { "A", "B" }));
            Assert.That(result.List.Warnings, Has.Count.EqualTo(1));
            Assert.That(result.List.Warnings[0].Issue, Is.EqualTo(OscNameListIssue.SourceFailed));
            Assert.That(result.List.Warnings[0].SourceIndex, Is.EqualTo(1));
            Assert.That(result.List.Warnings[0].Message, Does.Contain("InvalidOperationException").And.Contain("not ready"));
        }

        [Test]
        public void A_single_source_reports_positions_like_a_single_list()
        {
            var feed = new OscNameListFeed();
            feed.AddSource(() => new[] { "A", "A" });

            var warning = feed.Build().Warnings[0];

            Assert.That(warning.SourceIndex, Is.EqualTo(-1));
            Assert.That(warning.Index, Is.EqualTo(1));
        }

        [Test]
        public void No_sources_give_an_empty_list()
        {
            var feed = new OscNameListFeed();
            Assert.That(feed.Build().Names, Is.Empty);
            Assert.That(feed.SourceCount, Is.EqualTo(0));
        }

        [Test]
        public void Remove_and_clear_sources()
        {
            Func<IReadOnlyList<string>> a = () => new[] { "A" };
            var feed = new OscNameListFeed();
            feed.AddSource(a);
            feed.AddSource(() => new[] { "B" });

            Assert.That(feed.RemoveSource(a), Is.True);
            Assert.That(feed.Build().Names, Is.EqualTo(new[] { "B" }));
            feed.ClearSources();
            Assert.That(feed.SourceCount, Is.EqualTo(0));
            Assert.Throws<ArgumentNullException>(() => feed.AddSource(null));
            Assert.Throws<ArgumentNullException>(() => feed.Publish(null, true));
        }
    }
}
