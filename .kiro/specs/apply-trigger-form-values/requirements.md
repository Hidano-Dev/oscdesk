# Requirements Document

## Project Description (Input)

### 一文要約

適用トリガ(Update ボタン)を、押下時に **UI 上に見えている適用範囲の全値をセットで送ってから適用**する挙動に改め、操作者が「画面に見えている値がそのまま適用される」と信じられる状態にする。あわせて Unity 再起動などで再採用したマニフェストが同一内容でも UI の表示値を `default` に再同期する。

### 背景(フォーク a8-oscdesk での観測、2026-09-26)

フォーク a8-oscdesk は本リポジトリの `unity-staging-apply` / `manifest-input-select-widgets` をマージし、64 スロットの VP コンサートプリセット(`/vp/member/{NN}/*` が staged、`/vp/member/{NN}/update` がスロット適用トリガ、`/vp/all/update` が全スロット適用、`/vp/mb/*` + `/vp/mb/update` が MotionBuilder 設定)を Unity ホスト(BasicConcertDevelopment_URP、VP_Generic)で実運用に載せようとしている。その手動検証で次の事象が起きた。

1. ブラウザで MB アドレスを `192.168.0.154` に変更し、Unity がエコーバックして表示が確定した。
2. Unity を Play し直した。新しい Unity インスタンスのステージング現在値はホスト供給の既定値(`192.168.101.11`)に戻る。
3. Unity が起動時に送ったマニフェストは、前回採用済みのものと `default` を含めて完全に同一だったため、UI(`packages/nicegui-ui/src/oscdesk_ui/state.py:242` の `manifest == self._manifest` の早期 return)は無視し、`seed_defaults` を呼ばなかった。表示は `192.168.0.154` のまま。
4. 操作者が Update(`/vp/mb/update`)を押すとトリガだけが送られ、Unity は自分の現在値 `192.168.101.11` を適用した。Unity 側ログ: `[OscDeskMbTarget] OscDeskNodeTranslatorTarget on "NodeTranslator": primary[1] 192.168.101.12:22000 -> 192.168.101.11:22000 (entries=2)`。

結果として、画面に `192.168.0.154` と表示された状態で Update を押したのに `192.168.101.11` が適用され、操作者には理由が見えない。レガシーの Windows アプリ(VP_OscClient)は Update 押下時にフォーム上の全設定値をひとつの MemoryPack blob(`/vp_member`)として送っており、「押した時点の画面の値が適用される」ことが運用者の前提になっている。現状の OscDesk はこの前提を満たさず、「ブラウザと Unity の内部パラメータを想像しながら操作する」ことを要求してしまう。スタジオでシステムを知らないオペレータが GUI だけ見て操作できる、という要件に反する。

### 現状の機構(本リポジトリ)

- ステージング意味論: `docs/UNITY_PROTOCOL.md:244-246`。staged 値は受信時に Unity 側 `currentValues` へ保持されエコーバックされる。適用トリガは非ゼロ受信時に、`appliesTo` に解決された `staged` アドレスの現在値をイベントへ渡す。UI からは値とトリガが別々の OSC メッセージで届く。
- `staged` / `appliesTo` は Unity の `OscSurfaceManifestAsset`(エントリごとの `staged` / `appliesTo`)と mock-unity のシナリオ `staging` 節にだけ存在し、ワイヤ上のマニフェスト JSON には出ていない(`OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs:355` の `TryBuildManifestJson`、`packages/shared/src/schemas.ts:14` の `ManifestEntryBaseSchema`、`packages/mock-unity/src/scenario.ts:171` の `buildManifestEntry`)。zod は未知キーを削除するため、仮に Unity が出してもブリッジ経由で UI には届かない。UI がボタンについて知るのは `group` だけである。
- UI のボタンは `pointerdown` で on 値、`pointerup` 等で off 値を送るだけ(`packages/nicegui-ui/src/oscdesk_ui/widgets.py:349` の `_build_button`)。表示値は `ValueStore.values_of(address)` で取得できる。
- ブリッジと osc-codec に OSC bundle の送信機能は無い。Unity 側 uOSC は受信 bundle を順序どおり展開する(`OscSurfaceBridge.cs` の §4.1 コメント)。mock-unity は `osc` npm を使う。
- UI → ブリッジの WebSocket フレームは `type: 'osc'` の単発メッセージ(`packages/shared/src/wire.ts:31`)。

