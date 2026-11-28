# ブリッジ接続仕様

この文書は、`oscdesk-bridge` と UI クライアントの間で交換する WebSocket フレームの正典である。新しい UI クライアントは、この文書と `protocol/wire-samples.json` だけを参照して実装できる。

## 前提と接続

ブリッジは Unity との OSC/UDP 通信と、UI クライアントとの WebSocket 通信を中継する。UI クライアントはブリッジの WebSocket ポートへ接続し、1 WebSocket メッセージにつき 1 個の JSON オブジェクトを送受信する。フレームはすべて UTF-8 JSON であり、配列形式や未知のキーは使用しない。

この接続には認証機構がない。`0.0.0.0` で待ち受ける構成を含むため、信頼された LAN 内だけで使用し、インターネットや信頼できないネットワークへ公開してはならない。

ただしブラウザを踏み台にした接続は塞ぐ(D-082・D-138)。ブラウザは WebSocket のハンドシェイクに `Origin` を必ず付け、ページ側から外せない。ブリッジは `Origin` 付きのハンドシェイクのうち、ブリッジ自身が HTTP の `/` で配った SPA のページからのもの(`Origin` の host:port が要求の `Host` と同じ)だけを受け、ほかのページ(第三者のサイト・別のポート)からのものは HTTP 403 で拒否して `(WARN, BRIDGE)` に記録する。`Origin` を付けないクライアント(テストのクライアントなど、ブラウザでないもの)はそのまま受ける。

DNS の再束縛への備えとして、ブリッジは WebSocket のハンドシェイクと HTTP のすべての要求で `Host` を確かめ、IP アドレスの直書き(`192.168.1.10:7080`・`[::1]:7080`)かこの PC の名前(`localhost`・OS のホスト名・その短い名前と `.local`)でなければ 403 で断る(D-138)。接続先には IP アドレスかこれらの名前を使う(社内 DNS の別名・FQDN では接続できない)。HTTP の 403 の本文は、断った理由と対処の日本語・英語の案内(`text/plain`)である。

接続してよいブラウザの範囲(後述の `networkSettings` の `allowedBrowsers`、D-113)の外の送信元からは、WebSocket のハンドシェイクと HTTP を 403 で断る。範囲を狭めたときは、外になった既存の接続をコード 1008 で切る。この PC の localhost(`127.0.0.1` / `::1`)は常に通す。この許可リストは**認証の代わりではない**(送信元のアドレスで絞るだけで、同じ LAN の機器はアドレスを名乗り直せる)。信頼できる LAN 内だけで使う前提は変わらない。

### ブリッジの起動

リポジトリのルートで Node.js 20 以降と pnpm を用意し、次を実行する。

```powershell
corepack pnpm install
corepack pnpm --filter @oscdesk/bridge run build
node packages/bridge/dist/oscdesk-bridge.js --config config/oscdesk.config.json
```

保管の土台のフォルダは設定の `surfaces.dir`(既定 `surfaces`、実行時のカレントディレクトリ基準)で指定する。OSC パッド(後述の `osc.padDocument`)の保管先は `surfaces.padsDir`(省略時は `<surfaces.dir>/pads`)で、パッド名ごとに `<name>.json` を、採用中のパッドの名前を `.active.json` に置く(D-080)。パッドの保持値(後述の `osc.padValues`)と自動の再送の設定(`osc.padResend`)の保存先は `surfaces.valuesDir`(省略時は `<surfaces.dir>/.values`)である。サーフェス定義は撤去した(D-172)。起動時に採用する定義を指していた `surfaces.defaultName` は、設定ファイルに残っていれば読み捨てて `(WARN, BRIDGE) config "surfaces.defaultName" is ignored …` を出す(起動は止めない)。撤去の前に保存したサーフェス定義(`surfaces/*.json`)と保持値(`<name>.values.json`)は読まずに残す(消さない)。

宛先パネル(後述の `destinations`、`DESIGN.md` D-078 / D-086)の選択の保存先は `destinations.file`(省略時は `<保持値の保存先>/.destinations.json`。先頭のドットでパッドの名前と重ならない)、端末の名前(D-092)の保存先は `destinations.aliasesFile`(省略時は `<保持値の保存先>/.device-aliases.json`)で指定する。どれも省略できる(`"destinations"` ブロックごと省いてよい)。選択を保存していない間は `unity`(主系 + 副系)が送り先で、保存した選択はそれより優先する。LAN の走査は撤去した(D-172)。走査の時間上限だった `destinations.scanTimeoutMs` は、残っていれば読み捨てて警告する。

ネットワークの設定(後述の `networkSettings`、D-113)の保存先は `network.file`(省略時は `<保持値の保存先>/.network-settings.json`)で指定する(`"network"` ブロックごと省いてよい)。保存していない間は、ターゲット向けのネットワークが `bridge.oscListenHost`、ターゲットがいる範囲が自動、接続してよいブラウザがすべて(`0.0.0.0/0` と `::/0`)である。保存した設定は設定ファイルより優先する。設定ファイルへは書き戻さない。保存したターゲット向けのアドレスが起動時にこの PC に無ければ(NIC の差し替え・DHCP)、警告して `bridge.oscListenHost` で待ち受ける(ファイルは書き換えない)。

OSCQuery(後述の `osc.queryTargets`、D-168)は `"oscQuery"` ブロックで指定する(ブロックごと省いてよい)。`mdns`(既定 `true`)は mDNS で `_oscjson._tcp` を探すか(ターゲット向けのネットワークの IPv4 の NIC ごと。ネットワークの設定を変えると NIC を選び直す)、`targets`(既定 `[]`、32 件まで)は mDNS を使わずに読むターゲットの `{"host": "...", "port": <HTTP のポート>}`、`queryIntervalMs`(1,000〜600,000、既定 30,000)は mDNS の問い合わせの間隔(間隔の 3 倍の間答えなかったターゲットは消える)、`fetchTimeoutMs`(500〜60,000、既定 5,000)は HTTP の 1 回の取得の時間上限、`refreshDebounceMs`(0〜10,000、既定 250)は `PATH_*` を受けてから木を読み直すまでの間引き。Windows はネットワークが「パブリック」だとファイアウォールが mDNS(UDP 5353)を塞ぎ、何も見つからないことがある(そのときは `targets` で直接指定する)。

設定ファイルを省略せず、`--config` の値には `unity.host` と `unity.sendPort` を含む JSON 設定を指定する。ポートを一時的に上書きする場合は `--ws-port`、`--osc-listen-port`、`--unity-host`、`--unity-port`、`--debug` を使用できる。ブリッジは起動すると標準出力へ、次の形式の 1 行を出す。

```text
OSCDESK_BRIDGE_READY {"wsHost":"0.0.0.0","wsPort":7080,"oscListenPort":7091,"unity":{"host":"127.0.0.1","sendPort":7090},"protocolVersion":1,"debug":false,"configPath":"...","webUiPath":"/"}
```

`webUiPath` は SPA(後述の「SPA の配信(HTTP)」)を配る HTTP のパスで、設定の `webUi.enabled` が `false` なら `null`。

UI はブリッジが配る SPA だけで、プロセスはブリッジ 1 つである(D-162)。SPA はブリッジの WebSocket と同じポート(既定 7080)の HTTP の `/` で配る。設定の `ui` ブロックとブリッジの `--ui-port` は廃止した。設定ファイルに `ui` が残っていれば読み捨てて `(WARN, BRIDGE) config "ui" is ignored …` を出し、`--ui-port` も値を読み捨てて警告にする(どちらも起動は止めない)。READY 行に `uiHost`・`uiPort` は無い。

クライアントはこの行または設定済みの `wsPort` を使い、`ws://<ブリッジのホスト>:<wsPort>` へ接続する。`hello` の `bridge.wsPort` と `bridge.oscListenPort` が、実際に使用するポートである。

## 共通規則

### 外側の形式と版数

全フレームは次の共通フィールドを持つ。

```json
{"v":1,"type":"..."}
```

`v` は常に数値 `1` である。受信した `v` が `1` と一致しないフレームは処理せず破棄し、版数不一致をブリッジまたは UI のログへ記録する。接続そのものは切断しない。`hello.protocolVersion` も常に `1` である。

フレームは `type` で判別する。各オブジェクトは仕様に定めたキーだけを持つ（未知キーを許可しない）。JSON の構文エラー、未知の `type`、必須キー欠落、型違いもそのフレームだけを破棄してログに記録し、接続は維持する。

### 共通の語彙と OSC 専用のフレーム(HID-373・D-110)

UI とブリッジの間のフレームは、通信の方式(今は OSC)に依存しない**共通のフレーム**と、OSC 専用の機能のための **`osc.*` のフレーム**に分ける。

- 共通のフレームは、通信の方式に依らない語(部品の id・宛先・ロック・到達の結果・型タグを付けない JSON の値など)だけで書く。OSC のアドレスと型タグは `osc.*` のフレームと、アダプタ専用の欄(下記)にだけ置く
- OSC 専用の機能(Unity との OSC の生のやり取り `osc.message`・まとめ送り `osc.batch`・送信ログ `osc.sentLog`・OSC パッド `osc.pad*`・OSCQuery `osc.query*`)は `osc.` で始まる `type` にする。UI は `hello.adapters` に `osc` があるときだけ、これらの機能を出す
- 共通のフレームに OSC の語(`/` で始まるアドレス・型タグ付きの引数・`args`)を混ぜない。`tests/guards/osc-vocabulary.test.ts` が `protocol/wire-samples.json` の受理される見本で検査する。到達のイベント(`delivery`)・ロック(`locks`)・プロジェクトファイル(`project`)もこの語彙で書く(HID-389・D-117)。サーフェス定義の語彙で書いていた共通のフレーム(`surface`・`desired`・`echo`・`set` など)は撤去した(D-172)
- 共通のフレームの中でも、通信アダプタの名前(`hello.adapters` と同じ `osc`)のキーの下は、そのアダプタ専用の欄とする(プロジェクトファイルの `osc`。パッドとその保持値。D-173)。ガードはこの下を検査しない。UI はアダプタがあるときだけこれらを使い、本体の語彙には混ぜない

### OSC 引数の型タグ

`osc.message` の `args` は、引数が 1 個でも必ず配列で、順序を保つ。各要素は次のいずれかのオブジェクトである。

| `type` | `value` | 意味 |
|---|---|---|
| `i` | number（整数） | OSC int32。−2147483648 〜 2147483647 の整数のみ受理する |
| `f` | number | 浮動小数点数 |
| `s` | string | 文字列 |
| `b` | string | blob のバイト列を base64 化した文字列（正規形の base64 のみ受理） |
| `T` | (持たない) | OSC 1.0 の真(型タグだけで引数のバイトを持たない。HID-492) |
| `F` | (持たない) | OSC 1.0 の偽(同上) |

blob は JSON にバイナリを直接入れず、送信時にバイト列を標準 base64（例: `AAECAw==`）へ変換し、受信時に base64 からバイト列へ戻す。`type` と `value` の対応が不正な要素（`i` の値域逸脱・小数、`b` の base64 として不正な文字列を含む）はフレーム全体を拒否する。`T` / `F` は `{"type":"T"}` のように `value` を付けずに書き、`value` を付けた要素も拒否する（型タグと `value` のどちらが真偽か食い違うため）。`T` / `F` は版 2 のパッド（D-167）で `T` / `F` 型のアドレスへ送るためのもので、上り・中継・エコーとも型タグのまま運ぶ(撤去したサーフェス定義(D-172)の `bool` を `i` の 0 / 1 に直していた扱いは無い)。送信ログ（`osc.sentLog`）とエコーの `osc.message` も同じ形で `T` / `F` を載せる。

共通の OSC 部分は次の形である。`address` は `/` で始める。下りのフレームだけが `from` を持ち、上りには宛先フィールドを追加しない。送信先 Unity はブリッジの設定で決まる。

```json
{
  "v": 1,
  "type": "osc",
  "address": "/avatar/blend/smile",
  "args": [{"type":"f","value":0.5}]
}
```

## 下りフレーム（ブリッジ → UI）

ブリッジから UI へ送る種類は次のとおりである。画面を作る仕組みは OSC パッド(版 2)1 つで(D-163・D-170)、採用中のパッドは `osc.padDocument`、保存済みの一覧は `osc.padList`、値の正としてブリッジが持つ保持値は `osc.padValues`、ターゲットのエコーは `osc.padEcho`、自動の再送の設定は `osc.padResend` で配る。ターゲットとの連携は OSCQuery で、見つけたターゲットと部品の候補は `osc.queryTargets` で配る(D-168)。ブリッジが Unity へ送った OSC の記録は `osc.sentLog` で、送り先の選択は `destinations` で、書き出したプロジェクトファイルは `project` で配る。操作中のロックは `locks` で配る(D-111)。ネットワークの設定は `networkSettings` で配る(D-113)。送ったものが送り先の PC に届いたかは `delivery` で配る(D-116)。Unity からマニフェストを受け取る経路は撤去した(DESIGN.md D-051)。サーフェス定義(`surface`・`surfaceList`・`surfaceEdited`)・その保持値(`desired`・`desiredStatus`)・エコー(`echo`)・実行時の一覧(`runtimeOptions`)・設計図(`catalog`・`blueprintStatus`)・版 1 の OSC パッド(`osc.pad`・`osc.padEdited`)のフレームも撤去した(D-172。届いても未知の種別として捨てる)。

