# 開発ガイド

技術スタック・開発標準・リポジトリ構造の約束事。設計判断の正典は `DESIGN.md`(いま有効なものの索引は `docs/DECISIONS.md`)、Unity との契約は `docs/UNITY_PROTOCOL.md`、UI との契約は `docs/BRIDGE_PROTOCOL.md` を参照する。

## 技術スタック

### アーキテクチャ

**2 プロセス + 外部 Unity** の構成。プロセス境界がそのまま責務境界になっている。

```
Unity / mock-unity  --OSC over UDP-->  bridge (Node.js)  --WebSocket JSON-->  NiceGUI UI (Python)
 (受けてエコーする)  <-- 送信 7090 --   受信 7091 / WS 7080  <--             ブラウザ :8080
                                     (定義と保持値の正)
```

- **bridge** — OSC/UDP の送受信(複数の Unity 宛先。宛先パネルでの実行時の選択と LAN の走査を含む)、ping/pong による宛先ごとの死活監視、サーフェス定義の保管・検証・配信、狙いの値の保持と再送、NDJSON 診断ログ、WebSocket ハブ
- **nicegui-ui** — WebSocket クライアント、サーフェス定義からの画面生成と編集モード、表示キャッシュ、操作とまとめ送りの送信
- **Unity 側の受け口**(UPM パッケージ `com.hidano.oscdesk`、本体は `OscSurface/Packages/com.hidano.oscdesk/`。D-096、`docs/UPM_PACKAGE.md`)— 受けたアドレスを UnityEvent に振り分け、pong とエコーを返す。UI の設計図(Catalog)をターゲットから Sync でブリッジへ送る(D-101。D-051 の「構造を申告しない」を覆した)。形は `/sys/catalog/*`(D-104)で、ブリッジ側の受信・PC ごとの保持・既定の画面の生成(D-112)は実装済み。Unity 側の送信は HID-379
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
| `zod` | 境界でのスキーマ検証 | プロトコル・設定・サーフェス定義の正典。TypeScript 型はスキーマから導出する |
| `osc` (npm) | OSC のエンコード/デコード | `osc-codec` に閉じ込める。`shared` はライブラリ非依存に保つ |
| `ws` | WebSocket サーバ | bridge 側 |
| `websockets` (Python) | WebSocket クライアント | `connect(..., proxy=None)` を必須とする(プロキシ環境変数を無視するため) |
| `vitest` / `pytest` | テスト | 下記「テスト」参照 |

## 開発標準

### 型安全性と境界検証

- TypeScript は **strict**。`noEmit: true` で、`tsc` は型チェック専用(成果物は esbuild が作る)
- 外部から入る値(WebSocket フレーム、OSC メッセージ、設定ファイル、サーフェス定義)は **必ず zod で検証してから内部型として扱う**
- スキーマは **strict object**(未知キーを拒否)、判別可能ユニオンは `discriminatedUnion` を使う
- 数値は仕様どおりの値域まで縛る(例: OSC int32 は `-2147483648`〜`2147483647`、ポートは 1〜65535)。緩いスキーマは下流で黙って壊れる
- 不正フレームは **そのフレームだけを破棄してログに記録し、接続は維持する**(切断しない)。プロトコル版 `v` の不一致も同様

### テスト

