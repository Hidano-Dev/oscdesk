# 開発ガイド

技術スタック・開発標準・リポジトリ構造の約束事。設計判断の正典は `DESIGN.md`、Unity との契約は `docs/UNITY_PROTOCOL.md`、UI との契約は `docs/BRIDGE_PROTOCOL.md` を参照する。

## 技術スタック

### アーキテクチャ

**2 プロセス + 外部 Unity** の構成。プロセス境界がそのまま責務境界になっている。

```
Unity / mock-unity  --OSC over UDP-->  bridge (Node.js)  --WebSocket JSON-->  NiceGUI UI (Python)
   (真実の源)        <-- 送信 7090 --   受信 7091 / WS 7080  <--             ブラウザ :8080
```

- **bridge** — OSC/UDP の送受信、ping/pong による死活監視、マニフェストの検証と採用、誤接続ガード、NDJSON 診断ログ、WebSocket ハブ
- **nicegui-ui** — WebSocket クライアント、マニフェストからのウィジェット生成、表示キャッシュ、操作の送信
- 両者は言語が異なるため、コードではなく **プロトコル文書 (`docs/BRIDGE_PROTOCOL.md`) と `protocol/wire-samples.json`** を契約として結合する。UI は TypeScript の型を import しない

### 中核技術

- **言語/ランタイム**: TypeScript 5.5 on Node.js >= 20(CommonJS、`module: NodeNext`)/ Python >= 3.11
- **UI フレームワーク**: NiceGUI >= 2.0
- **パッケージ管理**: pnpm 10.13.1 を **corepack 経由**で使用(グローバルインストールしない、`packageManager` で固定)。Python 側は `packages/nicegui-ui/.venv` に editable install
- **バンドル**: esbuild(実行可能な成果物を持つ `bridge` / `mock-unity` のみ、単一 CJS ファイルへ)
- **プラットフォーム**: Windows を主対象(PowerShell、`.bat` ランチャー、`py -3` ランチャー)
- **Unity**: `OscSurface/` は Unity 6000.0.36f1(`ProjectSettings/ProjectVersion.txt`)

### 主要ライブラリ

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
- **Unity**: `OscSurface/` の C# は `corepack pnpm test` / `typecheck` の対象外。Unity Test Runner(EditMode)と CI(`.github/workflows/unity-ci.yml`)で検証する

### ログとメッセージ

- ブリッジの標準出力は `OSCDESK_BRIDGE_READY {JSON}` の 1 行で起動完了と実効設定を通知する。テストハーネスと起動スクリプトはこの行を待つ。同様に mock-unity も READY 行を出す
- 診断証跡は `logs/diagnostics/*.ndjson`(1 行 1 JSON)。通常は `oscdesk-*.ndjson`、誤接続拒否は `oscdesk-guard-*.ndjson`。容量上限は debug 時も無効化せず自動パージで守る
- 運用ログの接頭辞は `(WARN, BRIDGE)` / `(ERROR, BRIDGE)` のような発生源つきタグ

### Windows 固有の規約

- `.bat` は薄いランチャーに留め、**非 ASCII 文字を一切書かない**。cmd がコードページ依存で行を解釈するため日本語が壊れる
- 処理本体と日本語メッセージは `.ps1`(UTF-8 BOM 付き)に置く
- `.gitignore` に Unity 用パターンが深さ無制限で効いているため、Node 側に `Library/` という名前のディレクトリを作らない

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

### 現行構成に効いている主な設計判断

設計判断の正典は **`DESIGN.md`**(`D-0xx` の連番で時系列に追記、覆す場合も履歴を消さない)。