### `hello` — 接続情報

接続直後に、その UI クライアントだけへ 1 回送る。`clientId` は接続を識別する値である。`pingIntervalMs` は Unity への死活確認周期(2,000 ms)であり、WebSocket 心拍とは別である。`targets` は Unity の宛先一覧（冗長構成。DESIGN.md D-046）で、主系（`primary: true`）が先頭に 1 台、副系が config の順に続く。1 台構成でも要素は 1 つある。`unity` は主系と同じ値で、旧い UI のために残す。

```json
{
  "v":1,"type":"hello","clientId":"ui-1","protocolVersion":1,
  "server":{"name":"oscdesk-bridge","version":"0.1.0"},
  "unity":{"host":"127.0.0.1","sendPort":7090},
  "targets":[
    {"name":"unity","host":"127.0.0.1","sendPort":7090,"primary":true},
    {"name":"backup","host":"192.168.0.12","sendPort":7090,"primary":false}
  ],
  "bridge":{"oscListenPort":7091,"wsPort":7080},
  "heartbeat":{"intervalMs":15000,"timeoutMs":30000},
  "pingIntervalMs":2000,"debug":false,
  "adapters":["osc"]
}
```

`adapters` はブリッジが持つ通信アダプタの種類(HID-373)で、1 つ以上ある。今は `osc` だけである(複数のアダプタの同時稼働は作らない)。UI は `osc` があるときだけ OSC 専用の機能(OSC パッドのタブ・送信ログ)を出す。知らない種類は無視する。

`peer`(省略可)は、ブリッジから見たこの接続の送信元のアドレス(IPv4 射影の IPv6 は IPv4 にした形。例 `"peer":"192.168.1.30"`。D-153)である。ブラウザから直接つなぐ SPA は、ネットワークのタブの「このブラウザ」の表示と「このブラウザを足す」に使う。接続してよいかの判定はブリッジだけが行い、UI はこの値で判定しない。送信元が分からない接続では省く(空文字は送らない)。

### `osc.message` — Unity から受信した OSC

Unity から受信した通常の OSC(主にエコーバック)を UI へ配信する。OSC 専用の生の受信で、パッドの部品に当たるエコーは部品の語彙でも `osc.padEcho`(後述)で配る。`from` は受信元の UDP ピアで、`host` は文字列、`port` は 1〜65535 の整数である。配信するのは主系のエコー(と OSC ネイティブ UI の端末の操作)だけで、副系のエコーは UI へ流さない(パッドの保持値との食い違いの警告と到達のイベントにだけ使う)。`/sys/*` と `/oscdesk/*` は予約アドレスとして UI へ流さない。

```json
{"v":1,"type":"osc.message","address":"/avatar/blend/smile",
 "args":[{"type":"f","value":0.5}],
 "from":{"host":"127.0.0.1","port":7090}}
```

### `link` — Unity の到達性

接続時と ping の周期ごとに送る。`unity.reachability` は `unknown` / `reachable` / `lost`、`lastRttMs` と `lastPongSeq` は未確定なら `null`、`consecutiveLosses` は連続喪失数である。`unity` は主系の状態で、`targets` は宛先ごとの同じ項目（`name` と `primary` つき）である。エコーの出所は主系だけで、副系は到達性だけをここで知らせる。

```json
{"v":1,"type":"link",
 "unity":{"reachability":"reachable","lastRttMs":4,"consecutiveLosses":0,"lastPongSeq":12},
 "targets":[
   {"name":"unity","primary":true,"reachability":"reachable","lastRttMs":4,"consecutiveLosses":0,"lastPongSeq":12},
   {"name":"backup","primary":false,"reachability":"lost","lastRttMs":null,"consecutiveLosses":3,"lastPongSeq":9}
 ]}
```

### `osc.sentLog` — Unity へ送った OSC の記録

ブリッジが Unity へ実際に送った OSC の直近の記録を配る(`DESIGN.md` D-067)。UI はこれを表示するだけで、保持値にも確認にも使わない。完全な証跡は debug 起動時の NDJSON 診断ログ(`logs/diagnostics/*.ndjson`、D-031)であり、この記録はブリッジのメモリにだけある揮発する窓である(ブリッジ再起動で消え、`seq` は 1 に戻る)。

```json
{"v":1,"type":"osc.sentLog","full":false,"records":[
  {"seq":41,"at":"2026-10-14T10:00:00.250Z","origin":"ui","targets":["unity","backup"],
   "address":"/mix/master","args":[{"type":"f","value":0.75}],"count":12,"batch":null,"clipped":false},
  {"seq":42,"at":"2026-10-14T10:00:01.000Z","origin":"action","targets":["unity"],
   "address":"/slot/01","args":[{"type":"f","value":0.25}],"count":1,"batch":{"id":3,"index":0,"size":2},"clipped":false}]}
```

- **記録の単位**: 1 メッセージにつき 1 件。全宛先へ同じものを送った場合は 1 件にまとめ、`targets` に送った宛先の名前(`hello.targets[].name`)を並べる。1 台へ送る同期は、その宛先の 1 件になる
- **`origin`**(送った契機): `ui`(上り `osc.message` と、パッドの値の部品・表のマスの変更 `osc.padSet` / `osc.padSetCell`)、`action`(上り `osc.batch`)、`resend`(パッドの同期。手動の `osc.padSync` と自動の再送。`/sys/sync/begin`・`/sys/sync/end` を含む。D-169)、`relay`(OSC ネイティブ UI の中継)、`pad`(上り `osc.padPress` の押下と `osc.padAction` の表のアクション。D-080)。撤去したサーフェス定義の行の生成 `row` と一覧の要求 `request` は無くなった(D-172。この 2 つの `origin` を持つフレームは拒否される)。`/sys/ping` と、要求元へ直接返す `/oscdesk/*` の応答は記録しない
- **`seq`**: ブリッジの起動ごとに 1 から振る正整数。**`at`**: 最後に送った時刻(ISO 8601、オフセット付き)
- **`count`**(間引き): `ui` と `relay` で(`pad` はまとめない。押した 1 回ずつを時刻つきで残す)、直前の記録と同じ契機・宛先・アドレス(先頭の `s` の引数で行を区別するメッセージは、その引数も同じ)への送信が、その記録の最初の送信から 1,000 ms 以内に続いたときは、新しい記録を作らずに直前の記録の `count` を増やし、`at` と `args` を最後の送信のものにする。更新した記録は**同じ `seq` のまま**届き直す
- **`batch`**: まとめ送り(`osc.batch`)の各メッセージは `{ id, index, size }`(`id` はバッチごとに 1 から振る番号、`index` はバッチ内の 0 始まりの位置、`size` はバッチのメッセージ数)。それ以外は `null`(省略しない)。`targets` は bundle を送れた宛先(主系 + 送れた副系)
- **`clipped`**: 表示用に引数を切り詰めたとき `true`。`s` は 120 文字、`b` は先頭 32 バイト、引数は先頭 16 個まで。有限でない `f`(NaN など)は JSON で表せないため `s` の文字列にして `clipped: true` にする
- **配る契機**:
  - 接続直後、`hello`・`link` の後に、その UI だけへ保持している全量を送る。先頭のフレームが `full: true` で、UI は手元の記録を捨ててこれで置き換える。続きのフレームは `full: false`。記録が無くても `full: true` の空のフレームを 1 つ送る(ブリッジ再起動後の再接続で古い記録を捨てさせるため)
  - 送信のたびには送らず、新しい記録と更新した記録を **250 ms ごとに**まとめて全 UI へ `full: false` で送る。UI は `seq` をキーに追加・置き換えする
- **上限**: ブリッジは直近 **1,000 件**を保持し、古いものから捨てる(捨てた記録は配らない)。1 フレームは **100 件**まで(超える分は複数のフレームに分ける)。1 フレームを 1 MiB に十分収めるため(撤去した NiceGUI 版の UI のクライアントの受信上限に合わせて決めた値で、受信上限の小さい UI クライアントでも受けられるように残す。D-162)

### `destinations` — 送り先の選択

UI の宛先パネル(`DESIGN.md` D-078 / D-079 / D-085 / D-086)のための全量。パッドに依存しないので、接続直後(`hello`・`link`・`osc.sentLog` の後)にその UI へ送り、以後は選択の変更、ブロードキャストへ新しいホストが pong を返したとき(`primaryHosts` が変わる)、OSCQuery のターゲットが見つかった・消えた・`OSC_PORT` が変わったとき、この PC のネットワークを読み直したとき(上り `osc.queryRefresh` の「探し直す」と、ネットワークの設定の変更)に全 UI へ送る。UI は丸ごと置き換える。LAN の走査は撤去した(D-172)。`scanning`・`scannedAt` は無くなり、持つフレームは拒否される。

```json
{"v":1,"type":"destinations","sendPort":7090,
 "devices":[
   {"host":"192.168.1.10","hostname":"control-pc","alias":null,"mac":"aa:bb:cc:dd:ee:0a","interface":"Ethernet","self":true,"configured":false,"found":true},
   {"host":"192.168.1.20","hostname":"Unity","alias":"Unity 本番機","mac":null,"interface":"Ethernet","self":false,"configured":true,"found":true,
    "services":[{"name":"Unity","oscPort":7090}]}],
 "broadcasts":[{"address":"192.168.1.255","interface":"Ethernet","network":"192.168.1.0/24"}],
 "selection":{"source":"saved","allDevices":false,"networks":[],"hosts":["192.168.1.20"]},
 "targets":[{"name":"unity","host":"192.168.1.20","sendPort":7090,"primary":true,"broadcast":false}],
 "primaryHosts":["192.168.1.20"]}
```

- **`sendPort`**: 端末(`hosts`)とブロードキャストへ送るポート(`unity.sendPort`)
- **`devices`**: 一覧に並べる端末。この PC(`self`)、OSCQuery で見つけたターゲットの端末、設定の宛先(`configured`)、選択中のホストと組(`hosts`・`endpoints`)を、IPv4 の順(ホスト名はその後ろ)に並べる。`found` はこの PC か OSCQuery で見つかった端末で `true`(設定の宛先・選択中のもので見つかっていないものは `false` で残る)。`hostname` は端末の名前(1〜253 文字。分からなければ `null`。D-085)で、この PC は OS のホスト名、OSCQuery のターゲットは `HOST_INFO` の `NAME`。DNS の逆引き・NetBIOS などの名前解決は走査と一緒に撤去した。`mac` はこの PC なら OS が教えた NIC の MAC、ほかの端末は別名の表に残る最後に分かった MAC(D-092)で、分からなければ `null`(ほかの端末の MAC は走査の ARP 表でしか分からなかったので、新しい端末では `null` になる)。`alias` は UI から付けた端末の名前(1〜64 文字。無ければ `null`。省略しない。`destinationsAlias`、D-092)で、UI は `hostname` より優先して見せる。`interface` はその端末がいるネットワークのインタフェース名(分からなければ `null`)
- **`broadcasts`**: 「全てのデバイス」で送るブロードキャストアドレス(IPv4 の外部インタフェースごと。実際のネットワークのもの)。空なら「全てのデバイス」は選べない。`network`(CIDR 表記)は、ネットワークごとの「全てのデバイス」(`selection.networks`)で選ぶときの名前にもなる
- **`selection`**: `source` は `config`(選択していない。`networks` は空、`hosts` は設定の宛先のホスト)/ `saved`(保存した選択)/ `unsaved`(選択は効いているが `destinations.file` へ書けなかった。ブリッジを再起動すると失われる)。`networks` はネットワークごとの「全てのデバイス」で選んだネットワーク(`broadcasts` の `network`)。`allDevices` が `true` の間も `networks` と `hosts` は外したときに戻す選択として持つ。`endpoints`(省略可)は選んだ OSCQuery のターゲットの組(下記)
- **`targets`**: 実際に送っている宛先。`hello.targets` と同じ形に `broadcast`(ブロードキャストアドレスの宛先か)を足したもの。主系が先頭で 1 件以上ある。宛先が変わると `link` も全 UI へ送り直す(`hello` は送り直さない。UI は主系をここから取る)
- **OSCQuery で見つけたターゲット(D-168)**: `osc.queryTargets` のターゲットのうち、ターゲットがいる範囲の中のホストと設定の宛先のホスト(既定の `127.0.0.1` など)は `found: true` で並ぶ。その端末の `services` に、見つかったターゲットごとの `{name, oscPort}`(`name` は `HOST_INFO` の `NAME` かインスタンス名、`oscPort` は `OSC_PORT`)を `oscPort` の順に並べる(無ければ省く)。同じ PC の複数のアプリは `oscPort` で分かれ、`selection.endpoints`(ホストと `oscPort` の組。`destinationsSelect` の `endpoints`)で 1 つずつ選ぶ。端末(`hosts`)を選ぶのは従来どおり `sendPort` への送信で、ターゲットの選択とは別。選んだ組はいま見つかっていなくても `services` に `name: null` で残る(外せるように)。見つかった・消えた・`OSC_PORT` が変わっても選んだ組は変えない
- **`primaryHosts`**: ブリッジが主系の Unity とみなす送信元ホスト(主系の `host`、名前解決したアドレス、主系がこの PC(この PC の LAN アドレス、またはそこへ解決されるホスト名)ならループバック `127.0.0.1`、主系がブロードキャストならそこへ pong を返したホスト)。UI はエコーの出所をこれで判定する(主系がブロードキャストやこの PC のときは、`host` とエコーの送信元が一致しないため)

