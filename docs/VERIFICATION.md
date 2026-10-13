# VERIFICATION.md — 手動検証手順

各 Phase の完了時に、その Phase の動作確認手順を追記する。コマンドはリポジトリ root で実行する(PowerShell 想定)。

**認証が無いため、検証端末と Unity(または mock-unity)は信頼できる同一 LAN に置き、インターネットや信頼できないネットワークへ公開しない。**

## 基本の手動検証(ブリッジ + NiceGUI UI + Unity)

ブリッジと NiceGUI UI の 2 プロセスで Unity を操作する構成の確認手順。操作対象はサーフェス定義(OscDesk 側の JSON)で決まり、値の正はブリッジが持つ(DESIGN.md D-043〜D-046・D-051)。

### セットアップ

1. リポジトリ root で `setup-oscdesk.bat` をダブルクリックするか、PowerShell で次を実行する。既にセットアップ済みでも、pull の後は依存関係とビルドを最新にするために実行する。

   ```powershell
   .\setup-oscdesk.ps1
   ```

2. `packages/bridge/dist/oscdesk-bridge.js` と `packages/nicegui-ui/.venv/Scripts/python.exe` があることを確認する。
3. `config/oscdesk.config.json` に `"surfaces": { "dir": "surfaces", "defaultName": "stage" }` を足し、`surfaces/stage.json` に `protocol/surface-definition-samples.json` の `full-example` の `definition` を保存する。
4. Unity を使う場合は `OscSurface/` を Unity Editor で開き、「HID-164: Unity の汎用 OSC レシーバ(OscReceiver)」の手順 1〜2 のとおり `OscReceiver` を付けた GameObject を用意して Play Mode にする。mock-unity で代替する場合は次を実行する(ping/pong とエコーだけを返す)。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091
   ```

### 起動と LAN 端末からの接続

1. Unity または mock-unity が待ち受けている状態で、リポジトリ root から通常起動する。

   ```powershell
   .\start-oscdesk.ps1
   ```

   または `start-oscdesk.bat` をダブルクリックする。ブリッジと NiceGUI UI が起動し、`接続先 URL:` の下に LAN 用 URL が表示される。起動するプロセスはこの 2 つだけである。

   ウィンドウの × ボタンで閉じた後、`netstat -aon | find "7091"` に node.exe が残らないことを確認する(子プロセスは Job Object で親と道連れになる)。念のため孤立した `oscdesk-bridge.js` の node.exe を手で作ってから起動すると、`前回の起動で残っていたプロセスを停止しました: node.exe PID …` と表示され、ポート使用中にならずに起動することを確認する。

2. 同じ LAN の別の PC またはスマートフォンで、起動ウィンドウに表示された `http://<この PC の LAN IP>:8080` を開く。画面上部にブリッジの接続済みと「定義: 採用済み — stage」が出て、定義の部品が描画されることを確認する。LAN IP が複数表示された場合は、検証端末と同じネットワークのアドレスを選ぶ。

3. 画面を数秒表示したままにし、Unity の表示が「接続中」になって RTT の数値が出ることを確認する。「未接続」のままなら、Unity の送信先・ブリッジの UDP 受信ポート 7091・Windows ファイアウォールを確認する(`docs/UNITY_PROTOCOL.md` §6.3)。

### ping/pong・エコーバック・保持値の再送

1. ブリッジから `/sys/ping` が送られ、Unity から `/sys/pong` が返り、画面の RTT・連続喪失回数が更新されることを確認する。Unity を一時停止して約 5 秒待つと「未接続」になり、再開すると「接続中」に戻ることも確認する。
2. 画面のスライダー、スイッチ、ボタンを操作する。操作値が Unity に届き、同じ値がエコーバックされることを確認する(NDJSON で送信 out と同じアドレスの受信 in が対になる)。スライダーを保持中に別の値が届いても表示が飛ばず、指を離した後に揃うことも確認する。
3. スライダーを既定値と違う値にしてから、Unity の Play Mode を止めて再開する(mock-unity なら止めて起動し直す)。数秒以内にブリッジの標準出力に `Resending N desired value(s) to Unity "unity" (Unity recovered).` が出て、Unity に操作した値が届くことを確認する。ボタン(`trigger`)は再送されない。
4. 別の LAN 端末のブラウザでも同じ URL を開く。部品が崩れずに描画され、片方の端末で操作した値がもう片方にも反映されることを確認する(D-032 で失った実ブラウザ検査 E2E の代替として、目視で残すブラウザ描画確認)。

