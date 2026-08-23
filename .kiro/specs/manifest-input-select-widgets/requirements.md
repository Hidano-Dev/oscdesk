# Requirements Document

## Project Description (Input)
manifest-input-select-widgets: マニフェストの widget enum に編集可能な入力ウィジェット "input"(type s/i/f、確定時送信)と選択式ウィジェット "select"(type s、ドロップダウン、選択肢は options インラインと optionsRef + トップレベル optionLists 共有参照の併存)を追加する。変更対象は packages/shared の zod スキーマと Python 側ミラー、NiceGUI ウィジェット層、mock-unity、Unity 参照実装(OscSurfaceManifestAsset)、docs/UNITY_PROTOCOL.md。要件の正は docs/LEGACY_PRESET_REQUIREMENTS.md §6.1(R1)・§6.2(R2)。詳細な背景・決定済み事項・スコープ・未決事項は .kiro/multi-spec/legacy-preset-upstream.md の「全体コンテクスト」「共通の決定済み事項」「Spec: manifest-input-select-widgets」の各節に記載されており、requirements 生成・dig インタビュー・design の前提として必ず読み込むこと。

## Introduction

本仕様は、OscDesk のマニフェスト方式に 2 種類のウィジェットを追加する。編集可能な入力ウィジェット `widget: "input"`(type `s` / `i` / `f`、確定時送信)と、選択式ウィジェット `widget: "select"`(type `s`、ドロップダウン、選択肢はインライン `options` と共有参照 `optionsRef` + トップレベル `optionLists` の併存)である。現行 UI は文字列(`s`)型を操作系ウィジェットに割り当てても表示専用に落とすため(`INTERACTIVE_VALUE_TYPES = ("i", "f", "bool")`)、レガシー版 VP_OscClient の「Facial Client IP 入力」「LipSync Device 選択」「MB Address / Port 入力」を再現できない。本機能はその欠落を埋める upstream 側の機構提供である。

要件の正は `docs/LEGACY_PRESET_REQUIREMENTS.md` §5・§6.1(R1)・§6.2(R2)・§4.3 であり、分割とセッション固有の決定は `.kiro/multi-spec/legacy-preset-upstream.md` に従う。

## Boundary Context

- **In scope**:
  - `packages/shared` の zod スキーマ(`ManifestEntrySchema` の widget enum 拡張、`options` / `optionsRef` / トップレベル `optionLists`)と Python 側ミラーの同期
  - NiceGUI ウィジェット層(`packages/nicegui-ui/src/oscdesk_ui/widgets.py` ほか)への input / select の描画・送信・エコーバック挙動の実装
  - mock-unity への input / select を含むテスト用シナリオの追加
  - Unity 参照実装(`OscSurface/Assets/OscSurfaceBridge/` の `OscSurfaceManifestAsset`)の widget enum と選択肢のアセット定義・マニフェスト JSON 出力
  - `docs/UNITY_PROTOCOL.md` §2(スキーマ)・§4(実装指針)・付録 A・互換性ノートへの追記
  - 約 260 エントリ規模(64 スロット × 4 + グローバル)での NiceGUI 描画実用性(要件書 §6.4-1)
- **Out of scope**:
  - Unity 側ステージング機構(R3、§6.3)— 別 spec `unity-staging-apply` が担当する
  - ブリッジ本体(`packages/bridge`)の変更(per plan G-4)
  - フォーク側成果物: 64 スロットのデフォルトプリセットアセット、mock-unity の `vp-concert-default` プリセットシナリオ、E2E(per plan G-5)
  - マニフェストのチャンク分割拡張
- **Adjacent expectations**:
  - `docs/UNITY_PROTOCOL.md`・mock-unity・`OscSurface/Assets/OscSurfaceBridge/*.cs` は `unity-staging-apply` も変更するため、順次実行(本 spec が先)でコンフリクトを回避する
  - 本 spec が定義する `optionLists` スキーマは、フォークのプリセット(64 スロットがデバイス一覧を共有参照)が直接利用する
  - 任意要件 R1-8 の `pattern` 検証は本 spec で実装する(see D-13)。これにより `unity-staging-apply` 側に「形式不正の値を無視する」受け皿を作る前提は不要になる

## Decisions(決定済み事項)