ブロードキャストの宛先は、認証の無いこの接続を使う誰でも選べる。信頼できる LAN の中だけで使い、インターネットや信頼できないネットワークへ公開してはならない。

### `osc.queryTargets` — OSCQuery のターゲットと部品の候補(D-168)

mDNS で見つけたか設定(`oscQuery.targets`)で直接指定した OSCQuery のターゲットごとに、送り先・起動 ID・名前空間から作った部品の候補(パレット)を載せる全量。接続時にその UI へ送り、以後はターゲットが増減したとき・読み込みが終わったとき・失敗したとき・WebSocket が切れたときに全 UI へ送る。UI は丸ごと置き換える。名前空間はブリッジも保管しない(読み直せばよいため)。Unity との契約は `docs/UNITY_PROTOCOL.md` §7。

```json
{"v":1,"type":"osc.queryTargets","mdns":"running",
 "targets":[
   {"id":"Unity-9100","source":"mdns","name":"Unity","host":"192.168.1.20","httpPort":9100,"oscPort":7090,
    "bootId":"4f7c2d4e-2b1a-4a3c-9a55-0d1e2f3a4b5c","pathEvents":true,"status":"ready","error":null,
    "fetchedAt":"2026-11-27T12:00:00.000Z",
    "palette":[
      {"address":"/scene/level","type":"f","access":3,"description":"音量","extendedType":null,
       "range":[{"min":0,"max":1,"vals":null}],"kind":"slider","hold":true}],
    "unsupported":[{"address":"/scene/stamp","type":"t","reason":"unsupported-type"}],
    "dropped":0}]}
```

- **`mdns`**: 発見の状態。`off`(`oscQuery.mdns` が `false`)/ `running`(1 つ以上の NIC で動いている)/ `failed`(どの NIC でも起動できなかった。ファイアウォールで UDP 5353 が塞がれているなど)
- **`id`**: ターゲットの印。mDNS はサービスのインスタンス名、設定は `host:port`。mDNS が設定と同じホストとポートを見つけたときは設定の方だけを持つ。上限 64 件
- **`host`** / **`httpPort`**: HTTP を取ったアドレスとポート。ターゲットがいる範囲を変えると、外れた mDNS のターゲットを外し、前に範囲の外として断ったサービスを拾い直す(`osc.queryRefresh` でも拾い直す)。mDNS で見つけたものの `host` は応答の送信元のアドレス(A レコードは使わない。誰でも好きなアドレスを名乗れるため)で、ターゲットがいる範囲(D-113)の中か、この PC(ループバック・この PC のアドレス)のものだけを読む。名前空間を同時に読むのは全体で 2 つまで(残りは順番を待つ)。mDNS の告知による読み直しは `PATH_*` と同じく間引く
- **`oscPort`**: `HOST_INFO` の `OSC_PORT`。送り先は `host:oscPort`(`OSC_IP` は使わない)。`HOST_INFO` に答えない(204・400)ターゲットは `null`
- **`bootId`**: `HOST_INFO` の `X_OSCDESK_BOOT_ID`(起動 ID。D-164)。無ければ `null`。変わったら起動したとみなし、`/sys/pong` の起動 ID と同じ記録(`host:oscPort`)で比べて、自動の再送が入っていれば今の宛先のその 1 台へパッドの保持値を送り直す(D-169。後述の `osc.padResend`)
- **`pathEvents`**: WebSocket で `PATH_*` を受けているか(`HOST_INFO` の `EXTENSIONS` に `PATH_CHANGED` などがあるときだけつなぐ)。受けたら種類を問わず `oscQuery.refreshDebounceMs`(既定 250 ms)間引いて木を読み直す。切れたら間を置いて読み直す(5 秒から倍々に 60 秒まで)
- **`status`** / **`error`**: `loading`(初めての読み込み中)/ `ready` / `error`(一度も読めていない)。読めなかった理由は `error`(読めたことのあるターゲットの一時的な失敗は `status` を `ready` のまま、前の候補を残して `error` に理由を出す)。読めなければ間を置いて読み直す
- **`palette`**: 書けるノード(`ACCESS` が 2 か 3)だけ。`range` は引数ごと(`RANGE` が無い・読めない引数は `null`)。`kind` は推定した部品の種類(`button`・`toggle`・`select`・`slider`・`number`・`text`・`color`・`composite`。規則は `packages/shared/src/pad-from-node.ts` の `padWidgetFromNode` で、編集の `addWidgetFromNode` が置く部品の種類と同じ。D-171。作れないノードは `unsupported`)。`hold` は保持して送り直す既定(`ACCESS` 3 なら `true`、2 なら `false`。D-165)。上限 4,096 件
- **`unsupported`**: 書けるが部品にできないノード(`unsupported-type`: `h`・`d`・`t`・`b`・`[]` などを含む型や、引数が 17 個以上・`r` を含む組み合わせ / `invalid-address`: ASCII でない・OSC のパターンの文字を含む・`/sys` と `/oscdesk` の下・256 文字を超えるパス)。上限 512 件。候補(`palette` と `unsupported`)は件数に加えて JSON の大きさでも縛り、1 ターゲット 1 MiB・全ターゲットの合計 8 MiB に収める(先頭から載せる)。`dropped` は上限・予算で載せなかった件数。同じエンドポイント(ホストと HTTP のポート)を別のインスタンス名で告知されても 1 つのターゲットとして持ち(名乗ったインスタンス名はすべて覚え、最後の 1 つが消えたときだけターゲットを消す)、mDNS で 1 台の PC から持つターゲットは 8 個まで
- **上限**: HTTP の応答 8 MiB・木の深さ 32・ノード 20,000・1 回の取得 `oscQuery.fetchTimeoutMs`(既定 5 秒)。超えた名前空間は読まず `error` に理由を出す

### `osc.padList` — 保存済みパッドの一覧

保存済みの名前の一覧(昇順)と、採用中の名前(未採用なら `null`)を送る。

```json
{"v":1,"type":"osc.padList","names":["take-02","take-03"],"active":"take-03"}
```

### `osc.padDocument` — 採用中のパッドの版 2(D-167・D-169)

OSC パッド(`DESIGN.md` D-080・D-167)は、ボタン・値の部品(トグル・スライダー・選択・数値と文字の入力・色・組み合わせ)・表を格子に置いた画面で、名前付きで保存・切り替える。画面を作る仕組みはこれ 1 つである(D-163・D-170)。正はブリッジが持ち、版 2(`packages/shared/src/pad-document.ts`)で保管する。`name` は保管名、`revision` は採用のたびに 1 ずつ増える正整数(ブリッジの再起動で 1 に戻る)、`version` は採用ごとに一意な版の印(1〜64 文字の文字列。起動ごとのランダムなエポックと `revision` の組で、ブリッジの再起動をまたいでも重ならない。中身の形は UI が解釈しない)、`at` は採用時刻、`pad` は検証済みのパッドである。パッドの検証に通らないフレームは UI も捨てる。版 1 のパッド(ボタンだけの格子)を載せた `osc.padDocument` は拒否される。値の部品の操作(`osc.padSet` など)と押下(`osc.padPress`)は、名前と `version` で照合する。

```json
{"v":1,"type":"osc.padDocument","name":"take-03","revision":2,"version":"a1b2c3d4e5f6-2","at":"2026-11-27T10:00:00.000Z","pad":{
  "format":"oscdesk-pad","version":2,"rows":2,"columns":3,"widgets":[
    {"id":"fire","kind":"button","row":0,"column":0,"label":"Fire","address":"/fx/fire","args":[{"type":"i","value":1}]},
    {"id":"level","kind":"slider","row":0,"column":1,"columnSpan":2,"label":"Level","address":"/mixer/level","type":"f","min":0,"max":1,"resend":true},
    {"id":"title","kind":"text","row":1,"column":0,"label":"Title","address":"/scene/title","type":"s","resend":false}]}}
```

- **パッドの形**: `format`(`"oscdesk-pad"`)・`version`(`2`)・`rows` / `columns`(1〜12)・`widgets`(144 個まで。部品ごとの欄は `pad-document.ts`)。アドレスは 256 文字まで・NUL 不可で、`/sys/*`・`/oscdesk/*`・パターン文字・空白・空パート・末尾 `/` は不可。判定の正典は `packages/shared/src/pad-document.ts`(zod)で、判定はブリッジだけが行う(UI は写しを持たない。D-122・D-126)
- **大きさ**: パッドの JSON(区切りの空白なし、UTF-8)は 8 MiB まで。`osc.padDocument` は全 UI へ配り、UI の受信上限は 16 MiB なので、超えるパッドは保存も採用もしない(`pad-rejected`)。起動時に復元しようとした採用中のパッドが超えていれば、採用せずに警告ログを出す(UI が受け切れないフレームで切断・再接続を繰り返さないように)。この上限はフレームの形式の検査には含めず、保存の正を持つブリッジだけが判定する
- **名前の規則**: `name`(`osc.padLoad` / `osc.padSave` / `osc.padList` も同じ)は、英数字で始まり英数字・`_`・`-` だけからなる 1〜64 文字で、Windows の予約デバイス名(`CON` `PRN` `AUX` `NUL` `COM1`〜`COM9` `LPT1`〜`LPT9`、大文字小文字を問わない)ではない。ブリッジはこれをそのままファイル名(`<name>.json`)に使うため、パス区切り・ドット・先頭の `.`(`.backups` を含む)は表現できず、保管フォルダの外へは書けない。違反するフレームは `invalid-frame` の `notice` で破棄される
- 保管済みの版 1 のファイルは読み込むときに版 2 で書き直す(直前の内容は `.backups/` に残る)

採用は次の契機で起き、そのたびに**全 UI へ** `osc.padDocument` → `osc.padList` → `osc.padValues`(全量)の順に送る(版 1 の写しの `osc.pad` は撤去した。D-172)。

- 起動時に、前回採用していたパッド(`.active.json`)を読み込めたとき(UI の接続前なので、UI は `osc.padDocumentRequest` で取得する)
- 上り `osc.padSave` で保存したとき、上り `osc.padLoad` で読み込んだとき(どちらも `.active.json` を書き換え、ブリッジ再起動後も同じパッドを採用する)、上り `projectImport` でプロジェクトのパッドを取り込んだとき

不正なパッドは採用しない。直前のパッドを維持し、要求した UI だけへ `notice`(`level: error`、`code: pad-rejected`、`detail` に理由)を返す。保存は直前の内容を `<padsDir>/.backups/` へ退避してから置き換える(名前ごとに直近 20 件)。

### `osc.padDocumentEdited` — 版 2 の編集命令の答え(D-167)

上り `osc.padDocumentEdit`(後述)の応答として要求元だけへ送る。`requestId` は要求の `requestId` をそのまま返す。

- **通ったとき**(`ok: true`): `pad` だけを持つ。編集後の作業コピー(版 2)で、保存と同じ検査(形・意味・JSON の 8 MiB)に通したもの。UI はこれを新しい作業コピーにする(保存されてはいない)
- **断ったとき**(`ok: false`): `detail` だけを持つ。編集の規則に合わない理由(画面にそのまま出す日本語)か、検証に通らない理由

### `osc.padValues` — パッドの保持値(D-169)

```json
{"v":1,"type":"osc.padValues","name":"take-03","version":"a1b2c3d4e5f6-2","full":true,
 "widgets":[{"widget":"level","value":0.5},{"widget":"level-number","value":0.5},{"widget":"pose","value":[1,0.25,"A"]}],
 "rows":[{"widget":"members","key":"m01","column":"active","value":true}]}
```

- 値を持つ部品(トグル・スライダー・選択・数値と文字の入力・色・組み合わせ)は `widgets` に部品ごと、表は `rows` に部品・行のキー・欄の id ごと。値は型タグの無い JSON の値(トグルは真偽値、組み合わせの型と `ffff` の色は引数の並び)
- **同じアドレスの値の部品**: 値は文書の `widgets` の並びで最初に置いた、表示だけでない値の部品(持ち主)が持つ。同じアドレスの部品すべてに持ち主の値を載せる(上の例の `level` と `level-number`)。UI は部品ごとに描くだけでよい
- `full: true` は全量(採用のたびと `osc.padDocumentRequest` の答え)、`false` は変わった分(`osc.padSet` などで送れた値)。`version` は値が属する採用の印で、UI は描いているパッドの `version` と違う値を当てない
- **保存と復元**: パッドの名前ごとに `surfaces.valuesDir` の `<名前>.pad-values.json`(`{"format":"oscdesk-pad-values","version":1,"pad","savedAt","widgets":[{widget,address,value}],"rows":[{widget,key,column,address,value}]}`)へ 500 ms 間引いて書く。採用のたびに、同じパッドの上書き保存なら今の値を、別のパッド・起動時はそのファイルを、今のパッドで成り立つものだけ戻す(値の部品はアドレスの持ち主の型と値域で読めること、表のマスは同じ表と欄があってアドレスが同じで、キーが正しく(UI で管理する行は一覧にあり)欄で読めること)。落としたものがあれば保存し直す。表のマスは 20,000 件まで

