# Implementation Plan

## 実装順序の方針

design.md の段階順(① shared の契約 → ② Unity 役の出力 → ③ ブリッジ → ④⑤ UI → ⑥ E2E・サイズ実測 → ⑦ 契約文書・判断記録 → ⑧ 最終確認)に沿う。テストはすべて `corepack pnpm test` の単一入口(vitest + pytest)から到達させる。C# はテスト入口の外なので、batchmode コンパイル確認を独立タスク(2.4)にする。

- [x] 1. 契約の基盤(shared のスキーマ・定数・照合器・見本)
- [x] 1.1 アドレスパターン照合器を shared へ移設し、言語間共有のケース集を作る
  - mock-unity にある形検証と `*` 照合(part 数一致時のみ照合、`*` は `/` を跨がない 0 文字以上、先頭 `/` 必須、末尾 `/`・`//`・空 part・`?[]{},` の拒否)を挙動不変で shared に移し、複数パターンのいずれかに一致する判定も提供する
  - mock-unity 側は移設先を再エクスポートして既存 import と `staging-cases.json` 駆動テストを壊さない。ローカルに照合器の本体を残さない
  - `protocol/address-pattern-cases.json` を新設し、design.md の最低ケース(part 数不一致、末尾 `/`、`//`、`?`、`*` の 0 文字一致、深さ超過、先頭 `/` 無し、`/member/*/*` と `/member/01/name` の一致)を含める
  - 完了条件: shared の単体テストがケース集の全件を通り、既存のステージング挙動テストと staging-fixture-parity ガードが無変更で緑
  - _Requirements: 1.3, 2.1, 2.5, 6.3_

- [x] 1.2 サイズ定数を集約し、警告閾値と適用セットの上限を定める
  - マニフェストのサイズ定数を専用モジュールに移し(既存の import パスは不変)、警告閾値を 56 KiB へ改定する
  - 適用セットの上限(メッセージ数 512、エンコード後 60 KiB)と OSC の即時タイムタグ定数を追加する
  - wire スキーマから参照しても循環にならない配置にする
  - 完了条件: 既存の「共有参照シナリオは警告閾値未満」の断言が引き続き成立し、typecheck が通る
  - 1.1 と同じ再エクスポート元(shared の index)を編集するため 1.1 の後に行う(並列不可)
  - _Requirements: 4.7, 7.4_

- [x] 1.3 マニフェストスキーマに `staged` / `appliesTo` を追加し、見本で違反判定を固定する
  - `staged` は `true` のみ許す省略可項目、`appliesTo` は 1 件以上の文字列配列の省略可項目として受け入れる
  - `widget` が button 以外に `appliesTo` があれば `entries[i].appliesTo` のパスで、要素が形違反なら `entries[i].appliesTo[j]` のパスでスキーマ違反にする(形検証は 1.1 の照合器を使う)
  - `protocol/manifest-samples.json` に valid(`appliesTo` 付き button + `staged` 付き input)と invalid(fader に `appliesTo`、`/a//b`、空配列、`staged: false`)を追加する
  - 完了条件: 両項目を持たない従来形式が無変更で受理され、TS のスキーマテストと見本テストが新ケースを含めて緑。違反時のログ detail に path が含まれる
  - _Requirements: 1.1, 1.2, 1.3, 1.8, 1.9, 1.10, 1.11, 8.6_

- [x] 1.4 WebSocket フレームに採用識別 `adoption` と上り `oscBatch` を追加し、見本を更新する
  - 下り `manifest` フレームに `adoption { seq: 正の整数, at: ISO 8601 }` を必須項目として追加する
  - 上り `oscBatch` フレーム(strict なメッセージ配列、1 件以上・上限は 1.2 の定数、各要素は単発 `osc` と同じ引数スキーマ)を新設する。内部予約アドレスの拒否はスキーマではなくブリッジ本体(3.2)で行う
  - `protocol/wire-samples.json` の `downstream-manifest` に `adoption` と `staged` / `appliesTo` 付きエントリを入れ、`upstream-osc-batch`(valid)と `upstream-osc-batch-empty`(invalid)を追加する
  - 完了条件: wire の単体テストと見本テストが緑。`adoption` 欠落の `manifest` フレームと空の `oscBatch` が拒否される
  - _Requirements: 1.9, 4.4, 5.2, 8.6_

