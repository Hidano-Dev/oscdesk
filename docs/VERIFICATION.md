# VERIFICATION.md — 手動検証手順

各 Phase の完了時に、その Phase の動作確認手順を追記する。コマンドはリポジトリ root で実行する(PowerShell 想定)。

**認証が無いため、検証端末と Unity(または mock-unity)は信頼できる同一 LAN に置き、インターネットや信頼できないネットワークへ公開しない。**

## 基本の手動検証(ブリッジ + NiceGUI UI + Unity)

ブリッジと NiceGUI UI の 2 プロセスで Unity を操作する構成の確認手順。操作対象はサーフェス定義(OscDesk 側の JSON)で決まり、値の正はブリッジが持つ(DESIGN.md D-043〜D-046・D-051)。

### セットアップ

1. setup を手で実行する必要はない。下の起動ランチャーが、起動前に依存関係・ビルド成果物・UI の Python 仮想環境を確かめ、足りないか古ければ(clone 直後や、依存・ソースが変わる pull の後) `launchers/setup-oscdesk.ps1` を自動で実行してから起動する(D-068)。確認だけをしたいときは `-CheckOnly` を付ける(揃っていれば終了コード 0、足りなければ 2)。setup を明示的にやり直すときは、リポジトリ root で次を実行する(`launchers\setup-oscdesk.bat` のダブルクリックでもよい)。

   ```powershell
   .\launchers\setup-oscdesk.ps1
   ```

2. Unity を使う場合は `OscSurface/` を Unity Editor で開き、「HID-164: Unity の汎用 OSC レシーバ(OscReceiver)」の手順 1〜2 のとおり `OscReceiver` を付けた GameObject を用意して Play Mode にする。mock-unity で代替する場合は、次の起動で `-Mock` を付ける(ping/pong とエコーだけを返す)。

### 検証用ランチャー(`launchers/start-oscdesk-verify.ps1`)

手動検証の準備は検証用ランチャーが行う(HID-222)。config の手編集や、見本の定義の手作業での切り出しは要らない。

- `protocol/surface-definition-samples.json` の見本(`-Sample`、既定 `full-example`)を `surfaces/<-Name>.json`(既定 `stage`。`-Sample` を指定したときの既定は見本名)に置き、それを起動時に採用する。**同名のファイルが既にあれば上書きせずにそのまま使う**(検証の途中で定義を手で変えて起動し直す手順のため)。見本から作り直すときは `-Reset` を付ける(元のファイルは `surfaces/.backups/` へ退避される)
- 追跡対象の `config/oscdesk.config.json` は書き換えない。`logs/verify/oscdesk.verify.config.json` に一時 config を生成し、`launchers/start-oscdesk.ps1 -ConfigPath` で起動する。`-Diagnostics` で `config/oscdesk.debug.config.json` を元にし、診断 NDJSON を出す
- `-Secondary` で副系 `backup`(`127.0.0.1:7092`)を宛先に足す
- `-Mock` で mock-unity を別ウィンドウで起動する(主系 7090、`-Secondary` なら副系 7092 も)。`-OptionsReply` / `-SecondaryOptionsReply` で一覧の応答(`<要求アドレス>|<一覧のアドレス>|<名前>...`、複数はカンマ区切り)を足す。mock-unity のウィンドウには受信ログが出る。手順で「mock-unity を止めて起動し直す」ときは、そのウィンドウで Ctrl+C を押し、冒頭に表示されたコマンドを(必要なら一覧を変えて)打ち直す。ランチャーのウィンドウを閉じると mock-unity も止まる
- ブリッジの出力(`Resending …` / `Restored …` / `Requesting …` など)は、起動ウィンドウに `[bridge]` 付きで流れる(通常起動の `launchers/start-oscdesk.ps1` も同じ)

`launchers\start-oscdesk-verify.bat` をダブルクリックすると、引数なし(`full-example` を `stage` として採用、mock なし)で起動する。

### 起動と LAN 端末からの接続

1. Unity が待ち受けている状態で(mock-unity なら `-Mock` を付けて)、リポジトリ root から起動する。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1          # Unity を使う
   .\launchers\start-oscdesk-verify.ps1 -Mock    # mock-unity で代替する
   ```

   ブリッジと NiceGUI UI が起動し、`接続先 URL:` の下に LAN 用 URL が表示される。起動するプロセスはこの 2 つ(`-Mock` なら加えて mock-unity)だけである。

   ウィンドウの × ボタンで閉じた後、`netstat -aon | find "7091"` に node.exe が残らないことを確認する(子プロセスは Job Object で親と道連れになる)。念のため孤立した `oscdesk-bridge.js` の node.exe を手で作ってから起動すると、`前回の起動で残っていたプロセスを停止しました: node.exe PID …` と表示され、ポート使用中にならずに起動することを確認する。

2. 同じ LAN の別の PC またはスマートフォンで、起動ウィンドウに表示された `http://<この PC の LAN IP>:8080` を開く。画面上部にブリッジの接続済みと「定義: 採用済み — stage」が出て、定義の部品が描画されることを確認する。LAN IP が複数表示された場合は、検証端末と同じネットワークのアドレスを選ぶ。

3. 画面を数秒表示したままにし、Unity の表示が「接続中」になって RTT の数値が出ることを確認する。「未接続」のままなら、Unity の送信先・ブリッジの UDP 受信ポート 7091・Windows ファイアウォールを確認する(`docs/UNITY_PROTOCOL.md` §6.3)。

### ping/pong・エコーバック・保持値の再送

1. ブリッジから `/sys/ping` が送られ、Unity から `/sys/pong` が返り、画面の RTT・連続喪失回数が更新されることを確認する。Unity を一時停止して約 5 秒待つと「未接続」になり、再開すると「接続中」に戻ることも確認する。
2. 画面のスライダー、スイッチ、ボタンを操作する。操作値が Unity に届き、同じ値がエコーバックされることを確認する(NDJSON で送信 out と同じアドレスの受信 in が対になる)。スライダーを保持中に別の値が届いても表示が飛ばず、指を離した後に揃うことも確認する。
3. スライダーを既定値と違う値にしてから、Unity の Play Mode を止めて再開する(mock-unity なら止めて起動し直す)。数秒以内に起動ウィンドウのブリッジの出力に `Resending N desired value(s) to Unity "unity" (Unity recovered).` が出て、Unity に操作した値が届くことを確認する。ボタン(`trigger`)は再送されない。
4. 別の LAN 端末のブラウザでも同じ URL を開く。部品が崩れずに描画され、片方の端末で操作した値がもう片方にも反映されることを確認する(D-032 で失った実ブラウザ検査 E2E の代替として、目視で残すブラウザ描画確認)。

### ログと標準出力の観測場所

- NDJSON はリポジトリ root の `logs/diagnostics/` に出力される(debug 起動時。`launchers\start-oscdesk-debug.bat`、または検証用ランチャーに `-Diagnostics`)。ファイルは `oscdesk-*.ndjson` で、1 行が 1 JSON である。`ping`/`pong` と値の送受信を見る。

  ```powershell
  Get-ChildItem logs/diagnostics
  Get-Content (Get-ChildItem logs/diagnostics/*.ndjson | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -TotalCount 20
  ```

- ブリッジの標準出力は `OSCDESK_BRIDGE_READY {...}`、起動エラー、`(INFO, BRIDGE) Resending ...`、`(WARN, BRIDGE) Unity echo differs from desired value ...` などを見る場所である。ランチャー(`launchers/start-oscdesk*.ps1`)はブリッジを非表示で起動するが、その出力を起動ウィンドウに `[bridge]` 付きで中継する(起動完了行の JSON は除く。標準エラーは黄色)。以下の節で「ブリッジの標準出力に … が出る」とあるのは、この表示のことである。

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

1. `.\launchers\start-oscdesk-verify.ps1 -Mock -Reset` で起動する(`full-example` を `stage` として採用。上の「検証用ランチャー」)。
2. WebSocket クライアント(`npx wscat -c ws://127.0.0.1:7080` 等)で `{"v":1,"type":"surfaceRequest"}` を送る。**期待**: `surfaceList`(`active: "stage"`)と `surface`(`revision: 1`)が返る。
3. クライアントを 2 つ接続し、片方から `surfaceSave`(`name` を `stage`、`definition` の `name` を変えたもの)を送る。**期待**: 両方に `surface`(`revision: 2`)と `surfaceList` が届き、`surfaces/.backups/` に直前の内容が `stage.<時刻>.json` で残る。
4. `definition` に未知キーを足して送る。**期待**: 送った側だけに `notice`(`surface-rejected`)が届き、`surfaceRequest` の結果は変わらない。`stage.json` は書き換わらない。
5. `name` に `../x`・`CON`・`.backups` を入れた `surfaceSave` を送る。**期待**: `invalid-frame` の `notice` が返り、`surfaces/` の外にもファイルは作られない。
6. `curl http://127.0.0.1:7080/surfaces`、`curl -OJ http://127.0.0.1:7080/surfaces/stage.json`、`curl -X PUT --data-binary @stage.json http://127.0.0.1:7080/surfaces/uploaded.json` を実行する。**期待**: 一覧とダウンロードができ、PUT で全クライアントに `surface`(`name: "uploaded"`)が届く。壊れた JSON は 400、検証に通らない定義は 422 になる。
7. `surfaces/stage.json` を壊して(`{` だけにして)ブリッジを再起動する。**期待**: 警告ログが 1 行出て起動は続き、`surfaceRequest` の `active` は `null`。

## HID-161: 保持値と再接続時の再送(ブリッジ)

自動テスト: `corepack pnpm test`(`desired-values.test.ts` / `surface-core.test.ts` / `tests/e2e/desired-values.e2e.test.ts` / 両言語のワイヤ見本)。信頼できる LAN 内でのみ試すこと(認証なし)。

1. `.\launchers\start-oscdesk-verify.ps1 -Mock` で起動する(`full-example` は `trigger` と、`default` を持つ `state` を含む)。WebSocket クライアントで `surfaceRequest` を送る。**期待**: `surface`・`surfaceList` の後に `desired`(`full: true`、`state` の既定値だけ。`trigger` は含まれない)が届く。
2. `state` のアドレスへ `osc.message` を送る。**期待**: 全クライアントに `desired`(`full: false`)が届く。`trigger` のアドレスへ送っても `desired` は届かない。
3. mock-unity を止めて起動し直す。**期待**: 数秒以内に、手順 2 で送った値が Unity へ再送され(mock のエコーが `osc.message` フレームで届く)、`trigger` のアドレスは再送されない。
4. Unity 側でエコーが保持値と食い違う値を返すようにする(mock の手動送信等)。**期待**: ブリッジが `Unity echo differs from desired value` の警告を 1 回出し、`desired` は変わらない。

## HID-162: 冗長構成(複数の Unity と宛先ごとの再送)

自動テスト: `corepack pnpm test`(`surface-core.test.ts` / `schemas.test.ts` / `tests/e2e/redundant-targets.e2e.test.ts` / 両言語のワイヤ見本 / Python の `test_state.py`)。信頼できる LAN 内でのみ試すこと(認証なし)。

1. `.\launchers\start-oscdesk-verify.ps1 -Mock -Secondary` で起動する(mock-unity が 7090 と 7092 の 2 台で立ち、副系 `backup` が宛先に入る)。
2. 「再送」タブを開く(D-094 より前は画面の「Unity 宛先」の下)。**期待**: `unity` と `backup` が 1 台 1 行で並び、それぞれ「主系 / 接続中」「副系 / 接続中」になる。1 台構成の config では `unity` の 1 行だけが出る。
3. サーフェス定義を読み込み、スライダーを動かす。**期待**: 両方の mock-unity が値を受け取る(各 mock のログ、または WebSocket クライアントの `hello.targets` / `link.targets` で確認)。UI に出るエコーは主系の分だけ。
4. 副系の mock-unity だけを止めて起動し直す。**期待**: 数秒以内にブリッジのログに `Resending N desired value(s) to Unity "backup"` が出て、主系には出ない。バッジは一時的に「未接続」になり、戻る。
5. 「再送」タブの `backup` の行の「再送」を押す。**期待**: `to Unity "backup" (requested by UI)` のログが出て、主系へは送られない。「全台へ再送」では両方へ送られる。
6. WebSocket クライアントから `{"v":1,"type":"resend","target":"nope"}` を送る。**期待**: `notice`（`resend-rejected`）が返る。
7. 副系の mock-unity を止めたままスライダーを動かし、起動し直す。**期待**: 起動後に最新の値が副系だけへ再送される。

## HID-164: Unity の汎用 OSC レシーバ(OscReceiver)

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests`。CI の `Unity CI` で全件実行)。UI / ブリッジ側の `corepack pnpm test` の対象外。信頼できる LAN 内でのみ試すこと(認証なし)。

1. `OscSurface/` を Unity 6000.0.36f1 で開き、空の GameObject に `OscReceiver` を追加する。`Listen Port` を 7090、`Reply Host` / `Reply Port` を OscDesk ホストの 7091 に設定する(D-095 より前は `uOscServer` / `uOscClient` に設定していた)。
2. 適当なスクリプトに `public void OnMaster(float v)` と `public void OnGo()` を用意し、`Bindings` に `/mix/master`(Float)と `/cue/go`(Trigger)の行を足して、各イベントへ登録する。
3. 「定義ファイル」にサーフェス定義 JSON を設定する。**期待**: 定義にないアドレスの行と、行が無いアドレスが警告で出る。「定義にあって行が無いアドレスの行を追加」で不足分の行が型つきで増える。
4. Play してブリッジと UI を起動し、スライダーを動かし、GO ボタンを押す。**期待**: `OnMaster` が値つきで、`OnGo` が押すたびに呼ばれ、UI の値がエコーで確定する。
5. 登録のないアドレスへ送る(定義にあるが行がないパラメータを操作する)。**期待**: Console には何も出ず(D-102 で既定を変えた)、UI の値はエコーで確定する。`OscReceiver` の `Log Unbound Addresses` をオンにして同じ操作を繰り返すと、`no binding for ...` がそのアドレスにつき 1 回だけ出る。
6. 行の型と合わない値を送る(Int の行へ文字列等)。**期待**: `argument type mismatch` が出てイベントは呼ばれない。

## HID-193: UI のサーフェス定義駆動化

自動テスト: `corepack pnpm test`(Python の `test_state.py` / `test_surface_model.py` / `test_browser_*_events.py` / `test_entry_rules.py`、両言語のワイヤ見本)。信頼できる LAN 内でのみ試すこと(認証なし)。

1. `.\launchers\start-oscdesk-verify.ps1 -Mock -Reset` で起動する(`full-example` を `stage` として採用)。
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

1. `.\launchers\start-oscdesk-verify.ps1 -Sample action-sequence -Mock` で起動する(スロットは Unity が応答する実機または受信ログを見られる受信側で確認する)。**期待**: 画面に Slot 1・Slot 2・Mode のスライダー/選択と「Apply all」ボタンが出る(ボタンには定義のラベルだけを出し、件数は付け足さない。D-069)。

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

1. 見本 `options-from-shared-address` を `segments` として採用し、違う一覧を返す mock-unity を 2 台(主系と副系 `backup`)立てて起動する。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Sample options-from-shared-address -Name segments -Mock -Secondary `
     -OptionsReply '/mb/segments/get|/mb/segments|Intro|Song A' -SecondaryOptionsReply '/mb/segments/get|/mb/segments|Song A|Song B'
   ```

2. **期待**: 2 台が接続中になった時点で、ブリッジの標準出力に `Requesting 1 option list(s) from Unity "unity" (Unity first reachable).` と同じ行の `"backup"` 版が出る。
3. WebSocket クライアント(`npx wscat -c ws://127.0.0.1:7080` 等)で `{"v":1,"type":"surfaceRequest"}` を送る。**期待**: `desired` の後に `runtimeOptions` が届き、`lists[0].targets` が `unity: ["Intro","Song A"]`・`backup: ["Song A","Song B"]`、`choices` が両パラメータとも `["(none)","Intro","Song A","Song B"]` になる。`/mb/segments` と `/mb/segments/get` の `osc.message` フレームは届かない。
4. `{"v":1,"type":"osc.message","address":"/member/1/segment","args":[{"type":"s","value":"Song B"}]}` を送る。**期待**: 副系にしか無い名前でも `desired`(`full: false`)に入り、両方の mock-unity が受け取る。
5. 副系の mock-unity を止める。**期待**: `link` で `backup` が `lost` になっても、`runtimeOptions` は送り直されず、手順 3 の `surfaceRequest` を送り直しても `backup` の一覧が残っている。
6. 副系を別の一覧(例: `'/mb/segments/get|/mb/segments|Song C'`)で起動し直す。**期待**: `Requesting ... "backup" (Unity recovered).` が出て主系には出ず、`runtimeOptions` の `pending` に `backup` の `added: ["Song C"]`・`removed: ["Song A","Song B"]` が載る(HID-327 以降。`lists`・`choices` はまだ変わらない)。`{"v":1,"type":"runtimeOptionsApply"}` を送ると、`runtimeOptions` の `backup` が `["Song C"]` に置き換わる。`choices` は `["(none)","Intro","Song A","Song C"]` になり、手順 4 の `Song B` は保持値に残る(`surfaceRequest` の `desired` で確認。主系を再起動すると `Song B` が再送される)。
7. `{"v":1,"type":"runtimeOptionsRefresh"}` を送る。**期待**: `Requesting ... (requested by UI).` が両方の宛先について出る。一覧が変わらなければ `runtimeOptions` は届かない。
8. 定義から `optionsFrom` を外して保存する(`surfaceSave`)。**期待**: `runtimeOptions` が `lists: []`・`choices: []` で届き、以後ブリッジは一覧の要求を送らない(`/mb/segments` に届くものは通常のエコーとして扱われる)。

