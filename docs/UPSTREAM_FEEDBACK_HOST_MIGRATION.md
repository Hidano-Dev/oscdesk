# UPSTREAM_FEEDBACK_HOST_MIGRATION.md — 実行時マニフェスト API へのフィードバック

> **本リポジトリへの取り込みについて(2026-09-29)**
>
> フォーク a8-oscdesk(ブランチ `feature/hidano/vp-oscdesk-integration`)の `docs/UPSTREAM_FEEDBACK_HOST_MIGRATION.md` を複製したものである。フォークのリポジトリはリモート環境から参照できないため、spec `runtime-manifest-reinject` の参照資料として本リポジトリに置く。§0〜「互換性と差分の範囲」はフォーク文書の原文のままとした。末尾の「付録: フォーク実装の差分」は取り込み時に追加した。
>
> 注意: spec の Project Description は F-7(値注入 API)と F-8(有効化後の再注入)にも触れているが、この文書が扱うのは F-5 / F-6 だけである。F-7 / F-8 の要件は spec `runtime-manifest-reinject` の requirements.md を参照すること。
>
> 注意: F-6 の提案どおりに実装すると、F-8 と組み合わせたときに問題が起きる。`SendManifestNow` は staging 計画を再コンパイルしないため、`Awake` 後にホストがアセットの `entries` を書き換えると、UI に届くマニフェストと実際に動く計画が食い違う。これが F-8 の検査を素通りする経路になる。取り込み時の扱いは、同じく requirements.md の要求 3 で決める。

## Task 3.3 migration source commit

- a8-oscdesk migration source commit: `97941057e56c20dd56711b7db1acec8b5cb4ab14`
> フォーク(a8-oscdesk)で Unity ホスト移植を成立させるために追加した、機構コードへの公開 API 2 点を upstream へ戻すための文書。本書単体で差分の背景、影響、提案、受け入れ条件を確認できるようにする。
>
> 検証日: 2026-09-18。検証環境: Windows / Unity ホストプロジェクト / uOSC 2.1.0。

## 0. 総評

ホスト側が案件固有のマニフェストを実行時に供給し、デバイス構成の変化を UI へ通知するには、機構コードに次の公開 API が必要である。フォークでは追加 API として実装し、既存の `Awake`、`OnEnable`、`/sys/*` 応答、エコーバック、`ApplyRequested` の挙動は変更していない。upstream へは同じ追加差分を PR として取り込んでほしい。

| # | 件名 | 対象 | 種別 | 優先 |
|---|---|---|---|---|
| F-5 | 実行時にマニフェストアセットを注入する公開 API | `OscSurfaceBridge` | API | 高 |
| F-6 | 現在のアセット内容で `/sys/manifest` を自発送信する公開 API | `OscSurfaceBridge` | API | 高 |

## F-5: 実行時マニフェストアセット注入 API

### 現状

- `manifestAsset` は `[SerializeField] private` であり、Inspector 以外から設定できない。
- `Awake` でアセットの検証、ステージング計画の構築、既定値のシードが始まるため、ホスト供給側は `Awake` 前にアセットを差し替える必要がある。
- プレースホルダーアセットを in-memory で書き換える方法は、Editor の Play 中に共有アセットを汚染し、機構コードの private フィールド名にも依存する。

### 影響

ホストはメンバー名と `Microphone.devices` から一時的な `OscSurfaceManifestAsset` を生成できるが、公開された注入口がないとそれを `OscSurfaceBridge` に渡せない。反射による private フィールド代入や、アセットファイルの書き換えを採用すると、案件差分がデータとして閉じず、既存シーンにも副作用が及ぶ。

### 提案

```csharp
public bool SetManifestAsset(OscSurfaceManifestAsset asset);
```

- `asset == null`、または `Awake` / アセット消費後(`manifestAssetConsumed == true`)の呼び出しは `false` を返し、`Debug.LogError` で拒否する。
- 成功時は bridge が保持する `manifestAsset` を差し替え、`true` を返す。
- 呼び出し側は bridge が非アクティブな子オブジェクトである間に注入し、その後 `SetActive(true)` で通常の初期化を開始する。
- 既存の Inspector 設定済みシーンでは、注入 API を呼ばない限り従来の初期化経路を維持する。

### 受け入れ条件

- `Awake` 前の有効なアセット注入で、注入アセットから `/sys/manifest` とステージング計画が構築される。
- `Awake` 後の呼び出し、null、消費済み状態がすべて拒否される。
- 既存の serialized `manifestAsset` 経路、既存 EditMode テスト、付録 A.2.4 のソース一致を壊さない。

## F-6: 現在のアセット内容の `/sys/manifest` 自発送信 API

### 現状

- `SendManifest` は private であり、起動時または `/sys/manifest/request` の受信時にしか呼び出せない。
- ホスト側で `Microphone.devices` の列挙結果が変化しても、現在のアセットを再送する公開手段がない。
- デバイス変化のたびに `/sys/manifest/request` を偽装することや、private メソッドを反射呼び出しすることは、責務と契約を不明確にする。