- **単体テスト**: ソースの隣に `*.test.ts` を置く(`packages/*/src/**/*.test.ts`)。vitest の `unit` プロジェクト
- **E2E**: `tests/e2e/**/*.e2e.test.ts`。実プロセス(bridge / mock-unity)を起動し、WebSocket・OSC クライアントで検証する。ファイルは並列のワーカーで動かす(上限はコア数の 1/4 を 2〜6 に収めた全体の `maxWorkers`。`--maxWorkers` か `VITEST_MAX_FORKS` で上書き。ポートの帯の数(12)を超えられない)。ポートは `helpers/ports.ts` がワーカーごとに重ならない帯(20000〜31999 を `VITEST_POOL_ID` で 1,000 ずつ)から払い出し、ブリッジは起動ごとの一時フォルダを作業フォルダにして既定の保管先(`surfaces/`・`logs/diagnostics/`)をリポジトリと共有しない。既定のポート(7080・7090・7091)で起動したブリッジは `startBridge` が落とす。固定のポート・実ネットワークのブロードキャスト・本物の LAN 走査など並列にできない資源を使うテストを足すときは、別のプロジェクトに分けて直列にする(D-133)。タイムアウト 120 秒
- **ガードテスト**: `tests/guards/**` はリポジトリ全体の規約を機械的に守るテスト(例: 旧名称の残留検出)。`git ls-files` を走査し、除外は「内容が凍結された記録」に限る
- **クロス言語契約テスト**: `protocol/wire-samples.json` を TypeScript 側と Python 側の双方が読み、同じフレームをエンコード/デコードできることを確認する。プロトコルを変更したらまずサンプルを更新する
- **Python テスト**: pytest(`asyncio_mode = "auto"`、`testpaths = ["tests"]`、`pythonpath = ["src"]`)。`scripts/run-python-tests.mjs` が `.venv` を探して実行し、仮想環境が無ければ **スキップ理由と対処法を出して exit 0**
- import スモークテスト(`test_import_smoke.py`)を消さない。UI モジュールを import しないテスト構成では、起動不能を全テスト緑のまま見逃す
- **Unity**: `OscSurface/` の C# は `corepack pnpm test` / `typecheck` の対象外。Unity Test Runner(EditMode)と CI(`.github/workflows/unity-ci.yml`)で検証する

### ログとメッセージ

- ブリッジの標準出力は `OSCDESK_BRIDGE_READY {JSON}` の 1 行で起動完了と実効設定を通知する。テストハーネスと起動スクリプトはこの行を待つ。同様に mock-unity も READY 行を出す
- 診断証跡は `logs/diagnostics/*.ndjson`(1 行 1 JSON)。ファイルは `oscdesk-*.ndjson`。容量上限は debug 時も無効化せず自動パージで守る
- 運用ログの接頭辞は `(WARN, BRIDGE)` / `(ERROR, BRIDGE)` のような発生源つきタグ

### Windows 固有の規約

- `.bat` は薄いランチャーに留め、**非 ASCII 文字を一切書かない**。cmd がコードページ依存で行を解釈するため日本語が壊れる
- 処理本体と日本語メッセージは `.ps1`(UTF-8 BOM 付き)に置く。この 2 点は `tests/guards/launcher-scripts.test.ts` が検査する
- `.gitignore` に Unity 用パターンが深さ無制限で効いているため、Node 側に `Library/` という名前のディレクトリを作らない

### 主要コマンド

```powershell
# 通常起動(ブリッジ + UI の 2 プロセス、閉じると両方停止)。直下の start-oscdesk.bat をダブルクリックでもよい。
# 起動前に依存・ビルド成果物・.venv を確かめ、足りなければ setup を自動で実行する(D-068)
.\launchers\start-oscdesk.ps1             # -CheckOnly: 確認だけ(揃っていれば 0、足りなければ 2) / -SkipSetup: 自動 setup をしない
# 用途別: launchers\start-oscdesk-debug.bat / launchers\start-oscdesk-touchosc.bat / launchers\start-oscdesk-verify.ps1

# セットアップだけを実行(依存導入・全ビルド・Python venv 作成を一括、再実行可)
.\launchers\setup-oscdesk.ps1             # または launchers\setup-oscdesk.bat をダブルクリック

# 型チェック(全パッケージ)
corepack pnpm typecheck

# テスト一式(ビルド → vitest(unit + e2e)→ pytest の単一入口。約 1 分。E2E は並列で約 35 秒。D-133)
corepack pnpm test

# 段階別(下記「何を変えたら何を回すか」)
corepack pnpm test:fast                    # ビルド + typecheck + unit + pytest(約 20 秒。一次ゲート checks.fast)
corepack pnpm test:unit [ファイル…]        # vitest の unit だけ
corepack pnpm test:py [pytest の引数…]     # ビルド + pytest(例: -k records)
corepack pnpm test:e2e [ファイル…]         # ビルド + E2E(例: tests/e2e/ws-protocol.e2e.test.ts)
corepack pnpm test:guards                  # tests/guards だけ
corepack pnpm test:changed [基準]          # 変わったファイルに関係する unit・ガードと、必要なら pytest(基準の既定は origin/main との分岐点。E2E は回さない。限界は下記)
```

