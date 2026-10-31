// OscNameListPublisher.cs — optionsFrom / keysFrom に名前の一覧を返す小さな部品(DESIGN.md D-098)。
// 使い方: OscReceiver と同じ GameObject などに追加し、Address に定義の optionsFrom.address(または keysFrom.address)を書く。
// 一覧の供給元はコードから AddSource で渡し、定義の request の Trigger の行の On Trigger に SendNow を登録する。
// 周期(Refresh Interval Seconds)ごとに作り直し、前回送れた一覧と順序込みで違うときだけ送る。
using System;
using System.Collections.Generic;
using UnityEngine;

namespace OscDesk.Receiver
{
    [AddComponentMenu("OscDesk/OscDesk Name List Publisher")]
    public sealed class OscNameListPublisher : MonoBehaviour
    {
        [Tooltip("一覧を送る OscReceiver。")]
        [SerializeField] private OscReceiver receiver;

        [Tooltip("一覧を送るアドレス。定義の optionsFrom.address(または keysFrom.address)と同じにする。")]
        [SerializeField] private string address = "";

        [Tooltip("この秒数ごとに一覧を作り直し、前回送れた一覧と違えば送る(順序も比べる)。0 で周期の作り直しをしない(SendNow と MarkDirty だけで送る)。")]
        [SerializeField, Min(0f)] private float refreshIntervalSeconds = 3f;

        [Tooltip("一覧から除く固定候補(完全一致)。定義の静的な options に置いた「(none)」など、動的な一覧と二重に出したくない名前。")]
        [SerializeField] private List<string> reservedNames = new List<string>();

        [Tooltip("件数の目安。超えても送り、警告だけを出す。0 で検査しない。")]
        [SerializeField, Min(0)] private int maxCount = 100;

        [Tooltip("名前の長さ(文字数)の目安。超えても送り、警告だけを出す。0 で検査しない。")]
        [SerializeField, Min(0)] private int maxLength = 256;

        [Tooltip("警告の文に出す一覧の呼び名(例: デバイス)。")]
        [SerializeField] private string label = "名前";

        [Tooltip("送れたときに件数と契機をログに出す。")]
        [SerializeField] private bool logSends = true;

        private readonly OscNameListFeed feed = new OscNameListFeed();
        private float nextRefreshAt;
        private bool dirty;
        private bool warnedMissingReceiver;

        // 送れなかった一覧(大きすぎる・NUL を含むなど)。周期の作り直しで同じ一覧を何度も送ろうとして警告を重ねないために覚える
        private IReadOnlyList<string> lastFailed;

        /// <summary>送れたとき(SendNow・周期・MarkDirty のどれでも)に、送った一覧の結果を渡して呼ぶ。</summary>
        public event Action<OscNameListResult> Sent;

        public OscReceiver Receiver
        {
            get { return receiver; }
            set { receiver = value; warnedMissingReceiver = false; }
        }

        public string Address
        {
            get { return address; }
            set { address = value ?? string.Empty; }
        }

        public float RefreshIntervalSeconds
        {
            get { return refreshIntervalSeconds; }
            set { refreshIntervalSeconds = Mathf.Max(0f, value); }
        }

        /// <summary>中身(供給元・前回送れた一覧)。テストや、送信の記録を消したいとき(Feed.Reset)に使う。</summary>
        public OscNameListFeed Feed
        {
            get { return feed; }
        }

        /// <summary>供給元を足す。複数あれば足した順に結合し、同名は先に足したものが勝つ。例外を投げた供給元は空として扱う。</summary>
        public void AddSource(Func<IReadOnlyList<string>> source)
        {
            feed.AddSource(source);
        }

        public bool RemoveSource(Func<IReadOnlyList<string>> source)
        {
            return feed.RemoveSource(source);
        }

        public void ClearSources()
        {
            feed.ClearSources();
        }

        /// <summary>
        /// 一覧を作り直して、変化を問わず送る。定義の request の Trigger の行の On Trigger に登録する(引数なし)。
        /// ブリッジは到達の初報・回復・定義の採用・UI の「一覧を更新」で要求を送るので、要求には同じ一覧でも必ず応える。
        /// </summary>
        public void SendNow()
        {
            Publish(false, "request");
        }

