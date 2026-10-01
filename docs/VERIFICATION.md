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

   ウィンドウの × ボタンで閉じた後、`netstat -aon | find "7091"` に node.exe が残らないことを確認する(子プロセスは Job Object で親と道連れになる)。念のため孤立した `oscdesk-bridge.js` の node.exe を手で作ってから起動すると、`前回の起動で残っていたプロセスを停止しました: node.exe PID …` と表示され、ポート使用中にならずに起動することを確認する。

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

   あわせて次の 2 点を確認する。(a) 入力欄をクリックしてフォーカスしただけ（1 文字も打たない）の状態で、別の端末または `/vp/all/active` のような展開エコーで同じアドレスの値が変わっても、フォーカス中の欄は書き換わらない。フォーカスしたまま 2 分以上放置しても同じで、欄の外をクリックした後の次のエコーバックで表示が揃う。(b) 何も編集せずに Tab で欄を通り抜ける、またはクリックして離れるだけでは診断ログに送信が記録されない。同じ値を送り直したい場合は Enter を押す。

4. 整数 input では int32 の上限・下限内の値が送信され、値域外の値は送信されずエラー表示になることを確認する。`range` 付き input では範囲内の値が送信され、範囲外の値は拒否されることを確認する。`pattern` 付き input では一致する値だけが送信され、不一致の値は拒否されることを確認する。Enter で拒否された場合とフォーカス喪失で拒否された場合のいずれも、入力欄が Unity の現在値へ復元され、形式不正の通知が表示されることを確認する。

5. select で別の選択肢を選び、選択操作の直後に文字列型タグで 1 回送信されることを確認する。Unity のエコーバック後に選択表示が確定し、エコーバック前の一時表示だけで確定扱いにならないことを確認する。選択肢外の初期値を持つ select では、選択肢一覧に値が追加されず、受信した値が表示部にそのまま表示されることを確認する。空選択肢の select は送信されないことも確認する。

6. 日本語入力を使用する環境では、文字列 input に IME で日本語を入力し、変換中の Enter では送信されず、変換を確定した Enter と入力値の確定操作が二重に送信されないことを確認する。診断ログで 1 回の確定に対する送信が 1 件だけであることを確認する。

7. ログ確認には「ログと標準出力の観測場所」に示した NDJSON とブリッジ標準出力を使う。各操作について、送信アドレス・型タグ・送信回数・同一値のエコーバックを記録し、キーストロークごとの送信、拒否した値の送信、エコーバック前の確定がないことを確認する。

### 大規模シナリオの描画・操作計測