テストの入口は `corepack pnpm test` ひとつに保つ。新しいテスト種別を足す場合も、この入口から到達できるようにする。`test:*` はその一部を切り出したもので、`test` に無いテストを足す場所ではない。

どの入口も `scripts/run-tests.mjs` を通り、画面には段ごとの 1 行と、最後に「通過 N 件、失敗 M 件」と失敗ごとのファイル:行・テスト名・メッセージの先頭数行だけを出す(1 件の失敗で 10 行程度)。全文は `logs/test-results/` に書く(vitest の json・pytest の junitxml・各段のログ。コミット対象外)。ツールの出力をそのまま流すとテスト 1 件ごとに 1 行が並び、エージェントが失敗の場所を探すだけで文脈を使い切るため(HID-438)。流したいときは `--verbose` を付けるか `OSCDESK_TEST_VERBOSE=1` にする。

`packages/nicegui-ui/tests/test_browser_*.py` は名前に browser を含むが、NiceGUI のユーザーシミュレーション(プロセス内)で動き、実ブラウザを起動しない(全体で約 2 秒)。そのため `test:fast` から外さない。pytest には実ブラウザ(Playwright)を使うテストが無い。

#### 何を変えたら何を回すか

迷ったら `test:fast`、PR を出す前は `corepack pnpm test`。

| 変えたもの | 回すもの | 理由 |
|---|---|---|
| `packages/shared`(スキーマ・wire 型)・`protocol/*.json` | `test:fast`。フレームの出入りを変えたら `test:e2e` の該当ファイル(`ws-protocol` など) | wire-samples を TS と Python の両方が読む(クロス言語契約)。ブリッジの成果物(`surface-view-tool.js`)にも同梱される |
| `packages/bridge/src/domain/`(純粋ロジック。`surface-core/`・`*-editor` など)と `packages/shared` の `surface-view` | `test:fast` | 単体テストで足りる。`surface-view` は pytest がビルド成果物を通して使う(D-124) |
| `packages/bridge/src/adapters/`・`app/`(I/O と配線。`udp-transport`・`ui-hub`・`bridge-server`・`main`・`cli`・`config` など) | `test:fast` + `test:e2e` の該当ファイル | 配線と実プロセスの振る舞いは E2E にしか出ない |
| `packages/osc-codec` | `test:fast` + `test:e2e tests/e2e/osc-client.e2e.test.ts tests/e2e/bridge-loopback.e2e.test.ts` | エンコードの差は実ソケット越しの往復で確かめる。pytest の `test_bridge_link.py` もブリッジと mock-unity(どちらも osc-codec を同梱)を起動する |
| `packages/mock-unity` | `test:fast` + `test:e2e` | E2E と pytest の `test_bridge_link.py` が mock-unity のビルド成果物を起動する |
| `packages/nicegui-ui` | `test:py`(仕上げに `test:fast`) | UI のテストは pytest だけ |
| `launchers/`・`.bat`・`.ps1`・文書・ファイルの追加や改名 | `test:guards` | 非 ASCII・旧名称などの規約はガードが `git ls-files` を走査して守る |
| `scripts/*.mjs` | `test:unit tests/scripts`。`run-python-tests.mjs`・`overlays.mjs` は `test:fast` | 補助スクリプトの単体テスト。後の 2 つは pytest の呼び方を決める(D-132) |
| `OscSurface/` の C# | Unity の EditMode テスト | `corepack pnpm test` の対象外 |