### ログと標準出力の観測場所

- NDJSON はリポジトリ root の `logs/diagnostics/` に出力される(debug 起動時。`start-oscdesk-debug.bat`)。ファイルは `oscdesk-*.ndjson` で、1 行が 1 JSON である。`ping`/`pong` と値の送受信を見る。

  ```powershell
  Get-ChildItem logs/diagnostics
  Get-Content (Get-ChildItem logs/diagnostics/*.ndjson | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -TotalCount 20
  ```

- ブリッジの標準出力は `OSCDESK_BRIDGE_READY {...}`、起動エラー、`(INFO, BRIDGE) Resending ...`、`(WARN, BRIDGE) Unity echo differs from desired value ...` などを見る場所である。`start-oscdesk.ps1` はブリッジを非表示で起動して標準出力を一時ファイルへリダイレクトし、終了時に削除するため、実行中に標準出力を観測する場合は `start-oscdesk.ps1` を使わず、別ターミナルでブリッジを直接起動する(UI は `packages/nicegui-ui/.venv/Scripts/python -m oscdesk_ui` で別に起動する)。

  ```powershell
  node packages/bridge/dist/oscdesk-bridge.js --config config/oscdesk.config.json
  ```

  `start-oscdesk.ps1` と同時に実行して二重起動しない。

### 完了条件

この手順を上から実施し、LAN 端末からの描画、ブリッジ接続、Unity の ping/pong と接続状態、値のエコーバック、Unity 再起動後の保持値の再送、ならびに対応する NDJSON とブリッジ標準出力を確認できれば、2 プロセス構成の主要機能を手動で確認できたものとする。機能ごとの詳細な手順は、下の Issue ごとの節を参照する。

## Unity EditMode テストの実行方法

1. Unity Editor で `OscSurface/` プロジェクトを開き、インポートとコンパイルが完了するまで待つ。
2. メニューから **Window > General > Test Runner** を開く。
3. Test Runner の **EditMode** タブを選択し、一覧に `OscDesk.Receiver.Tests` のテストが表示されることを確認する。
4. **Run All** を押し、全テストが緑になることを確認する。失敗した場合はテスト名、Console の例外、Unity Editor のバージョンを記録する。

この EditMode テストはリポジトリの `corepack pnpm test` (Vitest + pytest) のテスト入口には接続されておらず、同コマンドを実行しても Unity テストは実行されない。CI では `.github/workflows/unity-ci.yml`(オンプレ Ubuntu のセルフホストランナー、Unity 6000.0.36f1、Xvfb)が同一リポジトリ由来の PR と main への push で EditMode 全件を実行し、結果 XML とログを artifact `unity-editmode-results` に残す。Unity を実行できない環境では、ローカルの EditMode テストを未実施として記録し、PR の `Unity CI` の結果を検証証跡として参照する(`corepack pnpm test` の結果と混同しない)。

### Unity Editor を開かずに実行する(batchmode)

Editor の GUI を使わず、コンパイル確認と EditMode 実行だけを行う場合はこちらを使う。**Unity Editor で同じプロジェクトを開いていると batchmode は起動できない**(`HandleProjectAlreadyOpenInAnotherInstance` でクラッシュ扱いになる)ため、事前に Editor を閉じる。

```powershell
# 1. コンパイルのみ(エラーがあればログに error CS として出る)
& "D:\UnityEditors\6000.0.36f1\Editor\Unity.exe" -batchmode -quit -nographics `
  -projectPath "D:\Personal\Repositries\oscdesk\OscSurface" -logFile "<任意>\compile.log"

# 2. EditMode テスト実行(結果は NUnit 形式の XML に出る)
& "D:\UnityEditors\6000.0.36f1\Editor\Unity.exe" -batchmode -nographics `
  -projectPath "D:\Personal\Repositries\oscdesk\OscSurface" `
  -runTests -testPlatform EditMode -testResults "<任意>\results.xml" -logFile "<任意>\tests.log"