- **D-025**: 撤去した旧基盤(外部の OSC コントロールサーフェス実装)から、Node ブリッジ + NiceGUI の 2 プロセス構成へ移行。UDP 変換と WebSocket 処理を Node に集約し、UI を Python に分離
- **D-026 / D-027**: 機械名は `oscdesk`、表示名は `OscDesk`。Unity との契約である `/sys/*` は据え置き、内部・UI 向け名前空間は `/oscdesk/*`
- **D-028**: WebSocket フレームは `v` と `type` を持つエンベロープ付き JSON オブジェクト。OSC 引数は型タグ付き、blob は base64
- **D-029**: 設定は `unity` / `bridge` / `ui` の 3 ブロック。起動時に解決した実効値を READY 行と `hello` フレームで配布し、それを正典とする(UI が設定ファイルを直接読まない)
- **D-006**: `osc` npm はコーデック層に限定し、`shared` はライブラリ非依存の wire 型だけを持つ
- **D-021**: UI の表示更新はページ側の 20Hz タイマーで状態を取り込む。バックグラウンドタスクから UI 要素を直接触らない
- **D-031**: 証跡は NDJSON とブリッジ標準出力に集約する(画面上の診断パネルは廃止)

## リポジトリ構造

### 構成方針

**プロトコル中心の層構成を、pnpm ワークスペースのパッケージ境界で表現する。**

契約(型・スキーマ・定数)を最下層の `shared` に置き、その上に I/O を担う各パッケージを積む。UI だけは言語が違うため、コード共有ではなく文書化されたプロトコルで結合する。パッケージ内部は「機能ごとの 1 ファイル」で平坦に並べ、深い階層を作らない。

### TypeScript パッケージ (`packages/<name>/`)

`src/` に実装と単体テストを平置き、`package.json` / `tsconfig.json` を各パッケージが持つ。実行可能な成果物があるパッケージだけが `dist/` を持つ。

| パッケージ | npm 名 | 役割 | 成果物 |
|---|---|---|---|
| `shared` | `@oscdesk/shared` | プロトコル定数・zod スキーマ・wire 型 | なし(`main: src/index.ts` で TS ソースを直接参照) |
| `osc-codec` | `@oscdesk/osc-codec` | OSC のエンコード/デコード(`osc` npm をここに閉じ込める) | なし(同上) |
| `bridge` | `@oscdesk/bridge` | OSC/UDP ↔ WebSocket の中継本体 | `dist/oscdesk-bridge.js` |
| `mock-unity` | `@oscdesk/mock-unity` | Unity 役の OSC レスポンダ | `dist/mock-unity.js` |

ビルド出力を持たないパッケージも `build` スクリプトを定義し(何もしない旨を出力するだけ)、`pnpm -r run build` が一様に通るようにする。

### Python パッケージ (`packages/nicegui-ui/`)

`src/oscdesk_ui/`(src レイアウト)+ `tests/` + `pyproject.toml`。仮想環境は `.venv/` をパッケージ内に置く。

モジュールは責務ごとに分ける: `config`(設定)/ `protocol`(フレームのエンコード・デコード)/ `surface_link`(WebSocket 接続)/ `state`(プロセス内の唯一の状態)/ `value_store`(値と送信レート)/ `manifest`(マニフェスト解釈)/ `widgets`(ウィジェット生成)/ `page`(NiceGUI ページ)/ `__main__`(エントリポイント)。

### データと契約

| 場所 | 内容 |
|---|---|
| `config/oscdesk*.config.json` | 実行時設定。`unity` / `bridge` / `ui` の 3 ブロック + フラグ。用途別に通常 / debug / touchosc |
| `protocol/wire-samples.json` | WebSocket フレームの正規サンプル。TS と Python の双方がテストで読む言語間の契約 |
| `packages/mock-unity/scenarios/*.json` | mock の応答内容(正常・不正マニフェスト・projectId 不一致など)をデータで表現 |
| `docs/*.md` | 契約と手順の正典(`BRIDGE_PROTOCOL` / `UNITY_PROTOCOL` / `VERIFICATION` ほか) |
| `logs/diagnostics/*.ndjson` | 実行時の診断証跡(コミット対象外) |

### テスト (`tests/`)

- `tests/e2e/*.e2e.test.ts` — 実プロセスを起動する E2E
- `tests/e2e/helpers/` — プロセスハーネス、ポート確保、bridge/mock 起動、WebSocket/OSC クライアント。**E2E から実行の詳細をここへ追い出す**
- `tests/guards/*.test.ts` — リポジトリ全体の規約を機械的に守るテスト

### ルート直下

`*.bat` は薄いランチャー、対になる `*.ps1` が処理本体。`scripts/` は Node から呼ぶ補助スクリプト(`.mjs`)。`OscSurface/` は同居する Unity プロジェクトで、Node 側の構造とは独立に扱う。