### `osc.padEcho` — ターゲットのエコーを部品の語彙で(D-169)

主系のターゲットのエコーのうち、採用中のパッドの部品(同じアドレスの部品すべて)・表のマスに当たるものを配る。`value` は部品の型として読めたときだけ付く。保持値は書き換えない(D-045)。保持値と食い違うエコーは、ブリッジが単位とターゲット(副系を含む)ごとに一致に戻るまで 1 回だけ警告ログに出す(操作から 1 秒は数えない)。

```json
{"v":1,"type":"osc.padEcho","version":"a1b2c3d4e5f6-2","widgets":[{"widget":"level","value":0.5}],"rows":[]}
```

### `osc.padResend` — 自動の再送の設定(D-165・D-169)

`auto` が `true` のときだけ、ターゲットの起動でパッドの保持値をその 1 台へ送り直す(既定は `false`)。`osc.padDocumentRequest` の答えと、`osc.padResendSet` を受けるたびに全 UI へ送る。設定と、見たターゲットの起動 ID は `surfaces.valuesDir` の `.pad-resend.json` に残る。

```json
{"v":1,"type":"osc.padResend","auto":false}
```

- **起動の判定**: 受理した `/sys/pong` の第 2 引数(`s`。`docs/UNITY_PROTOCOL.md`)と OSCQuery の `HOST_INFO` の `X_OSCDESK_BOOT_ID`(今 ping に答えている送り先へ引けたときだけ。引けなければ次の pong に任せる)を、送り先の PC(`host:送信ポート`。ブロードキャストの宛先は答えた PC ごと)ごとに前に見た起動 ID と比べる。変わった、または初めて見たら起動とする。同じ起動 ID のまま答えが戻った(ping の抜けからの回復)ときは送り直さない。起動 ID の無い pong の宛先は起動を知れない(記録に 1 回だけ残す)。見た起動 ID は `auto` が `false` の間も覚え、ブリッジの再起動をまたいで残す(256 台まで)
- **行の一覧**: `keysAddress` へ送る行のキーの並びは 1 メッセージなので、OSC にして 60 KiB を超える表はパッドの検証で断る(保存できない)
- **送るもの**: 「送り直す」(`resend`)の部品・表の欄の保持値だけを、`/sys/sync/begin ,s boot` → UI で管理する行の一覧(`keysAddress`)→ 値の部品 → 表のマス → `/sys/sync/end` の順に 1 つずつのメッセージで送る(送信ログは `origin: "resend"`)。値は 32 件ずつ 10 ms おきに送り、段ごとに今の保持値から取り直す。同じ送り先への新しい同期を始めたら古い同期の残りは送らない。途中でパッドの採用が変わったら、古い同期は end を送らずに打ち切る。表のマスのアドレスが値の部品やほかの表と重なるパッドは保存できない(`pad-rejected`)
- **送らない契機**: 初回の到達・ping の抜けからの回復・パッドの採用では送らない。サーフェス定義の保持値をこれらの契機で送り直していた再送は、定義と一緒に撤去した(D-172)。保持値を送るのは、手動の同期(`osc.padSync`)と、`auto` が `true` のときのターゲットの起動だけである

### `project` — 書き出したプロジェクトファイル

上り `projectExport`(後述)の応答として、要求元だけへ送る(`DESIGN.md` D-090・D-173)。`requestId` は要求の `requestId` をそのまま返す(どの書き出しの要求への応答かを UI が引き当てる)。`project` はプロジェクトファイルの中身で、UI はこれをそのままファイルとしてダウンロードさせる。

```json
{"v":1,"type":"project","requestId":"page-1-3","project":{
  "format":"oscdesk-project","version":3,"exportedAt":"2026-11-28T10:00:00.000Z",
  "osc":{"pad":{"name":"take-03","pad":{"format":"oscdesk-pad","version":2,"rows":1,"columns":2,"widgets":[
           {"id":"fire","kind":"button","row":0,"column":0,"label":"Fire","address":"/fx/fire","args":[{"type":"i","value":1}]},
           {"id":"level","kind":"slider","row":0,"column":1,"label":"Level","address":"/mixer/level","type":"f","min":0,"max":1,"resend":true}]}},
         "values":{"widgets":[{"widget":"level","value":0.5}],"rows":[]}},
  "destinations":[{"host":"192.168.1.20","port":7090,"name":"unity"}]}}
```

- **プロジェクトファイル**(版 3。D-173): `format`(`"oscdesk-project"`)・`version`(`3`)・`exportedAt`(書き出した時刻、ISO 8601)・`osc`・`destinations`。未知のキーは不可。判定の正典は `packages/shared/src/project-file.ts`(zod)の `readProjectFile`
- **`osc.pad`**: 採用中のパッドの保管名 `name` とパッド `pad`(版 2。保存と同じ検証で、8 MiB まで)。パッドとその保持値は OSC のアドレスを持つ OSC 専用のものなので `osc` の欄に置く(共通のフレームに OSC の語を混ぜない。D-110)。パッドの無いプロジェクトは書き出さず、読まない
- **`osc.values`**: パッドの保持値。`widgets`(`[{ widget, value }]`。値を持つ部品の id ごと、144 件まで)と `rows`(`[{ widget, key, column, value }]`。表の部品・行のキー・欄の id ごと、20,000 件まで)で、値は `osc.padValues` と同じ型タグの無い JSON の値。アドレスはパッドから引く(ファイルには書かない)
- **`destinations`**: 書き出したときに送っていたユニキャストの宛先(`{ host, port, name? }`、256 件まで。ブロードキャストの宛先は載せない)。取り込みでは宛先を変えない(記録として残すだけ)
- JSON(区切りの空白なし、UTF-8)は 12 MiB まで
- **版 1・版 2 のファイル**(サーフェス定義と版 1 の OSC パッドを持っていた形。`version: 1` は最上位に `surface` と `pad`、`version: 2` は `surface` と省略可の `osc.pad`)も読み、版 3 へ移す。パッドは版 2 へ移して保存と同じ検証に通し、保持値と送り先は空にする(版 1 のパッドはボタンだけで値を持たない)。サーフェス定義(とその保持値・生成の記録)は中身を検証せずに数えるだけにして落とし、落としたものを `projectInspection` の `droppedSurface` と取り込みの通知で知らせる(D-172・D-173)。パッドを持たない版 1・版 2 のファイル(サーフェス定義だけのもの)は、取り込めるものが無いので断る(`surface-only: ...`)。書き出しは常に版 3

### `projectInspection` — 読み込む前の検査の答え(D-122)

上り `projectInspect`(後述)の応答として、要求元だけへ送る。`requestId` は要求の `requestId` をそのまま返す。取り込み(`projectImport`)と同じ判定を行い、何も書き換えない。判定の正はブリッジだけが持ち、UI は写しを持たない(確認のダイアログに出す要約もここから取る)。

```json
{"v":1,"type":"projectInspection","requestId":"inspect-1-ab12","result":{"ok":true,"summary":{
  "exportedAt":"2026-10-28T10:00:00.000Z","sourceVersion":2,
  "pad":{"name":"take-03","widgets":1},"values":{"widgets":0,"rows":0},"destinations":0,
  "droppedSurface":{"name":"stage","values":1,"rows":1}}}}
{"v":1,"type":"projectInspection","requestId":"inspect-2-cd34","result":{"ok":false,"detail":"surface-file: this is a surface definition file, which this version no longer reads"}}
```

- **通ったとき**(`ok: true`): `summary` だけを持つ。件数は取り込む形(版 3 へ移した後)で数える
  - `exportedAt`: ファイルの書き出した時刻(文字列のまま)。`sourceVersion`: ファイルの版(`1` / `2` / `3`)
  - `pad`: パッドの保管名と部品の数(`widgets`)。`values`: 保持値の数(値の部品 `widgets` と表のマス `rows`)。`destinations`: ファイルにある送り先の数(取り込みでは宛先を変えない)
  - `droppedSurface`: 版 1・版 2 のファイルから落とすサーフェス定義の名前(読めなければ `null`)と、書いてあった保持値の数(`values` と行の `rows`)。落とすものが無ければ(版 3 のファイル・`surface` が `null` のファイル)`null`。UI は確認のダイアログでこれを先に見せる(黙って落とさないため。D-173)
- **断ったとき**(`ok: false`): `detail` だけを持つ。理由は取り込みを断るときの `project-import-rejected` と同じ(`too-large: ...` / `invalid: ...` / `surface-only: ...` / `unsupported-version: ...`)。サーフェス定義のファイル(`format: "oscdesk-surface"`)は、形の違いを列挙する前に `surface-file: ...` で断る(取り違えたと分かるように。取り込みでも同じ理由で断る)

### `locks` — 操作中のロックの全量(HID-378・D-111)

接続時と、ロックが付いた・外れた・持ち主の表示名が変わったときに全 UI へ送る(延長だけでは送らない)。UI は丸ごと置き換える。`clientId` と `holder` が自分(`hello.clientId` とページの `holder`)でないロックの部品を、UI は無効にして「操作中: <label>」を出す。`ref` の形は上り `lock` と同じ(`{widget}` か `{widget, key}`)。

```json
{"v":1,"type":"locks","locks":[{"ref":{"widget":"master"},"clientId":"ui-1","holder":"page-7f3a","label":"192.168.1.10"},
 {"ref":{"widget":"member","key":"6f1c2a90-0000-4000-8000-000000000001"},"clientId":"ui-1","holder":"page-91bc","label":"192.168.1.22"}]}
```

### `networkSettings` — ネットワークの設定

`DESIGN.md` D-113。サーバーが使うネットワーク(ターゲット向け)・ターゲットがいる範囲・接続してよいブラウザの範囲を配る。接続時(`destinations` の後)に要求元へ、`networkSettingsSet` で変わったときに全 UI へ、変更を断ったときに要求元へ、毎回全量を送る(UI は丸ごと置き換える)。

- **`targetInterface`**: Unity との OSC の送受信に使うこの PC の IPv4 アドレス。`null` はすべてのネットワーク(`0.0.0.0`)。ブラウザ向けの待ち受け(ブリッジの WebSocket と SPA を配る HTTP)は常にすべてのネットワークで、この設定に左右されない。そのため、これを変えても操作しているブラウザの接続は切れない。特定のアドレスで待ち受けると、そのアドレス以外へ届いた応答(同じ PC の Unity が `127.0.0.1` へ返す pong・エコーなど)は受けない
- **`targetRanges`**: ターゲットがいる範囲(IPv4 の CIDR、最大 8 件)。空なら自動(この PC のネットワークそのまま)。宛先パネル(`destinations`)の端末の一覧と個別に選べるホスト、OSCQuery で読むターゲット(mDNS で見つけたもの)を、範囲が重なるこの PC のネットワークの中の範囲に絞る。ネットワーク(`broadcasts`)とブロードキャストアドレスは NIC のもののまま(ブロードキャストは L2 全体に届き、範囲では狭められない)。どのネットワークにも重ならない範囲は使わない。設定ファイルの宛先(`unity`)と設定で直接指定した OSCQuery のターゲット(`oscQuery.targets`)は範囲の外でも選べる
- **`allowedBrowsers`**: 接続してよいブラウザの範囲(CIDR か 1 台のアドレス。IPv6 も可、最大 32 件)。空ならこの PC の localhost だけ。localhost(`127.0.0.1` / `::1`)は常に許可する。範囲は接続元と同じアドレスファミリーのものだけで判定する(IPv4 の接続元は `::/0` に当たらない)。ブリッジの WebSocket と HTTP(SPA の配信)の両方で使う。判定はブリッジだけが行う
- **`interfaces`**: `targetInterface` に選べるアドレス(`localhost` を先頭に、この PC の IPv4。`name` は OS の NIC 名)
- **`source`**: `default`(保存していない)/ `saved`(保存した)/ `unsaved`(効いているが、ファイルへ書けなかった。ブリッジを止めると失われる)
- **`revision`**: 設定の版(0 以上の整数)。ブリッジの起動ごとに 0 から始まり、設定を変えるたびに 1 つ進む。UI は `networkSettingsSet` にこれを添える

```json
{"v":1,"type":"networkSettings","revision":3,"targetInterface":"192.168.1.10","targetRanges":["192.168.1.0/24"],"allowedBrowsers":["192.168.1.0/24","10.0.0.5/32"],"interfaces":[{"address":"127.0.0.1","name":"localhost"},{"address":"192.168.1.10","name":"Ethernet"}],"source":"saved"}
```

### `delivery` — 送ったものが送り先の PC に届いたか(D-116)

```json
{ "v": 1, "type": "delivery", "events": [
  { "host": "192.168.0.11", "target": "PC1", "result": "ok", "elapsedMs": 4 },
  { "host": "192.168.0.12", "target": "PC2", "result": "ignored", "elapsedMs": 9 } ] }
```