`test:changed` の選び方と限界: vitest の `--changed` は import の繋がりで関係するテストを選ぶので、fs で読むデータ(`protocol/*.json` など)・`git ls-files` を走査するガード・設定(`package.json`・`vitest.config.ts`・`oscdesk.overlays.json`)の変更は拾えない。そこで `packages/`・`tests/`・`scripts/` の下の TS/JS(と Python)以外のファイルが 1 つでも変わっていれば unit を全部回し、そうでなければ関係する unit とガード(ソースの文字列も検査する)を回す。pytest は `packages/`・`protocol/`・Python のファイル・pytest の呼び方を決めるスクリプトが変わったときだけ全部回す。E2E は回さないので、配線を変えたら `test:e2e` を別に回す。`test:changed` は絞り込みの補助で、一次ゲートは `test:fast`。

### 設計判断

設計判断の正典は **`DESIGN.md`**(`D-0xx` の連番で時系列に追記し、覆す場合も履歴を消さない)。いま有効な判断だけを領域ごとに並べた索引は **`docs/DECISIONS.md`** にある。この文書には要約を写さない(写すと同期が漏れる)。判断を足す・覆すときの約束は `DESIGN.md` の冒頭にあり、`tests/guards/design-decisions.test.ts` が検査する。

## リポジトリ構造

### 構成方針

**プロトコル中心の層構成を、pnpm ワークスペースのパッケージ境界で表現する。**

契約(型・スキーマ・定数)を最下層の `shared` に置き、その上に I/O を担う各パッケージを積む。UI だけは言語が違うため、コード共有ではなく文書化されたプロトコルで結合する。パッケージ内部は「機能ごとの 1 ファイル」で平坦に並べ、深い階層を作らない。例外は `bridge` で、`src/` を `domain/`・`adapters/`・`app/` の 3 層に分ける(D-134。下の「bridge の層」)。

### TypeScript パッケージ (`packages/<name>/`)

`src/` に実装と単体テストを平置き(`bridge` は層のディレクトリの中に置く)、`package.json` / `tsconfig.json` を各パッケージが持つ。実行可能な成果物があるパッケージだけが `dist/` を持つ。

| パッケージ | npm 名 | 役割 | 成果物 |
|---|---|---|---|
| `shared` | `@oscdesk/shared` | プロトコル定数・zod スキーマ・wire 型 | なし(`main: src/index.ts` で TS ソースを直接参照) |
| `osc-codec` | `@oscdesk/osc-codec` | OSC のエンコード/デコード(`osc` npm をここに閉じ込める) | なし(同上) |
| `bridge` | `@oscdesk/bridge` | OSC/UDP ↔ WebSocket の中継本体 | `dist/oscdesk-bridge.js` |
| `mock-unity` | `@oscdesk/mock-unity` | Unity 役の OSC レスポンダ | `dist/mock-unity.js` |

ビルド出力を持たないパッケージも `build` スクリプトを定義し(何もしない旨を出力するだけ)、`pnpm -r run build` が一様に通るようにする。

#### bridge の層(`packages/bridge/src/`。D-134)

| 場所 | 置くもの | 主なファイル |
|---|---|---|
| `domain/` | I/O を持たない規則と状態。外の世界には引数で受け取った関数かポート(インターフェース)を通してだけ触る | `surface-core/`(下記)・`desired-values`・`held-values`・`spawn-record`・`runtime-options`・`delivery-tracker`・`lock-manager`・`catalog-manager`・`blueprint-*`・`surface-editor`・`pad-editor`・`pad-manager`・`project-manager`・`destinations`・`device-aliases`・`lan-subnets`・`named-store`・`sent-log`・`ping-monitor`・`link-health`・`subnet-check`・`osc-ui-router`・`ipv4`・`ring-buffer` |
| `adapters/` | ソケット・ファイル・OS に触るもの。domain のポートを実装する | `udp-transport`・`ui-hub`・`target-adapter`・`surface-store`・`surface-manager`(HTTP の口を持つ)・`*-file`・`json-file`・`ndjson-writer`・`ndjson-quota`・`diagnostics-engine`・`lan-scan`・`hostname-lookup`・`network-settings` |
| `app/` | 起動と配線 | `cli`・`config`・`main`・`bridge-server` |
| `src/` 直下 | バンドルの入口だけ | `index.ts`(→ `dist/oscdesk-bridge.js`)・`surface-view-tool.ts`(→ `dist/surface-view-tool.js`) |