### 要求する挙動(要件化の材料)

1. **Update 押下時のセット送信**: 適用トリガ(widget が button で適用範囲を持つエントリ)を押したとき、UI はその適用範囲に含まれる全エントリの **現在の表示値** を送ってからトリガの on 値を送る(off 値は従来どおり解放時)。display-only(blob 等)は除外する。未編集のエントリも送る(これが本件の核心)。「Update All」のように複数グループにまたがる範囲も同じ規則で扱う。
2. **適用範囲の公開**: UI が適用範囲を知れるよう、ワイヤ上のマニフェストで button エントリに適用範囲(`appliesTo` のアドレスパターン配列、OSC 1.0 の `*` サブセット)を出す。Unity の JSON ビルダ、共有 zod スキーマ、mock-unity のワイヤ出力の 3 か所を揃える。`staged` フラグをワイヤに出すかは設計で決める(フォークのプリセットでは適用範囲内の非ボタンは全て staged であり、非 staged への同値再送も冪等)。
3. **欠損時に古い staged 値を適用しない**: UDP で値メッセージの一部が落ちた場合にトリガだけが届き古い staged 値が適用される事態を防ぐ。候補は (a) osc-codec に bundle エンコードを追加し、値 + トリガを 1 データグラムで送る(推奨。uOSC は順序展開済み)、(b) UI が再送した値のエコーバックを全件待ってからトリガを送り、タイムアウト時は適用せずエラー表示する。ブリッジ / UI の責務分離(UI はブリッジの WebSocket プロトコルを使う)を守ること。
4. **再採用時の表示再同期**: Unity 再起動などでブリッジが新たにマニフェストを採用したとき、内容が前回と同一でも UI は各エントリの表示を `default` に再同期する(`docs/UNITY_PROTOCOL.md:117` の「再接続直後の表示を実状態へ寄せる初期同期」を、同一内容の再採用にも適用する)。ブリッジのマニフェストフレームに採用シーケンス番号を持たせるか、UI 側の同一比較を外すかは設計で決める。編集中(ホールド中)の input を上書きしない既存規則との整合を取る。
5. **Unity 側の意味論は不変**: staged / appliesTo / 展開規則 / `/sys/*` / エコーバックの規則は変えない。トリガ受信時に Unity が自分の現在値から適用する動作もそのまま(再送された値が直前に記録されるため結果が一致する)。`protocol/staging-cases.json` は変更不要のはず。
6. **サイズ制約**: フォークの 64 スロットプリセットはワイヤ上 51,136 byte(実測)で、フォークでは警告閾値を `56 * 1024`、実用上限を `60 * 1024` としている。`appliesTo` を 66 トリガに付けると約 2 KB 強増える見込み。実測して `MANIFEST_SIZE` の規則に当てること。増加を抑えるため `appliesTo` はトリガにだけ付ける。
7. **対象外**: TouchOSC 等の OSC ネイティブ UI は引き続き Unity 側ステージングに依存する(`docs/TOUCHOSC_EVAL.md`)。レガシー blob 互換は作らない。

### 受け入れの観点

- mock-unity: ワイヤ出力に `appliesTo` が出ること、既存の staging 挙動テストが緑のまま。
- E2E: Update 押下で「値 N 件 + トリガ」が Unity(mock)に届き、`MOCK_UNITY_APPLY` の件数と適用値が UI 表示値と一致すること。Unity 再起動(mock 再起動)後に UI が `default` へ再同期し、その後の Update で再起動後の実値が適用されること。
- NiceGUI ブラウザテスト: Update 押下時の送信順序と件数、同一マニフェスト再採用時の表示更新。
- 文書: `docs/UNITY_PROTOCOL.md`(§2 のマニフェスト項目、staged 節、§3 の同期規律)、`DESIGN.md` の判断記録、`docs/VERIFICATION.md` の手動手順。

