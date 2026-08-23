# Multi-Spec Plan: legacy-preset-upstream

- 生成日: 2026-08-23
- 元セッション: フォーク(a8-oscdesk)からの upstream 開発要件書 `docs/LEGACY_PRESET_REQUIREMENTS.md` §6 のレビューと spec 分割
- Status 欄は /kiro:spec-init-batch が更新する。手で編集して並び替え・追加・削除してもよい。

## 全体コンテクスト

フォークリポジトリ a8-oscdesk では、レガシー版 Windows アプリ「Activ8 OSC Client」(VP_OscClient: WinForms / .NET 8 / Rug.Osc / MemoryPack)を OscDesk の `/sys/*` マニフェスト方式の上で再現したデフォルトプリセット(コンサート運用でのキャラクタースロット操作、64 スロット)を作ろうとしている。その前提として upstream(本リポジトリ = OscDesk 本体)に 3 つの機能が必要であり、要件書 **`docs/LEGACY_PRESET_REQUIREMENTS.md`**(フォークから受領し本リポジトリへコピー済み。自己完結で書かれている)の §6 に定義されている:

- **R1(§6.1)**: 編集可能な入力ウィジェット `widget: "input"`
- **R2(§6.2)**: 選択式ウィジェット `widget: "select"`(選択肢の共有参照 `optionsRef` / `optionLists` を含む)
- **R3(§6.3)**: Unity 側ステージング(「値を蓄えて Update ボタンで適用」)

本プランはこれを 2 spec に分割する。R1+R2 は「共有スキーマ + NiceGUI UI + mock-unity」でファイル的にほぼ同一の変更対象であるため 1 spec にまとめ、R3 は Unity 側 C# 参照実装が主対象で検証方法も別物であるため独立 spec とする。

各 spec の要件詳細は必ず `docs/LEGACY_PRESET_REQUIREMENTS.md` の該当節を正として参照すること(本プランは分割とセッション固有の決定のみを持ち、要件の重複記載は最小限にする)。

**セッション中にコードで裏取り済みの事実**(再調査不要):

- `packages/nicegui-ui/src/oscdesk_ui/widgets.py:17` — `INTERACTIVE_VALUE_TYPES = ("i", "f", "bool")`。文字列 `s` 型は操作系ウィジェットでも表示専用に落とされる(= R1 が必要な理由)
- `packages/shared/src/schemas.ts:18` — `widget: z.enum(['fader', 'button', 'toggle', 'xy', 'text'])`。input / select は未定義
- Unity 参照実装は `OscSurface/Assets/OscSurfaceBridge/` に存在(`OscSurfaceBridge.cs` / `OscSurfaceManifestAsset.cs` / `Editor/OscSurfaceBridgeEditor.cs`)

**全 spec 共通の技術的前提**(要件書 §5 より):

- ワイヤプロトコル(UI ↔ ブリッジ WebSocket、`WireArgSchema`)は `s` 引数送信に対応済みで、**ブリッジ本体の改造は不要**の見込み
- マニフェストは `version: 1` のまま後方互換で変更する(既存ウィジェットのみのマニフェストは従来どおり受理)
- 既存規律の維持: Unity が真実の源 / 値の確定はエコーバックのみ / OSC 1.0 基本型タグのみ / 任意フィールドは値がないときキーごと省略し `null` を書かない

## 共通の決定済み事項

