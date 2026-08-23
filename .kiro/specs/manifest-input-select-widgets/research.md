# Research & Design Decisions — manifest-input-select-widgets

## Summary

- **Feature**: `manifest-input-select-widgets`
- **Discovery Scope**: Extension(既存マニフェスト方式への widget 追加。light discovery + NiceGUI/Quasar の focused research)
- **Key Findings**:
  - ブリッジはマニフェスト検証に共有 zod `ManifestSchema` を直接使っている(`packages/bridge/src/manifest-client.ts`)。スキーマ拡張は shared の再ビルド + `dist/oscdesk-bridge.js` の再生成だけでブリッジに波及し、ブリッジ本体のコード変更は不要(G-4 成立)。逆に dist を再生成しないと新マニフェストはブリッジで拒否され UI に届かない
  - mock-unity は既に非 `/sys/*` アドレスの受信値を同一アドレスへエコーバックしている(`responder.ts` L128-131)。要件 6.3 は既存機構で成立し、シナリオ追加と `ScenarioSchema` への `optionLists` 通し口だけが必要
  - 編集中の上書き保護は既存 `ValueChannel.holding` をそのまま使えるが、`page.py` の `HOLD_TIMEOUT_S = 2.0` 秒強制解除と衝突する。input 専用の長い保険タイムアウト(編集イベントごとに更新)で解決する(下記 Decision 1)
  - 選択肢外の値表示(D-20)は Quasar QSelect の `display-value` prop で実現できる(NiceGUI `ui.select` は QSelect のラッパ)
  - 正規表現方言差(D-19)は Python `re` と JS `RegExp` で受理判定が割れるパターンが実在する(例: `(?i)` インライン旗は Python 可 / JS 不可、`\p{L}`(旗なし)は JS 可 / Python 不可)。判定の正を Python 側と定義し、TS は近似 + 共通サブセット運用とする(下記 Decision 3)

## Research Log

### 既存コードの裏取り(統合ポイント)

- **Context**: validate-gap の分析結果の確認と設計への反映。
- **Sources Consulted**: リポジトリ内コード(下記)。
- **Findings**:
  - `packages/shared/src/schemas.ts` L14-28 — `ManifestEntrySchema` はフラットな `z.object`。widget enum は 5 値。クロスフィールド検証は未使用
  - `packages/nicegui-ui/src/oscdesk_ui/manifest.py` — 手書きパーサ(pydantic 不使用)。`ManifestEntry` は frozen dataclass、`Manifest.groups()` が出現順グループ化を提供
  - `packages/nicegui-ui/src/oscdesk_ui/widgets.py` L298-308 — `is_display_only()` は「widget が text」または「type が `INTERACTIVE_VALUE_TYPES = ("i","f","bool")` 外」で表示専用に落とす。`s` 型を新 widget で使うにはこの判定の変更が必須
  - `packages/nicegui-ui/src/oscdesk_ui/value_store.py` — `ValueChannel.holding` が True の間 `on_echo` を無視。`seed_defaults` は default を初期表示値として値だけ入れる(送信なし)
  - `packages/nicegui-ui/src/oscdesk_ui/page.py` L122-137 — `_release_stale_holds` が `HOLD_TIMEOUT_S`(2.0 秒)経過で強制ホールド解除。`_hold_started_at` の記録は page 層にあり、widget 種別で挙動を分けられる位置にある
  - `packages/nicegui-ui/src/oscdesk_ui/state.py` L148-156 — `entry_for` は線形探索。260 エントリ規模ではマニフェスト採用時に dict 索引を作る余地がある。`set_discrete` は間引きなし即時送信(toggle / button と同じ経路を select / input 確定に流用できる)
  - `packages/mock-unity/src/scenario.ts` L19-24 — `ScenarioSchema` に `optionLists` の通し口がない。`#buildManifest()` はトップレベルに `version` / `projectId` / `entries` のみ出力
  - `packages/mock-unity/src/responder.ts` L116-131 — 非 `/sys/*` 受信は `recordValue`(型一致チェック付き)後に同一アドレスへエコーバック済み
  - `OscSurface/Assets/OscSurfaceBridge/OscSurfaceManifestAsset.cs` — enum + `[Serializable] Entry`。任意フィールドは `hasRange` のような presence フラグ方式
  - `OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs` L186-231 — StringBuilder 手組み JSON。「値がない任意フィールドはキー省略」を実践済み。`TryGetValidatedAsset` がアセット検証の集約点
  - `docs/UNITY_PROTOCOL.md` — §2(L44-105)にスキーマ、§4 に実装指針、付録 A.2(L391-874)に C# 2 ファイルの全文コピー。**C# 変更時は A.2 の同期更新が必須**
  - `protocol/wire-samples.json` + `packages/shared/src/wire.test.ts` + `packages/nicegui-ui/tests/test_wire_samples.py` — 両言語で同一フィクスチャを検証する既存パターン。要件 1.6(TS/Python 同一判定)の担保に流用できる
