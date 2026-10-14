# oscdesk

Unity を LAN 内のブラウザやスマートフォンから操作する、oscdesk コントロールサーフェスです。操作する OSC アドレス・型・画面の配置は OscDesk 側のサーフェス定義 JSON にまとめ、ブラウザで読み込み・編集・保存します。Node.js のブリッジが Unity との OSC 通信と UI との WebSocket 通信を仲介し、NiceGUI UI が表示と操作を担当します。Unity 側には、受けたアドレスを UnityEvent に渡す汎用の受け口(`OscSurface/Assets/OscReceiver/`)を置くだけで操作できます。

このシステムは認証を提供しません。信頼できる LAN 内で利用することを前提とし、インターネットや信頼できないネットワークへ直接公開しないでください。

## 3つの規律

- ブリッジと UI の責務を分離する。Unity との OSC 通信はブリッジに集約し、UI はブリッジの WebSocket プロトコルを利用する。
- 案件ごとの差分はコードではなく、設定・サーフェス定義(パラメータ・配置・アクション)のデータで表現する。
- 定義と値の正は OscDesk が持つ。狙いの値はブリッジが保持し、Unity の再起動・再接続時に送り直す。Unity はアドレスと値を受け取ってエコーを返すだけで、エコーは届いた確認として扱う。

## 構成

- `packages/bridge` — Node.js ブリッジ。Unity との OSC 通信と UI との WebSocket 通信を担当
- `packages/nicegui-ui` — NiceGUI UI。Python モジュール名は `oscdesk_ui`
- `packages/shared` — プロトコル型、zod スキーマ、定数
- `packages/osc-codec` — OSC のエンコード・デコード
- `packages/mock-unity` — テスト・開発用 Unity モック
- `config/` — 実行時設定
- `launchers/` — 用途別ランチャー(debug / touchosc / verify)と setup、ランチャーの共通部品(`launchers/lib/`)。直下には通常起動の `start-oscdesk.bat` だけを置く
- `protocol/` — 共有プロトコルの資料とサンプル
- `tests/` — 共通テスト
- `OscSurface/` — 同居する Unity プロジェクト(汎用の受け口 `Assets/OscReceiver/`)

## セットアップ

セットアップを手で実行する必要はありません。起動ランチャー(`start-oscdesk.bat` と `launchers/` の各ランチャー)は、起動のたびに依存関係(`node_modules`)・ビルド成果物・UI 用 Python 仮想環境を確かめ、足りないか古ければ setup を自動で実行してから起動します。新しい PC にクローンした直後も、`start-oscdesk.bat` をダブルクリックするだけで構いません(初回は依存の導入に数分かかります)。

setup だけを実行したい場合は `launchers\setup-oscdesk.bat` をダブルクリックするか、PowerShell で `.\launchers\setup-oscdesk.ps1` を実行します。依存関係の導入、全パッケージのビルド、UI 用 Python 仮想環境の準備を行います。何度実行しても構いません。

個別に実行する場合:

```powershell
corepack pnpm install
corepack pnpm -r run build
py -3 -m venv packages/nicegui-ui/.venv
packages/nicegui-ui/.venv/Scripts/python -m pip install -e "packages/nicegui-ui[dev]"
```

## 起動

通常起動はリポジトリ直下の `start-oscdesk.bat` をダブルクリックするか、`.\launchers\start-oscdesk.ps1` を実行します。ブリッジと NiceGUI UI が起動し、接続先 URL が表示されます。既定の Unity 向けポートは送信 7090 / 受信 7091、WebSocket は 7080 です。ウィンドウを閉じると両プロセスが停止します(Ctrl+C でも × ボタンでも。子プロセスは OS の Job Object で親と道連れになります)。前回の起動で残った孤立プロセスがあれば、次の起動時に自動で停止してから起動します。

デバッグ起動は `launchers\start-oscdesk-debug.bat`、OSC ネイティブ UI 評価は `launchers\start-oscdesk-touchosc.bat` を使用します。評価起動では mock-unity とブリッジを起動し、接続先 IP と受信ポートを表示します。手動検証(`docs/VERIFICATION.md`)には、見本の定義・一時 config・mock-unity を用意する `launchers\start-oscdesk-verify.ps1` を使います。

どのランチャーも `-CheckOnly` を付けると、環境の確認だけを行って終了します(起動も setup もしない。揃っていれば終了コード 0、足りなければ 2)。`launchers\start-oscdesk.ps1` は `-SkipSetup` で自動 setup を止められます(足りなければエラーで止まる)。

### フォークの自前ランチャー

フォークで独自の config を使うランチャー(例: `start-oscdesk-vp.ps1`)を作るときは、起動の手順を複製せずに次のどちらかで再利用します。どちらも環境の確認と自動 setup を含みます。

1. 通常起動の手順をそのまま使い、config だけ差し替える(`launchers/start-oscdesk-debug.ps1` と同じ形)

   ```powershell
   $root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))   # ランチャーを launchers/ に置いた場合
   & (Join-Path $root 'launchers\start-oscdesk.ps1') -ConfigPath (Join-Path $root 'config\oscdesk.vp.config.json')
   exit $LASTEXITCODE
   ```

2. 起動するプロセスを自分で組む場合は、共通部品を dot-source する(`launchers/start-oscdesk-touchosc.ps1` と同じ形)。`$OscdeskRoot`・`Initialize-OscdeskEnvironment`・Job Object による後始末(`Initialize-LauncherJob` ほか)・`Find-BridgeReadyLine` などが使える。一覧は `launchers/lib/oscdesk-launcher.ps1` の冒頭にある

   ```powershell
   . (Join-Path $PSScriptRoot 'lib\oscdesk-launcher.ps1')   # ランチャーを launchers/ に置いた場合
   Set-Location -LiteralPath $OscdeskRoot
   Initialize-OscdeskEnvironment                             # 足りなければ setup を自動で実行する
   ```

フォーク側のランチャーも `launchers/` に置き、直下の bat は増やさないことを勧めます。`.bat` には ASCII 以外を書かず、日本語は UTF-8(BOM 付き)の `.ps1` に置きます(`tests/guards/launcher-scripts.test.ts` が検査します)。

## テスト

```powershell
# 型チェック
corepack pnpm typecheck

# 全テスト(ビルドを含む単一入口)
corepack pnpm test

# 単体テストのみ
corepack pnpm exec vitest run --config vitest.config.ts --project unit
```

UI の pytest は `corepack pnpm test` から `scripts/run-python-tests.mjs` 経由で実行されます。

Unity との契約と接続手順は `docs/UNITY_PROTOCOL.md`、UI との契約は `docs/BRIDGE_PROTOCOL.md`、定義の形式は `protocol/surface-definition.schema.json`、手動検証手順は `docs/VERIFICATION.md` を参照してください。