- ブリッジはターゲットへ送るたびに (宛先名, 送ったアドレス) を記録し、通信アダプタ(D-110)が振り分けた受信と突き合わせる。`result` は `ok` = 届いた(アダプタの「届いた」。OSC ではエコー)、`ignored` = 届いたが対象がいない(「対象なし」。OSC では受け口の `/sys/ignored`)、`failed` = 届いたが処理できなかった(「処理失敗」。`/sys/failed`)。後ろの 2 つは受け口の任意の通知(HID-375)で、返さない受け口では `ok` だけが届く
- `host` は返事を返した PC、`target` は宛先名、`elapsedMs` は送ってから届くまでの経過(遅れて届いた PC に気づくため)。送ったもののパラメータ id の `param` はサーフェス定義と一緒に撤去した(D-172。持つフレームは拒否される)。共通のフレームなので OSC のアドレスや型タグは載せない(HID-373)。送っていないもののエコーと、送り先でないホストの返事はイベントにしない。ブロードキャストの宛先では、答えたホストごとに 1 回
- 「エコーの表示は主系だけ」(D-046)は値の表示の扱いで、到達のイベントには適用しない(副系や全てのデバイスの各ホストについても出す)。値の表示は変えない
- 頻度の上限: (宛先, ホスト, 結果) ごとに 100 ms に 1 回まで(スライダーの連続操作で大量に出るのを抑える)。結果ごとに分けるので、連続する `ok` が 1 回の `failed` / `ignored` を押し流さない。色の退色などの途中経過は送らない(UI が行う)
- 全 UI へ配る(状態はブリッジが持ち、どのブラウザから送っても同じに光る)。送った記録は 1024 件・30 秒まで

### `heartbeat` — WebSocket 心拍

ブリッジが **15,000 ms 間隔**で送る。`t` は送信時点の Unix epoch 時刻（ミリ秒）の数値である。UI は受信した `t` をそのまま `heartbeatAck` の `t` にして直ちに返す。ブリッジが最後に受信してから **30,000 ms** を超えると、その接続をタイムアウトとして切断する。

```json
{"v":1,"type":"heartbeat","t":1720000000000}
```

### `notice` — 注意・エラー通知

不正な上りフレームなど、UI に知らせるべき事象を送る。`level` は `info` / `warn` / `error`、`code` と `detail` は文字列である。`requestId`(省略可、1〜64 文字)は、要求の印を添えた上りへの答えのときだけ、その印をそのまま返す(いまは `networkSettingsSet` の `network-settings-applied` / `network-settings-rejected`(HID-474)と、`osc.padSync` の `pad-synced` / `pad-sync-rejected`)。印の無い答えでは省く

```json
{"v":1,"type":"notice","level":"warn","code":"bad-frame","detail":"discarded"}
```

まとめ送り(`osc.batch`)が内部予約アドレス、ロック、サイズ上限、または送信経路の検査に失敗した場合は、`level` が `error`、`code` が `batch-rejected` の `notice` を送る。`detail` には拒否理由を含める(`osc.batch` は印を持たないので `requestId` は付かない)。この場合、まとめの中身は Unity へ一つも送らない。ロック中の部品・行に当たる `osc.message` は `code` が `locked` の `notice` で断る(後述の `lock`)。

パッドの `code` は、保存・読み込みを断った `pad-rejected`、押下を断った `pad-press-rejected`、値の変更を断った `pad-set-rejected`、表のアクションを断った `pad-action-rejected`、同期の結果の `pad-synced`(`level:"info"`)と `pad-sync-rejected` である(どれも要求元だけ。ほかは `level:"error"`)。

プロジェクトファイル(D-090・D-173)の `code` は、書き出しを断った `project-export-rejected`、取り込みを断った `project-import-rejected`(どちらも要求元だけ。`level:"error"`)、取り込みを終えた `project-imported`(要求元だけ。`level:"info"`)である。`project-imported` の `detail` は、取り込んだパッドの名前・保持値の数と、今のパッドに当たらずに捨てた値の数(あれば)・落としたサーフェス定義(版 1・版 2 のファイルにあれば)を並べたもの(例: `pad "take-03", 3 value(s), surface definition "stage" was not imported`)。

サーフェス定義・実行時の一覧・行の増減・設計図の `code`(`set-rejected`・`row-rejected`・`surface-rejected`・`runtime-options-refresh-rejected`・`runtime-options-apply-rejected`・`record-key-rejected`・`resend-rejected`・`catalog-mismatch`・`catalog-adopted`・`catalog-adopt-rejected`)と、走査の `destinations-scan-failed` は撤去した(D-172)。

宛先パネルの `code` は、選択を断った `destinations-rejected`(要求元だけ。`level:"error"`)、選択をファイルへ書けなかった・`destinationsReset` でファイルを消せなかった `destinations-save-failed`(全 UI。`level:"error"`。書けなかった選択は `source: "unsaved"` で配る)、端末の名前を断った `destination-alias-rejected`(要求元だけ。`level:"error"`)、端末の名前をファイルへ書けなかった `destination-aliases-save-failed`(全 UI。`level:"error"`。名前は実行中だけ効く)である(後の 2 つは D-092)。

ネットワークの設定(D-113)の `code` は、変更を断った `network-settings-rejected`(要求元だけ。`level:"error"`。`detail` は後述の `networkSettingsSet`)と、変更が通った `network-settings-applied`(要求元だけ。`level:"info"`。`detail` は `revision: <通った後の版>`。全 UI への `networkSettings` の後に届く。D-153)と(この 2 つは、要求に `requestId` があればそれを載せる。HID-474)、設定をファイルへ書けなかった `network-settings-save-failed`(全 UI。`level:"error"`。設定は `source: "unsaved"` で実行中だけ効く)である。

## 上りフレーム（UI → ブリッジ）

UI から送る種類は次のとおりである(OSC パッドの 4 種類とプロジェクトファイルの 2 種類とネットワークの設定の `networkSettingsSet` は末尾)。

### `lock` / `unlock` — 操作中のロック(HID-378・D-111)

ブラウザがある部品の操作を始めたら(スライダーのドラッグ開始・入力欄へのフォーカスなど)、`lock` でロックを求める。ロックの単位は採用中のパッドの値を持つ部品(`ref: {"widget": "<部品の id>"}`)と表の部品の 1 行(`ref: {"widget": "<表の部品の id>", "key": "<行のキー>"}`)である(D-169)。サーフェス定義のパラメータ(`{"param"}`)と Record の行(`{"record", "key"}`)の単位は撤去した(D-172。持つフレームは拒否される)。

```json
{"v":1,"type":"lock","ref":{"widget":"master"},"holder":"page-7f3a","label":"192.168.1.10"}
{"v":1,"type":"lock","ref":{"widget":"member","key":"6f1c2a90-0000-4000-8000-000000000001"},"holder":"page-7f3a","label":"192.168.1.10"}
{"v":1,"type":"unlock","ref":{"widget":"master"},"holder":"page-7f3a"}
```

- **持ち主**: 接続(`hello.clientId`)と `holder` の組。`holder` は操作したページを表す名前で、UI が振る(1〜64 文字)。`label` は他のブラウザに出す持ち主の名前(ページの IP など。64 文字まで)
- **期限**: 2 秒。操作が続く間は同じ `lock` を送り直して延ばす(SPA は 0.5 秒ごと)。期限の無いロックは無い。期限切れ・持ち主の `unlock`・接続の切断で外れる。持ち主以外の `unlock` は何もしない
- **ほかの持ち主が持っているとき**: `lock` は要求元へ `notice`(`code: "lock-rejected"`、`level: "warn"`、`detail: "held: <label>"`)を返す
- **採用中のパッドに無い単位**: パッドに無い部品・値を持たない部品、表に無い行の `lock` は、`lock-rejected`(`detail: "unknown-ref: <単位>"`)で断る。無い単位のロックで全量の `locks` を膨らませられないようにするため(HID-392)。持てるロックの数にも上限があり、超えると `detail: "too-many-locks"`
- **値の変更の拒否**: ロック中の部品・行への、持ち主の `holder` を付けない変更は送らずに断る。パッドの `osc.padSet` / `osc.padSetCell`、`osc.message`(パッドの部品・表のマスと同じアドレス)と、持ち主の印を持たないボタン(`osc.padPress`)・表のアクション(`osc.padAction`)は `code: "locked"`、`osc.batch` は `batch-rejected` で、`detail` は `locked: <単位> by <label>`。同じアドレスの部品は 1 つのロックとして見る。まとめ送り・全行のアクションは、含まれる部品・行のどれかがロック中ならまとめごと断る(1 データグラムでまとめて届く前提を崩さないため)
- 値の変更のフレーム(`osc.padSet` / `osc.padSetCell` / `osc.message` / `osc.batch`)は、操作したページの `holder` を省略可のキーとして持つ

### `osc.message` — Unity へ送る OSC

`address` と型タグ付き `args` を送る。OSC 専用の生の送信で、SPA は使わない(パッドの部品の操作は `osc.padSet` などで送る)。送信ログの `origin` は `ui`。保持値は書き換えない(パッドの保持値を書き換えるのはパッドの部品の操作だけ。D-169・D-172)。`from`、`target`、配列形式の旧イベント名などは付けない。ブリッジは設定された全ての Unity 宛先（主系と副系）へ転送し、内部予約アドレスへの送信は拒否する。

```json
{"v":1,"type":"osc.message","address":"/avatar/pos",
 "args":[{"type":"f","value":0.1},{"type":"f","value":0.9}]}
```

上り(`osc.message` と `osc.batch` の各要素)の `address` と `s` の引数は、NUL(U+0000)と孤立サロゲートを含めない。含むフレームは不正なフレームとして捨てる(HID-392)。OSC の文字列は NUL で終わるので `/set/level\u0000` は `/set/level` と同じバイト列で Unity へ届くが、ロックの照合(完全一致)だけを外れるため。孤立サロゲートも UTF-8 へ直すと U+FFFD に置き換わり、照合した文字列と送るバイト列が食い違う。下りの `osc.message` は Unity から届いた文字列をそのまま載せる。

### `osc.batch` — 複数の OSC を 1 データグラムで送る

`messages` に 1 件以上の OSC メッセージを、送信順に並べる。各要素は `address` と `args` だけを持ち、`osc.message` と同じ型タグ付き引数を使用する。ブリッジはこれを即時タイムタグの OSC bundle 1 個へ変換し、1 データグラムとして全ての Unity 宛先へ送る(主系への送信に失敗したときはバッチ全体を拒否し、副系へも送らない)。ブリッジはメッセージの意味を解釈せず、保持値にも記録しない(送信ログの `origin` は `action`)。OSC 専用の生のまとめ送りである(共通のフレームのまとめ送り `batch` は D-172 で撤去した)。

1 バッチの上限は 512 メッセージ、OSC bundle のエンコード後サイズの実用上限は 60 KiB (60 × 1024 byte) である。空の `messages`、上限超過、内部予約アドレスを含むバッチは拒否する。

```json
{"v":1,"type":"osc.batch","messages":[
  {"address":"/slot/01","args":[{"type":"f","value":0.25}]},
  {"address":"/slot/02","args":[{"type":"f","value":0.75}]},
  {"address":"/cue/apply","args":[{"type":"i","value":1}]}
]}
```

### `reconcile` — 撤去した(D-166・D-169)

「この PC を生成の記録に合わせる」は生成の記録と一緒に撤去した。送ってきたフレームは不正なフレームとして捨てる(`upstream-reconcile-removed`)。1 台を保持値の状態に揃えるのは、パッドの手動の同期(`osc.padSync`)で行う

### `destinationsSelect` / `destinationsReset` — 送り先の選択(宛先パネル)

`DESIGN.md` D-078 / D-079 / D-085。応答はどれも `destinations` の全量で、選択の変更は全 UI へ、断ったときは要求元だけへ届く(要求元のチェックを、ブリッジが持つ選択へ戻させるため)。LAN を走査させる `destinationsScan` は撤去した(D-172。送っても未知の種別として捨てる)。宛先パネルの「探し直す」は `osc.queryRefresh`(後述)を送る。

