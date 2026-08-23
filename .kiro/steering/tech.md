# 技術スタック

## アーキテクチャ

**2 プロセス + 外部 Unity** の構成。プロセス境界がそのまま責務境界になっている。

```
Unity / mock-unity  --OSC over UDP-->  bridge (Node.js)  --WebSocket JSON-->  NiceGUI UI (Python)
   (真実の源)        <-- 送信 7090 --   受信 7091 / WS 7080  <--             ブラウザ :8080
```

- **bridge** — OSC/UDP の送受信、ping/pong による死活監視、マニフェストの検証と採用、誤接続ガード、NDJSON 診断ログ、WebSocket ハブ
- **nicegui-ui** — WebSocket クライアント、マニフェストからのウィジェット生成、表示キャッシュ、操作の送信
- 両者は言語が異なるため、コードではなく **プロトコル文書 (`docs/BRIDGE_PROTOCOL.md`) と `protocol/wire-samples.json`** を契約として結合する。UI は TypeScript の型を import しない

## 中核技術

- **言語/ランタイム**: TypeScript 5.5 on Node.js >= 20(CommonJS、`module: NodeNext`)/ Python >= 3.11
- **UI フレームワーク**: NiceGUI >= 2.0
- **パッケージ管理**: pnpm 10.13.1 を **corepack 経由**で使用(グローバルインストールしない、`packageManager` で固定)。Python 側は `packages/nicegui-ui/.venv` に editable install
- **バンドル**: esbuild(実行可能な成果物を持つ `bridge` / `mock-unity` のみ、単一 CJS ファイルへ)
- **プラットフォーム**: Windows を主対象(PowerShell、`.bat` ランチャー、`py -3` ランチャー)

## 主要ライブラリ

| ライブラリ | 用途 | 備考 |
|---|---|---|
| `zod` | 境界でのスキーマ検証 | プロトコル・設定・マニフェストの正典。TypeScript 型はスキーマから導出する |
| `osc` (npm) | OSC のエンコード/デコード | `osc-codec` に閉じ込める。`shared` はライブラリ非依存に保つ |
| `ws` | WebSocket サーバ | bridge 側 |
| `websockets` (Python) | WebSocket クライアント | `connect(..., proxy=None)` を必須とする(プロキシ環境変数を無視するため) |
| `vitest` / `pytest` | テスト | 下記「テスト」参照 |

## 開発標準

### 型安全性と境界検証

- TypeScript は **strict**。`noEmit: true` で、`tsc` は型チェック専用(成果物は esbuild が作る)
- 外部から入る値(WebSocket フレーム、OSC メッセージ、設定ファイル、マニフェスト)は **必ず zod で検証してから内部型として扱う**
- スキーマは **strict object**(未知キーを拒否)、判別可能ユニオンは `discriminatedUnion` を使う
- 数値は仕様どおりの値域まで縛る(例: OSC int32 は `-2147483648`〜`2147483647`、ポートは 1〜65535)。緩いスキーマは下流で黙って壊れる
- 不正フレームは **そのフレームだけを破棄してログに記録し、接続は維持する**(切断しない)。プロトコル版 `v` の不一致も同様

### テスト

- **単体テスト**: ソースの隣に `*.test.ts` を置く(`packages/*/src/**/*.test.ts`)。vitest の `unit` プロジェクト
- **E2E**: `tests/e2e/**/*.e2e.test.ts`。実プロセス(bridge / mock-unity)を起動し、WebSocket・OSC クライアントで検証する。ポート競合を避けるため `fileParallelism: false` + `singleFork` の直列実行、タイムアウト 120 秒
- **ガードテスト**: `tests/guards/**` はリポジトリ全体の規約を機械的に守るテスト(例: 旧名称の残留検出)。`git ls-files` を走査し、除外は「内容が凍結された記録」に限る
- **クロス言語契約テスト**: `protocol/wire-samples.json` を TypeScript 側と Python 側の双方が読み、同じフレームをエンコード/デコードできることを確認する。プロトコルを変更したらまずサンプルを更新する
- **Python テスト**: pytest(`asyncio_mode = "auto"`、`testpaths = ["tests"]`、`pythonpath = ["src"]`)。`scripts/run-python-tests.mjs` が `.venv` を探して実行し、仮想環境が無ければ **スキップ理由と対処法を出して exit 0**
- import スモークテスト(`test_import_smoke.py`)を消さない。UI モジュールを import しないテスト構成では、起動不能を全テスト緑のまま見逃す