- [x] 2. Unity 役の出力(mock-unity と Unity 参照実装)
- [x] 2.1 (P) mock-unity のワイヤ出力に `staged` / `appliesTo` を付与する
  - シナリオの `staging` 節から、staged 宣言されたアドレスへ `staged: true` を、トリガ宣言に一致する button へ同じパターン配列を `appliesTo` として付ける。それ以外にはキーを出さない
  - シナリオの `entries` に `staged` / `appliesTo` を直接書いた場合はシナリオ検証で拒否し、`staging` 節を唯一の宣言元にする
  - 照合器は 1.1 の shared 実装を使う
  - 完了条件: `staging.json` のワイヤ出力で `/member/01/update` に `appliesTo: ["/member/01/*"]`、`/member/01/name` に `staged: true`、`/member/all/enabled` に `staged` 無し、`/legacy/status` に両キー無しであることを単体テストで確認。既存のステージング挙動テストは無変更で緑
  - _Requirements: 1.5, 1.10, 6.3, 7.1, 8.1_
  - _Boundary: mock-unity Scenario 拡張_

- [x] 2.2 (P) mock-unity の適用ログに適用値を付記し、bundle の順序展開を確認する
  - `MOCK_UNITY_APPLY <trigger> <count>` 行の末尾に適用値の JSON 配列(アドレスと値)を付け、既存の接頭辞は変えない(前方互換)
  - 受信 bundle が要素順どおりに展開され、値の記録 → トリガ適用の順で処理されて適用行が 1 行出ることを単体テストで確認する
  - 完了条件: 値 2 件 + トリガの bundle を受けたとき、stderr に件数 2 と両方の値を含む適用行が 1 行出る
  - _Requirements: 4.5, 8.2_
  - _Boundary: mock-unity Responder / エントリポイント_

- [x] 2.3 (P) Unity 参照実装のマニフェスト JSON に `staged` / `appliesTo` を追記する
  - マニフェスト JSON ビルダの `pattern` ブロック直後に、`staged == true` なら `"staged":true`、button かつ `AppliesTo` 非空なら `"appliesTo":[…]` を出す 2 ブロックを追記する。既存行は書き換えない(フォークの文字列一致再移植のため)
  - 受信処理・ステージングエンジン・`/sys/*`・エコーバック規則には手を入れない
  - `docs/UNITY_PROTOCOL.md` 付録 A.2.4 のコードブロックを実ファイルと同期する
  - 完了条件: appendix-source-parity ガードが緑で、付録の差分が追記 2 ブロックだけである
  - _Requirements: 1.4, 1.10, 6.1, 6.2, 6.5, 7.1_
  - _Boundary: Unity JSON Builder 拡張_

- [x] 2.4 Unity batchmode でコンパイル確認し、結果を記録する
  - `docs/VERIFICATION.md` の既存手順に従い `-batchmode -quit -nographics -logFile` でプロジェクトをコンパイルし、`error CS` が無いことを確認する(Editor で同プロジェクトを開いたまま実行しない)
  - EditMode テスト(StagingFixtureTests)が無変更で緑であることも確認する
  - 完了条件: 日付・エディタ版・結果が `docs/VERIFICATION.md` に記録されている
  - _Requirements: 6.6_

- [x] 3. ブリッジ(bundle 送信・`oscBatch` 受理・採用識別)
- [x] 3.1 UDP トランスポートに bundle の単一データグラム送信を追加する
  - 複数メッセージを即時タイムタグの OSC bundle にエンコードし、エンコード後バイト数が上限(1.2 の定数)を超えていれば送らずに `too-large` を結果で返す。超えていなければ 1 回だけ送信し、バイト数と件数を返す
  - 送信結果の判別型(成功 / too-large / transport-unavailable)を定める。既存の単発 `send` は変更しない
  - 完了条件: ループバック受信側が 1 データグラムを受け取り、デコードすると元の順序で N 件に展開される。`too-large` のときソケットに触れない
  - _Requirements: 4.1, 4.3, 4.7_

