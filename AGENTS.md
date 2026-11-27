# oscdesk 開発ガイド

プロジェクトの規約・構造・設計方針は `CLAUDE.md` と `docs/DEVELOPMENT.md` にあります。あわせて従ってください。作業は Linear の Issue(Hidano チーム / oscdesk プロジェクト)で管理します。

## プロジェクト文書

- `AGENTS.md` は対象ディレクトリ固有の前提・契約・テスト規約を記録します。
- いま有効な設計判断は `docs/DECISIONS.md` にあります。設計判断は `DESIGN.md` に `D-0xx` で追記し、`docs/DECISIONS.md` を書き換えます(覆した項目の見出しには印を付けます)。
- Markdown のプロジェクト文書は、日本語で UTF-8 として編集します。

## 構成

- `packages/bridge` — Node.js ブリッジ。OSC と WebSocket の境界を担当。`src/` は `domain/`・`adapters/`・`app/` の 3 層(D-134)
- `packages/web-ui` — ブリッジが HTTP の `/` で配る TypeScript の SPA(Preact)。UI はこれだけ(D-137・D-162)
- `packages/shared` — 共有プロトコル型・zod スキーマ・定数
- `packages/osc-codec` — OSC エンコード・デコード
- `packages/mock-unity` — Unity モック
- `config/` — 実行時設定、`protocol/` — プロトコル資料
- `tests/` — 共通テスト、`scripts/run-tests.mjs` — テストの入口(Node だけで動く)

Unity 側の汎用の受け口(UPM パッケージ `com.hidano.oscdesk`)と、それを検証する Unity プロジェクトは別リポジトリ [Hidano-Dev/oscdesk-unity](https://github.com/Hidano-Dev/oscdesk-unity) にあります(D-136)。

## 絶対規律

1. ブリッジと UI の責務を分離する。Unity との OSC 通信はブリッジに集約し、UI は WebSocket プロトコルを利用する。
2. 案件差分はコードではなく設定・サーフェス定義(パラメータ・配置・アクション)のデータで表現する。
3. 定義と値の正は OscDesk(サーバー)が持つ。UI の設計図はターゲット(Unity)から Sync で受け取り、PC ごとに取得元付きで保持する(ターゲットとの紐づけは切り離す)。狙いの値はサーバー(ブリッジ)が保持し、再起動・再接続時に再送する(`trigger` は再送しない。例外として、生成担当の命令で生成されてまだ消されていないものの一覧はサーバーが PC ごとに持つ状態として扱い、ターゲットの起動の合図と「記録に合わせる」で送り直す。D-115)。エコーは届いた確認であり保持値を書き換えない。UI は表示キャッシュ。Sync・既定の画面・生成の記録など、この規律に関わる現行の判断は `docs/DECISIONS.md` を見てください。

本リポジトリの対象は OSC の送受信とブラウザ UI です。Unity 側の汎用の受け口は別リポジトリ `Hidano-Dev/oscdesk-unity` で開発します(契約 `docs/UNITY_PROTOCOL.md` と言語間の見本 `protocol/` の正は本リポジトリ)。Unity のシステム構成の切り替えなど案件固有の制御はフォーク側で実装します。

## セットアップと起動

```powershell
.\launchers\setup-oscdesk.ps1
corepack pnpm install
corepack pnpm -r run build
```

通常起動はリポジトリ直下の `start-oscdesk.bat` または `.\launchers\start-oscdesk.ps1`、デバッグ起動は `launchers\start-oscdesk-debug.bat`、OSC ネイティブ UI 評価は `launchers\start-oscdesk-touchosc.bat` です。通常起動ではブリッジ 1 プロセスだけが起動し、ブリッジが配る UI(SPA)の接続先 URL(`http://<この PC の IP>:7080/`)が表示され、終了時にブリッジが停止します。ランチャーは起動前に依存・ビルド成果物を確かめ(Python は要りません。D-162)、足りなければ setup を自動で実行します(`-CheckOnly` で確認だけ。D-068)。用途別ランチャー・setup・共通部品(`launchers/lib/oscdesk-launcher.ps1`)は `launchers/` に置き、直下には `start-oscdesk.bat` だけを置きます。

このシステムは無認証で、信頼できる LAN 内での利用を前提とします。外部ネットワークへ公開しないでください。

## テスト

```powershell
corepack pnpm test:fast      # ビルド + typecheck + unit(約 20 秒)
corepack pnpm test           # 全部(E2E を含む。約 1 分)
```

修正のたびの確認は `corepack pnpm test:fast`(または `test:changed`。E2E は回さず、データや設定の変更では unit を全部回す絞り込みの補助です)、PR を出す前は `corepack pnpm test` を実行します。変更の種類ごとに回すもの(`test:unit` / `test:e2e` / `test:guards`)は `docs/DEVELOPMENT.md` の「何を変えたら何を回すか」の表に従います。どの入口も最後に失敗だけの要約を出し、全文は `logs/test-results/` に書きます。手動検証は `docs/VERIFICATION.md`、Unity との契約は `docs/UNITY_PROTOCOL.md`、UI との契約は `docs/BRIDGE_PROTOCOL.md` と `protocol/` を参照します。Unity 側の見本の写しを持つ `protocol/osc-binary-samples.json`・`protocol/catalog-samples.json` を変えたら、`oscdesk-unity` の同期手順(その README)で写しを更新します。

## Review guidelines

PR をレビューするときの指示です(Codex などのレビューボット向け)。

- **1 回で網羅的に**: 依頼された時点の PR 全体(差分と、差分が触れる既存コードとの相互作用)を見て、懸念箇所を重大度を問わずその 1 回ですべて列挙してください。後続の push で、同じ範囲の懸念を小分けに出さないでください。
- **重大度**: P0・P1 は、通常の運用で起きる実害(データの消失・上書き、接続断・起動不能、誤った宛先・内容の送信、保持値の破壊、セキュリティ上の抜け道)に付けてください。P2 は、再現手順を書ける具体的な実害があるものに限ってください。仮定の積み重ねでしか起きないもの・好みの問題・スコープ外の改善は、出すなら P3 以下にしてください。
- **前提**: 本システムは認証を提供せず、信頼できる LAN 内での利用が前提です。この前提の上で起きる問題を評価してください(前提そのものへの指摘は不要です)。
- **重複を避ける**: 返信で修正済み・対応しないと理由を書いたスレッドと同じ論点は、新しい根拠が無い限り再提起しないでください。

## 判断を止めて報告するとき

実装前にブリッジ/UI 境界や Unity の契約を変更する必要がある場合は、判断を止めて報告します。