- 依存の向きは app → adapters → domain(app は domain も直接使う)。`domain` は adapters・app・入口を import せず、外部のモジュールは許可リスト(`node:path`・`node:crypto`・`zod`・`@oscdesk/*`)のものだけを使い、`process.`・`fetch(` も書かない。`adapters` は app と入口を import しない。`tests/guards/bridge-layers.test.ts` が検査する(テストファイルは対象外)
- 保存先・走査器・名前解決のポート(`DestinationSelectionStore` `DeviceAliasStore` `HostnameResolver` `LanProber` `NamedJsonStore` `PadActiveStore`)は使う側の domain に置き、adapters が実装する。fs を引数で受け取るファイルの読み書きも、ファイルの形式・置き場所を知っているので adapters に置く
- どちらの層か迷うファイルは中身で決める: 純粋な部分と I/O の部分が混ざったら、関数を分けて両方の層に置く(例: `domain/lan-subnets` と `adapters/lan-scan`)
- `domain/surface-core/` は責務ごとのファイルに分けてある: `index`(`createSurfaceCore` と公開の型)・`context`(状態を集めた文脈 `Core` と定数)・`types`・`targets`(宛先・死活監視・link)・`outbound`(送信・まとめ送り・パッド)・`vocabulary`(パラメータ id と OSC の相互の直し・ロックの単位)・`desired`(保持値と再送・保存)・`records`(一覧とレコードの行)・`spawns`(生成の記録)・`adoption`(定義の採用)・`inbound`(OSC の受信)・`ui-frames`(上りのフレーム)・`osc-args`(値と引数の変換)。各ファイルは文脈を受け取って自分の関数を返し、ほかのファイルの関数は `core.x()` で引く

### Python パッケージ (`packages/nicegui-ui/`)

`src/oscdesk_ui/`(src レイアウト)+ `tests/` + `pyproject.toml`。仮想環境は `.venv/` をパッケージ内に置く。

モジュールは責務ごとに分ける: `config`(設定)/ `protocol`(フレームのエンコード・デコード。サブパッケージで、`common`(版・引数・検証の部品)・`frames`(入口の `decode_frame`)とフレームの種類ごとの `connection` / `surface` / `values` / `runtime_options` / `destinations` / `network` / `locks` / `osc` / `pad` / `project` / `catalog` / `delivery` に分ける。`__init__` が公開名を再輸出する。HID-440)/ `surface_link`(WebSocket 接続)/ `state`(プロセス内の唯一の状態。サブパッケージで、状態の全属性とフレームの振り分けは `core` の `SurfaceState` 1 つが持ち、領域ごとの振る舞いを mixin の `surface` / `values` / `records` / `actions` / `requests` / `network` / `locks` / `catalog` に、値オブジェクトを `models`、エコーの照合を `echo_match` に分ける。HID-440)/ `value_store`(値と送信レート。操作中の保護・送信の間引き・下書きは操作の手触りに関わるので UI に置く。D-124)/ `surface_definition`(定義の本体と結び付けの出し入れ。定義の判定はブリッジ。D-122)/ `surface_model`(ブリッジが配る部品の木(`surface.view`)を描くための型へ読み込む。部品の決め方はブリッジの `surface-view.ts`。D-124)/ `layout`(画面層の配置)/ `surface_editor`(編集モードの作業コピーと編集命令の列。編集の規則はブリッジの `surface-editor.ts`。D-123)/ `editor_panel`(編集モードの画面)/ `sent_log`(送信ログの表示キャッシュ)/ `notify_history`(通知とその履歴。`ui.notify` は必ずここを通す)/ `log_drawer`(送信ログと通知履歴のドロワー)/ `osc_pad`(OSC パッドの作業コピーと編集命令の列・表示キャッシュ。編集の規則と検証はブリッジの `pad-editor.ts`。D-126)/ `osc_pad_panel`(OSC パッドのタブ)/ `destinations_panel`(右側の宛先パネル。送り先の選択と LAN 走査の表示)/ `delivery_lights`(送り先ブロックの点灯の表示キャッシュ。D-116)/ `pending_options`(「新しい一覧があります」。届いたが反映していない Unity の一覧の表示と反映の要求)/ `project_file`(プロジェクトファイルの受け口(JSON のオブジェクトとして読む)とダウンロード用の整形の純粋関数。取り込めるかの判定と要約はブリッジ。D-122)/ `blueprint_panel`(設計図のタブ。PC ごとの一覧・取り直し・設計図から画面を作る。HID-386)/ `project_panel`(プロジェクトの書き出し・読み込みと「まだ Unity へ送っていない」の帯)/ `network_access`(接続してよいブラウザの判定の純粋関数と UI の HTTP の ASGI ミドルウェア。D-113)/ `network_panel`(ネットワークのタブ)/ `entry_rules`・`address_pattern`(入力検証とアドレスパターン)/ `widgets`(ウィジェット生成)/ `page`(NiceGUI ページ)/ `__main__`(エントリポイント)。