バッチプラン `.kiro/multi-spec/legacy-preset-upstream.md` および要件書 `docs/LEGACY_PRESET_REQUIREMENTS.md` で決定済み。本仕様ではこれらを前提として扱う。

| ID | 決定 | 出典 |
|----|------|------|
| D-1 | 要件の正は `docs/LEGACY_PRESET_REQUIREMENTS.md` §5〜§6。二重管理を避け、本書は同書の該当節を参照する | per plan G-1 |
| D-2 | マニフェストは `version: 1` のまま後方互換で拡張する。既存ウィジェットのみのマニフェストは従来どおり受理する | per plan G-3 |
| D-3 | ブリッジ本体(`packages/bridge`)は変更対象外。`WireArgSchema` は `s` 引数対応済み。実装中に境界を越える必要が出たら実装前にユーザーへ報告する | per plan G-4 |
| D-4 | フォーク側成果物(64 スロットプリセット、プリセットシナリオ、E2E)は upstream スコープ外 | per plan G-5 |
| D-5 | 新 widget 値を知らない旧 UI の挙動は「検証エラーでマニフェスト全体を不採用」の現行流儀を維持する | per plan G-6 |
| D-6 | input の送信は確定時(Enter またはフォーカス喪失)のみ。キーストロークごとに送らない | per plan S1-1 |
| D-7 | 編集中(フォーカス保持中)は受信値で入力欄を上書きしない。確定後の受信値で表示確定(既存 fader の hold 機構と同等) | per plan S1-2 |
| D-8 | select は `options`(インライン)と `optionsRef` + `optionLists`(共有参照)の 2 形態を併存させる | per plan S1-3 |
| D-9 | 選択肢にない `default` / エコーバック値を受けてもマニフェスト全体は不採用にしない(受信値表示または未選択表示へ落とす) | per plan S1-4 |
| D-10 | 選択肢の変化はマニフェスト再送で反映する。専用の差分プロトコルは追加しない | per plan S1-5 |
| D-11 | 送信タグは `type` に従う(`s`→`s`、`i`→`i` の整数値、`f`→`f`)。`i` は UI 側で int32 値域チェックを行う | per plan S1-6 |
| D-12 | 既存規律の維持: Unity が真実の源 / 値の確定はエコーバックのみ / OSC 1.0 基本型タグのみ / 任意フィールドは値がないときキーごと省略し `null` を書かない | per plan 全体コンテクスト(要件書 §5) |

## Open Questions and Decisions (Dig)

dig インタビューでユーザーが確定した決定。