### 命名規約

- **ファイル**: TypeScript は kebab-case(`bridge-server.ts`, `ndjson-writer.ts`)。Python は snake_case(`surface_link.py`)
- **単体テスト**: 対象と同名 + `.test.ts`(TS)/ `test_<対象>.py`(Python)。E2E は `*.e2e.test.ts`
- **TypeScript の識別子**: 型・インターフェースは PascalCase、関数・変数は camelCase、定数は SCREAMING_SNAKE_CASE
- **zod スキーマ**: `XxxSchema`(例: `ManifestSchema`, `WireArgSchema`)。対応する型は同名から `z.infer` で導出する
- **ファクトリ関数**: 状態を持つコンポーネントは `createXxx()`、I/O を開始するものは `startXxx()`(非同期)で生成し、`close()` / `stop()` を返す
- **プロトコルのアドレス**: Unity との契約は `/sys/*`、OSCDesk 内部と UI 向けは `/oscdesk/*`。定数は `shared/src/index.ts` の `SYS` / `OSCDESK` オブジェクトに集約し、文字列リテラルを散らさない
- **機械名 / 表示名**: 機械名は `oscdesk`(パッケージ・設定・実行ファイル・環境変数の `OSCDESK_*`)、表示名は `OscDesk`
- **旧名称の禁止**: 移行前の名前空間・パッケージ名・旧基盤の呼称は、追跡対象のテキストファイルに残さない(禁止トークンの定義は `tests/guards/legacy-names.test.ts` を参照。この文書もガードの走査対象なので、旧名を例示として書かない)。除外リストに足してよいのは「内容が凍結された記録」だけで、生きている資産を足すとガードが残作業を隠す装置になる

### import の並び

```typescript
import fs from 'node:fs'              // 1. Node 組み込み(node: 接頭辞を必ず付ける)
                                      //    空行
import { z } from 'zod'               // 2. 外部パッケージ
                                      //    空行
import type { DownstreamFrame } from '@oscdesk/shared'   // 3. ワークスペース内パッケージ
                                      //    空行
import { createSurfaceCore } from './surface-core'       // 4. 相対パス
```

```python
from __future__ import annotations    # 1. future

import logging                        # 2. 標準ライブラリ
from dataclasses import dataclass

from .config import AppConfig         # 3. パッケージ内相対
```

- **パスエイリアスは使わない**。ワークスペース参照は `workspace:*` 依存 + パッケージ名で行う
- 型だけを使う import は `import type` にする

### 依存の向き(逆流させない)

```
shared  ←  osc-codec  ←  bridge / mock-unity
  ↑
  └─ (コード依存なし) ─  nicegui-ui  … docs/BRIDGE_PROTOCOL.md + protocol/wire-samples.json で結合
```

- `shared` は `zod` 以外に依存しない。OSC ライブラリの型や実装をここへ持ち込まない
- `nicegui-ui` から TypeScript パッケージへの依存を作らない。プロトコルを変えるときは「スキーマ → wire-samples → 文書 → 両言語の実装」の順で揃える
- mock 専用の契約(シナリオスキーマ)は `mock-unity` の内側に閉じ、`shared` へ出さない

### bridge 内部の組み立て

`cli`(引数解析)→ `config`(設定の読み込みと検証)→ `main`(起動と終了コード)→ `bridge-server`(配線)という一方向。`bridge-server` は各コンポーネント(`udp-transport` / `ui-hub` / `surface-core` / `diagnostics-engine` / `guard-event-log`)を生成してコールバックで結びつけるだけで、ロジックを持たない。

### 純粋ロジックと I/O の分離

`surface-core` などのロジック層は、送信関数・配信関数・`fs`・時計・ネットワーク情報プロバイダを **引数で受け取る**。ソケットやファイルを直接掴まない。これにより単体テストがプロセス起動なしで書け、E2E は配線と実プロセスの検証に集中できる。

### コメント

コメントは日本語で **「なぜそうしたか」と「そうしないと何が壊れるか」** を書く。API の説明の繰り返しは書かない。判断の背景が長くなる場合は `DESIGN.md` の `D-0xx` へ記録し、コードからはその番号を参照する。