## HID-206: Unity の一覧を UI の選択欄に重ねる

自動テスト: `corepack pnpm test`(`test_runtime_options.py` / `test_surface_model.py` / 両言語のワイヤ見本)。**認証が無いため信頼できる LAN 内でのみ試すこと。** 準備は「HID-205」の手順 1 と同じコマンドで起動する(mock-unity を 2 台、`segments` 定義、副系の設定)。

1. ブラウザで UI を開く。**期待**: 「セグメント」欄(`optionsFrom` を持つ欄)の候補が `(none)` / `Intro` / `Song A` / `Song B` になり、状態カードの下に「一覧を更新」ボタンが出る。`optionsFrom` を持たない定義を読み込むとボタンは出ない。
2. 「セグメント」欄で `Song B`(副系にしか無い名前)を選ぶ。**期待**: 両方の mock-unity が受け取り、欄は `Song B` のまま。
3. 副系を別の一覧(`Song C` だけ)で起動し直し、「一覧を更新」を押す。**期待**: 「Unity に一覧を要求しました」の通知が出る。HID-327 以降は「新しい一覧があります」が出るので「反映」を押す。画面を作り直さずに候補が `(none)` / `Intro` / `Song A` / `Song C` に変わる。欄は消えずに `Song B(一覧に無い)` と表示され、OSC は送られない。
4. 手順 3 のあと、ブラウザをもう 1 つ開く。**期待**: 新しいページでも同じ候補と `Song B(一覧に無い)` が出る。
5. 副系を `Song B` を含む一覧で再起動して「一覧を更新」を押す(HID-327 以降は続けて「反映」を押す)。**期待**: 候補に `Song B` が戻り、欄の表示が `Song B(一覧に無い)` から `Song B`(通常の選択表示)に戻る。
6. 欄を操作している最中(メニューを開いた状態)に別の端末で「一覧を更新」を押す。**期待**: 選んだ値は失われず、選択後に通常どおり 1 回だけ送信される。
7. ブリッジを止めて「一覧を更新」を押す。**期待**: 「ブリッジに接続していないため要求できませんでした」の通知が出る。

## HID-207: OscReceiver から Unity の一覧が届く

自動テスト: CI の `Unity CI`(`OscDesk.Receiver.Tests`。`OscStringList` の見積りと上限、`optionsFrom.request` の取り込みと A5)。**認証が無いため信頼できる LAN 内でのみ試すこと。** 実 Unity(`OscSurface/`)で行う。

1. 定義の `parameters` に `optionsFrom: { "address": "/mb/segments", "request": "/mb/segments/get" }` を持つ `s` の state を 1 つ置き、`OscReceiver` の「定義ファイル」に設定する。インスペクタに「定義にあるアドレスに対応する行がありません: /mb/segments/get」(A5)が出て、`/mb/segments` については出ない。**期待**: 「定義にあって行が無いアドレスの行を追加」で `/mb/segments/get` が Trigger の行として足される。
2. その Trigger 行に、`GetComponent<OscReceiver>().SendStrings("/mb/segments", new[] { "(none)", "Intro", "Song A" })` を呼ぶ自前の public 関数を登録する。Play してブリッジと UI を `launchers/start-oscdesk.ps1` で起動する。**期待**: UI の選択欄の候補が `(none)` / `Intro` / `Song A` になる(ブリッジの `runtimeOptions`)。
3. UI の「一覧を更新」を押す。**期待**: Unity の関数が 1 回呼ばれ、候補は変わらない。関数の中身を `Song B` を足す形に変えて Play し直し、同様に押すと候補に `Song B` が加わる(HID-327 以降は「新しい一覧があります」の「反映」を押してから加わる)。
4. 構成変更の自発送信として、Play 中に同じ関数を直接呼ぶ(例: ボタンから)。**期待**: 要求なしで UI の候補が更新される(HID-327 以降は、変わった一覧が「新しい一覧があります」に出て、「反映」で更新される)。
5. 61,000 バイトを超える一覧(例: 20,000 件)を `SendStrings` に渡す。**期待**: false が返り、Console に「一覧を送りませんでした … 大きすぎます」が出る。UI の候補は変わらない。

## HID-211: 保持値のブリッジ再起動をまたいだ復元(ブリッジ)

自動テスト: `corepack pnpm test`(`desired-values.test.ts` / `desired-values-file.test.ts` / `surface-core.test.ts` / `config.test.ts` / `tests/e2e/desired-values-persistence.e2e.test.ts`)。**認証が無いため信頼できる LAN 内でのみ試すこと。** 保存ファイルの中身も、認証の無い UI の操作で書き換わる。

1. 前回の `surfaces/.values/stage.values.json` があれば消し、`.\launchers\start-oscdesk-verify.ps1 -Mock -Reset` で起動する(`full-example` は `trigger` と、`default` を持つ `state` を含む)。以降の「起動し直す」は `-Reset` を付けずに同じコマンドで行う(手順 4 で変えた `stage.json` を残すため)。**期待**: 1 秒以内に `surfaces/.values/stage.values.json` ができ、`format: "oscdesk-desired-values"`・`version: 2`(HID-215 で 1 から上げた。`records` は空)・`surface: "stage"` と `state` の既定値が入っている(`trigger` は入らない)。
2. UI で `state` の値を動かす(スライダーをドラッグし続ける等)。**期待**: 操作をやめてから 1 秒以内にファイルの `values` が最後の値になる。ドラッグ中の書き込みは 0.5 秒に 1 回程度に間引かれ、フォルダに `*.tmp` が残らない。
3. 操作から 1 秒以上待ってブリッジを止め(ランチャーのウィンドウを閉じる等)、起動し直す。**期待**: 標準出力に `Restored N of N saved desired value(s) for surface "stage".` が出る。UI の表示値は手順 2 の値のままで、mock-unity(実機なら Unity)には初回の到達で手順 2 の値が送られる(`Resending ... (Unity first reachable)`)。`trigger` は送られない。
4. ブリッジを止め、`surfaces/stage.json` の `state` のパラメータの 1 つの `id` を変える(または保存値が外れるように `range` を狭める)。起動し直す。**期待**: そのパラメータだけが定義の `default` で始まり、他は手順 2 の値が戻る(`Restored N-1 of N ...`)。
5. ブリッジを止め、`surfaces/.values/stage.values.json` を `{` だけにして起動する。**期待**: `(WARN, BRIDGE) Desired values for surface "stage" not restored (starting from defaults): ...` が 1 行出て、起動は続き、全パラメータが `default` から始まる。壊れたファイルは起動時の採用の直後に既定値の内容で書き直される。
6. 稼働中に UI の編集モードで別の定義(例 `stage-b`)を読み込む。**期待**: 値は従来どおりメモリ上の値が引き継がれ(D-045。ファイルからは読まない)、`surfaces/.values/stage-b.values.json` ができる。`stage.values.json` は切り替え前の値のまま残る。

## HID-209: OscReceiver の受信観測(最終受信時刻と途絶/再開イベント)

1. `OscReceiver` の `Silence Timeout Seconds` を 3 にし、`onLinkLost` / `onLinkResumed` に `Debug.Log` を呼ぶ関数を登録して Play Mode にする。
2. ブリッジを起動して接続する。`/sys/ping` が届く間はどちらのログも出ないこと。
3. ブリッジを停止して 3 秒以上待つと `onLinkLost` が 1 回だけ呼ばれること。
4. ブリッジを再起動すると `onLinkResumed` が 1 回だけ呼ばれること。
5. 自動テスト(`OscLinkMonitorTests`)は CI の `Unity CI` で実行される。

## HID-214: レコード型パラメータの定義の受理/拒否

自動テスト: `corepack pnpm test`(`surface-definition.test.ts` / `surface-record.test.ts` / `test_surface_definition.py` / 両言語のワイヤ見本。`protocol/surface-definition-samples.json` のレコード関連 77 件を TS と Python が同じ判定にする)。**認証が無いため信頼できる LAN 内でのみ試すこと。** 保持値と UI のレコード表は HID-215 / HID-216 で扱うので、ここではブリッジの HTTP で定義の検証だけを確かめる(UI はまだ record ノードを描画できない)。

1. 見本から定義を取り出す(不正な見本も取り出せる)。

   ```powershell
   foreach ($n in 'records-basic', 'record-state-field-without-default', 'action-node-row-scope') { node scripts/verify-surface.mjs export $n "logs/verify/$n.json" }
   ```

2. ブリッジを起動し(`launchers\start-oscdesk-debug.bat` 等)、`curl.exe -X PUT --data-binary "@logs/verify/records-basic.json" "http://127.0.0.1:7080/surfaces/members.json?activate=0"` を送る。**期待**: 200 で保存され、`surfaces/members.json` ができる。
3. `record-state-field-without-default.json` と `action-node-row-scope.json` を同様に PUT する。**期待**: どちらも 422 で、本文に `state record field requires default` / `row-scoped action must be placed in rowActions` が含まれ、ファイルは保存されない。
4. `surfaces/members.json` を消す(手順 1 の JSON は追跡対象外の `logs/verify/` にあるので残してよい)。

## HID-210 / HID-217: OscReceiver の名前空間・レコードの行

受信の観測(HID-209)は上の節を参照(D-060)。

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests`。CI の `Unity CI` で全件実行。`OscRecord` の取り出し、Record の行の振り分けと拒否、`records` の取り込み、A5・A6)。UI / ブリッジ側の `corepack pnpm test` の対象外。**認証が無いため信頼できる LAN 内でのみ試すこと。** 実 Unity(`OscSurface/`、6000.0.36f1)で行う。ブリッジ・UI がレコードに対応する前でも、WebSocket クライアント(`npx wscat -c ws://127.0.0.1:7080` 等)から `osc.message` フレームで同じメッセージを送れば確かめられる。

1. 「HID-164」の手順 1 で `OscReceiver` を置いた既存のシーンを開く。**期待**: Missing Script にならず、対応表と登録した関数が残っている。Add Component の検索で `OscReceiver` を探すと 1 つだけ出る。自前のスクリプトから `OscReceiver` を参照している場合は `using OscDesk.Receiver;` が無いとコンパイルエラーになる(破壊的変更)。
2. 定義に `records` を足す(`member` = `/vp/member`、`state`、フィールド `active`(bool)・`slot`(i)・`ip`(s)・`segment`(s)、`keysFrom: { "address": "/vp/members/list", "request": "/vp/members/request" }`)。`OscReceiver` の「定義ファイル」に設定する。**期待**: インスペクタに `/vp/member` と `/vp/members/request` の A5 が出て、`/vp/members/list` については出ない。「定義にあって行が無いアドレスの行を追加」で `/vp/member` が Record の行(`Record Fields` = `active` `slot` `ip` `segment`)、`/vp/members/request` が Trigger の行として増える。
3. `/vp/member` の行の `Record Fields` から `segment` を消す。**期待**: A6(フィールド id が定義と違う)が出る。「Record の行のフィールド id を定義に合わせる」を押すと元の 4 つに戻り、A6 が消える。登録した関数は残る。
4. `UNITY_PROTOCOL.md` §5 の例の `MemberHost` を置き、`OnMember` を `/vp/member` の行に **Dynamic OscRecord** で、`OnMembersRequested` を `/vp/members/request` の行に登録して Play する。`{"v":1,"type":"osc.message","address":"/vp/member","args":[{"type":"s","value":"メンバーA"},{"type":"i","value":1},{"type":"i","value":3},{"type":"s","value":"192.168.0.21"},{"type":"s","value":"(none)"}]}` を送る。**期待**: Console に `メンバーA active=True slot=3 ip=192.168.0.21` が出る。WebSocket クライアントに同じアドレス・同じ引数のエコー(`osc.message` フレーム)が届く。
5. 先頭をキーでなくした `{"v":1,"type":"osc.message","address":"/vp/member","args":[{"type":"i","value":1}]}` と、フィールドが 2 つしか無いメッセージを送る。**期待**: `OnMember` は呼ばれず、Console に `record mismatch for /vp/member (record): 先頭の引数がキーの s ではありません(Int32)` / `フィールドの数が行の設定と違います(受信 2 個、設定 4 個)` が出る。どちらもエコーは届く。
6. `{"v":1,"type":"osc.message","address":"/vp/members/request","args":[]}` を送る(ブリッジがレコードに対応した後は、UI の「一覧を更新」や Unity の初回到達で送られる)。**期待**: `OnMembersRequested` が呼ばれ、ブリッジへ `/vp/members/list` に `s` 2 個の一覧が届く(debug 起動なら NDJSON で確認できる)。

## HID-215: レコードのキーごとの保持値・行の生成・再送・保存(ブリッジ)

自動テスト: `corepack pnpm test`(`runtime-options.test.ts` / `desired-values.test.ts` / `desired-values-file.test.ts` / `surface-core.test.ts` / `tests/e2e/record-values.e2e.test.ts` / `tests/e2e/desired-values-persistence.e2e.test.ts`)。**認証が無いため信頼できる LAN 内でのみ試すこと。** UI のレコード表はまだ無い(HID-216)ので、WebSocket クライアント(`npx wscat -c ws://127.0.0.1:7080` 等)とブリッジの標準出力、mock-unity で確かめる。

