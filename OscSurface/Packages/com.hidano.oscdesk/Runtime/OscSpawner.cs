// OscSpawner.cs — 名前を付けて Prefab を生成・破棄する受け手(DESIGN.md D-107)。
// 例: /effect/spawner/spawn ,s "spark1" で生成し、生成したものの OscTarget は対象名 spark1 で登録する(/effect/spark1/stop)。
using System.Collections.Generic;
using UnityEngine;

namespace OscDesk.Receiver
{
    /// <summary>
    /// 生成担当。名前の番号はコントローラーが振る(HID-372 の合意)ので、ここでは渡された名前をそのまま使い、番号を振らない。
    /// 既に使われている名前なら生成せず失敗("name in use")を返す(受け口が /sys/failed で知らせる。HID-375)。
    /// </summary>
    [AddComponentMenu("OscDesk/Osc Spawner")]
    public class OscSpawner : OscTarget
    {
        public const string SpawnOperation = "spawn";
        public const string DestroyOperation = "destroy";

        public const string ReasonNameInUse = "name in use";
        public const string ReasonInvalidName = "invalid name";
        public const string ReasonNotFound = "not found";
        public const string ReasonNoPrefab = "no prefab";
        public const string ReasonTooMany = "too many";
        public const string ReasonRateLimited = "rate limited";
        public const string ReasonInactiveParent = "inactive parent";

        [Tooltip("生成する Prefab。生成したものとその子の OscTarget は、命令で渡された名前を対象名にして登録する。"
            + "Prefab(やシーンのひな形)の根が非アクティブでも、生成したものは有効にする。")]
        [SerializeField] private GameObject prefab;

        [Tooltip("生成したものを置く親。空ならシーンの直下。")]
        [SerializeField] private Transform parent;

        [Tooltip("この生成担当が同時に残しておける数の上限。認証の無い LAN から新しい名前を送り続けられても、GameObject とメモリが"
            + "増え続けないようにする。超えた生成は \"too many\" で失敗する。")]
        [SerializeField, Min(1)] private int maxInstances = 64;

        [Tooltip("1 フレームに生成できる数の上限。1 つの bundle に生成の命令を詰められても、そのフレームが止まらないようにする。"
            + "超えた生成は \"rate limited\" で失敗する(コントローラーが送り直す)。")]
        [SerializeField, Min(1)] private int maxSpawnsPerFrame = 8;

        private int spawnFrame = -1;
        private int spawnsThisFrame;

        private readonly Dictionary<string, GameObject> spawned = new Dictionary<string, GameObject>(System.StringComparer.Ordinal);
        private GameObject holder;

        public GameObject Prefab
        {
            get { return prefab; }
            set { prefab = value; }
        }

        public Transform Parent
        {
            get { return parent; }
            set { parent = value; }
        }

        /// <summary>同時に残しておける数の上限(1 以上)。</summary>
        public int MaxInstances
        {
            get { return maxInstances; }
            set { maxInstances = Mathf.Max(1, value); }
        }

        /// <summary>1 フレームに生成できる数の上限(1 以上)。</summary>
        public int MaxSpawnsPerFrame
        {
            get { return maxSpawnsPerFrame; }
            set { maxSpawnsPerFrame = Mathf.Max(1, value); }
        }

        /// <summary>生成して残っているもの(名前 → インスタンス)。破棄されたものは除く。</summary>
        public IReadOnlyDictionary<string, GameObject> Spawned
        {
            get
            {
                Prune();
                return spawned;
            }
        }

        protected override void DeclareOperations(OscOperationList operations)
        {
            // 設計図には kind trigger・type s で載せる(保持値として再送させない。HID-385 は末尾の /spawn・/destroy と s 1 個で認識する。D-114)
            operations.Add(SpawnOperation, OscBindingKind.String, invocation => TrySpawn(invocation.StringValue, out _)).AsCommand();
            operations.Add(DestroyOperation, OscBindingKind.String, invocation => TryDestroy(invocation.StringValue)).AsCommand();
        }

