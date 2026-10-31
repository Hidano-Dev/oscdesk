using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>OscNameListFeed.Publish の結果。</summary>
    public sealed class OscNameListPublishResult
    {
        internal OscNameListPublishResult(OscNameListResult list, bool attempted, bool sent)
        {
            List = list;
            Attempted = attempted;
            Sent = sent;
        }

        /// <summary>作り直した一覧(送らなかったときも入る)。</summary>
        public OscNameListResult List { get; }

        /// <summary>送信関数を呼んだか。変わったときだけ送る指定で、前回送った一覧と同じなら false。</summary>
        public bool Attempted { get; }

        /// <summary>送信関数が true を返したか(送り出したことまでで、UDP なので届いたことは保証しない)。</summary>
        public bool Sent { get; }
    }

    /// <summary>
    /// 一覧の供給元(デリゲート)から作り直して正規化し、前回送った一覧と順序込みで違うときだけ送る(D-057 の間引き、D-098)。
    /// 要求(optionsFrom.request / keysFrom.request の Trigger)には変化を問わず送り、周期の作り直しでは変わったときだけ送る、
    /// という使い分けを 1 か所にまとめる。UnityEngine に依存しないので、時計と送信は呼ぶ側が持つ(OscNameListPublisher)。
    /// メインスレッドから呼ぶ前提で、スレッド安全ではない。
    /// </summary>
    public sealed class OscNameListFeed
    {
        private readonly List<Func<IReadOnlyList<string>>> sources = new List<Func<IReadOnlyList<string>>>();
        private OscNameListOptions options;

        public OscNameListFeed(OscNameListOptions options = null)
        {
            this.options = options ?? new OscNameListOptions();
        }

        public OscNameListOptions Options
        {
            get { return options; }
            set { options = value ?? new OscNameListOptions(); }
        }

        public int SourceCount
        {
            get { return sources.Count; }
        }

        /// <summary>最後に送れた一覧(Ordinal で比べる写し)。まだ送れていなければ null。</summary>
        public IReadOnlyList<string> LastSent { get; private set; }

        /// <summary>
        /// 供給元を足す。複数あれば足した順に結合し、同名は先に足したものが勝つ。
        /// 供給元が null を返したら空として、例外を投げたら空として扱って SourceFailed の警告を出す
        /// (1 つの供給元の失敗で、ほかの供給元の名前まで送れなくならないように)。
        /// </summary>
        public void AddSource(Func<IReadOnlyList<string>> source)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            sources.Add(source);
        }

        public bool RemoveSource(Func<IReadOnlyList<string>> source)
        {
            return sources.Remove(source);
        }

        public void ClearSources()
        {
            sources.Clear();
        }

        /// <summary>供給元を呼んで一覧を作り直す(送らない)。</summary>
        public OscNameListResult Build()
        {
            var collected = new List<IReadOnlyList<string>>(sources.Count);
            var failures = new List<OscNameListWarning>();
            for (var i = 0; i < sources.Count; i++)
            {
                try
                {
                    collected.Add(sources[i]());
                }
                catch (Exception exception)
                {
                    collected.Add(null);
                    failures.Add(new OscNameListWarning(OscNameListIssue.SourceFailed, i, -1, null,
                        options.Label + "のソース " + i + " が例外 " + exception.GetType().Name + " を投げたので空として扱いました: "
                        + exception.Message));
                }
            }

            // 供給元が 1 つなら、警告の位置を 1 本の一覧と同じ「n 番目」で書く
            return OscNameList.NormalizeCore(collected, options, sources.Count != 1, failures);
        }

        /// <summary>前回送った一覧と違うか(まだ送っていなければ、空の一覧でも true)。</summary>
        public bool IsChanged(IReadOnlyList<string> names)
        {
            return !OscNameList.SequenceEqual(names, LastSent);
        }

        /// <summary>送れたことを記録する。send を自分で呼ぶときに使う(Publish は自分で記録する)。</summary>
        public void MarkSent(IReadOnlyList<string> names)
        {
            LastSent = names == null ? null : new List<string>(names).AsReadOnly();
        }

        /// <summary>
        /// 送った記録を消す。次の Publish(onlyIfChanged: true)は内容を問わず送る。
        /// 受け手が一覧を失ったと分かったとき(ブリッジの再起動など)に使う。ふつうはブリッジの要求が来るので要らない。
        /// </summary>
        public void Reset()
        {
            LastSent = null;
        }

        /// <summary>
        /// 作り直して送る。onlyIfChanged が true なら、前回送れた一覧と同じときは send を呼ばない。
        /// send が true を返したときだけ送れたと記録するので、送れなかった一覧は次の機会にもう一度送ろうとする。
        /// </summary>
        public OscNameListPublishResult Publish(Func<IReadOnlyList<string>, bool> send, bool onlyIfChanged)
        {
            if (send == null) throw new ArgumentNullException(nameof(send));
            var list = Build();
            if (onlyIfChanged && !IsChanged(list.Names))
            {
                return new OscNameListPublishResult(list, false, false);
            }

            var sent = send(list.Names);
            if (sent) MarkSent(list.Names);
            return new OscNameListPublishResult(list, true, sent);
        }
    }
}