1. 前回の `surfaces/.values/members.values.json` があれば消し、見本 `records-basic` を `members` として採用し、キーの一覧を返す mock-unity と一緒に起動する(`--options-reply` は optionsFrom と同じ仕組みで keysFrom にも使える)。以降の「起動し直す」は `-Reset` を付けずに同じコマンドで行う。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Sample records-basic -Name members -Reset -Mock -OptionsReply '/vp/members/request|/vp/members/list|Alpha|Bravo'
   ```

2. **期待**: 初回の到達で、ブリッジの標準出力に `Requesting 2 option list(s) from Unity "unity" (Unity first reachable).` に続いて `Sending 2 new record row(s) to Unity "unity".` が出て、mock-unity が `/vp/member` を `Alpha` と `Bravo` の 2 メッセージ(`s:キー i:0 i:1 s:"" s:"(none)"`)で受ける。
3. WebSocket クライアントで `{"v":1,"type":"surfaceRequest"}` を送る。**期待**: `desired`(`full: true`)の `values` に `/mix/master` と、`/vp/member` が `Alpha` / `Bravo` の 2 エントリ(`args` の先頭がキー)で並ぶ。続く `runtimeOptions` に `keys: [{"record":"member","keys":["Alpha","Bravo"]},{"record":"memberUpdate","keys":["Alpha","Bravo"]}]` と `fieldChoices: [{"record":"member","field":"segment","options":["(none)"]}]` があり、`lists` に `/vp/members/list` が含まれる。`/vp/members/list` と `/vp/members/request` の `osc.message` フレームは届かない。
4. `{"v":1,"type":"osc.message","address":"/vp/member","args":[{"type":"s","value":"Bravo"},{"type":"i","value":1},{"type":"i","value":7},{"type":"s","value":"10.0.0.5"},{"type":"s","value":"Song X"}]}` を送る。**期待**: `desired`(`full: false`)に `Bravo` の 1 エントリだけが届く(`Song X` は静的な `options` に無いが `optionsFrom` を持つので保持される)。`slot` を 99 にした同じ形を送ると、mock-unity には届くが `desired` は届かない(値域外は保持しない)。
5. `{"v":1,"type":"resend"}` を送る。**期待**: `Resending 3 desired value(s) ...` が出て、mock-unity が `/mix/master` と `/vp/member` をキーごとに 1 メッセージずつ(計 3 個)受ける。`/vp/member/update` は送られない。
6. mock-unity を止め、一覧から `Bravo` を外し `Charlie` を足して起動し直す(`'/vp/members/request|/vp/members/list|Alpha|Charlie'`)。**期待**: 回復の再送で `Alpha` と `Bravo`(一覧から消えても行は残る)が送られ、続く一覧の受信で `Charlie` の行だけが新しく作られて送られる。`desired`(`full: false`)は `Charlie` の 1 エントリ。
7. 1 秒以上待って `surfaces/.values/members.values.json` を開く。**期待**: `version: 2` で、`records` に `member` の行が `Alpha` / `Bravo` / `Charlie` の 3 件、各行の `fields` が `id`・`type`・`arg` で並ぶ(`memberUpdate` は無い)。
8. ブリッジを止めて起動し直す。**期待**: `Restored 4 of 4 saved desired value(s) for surface "members".` が出て、手順 3 の `surfaceRequest` の `desired` に手順 4 の `Bravo` の値が戻っている(一覧に無い `Bravo` も戻る)。初回の到達で 4 個がキーごとに送り直される。
9. ブリッジを止め、`surfaces/members.json` の `slot` の `range` を `[1, 4]` に狭めて起動し直す。**期待**: `Bravo` の行は `slot` だけが `default`(1)に戻り、他のフィールド(`active`・`ip`・`segment`)は保存値のまま。
10. `version: 1` の古いファイル(`records` 欄の無い HID-211 の形式)を置いて起動する。**期待**: 警告は出ずにパラメータの値が戻り、次の保存で `version: 2` に書き直される。

## HID-216: UI のレコード表(行 = キー)と行・全行のアクション

自動テスト: `corepack pnpm test`(`test_records.py`。モデルの畳み込み・行の順と印・行単位の送信と間引き・エコーの振り分け・row / all アクションの展開と上限・編集モードでの保持・NiceGUI の表の要素生成)。**認証が無いため信頼できる LAN 内でのみ試すこと。** ブリッジ側のキーの一覧の配信(`runtimeOptions.keys` / `fieldChoices`)とレコードの保持値は HID-215 で入る。HID-215 が入る前のブリッジでは、手順 2 で表の見出しと「行がありません(Unity のキーの一覧待ち)」が出るところまでを確かめる。

1. 前回の `surfaces/.values/members.values.json` があれば消し、見本 `records-basic` を `members` として採用し、キーの一覧とセグメントの一覧を返す mock-unity と一緒に起動する(既存の `--options-reply` をキーの一覧にもそのまま使う)。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Sample records-basic -Name members -Reset -Mock `
     -OptionsReply '/vp/members/request|/vp/members/list|メンバーA|メンバーB', '/vp/segments/request|/vp/segments/list|Intro|Song A'
   ```

2. ブラウザで UI を開く。**期待**: 「メンバー」の表が出て、見出しが「メンバー名」「Active」「Slot」「Seg」。行は `メンバーA` → `メンバーB` の順で、値は定義の `default`(Active off、Slot 1、Seg `(none)`)。各行の末尾に「Update」、表の下に「UPDATE ALL」「ALL ACTIVE」(定義のラベルのまま。「(全行)」は付かない。D-069)、状態カードの下に「一覧を更新」が出る。Seg の候補は `(none)` / `Intro` / `Song A`。
3. `メンバーA` の Active をオンにする。**期待**: mock-unity が `/vp/member s:"メンバーA" i:1 i:1 s:"" s:"(none)"` を 1 メッセージで受け取る(行の全フィールド。debug 起動なら NDJSON で確認できる)。表は作り直されず、他の行の値も変わらない。Slot のスライダーをドラッグすると、送信は間引かれ、離した時点の値が最後に必ず送られる。
4. `メンバーB` の行の「Update」を押す。**期待**: `osc.batch` 1 個で `/vp/member s:"メンバーB" …` → `/vp/member/update s:"メンバーB"` の順に届き、エコーが揃うと「「Update」を送信しました(2 件を確認)」が出る。
5. 「ALL ACTIVE」を押す。**期待**: 全行の `/vp/member` が表示順に Active=1 で 1 個の bundle で届き、表の Active が全行オンになる。「UPDATE ALL」は行ごとに `/vp/member` → `/vp/member/update` の順になる。
6. mock-unity を `メンバーB` を含まない一覧(`'/vp/members/request|/vp/members/list|メンバーA'`)で起動し直し、「一覧を更新」を押す。**期待**: 画面を作り直さずに `メンバーB` の行が末尾へ移り、キーの下に「(一覧に無い)」が出る。値は保持値のまま残る。操作中(入力欄にフォーカスがある等)の欄は壊れない。
7. mock-unity を新しい名前を含む一覧(`'…|メンバーA|メンバーB|メンバーC'`)で起動し直し、「一覧を更新」を押す。**期待**: `メンバーC` の行が `default` の値で増え、`メンバーB` の印が消えて一覧の順に戻る。
8. 編集モードに切り替え、レコード表を上下に動かして保存する。**期待**: 「レコード表: メンバー (member)」と「レコード(編集は JSON で行います)」の一覧が出る。保存した定義(ダウンロードで確認)に `records` と `scope` 付きのアクションがそのまま残る。
9. 不要なら `surfaces/members.json` と `surfaces/.values/members.values.json` を消す(config は書き換えていないので戻すものは無い)。

## HID-253: レコード表の列のアクション(列の直下のフッター行)

自動テスト: `corepack pnpm test`(`surface-definition.test.ts` と `test_surface_definition.py` の見本 `records-column-action*` の受理/拒否と報告文言の一致、`test_records.py` の列への畳み込み・フッター行の生成と押下の展開)。**認証が無いため信頼できる LAN 内でのみ試すこと。**

1. 前回の `surfaces/.values/members.values.json` があれば消し、見本 `records-column-actions`(`records-basic` の Active 列に「All Active」「All Inactive」を置き、表の外には「Update All」だけを置いたもの)を `members` として採用して起動する。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Sample records-column-actions -Name members -Reset -Mock `
     -OptionsReply '/vp/members/request|/vp/members/list|メンバーA|メンバーB', '/vp/segments/request|/vp/segments/list|Intro|Song A'
   ```

2. ブラウザで UI を開く。**期待**: 「メンバー」の表の枠内で、最後の行(`メンバーB`)の下にフッター行が 1 行あり、Active 列の直下に「All Active」「All Inactive」が各行のトグルと同じ幅・高さのカードに収まって並ぶ。キー・Slot・Seg・行のアクションの欄の直下は空。「Update All」は表の外(下)に出て、列のアクションとは別の位置にある。狭い画面では、フッター行も行と一緒に表の中だけで横スクロールする。
3. 「All Active」を押す。**期待**: 全行の `/vp/member` が表示順に Active=1 で 1 個の bundle で届き、表の Active が全行オンになる。「All Inactive」を押すと同様に全行が Active=0 になる。
4. mock-unity を `メンバーC` を足した一覧で起動し直し、「一覧を更新」を押す。**期待**: 行が増えてもフッター行は表の最後(`メンバーC` の下)に残り、「All Inactive」を押すと `メンバーC` も含めた全行へ届く。
5. `logs/verify/` に `records-column-action-row-scope` を書き出して PUT する(`node scripts/verify-surface.mjs export records-column-action-row-scope logs/verify/records-column-action-row-scope.json` の後に `curl.exe -X PUT --data-binary "@logs/verify/records-column-action-row-scope.json" "http://127.0.0.1:7080/surfaces/bad.json?activate=0"`)。**期待**: 422 で、本文に `column action must have scope all` が含まれ、ファイルは保存されない。
6. 不要なら `surfaces/members.json` と `surfaces/.values/members.values.json` を消す。

## HID-255: 編集モードのスイッチの当たり判定

自動テスト: `corepack pnpm test`(`test_editor_page.py`。スイッチがラベルを持たず、表示用のラベルが別要素で、行が横に伸びないこと)。**認証が無いため信頼できる LAN 内でのみ試すこと。**

1. `.\launchers\start-oscdesk-verify.ps1 -Mock` で起動し、ブラウザ(PC とスマホ幅の両方)で UI を開く。**期待**: 状態カードの下にトグルと「編集モード」の文字が並んで見える。
2. 「編集モード」の文字、およびその右側の空白(行の右端まで)を押す。**期待**: 編集モードに入らない(トグルはオフのまま、保存などの編集用の操作が出ない)。
3. トグル本体を押す。**期待**: 編集モードに入り、作業コピーの木と保存などの操作が出る。もう一度トグルを押すとオフに戻る。

## HID-254: レコード表の行の高さをそろえる

> 見た目は HID-280(D-072)で置き換えた。現行の確認は「HID-280」節で行う。以下は当時の手順として残す。

自動テスト: 当時は `test_records.py` の `test_record_row_cells_share_the_row_height`(行の stretch、入力欄・選択の dense、カードとボタンの伸長)。見た目の高さは自動テストでは測らないので、ブラウザで確かめる。**認証が無いため信頼できる LAN 内でのみ試すこと。**

1. HID-216 の手順 1 と同じく `records-basic` を `members` として mock-unity と一緒に起動する。続けて `surfaces/members.json` の `record` ノードの `columns` から `slot` を外し、`{ "field": "ip" }` を足して保存し、起動し直す(入力欄・選択・スイッチ・ボタンの並ぶ行にするため)。
2. ブラウザで UI を開く。**期待**: 各行で Active のスイッチのカード、IP の入力欄のカード、Seg の選択のカード、「Update」ボタンの矩形の上端と下端がそろう(既定の画面で高さ 72px 前後)。キーの名前は行の縦中央に出る。
3. `slot` の列を戻して起動し直す。**期待**: スライダーを含む行では、すべての欄とボタンがスライダーのカードの高さにそろう(行の中では揃い、スイッチの高さより高くなる。D-070 の既知の限界)。
4. 確認後、`surfaces/members.json` を見本に戻す(`-Reset` で作り直すか、ファイルを消す)。

## HID-256 / HID-257: 送信 OSC のログと通知の履歴

自動テスト: `corepack pnpm test`(`sent-log.test.ts`。記録の間引き・まとめ送りの印・件数上限・既存分の分割と `full`・引数の切り詰め・surface-core が渡す送信契機(ping は渡さない)。`sent-log.e2e.test.ts`。実ブリッジで UI の送信とまとめ送りが `osc.sentLog` で全 UI へ届き、後から接続した UI に既存分が届く。`test_sent_log.py` / `test_notify_history.py`。フレームの検証・表示キャッシュ・通知の履歴・`ui.notify` の直接呼び出しが無いこと・ドロワーの表)。**認証が無いため信頼できる LAN 内でのみ試すこと。** 設計は `DESIGN.md` D-067。

1. 見本を採用して mock-unity と一緒に起動する。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Mock -Secondary
   ```

2. ブラウザで UI を開き、ヘッダーの「ログ」を押す。**期待**: 右からドロワーが開き、「送信ログ」が選ばれている。Unity が初めて到達した時点の再送(契機「再送」)が宛先 `unity` / `backup` ごとに並ぶ。`/sys/ping` は出ない。
3. スライダーを数秒ドラッグする。**期待**: 送信ログの先頭に契機「操作」・宛先 `unity, backup` の 1 行が出て、「回数」が増えていく(同じアドレスへの連続送信は 1 秒の窓で 1 行にまとまる)。表は 0.5 秒ごとに更新され、ドラッグ中も画面が重くならない。
4. アクション(まとめ送り)のボタンを押す。**期待**: 契機「まとめ送り」の行がバッチ内のメッセージ数だけ並び、「まとめ送り」の欄に `#<番号> 1/N`〜`N/N` が出る。
5. 別の端末(または別タブ)で同じ URL を開いて「ログ」を押す。**期待**: それまでの送信ログが同じ内容で出る(ブリッジが接続時に既存分を送る)。片方で操作すると、もう片方の送信ログにも 0.5 秒以内に出る。
6. 存在しない名前で保存する(編集モードで保存名に `../x` を入れて「保存」)など、トーストが出る操作をする。ドロワーの「通知履歴」に切り替える。**期待**: 時刻・種類(エラー・警告・情報など)・本文の行が新しい順に出る。トーストが消えた後も残る。別の端末の通知履歴には出ない(履歴はページごと)。「消去」で空になる。ページを再読み込みすると通知履歴は空になるが、送信ログは残る(ブリッジから届き直す)。
7. ブリッジを止めて起動し直す。**期待**: UI の再接続後、送信ログは起動し直した後の記録だけになる(古い記録は捨てられる)。送信ログはブリッジのメモリにだけあり、保存されない。完全な証跡が要るときは `-Diagnostics` で起動し、`logs/diagnostics/*.ndjson` の送信(out)を見る。

## HID-258: ランチャーの launchers/ への移動と起動時の自動 setup

1. リポジトリ直下を見る。**期待**: ランチャーは `start-oscdesk.bat` だけで、用途別ランチャー(`start-oscdesk-debug` / `-touchosc` / `-verify`)と `setup-oscdesk` は `launchers/` に、共通部品は `launchers/lib/` にある。
2. 環境が揃った状態で `.\launchers\start-oscdesk.ps1 -CheckOnly` を実行する。**期待**: 「環境の確認: 揃っています。」が出て終了コード 0。`launchers\start-oscdesk-debug.ps1` / `-touchosc.ps1` / `-verify.ps1` に `-CheckOnly` を付けても同じ(debug は使う config の絶対パスも出る)。直下の `start-oscdesk.bat -CheckOnly` も同じ表示になる。
3. `packages/shared/src/index.ts` の更新日時を新しくする(PowerShell で `(Get-Item packages\shared\src\index.ts).LastWriteTime = Get-Date`)。`-CheckOnly` を実行する。**期待**: 「ブリッジのビルド成果物がソースより古くなっています」「mock-unity のビルド成果物がソースより古くなっています」が出て終了コード 2。`-SkipSetup` を付けて起動すると、同じ理由のエラーで止まる。
4. そのまま `start-oscdesk.bat` をダブルクリックする。**期待**: 「setup を自動で実行します...」の後に setup の 3 手順が同じウィンドウに流れ、完了するとブリッジと UI が起動して接続先 URL が出る。もう一度 `-CheckOnly` を実行すると揃っている。
5. (任意、数分かかる)`packages/nicegui-ui/.venv` を別名に変えて `start-oscdesk.bat` をダブルクリックする。**期待**: 「UI の Python 仮想環境(packages/nicegui-ui/.venv)がありません」と出て setup が仮想環境を作り直し、起動する。確認後、別名にした仮想環境は消してよい。
6. `launchers\setup-oscdesk.bat` を単体でダブルクリックする。**期待**: setup だけが走り、最後に「=== セットアップ完了 ===」が出てウィンドウが止まる(何度実行してもよい)。
7. `corepack pnpm test` を実行する。**期待**: `tests/guards/launcher-scripts.test.ts`(`.bat` が ASCII だけ・`.ps1` が UTF-8 BOM 付き・直下のランチャーは `start-oscdesk.bat` だけ・各 bat の呼び先の `.ps1` が存在する)を含めて緑。