```

- **`-runTests` に `-quit` を付けない**。付けるとテスト実行前に終了し、結果 XML が生成されないまま終了コード 0 が返る
- `-testResults` / `-logFile` は絶対パスで指定する
- 結果の確認は XML の `test-run` 要素(`total` / `passed` / `failed`)を見る。終了コードはテスト失敗時に 2 になる
- Editor のパスはインストール先に読み替える。このマシンでは Unity Hub 配下ではなく `D:\UnityEditors\<version>\Editor\Unity.exe` にある

## HID-160: サーフェス定義の保存・読み込み・配信(ブリッジ)

自動テスト: `corepack pnpm test`(`surface-store.test.ts` / `surface-manager.test.ts` / `tests/e2e/surface-definition.e2e.test.ts` / 両言語のワイヤ見本)。信頼できる LAN 内でのみ試すこと(認証なし)。

1. `config/oscdesk.config.json` に `"surfaces": { "dir": "surfaces", "defaultName": "stage" }` を足し、`surfaces/stage.json` に `protocol/surface-definition-samples.json` の `full-example` の `definition` を保存してブリッジを起動する(`node packages/bridge/dist/oscdesk-bridge.js --config config/oscdesk.config.json`)。
2. WebSocket クライアント(`npx wscat -c ws://127.0.0.1:7080` 等)で `{"v":1,"type":"surfaceRequest"}` を送る。**期待**: `surfaceList`(`active: "stage"`)と `surface`(`revision: 1`)が返る。
3. クライアントを 2 つ接続し、片方から `surfaceSave`(`name` を `stage`、`definition` の `name` を変えたもの)を送る。**期待**: 両方に `surface`(`revision: 2`)と `surfaceList` が届き、`surfaces/.backups/` に直前の内容が `stage.<時刻>.json` で残る。
4. `definition` に未知キーを足して送る。**期待**: 送った側だけに `notice`(`surface-rejected`)が届き、`surfaceRequest` の結果は変わらない。`stage.json` は書き換わらない。
5. `name` に `../x`・`CON`・`.backups` を入れた `surfaceSave` を送る。**期待**: `invalid-frame` の `notice` が返り、`surfaces/` の外にもファイルは作られない。
6. `curl http://127.0.0.1:7080/surfaces`、`curl -OJ http://127.0.0.1:7080/surfaces/stage.json`、`curl -X PUT --data-binary @stage.json http://127.0.0.1:7080/surfaces/uploaded.json` を実行する。**期待**: 一覧とダウンロードができ、PUT で全クライアントに `surface`(`name: "uploaded"`)が届く。壊れた JSON は 400、検証に通らない定義は 422 になる。
7. `surfaces/stage.json` を壊して(`{` だけにして)ブリッジを再起動する。**期待**: 警告ログが 1 行出て起動は続き、`surfaceRequest` の `active` は `null`。

## HID-161: 保持値と再接続時の再送(ブリッジ)

自動テスト: `corepack pnpm test`(`desired-values.test.ts` / `surface-core.test.ts` / `tests/e2e/desired-values.e2e.test.ts` / 両言語のワイヤ見本)。信頼できる LAN 内でのみ試すこと(認証なし)。

1. `trigger` と `state`(`default` あり)のパラメータを持つ定義を `surfaces/` に置き、mock-unity とブリッジを起動する(`start-oscdesk-touchosc.bat` 等)。WebSocket クライアントで `surfaceRequest` を送る。**期待**: `surface`・`surfaceList` の後に `desired`(`full: true`、`state` の既定値だけ。`trigger` は含まれない)が届く。
2. `state` のアドレスへ `osc` を送る。**期待**: 全クライアントに `desired`(`full: false`)が届く。`trigger` のアドレスへ送っても `desired` は届かない。
3. mock-unity を止めて起動し直す。**期待**: 数秒以内に、手順 2 で送った値が Unity へ再送され(mock のエコーが `osc` フレームで届く)、`trigger` のアドレスは再送されない。
4. Unity 側でエコーが保持値と食い違う値を返すようにする(mock の手動送信等)。**期待**: ブリッジが `Unity echo differs from desired value` の警告を 1 回出し、`desired` は変わらない。

## HID-162: 冗長構成(複数の Unity と宛先ごとの再送)