- [x] 3.2 Surface Core で `oscBatch` を受理し、拒否通知と診断記録を行う
  - bundle 送信関数を依存として注入し(既存の送信関数注入パターン)、`oscBatch` を受けたら内部予約アドレスの混入を検査 → bundle 送信 → 成功時に各メッセージを NDJSON へ `out` で個別記録する
  - 内部アドレス混入・`too-large`・トランスポート不在は送らずに、送信元 UI にだけ `notice(error, batch-rejected, detail)` を返す。送らなかったセットは NDJSON に記録しない
  - ブリッジは値の意味(staged かトリガか)を解釈しない
  - 完了条件: 単体テストで「`oscBatch` → bundle 送信 1 回 + 記録 N+1 回」「内部アドレス混入で送らず notice」「too-large で notice」が緑
  - 3.1 の結果型を共有するため 3.1 の後に行う
  - _Requirements: 1.6, 4.1, 4.7, 4.9_

- [x] 3.3 採用ごとの `adoption` 採番と `manifest` 配信経路の集約
  - マニフェスト採用成功時にだけ `seq` を 1 ずつ進め、注入された時計から `at` を生成する。不採用(スキーマ違反・project-mismatch)では進めない
  - 採用時ブロードキャスト・UI 接続時・`manifestRequest` の 3 経路を単一の配信関数に集約し、再送は直近の採用と同じ `adoption` を付ける
  - `appliesTo` / `staged` を含むマニフェストが削られずに `manifest` フレームに載ることを確認する
  - 完了条件: 単体テストで「採用 2 回で seq 1→2」「再送は同一 adoption」「不採用で不変」「`appliesTo` が配信フレームに残る」が緑
  - 3.2 と同じ Surface Core を編集するため並列不可
  - _Requirements: 1.6, 5.1, 5.2, 5.8_

- [x] 3.4 ブリッジの配線と既存 E2E の更新
  - bridge-server で bundle 送信関数を UDP トランスポートへ配線し、トランスポート不在時は `transport-unavailable` を返す
  - 既存 E2E(ws-protocol / bridge-loopback)の `manifest` フレーム断言を `adoption` 込みに更新する
  - 完了条件: 実プロセスで起動したブリッジが `adoption` 付き `manifest` を配信し、既存 E2E が緑
  - _Requirements: 4.1, 5.2_

- [x] 4. UI の純粋ロジックとプロトコル(NiceGUI 非依存)
- [x] 4.1 (P) アドレスパターン照合の Python 実装
  - shared と同じ規則(形検証・part 数一致・`*` は part 内 0 文字以上)を標準ライブラリだけで写す。`re` を使う場合は part 単位で escape し fullmatch する
  - 完了条件: `protocol/address-pattern-cases.json` の全ケースで TS と同じ真理値を返すテストが緑
  - _Requirements: 2.1, 2.5_
  - _Boundary: address_pattern (Python)_
  - _Depends: 1.1_

- [x] 4.2 (P) プロトコル層の `adoption` 復号と `oscBatch` 符号化、リンクのセット送信
  - `manifest` フレームの復号で `adoption`(seq ≥ 1、at 文字列)を必須にし、欠落・型違いは復号エラーにする。許容キー集合に `adoption` を加える
  - OSC メッセージ(アドレス + 型付き引数)の値オブジェクトと、複数メッセージを 1 つの `oscBatch` フレームへ符号化する関数を追加する(空はエラー)
  - リンクにセット送信を追加し、接続中なら 1 フレームを送信キューに積んで真、未接続なら偽を返す(UI は WebSocket 以外の経路を持たない)
  - 完了条件: `test_wire_samples.py` が更新済み見本(`upstream-osc-batch` の完全一致、`downstream-manifest` の `adoption`)で緑。リンクのテストで 1 フレームだけが積まれる
  - _Requirements: 4.4, 4.8, 5.2, 8.6_
  - _Boundary: Protocol / SurfaceLink 拡張_
  - _Depends: 1.4_

- [x] 4.3 (P) ValueStore の下書き・編集前値・強制再同期
  - ホールド開始時に編集前値を保存し、ホールド中に届いた `default`(強制再同期)やエコーは表示を変えずに編集前値だけを更新する
  - ホールド中の下書きを保持する(ホールド外では無視)。下書きはホールド終了・期限切れ・確定で破棄する
  - 未確定でホールドを離れた(blur・期限切れ・切断解放)とき、編集前値が表示値と異なれば下書きを捨てて表示を編集前値へ戻す(revision 進行、送信なし)。確定して離れたときは従来どおり確定値を返す
  - `seed_defaults` に force モードを追加し、ホールド中でないチャネルを `default` で上書き、blob は除外して理由を返す。値が等しいときは revision を進めない。送信経路(保留・最終送信時刻)には触れない
  - 完了条件: 単体テストで「force で上書き・revision 進行」「holding は据え置きで編集前値が default」「blob 除外と理由」「未確定 end_hold で default に戻り戻り値 None」「確定で確定値が返る」「echo 後の未確定 expire_hold で echo 値」が緑
  - _Requirements: 3.9, 5.1, 5.3, 5.4, 5.6_
  - _Boundary: ValueStore 拡張_

