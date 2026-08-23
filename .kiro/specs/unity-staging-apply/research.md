# Research & Design Decisions — unity-staging-apply

## Summary

- **Feature**: `unity-staging-apply`
- **Discovery Scope**: Extension(既存 Unity 参照実装への機構追加)+ 一部 Complex Integration(Unity アセンブリ構成の新設と二実装の同期)
- **Key Findings**:
  1. **button ウィジェットは押下 `1` と解放 `0` の 2 メッセージを送る**(`widgets.py` `_button_values` / `pointerdown` + `release`)。適用トリガを「受信したら発火」にすると 1 回の押下で適用イベントが 2 回発火する。**非ゼロ値の受信でのみ発火**する規律が必須(D-27)
  2. Unity 仕様上、asmdef を持つテストアセンブリは predefined assembly(`Assembly-CSharp`)を参照できない。`OscSurface/Assets` に asmdef は 1 つも存在せず、`OscSurfaceBridge` は `Assembly-CSharp` に属するため、ステージング中核を `UnityEngine` 非依存の asmdef へ切り出す以外に EditMode テストの成立経路がない
  3. `JsonUtility` は `Dictionary` とトップレベル配列を扱えず、異種型の混在も表現できない。共通フィクスチャは「型タグ付き値エンベロープ + 名前付き配列」の形状に制約される
  4. mock-unity の `ManifestEntrySchema` は `.strict()` ではないため、シナリオのエントリに未知キーを書いても**黙って捨てられる**。ステージング宣言をエントリ内に置くと無言で無効化される
  5. mock-unity の `buildManifestEntry` は `entry.default !== undefined` のときしか `default` を出力しない。C#(`currentValues` にあれば必ず出力)と挙動が食い違い、共通フィクスチャを入れた時点で乖離が顕在化する
  6. `bool` エントリの現在値記録は C#(`value is bool`)・mock(`typeof value === 'boolean'`)の双方で死んでいる。ワイヤ上は `i` の 0/1 で届くため型判定が常に偽になる。かつアセット既定値 `defaultBool` は `true` / `false` で JSON 出力されるため、同一エントリの `default` が `true` → `1` と型を変える潜在バグがある

## Research Log

### OSC 1.0 のアドレスパターン一致規則(G-1)

- **Context**: 適用範囲・展開先を表すワイルドカードで `*` が `/` を跨ぐかを確定する必要がある(要件の残リスク)。「OSC 1.0 標準の枠内で説明できる」ことがリポジトリの絶対規律
- **Sources Consulted**: OpenSoundControl 1.0 仕様(パターンマッチ節)、CNMAT / OSW / wosclib の仕様写しと実装例
- **Findings**:
  - OSC アドレスパターンは `/` で区切られた **part** 単位で照合し、パターンの part 数とアドレスの part 数が一致する必要がある
  - `*` は **1 つの part 内**の「0 文字以上の任意の並び」に一致する。`/` は跨がない(`/a/*/c` は `/a/b/c` に一致し `/a/b/x/c` には一致しない)
  - 他に `?`(任意 1 文字)、`[...]`(文字クラス)、`{a,b}`(選択)、`//`(1.1 拡張)がある
- **Implications**: `*` のみを採用し、`?` / `[]` / `{}` / `//` は宣言記法から**除外**する(2 実装で照合器を一致させるコストと、アセット作成者が覚える規則を最小化するため)。「OSC 1.0 のアドレスパターンの真部分集合」として文書化する。`/vp/member/01/*` は 4 part で `/vp/member/01/ip` に一致し、より深い `/vp/member/01/a/b` には一致しない

### Unity のアセンブリ構成と EditMode テストの成立条件