## HID-280: レコード表の欄をカードで包まず低い 1 段にそろえる

自動テスト: `corepack pnpm test`(`test_records.py` の `test_record_row_cells_are_compact_and_unboxed`。カードが flat で影が無いこと、入力欄・選択・スイッチの dense、行の縦中央寄せと下罫線)。見た目の高さは自動テストでは測らないので、ブラウザで確かめる。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. HID-254 の手順 1 と同じく、`records-basic` を `members` として mock-unity と一緒に起動し、`record` ノードの `columns` の `slot` を `{ "field": "ip" }` に置き換えて起動し直す。
2. ブラウザで UI を開く。**期待**: Active のスイッチ・IP の入力欄・Seg の選択に枠(カード)が無く、行の下に薄い罫線が引かれている。行の高さは 40px 前後(HID-254 の 72px のおよそ半分)で、スイッチ・入力欄・選択・「Update」ボタンが行の縦中央にそろう。入力欄と選択には下線が残る。
3. 確認後、`surfaces/members.json` を見本に戻す(`-Reset` で作り直すか、ファイルを消す)。
## HID-281 / HID-282: 列の一括トグルと表の右の縦長ボタン

自動テスト: `corepack pnpm test`(`surface-definition-samples.json` の `records-column-toggle-*` / `records-table-action-*` を TS と Python の両方で判定、`test_records.py` の一括トグルの表示と送信・縦長ボタンの配置と送信・編集モードでの保持)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. 見本 `records-column-toggle-and-table-actions` を `members` として採用し、mock-unity と一緒に起動する。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Sample records-column-toggle-and-table-actions -Name members -Reset -Mock `
     -OptionsReply '/vp/members/request|/vp/members/list|メンバーA|メンバーB|メンバーC', '/vp/segments/request|/vp/segments/list|Intro|Song A'
   ```

2. ブラウザで UI を開く。**期待**: 「メンバー」の表の見出しの直下(行の並びの上。HID-286 で下から移した)の Active 列に「All Active」の文字と、その下にスイッチが 1 つある(ボタンは無い)。表の右側に、行の並びと同じ高さの縦長のボタン「Update All」(二重矢印のアイコンの下にラベル)がある。表の外に「UPDATE ALL」のボタンは無い。PC の画面幅では表が横スクロールせず、各行の「Update」まで見える。
3. 「All Active」のスイッチをオンにする。**期待**: 全行の Active がオンになり、スイッチもオンのまま。mock-unity が `/vp/member` を行の数だけ 1 bundle で受け取る(`/vp/member/update` は送られない)。
4. `メンバーB` の Active だけをオフにする。**期待**: 「All Active」のスイッチはオフの表示になり、下に「一部オン」が出る(D-094 より前は中間の不定の表示)。続けてスイッチを押す。**期待**: 全行がオンになる。もう一度押すと全行がオフになり、スイッチもオフになる。
5. 縦長の「Update All」を押す。**期待**: 行ごとに `/vp/member` → `/vp/member/update` の順で、全行分が 1 bundle で送られる。
6. ブラウザの幅をスマホ程度に狭める。**期待**: 表だけが横スクロールし、縦長のボタンは表の右に見えたまま。ページ全体には横スクロールが出ない。
7. 確認後、`surfaces/members.json` を見本に戻す(`-Reset` で作り直すか、ファイルを消す)。
## HID-283: 通常の画面でのレコードの行の追加・削除と、UI で管理するキー

自動テスト: `corepack pnpm test`(見本 `records-ui-keys` と誤例 5 件を TS と Python の両方で判定、ワイヤの見本 `upstream-record-key-*`、`surface-core.test.ts` の D-075、`desired-values-file.test.ts` の `keyLists`、`tests/e2e/record-keys.e2e.test.ts`、`test_records.py` の追加・削除)。受け口は OscSurface の EditMode(`OscReceiverCoreTests` の Strings の行と `"ui"` の Strings の行の提案)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. 見本 `records-ui-keys` を `members` として採用し、mock-unity と一緒に起動する(前回の `surfaces/.values/members.values.json` があれば消す)。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Sample records-ui-keys -Name members -Reset -Mock `
     -OptionsReply '/vp/members/request|/vp/members/list|メンバーA|メンバーB', '/vp/segments/request|/vp/segments/list|Intro|Song A'
   ```

2. ブラウザで UI を開く。**期待**: 「メンバー」の表の各行のキーの左に × があり、表の下に「追加するメンバー名」の入力欄と「追加」がある。「MB」の表は「行がありません(下の欄から追加してください)」で、下に入力欄と「追加」、右に縦長の「MB Sync」がある。
3. MB の入力欄に `MB 1` と打って Enter、続けて `MB 2` を「追加」で足す。**期待**: `MB 1` → `MB 2` の順に行ができ、値は `default`(Active オン・Address `127.0.0.1`・Port `22000`)。mock-unity の受信ログに `/mb/keys` と各行の `/mb/values` が出る(HID-323 以降、`/mb/keys` は行の ID の並びで、`/mb/values` は `s:<ID> s:"MB 1" ...`。D-087)。同じ名前・空白だけの名前は足されず、理由がトーストで出る(右上の「ログ」の通知履歴にも残る)。
4. `MB 3`、`MB 4` を足す。**期待**: 4 行で「追加」と入力欄が押せなくなる(上限 4)。
5. `MB 1` の × を押し、メニューの「「MB 1」を削除」を押す。**期待**: `MB 1` の行が消え、「追加」が再び押せる。mock-unity に `MB 2`・`MB 3`・`MB 4` の行の ID の 3 つを並べた `/mb/keys` が届く。別のブラウザで開いている画面からも行が消える。
6. 「メンバー」の表で `ゲスト` を足す。**期待**: `ゲスト` の行が「(一覧に無い)」付きで足される。`メンバーA` の Active をオンにしてから × で削除する。**期待**: × のメニューに「Unity の一覧にある名前は、行が残り既定値に戻ります」が出る。削除すると `メンバーA` の行は残り、Active がオフ(既定値)に戻る。`ゲスト` を削除すると行ごと消える。
7. ランチャーのウィンドウを閉じ、手順 1 を `-Reset` なしで実行し直す。**期待**: MB の行が `MB 2` → `MB 3` → `MB 4` の順に戻り、mock-unity に一覧が行の値より先に届く。
8. 確認後、`surfaces/members.json` と `surfaces/.values/members.values.json` を消す(または `-Reset` で作り直す)。
## HID-286: 列の一括操作を行の上へ、キーの列を広く・スイッチの列を狭く

自動テスト: `corepack pnpm test`(`test_records.py` の `test_column_actions_sit_in_a_bulk_row_above_the_rows`・`test_key_column_is_wide_and_switch_columns_are_fixed_narrow`)。見た目の幅は自動テストでは測らないので、ブラウザで確かめる。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. HID-281 / HID-282 節の手順 1 と同じく、見本 `records-column-toggle-and-table-actions` を `members` として mock-unity と一緒に起動し、キーの一覧に `chkakamatteaias2` のような 16 文字程度の名前を入れる(`-OptionsReply '/vp/members/request|/vp/members/list|メンバーA|chkakamatteaias2'`)。
2. ブラウザで UI を開く。**期待**: 「All Active」の文字とスイッチが、表の見出しの直下・最初の行の上にある(行の並びの下には何も無い)。Active の列はスイッチの幅に詰まり、キーの列は広く、16 文字程度の名前が 1 段に収まる。PC の画面幅では表が横スクロールしない。
3. 確認後、`surfaces/members.json` を見本に戻す(`-Reset` で作り直すか、ファイルを消す)。

## HID-300: 一覧の近くの「Sync」で、その一覧だけを取り直す

自動テスト: `corepack pnpm test`(`surface-core.test.ts` の Sync の送り分けと拒否、mock-unity の `responder.test.ts` の応答の順送り、`tests/e2e/runtime-options-sync.e2e.test.ts`、`test_runtime_options.py` / `test_records.py` の Sync のボタンと通知、両言語のワイヤ見本 `upstream-runtime-options-refresh-one-request`)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. 前回の `surfaces/.values/members.values.json` があれば消し、見本 `records-basic` を `members` として採用し、mock-unity と一緒に起動する。セグメントの一覧は同じ組を 2 つ書き、最初の要求には空、2 回目からは `Intro` / `Song A` を返させる(起動時に MB と未接続だった Unity を模す。D-077)。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Sample records-basic -Name members -Reset -Mock `
     -OptionsReply '/vp/members/request|/vp/members/list|メンバーA|メンバーB', '/vp/segments/request|/vp/segments/list', '/vp/segments/request|/vp/segments/list|Intro|Song A'
   ```

2. ブラウザで UI を開く。**期待**: 「メンバー」の表の見出しで、「メンバー名」と「Seg」の横にだけ「Sync」が出る(「Active」「Slot」には出ない。行の欄ごとにも出ない)。Seg の候補は `(none)` だけ。状態カードの下の「一覧を更新」も従来どおり出る。
3. 「Seg」の横の「Sync」を押す。**期待**: 「Unity に一覧を要求しました(/vp/segments/request)。一覧の中身が変わったときだけ候補が入れ替わります」の通知が出て(右上の「ログ」の通知履歴にも残る)、画面を作り直さずに Seg の候補が `(none)` / `Intro` / `Song A` になる。HID-327 以降は、通知が「…。一覧が変わっていれば「新しい一覧があります」に出ます」になり、最初の空の一覧が初報として反映済みなので、取り直した一覧は「新しい一覧があります」に出る。「反映」を押すと候補が替わる。ブリッジの出力に `Requesting 1 option list(s) from Unity "unity" (sync requested by UI: /vp/segments/request).` が出て、「ログ」の送信ログには `request` の `/vp/segments/request` だけが増える(`/vp/members/request` は増えない)。
4. もう一度「Seg」の「Sync」を押す。**期待**: 通知は同じで、一覧が変わらないので候補も画面も変わらない(エラーにはならない)。
5. 「メンバー名」の横の「Sync」を押す。**期待**: 送信ログに `/vp/members/request` だけが増える。一覧が変わらないので行は変わらない。
6. 「一覧を更新」を押す。**期待**: 従来どおり `Requesting 2 option list(s) ... (requested by UI).` が出て、両方の要求が送られる。
7. 見本 `options-from-shared-address` を `segments` として `-Mock -OptionsReply '/mb/segments/get|/mb/segments|Intro|Song A'` で起動し直す。**期待**: 通常の欄の select(セグメント)の横、同じカードの中に「Sync」が出て、押すと `/mb/segments/get` だけが送られる。
8. ブリッジを止めて「Sync」を押す。**期待**: 「ブリッジに接続していないため要求できませんでした」の通知が出る。
9. 確認後、`surfaces/members.json`・`surfaces/segments.json` と `surfaces/.values/` の該当ファイルを消す(または `-Reset` で作り直す)。

## HID-301: 宛先タブ(LAN の走査・送り先の選択・全てのデバイス)

自動テスト: `corepack pnpm test`(`lan-scan.test.ts` のサブネットの計算と ARP 表の読み取り、`destinations.test.ts` の選択・保存・走査の合流と時間上限、`destinations-file.test.ts`、`surface-core-targets.test.ts` の宛先の差し替えとブロードキャストの pong・ユニキャストの再送、`udp-transport.test.ts` の `setBroadcast`、`tests/e2e/destinations.e2e.test.ts` の mock-unity 2 台(127.0.0.2 / 127.0.0.3)での「チェックした端末だけに届く」「再走査で増減が出る」「ブリッジ再起動で選択が戻る」、`test_destinations.py`、ワイヤの見本 `*-destinations-*`)。ブロードキャストが実際に届くかはネットワークに依存するので、手で確かめる。**走査とブロードキャストは LAN の全端末に届く。認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. 前回の選択 `surfaces/.values/.destinations.json` があれば消し、mock-unity と一緒に起動する(mock-unity はこの PC の 7090 で待ち受け、127.0.0.1 へ返す)。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Mock
   ```

2. ブラウザで UI を開き、右側の宛先パネル(D-086 より前は画面タブの後ろの「宛先」タブ)を見る。**期待**: 「走査中…」の後に「最終走査 hh:mm:ss」になり(3 秒前後)、この PC の LAN の IP(「この PC」)、`127.0.0.1`(「設定の宛先」、チェック済み)、LAN のほかの端末(MAC つき)が IP の順に並ぶ。先頭に「全てのデバイス(192.168.x.255)」がある。下に「設定ファイルの宛先を使っています」。
3. この PC の LAN の IP にチェックを付け、`127.0.0.1` のチェックを外す。**期待**: 「いま送っている宛先: 192.168.x.y:7090」「保存した選択を使っています」になり、数秒で上部の Unity のバッジが「接続中」になる。スライダーを動かすと mock-unity の受信ログに値が出て、右上の「ログ」の送信ログの宛先が `ip-192-168-x-y` になる。最後の 1 台のチェックを外そうとすると「送信先を 1 台以上選んでください」が出て、チェックが戻る。(この PC のネットワークの外のアドレスやブロードキャストアドレスを個別に選ばせない規則は、自動テストで確かめている。)
4. 「全てのデバイス」にチェックを付ける。**期待**: 個別の端末のチェックボックスがグレーアウトして押せなくなる(チェックの状態は残る)。「いま送っている宛先: 192.168.x.255:7090」になり、Unity のバッジが「接続中」のまま(または数秒で戻る)。スライダーを動かすと mock-unity の受信ログに値が出る(ブロードキャストがこの PC にも届く)。ブリッジの出力に `Resending ... (Unity first reachable at 127.0.0.1)` が出る。
5. ランチャーのウィンドウを閉じ、手順 1 のコマンドだけを実行し直す(`.destinations.json` は消さない)。**期待**: 「全てのデバイス」にチェックが付いたまま起動し、ブリッジの出力に `Restored destinations from "....destinations.json"` と `Unity targets: all-devices 192.168.x.255:7090 (primary)` が出る。
6. 「全てのデバイス」のチェックを外す。**期待**: 手順 3 の個別の選択(この PC の IP)に戻る。「設定ファイルの宛先に戻す」を押す。**期待**: `127.0.0.1` だけにチェックが戻り、「設定ファイルの宛先を使っています」になり、`surfaces/.values/.destinations.json` が消える。
7. 走査の増減: スマートフォンなどを同じ LAN につないでから「更新」を押す。**期待**: その端末の IP が一覧に増える。端末を LAN から外し、数分おいて「更新」を押す。**期待**: 一覧から消える(OS の ARP 表に古いエントリが残る間は残る。D-078 の既知の限界)。走査中は「更新」が押せない。
8. 任意(別の PC の Unity): 別の PC で `OscReceiver` を置いた Unity を動かし(`OscReceiver` の `Reply Host` はこの PC の LAN の IP)、その PC の IP だけを選ぶ。**期待**: その台が「接続中」になり、保持値が届き、エコーが UI に映る。「全てのデバイス」に切り替えても同じく届き、エコーが映る(受け口が `0.0.0.0` で待ち受けていること。`docs/UNITY_PROTOCOL.md` §4)。
9. 確認後、`surfaces/.values/.destinations.json` を消す(または手順 6 の「設定ファイルの宛先に戻す」)。

## HID-302: OSC パッド(自由にアドレスと引数を書いて撃つボタンの格子)

自動テスト: `corepack pnpm test`(`protocol/osc-pad-samples.json` を TS の `osc-pad.test.ts` と Python の `test_osc_pad.py` で判定、ワイヤの見本 `downstream-pad*`・`upstream-pad-*`、`pad-manager.test.ts`、`surface-core.test.ts` の D-080、`tests/e2e/osc-pad.e2e.test.ts`(保存 → ブリッジ再起動後も採用が残る、押下で mock-unity に指定のアドレスと引数が届く)、`test_osc_pad.py` の編集規則とタブの操作)。押した見た目・格子とInspector の配置・押下の手応えは自動テストでは測らないので、ブラウザ(PC とスマホ)で確かめる。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. mock-unity と一緒に起動する(定義はどれでもよい。パッドは定義とは別に採用される)。前回の `surfaces/pads/` があれば消しておく。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Sample records-ui-keys -Name members -Reset -Mock
   ```

