# Requirements Document

## Project Description (Input)

### 一文要約

Unity の `OscSurfaceBridge` が **有効化後(Play 中)にマニフェストを差し替え、staging 計画を組み直して `/sys/manifest` を再送できる**ようにする。あわせて、フォーク a8-oscdesk が先行実装している実行時マニフェスト注入 API(F-5 `SetManifestAsset` / F-6 `SendManifestNow`)を本リポジトリへ取り込む。エントリの増減を伴う再注入を、ブリッジ・UI・mock-unity が破綻なく扱えることもテストで保証する。

### 背景(フォーク a8-oscdesk からの要望、2026-09-29)

フォーク a8-oscdesk は VP コンサートプリセットを使っており、MotionBuilder(以下 MB)の接続先を `/vp/mb/{KK}/*` として MB 件数分マニフェストに並べている。現場から「ブラウザ UI から MB マシンを追加・削除したい」という要望が出た。フォーク側で決まっている運用は次のとおりである(フォーク spec `oscdesk-mb-endpoint-list` の改訂版)。

- 追加は UI の追加フォーム(種類・address・port・追加ボタン)から行う。Unity は受け取った値で実機設定(NodeTranslator の接続先一覧、Crescent プラグインの実体)を即時に変え、その実状態からマニフェストを組み直して再送する。Unity が真実の源である
- 行ごとの種類・active・address・port・削除の変更は staged で、MB Sync(適用トリガ)でまとめて確定する。削除が確定すると後ろの行の番号が詰まる
- MB 件数の上限は 4 件。マニフェストのワイヤサイズを実用上限 60 KiB に収めるため

つまり **Play 中にマニフェストのエントリ集合(件数)が変わる**。本リポジトリの `OscSurfaceBridge` は `Awake` で staging 計画を一度だけコンパイルし、その後マニフェストを差し替える口を持たないため、これを実現できない。

### 現状の機構

- 本リポジトリの `OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs` は、`Awake` でアセット検証 → 宣言写像 → `StagingPlan.TryCompile` → 初期値シードを **一度だけ** 行う。以後、計画(`StagingEngine`)とアセットは固定である。`/sys/manifest` は `/sys/manifest/request` への応答と接続時にだけ送る
- フォーク a8-oscdesk は次の 2 つの公開 API を追加実装済みで、upstream への取り込みを要望している(フォーク `docs/UPSTREAM_FEEDBACK_HOST_MIGRATION.md` F-5 / F-6)。本リポジトリには **まだ無い**
  - F-5 `bool SetManifestAsset(OscSurfaceManifestAsset asset)`: `Awake` より前(非アクティブな GameObject に AddComponent した直後など)にだけアセットを差し替えられる。消費済み(`Awake` 後)や null の場合は拒否して false を返す
  - F-6 `bool SendManifestNow()`: 現在のアセット内容で `/sys/manifest` を自発送信する。非アクティブ時、staging 宣言が不正で抑止中のとき、アセットが不正なときは false を返す
- フォークは Play 中の MB 接続先の **値** の変化を、`uOscServer.onDataReceived.Invoke` を使ってブリッジへ自己注入して反映している(フォークの暫定策。受信統計 `received` に自己注入分が混ざる)。フォークはこれを公開 API に置き換える要望 F-7 を持っている
- ブリッジは新しいマニフェストを採用するたびに `adoption` を更新する。UI は、内容が同一なら表示を `default` へ再同期し、内容が変われば本体を再描画する(D-037)。編集中(ホールド中)の input は上書きしない
- ワイヤサイズの規則(D-038): `MANIFEST_SIZE.WARNING_BYTES = 56 KiB` は通知で、配信は継続する。硬い上限は `PRACTICAL_LIMIT_BYTES = 60 KiB` のみ

### 要求する挙動(要件化の材料)

1. **F-5 / F-6 の取り込み**: フォークの追加差分(`SetManifestAsset` / `SendManifestNow` と `manifestAssetConsumed` の管理)を本リポジトリへ取り込む。既存の `Awake` / `OnEnable` / `/sys/*` 応答 / エコーバック / `ApplyRequested` の挙動は変えない
2. **有効化後のマニフェスト再注入(F-8)**: 有効化後(`Awake` 後)でもマニフェストアセットを差し替えられる公開 API を足す。差し替えでは次を行う
   - 新しいアセットを検証し、staging 宣言を再コンパイルする
   - 失敗したら、**旧アセット・旧計画・旧現在値をそのまま維持**して false と理由を返す。ブリッジを止めず、`/sys/manifest` も送らない
   - 成功したら計画を差し替える。**新旧で同じアドレスのエントリは、現在値(staged の未適用値を含む)を引き継ぐ**。消えたアドレスの値は捨て、新しく現れたアドレスは `default` でシードする。そのうえで `/sys/manifest` を再送する
   - Play 中に何回呼んでもよい
   - 型が変わった同一アドレス(例: `i` → `s`)の扱いは設計で決める(引き継がず `default` でシードする案が有力)