### フォーク側との関係

- 本 spec の成果はフォーク a8-oscdesk が `upstream/main` をマージして取り込む。フォークではその後、`OscSurfaceBridge.cs` をホストへ文字列一致で再移植し、HostDoc の手動検証項目を更新し、ワイヤサイズを再実測する。
- フォークからの別件フィードバック `docs/UPSTREAM_FEEDBACK_HOST_MIGRATION.md`(`OscSurfaceBridge.SetManifestAsset` / `SendManifestNow` の公開 API 追加)はまだ本リポジトリ未反映であり、本 spec とは独立。`TryBuildManifestJson` 周辺の変更が衝突しないよう、フォーク側の差分(フォークでは同関数が 387 行目)を意識して設計する。

## Introduction

本仕様は、OscDesk の適用トリガ(Update ボタン)の押下時挙動を「トリガだけを送る」から「適用範囲に含まれる全エントリの現在の表示値をセットで送ってからトリガを送る」へ改め、操作者が画面に見えている値がそのまま Unity に適用されると信じられる状態を作るものである。あわせて、Unity 再起動などで同一内容のマニフェストが再採用されたときに UI の表示を `default`(Unity の現在値)へ再同期し、画面と Unity の内部状態が乖離したまま固定される事態を防ぐ。

このために、Unity が宣言する適用範囲(`appliesTo`)をワイヤ上のマニフェストへ公開し、共有スキーマ・mock-unity・Unity 参照実装の 3 か所を揃える。Unity 側のステージング意味論(staged / appliesTo / 展開規則 / `/sys/*` / エコーバック)は変更しない。

## Boundary Context

- **In scope**:
  - ワイヤ上のマニフェストにおける button エントリの適用範囲(`appliesTo`)の公開(Unity 参照実装の JSON ビルダ、共有 zod スキーマ、mock-unity のワイヤ出力、UI のマニフェスト解釈)
  - NiceGUI UI の適用トリガ押下時のセット送信(値の集合 + トリガ)
  - 値の欠損時に古い staged 値が適用されないための配送保証(OSC bundle 化またはエコーバック確認のいずれか。設計で決定)
  - 同一内容を含むマニフェスト再採用時の UI 表示再同期
  - マニフェストのワイヤサイズの実測と `MANIFEST_SIZE` 規則への適合
  - 契約文書(`docs/UNITY_PROTOCOL.md`、`docs/BRIDGE_PROTOCOL.md`、`protocol/wire-samples.json`)、判断記録(`DESIGN.md`)、手動検証手順(`docs/VERIFICATION.md`)の更新
- **Out of scope**:
  - TouchOSC 等の OSC ネイティブ UI からの適用(引き続き Unity 側ステージングに依存する)
  - レガシー Windows アプリ(VP_OscClient)の MemoryPack blob 互換
  - Unity 側ステージング意味論・展開規則・`/sys/*` プロトコル・エコーバック規則の変更
  - フォークからの別件フィードバック `docs/UPSTREAM_FEEDBACK_HOST_MIGRATION.md`(`SetManifestAsset` / `SendManifestNow` の公開 API)
  - フォーク側でのホストへの再移植・HostDoc 更新・ワイヤサイズ再実測
- **Adjacent expectations**:
  - 本仕様の成果はフォーク a8-oscdesk が `upstream/main` をマージして取り込むため、`OscSurfaceBridge.cs` の `TryBuildManifestJson` 周辺の変更は局所化し、フォーク側の差分と衝突しにくい形にする
  - ブリッジと UI の責務分離(UI はブリッジの WebSocket プロトコルだけを使い、OSC/UDP を直接扱わない)を維持する
  - 「Unity が真実の源」の規律を維持する。UI の表示は引き続きキャッシュであり、値の確定はエコーバックのみで行う
  - `unity-staging-apply` で定めた既存のステージング挙動テストと `protocol/staging-cases.json` を変更せずに緑のまま保つ