2. ブラウザで UI を開き、定義の画面タブの後ろの「OSC パッド」タブを開く。**期待**: 「パッドを編集」のスイッチ(文字は押せない)と「パッド: 未選択」、「パッドがありません。…」が出る。
3. 「パッドを編集」をオンにする。**期待**: 4 × 4 の空きマス(+)と、右に灰色の Inspector、上に「保存済み」「切り替え」「保存名」「保存」「新規」が出る。(行数・列数は HID-322 / D-084 でスイッチの下の「格子」へ移した。)
4. 左上の + を押す。**期待**: ボタン `b1` ができて黄色の枠で選ばれ、Inspector に「ボタン (b1)」「OSC」の見出しが出る。次を編集する。
   - ラベルを `Fire` にする(マスの文字がその場で変わる)。背景色をカラーピッカーで赤にする(文字は読める色に変わる)。「画像を選ぶ」で 256 KiB 以下の PNG を選ぶ(マスに画像が出てラベルが下端の帯に乗る)。300 KiB 程度の画像や SVG は断られトーストが出る
   - アドレスに `/sys/ping` と打つ。**期待**: 欄の下に「/sys と /oscdesk は予約されています」が出て、マスのアドレスは変わらない。`/fx/fire` にする
   - 「引数を追加」を 3 回押し、型を `i` / `f` / `s` にして値を `1` / `0.5` / `メンバーA` にする。`i` に `1.5` や `2147483648` を打つと欄の下に理由が出る。行末の ⋮ から並べ替え・削除ができる
   - (位置の編集は HID-322 / D-084 で撤去し、設定のコピーに置き換えた。手順は HID-322 の節を参照)行数を減らしてはみ出すボタンがあると断られる
5. 保存名に `take-01` と入れて「保存」を押す。**期待**: 「未保存の変更があります」が消え、`surfaces/pads/take-01.json` ができる。
6. 「パッドを編集」をオフにする(実行モード)。`Fire` を押す。**期待**: 押し込んだ瞬間(離す前)にマスが縮んで暗くなり、mock-unity の受信ログに `/fx/fire i:1 f:0.5 s:"メンバーA"` が出る。右上の「ログ」の送信ログに契機「OSC パッド」で 1 件ずつ(連打してもまとめずに)残る。右クリックでは送らない。実行モードでは Inspector も保存の操作も出ない。
7. スマホで同じ URL を開き、「OSC パッド」タブで `Fire` を指で叩く。**期待**: 触れた瞬間に送られる(指を離すまで待たない)。ダブルタップで拡大されず、長押しでメニューが出ない。「パッドを編集」をオンにすると Inspector が格子の下に回り、横スクロールしない。
8. 編集モードでラベルを変えたまま「パッドを編集」をオフにする。**期待**: 破棄の確認が出て、「やめる」なら編集を続け、「破棄する」なら保存済みの内容に戻る。別の名前(`take-02`)で保存し、「保存済み」から `take-01` を選んで「切り替え」を押す。**期待**: 全端末の OSC パッドが `take-01` に替わる。
9. ランチャーのウィンドウを閉じ、手順 1 を実行し直す。**期待**: 「OSC パッド」タブに最後に切り替えた `take-01` が出て、押すと送られる(押下は保持値に載らないので、起動直後に mock-unity へ `/fx/fire` が再送されない)。
10. 確認後、`surfaces/pads/` を消す。

## HID-322: OSC パッドの Inspector の整理と宛先タブの見やすさ(D-084 / D-085)

自動テスト: `corepack pnpm test`(`test_osc_pad.py` のコピー・貼り付けと画像の上限・表示の外のボタン・実行モードの格子の大きさ・Inspector の折りたたみ、`destinations.test.ts` のネットワークごとの全てのデバイスと端末名の引き直し、`hostname-lookup.test.ts`、`destinations-file.test.ts` の旧形式の読み込み、`test_destinations.py` のまとめ・検索・ネットワークのチェック、ワイヤの見本 `*-destinations-networks`)。見た目と、実際の LAN で名前が引けるかは手で確かめる。**走査・名前の問い合わせ・ブロードキャストは LAN に届く。認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. HID-302 の手順 1 と同じく mock-unity と一緒に起動し、「OSC パッド」タブでボタンを 2〜3 個置いたパッドを `take-01` として保存しておく(右下のマスにも 1 つ置く)。
2. 「パッドを編集」をオフにしたまま、スイッチの下の「格子」で行数を 1 減らす。**期待**: 編集モードに入らずに格子が小さくなり、「(この画面の表示だけ。保存しません)」と「表示の外に 1 個のボタンがあります」が出る。別のブラウザの「OSC パッド」タブは元の大きさのまま。行数を戻すと隠れたボタンが元の位置に出る(パッドから消えていない)。
3. 「パッドを編集」をオンにする。**期待**: 格子は保存された大きさで出て、「(パッドと一緒に保存します)」になる。Inspector には「パッド」の見出しが無い。
4. ボタンを押す。**期待**: Inspector に「ボタン (b1)」の見出しの下に「ラベル」、字下げされた子の見出し「外観(任意)」(畳まれていて、補足に背景色や「画像あり」が出る)と「OSC」(開いている)が並ぶ。「位置」の行は無い。「外観(任意)」を開いてから別のボタンを選んでも開いたまま。
5. 「コピー」を押す。**期待**: 格子の上に「「…」の設定をコピーしています。…」と「コピーをやめる」が出て、空きマスの印が貼り付けの印に変わる。空きマスを押すと、同じラベル・色・画像・アドレス・引数のボタン(id は新しいもの)ができて選ばれる。続けて別の空きマスにも貼り付けられる。
6. 別のボタンを選んで「貼り付け」を押す。**期待**: そのボタンの位置と id はそのままで、設定がコピーした内容に置き換わる。「コピーをやめる」を押すと空きマスの印が + に戻り、「貼り付け」が押せなくなる。画像の大きいボタンを何度も貼り付けて合計 4 MiB を超えると「パッド全体の画像が 4 MiB を超えます」で断られる。
7. 右側の宛先パネル(D-086 より前は「宛先」タブ)を見る。**期待**: 先頭に検索欄と「全てのデバイス(…)」があり、その下にネットワークごとの見出し(`192.168.x.0/24(インタフェース名)`)、「このネットワークの全てのデバイス(192.168.x.255)」、そのネットワークの端末が字下げされて並ぶ。端末のチェックボックスの文字は名前(引けた場合。この PC は OS のコンピューター名)で、IP は右の補足に回る。MAC は一覧に出ず、行にマウスを載せたときのツールチップにだけ出る。名前は「走査中…」が終わるまで(3 秒程度余分に)引かれる。ルーターや DNS が名前を返さない端末は IP のままになる。
8. 検索欄に端末名の一部や IP の一部を入れる。**期待**: 一致しない端末は薄くなってチェックできなくなる(チェック済みの端末はチェックが付いたまま)。× で消すと戻る。
9. 「このネットワークの全てのデバイス」にチェックを付ける。**期待**: 「いま送っている宛先」にそのネットワークのブロードキャストアドレスが加わり、そのネットワークの端末がグレーアウトする(ブロードキャストで届くので個別には送らない。ただし「設定の宛先」はポートが違うと届かないので選べるまま)。ほかのネットワークの端末は選べる。mock-unity に操作が届く。ブリッジを再起動しても選択が戻る(`surfaces/.values/.destinations.json` に `networks` が入る)。最後のネットワークを外して個別の端末も残っていなければ設定ファイルの宛先に戻る。「全てのデバイス」を付けている間はネットワークのチェックもグレーアウトする。
10. 確認後、`surfaces/pads/` と `surfaces/.values/.destinations.json` を消す。

## HID-326: 宛先パネルの常時表示と正規表現の検索(D-086)

自動テスト: `corepack pnpm test`(`test_destinations.py` の正規表現の検索・読めない正規表現の扱い・タブを開かずに操作できること、`test_layout.py` のタブの並び)。見た目は手で確かめる。**走査は LAN に届く。認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `launchers\start-oscdesk-verify.ps1` で起動し、横幅の広い(1024px 以上の)ブラウザで UI を開く。**期待**: タブ列に「宛先」が無く(定義の画面と「OSC パッド」だけ)、画面の右側に「送信先」のパネルが出ている。
2. 画面タブ・「OSC パッド」タブを切り替える。**期待**: どのタブでも右側のパネルが出たままで、端末のチェックを付け外しできる(「いま送っている宛先」が変わり、mock-unity に操作が届く)。
3. 本体を下までスクロールする。**期待**: 右側のパネルはヘッダーのすぐ下に留まって見え続ける。端末が多いときはパネルの中だけがスクロールする。
4. 検索欄に `^192\.168\.0\.(1|42)$` のような正規表現を入れる。**期待**: 一致する端末だけが選べるまま残り、ほかは薄くなってチェックできなくなる(チェック済みの端末はチェックが付いたまま)。`unity` のような文字の一部も従来どおり当たる。
5. 検索欄に `192.168.(` を入れる。**期待**: 検索欄の下に「正規表現として読めないため、文字どおりに探しています」が出て、絞り込みは文字どおりの部分一致になる。× で消すと表示が消えて一覧が戻る。`^(a|aa)+$` のような重い式を入れても画面は固まらない(重さで打ち切ったときは「正規表現の照合に時間がかかりすぎるため、文字どおりに探しています」が出る)。
6. ブラウザの幅を 1000px 程度より狭く(スマホなど)する。**期待**: パネルが本体の上に回り、高さが画面の 4 割ほどに抑えられて中だけスクロールする。本体はパネルの下に続く。
7. 幅 1600px 未満のブラウザで「ログ」を開く。**期待**: 送信ログのドロワーで本体の置き場が狭くなると、パネルが本体の上に回り、本体の部品が潰れない。ログを閉じると右側に戻る。
8. 長い名前のサーフェスを採用するなどしてヘッダーのバッジを折り返させ、本体を下へスクロールする。**期待**: パネルの「送信先」と「更新」がヘッダーの裏に隠れない。
9. 確認後、`surfaces/` の見本(`stage.json` と `.values/`)と `surfaces/.values/.destinations.json` を消す。

## HID-323: UI で管理する行の ID と Name の変更(D-087)

自動テスト: `corepack pnpm test`(ワイヤの見本 `downstream-runtime-options-ui-row-names*`・`upstream-osc-record-row-with-id`・`upstream-record-key-rename*`、`surface-record.test.ts`・`runtime-options.test.ts` の ID と Name、`surface-core.test.ts` の改名・Name の揃え直し・version 2 の移行、`desired-values-file.test.ts` の version 3 と version 2 の読み込み、`tests/e2e/record-keys.e2e.test.ts` の改名・再起動・移行、`test_records.py` の ID で指す行・改名の確認・Name の欄)。受け口は OscSurface の EditMode(`OscReceiverCoreTests` の Record Row Ids と A7)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. HID-283 の手順 1 と同じく、見本 `records-ui-keys` を `members` として mock-unity と一緒に起動する(`-Reset` で前回の保持値を消す)。
2. MB の表で `MB 1` と `MB 2` を足し、`MB 1` の Port を `1234` にする。**期待**: MB の表のキーの列(Name)は入力欄になっている。「メンバー」の表(Unity の一覧の表)のキーの列は名前の表示のまま。mock-unity の受信ログの `/mb/values` は `s:<ID> s:"MB 1" i:1 s:"127.0.0.1" i:1234` の形(ID は UUID)。
3. `MB 1` の Name の欄を `MB A` に書き換えて Enter を押す。**期待**: 行は同じ位置のまま Name が `MB A` になり、Port は `1234` のまま。別のブラウザの画面でも `MB A` になる。mock-unity に同じ ID の `/mb/values s:<ID> s:"MB A" ... i:1234` が届き、`/mb/keys` は届かない(一覧は ID の並びで変わらない)。× のメニューも「「MB A」を削除」になる。
4. Name の欄を `MB 2` に書き換えて Enter、空白だけにして欄の外を押す。**期待**: どちらも送られず、「「MB 2」は既にあります」「名前を入力してください」がトーストと通知履歴に出て、欄は `MB A` に戻る。
5. ランチャーのウィンドウを閉じ、手順 1 を `-Reset` なしで実行し直す。**期待**: MB の行は `MB A` → `MB 2` の順で、`MB A` の Port は `1234`。mock-unity には手順 2 と同じ ID で届く。`surfaces/.values/members.values.json` は `version: 3` で、`keyLists` に `rows: [{ "id", "name" }]` がある。
6. 旧形式からの移行: ランチャーを閉じ、`surfaces/.values/members.values.json` を `version: 2` の形(`keyLists: [{ "address": "/mb/keys", "keys": ["MB 1"] }]`、`records` の `/mb/values` の行の `key` が `"MB 1"`、Port の `arg` を `1234`)に書き換えてから手順 1 を `-Reset` なしで実行する。**期待**: MB の表に `MB 1` の行が Port `1234` のまま出る。ファイルは次の保存で `version: 3` に書き直され、`MB 1` に ID が振られている。
7. Unity(OscSurface)で確かめる場合: `/mb/values` の Record の行の `Record Row Ids` をオンにし(インスペクタの A7 に従い「Record の行のフィールド id を定義に合わせる」でもよい)、`OscRecord` を受ける関数で `record.Id` と `record.Key` をログに出す。**期待**: 手順 3 の改名の前後で `record.Id` が同じで、`record.Key` が `MB 1` → `MB A` に変わる。`Record Row Ids` をオフに戻すと、A7 の警告が出る。
8. 確認後、`surfaces/members.json` と `surfaces/.values/members.values.json` を消す(または `-Reset` で作り直す)。

## HID-327: Unity の一覧の手動反映(D-088)