### データと契約

| 場所 | 内容 |
|---|---|
| `config/oscdesk*.config.json` | 実行時設定。`unity` / `bridge` / `ui` の 3 ブロック + フラグ。用途別に通常 / debug / touchosc |
| `protocol/wire-samples.json` | WebSocket フレームの正規サンプル。TS と Python の双方がテストで読む言語間の契約 |
| `protocol/osc-pad-samples.json` | OSC パッド(D-080)の受理 / 拒否の見本。判定の正はブリッジ(`packages/shared/src/osc-pad.ts`)だけで、TS の `osc-pad.test.ts` が読む(UI は判定の写しを持たない。D-126) |
| `protocol/surface-definition.schema.json` / `surface-definition-samples.json` | サーフェス定義(版 2。D-117)の JSON Schema と見本。判定は TS(ブリッジ)だけが行い、Python はテストの定義の構造の検査にだけスキーマを使う(D-122・D-123)。正典は `packages/shared/src/surface-definition.ts`、OSC に解決した形は `osc-definition.ts`、版 1 からの移行は `surface-migration.ts` |
| `surfaces/*.json` | 実行時に保存されるサーフェス定義(本体 + `bindings.osc`。保管先は設定の `surfaces.dir`。版 1 のファイルは読み込み時に版 2 で書き直す) |
| `surfaces/.values/*.values.json` | 定義名ごとの保持値と生成の記録(D-115)。ブリッジ再起動をまたいで復元する(保存先は設定の `surfaces.valuesDir`、D-058。コミット対象外) |
| `*.oscdesk-project.json` | プロジェクトファイル(D-090)。利用者がブラウザでダウンロードして手元に保管するもので、ブリッジのフォルダには置かない。形式の正典は `packages/shared/src/project-file.ts` |
| `docs/*.md` | 契約と手順の正典(`BRIDGE_PROTOCOL` / `UNITY_PROTOCOL` / `VERIFICATION` ほか) |
| `logs/diagnostics/*.ndjson` | 実行時の診断証跡(コミット対象外) |

### テスト (`tests/`)

- `tests/e2e/*.e2e.test.ts` — 実プロセスを起動する E2E
- `tests/e2e/helpers/` — プロセスハーネス、ポート確保、bridge/mock 起動、WebSocket/OSC クライアント。**E2E から実行の詳細をここへ追い出す**
- `tests/guards/*.test.ts` — リポジトリ全体の規約を機械的に守るテスト

### ルート直下