## Requirements

### Requirement 1: 適用範囲(appliesTo)のワイヤ公開

**Objective:** As a UI 開発者, I want Unity が宣言した適用トリガの適用範囲がワイヤ上のマニフェストに含まれること, so that UI が Unity 側の宣言と同じ根拠で「どの値をセットで送るべきか」を判断できる

#### Acceptance Criteria

1. The 共有 zod スキーマ(`ManifestEntrySchema`) shall button エントリに任意項目 `appliesTo`(アドレスパターンの文字列配列)を受け入れる
2. If `widget` が `button` でないエントリに `appliesTo` が含まれている, then the 共有 zod スキーマ shall そのマニフェストを不採用(スキーマ違反)とし、違反箇所のパスをログへ残す
3. If `appliesTo` の要素が `docs/UNITY_PROTOCOL.md` §4.3.1 のワイルドカード規則に反する形(先頭が `/` でない、末尾が `/`、空 part、`//`、`*` 以外のワイルドカード文字)である, then the 共有 zod スキーマ shall そのマニフェストを不採用(スキーマ違反)とする
4. When Unity 参照実装(`OscSurfaceBridge`)がマニフェスト JSON を生成する, the Unity 参照実装 shall `AppliesTo` が非空の button エントリにだけ `appliesTo` を出力し、それ以外のエントリには `appliesTo` キーを出力しない
5. When mock-unity がシナリオの `staging` 節に適用トリガを持つ, the mock-unity shall ワイヤ上のマニフェストの当該 button エントリに同じパターン配列を `appliesTo` として出力する
6. When ブリッジが `appliesTo` を含むマニフェストを採用する, the ブリッジ shall `appliesTo` を削除せずに `manifest` フレームで UI クライアントへ配信する
7. When UI がマニフェストフレームを受信する, the OscDesk UI shall 各 button エントリの `appliesTo` を保持し、適用範囲の解決に使えるようにする
8. The 共有 zod スキーマ shall `appliesTo` を持たない従来形式のマニフェストを引き続き受け入れる(後方互換)
9. The プロトコル契約(`protocol/wire-samples.json`、`docs/BRIDGE_PROTOCOL.md`、`docs/UNITY_PROTOCOL.md` §2) shall `appliesTo` を含むマニフェストのサンプルと項目説明を含み、TypeScript 側と Python 側の双方の契約テストで同じサンプルを読めること
10. The 共有 zod スキーマ・Unity 参照実装・mock-unity shall staged と宣言されたエントリにだけ任意項目 `staged: true` をワイヤ上のマニフェストへ出力し(非 staged エントリには `staged` キーを出力しない)、3 か所で同じ意味に揃える
11. The 共有 zod スキーマ shall `staged` を持たない従来形式のマニフェストを引き続き受け入れる(後方互換)

### Requirement 2: 適用範囲の解決規則の一致

**Objective:** As a オペレータ, I want UI が送るセットの範囲が Unity 側の適用範囲と一致すること, so that 画面に見えている値と Unity が適用する値の集合がずれない

#### Acceptance Criteria