自動テスト: `corepack pnpm test`(`runtime-options.test.ts` の初報の自動反映・反映待ち・一覧ごとの反映・ブロードキャストのホストごとの保持、`surface-core.test.ts` の反映待ちの配信・`runtimeOptionsApply`・反映のときの行の作成、`tests/e2e/runtime-options-hold.e2e.test.ts` の「別の一覧で起動し直した Unity は反映まで行も選択肢も変えず、反映で全 UI へ配って新しい行を Unity へ送る」、`tests/e2e/runtime-options-sync.e2e.test.ts`、`test_runtime_options.py` の「新しい一覧があります」、両言語のワイヤ見本 `downstream-runtime-options-pending*`・`upstream-runtime-options-apply-*`)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. 前回の `surfaces/.values/members.values.json` があれば消し、見本 `records-basic` を `members` として採用し、mock-unity と一緒に起動する。メンバーの一覧は同じ組を 2 つ書き、最初の要求には `メンバーA` / `メンバーB`、2 回目からは `メンバーA` / `メンバーC` を返させる(後から構成の変わった Unity、または誤って起動した別のプロジェクトを模す)。

   ```powershell
   .\launchers\start-oscdesk-verify.ps1 -Sample records-basic -Name members -Reset -Mock `
     -OptionsReply '/vp/members/request|/vp/members/list|メンバーA|メンバーB', '/vp/members/request|/vp/members/list|メンバーA|メンバーC', '/vp/segments/request|/vp/segments/list|Intro|Song A'
   ```

2. ブラウザで UI を開く。**期待**: 「メンバー」の表に `メンバーA` / `メンバーB` の行が出る(初報は自動で反映される)。「新しい一覧があります」は出ない。mock-unity の受信ログに 2 行分の `/vp/member` が出る。
3. 別のブラウザ(またはタブ)でも UI を開いておく。最初の画面で「一覧を更新」を押す。**期待**: 「Unity に一覧を要求しました。一覧が変わっていれば「新しい一覧があります」に出ます」の通知が出る。両方の画面に「新しい一覧があります」が出て、`/vp/members/list(メンバー の行 …)` の下に「unity の一覧が変わりました(追加: メンバーC / 削除: メンバーB)」が出る。表の行は `メンバーA` / `メンバーB` のままで、mock-unity に `メンバーC` の `/vp/member` は届かない。ブリッジの出力に `Holding option list "/vp/members/list" from Unity "unity" until it is applied from the UI.` が出る。
4. 2 つ目の画面で、その一覧の「反映」を押す。**期待**: 両方の画面で「新しい一覧があります」が消え、表に `メンバーC` の行が既定値で足される(`メンバーB` の行は保持値を持つので「(一覧に無い)」付きで残る)。mock-unity に `メンバーC` の `/vp/member` が届き、「ログ」の送信ログに `row` として残る。ブリッジの出力に `Applied held option list(s) "/vp/members/list" by UI request.` が出る。
5. もう一度「一覧を更新」を押す。**期待**: 一覧は反映済みと同じなので「新しい一覧があります」は出ない。
6. 「全てのデバイス」で確かめる場合(この PC とは別に、mock-unity か Unity を動かせる PC が LAN にもう 1 台要る): 両方の PC で受け口を起動し、宛先パネルで「全てのデバイス」を選ぶ。**期待**: 先に答えた PC の一覧が反映され、後から答えた PC の一覧は「all-devices(<その PC の IP>) の一覧が変わりました(…)」として反映待ちになる。「すべて反映」を押すと、両方の PC の一覧の和集合になる。
7. 手順 3 の状態(反映待ちあり)でブリッジのプロセスだけを止める。**期待**: 「新しい一覧があります」は消える(切断中は古い表示を出さない)。ブリッジを起動し直すと反映待ちは無くなり、起動後の初報が反映される(反映済みの一覧は保存しない)。
8. 確認後、`surfaces/members.json` と `surfaces/.values/members.values.json` を消す(または `-Reset` で作り直す)。

## HID-331: 送信先パネルの幅・親子のチェック・検索の非表示、OSC パッドの編集画面の配置(D-089)

自動テスト: `corepack pnpm test`(`test_destinations.py` の `selection_without` / `selection_with`(親を外して残りを個別の選択へ展開する)、全てのデバイス・ネットワークの間に子にもチェックが付いて操作できること、検索で一致しない端末を隠し「表示中の全てのデバイス」が表示中の端末だけを付け外しすること、`test_osc_pad.py` の案内が格子の上に出てボタンを選ぶまで Inspector を出さないこと・コピーが空きマスの挙動を変えず「貼り付け」だけで使われること)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `.\launchers\start-oscdesk-verify.ps1 -Sample records-ui-keys -Name demo -Reset -Mock` で起動し、幅 960px 以上のブラウザで UI を開く。
2. 送信先パネルの左端の縦線にマウスを乗せ、左右へドラッグする。**期待**: 縦線が青くなり、パネルの幅が変わる(本体が潰れる手前で止まる)。ページを開き直しても幅が保たれる(このブラウザだけ)。幅 960px 未満の画面ではつまみは出ず、パネルは本体の上に出る。
3. 本体が長い画面で、送信先パネルの上でホイールを回して最後までスクロールし、さらに回す。**期待**: ページ全体はずれない。本体が短い画面(OSC パッドのタブなど)ではページ全体に縦のスクロールバーが出ない。
4. 「全てのデバイス」の文字にマウスを乗せる。**期待**: 文字にはブロードキャストアドレスが無く、ツールチップに「送り先: 192.168.x.255」が出る。「このネットワークの全てのデバイス」も同じ。
5. 「全てのデバイス」にチェックを付ける。**期待**: ネットワークと各端末のチェックがすべて付き、どれも操作できる(グレーアウトしない)。続けて端末を 1 台外す。**期待**: 「全てのデバイス」とその端末のネットワークのチェックが外れ、ほかの端末のチェックは付いたまま(個別の選択になる)。
6. 検索欄に IP の一部(例: `192.168.0.1`)を入れる。**期待**: 一致しない端末とネットワークは一覧から消え、先頭は「表示中の全てのデバイス」、ネットワークは「このネットワークの表示中のデバイス」になる。「表示中の全てのデバイス」を付けると表示中の端末だけにチェックが付き、外すと表示中の端末だけが外れる(隠れている端末の選択は残る。検索を消すと見える)。
7. 「メンバー」「MB」の表の下の追加欄。**期待**: 入力欄と「追加」ボタンが同じ幅・同じ高さで横に並ぶ。
8. 「OSC パッド」のタブで「パッドを編集」をオンにする。**期待**: 「格子のボタンを押すと編集できます。…」の案内が格子の上に出て、格子の幅は実行モードと同じ(右側に Inspector の場所を取らない)。ボタンを押すと Inspector が出る(出る場所と格子の幅は HID-334 の手順を参照)。
9. Inspector の「引数を追加」を押す。**期待**: 型の選択欄と値の欄の上端と高さがそろう。
10. Inspector の「コピー」を押す。**期待**: 格子の上の案内に「「…」の設定をコピー済みです」が足される。空きマスの印は「+」のままで、押すと仮の設定のボタンが足される。足したボタンで「貼り付け」を押すと、コピーした設定で置き換わる。

## HID-332: プロジェクトファイルの書き出し・読み込みと未送信の表示(D-090)

自動テスト: `corepack pnpm test`(`project-file.test.ts` の形式の受理・拒否、`project-manager.test.ts` の書き出し・取り込み・検証で断るときに何も書き換えないこと、`surface-core-import.test.ts` の取り込みで保持値を置き換えて Unity へ送らない・全宛先への `resend` まで自動の再送を止める・ブリッジ再起動後も止めたまま、`desired-values-file.test.ts` の `unsentSince`、`tests/e2e/project-file.e2e.test.ts` の「取り込んだ値は mock-unity の再起動でも送られず、`resend` で届く」、`test_project_file.py` のアップロードの検査・ページごとのダウンロード・未送信の帯、両言語のワイヤ見本 `downstream-project*`・`downstream-desired-status-*`・`upstream-project-*`)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `.\launchers\start-oscdesk-verify.ps1 -Sample records-ui-keys -Name demo -Reset -Mock` で起動し、ブラウザで UI を開く。値を 1 つ変え、「MB」の表に行を 1 つ足して Name とポートを変える。「OSC パッド」のタブでボタンを 1 つ作って保存する。
2. 状態カードの下の「プロジェクト」で「書き出す」を押す。**期待**: `demo-<日時>.oscdesk-project.json` がダウンロードされ、「プロジェクトを書き出しました(定義「demo」・パッド「…」)」が出る。ファイルをテキストエディタで開くと、`surface.values` に変えた値と MB の行(`keyLists` に ID と Name)が、`pad` に作ったボタンが入っている。実行モードのままでも書き出せる。
3. 値を別の値に変え、MB の行を消す。パッドのボタンのラベルを変えて保存する。
4. 実行モードでは「読み込む」が出ないことを確かめてから、編集モードをオンにする。**期待**: 「読み込む」が出る。手順 2 のファイルを選ぶ。**期待**: 確認のダイアログに定義「demo」と値・行の件数、パッドの名前とボタンの数、上書きすること、「読み込んでも Unity へは送りません」が出る。「やめる」を押すと何も変わらない。
5. もう一度選んで「読み込む」を押す。**期待**: 「プロジェクトを読み込みました(…)。保持値はまだ Unity へ送っていません」が出て、手順 2 の値・MB の行(同じ Name・ポート)・パッドのラベルに戻る。別のブラウザで開いた画面も同じ内容に替わる。「プロジェクト」に橙色の帯「読み込んだプロジェクトの保持値を、まだ Unity へ送っていません(… に読み込み)。…」と「Unity へ送る」が出る。mock-unity の受信ログと「ログ」の送信ログに、読み込んだ値は出ない(送られていない)。
6. mock-unity のウィンドウを閉じて起動し直す(Unity の再起動を模す)。**期待**: 到達が回復しても値は送られず、ブリッジの出力に `Not resending desired values to Unity "unity" (Unity recovered): the imported project has not been sent yet.` が出る。帯は出たまま。
7. ブリッジのプロセスを止めて起動し直す。**期待**: 画面は読み込んだ値のまま、帯も出たまま(`surfaces/.values/demo.values.json` に `unsentSince` がある)。
8. 帯が出たまま、編集モードで別の保存済みの定義(例: 見本の `records-basic` を別名で保存したもの)を読み込む。**期待**: 帯が消え、その定義の画面と(保存ファイルがあれば)その値になる。`surfaces/.values/demo.values.json` には `unsentSince` が残り、切り替え先のファイルには書かれない。その定義の一覧に新しいキーが現れても従来どおり送られる。続けて `demo` を読み込み直す。**期待**: 読み込んだプロジェクトの値と帯が戻り、Unity へは送られない。
9. 帯が出ている間に「一覧を更新」を押す。**期待**: 「読み込んだプロジェクトをまだ Unity へ送っていないため、一覧を要求しませんでした。…」と出て、mock-unity と送信ログに要求(`request`)は出ない。mock-unity を再起動しても、回復の契機で要求は送られない。一覧に新しいメンバーが現れた場合(mock-unity が自発的に送る場合など)も、表に新しい行は出るが mock-unity にその行の `/vp/member` は届かない。
10. 「Unity へ送る」を押し、確認で「送る」を押す。**期待**: 帯が消え、mock-unity と送信ログ(`resend`)に保持値がすべて届き、続けて一覧の要求(`request`)が送られる。以後、mock-unity を再起動すると従来どおり再送される。`demo.values.json` から `unsentSince` が消える。
11. 定義のファイル(`surfaces/demo.json`)を「読み込む」で選ぶ。**期待**: 「これはサーフェス定義のファイルです。定義は編集モードの「アップロード」で読み込んでください」と出て、何も変わらない。壊れた JSON・別の種類の JSON も理由を出して断る。
12. 定義もパッドも採用していない状態(新しい `surfaces` フォルダで起動など)で「書き出す」を押す。**期待**: 「プロジェクトを書き出せません: empty: …」が 1 回だけ出て、15 秒後に「応答がありませんでした」は重ねて出ない。パッドだけのプロジェクトを読み込んだときの完了の通知には「保持値はまだ Unity へ送っていません」が付かない。上限(一覧 1000 行・展開後 2 万行・見積もり 8 MiB)を超える状態で「書き出す」を押すと「プロジェクトを書き出せません: invalid: …」が出て、ファイルはダウンロードされない(書き出せたファイルは必ず読み込める)。
13. 確認後、`surfaces/demo.json`・`surfaces/.values/demo.values.json`・作ったパッド(`surfaces/pads/`)を消す(または `-Reset` で作り直す)。保存済みの定義・パッドを上書きした直前の内容は `.backups/` に残っている。

## HID-334: アプリ全体の Inspector の領域(D-091)

自動テスト: `corepack pnpm test`(`test_osc_pad.py` のボタンを選ぶと送信先パネルの場所に Inspector が出て送信先パネルが隠れること・閉じる/削除/編集の終了/タブの切り替えで送信先パネルへ戻りタブへ戻ると出し直すこと、`test_layout.py` のタブの切り替えが知らされること)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `.\launchers\start-oscdesk-verify.ps1 -Sample records-ui-keys -Name demo -Reset -Mock` で起動し、幅 960px 以上のブラウザで UI を開く。
2. 「OSC パッド」のタブで「パッドを編集」をオンにする。**期待**: 右側は送信先パネルのまま。格子の上に「格子のボタンを押すと、送信先パネルの場所(Inspector)で編集できます。…」が出る。
3. 格子のボタン(無ければ空きマスの「+」で足す)を押す。**期待**: 右側の送信先パネルが「Inspector — OSC パッドのボタン」に替わり、ボタンの設定が出る。格子の幅とボタンの位置は手順 2 から変わらない。送信先パネルの左端のつまみで Inspector の幅も変えられる。
4. 手順 3 の前に送信先パネルを途中までスクロールしておく。Inspector の中身をスクロールしても見出し(「Inspector」と「×」)は動かない。右上の「×」を押す。**期待**: ボタンの選択(黄色の枠)が外れ、右側が送信先パネルに戻る。それまでの送信先の選択・検索欄の文字・スクロールの位置はそのまま(Inspector のスクロールが持ち込まれない)。
5. もう一度ボタンを選んでから、定義の画面のタブ(例: 先頭のタブ)へ移る。**期待**: 右側は送信先パネルに戻る。「OSC パッド」のタブへ戻ると、同じボタンの Inspector が出る。
6. ボタンを選んだまま「削除」を押す。**期待**: 送信先パネルに戻る。ボタンを選んでから「パッドを編集」をオフにする(未保存なら「破棄する」)。**期待**: 送信先パネルに戻る。
7. ブラウザの幅を 960px 未満(スマホ相当)にし、手順 3 のようにボタンを選ぶ。**期待**: Inspector は本体の上の送信先パネルと同じ高さ(40vh)の場所に出て、格子の大きさも上下の位置も変わらない。ページを下へスクロールしても Inspector はヘッダーの下に貼り付いたまま見える(中だけスクロール)。「×」で閉じると送信先パネルに戻り、送信先パネルはスクロールすると従来どおり流れていく。

## HID-335: 送信先の端末に名前(別名)を付ける(D-092)

自動テスト: `corepack pnpm test`(`device-aliases.test.ts` のキーの決め方・照合・ファイルの保存と復元、`destinations.test.ts` の MAC で覚えた名前が IP の変化と再起動をまたいで付くこと・MAC の分からない端末は host で覚えること・一覧に無い端末と不正な名前を断ること、`destinations.e2e.test.ts` の実プロセスでの保存と再起動後の復元、`test_destinations.py` の別名を見出しにすることと名前のダイアログ)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. 通常起動(`start-oscdesk.bat`)でブリッジと UI を立ち上げ、ブラウザで UI を開く。送信先パネルが走査を終えるまで待つ。
2. 名前の出ていない(IP のままの)端末の行の鉛筆ボタンを押す。**期待**: 「<IP> の名前」のダイアログが開き、MAC の分かる端末なら「MAC xx:xx:… で覚えます(IP が変わっても同じ名前で出ます)」、分からない端末なら「MAC が分からないため <IP> で覚えます(IP が変わると名前は外れます)」と出る。
3. 名前(例: `ステージ左 iPad`)を日本語入力で打つ。変換を確定する Enter ではダイアログは閉じない(iPad の Safari でも確かめる)。「決定」(または確定後の Enter)を押す。**期待**: ダイアログが閉じ、その端末の見出しが名前に変わり、補足に IP が出る。別のブラウザで開いた UI にも同じ名前が出る。逆引きなどで引けた名前のある端末に付けたときは、補足に引けた名前と IP の両方が出る。
4. 検索欄に付けた名前の一部を入れる。**期待**: その端末が残る。
5. 65 文字以上の名前は入力欄で打てない(入力欄の文字数の上限。絵文字は 1 文字で 2 と数える)。ブリッジに断られたとき(例: 通知「端末の名前を変更できません」)は、ダイアログが開いたまま入力が残る。
6. ブリッジのウィンドウを閉じて起動し直す(UI も開き直す)。**期待**: 走査の前から、選択中・設定の宛先の端末には付けた名前が出る。走査の後、ほかの端末にも名前が出る。保持値の保存先(既定 `surfaces/.values/`)に `.device-aliases.json` があり、MAC の分かる端末は `mac:…`(`host` に最後に見えた IP)、分からない端末は `host:…` のキーで書かれている。
7. (できれば)名前を付けた端末の IP を DHCP の再取得などで変え、「更新」で走査し直す。**期待**: MAC で覚えた端末は新しい IP の行に同じ名前が出る。名前を付けて選択中にした端末の電源を切って「更新」すると、行は「直近の走査で見つかりません」になるが名前は残る。その間に名前を変え、電源を入れて「更新」しても変えた名前のまま。
8. ブリッジを止めて `.device-aliases.json` の 1 件の `alias` を空文字にして起動し直す。**期待**: ブリッジのウィンドウに `ignored 1 invalid` の警告が出て、ほかの名前は残る。ファイルを JSON として壊して起動し直すと警告が出て名前は出ず、名前を付けても「端末の名前を保存できませんでした」と出てファイルは書き換わらない(直して起動し直すと元の名前が戻る)。
9. 鉛筆ボタンからダイアログを開き「名前を消す」を押す(入力欄を空にして「決定」でもよい)。**期待**: 見出しが元(引けた名前か IP)に戻り、`.device-aliases.json` からその端末のキーが消える。

## HID-353: OscReceiver の自前の UDP / OSC(uOSC の撤去、D-095)

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests` の `OscCodecTests`・`OscBinarySamplesTests`・`OscUdpTransportTests`。ループバックの実ソケットで、送信元ポート・ICMP Port Unreachable の後の受信・停止とポートの解放を確かめる)と、`corepack pnpm test` の `osc-binary-samples.test.ts`(同じ `protocol/osc-binary-samples.json` を TS の `osc-codec` で確かめる)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `OscSurface/` を Unity 6000.0.36f1 で開く。**期待**: Package Manager に uOSC(`com.hecomi.uosc`)が無く、Console にコンパイルエラーが無い。上の「HID-164」の手順 1〜6 がそのまま通る(`Listen Port` / `Reply Host` / `Reply Port` で設定する)。
2. Play 中に `launchers\start-oscdesk-debug.bat` でブリッジと UI を起動する。**期待**: UI の Unity の表示が「接続中」になり RTT が出る。スライダーとまとめ送りのボタンの操作が UnityEvent に届き、エコーで確定する。ブリッジのウィンドウに `Ignored /sys/pong from non-Unity source` が出ない。
3. **ICMP の後も受け続ける**: Play したままブリッジのウィンドウを閉じ、10 秒以上待ってから(その間の pong に ICMP Port Unreachable が返る)ブリッジを起動し直す。**期待**: 数秒以内に「接続中」に戻り、保持値が再送されて Unity に届く。Console に例外や「待ち受けられません」が出ない。同じことを mock ではなく別の PC のブリッジ(`Reply Host` を LAN の IP)でも確かめる。
4. **ポートの競合**: 別の Unity(または `ncat -u -l 7090` など)で 7090 を使ったまま Play する。**期待**: Console に「UDP ポート 7090 で待ち受けられません」のエラーが 1 回出る。相手を止めて OscReceiver を無効→有効にすると待ち受けが始まる。
5. **uOSC からの移行**: D-095 より前の `OscSurface`(uOSC が入っていて、GameObject に `uOscServer` / `uOscClient` が付いたシーン)で、この版の `OscReceiver.cs` / `Core/` / `Editor/` に差し替える。**期待**: `OscReceiver` のインスペクタに uOSC が残っている旨の警告と「uOSC の設定を取り込んでコンポーネントを外す」が出る。押すと `uOscServer.port` が `Listen Port` に、`uOscClient.address` / `port` が `Reply Host` / `Reply Port` に写り、uOSC のコンポーネントが外れる(Undo で戻せる)。保存後に `com.hecomi.uosc` を manifest から外しても Missing Script が出ない。
6. **IL2CPP**: Build Settings で Windows(と、使うなら macOS / Linux)を選び、Player Settings の Scripting Backend を IL2CPP にして、`OscReceiver` を置いたシーンをビルドする。ビルドしたアプリを起動し、手順 2・3 を行う。**期待**: 受信・送信・pong・エコーが Editor と同じに動き、ブリッジを閉じて起動し直した後も受け続ける。ログ(`Player.log`)に `SocketException` や `NotSupportedException` が出ない。Windows のファイアウォールの確認ダイアログが出たら、プライベートネットワークで許可する。

