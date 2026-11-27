# OSCDesk — Unity向けOSCコントロールサーフェス

初回指示の原文: `claude-code-initial-prompt.md`。いま有効な設計判断: `docs/DECISIONS.md`(経緯の記録は `DESIGN.md`)。開発標準とリポジトリ構造: `docs/DEVELOPMENT.md`。

## 概要

Unity アプリ(将来的には任意の OSC 受信アプリ)を LAN 内のブラウザ/スマホから操作する OSC コントロールサーフェスを作る。本質は「ブラウザ UI とやり取りする OSC アドレスの一元管理」で、操作対象(アドレス・型・配置)は OscDesk 側のサーフェス定義 JSON に書き、ブラウザで読み込み・編集・保存する。ブリッジサーバーが Unity との OSC 通信と UI との WebSocket 通信を仲介し、ブリッジが配る SPA(ブラウザで動く TypeScript の UI)が表示と操作を担当する。動かすプロセスはブリッジ 1 つ(D-162)。

## 対象範囲と境界

- **開発対象**: ブリッジ、SPA(`packages/web-ui`)、共有プロトコル(型・スキーマ・定数)、サーフェス定義の形式、OSC コーデック、mock-unity、テストハーネス
- **開発対象外**: Unity アプリ本体。Unity のシステム構成の切り替えなど案件固有の制御はフォーク側で実装し、本リポジトリは OSC の送受信とブラウザ UI に絞る。Unity 側の汎用の受け口(UPM パッケージ `com.hidano.oscdesk`。受信アドレス → UnityEvent と、定義 JSON からの行の取り込み)は別リポジトリ `Hidano-Dev/oscdesk-unity` で開発する(D-136。下の「Unity の受け口」)
- **セキュリティ前提**: 本システムは認証を提供しない。信頼できる LAN 内での利用が前提であり、インターネットや信頼できないネットワークへ公開してはならない。この前提は README・AGENTS・プロトコル文書・手動検証手順のすべてで繰り返し明示する

## 絶対規律

- **ブリッジサーバーと UI の責務を分離する**。Unity との OSC 通信はブリッジに集約し、UI はブリッジの WebSocket プロトコルを利用する。要件がこの境界を越える場合は、実装前にユーザーへ報告して判断を仰ぐ
- **案件差分はコードでなくデータ**(config / サーフェス定義のパラメータ・配置・アクション)で表現する
- **定義と値の正は OscDesk(サーバー)が持つ**。UI の設計図はターゲット(Unity)から Sync で受け取り、PC ごとに取得元付きで保持する(ターゲットとの紐づけは切り離す)。狙いの値はサーバー(ブリッジ)が保持する。エコーは「届いた」確認であり保持値を書き換えない。UI は表示キャッシュ。この規律に関わる現行の判断(Sync・既定の画面・生成の記録など)は `docs/DECISIONS.md` を見る
- **再送は選べる(HID-483 で移行中。D-165)**。自動の再送はトグルで選べ、既定は OFF。ON のときはターゲットの起動(起動 ID の変化。D-164)で送り直す。値を持つ部品ごとに送り直さない設定ができ、任意の PC へ手動で同期できる。きっかけ系の `trigger` は再送しない。生成物の作り直しは oscdesk の責務ではなく、受信側(フォーク)が同期を受けて行う(D-166)。移行が済むまでは、いまの実装(再起動・再接続時の自動の再送と生成の記録)が動く
- **画面を作る仕組みは OSC パッド 1 つ、ターゲットとの連携は OSCQuery に移す(HID-483 で移行中。D-163・D-164)**。新しく足す機能は、撤去する予定のサーフェス定義・編集モード・設計図・LAN の走査の上に積まない
- **特定 Unity OSC ライブラリに依存しない**。OSC 1.0 標準の機能のみで Unity との契約を成立させ、迷う点は `docs/UNITY_PROTOCOL.md` に互換性ノートとして記録
- 各 Phase 完了時、`docs/VERIFICATION.md` に手動検証手順を追記し、自動テストを緑にしてから次へ進む

## 作業の進め方

- 作業の起点は Linear の Issue(Hidano チーム / oscdesk プロジェクト)。先送りする作業は Issue として登録する
- 設計判断は `DESIGN.md` に `D-0xx` で追記し、`docs/DECISIONS.md` を書き換える。前の判断を覆したら、その見出しに `(→ D-xxx で覆した)` / `(一部 → D-xxx)` の印を足す(`tests/guards/decisions.test.ts`)。プロジェクトの Markdown 文書は日本語・UTF-8 で書く
- ユーザーの指示に正確に従い、その範囲では自律的に動く。必要な文脈を集めて依頼された作業を最後までやり切り、質問は必須情報が欠けているか指示が決定的に曖昧なときに限る

## リポジトリ構成