- [x] 4.4 マニフェスト解釈の `staged` / `applies_to` 対応と表示専用判定の移設
  - エントリに `staged`(既定 False)と `applies_to`(None = 範囲なし)を持たせ、`appliesTo` は button のときだけ・1 件以上・各要素が形検証を通ることを、`staged` は `true` のみを検証する。エラー文言は既存書式に合わせる
  - 表示専用判定とボタンの on/off 値の算出を NiceGUI 非依存のルールモジュールへ移し、widgets 側は import して使う(挙動不変)。適用トリガ判定(button かつ範囲あり)を追加する
  - 完了条件: `test_manifest.py` と共有見本テスト(`manifest-samples.json`)が TS と同じ valid / invalid 判定で緑。従来形式のマニフェストは無変更で受理。ブラウザスモークと import スモークが緑
  - 4.1 の形検証を使うため 4.1 の後に行う
  - _Requirements: 1.7, 1.8, 1.11, 2.4, 8.6_

- [x] 4.5 適用範囲の解決とセット組み立ての純粋関数
  - トリガと採用済みマニフェストから、定義順を保って適用範囲を解決する: トリガ自身を除く / いずれかのパターンに一致 / button でない / blob でない / 表示専用でない / `staged: true` を持つ
  - 値の取り出しを Protocol で抽象化し、ホールド中で下書きがあれば入力確認の検証を通った場合だけ採用(通らなければ `invalid-draft` として除外)、それ以外は表示値、表示値が無ければ `no-value` として除外する
  - ワイヤ引数への正規化: `i`(bool 型含む)は Python の bool を 0/1 の int に、数値は int に、`f` は float にする。多値(xy)は値の個数ぶんタグを繰り返す。末尾にトリガの on 値を 1 件付ける
  - 完了条件: 単体テストで `/member/all/update` の範囲が 4 件になること、bool default(`(False,)` / `(True,)`)を含む未編集 toggle が `{"type":"i","value":0/1}` になり `messages` に bool インスタンスが一切現れないこと、下書きの採用 / 除外、`no-value` 除外、順序とトリガ末尾が緑
  - _Requirements: 2.2, 2.3, 2.4, 2.7, 3.2, 3.3, 3.4, 3.8, 3.9_

- [x] 5. UI の統合(SurfaceState・widgets・page)
- [x] 5.1 SurfaceState の適用トリガ押下・エコー待ち・通知ログ
  - 押下時: 適用トリガでない、または範囲が空(警告ログ)なら従来どおり on 値を単発送信。それ以外はセットを組み立て、除外があれば警告ログ + warn 通知、トリガのチャネルだけ on 値に更新し、`oscBatch` を 1 フレームで送る(値チャネルの間引き・保留を経由しない)。未接続なら「ブリッジ未接続」の error 通知
  - 送信成功時にトリガの期限(固定 2 秒)を登録し、非ゼロエコーで解除。`tick()` で期限切れを「確認できなかった」error 通知にし(未適用と断定しない)、期限切れトリガを 10 秒保持して遅延エコーが届けば info 通知
  - `notice(error)` の `batch-rejected` / `invalid-frame`、および切断時に全 pending を失敗にする。セットの値のエコーは通常の単発送信と同じ規律で表示を確定する
  - 通知は `ui.notify` を直接呼ばず seq 付きログ(直近 50 件)に積み、カーソル以降を読める API を提供する。下書きの受け口を追加する
  - 完了条件: 単体テストで「送信順序 = 定義順 + トリガ末尾」「範囲なし / `applies_to` 無しで単発 on」「非ゼロエコーで解除」「2 秒で error 通知」「10 秒以内の遅延エコーで info、超過は無視」「`invalid-frame` で失敗」が緑
  - _Requirements: 2.6, 3.1, 3.2, 3.4, 3.6, 3.7, 3.10, 4.2, 6.4_