## HID-354: 受け口の UPM パッケージ(`com.hidano.oscdesk`、D-096)

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests`。`OscSurface` の manifest の `testables` で CI の `Unity CI` が実行。`OscReceiverPackageTests` がスクリプトの GUID・アセンブリ名・インスペクタ拡張の結び付きを確かめる)と、`corepack pnpm test` の `tests/guards/unity-package.test.ts`(見本の写しの一致・`.meta` の揃い・版と CHANGELOG・サンプルの定義の受理)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `OscSurface/` を Unity 6000.0.36f1 で開く。**期待**: Package Manager の In Project に **OscDesk Receiver**(`com.hidano.oscdesk`、Custom / 埋め込み)が出て、Console にコンパイルエラーが無い。`Assets/` に `OscReceiver/` が無い。Test Runner の EditMode に `OscDesk.Receiver.Tests` が出て全件緑
2. 既存のシーン(パッケージ化の前に `OscReceiver` を付けて保存したもの)を開く。**期待**: Missing Script にならず、対応表と登録した関数が残っている
3. パッケージの **Samples** から **Minimal Receiver** を Import し、`Assets/Samples/.../MinimalReceiver.unity` を開いて Play する。`start-oscdesk.bat`(mock-unity なし)でブリッジと UI を起動し、UI で同じフォルダの `MinimalReceiver.surface.json` を読み込んで採用する。**期待**: Unity の表示が「接続中」になり RTT が出る。スライダーを動かすと Console に `[MinimalReceiver] /sample/value = …`、ボタンで `[MinimalReceiver] /sample/hello` が出て、エコーで確定する
4. **レジストリから入れた形**: `cd OscSurface/Packages/com.hidano.oscdesk` → `npm pack --pack-destination <リポジトリの外のフォルダ>` で作った `.tgz` を(パッケージの中に作ると、開いている Unity が取り込んで `.meta` を作ってしまう)、空の Unity 6000.0 プロジェクトの manifest に `"com.hidano.oscdesk": "file:<.tgz の絶対パス>"` と `"testables": ["com.hidano.oscdesk"]` で入れる(`.tgz` は読み取り専用で入るので、npmjs から入れたときと同じく `.meta` の欠けが見える)。**期待**: Console に「has no meta file」や コンパイルエラーが出ず、EditMode の `OscDesk.Receiver.Tests` が全件緑(oscdesk リポジトリの外でも通る)。手順 3 と同じくサンプルでブリッジと ping / エコーが通る
5. 公開後(`docs/UPM_PACKAGE.md`): 空の Unity 6000.0 プロジェクトに npmjs のスコープ付きレジストリと `"com.hidano.oscdesk": "<版>"` を足すだけで、手順 3・4 と同じ結果になる

## HID-357: 名前の一覧の正規化と、変わったときだけ送る部品(D-098)

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests` の `OscNameListTests`(フォークのホストの 3 つの正規化を設定違いで再現)・`OscNameListFeedTests`・`OscNameListPublisherTests`)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `OscSurface/` の Minimal Receiver のシーン(HID-354 の手順 3)で、`OscReceiver` と同じ GameObject に `OscNameListPublisher` を追加し、`Receiver` に `OscReceiver`、`Address` に `/sample/names`、`Reserved Names` に `(none)` を設定する。`publisher.AddSource(() => names)` で `List<string>` を渡す一時的なスクリプトを置き、`names` を Inspector の配列などから変えられるようにする。定義に `s` の `state` パラメータ(`options: ["(none)"]`、`optionsFrom: { address: "/sample/names", request: "/sample/names/request" }`)を足し、`OscReceiver` に `/sample/names/request` の Trigger の行を足して On Trigger に `OscNameListPublisher.SendNow` を登録する
2. Play してブリッジと UI を起動する。**期待**: 到達の初報でブリッジが要求を送り、Console に「N 件を /sample/names へ送りました(request)」が出て、UI の選択欄に `(none)` と一覧の名前が並ぶ。`names` に `" "`・`"(none)"`・重複を入れると、それらは選択肢に出ず、Console に除いた理由の警告が出る
3. Play したまま `names` に名前を足す。**期待**: 3 秒以内に「(changed)」で送られ、UI に「新しい一覧があります」(D-088)が出る。変えずに待っても Console に送信のログも警告も重ならない。`OscNameListPublisher` のチェックを外すと、「Sync」でも送らない。UI の「Sync」で要求すると、一覧が同じでも「(request)」で送られる

## HID-359: `[OscAddress]` の宣言からの配線(D-100)

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests` の `OscReceiverWiringTests`。宣言だけで定義のすべての行(Value 4 型・Trigger・Strings・Record)に永続リスナーが付くこと、2 回目は何も変えないこと、手で登録したリスナーを残すこと、型の合わない・登録できない宣言と関数の無い行を警告すること)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `OscSurface/` を Unity 6000.0.36f1 で開き、新しいシーンに空の GameObject を置いて `OscReceiver` を追加する。同じ GameObject に、`[OscAddress("/sample/value")] public void OnValue(float v)` と `[OscAddress("/sample/hello")] public void OnHello()` を持つスクリプトを付ける(サンプル `MinimalReceiverLogger` と同じ形でよい)
2. インスペクタの「定義ファイル」に `Samples~/MinimalReceiver/MinimalReceiver.surface.json` を取り込んだもの(Import したサンプルの `.json`)を設定し、「定義から配線([OscAddress] の関数を登録)」を押す。**期待**: `/sample/value`(Float)と `/sample/hello`(Trigger)の行ができ、それぞれの `On Float` / `On Trigger` に手順 1 の関数が Runtime Only で登録される。インスペクタの下と Console に「行を追加」「リスナーを登録」の変更が出て、A4(関数が登録されていない)の警告が消える
3. もう一度押す。**期待**: 「変更はありません」で、リスナーは増えない。手でイベントに足した別の関数も残る
4. 手順 1 の `OnValue` の引数を `int` に変えて押し直す。**期待**: 「行 /sample/value の型は Float ですが、… は Int の行で受ける形」の警告が出て、登録は足されない(既に付いたリスナーは消さない)
5. シーンを保存して開き直し、Play で OscDesk(`start-oscdesk.bat`)からスライダーとボタンを操作する。**期待**: 登録した関数が呼ばれる(配線がシーンに保存されている)

## HID-381: 受け口のアドレスのパターン(D-106)

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests` の `OscAddressPatternTests`。各記法の一致・不一致、読めないパターンの完全一致への切り替え、パターンでないアドレスの振り分けが変わらないこと、256 行の上限と警告)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `OscSurface/` を Unity 6000.0.36f1 で開き、`OscReceiver` に Trigger の行 `/effect/spark1/stop`・`/effect/spark2/stop`・`/effect/smoke/stop` を足し、それぞれの `On Trigger` に `Debug.Log` で行が分かる関数を登録して Play する
2. OscDesk の定義と OSC パッドはまだパターンの文字(`*` `?` `[` `]` `{` `}` `,`)を受け付けないので、OSC を自由に送れるツール(TouchOSC・`oscsend` など)から `OscReceiver` の `Listen Port`(既定 7090)へ、引数なしの `/effect/spark*/stop` を送る。**期待**: `spark1` と `spark2` の行の関数だけが呼ばれ、`smoke` は呼ばれない
3. `/effect/{spark1,smoke}/stop` と `/effect/spark[!1]/stop` を送る。**期待**: それぞれ `spark1` と `smoke`、`spark2` だけが呼ばれる
4. `/effect/spark[1/stop`(読めないパターン)を送る。**期待**: どの行も呼ばれず、Console に警告も出ない

## HID-382: 受け手の Registry と基底コンポーネント(D-107)

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests` の `OscRegistryTests`)と PlayMode(`OscDesk.Receiver.PlayModeTests` の `OscTargetPlayModeTests`。batchmode では `-testPlatform PlayMode` で実行する。CI は EditMode だけ)。OscDesk から OSC を送って確かめる手順は HID-384 の節。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `OscSurface/` を Unity 6000.0.36f1 で開き、`OscTarget` を継承した確認用のスクリプト(README の `SparkEffect` の例でよい)を作って空の GameObject `spark1` に付ける。**期待**: インスペクタの「受け付けるアドレス」に `/effect/spark1/stop`(Trigger)と `/effect/spark1/rate`(Float)が出る。`Target Name` に `a b` を入れると、使えない名前の警告が出る
2. 手順 1 で入れた `Target Name` を空に戻してから Play する。Play したまま Hierarchy で `spark1` を複製し(Ctrl+D。名前は `spark1 (1)` になる)、複製のインスペクタの `Target Name` に `spark1` を入れる(Play の開始時の自動の付け直し(HID-383)より後に重ねるため、実行中に重ねる)。**期待**: Console に「/effect/spark1/stop は既に登録されているので受け付けませんでした(先に登録: spark1)」の警告が操作の数だけ出て、複製のインスペクタに「登録できなかったアドレスがあります」が出る

## HID-383: 重複した対象名の付け直し(D-109)

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests` の `OscTargetNameDeduplicatorTests`。保存時・Play の開始時の付け直し、重複が無いときに何も変えないこと、Undo で戻ること)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. `OscSurface/` を Unity 6000.0.36f1 で開き、HID-382 の手順 1 の `SparkEffect` を付けた GameObject `spark1` を Hierarchy で複製する(Ctrl+D。名前は `spark1 (1)` になるので、`Target Name` に `spark1` を入れて重ねる)
2. シーンを保存する(Ctrl+S)。**期待**: Console に「対象名を "spark1" から "spark1_2" に付け直しました(/effect/spark1/stop が同じシーンの別の対象と重なったため…)」が出て、後に並ぶ方の `Target Name` が `spark1_2` になり、インスペクタにも同じ文が出る。Ctrl+Z で `spark1` に戻る(戻したまま保存すると、また付け直される)
3. もう一度 `Target Name` を `spark1` に戻し、保存せずに Play する。**期待**: Play の開始時に同じく付け直され、Console に「既に登録されている」の警告が出ない。Play を止めるとシーンは未保存(付け直した名前のまま)になっている
4. 別のシーンにも `spark1` を置き、両方のシーンを開いて(片方を加算で開く)Play する。**期待**: シーンをまたいだ重なりは付け直されず、「シーン … と … で重なっています」の警告が出る

## HID-384: `OscReceiver` の振り分けの Registry への移行(D-108)

自動テスト: Unity の EditMode(`OscDesk.Receiver.Tests` の `OscRouterTests` と既存のテストすべて)と PlayMode(`OscDesk.Receiver.PlayModeTests` の `OscReceiverPlayModeTests`。ループバックの UDP で、対応表の行・エコー・pong・`/sys/ignored`・`/sys/failed`・`OscTarget` と `OscSpawner`・行と操作の重なり・無効化での登録の解除を確かめる)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. 既存のシーン(`OscSurface/` の Minimal Receiver、またはフォークのホストのシーン)を Unity 6000.0.36f1 で開き、何も変えずに Play して OscDesk(`start-oscdesk.bat`)から操作する。**期待**: 到達性・スライダー・ボタン・送信結果の点灯が HID-384 より前と同じ(対応表の行は Registry 経由でも同じに呼ばれる)。Console に「対応表の行 … は既に登録されている」が出ない
2. 同じシーンに、HID-382 の手順 1 の `SparkEffect` を付けた GameObject `spark1` を置いて Play し、OSC を自由に送れるツールから `OscReceiver` の `Listen Port` へ `/effect/spark1/stop` を送る。**期待**: `SparkEffect.Stop` が呼ばれ、エコーが返る
3. `OscSpawner` を付けた GameObject `spawner`(`Package Name` = `effect`、`Prefab` に `SparkEffect` を付けた Prefab)を置き、`/effect/spawner/spawn ,s "spark2"` を送る。**期待**: `spark2` の名前で生成され、`/effect/spark*/stop` で `spark1` と `spark2` の両方の `Stop` が呼ばれる。同じ `spawn ,s "spark2"` をもう一度送ると生成されず、ブリッジに `/sys/failed`(`/effect/spawner/spawn`, `name in use`)が届き、Console に `failed for /effect/spawner/spawn (string): name in use` が出る。`/effect/spawner/destroy ,s "spark2"` で消える