### ログとメッセージ

- ブリッジの標準出力は `OSCDESK_BRIDGE_READY {JSON}` の 1 行で起動完了と実効設定を通知する。テストハーネスと起動スクリプトはこの行を待つ。同様に mock-unity も READY 行を出す
- 診断証跡は `logs/diagnostics/*.ndjson`(1 行 1 JSON)。通常は `oscdesk-*.ndjson`、誤接続拒否は `oscdesk-guard-*.ndjson`。容量上限は debug 時も無効化せず自動パージで守る
- 運用ログの接頭辞は `(WARN, BRIDGE)` / `(ERROR, BRIDGE)` のような発生源つきタグ

### Windows 固有の規約

- `.bat` は薄いランチャーに留め、**非 ASCII 文字を一切書かない**。cmd がコードページ依存で行を解釈するため日本語が壊れる
- 処理本体と日本語メッセージは `.ps1`(UTF-8 BOM 付き)に置く
- `.gitignore` に Unity 用パターンが深さ無制限で効いているため、Node 側に `Library/` という名前のディレクトリを作らない

## 開発環境

### 必要なもの

Node.js 20 以降 / Python 3.11 以降(`py -3` ランチャー)/ corepack(Node 同梱)。pnpm と esbuild の個別インストールは不要。

### 主要コマンド

```powershell
# 初回セットアップ(依存導入・全ビルド・Python venv 作成を一括、再実行可)
.\setup-oscdesk.ps1        # または setup-oscdesk.bat をダブルクリック

# 通常起動(ブリッジ + UI の 2 プロセス、閉じると両方停止)
.\start-oscdesk.ps1        # デバッグ: start-oscdesk-debug.bat / OSC ネイティブ UI 評価: start-oscdesk-touchosc.bat

# 型チェック(全パッケージ)
corepack pnpm typecheck

# テスト一式(ビルド → vitest → pytest の単一入口)
corepack pnpm test

# 単体テストのみ
corepack pnpm exec vitest run --config vitest.config.ts --project unit
```

テストの入口は `corepack pnpm test` ひとつに保つ。新しいテスト種別を足す場合も、この入口から到達できるようにする。

## 重要な技術判断

設計判断の正典は **`DESIGN.md`**(`D-0xx` の連番で時系列に追記、覆す場合も履歴を消さない)。現行構成に効いている主なものは以下。

- **D-025**: 撤去した旧基盤(外部の OSC コントロールサーフェス実装)から、Node ブリッジ + NiceGUI の 2 プロセス構成へ移行。UDP 変換と WebSocket 処理を Node に集約し、UI を Python に分離
- **D-026 / D-027**: 機械名は `oscdesk`、表示名は `OscDesk`。Unity との契約である `/sys/*` は据え置き、内部・UI 向け名前空間は `/oscdesk/*`
- **D-028**: WebSocket フレームは `v` と `type` を持つエンベロープ付き JSON オブジェクト。OSC 引数は型タグ付き、blob は base64
- **D-029**: 設定は `unity` / `bridge` / `ui` の 3 ブロック。起動時に解決した実効値を READY 行と `hello` フレームで配布し、それを正典とする(UI が設定ファイルを直接読まない)
- **D-006**: `osc` npm はコーデック層に限定し、`shared` はライブラリ非依存の wire 型だけを持つ
- **D-021**: UI の表示更新はページ側の 20Hz タイマーで状態を取り込む。バックグラウンドタスクから UI 要素を直接触らない
- **D-031**: 証跡は NDJSON とブリッジ標準出力に集約する(画面上の診断パネルは廃止)

---
_標準とパターンを記述する。依存関係の網羅列挙はしない_
