using System;
using System.Collections.Generic;

namespace OscDesk.Receiver
{
    /// <summary>
    /// キーの一覧を Unity が持つレコード(<c>keysFrom</c> が Unity 側の一覧。D-059 / D-062)の、キーごとの保持値と適用待ちの帳簿(D-099)。
    /// 値は届いた時点で保持するだけで、適用は利用側がトリガ(または再送の自動適用)で行う前提の部品。
    /// <list type="bullet">
    /// <item>保持値: キーごとの直近の値。いまシーンに居ないキーの値も捨てずに持つ(居ない対象の設定を失わない。D-062 と同じ考え方)</item>
    /// <item>窓の中で値が届いたキー: <see cref="Store"/> の <c>inWindow</c> で印を付け、再送の窓が閉じたときの自動適用の対象にする。
    /// 窓の判定(いつ開いていつ閉じるか)は利用側が持ち、ここには真偽値で渡す(窓の型に依存しないため)</item>
    /// <item>適用を待つキー: 適用を求められたが対象がまだ居なかった(起動待ち・シーンに居ない)キー。対象が現れたら利用側がその時点の保持値で適用する</item>
    /// <item>居ないキーの警告: 同じキーで毎回警告するとログが埋まるので、現れるまで 1 回に絞る</item>
    /// </list>
    /// キーは初めて値か適用要求を受けた順に並べ、取り出しもその順で返す(ログと適用順を決定的にするため。辞書の列挙順に任せると実行ごとに変わり得る)。
    /// キーは大文字・小文字を区別する(OscDesk はキーを文字どおり送る)。スレッドセーフではない(メインスレッドから使う)。
    /// </summary>
    public sealed class OscKeyedBook<T>
    {
        private readonly Dictionary<string, T> values = new Dictionary<string, T>(StringComparer.Ordinal);
        private readonly List<string> order = new List<string>();
        private readonly HashSet<string> known = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> touched = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> awaiting = new HashSet<string>(StringComparer.Ordinal);
        private readonly HashSet<string> warnedAbsent = new HashSet<string>(StringComparer.Ordinal);

        /// <summary>保持値を持つキーの数。</summary>
        public int Count => values.Count;

        /// <summary>窓の中で値が届き、まだ取り出していないキーの数。</summary>
        public int TouchedCount => touched.Count;

        /// <summary>適用を待っているキーの数。</summary>
        public int AwaitingCount => awaiting.Count;

        /// <summary>
        /// 知っているキー(値・適用要求・<see cref="Track"/> のどれかを受けたもの)を初めて受けた順に並べたもの。
        /// 利用側が自前の表(案件固有の待ちなど)を同じ順で回すときに使う。帳簿の中身を写さない読み取り専用の窓なので、
        /// 列挙しながら新しいキーを載せる(<see cref="Store"/> / <see cref="Track"/> / <see cref="Await"/>)ときは先に写す。
        /// </summary>
        public IReadOnlyList<string> Keys => order.AsReadOnly();

        public bool TryGet(string key, out T value)
        {
            if (key == null)
            {
                value = default;
                return false;
            }

            return values.TryGetValue(key, out value);
        }

        /// <summary>
        /// 値を保持する(同じキーの値は置き換える)。<paramref name="inWindow"/> が true なら、窓の自動適用の対象として印を付ける。
        /// キーが null・空なら例外にする(空のキーで保持すると、レコードを読み損ねた行を正しい行として適用してしまうため)。
        /// </summary>
        public void Store(string key, T value, bool inWindow)
        {
            RequireKey(key);
            Remember(key);
            values[key] = value;
            if (inWindow) touched.Add(key);
        }

        /// <summary>値を持たないまま、キーを並び順にだけ載せる(利用側の表のキーを <see cref="Keys"/> の順に含めるため)。null・空は無視する。</summary>
        public void Track(string key)
        {
            if (string.IsNullOrEmpty(key)) return;
            Remember(key);
        }

        public bool IsTouched(string key)
        {
            return key != null && touched.Contains(key);
        }

        /// <summary>窓が開き直ったとき・トリガで閉じたときに、窓で集めた印を忘れる(保持値は残す)。</summary>
        public void ClearTouched()
        {
            touched.Clear();
        }

        /// <summary>窓の中で値が届いたキーを、初めて受けた順に取り出して印を忘れる。</summary>
        public List<string> TakeTouched()
        {
            var result = new List<string>(touched.Count);
            if (touched.Count == 0) return result;
            foreach (var key in order)
            {
                if (touched.Contains(key)) result.Add(key);
            }

            touched.Clear();
            return result;
        }

        /// <summary>適用を、そのキーの対象が現れるまで待たせる。null・空は無視する。</summary>
        public void Await(string key)
        {
            if (string.IsNullOrEmpty(key)) return;
            Remember(key);
            awaiting.Add(key);
        }

        public bool IsAwaiting(string key)
        {
            return key != null && awaiting.Contains(key);
        }

        /// <summary>待ちを取り消す(対象が現れる前に別の経路で適用した、または適用をやめたとき)。待っていたなら true。</summary>
        public bool CancelAwait(string key)
        {
            return key != null && awaiting.Remove(key);
        }

        /// <summary>待っているキーのうち <paramref name="present"/> に含まれるものを、初めて受けた順に取り出して待ちから外す。</summary>
        public List<string> TakeAppeared(ICollection<string> present)
        {
            var result = new List<string>();
            if (awaiting.Count == 0 || present == null) return result;
            foreach (var key in order)
            {
                if (awaiting.Contains(key) && present.Contains(key)) result.Add(key);
            }

            foreach (var key in result) awaiting.Remove(key);
            return result;
        }

        /// <summary>
        /// 居ないキーの警告を 1 回に絞る。初回だけ true。<see cref="ResetAbsentWarnings"/> で現れたキーを戻すので、
        /// 後でまた居なくなったときに再び 1 回警告する。null・空は常に false。
        /// </summary>
        public bool ShouldWarnAbsent(string key)
        {
            return !string.IsNullOrEmpty(key) && warnedAbsent.Add(key);
        }

        /// <summary><paramref name="present"/> に含まれるキーの警告済みの印を外す。</summary>
        public void ResetAbsentWarnings(ICollection<string> present)
        {
            if (present == null || warnedAbsent.Count == 0) return;
            warnedAbsent.RemoveWhere(present.Contains);
        }

        private void Remember(string key)
        {
            if (known.Add(key)) order.Add(key);
        }

        private static void RequireKey(string key)
        {
            if (key == null) throw new ArgumentNullException(nameof(key));
            if (key.Length == 0) throw new ArgumentException("キーが空です。", nameof(key));
        }
    }
}