- [x] 5.2 SurfaceState の採用識別による強制再同期
  - `manifest` フレームの `(seq, at)` が前回と等しければ状態を一切変えない。異なれば内容が同一でも `seed_defaults(force=True)` を行い、内容が異なる場合だけマニフェスト本体と `manifest_revision` を更新する(同一内容では値チャネルの revision だけ進み、再描画を起こさない)
  - 切断で `(seq, at)` を捨てない。再同期で OSC 送信を発生させない。再同期の採用 seq と除外件数を info ログに残す
  - マニフェスト解釈エラー時は状態を変えない(既存ガード維持)
  - 完了条件: 単体テストで「同一 adoption 再送で無変化」「新 adoption 同一内容で revision 不変・値更新・送信なし」「holding は据え置きで解除後に default へ戻る」が緑
  - 5.1 と同じ SurfaceState を編集するため並列不可
  - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.8_

- [x] 5.3 widgets / page の配線と通知表示
  - ウィジェット生成に押下コールバックと下書きコールバックを追加し、button の pointerdown は押下コールバックへ、pointerup 等の解放は従来どおり off 値の単発送信にする。input の値変更はホールド開始直後に下書きを渡す
  - page で押下 → `press_trigger`、下書き → `set_draft` を配線し、20 Hz の同期で通知ログのカーソル以降を `ui.notify`(error → negative、warn → warning、info → info)に流す(D-021)
  - 完了条件: ブラウザスモーク・import スモークが緑。押下で 1 つの `oscBatch`、解放で off 1 件が送られる
  - _Requirements: 3.1, 3.5, 3.9, 4.2_

- [x] 5.4 ブラウザテストでボタン操作と再採用時の表示を検証する
  - FakeLink にセット送信を追加し、`trigger("pointerdown")` で `oscBatch` 1 回・順序が定義順 + トリガ末尾・件数・未編集 toggle の bool default が `i` 0/1 で含まれること、`trigger("pointerup")` で off 1 回、`applies_to` 無しボタンで単発 2 回を確認する
  - 同一内容の新 adoption で input の表示が `default` に戻ること、フォーカス中(ホールド中)の input はその場では戻らず、確定せずに blur すると `default` に戻り送信が発生しないこと、確定して blur すると確定値が送られることを確認する
  - 完了条件: `test_browser_button_events.py` が pytest から緑
  - _Requirements: 3.5, 5.4, 5.5, 8.4, 8.5_

- [x] 6. E2E とサイズ実測
- [x] 6.1 (P) 適用セットの E2E(bundle 配送・再起動後の再同期・拒否通知)
  - プロセスハーネスに stderr のスナップショット取得を追加する(bridge ヘルパも透過)
  - bridge + mock(`staging.json`)で `manifest` フレームの `appliesTo` / `staged` を確認 → `oscBatch`(値 2 件 + トリガ)→ 3 件のエコーが順序どおり届き、mock の適用行の件数と値が送った値と一致することをポーリングで確認する
  - mock を再起動 → `adoption.seq` が進み `default` が戻る → 再起動後の値で `oscBatch` → 適用行の値が再起動後の値になることを確認する
  - 内部アドレスを含む `oscBatch` で `notice(error, batch-rejected)` が返り mock に届かないことを確認する
  - 完了条件: `tests/e2e/apply-set.e2e.test.ts` が `corepack pnpm test` から緑
  - _Requirements: 1.6, 4.5, 4.9, 5.7, 6.2, 8.2, 8.3_
  - _Boundary: E2E / Harness_
  - _Depends: 2.2, 3.4_

- [x] 6.2 (P) 64 スロット相当シナリオの生成とワイヤサイズの回帰ガード
  - 決定的な生成スクリプトで、64 スロット × 4 項目(input s / input i / input f / select optionsRef、すべて staged)+ 各スロットの update トリガ + 全体 update + MB 群(計 324 エントリ)のシナリオを生成しコミットする。`--without-staging` で `staging` 節を省いた対照を出せるようにする
  - scenario の単体テストで、生成シナリオのワイヤ出力が実用上限(60 KiB)未満であることを断言し、総量と対照との差分(増分)をログに出す
  - 完了条件: テストが緑で、総量と増分のバイト数がテスト出力から読み取れる。56 KiB を超える場合は警告が出ても配信が継続する(警告ログを失敗条件にしない)
  - _Requirements: 7.1, 7.2, 7.3, 7.5_
  - _Boundary: mock-unity Scenario 拡張(生成スクリプト・シナリオ・サイズテスト)_
  - _Depends: 1.2, 2.1_