        /// <summary>名前を付けて生成する。成功なら null、失敗なら理由を返す。</summary>
        public string TrySpawn(string targetName, out GameObject instance)
        {
            instance = null;
            if (!OscAddressNames.IsValidSegment(targetName))
            {
                return ReasonInvalidName;
            }

            if (prefab == null)
            {
                Debug.LogWarning("OscSpawner: Prefab が設定されていないので " + targetName + " を生成しませんでした。", this);
                return ReasonNoPrefab;
            }

            Prune();
            if (spawned.ContainsKey(targetName))
            {
                return ReasonNameInUse;
            }

            if (spawned.Count >= maxInstances)
            {
                return ReasonTooMany;
            }

            if (spawnFrame != Time.frameCount)
            {
                spawnFrame = Time.frameCount;
                spawnsThisFrame = 0;
            }

            if (spawnsThisFrame >= maxSpawnsPerFrame)
            {
                return ReasonRateLimited;
            }

            if (parent != null && !parent.gameObject.activeInHierarchy)
            {
                // 非アクティブな親の下では OscTarget が有効にならず、何も登録されないのに成功を返してしまうため
                return ReasonInactiveParent;
            }

            spawnsThisFrame += 1;

            // 非アクティブな入れ物の下に生成して、OnEnable(登録)より前に対象名を入れる。
            // そのまま生成すると、Prefab の名前で一度登録されてから付け直しになり、その間に別の対象と重なり得るため
            var stage = Holder();
            instance = Instantiate(prefab, stage.transform, false);
            instance.name = prefab.name + " " + targetName;
            var targets = instance.GetComponentsInChildren<OscTarget>(true);
            foreach (var target in targets)
            {
                target.TargetName = targetName;
            }

            // 生成元の根が非アクティブ(シーンに隠したひな形など)だと、写しも非アクティブのままで登録されない。
            // 入れ物が非アクティブな間に根を有効にしておき、親へ移した時点で有効化(登録)させる(PR #99 の指摘)
            instance.SetActive(true);
            instance.transform.SetParent(parent, false);

            // 有効になった受け手の登録が 1 つでも重なったら、名前が使われている(シーンに同名の対象がある等)ので取り消す
            foreach (var target in targets)
            {
                if (target.isActiveAndEnabled && !target.IsFullyRegistered)
                {
                    instance.SetActive(false); // 先に登録を外す(Destroy はフレームの終わりまで遅れる)
                    Destroy(instance);
                    instance = null;
                    return ReasonNameInUse;
                }
            }

            spawned.Add(targetName, instance);
            return null;
        }

        /// <summary>名前で生成したものを破棄する。成功なら null、失敗なら理由を返す。</summary>
        public string TryDestroy(string targetName)
        {
            Prune();
            if (targetName == null || !spawned.TryGetValue(targetName, out var instance))
            {
                return ReasonNotFound;
            }

            spawned.Remove(targetName);
            // Destroy はフレームの終わりまで遅れるので、先に無効にして登録を外す(同じフレームで同じ名前を生成し直せるように)
            instance.SetActive(false);
            Destroy(instance);
            return null;
        }

        protected virtual void OnDestroy()
        {
            if (holder != null)
            {
                Destroy(holder);
                holder = null;
            }
        }

        private GameObject Holder()
        {
            if (holder == null)
            {
                holder = new GameObject("OscSpawner stage") { hideFlags = HideFlags.HideAndDontSave };
                holder.SetActive(false);
            }

            return holder;
        }

        // 利用者のスクリプトが直接 Destroy したものを、使われている名前から外す
        private void Prune()
        {
            List<string> gone = null;
            foreach (var pair in spawned)
            {
                if (pair.Value == null)
                {
                    (gone ?? (gone = new List<string>())).Add(pair.Key);
                }
            }

            if (gone != null)
            {
                foreach (var key in gone)
                {
                    spawned.Remove(key);
                }
            }
        }
    }
}