- **`destinationsSelect`**: `allDevices`(真偽値、省略不可)と `networks`(`broadcasts` の `network`、最大 4 個、省略不可。選ばないときは空の配列)と `hosts`(空でない文字列、最大 256 個)を持つ。`allDevices: true` なら `broadcasts` の各アドレスへ(先頭が主系)、`false` なら `networks` の各ネットワークのブロードキャストアドレス(`net-<a>-<b>-<c>-<d>-<prefix>` という名前で `sendPort` へ)と `hosts` の各端末へ送る(ブロードキャストの宛先が先に並ぶ)。選んだネットワークの中のホストのうち `sendPort` へ送るものは、ブロードキャストと二重に届かないよう個別には送らない(`config` の宛先で `sendPort` が違うものは個別に送る。`config` の宛先がホスト名なら名前解決したアドレスで判定する)。この PC を指す宛先(ループバック・この PC のどの NIC のアドレスも)は、ブロードキャストがこの PC 自身にも届くので、ネットワークを 1 つでも選べば個別には送らない。ブロードキャストの宛先(`allDevices` を含む)は、ネットワークの中とループバックに加えてこの PC のどの NIC のアドレスから返った pong も受ける(同じ PC の Unity が別の NIC のアドレスから答えるため)。ネットワークの宛先の pong とエコーの扱いは「全てのデバイス」と同じ(pong を返したホストを Unity とみなし、パッドの同期・自動の再送はそのホストへユニキャストで送る。D-079)。`config` にあるホストはその宛先(名前・`sendPort`)のまま使い、それ以外は `ip-<a>-<b>-<c>-<d>` という名前で `sendPort` へ送る。主系は、`config` の主系が個別の宛先に残っていればそれ、`config` の主系が選んだネットワークの中ならそのネットワークの宛先、どちらでもなければ先頭。選択はファイル(`destinations.file`)へ原子的に保存し、ブリッジ再起動後も保たれる。新しく加わった宛先へ保持値を自動では送らない(送るのはパッドの同期か、自動の再送を入れたときのターゲットの起動。D-165)。`hosts` に書けるのは、`config` の宛先のホストと、ブリッジの PC の有効なネットワーク(`broadcasts` のネットワーク。この PC 自身のアドレスを含む)の中のユニキャストアドレスだけである(ネットワークアドレス・ブロードキャストアドレス、ほかのネットワーク・公開アドレス・ループバックは書けない。ブロードキャストは `allDevices` で選ぶ)。IPv4 は正規形(先頭ゼロの無い dotted-quad)だけを受け、`192.168.001.255` のような非正規の表記は `invalid-host` で断る。一覧(`devices`)に出ているかどうかは問わない。保存した選択を起動時に戻すとき、および「探し直す」・ネットワークの設定の変更でこの PC のネットワークが変わったときも同じ規則で検証し直し、外れたホストと、この PC がもういないネットワークは警告して落とす(個別の選択とネットワークが全部落ちたら `config` の宛先に戻る)。D-085 より前に保存したファイル(`networks` が無い)は `networks` が空として読む。断る場合は `notice`(`code:"destinations-rejected"`、`detail` は `empty-selection`(`allDevices: false` で `networks` と `hosts` がどちらも空)/ `invalid-host: <ホスト>` / `invalid-network: <ネットワーク>`(`broadcasts` に無い)/ `no-broadcast-network`(`broadcasts` が空))
- **`destinationsSelect` の `endpoints`(D-168)**: 省略できる(省略は空)。OSCQuery のターゲットを `{"host": <端末>, "port": <OSC_PORT>}` の組で最大 256 個選ぶ。各組は `oq-<a>-<b>-<c>-<d>-<port>` という名前で、その `port` へ送る。`host` は `hosts` と同じ規則で縛り(外れたら `invalid-endpoint: <host>:<port>` で断る)、いま見つかっているかは問わない(再起動直後に OSCQuery を読む前でも選び直せる)。同じホストと同じポートへほかの選択(`config` の宛先・`hosts`・選んだネットワークのブロードキャスト)で送るなら重ねて送らない。`allDevices: true` の間も、`sendPort` と違うポートの組は個別に送る(ブロードキャストは `sendPort` にしか届かない)。`endpoints` だけの選択も受ける(`empty-selection` は `networks`・`hosts`・`endpoints` が全部空のとき)。選択は `destinations.file` の `endpoints` に保存する(この開発の途中の形で書いた `ports`(ホスト → ポート)は、読むときに `endpoints` へ移してそのホストを `hosts` から外す)
- **`destinationsReset`**: 引数を持たない。保存した選択を消し、`config` の宛先へ戻す

```json
{"v":1,"type":"destinationsSelect","allDevices":false,"networks":[],"hosts":["192.168.1.20","192.168.1.21"]}
{"v":1,"type":"destinationsSelect","allDevices":false,"networks":["192.168.1.0/24"],"hosts":["10.0.0.40"]}
{"v":1,"type":"destinationsSelect","allDevices":false,"networks":[],"hosts":[],"endpoints":[{"host":"192.168.1.20","port":9001}]}
{"v":1,"type":"destinationsReset"}
```

### `destinationsAlias` — 端末の名前(別名)

`DESIGN.md` D-092。宛先パネルの端末に、UI から名前(別名)を付ける・消す。端末の名前が分からない(この PC でも OSCQuery のターゲットでもない)端末も、見分けられるようにするため。

```json
{"v":1,"type":"destinationsAlias","host":"192.168.1.21","alias":"ステージ左 iPad"}
{"v":1,"type":"destinationsAlias","host":"192.168.1.21","alias":null}
```

- **`host`**: `destinations` の `devices` にある端末の `host`(1〜253 文字)。一覧に無い端末には付けられない
- **`alias`**: 256 文字までの文字列か `null`(省略不可)。ブリッジは前後の空白を外し、`null` か空白だけなら名前を消す。名前は 64 文字まで(文字数は UTF-16 の単位で数える。絵文字などは 1 文字で 2)で、超える名前・制御文字を含む名前は理由つきで断る(フレームとしては 256 文字まで受ける。フレームの検査で落とすと UI に理由が返らないため)
- **覚えるキー**: ブリッジは、その端末の MAC が分かれば(`devices` の `mac`。この PC は NIC の MAC、ほかの端末は別名の表に残る最後に分かった MAC)MAC で、分からなければ `host` の文字列で覚える。MAC は UI から受け取らない。走査の ARP 表が無くなったので(D-172)、新しく付ける名前はこの PC 以外ではほぼ `host` で覚える。MAC で付け直すと、同じ `host` で覚えていた名前は消す(MAC の名前へ移す)。消すときは MAC と `host` の両方の名前を消す。MAC の名前には最後に見えたホストも一緒に覚える
- **表示の照合**: `devices` の `alias` は、MAC の名前、無ければ `host` の名前。前に MAC で覚えた名前は、最後に見えたホストの行に出る。`host` で覚えた名前は IP が変わると外れ、その IP に後から来た別の端末に付いて見えることがある
- **保存**: 名前は `destinations.aliasesFile`(省略時は `<保持値の保存先>/.device-aliases.json`)へ原子的に保存し、ブリッジ再起動後も保たれる。覚える名前は 512 件まで。ファイルの各件は `{ "key": "mac:aa:bb:cc:dd:ee:ff" | "host:<host>", "alias": "...", "host": "<最後に見えたホスト。MAC の件だけ>" }`。手で直したときの書き損じの件は警告して捨て、残りを読む(MAC の大文字・ハイフン区切りは直して受ける)。ファイルそのものが読めないときは別名なしで起動し、そのファイルを上書きしない
- **応答**: 受け付けたら `destinations` の全量を全 UI へ配る。断るときは要求元だけへ `notice`(`level:"error"`、`code:"destination-alias-rejected"`、`detail` は `unknown-host: <ホスト>` / `unaliasable-host: <ホスト>`(制御文字を含むなど、キーに使えない host)/ `alias-too-long: ...` / `alias-has-control-characters` / `alias-has-lone-surrogates`(対になっていない UTF-16 サロゲート。保存すると UI が `destinations` を符号化・描画できなくなるため。この検査の前に保存された該当エントリは、起動時の読み込みで警告とともに捨てられ、次の保存でファイルからも消える) / `too-many-aliases: ...`)と、その UI へ `destinations` を返す。ファイルへ書けなかったとき(読めなかったファイルを上書きしないときを含む)は名前を実行中だけ効かせ、全 UI へ `notice`(`level:"error"`、`code:"destination-aliases-save-failed"`)を送る

### `osc.queryRefresh` — OSCQuery のターゲットを探し直す(D-168)

```json
{"v":1,"type":"osc.queryRefresh"}
```

mDNS の問い合わせを出し直し、知っているターゲットすべての `HOST_INFO` と名前空間を読み直す。要求元へはすぐ `osc.queryTargets` を返し、読み終わったら全 UI へ送る。ターゲットを選んで読み直すことはできない。mDNS の問い合わせは 1 秒に 1 回までで、続けて届いた読み直しは間引いて 1 回にまとめる(認証の無い UI から連打されても LAN へ撒き続けないため)。

宛先パネルの「探し直す」とパッドのパレットがこれを送る(D-172)。このときブリッジは、OSCQuery を探し直すのに加えて、この PC の NIC を読み直して宛先を決め直し(後から足した NIC・DHCP で変わったアドレスを選べるように。外れた選択は `destinationsSelect` と同じ規則で落とす)、`destinations` と `networkSettings`(`interfaces` の候補)を全 UI へ配り直す。撤去した LAN の走査(`destinationsScan`)の「更新」が受け持っていた読み直しである。

### `osc.padLoad` / `osc.padSave` — OSC パッドの切り替え・保存

- **`osc.padLoad`**(`name`): 保存済みのパッドを読み込んで採用し、全 UI へ配る。無い・壊れている場合は直前のパッドを維持して `pad-rejected` を返す
- **`osc.padSave`**(`name`・`pad`・省略可の `baseVersion`): `pad` を検証して保存し、採用して全 UI へ配る。`pad` の中身はフレームの形式検査では見ず(フレームごと捨てると UI に理由が届かないため)、ブリッジが検証して理由を返す。版 1 と版 2 のどちらの文書も受け、版 2 で保管する。保存だけして採用しない指定は無い。`baseVersion` は後述の `osc.padDocumentRequest` / `osc.padDocumentEdit` の節

取得の要求は `osc.padDocumentRequest`(後述)だけである。版 1 の写しを返していた `osc.padRequest` と、版 1 の編集命令 `osc.padEdit` は撤去した(D-172。送っても未知の種別として捨てる)。

```json
{"v":1,"type":"osc.padLoad","name":"take-02"}
{"v":1,"type":"osc.padSave","name":"take-03","baseVersion":"a1b2c3d4e5f6-2","pad":{"format":"oscdesk-pad","version":2,"rows":1,"columns":1,"widgets":[]}}
```

### `osc.padPress` — OSC パッドの押下

`name`(押したパッドの名前)・`version`(押した画面が描いたパッドの `osc.padDocument` フレームの `version`。必須)・`button`(ボタンの部品の `id`)だけを送る。アドレスと引数は送らず、ブリッジが採用中のパッドから引いて**全宛先へ 1 メッセージ**(bundle にしない)で送る。送る中身の正をブリッジに置き、どの端末から押しても保存されたとおりに送るため、任意のアドレスを撃つ上りの経路は作らない。

- **保持値・再送に載せない**: 押下はきっかけであり、保持値を書き換えず、同期・再送もしない(値の部品と同じアドレスを撃っても保持値は変わらない。食い違いはエコーの警告ログに出る)
- **送信ログ**: `osc.sentLog` の `origin` は `pad`
- **断る場合**: 採用中のパッドの名前か版(`version`)と違う(別の端末が切り替えた・同じ名前で上書き保存した直後の古い画面や、ブリッジの再起動の前に描いた画面。同じ `id` の別のボタンを撃たないため。`revision` は再起動で 1 に戻るので照合に使わない)・未知のボタン・予約アドレスは、何も送らずに要求元だけへ `notice`(`level: error`、`code: pad-press-rejected`、`detail` は `stale-pad: <name>@<version>` / `unknown-button: <id>` / `internal-address: <address>`)を返す。ほかのブラウザがロック中の部品・行と同じアドレスなら `code: "locked"`

```json
{"v":1,"type":"osc.padPress","name":"take-03","version":"3f9a1c0b7e2d-2","button":"b1"}
```

### `osc.padDocumentRequest` / `osc.padDocumentEdit` — 版 2 のパッドの取得と編集命令(D-167・D-169)

`osc.padDocumentRequest`(引数なし)は要求元へ `osc.padList`・`osc.padDocument`(採用中なら)・`osc.padValues`(全量)・`osc.padResend` を返させる。UI は接続のたびに(再接続を含む)、`hello.adapters` に `osc` があればこれを送る。`osc.padDocumentEdit` は版 2 の編集命令(`PadDocumentEditSchema`。`packages/shared/src/pad-document-edit.ts`)を作業コピー `draft`(版 1 も受けて版 2 に直す)に当て、結果を `osc.padDocumentEdited`(`requestId` 付き)で返す。ブリッジは編集中の状態を持たず、何も保存・採用しない。保存と切り替えは `osc.padSave`・`osc.padLoad`。版 1 で表せない部品を持つ保管済みのパッドへの版 1 の `osc.padSave` は `pad-rejected` で断る(旧い画面からの上書きで値の部品・表を消さない)。`osc.padSave` に省略可の `baseVersion`(保存する文書のもとにした `osc.padDocument` の `version`)を付けると、採用中のパッドの `version` が違う(採用中のパッドが無いときを含む)ときは保存せずに `pad-rejected`(`stale-pad: <名前>@<baseVersion>`)で断る。同じ版から同時に編集した 2 つの画面の後着の保存が、先着の変更(行の追加・削除と、削除に伴う保持値)を古い写しで消さないため。`baseVersion` が `null` のときは、採用中のパッドが無い状態から作った文書として、採用中のパッドがあれば断る(`stale-pad: <名前>@none`。初めての保存を 2 つの画面が同時にしたとき、後着が先着を上書きしないため)。SPA は UI で管理する行の変更と、上書きを確かめていない保存に付ける(HID-489・D-170)。

