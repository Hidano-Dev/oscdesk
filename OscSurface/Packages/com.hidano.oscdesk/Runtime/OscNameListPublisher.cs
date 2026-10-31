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
        private const float RetryDelaySeconds = 1f;

        private float nextRefreshAt;
        private bool dirty;
        private float dirtyNotBefore;
        private bool warnedMissingReceiver;

        // 最後に警告を出した一覧と警告の文の組。周期で作り直すたびに同じ警告を積まず、警告が変わったら(一覧が同じでも)出す
        private string lastReported;

        // 要求に応えた最後のフレーム。LAN の相手が request を連打しても(1 つの bundle に何千個詰めても)、
        // 1 フレームに 1 回だけ作り直して送る(同じフレームの一覧は同じなので、まとめても結果は変わらない)
        private int lastRequestFrame = -1;

        /// <summary>送れたとき(SendNow・周期・MarkDirty のどれでも)に、送った一覧の結果を渡して呼ぶ。</summary>
        public event Action<OscNameListResult> Sent;

        /// <summary>送り先を変えると、前回送れた記録と警告の抑えを消す(新しい送り先へは同じ一覧でも送る)。</summary>
        public OscReceiver Receiver
        {
            get { return receiver; }
            set
            {
                if (receiver != value) ForgetDelivery();
                receiver = value;
                warnedMissingReceiver = false;
            }
        }

        /// <summary>送り先を変えると、前回送れた記録と警告の抑えを消す(新しいアドレスへは同じ一覧でも送る)。</summary>
        public string Address
        {
            get { return address; }
            set
            {
                value = value ?? string.Empty;
                if (!string.Equals(address, value, StringComparison.Ordinal)) ForgetDelivery();
                address = value;
            }
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

        /// <summary>供給元を足す。複数あれば足した順に結合し、同名は先に足したものが勝つ。例外を投げた供給元は、最後に返せた一覧(まだ無ければ空)を使う。</summary>
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
            if (Time.frameCount == lastRequestFrame) return;
            lastRequestFrame = Time.frameCount;
            Publish(false, "request", out _);
        }

        /// <summary>
        /// 一覧を作り直して、前回送れた一覧と違うときだけ送る。送れたら true。
        /// 供給元の変化を自分で知ったとき(項目の追加・削除のイベント)は、これか MarkDirty を呼ぶ。
        /// </summary>
        public bool RefreshIfChanged()
        {
            return Publish(true, "changed", out _);
        }

        /// <summary>次のフレームの Update で RefreshIfChanged を行う(同じフレームに何度呼んでも 1 回)。</summary>
        public void MarkDirty()
        {
            dirty = true;
            dirtyNotBefore = 0f;
        }

        // 追加したとき、同じ GameObject の OscReceiver を Receiver に入れる
        private void Reset()
        {
            receiver = GetComponent<OscReceiver>();
        }

        private void OnEnable()
        {
            if (receiver == null) receiver = GetComponent<OscReceiver>();
            if (receiver == null) WarnMissingReceiver();

            // 初回は 1 周期待つ。ブリッジは到達の初報で要求を送るので、起動直後にこちらから送らなくても一覧は届く
            nextRefreshAt = Time.realtimeSinceStartup + refreshIntervalSeconds;
            if (!OscStringList.TryValidate(address, Array.Empty<string>(), out var reason))
            {
                Debug.LogWarning("OscNameListPublisher: " + reason, this);
            }
        }

        private void Update()
        {
            var now = Time.realtimeSinceStartup;
            var due = refreshIntervalSeconds > 0f && now >= nextRefreshAt;
            if (!due && !(dirty && now >= dirtyNotBefore)) return;

            if (due) nextRefreshAt = Time.realtimeSinceStartup + refreshIntervalSeconds;

            // 待ち受けていない間は送れないので試みない(SendStrings の警告を周期ごとに重ねない)。
            // MarkDirty の印は残し、待ち受けが始まったフレームで送る(周期なしの使い方で変化を落とさない)。
            // Receiver が未設定のことは有効化のときに警告している
            if (receiver == null || !receiver.isActiveAndEnabled || !receiver.IsListening) return;

            // 送り出しに失敗した変化は印を残し、1 秒おいて送り直す(周期なしの使い方で、返信先が直った後に送れるように。
            // 毎フレーム試みると SendStrings の警告がフレームごとに積まれる)
            Publish(true, "changed", out var retry);
            dirty = retry;
            if (retry) dirtyNotBefore = Time.realtimeSinceStartup + RetryDelaySeconds;
        }

        // retry は「送るべき変化があったのに、送り出し(ソケット・返信先)で失敗した」とき true
        private bool Publish(bool onlyIfChanged, string cause, out bool retry)
        {
            retry = false;

            // 無効にした部品は、UnityEvent から呼ばれる SendNow でも送らない(周期の作り直しと揃える)
            if (!isActiveAndEnabled) return false;
            if (receiver == null)
            {
                WarnMissingReceiver();
                return false;
            }

            feed.Options = BuildOptions();
            var list = feed.Build();

            // 警告は一覧か警告の文が変わったときだけ出す(要求のときは毎回)。一覧が同じでも、供給元が壊れて前回の一覧を
            // 使い始めたことや、新しく除いた名前は知らせる。送れないまま同じ一覧を周期で作り直しても同じ警告を積まない
            var signature = Signature(list);
            var report = !onlyIfChanged || !string.Equals(signature, lastReported, StringComparison.Ordinal);
            if (report)
            {
                lastReported = signature;
                foreach (var warning in list.Warnings)
                {
                    Debug.LogWarning("OscNameListPublisher(" + address + "): " + warning.Message, this);
                }
            }

            if (onlyIfChanged && !feed.IsChanged(list.Names)) return false;

            // 中身のせいで送れない一覧(大きすぎる・アドレスが不正)は、送る前に分けて SendStrings を呼ばない(送り直しても同じ)。
            // 送り出しの失敗(ソケット・返信先)は一時的なことがあるので記録せず、次の機会にもう一度送る
            if (!OscStringList.TryValidate(address, list.Names, out var reason))
            {
                if (report) Debug.LogWarning("OscNameListPublisher: 一覧を送りませんでした(" + address + "): " + reason, this);
                return false;
            }

            if (!receiver.SendStrings(address, list.Names))
            {
                retry = true;
                return false;
            }

            feed.MarkSent(list.Names);
            if (logSends)
            {
                Debug.Log("OscNameListPublisher: " + list.Names.Count + " 件を " + address + " へ送りました(" + cause + ")", this);
            }

            try
            {
                Sent?.Invoke(list);
            }
            catch (Exception exception)
            {
                // 購読者の例外で周期の作り直しを止めない
                Debug.LogException(exception, this);
            }

            return true;
        }

        private void ForgetDelivery()
        {
            feed.Reset();
            lastReported = null;
        }

        // 名前は正規化で制御文字を除いてあるので、NUL を区切りに使える
        private static string Signature(OscNameListResult list)
        {
            var builder = new System.Text.StringBuilder();
            foreach (var name in list.Names) builder.Append(name).Append('\0');
            builder.Append('\u0001');
            foreach (var warning in list.Warnings) builder.Append(warning.Message).Append('\0');
            return builder.ToString();
        }

        private void WarnMissingReceiver()
        {
            if (warnedMissingReceiver) return;
            warnedMissingReceiver = true;
            Debug.LogWarning("OscNameListPublisher: Receiver が未設定なので一覧を送れません(" + address + ")", this);
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