自動テスト: `corepack pnpm test`(`surface-core.test.ts` / `schemas.test.ts` / `tests/e2e/redundant-targets.e2e.test.ts` / 両言語のワイヤ見本 / Python の `test_state.py`)。信頼できる LAN 内でのみ試すこと(認証なし)。

1. 同じ PC で mock-unity を 2 台起動する(`--listen-port 7090` と `--listen-port 7092`、どちらも `--reply-port 7091`)。`config/oscdesk.config.json` の `unity` に `"secondary": [{ "name": "backup", "host": "127.0.0.1", "sendPort": 7092 }]` を足してブリッジと UI を起動する。
2. 画面の「Unity 宛先」の下に、`unity (主系)` と `backup (副系)` のバッジが出て、どちらも「接続中」になる。**期待**: 1 台構成の config ではこの行は出ない。
3. サーフェス定義を読み込み、スライダーを動かす。**期待**: 両方の mock-unity が値を受け取る(各 mock のログ、または WebSocket クライアントの `hello.targets` / `link.targets` で確認)。UI に出るエコーは主系の分だけ。
4. 副系の mock-unity だけを止めて起動し直す。**期待**: 数秒以内にブリッジのログに `Resending N desired value(s) to Unity "backup"` が出て、主系には出ない。バッジは一時的に「未接続」になり、戻る。
5. 画面の `backup` の「再送」を押す。**期待**: `to Unity "backup" (requested by UI)` のログが出て、主系へは送られない。「全台へ再送」では両方へ送られる。
6. WebSocket クライアントから `{"v":1,"type":"resend","target":"nope"}` を送る。**期待**: `notice`（`resend-rejected`）が返る。
7. 副系の mock-unity を止めたままスライダーを動かし、起動し直す。**期待**: 起動後に最新の値が副系だけへ再送される。