- **Context**: D-12(EditMode テストの新設)を実現できるか、できるならどの構成か
- **Sources Consulted**: Unity Manual「Script compilation and assembly definition files」「Edit mode and Play mode tests」、Test Framework 1.4 の「Workflow: How to create a new test assembly」、Unity Discussions の Assembly-CSharp 参照不可事例
- **Findings**:
  - テスト用にフラグされた asmdef アセンブリは predefined assembly から自動参照されず、逆にテストアセンブリから `Assembly-CSharp` を参照する手段もない。テスト対象は独立した asmdef へ切り出す必要がある
  - EditMode テストアセンブリの asmdef は `includePlatforms: ["Editor"]`、Assembly Definition References に `UnityEngine.TestRunner` / `UnityEditor.TestRunner`、Assembly References(`precompiledReferences`)に `nunit.framework.dll`、`defineConstraints: ["UNITY_INCLUDE_TESTS"]` を持つのが標準形
  - predefined assembly(`Assembly-CSharp`)は非テストの asmdef アセンブリを自動参照する(`autoReferenced: true` の既定)ため、`OscSurfaceBridge.cs` 側は `using` を足すだけで新アセンブリを使える
  - 対象プロジェクトは Unity 6000.0.36f1 / `com.unity.test-framework` 1.4.6 導入済み
