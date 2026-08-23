# VERIFICATION.md — 手動検証手順

各 Phase の完了時に、その Phase の動作確認手順を追記する。コマンドはリポジトリ root で実行する(PowerShell 想定)。

## ブリッジ + NiceGUI 構成 — 移行後の手動検証

ブリッジと NiceGUI UI の 2 プロセスだけで Unity を操作する構成の確認手順。検証端末と Unity (または同じプロトコルを実装した mock-unity) は信頼できる同一 LAN に置く。認証はないため、インターネットへ公開しない。

### セットアップ

1. リポジトリ root で `setup-oscdesk.bat` をダブルクリックするか、PowerShell で次を実行する。既にセットアップ済みなら、依存関係とビルドが最新であることを確認する。

   ```powershell
   .\setup-oscdesk.ps1
   ```

2. セットアップが完了し、`packages/bridge/dist/oscdesk-bridge.js` と `packages/nicegui-ui/.venv/Scripts/python.exe` が存在することを確認する。Unity を使う場合は `OscSurface/` を Unity Editor で開き、`Assets/OscSurfaceBridge/OscSurfaceBridge.unity` を Play Mode にする。mock-unity で代替する場合は次を実行する。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/default.json
   ```

### 起動と LAN 端末からの接続

1. Unity または mock-unity が待ち受けている状態で、リポジトリ root から通常起動する。

   ```powershell
   .\start-oscdesk.ps1
   ```

   または `start-oscdesk.bat` をダブルクリックする。これはブリッジと NiceGUI UI を起動し、`接続先 URL:` の下に LAN 用 URL を表示する。起動するプロセスはこの 2 つだけで、ほかのサーバーを別途立てる必要はない。

2. 同じ LAN に接続した別の PC またはスマートフォンで、起動ウィンドウに表示された `http://<この PC の LAN IP>:8080` を開く。画面が表示され、ヘッダーに `ブリッジ: 接続済み`、マニフェストに `採用済み`、ウィジェット群が表示されることを確認する。LAN IP が複数表示された場合は、検証端末と同じネットワークのアドレスを選ぶ。

3. 画面を数秒表示したままにし、ヘッダーの `Unity: 接続中 (… ms, 連続喪失 0 回)` (または同等の RTT 表示) を確認する。これが `Unity 未接続` のままなら、Unity の送信先・ブリッジの UDP 受信ポート 7091・Windows ファイアウォールを確認する。

### ping/pong、接続状態、エコーバック

1. `Unity: 接続中` と RTT の数値が表示されている状態で、Unity または mock-unity 側のログとブリッジのログを確認する。ブリッジから `/sys/ping` が送られ、Unity から `/sys/pong` が返り、画面の RTT・連続喪失回数が更新されることを確認する。Unity を一時停止して約 5 秒待つと `Unity 未接続` になり、再開すると `Unity 接続中` に戻ることも確認する。

2. 画面のスライダー、トグル、ボタンを操作する。操作値が Unity に届き、Unity から同じ値がエコーバックされた後に表示値が確定することを確認する。スライダーを保持中に別のエコーバックが来た場合は表示が飛ばず、指を離した後にエコーバック値へ揃うことも確認する。

3. ブラウザ描画の目視確認として、別の LAN 端末のブラウザでも同じ URL を開く。ヘッダーの接続状態、マニフェスト由来のラベル、グループ、スライダー・トグル・ボタン・表示専用値が崩れずに描画され、片方の端末で操作したエコーバック値がもう片方にも反映されることを確認する。これが D-032 で失った実ブラウザ検査 E2E の代替として、目視で残すブラウザ描画確認である。

### input / select の通常規模シナリオ