3. **再注入時のサイズ検査**: 再注入の前に、新しいアセットのワイヤ JSON の UTF-8 バイト数を測れるようにする。`PRACTICAL_LIMIT_BYTES` を超える再注入は拒否し、理由を返す。フォークは MB の追加を受け付ける前に、組み直した後のサイズを確かめたい。測定 API を公開するか、再注入の戻り値に理由を載せるかは設計で決める
4. **値注入 API(F-7、要否は要件化で判断)**: ホストが Unity 側の実状態の変化(Inspector 編集、実機の変化)を、受信経路を偽装せずにブリッジの現在値へ反映し、エコーバックできる公開 API。受信統計には計上しない。F-8 と同時に入れるか、別 spec にするかを requirements で決める
5. **ブリッジ / UI の追従の保証**: エントリの増減・番号の詰まりを伴う再採用を、ブリッジと UI が正しく扱うことをテストで保証する。特に次の 2 点を決めて、テストで固定する
   - 編集中の値を保護する規則と、再採用でアドレスの意味が変わる場合との整合。例: 削除で番号が詰まり、編集中の `/vp/mb/03/address` の値が、別の接続先を指すようになった行に残る恐れがある。定義が変わったエントリでは、保護している値を捨てるかどうか
   - 再採用で消えたアドレスへの UI の送信を、ブリッジがどう扱うか(Unity は未知アドレスとしてエコーしない)
6. **mock-unity の開発用の口(要否は要件化で判断)**: E2E で「Play 中にエントリ集合が変わる」経路を検証できるように、mock-unity のシナリオで実行時にマニフェストを差し替えて再送できるようにする(例: 特定のトリガを受けたら別シナリオのエントリ集合に切り替える)。案件固有の意味論(MB の追加・削除そのもの)は持ち込まない

### 対象外

- 案件固有の意味論(MB の種類、追加・削除の規則、NodeTranslator / Crescent への反映)。これらはフォークの担当である
- `/sys/*` のアドレス体系の変更
- ワイヤサイズの閾値の再議論(D-038 で決着済み)
- マニフェストの分割送信(サイズ上限そのものを引き上げる仕組み)

### 受け入れの観点

- Unity EditMode:
  - 再注入の成功と失敗(検証エラー、staging コンパイルエラー、サイズ超過)。失敗時に旧状態が維持されること
  - 同じアドレスの現在値(staged の未適用値を含む)が引き継がれること。消えたアドレスは捨てられ、新しいアドレスは `default` でシードされること
  - 適用トリガの `appliesTo` が、新しい計画のアドレス集合で解決されること
  - F-5 / F-6 の既存の受け入れ条件(フォーク文書 F-5 / F-6 の「受け入れ条件」)
- ブリッジ / UI: エントリの増減を伴う再採用で、UI が行を増減し、編集中の値の扱いが要件 5 で決めた規則どおりになること。消えたアドレスへの送信の扱い
- `docs/UNITY_PROTOCOL.md` に再注入の意味論(値の引き継ぎ・失敗時の維持・サイズ検査)を互換性ノートとして記録する。`docs/VERIFICATION.md` に手動検証の手順を追記する
- 既存のテスト一式(`corepack pnpm test`、Unity EditMode)が緑のまま

### 関連資料

- フォーク a8-oscdesk(`D:\Activ8\Repositries\a8-oscdesk`、ブランチ `feature/hidano/vp-oscdesk-integration`)
  - `docs/UPSTREAM_FEEDBACK_HOST_MIGRATION.md`: F-5 / F-6(取り込み対象の差分と受け入れ条件)
  - `OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs`: F-5 / F-6 の実装済み版
  - `.kiro/specs/oscdesk-mb-endpoint-list/requirements.md`: 要望元のフォーク spec(改訂版)
  - `.kiro/multi-spec/mb-endpoint-list.md`: 要望元のプラン
- 本リポジトリの `DESIGN.md` D-037(再採用時の UI 挙動)/ D-038(ワイヤサイズの閾値)、`docs/UNITY_PROTOCOL.md`、`docs/BRIDGE_PROTOCOL.md`