1. The OscDesk UI shall `appliesTo` のパターンと採用済みマニフェストの各エントリのアドレスを `docs/UNITY_PROTOCOL.md` §4.3.1 と同一の規則(`/` で分割し part 数が一致するときだけ照合、各 part の `*` は `/` を跨がない 0 文字以上に一致)で照合する
2. When `appliesTo` のいずれかのパターンに一致する, the OscDesk UI shall 当該エントリを適用範囲に含める(複数パターン・複数グループにまたがる範囲も同じ規則で扱う)
3. The OscDesk UI shall 適用範囲に一致したエントリのうち、`widget` が `button` のエントリ(トリガ自身および他のトリガ)を送信対象から除外する
4. The OscDesk UI shall 適用範囲に一致したエントリのうち、`type` が `b`(blob)のエントリおよび UI が値送信を持たない表示専用ウィジェットのエントリを送信対象から除外する
5. The UI のパターン照合 shall `protocol/staging-cases.json`(または同等の共有ケース集)に含まれる照合ケースに対して Unity 参照実装・mock-unity と同じ一致結果を返すことをテストで確認できる
6. If `appliesTo` のパターンがどのエントリにも一致しない, then the OscDesk UI shall 値を送らずにトリガの on 値だけを送り(従来挙動)、警告ログを残す
7. The OscDesk UI shall 適用範囲に一致したエントリのうち、`staged: true` を持たないエントリを送信対象から除外する(展開元エントリ(例: `/member/all/enabled`)が適用範囲に一致した場合に、その再送による展開で staged 値が上書きされることを防ぐ)

### Requirement 3: 適用トリガ押下時のセット送信

**Objective:** As a オペレータ, I want Update を押した時点で画面に見えている値がそのまま適用されること, so that ブラウザと Unity の内部パラメータを想像しながら操作しなくてよい

#### Acceptance Criteria

1. When 操作者が `appliesTo` を持つ適用トリガを押下(pointerdown)する, the OscDesk UI shall 送信対象エントリの現在の表示値を全件送ってから、トリガの on 値を送る
2. The OscDesk UI shall 送信対象エントリを、操作者が編集したかどうかにかかわらず(未編集のエントリも含めて)全件送る
3. The OscDesk UI shall 各値をマニフェストの `type` に対応する型タグで送り、`bool` 型は `i` の 0/1 で送る(単発送信と同じ表現)
4. The OscDesk UI shall 送信対象エントリをマニフェストのエントリ定義順で送り、トリガの on 値を最後に送る
5. When 操作者が適用トリガを解放(pointerup 等)する, the OscDesk UI shall 従来どおりトリガの off 値だけを送り、値の再送は行わない
6. When 操作者が `appliesTo` を持たない button(適用範囲のないトリガ)を押下する, the OscDesk UI shall 従来どおり on 値だけを送る
7. The OscDesk UI shall セット送信の値を送信レート制限による間引き・結合の対象にせず、全件を欠けなく送る
8. If 送信対象エントリに表示値が存在しない(`default` もエコーバックも未受信), then the OscDesk UI shall 当該エントリを送信対象から除外し、除外したアドレスを警告ログに残す
9. While 送信対象エントリのいずれかが操作者による編集中(ホールド中)である, the OscDesk UI shall そのエントリについて画面に表示されている編集中の値を送る
10. When セット送信の値が Unity からエコーバックされる, the OscDesk UI shall 通常の単発送信と同じ規律(§3 双方向同期)で表示を確定する

### Requirement 4: 値の欠損時に古い staged 値を適用させない配送保証

**Objective:** As a オペレータ, I want 通信の欠損があっても「画面と違う古い値が適用される」ことが起きないこと, so that 適用結果を信頼でき、失敗したときはそれが分かる

#### Acceptance Criteria

