# プロジェクト構造

## 構成方針

**プロトコル中心の層構成を、pnpm ワークスペースのパッケージ境界で表現する。**

契約(型・スキーマ・定数)を最下層の `shared` に置き、その上に I/O を担う各パッケージを積む。UI だけは言語が違うため、コード共有ではなく文書化されたプロトコルで結合する。パッケージ内部は「機能ごとの 1 ファイル」で平坦に並べ、深い階層を作らない。

## ディレクトリのパターン

### TypeScript パッケージ (`packages/<name>/`)

**構成**: `src/` に実装と単体テストを平置き、`package.json` / `tsconfig.json` を各パッケージが持つ。実行可能な成果物があるパッケージだけが `dist/` を持つ。

| パッケージ | npm 名 | 役割 | 成果物 |
|---|---|---|---|
| `shared` | `@oscdesk/shared` | プロトコル定数・zod スキーマ・wire 型 | なし(`main: src/index.ts` で TS ソースを直接参照) |
| `osc-codec` | `@oscdesk/osc-codec` | OSC のエンコード/デコード(`osc` npm をここに閉じ込める) | なし(同上) |
| `bridge` | `@oscdesk/bridge` | OSC/UDP ↔ WebSocket の中継本体 | `dist/oscdesk-bridge.js` |
| `mock-unity` | `@oscdesk/mock-unity` | Unity 役の OSC レスポンダ | `dist/mock-unity.js` |

ビルド出力を持たないパッケージも `build` スクリプトを定義し(何もしない旨を出力するだけ)、`pnpm -r run build` が一様に通るようにする。

### Python パッケージ (`packages/nicegui-ui/`)

**構成**: `src/oscdesk_ui/`(src レイアウト)+ `tests/` + `pyproject.toml`。仮想環境は `.venv/` をパッケージ内に置く。

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

## 命名規約

- **ファイル**: TypeScript は kebab-case(`bridge-server.ts`, `ndjson-writer.ts`)。Python は snake_case(`surface_link.py`)
- **単体テスト**: 対象と同名 + `.test.ts`(TS)/ `test_<対象>.py`(Python)。E2E は `*.e2e.test.ts`
- **TypeScript の識別子**: 型・インターフェースは PascalCase、関数・変数は camelCase、定数は SCREAMING_SNAKE_CASE
- **zod スキーマ**: `XxxSchema`(例: `ManifestSchema`, `WireArgSchema`)。対応する型は同名から `z.infer` で導出する
- **ファクトリ関数**: 状態を持つコンポーネントは `createXxx()`、I/O を開始するものは `startXxx()`(非同期)で生成し、`close()` / `stop()` を返す
- **プロトコルのアドレス**: Unity との契約は `/sys/*`、OSCDesk 内部と UI 向けは `/oscdesk/*`。定数は `shared/src/index.ts` の `SYS` / `OSCDESK` オブジェクトに集約し、文字列リテラルを散らさない
- **機械名 / 表示名**: 機械名は `oscdesk`(パッケージ・設定・実行ファイル・環境変数の `OSCDESK_*`)、表示名は `OscDesk`
- **旧名称の禁止**: 移行前の名前空間・パッケージ名・旧基盤の呼称は、追跡対象のテキストファイルに残さない(禁止トークンの定義は `tests/guards/legacy-names.test.ts` を参照。この steering ファイルもガードの走査対象なので、旧名を例示として書かない)。除外リストに足してよいのは「内容が凍結された記録」だけで、生きている資産を足すとガードが残作業を隠す装置になる

## import の並び

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

## コード構成の原則

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

---
_パターンを記述する。ファイルツリーの列挙はしない。パターンに従った新規ファイルの追加では更新不要_