## ブラウザ発の WebSocket 接続の拒否(HID-309 / D-082)

1. 通常起動(`start-oscdesk.bat`)でブリッジと UI を立ち上げる。UI がブリッジに接続できている(画面のリンク表示が接続中)ことを確かめる。
2. 別のサイトの http ページ(https のページは混在コンテンツとして `ws://` への接続自体がブラウザに止められ、ブリッジに届かない。例: 別ポートで立てた簡単な http ページ)のブラウザの開発者ツールのコンソールで `new WebSocket('ws://<ブリッジのIP>:7080')` を実行する。**期待**: 接続は開かず(`onerror` / `onclose`)、ブリッジのウィンドウに `(WARN, BRIDGE) Rejected browser-originated WebSocket handshake` と `origin` が出る。
3. 手順 1 の UI は接続を保ったまま操作できる(拒否の影響を受けない)。

## HID-371: 設計図の Sync(プロトコルとブリッジ。D-104)

自動テスト: `catalog.test.ts`(要約値)・`catalog-manager.test.ts`・`tests/e2e/catalog.e2e.test.ts`・`wire-samples.json`。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。** UI の表示は続きの PR で足す。

1. mock-unity を設計図つきで起動する: `node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --catalog-json '{"name":"PC1","items":[{"address":"/a/x","kind":"state","type":"f","props":[]}]}'`。ブリッジを起動する
2. ブラウザの代わりに WebSocket クライアントで `ws://127.0.0.1:7080` へ接続し、`{"v":1,"type":"catalogRequest"}` を送る。**期待**: `catalog` フレームが届き、`pcs[0]` が `name: "PC1"`・`verified: true`・項目 1 件になる
3. mock-unity を `"corruptDigest":true` つきで起動し直して同じことをする。**期待**: `verified: false` の `catalog` と、`catalog-mismatch` の notice が届き、ブリッジのウィンドウに `Catalog digest mismatch` の警告が出る。受け取れた項目は残る

## 処理しなかった受信の報告 `/sys/ignored`・`/sys/failed`(HID-375 / D-105)

自動テスト: vitest の `packages/mock-unity/src/responder.test.ts`(mock の再現)と Unity の EditMode `OscDeliveryReportTests`(`corepack pnpm test` の対象外。Unity CI で実行)。

1. mock で再現する: `node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7099 --known-address /a --failing /b=exception` を起動し、別の端末で 7099 を待ち受ける OSC 受信側(または `tests/e2e/helpers` のクライアント)を用意して `/a`・`/b`・`/c` を 7090 へ送る。**期待**: `/a` はエコーのみ。`/b` はエコーの後に `/sys/failed ["/b","exception"]`。`/c` はエコーの後に `/sys/ignored ["/c"]`。`--known-address` と `--failing` を付けなければ、どれもエコーのみ
2. 実機: `OscSurface/` を Unity 6000.0.36f1 で開き、`OscReceiver`(`Report Outcomes` 既定オン)を置いて Play する。行の無いアドレス・Float の行に文字列・Record の行に形の違う引数を OscDesk の OSC パッド等から送る。**期待**: 受信側にエコーの後、それぞれ `/sys/ignored`・`/sys/failed`(`type mismatch` / `record mismatch`)が 1 メッセージずつ届く。`Report Outcomes` をオフにすると届かず、エコーと振り分けは変わらない
3. 注意: 認証の無い LAN 内でのみ使う。報告の件数・文字数には上限がある(`docs/UNITY_PROTOCOL.md` §1)

## HID-373: パラメータ ID の語彙と `osc.*` のフレーム(D-110)

自動テスト: `target-adapter.test.ts`(受信の 5 種類への振り分け)・`surface-core.test.ts`(`set` の型・範囲・trigger・単独で送らないものの扱い)・`tests/guards/osc-vocabulary.test.ts`(共通フレームに OSC の語が無いこと)・`tests/e2e/ws-protocol.e2e.test.ts`(`set` が型どおりの OSC で Unity に届き、範囲外を断る)・`test_protocol.py` / `test_state.py`(UI が `set` で送り、`hello.adapters` に従って OSC 専用の機能を出す)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. 検証ランチャー(`launchers\start-oscdesk-verify.ps1`)で mock-unity・ブリッジ・UI を起動し、ブラウザで UI を開く
2. スライダー・スイッチ・入力欄・トリガのボタンを操作する。**期待**: 従来どおり値が届いてエコーが戻る。ブラウザのヘッダーの「ログ」で送信ログを開くと、操作したパラメータのアドレスと型(スイッチは `i` の 0/1)で記録されている(UI はパラメータ ID と値だけを送り、アドレスと型はブリッジが決めている)
3. WebSocket クライアント(`npx wscat -c ws://127.0.0.1:7080` 等)で `{"v":1,"type":"set","param":"<数値のパラメータの id>","value":"x"}` を送る。**期待**: `set-rejected` の notice(`type-mismatch: …`)が返り、Unity へは何も送られない
4. 同じクライアントで最初に届く `hello` に `"adapters":["osc"]` があり、UI に「OSC パッド」のタブと送信ログが出ていることを確かめる

## HID-378: 操作中のロック(D-111)

自動テスト: `lock-manager.test.ts`(取得・延長・期限切れ・持ち主だけの解放・切断での解放・行単位)・`surface-core.test.ts`(ロック中の部品への `set` / まとめ送り / `osc.message` の拒否と、持ち主の変更の通過)・`tests/e2e/ws-protocol.e2e.test.ts`(2 つの WebSocket クライアントで、片方の操作中にもう片方の変更が断られ、期限切れの後は通る)・`test_state.py`(ほかのページのロックの判定と、送る値に操作したページの holder が付くこと)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. 検証ランチャー(`launchers\start-oscdesk-verify.ps1`)で起動し、2 台の端末(または 2 つのブラウザ)で UI を開く
2. 端末 A でスライダーを押したまま動かす。**期待**: 端末 B の同じスライダーが無効になり、下に「操作中: <端末 A の IP>」が出る。端末 A の操作は従来どおり届く
3. 端末 A でスライダーを放す。**期待**: すぐに端末 B のスライダーが有効に戻り、「操作中」の表示が消える
4. 端末 A でスライダーを押したまま、端末 A のブラウザのタブを閉じる(または通信を切る)。**期待**: 遅くとも 2〜3 秒で端末 B のスライダーが有効に戻る(期限の無いロックは残らない)
5. 入力欄でも同じことを確かめる(フォーカスしている間がロック中)。Record の表の行は、今はロックを取らない(HID-390)

## HID-386: 設計図のタブと、設計図からの既定の画面(D-112)

自動テスト: `blueprint-surface.test.ts`(項目からパラメータと既定の画面への変換・知らない kind / type を出さない・設計図に無いパラメータの判定・`catalogAdopt` と `blueprintStatus`)・`tests/e2e/catalog.e2e.test.ts`(mock-unity の設計図から画面を作って採用し、保存した画面を作り直しで上書きしない)・`test_blueprint_panel.py`。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。**

1. mock-unity を設計図つきで起動する: `node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --catalog-json '{"name":"PC1","items":[{"address":"/fx/light/level","kind":"state","type":"f","props":[{"key":"min","arg":{"type":"f","value":0}},{"key":"max","arg":{"type":"f","value":1}}]},{"address":"/fx/light/go","kind":"trigger","type":"i","props":[]}]}'`。ブリッジと UI を起動してブラウザで開く
2. 「設計図」タブで「設計図を取り直す」を押す。**期待**: `PC1(127.0.0.1)`・2 項目・「一致」の行が出る
3. 「この設計図から画面を作る」を押す。**期待**: 画面が `blueprint-PC1-<8 桁の 16 進>` に切り替わり、「fx / light」のグループにスライダーとボタンが並ぶ。スライダーを動かすと mock-unity にその値が届く
4. 編集モードで並べ替えるか部品を 1 つ足して保存し、もう一度「この設計図から画面を作る」を押す。**期待**: 保存した画面のまま(作り直さない)。足した部品は薄く表示され、「この PC には無い」が出る
5. mock-unity を `"corruptDigest":true` つきで起動し直して取り直す。**期待**: 行が「食い違い(…)」になる

## HID-374: ネットワークの設定(サーバーが使うネットワーク・ターゲットがいる範囲・接続してよいブラウザの範囲、D-113)

自動テスト: `corepack pnpm test`(`network-settings.test.ts` の CIDR の判定・自分を締め出す変更の拒否・localhost の常時許可・設定の保存と読み戻し・付け替えの順序、`lan-scan.test.ts` / `destinations.test.ts` の範囲での走査と選択の絞り込み、`udp-transport.test.ts` の同じポートでの付け替え、`ui-hub.test.ts` の範囲の外の送信元の拒否と既存接続の切断、`network-settings.e2e.test.ts` の実プロセスでの拒否と付け替え、`test_network_settings.py` の UI の判定とネットワークのタブ)。**認証が無いため信頼できる LAN 内でのみ試すこと。インターネットや信頼できないネットワークへ公開しない。許可リストは認証の代わりではない(同じ LAN の機器はアドレスを名乗り直せる)。**

用意: サーバー PC(ブリッジと UI を動かす)と、同じ LAN の別の端末を 2 台(スマホ A・B など)。各端末の IP を控える。

1. 通常起動(`start-oscdesk.bat`)でブリッジと UI を立ち上げ、サーバー PC のブラウザで `http://localhost:8080` を、スマホ A で `http://<サーバー PC の IP>:8080` を開く。タブの「ネットワーク」を開く。**期待**: 「状態: 保存していません(既定のまま)」、サーバーが使うネットワークは「すべてのネットワーク」、ターゲットがいる範囲は空(自動)、接続してよいブラウザの範囲は `0.0.0.0/0` と `::/0`。「このブラウザ」にスマホ A の IP が出る(サーバー PC では `127.0.0.1`)。
2. **自分を締め出す変更は断られる**: スマホ A で、接続してよいブラウザの範囲を `10.255.255.0/24`(スマホ A を含まない範囲)だけにする。**期待**: 入力欄の下に「このままではこのブラウザ(…)が範囲の外になるため、ブリッジは保存を断ります」が出る。「保存して適用」を押すと、通知「ネットワークの設定を変更できません: この変更をすると、操作しているブラウザ(<スマホ A の IP>)が接続できなくなります」が出て、設定は変わらない(サーバー PC の画面も元のまま)。
3. **許可リストで絞る**: スマホ A で、範囲を `<スマホ A の IP>`(1 台)だけにして保存する。**期待**: 両方のブラウザの「状態」が「保存済み」になり、範囲が `<スマホ A の IP>/32` と表示される。スマホ B で `http://<サーバー PC の IP>:8080` を開くと、「このブラウザ(接続元 …)からは OSCDesk に接続できません」の 403 の画面になる。スマホ B で先に UI を開いていた場合は、保存した直後にそのページが読み込み直されて同じ画面になる。スマホ A とサーバー PC は操作を続けられる。ブリッジのウィンドウに `Rejected an HTTP request ...`(UI 経由ではなくブリッジのポート 7080 に直接つないだとき)や `Closed N WebSocket connection(s) outside the allowed browser range` が出ることがある。
4. **localhost は常に通る**: サーバー PC のブラウザ(`http://localhost:8080`)で、接続してよいブラウザの範囲を空にして保存する。**期待**: 保存できる(localhost だけになる)。スマホ A も 403 の画面になる。サーバー PC からは操作を続けられ、「すべて許可」→「保存して適用」で元に戻せる。サーバー PC で `http://<サーバー PC の LAN の IP>:8080` を開いた場合は localhost ではないので範囲の判定を受けることも確かめる。
5. **再起動をまたいで残る**: 範囲を `<スマホ A の IP>` だけにした状態でブリッジのウィンドウを閉じ、起動し直す。**期待**: スマホ B は起動直後から 403 のまま(UI がブリッジから許可リストを受け取るまでの間は、localhost 以外は「ブリッジから…受け取るまで」の 503 になる)。保持値の保存先(既定 `surfaces/.values/`)に `.network-settings.json` があり、3 つの設定が書かれている。`config/oscdesk.config.json` は書き換わっていない。
6. **サーバーが使うネットワークを変えても切れない**: 「すべて許可」に戻してから、Unity(または `launchers\start-oscdesk-verify.ps1` の mock-unity)を別の PC で動かし、宛先を選んで「Unity 接続中」にする。スマホ A で、サーバーが使うネットワークをその Unity と同じネットワークの NIC(例 `Ethernet (192.168.1.10)`)にして保存する。**期待**: スマホ A・サーバー PC の画面は切れず(ヘッダーの「ブリッジ: 接続済み」のまま)、数秒以内に Unity の表示も「接続中」に戻り、スライダーの操作がエコーで確定する。別の NIC(Wi-Fi など)を選ぶと、その NIC からは Unity に届かないので「Unity 未接続」になるが、ブラウザの接続はやはり切れない。「すべてのネットワーク」に戻すと回復する。
7. **同じ PC の Unity**: サーバー PC の Unity(返信先 `127.0.0.1`)へ送る構成で、サーバーが使うネットワークを LAN の NIC にする。**期待**: Unity からの pong が届かず「Unity 未接続」になる(特定のアドレスで待ち受けると 127.0.0.1 へ返る応答を受けないため。画面の説明文のとおり)。`localhost (127.0.0.1)` か「すべてのネットワーク」を選ぶと回復する。
8. **ターゲットがいる範囲**: 送信先パネルで「更新」して端末の一覧を出してから、ターゲットがいる範囲に LAN の一部(例 `192.168.1.0/28`)を書いて保存する。**期待**: 走査し直さずに、範囲の外の端末が送信先パネルの一覧から消え、範囲の外で選んでいた端末は選択から外れる(ブリッジのウィンドウに `dropped host(s)` の警告)。「更新」で走査しても範囲の外の端末は出ない。範囲の外の IP をチェックしようとしても断られる。設定ファイルの宛先(`unity.host`)は範囲の外でも選べる。範囲にこの PC のどのネットワークにも重ならない CIDR(例 `172.31.0.0/24`)だけを書くと、送信先パネルのネットワークと「全てのデバイス」が無くなる。範囲を空にして保存すると元(自動)に戻る。
9. **不正な入力**: ターゲットがいる範囲に `192.168.1.5`(接頭辞なし)や `abc` を書いて保存する。**期待**: 通知「ターゲットがいる範囲「…」は IPv4 の CIDR(例 192.168.1.0/24)ではありません」が出て、設定は変わらない。
10. 保持値の保存先へ書けない状態(フォルダを読み取り専用にするなど)で設定を変える。**期待**: 通知「ネットワークの設定を保存できませんでした(ブリッジを止めるまで効きます)」が出て、「状態」が「ファイルへ書けなかったため…」になる。設定はその場では効いている。
11. **DNS の再束縛への備え(Host の検査)**: サーバー PC の hosts ファイルに `127.0.0.1 oscdesk-test.example` を足し、ブラウザで `http://oscdesk-test.example:8080` を開く。**期待**: 「OSCDesk はこの名前(oscdesk-test.example:8080)では開けません」の 403 になる。`http://localhost:8080`・`http://<この PC の IP>:8080`・`http://<この PC のホスト名>:8080` では開ける。確かめたら hosts の行を消す。
12. **ほかのブラウザが先に変えた後の古い画面**: スマホ A とスマホ B で同時にネットワークのタブを開く。A で範囲を変えて保存した後、B で(画面を開き直さずに)別の範囲を書いて保存する。**期待**: B の画面は A の保存で新しい設定に替わっていて、B の保存はその設定に対して通る。B の通信を止めて A の保存を受け取れない状態で B から保存した場合など、古い版の画面からの変更は、通知「ほかのブラウザが先に設定を変えました…」が出て設定は変わらない。A が B を範囲の外にした後に B から保存しても、通知「このブラウザ(…)は接続してよい範囲の外です」か 403 の画面になり、B は範囲へ戻れない。