| ID  | 決定 | 理由 |
|-----|------|------|
| G-1 | 要件の正は `docs/LEGACY_PRESET_REQUIREMENTS.md` §5〜§6(フォークから受領、本リポジトリへコピー済み) | 要件書自体が upstream 単体へ渡せるよう自己完結で書かれている。二重管理を避ける |
| G-2 | R1+R2 を 1 spec、R3 を別 spec の計 2 分割 | R1/R2 は変更ファイル(shared スキーマ・NiceGUI ウィジェット層・mock-unity)がほぼ重なり分けると二度手間。R3 は Unity C# が主対象でテスト・検証方法が別物。ユーザーが AskUserQuestion で「2 spec に分ける」を選択済み |
| G-3 | マニフェスト `version: 1` のまま後方互換で拡張する | 要件書 §5 の指定。既存マニフェストの受理を壊さない |
| G-4 | ブリッジ本体(packages/bridge)は変更対象外 | `WireArgSchema` が `s` 引数対応済み(要件書 §5)。実装中に境界を越える必要が出たら実装前にユーザーへ報告(CLAUDE.md の絶対規律) |
| G-5 | フォーク側成果物(64 スロットのプリセットアセット、mock-unity のプリセットシナリオ、E2E)は upstream スコープ外 | 要件書 §7 の分担。upstream は機構(input / select / ステージング)のみ提供する |
| G-6 | 新 widget 値を知らない旧 UI の挙動は「検証エラーでマニフェスト全体を不採用」の現行流儀でよい | 要件書 §5 が upstream 判断に委ねており、現行流儀の維持が最小変更 |

## 検討して捨てた選択肢

