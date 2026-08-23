# Requirements Document

## Project Description (Input)
マニフェストに編集可能な入力ウィジェット(widget: "input")と選択式ウィジェット(widget: "select")を追加する。要件の出所はフォーク側からの upstream 開発要件書 docs/LEGACY_PRESET_REQUIREMENTS.md の §6.1(R1)と §6.2(R2)。R1: widget enum に "input" を追加し、type s/i/f に対応する編集可能入力欄を NiceGUI UI に実装する。送信は確定時(Enter またはフォーカス喪失)のみ、編集中はエコーバックで上書きしない(fader の hold 機構と同等の保護)、type "i" + range は UI 側で値域チェック。任意要件として pattern(正規表現)による書式検証の宣言手段。R2: widget enum に "select" を追加し、type s のドロップダウンを実装する。選択肢は options: string[](インライン)と optionsRef: string + マニフェストトップレベル optionLists: {[key]: string[]}(共有参照)の併存(64 スロットが同一デバイス一覧を参照するプリセットでインライン格納だとマニフェストが 50〜55KB に膨らむため共有参照が実質必須)。選択で即時送信・エコーバック確定(discrete 系)、選択肢にない default/エコーバック値の許容、空選択肢の扱い定義。変更対象: packages/shared の zod スキーマと Python 側ミラー、NiceGUI ウィジェット層、mock-unity、docs/UNITY_PROTOCOL.md(§2・§4・付録 A・互換性ノート)。マニフェスト version 1 のまま後方互換で行う。ブリッジ本体は WireArgSchema が s 引数対応済みのため改造不要の見込み。非機能: 約 260 エントリ規模での NiceGUI 描画実用性(6.4-1)。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