1. The OscDesk システム(ブリッジと UI) shall セットに含まれる全値が Unity に到達していない状態でトリガだけが Unity に届くことがないように、値とトリガを配送する
2. If セットの値が Unity に到達したことを保証できない(データグラムの欠損、確認待ちのタイムアウト等), then the OscDesk システム shall トリガを送らず、操作者に適用が行われなかったことをエラーとして表示する
3. Where OSC bundle による配送を採用する, the ブリッジ(UDP トランスポートと送信経路) shall osc-codec の既存 bundle エンコード(`encodeOscPacket` の bundle 対応)を使い、セットの全値とトリガを 1 つの bundle(単一データグラム)として送信する
4. Where OSC bundle による配送を採用する, the ブリッジの WebSocket プロトコル shall UI がセット(複数の OSC メッセージ)をひとまとまりとして送れるフレームを提供し、そのフレームは共有 zod スキーマで検証され `protocol/wire-samples.json` と `docs/BRIDGE_PROTOCOL.md` に記載される
5. Where OSC bundle による配送を採用する, the mock-unity shall 受信 bundle を要素の順序どおり展開して処理する
6. Where エコーバック確認による配送を採用する, the OscDesk UI shall 送った全値のエコーバックを受信してからトリガを送り、タイムアウト時はトリガを送らずエラー表示する
7. If セットのエンコード後サイズが単一 UDP データグラムの実用上限を超える, then the OscDesk システム shall 黙って切り捨てず、設計で定めた代替配送(分割せずに確認付き配送へ切り替える等)または操作者へのエラー表示のいずれかを行う
8. The OscDesk UI shall 配送方式にかかわらず、Unity との OSC/UDP 通信を直接行わず、ブリッジの WebSocket プロトコルだけを使う
9. The ブリッジ shall セットとして送った各 OSC メッセージ(値およびトリガ)を NDJSON 診断証跡に個別のメッセージとして記録し、操作者が「値 N 件 + トリガ」を確認できるようにする

### Requirement 5: マニフェスト再採用時の表示再同期

**Objective:** As a オペレータ, I want Unity を再起動したあとに画面の値が Unity の現在値に戻ること, so that 再起動前の古い表示を見て操作することがない

#### Acceptance Criteria

1. When ブリッジが新たにマニフェストを採用する(前回採用分と内容が完全に同一である場合を含む), the OscDesk UI shall 各エントリの表示値を当該マニフェストの `default` に再同期する
2. The ブリッジの WebSocket プロトコル shall UI が「新たな採用」を識別できる手段(採用シーケンス番号等)を提供するか、または UI が同一内容比較による早期 return を持たないことで、同一内容の再採用を取りこぼさないこと
3. When マニフェスト再採用による表示再同期が行われる, the OscDesk UI shall Unity への OSC 送信を発生させない(フィードバックループ禁止)
4. While 操作者があるエントリを編集中(ホールド中)である, the OscDesk UI shall 当該エントリの編集中の値を再同期で上書きしない
5. When 同一内容のマニフェストが再採用される, the OscDesk UI shall 操作者の編集中の入力内容を破棄せず、ウィジェットの操作性(フォーカス・スクロール位置)を損なわない
6. The OscDesk UI shall `type` が `b`(blob)のエントリを再同期の対象外とし、警告ログのみ残す(既存規則を維持)
7. When mock-unity(または Unity)を再起動して同一マニフェストが再採用され、その後に操作者が適用トリガを押下する, the OscDesk システム shall 再起動後の `default` に基づく表示値をセットで送り、Unity は再起動後の実値を適用する
8. If マニフェストが不採用(スキーマ違反・`project-mismatch`)となる, then the OscDesk UI shall 表示を再同期せず、直前の採用済み状態を維持する(既存のガード規則を維持)

### Requirement 6: Unity 側意味論の不変と後方互換

**Objective:** As a Unity 側実装者, I want 既存のステージング・展開・エコーバック規則を変えずに本機能が成立すること, so that 参照実装を再移植したホストでも挙動が変わらず、既存の検証結果を維持できる

#### Acceptance Criteria

1. The Unity 参照実装 shall staged 値の受信時記録、適用トリガの非ゼロ受信時の適用、展開規則、`/sys/*` の応答、エコーバック規則を本仕様の前後で変えない
2. The Unity 参照実装 shall トリガ受信時に自身の `currentValues` から適用する動作を維持する(UI が直前に送った値が記録されるため、結果として画面の値が適用される)
3. The `protocol/staging-cases.json` および既存のステージング挙動テスト shall 変更なしで緑のまま維持される
4. When UI が `appliesTo` を出力しない従来の Unity(または mock シナリオ)に接続する, the OscDesk UI shall 適用トリガを従来どおり on/off の 2 メッセージで送り、エラーにしない
5. The Unity 参照実装の変更 shall `TryBuildManifestJson` 周辺に局所化し、フォーク側の差分と衝突しにくい形で行う
6. The Unity 参照実装の C# 変更 shall テスト入口(`corepack pnpm test`)の外であることを踏まえ、コンパイル可能性を別途確認した記録を残す