| 選択肢 | 捨てた理由 |
|--------|-----------|
| 3 件を 1 spec にまとめる | 契約変更を一括レビューできる利点はあるが、UI 系(TS/Python)と Unity 系(C#)で検証方法が別物であり、レビューと実装バッチを分けたい |
| R1 / R2 / R3 の 3 spec に分ける | R1 と R2 は変更ファイルがほぼ重なるため、分けると同じファイルを二度触る二度手間になる |
| select の選択肢をインライン `options` のみで実装 | フォークの 64 スロット構成では同一デバイス一覧が 64 回重複しマニフェストが 50〜55KB に膨張、単一 UDP データグラムの実用上限(~60KB)に接触しうる(要件書 §4.3)。共有参照 `optionsRef` + `optionLists` が実質必須 |
| レガシープロトコル(MemoryPack blob、ポート 3578/3579)の互換実装 | フォーク側で確定済みの判断(要件書 D-L1)。Unity 側をマニフェスト方式へ移行する前提のため upstream では考慮不要 |
| マニフェストのチャンク分割拡張 | フォーク側判断(D-L5)で単一データグラム容認。不安定が実測されたらフォークが別途起案する。upstream の推奨値(~1.4KB)の変更も要求されていない |

## Spec 一覧(推奨実行順)

| # | Spec | Status | 依存 |
|---|------|--------|------|
| 1 | manifest-input-select-widgets | DONE | - |
| 2 | unity-staging-apply | DONE | -(機能依存なし。ただし #1 と同一ファイルを触るため順次実行) |

---

## Spec: manifest-input-select-widgets

- Status: DONE
- Feature dir: `.kiro/specs/manifest-input-select-widgets/`
- 依存: なし

### 概要

マニフェストの widget enum に編集可能な入力ウィジェット `"input"`(type `s`/`i`/`f`、確定時送信)と選択式ウィジェット `"select"`(type `s`、ドロップダウン、選択肢は `options` インラインと `optionsRef` + トップレベル `optionLists` 共有参照の併存)を追加する。要件の正は `docs/LEGACY_PRESET_REQUIREMENTS.md` §6.1(R1)・§6.2(R2)。

### スコープ (in)

- `packages/shared` の zod スキーマ(`ManifestEntrySchema` の widget enum 拡張、`options` / `optionsRef` / トップレベル `optionLists`、任意で `pattern`)と Python 側ミラーの同期
- NiceGUI ウィジェット層(`packages/nicegui-ui/src/oscdesk_ui/widgets.py` ほか): input の確定時送信・編集中のエコーバック上書き保護(既存 fader の hold 機構と同等)・`i` の int32 値域 / `range` チェック、select の即時送信・エコーバック確定(discrete 系)・選択肢外の値の許容・空選択肢の扱い
- mock-unity: input / select を含むマニフェストとエコーバック応答のシナリオ(upstream のテスト用。フォークのプリセットシナリオとは別物)
- Unity 参照実装の対応(要件書 §5 の変更対象に含まれる): `OscSurfaceManifestAsset` の widget enum への input / select 追加と選択肢(options / optionsRef / optionLists)のアセット定義・マニフェスト JSON 出力
- `docs/UNITY_PROTOCOL.md` §2(スキーマ)・§4(実装指針)・付録 A・互換性ノートへの追記
- 約 260 エントリ規模(64 スロット × 4 + グローバル)での NiceGUI 描画実用性(要件書 §6.4-1)

### スコープ (out)

- ステージング機構(spec: unity-staging-apply が担当)
- フォーク側デフォルトプリセット(64 スロットのアセット定義、`vp-concert-default` シナリオ)
- ブリッジ本体の変更(G-4)
- マニフェストのチャンク分割

### この Spec 固有の決定済み事項

| ID  | 決定 | 理由 |
|-----|------|------|
| S1-1 | input の送信は確定時(Enter またはフォーカス喪失)のみ。キーストロークごとに送らない | レガシーの「入力途中の値を飛ばさない」意図とエコーバック確定の規律との整合(要件書 R1-3) |
| S1-2 | 編集中(フォーカス保持中)は受信値で入力欄を上書きしない。確定後の受信値で表示確定 | 既存 fader の hold 機構と同じ保護(要件書 R1-5) |
| S1-3 | select は `options`(インライン)と `optionsRef` + `optionLists`(共有参照)の 2 形態を併存させる | 少数エントリの簡便さと、64 スロットで同一一覧を共有するときのサイズ削減(50〜55KB → 30〜32KB)の両立(要件書 R2-3、§4.3) |
| S1-4 | 選択肢にない `default` / エコーバック値を受けてもマニフェスト全体は不採用にしない(受信値表示または未選択表示へ落とす) | デバイス一覧変化時の頑健性(要件書 R2-5) |
| S1-5 | 選択肢の変化はマニフェスト再送で反映。専用の差分プロトコルは追加しない | 既存の「採用は冪等」「回復時再要求」の仕組みに乗る(要件書 R2-6) |
| S1-6 | 送信タグは `type` に従う(`s`→`s`、`i`→`i` の整数値、`f`→`f`)。`i` は UI 側で int32 値域チェック | ブリッジの `WireArgSchema` が逸脱を拒否するため UI 側で先に守る(要件書 R1-4) |

### 未決事項(dig で確認すべき候補)

- 任意要件 R1-8 の `pattern`(正規表現による書式検証、IPv4 入力の UI 側検証用)を本 spec で実装するか見送るか。見送る場合、形式不正の値も Unity へ送られる前提を unity-staging-apply(不正値をステージングで無視)が引き受けることになる
- 1 エントリに `options` と `optionsRef` の両方があるときの優先順位、`optionsRef` の参照先キー欠落時の扱い(現行流儀ならエントリ不正 = マニフェスト全体不採用。要件書 R2-3 が upstream 定義に委ねている)
- `type: "i"` + `range` の範囲外入力を「拒否」と「クランプ」のどちらにするか(要件書 R1-7 は両方許容)
- 空の選択肢配列の表示(レガシーは `"Not Found!"` を 1 件入れていた。UI 側の「選択肢なし」表示でもよい。要件書 R2-7)
- 約 260 エントリでの描画性能対策(グループ折りたたみ・遅延描画など)をどこまでやるか(要件書 §6.4-1 は upstream 判断に委ねている)

### 他 Spec とのインターフェース

- `docs/UNITY_PROTOCOL.md` と mock-unity、`OscSurface/Assets/OscSurfaceBridge/*.cs` を unity-staging-apply も変更する。順次実行でコンフリクトを避ける(推奨順 #1 → #2)
- 本 spec が定義する select の `optionLists` スキーマは、フォークのプリセット(64 スロットがデバイス一覧を共有参照)が直接利用する

---

## Spec: unity-staging-apply

- Status: DONE
- Feature dir: `.kiro/specs/unity-staging-apply/`
- 依存: なし(機能依存はないが、manifest-input-select-widgets と同一ファイルを触るため後に実行)

### 概要

Unity 側参照実装(`OscSurface/Assets/OscSurfaceBridge/` の `OscSurfaceBridge` / `OscSurfaceManifestAsset`)に「受信値を蓄えて Update ボタン受信時にアプリへ適用する」ステージング機能を追加する。ワイヤプロトコルは無改造(マニフェスト `version: 1` のまま)。要件の正は `docs/LEGACY_PRESET_REQUIREMENTS.md` §6.3(R3)。

### スコープ (in)

- アセット定義への宣言追加: ステージング対象(案: `staged: bool`)、button エントリの適用トリガ(案: `applies:` 対象アドレス接頭辞/グループ)、一括操作の展開規則(例: `/vp/all/active` 受信を `/vp/member/{NN}/active` 群への書き込みに展開)。**C# を書き換えずアセット定義だけで構成できること**(「案件差分はコードでなくデータ」の規律)
- 受信時挙動: ステージング領域へ保持しつつ同一アドレスへ通常どおりエコーバック(UI 表示確定は即時、アプリ適用のみ遅延)。`currentValues` もステージング値で更新し、再接続時の UI(マニフェスト `default`)がステージング状態を復元できること
- 適用トリガ受信で対象範囲のステージング値を適用するコールバック/イベント発火(適用処理自体はアプリ固有実装に委ねる)
- 一括操作の展開先アドレスへも個別にエコーバックし、UI の各ウィジェットが追従できること
- 適用前ステージング値と適用済み値の乖離を許容(レガシーと同じ)
- mock-unity へのステージング挙動の模擬(フォーク側 E2E の前提になる)
- `docs/UNITY_PROTOCOL.md` §4(実装指針)・付録 A・互換性ノートへの追記

### スコープ (out)

- input / select ウィジェット(spec: manifest-input-select-widgets が担当)
- 適用処理そのもの(キャラクターへの反映などアプリ固有実装。BasicConcertDevelopment_URP 側での構成はフォーク側 §7-3 の作業)
- ワイヤプロトコル・ブリッジ・NiceGUI UI の変更(ステージングは Unity 側で閉じる)

### この Spec 固有の決定済み事項

| ID  | 決定 | 理由 |
|-----|------|------|
| S2-1 | ステージングはプロトコル無改造で Unity 側に閉じて実装する | UI から見れば通常のエコーバック付き送信と区別がつかない設計により、既存の UI・ブリッジ・プロトコルを一切変えずにレガシーの運用感を再現できる(要件書 D-L3) |
| S2-2 | ステージング構成(対象・トリガ・展開規則)はアセット定義で宣言する | 「案件差分はコードでなくデータ」の規律。案件ごとに C# を書き換えない(要件書 R3-1) |
| S2-3 | マニフェストの `default` はステージング値を返す | 再接続時の UI 表示復元をマニフェストが担う(レガシーの `member_slot_state.json` 相当を「Unity が真実の源」の規律で置き換える。要件書 R3-2・R3-5) |

### 未決事項(dig で確認すべき候補)

- `staged` / `applies` / 展開規則の具体的な宣言形式(要件書は案を示すのみで upstream 設計に委ねている)。特に展開規則(1 アドレス → 複数アドレス書き込み)をアセット上でどう表現するか(ワイルドカード、接頭辞、明示リストなど)
- 適用コールバックの公開形態(UnityEvent / C# event / interface のどれか、適用範囲の渡し方)
- mock-unity 側の模擬を「汎用のステージング機構」として実装するか「シナリオ固有の応答」に留めるか
- Unity C# 部分の検証方法(本リポジトリのテスト入口 `pnpm test` は TS/Python のみ。EditMode テストを足すか、`docs/VERIFICATION.md` の手動検証で担保するか)
- 形式不正の値(例: IPv4 でない文字列)をステージングで無視する要件を持たせるか(manifest-input-select-widgets が `pattern` 検証を見送った場合の受け皿。要件書 R1-8 の注記)

### 他 Spec とのインターフェース

- `docs/UNITY_PROTOCOL.md`・mock-unity・`OscSurface/Assets/OscSurfaceBridge/*.cs` を manifest-input-select-widgets も変更する(推奨順 #1 → #2 で順次実行)
- フォークのプリセットが前提とする具体構成(要件書 §6.3 末尾): `/vp/member/{NN}/*` がステージング対象、`/vp/member/{NN}/update` がスロット適用トリガ、`/vp/all/update` が全スロット適用、`/vp/all/active` が全スロット `active` への展開書き込み、`/vp/mb/*` + `/vp/mb/update` が MotionBuilder 設定