1. 通常規模シナリオを停止し、約 260 エントリの大規模シナリオを起動する。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/large-input-select.json
   ```

   mock-unity は送信直前のマニフェスト JSON が 48KB を超えると `[mock-unity] /sys/manifest is NN.N KB ...` を標準エラーに出す。大規模シナリオ（約 40KB）ではこの警告が出ないことを確認する。警告が出る場合はマニフェストが単一データグラムの実用上限（60KB）に近づいているので、`optionsRef` への置き換えやラベルの短縮を検討する。

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

| 測定対象 | 実測結果 | 条件 / 備考 |
| --- | ---: | --- |
| 大規模シナリオのエントリ数 | 260 | `large-input-select.json`。64 グループ × 4 + Global 4 |
| 大規模シナリオのマニフェスト JSON サイズ | 39.7 KB（共有参照）/ 66.3 KB（インライン展開） | 2026-08-28 再計測。日本語混在のデバイス名 8 件（20〜40 文字）。共有参照は警告閾値 48KB 未満、インライン展開は実用上限 60KB 超で、Vitest が両方を回帰ガード |
| 大規模シナリオの決定性・スキーマ検証 | 24 ms | mock-unity の Vitest シナリオテスト |
| input / select ブラウザ相当テスト | 5 tests passed | pytest 全体 139 passed / 2 skipped の内訳 |
| 全テスト入口 (`corepack pnpm test`) | 19.1 s | Vitest 32 files / 233 tests、pytest 139 passed / 2 skipped |

##### 実ブラウザ計測 (自動)

上の手順 2〜4 を `node scripts/measure-large-scenario.mjs --runs 3` で自動化して測った。スクリプトは mock-unity(大規模シナリオ)・ブリッジ・NiceGUI UI を一時ポートで起動し、開発用の軽量ブラウザ(Playwright 同梱 Chromium の headless)で操作する。常用ブラウザには接続しない。

- 日時: 2026-08-23
- ブラウザ: Playwright 1.62.1 同梱 Chromium (headless)、ビューポート 1280 × 900
- OS: Windows 11 Pro 10.0.26200 / CPU: AMD Ryzen 9 9900X / メモリ: 62 GB
- 試行回数: 各 3 回。ページはその都度読み込み直す

| 測定項目 | 1回目 | 2回目 | 3回目 | 平均 / 備考 |
| --- | ---: | ---: | ---: | --- |
| 初回マニフェスト採用〜全描画完了 (ms) | 372 | 287 | 279 | 平均 313 |
| グループ開閉 (先頭) (ms) | 240 | 258 | 263 | 平均 254 |
| グループ開閉 (中央) (ms) | 246 | 258 | 265 | 平均 256 |
| グループ開閉 (末尾) (ms) | 248 | 262 | 324 | 平均 278 |
| input 操作開始〜エコーバック確定 (ms) | 70 | 61 | 70 | 平均 67 |
| select 操作開始〜画面反映 (ms) | 316 | 368 | 531 | 平均 405 |
| うち 選択肢クリック〜画面反映 (ms) | 13 | 10 | 18 | 平均 14 |
| select エコーバック到達〜画面反映 (ms) | 37 | 40 | 33 | 平均 37 |
| ブラウザエラー / 欠落 / フリーズ | なし | なし | なし | なし (グループ 65 / 入力欄 260 を毎回確認) |

計測点の注記:

- **初回描画**はページ読み込みからヘッダーの `260 件` 表示と 260 番目の入力欄の出現までを 1 回とする。
- **グループ開閉**は既定で開いた状態のパネルを一度閉じてから、開く操作の開始〜内容表示までを測る。値の大半は Quasar の開閉アニメーション時間である。
- **input のエコーバック確定**は、`f` 型の値が OSC の 32bit float を往復して別の文字列表現で戻る(例: 入力 `0.870000` → 表示 `0.8700000047683716`)ことを利用し、表示が入力文字列から変わった時点を確定とみなす。
- **select** は選択した値と Unity が返す値が同一文字列のため、エコーバック確定が DOM にも NiceGUI の更新フレームにも現れない。そのため操作側は「画面反映まで」を測り、エコーバック経路は別途 `/slots/01/device` へ選択肢外の値を OSC で送り、`display-value` 側の表示に切り替わるまでを測っている。`select 操作開始〜画面反映` にはドロップダウンの開閉アニメーションが含まれる。

いずれの項目も実用範囲に収まっており、要件 8.1 / 8.2 に対して遅延描画の追加は不要と判断した。

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

## Unity ステージング構成 — 手動検証

ステージング対象の編集値を保持し、Update 受信時だけ購読者へ適用する構成を確認する。ここでは upstream の `staging.json` を使う。検証中は mock-unity の標準エラーに出る `MOCK_UNITY_APPLY <triggerAddress> <valueCount> <json>`、ブリッジの NDJSON に `dir: "out"` で記録される適用セットの各メッセージ、および必要に応じて Unity の適用ログを観測する。

### 前提と起動

1. リポジトリ root で、既存の mock-unity とブリッジ/UI を停止してから、次の mock-unity を起動する。

   ```powershell
   node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/staging.json
   ```

2. 別のターミナルで `start-oscdesk.ps1` (または `start-oscdesk.bat`) を起動し、表示された URL をブラウザで開く。マニフェストが採用され、Member 01/02 の name・enabled・update、All Members Enabled・Update All Members、Legacy Status が表示されることを確認する。

3. mock-unity を実機 Unity に置き換える場合は、`OscSurface/` を Unity Editor で開いて `Assets/OscSurfaceBridge/OscSurfaceBridge.unity` を Play Mode にし、同じステージング宣言を持つマニフェストアセットを読み込む。実機では適用イベントの購読者が出力する適用ログも観測対象にする。

### 検証項目

#### 編集時は表示だけが確定し、適用されない

- **前提**: staging シナリオで接続済み。`MOCK_UNITY_APPLY` がまだ出ていない。
- **操作**: Member 01 の name を別の文字列へ確定し、Member 01 の enabled をオンにする。Update は押さない。
- **期待結果**: 各操作は入力値のエコーバック後に 1 回ずつ表示へ反映される。`MOCK_UNITY_APPLY` は出ず、実機でも適用イベントは発火しない。受信値はステージング値およびマニフェストの `default` の供給値として保持される。

#### Update の 1 押下につき適用は 1 回

- **前提**: Member 01 の name/enabled を変更済み。mock-unity の標準エラーを表示している。
- **操作**: Member 01 Update を 1 回押して離す。押下と解放の両方が送信される UI であることを前提に、ボタン操作を 1 回だけ行う。押下直後に、最新の NDJSON ファイルからこの操作に対応する `dir: "out"` の記録を確認する。
- **期待結果**: NDJSON には `/member/01/name`、`/member/01/enabled`、`/member/01/update` の順に、値 2 件とトリガ 1 件が `out` として記録される。値は画面に表示されている `name` と `enabled` と一致し、トリガの `i` 値は `1` である。mock-unity には次の形式の行が 1 行だけ出る（値は操作した表示値に置き換える）。

  ```text
  MOCK_UNITY_APPLY /member/01/update 2 [{"address":"/member/01/name","value":"Alicia"},{"address":"/member/01/enabled","value":1}]
  ```

  値 `1` で適用イベントが 1 回発火し、値 `0` ではエコーバックだけで再度発火しない。適用後も name/enabled のステージング値は保持される。適用範囲に値がない場合もエラーにせず、トリガ自身のエコーバックを続ける。

#### Unity 再起動後の表示再同期と適用

- **前提**: staging シナリオで接続済み。Member 01 の name を `BeforeRestart` など既定値と異なる値へ確定し、画面にエコーバックされたことを確認する。input は一度フォーカスして編集中のままにする。
- **操作**: mock-unity を停止してから、同じ `staging.json` で再起動する（実機 Unity の場合は Play Mode を停止してから再度 Play Mode にする）。再起動後のマニフェストが採用されたことを確認し、編集中の input は値を確定せずにフォーカスを外す。
- **期待結果**: 同一内容のマニフェストでも新しい採用として扱われ、確定済みの表示値は再起動後に供給された `default`（Member 01 name は `Alice`、enabled は `false`）へ戻る。フォーカス中の input は再同期中に上書きされず、確定せずに離れると再起動後の `default` へ戻り、追加の値送信は発生しない。再起動だけでは `MOCK_UNITY_APPLY` は出ない。
- **操作**: 再起動後の `default` が表示された状態で、Member 01 の name を別の値へ変更せず、Member 01 Update を 1 回押して離す。NDJSON と mock-unity の適用行を確認する。
- **期待結果**: NDJSON の適用セットには再起動後に画面へ表示された `Alice` と `0` が値として含まれ、トリガが末尾に記録される。mock-unity には再起動後の値と一致する JSON 付きの `MOCK_UNITY_APPLY /member/01/update 2 [...]` が 1 行出る。

#### 64 スロット相当の適用セット（実機 Unity）

64 スロット相当のマニフェストを実機 Unity で使用する場合は、Update の適用イベントが一度だけ発火し、適用値が全件揃っていることを確認する。mock-unity で代替する場合は `packages/mock-unity/scenarios/large-staging.json`(`generate-large-staging-scenario.mjs` で生成。64 スロット × 4 項目 + 各スロットの update + `/slots/all/update` + MB 群の 324 エントリ)を `--scenario` に指定し、NDJSON と標準エラーを記録する。

- **準備**: 64 スロットの各入力を表示し、必要なら数件だけ既定値と異なる値へ変更してエコーバックを確認する。実機 Unity では `ApplyRequested` の検証用購読者を接続し、適用トリガの Console ログを記録できるようにする。
- **操作**: 全スロットを対象とする Update を 1 回押して離す。ブリッジ NDJSON の同一送信時刻付近にある `out` 記録を抽出し、トリガを含むメッセージ数と値を数える。
- **期待結果**: `ApplyRequested` は 1 回だけ発火し、購読者の適用値は 256 件になる。NDJSON は適用範囲の値 256 件と末尾のトリガ 1 件を順序どおり記録し、Unity の適用ログに出た 256 件の値が画面表示値と一致する。欠落、重複、トリガの先行送信がないことを記録する。

#### 一括展開で各ウィジェットが追従する

- **前提**: Member 01/02 の enabled が表示され、All Members Enabled が表示されている。
- **操作**: All Members Enabled をオンにする。
- **期待結果**: 展開元 `/member/all/enabled` のエコーバックに続き、Member 01/02 の `/enabled` へ個別エコーバックが届き、両方のトグルがオンになる。展開だけでは適用イベントは発火しない。ログ上、1 回の受信に対して展開先 2 件の個別エコーがあり、欠落や無限連鎖がない。

#### 再接続後にステージング値が復元される

- **前提**: Member 01/02 の name または enabled を変更し、Update を押さずに表示が確定している。
- **操作**: ブラウザを再読み込みする。必要なら mock-unity を停止・再起動して Unity 接続も再確立する。
- **期待結果**: マニフェスト再取得後、変更した name/enabled が最後にエコーバックされたステージング値で表示される。Update 前の値が既定値へ戻らず、再接続だけで適用イベントは発火しない。

#### 購読者の例外後もエコーバックが継続する（実機 Unity）

この項目だけは mock-unity では確認できない。実機 Unity と、以下の 2 つの準備が要る。`ApplyRequested` の購読者は製品コードに存在しない（インスペクタ結線を提供しない設計のため）ので、検証用の購読者を一時的に付ける。

**準備 1 — マニフェストアセットのステージング宣言を確認する。** 同梱の `Assets/OscSurfaceBridge/OscSurfaceManifest.asset` には次の宣言が既に入っている（コミット `d988b76`）。Inspector で以下のとおりになっていることを確認し、二重に設定しない。

| エントリ | 確認項目 |
|---|---|
| `/avatar/text/name` | `Staged` がオン |
| `/avatar/toggle/visible` | `Staged` がオン |
| `/avatar/generated/wave`（button） | `Applies To` に `/avatar/text/*` と `/avatar/toggle/*` |

トリガ自身は `Staged` をオフのままにする（オンにすると S2 で起動時にマニフェストが送信されなくなる）。これらのフィールドはマニフェスト JSON へ出力されないため、設定を残したままでも UI 側には影響しない。独自のマニフェストアセットで検証する場合は、宣言がゼロだと計画が `Empty` になり適用イベントは発火しないため、同等の宣言を入れてから始める。

**準備 2 — mock-unity を停止する。** mock-unity と Unity は同じ受信ポートを使うため共存できない。ブリッジと UI は起動したままでよい。

- **前提**: 上記 2 点を済ませ、`OscSurfaceBridge` コンポーネントを持つ GameObject へ `StagingApplyProbe`（`Assets/OscSurfaceBridge/StagingApplyProbe.cs`。適用値を Console へ記録した直後に必ず例外を投げる検証用購読者）を追加し、`OscSurfaceBridge.unity` を Play Mode にする。Console に `[StagingApplyProbe] subscribed` が出る。
- **操作**: Character Name を書き換えて確定し、Visible を切り替える（この時点では適用ログが出ないこと）。次に Wave ボタンを押す。その直後に Character Name または Visible をもう一度変更する。
- **期待結果**: Wave 押下で `[StagingApplyProbe] apply #1 trigger=/avatar/generated/wave count=2` と各値が Console に記録され、続けて `InvalidOperationException` が記録される。購読者例外が記録されてもトリガのエコーバックは先に送信済みで、続く Character Name / Visible の受信にも通常どおりエコーバックが返り、UI が停止・不整合にならない。例外は次の受信処理へ伝播しない。
- **後始末**: Play Mode を抜け、`StagingApplyProbe` コンポーネントを外す。`StagingApplyProbe` は検証専用であり製品コードから参照しない。

### 展開バーストの実測記録

64 相当の展開先を持つステージング構成で、1 件の展開元受信から各展開先の個別エコーが UI に反映されるまでを確認する。数値目標は設けず、欠落があれば再現条件とともに後続課題へ記録する。

| 測定項目 | 1回目 | 2回目 | 3回目 | 平均 / 備考 |
| --- | ---: | ---: | ---: | --- |
| 展開先数 | 64 | 64 | 64 | 64（展開元エコーを含む送出は各回65件） |
| 展開元受信〜最後の展開先エコー到達 (ms) | 2.3359 | 1.1149 | 1.3328 | 1.5945（クライアント送信開始〜最後の受信 datagram。loopback UDP） |
| UI の先頭ウィジェット反映〜最後のウィジェット反映 (ms) | 0.0 | 0.1 | 0.0 | 0.03（実ブラウザ計測。下の注記を参照） |
| UI の input 確定〜最後のウィジェット反映 (ms) | 57.2 | 15.1 | 16.0 | 29.4（同上。UI 操作を起点にした往復全体） |
| エコー欠落数 | 0 | 0 | 0 | 0（65件中） |
| 表示の不整合 / フリーズ | なし | なし | なし | 受信側 datagram の欠落・停止なし。ブラウザ計測でもエラー・欠落なし |

記録日時: 2026-08-24（UDP 計測）　ブラウザ/OS: 該当なし（Node.js mock-unity / Windows）　接続形態: mock-unity　備考: 各回の送出 payload 合計は 1,816 bytes（最小24 / 最大28 bytes）。最初のエコーから最後のエコーまでの到達幅は 0.3522 / 0.1500 / 0.1585 ms。Unity Editor は未実行。緩和機構は追加せず、必要なら後続 spec で扱う。

##### 実ブラウザ計測 (自動)

上表の UI 2 行は `node scripts/measure-staging-burst.mjs --targets 64 --runs 3` で測った。スクリプトは 64 展開先のステージングシナリオを一時ファイルへ生成し、mock-unity・ブリッジ・NiceGUI UI を一時ポートで起動して、開発用の軽量ブラウザ（Playwright 同梱 Chromium の headless）で操作する。常用ブラウザには接続しない。

- 日時: 2026-08-25
- ブラウザ: Playwright 1.62.1 同梱 Chromium (headless)、ビューポート 1280 × 900
- OS: Windows 11 Pro 10.0.26200
- 構成: 展開元 `/burst/src`（`s` 型 input）1 件 + 展開先 `/burst/t01`〜`/burst/t64`（`s` 型 text）64 件。展開先パターンは `/burst/t*`
- 試行回数: 3 回。毎回一意なトークン文字列を input へ確定し、64 件すべてがその値を表示するまでを 1 回とする

計測点の注記:

- **反映幅**は各展開先カードのテキストにトークンが現れた時刻（`performance.now()`）の最初と最後の差である。64 件が同一の `MutationObserver` コールバックで検出されるため、実質的に 1 フレームで一括反映されている。0.0 ms は「反映の引きずりが観測されない」ことを表し、測定不能や欠落を意味しない（64 件の到達自体は毎回確認している）。
- **input 確定〜最後のウィジェット反映**は Enter 押下直前から最後のカードが更新されるまでで、UI → ブリッジ → mock-unity → 展開 65 件のエコー → UI の往復すべてを含む。1 回目が長いのは初回の経路確立を含むためで、2 回目以降は 15〜16 ms で安定する。

### Unity EditMode テストの実行方法

1. Unity Editor で `OscSurface/` プロジェクトを開き、インポートとコンパイルが完了するまで待つ。
2. メニューから **Window > General > Test Runner** を開く。
3. Test Runner の **EditMode** タブを選択し、一覧に `OscSurfaceBridge.Staging.Tests` とステージングのテストが表示されることを確認する。
4. **Run All** を押し、全テストが緑になることを確認する。失敗した場合はテスト名、Console の例外、Unity Editor のバージョンを記録する。

この EditMode テストはリポジトリの `corepack pnpm test` (Vitest + pytest) のテスト入口にも CI にも接続されておらず、同コマンドを実行しても Unity テストは実行されない。Unity を実行できない環境では、EditMode テストを未実施として記録し、`corepack pnpm test` の結果と混同しない。

#### Unity Editor を開かずに実行する(batchmode)

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
- 結果の確認は XML の `test-run` 要素(`total` / `passed` / `failed`)を見る。終了コードはテスト失敗時に 2 になる
- Editor のパスはインストール先に読み替える。このマシンでは Unity Hub 配下ではなく `D:\UnityEditors\<version>\Editor\Unity.exe` にある

#### 2.4 Unity batchmode コンパイル・EditMode 実行結果

- 実施日: 2026-09-26
- Unity Editor: `6000.0.36f1` (`D:\UnityEditors\6000.0.36f1\Editor\Unity.exe`)
- コンパイル確認: 成功（終了コード 0、ログ内の `error CS` 0 件）
- EditMode テスト: 成功（終了コード 0、`total=19`、`passed=19`、`failed=0`、`inconclusive=0`、XML の `result=Passed`）
- 備考: 実行前に OscSurface を開いている Unity プロセスがないことを確認した。残存していた `Library/ArtifactDB-lock` と `Library/SourceAssetDB-lock` を一時退避してから実行した。

### ステージング検証の完了条件

上記 5 項目で、編集時の非適用、Update 1 押下 1 適用、一括展開の個別エコー、再接続後の値復元、購読者例外後のエコーバック継続を確認し、展開バーストの記録欄を埋める。さらに Unity Editor の EditMode テストを実行できる環境では全件緑を確認する。

## runtime-manifest-reinject: P1 ブリッジの採否と照合(タスク 1.1〜1.4)

自動テスト(`corepack pnpm typecheck` と `corepack pnpm test`)の単体テストで、重複判定、強制採用、stats の不一致からの回復、再起動の検出を決定的に確認する。手動確認の手順は次のとおり(Unity 側の対応が入るまでは mock-unity の組あり応答が無いため、組を持たない従来経路の非退行確認が中心になる)。

1. `start-oscdesk.bat` でブリッジと UI を起動し、既存の Unity または mock-unity につなぐ。マニフェストが従来どおり採用され、UI にコントロールが出ることを確認する。
2. 組(`bootId` / `structureGeneration`)を持たないマニフェストでは、`/sys/stats/request` がブリッジから送られないこと(`start-oscdesk-debug.bat` の診断ログで確認)。
3. 組を持つ `/sys/manifest` を同じ内容で 2 回送る(任意の OSC 送信ツールを使う)。2 回目はブリッジが採用せず、UI の再生成も起きない(ブリッジの `manifest` フレームの `adoption.seq` が増えない)こと。
4. 組を持つマニフェスト受理後、約 4 秒ごとに `/sys/stats/request` が出ること。`/sys/stats` の組を別の値にして返すと、INFO ログが 1 行出て直ちに `/sys/manifest/request` が送られること。

## runtime-manifest-reinject: P3 mock-unity の実行時切り替えと組の送出(タスク 3.1〜3.3)

自動テスト(`corepack pnpm test` の mock-unity 単体テスト)で、組の送出、切り替えの検査順序、引き継ぎ、拒否、障害注入を確認する。手動確認の手順は次のとおり。

1. `corepack pnpm -r run build` の後、`node packages/mock-unity/dist/mock-unity.js --listen-port 7090 --reply-host 127.0.0.1 --reply-port 7091 --scenario packages/mock-unity/scenarios/runtime-switch.json` で起動し、ブリッジと UI をつなぐ。`/sys/manifest` と `/sys/stats` の JSON に `bootId`(32 桁)と `structureGeneration`(1)が載っていること。
2. UI の `Remove middle row` を押す。値のエコーの後に世代 2 のマニフェストが届き、Row B の行が消えて Row A・Row C の現在値が保たれること。`Add row`、`Change widget kind only`、`Update choices only` でも、それぞれ行の追加、Gain の種類の変更、選択肢だけの更新が反映され、選択中の値が保たれること。
3. `Reuse violation (rejected)` と `ProjectId mismatch (rejected)` を押す。何も変わらず、mock-unity の標準エラーに `MOCK_UNITY_SWITCH_REJECTED ... <理由>` が 1 行だけ出ること(`address-reused` / `project-mismatch`)。
4. `--fault drop-reinject-manifest` を付けて再起動し、手順 2 を行う。切り替えのマニフェストだけが落ち、UI は変わらない。照合(stats の組の不一致)により、数秒以内にブリッジが `/sys/manifest/request` を送り、新しい行を持つマニフェストが届くこと。
5. `--legacy-origin` を付けて再起動する。マニフェストと stats に組が載らず、従来どおり受信ごとに採用されること(`/sys/stats/request` はブリッジから送られない)。

## runtime-manifest-reinject: P3 再注入の E2E(タスク 4.1・4.2)

mock-unity(実行時切り替えのシナリオ)+ ブリッジ + WebSocket クライアントの E2E を `tests/e2e/reinject-switching.e2e.test.ts` と `tests/e2e/reinject-content.e2e.test.ts` に置いた(Python UI は使わない)。`corepack pnpm test` の中で自動実行され、手動確認は不要。確認する内容は次のとおり。

- 切り替え: トリガによる行の削除・追加が、同じ起動識別子のまま世代 +1 の新しい採用として届く。
- 喪失からの回復: `--fault drop-reinject-manifest` で切り替えのマニフェストが落ちても、stats の照合(4 秒間隔)と要求により 12 秒以内に新しい行のマニフェストが届く。
- 再起動: mock を起動し直すと、到達不能を経ずに新しい起動識別子のマニフェストが採用される(世代が小さくなっても採用)。
- 従来形式: `--legacy-origin` では組が載らず、受信ごとに採用され、照合による取り直しは起きない。
- 拒否・内容更新・引き継ぎ: 再利用違反と projectId 違いは新しい採用を起こさない。選択肢だけの更新は直接の再要求で再採用されない。ウィジェットの種類だけの変更は現在値を `default` に保つ。staged の値は行の削除後も引き継がれ、`ApplyRequested` で同じ値が確定される(シナリオ `runtime-switch-staging.json`)。