### Requirement 7: マニフェストのワイヤサイズ制約

**Objective:** As a 案件構築者, I want 64 スロット規模のプリセットでもマニフェストが単一データグラムに収まること, so that 大規模案件で `appliesTo` の追加がマニフェスト配信を壊さない

#### Acceptance Criteria

1. The Unity 参照実装および mock-unity shall `appliesTo` を適用トリガ(`AppliesTo` が非空の button エントリ)にだけ、`staged: true` を staged エントリにだけ付与し、それ以外のエントリにサイズを増やす項目を追加しない
2. The 本仕様の成果 shall 64 スロット相当(66 トリガに `appliesTo` を付与、256 エントリに `staged: true` を付与)のマニフェストのワイヤサイズ増分を実測し、その値を `DESIGN.md` または `docs/UNITY_PROTOCOL.md` に記録する
3. The 64 スロット相当のマニフェスト shall `MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES`(60 KiB)を超えない
4. If 64 スロット相当のマニフェストが `MANIFEST_SIZE.WARNING_BYTES` を超える, then the 本仕様 shall 警告閾値の扱い(現行 48 KiB を維持するか、フォークの 56 KiB に合わせるか)を `DESIGN.md` に判断として記録する
5. When マニフェストのサイズが警告閾値を超える, the 送信側(Unity 参照実装・mock-unity) shall 既存の規則どおり警告を出し、配信は継続する

### Requirement 8: 検証と文書

**Objective:** As a 開発者, I want 本機能が自動テストと手動検証手順の両方で確認できること, so that フォークへの取り込み後もリグレッションを検出できる

#### Acceptance Criteria

1. The mock-unity の単体テスト shall `staging` 節を持つシナリオでワイヤ上のマニフェストに `appliesTo` と `staged: true` が出力されることを確認する
2. The E2E テスト shall 適用トリガ押下で「値 N 件 + トリガ」が mock-unity に届き、`MOCK_UNITY_APPLY` の件数と適用値が UI 側の表示値と一致することを確認する
3. The E2E テスト shall mock-unity 再起動後に UI が `default` へ再同期し、その後の適用トリガ押下で再起動後の実値が適用されることを確認する
4. The NiceGUI ブラウザテスト shall 適用トリガ押下時の送信順序(値の全件 → トリガ on)と件数、および解放時の off 値送信を確認する
5. The NiceGUI ブラウザテスト shall 同一内容のマニフェスト再採用時に表示値が `default` へ更新されること、およびホールド中のエントリが上書きされないことを確認する
6. The クロス言語契約テスト shall 更新された `protocol/wire-samples.json`(`appliesTo` を含むマニフェスト、および新フレームがある場合はそのサンプル)を TypeScript 側と Python 側の双方で読み、エンコード/デコードできることを確認する
7. The `docs/UNITY_PROTOCOL.md` shall §2 のマニフェスト項目に `appliesTo` を追加し、§4.3.1 のステージング節に UI 側のセット送信との関係を、§3 の同期規律に再採用時の再同期を記述する
8. The `docs/BRIDGE_PROTOCOL.md` shall マニフェストフレームの `appliesTo`、および採用識別手段や新フレームがある場合はその仕様を記述する
9. The `DESIGN.md` shall 配送方式(bundle かエコーバック確認か)、`staged` のワイヤ公開の有無、再採用の識別手段、警告閾値の扱いを `D-0xx` として記録する
10. The `docs/VERIFICATION.md` shall 適用トリガ押下時のセット送信と、Unity 再起動後の表示再同期を確認する手動検証手順を含む
11. The 全テスト shall `corepack pnpm test` の単一入口から到達でき、既存のガードテスト(旧名称の残留検出等)を含めて緑のまま維持される
