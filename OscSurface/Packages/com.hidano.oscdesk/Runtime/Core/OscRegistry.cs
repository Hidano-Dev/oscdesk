// OscRegistry.cs — 受け手の登録・解除と変化の通知(DESIGN.md D-107)。UnityEngine に依存しない。
using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>登録 1 件。アドレスと、それを受ける操作・持ち主。</summary>
    public sealed class OscRegistryEntry
    {
        public string Address { get; }
        public OscOperation Operation { get; }

        /// <summary>登録した受け手(Unity では OscTarget)。警告で持ち主を示すのに使う。</summary>
        public object Owner { get; }

        public string PackageName { get; }
        public string TargetName { get; }

        /// <summary>振り分けの型の変換に使う行(OscDispatcher と同じ変換を通すため)。</summary>
        public OscBindingRow Row { get; }

        public OscRegistryEntry(string address, OscOperation operation, object owner, string packageName = null, string targetName = null)
        {
            Address = address ?? string.Empty;
            Operation = operation ?? throw new ArgumentNullException(nameof(operation));
            Owner = owner;
            PackageName = packageName ?? string.Empty;
            TargetName = targetName ?? string.Empty;
            var isRecord = operation.Kind == OscBindingKind.Record;
            Row = new OscBindingRow(Address, operation.Kind, 1, isRecord ? operation.RecordFields : null, isRecord && operation.RecordRowIds);
        }
    }

    public enum OscRegistrationResult
    {
        Registered,
        /// <summary>同じアドレスが既に登録されている。後から来た方は受け付けない(D-107)。</summary>
        Duplicate,
        /// <summary>アドレスが不正(OscBindingAudit.IsValidAddress を満たさない)。</summary>
        InvalidAddress
    }

    /// <summary>登録するアドレスの検査の強さ(D-108)。</summary>
    public enum OscAddressCheck
    {
        /// <summary>OscBindingAudit.IsValidAddress を満たすこと(OscTarget の宣言など、新しく作る登録)。</summary>
        Strict,
        /// <summary>
        /// 空でないことだけ。OscReceiver の対応表の行は、不正なアドレス(A2)でも以前は完全一致で届いていたので、
        /// Registry へ移しても同じに届くよう警告だけにとどめる。
        /// </summary>
        NonEmpty
    }

    public enum OscDeliveryOutcome
    {
        /// <summary>そのアドレスの登録が無い。何もしない(UNITY_PROTOCOL §2)。</summary>
        NoTarget,
        Delivered,
        /// <summary>登録はあるが引数の型・Record の形が合わない。処理は呼ばない。</summary>
        Mismatch,
        /// <summary>処理が失敗の理由を返した(例 "name in use")。</summary>
        Failed
    }

    /// <summary>
    /// 受け手の登録簿。アドレス 1 つに受け手 1 つ(実行中に重なったら後から来た方を受け付けない。HID-372 の合意)。
    /// 変化は C# の event で知らせる(外部ライブラリを使わない)。シーンに置かなくても Shared で使える。
    /// </summary>
    public sealed class OscRegistry
    {
        public const string ReasonTypeMismatch = "type mismatch";
        public const string ReasonRecordMismatch = "record mismatch";

        private static OscRegistry shared;

        private readonly Dictionary<string, OscRegistryEntry> entries = new Dictionary<string, OscRegistryEntry>(StringComparer.Ordinal);

        // 登録の順(パターンで複数に届けるときの順。辞書の列挙順は決まっていないため)
        private readonly List<OscRegistryEntry> ordered = new List<OscRegistryEntry>();

        // 受け付けなかった重複(アドレス → 受け付けなかった登録)。設計図に重複として載せる(HID-379)。受け付けなかった側が
        // 解除(OscTarget の無効化)を呼んだら外す。1 つのアドレスに覚える数は MaxRejectedPerAddress まで
        private readonly Dictionary<string, List<OscRegistryEntry>> rejected = new Dictionary<string, List<OscRegistryEntry>>(StringComparer.Ordinal);
        private static readonly OscRegistryEntry[] NoEntries = new OscRegistryEntry[0];

        /// <summary>1 つのアドレスについて覚えておく、受け付けなかった重複の数の上限。</summary>
        public const int MaxRejectedPerAddress = 16;

        // Deliver(address, args, out reason) が理由を集めるための使い回し。処理の中から Deliver を呼び直すと(入れ子)
        // 1 本の使い回しでは内側が外側の理由を消すので、入れ子の深さごとに別のリストを使う(PR #103 のレビュー)
        private readonly List<List<string>> scratchFailures = new List<List<string>>();
        private int deliverDepth;

        // パターンの判定 1 回で埋める表の幅の合計(登録ごとに アドレスの長さ + 1。OscAddressPattern.MaxLength を超えるものは 0)
        private long patternMatchWidth;

        /// <summary>
        /// プロセスで共有する登録簿。初めて使うときに作るので、登録の順序(どのコンポーネントが先に有効になるか)を気にしなくてよい。
        /// Unity では Play の開始ごとに ResetShared で空にする(ドメインのリロードを切った環境で前回の登録が残らないように)。
        /// </summary>
        public static OscRegistry Shared => shared ?? (shared = new OscRegistry());

        /// <summary>共有の登録簿を捨てる。次に Shared を使ったときに新しく作る。</summary>
        public static void ResetShared()
        {
            shared = null;
        }

        /// <summary>登録された(後)。</summary>
        public event Action<OscRegistryEntry> Registered;

        /// <summary>解除された(後)。</summary>
        public event Action<OscRegistryEntry> Unregistered;

        /// <summary>同じアドレスが既にあるので受け付けなかった(受け付けなかった方, 既にある方)。設計図(HID-379)で重複として載せるのに使う。</summary>
        public event Action<OscRegistryEntry, OscRegistryEntry> Rejected;

        /// <summary>受け付けなかった重複が解除された(覚えていた重複から外した後)。</summary>
        public event Action<OscRegistryEntry> RejectionWithdrawn;

        /// <summary>そのアドレスで受け付けなかった重複(受け付けなかった順)。無ければ空。</summary>
        public IReadOnlyList<OscRegistryEntry> RejectedFor(string address)
        {
            return address != null && rejected.TryGetValue(address, out var list) ? (IReadOnlyList<OscRegistryEntry>)list : NoEntries;
        }

        public int Count => entries.Count;

        /// <summary>
        /// パターン 1 通を全登録と突き合わせるときの表の幅の合計(Σ アドレスの長さ + 1。長すぎて表を作らない登録は数えない)。
        /// これにパターンのトークン数 + 1 を掛けたものが判定のマスの数で、受け口は 1 フレームの枠をそれで数える(PR #97 のセキュリティレビュー)。
        /// </summary>
        public long PatternMatchWidth => patternMatchWidth;

        private static long MatchWidthOf(OscRegistryEntry entry)
        {
            return OscAddressPattern.MatchCells(0, entry.Address.Length);
        }

        /// <summary>登録の写し(列挙中の登録・解除で壊れないよう、呼ぶたびに作る)。</summary>
        public List<OscRegistryEntry> Snapshot()
        {
            return new List<OscRegistryEntry>(ordered);
        }

        /// <summary>登録の順に並べた登録(読み取り専用。列挙中に登録・解除しないこと。Router が確保なしで回すため)。</summary>
        public IReadOnlyList<OscRegistryEntry> Ordered => ordered;

        public bool TryGet(string address, out OscRegistryEntry entry)
        {
            if (address == null)
            {
                entry = null;
                return false;
            }

            return entries.TryGetValue(address, out entry);
        }

        /// <summary>
        /// 登録する。同じアドレスが既にあれば受け付けず Duplicate を返して Rejected を知らせる。
        /// event の購読者の例外は、登録簿を書き換えた後に呼び出し側へそのまま伝わる(登録簿の状態は崩れない)。
        /// </summary>
        public OscRegistrationResult Register(OscRegistryEntry entry)
        {
            return Register(entry, OscAddressCheck.Strict);
        }

        /// <summary>アドレスの検査の強さを指定して登録する(OscReceiver の対応表は NonEmpty。D-108)。</summary>
        public OscRegistrationResult Register(OscRegistryEntry entry, OscAddressCheck check)
        {
            if (entry == null) throw new ArgumentNullException(nameof(entry));

            var valid = check == OscAddressCheck.NonEmpty ? entry.Address.Length > 0 : OscBindingAudit.IsValidAddress(entry.Address);
            if (!valid)
            {
                return OscRegistrationResult.InvalidAddress;
            }

            if (entries.TryGetValue(entry.Address, out var existing))
            {
                if (!rejected.TryGetValue(entry.Address, out var list))
                {
                    list = new List<OscRegistryEntry>();
                    rejected.Add(entry.Address, list);
                }

                if (list.Count < MaxRejectedPerAddress && !list.Contains(entry))
                {
                    list.Add(entry);
                }

                Rejected?.Invoke(entry, existing);
                return OscRegistrationResult.Duplicate;
            }

            entries.Add(entry.Address, entry);
            ordered.Add(entry);
            patternMatchWidth += MatchWidthOf(entry);
            Registered?.Invoke(entry);
            return OscRegistrationResult.Registered;
        }

        /// <summary>
        /// 解除する。そのアドレスに登録されているのがこの entry のときだけ外す(受け付けられなかった重複の解除で、先に登録した方を外さないため)。
        /// </summary>
        public bool Unregister(OscRegistryEntry entry)
        {
            if (entry == null)
            {
                return false;
            }

            if (!entries.TryGetValue(entry.Address, out var current) || !ReferenceEquals(current, entry))
            {
                // 受け付けなかった重複の解除なら、覚えていた重複から外す(先に登録した方は外さない)
                if (rejected.TryGetValue(entry.Address, out var list) && list.Remove(entry))
                {
                    if (list.Count == 0)
                    {
                        rejected.Remove(entry.Address);
                    }

                    RejectionWithdrawn?.Invoke(entry);
                }

                return false;
            }

            entries.Remove(entry.Address);
            ordered.Remove(entry);
            patternMatchWidth -= MatchWidthOf(entry);
            Unregistered?.Invoke(entry);
            return true;
        }

        /// <summary>
        /// アドレスの登録へ引数を渡す。型の変換は OscDispatcher と同じ。処理の例外は捕まえずに呼び出し側へ伝える
        /// (ログの出し方は受け口が決める。中核は UnityEngine に依存しないため)。
        /// 処理の中で登録・解除してよい(生成担当が生成したものを登録するため)。
        /// </summary>
        public OscDeliveryOutcome Deliver(string address, IReadOnlyList<object> args, out string failureReason)
        {
            failureReason = null;
            if (!TryGet(address, out var entry))
            {
                return OscDeliveryOutcome.NoTarget;
            }

            if (deliverDepth >= scratchFailures.Count)
            {
                scratchFailures.Add(new List<string>());
            }

            var failures = scratchFailures[deliverDepth];
            failures.Clear();
            deliverDepth += 1;
            try
            {
                var outcome = DeliverTo(entry, args, failures);
                failureReason = failures.Count > 0 ? failures[0] : null;
                return outcome;
            }
            finally
            {
                deliverDepth -= 1;
                failures.Clear();
            }
        }

        /// <summary>
        /// 登録 1 件へ引数を渡す。処理できなかった理由を failures に足す(引数を変換せずに受ける登録は何件も足し得る)。
        /// Mismatch / Failed のとき failures には少なくとも 1 件入る。処理の例外は捕まえない。
        /// </summary>
        public static OscDeliveryOutcome DeliverTo(OscRegistryEntry entry, IReadOnlyList<object> args, List<string> failures)
        {
            if (entry == null) throw new ArgumentNullException(nameof(entry));
            if (failures == null) throw new ArgumentNullException(nameof(failures));

            var operation = entry.Operation;
            if (operation.IsRaw)
            {
                var before = failures.Count;
                operation.RawHandler(args, failures);
                return failures.Count == before ? OscDeliveryOutcome.Delivered : OscDeliveryOutcome.Failed;
            }

            if (!OscDispatcher.TryConvert(0, entry.Row, args, out var invocation))
            {
                failures.Add(entry.Row.Kind == OscBindingKind.Record ? ReasonRecordMismatch : ReasonTypeMismatch);
                return OscDeliveryOutcome.Mismatch;
            }

            var reason = operation.Handler(invocation);
            if (reason == null)
            {
                return OscDeliveryOutcome.Delivered;
            }

            failures.Add(reason);
            return OscDeliveryOutcome.Failed;
        }
    }

    /// <summary>アドレス /パッケージ/対象/操作 を組み立てる補助(推奨の規約。コアは文字列の一致しか見ない。HID-372)。</summary>
    public static class OscAddressNames
    {
        private const string CloneSuffix = "(Clone)";

        /// <summary>
        /// アドレスの 1 段に使える名前か。空・空白・`/`・OSC のパターンの文字(`* ? [ ] { } ,`)・`#` を含むものは使えない
        /// (`#` は OSC で bundle の印。パターンの文字を含む名前は、まとめて操作するパターン(D-106)と区別できなくなる)。
        /// </summary>
        public static bool IsValidSegment(string name)
        {
            if (string.IsNullOrEmpty(name))
            {
                return false;
            }

            foreach (var c in name)
            {
                if (char.IsWhiteSpace(c) || char.IsControl(c))
                {
                    return false;
                }

                switch (c)
                {
                    case '/':
                    case '*':
                    case '?':
                    case '[':
                    case ']':
                    case '{':
                    case '}':
                    case ',':
                    case '#':
                        return false;
                }
            }

            return true;
        }

        /// <summary>/パッケージ/対象/操作。パッケージが空なら /対象/操作。</summary>
        public static string Build(string packageName, string targetName, string operationName)
        {
            var package = packageName ?? string.Empty;
            var prefix = package.Length == 0 ? string.Empty : "/" + package;
            return prefix + "/" + (targetName ?? string.Empty) + "/" + (operationName ?? string.Empty);
        }

        /// <summary>GameObject 名から末尾の (Clone) を(Instantiate を重ねたぶんも)除き、前後の空白を落とす。対象名の既定値。</summary>
        public static string StripClone(string objectName)
        {
            var name = (objectName ?? string.Empty).Trim();
            while (name.EndsWith(CloneSuffix, StringComparison.Ordinal))
            {
                name = name.Substring(0, name.Length - CloneSuffix.Length).TrimEnd();
            }

            return name;
        }
    }
}