## HID-164: Unity の汎用 OSC レシーバ(OscReceiver)

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests`。CI の `Unity CI` で全件実行)。UI / ブリッジ側の `corepack pnpm test` の対象外。信頼できる LAN 内でのみ試すこと(認証なし)。

1. `OscSurface/` を Unity 6000.0.36f1 で開き、空の GameObject に `OscReceiver` を追加する。`uOscServer.port` を 7090、`uOscClient` を OscDesk ホストの 7091 に設定する。
2. 適当なスクリプトに `public void OnMaster(float v)` と `public void OnGo()` を用意し、`Bindings` に `/mix/master`(Float)と `/cue/go`(Trigger)の行を足して、各イベントへ登録する。
3. 「定義ファイル」にサーフェス定義 JSON を設定する。**期待**: 定義にないアドレスの行と、行が無いアドレスが警告で出る。「定義にあって行が無いアドレスの行を追加」で不足分の行が型つきで増える。
4. Play してブリッジと UI を起動し、スライダーを動かし、GO ボタンを押す。**期待**: `OnMaster` が値つきで、`OnGo` が押すたびに呼ばれ、UI の値がエコーで確定する。
5. 登録のないアドレスへ送る(定義にあるが行がないパラメータを操作する)。**期待**: Console に `no binding for ...` が出るが、UI の値はエコーで確定する。
6. 行の型と合わない値を送る(Int の行へ文字列等)。**期待**: `argument type mismatch` が出てイベントは呼ばれない。

## HID-193: UI のサーフェス定義駆動化

自動テスト: `corepack pnpm test`(Python の `test_state.py` / `test_surface_model.py` / `test_browser_*_events.py` / `test_entry_rules.py`、両言語のワイヤ見本)。信頼できる LAN 内でのみ試すこと(認証なし)。

1. `config/oscdesk.config.json` に `"surfaces": { "dir": "surfaces", "defaultName": "stage" }` を足し、`surfaces/stage.json` に `protocol/surface-definition-samples.json` の `full-example` の `definition` を保存する。mock-unity とブリッジ、UI を起動する(`start-oscdesk-touchosc.bat` 等)。
2. ブラウザで UI を開く。**期待**: 画面上部に「定義: 採用済み — stage (6 件, rev 1)」が出て、最初の画面の部品(スライダー・スイッチ・選択・数値入力・GO ボタン)が縦一列に並ぶ。各部品の初期表示は定義の `default`。
3. スライダーを動かす。**期待**: mock-unity がその値を受け取る。UI を 2 つ開くと、もう一方のスライダーも `desired` で追従する。
4. GO(`trigger`)ボタンを押す。**期待**: 押した瞬間に定義の `value` が 1 回だけ届く(離しても何も送られない)。`standalone: false` のボタンは無効表示で、押しても何も送られない。
5. WebSocket クライアントから `surfaceSave`(`name` を `stage`、ラベルなどを変えた定義)を送る。**期待**: UI が画面を作り直し、操作済みの値は保持値のまま残る。同じ内容の再保存では操作中の欄が壊れない。
6. 数値入力欄に範囲外の値を打って Enter / フォーカス移動する。**期待**: 送信されず、赤字のエラーが出て、欄は直近の値へ戻る。
7. 不正な定義(未知キーを足す)を `surfaceSave` で送る。**期待**: UI に「定義を採用できません」の通知が出て、画面は直前のまま。
8. ブリッジを再起動する。**期待**: UI が再接続し、`surfaceRequest` の応答で画面と値が復元される(再起動前に操作した値はブリッジが保持していないため `default` に戻る)。

## HID-163: UI の画面層(行・列・グループ・タブ・幅)

自動テスト: `corepack pnpm test`(Python の `test_layout.py` / `test_surface_model.py`)。実際の折り返しは自動テストでは見えないため、ブラウザで確認する。信頼できる LAN 内でのみ試すこと(認証なし)。

1. HID-193 の手順 1 と同様に起動し、`surfaces/stage.json` を、行(`width` 8 と 4 の control)、`collapsed: true` のグループ、2 つ以上のタブを持つ `tabs`、`width: "auto"` の control を含む定義に差し替える。
2. PC 幅のブラウザで UI を開く。**期待**: 行の子が 8:4 の比で横に並ぶ。`collapsed: true` のグループは閉じて始まり、開くと中の部品が出る。タブを切り替えると中身が変わる。
3. ブラウザ幅を 360px 前後まで狭める(開発者ツールのスマホ表示)。**期待**: 横スクロールが出ず、行の子が折り返して縦に並ぶ。
4. 定義に画面を 2 つ足して `surfaceSave` で送る。**期待**: 最上位にタブが出て、画面を切り替えられる。
5. 数値入力欄に入力中のまま、同じ内容の `surfaceSave` を送る。**期待**: 画面は作り直されず、入力中の値が残る。内容を変えて送ると画面が作り直される。


## HID-165: 定義のブラウザ編集(編集モード)

自動テスト: `corepack pnpm test`(Python の `test_surface_editor.py` / `test_editor_page.py` / `test_surface_link.py`)。実ブラウザでの操作感とファイルのダウンロード・アップロードは自動テストでは見えないため、次の手順で確認する。**認証が無いため信頼できる LAN 内でのみ試すこと。**

1. HID-193 の手順 1 と同様にブリッジと UI を起動し、ブラウザで UI を開く。**期待**: 画面上部に「編集モード」スイッチがあり、オフの間は保存・読み込み・配置変更の操作が出ない。
2. 「編集モード」をオンにする。**期待**: 作業コピーの木(画面・部品・パラメータ一覧)と、保存済み・保存名・保存・ダウンロード・アップロードが出る。
3. 部品の「↑ / ↓」で順序を変え、「グループ化」で包み、「閉じて開始」を入れ、幅を選び、隣の部品との「横並び」を押す。**期待**: 木の表示が変わる(保存するまで本番の画面は変わらない)。
4. 「パラメータを追加」で新しい id・アドレス・型を入力して OK する。**期待**: 一覧に増え、「未配置のパラメータ」に出て「置く」で配置できる。範囲を逆(最小 > 最大)にして OK する。**期待**: 赤い通知が出て作業コピーは変わらない。
5. 保存名(例 `stage-b`)を入れて「保存」を押す。**期待**: 本番の画面が新しい配置に作り直され、保存済みの一覧に `stage-b` が増える(`surfaces/stage-b.json` ができる)。不正な保存名(`../x` など)では送信されず通知が出る。
6. 別のブラウザ(別端末)でも UI を開いておき、手順 5 を行う。**期待**: 保存後に他方の画面も作り直される。編集モードで未編集の端末は作業コピーが追従する。
7. 編集モードで変更を入れた(未保存の)端末がある状態で、他方の端末から保存する。**期待**: 変更中の端末に警告が出て作業コピーは保たれ、その端末で「保存」すると上書きの確認が出る。
8. 「ダウンロード」を押す。**期待**: 作業コピーの JSON がダウンロードされる。それを編集して「アップロード」する。**期待**: 作業コピーに読み込まれ(保存するまで採用されない)、不正な JSON では通知が出て作業コピーは変わらない。
9. 保存済みから別の定義を選んで「読み込み」を押す。**期待**: 本番の画面がその定義に切り替わる。未保存の変更があるまま編集モードをオフにする。**期待**: 破棄の確認が出る。

## HID-166: アクション(まとめ送りボタン)

自動テスト: `corepack pnpm test`(Python の `test_actions.py`、`tests/e2e/action-batch.e2e.test.ts`、両言語の定義見本)。**認証が無いため信頼できる LAN 内でのみ試すこと。**

1. `protocol/surface-definition-samples.json` の `action-sequence` の `definition` を `surfaces/` に保存し、HID-193 の手順 1 と同様に起動する(スロットは Unity が応答する実機または受信ログを見られる受信側で確認する)。**期待**: 画面に Slot 1・Slot 2・Mode のスライダー/選択と「Apply all (4 件)」ボタンが出る。
2. Slot 1 を動かす。**期待**: Unity には何も送られない(`standalone: false`)。他の端末で UI を開き直しても、この値は共有されない。
3. 「Apply all」を押す。**期待**: `/slot/01` `/slot/02` `/slot/mode` `/cue/apply` が 1 つの bundle で定義順に届く。エコーが揃うと「送信しました(4 件を確認)」が出る。
4. Slot 2 を一度も動かさず(`default` が無い定義に変えて)押す。**期待**: 値が未設定の項目は送られず、警告が出る。
5. エコーを返さない状態(Unity を止める、または宛先を誤る)で押す。**期待**: 約 2 秒後に未達の件数とアドレスの error 通知が出る。再送はされない。
6. ブリッジを止めて押す。**期待**: 「接続していないため送れませんでした」の通知。

## HID-195: Unity 側のマニフェスト機構の撤去

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests`。CI の `Unity CI`)と `corepack pnpm test`。信頼できる LAN 内でのみ試すこと(認証なし)。

