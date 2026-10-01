# ギャップ分析: runtime-manifest-reinject

- 実施日: 2026-09-30
- エンジン: Claude サブエージェント(validate-gap-agent)。codex を使わなかった理由: codex 実行前に作業ツリーを記録する監査用のシェルコマンドが、権限設定で拒否された。手順の定めにより codex を起動しなかった

## 分析サマリー

- **対象範囲**: Unity の参照実装、ブリッジ、共有スキーマ、UI、mock-unity、文書の 6 層すべてに手が入る。既存資産として使えるのは次の 3 つで、ほかはほぼ新規になる。
  - `StagingPlan.TryCompile` / `StagingEngine`(純 C#)
  - `ManifestClient` の状態機械
  - UI の `seed_defaults(force=True)` / `cancel_all_holds()`
- **最大の制約**: 次の 2 点から、再注入の中核は純 C# のアセンブリへ切り出すのが事実上の前提になる。
  - Unity EditMode のテストアセンブリは `OscSurfaceBridge.Staging` しか参照できない。`OscSurfaceBridge.cs` と `OscSurfaceManifestAsset.cs` は Assembly-CSharp にあり、テストから触れない
  - C# の全ファイルは `docs/UNITY_PROTOCOL.md` 付録 A.2 と 1 字 1 句一致が必要(`tests/guards/appendix-source-parity.test.ts`)
- **最大の未決事項**: 次の 3 点は、方式によってはプロトコル契約が変わる。design の最初に決める。
  - 版を Unity の再起動をまたいでどう順序付けるか
  - エコーに版を載せる OSC 1.0 上の表し方
  - 「エコーより新しくない値」をブリッジがどう扱うか
- **要件どうしの潜在的な矛盾**: 次の 2 つを組み合わせると、正当なエコーが捨てられる。
  - Req 7.4: 値の版は「現在値が変わったときに進める」
  - Req 10.4: 同じアドレスで「新しくない版のエコーは中継しない」

  型の不一致で記録されない受信や、計画外のアドレスでは版が進まない。このため、連続したエコーが同じ版になって捨てられる。「エコーを送るたびに版を進める」か、比較を「古いときだけ捨てる」に緩めるかを design で確定する。
- **推奨**: ハイブリッド(案 C)で、段階に分けて実装する。工数は **XL**、リスクは **High**。

---

## 1. 現状の調査

### Unity 参照実装(`OscSurface/Assets/OscSurfaceBridge/`)

- `OscSurfaceBridge.cs`(Assembly-CSharp。asmdef なし)
  - 検証 → 宣言の写像 → `TryCompile` → シードを `Awake` で 1 回だけ行う。`stagingEngine` はフィールドで持つので、差し替えは可能
  - `TryBuildManifestJson` は `manifestAsset`(外から書き換えられる参照)と `stagingEngine.TryGetCurrentValue` から JSON を組む。スナップショットは無い
  - `TryGetValidatedAsset` は検証失敗を `Debug.LogError` で出して bool を返すだけ。失敗の種類を区別する理由は返さない
- `OscSurfaceStaging.cs`(`OscDesk.Staging` asmdef。UnityEngine 非依存)
  - `StagingEngine` は plan を readonly で持つ。計画の差し替えには、新しい engine を作って値を移す方法しかない
  - `Snapshot()` はある
  - `TryNormalizeForEntry` は型で正規化する。引き継ぎで型を突き合わせる判定に流用できる
- `OscSurfaceManifestAsset.cs`: `Entry` に安定した識別子のフィールドが無い
- テストの asmdef `OscSurfaceBridge.Staging.Tests` の参照先は `OscSurfaceBridge.Staging` だけで、Assembly-CSharp は参照できない
- uOSC 2.2.0 の事実:
  - `Bundle(Timestamp)` で任意の 64bit タイムタグを送れる
  - `Writer` が書ける型は int / float / string / blob / Timestamp で、64bit 整数の引数は無い
  - `uOscClient` の送信キューは `maxQueueSize` を超えると古いものを捨てる。Unity 側でも喪失が起こりうる

### ブリッジ(`packages/bridge/src`)

- `ManifestClient`: `requesting` / `settled` の 2 状態。`onManifestPayload` は、正しい形なら常に採用する。版による比較の概念は無い
- `surface-core.ts`
  - 採用のたびに `adoptionSeq++`。構造の再採用と、値だけの再同期の区別は無い
  - `/sys/stats` は `isInternalAddress` で黙って捨てている(`surface-core.test.ts:77-80` で固定済み)
  - `/sys/stats/request` を送る経路は無い。UNITY_PROTOCOL の互換性ノートは「通常運用では送信されない」と明記している
- エコーの中継: Unity から来たエコーは `publish({type:'osc'...})` で UI へ、`uiRouter` の `to-ui` で OSC ネイティブ UI へ中継される。引数は無加工で、アドレスごとの状態は持っていない
- `udp-transport.ts` の `flattenMessages` は、bundle のタイムタグを捨ててメッセージだけを渡す。`osc-codec` はタイムタグをデコードしている

### 共有パッケージ

- `ManifestSchema` / `StatsPayloadSchema` は `z.object` で、strict ではない。未知のキーは黙って取り除かれる
  - 利点: 旧ブリッジは版の項目を無視して受理するので、前方互換には有利
  - 欠点: 新しい項目をスキーマに足さない限り、ブリッジ内でも消える
- wire 側の `ManifestAdoptionSchema` は strict の `{seq, at}`。Python の `protocol.py:212` も `{"seq","at"}` を strict に検査している。採用の種類を足すには、TS と Python を同時に更新する必要がある
- `MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES = 60 KiB`(`limits.ts`)

### UI(`oscdesk_ui`)

- `SurfaceState._on_manifest`
  - `adoption_key` が同じなら何もしない
  - 内容が変われば `cancel_all_holds()` と `manifest_revision++`
  - 新しい採用なら常に `seed_defaults(force=True)`
  - 値だけの再同期(再描画も打ち切りもせず、force で再同期する)は、既存の部品の組み合わせで作れる
- エコーの受信(`state.py:367-368`)は `self.values.on_echo(address, ...)`。`channel()` はアドレスが未知でもチャネルを作る。現在のマニフェストに無いアドレスを無視する処理が無い(Req 5.6)
- `seed_defaults(force=True)` は、`default` を持たないエントリの表示値を**消す**。ブリッジが `default` を省く方式を採ると、表示が消える副作用が出る

### mock-unity

- `ScenarioRuntime` はインスタンスの生成時に 1 回だけ組み立てる(readonly)。実行時の切り替え、版、`id` はどれも無い
- `FaultMode` は pong 中心(`drop-pong` / `random-loss` / `delay` は pong だけが対象)。マニフェストの喪失・順序の入れ替わり・遅延を注入する手段は無い
- 送信時のサイズ監視(`ManifestSizeMonitor`)は警告だけ
- `staging.ts` は C# の中核を TS へ移植したもので、`protocol/staging-cases.json` を双方で共有している(`staging-fixture-parity.test.ts`)

### テスト基盤

- `surface-core` は `now` / `setIntervalFn` / `publish` を注入できる。喪失・順序の入れ替わり・再起動の順序は、単体テストで決定的に書ける
- E2E の `createOscTestClient` は生の UDP で Unity 役を演じられる
- C# は `corepack pnpm test` の対象外。Unity EditMode は別に実行する必要がある

---

## 2. 要件と資産の対応表

凡例: **Missing** = 実装が無い / **Unknown** = design で調査が必要 / **Constraint** = 既存構造からの制約

| Req | 必要な機能 | 既存資産 | ギャップ |
|---|---|---|---|
| 1 F-5/F-6 | `SetManifestAsset` / `SendManifestNow` / `manifestAssetConsumed` | フォークの 32 行の差分(`UPSTREAM_FEEDBACK_HOST_MIGRATION.md` 付録) | **Missing**(取り込めば済む)。**Constraint**: 付録 A.2.4 の一致ガード。F-6 はフォーク版のままでは Req 6/7 と整合しないので、改変が前提 |
| 2.1-2.5 再注入のトランザクション | 候補の検証 → コンパイル → シード → 差し替え → 送信 | `TryCompile`、`StagingEngine`、`TryBuildManifestJson` | **Missing**: 差し替え口、失敗理由の型(検証・コンパイル・サイズ・projectId・再利用・状態変化)、ロールバックの保証。**Constraint**: `TryGetValidatedAsset` はログ出力型で、理由を返さない |
| 2.3 projectId の照合 | 現在の projectId と比べる | なし | **Missing**。**Unknown**: `Awake` で検証に失敗した状態(有効な projectId が無い)から再注入したときの基準 |
| 2.6/2.7 非アクティブ時・抑止中 | 計画の差し替えと、抑止の解除 | `stagingManifestSuppressed`、`OnEnable` での自発送信 | **Missing**(小) |
| 3 事前検査・サイズ | 候補 JSON の UTF-8 バイト数と、確定時の再判定 | なし(mock の監視は警告だけ) | **Missing**: 副作用の無い「候補の組み立て」。**Constraint**: JSON の組み立てがインスタンスの状態(`manifestAsset`、`stagingEngine`、`characterName`)に依存しており、候補から組むにはリファクタが要る。**Unknown**: 事前検査の結果を確定時に再利用する方法(トークン、または候補オブジェクトの受け渡し) |
| 4 引き継ぎ | 識別子の追加と、(識別子・アドレス・型)の一致判定 | `StagingEngine.Snapshot`、`TryNormalizeForEntry` | **Missing**: `Entry.id`、新しい engine への値の移し替え API。**Constraint**: `StagingEngine` は plan が readonly なので、新しい engine を作ってシードする。そのとき、`SeedInitialValue` とは別に引き継ぎ用の入口が要るか検討する |
| 5.1-5.2 再利用の禁止 | 1 回の起動の間、アドレスと識別子の対応を記録する | なし | **Missing** |
| 5.3-5.5 消えたアドレス | 計画外は記録しないが、エコーは続ける | 既存の `StagingEngine.Handle` は計画外を記録しない | 実質**あり**(テストで固定するだけ) |
| 5.6 UI が計画外のエコーを無視する | `_entry_index` で絞る | `state.py` の `on_echo` | **Missing**(小) |
| 6 スナップショット | 消費時・再注入時に複製し、計画への影響を判定する | なし | **Missing**: アセットの深い複製(DTO)、「計画に影響する差分」の比較器。**Unknown**: 影響ありとする項目の線引き(address / type / widget=button / staged / appliesTo / expandsTo / エントリ集合と順序? / `default`?) |
| 7 構造の世代と値の版 | Unity 側のカウンタと、再起動をまたぐ順序 | なし | **Missing**。**Unknown**(重大): 再起動をまたぐ順序の方式、表し方、Req 7.4 と 10.4 の整合 |
| 8 ブリッジの採否 | 版の比較、構造と値の区別、旧形式との互換 | `ManifestClient`、`adoptionSeq` | **Missing**: 版を持つ状態、値だけの再同期を配信する形式。**Constraint**: wire の `ManifestAdoptionSchema` と Python が strict なので、両言語を同時に更新する(BRIDGE_PROTOCOL の「旧 UI と新ブリッジを混在させない」規則に従う)。**Unknown**: 版を受理した後に版の無いマニフェストが来たとき(Unity を旧版へ戻した場合など)の扱い |
| 9 stats による照合 | 定期的な `/sys/stats/request`、stats の受理、目標の世代まで要求を続ける | `SYS.STATS*` 定数、`StatsPayloadSchema`、mock の応答 | **Missing**: ブリッジでの stats 処理(Unity ホスト以外からの受信を捨てる検査を含む)、`ManifestClient` の「目標の世代」状態。**Constraint**: 「stats は通常運用で送らない」という互換性ノートを改める。Unity の `received` に照合要求が計上されるので、その旨も記録する |
| 10 エコーの版 | Unity で付けて、ブリッジで取り除く。アドレスごとの最終版 | なし | **Missing**: Unity の全送信経路(エコー、展開書き込み)への付加、トランスポートからの受け渡し、除去、アドレスごとの表。**Unknown**(重大): 表し方、10.5 の実現方法 |
| 11 UI の追従 | 構造の再採用と値だけの再同期の分岐 | `_on_manifest`、`seed_defaults`、`cancel_all_holds` | **Missing**(中): 採用の種類による分岐と、テストでの固定 |
| 12 mock-unity | 実行時の切り替え、版、旧形式の模倣、障害注入 | `ScenarioRuntime`、`FaultMode` | **Missing**: 切り替えシナリオのスキーマ、切り替えのトリガ、版の送出、マニフェストの喪失・遅延・順序の入れ替えの注入。**Constraint**: シナリオの `entries` は `ManifestEntrySchema` を使っており、wire に出さない `id` を別の項目として持つ必要がある |
| 13 文書・テスト | UNITY_PROTOCOL / BRIDGE_PROTOCOL / VERIFICATION / DESIGN、EditMode テスト | 付録 A.2 のガード、staging-cases の共有フィクスチャ | **Constraint**: C# のファイルを増やすたびに、付録 A.2.x 節とガードの一覧に追加が要る。C# は `pnpm test` の外にあるので、EditMode の実行手順を別途確保する |

---

## 3. 実装アプローチの選択肢

### 案 A: 既存のコンポーネントを拡張する

- **Unity**: `OscSurfaceBridge.cs` に、F-5/F-6/F-8、事前検査、スナップショット、版、エコーへの版の付加をすべて足す
- **ブリッジ**: `manifest-client.ts` と `surface-core.ts` に、版の比較、stats による照合、エコーの版の除去を足す
- **UI / mock**: 既存のモジュールを拡張する
- **利点**: 新しいファイルが少ない。付録 A.2 の節も増えない
- **欠点**: MonoBehaviour の中にロジックが集まり、**EditMode テストが書けない**(Req 13.5-13.7 を満たせない)。`surface-core.ts`(約 420 行)はさらに肥大化する。「純粋ロジックと I/O の分離」の方針から外れる

### 案 B: 新しいコンポーネントを作る

- **Unity**: `OscDesk.Staging` アセンブリ(または新しい純 C# アセンブリ)に次の 3 つを置き、`OscSurfaceBridge.cs` を薄いアダプタにする
  - `ManifestSnapshot`(アセットの DTO 複製)
  - `ManifestSession`(スナップショット + engine + 版 + アドレスと識別子の対応。事前検査・確定・JSON 組み立て・サイズ測定)
  - `VersionClock`(エポック + カウンタ)
- **ブリッジ**: 次の 3 つを新設し、`surface-core` からは配線だけにする
  - `manifest-versioning.ts`(版の比較、構造と値の判定)
  - `stats-reconciler.ts`(照合の間隔、目標の世代)
  - `echo-sequencer.ts`(版の除去と、アドレスごとの最終版)
- **mock-unity**: `scenario-switch`(切り替え)と、マニフェストにも効く障害注入を新設する
- **利点**: EditMode とブリッジの単体テストで、すべての受け入れの順序を決定的に検証できる。TS の mock と C# の中核で、共有フィクスチャによる同等性を拡張できる
- **欠点**: 付録 A.2 の節とガードの一覧が増える。JSON の組み立てを移すので、既存の `TryBuildManifestJson` と出力が同一であることを回帰テストで確かめる必要がある。インターフェース設計の負荷が大きい

### 案 C: ハイブリッド(推奨)

- **新規にするもの**: 状態を持つ判定ロジック
  - Unity: `ManifestSession` 系(純 C#)
  - ブリッジ: 版の採否とエコーの版の表を独立モジュールに
  - mock: シナリオの切り替えと障害注入
- **拡張で済ませるもの**
  - F-5/F-6 の公開 API(`OscSurfaceBridge.cs` へ差分を取り込み、Session へ委譲する)
  - UI の `_on_manifest` の分岐と、`on_echo` のアドレス絞り込み
  - `ManifestClient` の状態(目標の世代)
  - スキーマと wire サンプルの項目追加
- **段階の例**
  1. F-5/F-6 の取り込みと、スナップショット化(Req 1, 6)
  2. Session の切り出し、F-8、事前検査、サイズ、引き継ぎ、再利用の禁止(Req 2-5)
  3. Unity と mock の版の送出(Req 7, 12.2-12.3)
  4. ブリッジの採否、stats による照合、エコーの順序付け(Req 8-10)
  5. UI の追従(Req 11)
  6. E2E、障害注入、文書(Req 12.5, 13)
- **リスクの抑え方**
  - 版の無い送信元との互換(Req 8.9 / 9.8 / 10.7)を各段階のテストで固定し、段階 3 より前でも既存の Unity と動くことを保つ
  - プロトコルの変更は「スキーマ → wire サンプル → 文書 → 両言語」の順で入れる
- **利点**: テストのしやすさと差分の局所化を両立できる。フォークへの差し戻しも、段階ごとに分けられる
- **欠点**: 計画が複雑になる。段階の間で wire 契約を一時的に二重にサポートする期間がある

---

## 4. 工数とリスク

- **工数: XL(2 週間以上)**。次の作業が同時に必要になる
  - 4 つの実行環境にまたがる変更(C#、TS のブリッジと mock、Python の UI)
  - Unity の中核の切り出しと、付録 A.2 の同期
  - 新しい順序付けのプロトコル(構造の世代、値の版、エコーの版)
  - 障害注入のハーネス
- **リスク: High**。理由は次の 3 つ
  - 再起動をまたぐ順序と、エコーの版の表し方が未確定で、しかも wire 契約(フォークの Unity 実装を含む)を変える
  - C# が自動テストの入口の外にある
  - Req 7.4 と 10.4、Req 10.5 と D-037(ブリッジは値を解釈しない)の整合が、設計しだいで壊れやすい

---

## 5. design へ持ち越す調査項目

### R1. 構造の世代と値の版を、再起動をまたいで順序付ける方式(Req 7.6 / 8.5 / 8.6)

- **案 a**: 起動時の UTC 時刻(ms)をエポックにし、(エポック, カウンタ)の辞書順で比べる
  - 時計の巻き戻り(NTP 補正、手動変更)で不変条件が破れる
  - `max(now, 永続化した値 + 1)` で補強する案がある。永続化先は `PlayerPrefs` など。Editor と Player での永続化の挙動を確かめる
- **案 b**: 永続化したカウンタだけを使う
  - 保存に失敗したときや、ビルドを入れ替えたときの扱いが要る
- **案 c**: ブリッジ側で「退役したエポック」を管理する
  - ランダムなエポックでは、**一度も見ていない旧エポックが遅れて届く**(A を観測する前に B が届き、その後 A が届く)と誤って受理する。起動をまたいだ順序が付かないので、単独では不変条件を満たさない
- **表現の制約**: ms のエポックは int32 に収まらない。互換性ノートは 64bit 整数を禁じている。JSON の数値(2^53 以内)、int32 の組、文字列のどれで表すかを決める

### R2. エコーに版を付ける、OSC 1.0 の範囲での表し方(Req 10.1 / 10.2 / 10.7)

- **案 a: 末尾への引数の追加**。予約した印の文字列と版(例: `s` の印 + `i` / `s` の版)をエコーの末尾に付け、ブリッジが Unity から来たものだけを取り除く
  - uOSC で実装できる。トランスポートの変更も不要
  - 印との衝突と、複数引数のメッセージ(xy)の扱いを決める
  - ステージングの「値として解釈できる最初の引数」の規則には影響しない(Unity は受信側では付けない)
- **案 b: タイムタグ付きの bundle で包む**。uOSC は `Bundle(Timestamp)` で任意の 64bit 値を送れる
  - タイムタグの意味(時刻)を版に流用することになる
  - `udp-transport.ts` の `flattenMessages` がタイムタグを捨てているので、トランスポートから surface-core までタイムタグを通す改修が要る
  - 互換性ノート「timetag の遅延実行は要求しない」との整合を確かめる
- **案 c: bundle の中に版を運ぶ補助メッセージを入れる**。補助メッセージのアドレスが `/sys/*` の追加に当たると対象外(アドレス体系の変更)なので、実質的に使えない
- どの案でも、次を確かめる
  - Unity の全送信経路(`HandleNormalMessage` のエコー、`ExpansionWrites`、計画外のアドレスのエコー)に付けること
  - `diagnostics.recordIncoming` の記録を、取り除く前と後のどちらにするか
  - OSC ネイティブ UI への中継(`uiRouter` の `to-ui`)でも取り除くこと

### R3. 値の版の刻み方(Req 7.4 と 10.4 の整合)

- 「現在値が変わったときだけ進める」と、記録されない受信(型の不一致、計画外)や同じ値の再受信で、連続したエコーが同じ版になる。その結果、Req 10.4 で後のエコーが捨てられる
- 選択肢
  - 「エコーを送るたびに進める」
  - 比較を「厳密に古いときだけ捨てる」にする(この場合は、同じ版の重複を中継することを許す)
  - 計画外のアドレスは版の管理の対象外にする
- 展開書き込みを同じ版にするか、個別の版にするかも決める

### R4. Req 10.5 の実現手段と、D-037 との整合

- 値だけの再同期でも構造の再採用でも、エコーより古い `default` で UI を戻さない必要がある。選択肢
  - ブリッジがそのアドレスの最後のエコーの値で `default` を差し替える(ブリッジが値を扱うことになり、D-037 の「解釈しない」を改める)
  - frame に「上書きしないアドレスの一覧」を載せる
- `default` を省く方式は、UI の `seed_defaults(force=True)` が表示を消すので不可
- Req 10.6 の順序が、構造の再採用(例: 再注入の直後)の場合にも成り立つかを要件と照らして確かめる

### R5. ブリッジから UI への「構造の再採用」と「値だけの再同期」の表し方(Req 8.2 / 8.11)

- 選択肢は、`adoption` に種類の項目を足すか、新しいフレーム種別にするか
- どちらも strict な検査をしているので、TS の wire スキーマ、Python の `protocol.py`、`wire-samples.json`、BRIDGE_PROTOCOL を同時に更新する
- UI 接続時や `manifestRequest` への応答で、最新の値を反映した `default` を返すか(D-037 の既知の限界を改善するか)もあわせて決める

### R6. `ManifestClient` の状態機械の拡張(Req 9.2-9.4 / 8.9)

- 追加する状態: `settled` の後の照合間隔、目標の世代、「その世代以上を受理するまで要求を続ける」
- 版を受理した後に版の無いマニフェストが来た場合と、その逆の扱い
- 照合間隔の既定値と、回復にかかる時間の上限(Req 9.4 のテストで使う)

### R7. F-6 の「計画に影響する変更」の判定項目と、スナップショットの深さ(Req 6)

- `characterName` の置換後の値で持つか、置換前の値で持つか
- `default` を書き換えただけのとき、構造の世代を進めるか
- ラベルや範囲の変更を「内容の変わった公開」として世代を進めるか。進めると、UI が再描画し、ホールドも打ち切られる

### R8. 事前検査から確定までの保証(Req 3.5 / 3.6)

- 選択肢は、候補オブジェクトを返してそのまま確定に渡すか、現在値の版で古くなったことを検出するか
- uOSC の `onDataReceived` がメインスレッドの `Update` で呼ばれることを前提に、「同じフレーム内なら失敗しない」を保証する方法

### R9. テストのハーネス(Req 12.5 / 13)

- **ブリッジの単体テスト**: `surface-core` に `now`、`publish`、`handleOscIn` の順序を注入すれば、喪失・遅延・順序の入れ替わり・エポックの切り替えを決定的に再現できる(第一候補)
- **E2E**: `createOscTestClient` を偽の Unity として使い、生の UDP で任意の順序に送る方式が妥当。mock-unity の `FaultMode` を拡張する場合は、「次の `/sys/manifest` を 1 通落とす」「遅延させて入れ替える」「`--epoch` の指定または再起動」を追加する。再起動は `ProcessHarness` で mock を起動し直せば再現できる
- **Unity EditMode**: 純 C# の `ManifestSession` を対象にする。`protocol/staging-cases.json` の共有フィクスチャを、引き継ぎと再利用の禁止のケースへ広げ、C# と TS の同等性を保つか検討する
- **C# が `pnpm test` の外にあること**: 検証手順を用意する(EditMode の実行、または一時的な csproj を使った `dotnet build` / テスト)

### R10. 付録 A.2 の同期コスト

新しい C# ファイルごとに、`UNITY_PROTOCOL.md` の A.2.x 節とガードの一覧(`appendix-source-parity.test.ts`)に追加が要る。ファイル分割の粒度を決めるときの判断材料にする。

---

## 6. design フェーズへの推奨

- 推奨の方向は案 C(ハイブリッド)
- 最初に確定すべき判断は R1、R2、R3、R4 で、どれもプロトコル契約とフォークへの影響を決める。R5 は、R4 の結論と同時に決まる
- design の冒頭で R1〜R5 の方式を決め、フォークの Unity 実装への影響(エコーの形式の変更)をユーザーの判断事項として示す
- R1〜R5 は、要件の論点 10・11 で「design で決める」とされた項目にあたる

---

## 追記: 要件の簡素化による調査項目の整理(2026-09-30)

要件を LAN 前提に簡素化した(requirements.md「方針の見直し」)。値の版と、再起動をまたぐ順序付けを採らないため、上の調査項目は次のように整理する。

- **不要になった**: R1(再起動をまたぐ順序付け)、R2(エコーへの版の付加)、R3(値の版の刻み方。Req 7.4 と 10.4 の食い違いも消えた)、R4(エコーより古い `default` で UI を戻さない仕組み)
- **縮小した**: R5(採用の種類の区別は不要になった。`adoption` の形式は変えずに済む見込み)、R6(照合は「起動の識別子と構造の世代の組が違うか」だけ。到達性回復時は従来どおり採用する)
- **そのまま残る**: R7(F-6 の「計画に影響する変更」の判定項目)、R8(事前検査から確定までの保証)、R9(テストのハーネス。喪失 1 通と再起動の再現に縮小)、R10(付録 A.2 の同期コスト)
- 新しく決めること: 起動の識別子の表し方(例: 起動時に作るランダムな文字列)。大小を比べないので、時計や永続化には依存しない
- 工数の見込みは XL から L 程度に下がる。Unity の中核を純 C# へ切り出す制約は変わらない

---

# 設計時の調査(2026-09-30、spec-design)

## Summary

- **Feature**: `runtime-manifest-reinject`
- **Discovery Scope**: Extension(既存の Unity 参照実装・ブリッジ・UI・mock-unity の拡張。新しい外部依存なし)。light discovery に従い、統合点と既存パターンをコードで確かめた
- **Key Findings**:
  - 新しい項目(`bootId` / `structureGeneration`)は、既存のブリッジにも既存の UI にも**無害に追加できる**。`ManifestSchema` と `StatsPayloadSchema` は strict ではなく未知キーを黙って取り除き、Python の `parse_manifest` も未知キーを無視する。したがって Unity 側と、ブリッジ・UI 側を独立に出荷できる
  - wire の `adoption { seq, at }` は変えずに済む。同じ組の再受信は、ブリッジが採用を発行しないだけで表現できる(UI は既存の `adoption_key` 比較のまま)
  - Unity の再注入の中核は、`UnityEngine` を参照しない `OscSurfaceBridge.Staging` アセンブリへ置けば EditMode でテストできる。既存の `StagingEngineTests.cs` は NUnit と System だけを使うため、同じ方針で書いたテストは `dotnet` の一時プロジェクトでもコンパイル・実行できる

## Research Log

### 既存スキーマの未知キーの扱い(前方互換)

- **Context**: Unity を先に更新したとき、既存のブリッジがマニフェストを拒否しないか
- **Sources Consulted**: `packages/shared/src/schemas.ts`、`packages/shared/src/wire.ts`、`packages/nicegui-ui/src/oscdesk_ui/protocol.py`、`manifest.py`
- **Findings**:
  - `ManifestBaseSchema` / `StatsPayloadSchema` は `z.object`(strip)。未知キーは受理され、出力から消える
  - `ManifestFrameSchema` は strict だが、`manifest` の中身は `ManifestSchema` なので同じく strip
  - Python の `decode_frame` は `manifest` を `_object` で受けるだけで、`parse_manifest` は未知キーを読まない
  - mock-unity は `ManifestSchema.parse(this.#buildManifest())` を通してから送るので、スキーマに項目を足す前に mock が項目を出しても消える
- **Implications**: スキーマへの項目追加(任意項目)を最初に入れる。mock の版の送出はその後にする。Unity 側はどの順でも出荷できる

### `/sys/stats` の現在の扱い

- **Context**: 照合に `/sys/stats` を使うため、ブリッジの受信経路を確かめた
- **Sources Consulted**: `packages/bridge/src/surface-core.ts`、`surface-core.test.ts:74-85`、`docs/UNITY_PROTOCOL.md` Phase 4 追記
- **Findings**:
  - `/sys/stats` は `isInternalAddress` で黙って捨てている。UI へは配信しない(テストで固定)
  - 送信元が Unity ホストかどうかの検査は `/sys/pong` と `/sys/manifest` だけにある
  - UNITY_PROTOCOL は「`/sys/stats/request` は通常運用では送信されない」と明記している
- **Implications**: `/sys/stats` を Unity ホストからだけ受け付ける分岐を足し、UI へは引き続き配信しない。互換性ノートの記述を改める。Unity の `received` に照合の要求が計上されることも記録する

### Unity 参照実装の依存関係と EditMode の到達範囲

- **Context**: F-8 の中核をテスト可能な場所へ置けるか
- **Sources Consulted**: `OscSurfaceBridge.Staging.asmdef`(`noEngineReferences: true`)、`OscSurfaceBridge.Staging.Tests.asmdef`(参照は Staging だけ)、`OscSurfaceBridge.cs`、`OscSurfaceManifestAsset.cs`、`StagingEngineTests.cs` / `StagingFixtureTests.cs` の using
- **Findings**:
  - `TryGetValidatedAsset`(検証)と `TryBuildManifestJson`(JSON 組み立て)は `UnityEngine` に依存する部分が `Debug.LogError` だけ。`Regex` は System なので純 C# へ移せる
  - `OscSurfaceManifestAsset` は `ScriptableObject` なので中核から参照できない。中核はアセットを写した DTO を受け取る必要がある
  - `StagingEngine` は plan を readonly で持つ。計画の差し替えは「新しい engine を作ってシードし、参照を入れ替える」で表せる。`SeedInitialValue` は型の正規化も行うので、引き継ぎ値の投入にそのまま使える
  - `StagingEngineTests.cs` は `System` と `NUnit` だけ、`StagingFixtureTests.cs` は `UnityEngine`(JSON 読み込み)も使う
- **Implications**: 中核 2 ファイル(モデルとセッション)を Staging アセンブリに追加し、`OscSurfaceBridge.cs` は変換・送受信・ログだけの薄いアダプタにする。新しいテストは `UnityEngine` を使わずに書く

### uOSC の受信スレッドと「同じフレーム」の保証

- **Context**: Req 3.5(事前検査の直後の確定は失敗しない)の実現手段
- **Sources Consulted**: uOSC 2.2.0 の `uOscServer`(受信はワーカースレッドでキューに積み、`Update` でメインスレッドから `onDataReceived` を呼ぶ。ギャップ分析の R8 で確認済み)
- **Findings**: 受信処理はメインスレッドの `Update` でだけ走る。ホストがメインスレッドの 1 つのメソッド内で事前検査と確定を続けて呼べば、間に受信処理は入らない
- **Implications**: フレームに依存する仕組みは作らず、中核に「状態の版(値を記録するたび・計画やスナップショットを差し替えるたびに進める整数)」を持たせる。事前検査の結果に版を記録し、確定時に版が同じなら再判定せずに差し替える(失敗しない)。版が違えば再判定し、失敗したら「事前検査後の状態変化」を区別して返す。同じフレームの保証は、この仕組みの特別な場合として成り立つ

### 起動の識別子の生成

- **Context**: Req 7.1(Play の開始ごとに異なる値)
- **Findings**:
  - `System.Guid.NewGuid()` は `UnityEngine` なしで使え、32 桁の hex(`"N"` 書式)で表せる。大小を比べないので、時計や永続化は要らない
  - Enter Play Mode Options でドメインのリロードを切っても、シーンの読み込みでコンポーネントは作り直され `Awake` が走る。識別子をインスタンスのフィールドに持てば、Play ごとに変わる(静的フィールドには置かない)
- **Implications**: アダプタが `Awake` で `Guid.NewGuid().ToString("N")` を作って中核へ渡す。中核はテストで固定値を渡せる。mock-unity は `crypto.randomUUID()` からハイフンを除いた値を使う

### C# の検証経路

- **Context**: C# は `corepack pnpm test` の対象外で、実装はクラウドの Claude が行う(Unity を動かせない前提)
- **Findings**:
  - 中核とその NUnit テストが `UnityEngine` を参照しなければ、`dotnet` SDK と NuGet の `NUnit` / `NUnit3TestAdapter` / `Microsoft.NET.Test.Sdk` で、Unity の外でもコンパイル・実行できる
  - Unity の C# は C# 9 相当。`dotnet` 側で `LangVersion` を 9.0 に固定すれば、Unity で使えない構文を使ったときにも気づける
  - `dotnet` が無い環境もあるため、Python テストと同じく「無ければ理由を出して exit 0」とするのが既存の流儀に合う
- **Implications**: 中核の検証用に、リポジトリにチェック用の csproj とランナースクリプトを置く案を設計に載せる(人間の判断事項)。最終確認は Unity EditMode(uloop)で行う

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 中核の抽出 + 薄いアダプタ(採用) | Staging アセンブリに `ManifestSession` とモデルを置き、MonoBehaviour は変換と I/O だけ | EditMode と dotnet でテストできる。事前検査と確定が同じコードを通る | JSON 組み立ての移設で出力が変わる危険。付録 A.2 の節が 3 つ増える | 移設前後の出力一致を、固定文字列のテストで確かめる |
| MonoBehaviour へ直接追加 | `OscSurfaceBridge.cs` に全部書く | ファイルが増えない | EditMode から触れず、Req 11.6-11.8 を満たせない | 不採用 |
| 版の比較を bridge の独立モジュールへ | `stats-reconciler.ts` などを新設 | 責務が細かく分かれる | 状態が `ManifestClient` と二重になる | 不採用。照合の状態は `ManifestClient` に足す(採否と同じ状態を見るため) |

## Design Decisions

### Decision: 起動の識別子と構造の世代の表し方

- **Context**: Req 7.1 / 7.4 / 8.1 / 8.2
- **Alternatives Considered**:
  1. 1 つの文字列 `origin: "<bootId>:<generation>"`
  2. 2 つの項目 `bootId`(文字列)と `structureGeneration`(整数)
- **Selected Approach**: 2 つの項目。`/sys/manifest` と `/sys/stats` の JSON の最上位に置く。両方あるか両方ないかのどちらかとし、片方だけはスキーマ違反にする
- **Rationale**: 整数は int32 の範囲に収まり(64bit 整数の禁止に触れない)、ログでも読みやすい。片方だけの状態を作らないことで、比較の規則が 1 つで済む
- **Trade-offs**: 項目名が長い(数十バイト)。60 KiB に対しては無視できる
- **Follow-up**: `protocol/wire-samples.json` に項目つきのマニフェストのサンプルを足す

### Decision: 同じ組の判定はブリッジだけで行い、adoption の形式は変えない

- **Context**: Req 8.2 / 9.3、ギャップ分析の R5
- **Alternatives Considered**:
  1. `adoption` に種類を足す(strict なので TS と Python を同時に更新)
  2. ブリッジが同じ組の再受信で採用を発行しない
- **Selected Approach**: 2
- **Rationale**: 値だけの再同期を採らないので、採用の種類は 1 つで足りる。UI の変更が要らない
- **Trade-offs**: 同じ組で `default` が進んでいても UI へ届かない。値はエコーで追従しているので実害はない

### Decision: 到達性の回復後は「次に届いた 1 通」を必ず採用する

- **Context**: Req 8.3。`/sys/manifest/request` には要求 ID が無い
- **Selected Approach**: `ManifestClient` に「次の正しいマニフェストは組によらず採用する」旗を持たせ、到達性の回復で立て、採用で下ろす
- **Trade-offs**: 回復前に送った照合の応答が遅れて届くと、それが採用される。既知の制限(Req 11.2 (a))として記録する

### Decision: 照合は受理済みのマニフェストが組を持つときだけ行う

- **Context**: Req 8.4 / 8.8
- **Selected Approach**: 受理済みのマニフェストが `bootId` / `structureGeneration` を持つときだけ、4 秒間隔で `/sys/stats/request` を送る。組を持たないマニフェスト(既存の送信元)の間は送らない
- **Rationale**: 既存の Unity 実装に対して、ブリッジの送信内容を変えない(`received` の計上も増やさない)
- **Trade-offs**: 既存の送信元の間は取りこぼしを検出しない(従来どおり)

### Decision: F-6 で取り込める変更は「表示の項目」の許可リストで決める

- **Context**: Req 6.3 / 6.4、ギャップ分析の R7
- **Alternatives Considered**:
  1. 計画に影響する項目を列挙し、それ以外は取り込む(拒否リスト)
  2. 取り込める表示の項目を列挙し、それ以外の差分はすべて拒否する(許可リスト)
- **Selected Approach**: 2。取り込めるのは `label`、`range`(`hasRange` / `rangeMin` / `rangeMax`)、`group`、`options`(`hasOptions` / `options`)、`optionsRef`、`pattern`、トップレベルの `optionLists`。エントリの数・順序、`address`、`id`、`type`、`widget`、`staged`、`appliesTo`、`expandsTo`、既定値、`projectId` の差分は拒否する
- **Rationale**: 項目が増えたときに、既定で安全側(拒否)に倒れる。既定値は中核の現在値で上書きされて表に出ないため、取り込むと「変えたのに反映されない」状態を黙って作る。拒否して再注入を促すほうが分かりやすい
- **Trade-offs**: `widget` の変更(fader から input など)も再注入が要る
- **改訂(2026-10-01 ユーザー確定、J4)**: button 以外の種類どうしの `widget` の変更も、再注入なしで取り込む。staging の宣言が `widget` から使うのは「button かどうか」(`IsButton`。S1 の判定と適用トリガの意味)だけなので、それが変わらない限り計画は変わらない。button ↔ button 以外の変更は引き続き拒否する。既定値の変更は拒否のまま(理由は上と同じ)。UI 側は `Manifest` の内容が変わるので「内容が変わった採用」として再描画される(D-037 の既存の経路。追加の実装は不要で、テストで固定する)。変更後のエントリは通常の検証(select は型 s と選択肢が要る等)を通す

### Decision: `{characterName}` の置換はスナップショットを取るときに行う

- **Context**: Req 6.1 / 6.2(以後のマニフェストはスナップショットと現在値だけから組み立てる)
- **Selected Approach**: アダプタがアセットを DTO へ写すときに、`label` と文字列の既定値の `{characterName}` を置換する
- **Trade-offs**: Play 中に Inspector で `characterName` を変えても、次の再注入か `SendManifestNow` まで反映されない(従来は次の送信から反映された)。互換性ノートに記録する

### Decision: 事前検査から確定までの保証は「状態の版」で行う

- **Context**: Req 3.5 / 3.6、ギャップ分析の R8
- **Selected Approach**: 上の「uOSC の受信スレッドと同じフレームの保証」を参照
- **Trade-offs**: 事前検査の後に無関係なエントリの値が記録されただけでも再判定になる。再判定が通れば確定は成功するので、ホストから見た失敗は増えない

### Decision: mock-unity の切り替えは、シナリオの `variants` とトリガのアドレスで表す

- **Context**: Req 10.1 / 10.4 / 10.5、Req 11.9
- **Selected Approach**: シナリオに `runtime.variants`(名前つきのエントリ集合)と `runtime.switches`(トリガのアドレスと切り替え先)を足す。トリガのアドレスに非ゼロの値を受けたら、Unity と同じ検査(スキーマ、コンパイル、アドレスの再利用、サイズ、`projectId`)を通してから切り替える。検査に落ちたら切り替えず、何も送らない
- **Rationale**: 「事前検査で失敗したら何も変わらない」ことを、Unity なしでブリッジと UI まで通して確かめられる
- **Trade-offs**: mock が Unity の検査の一部を二重に持つ。検査の詳細な理由コードの一致までは求めない(採否だけを揃える)

### Decision: C# の中核の検証をテストの入口から到達できるようにする(判断事項)

- **Context**: C# は `pnpm test` の外にあり、クラウドの実装者は Unity を動かせない
- **Alternatives Considered**:
  1. Unity EditMode(uloop)だけで検証する
  2. チェック用の csproj をリポジトリに置き、`scripts/run-csharp-core-tests.mjs` を `pnpm test` から呼ぶ。`dotnet` が無ければ理由を出して exit 0
- **Selected Approach(2026-10-01 ユーザー確定)**: 2。最終確認は 1 も行う。あわせて、照合の間隔 4 秒の定数(J1)、`{characterName}` のスナップショット時点での置換(J3)、組の無い送信元への照合を行わないこと(J5)も推奨どおり確定した
- **Trade-offs**: NuGet の取得が要る。Unity 外のコンパイラは Unity と完全には同じではないので、EditMode の確認は省けない

## Risks & Mitigations

- JSON 組み立ての移設で出力が 1 バイトでも変わる — 移設前の出力(`optionLists` の `": ["` の空白を含む)を固定文字列で断言するテストを先に書く
- 付録 A.2 の一致ガードの更新漏れ — 新しい C# ファイルごとに付録の節とガードの一覧を同じ PR で足す。見出しは既存の番号を変えずに A.2.8 以降へ追加する
- 新しい `.meta` の GUID の衝突 — ランダムな 32 桁の hex を生成して使う(連番・使い回しの禁止)
- 照合の要求が Unity の `received` を増やす — 互換性ノートに記録する。stats の数値の意味は変えない
- 到達性の回復直後に遅れた旧い応答を採用する — 既知の制限として記録し、定期照合で追いつく

## References

- `docs/UNITY_PROTOCOL.md` §1 / §2 / §4 / 互換性ノート / 付録 A.2
- `docs/UPSTREAM_FEEDBACK_HOST_MIGRATION.md` F-5 / F-6 と付録の差分
- `DESIGN.md` D-037 / D-038