```json
{"v":1,"type":"osc.padDocumentRequest"}
{"v":1,"type":"osc.padDocumentEdit","requestId":"pad-edit-1","draft":{"format":"oscdesk-pad","version":2,"rows":2,"columns":2,"widgets":[]},"edit":{"op":"addWidget","kind":"slider","row":0,"column":0}}
```

### `osc.padSet` / `osc.padSetCell` — 値の部品・表のマスの変更(D-169)

```json
{"v":1,"type":"osc.padSet","name":"take-03","version":"a1b2c3d4e5f6-2","widget":"level","value":0.5,"holder":"page-1"}
{"v":1,"type":"osc.padSetCell","name":"take-03","version":"a1b2c3d4e5f6-2","widget":"members","key":"m01","column":"active","value":true}
```

- 名前と `version` が採用中のものと違えば送らずに `pad-set-rejected`(`stale-pad: <名前>@<version>`)
- 値は部品の型と値域で確かめる(トグルは真偽値で `T` なら OSC 1.0 の `T` / `F`、`i` なら 0 / 1、スライダーと数値は型どおりの数で範囲の中、選択は候補のどれか、文字は `maxLength` と NUL・孤立サロゲートの無いこと、組み合わせは引数の数と各引数、`ffff` の色は 0〜1 の数 4 つ)。合わなければ `pad-set-rejected`(`out-of-range: …`・`type-mismatch: …`・`not-an-option`・`unknown-widget: <id>`・`read-only: <id>`・`unknown-row: <id>[<key>]`・`too-many-rows: …` など)。`r` の色は wire と osc-codec が運べないので `unsupported-type: r`(`T` / `F` は HID-492 で運べるようになった)
- 同じアドレスの後の部品の操作は、持ち主の型と値域でも読める値だけを通し(合わなければ `owner-mismatch: <持ち主> …`)、持ち主の型で送る
- ロックの単位は値の部品 `{"widget": "<id>"}`(同じアドレスの部品すべてのロックを見る)と表の行 `{"widget": "<id>", "key": "<キー>"}`。パッドのロックは、同じアドレスへ送る `osc.message`・`osc.batch`・パッドのボタン(`osc.padPress`)・表のアクション(`osc.padAction`)でも確かめる(ボタンとアクションは持ち主の印を持たないので、ロック中なら `locked` で断る)。ほかの持ち主がロック中なら `code: "locked"`
- 全宛先へ 1 メッセージで送り(送信ログは `origin: "ui"`)、送れたものだけを保持値に入れて `osc.padValues`(`full: false`)を全 UI へ配る。表のマスのアドレスは `/<表のアドレス>/<key>/<欄のアドレス>`

### `osc.padAction` — 表のアクション(D-167)

`scope: "row"` のアクションは `key` の行の `/<表のアドレス>/<key>/<アクションのアドレス>` へ、`scope: "all"` は全行(UI で管理する行は一覧、ターゲットが持つ行は今は保持値にある行)へ、決まった値を送る(送信ログは `origin: "pad"`)。保持値には入れない。断るときは `pad-action-rejected`。

```json
{"v":1,"type":"osc.padAction","name":"take-03","version":"a1b2c3d4e5f6-2","widget":"members","action":"reset","key":"m01"}
```

### `osc.padSync` — 手動の同期(D-165・D-169)

選んだ PC へ、パッドの保持値のうち「送り直す」の部品・表の欄の値を、`/sys/sync/begin ,s manual` と `/sys/sync/end` で挟んで送る(順序は `osc.padResend` の自動の再送と同じ)。`target`(`hello.targets[].name`)を省くと全宛先。`host`(と `port`)で 1 台に絞る: 今の宛先の host・ブロードキャストの宛先へ pong を返したホスト・OSCQuery で見つけたターゲット(`osc.queryTargets` の `host` と `oscPort`。ターゲットがいる範囲の中だけなので、宛先に選んでいなくてよい)。これ以外のアドレスへは送らない(`pad-sync-rejected`、`unknown-target: <名前>` / `unknown-host: <host>[:<port>]`)。送れたら要求元へ `pad-synced`(`detail` は `<宛先名> (<host>): <N> value(s)`)。`requestId` は notice にそのまま載る。

```json
{"v":1,"type":"osc.padSync","target":"backup","requestId":"sync-1"}
{"v":1,"type":"osc.padSync","host":"192.168.1.21","port":9000}
```

### `osc.padResendSet` — 自動の再送の入り切り(D-165)

```json
{"v":1,"type":"osc.padResendSet","auto":true}
```

答えは `osc.padResend`(全 UI)。

### `projectExport` / `projectInspect` / `projectImport` — プロジェクトファイルの書き出し・読み込む前の検査・取り込み

`DESIGN.md` D-090・D-173。プロジェクトファイル(前述の `project`。版 3)は、採用中のパッド・その保持値・送り先を 1 つにまとめたもので、UI はブラウザのダウンロード・アップロードで扱う(ブリッジのフォルダへは書き出さない)。SPA では「同期」のタブのパネルから使う。

- **`projectExport`**(`requestId`: 1〜64 文字の文字列。必須): 採用中のパッド・保持値・今送っているユニキャストの宛先をまとめ、取り込みと同じ検査(`ProjectFileSchema`)を通してから `project` を要求元だけへ返す。パッドを採用していない・12 MiB を超える・検査に通らない(取り込めないファイルになる)場合は `notice`(`code:"project-export-rejected"`、`detail` は `empty: no pad is adopted` / `too-large: ...` / `invalid: ...`)。この notice は `requestId` を持たない。ブリッジは 1 本の接続の上りを受けた順に処理してその場で答えるので、UI は最も古い応答待ちの `projectExport` への答えとして扱える
- **`projectInspect`**(`requestId`: 1〜64 文字の文字列。必須、`project`: JSON オブジェクト): 取り込みと同じ判定だけを行い、何も書き換えずに `projectInspection`(前述)を要求元だけへ返す(D-122)。UI はアップロードしたファイルをまずこれで確かめ、通れば答えの要約(落とすサーフェス定義を含む)で確認のダイアログを出してから `projectImport` を送る。判定の写しを UI に置かないため(UI 技術を差し替えても判定を作り直さずに済む)
- **`projectImport`**(`project`: JSON オブジェクト): プロジェクトファイルを取り込む。`project` の中身はフレームの形式検査では見ず、ブリッジが大きさ(12 MiB)を先に見てから `readProjectFile` に 1 回だけ通す(何も書き換えないうちに確かめる)。版 1・版 2 のファイルは版 3 へ移す(前述の `project`)。通れば、パッドを `osc.pad.name` で保存(直前の内容は `.backups/` へ退避)して採用し、保持値をファイルの `osc.values` で置き換える(同じ名前のパッドを採用中でも今の値を引き継がない。保存した値のファイルも書き直す)。今のパッドに当たらない値(無い部品・値を持たない部品・型や値域の合わない値・UI で管理する行に無い行)は捨てる。配信は通常の採用と同じ(`osc.padDocument`・`osc.padList`・`osc.padValues`(全量)を全 UI へ)で、最後に要求元へ `notice`(`code:"project-imported"`、`level:"info"`。`detail` は前述の `notice`)を返す
- **送り先へは送らない**: 取り込んだ保持値は送り先へ送らず、宛先の選択も変えない(ファイルの `destinations` は記録として残すだけ。読み込んだ PC のネットワークに合うとは限らず、ファイルから UDP の行き先を変えさせないため)。送るのは利用者の同期(`osc.padSync`)と、利用者が入れた自動の再送(`osc.padResend` の `auto`)が見たターゲットの起動だけである。取り込んだ値に「まだ送っていない」の印は持たない(D-090 の `desiredStatus` は撤去した。D-173)
- **断る場合**: `notice`(`code:"project-import-rejected"`、`detail` は `surface-file: ...` / `surface-only: ...` / `unsupported-version: ...` / `too-large: ...` / `invalid: ...` / `pad: <保存の失敗の理由>`)。検証で断るときは何も書き換えない
- **競合**: 作業コピーの照合はしない(後勝ち)。UI は送る前に確認のダイアログを出す

```json
{"v":1,"type":"projectExport","requestId":"page-1-3"}
{"v":1,"type":"projectInspect","requestId":"inspect-1-ab12","project":{"format":"oscdesk-project","version":2,"exportedAt":"2026-10-28T10:00:00.000Z","surface":null,"osc":{"pad":{"name":"take-03","pad":{"format":"oscdesk-pad","version":1,"rows":1,"columns":1,"buttons":[]}}}}}
{"v":1,"type":"projectImport","project":{"format":"oscdesk-project","version":2,"exportedAt":"2026-10-28T10:00:00.000Z","surface":null,"osc":{"pad":{"name":"take-03","pad":{"format":"oscdesk-pad","version":1,"rows":1,"columns":1,"buttons":[]}}}}}
```

上の見本は版 2 のファイル(版 3 へ移して取り込む)。版 3 のファイルは前述の `project` の `project` と同じ形である。

### `networkSettingsSet` — ネットワークの設定の変更

`DESIGN.md` D-113。3 つの設定(前述の `networkSettings` の `targetInterface`・`targetRanges`・`allowedBrowsers`)をまとめて置き換える。どれも省略できない(部分更新はしない)。どの UI からでも変えられ、通れば保存して全 UI へ `networkSettings` を配る。

- **`targetInterface`**: `null`(すべて。`"0.0.0.0"` も同じ)か、`networkSettings` の `interfaces` にあるアドレス。変わったら Unity 向けの UDP ソケットを同じポートのまま付け替える(今のソケットを閉じてから新しいアドレスで開く。付け替えの間の数ミリ秒に届いた・送ろうとした OSC は落ちる)。開けなければ元のアドレスへ戻して断る
- **`targetRanges`**: IPv4 の CIDR(接頭辞は必須)。ブリッジがネットワークアドレスへ丸め(`192.168.1.10/24` → `192.168.1.0/24`)、重複を除く。変わると宛先パネルの範囲を決め直し、範囲の外になった端末を一覧と選択から外して `destinations` を配る。範囲の外になった mDNS の OSCQuery のターゲットも外す
- **`allowedBrowsers`**: CIDR か 1 台のアドレス(`/32`・`/128` にする)。正規形にして重複を除く。変わると範囲の外になった WebSocket の接続を切る
- **`revision`**: 操作した画面が持っていた設定の版(`networkSettings.revision`)。処理する時点の版と違えば何も変えずに断る(ほかのブラウザが先に変えた後の、古い画面からの上書きを防ぐ)
- **操作元**: 接続の送信元(ブラウザそのもの)で判定する(D-153・D-162)。届いた `browser`(撤去した NiceGUI 版の UI が操作したブラウザのアドレスを添えていたキー)は未知のキーとして断る
- **`requestId`**(省略可、1〜64 文字): 要求の印。ブリッジは通った・断ったの `notice` にそのまま載せて返す(HID-474)。要求元は、待っている要求への答えかをこれで見分ける。応答が時間切れの後に遅れて届いたとき、版だけでは次の要求の答えと見分けられないため(時間切れの後に今の版のまま送り直すと、遅れて届いた前の要求の `revision: <版>` が、次の要求が通ったときの版と同じになる)。SPA は送る
- **許可の外からの変更は断る**: 送信元が処理する時点の `allowedBrowsers` に入らなければ断る(localhost は常に入る)。許可を取り消した後に、閉じる前の接続から送られていた要求が届くことがあるので、それで設定を戻させない
- **自分を締め出す変更は断る**: 送信元が localhost でなく、新しい `allowedBrowsers` に入らなければ、何も変えずに断る(読めないアドレスも断る側に倒す)。localhost からは空(localhost だけ)にもできる
- **通った場合**: 全 UI へ `networkSettings` を配った後、要求元にだけ `notice`(`code:"network-settings-applied"`、`level:"info"`、`detail` は `revision: <通った後の版>`)を送る。版が進んだ `networkSettings` だけでは、ほかの UI の変更が先に通ったのか自分の変更が通ったのかを要求元が見分けられないため(D-153)。知らない UI は無視してよい
- **断る場合**: 要求元へ `notice`(`code:"network-settings-rejected"`、`detail` は `stale-revision: <届いた版> (current <今の版>)` / `not-allowed: <アドレス>` / `would-lock-out: <アドレス>` / `invalid-target-interface: <値>` / `invalid-target-range: <値>` / `invalid-allowed-browser: <値>` / `rebind-failed: <理由>`)と、今の `networkSettings` を返す。変更は届いた順に 1 つずつ処理し、版と許可の照合は前の変更を適用した後に行う

```json
{"v":1,"type":"networkSettingsSet","revision":3,"targetInterface":"192.168.1.10","targetRanges":["192.168.1.0/24"],"allowedBrowsers":["192.168.1.0/24"]}
```

### `heartbeatAck` — 心拍応答

`heartbeat` の `t` をそのまま返す。ブリッジはこの受信を接続の生存確認に使う。

```json
{"v":1,"type":"heartbeatAck","t":1720000000000}
```

## 撤去した HTTP の口(定義のダウンロード・アップロード)