1. `OscSurface/` を Unity 6000.0.36f1 で開く。**期待**: コンパイルエラーが無く、`Assets/` に `OscSurfaceBridge/` が無い。Missing Script の警告も出ない。
2. Test Runner の EditMode で Run All する。**期待**: `OscDesk.Receiver.Tests` だけが表示され、全件緑。
3. 「HID-164」の手順 1・4 で `OscReceiver` をブリッジと UI につなぐ。**期待**: Unity から `/sys/manifest` が送られず(診断 NDJSON に記録が無い)、ping/pong とエコーで接続中・値の確定が従来どおり動く。


## HID-205: Unity の一覧の宛先ごとの保持と和集合の配信(ブリッジ)

自動テスト: `corepack pnpm test`(`runtime-options.test.ts` / `surface-core.test.ts` / mock-unity の `responder.test.ts` / `tests/e2e/runtime-options.e2e.test.ts` / 両言語のワイヤ見本)。**認証が無いため信頼できる LAN 内でのみ試すこと。** UI の選択欄にはまだ出ない(HID-206)ので、WebSocket クライアントとブリッジの標準出力で確かめる。

1. 同じ PC で mock-unity を 2 台、違う一覧を返すように起動する(`--options-reply` は `<要求アドレス>|<一覧のアドレス>|<名前>...`)。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --options-reply '/mb/segments/get|/mb/segments|Intro|Song A'
   node packages/mock-unity/dist/mock-unity.js --listen-port 7092 --reply-host 127.0.0.1 --reply-port 7091 --options-reply '/mb/segments/get|/mb/segments|Song A|Song B'
   ```

2. `config/oscdesk.config.json` の `unity` に `"secondary": [{ "name": "backup", "host": "127.0.0.1", "sendPort": 7092 }]` を足し、`surfaces/segments.json` に `protocol/surface-definition-samples.json` の `options-from-shared-address` の `definition` を保存して、`"surfaces": { "dir": "surfaces", "defaultName": "segments" }` で起動する。**期待**: 2 台が接続中になった時点で、標準出力に `Requesting 1 option list(s) from Unity "unity" (Unity first reachable).` と同じ行の `"backup"` 版が出る。
3. WebSocket クライアント(`npx wscat -c ws://127.0.0.1:7080` 等)で `{"v":1,"type":"surfaceRequest"}` を送る。**期待**: `desired` の後に `runtimeOptions` が届き、`lists[0].targets` が `unity: ["Intro","Song A"]`・`backup: ["Song A","Song B"]`、`choices` が両パラメータとも `["(none)","Intro","Song A","Song B"]` になる。`/mb/segments` と `/mb/segments/get` の `osc` フレームは届かない。
4. `{"v":1,"type":"osc","address":"/member/1/segment","args":[{"type":"s","value":"Song B"}]}` を送る。**期待**: 副系にしか無い名前でも `desired`(`full: false`)に入り、両方の mock-unity が受け取る。
5. 副系の mock-unity を止める。**期待**: `link` で `backup` が `lost` になっても、`runtimeOptions` は送り直されず、手順 3 の `surfaceRequest` を送り直しても `backup` の一覧が残っている。
6. 副系を別の一覧(例: `'/mb/segments/get|/mb/segments|Song C'`)で起動し直す。**期待**: `Requesting ... "backup" (Unity recovered).` が出て主系には出ず、`runtimeOptions` の `backup` が `["Song C"]` に置き換わる。`choices` は `["(none)","Intro","Song A","Song C"]` になり、手順 4 の `Song B` は保持値に残る(`surfaceRequest` の `desired` で確認。主系を再起動すると `Song B` が再送される)。
7. `{"v":1,"type":"runtimeOptionsRefresh"}` を送る。**期待**: `Requesting ... (requested by UI).` が両方の宛先について出る。一覧が変わらなければ `runtimeOptions` は届かない。
8. 定義から `optionsFrom` を外して保存する(`surfaceSave`)。**期待**: `runtimeOptions` が `lists: []`・`choices: []` で届き、以後ブリッジは一覧の要求を送らない(`/mb/segments` に届くものは通常のエコーとして扱われる)。

