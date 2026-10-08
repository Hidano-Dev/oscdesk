# OSCDesk — Unity向けOSCコントロールサーフェス

初回指示の原文: `claude-code-initial-prompt.md`。設計判断の記録: `DESIGN.md`。開発標準とリポジトリ構造: `docs/DEVELOPMENT.md`。

## 概要

Unity アプリ(将来的には任意の OSC 受信アプリ)を LAN 内のブラウザ/スマホから操作する双方向 OSC コントロールサーフェスを作る。ブリッジサーバーが Unity との OSC 通信と UI との WebSocket 通信を仲介し、NiceGUI UI が表示と操作を担当する。開発対象はブリッジ、UI、共有プロトコル、mock-unity、テストハーネスに限定する。

## 対象範囲と境界

- **開発対象**: ブリッジ、NiceGUI UI、共有プロトコル(型・スキーマ・定数)、OSC コーデック、mock-unity、テストハーネス
- **開発対象外**: Unity アプリ本体。同居する `OscSurface/` は接続確認用の Unity プロジェクトであり、リポジトリが責任を持つのは `/sys/*` プロトコルと参照実装の記述まで
- **セキュリティ前提**: 本システムは認証を提供しない。信頼できる LAN 内での利用が前提であり、インターネットや信頼できないネットワークへ公開してはならない。この前提は README・AGENTS・プロトコル文書・手動検証手順のすべてで繰り返し明示する

## 絶対規律

- **ブリッジサーバーと UI の責務を分離する**。Unity との OSC 通信はブリッジに集約し、UI はブリッジの WebSocket プロトコルを利用する。要件がこの境界を越える場合は、実装前にユーザーへ報告して判断を仰ぐ
- **案件差分はコードでなくデータ**(config / レイアウト / マニフェスト)で表現する
- **Unity が真実の源**。UI は表示キャッシュ。値の確定は Unity からのエコーバックのみ
- **特定 Unity OSC ライブラリに依存しない**。OSC 1.0 標準の機能のみでプロトコルを成立させ、迷う点は `docs/UNITY_PROTOCOL.md` に互換性ノートとして記録
- 各 Phase 完了時、`docs/VERIFICATION.md` に手動検証手順を追記し、自動テストを緑にしてから次へ進む

## 作業の進め方

- 作業の起点は Linear の Issue(Hidano チーム / oscdesk プロジェクト)。先送りする作業は Issue として登録する
- 設計判断は `DESIGN.md` に `D-0xx` で追記する。プロジェクトの Markdown 文書は日本語・UTF-8 で書く
- ユーザーの指示に正確に従い、その範囲では自律的に動く。必要な文脈を集めて依頼された作業を最後までやり切り、質問は必須情報が欠けているか指示が決定的に曖昧なときに限る

## リポジトリ構成

- `packages/bridge` — Node.js のブリッジサーバー。Unity との OSC 通信と UI との WebSocket 通信を担当し、`dist/oscdesk-bridge.js` を生成する
- `packages/nicegui-ui` — NiceGUI(Python) UI。パッケージ名は `oscdesk-nicegui-ui`、Python モジュール名は `oscdesk_ui`
- `packages/shared` — プロトコル型・zod スキーマ・定数(TS ソースを直接参照、ビルド出力なし)
- `packages/osc-codec` — OSC のエンコード・デコード処理
- `packages/mock-unity` — Unity モック OSC レスポンダ(テスト・開発用)
- `config/` — 実行時設定(宛先・ポート・デバッグフラグ)
- `protocol/` — 共有プロトコルの資料・サンプル
- `tests/` — リポジトリ共通テスト
- `scripts/run-python-tests.mjs` — UI の pytest をテスト入口から実行するスクリプト
- `OscSurface/` — 同居する Unity プロジェクト

## 開発コマンド

### 初回セットアップ(新しい PC にクローンした直後)

