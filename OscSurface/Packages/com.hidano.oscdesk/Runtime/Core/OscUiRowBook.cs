using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>UI で管理する行の表記の規則(帳簿を持たない利用側も型引数なしで使えるよう、型パラメータの無い側に置く)。</summary>
    public static class OscUiRowBook
    {
        /// <summary>Name が空なら [行 ID]、あれば引用符つきの Name(同名の行があり得るので、区別が要るなら ID も併記する)。</summary>
        public static string Label(string id, string name)
        {
            return string.IsNullOrEmpty(name) ? "[" + id + "]" : "\"" + name + "\"";
        }

        /// <summary>レコードの行の表記(<see cref="OscRecord.Id"/> と <see cref="OscRecord.Key"/>)。</summary>
        public static string Label(OscRecord record)
        {
            if (record == null) throw new ArgumentNullException(nameof(record));
            return Label(record.Id, record.Key);
        }
    }

    /// <summary>
    /// キーの一覧を OscDesk の画面で管理するレコード(<c>keysFrom.source</c> が <c>"ui"</c>。D-075 / D-087)の帳簿(D-099)。
    /// <list type="bullet">
    /// <item>並び順と削除の正は、OscDesk が <c>keysFrom.address</c> へ送る行 ID の一覧(<see cref="SetIds"/>)。一覧から消えた ID の値は捨てる</item>
    /// <item>値は行 ID ごとに持つ。一覧に無い ID の値も次の一覧までは持つ(一覧より先に値が届く順序の入れ替わりに備える)</item>
    /// <item>Name は値と一緒に届く表示名。改名は同じ ID の値が新しい Name で届き直すだけなので、行は作り直さない</item>
    /// <item>行 ID ごとに一度振った連番(<see cref="SerialOf"/>)を使い続ける。並べ替え・改名をまたいで行と実体の割り当てを引き継ぐため。
    /// 消した行の番号も振り直さない(後から別の行に同じ番号が付くと、古い割り当てを別の行が引き継いでしまう)</item>
    /// <item>一覧を一度も受けていない間(<see cref="HasIds"/> が false)は、利用側が適用しない前提(ブリッジは再送のとき一覧を値より先に送る)</item>
    /// </list>
    /// 値の検証と適用は案件ごとに違うので利用側が書く(<see cref="Ids"/> の順に <see cref="TryGet"/> で読む)。スレッドセーフではない。
    /// </summary>
    public sealed class OscUiRowBook<T>
    {
        private readonly Dictionary<string, Row> rows = new Dictionary<string, Row>(StringComparer.Ordinal);
        private readonly Dictionary<string, int> serials = new Dictionary<string, int>(StringComparer.Ordinal);
        private readonly Dictionary<int, string> idsBySerial = new Dictionary<int, string>();
        private List<string> ids = new List<string>();

        /// <summary>行 ID の一覧を一度でも受けたか。受ける前は適用しない。</summary>
        public bool HasIds { get; private set; }

        /// <summary>直近に受けた行 ID の一覧(空と重複を落としたもの)。</summary>
        public IReadOnlyList<string> Ids => ids.AsReadOnly();

        /// <summary>値を保持している行の数(一覧に無い ID の値を含む)。</summary>
        public int Count => rows.Count;

        /// <summary>次に振る連番。これまでに振った番号はすべてこれより小さい(利用側が番号の範囲を確保するときに使う)。</summary>
        public int NextSerial { get; private set; } = 1;

        /// <summary>一覧の順の表示(<see cref="LabelOf"/>)。値がまだ届いていない行は Name が分からないので [行 ID] で示す。</summary>
        public IReadOnlyList<string> Labels
        {
            get
            {
                var labels = new List<string>(ids.Count);
                foreach (var id in ids) labels.Add(LabelOf(id));
                return labels.AsReadOnly();
            }
        }

        /// <summary>一覧を受けていて、一覧の全行が値を持つか(再送の自動適用はこのときだけ行う、という使い方を想定)。空の一覧は true。</summary>
        public bool IsComplete
        {
            get
            {
                if (!HasIds) return false;
                foreach (var id in ids)
                {
                    if (!rows.ContainsKey(id)) return false;
                }

                return true;
            }
        }

        /// <summary>
        /// 行 ID の一覧で置き換える。空文字・null と重複は落とす(ブリッジは送らないが、Strings の行は任意の s を受ける)。
        /// 一覧から消えた ID の値は捨てる(OscDesk で消した行)。連番は捨てない。戻り値は初回か、並び・中身が変わったか。
        /// </summary>
        public bool SetIds(IReadOnlyList<string> received)
        {
            var next = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (received != null)
            {
                foreach (var id in received)
                {
                    if (!string.IsNullOrEmpty(id) && seen.Add(id)) next.Add(id);
                }
            }

            var changed = !HasIds || !SameSequence(next, ids);
            HasIds = true;
            ids = next;
            // 新しい ID の連番は一覧の順で振る(値の届いた順や利用側の呼び順で振ると、UDP の届き方で行と実体の割り当てが実行ごとに変わる)
            foreach (var id in next) SerialOf(id);
            foreach (var id in new List<string>(rows.Keys))
            {
                if (!seen.Contains(id)) rows.Remove(id);
            }

            return changed;
        }

        /// <summary>
        /// 行の値を保持する(同じ ID の値は置き換える)。戻り値は、同じ ID で保持していた値から Name が変わったか(改名。ログ用)。
        /// ID が null・空なら保持せず false(行 ID の無い行を正しい行として扱わないため)。
        /// 一覧に無い ID も保持する(一覧と値の UDP の順序が入れ替わると、追加した行の値が一覧より先に届くため)。そのため消した行の値が
        /// 遅れて届くと次の一覧まで <see cref="TryGet"/> で読めるので、適用は <see cref="Ids"/> の順に回して行う。
        /// </summary>
        public bool Store(string id, string name, T value)
        {
            if (string.IsNullOrEmpty(id)) return false;
            name = name ?? string.Empty;
            var renamed = rows.TryGetValue(id, out var previous) && !string.Equals(previous.Name, name, StringComparison.Ordinal);
            rows[id] = new Row(name, value);
            return renamed;
        }

        /// <summary><see cref="OscRecord.Id"/> を行 ID、<see cref="OscRecord.Key"/> を Name として保持する(Record Row Ids の行で受けたレコード)。</summary>
        public bool Store(OscRecord record, T value)
        {
            if (record == null) throw new ArgumentNullException(nameof(record));
            return Store(record.Id, record.Key, value);
        }

        public bool TryGet(string id, out T value)
        {
            if (id != null && rows.TryGetValue(id, out var row))
            {
                value = row.Value;
                return true;
            }

            value = default;
            return false;
        }

        /// <summary>値と一緒に届いた Name。値が届いていない行は false。</summary>
        public bool TryGetName(string id, out string name)
        {
            if (id != null && rows.TryGetValue(id, out var row))
            {
                name = row.Name;
                return true;
            }

            name = null;
            return false;
        }

        /// <summary>
        /// 行 ID の連番(1 始まり)。一覧に載った ID には <see cref="SetIds"/> が一覧の順で振る。一覧に無い ID は初めて聞かれたときに
        /// 次の番号を振る。以後は同じ番号を返す。
        /// </summary>
        public int SerialOf(string id)
        {
            if (string.IsNullOrEmpty(id)) throw new ArgumentException("行 ID が空です。", nameof(id));
            if (!serials.TryGetValue(id, out var serial))
            {
                serial = NextSerial++;
                serials.Add(id, serial);
                idsBySerial.Add(serial, id);
            }

            return serial;
        }

        /// <summary>連番から行 ID を引き直す(適用した結果をログに出すときなど)。振っていない番号は false。</summary>
        public bool TryGetIdOfSerial(int serial, out string id)
        {
            return idsBySerial.TryGetValue(serial, out id);
        }

        /// <summary>ログ・インスペクタ用の行の表記。Name が分かれば "Name"、分からなければ [行 ID]。</summary>
        public string LabelOf(string id)
        {
            return OscUiRowBook.Label(id, TryGetName(id, out var name) ? name : null);
        }

        private static bool SameSequence(List<string> a, List<string> b)
        {
            if (a.Count != b.Count) return false;
            for (var i = 0; i < a.Count; i++)
            {
                if (!string.Equals(a[i], b[i], StringComparison.Ordinal)) return false;
            }

            return true;
        }

        private readonly struct Row
        {
            public readonly string Name;
            public readonly T Value;

            public Row(string name, T value)
            {
                Name = name;
                Value = value;
            }
        }
    }
}