- **Implications**: ステージング中核を `OscSurface/Assets/OscSurfaceBridge/Staging/` の独立 asmdef(`noEngineReferences: true`)へ切り出す。`noEngineReferences` により `Debug.Log*` が使えないため、**検証エラーはデータ(文字列リスト)で返し、ログ出力は `OscSurfaceBridge` 側の責務**とする。この構成変更に伴い `docs/UNITY_PROTOCOL.md` 付録 A.2(「C# 2 ファイル全文」)の構成更新が必要

### `JsonUtility` で読める共通フィクスチャの形状(G-5)

- **Context**: D-14(JSON 共通フィクスチャを C# と TypeScript の双方から読む)の実現方式。C# 側に追加依存を持ち込みたくない
- **Sources Consulted**: Unity Manual「JSON Serialization」、JsonUtility のトップレベル配列・Dictionary 非対応に関する解説記事
- **Findings**:
  - `JsonUtility` は `Dictionary<K,V>` を扱えない(key/value ペアの配列で代替する)
  - トップレベルが配列の JSON を `FromJson` に渡すと **null が返るだけでエラーも出ない**。最外は必ずオブジェクトにする
  - 異種型(数値・文字列が同じキーに入る)は表現できない。フィールドは静的型で固定される
  - 未知キーは無視され、欠落キーは型の既定値になる(= 省略可能キーは表現できるが、欠落と既定値が区別できない)
  - `Newtonsoft.Json` は現状 `uloopmcp` 経由の推移依存にすぎず、直接使うなら `Packages/manifest.json` への明示追加が必要
- **Implications**: フィクスチャは「トップレベルオブジェクト + 名前付き配列 + 型タグ付き値エンベロープ(`{kind, i, f, s}`)」で設計し、任意キーは常に明示的に書く(欠落を使わない)。追加依存なしで `JsonUtility` を採用する

### mock-unity 側の受け口の実測

- **Context**: シナリオにステージング宣言をどう載せるか、既存挙動と C# の差分がどこにあるか
- **Sources Consulted**: `packages/mock-unity/src/scenario.ts` / `responder.ts`、`packages/shared/src/schemas.ts`
- **Findings**:
  - `ScenarioSchema.entries` は `ManifestEntrySchema` をそのまま使う。zod のオブジェクトは既定で未知キーを **strip** するため、エントリに `staged` を足しても消える
  - `recordValue` は `void` を返し、呼び出し側(`responder.visitPacket`)は結果を観測できない。展開エコーを出すには戻り値化が必要
  - `buildManifestEntry` は `entry.default !== undefined` のときだけ `default` を出力する。C# は `currentValues` にあれば必ず出力する
  - `matchesEntryType('bool')` は `typeof value === 'boolean'` を要求し、`toScenarioValue` は `i` タグを number にするため、実運用の 0/1 は記録されない
- **Implications**: ステージング宣言は**シナリオのトップレベル `staging` セクション**に置く(要件 6.2 の「マニフェスト JSON へ出力しない」とも自然に整合)。`recordValue` は反応(記録・展開・適用)を返す形へ変え、`buildManifestEntry` の出力条件と `bool` 判定を C# に合わせて修正する

### UI 側の button 送信仕様(新規発見)

- **Context**: 適用トリガの発火条件を決めるため、`widget: "button"` が実際に何を送るかを確認した
- **Sources Consulted**: `packages/nicegui-ui/src/oscdesk_ui/widgets.py`(`_build_button` / `_button_values`)
- **Findings**: `pointerdown` で on 値(`i` の `1`、type `f` なら `1.0`)、`pointerup` / `pointercancel` 等の release で off 値(`0`)を送る。1 回の押下で 2 メッセージが届く
- **Implications**: 「トリガアドレスの受信で発火」は 1 押下 2 適用になる。**非ゼロ値の受信でのみ適用イベントを発火**する規律を設計へ入れる(D-27)。エコーバックは 0 / 1 の双方に対して従来どおり行う(要件 3.3)

### 先行 spec との衝突面

- **Context**: `manifest-input-select-widgets` が同一ファイル群を変更する。実装順の前提を確定する
- **Sources Consulted**: `.kiro/specs/manifest-input-select-widgets/design.md` / `tasks.md`(全タスク未着手)
- **Findings**: 先行 spec は `OscSurfaceManifestAsset.WidgetType` へ `Input` / `Select` を追加し、`TryGetValidatedAsset` / `TryBuildManifestJson` を拡張し、付録 A.2 の全文を同期する。`protocol/manifest-samples.json` と `tests/guards` 的なフィクスチャ駆動テストの前例も作る
- **Implications**: 本 spec は先行 spec 完了後のコードベースを前提にする。フィクスチャの置き場所・形式(`protocol/*.json` + 両言語テスト)は先行 spec の流儀を踏襲し、一致ガードだけ `tests/guards/` に足す

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A: 全面 in-place | `OscSurfaceBridge.cs` にステージング処理を直接書く | 変更ファイル最少、付録 A.2 の構成が変わらない | EditMode テストが成立しない(D-12 を満たせない)、`MonoBehaviour` 肥大 | 却下 |
| B: 全面切り出し | 現在値ストア・マニフェスト生成まで含めて純 C# 化 | テスト範囲が最大 | 既存の JSON 生成コードまで動かすため退行リスクが大きく、付録 A.2 の差分が巨大化 | 却下 |
| **C: ハイブリッド(採用)** | ステージング中核(照合・コンパイル・現在値ストア・反応計算)を asmdef 付き純 C# へ切り出し、`OscSurfaceBridge` は結線・I/O・ログに徹する | EditMode テストが成立し、mock-unity と同一の純関数境界を作れる。JSON 生成は既存のまま | asmdef 新設・.meta 追加・付録 A.2 の構成更新が必要 | validate-gap 推奨。二実装の同期は共通フィクスチャで機械担保 |

mock-unity 側の粒度も同じ理由で「汎用機構(`staging.ts`)+ 既存ファイルの in-place 拡張」を採る(D-12)。

## Design Decisions

### Decision: ワイルドカードは OSC 1.0 の真部分集合(`*` のみ・part 単位)

- **Context**: G-1。適用範囲と展開先の唯一の記法(D-15)の厳密な意味を確定する
- **Alternatives Considered**:
  1. `*` が `/` を跨ぐ(glob 的)— `/vp/member/*` だけで全スロット全項目を書ける
  2. OSC 1.0 準拠の part 単位(`*` は `/` を跨がない)
  3. OSC 1.0 のパターン機能を全部(`?` `[]` `{}`)サポート
- **Selected Approach**: 2 を採用し、サポートする特殊文字は `*` のみに限定する。パターンとアドレスは `/` で分割し、part 数が一致し、各 part が一致するときだけ一致とする
- **Rationale**: 「OSC 1.0 標準の機能のみでプロトコルを成立させる」規律に合う。跨がない規則は「階層のどの段を任意にするか」が読んだとおりになり、`/vp/member/*/active`(全スロットの active)と `/vp/member/01/*`(スロット 01 の全項目)を誤解なく書き分けられる。実装も 2 言語で同一に保ちやすい
- **Trade-offs**: `/vp/member/*` で全スロット全項目を表すことはできず `/vp/member/*/*` と書く必要がある。深さの違う階層を 1 パターンで束ねられない(複数パターンの列挙で対応)
- **Follow-up**: 照合器の単体テストを両実装に置き、`*` が `/` を跨がないこと・part 数不一致が非一致になることを固定する

### Decision: ステージング領域は現在値ストアそのもの(別立てにしない)

- **Context**: G-2 / 要件 2.4 / 5.1
- **Alternatives Considered**: 1. `stagedValues` を別に持ち `currentValues` は適用済み値を保つ 2. 単一ストア
- **Selected Approach**: 単一ストア。ステージング対象かどうかに関わらず受信値は同じストアへ入り、マニフェスト `default` はそこから引く
- **Rationale**: 要件は「適用済み値」を Unity 側で保持することを求めていない(適用先はアプリ固有実装)。単一ストアにすると 5.1(`default` はステージング値)と 2.4 が自動的に成立し、「ステージング対象でないアドレスと区別できる差分を作らない」(2.5)も構造的に保証される
- **Trade-offs**: 「未適用の変更があるか」を Unity 側で知る手段がなくなる。要件外(レガシーも持たない)なので許容
- **Follow-up**: 適用イベントで値を破棄しない(3.4)ことをフィクスチャで固定する

### Decision: 宣言はコンパイル時にエントリ集合へ解決し、受信時は照合しない

- **Context**: G-7。260 エントリ × 展開 64 の規模で受信ごとに線形照合すると負荷が読めない
- **Alternatives Considered**: 1. 受信ごとにパターン照合 2. 起動時にアドレス空間へ解決して索引化
- **Selected Approach**: 2。アセット(またはシナリオ)のエントリ集合は閉じているため、検証成功時に「アドレス → {staged か / 属する適用範囲 / 展開先リスト / トリガか}」の索引を 1 度だけ構築する。受信時は辞書 1 回参照 + 展開先リストの反復のみ
- **Rationale**: 受信経路が規模非依存になる。既存の `RecordValue` の線形探索(エントリ数に比例)も同時に解消される。ワイルドカードの意味が「宣言時点のエントリ集合に対する解決結果」に固定されるため、2 実装の挙動差も出にくい
- **Trade-offs**: マニフェストに存在しないアドレスはパターンに合致しても対象にならない。これは仕様として明示する(むしろ望ましい: 未宣言アドレスへの暗黙書き込みを防ぐ)
- **Follow-up**: アセット再読込み(Play 再開)時に再コンパイルされる経路を確認する

### Decision: 適用イベントはエコー送出後に、購読者単位で例外隔離して発火する

- **Context**: G-4 / 要件 2.5(区別できる差分を作らない)。購読者の例外が `OnDataReceived` を貫くとエコーが止まる
- **Selected Approach**: 受信処理の順序を「記録 → 展開書き込みと記録 → 受信アドレスへエコー → 展開先へ個別エコー → 適用イベント発火」に固定し、発火は購読デリゲートを 1 件ずつ呼んで各々を `try/catch` で包む。例外は `Debug.LogException` して次の購読者へ進む
- **Rationale**: エコー(プロトコル上の義務)がアプリ固有実装の失敗に巻き込まれない。1 購読者の失敗が他の購読者を巻き込まない
- **Trade-offs**: 例外が握り潰されて見えにくくなる → ログで担保する
- **Follow-up**: 「購読者が例外を投げてもエコーは出る」ことを EditMode テストで固定する(フィクスチャでは表現できないため専用テスト)

### Decision: `bool` の現在値は `i` の 0/1 に正規化して保持・出力する

- **Context**: 要件 10.3。受信は `i` 0/1、アセット既定値 `defaultBool` は `true`/`false` で出力されており、同一エントリの `default` の型が揺れる
- **Alternatives Considered**:
  1. `default` を `true` / `false`(JSON boolean)に統一し、受信 0/1 を bool へ変換して保持
  2. `default` を `0` / `1`(JSON number)に統一し、アセット既定値も 0/1 で出力
- **Selected Approach**: 2
- **Rationale**: `docs/UNITY_PROTOCOL.md` は既に「`type: "bool"` の値同期は `i` タグの 0/1 で表現する」(§2)「真偽値は `i` の 0/1 で送る」(§4.4)と規定している。ワイヤ表現と `default` 表現を揃えるほうが規律に忠実で、UI 側も `_as_bool` が数値を受け取れる。0/1 以外の整数は `bool` エントリの現在値として記録しない(エコーは従来どおり素通し)
- **Trade-offs**: 既存アセットで `defaultBool = true` を使っている場合、マニフェストの `default` が `true` から `1` へ変わる。マニフェストスキーマは `boolean | number | string` を許すため受理は変わらず、UI 表示も等価。**挙動変更として互換性ノートへ記録する**(10.4)
- **Follow-up**: mock-unity 側も同一規則にし、フィクスチャで固定する

### Decision: 適用トリガは非ゼロ値の受信でのみ発火する

- **Context**: 上記「UI 側の button 送信仕様」の発見。button は押下 `1` と解放 `0` を送る
- **Selected Approach**: トリガアドレスに届いた記録可能値が「非ゼロの整数 / 非ゼロの小数 / 空でない文字列」のときだけ適用イベントを発火する。記録可能値のないメッセージでは発火しない。エコーは値に関わらず従来どおり行う
- **Rationale**: 1 押下で 1 回だけ適用する。レガシーの「Update ボタンを押したときだけ反映」と一致する
- **Trade-offs**: 「値 0 を送って適用したい」用途は表現できない(要件になく、button の意味からも不要)
- **Follow-up**: フィクスチャに「`1` で発火 → `0` で非発火、ただし双方エコー」のケースを入れる

### Decision: 展開は 1 段のみ。展開先集合から展開元自身を除外する

- **Context**: 要件 4.6(循環しても有限回で終了)
- **Alternatives Considered**: 1. 連鎖を許し訪問済み集合で打ち切る 2. 1 段のみ(展開先を再展開しない)
- **Selected Approach**: 2。展開元アドレスの受信でのみ展開が起き、展開書き込み自体は新たな受信として扱わない。加えて、解決した展開先集合から展開元自身のアドレスを取り除く(自己参照パターンによる二重エコーを防ぐ)
- **Rationale**: 構造的に有限。挙動が読みやすく、2 実装で一致させやすい。レガシーの「All チェック → 各スロットへ反映」は 1 段で足りる
- **Trade-offs**: 「All → グループ代表 → 各スロット」のような多段展開は書けない。必要になったら展開先パターンを複数書く
- **Follow-up**: フィクスチャに「展開先が別規則の展開元でもある」ケースを入れ、連鎖しないことを固定する

### Decision: 共通フィクスチャは原本 1 つ + Unity 側複製 + 一致ガードテスト

- **Context**: G-5 / D-14
- **Alternatives Considered**:
  1. Unity のテストがリポジトリ相対パス(`Application.dataPath/../../protocol/...`)で原本を直接読む
  2. 原本 1 つ + `Assets` 配下への複製 + `tests/guards/` の一致ガード
- **Selected Approach**: 2
- **Rationale**: 1 は複製ゼロで魅力的だが、`OscSurface/` を単体で持ち出したり付録 A の参照実装としてコピーした環境でテストが壊れる(Unity プロジェクトの自己完結性が失われる)。2 なら Unity 側は自己完結し、乖離は `pnpm test` が必ず検出する(既存 `tests/guards/legacy-names.test.ts` と同じ枠)
- **Trade-offs**: 複製の更新忘れが起きうる → ガードテストで機械検出する。改行差は正規化して比較する
- **Follow-up**: `.json` の複製には `.meta` が必要。GUID はランダムな 32 桁 hex を新規生成する(連続・ローテーション系列は禁止)

### Decision: 展開バーストの緩和策は入れず、実測項目に載せる

- **Context**: G-9。64 スロット構成では 1 受信 → 65 データグラム(展開元 1 + 展開先 64)
- **Selected Approach**: bundle 化・間引き・分割送信のいずれも導入しない。`docs/VERIFICATION.md` に「All トグル操作時の UI 追従と欠落の有無を実測する」項目を追加する
- **Rationale**: 65 個の短いメッセージ(合計 3KB 未満)であり、有線 LAN / 同一ホスト運用(D-L5)の前提では問題になりにくい。未実測の段階で機構を足すと `packages/bridge` 側の受信経路にも影響しうる(D-3 の境界)
- **Trade-offs**: Wi-Fi 環境で取りこぼす可能性が残る → 実測して問題があれば後続 spec で起案する

## Risks & Mitigations

- **二重実装(C# / TypeScript)の乖離** — 共通フィクスチャ(`protocol/staging-cases.json`)を両者から読み、mock 側は `pnpm test` で常時、C# 側は EditMode テストで検証する。フィクスチャ複製の乖離は `tests/guards/` が検出する
- **EditMode テストが CI で回らない** — `pnpm test` からも CI からも実行されない(既知の制約)。緩和として、規律の大半を mock 側フィクスチャテストで常時検証し、EditMode テストは「C# 実装が同じフィクスチャを満たすこと」の確認に位置づける。実行手順は `docs/VERIFICATION.md` に明記する(9.3)
- **asmdef 新設による既存コンパイルへの影響** — `noEngineReferences: true` の純 C# アセンブリ 1 つと Editor 専用テストアセンブリ 1 つのみ。`Assembly-CSharp` は非テスト asmdef を自動参照するため既存コードは `using` 追加だけで済む。Unity Editor での再コンパイル確認を完了条件に入れる
- **`.meta` GUID の衝突** — 新規 `.meta` は必ずランダム生成した 32 桁 hex を使う(`[guid]::NewGuid().ToString('N')`)。既存 `.meta` からのコピーやローテーション系列は禁止
- **`bool` の `default` 出力形の変更が既存アセット/シナリオに波及** — スキーマ上は受理され UI 表示も等価。互換性ノートへ明記し、mock の既存シナリオ(`default.json` 等)への影響をテストで確認する
- **付録 A.2 の全文同期漏れ** — 対象ファイルが 2 → 4(C# 3 + asmdef)へ増える。C# 変更と同一タスク内で同期することを完了条件に書く
- **先行 spec との衝突** — `manifest-input-select-widgets` の実装完了を着手条件とする(要件の前提条件)。同一ファイル(`OscSurfaceManifestAsset.cs` / `OscSurfaceBridge.cs` / 付録 A.2 / mock-unity)を双方が変更する

## References

- [OpenSoundControl 1.0 Specification — OSC Address Pattern matching](https://opensoundcontrol.stanford.edu/spec-1_0-examples.html) — `*` が part 内の 0 文字以上に一致し `/` を跨がないこと
- [OpenSound Control Specification (wosclib 収録の写し)](https://wosclib.sourceforge.net/osc-ref.pdf) — パターンマッチ規則の原文
- [Unity Manual — Script compilation and assembly definition files](https://docs.unity3d.com/2020.1/Documentation/Manual/ScriptCompilationAssemblyDefinitionFiles.html) — predefined assembly と asmdef の参照関係
- [Unity Manual — Edit mode and Play mode tests](https://docs.unity3d.com/6000.4/Documentation/Manual/test-framework/edit-mode-vs-play-mode-tests.html) — EditMode / PlayMode の分離
- [Unity Test Framework 1.4 — Workflow: How to create a new test assembly](https://docs.unity.cn/Packages/com.unity.test-framework@1.4/manual/workflow-create-test-assembly.html) — テスト asmdef の標準形(`nunit.framework.dll` / TestRunner 参照 / `includePlatforms`)
- [Unity Discussions — Missing reference between 'Assembly-CSharp' and 'Tests' assembly](https://discussions.unity.com/t/missing-reference-between-assembly-csharp-and-tests-assembly-created-with-assembly-definition/212896) — テストアセンブリから `Assembly-CSharp` を参照できない事例と回避策
- [Unity Manual — JSON Serialization](https://docs.unity3d.com/2018.2/Documentation/Manual/JSONSerialization.html) — `JsonUtility` の対応範囲
- [Top-Level Arrays and Dictionaries in JSON: Why Unity's JsonUtility Can't Handle Them](https://medium.com/@fulton_shaun/top-level-arrays-and-dictionaries-in-json-why-unitys-jsonutility-can-t-handle-them-8cc3af7d7b0f) — トップレベル配列が null を返す挙動
- `docs/LEGACY_PRESET_REQUIREMENTS.md` §3(D-L3)/ §4.2 / §5 / §6.3 — 要件の正
- `.kiro/multi-spec/legacy-preset-upstream.md` — 分割方針と S2-1〜S2-3
- `.kiro/specs/manifest-input-select-widgets/design.md` — 先行 spec のフィクスチャ流儀と C# 拡張方針
