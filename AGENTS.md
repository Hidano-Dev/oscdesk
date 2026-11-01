# oscdesk 開発ガイド

プロジェクトの規約・構造・設計方針は `CLAUDE.md` と `docs/DEVELOPMENT.md` にあります。あわせて従ってください。作業は Linear の Issue(Hidano チーム / oscdesk プロジェクト)で管理します。

## プロジェクト文書

- `AGENTS.md` は対象ディレクトリ固有の前提・契約・テスト規約を記録します。
- 設計判断は `DESIGN.md` に `D-0xx` で追記します。
- Markdown のプロジェクト文書は、日本語で UTF-8 として編集します。

## 構成

- `packages/bridge` — Node.js ブリッジ。OSC と WebSocket の境界を担当
- `packages/nicegui-ui` — NiceGUI(Python) UI。モジュール名は `oscdesk_ui`
- `packages/shared` — 共有プロトコル型・zod スキーマ・定数
- `packages/osc-codec` — OSC エンコード・デコード
- `packages/mock-unity` — Unity モック
- `config/` — 実行時設定、`protocol/` — プロトコル資料
- `tests/` — 共通テスト、`scripts/run-python-tests.mjs` — pytest の入口
- `OscSurface/` — Unity プロジェクト(汎用の受け口 UPM パッケージ `Packages/com.hidano.oscdesk/`(`Runtime/Core/` `Runtime/` `Editor/` `Tests/Editor/`))

## 絶対規律

1. ブリッジと UI の責務を分離する。Unity との OSC 通信はブリッジに集約し、UI は WebSocket プロトコルを利用する。
2. 案件差分はコードではなく設定・サーフェス定義(パラメータ・配置・アクション)のデータで表現する。
3. 定義と値の正は OscDesk(サーバー)が持つ。UI の設計図はターゲット(Unity)から Sync で受け取り、PC ごとに取得元付きで保持する(ターゲットとの紐づけは切り離す)。狙いの値はサーバー(ブリッジ)が保持し、再起動・再接続時に再送する(`trigger` は再送しない。例外として、生成担当の命令で生成されてまだ消されていないものの一覧はサーバーが PC ごとに持つ状態として扱い、ターゲットの起動の合図と「記録に合わせる」で送り直す。D-115)。エコーは届いた確認であり保持値を書き換えない。UI は表示キャッシュ。Sync で送るデータの形と、設計図とサーフェス定義の関係は未決で、Sync は未実装(現行の操作対象は OscDesk 側のサーフェス定義。DESIGN.md D-101)。

本リポジトリの対象は OSC の送受信とブラウザ UI、および Unity 側の汎用の受け口(`OscSurface/Packages/com.hidano.oscdesk/`)です。Unity のシステム構成の切り替えなど案件固有の制御はフォーク側で実装します。

## セットアップと起動

```powershell
.\launchers\setup-oscdesk.ps1
corepack pnpm install
corepack pnpm -r run build
```

通常起動はリポジトリ直下の `start-oscdesk.bat` または `.\launchers\start-oscdesk.ps1`、デバッグ起動は `launchers\start-oscdesk-debug.bat`、OSC ネイティブ UI 評価は `launchers\start-oscdesk-touchosc.bat` です。通常起動ではブリッジと NiceGUI UI の接続先 URL が表示され、終了時に両プロセスが停止します。ランチャーは起動前に依存・ビルド成果物・`.venv` を確かめ、足りなければ setup を自動で実行します(`-CheckOnly` で確認だけ。D-068)。用途別ランチャー・setup・共通部品(`launchers/lib/oscdesk-launcher.ps1`)は `launchers/` に置き、直下には `start-oscdesk.bat` だけを置きます。

このシステムは無認証で、信頼できる LAN 内での利用を前提とします。外部ネットワークへ公開しないでください。

## テスト

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm exec vitest run --config vitest.config.ts --project unit
```

変更後は対象テストに加えて、可能なら `corepack pnpm test` を実行します。手動検証は `docs/VERIFICATION.md`、Unity との契約は `docs/UNITY_PROTOCOL.md`、UI との契約は `docs/BRIDGE_PROTOCOL.md` と `protocol/` を参照します。`OscSurface/` の C# は `corepack pnpm test` の対象外なので、変更したら Unity の EditMode テストを実行します。

## Review guidelines

PR をレビューするときの指示です(Codex などのレビューボット向け)。

- **1 回で網羅的に**: 依頼された時点の PR 全体(差分と、差分が触れる既存コードとの相互作用)を見て、懸念箇所を重大度を問わずその 1 回ですべて列挙してください。後続の push で、同じ範囲の懸念を小分けに出さないでください。
- **重大度**: P0・P1 は、通常の運用で起きる実害(データの消失・上書き、接続断・起動不能、誤った宛先・内容の送信、保持値の破壊、セキュリティ上の抜け道)に付けてください。P2 は、再現手順を書ける具体的な実害があるものに限ってください。仮定の積み重ねでしか起きないもの・好みの問題・スコープ外の改善は、出すなら P3 以下にしてください。
- **前提**: 本システムは認証を提供せず、信頼できる LAN 内での利用が前提です。この前提の上で起きる問題を評価してください(前提そのものへの指摘は不要です)。
- **重複を避ける**: 返信で修正済み・対応しないと理由を書いたスレッドと同じ論点は、新しい根拠が無い限り再提起しないでください。

## 判断を止めて報告するとき

実装前にブリッジ/UI 境界や Unity の契約を変更する必要がある場合は、判断を止めて報告します。