`setup-oscdesk.bat` をダブルクリックする(または `.\setup-oscdesk.ps1` を実行)。ワークスペース依存の導入、全パッケージのビルド、`packages/nicegui-ui/.venv` の作成と UI パッケージの開発インストールを一括で行う。完了済みの手順はスキップするので何度実行してもよい。`-Force` で全手順を再実行する。

### 個別コマンド

pnpm は corepack 経由(グローバルインストール不要)。

```powershell
# ワークスペース依存のインストール
corepack pnpm install

# 全パッケージのビルド
corepack pnpm -r run build

# UI の Python 仮想環境と開発依存を準備(通常は setup-oscdesk.bat が実行)
py -3 -m venv packages/nicegui-ui/.venv
packages/nicegui-ui/.venv/Scripts/python -m pip install -e "packages/nicegui-ui[dev]"

# 型チェック
corepack pnpm typecheck

# テスト一式(単一の入口)
corepack pnpm test
```

## 起動方法

通常起動はリポジトリ直下の `start-oscdesk.bat` をダブルクリックする(または `.\start-oscdesk.ps1` を実行する)。このランチャーはブリッジ(Node.js)と NiceGUI UI(Python)の2プロセスを起動し、接続先 URL を表示する。既定の Unity 向けポートは送信 7090 / 受信 7091、ブリッジ WebSocket は 7080 である。ウィンドウを閉じると両プロセスを停止する(子プロセスは `scripts/launcher-guard.ps1` の Job Object で親と道連れになり、× で閉じても残らない。起動時には前回の孤立プロセスを回収する)。

デバッグ起動は `start-oscdesk-debug.bat`、OSC ネイティブ UI 評価は `start-oscdesk-touchosc.bat` を使う。評価用ランチャーは mock-unity とブリッジを起動し、接続先 IP と受信ポートを表示する。

`.bat` は薄いランチャーに留め、処理本体と日本語メッセージは `.ps1`(UTF-8 BOM 付き)に置く。`.bat` に非 ASCII を入れると cmd のコードページ依存で壊れるため。

## 実装上の前提

- Unity 側のマニフェストと `/sys/*` プロトコルを契約の基準とする
- ブリッジと UI の接続、Unity との送受信、マニフェスト同期、診断表示はテストで検証する
- 手動検証の手順やプロトコルの詳細は `docs/` と `protocol/` の該当資料を参照する

## Unity 操作の注意(`OscSurface/`)

- Editor は `ProjectSettings/ProjectVersion.txt` と同じバージョン(6000.0.36f1)だけを使う。別バージョンで開くと `ProjectVersion.txt` が書き換わり全リインポートが走る。食い違いを見つけても Editor の選択や `ProjectVersion.txt` を勝手に「直さない」で報告する
- C# は `corepack pnpm test` / `typecheck` の対象外。変更したら少なくとも EditMode テストを実行して結果を確認する。batchmode で Test Runner を使うときは `-runTests` と `-quit` を併用しない(テストが走らずに終了する)。`-testResults` / `-logFile` は絶対パスで指定する
- 同じプロジェクトを開いている Editor があると batchmode のテストはプロジェクトロックで止まる。人が作業中の Editor は勝手に終了させず、閉じてもらうよう依頼する。テストが走らないことを理由にファイルの手編集や検証の省略に逃げない
- 自動化目的で Editor を GUI 付きで起動するときは `-automated` を渡す(ブロッキングダイアログで止まらないようにする)
- シーン(`.unity`)・プレハブ(`.prefab`)・ScriptableObject(`.asset`)の YAML は手で編集しない。Editor 経由かコードからの生成で変更し、手編集が避けられないときはその旨を報告する
- 新規ファイルの `.meta` は可能なら Unity に生成させる。手で書くときは GUID をランダムな 32 桁 hex で新規生成する(規則的なパターンや既存 GUID の流用は禁止)
- `Library/` `Temp/` `Logs/` `UserSettings/` などの生成物はコミットしない。`Packages/packages-lock.json` はパッケージ変更時に更新してコミットする

## 開発ガイド

@docs/DEVELOPMENT.md

## Git 運用ルール (agentic-dev-harness)

@.claude/rules/git-workflow.md