1. `default.json` の代わりに input / select を含むシナリオを起動する。既に mock-unity を起動している場合は停止してから、次を実行する。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/input-select.json
   ```

2. ブラウザを再読み込みし、input の文字列・整数・小数欄、インライン選択肢の select、共有参照の select、空選択肢の select がマニフェスト採用後に描画されることを確認する。空選択肢の select はグレーアウトされ、「選択肢なし」と表示され、操作できないことを確認する。

3. 文字列 input に値を入力している途中では Unity 側の値が入力欄を上書きしないことを確認する。Enter で確定し、入力欄の値が 1 回だけ送信され、Unity のエコーバック後に表示が確定することを確認する。別の値を入力してから入力欄の外をクリックする場合も同じ結果になる。入力中に 1 文字ずつ送信されていないことを、診断ログの同一アドレスの送信記録で確認する。

4. 整数 input では int32 の上限・下限内の値が送信され、値域外の値は送信されずエラー表示になることを確認する。`range` 付き input では範囲内の値が送信され、範囲外の値は拒否されることを確認する。`pattern` 付き input では一致する値だけが送信され、不一致の値は拒否されることを確認する。Enter で拒否された場合とフォーカス喪失で拒否された場合のいずれも、入力欄が Unity の現在値へ復元され、形式不正の通知が表示されることを確認する。

5. select で別の選択肢を選び、選択操作の直後に文字列型タグで 1 回送信されることを確認する。Unity のエコーバック後に選択表示が確定し、エコーバック前の一時表示だけで確定扱いにならないことを確認する。選択肢外の初期値を持つ select では、選択肢一覧に値が追加されず、受信した値が表示部にそのまま表示されることを確認する。空選択肢の select は送信されないことも確認する。

6. 日本語入力を使用する環境では、文字列 input に IME で日本語を入力し、変換中の Enter では送信されず、変換を確定した Enter と入力値の確定操作が二重に送信されないことを確認する。診断ログで 1 回の確定に対する送信が 1 件だけであることを確認する。

7. ログ確認には「ログと標準出力の観測場所」に示した NDJSON とブリッジ標準出力を使う。各操作について、送信アドレス・型タグ・送信回数・同一値のエコーバックを記録し、キーストロークごとの送信、拒否した値の送信、エコーバック前の確定がないことを確認する。

### 大規模シナリオの描画・操作計測

1. 通常規模シナリオを停止し、約 260 エントリの大規模シナリオを起動する。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/large-input-select.json
   ```

2. ブラウザの開発者ツールを開き、Console を消去する。ブラウザを再読み込みした時刻から、ヘッダーの `採用済み` 表示と全ウィジェットの描画が完了するまでをストップウォッチまたは Performance パネルで測る。キャッシュありの通常起動で 3 回行い、必要に応じてハードリロードの結果も別に記録する。測定中は同じ PC・同じブラウザ・同じウィンドウサイズを使う。

3. 64 グループ相当の折りたたみパネルが表示され、各パネルを開閉できることを確認する。先頭・中央・末尾のグループをそれぞれ開閉し、全エントリが欠落せず、input / select を操作できることを確認する。開閉の開始から内容が表示されるまでを 3 回測り、操作中の目立つフリーズやブラウザエラーの有無を記録する。

4. 開いたパネル内の input で値を確定し、select で値を選択する。操作開始から UI の表示更新、さらに Unity のエコーバックによる確定までを各 3 回測る。送信が 1 回であることと、別グループの表示が崩れないことをログでも確認する。

5. 記録欄（日時・ブラウザ・OS・CPU/メモリ・画面サイズ・試行回数）を埋め、次の表を手動検証結果に添付する。初回描画や操作応答が実用範囲を外れる場合は、遅延描画をこのタスクで実装せず、実測値と再現条件を後続課題として記録する。

   | 測定項目 | 1回目 | 2回目 | 3回目 | 平均 / 備考 |
   | --- | ---: | ---: | ---: | --- |
   | 初回マニフェスト採用〜全描画完了 (ms) |  |  |  |  |
   | グループ開閉 (先頭) (ms) |  |  |  |  |
   | グループ開閉 (中央) (ms) |  |  |  |  |
   | グループ開閉 (末尾) (ms) |  |  |  |  |
   | input 操作開始〜エコーバック確定 (ms) |  |  |  |  |
   | select 操作開始〜エコーバック確定 (ms) |  |  |  |  |
   | ブラウザエラー / 欠落 / フリーズ |  |  |  | なし / 内容 |