        /// <summary>
        /// 一覧を作り直して、前回送れた一覧と違うときだけ送る。送れたら true。
        /// 供給元の変化を自分で知ったとき(項目の追加・削除のイベント)は、これか MarkDirty を呼ぶ。
        /// </summary>
        public bool RefreshIfChanged()
        {
            return Publish(true, "changed");
        }

        /// <summary>次のフレームの Update で RefreshIfChanged を行う(同じフレームに何度呼んでも 1 回)。</summary>
        public void MarkDirty()
        {
            dirty = true;
        }

        private void OnEnable()
        {
            // 初回は 1 周期待つ。ブリッジは到達の初報で要求を送るので、起動直後にこちらから送らなくても一覧は届く
            nextRefreshAt = Time.realtimeSinceStartup + refreshIntervalSeconds;
            if (!OscBindingAudit.IsValidAddress(address))
            {
                Debug.LogWarning("OscNameListPublisher: Address が不正です(空、/ で始まらない、空白やワイルドカードを含む、または /sys・/oscdesk 配下): \""
                    + address + "\"", this);
            }
        }

        private void Update()
        {
            var due = refreshIntervalSeconds > 0f && Time.realtimeSinceStartup >= nextRefreshAt;
            if (!dirty && !due) return;

            if (due) nextRefreshAt = Time.realtimeSinceStartup + refreshIntervalSeconds;

            // 待ち受けていない間は送れないので試みない(SendStrings の警告を周期ごとに重ねない)。
            // MarkDirty の印は残し、待ち受けが始まったフレームで送る(周期なしの使い方で変化を落とさない)
            if (receiver == null || !receiver.isActiveAndEnabled || !receiver.IsListening) return;
            dirty = false;
            Publish(true, "changed");
        }

        private bool Publish(bool onlyIfChanged, string cause)
        {
            feed.Options = BuildOptions();
            if (receiver == null)
            {
                if (!warnedMissingReceiver)
                {
                    Debug.LogWarning("OscNameListPublisher: Receiver が未設定なので一覧を送れません(" + address + ")", this);
                    warnedMissingReceiver = true;
                }

                return false;
            }

            var skipFailed = onlyIfChanged;
            var listening = receiver.IsListening;
            var result = feed.Publish(names =>
            {
                if (skipFailed && OscNameList.SequenceEqual(names, lastFailed)) return false;
                return receiver.SendStrings(address, names);
            }, onlyIfChanged);

            if (!result.Attempted) return false;
            if (!result.Sent)
            {
                // 前回も送れなかった同じ一覧なら、警告は前回出したので重ねない
                if (skipFailed && OscNameList.SequenceEqual(result.List.Names, lastFailed)) return false;

                // 待ち受けていなくて送れなかった一覧は中身のせいではないので覚えない(待ち受けが始まった後の周期で送る)
                lastFailed = listening ? result.List.Names : null;
                LogWarnings(result.List);
                return false;
            }

            lastFailed = null;
            LogWarnings(result.List);
            if (logSends)
            {
                Debug.Log("OscNameListPublisher: " + result.List.Names.Count + " 件を " + address + " へ送りました(" + cause + ")", this);
            }

            try
            {
                Sent?.Invoke(result.List);
            }
            catch (Exception exception)
            {
                // 購読者の例外で周期の作り直しを止めない
                Debug.LogException(exception, this);
            }

            return true;
        }

        private void LogWarnings(OscNameListResult list)
        {
            foreach (var warning in list.Warnings)
            {
                Debug.LogWarning("OscNameListPublisher(" + address + "): " + warning.Message, this);
            }
        }

        private OscNameListOptions BuildOptions()
        {
            return new OscNameListOptions
            {
                Reserved = reservedNames != null ? reservedNames.ToArray() : Array.Empty<string>(),
                MaxCount = maxCount,
                MaxLength = maxLength,
                Label = label,
            };
        }
    }
}
