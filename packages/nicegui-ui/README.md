# oscdesk NiceGUI UI

`oscdesk_ui` は、oscdesk ブリッジの WebSocket プロトコルを利用する NiceGUI
(Python) UI です。Unity との OSC 通信は `packages/bridge` が担当し、UI は表示と
操作を担当します。値の正はブリッジが保持し(`desired`)、Unity のエコーバックは
届いた確認として表示に反映します。

このシステムは認証を提供しません。信頼できる LAN 内で利用し、インターネットや
信頼できないネットワークへ直接公開しないでください。

```
NiceGUI UI  --WebSocket-->  oscdesk bridge  --UDP OSC-->  Unity
ブラウザ   <--WebSocket--                  <--UDP OSC--
```

## 起動

通常はリポジトリ直下の `start-oscdesk.bat` または `./launchers/start-oscdesk.ps1` を使います。
ブリッジを起動してから UI を接続し、接続先 URL を表示します。デバッグ構成は
`launchers\start-oscdesk-debug.bat`、OSC ネイティブ UI の評価は
`launchers\start-oscdesk-touchosc.bat` を使います。

手動で UI だけを起動する場合は、ブリッジが待ち受けている状態で次を実行します。

```powershell
packages/nicegui-ui/.venv/Scripts/python -m oscdesk_ui
```

主なオプションは `--osc-host`、`--osc-port`、`--ui-host`、`--ui-port`、
`--client-id`、`--show-ui`、`--verbose` です。既定の UI ポートは 8080、ブリッジの
WebSocket ポートは 7080 です。

## 構成

| パス | 役割 |
|---|---|
| `src/oscdesk_ui/protocol.py` | ブリッジ WebSocket フレームのエンコード・デコード |
| `src/oscdesk_ui/surface_link.py` | ブリッジへの接続、再接続、心拍、送信キュー |
| `src/oscdesk_ui/surface_definition.py` | 定義の本体と結び付けの出し入れ(判定はブリッジだけ。D-122) |
| `src/oscdesk_ui/surface_model.py` | ブリッジが配る部品の木(`surface.view`)を ControlSpec などの型へ読み込む(部品の決め方はブリッジの `packages/shared/src/surface-view.ts`。D-124) |
| `src/oscdesk_ui/value_store.py` | 操作値の表示キャッシュとエコーバック反映、操作中の保護と送信の間引き(操作の手触りに関わるので UI に置く。D-124) |
| `src/oscdesk_ui/state.py` | 接続、サーフェス定義、表示値の状態管理 |
| `src/oscdesk_ui/widgets.py` | ControlSpec から NiceGUI 部品を生成 |
| `src/oscdesk_ui/layout.py` | 画面層(行・列・グループ・タブ・幅)の描画 |
| `src/oscdesk_ui/record_table.py` | レコード型パラメータの表(行 = キー、列 = フィールド。行の増減だけで画面を作り直さない) |
| `src/oscdesk_ui/page.py` | 画面と接続状態の表示 |

案件差分はコードではなく、設定・サーフェス定義のデータで表現します。

## テスト

リポジトリ全体のテストは、ビルド、Vitest (unit / guards / e2e)、pytest の順に
ルートから実行します。

```powershell
corepack pnpm test
```

UI のテストだけを実行する場合は次を使います。

```powershell
packages/nicegui-ui/.venv/Scripts/python -m pytest packages/nicegui-ui
```

pytest のブリッジ結合テストはブラウザを使わず、ビルド済みブリッジと mock-unity
をプロセスとして起動して WebSocket と OSC の往復を検証します。