- `packages/bridge` — Node.js のブリッジサーバー。Unity との OSC 通信と UI との WebSocket 通信を担当し、`dist/oscdesk-bridge.js` を生成する。`src/` は `domain/`(I/O を持たない規則と状態)・`adapters/`(ソケット・ファイル・OS)・`app/`(起動と配線)の 3 層で、依存は app → adapters → domain の向きだけ(D-134。`tests/guards/bridge-layers.test.ts` が守る)
- `packages/web-ui` — ブリッジが HTTP の `/` で配る TypeScript の SPA(Preact。D-137・D-138)。UI はこれだけで、1 つの画面の枠(タブ)にまとめてある(D-156)。NiceGUI(Python)版は撤去した(D-162)
- `packages/shared` — プロトコル型・zod スキーマ・定数(TS ソースを直接参照、ビルド出力なし)
- `packages/osc-codec` — OSC のエンコード・デコード処理
- `packages/mock-unity` — Unity モック OSC レスポンダ(テスト・開発用)
- `config/` — 実行時設定(宛先・ポート・デバッグフラグ)
- `protocol/` — 共有プロトコルの資料・サンプル
- `tests/` — リポジトリ共通テスト
- `scripts/run-tests.mjs` — テストの入口(`corepack pnpm test` と `test:*`)。Node だけで動く
- `launchers/` — 用途別ランチャー(debug / touchosc / verify)・setup・ランチャーの共通部品(`launchers/lib/`)。直下の `start-oscdesk.bat` はここの `start-oscdesk.ps1` を呼ぶ

## 開発コマンド

### 初回セットアップ(新しい PC にクローンした直後)

手で setup を実行する必要はない。起動ランチャー(`start-oscdesk.bat` と `launchers/` の各ランチャー)が起動前に依存(`node_modules/.pnpm/lock.yaml` と `pnpm-lock.yaml` の一致)・ビルド成果物(ブリッジ・mock-unity・SPA がソースより新しいか)を確かめ、足りなければ setup を自動で実行する(D-068)。Python は要らない(D-162)。setup だけを実行するときは `launchers\setup-oscdesk.bat`(または `.\launchers\setup-oscdesk.ps1`)。ワークスペース依存の導入と全パッケージのビルドを一括で行う。冪等なので何度実行してもよい。

### 個別コマンド

pnpm は corepack 経由(グローバルインストール不要)。

```powershell
# ワークスペース依存のインストール
corepack pnpm install

# 全パッケージのビルド
corepack pnpm -r run build

# 型チェック
corepack pnpm typecheck

# テスト一式(単一の入口)
corepack pnpm test
```

## 起動方法

通常起動はリポジトリ直下の `start-oscdesk.bat` をダブルクリックする(または `.\launchers\start-oscdesk.ps1` を実行する)。このランチャーはブリッジ(Node.js)1 プロセスだけを起動し、ブリッジが配る UI(SPA)の接続先 URL(`http://<この PC の LAN の IP>:7080/` と `http://localhost:7080/`)を表示する。既定の Unity 向けポートは送信 7090 / 受信 7091、ブリッジ WebSocket と SPA の HTTP は 7080 である(UI の 8080 は D-162 で無くなった)。ウィンドウを閉じるとブリッジを停止する(子プロセスは `launchers/lib/launcher-guard.ps1` の Job Object で親と道連れになり、× で閉じても残らない。起動時には前回の孤立プロセスを回収する)。

デバッグ起動は `launchers\start-oscdesk-debug.bat`、OSC ネイティブ UI 評価は `launchers\start-oscdesk-touchosc.bat`、手動検証は `launchers\start-oscdesk-verify.ps1` を使う。評価用ランチャーは mock-unity とブリッジを起動し、接続先 IP と受信ポートを表示する。どのランチャーも `-CheckOnly` で環境の確認だけを行う(起動も setup もしない。揃っていれば 0、足りなければ 2)。

リポジトリ直下には `start-oscdesk.bat` だけを置き、用途別ランチャー・setup・共通部品(`launchers/lib/oscdesk-launcher.ps1`。フォークの自前ランチャーもこれを dot-source して再利用する)は `launchers/` に置く。`.bat` は薄いランチャーに留め、処理本体と日本語メッセージは `.ps1`(UTF-8 BOM 付き)に置く。`.bat` に非 ASCII を入れると cmd のコードページ依存で壊れるため(`tests/guards/launcher-scripts.test.ts` が検査する)。

## 実装上の前提

- Unity との契約は `docs/UNITY_PROTOCOL.md`(`/sys/ping`・`/sys/pong` と同一アドレスへのエコー)、UI との契約は `docs/BRIDGE_PROTOCOL.md` と `protocol/wire-samples.json`、定義の形式は `protocol/surface-definition.schema.json` を基準とする
- ブリッジと UI の接続、Unity との送受信、定義の保存・配信、保持値と再送、複数台構成はテストで検証する
- 手動検証の手順やプロトコルの詳細は `docs/` と `protocol/` の該当資料を参照する

## Unity の受け口(別リポジトリ)

- 受け口の UPM パッケージ `com.hidano.oscdesk` と検証用の Unity プロジェクトは [Hidano-Dev/oscdesk-unity](https://github.com/Hidano-Dev/oscdesk-unity) にある(D-136)。C# の変更・EditMode テスト・Unity CI・Unity 操作の注意はそちらの `CLAUDE.md` に従う
- Unity との契約 `docs/UNITY_PROTOCOL.md` と言語間の見本(`protocol/osc-binary-samples.json`・`protocol/catalog-samples.json`)の正は本リポジトリ。`oscdesk-unity` はパッケージの `Tests/Editor/` に写しを持つので、見本を変えた PR では `oscdesk-unity` の README の同期手順で写しを更新する(更新を忘れると `oscdesk-unity` の CI が食い違いで落ちる)

## 開発ガイド

@docs/DEVELOPMENT.md

## Git 運用ルール (agentic-dev-harness)

@.claude/rules/git-workflow.md