### 影響

ホストはデバイス一覧を `optionLists.devices` に反映した一時アセットへ置き換えた後、UI に新しい選択肢を届けられない。デバイス構成が変化した際の再送ができないため、UI の選択肢が実機状態から遅れ続ける。

### 提案

```csharp
public bool SendManifestNow();
```

- 現在保持しているアセットを検証し、通常の `SendManifest` と同じ `/sys/manifest` JSON を `uOscClient` から送信する。
- bridge が非アクティブ、マニフェスト送信抑制中、または検証失敗の場合は送信せず `false` を返す。
- 送信成功時は `true` を返す。既存の `/sys/manifest/request` と起動時送信の処理はこの API と同じ内部送信経路を使い、JSON 契約を分岐させない。
- ホスト側は列挙結果が順序込みで前回と異なる場合だけ呼び出す。固定間隔の無条件送信やチャンク分割は行わない。

### 受け入れ条件

- 有効な現在アセットから、既存の要求応答と同一形式の `/sys/manifest` が 1 回送信される。
- 非アクティブ、抑制中、検証失敗では送信されず、戻り値で失敗を判定できる。
- 既存の `/sys/manifest/request`、エコーバック、ステージング適用イベントの挙動を変更しない。
- デバイス一覧変更時にホストが `SendManifestNow` を 1 回呼ぶことで UI の `optionLists.devices` を更新できる。

## フォーク側の利用例

1. 非アクティブな bridge と供給スクリプトを含む子オブジェクトを用意する。
2. 供給スクリプトが in-memory の `OscSurfaceManifestAsset` を生成し、`SetManifestAsset` を呼ぶ。
3. 注入成功後に bridge の子オブジェクトを `SetActive(true)` にする。
4. `Microphone.devices` の順序込み比較で差分を検出したときだけ、アセットの `optionLists.devices` を更新して `SendManifestNow` を呼ぶ。

## 互換性と差分の範囲

- 追加は公開 API 2 点と、それらを説明する文書・付録の同期に限る。
- `version: 1`、`/sys/*`、OSC 1.0 の基本型、既存のエコーバックおよび `ApplyRequested` は維持する。
- in-memory アセットは Play 中に破棄し、プロジェクト内の共有アセットを変更しない。
- 実測ワイヤサイズが Spec 1 の警告閾値 48KB 以上になった場合は、閾値変更やチャンク分割をせず Spec 1 へフィードバックする。

## 付録: フォーク実装の差分(本リポジトリ取り込み時に追加)

2026-09-29 時点で、本リポジトリの `OscSurface/Assets/OscSurfaceBridge/` とフォークの同じディレクトリを比べた。違いは `OscSurfaceBridge.cs` に 32 行が追加されていることだけで、ほかのファイルは同一である。以下はその差分をそのまま載せたものである。

注: 原文の「警告閾値 48KB」はフォーク文書を書いた時点の値である。本リポジトリでは D-038 で `WARNING_BYTES = 56 KiB` / `PRACTICAL_LIMIT_BYTES = 60 KiB` に決まっている。

```diff
--- a/OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs   (本リポジトリ)
+++ b/OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs   (a8-oscdesk)
@@ -24,6 +24,7 @@ public sealed class OscSurfaceBridge : MonoBehaviour
     [SerializeField] private string characterName = "UnityBridge";
     [Tooltip("Surface へ送るマニフェスト定義(必須)。projectId は Surface config の expectedProjectId と一致させること。")]
     [SerializeField] private OscSurfaceManifestAsset manifestAsset;
+    private bool manifestAssetConsumed;
 
     // §4.1 受信統計
     private int received;
@@ -39,6 +40,8 @@ public sealed class OscSurfaceBridge : MonoBehaviour
 
     private void Awake()
     {
+        manifestAssetConsumed = true;
+
         // 起動時にアセット検証 → 宣言写像 → 計画コンパイルを一度だけ行う。
         // コンパイル失敗時は Empty 計画へ落とし、通常のエコーと sys 系の生存性は維持する。
         if (!TryGetValidatedAsset(out var asset))
@@ -96,6 +99,35 @@ private void Awake()
         }
     }
 
+    public bool SetManifestAsset(OscSurfaceManifestAsset asset)
+    {
+        if (asset == null || manifestAssetConsumed)
+        {
+            Debug.LogError("OscSurfaceBridge cannot set the manifest asset after consumption or with a null asset.", this);
+            return false;
+        }
+
+        manifestAsset = asset;
+        return true;
+    }
+
+    public bool SendManifestNow()
+    {
+        if (!isActiveAndEnabled)
+        {
+            Debug.LogWarning("OscSurfaceBridge cannot send a manifest while inactive.", this);
+            return false;
+        }
+
+        if (stagingManifestSuppressed || !TryGetValidatedAsset(out _))
+        {
+            return false;
+        }
+
+        SendManifest();
+        return true;
+    }
+
     private void OnEnable()
     {
         server = GetComponent<uOscServer>();
```