#### 12.2 実測結果 (2026-08-23)

この環境では実ブラウザを起動できないため、ブラウザ相当の NiceGUI テストとリポジトリのテスト入口で確認した。実ブラウザでのストップウォッチ計測欄は未実施として残し、遅延描画を追加する判断材料には用いない。

| 測定対象 | 実測結果 | 条件 / 備考 |
| --- | ---: | --- |
| 大規模シナリオのエントリ数 | 260 | `large-input-select.json`。64 グループ × 4 + Global 4 |
| 大規模シナリオの決定性・スキーマ検証 | 24 ms | mock-unity の Vitest シナリオテスト |
| input / select ブラウザ相当テスト | 5 tests passed | pytest 全体 139 passed / 2 skipped の内訳 |
| 実ブラウザ初回描画・操作応答 | 未実施 | ブラウザ実機がないため、後続の手動検証で測定 |
| 全テスト入口 (`corepack pnpm test`) | 19.1 s | Vitest 32 files / 233 tests、pytest 139 passed / 2 skipped |

### 誤接続ガード

1. 正常な値を確認した後、Unity または mock-unity を停止する。mock-unity を使う場合は `wrong-project.json` で起動する。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/wrong-project.json
   ```

2. ブラウザを再読み込みする。`projectId` が `expectedProjectId` (`oscdesk-demo`) と一致しないマニフェストは採用されず、既に表示されているウィジェットと値が差し替わらないことを確認する。画面のマニフェスト欄に `誤接続の疑い` または `projectId 不一致` が表示されることも確認する。

### ログと標準出力の観測場所

- NDJSON はリポジトリ root の `logs/diagnostics/` に出力される。通常の診断ログは `oscdesk-*.ndjson`、誤接続の拒否は `oscdesk-guard-*.ndjson` で、1 行が 1 JSON である。正常接続では `ping`/`pong` と値の送受信、ガード確認では `kind: "guard-reject"`、`expectedProjectId`、`receivedProjectId` を見る。確認には次を使う。

  ```powershell
  Get-ChildItem logs/diagnostics
  Get-Content (Get-ChildItem logs/diagnostics/*.ndjson | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -TotalCount 20
  Get-Content (Get-ChildItem logs/diagnostics/oscdesk-guard-*.ndjson | Sort-Object LastWriteTime | Select-Object -Last 1).FullName -TotalCount 20
  ```

- ブリッジの標準出力は `OSCDESK_BRIDGE_READY {...}`、起動エラー、`(ERROR, CUSTOM MODULE) Manifest project mismatch: ...` などのブリッジ側観測値を見る場所である。`start-oscdesk.ps1` はブリッジを非表示で起動して標準出力を一時ファイルへリダイレクトし、終了時に削除するため、実行中に標準出力を観測する場合は別ターミナルで次を実行する（UI は通常どおり起動し、同じブリッジへ接続する）。

  ```powershell
  node packages/bridge/dist/oscdesk-bridge.js
  ```

  `start-oscdesk.ps1` を同時に実行して二重起動しない。標準出力と NDJSON は別物であり、ブラウザの接続状態は UI がブリッジから受け取った表示、NDJSON は root の `logs/diagnostics/` にある記録として突き合わせる。

### 完了条件

この手順を上から実施し、LAN 端末からの描画、ブリッジ接続、Unity の ping/pong と接続状態、値のエコーバック、誤接続マニフェストの拒否、ならびに対応する NDJSON とブリッジ標準出力を確認できれば、ブリッジ + NiceGUI の 2 プロセス構成の主要機能を手動で確認できたものとする。