- [x] 7. 契約文書と判断記録
- [x] 7.1 (P) ブリッジプロトコル文書の更新
  - `manifest` 節に `adoption`・`staged`・`appliesTo`(および既存の抜けである widget 一覧の input / select)、上り `oscBatch` 節、`notice` の `batch-rejected`、対応表に `upstream-osc-batch` を追記する
  - `adoption` が必須追加であるため、第三の UI クライアントは UI 側を先に更新する順序を明記する。サイズ定数(512 件 / 60 KiB)を記載する
  - 完了条件: 文書の記述が `protocol/wire-samples.json` の見本と一致し、契約テストが緑
  - _Requirements: 1.9, 4.4, 5.2, 8.8_
  - _Boundary: docs/BRIDGE_PROTOCOL.md_

- [x] 7.2 (P) Unity プロトコル文書の更新
  - §2 のスキーマに `staged?: true` / `appliesTo?: string[]`、§3 に「新たな採用(同一内容を含む)で表示を default へ再同期(ホールド中は除く)」、§4.3.1 に「UI は適用範囲の staged 値を bundle で再送してからトリガを送る。Unity 側の意味論は不変」を記述する
  - 互換性ノート Phase 8 に、非 staged には `staged` を出さない・空 `appliesTo` を出さない・bundle 受信の前提・64 スロット実測値(6.2 の結果)を記す
  - 完了条件: 付録 A.2.4(2.3 で同期済み)を含めて appendix-source-parity ガードと legacy-names ガードが緑
  - _Requirements: 1.9, 7.2, 8.7_
  - _Boundary: docs/UNITY_PROTOCOL.md_
  - _Depends: 6.2_

- [x] 7.3 (P) DESIGN.md への判断記録
  - D-035(配送方式: bundle + トリガエコー待ち、2 秒は「未確認」判定であり「未適用」の証明ではない)、D-036(`staged` / `appliesTo` のワイヤ公開)、D-037(採用識別 `adoption { seq, at }`)、D-038(警告閾値 56 KiB と 64 スロット実測の総量・増分)を追記する
  - 既知の限界(重複採用直後のレース、IP フラグメント)も併記する
  - 完了条件: 6.2 の実測値が D-038 に転記されている
  - _Requirements: 7.2, 7.4, 8.9_
  - _Boundary: DESIGN.md_
  - _Depends: 6.2_

- [x] 7.4 (P) 手動検証手順の更新
  - Update 押下でブリッジ NDJSON に値 N 件 + トリガが `out` で並び、Unity ログ / mock の適用行に同じ値が出る手順
  - Unity の Play 停止 → 再 Play で画面が `default` に戻り、その後の Update で再起動後の値が適用される手順。編集中の input を確定せずに離れると編集前(再起動後)の値に戻る手順
  - 実 Unity で 64 スロット相当の Update を押し、ApplyRequested が 1 回・値 256 件で発火する確認
  - 既存手順の期待値 `MOCK_UNITY_APPLY /member/01/update 2` を JSON 付きの新形式へ更新する
  - 完了条件: 手順どおりに実行して結果を記録できる状態になっている(2.4 のコンパイル記録と同じ文書に並ぶ)
  - _Requirements: 8.10_
  - _Boundary: docs/VERIFICATION.md_
  - _Depends: 6.1_

- [x] 8. 単一入口での全テスト確認
  - `corepack pnpm typecheck` と `corepack pnpm test`(build → vitest unit / e2e / guards → pytest)を実行し、既存のガードテスト(旧名称の残留検出、付録一致、staging フィクスチャ一致)を含めて全て緑であることを確認する
  - `protocol/staging-cases.json` と既存ステージング挙動テストに差分が無いことを確認する
  - process-harness の ready-timeout テストが単独で落ちた場合は再実行してから判定する
  - 完了条件: 全テスト緑。C# の追記は 2.4 の記録で担保
  - _Requirements: 6.3, 8.11_

## 不適用の要件

- 4.6: 「エコーバック確認による配送を採用する場合」の条件付き要件。設計(D-035)で OSC bundle 配送を採用したため不適用。失敗の可視化は 4.2 として 5.1 で実装する