サーフェス定義のダウンロード・アップロードの口(`GET /surfaces`・`GET /surfaces/<name>.json`・`PUT /surfaces/<name>.json`)は、定義と一緒に撤去した(D-172)。これらのパスは下の SPA の配信の決まったファイルに当たらないので 404 になる。WebSocket と同じポート(`wsPort`)の HTTP には認証がなく、CORS ヘッダも付けない(ほかのサイトのページからは応答を読めない)。

## SPA の配信(HTTP)

設定の `webUi.enabled`(既定 `true`)のとき、ブリッジは同じポートの HTTP で SPA(`packages/web-ui` のビルド出力。フォルダは `webUi.dir`、省略時はブリッジのバンドルの隣の `packages/web-ui/dist`)を配る(D-138)。

| メソッド・パス | 動作 |
|---|---|
| `GET /` ・ `GET /index.html` | SPA のページ |
| `GET /app.js` ・ `GET /app.js.map` ・ `GET /app.css` | SPA のスクリプト・ソースマップ・スタイル |

配るのはこの決まった名前のファイルだけで、ほかのパスは 404。`GET` / `HEAD` 以外は 405。1 KiB 以上のファイルは `Accept-Encoding` が gzip を受ければ gzip で返す。`Cache-Control: no-cache` と弱い `ETag` を付け、`If-None-Match` が一致すれば 304。`X-Frame-Options: DENY` と `Content-Security-Policy: frame-ancestors 'none'` で、ほかのページへの埋め込みを断る。ビルド出力が無ければ 503(本文に案内)。SPA は開いたページと同じ host:port の WebSocket(`ws://<host>:<wsPort>/`)につなぎ、この文書のフレームでほかの UI と同じように話す(`Origin` を付けるが、上の規則で受ける)。SPA の画面は「パッド」・「同期」・「送信先」・「ネットワーク」のタブで(広い画面では送信先はタブでなく横の欄に出る)、プロジェクトファイルの書き出し・取り込みは「同期」のタブにある(D-170・D-173)。

## 接続時とエラー時の動作

1. UI が WebSocket 接続を確立する。
2. ブリッジが `hello`、`link`、`osc.sentLog`(`full: true`。送信の記録の既存分)、`destinations`、`networkSettings`、`osc.queryTargets`、`locks` の順に送る。
3. UI は `hello.adapters` に `osc` があれば `osc.padDocumentRequest` を送り、`osc.padList`・`osc.padDocument`(採用中なら)・`osc.padValues`(全量)・`osc.padResend` を受け取ってパッドの画面と表示値を作る(接続ごとの初期の要求はこれだけ。D-155)。以後 `heartbeat` に応答し、`link` を状態へ反映する。
4. UI の通常操作は、パッドのボタンを上り `osc.padPress`、値の部品を `osc.padSet`、表のマスを `osc.padSetCell`、表のアクションを `osc.padAction` で送る。ブリッジは全宛先へ送り、値の部品・表のマスの値を保持値に記録して全 UI へ `osc.padValues`(`full: false`)を配る。主系の Unity からのエコーバックは下り `osc.padEcho`(と生の `osc.message`)で受け取り、届いたことの確認に使う(保持値は書き換わらない)。送り先の PC ごとに届いたかは `delivery` で受け取る。
5. JSON 構文、版数、未知キー、未知種別、型タグなどの検証に失敗したフレームは破棄される。接続は維持され、ブリッジが処理した上り不正フレームには可能なら `notice` も返す。撤去したフレーム(D-172 の `surface*`・`set`・`batch`・`resend`・`catalog*`・`runtimeOptions*`・`recordKey*`・`destinationsScan`・`osc.pad`・`osc.padRequest`・`osc.padEdit` など)も未知の種別として同じく破棄される。
   検証に通ったフレームの処理中にブリッジの想定外の例外が起きたときも、そのフレームだけを捨てて接続を保ち、要求元だけへ `notice`(`level:"error"`、`code:"internal-error"`、`detail:"<フレームの type>: <例外の文言(先頭 200 文字)>"`)を返す(D-129)。そのフレームの処理は途中で止まっているので、一部の下りフレームが届いている場合がある。UI は `osc.padDocumentRequest` などで状態を取り直せる。
6. 心拍タイムアウトで切断された場合、UI は再接続し、接続後に `osc.padDocumentRequest` を送って状態を再取得する。

## ワイヤ見本との対応

すべての実例は `protocol/wire-samples.json` に手書きで収録している。同ファイルの `cases` の `name` と本書の種類は次の対応になる。

| 本書 | `wire-samples.json` の `name` |
|---|---|
| 下り `hello` | `downstream-hello`、`downstream-hello-with-peer`(拒否例: `downstream-hello-no-adapters`、`downstream-hello-empty-peer`) |
| 下り `osc.message` | `downstream-osc-float`、`downstream-osc-bool-tags`(拒否例: `downstream-invalid-type-tag`) |
| 下り `link` | `downstream-link` |
| 下り `heartbeat` | `downstream-heartbeat` |
| 下り `notice` | `downstream-notice`、`downstream-notice-network-settings-applied`、`downstream-notice-network-settings-applied-request-id`、`downstream-notice-batch-rejected-request-id`(拒否例: `downstream-notice-empty-request-id`) |
| 下り `osc.sentLog` | `downstream-sent-log`、`downstream-sent-log-backlog-empty`、`downstream-sent-log-pad`(拒否例: `downstream-sent-log-unknown-origin`、`downstream-sent-log-missing-batch`) |
| 下り `destinations` | `downstream-destinations`、`downstream-destinations-all-devices`、`downstream-destinations-networks`、`downstream-destinations-unsaved`、`downstream-destinations-aliases`、`downstream-destinations-oscquery-services`(拒否例: `downstream-destinations-no-target`、`downstream-destinations-alias-too-long`、`downstream-destinations-missing-alias`) |
| 下り `osc.queryTargets` | `downstream-osc-query-targets`(拒否例: `downstream-osc-query-targets-bad-kind`) |
| 下り `osc.padList` | `downstream-pad-list`、`downstream-pad-list-none-active` |
| 下り `osc.padDocument` / `osc.padDocumentEdited` | `downstream-pad-document`、`downstream-pad-document-edited`(拒否例: `downstream-pad-document-v1`) |
| 下り `osc.padValues` / `osc.padEcho` / `osc.padResend` | `downstream-pad-values`、`downstream-pad-echo`、`downstream-pad-resend`(拒否例: `downstream-pad-values-tagged`、`downstream-pad-resend-extra`) |
| 下り `project` | `downstream-project`、`downstream-project-pad-only`(拒否例: `downstream-project-empty`) |
| 下り `projectInspection` | `downstream-project-inspection-ok`、`downstream-project-inspection-rejected`(拒否例: `downstream-project-inspection-ok-with-detail`) |
| 下り `delivery` | `downstream-delivery`(拒否例: `downstream-delivery-param-retired`、`downstream-delivery-bad-result`、`downstream-delivery-empty`、`downstream-delivery-negative-elapsed`、`downstream-delivery-osc-address`) |
| 下り `networkSettings` | `downstream-network-settings`、`downstream-network-settings-default`(拒否例: `downstream-network-settings-missing-source`) |
| 下り `locks` | `downstream-locks`、`downstream-locks-empty` |
| 上り `lock` / `unlock` | `upstream-lock-widget`、`upstream-lock-table-row`、`upstream-unlock`(拒否例: `upstream-lock-without-holder`、`upstream-lock-mixed-ref`) |
| 上り `osc.message` | `upstream-osc-multi`、`upstream-osc-bool-tags`、`upstream-osc-record-row`、`upstream-osc-record-row-with-id`(拒否例: `upstream-osc-message-nul-in-address`、`upstream-osc-message-nul-in-string-arg`、`upstream-osc-bool-tag-with-value`) |
| 上り `osc.batch` | `upstream-osc-batch`、`upstream-osc-batch-bool-tags`(拒否例: `upstream-osc-batch-empty`、`upstream-osc-batch-lone-surrogate`) |
| 上り `reconcile`(撤去した。D-166) | (拒否例: `upstream-reconcile-removed`) |
| 上り `destinationsSelect` / `destinationsReset` | `upstream-destinations-select`、`upstream-destinations-select-all-devices`、`upstream-destinations-select-networks`、`upstream-destinations-select-endpoints`、`upstream-destinations-reset`(拒否例: `upstream-destinations-select-missing-all-devices`、`upstream-destinations-select-missing-networks`、`upstream-destinations-select-endpoint-bad-port`) |
| 上り `destinationsAlias` | `upstream-destinations-alias`、`upstream-destinations-alias-clear`、`upstream-destinations-alias-over-limit`(拒否例: `upstream-destinations-alias-missing`、`upstream-destinations-alias-too-long`) |
| 上り `osc.queryRefresh` | `upstream-osc-query-refresh`(拒否例: `upstream-osc-query-refresh-extra-key`) |
| 上り `osc.padLoad` / `osc.padSave` / `osc.padPress` | `upstream-pad-load`、`upstream-pad-save`、`upstream-pad-save-base-version`、`upstream-pad-save-base-version-none`、`upstream-pad-press`(拒否例: `upstream-pad-save-path-traversal`、`upstream-pad-save-empty-base-version`、`upstream-pad-press-with-address`、`upstream-pad-press-without-version`) |
| 上り `osc.padDocumentRequest` / `osc.padDocumentEdit` | `upstream-pad-document-request`、`upstream-pad-document-edit` |
| 上り `osc.padSet` / `osc.padSetCell` / `osc.padAction` | `upstream-pad-set`、`upstream-pad-set-composite`、`upstream-pad-set-cell`、`upstream-pad-action`(拒否例: `upstream-pad-set-nul`、`upstream-pad-set-object-value`) |
| 上り `osc.padSync` / `osc.padResendSet` | `upstream-pad-sync`、`upstream-pad-sync-one-pc`、`upstream-pad-sync-endpoint`、`upstream-pad-resend-set`(拒否例: `upstream-pad-sync-address`、`upstream-pad-resend-set-missing`) |
| 上り `projectExport` / `projectInspect` / `projectImport` | `upstream-project-export`、`upstream-project-inspect`、`upstream-project-import`(拒否例: `upstream-project-export-without-request-id`、`upstream-project-inspect-without-request-id`、`upstream-project-import-array`) |
| 上り `networkSettingsSet` | `upstream-network-settings-set`、`upstream-network-settings-set-all-interfaces`、`upstream-network-settings-set-request-id`(拒否例: `upstream-network-settings-set-missing-ranges`、`upstream-network-settings-set-missing-revision`、`upstream-network-settings-set-retired-browser`) |
| 上り `heartbeatAck` | `upstream-heartbeat-ack` |

見本には、単一引数でも配列を保持する例、blob の base64、`osc.batch`、空バッチ、および異常系（旧配列形式、未知キー、`v:2`、未知種別、不正な型タグ）が含まれる。撤去したフレーム(`manifest`・`manifestRequest`・`link` の `manifest` 項目)が拒否されることを示す無効サンプル(`downstream-manifest-retired`、`upstream-manifest-request-retired`、`downstream-link-retired-manifest-field`)も残している。撤去した `networkSettingsSet` の `browser` が未知のキーとして断られることは `upstream-network-settings-set-retired-browser` が、撤去した `delivery` の `param` が断られることは `downstream-delivery-param-retired` が示す(D-162・D-172)。D-172 で撤去したサーフェス定義・設計図・走査・実行時の一覧・版 1 の OSC パッドのフレームの見本は消した(`packages/shared/src/wire.test.ts` が、撤去したフレームを断ることを確かめる)。実装時は `direction`、`valid`、`frame` を照合し、正しいフレームの全種類と拒否規則を本書の記述どおりに実装する。見本を読むのは TS(ブリッジの側)のテストで、全件の受理と拒否を確かめる。拒否例のうち中身(パッド・プロジェクト)の検証で拒否するものの判定はブリッジだけが行う(D-122)。ブリッジはこの形のフレームを配らないので、UI クライアントは中身の検証の写しを持たなくてよい。

## 互換性と更新順序

マニフェスト経路の撤去(D-051)で、`manifest`・`manifestRequest` フレーム、`hello` の `expectedProjectId`、`link` の `manifest` / `lastRejection` は無くなった。撤去前の UI クライアントと新しいブリッジ(またはその逆)は、未知キー・未知種別の拒否により組み合わせられない。同じく、OSC 専用のフレームを `osc.*` へ改名し `hello` に `adapters` を足した版(HID-373・D-110)と、共通のフレームをパラメータ ID の語彙へ移した版(HID-389・D-117)の前後の UI とブリッジも組み合わせられない。サーフェス定義・設計図・LAN の走査・実行時の一覧・版 1 の OSC パッドのフレームを撤去した版(HID-491・D-172)と、プロジェクトファイルを版 3 にした版(D-173)の前後も同じである(版 3 のプロジェクトファイルは撤去前のブリッジでは読めない。撤去後のブリッジは版 1・版 2 のファイルを読み、サーフェス定義を落として取り込む)。`v` は 1 のまま(ブリッジと UI は同じランチャーで一緒に起動する前提のため、版数は上げていない)。第三の UI クライアントを追加・更新する場合は、まず本書と `wire-samples.json` に合わせて UI クライアントを更新し、動作確認後にブリッジを更新する順序にする。