- **Implications**: 変更は「スキーマ 2 系統 + widgets/page + mock-unity シナリオ + C# + docs」に閉じる。ブリッジ・ワイヤプロトコルは無改造で成立する。

### NiceGUI input の確定時送信(Enter / blur のみ)

- **Context**: S1-1(キーストローク送信の抑止)、要件 2.3 / 2.4。
- **Sources Consulted**: [NiceGUI ui.input ドキュメント](https://nicegui.io/documentation/input)、[NiceGUI Discussion #2984](https://github.com/zauberzeug/nicegui/discussions/2984)、[Issue #4154](https://github.com/zauberzeug/nicegui/issues/4154)(keydown 系イベントは要素生成時に登録する)。
- **Findings**:
  - `ui.input` / `ui.number` の `.value` はキーストロークごとにサーバへ同期されるが、これは値同期であって送信ではない。OSC 送信は `element.on('keydown.enter', ...)` と `element.on('blur', ...)` のハンドラだけから行えば、キーストローク送信は構造的に発生しない
  - `on_value_change` は購読するが送信には使わず、「編集再開の検知」(保護の再開)と `_applying` ガード(プログラム的な値設定で発火した場合の無視)にのみ使う
  - イベントハンドラは要素生成時に登録する(#4154 の制約)
- **Implications**: 確定イベントは `keydown.enter` + `blur` の 2 本。数値入力は `ui.number`、文字列は `ui.input`。整数強制・値域・pattern の判定は確定時に純関数で行う。

### Quasar QSelect の選択肢外値表示(D-20)

- **Context**: 要件 5.3 / 5.4(選択肢にない default / エコーバック値を表示部にそのまま出す)。
- **Sources Consulted**: [Quasar QSelect ドキュメント](https://quasar.dev/vue-components/select/)(`display-value` prop)、[NiceGUI Issue #3951](https://github.com/zauberzeug/nicegui/issues/3951) / [Discussion #3977](https://github.com/zauberzeug/nicegui/discussions/3977)(ui.select は QSelect のラッパで props を透過できる)。
- **Findings**:
  - QSelect の `display-value` prop は選択表示文字列を上書きする(`use-chips` / `selected` スロット未使用時)。NiceGUI からは `select.props(...)` で設定・解除できる
  - 選択肢外の値をそのまま `select.value` に入れる方法は QSelect 側でエラーになりうる([Quasar Discussion #13639](https://github.com/quasarframework/quasar/discussions/13639))ため採らない
- **Implications**: エコーバック値が選択肢内なら `value` を通常設定、選択肢外なら `value = None` + `display-value` で受信値を表示する 2 系統で実装する(選択肢一覧には加えない)。

### 正規表現の方言差(D-19)

- **Context**: 要件 1.12(pattern の受理判定)と 1.6(TS/Python の同一判定)の両立。
- **Sources Consulted**: Python `re` モジュール仕様 / ECMAScript RegExp 仕様(既知知識)、validate-gap 分析。
- **Findings**: 判定が割れる代表例。
  - Python 可 / JS 不可: インライン旗 `(?i)abc`、名前付きグループ `(?P<x>a)`、アトミックグループ `(?>a)`(Python 3.11+)
  - JS 可 / Python 不可: `\p{L}`(`u` 旗なしの JS ではリテラル扱いで受理、Python は bad escape)
  - 両者で一致: 基本機能(文字クラス `[...]`、`^` `$`、量指定子 `* + ? {n,m}`、選択 `|`、素のグループ `(...)`、`\d \w \s`)と、明白な構文エラー(対応しない括弧など)
- **Implications**: 受理判定の正は **Python `re.compile` の成否**(D-19)。TS zod 側は `new RegExp` の try/catch による**近似判定**とし、共通フィクスチャには両者の判定が一致する「共通サブセット」のパターンのみを収録する。docs に「pattern は共通サブセットのみ使う」注記を置く(要件 9.1a)。C# アセット検証は .NET `Regex` の try/catch による早期警告に留め、最終判定は下流(スキーマ検証)に委ねる。

### 260 エントリの実測方法(D-18)

- **Context**: 要件 8(描画実用性)と D-18(既定全開、初回描画の重さは実測)。
- **Sources Consulted**: `packages/mock-unity/scenarios/*.json`(既存シナリオは手書き JSON)、`state.py` の同期ループ。
- **Findings**:
  - 260 エントリの手書き JSON は非現実的。生成スクリプト(Node、リポジトリ内)で決定論的に生成した JSON をコミットする方式が、既存の「シナリオ = JSON ファイル」の枠組みを壊さない
  - UI 側ホットパス: `ui.timer`(20Hz)の `sync()` はバインディング列挙 + revision 比較のみで軽量。`entry_for` の線形探索は flush 時のみだが、採用時に dict 索引を作れば規模非依存になる(小改善)
- **Implications**: `large-input-select.json`(約 260 エントリ、64 スロット × 4 + グローバル構成を模した upstream テスト用データ。フォークの `vp-concert-default` とは別物)を生成スクリプトとともに追加し、`docs/VERIFICATION.md` に初回描画・操作応答の手動計測手順を追記する。`Manifest` 採用時にアドレス索引 dict を構築する。

### Unity の optionLists シリアライズ(Research 6)

- **Context**: Unity の `[Serializable]` は `Dictionary` を直接シリアライズできない。
- **Sources Consulted**: `OscSurfaceManifestAsset.cs` の既存スタイル(presence フラグ + フラットフィールド)。
- **Findings**: `[Serializable] OptionList { string key; List<string> values; }` の `List<OptionList>` として持ち、JSON 出力時にオブジェクト `{"key": [...]}` へ畳むのが既存スタイルと整合する。重複キーは畳む際に情報が失われるため、`TryGetValidatedAsset` で検証エラー(マニフェスト不送信 + `Debug.LogError`)にする(D-14 の厳格方針と一貫)。
- **Implications**: エントリ側は `hasOptions` presence フラグ + `List<string> options`、`optionsRef` は空文字 = 不在の規約(既存 `group` と同じ)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 全て in-place 拡張 | 既存ファイルへ直接追記 | 変更ファイル最少 | widgets.py / manifest.py が肥大。確定時検証ロジックがテストしにくい | 却下 |
| B: 新レイヤ導入(validation パッケージ等) | 検証・解決を独立パッケージ化 | 分離が明確 | この規模には過剰。依存方向の管理コスト増 | 却下 |
| **C: ハイブリッド(採用)** | スキーマ・mock-unity・C#・page は in-place、Python の確定時検証 + optionsRef 解決だけ純関数モジュールへ小分離。両言語共通フィクスチャ新設 | 変更最少とテスト容易性の両立。要件 1.6 を機械的に担保 | 新規ファイル 3 件程度 | validate-gap の推奨。採用 |

## Design Decisions

### Decision 1: input の編集保護 — 既存 hold 機構 + input 専用タイムアウト

- **Context**: 要件 3.1-3.3。`page.py` の `HOLD_TIMEOUT_S = 2.0` 秒強制解除は「フォーカス保持中は上書きしない」と衝突する(編集は 2 秒を超える)。
- **Alternatives Considered**:
  1. hold と別の「focus 状態」を `ValueChannel` に新設 — 機構が二重化し、`on_echo` の判定が複雑化
  2. input を page のタイムアウト管理から完全免除 — blur 取りこぼし(タブ強制終了等)で当該アドレスのエコーバックが永久に無視される
  3. **採用**: `ValueChannel.holding` を流用し、page 層で input だけ長い保険タイムアウト(`INPUT_HOLD_TIMEOUT_S = 120` 秒)を適用。編集イベント(focus / キーストローク = value change)のたびにタイムスタンプを更新する
- **Selected Approach**: 保護開始 = focus または編集検知(value change)。保護終了 = blur / Enter 確定 / 保険タイムアウト(最終編集イベントから 120 秒)。Enter 確定後にさらに打鍵すると value change で保護が再開する。
- **Rationale**: `on_echo` の無視判定は既存の `holding` 1 本のまま。既存 fader と「同等の保護水準」(要件 3.3)を同一機構で満たし、blur 取りこぼしの保険も既存設計思想(`_release_stale_holds` は保険)の延長で持てる。
- **Trade-offs**: フォーカスしたまま 120 秒無操作だと受信値で上書きされうる(要件 3.1 の名目上の「無期限」からの逸脱)が、これは取りこぼし時の保険動作であり、実操作では blur / Enter が先に来る。
- **Follow-up**: タイムアウト値 120 秒は実装時に定数として一箇所に置き、テストでは clock 注入で検証する。

### Decision 2: 受理判定の実装配置 — zod superRefine + Python パーサ拡張 + 共通フィクスチャ

- **Context**: 要件 1.7 / 1.10 / 1.11 / 1.12 はクロスフィールド・クロスエントリ(トップレベル `optionLists` 参照)の検証。要件 1.6 は両言語の同一判定。
- **Selected Approach**: TS はエントリ単位の制約を `ManifestEntrySchema.superRefine`、`optionsRef` 参照解決を `ManifestSchema.superRefine` に置く。Python は `manifest.py` の手書きパーサへ同一規則を追加する。`protocol/manifest-samples.json` に受理/拒否ケースを列挙し、TS(vitest)と Python(pytest)の両方から同一ファイルを検証する(`wire-samples.json` の既存パターン踏襲)。
- **Rationale**: スキーマの正は TS(manifest.py の docstring 記載の既存規律)を維持しつつ、同一判定を人力レビューでなくフィクスチャで機械担保する。
- **Trade-offs**: フィクスチャの網羅が判定同一性の実質的な上限になる。pattern の方言差はフィクスチャを共通サブセットに限定して回避(Research Log 参照)。
- **Follow-up**: `ScenarioSchema` は `ManifestEntrySchema` を直接参照しているため、エントリ単位の superRefine は mock-unity にも自動で効く。`ManifestSchema.parse(#buildManifest())` によりトップレベル検証も自動で効く。

### Decision 3: pattern 検証の正は Python、TS は近似、C# は早期警告

- **Context**: D-19。要件 1.12 の「正規表現として解釈できない pattern は検証エラー」を 3 言語でどう扱うか。
- **Selected Approach**: 契約上の判定基準は Python `re.compile` の成否。TS は `new RegExp` try/catch の近似判定。C# アセット検証は .NET `Regex` try/catch で作成時に早期警告する(最終判定は下流)。`docs/UNITY_PROTOCOL.md` に共通サブセット(基本機能のみ)の注記を置く(要件 9.1a)。
- **Rationale**: 実行時に pattern を評価するのは Python(UI)だけであり、そこで解釈できないことが実害の定義。TS 側の厳密な Python 互換判定は実装コストに見合わない。
- **Trade-offs**: 共通サブセット外のパターンでは TS(ブリッジ)通過 / Python(UI)拒否のような判定分裂が起こりうる。docs 注記 + フィクスチャの共通サブセット限定で運用上回避する。

### Decision 4: select の送信は toggle と同じ discrete 経路

- **Context**: 要件 5.1 / 5.2。
- **Selected Approach**: `on_value_change`(`_applying` ガード付き)から `state.set_discrete` で即時送信し、エコーバックで表示確定する。hold は使わない。input の確定送信も同じ `set_discrete` を使う(間引き対象にしない。確定は離散操作)。
- **Rationale**: 取りこぼすと Unity と食い違う離散操作の既存経路をそのまま流用でき、レート制限・pending の考慮が不要。

### Decision 5: range 検証は type i / f の両方に適用する

- **Context**: 要件 2.7 は `i` + `range` の拒否のみを要求。`f` + `range` の input は未規定。
- **Selected Approach**: 確定時 range 検証は `i` / `f` 共通に適用する(範囲外は拒否 + エラー表示、クランプしない)。
- **Rationale**: `f` だけ範囲外を素通しすると fader(クランプ)との整合も D-16 の事故防止意図とも矛盾する。検証関数は共通化でき、追加コストはない。
- **Trade-offs**: 要件の最小範囲を僅かに超えるが、挙動は一貫方向への拡張のみ。

### Decision 6: 260 エントリシナリオは生成スクリプト + コミット済み JSON

- **Context**: 要件 8、D-18(実測)。
- **Selected Approach**: `packages/mock-unity/scripts/generate-large-scenario.mjs`(決定論的生成)で `scenarios/large-input-select.json` を生成しコミットする。手動計測手順は `docs/VERIFICATION.md` に追記する。
- **Rationale**: シナリオ = JSON ファイルという既存の枠組みを維持しつつ、260 エントリの手書きを避ける。生成条件がスクリプトに残るため再現・調整が容易。

## Risks & Mitigations

- **blur / focus 取りこぼしで input の保護が残留** — Decision 1 の 120 秒保険タイムアウト(編集イベントで更新)で回収する
- **pattern の方言差による判定分裂** — 判定の正を Python に定義、フィクスチャは共通サブセット限定、docs に注記(Decision 3)
- **260 エントリ既定全開の初回描画が重い** — D-18 でユーザー了承済み。実測手順を VERIFICATION.md 化し、問題があれば後続起案(遅延描画はスコープ外)
- **`dist/oscdesk-bridge.js` の再生成漏れ** — 再生成しないとブリッジが新マニフェストを拒否し UI に届かない。タスクに dist 再生成 + コミットを明記する
- **C# 変更と docs A.2 全文コピーの乖離** — A.2 同期をタスクの完了条件に含める
- **`display-value` prop の Quasar 側挙動差(バージョン依存)** — 実装時に NiceGUI 2.x 実環境で選択肢外値表示を手動確認し、VERIFICATION.md に手順を残す

## References

- [NiceGUI ui.input documentation](https://nicegui.io/documentation/input) — 確定イベント(`keydown.enter` / `blur`)の購読方法
- [NiceGUI Issue #4154](https://github.com/zauberzeug/nicegui/issues/4154) — keydown 系イベントは要素生成時に登録する制約
- [NiceGUI Discussion #2984](https://github.com/zauberzeug/nicegui/discussions/2984) — ui.input の信頼できる使い方(Enter / blur ハンドリング)
- [Quasar QSelect](https://quasar.dev/vue-components/select/) — `display-value` prop(選択表示文字列の上書き)
- [Quasar Discussion #13639](https://github.com/quasarframework/quasar/discussions/13639) — 選択肢外の値を value に入れる方式の問題
- [NiceGUI Issue #3951](https://github.com/zauberzeug/nicegui/issues/3951) / [Discussion #3977](https://github.com/zauberzeug/nicegui/discussions/3977) — ui.select と QSelect props の透過
- `docs/LEGACY_PRESET_REQUIREMENTS.md` §4.3 / §5 / §6.1 / §6.2 — 要件の正
- `.kiro/multi-spec/legacy-preset-upstream.md` — 決定済み事項 G-1〜G-6 / S1-1〜S1-6
