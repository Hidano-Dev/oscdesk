// OscTarget.cs — 拡張パッケージが継承する受け手の基底(DESIGN.md D-107)。
// 有効になったら自分の操作を OscRegistry に登録し、無効になったら外す。
using System;
using System.Collections.Generic;
using UnityEngine;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 受け手の基底コンポーネント。派生クラスは DeclareOperations で操作(名前・型・制約・表示ヒント・処理)を宣言する。
    /// アドレスは /パッケージ名/対象名/操作名。対象名はインスペクタの欄で決め、空なら GameObject 名から (Clone) を除いたもの。
    /// OnDestroy でなく OnDisable で外すのは、非アクティブになったものへ命令を届けないため(破棄のときも OnDisable が先に呼ばれる)。
    /// 派生クラスで OnEnable / OnDisable を書くときは base を呼ぶ。
    /// </summary>
    public abstract class OscTarget : MonoBehaviour
    {
        [Tooltip("アドレスの 1 段目(/パッケージ名/対象名/操作名)。空なら派生クラスの既定。空白・/・* ? [ ] { } , # は使えない。")]
        [SerializeField] private string packageName = string.Empty;

        [Tooltip("アドレスの 2 段目。空なら GameObject 名から (Clone) を除いたもの。同じアドレスが実行中に重なったら、後から有効になった方は受け付けられない。")]
        [SerializeField] private string targetName = string.Empty;

        private readonly List<OscRegistryEntry> registered = new List<OscRegistryEntry>();
        private int rejectedCount;
        private bool isRegistered;
        private string registeredPackage;
        private string registeredTarget;

        /// <summary>派生クラスの既定のパッケージ名(インスペクタの欄が空のとき)。</summary>
        protected virtual string DefaultPackageName => string.Empty;

        /// <summary>アドレスの 1 段目。有効な間に変えると登録し直す。</summary>
        public string PackageName
        {
            get { return string.IsNullOrEmpty(packageName) ? DefaultPackageName ?? string.Empty : packageName; }
            set
            {
                if (packageName != value)
                {
                    packageName = value ?? string.Empty;
                    ReregisterIfActive();
                }
            }
        }

        /// <summary>アドレスの 2 段目(実際に使う値)。有効な間に変えると登録し直す。</summary>
        public string TargetName
        {
            get { return string.IsNullOrEmpty(targetName) ? OscAddressNames.StripClone(gameObject.name) : targetName; }
            set
            {
                if (targetName != value)
                {
                    targetName = value ?? string.Empty;
                    ReregisterIfActive();
                }
            }
        }

        /// <summary>インスペクタの欄の値そのもの(空なら GameObject 名を使う)。</summary>
        public string TargetNameField => targetName;

        /// <summary>今 Registry に載っている登録。</summary>
        public IReadOnlyList<OscRegistryEntry> Registrations => registered;

        /// <summary>有効で、宣言したすべての操作が登録できているか(重複や不正なアドレスで外れたものが無いか)。</summary>
        public bool IsFullyRegistered => isRegistered && rejectedCount == 0;

        /// <summary>受け付ける操作を宣言する。有効化のたびに呼ぶので、宣言は毎回同じにする。</summary>
        protected abstract void DeclareOperations(OscOperationList operations);

        /// <summary>宣言した操作から登録を作る(Registry には載せない)。インスペクタでアドレスを見せるのにも使う。</summary>
        public List<OscRegistryEntry> CreateEntries()
        {
            var list = new OscOperationList();
            DeclareOperations(list);
            var package = PackageName;
            var target = TargetName;
            var entries = new List<OscRegistryEntry>(list.Operations.Count);
            foreach (var operation in list.Operations)
            {
                entries.Add(new OscRegistryEntry(OscAddressNames.Build(package, target, operation.Name), operation, this, package, target));
            }

            return entries;
        }

        protected virtual void OnEnable()
        {
            Register();
        }

        protected virtual void OnDisable()
        {
            Unregister();
        }

        /// <summary>
        /// Play 中にインスペクタで Package Name / Target Name を変えたときも登録し直す。インスペクタはシリアライズしたフィールドを
        /// 直接書き換え、プロパティの setter を通らないため(PR #99 の指摘)。派生クラスで書くときは base を呼ぶ。
        /// </summary>
        protected virtual void OnValidate()
        {
            if (isRegistered && Application.isPlaying
                && (!string.Equals(registeredPackage, PackageName, StringComparison.Ordinal)
                    || !string.Equals(registeredTarget, TargetName, StringComparison.Ordinal)))
            {
                ReregisterIfActive();
            }
        }

        // 制御文字(NUL など)をそのままログに渡すと、そこで文が切れて読めなくなるので \uXXXX にする
        private static string Printable(string text)
        {
            var builder = new System.Text.StringBuilder(text.Length);
            foreach (var c in text)
            {
                if (char.IsControl(c))
                {
                    builder.Append("\\u").Append(((int)c).ToString("x4"));
                }
                else
                {
                    builder.Append(c);
                }
            }

            return builder.ToString();
        }

        private static bool HasValidNames(OscRegistryEntry entry)
        {
            return (entry.PackageName.Length == 0 || OscAddressNames.IsValidSegment(entry.PackageName))
                && OscAddressNames.IsValidSegment(entry.TargetName)
                && OscAddressNames.IsValidSegment(entry.Operation.Name);
        }

        private void ReregisterIfActive()
        {
            if (isRegistered)
            {
                Unregister();
                Register();
            }
        }

        private void Register()
        {
            Unregister();
            isRegistered = true;
            rejectedCount = 0;
            registeredPackage = PackageName;
            registeredTarget = TargetName;

            List<OscRegistryEntry> entries;
            try
            {
                entries = CreateEntries();
            }
            catch (Exception exception)
            {
                // 派生クラスの宣言の例外で、ほかのコンポーネントの有効化を止めない
                rejectedCount = 1;
                Debug.LogException(exception, this);
                return;
            }

            var registry = OscRegistry.Shared;
            foreach (var entry in entries)
            {
                OscRegistrationResult result;
                try
                {
                    // アドレス全体の検査(IsValidAddress)は途中の / や # や NUL を通すので、名前は段ごとに検査する(D-107 の名前の約束。
                    // "a/b" を対象名にすると /fx/a/b/stop として載り、/fx/*/stop で操作できなくなるため)
                    result = HasValidNames(entry) ? registry.Register(entry) : OscRegistrationResult.InvalidAddress;
                }
                catch (Exception exception)
                {
                    // 購読者の例外。登録簿は書き換え済みなので、載ったかどうかで扱いを決める
                    Debug.LogException(exception, this);
                    result = registry.TryGet(entry.Address, out var current) && ReferenceEquals(current, entry)
                        ? OscRegistrationResult.Registered
                        : OscRegistrationResult.Duplicate;
                }

                switch (result)
                {
                    case OscRegistrationResult.Registered:
                        registered.Add(entry);
                        break;
                    case OscRegistrationResult.Duplicate:
                        rejectedCount += 1;
                        registry.TryGet(entry.Address, out var existing);
                        var owner = existing != null ? existing.Owner as UnityEngine.Object : null;
                        Debug.LogWarning("OscTarget: " + entry.Address + " は既に登録されているので受け付けませんでした(先に登録: "
                            + (owner != null ? owner.name : "不明") + ")。対象名を変えてください。", this);
                        break;
                    default:
                        rejectedCount += 1;
                        Debug.LogWarning("OscTarget: アドレス \"" + Printable(entry.Address) + "\" が不正なので登録しませんでした"
                            + "(パッケージ名・対象名・操作名に空白・/・* ? [ ] { } , # を使わず、/sys・/oscdesk 以外にしてください)。", this);
                        break;
                }
            }
        }

        private void Unregister()
        {
            if (!isRegistered)
            {
                return;
            }

            isRegistered = false;
            // 共有の登録簿が Play の開始で作り直されていても、Unregister は自分の登録でなければ何もしないので安全
            var registry = OscRegistry.Shared;
            foreach (var entry in registered)
            {
                try
                {
                    registry.Unregister(entry);
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception, this);
                }
            }

            registered.Clear();
            rejectedCount = 0;
        }
    }
}