ランチャーは通常起動の `start-oscdesk.bat` だけを置く。これは薄い bat で、処理本体は `launchers/start-oscdesk.ps1`。`launchers/` には用途別ランチャー(`start-oscdesk-debug` / `-touchosc` / `-verify`)と setup を、bat(薄い入口)と ps1(処理本体)の対で置き、`launchers/lib/` に共通部品(`oscdesk-launcher.ps1`: リポジトリ root の解決・環境の確認と自動 setup・プロセス操作の補助、`launcher-guard.ps1`: Job Object と孤立プロセスの回収)を置く。フォークの自前ランチャーは `oscdesk-launcher.ps1` を dot-source するか、`launchers/start-oscdesk.ps1 -ConfigPath` を呼んで再利用する。`scripts/` は Node から呼ぶ補助スクリプト(`.mjs`)。`OscSurface/` は同居する Unity プロジェクトで、Node 側の構造とは独立に扱う。受け口は `OscSurface/Packages/com.hidano.oscdesk/` の埋め込みパッケージ(`Runtime/Core/` = 純粋 C# の `OscDesk.Receiver`、`Runtime/` = MonoBehaviour の `OscDesk.Receiver.Runtime`、`Editor/` = `OscDesk.Receiver.Editor`、`Tests/Editor/` = `OscDesk.Receiver.Tests`)で、`OscSurface` はそれを `testables` で検証するプロジェクトである(D-096)。

### 命名規約

- **ファイル**: TypeScript は kebab-case(`bridge-server.ts`, `ndjson-writer.ts`)。Python は snake_case(`surface_link.py`)
- **単体テスト**: 対象と同名 + `.test.ts`(TS)/ `test_<対象>.py`(Python)。E2E は `*.e2e.test.ts`
- **TypeScript の識別子**: 型・インターフェースは PascalCase、関数・変数は camelCase、定数は SCREAMING_SNAKE_CASE
- **zod スキーマ**: `XxxSchema`(例: `SurfaceDefinitionSchema`, `WireArgSchema`)。対応する型は同名から `z.infer` で導出する
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

- **パスエイリアスは使わない**。ワークスペース参照は `workspace:*` 依存 + パッケージ名で行う。例外はワークスペースのパッケージでないリポジトリ直下のテスト(`tests/` とフォークのオーバーレイの `tests/`)で、依存を宣言する `package.json` を持たないので、`shared` は相対パス(`'../../packages/shared/src'`)で読む
- 型だけを使う import は `import type` にする

### 依存の向き(逆流させない)

```
shared  ←  osc-codec  ←  bridge / mock-unity
  ↑
  └─ (コード依存なし) ─  nicegui-ui  … docs/BRIDGE_PROTOCOL.md + protocol/wire-samples.json で結合
```

- `shared` は `zod` 以外に依存しない。OSC ライブラリの型や実装をここへ持ち込まない
- `nicegui-ui` から TypeScript パッケージへの依存を作らない(例外は UI のテストが部品の木をブリッジと同じ規則で得るために使う `packages/bridge/dist/surface-view-tool.js` だけ。本体は依存しない。D-124)。プロトコルを変えるときは「スキーマ → wire-samples → 文書 → 両言語の実装」の順で揃える
- mock 専用の振る舞い(故障注入など)は `mock-unity` の内側に閉じ、`shared` へ出さない

### bridge 内部の組み立て

`app/` の `cli`(引数解析)→ `config`(設定の読み込みと検証)→ `main`(起動と終了コード)→ `bridge-server`(配線)という一方向。`bridge-server` は各コンポーネント(adapters の `udp-transport` / `ui-hub` / `surface-manager` / `diagnostics-engine` / `network-settings` と各ファイルの保存先、domain の `surface-core`(生成の記録の純粋ロジックは `spawn-record`) / `pad-manager`(編集の規則は `pad-editor`) / `project-manager` / `sent-log` / `destinations`)を生成してコールバックで結びつけるだけで、ロジックを持たない。

### 純粋ロジックと I/O の分離

`domain/` のロジック層は、送信関数・配信関数・保存先・時計・ネットワーク情報プロバイダを **引数で受け取る**。ソケットやファイルを直接掴まない。この線引きをディレクトリで表し、ガードテストで守る(D-134。上の「bridge の層」)。これにより単体テストがプロセス起動なしで書け、E2E は配線と実プロセスの検証に集中できる。

### コメント

コメントは日本語で **「なぜそうしたか」と「そうしないと何が壊れるか」** を書く。API の説明の繰り返しは書かない。判断の背景が長くなる場合は `DESIGN.md` の `D-0xx` へ記録し、コードからはその番号を参照する。

## フォークの置き場所

フォークは固有のファイル(テスト・サーフェス定義・config・ランチャーなど)を、機構と別のディレクトリ 1 つ(例: `vp/`。以下「オーバーレイ」)に集める。機構のファイルを書き換えずに、オーバーレイのテストを `corepack pnpm test` から走らせられる(D-132)。

- **一覧ファイル**: リポジトリ直下に `oscdesk.overlays.json` を置き、`{ "overlays": ["vp"] }` のようにオーバーレイを書く(リポジトリ直下からの相対パス。`..`・絶対パス・機構のディレクトリ(`packages` `tests` `scripts` `launchers` `protocol` `config` `docs` `surfaces` `OscSurface` など。大文字小文字の違いも同じとみなす)は書けない)。ファイルが無ければオーバーレイは無い。書いたディレクトリが無いとテストの起動が失敗する(打ち間違いでフォークのテストが黙って消えないように。`scripts/run-python-tests.mjs` も仮想環境の有無より先に一覧を検査し、誤りがあれば 0 以外で終わる)。解決は `scripts/overlays.mjs` の 1 か所で、`vitest.config.ts`・`scripts/run-python-tests.mjs`・ガードテストが同じ答えを使う。環境変数 `OSCDESK_OVERLAYS`(カンマ区切り。空ならオーバーレイなし)は一覧ファイルの代わりになる(仕組み自体のテスト用)
- **テストの置き場所**: テストはオーバーレイの `tests/` の下に置く
  - `<overlay>/tests/**/*.test.ts` は vitest の `unit`、`<overlay>/tests/**/*.e2e.test.ts` は `e2e`(機構の E2E と並列・タイムアウト 120 秒)で走る。cwd はリポジトリ直下。ポートは `reserveTcpPort` / `reserveUdpPort` で取り、既定のポートや固定の番号を使わない(D-133)
  - E2E の補助は入口 `tests/e2e/helpers/index.ts` から import する(例: `vp/tests/foo.e2e.test.ts` から `import { startStack, frameWithin } from '../../tests/e2e/helpers'`)。補助の個々のファイルを直接指さない(分け直しで壊れる)。共有の型・スキーマは `'../../packages/shared/src'` から相対パスで読む(オーバーレイはワークスペースのパッケージでないので、パッケージ名の規則の例外。上記「import の並び」)
  - Python のテスト(`test_*.py` または `*_test.py`)を `<overlay>/tests/` に置くと、`scripts/run-python-tests.mjs` が UI のテストと同じ pytest の実行に渡す(設定は `packages/nicegui-ui/pyproject.toml`、rootdir はリポジトリ直下)。UI のテストの補助は `from tests.surface_fixtures import definition, model_of` のようにパッケージ `tests` から import する(相対 import の `.surface_fixtures` は使えない)。fixture(`run_task`、nicegui の `user`)は `packages/nicegui-ui/tests/oscdesk_plugin.py` をプラグインとして読むので、オーバーレイのテストからもそのまま使える
  - オーバーレイの `tests/` に `__init__.py` を置かない(UI のテストのパッケージ `tests` と名前がぶつかる。置くと起動が失敗する)。UI のテストとはファイル名が同じでもぶつからない(UI のテストはパッケージ `tests` の中にある)。ぶつかるのは、オーバーレイ同士、または 1 つのオーバーレイの中のサブフォルダ同士で同じファイル名を使ったとき(pytest が import file mismatch で止まる)なので、フォークの接頭辞を付けて重ならないようにする(例: `test_vp_concert_surface.py`)
- **ガードテスト**: `tests/guards/` は `git ls-files` で追跡中のファイル全体を走査するので、オーバーレイの `.bat`・`.ps1`・旧名称も検査の対象になる。`tests/guards/test-roots.test.ts` は、追跡中の `*.test.ts` と `test_*.py`・`*_test.py`(pytest の既定で集める 2 つの形)がどれも `pnpm test` のどこかの段で走ることを確かめる(オーバーレイを一覧ファイルに書き忘れると落ちる)
- **見本**: `tests/fixtures/overlay-sample/` は仕組み自体のテスト(`tests/scripts/overlays.test.ts`)が `OSCDESK_OVERLAYS` で指して走らせる見本で、通常の `pnpm test` では直接は走らない