## HID-206: Unity の一覧を UI の選択欄に重ねる

自動テスト: `corepack pnpm test`(`test_runtime_options.py` / `test_surface_model.py` / 両言語のワイヤ見本)。**認証が無いため信頼できる LAN 内でのみ試すこと。** 準備は「HID-205」の手順 1・2(mock-unity を 2 台、`segments` 定義、副系の設定)と同じにして、ブリッジと UI を `start-oscdesk.ps1` で起動する。

1. ブラウザで UI を開く。**期待**: 「セグメント」欄(`optionsFrom` を持つ欄)の候補が `(none)` / `Intro` / `Song A` / `Song B` になり、状態カードの下に「一覧を更新」ボタンが出る。`optionsFrom` を持たない定義を読み込むとボタンは出ない。
2. 「セグメント」欄で `Song B`(副系にしか無い名前)を選ぶ。**期待**: 両方の mock-unity が受け取り、欄は `Song B` のまま。
3. 副系を別の一覧(`Song C` だけ)で起動し直し、「一覧を更新」を押す。**期待**: 「Unity に一覧を要求しました」の通知が出て、画面を作り直さずに候補が `(none)` / `Intro` / `Song A` / `Song C` に変わる。欄は消えずに `Song B(一覧に無い)` と表示され、OSC は送られない。
4. 手順 3 のあと、ブラウザをもう 1 つ開く。**期待**: 新しいページでも同じ候補と `Song B(一覧に無い)` が出る。
5. 副系を `Song B` を含む一覧で再起動して「一覧を更新」を押す。**期待**: 候補に `Song B` が戻り、欄の表示が `Song B(一覧に無い)` から `Song B`(通常の選択表示)に戻る。
6. 欄を操作している最中(メニューを開いた状態)に別の端末で「一覧を更新」を押す。**期待**: 選んだ値は失われず、選択後に通常どおり 1 回だけ送信される。
7. ブリッジを止めて「一覧を更新」を押す。**期待**: 「ブリッジに接続していないため要求できませんでした」の通知が出る。