| ID | 対象 | 決定 | 理由 | リスク |
|----|------|------|------|--------|
| D-13 | OQ-1(`pattern`) | 任意要件 R1-8 の `pattern`(正規表現による書式検証)を本 spec で実装する。形式に合わない入力は確定(送信)させない | レガシーと同じく入力時点で不正値を止め、`unity-staging-apply` 側の「不正値を無視する」受け皿を不要にする。スキーマ追加も UI 側チェックも小さい変更で済む | 低。正規表現の方言差(TS / Python / C#)は設計で扱う |
| D-14 | OQ-2(選択肢の矛盾) | 1 エントリに `options` と `optionsRef` の両方がある場合、および `optionsRef` の参照先キーが `optionLists` に存在しない場合は、いずれも検証エラーとしてマニフェスト全体を不採用にする | アセット定義の書き間違いに最初に気づける。現行流儀(不正エントリ 1 つで全体不採用、per plan G-6)と一貫し、実装も単純 | 低。1 箇所のミスで画面全体が出なくなるが現行と同じ挙動 |
| D-15 | OQ-5(描画性能) | グループ(スロット)ごとに開閉できる折りたたみパネルにする | 画面に出る部品数が激減し確実に軽くなる。64 スロットの一覧性も上がる。遅延描画まで作り込むとエコーバック反映が複雑になるため見送る | 中。既存の表示レイアウトが変わるため、既存プリセットの見え方にも影響する。既定の開閉状態は D-18 |
| D-16 | OQ-3(range 範囲外) | `type: "i"` + `range` の範囲外入力は拒否する(確定できず送信もしない。入力欄にエラー表示)。クランプ(自動補正)はしない | 打ち間違いが別の値に化けて送られる事故を防ぐ。pattern 検証(D-13)の「不一致は確定させない」と同じ挙動で一貫する | 低。オペレーターが値を直す手間が 1 回増えるのみ |
| D-17 | OQ-4(空の選択肢) | 選択肢が空の select はドロップダウンを無効化(グレーアウト)し「選択肢なし」の注記を表示する。レガシーの `"Not Found!"` ダミー項目は入れない | 選べないことが一目で分かり、ダミー値を誤送信する余地がない | 低。レガシーとは見た目が変わる |
| D-18 | 折りたたみの既定状態 | グループ数によらず既定で全グループを開いた状態にする(閉じるのは手動) | 今までの見た目に最も近く、挙動が単純。初回描画の重さは 260 エントリのテストシナリオで実測し、問題があれば後続で対策を起案する | 中。260 エントリでは初回表示が重いままの可能性がある(ユーザー了承済み) |
| D-19 | pattern の適用範囲と不正 pattern | `pattern` は `type: "s"` のみ許可(`i` / `f` に付いていたら検証エラーでマニフェスト全体不採用)。正規表現として解釈できない `pattern` も検証エラー | アセット定義のミスに最初に気づける。D-14 の厳格方針と一貫。TS / Python の正規表現の方言差があるため、両者で共通に使える基本機能のみを使うよう docs に注記する | 低〜中。方言差の注記が docs 頼みになる(検証は Python `re` でのコンパイル可否が基準) |
| D-20 | 選択肢外の値の表示 | 選択肢にない `default` / エコーバック値は、ドロップダウンの表示部に受信値をそのまま表示する(選択肢一覧には加えない)。未選択表示には落とさない | Unity の現在値(真実の源)が常に UI から見え、デバイス一覧の変化で値が取り残されたことに気づける | 低。一覧にない値を表示する状態の作り込みが少し増える |
| D-21 | 編集中保護の失効管理(validate-design 指摘 1) | ホールドの失効管理をページ単位から共有層(`ValueChannel` / `SurfaceState.tick()`)へ移設し、`app.on_disconnect` でも解放する。既存 fader / xy の 2 秒ホールドも同じ共通経路へ移行する | ページ単位のタイマーでは、入力欄にフォーカスしたままタブを閉じると期限を知る主体が消え保護が恒久残留する(表示が二度と更新されず UI 再起動でしか復旧しない)。既存ウィジェットにも同じ穴があり、まとめて塞ぐ | 中。既存ホールド機構に触るため既存テストの調整が発生する |
| D-22 | 確定拒否時の表示復元(validate-design 指摘 2) | blur で確定を拒否した場合、入力欄を Unity の現在値へ復元しエラー表示を消したうえで、`ui.notify` で「形式不正のため送信しませんでした」を一時表示する | 拒否時は送信していないためエコーバックは来ず、同値エコーも revision 差分で弾かれる。復元しないと Unity に存在しない値が入力欄に残り続け、送信済みと誤認される(「UI は表示キャッシュ」の規律違反) | 低 |
| D-23 | ウィジェット層の自動テスト(validate-design 指摘 3) | `nicegui.testing` の `User` フィクスチャでブラウザ相当の自動テストを導入し、input / select のイベント結線(キーストローク非送信・編集中保護・`display-value`)を CI で担保する | 本番に最も近い形で検証できる。純関数コントローラ抽出案より実物に近い。「テスト全部緑で UI 起動不能」の既往がある領域のため手動検証のみに委ねない | 中。テスト依存と実行時間が増え、非同期 UI 由来のフレークを抱えやすい。フレーク時は待機条件の明示化で対処し、テスト削除では回避しない |

## Requirements

### Requirement 1: マニフェストスキーマ拡張(共有スキーマと Python ミラー)
**Objective:** マニフェスト作成者(Unity 側アセット定義者)として、`input` / `select` ウィジェットと選択肢の宣言をマニフェストで表現したい。それにより、C# やスキーマを案件ごとに書き換えることなく編集・選択 UI をデータで構成できる。

#### Acceptance Criteria
1. The 共有スキーマ(`packages/shared` の zod `ManifestEntrySchema`)shall `widget` enum の値として既存値に加えて `"input"` と `"select"` を受理する。
2. Where `widget` が `"input"`, the 共有スキーマ shall `type` が `s` / `i` / `f` のいずれかであるエントリを受理する。
3. Where `widget` が `"select"`, the 共有スキーマ shall `type` が `s` であるエントリを受理する。
4. The 共有スキーマ shall エントリの任意フィールド `options: string[]`(選択肢のインライン格納)と `optionsRef: string`(共有参照キー)、およびマニフェストトップレベルの任意フィールド `optionLists: { [key]: string[] }` を受理する。
5. When 既存ウィジェット(`fader` / `button` / `toggle` / `xy` / `text`)のみで構成された `version: 1` マニフェストを検証する, the 共有スキーマ shall 従来どおり受理する(per plan G-3)。
6. The Python 側ミラースキーマ(`packages/nicegui-ui`)shall zod スキーマと同一のマニフェストに対して同一の受理・拒否判定を行う。
7. If `widget` が `"select"` のエントリに `options` と `optionsRef` のいずれも存在しない, the 共有スキーマ shall 当該マニフェストを検証エラーとして不採用にする。
8. The 共有スキーマ shall マニフェストの `version` フィールドを `1` のまま維持する(バージョン値の追加・変更を行わない)。
9. The 共有スキーマ shall エントリの任意フィールド `pattern: string`(正規表現による入力書式検証の宣言)を受理する(see D-13)。
10. If `widget` が `"select"` のエントリに `options` と `optionsRef` の両方が存在する, the 共有スキーマ shall 当該マニフェストを検証エラーとして不採用にする(see D-14)。
11. If `optionsRef` の参照先キーがトップレベル `optionLists` に存在しない, the マニフェスト検証 shall 当該マニフェストを検証エラーとして不採用にする(see D-14)。
12. If `pattern` が `type` が `s` 以外のエントリに指定されている, または `pattern` が正規表現として解釈できない, the マニフェスト検証 shall 当該マニフェストを検証エラーとして不採用にする(see D-19)。

### Requirement 2: input ウィジェットの描画と送信
**Objective:** オペレーター(ブラウザ UI の利用者)として、文字列・整数・小数の値を入力欄で編集し確定時に Unity へ送信したい。それにより、レガシーの「Facial Client IP」「MB Address / Port」相当の入力操作を OscDesk 上で行える。

#### Acceptance Criteria
1. Where エントリの `widget` が `"input"` かつ `type` が `s`, the NiceGUI UI shall 当該エントリを編集可能な文字列入力欄として描画する。
2. Where エントリの `widget` が `"input"` かつ `type` が `i` または `f`, the NiceGUI UI shall 当該エントリを編集可能な数値入力欄として描画する。
3. When オペレーターが入力欄で Enter キー押下またはフォーカス喪失により値を確定する, the NiceGUI UI shall 確定した値を当該エントリのアドレスへ 1 回送信する(per plan S1-1)。
4. While オペレーターが入力欄を編集中で値を確定していない, the NiceGUI UI shall 値の送信を行わない(キーストロークごとに送信しない)(per plan S1-1)。
5. The NiceGUI UI shall input の送信引数の型タグをエントリの `type` に従って付与する(`s` → `s` タグ、`i` → `i` タグの整数値、`f` → `f` タグ)(per plan S1-6)。
6. If `type` が `i` のエントリで int32 値域(-2147483648〜2147483647)を外れる値が確定されようとする, the NiceGUI UI shall 当該値を送信しない(per plan S1-6)。
7. If `type` が `i` かつ `range` が指定されたエントリで範囲外の値が入力される, the NiceGUI UI shall 当該値の確定を拒否し送信せず、入力欄にエラーを表示する(クランプによる自動補正は行わない)(see D-16)。
8. When input エントリを含むマニフェストを採用する, the NiceGUI UI shall `default` の値を入力欄の初期表示に反映し、その反映に伴う送信を発生させない。
9. Where エントリに `pattern` が指定されている, the NiceGUI UI shall 正規表現に一致しない入力を確定(送信)させない(see D-13)。

### Requirement 3: input ウィジェットのエコーバック規律(編集中の上書き保護)
**Objective:** オペレーターとして、入力途中の値を Unity からの受信値に上書きされたくない。それにより、編集操作とエコーバック確定の規律(Unity が真実の源)を両立できる。

#### Acceptance Criteria
1. While オペレーターが入力欄のフォーカスを保持して編集中, the NiceGUI UI shall 当該アドレスの受信値で入力欄の表示を上書きしない(per plan S1-2)。
2. When 入力欄の確定またはフォーカス喪失の後に当該アドレスの値を受信する, the NiceGUI UI shall 受信値で入力欄の表示を確定する(per plan S1-2)。
3. The NiceGUI UI shall input の上書き保護を既存 fader の hold 機構と同等の保護水準で提供する(送信直後の未エコーバック期間に表示が古い値へ戻らないこと)。

### Requirement 4: select ウィジェットの描画と選択肢解決
**Objective:** マニフェスト作成者として、選択肢をインラインまたは共有参照で宣言し、UI にドロップダウンとして表示させたい。それにより、少数エントリの簡便さと 64 スロット共有時のマニフェストサイズ削減(50〜55KB → 30〜32KB、要件書 §4.3)を両立できる。

#### Acceptance Criteria
1. Where エントリの `widget` が `"select"`, the NiceGUI UI shall 当該エントリをドロップダウン(選択式)として描画する。
2. Where select エントリに `options` がインライン指定されている, the NiceGUI UI shall `options` の文字列配列を選択肢として表示する(per plan S1-3)。
3. Where select エントリに `optionsRef` が指定されている, the NiceGUI UI shall マニフェストトップレベル `optionLists` の当該キーの文字列配列を選択肢として解決し表示する(per plan S1-3)。
4. If select エントリの解決後の選択肢配列が空である, the NiceGUI UI shall マニフェスト全体を不採用にせず、ドロップダウンを無効化(操作不可)して「選択肢なし」の注記を表示する(ダミー項目は挿入しない)(see D-17)。
5. When 選択肢の内容が変化した新しいマニフェストを受信し採用する, the NiceGUI UI shall 新しい選択肢でドロップダウンの表示を更新する(専用の差分プロトコルは追加しない)(per plan S1-5)。

### Requirement 5: select ウィジェットの送信とエコーバック
**Objective:** オペレーターとして、ドロップダウンで選択した値を即時に Unity へ送信し、エコーバックで表示を確定したい。それにより、toggle と同じ discrete 系の操作感でレガシーの LipSync Device 選択を再現できる。

#### Acceptance Criteria
1. When オペレーターがドロップダウンで選択肢を選択する, the NiceGUI UI shall 選択された選択肢の文字列を `s` タグで当該エントリのアドレスへ即時送信する。
2. When select エントリのアドレスでエコーバック値を受信する, the NiceGUI UI shall 受信値で選択表示を確定する(toggle と同じ discrete 系の扱い)。
3. If select エントリの `default` が選択肢に存在しない, the NiceGUI UI shall マニフェスト全体を不採用にせず、ドロップダウンの表示部に当該値をそのまま表示する(選択肢一覧には加えない)(per plan S1-4, see D-20)。
4. If 選択肢に存在しないエコーバック値を受信する, the NiceGUI UI shall マニフェスト全体を不採用にせず、選択を勝手に変更することなく受信値をそのまま表示する(選択肢一覧には加えない)(per plan S1-4, see D-20)。
5. When select エントリを含むマニフェストを採用する, the NiceGUI UI shall `default` の値を選択表示の初期値に反映し、その反映に伴う送信を発生させない。

### Requirement 6: mock-unity のテストシナリオ
**Objective:** 開発者として、input / select を含むマニフェストとエコーバック応答を mock-unity で模擬したい。それにより、Unity 実機なしでブリッジ〜UI の挙動を自動テスト・手動検証できる。

#### Acceptance Criteria
1. The mock-unity shall `input`(type `s` / `i` / `f`)と `select` のエントリを含むマニフェストを供給するシナリオを提供する。
2. The mock-unity のシナリオ shall select の選択肢宣言として `options`(インライン)と `optionsRef` + `optionLists`(共有参照)の両形態を含む。
3. When mock-unity が input / select のアドレスへの値送信を受信する, the mock-unity shall 同一アドレスへ受信値をエコーバックする。
4. The mock-unity のシナリオ shall upstream のテスト用に限定し、フォークのプリセットシナリオ(`vp-concert-default`)を含まない(per plan G-5)。

### Requirement 7: Unity 参照実装のアセット定義とマニフェスト出力
**Objective:** Unity 側の案件担当者として、`OscSurfaceManifestAsset` のアセット定義だけで input / select と選択肢を宣言したい。それにより、「案件差分はコードでなくデータ」の規律を維持したままマニフェストを構成できる。

#### Acceptance Criteria
1. The Unity 参照実装(`OscSurfaceManifestAsset`)shall アセット定義で `widget` として `input` と `select` を宣言できる。
2. The Unity 参照実装 shall アセット定義で `options`(インライン)・`optionsRef`・トップレベル `optionLists` を宣言し、マニフェスト JSON に出力できる。
3. When マニフェスト JSON を生成する, the Unity 参照実装 shall 値のない任意フィールド(`options` / `optionsRef` / `optionLists` など)をキーごと省略し、`null` を出力しない(要件書 §5 の規律)。
4. The Unity 参照実装 shall 生成したマニフェストを `version: 1` のまま出力する(per plan G-3)。

### Requirement 8: 描画実用性(非機能)
**Objective:** オペレーターとして、約 260 エントリ(64 スロット × 4 + グローバル)のマニフェストでも UI を実用的に操作したい。それにより、コンサート運用のデフォルトプリセット規模に耐えられる。

#### Acceptance Criteria
1. When 約 260 エントリ(input / select を含む)のマニフェストを採用する, the NiceGUI UI shall 全エントリを描画し、各ウィジェットの操作を受け付ける。
2. While 約 260 エントリのマニフェストを表示中, the NiceGUI UI shall 個々のウィジェット操作(入力確定・選択)とエコーバック反映を実用的な応答性で処理する。
3. The NiceGUI UI shall グループごとに開閉できる折りたたみパネルとしてエントリを描画する(see D-15。既定の開閉状態は D-18 参照)。

### Requirement 9: プロトコル文書の更新
**Objective:** プロトコル利用者(Unity 側実装者・フォーク側開発者)として、input / select / optionLists の仕様を `docs/UNITY_PROTOCOL.md` で参照したい。それにより、特定ライブラリに依存せず互換実装を書ける。

#### Acceptance Criteria
1. The プロトコル文書(`docs/UNITY_PROTOCOL.md`)shall §2(スキーマ)に `input` / `select` / `options` / `optionsRef` / `optionLists` / `pattern` の定義を含む。
1a. The プロトコル文書 shall `pattern` の正規表現は TS / Python で共通に使える基本機能のみを使う旨の注記を含む(see D-19)。
2. The プロトコル文書 shall §4(実装指針)に input の確定時送信・エコーバック規律と select の即時送信・選択肢解決の指針を含む。
3. The プロトコル文書 shall 付録 A(参照実装)に input / select 対応の記述を含む。
4. The プロトコル文書 shall 互換性ノートに本拡張が `version: 1` 後方互換であることと、新 widget 値を知らない旧 UI が検証エラーでマニフェスト全体を不採用にする現行流儀(per plan G-6)の記録を含む。

## Dig Summary

- ラウンド数: 3 / 質問数: 8 / 決定数: 8(D-13〜D-20)
- 主要な発見:
  1. `pattern`(書式検証)は本 spec で実装すると決定(D-13)。これにより後続 spec `unity-staging-apply` の「不正値をステージングで無視する」受け皿要件が不要になり、spec 間のスコープ境界が動いた
  2. 検証方針は一貫して「厳格」(選択肢の矛盾・参照先欠落・不正 pattern はいずれもマニフェスト全体不採用。D-14 / D-19)。現行流儀(G-6)との一貫性を優先
  3. 描画性能はグループ折りたたみを実装するが既定は全開(D-15 / D-18)。260 エントリの初回描画の重さはテストシナリオで実測し、問題があれば後続起案とする(ユーザー了承済みのリスク)
- 決定一覧: 「Open Questions and Decisions (Dig)」の表を参照(D-13〜D-20)
- 残リスク(設計フェーズへ引き継ぎ):
  - 正規表現の方言差(TS zod 検証 / Python `re` 実行 / C# アセット作成者)。docs の注記と「共通基本機能のみ」の運用頼みになる(D-19)
  - 260 エントリ・既定全開での初回描画性能は未実測(D-18)。mock-unity の約 260 エントリシナリオで実測する
  - 選択肢外の値をドロップダウン表示部に出す UI 表現(D-20)は NiceGUI `ui.select` の標準挙動から外れるため、設計で実現方法を確認する
