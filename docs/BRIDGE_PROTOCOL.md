# ブリッジ接続仕様

この文書は、`oscdesk-bridge` と UI クライアントの間で交換する WebSocket フレームの正典である。新しい UI クライアントは、この文書と `protocol/wire-samples.json` だけを参照して実装できる。

## 前提と接続

ブリッジは Unity との OSC/UDP 通信と、UI クライアントとの WebSocket 通信を中継する。UI クライアントはブリッジの WebSocket ポートへ接続し、1 WebSocket メッセージにつき 1 個の JSON オブジェクトを送受信する。フレームはすべて UTF-8 JSON であり、配列形式や未知のキーは使用しない。

この接続には認証機構がない。`0.0.0.0` で待ち受ける構成を含むため、信頼された LAN 内だけで使用し、インターネットや信頼できないネットワークへ公開してはならない。

ただしブラウザを踏み台にした接続は塞ぐ(D-082)。ブリッジは `Origin` ヘッダ付きの WebSocket ハンドシェイク(ブラウザ発)を HTTP 403 で拒否し、`(WARN, BRIDGE)` に記録する。ブラウザは `Origin` を必ず付け、ページ側から外せない。正規の UI クライアント(NiceGUI のサーバ側の `websockets`)は付けないので影響を受けない。ブラウザから直接つなぐ第三のクライアントは対象外。

接続してよいブラウザの範囲(後述の `networkSettings` の `allowedBrowsers`、D-113)の外の送信元からは、WebSocket のハンドシェイクと HTTP を 403 で断る。範囲を狭めたときは、外になった既存の接続をコード 1008 で切る。この PC の localhost(`127.0.0.1` / `::1`)は常に通す。この許可リストは**認証の代わりではない**(送信元のアドレスで絞るだけで、同じ LAN の機器はアドレスを名乗り直せる)。信頼できる LAN 内だけで使う前提は変わらない。

### ブリッジの起動

リポジトリのルートで Node.js 20 以降と pnpm を用意し、次を実行する。

```powershell
corepack pnpm install
corepack pnpm --filter @oscdesk/bridge run build
node packages/bridge/dist/oscdesk-bridge.js --config config/oscdesk.config.json
```

保管フォルダは設定の `surfaces.dir`(既定 `surfaces`、実行時のカレントディレクトリ基準)、起動時に採用する定義は `surfaces.defaultName`(省略可)で指定する。保持値(後述の `desired`)の保存先は `surfaces.valuesDir`(省略時は `<surfaces.dir>/.values`)で、定義名ごとに `<name>.values.json` を置く(`DESIGN.md` D-058)。OSC パッド(後述の `osc.pad`)の保管先は `surfaces.padsDir`(省略時は `<surfaces.dir>/pads`)で、パッド名ごとに `<name>.json` を、採用中のパッドの名前を `.active.json` に置く(D-080)。

宛先パネル(後述の `destinations`、`DESIGN.md` D-078 / D-086)の選択の保存先は `destinations.file`(省略時は `<保持値の保存先>/.destinations.json`。先頭のドットでサーフェス名と重ならない)、LAN 走査の時間上限は `destinations.scanTimeoutMs`(1,000〜60,000、既定 8,000)、端末の名前(D-092)の保存先は `destinations.aliasesFile`(省略時は `<保持値の保存先>/.device-aliases.json`)で指定する。どれも省略できる(`"destinations"` ブロックごと省いてよい)。選択を保存していない間は `unity`(主系 + 副系)が送り先で、保存した選択はそれより優先する。

ネットワークの設定(後述の `networkSettings`、D-113)の保存先は `network.file`(省略時は `<保持値の保存先>/.network-settings.json`)で指定する(`"network"` ブロックごと省いてよい)。保存していない間は、ターゲット向けのネットワークが `bridge.oscListenHost`、ターゲットがいる範囲が自動、接続してよいブラウザがすべて(`0.0.0.0/0` と `::/0`)である。保存した設定は設定ファイルより優先する。設定ファイルへは書き戻さない。保存したターゲット向けのアドレスが起動時にこの PC に無ければ(NIC の差し替え・DHCP)、警告して `bridge.oscListenHost` で待ち受ける(ファイルは書き換えない)。

設定ファイルを省略せず、`--config` の値には `unity.host` と `unity.sendPort` を含む JSON 設定を指定する。ポートを一時的に上書きする場合は `--ws-port`、`--osc-listen-port`、`--unity-host`、`--unity-port`、`--ui-port`、`--debug` を使用できる。ブリッジは起動すると標準出力へ、次の形式の 1 行を出す。

```text
OSCDESK_BRIDGE_READY {"wsHost":"0.0.0.0","wsPort":7080,"oscListenPort":7091,"unity":{"host":"127.0.0.1","sendPort":7090},"uiHost":"0.0.0.0","uiPort":8080,"protocolVersion":1,"debug":false,"configPath":"..."}
```

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

- 共通のフレームは、パラメータ ID(UI は中身を解釈しない文字列)・型・制約・表示ヒントと、型タグを付けない JSON の値だけで書く。OSC のアドレスと型タグは、ブリッジの中の結び付け(パラメータ ID → OSC アドレス)にだけ置く。パラメータの値を変える上りの `set` がこの形である
- OSC 専用の機能(Unity との OSC の生のやり取り `osc.message`・まとめ送り `osc.batch`・送信ログ `osc.sentLog`・OSC パッド `osc.pad*`)は `osc.` で始まる `type` にする。UI は `hello.adapters` に `osc` があるときだけ、これらの機能を出す
- 共通のフレームに OSC の語(`/` で始まるアドレス・型タグ付きの引数・`args`)を混ぜない。`tests/guards/osc-vocabulary.test.ts` が `protocol/wire-samples.json` の受理される見本で検査する。定義(`surface`)・保持値(`desired`)・エコー(`echo`)・一覧(`runtimeOptions`)・行の送信(`setRow`)・まとめ送り(`batch`)・プロジェクトファイル(`project`)・設計図(`catalog`)もこの語彙で書く(HID-389・D-117。移行待ちのフレームは無い)
- 共通のフレームの中でも、通信アダプタの名前(`hello.adapters` と同じ `osc`)のキーの下は、そのアダプタ専用の欄とする(定義に添える結び付け `bindings.osc`、プロジェクトファイルの `osc.pad`・`surface.osc.spawns`)。ガードはこの下を検査しない。UI はアダプタがあるときだけこれらを使い、本体の語彙には混ぜない

### OSC 引数の型タグ

`osc.message` の `args` は、引数が 1 個でも必ず配列で、順序を保つ。各要素は次のいずれかのオブジェクトである。

| `type` | `value` | 意味 |
|---|---|---|
| `i` | number（整数） | OSC int32。−2147483648 〜 2147483647 の整数のみ受理する |
| `f` | number | 浮動小数点数 |
| `s` | string | 文字列 |
| `b` | string | blob のバイト列を base64 化した文字列（正規形の base64 のみ受理） |

blob は JSON にバイナリを直接入れず、送信時にバイト列を標準 base64（例: `AAECAw==`）へ変換し、受信時に base64 からバイト列へ戻す。`type` と `value` の対応が不正な要素（`i` の値域逸脱・小数、`b` の base64 として不正な文字列を含む）はフレーム全体を拒否する。

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

ブリッジから UI へ送る種類は次のとおりである。操作対象の定義は OscDesk 側のサーフェス定義(`surface`)で配り、値の正はブリッジが持つ(`desired`。まだ Unity へ送っていない取り込んだ値があるかは `desiredStatus`)。Unity が実行時に持つ文字列の一覧は `runtimeOptions` で、ブリッジが Unity へ送った OSC の記録は `osc.sentLog` で、OSC パッドは `osc.pad` / `osc.padList` で、送り先の選択と LAN 走査の結果は `destinations` で、書き出したプロジェクトファイルは `project` で配る。Unity からマニフェストを受け取る経路は撤去した(DESIGN.md D-051)。ターゲットから受けた UI の設計図は PC ごとに `catalog` で配り(D-101・D-104)、設計図から作った画面との突き合わせは `blueprintStatus` で配る(D-112)。操作中のロックは `locks` で配る(D-111)。ネットワークの設定は `networkSettings` で配る(D-113)。送ったものが送り先の PC に届いたかは `delivery` で配る(D-116)。

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

### `osc.message` — Unity から受信した OSC

Unity から受信した通常の OSC(主にエコーバック)を UI へ配信する。OSC 専用の生の受信で、UI の表示とまとめ送りの確認は共通のフレーム `echo`(後述)を使う。`from` は受信元の UDP ピアで、`host` は文字列、`port` は 1〜65535 の整数である。配信するのは主系のエコー(と OSC ネイティブ UI の端末の操作)だけで、副系のエコーは UI へ流さない(保持値との食い違いの警告にだけ使う)。`/sys/*` と `/oscdesk/*` は予約アドレスとして UI へ流さない。採用中の定義の一覧のアドレス(`bindings.osc.lists[].address`)と要求のアドレス(`request` のエコー)に届いたものも `osc.message` としては流さない(一覧は `runtimeOptions` で配る)。

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

### `surface` — 採用中のサーフェス定義

ブリッジが採用した定義(`DESIGN.md` の D-043・D-117、`protocol/surface-definition.schema.json`)を配る。`name` は保管名(後述の名前規則)、`revision` はブリッジが採用するたびに 1 ずつ増える正整数(ブリッジの再起動で 1 に戻る。同じ内容の再採用でも増える)、`at` は採用時刻(ISO 8601、オフセット付き)である。

- **`definition`**: 検証済みの定義の**本体**(版 2)。パラメータ ID・型・制約・表示ヒントだけで書き、OSC のアドレスを含まない。`bindings` のキーを持たない(持つフレームは不正)
- **`bindings`**: 本体に添える通信の結び付け(省略不可。アダプタが無ければ `{}`)。今は `osc` だけで、ID ごとの OSC アドレス・一覧の受け口・アクションのセレクタを持つ(後述)。UI は `hello.adapters` に `osc` があるときだけ、編集モードのアドレスの欄にこれを使う。本体の表示・操作には使わない
- **`selectors`**: アクションの `selector` step(後述)が当たるパラメータ id の一覧 `[{ "selector": "<id>", "params": ["<パラメータ id>", ...] }]`(定義順、1 件 512 まで)。UI は結び付けを見ずに `selector` の step を展開する

定義の検証に通らないフレームは UI も捨てる。

```json
{"v":1,"type":"surface","name":"stage","revision":1,"at":"2026-10-08T10:00:00.000Z",
 "definition":{"format":"oscdesk-surface","version":2,"name":"Stage",
   "parameters":[{"id":"master","label":"Master","type":"f","kind":"state","range":[0,1],"default":0.5}],
   "screens":[{"id":"main","label":"Main","children":[{"kind":"control","param":"master","widget":"slider"}]}]},
 "bindings":{"osc":{"parameters":[{"id":"master","address":"/mix/master"}]}},
 "selectors":[]}
```

#### 定義の版 2 と OSC の結び付け(`bindings.osc`、HID-389・D-117)

保存するファイル・プロジェクトファイルの定義は、本体の最上位に `bindings` を足した 1 つの JSON である(`version: 2`)。ブリッジは保存・採用の時点で `bindings.osc` を必須にする(今の通信アダプタは OSC だけで、結び付けの無い定義は送れない)。`bindings.osc` は次の配列を持つ(id をキーにしたオブジェクトにしないのは、`constructor` などの名前が JS の既定のメンバーと紛れるため)。

- `parameters`(必須): `[{ "id": "<パラメータ id>", "address": "<具体アドレス>" }]`。本体の全パラメータにちょうど 1 つずつ
- `records`(省略可): `[{ "id": "<レコード id>", "address": "<具体アドレス>" }]`。本体の全レコードにちょうど 1 つずつ
- `lists`(省略可): `[{ "id": "<一覧 id>", "address": "<具体アドレス>", "request": "<具体アドレス>"? }]`。本体の `optionsFrom.list`・`keysFrom.list` が参照する一覧にちょうど 1 つずつ。`address` は Unity が一覧を返すアドレス(`keysFrom.source: "ui"` の一覧ではブリッジが行の ID の並びを送る先)、`request` は要求を送るアドレス
- `selectors`(省略可): `[{ "id": "<セレクタ id>", "match": "<アドレスパターン>" }]`。本体のアクションの `selector` step が参照するセレクタにちょうど 1 つずつ

規則: 本体に無い id・重複した id・欠けた id の結び付けは不可。具体アドレスに `/sys/*` `/oscdesk/*` は使えない。値のアドレス(パラメータとレコード)は互いに重ねない。一覧のアドレスは一覧ごとに別で、値のアドレスと重ねない。`request` は値のアドレス・一覧のアドレスと重ねない(要求のエコーが空の一覧として届くため)。`source: "ui"` の一覧は `request` を持てない。`match` は 1 件以上のパラメータに当たり、`selector` を含むアクションの展開後の総数は 512 以下。

**版 1 の定義**(パラメータ・レコードに `address`、`optionsFrom` / `keysFrom` に `address` / `request`、アクションに `match` を直接書く形)は、ブリッジが読み込み・保存・取り込みの前に版 2 へ移す。一覧の id は `l_` + アドレスの英数字以外を `_` にしたもの(同じアドレスは同じ一覧。別のアドレスが同じ形になれば番号を付ける)、セレクタの id は `m_` + パターンを同じ規則で直したもの。同じ一覧のアドレスに別々の `request` が書かれていたら最初の `request` を使う。保管フォルダの版 1 のファイルは、読み込んだときに版 2 で書き直す(直前の内容は `.backups` へ退避)。

採用は次の契機で起き、そのたびに**全 UI へ** `surface`、続けて `surfaceList` を送る。

- 起動時に設定 `surfaces.defaultName` の定義を読み込めたとき(UI の接続前なので、UI は `surfaceRequest` で取得する)
- 上り `surfaceSave`(`activate` が `false` でない)または HTTP `PUT` で保存したとき
- 上り `surfaceLoad` で読み込んだとき

不正な定義は採用しない。直前の定義を維持し、要求した UI だけへ `notice`(`level: error`、`code: surface-rejected`、`detail` に理由)を返す。フォルダ上のファイルを手で書き換えても自動では再配信しない。反映するには `surfaceLoad` を送る。

#### アクション(`actions` と `kind: "action"`、HID-166)

定義の最上位に省略可能な `actions` 配列を持てる。アクションは「押すと複数の値をこの順に 1 つのまとめ送りで送る」ボタンの中身で、パラメータ層に置く。画面層は `{"kind":"action","action":"<id>"}` のノード(任意で `label` と `width`)で配置するだけである。展開は UI が行い、中身を上り `batch`(後述)で送る。ブリッジは 1 つの OSC bundle にして送る。

```json
"actions":[{"id":"applyAll","label":"Apply all","steps":[{"selector":"m_slot"},{"param":"apply"}]}]
```

- `steps`(1 件以上)の要素は次のどちらか。
  - `{"param":"<パラメータ id>"}` — そのパラメータ 1 件。`value` を足すと固定値を送る(`state` のみ。型・値域・`options` に収まること。`trigger` は自身の `value` を送るので上書きできない)。`value` が無ければ、`state` は UI が持つ現在値、`trigger` は定義の `value` を送る。
  - `{"selector":"<セレクタ id>"}` — 結び付けが決めるパラメータの集まりを定義順に送る(D-117)。OSC では `bindings.osc.selectors` の `match`(アドレスパターン)に合う**全パラメータ**で、`*` は 1 パート(`/` で区切られた部分)内の 0 文字以上に一致し、`?` `[]` `{}` は使えない。1 件も当たらないパターンは定義として無効。後から足したパラメータもアドレスが合えば含まれる。UI は `surface.selectors` で当たるパラメータ id を知る(版 1 の `{"match":...}` は版 2 への移行でこの形になる)。
- 展開後の総数は 512 以下(まとめ送りの上限)。超える定義は無効(`selector` の件数は結び付けで決まるので、結び付けの検証で見る)。
- 操作しても単独では送りたくないパラメータは `standalone: false` にする(部品を動かしても何も送られず、アクションを押したときだけ送られる)。ブリッジは `standalone: false` のパラメータを保持値にも再送にも含めない。
- 送信後、UI は対象の Unity からのエコー(下り `echo`)を 2 秒待つ(`state` は値が一致するもの、`trigger` は値を問わず届いたもの)。揃えば「送信しました」、揃わなければ未達の対象を挙げて警告する。再送はしない。
- 現在値がまだ無い `state`(`default` が無く未操作)は送らず、その旨を UI が警告する。
- アクションと `actions` の編集 UI は無い。JSON のアップロードかファイルの手編集で作る(パラメータの改名・削除には追従する)。

#### 実行時の候補(`optionsFrom`、HID-204)

`type: "s"` かつ `kind: "state"` のパラメータは、Unity が実行時に持つ文字列の一覧を候補として受ける宣言 `optionsFrom` を持てる(`DESIGN.md` D-053 / D-054)。一覧は定義を書き換えない「値」で、本体では一覧の id で指す(D-117)。OSC では Unity が一覧の結び付けの `address` へ `s` 引数を N 個並べた 1 メッセージで返す。

```json
{"id":"segment1","label":"Segment","type":"s","kind":"state","options":["(none)"],"default":"(none)","optionsFrom":{"list":"segments"}}
```
```json
"bindings":{"osc":{"parameters":[{"id":"segment1","address":"/member/1/segment"}],"lists":[{"id":"segments","address":"/mb/segments","request":"/mb/segments/get"}]}}
```

- `list`(必須)— 一覧の id。同じ id を指す箇所は同じ一覧を共有する。一覧が届くアドレスと要求を送るアドレス(省略時は Unity の自発送信だけを待つ)は `bindings.osc.lists` が決め、アドレスの衝突の規則も結び付けの側で見る(前述)。
- 静的な `options` は省略可。書いた場合は一覧の先頭に固定で付く候補になる。`default` とアクションの固定値は、静的な `options` に無くてもよい。
- 部品のヒント `select` は、静的な `options` が無くても `optionsFrom` があれば指定できる。
- ブリッジの保持値(`desired`)と UI の入力欄も、`optionsFrom` を持つパラメータでは静的な `options` への所属を問わない。
- ブリッジは一覧を宛先ごとに受け取り、和集合を下り `runtimeOptions` で配る(後述)。UI の選択欄への反映は HID-206、Unity の受け口は HID-207 で扱う。それまで UI は `runtimeOptions` を読み捨て、静的な `options` があればそれだけの選択欄、無ければ(`select` を指定していても)入力欄を出す。

#### レコード型パラメータ(`records` と `kind: "record"`、HID-214)

個数が実行時に変わる対象(例: メンバー)は、定義の最上位に省略可能な `records` 配列で宣言する(`DESIGN.md` D-059 / D-061)。1 行はキーとフィールドの値で、キー(行)の一覧は `keysFrom` の一覧(一覧の id で指す)の値で、定義は個数を持たない。OSC では、レコードの結び付けのアドレスへの 1 メッセージで 1 行を運び、引数は**先頭が `s` のキー**、続いてフィールドを宣言順に並べたもの(`[s:key, ...fields]`)である。

```json
"records":[
  {"id":"member","label":"メンバー","kind":"state",
   "key":{"label":"メンバー名"},
   "keysFrom":{"list":"members"},
   "fields":[
     {"id":"active","label":"Active","type":"bool","default":false},
     {"id":"slot","label":"Slot","type":"i","range":[1,64],"step":1,"default":1},
     {"id":"segment","label":"Segment","type":"s","options":["(none)"],
      "optionsFrom":{"list":"segments"},"default":"(none)"}]},
  {"id":"memberUpdate","label":"Update","kind":"trigger",
   "keysFrom":{"list":"members"},"fields":[]}],
"bindings":{"osc":{"parameters":[],
  "records":[{"id":"member","address":"/vp/member"},{"id":"memberUpdate","address":"/vp/member/update"}],
  "lists":[{"id":"members","address":"/vp/members/list","request":"/vp/members/request"},
           {"id":"segments","address":"/vp/segments/list","request":"/vp/segments/request"}]}}
```

上の `member` の 1 行は OSC で `/vp/member  s:"メンバーA"  i:1  i:3  s:"(none)"`(`bool` は D-017 どおり `i` の 0 / 1)、`memberUpdate` は `/vp/member/update  s:"メンバーA"` になる。

- **レコード**: `id`(パラメータ id と重ねない)、`label`、`kind`(`state` / `trigger`)、`key`(省略可。`{ label? }` でキーの表示名)、`keysFrom`(必須。`{ list, source?, max? }`。`source` を省くか `"unity"` なら `optionsFrom` と同じく Unity が返す一覧。`"ui"` なら UI で追加・削除し、ブリッジが追加順に保持・保存して一覧のアドレスへ `s` の並びで Unity に送る一覧で、一覧の結び付けは `request` を持てず、`max`(1〜1000)で上限を書ける。`max` は `"ui"` にだけ書ける。同じ一覧を共有するレコードは `source` と `max` を揃える。`"ui"` の一覧は `optionsFrom` に使えない。D-075)、`fields`(`state` は 1 件以上、`trigger` は 0 件以上)。キーの型は `s` だけで、型の欄は無い。`standalone` は無い。アドレスは `bindings.osc.records` が持つ
- **フィールド**: `id`(レコード内で一意)、`label`、`type`(`i` / `f` / `s` / `bool`)と、型ごとの `range` `step` `options` `optionsFrom` `default` `value`(パラメータと同じ規則。`optionsFrom` は `s` だけ)。`kind` と `standalone` は持たない
- **パラメータの表示ヒント**: パラメータは省略可能な `widget`(`slider` / `switch` / `button` / `input` / `select`)を持てる(HID-377、`DESIGN.md` D-103)。画面層の `widget` が無い control・列・自動配置の既定として使い、パラメータの型と制約に合うこと(画面層の `widget` と同じ規則)。どちらも無ければ型と制約から決める: 範囲つきの数値 → `slider`、範囲なしの数値 → `input`、`bool` → `switch`、`trigger` → `button`、`options` / `optionsFrom` つきの文字列 → `select`、それ以外 → `input`。Range は型ではなく制約(`range` / `step` / `options` / `optionsFrom`)で、送受信の形式には関与しない
  - `state` レコード: `default` 必須、`value` 不可(新しいキーの行はフィールドの `default` で作る)。`optionsFrom` を持つ `s` は `default` が静的な `options` に無くてよい
  - `trigger` レコード: `value` 必須(固定値)、`default` `range` `step` `options` `optionsFrom` 不可
- **アドレスの衝突**: 結び付けの規則(前述の「定義の版 2 と OSC の結び付け」)で見る。同じ一覧を複数の箇所で共有するのは可で、`keysFrom.list` と別の欄の `optionsFrom.list` が同じ一覧を指してもよい
- **アクション**: アクションに省略可能な `scope`(`"row"` / `"all"`)を足した。`scope` を持つアクションは `{"record":"<レコード id>","value":{"<フィールド id>":<固定値>}}` の step だけを持ち、その全レコードが同じ `keysFrom.list` を持つ。`state` レコードは行の現在値を送り、`value` に書いたフィールドだけ固定値で上書きする(値はフィールドの型・値域・`options` に収まること。`optionsFrom` を持つ `s` は所属を問わない)。`trigger` レコードはフィールドの `value` を送り、`value` は書けない。`scope` の無いアクションは `record` step を持てない。展開は UI が行い、`row` は押した行のキーについて steps を定義順に、`all` は表示中の全行について行ごとに steps を定義順に並べ(行 1 の全 step → 行 2 の全 step …)、1 つの上り `batch` で送る。`all` の件数は行数で決まるので定義では上限を見ず、展開後に 512 件 / 60 KiB を超えたら UI が送らずに通知する
- **画面層**: `{"kind":"record","record":"<レコード id>","label":?,"width":?,"columns":?,"rowActions":?,"tableActions":?}` でレコード表を置く。`columns` は `[{"field":"<フィールド id>","widget":?,"label":?,"actions":?,"toggle":?}]` で列の順序・部分集合・部品のヒント(省略時は全フィールドを定義順。同じ `field` の重複・未知の `field` は不可。`widget` はフィールドを「`kind` がレコードの `kind` のパラメータ」とみなして合うこと)。列の `actions` は表の枠内で見出しの直下(行の並びの上の一括操作の行。D-076)のその列の下に出す `scope: "all"` のアクション id で、列の一括操作(例: 全行の Active を On / Off)の置き場である(`DESIGN.md` D-066。`columns` を省略した表には置けない)。列の `toggle` は `{"label":"<共通ラベル>","on":"<アクション id>","off":"<アクション id>"}` で、同じ一括操作の行にラベルとスイッチ 1 つの一括トグルを出す(D-073。`bool` のフィールドの列に限る。表示は全行オンでオン・それ以外(全行オフ・混在)でオフ(混在は「一部オン」を添える。D-094)、操作でオンなら `on`、オフなら `off` の `scope: "all"` のアクションを送る)。`rowActions` は各行の末尾に出す `scope: "row"` のアクション id。`tableActions` は表の右側に行の並びいっぱいの縦長ボタンで出す `scope: "all"` のアクション id で、表全体の確定(例: Update All)の置き場である(D-074)。いずれも、そのアクションのレコードはこの表のレコードと同じ `keysFrom.list` を持つこと。`{"kind":"action"}` ノードは `scope: "row"` のアクションを置けない(行が決まらない)。`{"kind":"control"}` はレコード id を参照できない。行の並び順は UI の規則(キーの一覧の順 → 一覧に無いが保持値を持つキー)で、定義には書かない
- **UI で管理する行の ID と Name**(`keysFrom.source: "ui"`、`DESIGN.md` D-087): 行はブリッジが追加のときに振るランダムな ID(UUID)で指し、Name は別に持つ編集できるラベルである。行の引数は `[s:ID, s:Name, ...fields]`(`trigger` も同じ)で、以下の「キー」はこのレコードでは ID を指す。一覧のアドレスへ Unity に送る一覧は ID の並び。Name は同じ一覧の中で重複も空も不可
- **ワイヤ**: UI は行を上り `setRow`(`record`・`key`・フィールド id ごとの値。後述)で、アクションの行は上り `batch` の行の要素で送る。`state` の欄を 1 つ編集しても行の全フィールドを載せる。ブリッジは OSC の 1 行 = 1 メッセージ(`args` = `[s:key, ...fields]`。UI で管理する行は `[s:ID, s:Name, ...fields]` で、Name はブリッジが一覧から付ける)に直して送る。保持値(`desired`)は行ごとに 1 エントリ、キーの一覧と選択肢は `runtimeOptions` の `keys` / `fieldChoices`(後述)。ブリッジは `state` のレコードをキーごとに保持・再送・保存する(後述の `desired`。`DESIGN.md` D-062)。`trigger` のレコードは保持せず、通常どおり中継するだけ。UI のレコード表は HID-216、Unity の受け口は HID-217 で扱う

### `surfaceList` — 保存済み定義の一覧

保存済みの名前の一覧(昇順)と、採用中の名前(未採用なら `null`)を送る。

```json
{"v":1,"type":"surfaceList","names":["stage","stage-b"],"active":"stage"}
```

### `desired` — ブリッジが保持する狙いの値

値の「正」はブリッジが持つ(`DESIGN.md` D-045)。採用中の定義の `kind: state` のパラメータごとに、最後に UI が操作した値(未操作なら定義の `default`。`default` が無ければ値なし)を保持し、Unity のエコーでは書き換えない。

保持値はパラメータ ID と型タグを付けない JSON の値で配る(HID-389・D-117)。`values` はパラメータの `{ "param": "<id>", "value": <値> }`(`bool` は真偽、`i` / `f` は数値、`s` は文字列)、`rows` は `state` のレコードの行の `{ "record": "<レコード id>", "key": "<キー>", "values": { "<フィールド id>": <値> } }` である(UI で管理する行の `key` は行の ID。Name は `runtimeOptions` の `names`)。

- `full: true` — 保持値の全量。UI は表示中の値を丸ごと置き換える。定義の採用のたびに全 UI へ、`surfaceRequest` の応答として要求元へ(`surface`・`surfaceList` の後)送る。
- `full: false` — 変更分のみ。UI の操作(`set` / `setRow` / `batch`、OSC 専用の `osc.message` / `osc.batch`)で保持対象が更新されたとき全 UI へ送る(操作した UI 自身にも届く)。

```json
{"v":1,"type":"desired","full":true,"values":[{"param":"level","value":0.5},{"param":"on","value":true}],"rows":[]}
```

`state` のレコード(前述)の保持値は**キーごとに 1 エントリ**(`rows` の 1 要素)である。`full: true` は全パラメータと全レコードの全キーを、`full: false` は変わったキーだけを含む(`DESIGN.md` D-061 / D-062)。

- **並び**: `full: true` ではパラメータを定義順に並べた後、レコードを定義順に、各レコードの行を「行ができた順」に並べる。UI の表の行の順は UI が決める(キーの一覧の順が先。D-064)
- **行の生成**: 反映済みのキーの一覧(どの宛先から届いたものでも。後述の `runtimeOptions` の「反映」)に、まだ行の無いキーが現れると、ブリッジはフィールドの `default` で行を作り、到達可能な宛先へその行を 1 メッセージずつ送り、作った行だけの `desired`(`full: false`)を全 UI へ配る。同じ契機の `runtimeOptions` が先に届く。まだ到達していない宛先には、初回の到達・回復の再送で届く。定義の採用時に、引き継いだ一覧に行の無いキーがあれば同じく作る(この場合は採用の `full: true` に載る)。届いたが反映していない一覧のキーでは行を作らず、Unity へも送らない(`DESIGN.md` D-088)
- **保持の更新**: 上り `setRow` / `batch` / `osc.message` / `osc.batch` と OSC ネイティブ UI の中継で、レコードのアドレスに「先頭が空でない `s` のキー + フィールドの数・型が一致 + 値域・`options` に収まる(`optionsFrom` を持つ `s` は所属を問わない)」1 行が来たときだけ、そのキーの行を置き換える。合わないものは保持しないが、Unity へは通常どおり送る(パラメータと同じ)。一覧に無いキーでも正しい行なら保持する
- **一覧から消えたキー**: 行は残り、再送も続ける。キーの改名は別キーとして扱い、古いキーの行は残る(Unity の一覧から行ができるレコード。UI で管理する行は ID が変わらないので、改名しても同じ行のまま。D-087)
- **UI で管理する行の Name**: 上り `setRow` / `batch` の行は ID だけで届き、ブリッジが一覧の今の Name を付けて送る(一覧に無い ID の行は `unknown-row` で断る)。OSC 専用の `osc.message` / `osc.batch` で一覧にある ID の行が来たら、Name を一覧の今の Name に揃えてから Unity へ送り、保持する(改名の直後に古い画面が古い Name のまま送っても、今の Name で届く)。一覧に無い ID の行は Unity へは送るが保持しない
- **定義の再採用**: 同じ `id`・`address` の `state` レコードは、行ごとにフィールド単位で引き継ぐ(フィールドの `id` と型が一致し、値が値域に収まるものだけ。残りは `default`)。引き継ぎで行の中身・並びが変わった行だけを、採用時に到達可能な宛先へ送る。`id` が変わったレコード、`trigger` になったレコードの行は捨てる

```json
{"v":1,"type":"desired","full":false,"values":[],"rows":[
  {"record":"member","key":"メンバーA","values":{"active":true,"slot":3,"segment":"(none)"}}]}
```

`kind: trigger` のパラメータは保持も配信もしない(例外は生成担当の命令で生成したものの一覧。後述の「生成の記録」)。ブリッジは次の契機で保持値を Unity へ再送する(`kind: state` のみ。UI の操作とは別にブリッジが送る)。

- Unity が初めて pong を返したとき、および到達不能から回復したとき(その宛先だけへ。Unity の再起動はこの喪失→回復で検知する。ping 間隔より速い再起動は検知できないため、上り `resend` で補う)
- 定義を採用した時点で到達可能な宛先へ(採用で値が決まり直したアドレスだけ。引き継いだ値は送らない)
- 上り `resend` を受けたとき

レコードの行は、どの契機でもキーごとに 1 メッセージ(個別送信)で送る。`trigger` のレコードは再送しない。

**生成の記録(`HID-385`、`DESIGN.md` D-115)**: `trigger` は再送しないが、その例外として、生成担当の命令で「生成されて、まだ消されていないもの」の一覧はブリッジが持つ状態として扱い、送り直す。生成担当の命令は、定義のパラメータのうちアドレスが `/<パッケージ名>/<対象名>/spawn` か `/<パッケージ名>/<対象名>/destroy`(3 段)で終わる `type: "s"` の `trigger` である(受け口の生成担当の契約。`docs/UNITY_PROTOCOL.md` §3「生成の記録」・HID-382)。命令そのものは Trigger のままで、保持値(`desired`)には入らない。

- **名前の割り当て**: 上り `set` で `spawn` のパラメータに届いた値(省けば定義の `value`。例 `spark`)に、ブリッジが番号を付けて送る(`spark1`、`spark1` が埋まっていれば `spark2`)。どの PC の設計図(`catalog`)にも `/<パッケージ名>/<名前>/` で始まる項目が無く、生成の記録にも無く、直前に送った・消した名前(10 秒取っておく)でもない最小の番号を選ぶ。複数のブラウザから同時に生成しても同じ名前は出ない。値の末尾がすでに数字なら(`spark3`)、利用者が名前を指定したものとしてそのまま使う(ぶつかれば受け口が `name in use` で断り、「記録に合わせる」で直せる)。名前に空白・制御文字・`/`・`* ? [ ] { } ,`・`#` を含む値、番号を付けると 128 文字を超える値は送らずに `set-rejected`(`invalid-name: <id>`)で断る。生成の記録(4096 件まで)に全送信先の分が入らないときも送らずに `set-rejected`(`spawn-record-full: <id>`)で断る。生成担当のアドレスのパッケージ名・対象名が 128 文字を超えるなど、記録の形(`/<パッケージ名>/<対象名>/spawn`)に入らないときも送らずに `set-rejected`(`invalid-address: <id>`)で断る。振った名前は要求元へ notice `spawned`(`level:"info"`、`detail` が名前)で知らせる
- **記録**: 送り先の PC(ユニキャストの宛先はその `host`、「全てのデバイス」の宛先は pong を返したホスト)ごとに `{ param, address, name, host }` を 1 件持つ。`destroy` を送ったら送った PC の記録から外す。その PC から設計図の削除通知(`/sys/catalog/remove` で `/<パッケージ名>/<名前>/…`)が来たら、その PC の記録から外す(シーンの切り替えなど命令以外で消えた場合も含む)。送り先の一覧から外した PC の記録は消す
- **クラッシュ**: 削除通知が来ない PC の記録は残る。同じものを記録しているほかの PC から削除通知が来たとき、ping に答えていない PC の記録には「止まっている間にほかの PC で消された」印(`removedElsewhere`)を付け、その PC が起動して戻ったときに復元せずに記録から外す。印のある PC の設計図にそのものが現れたら(生きていて持っている)印を外す
- **起動の合図と復元**: Sync の要求(`/sys/catalog/request`)を送ってから 5 秒以内でない `/sys/catalog/begin` を、その送信元の PC が起動した合図として扱う(同じホストからは 5 秒に 1 回まで。新しい生成し直しを始めたら、その PC の進行中の生成し直しの残りは送らない)。合図を受けたら、その PC の記録を生成し直し(`spawn ,s 名前`。送信ログの `origin` は `resend`)、続けて保持値をその PC へ再送する(ログ `Restoring <N> spawned object(s) on <host>`)。生成し直しは生成担当ごとに 8 個ずつ 100 ms おきに送り(受け口の 1 フレームの生成数の上限に合わせる)、送り終えてから値を送る。ping の喪失→回復による再送(前述)はそのまま残る(起動の合図があれば ping の間隔より速い再起動も分かる)。取り込んだプロジェクトをまだ全宛先へ送っていない間(後述の D-090)は、合図を受けても生成も再送もしない
- **保存**: 保持値と同じファイルに `spawns` として残る(後述の保存ファイルの形式)。採用中の定義のファイルへ書き、ブリッジ起動後の最初の採用で戻す。稼働中の定義の切り替えでは記録をメモリ上のまま引き継ぐ(生成したものは画面と関係なくターゲットに残っているため)

プロジェクトファイルを取り込んだ後(後述の `projectImport`、`DESIGN.md` D-090)は、上り `resend`(`target` を省いた全宛先)を受けるまで、最初の 2 つの契機(初回の到達・回復、定義の採用)では送らない(ブリッジは `Not resending desired values ... the imported project has not been sent yet.` をログに出す)。取り込んだ値は「画面と保持値の更新」で、Unity へ送るのは利用者の明示の操作だけにするためである。この状態は `desiredStatus`(後述)で配る。宛先を絞った `resend` はその宛先へ送るが、状態は変えない。一覧の届き・反映・宛先の切り替えで新しいキーの行を作るとき(前述の「行の生成」)も、行は作って `desired` で配るが Unity へは送らない(全宛先への `resend` で届く)。一覧の要求(一覧の結び付けの `request`)も、自動の契機・上り `runtimeOptionsRefresh` のどちらでも送らず(後者は `runtime-options-refresh-rejected`、`detail:"unsent-project"` で断る)、全宛先への `resend` を受けたときに全宛先へまとめて送る。要求のアドレスは取り込んだ定義が決めるので、確かめる前に任意のアドレスを撃たせないためである。利用者の操作(上り `set` / `setRow` / `batch` / `osc.message` / `osc.batch`、`recordKeyAdd` などの行の操作)は従来どおり送る。

この状態は定義ごとで、取り込んだ定義の保存ファイルにだけ `unsentSince` として残る。同じ定義の再採用では保たれる。別の定義へ切り替えると、送っていない値は引き継がず、切り替え先の保存ファイルの値(無ければ `default`)から始め、状態は切り替え先のもの(通常は未送信でない)になる。保存ファイルに `unsentSince` のある定義を採用すると(ブリッジ起動後の最初の採用でなくても)、メモリ上の値ではなくそのファイルの値と状態を戻す。

Unity のエコーが保持値と食い違う場合も保持値は変えず、ブリッジが警告ログを 1 回出す(同じアドレスは一致に戻るまで繰り返さない。レコードは行ごとに数え、ログにキーを含める)。エコーはそのまま `echo`(と `osc.message`)として UI へ流れる。

保持値はブリッジ再起動をまたいで残る(`DESIGN.md` D-058)。ブリッジは保持値が変わったときと定義の採用のときに、定義名ごとのファイル(`surfaces.valuesDir`、省略時 `<surfaces.dir>/.values/<name>.values.json`)へ 500 ms 間引いて書き、起動後最初の採用でそのファイルを読む。採用中の定義と id・アドレス・型が一致し、値域(`range` / `options`。`optionsFrom` を持つ `s` は所属を問わない)に収まる値だけを戻し、残りは `default` から始める。戻した値は最初の `desired`(`full: true`)にそのまま載り、Unity へは上記の契機(初回の到達など)で送られる。稼働中の再採用・定義の切り替えはファイルを読まず、従来どおりメモリ上の値を引き継ぐ。ファイルが壊れていれば警告ログを出して `default` から始め、起動は止めない。フレームの形は変わらない。

レコードの行もキー単位で同じファイルに保存し、同じ時機に戻す(`DESIGN.md` D-062)。戻すのは、採用中の定義に同じ `id`・`address` の `state` レコードがある行で、フィールドは `id` と型が一致し値域に収まるものだけを戻し、残りは `default` にする。キーの一覧に無いキーの行も戻す(一覧は再起動後に届き直す)。戻した行は、一覧に現れても作り直さない。

保存ファイルの形式(`version: 5`)は次のとおり。`version: 1`(`records` の無い HID-211 の形式)、`version: 2`(UI で管理する一覧が Name の並びで、行のキーも Name だった形式)、`version: 3`(`unsentSince` の無い形式)、`version: 4`(`spawns` の無い形式)も読み、次の保存で `version: 5` に書き直す。

```json
{
  "format": "oscdesk-desired-values",
  "version": 5,
  "surface": "stage",
  "savedAt": "2026-10-14T00:00:00.000Z",
  "values": [{"id":"level","address":"/light/level","type":"f","args":[{"type":"f","value":0.5}]}],
  "records": [
    {"id":"member","address":"/vp/member","key":"メンバーA",
     "fields":[{"id":"active","type":"bool","arg":{"type":"i","value":1}},
               {"id":"slot","type":"i","arg":{"type":"i","value":3}}]}
  ]
}
```

- `records` は行ごとに 1 件(キーごとにまとめない)。`fields` はフィールドを `id`・型・引数 1 個で持ち、位置では照合しない(定義でフィールドを並べ替えても戻せる)
- `keyLists`(省略可)は UI で管理する一覧(D-075)ごとに `{ "address": keysFrom.address, "rows": [{ "id": 行の ID, "name": Name }] }` を追加順に持つ。UI で管理する行の `records` の `key` は ID(D-087)。使う一覧が無ければ書かない
- `version: 2` の `keyLists` は `{ "address", "keys": [Name...] }` で、`records` の `key` も Name だった。ブリッジは採用のときに一覧の行へ ID を振り、その一覧を共有する `state` レコードの行のキーを Name から ID へ付け替えてから戻す(値は引き継がれる)
- `unsentSince`(省略可、`version: 4`。D-090)は、その定義に取り込んだプロジェクトの値をまだ全宛先へ送っていないときの取り込んだ時刻(ISO 8601)。取り込んだ定義のファイルにだけ書く。あれば、その定義を採用したとき(ブリッジの再起動後の最初の採用でも、稼働中の切り替えでも)そのファイルの値を戻して自動の再送を止める。全宛先への `resend` の後は書かない
- `spawns`(省略可、`version: 5`。HID-385・D-115)は生成の記録で、送り先の PC ごとに `{ "param", "address", "name", "host", "removedElsewhere"? }` を 1 件持つ(前述の「生成の記録」)。`removedElsewhere: true` は止まっている間にほかの PC で消された印。記録が無ければ書かない
- 引数は `i`(int32)・`f`(有限)・`s` だけで、blob は受けない。未知のキー・版は「壊れたファイル」として扱う

### `echo` — ターゲットが返したエコー(HID-389・D-117)

主系のターゲットが返したエコー(届いたことの確認)を、パラメータ ID の語彙で全 UI へ配る。UI はこれで表示を更新し、まとめ送りの到着を確かめる(保持値は書き換えない。D-045)。副系のエコー・OSC ネイティブ UI の端末の操作・採用中の定義に当たらない受信は載せない。

- `values` — パラメータの `{ "param": "<id>", "value"?: <値> }`。`value` は受けた値がパラメータの型として読めたときだけ付く(`bool` は `i` / `f` の 0 / 1)。`trigger` の到着の確認は値を問わないので、値の読めない受信も `value` 無しで載る
- `rows` — レコードの行 `{ "record", "key", "values" }`(`desired` の `rows` と同じ形)。定義どおりの形の行(キー・フィールドの数と型・値域)だけを載せ、合わない行は捨てる

1 回の受信につき 1 フレーム。どのアドレスで届いたかは載せない(OSC 専用の `osc.message` で見る)。

```json
{"v":1,"type":"echo","values":[{"param":"level","value":0.5},{"param":"go"}],
 "rows":[{"record":"member","key":"メンバーA","values":{"active":true,"slot":3,"ip":"192.168.0.21","segment":"(none)"}}]}
```

### `runtimeOptions` — Unity が実行時に持つ文字列の一覧

採用中の定義の `optionsFrom`(前述)に Unity が返した一覧を配る(`DESIGN.md` D-053 / D-055)。毎回全量で、UI は丸ごと置き換える。一覧は一覧の id(`optionsFrom.list`・`keysFrom.list`)で指す(HID-389)。アドレスは載せない。

ブリッジは一覧を「届いた一覧」と「反映済みの一覧」に分けて持つ(`DESIGN.md` D-088)。`lists`・`choices`・`keys`・`fieldChoices` はすべて反映済みの一覧から作り、届いた一覧が反映済みの一覧と食い違う間は、その出所を `pending` に載せる。収録に使っていない PC で誤って起動した Unity が一覧を返しても、操作者が反映するまで画面の行と選択肢が変わらないようにするためである。

```json
{"v":1,"type":"runtimeOptions",
 "lists":[{"list":"segments","targets":[
   {"name":"unity","options":["Intro","Song A"]},
   {"name":"backup","options":["Song A","Song B"]}]}],
 "choices":[{"param":"segment1","options":["(none)","Intro","Song A","Song B"]}]}
```

- `lists` — 定義が参照する一覧ごとに 1 件 `{ "list": "<一覧 id>", "targets" }`(定義順)。`targets` は反映済みの一覧がある宛先だけを `hello.targets` の順に並べ、まだ無い宛先は含まない(空の `targets` は「まだ届いていない」、空の `options` は「その台には名前が無い」)。宛先ごとの一覧は、Unity が返した順のまま(重複も含めて)載せる。ブロードキャストの宛先(D-079)で複数のホストの一覧を反映していれば、その宛先の `options` はホストの一覧の和集合(最初に届いたホストの順、重複を除く)になる。
- `choices` — `optionsFrom` を持つパラメータごとに 1 件(定義順、`param` はパラメータの `id`)。選択肢は、静的な `options` → 主系の一覧の順 → 副系にしか無い名前を `hello.targets` の順に続けたもので、重複は除く。UI はこれをそのまま選択欄の候補にする。
- `keys`(省略可、HID-214)— `keysFrom` を持つ全レコードごとに 1 件 `{ "record": <レコード id>, "keys": [<キー>...] }`(定義順)。キーは主系の一覧の順 → 副系にしか無い名前を `hello.targets` の順に続けた和集合で、重複と空文字を除く。一覧が未着なら `keys: []`。`keysFrom.source: "ui"` のレコードは、`keys` が追加順の行の ID で、同じ並び・同じ数の `names`(Name)を足す(D-087。`{ "record": "mb", "keys": ["<ID>"...], "names": ["MB 1"...] }`)。`names` はそれ以外のレコードには付かない
- `fieldChoices`(省略可、HID-214)— `optionsFrom` を持つレコードのフィールドごとに 1 件 `{ "record", "field", "options" }`(定義順)。順序の規則は `choices` と同じ。
- `keys` と `fieldChoices` はブリッジが常に送る(レコードが無ければ空の配列)。UI は欄が無ければ空として扱う。`lists` には `keysFrom` の一覧も含める(一覧の id 単位で、`optionsFrom` と同じ一覧を指していれば 1 件にまとまる。宛先ごとの一覧は空文字も含めて届いたまま載せ、`keys` からだけ空文字を除く)。
- `pending`(省略可、D-088)— 届いたが反映していない一覧。届いた一覧と反映済みの一覧が食い違う出所ごとに 1 件 `{ "list", "target", "host"?, "added", "removed" }` を、一覧の定義順 → `hello.targets` の順 → (ブロードキャストの宛先では)ホストが最初に答えた順に並べる。`host` はブロードキャストの宛先でだけ付き、一覧を返したホスト。`added` / `removed` は反映済みの一覧から見た名前の増減(重複を除き、届いた一覧・反映済みの一覧の順)で、両方が空なら並びだけが違う。食い違いが無ければ空の配列。ブリッジは常に送り、UI は欄が無ければ空として扱う。
- キーの一覧は `optionsFrom` の一覧と同じ仕組み(下記の受け取り・保持・反映・送る契機・要求)で扱う。キーの一覧の反映で新しい行ができたときは、この `runtimeOptions` に続けて作った行の `desired`(`full: false`)が届く(前述)。

```json
{"v":1,"type":"runtimeOptions",
 "lists":[{"list":"members","targets":[{"name":"unity","options":["メンバーA","メンバーB"]}]},
          {"list":"segments","targets":[]}],
 "choices":[],
 "keys":[{"record":"member","keys":["メンバーA","メンバーB"]},{"record":"memberUpdate","keys":["メンバーA","メンバーB"]}],
 "fieldChoices":[{"record":"member","field":"segment","options":["(none)"]}]}
```

- **受け取り**: ブリッジは一覧の結び付けのアドレス(`bindings.osc.lists[].address`)に届いた 1 メッセージを、その出所の届いた一覧として置き換える。出所は宛先で、ブロードキャストの宛先(D-079)では一覧を返したホストごとに分けて持つ(同じ宛先名で複数のホストが答えても、後から届いた方が上書きしない)。引数はすべて `s` で、0 個(空の一覧)も可。`s` 以外を含むメッセージは捨てて警告ログを 1 回出す。Unity の宛先以外(OSC ネイティブ UI の端末など)から届いたものは受けない。副系から届いた一覧も受ける。
- **反映**: その宛先にまだ反映済みの一覧が無い(ブリッジ起動後・宛先の追加後・定義で一覧のアドレスが新しく現れた後の最初の一覧)ときは、届いた一覧をそのまま反映する(初報)。初報の判定は宛先ごとで、ブロードキャストの宛先に後から答えたホストの一覧は初報として扱わない。それ以外の変化は届いた一覧に入るだけで、上り `runtimeOptionsApply`(後述)を受けるまで反映しない(`pending` に載り、ブリッジは `Holding option list ... until it is applied from the UI.` をログに出す)。届いた一覧が反映済みの一覧に戻れば `pending` から消える。宛先の差し替え(D-078)は、外した宛先と別の宛先に差し替えた同じ名前の宛先の一覧(届いた一覧も反映済みの一覧も)を捨ててすぐ配り直し、その宛先の次の一覧は初報として反映する。
- **保持**: 到達不能になった台の一覧は最後に受けたものを残す。定義の再採用では、参照が残るアドレスの一覧(届いた一覧と反映済みの一覧)を引き継ぎ、参照が消えたアドレスの一覧は捨てる。ブリッジ再起動では保存しない(反映済みの一覧も起動のたびに初報から始める)。
- **送る契機**: Unity から届いた一覧で、反映済みの一覧か反映待ちの状態(`pending`)が変わったとき(同じ一覧の繰り返しでは送らない)、`runtimeOptionsApply` で反映済みの一覧が変わったとき、宛先の差し替えで中身が変わったとき、定義を採用したとき(`desired` の後。中身が変わっていなくても送る)に全 UI へ。`surfaceRequest` の応答として要求元へ(`desired` の後)。定義が無いときは送らない。
- **要求**: ブリッジは一覧の結び付けの `request` へ引数なしの OSC を送る。契機は、その宛先が初めて pong を返したとき、喪失から回復したとき(その宛先だけ)、到達可能な状態で定義を採用し新しい一覧のアドレスか要求のアドレスが増えたとき(到達可能な宛先)、上り `runtimeOptionsRefresh` を受けたとき(全宛先。`list` 付きならその一覧の要求だけ)。`request` の無い一覧は Unity の自発送信を待つだけで、いつ届いても受ける。
- 保持値(`desired`)は一覧に左右されない。一覧に無い名前も保持し、一覧から消えた名前も再送し続ける。
- 一覧のアドレスは Unity から OscDesk への向きだけで使う。共通のフレームでは一覧のアドレスへ送れない(値のアドレスと重ねられないため)。OSC 専用の上り `osc.message` で一覧のアドレスへ送っても Unity へは送らず(警告ログのみ)、それを含む `osc.batch` は `batch-rejected` で拒否する。

### `osc.sentLog` — Unity へ送った OSC の記録

ブリッジが Unity へ実際に送った OSC の直近の記録を配る(`DESIGN.md` D-067)。UI はこれを表示するだけで、保持値にも確認にも使わない。完全な証跡は debug 起動時の NDJSON 診断ログ(`logs/diagnostics/*.ndjson`、D-031)であり、この記録はブリッジのメモリにだけある揮発する窓である(ブリッジ再起動で消え、`seq` は 1 に戻る)。

```json
{"v":1,"type":"osc.sentLog","full":false,"records":[
  {"seq":41,"at":"2026-10-14T10:00:00.250Z","origin":"ui","targets":["unity","backup"],
   "address":"/mix/master","args":[{"type":"f","value":0.75}],"count":12,"batch":null,"clipped":false},
  {"seq":42,"at":"2026-10-14T10:00:01.000Z","origin":"action","targets":["unity"],
   "address":"/slot/01","args":[{"type":"f","value":0.25}],"count":1,"batch":{"id":3,"index":0,"size":2},"clipped":false}]}
```

- **記録の単位**: 1 メッセージにつき 1 件。全宛先へ同じものを送った場合は 1 件にまとめ、`targets` に送った宛先の名前(`hello.targets[].name`)を並べる。宛先ごとに送る再送・行の生成・一覧の要求は、宛先ごとに 1 件になる
- **`origin`**(送った契機): `ui`(上り `set` / `setRow` / `osc.message`)、`action`(上り `batch` / `osc.batch`)、`resend`(保持値の再送。初回到達・回復・定義の採用・上り `resend`)、`row`(キーの一覧に現れた新しい行)、`request`(一覧の結び付けの `request` への要求)、`relay`(OSC ネイティブ UI の中継)、`pad`(上り `osc.padPress`。OSC パッドの押下)。`/sys/ping` と、要求元へ直接返す `/oscdesk/*` の応答は記録しない
- **`seq`**: ブリッジの起動ごとに 1 から振る正整数。**`at`**: 最後に送った時刻(ISO 8601、オフセット付き)
- **`count`**(間引き): `ui` と `relay` で(`pad` はまとめない。押した 1 回ずつを時刻つきで残す)、直前の記録と同じ契機・宛先・アドレス(レコードは先頭の `s` のキーも同じ)への送信が、その記録の最初の送信から 1,000 ms 以内に続いたときは、新しい記録を作らずに直前の記録の `count` を増やし、`at` と `args` を最後の送信のものにする。更新した記録は**同じ `seq` のまま**届き直す
- **`batch`**: まとめ送り(`batch` / `osc.batch`)の各メッセージは `{ id, index, size }`(`id` はバッチごとに 1 から振る番号、`index` はバッチ内の 0 始まりの位置、`size` はバッチのメッセージ数)。それ以外は `null`(省略しない)。`targets` は bundle を送れた宛先(主系 + 送れた副系)
- **`clipped`**: 表示用に引数を切り詰めたとき `true`。`s` は 120 文字、`b` は先頭 32 バイト、引数は先頭 16 個まで。有限でない `f`(NaN など)は JSON で表せないため `s` の文字列にして `clipped: true` にする
- **配る契機**:
  - 接続直後、`hello`・`link` の後に、その UI だけへ保持している全量を送る。先頭のフレームが `full: true` で、UI は手元の記録を捨ててこれで置き換える。続きのフレームは `full: false`。記録が無くても `full: true` の空のフレームを 1 つ送る(ブリッジ再起動後の再接続で古い記録を捨てさせるため)
  - 送信のたびには送らず、新しい記録と更新した記録を **250 ms ごとに**まとめて全 UI へ `full: false` で送る。UI は `seq` をキーに追加・置き換えする
- **上限**: ブリッジは直近 **1,000 件**を保持し、古いものから捨てる(捨てた記録は配らない)。1 フレームは **100 件**まで(超える分は複数のフレームに分ける)。UI の WebSocket クライアントの受信上限(Python `websockets` の既定 1 MiB)に十分収めるため

### `destinations` — 送り先の選択と LAN 走査の結果

UI の宛先パネル(`DESIGN.md` D-078 / D-079 / D-085 / D-086)のための全量。定義に依存しないので、接続直後(`hello`・`link`・`osc.sentLog` の後)にその UI へ送り、以後は走査の開始・終了、選択の変更、ブロードキャストへ新しいホストが pong を返したとき(`primaryHosts` が変わる)に全 UI へ送る。UI は丸ごと置き換える。

```json
{"v":1,"type":"destinations","sendPort":7090,"scanning":false,"scannedAt":"2026-10-18T10:00:00.000Z",
 "devices":[
   {"host":"192.168.1.10","hostname":"control-pc","alias":null,"mac":"aa:bb:cc:dd:ee:0a","interface":"Ethernet","self":true,"configured":false,"found":true},
   {"host":"192.168.1.20","hostname":"unity-main","alias":"Unity 本番機","mac":"aa:bb:cc:dd:ee:14","interface":"Ethernet","self":false,"configured":true,"found":true}],
 "broadcasts":[{"address":"192.168.1.255","interface":"Ethernet","network":"192.168.1.0/24"}],
 "selection":{"source":"saved","allDevices":false,"networks":[],"hosts":["192.168.1.20"]},
 "targets":[{"name":"unity","host":"192.168.1.20","sendPort":7090,"primary":true,"broadcast":false}],
 "primaryHosts":["192.168.1.20"]}
```

- **`sendPort`**: 走査で見つけた端末とブロードキャストへ送るポート(`unity.sendPort`)
- **`scanning`** / **`scannedAt`**: 走査中か / 最後に走査が終わった時刻(未走査なら `null`)。走査は同時に 1 本だけで、時間上限(`destinations.scanTimeoutMs`)を超えたら走査そのもの(送信・待ち・`arp`)を中断して直前の一覧を残し、`notice`(`level:"warn"`、`code:"destinations-scan-failed"`)を全 UI へ送る
- **`devices`**: 一覧に並べる端末。直近の走査で見つかった端末(`found: true`)に、この PC(`self`)、設定の宛先(`configured`)、選択中のホストを足し、IPv4 の順(ホスト名はその後ろ)に並べる。前回の走査にあって今回見つからなかった端末は消える(設定の宛先・選択中のものは `found: false` で残る)。`mac` は ARP 表から取れたときだけ(この PC は OS が教えた NIC の MAC。直近の走査に出なかった端末は最後に分かった MAC。D-092)。`alias` は UI から付けた端末の名前(1〜64 文字。無ければ `null`。省略しない。`destinationsAlias`、D-092)で、UI は `hostname` より優先して見せる。`interface` はその端末がいるネットワークのインタフェース名(分からなければ `null`)。`hostname` は端末の名前(1〜253 文字。引けなければ `null`。D-085): この PC は OS のホスト名、ほかの端末は走査の後にブリッジが引いた名前で、まず DNS の逆引き(PTR。ルーターの DHCP や社内 DNS が答える)を全端末に並列で(1 台 1 秒まで)、引けなかった端末だけ OS の名前解決(`getnameinfo`。Windows では NetBIOS・LLMNR・mDNS も引く)を 1 台ずつ引く。合わせて 3 秒で打ち切り、その間は `scanning: true` のまま。引き終わらなかった端末は前回の名前を残す。数値のままの答えと `localhost` は名前とみなさない。名前が引けなくても走査は失敗にしない
- **`broadcasts`**: 「全てのデバイス」で送るブロードキャストアドレス(IPv4 の外部インタフェースごと。実際のネットワークのもの)。空なら「全てのデバイス」は選べない。`network`(CIDR 表記)は、ネットワークごとの「全てのデバイス」(`selection.networks`)で選ぶときの名前にもなる
- **`selection`**: `source` は `config`(選択していない。`networks` は空、`hosts` は設定の宛先のホスト)/ `saved`(保存した選択)/ `unsaved`(選択は効いているが `destinations.file` へ書けなかった。ブリッジを再起動すると失われる)。`networks` はネットワークごとの「全てのデバイス」で選んだネットワーク(`broadcasts` の `network`)。`allDevices` が `true` の間も `networks` と `hosts` は外したときに戻す選択として持つ
- **`targets`**: 実際に送っている宛先。`hello.targets` と同じ形に `broadcast`(ブロードキャストアドレスの宛先か)を足したもの。主系が先頭で 1 件以上ある。宛先が変わると `link` も全 UI へ送り直す(`hello` は送り直さない。UI は主系をここから取る)
- **`primaryHosts`**: ブリッジが主系の Unity とみなす送信元ホスト(主系の `host`、名前解決したアドレス、主系がこの PC(この PC の LAN アドレス、またはそこへ解決されるホスト名)ならループバック `127.0.0.1`、主系がブロードキャストならそこへ pong を返したホスト)。UI はエコーの出所をこれで判定する(主系がブロードキャストやこの PC のときは、`host` とエコーの送信元が一致しないため)

**走査の方法**(ブリッジの PC 上): IPv4 の外部インタフェース(ループバック・リンクローカル 169.254/16・/31・/32 を除く、最大 4 つ)ごとに、自分のアドレスを含む /24 まで(/24 より広いネットワークは /24 に絞る)の全アドレスへ空の UDP データグラム(discard ポート 9)を送り、OS の ARP 解決で埋まった ARP 表(`arp -a`、無ければ `/proc/net/arp`)を読む。ICMP は使わない(権限が要り、Windows の既定の防火壁は ping に応答しない)。1 回およそ 3 秒で、続く端末名の問い合わせ(`devices` の `hostname`)に最大 3 秒かかる。名前の問い合わせは LAN の DNS サーバー(逆引き)と各端末(NetBIOS 等)へ届く。走査もブロードキャストも、認証の無いこの接続を使う誰でも起こせる。信頼できる LAN の中だけで使い、インターネットや信頼できないネットワークへ公開してはならない。

### `osc.pad` — 採用中の OSC パッド

OSC パッド(`DESIGN.md` D-080)は、サーフェス定義とは別に、ユーザーが自由にアドレスと引数を書いて撃つボタンの格子である。収録回ごとに違う特殊な Unity 実装を発火させる用途で、名前付きで保存・切り替える。正はブリッジが持ち、サーフェス定義の採用とは独立に採用される。`name` は保管名(`surface` と同じ名前の規則)、`revision` は採用のたびに 1 ずつ増える正整数(ブリッジの再起動で 1 に戻る)、`version` は採用ごとに一意な版の印(1〜64 文字の文字列。起動ごとのランダムなエポックと `revision` の組で、ブリッジの再起動をまたいでも重ならない。中身の形は UI が解釈しない)、`at` は採用時刻、`pad` は検証済みのパッドである。パッドの検証に通らないフレームは UI も捨てる。

```json
{"v":1,"type":"osc.pad","name":"take-03","revision":2,"version":"3f9a1c0b7e2d-2","at":"2026-10-18T10:00:00.000Z","pad":{
  "format":"oscdesk-pad","version":1,"rows":2,"columns":4,"buttons":[
    {"id":"b1","row":0,"column":0,"label":"Fire","color":"#E53935","address":"/fx/fire",
     "args":[{"type":"i","value":1},{"type":"s","value":"メンバーA"}]},
    {"id":"b2","row":1,"column":3,"label":"Next","address":"/scene/next","args":[]}]}}
```

- **パッド**: `format`(`"oscdesk-pad"`)・`version`(`1`)・`rows` / `columns`(1〜12)・`buttons`(144 個まで)。未知のキーは不可
- **ボタン**: `id`(英字始まりの `[A-Za-z0-9_-]` 64 文字以内、パッド内で一意)、`row` / `column`(0 始まりのマス。格子の外と重なりは不可)、`label`(64 文字まで。空でもよい)、`color`(省略可。`#rrggbb`)、`image`(省略可。`data:image/png|jpeg|gif|webp;base64,...` の data URL で、1 枚 256 KiB・パッド全体 4 MiB まで。SVG は不可)、`address`(256 文字まで、NUL 不可。サーフェス定義のパラメータと同じ具体アドレスの規則。`/sys/*`・`/oscdesk/*`・パターン文字・空白・空パート・末尾 `/` は不可)、`args`(16 個まで。`i`(int32)/ `f`(float32 へ丸めて有限な数。`1e300` のように float32 では +Inf になる値は不可)/ `s`(1,024 文字まで。NUL は不可)だけ。OSC 1.0 の `T` / `F` は wire に無く、bool は `i` の 0 / 1 で書く)
- **大きさ**: パッドの JSON(区切りの空白なし、UTF-8)は 8 MiB まで。`osc.pad` フレームは全 UI へ配り、UI の受信上限は 16 MiB なので、超えるパッドは保存も採用もしない(`pad-rejected`)。起動時に復元しようとした採用中のパッドが超えていれば、採用せずに警告ログを出す(UI が受け切れないフレームで切断・再接続を繰り返さないように)。この上限はフレームの形式の検査には含めず、保存の正を持つブリッジだけが判定する
- 判定の正典は `packages/shared/src/osc-pad.ts`(zod)で、`protocol/osc-pad-samples.json` を TypeScript と Python の双方のテストが読んで判定の一致を確かめる

採用は次の契機で起き、そのたびに**全 UI へ** `osc.pad`、続けて `osc.padList` を送る。

- 起動時に、前回採用していたパッド(`.active.json`)を読み込めたとき(UI の接続前なので、UI は `osc.padRequest` で取得する)
- 上り `osc.padSave` で保存したとき、上り `osc.padLoad` で読み込んだとき(どちらも `.active.json` を書き換え、ブリッジ再起動後も同じパッドを採用する)

不正なパッドは採用しない。直前のパッドを維持し、要求した UI だけへ `notice`(`level: error`、`code: pad-rejected`、`detail` に理由)を返す。保存は `surfaceSave` と同じく直前の内容を `<padsDir>/.backups/` へ退避してから置き換える(名前ごとに直近 20 件)。

### `osc.padList` — 保存済みパッドの一覧

保存済みの名前の一覧(昇順)と、採用中の名前(未採用なら `null`)を送る。

```json
{"v":1,"type":"osc.padList","names":["take-02","take-03"],"active":"take-03"}
```

### `project` — 書き出したプロジェクトファイル

上り `projectExport`(後述)の応答として、要求元だけへ送る(`DESIGN.md` D-090)。`requestId` は要求の `requestId` をそのまま返す(UI のプロセスは 1 本の接続で複数のページを抱えるので、どのページの書き出しかを UI が引き当てる)。`project` はプロジェクトファイルの中身で、UI はこれをそのままファイルとしてダウンロードさせる。

```json
{"v":1,"type":"project","requestId":"page-1-3","project":{
  "format":"oscdesk-project","version":2,"exportedAt":"2026-10-28T10:00:00.000Z",
  "surface":{"name":"stage",
             "definition":{"format":"oscdesk-surface","version":2,"name":"Stage",
               "parameters":[{"id":"level","label":"Level","type":"f","kind":"state","range":[0,1],"default":0.5}],"screens":[],
               "bindings":{"osc":{"parameters":[{"id":"level","address":"/light/level"}]}}},
             "values":{"values":[{"param":"level","value":0.875}],"rows":[]},
             "osc":{"spawns":[]}},
  "osc":{"pad":{"name":"take-03","pad":{"format":"oscdesk-pad","version":1,"rows":1,"columns":1,"buttons":[]}}}}}
```

- **プロジェクトファイル**(版 2。HID-389・D-117): `format`(`"oscdesk-project"`)・`version`(`2`)・`exportedAt`(書き出した時刻、ISO 8601)・`surface`・省略可の `osc`。未知のキーは不可。判定の正典は `packages/shared/src/project-file.ts`(zod)
- **`surface`**: 採用中の定義の保管名 `name`・定義 `definition`(結び付け `bindings.osc` を含む定義の全体。`surface` と同じ検証で、`bindings.osc` は必須)・保持値 `values`・省略可の `osc`。採用中の定義が無ければ `null`。`values` はパラメータ ID と JSON の値で書き、`values`(`[{ param, value }]`)/ `rows`(`[{ record, key, values }]`。`desired` の `rows` と同じ形)/ 省略可の `keyLists`(UI で管理する一覧 `[{ list: "<一覧 id>", rows: [{ id, name }] }]`)で、UI で管理する行(ID と Name)・Unity の一覧から行ができるレコードの行(一覧に無いキーの行も)を含む。届いた一覧・反映済みの一覧(`runtimeOptions`)は含まない。`surface.osc.spawns` は生成の記録(HID-385、4096 件まで。生成担当の OSC のアドレスで持つ)。取り込みでは、定義に無い id・型の合わない値を落とす(保存ファイルからの復元と同じく `default` に戻る)
- **`osc.pad`**: 採用中のパッドの保管名 `name` とパッド `pad`(`osc.pad` フレームと同じ検証)。採用中のパッドが無ければ `null`。OSC 専用のものなので `osc` の欄に置く
- `surface` と `osc.pad` の少なくとも一方を持つ。JSON(区切りの空白なし、UTF-8)は 12 MiB まで
- **版 1 のファイル**(`version: 1`。`surface.definition` が版 1 の定義、`surface.values` が保持値の保存ファイルと同じ OSC のアドレスで書いた `values` / `records` / `keyLists` / `spawns`、最上位に `pad`)も取り込める。定義は版 2 へ移し(前述)、保持値はそのまま使う。書き出しは常に版 2
- `surface.values` の上限(取り込みのときだけ。保存ファイルの読み込みには掛けない): `keyLists[].rows` は 1 一覧 1000 行まで、`rows`(版 1 は `records`)と、UI で管理する一覧の行を一覧を共有する `state` レコードへ展開した行の合計は 2 万行まで、展開後の `desired`(`full: true`)の見積もりは 8 MiB まで。見積もりは採用後の行(UI で管理する一覧の行は一覧を共有する `state` レコードごと、Unity の一覧から行ができるレコードはファイルの行ごとに 1 行。同じ行は二重に数えない)を、フィールドはファイルの値と `default` の大きいほう(欠けたフィールドは採用で `default` に補われる)で数える。`runtimeOptions` の `keys` / `names`(UI で管理する一覧を参照するレコードごとに一覧の ID と Name を複製する。`trigger` のレコードも含む)の見積もりも 8 MiB まで。超えるプロジェクトは `project-import-rejected`(`invalid: surface.values: ...`)。書き出しにも同じ検査を掛ける

### `desiredStatus` — まだ Unity へ送っていない取り込んだ値

採用中の定義の保持値(取り込んだプロジェクトの値)をまだ全宛先へ送っていないかを配る(D-090)。`unsent` が `true` の間は `since` に取り込んだ時刻(ISO 8601)が入り、ブリッジは保持値の自動の再送を止めている(前述の `desired`)。`false` のときは `since` が `null`(省略しない)。定義の採用のたび(取り込みを含む)と、全宛先への `resend` で `unsent` が `false` に戻ったときに全 UI へ、`surfaceRequest` の応答として要求元へ(定義があれば `runtimeOptions` の後)送る。`surfaceRequest` には定義が無くても必ず答える(再接続した UI が古い表示を残さないため)。

```json
{"v":1,"type":"desiredStatus","unsent":true,"since":"2026-10-28T10:00:00.000Z"}
```

### `catalog` — ターゲットから受けた設計図(D-104)

```json
{ "v": 1, "type": "catalog", "pcs": [
  { "host": "192.168.0.11", "name": "PC1", "receivedAt": "2026-11-01T10:00:00.000Z", "verified": true,
    "items": [ { "param": "p_avatar_blend_smile", "kind": "state", "type": "f",
                 "props": [ { "key": "min", "value": 0 }, { "key": "label", "value": "Smile" } ] } ] } ] }
```

- 全量を毎回送る(UI は丸ごと置き換える)。接続時と、設計図が変わったとき(短い間引き付き)に届く。`pcs` は取得元のホストごとで、最初に受けた順
- `verified` は要約値(件数と CRC32。`docs/UNITY_PROTOCOL.md`)の照合結果。`true` = 一致、`false` = 食い違い(UI は赤く示し、人が Sync で取り直す)、`null` = まだ照合していない。UI は `false` の PC の `host` と同じ host の送信先パネルのブロックを、`false` になったときに 1 回赤く点灯し(`delivery` の `failed` と同じ点灯と退色)、`false` の間は枠を赤くする(D-118)。照合の結果は `delivery` には載せない
- 項目はブリッジが受け取った時点でパラメータの語彙に直して配る(HID-389・D-117)。`param` は設計図から作る画面(D-112)のパラメータ id と同じ作り方(アドレスの順に `p_` + アドレスの英数字以外を `_` に。重なれば番号)で、どのアドレスで届いたかは載せない
- `props` は制約・表示ヒント・ラベルなどのキーと値の組で、値は型タグを付けない数値か文字列(OSC では `i` / `f` / `s` で届く。`b` は無い)。同じキーが並んでよく、知らないキーは UI が無視する。`kind` / `type` は知らない値も保持される
- 食い違いのときは `notice`(`level: warn`、`code: catalog-mismatch`)も 1 回届く

### `blueprintStatus` — 採用中の画面と設計図の突き合わせ(HID-386・D-112)

設計図から作った画面(名前が `blueprint-<PC 名>`)を採用している間、`pc` にその設計図の PC(`host`・`name`)を、`absent` にその PC の設計図に無いパラメータの id を載せる。UI は `absent` の部品を消さずに薄くし、「この PC には無い」を出す。それ以外の画面では `pc` が `null` で `absent` は空。接続時と、変わったとき(設計図の更新・画面の採用)に送る。

```json
{"v":1,"type":"blueprintStatus","pc":{"host":"192.168.1.20","name":"PC1"},"absent":["p_fx_light_level"]}
```

### `locks` — 操作中のロックの全量(HID-378・D-111)

接続時と、ロックが付いた・外れた・持ち主の表示名が変わったときに全 UI へ送る(延長だけでは送らない)。UI は丸ごと置き換える。`clientId` と `holder` が自分(`hello.clientId` とページの `holder`)でないロックの部品を、UI は無効にして「操作中: <label>」を出す。

```json
{"v":1,"type":"locks","locks":[{"ref":{"param":"master"},"clientId":"ui-1","holder":"page-7f3a","label":"192.168.1.10"}]}
```

### `networkSettings` — ネットワークの設定

`DESIGN.md` D-113。サーバーが使うネットワーク(ターゲット向け)・ターゲットがいる範囲・接続してよいブラウザの範囲を配る。接続時(`destinations` の後)に要求元へ、`networkSettingsSet` で変わったときに全 UI へ、変更を断ったときに要求元へ、毎回全量を送る(UI は丸ごと置き換える)。

- **`targetInterface`**: Unity との OSC の送受信に使うこの PC の IPv4 アドレス。`null` はすべてのネットワーク(`0.0.0.0`)。ブラウザ向けの待ち受け(UI の HTTP とブリッジの WebSocket)は常にすべてのネットワークで、この設定に左右されない。そのため、これを変えても操作しているブラウザの接続は切れない。特定のアドレスで待ち受けると、そのアドレス以外へ届いた応答(同じ PC の Unity が `127.0.0.1` へ返す pong・エコーなど)は受けない
- **`targetRanges`**: ターゲットがいる範囲(IPv4 の CIDR、最大 8 件)。空なら自動(この PC のネットワークそのまま)。宛先パネル(`destinations`)の走査と端末の一覧と個別に選べるホストを、範囲が重なるこの PC のネットワークの中の範囲に絞る。ネットワーク(`broadcasts`)とブロードキャストアドレスは NIC のもののまま(ブロードキャストは L2 全体に届き、範囲では狭められない)。どのネットワークにも重ならない範囲は使わない(ルーターの先は走査できない)。設定ファイルの宛先(`unity`)は範囲の外でも選べる
- **`allowedBrowsers`**: 接続してよいブラウザの範囲(CIDR か 1 台のアドレス。IPv6 も可、最大 32 件)。空ならこの PC の localhost だけ。localhost(`127.0.0.1` / `::1`)は常に許可する。範囲は接続元と同じアドレスファミリーのものだけで判定する(IPv4 の接続元は `::/0` に当たらない)。ブリッジの WebSocket・HTTP と UI の HTTP(UI のプロセスはこのフレームで受けた値で判定する)の両方で使う
- **`interfaces`**: `targetInterface` に選べるアドレス(`localhost` を先頭に、この PC の IPv4。`name` は OS の NIC 名)
- **`source`**: `default`(保存していない)/ `saved`(保存した)/ `unsaved`(効いているが、ファイルへ書けなかった。ブリッジを止めると失われる)
- **`revision`**: 設定の版(0 以上の整数)。ブリッジの起動ごとに 0 から始まり、設定を変えるたびに 1 つ進む。UI は `networkSettingsSet` にこれを添える

```json
{"v":1,"type":"networkSettings","revision":3,"targetInterface":"192.168.1.10","targetRanges":["192.168.1.0/24"],"allowedBrowsers":["192.168.1.0/24","10.0.0.5/32"],"interfaces":[{"address":"127.0.0.1","name":"localhost"},{"address":"192.168.1.10","name":"Ethernet"}],"source":"saved"}
```

### `delivery` — 送ったものが送り先の PC に届いたか(D-116)

```json
{ "v": 1, "type": "delivery", "events": [
  { "host": "192.168.0.11", "target": "PC1", "result": "ok", "param": "smile", "elapsedMs": 4 },
  { "host": "192.168.0.12", "target": "PC2", "result": "ignored", "param": "smile", "elapsedMs": 9 } ] }
```

- ブリッジはターゲットへ送るたびに (宛先名, 送った先の結び付け) を記録し、通信アダプタ(D-110)が振り分けた受信と突き合わせる。`result` は `ok` = 届いた(アダプタの「届いた」。OSC ではエコー)、`ignored` = 届いたが対象がいない(「対象なし」。OSC では受け口の `/sys/ignored`)、`failed` = 届いたが処理できなかった(「処理失敗」。`/sys/failed`)。後ろの 2 つは受け口の任意の通知(HID-375)で、返さない受け口では `ok` だけが届く
- `host` は返事を返した PC、`target` は宛先名、`param` は送ったもののパラメータ id(採用中の定義のパラメータに当たらない送信、たとえば OSC パッドや Record の行は `null`)、`elapsedMs` は送ってから届くまでの経過(遅れて届いた PC に気づくため)。共通のフレームなので OSC のアドレスや型タグは載せない(HID-373)。送っていないもののエコーと、送り先でないホストの返事はイベントにしない。ブロードキャストの宛先では、答えたホストごとに 1 回
- 「エコーの表示は主系だけ」(D-046)は値の表示の扱いで、到達のイベントには適用しない(副系や全てのデバイスの各ホストについても出す)。値の表示は変えない
- 頻度の上限: (宛先, ホスト, 結果) ごとに 100 ms に 1 回まで(スライダーの連続操作で大量に出るのを抑える)。結果ごとに分けるので、連続する `ok` が 1 回の `failed` / `ignored` を押し流さない。色の退色などの途中経過は送らない(UI が行う)
- 全 UI へ配る(状態はブリッジが持ち、どのブラウザから送っても同じに光る)。送った記録は 1024 件・30 秒まで

### `heartbeat` — WebSocket 心拍

ブリッジが **15,000 ms 間隔**で送る。`t` は送信時点の Unix epoch 時刻（ミリ秒）の数値である。UI は受信した `t` をそのまま `heartbeatAck` の `t` にして直ちに返す。ブリッジが最後に受信してから **30,000 ms** を超えると、その接続をタイムアウトとして切断する。

```json
{"v":1,"type":"heartbeat","t":1720000000000}
```

### `notice` — 注意・エラー通知

不正な上りフレームなど、UI に知らせるべき事象を送る。`level` は `info` / `warn` / `error`、`code` と `detail` は文字列である。

```json
{"v":1,"type":"notice","level":"warn","code":"bad-frame","detail":"discarded"}
```

まとめ送り(`batch` / `osc.batch`)が項目の検査(後述の `batch`)、内部予約アドレス、サイズ上限、または送信経路の検査に失敗した場合は、`level` が `error`、`code` が `batch-rejected` の `notice` を送る。`detail` には拒否理由を含める。この場合、まとめの中身は Unity へ一つも送らない。行の変更(`setRow`)を断った場合は `code` が `row-rejected` の `notice` を送る(後述)。

一覧の `code` は、定義に無い一覧・要求を持たない一覧の Sync を断った `runtime-options-refresh-rejected`(`detail: "unknown-request: <一覧 id>"`)と、Unity から受ける一覧でない一覧 id の反映を断った `runtime-options-apply-rejected`(`detail: "unknown-list: <一覧 id>"`。どちらも要求元だけ。`level:"error"`)である。

プロジェクトファイル(D-090)の `code` は、書き出しを断った `project-export-rejected`、取り込みを断った `project-import-rejected`(どちらも要求元だけ。`level:"error"`)、取り込みを終えた `project-imported`(要求元だけ。`level:"info"`、`detail` は取り込んだ定義・パッドの名前)である。

宛先パネルの `code` は、選択を断った `destinations-rejected`(要求元だけ。`level:"error"`)、走査を打ち切った `destinations-scan-failed`(全 UI。`level:"warn"`)、選択をファイルへ書けなかった・`destinationsReset` でファイルを消せなかった `destinations-save-failed`(全 UI。`level:"error"`。書けなかった選択は `source: "unsaved"` で配る)、端末の名前を断った `destination-alias-rejected`(要求元だけ。`level:"error"`)、端末の名前をファイルへ書けなかった `destination-aliases-save-failed`(全 UI。`level:"error"`。名前は実行中だけ効く)である(後の 2 つは D-092)。

ネットワークの設定(D-113)の `code` は、変更を断った `network-settings-rejected`(要求元だけ。`level:"error"`。`detail` は後述の `networkSettingsSet`)と、設定をファイルへ書けなかった `network-settings-save-failed`(全 UI。`level:"error"`。設定は `source: "unsaved"` で実行中だけ効く)である。

## 上りフレーム（UI → ブリッジ）

UI から送る種類は次のとおりである(OSC パッドの 4 種類とプロジェクトファイルの 2 種類とネットワークの設定の `networkSettingsSet` は末尾)。

### `set` — パラメータの値の変更(HID-373)

採用中の定義のパラメータを、パラメータ ID(`param`)と型タグの無い JSON の値(`value`: 有限の数・文字列・真偽値)で変える。UI の部品の操作はこれで送る。どの OSC アドレスへどの型で送るかは、ブリッジが採用中の定義から決める(UI は OSC の語を持たない)。

```json
{"v":1,"type":"set","param":"master","value":0.5}
{"v":1,"type":"set","param":"mute","value":true}
{"v":1,"type":"set","param":"go"}
```

- **型の直し方**: `i` は int32 の整数、`f` は有限の数、`s` は文字列、`bool` は真偽値(OSC へは 0/1 の `i` で送る。D-017)。合わない値は送らずに断る
- **制約**: `range` を持つ数値は範囲外を断る(UI の表示だけに頼らない)
- **trigger**: `value` を省くと定義の `value` を送る。保持値には入らない(D-045)
- **生成担当**: アドレスが `/…/spawn` / `/…/destroy` で終わる `s` の `trigger` は生成担当の命令で、`spawn` はブリッジが名前を振って送り、送り先の PC ごとに生成の記録へ入れる。`destroy` は値(名前)をそのまま送って記録から外す(前述の `desired` の「生成の記録」。HID-385)
- **定義の版**: `revision` は操作した画面が描いた定義の版(`surface` の `revision`)。採用中の版と違えば送らずに `set-rejected`(`level: "warn"`、`detail: "stale-surface: <id>"`)で断る(別のブラウザが定義を切り替えた直後に、旧画面の操作が同じ id の別のアドレスへ読み替わらないように)。省くと照合しない(NiceGUI の UI は常に付ける。UI は作り直し前の画面の部品からは送らない)。`setRow` / `batch` も同じ照合をする
- **断る場合**: 採用中の定義に無い ID、型の不一致、範囲外、単独で送らないパラメータ(`standalone: false`。まとめ送りの一部としてだけ送る)、`value` の無い state。要求元だけへ `notice`(`code: "set-rejected"`、`level: "error"`、`detail` は `unknown-param: <id>` / `type-mismatch: <id> …` / `out-of-range: <id>` / `not-standalone: <id>` / `missing-value: <id>`)を返す
- 送ったものは全宛先へ送り、保持値に記録し、送信ログ(`origin: "ui"`)に残す

### `setRow` — Record の 1 行の値の変更(HID-389・D-117)

採用中の定義の Record の 1 行を、レコード id(`record`)・行のキー(`key`。`keysFrom.source: "ui"` のレコードでは行の ID)・フィールド id ごとの値(`values`)で変える。UI のレコード表の操作はこれで送る。欄を 1 つ編集しても行の全フィールドを載せる(D-061)。どのアドレスへどの型で送るか、`"ui"` の行の Name はブリッジが定義と一覧から決める。

```json
{"v":1,"type":"setRow","record":"member","key":"メンバーA","values":{"active":true,"slot":3,"ip":"192.168.0.21","segment":"(none)"},"revision":3,"holder":"page-7f3a"}
```

- **検査**: 全フィールドが揃い、知らないフィールドが無く、値がフィールドの型(`bool` は真偽値、`i` は int32 の整数、`f` は有限の数、`s` は文字列)に合い、値域・`options` に収まる(`optionsFrom` を持つ `s` は所属を問わない)こと。`"ui"` の行は一覧にある ID であること。`key` と文字列の値は NUL と孤立サロゲートを含めない(上りの OSC の文字列と同じ。HID-392)
- **断る場合**: 送らずに要求元だけへ `notice`(`code: "row-rejected"`、`level: "error"`、`detail` は `unknown-record: <id>` / `missing-field: <id>.<field>` / `unknown-field: <id>.<field>` / `type-mismatch: <id>.<field>` / `out-of-range: <id>[<key>]` / `unknown-row: <id>[<key>]` / `stale-surface: <id>[<key>]`)。ほかのブラウザがロック中の行は `code: "locked"`
- 送ったものは全宛先へ 1 メッセージで送り、`state` のレコードなら保持値に記録し、送信ログ(`origin: "ui"`)に残す。`trigger` のレコードの行も同じ形で送る(保持はしない)

### `batch` — まとめ送り(D-050・HID-389・D-117)

画面のアクション(前述)を UI が展開した中身を、送る順に `items` に並べる(1〜512 件)。要素はパラメータ `{ "param": "<id>", "value"?: <値> }` か行 `{ "record": "<id>", "key": "<キー>", "values": {...} }`。ブリッジは各要素を OSC のメッセージに直し、即時タイムタグの OSC bundle 1 個(1 データグラム)として全宛先へ送る(主系への送信に失敗したときはまとめ全体を拒否し、副系へも送らない)。

```json
{"v":1,"type":"batch","items":[{"param":"name","value":"Zed"},{"param":"enabled","value":true},{"param":"update"},
 {"record":"member","key":"メンバーA","values":{"active":true,"slot":3,"ip":"","segment":"(none)"}}],"revision":3,"holder":"page-7f3a"}
```

- パラメータの要素は `set` と同じ規則で直す(`value` を省いた `trigger` は定義の `value`)。ただし `standalone: false` のパラメータも送れる(まとめ送りの一部としてだけ送るため)。生成担当の命令(前述の「生成の記録」)はまとめ送りでは送れない(名前の割り振りと記録が要るので `set` で送る)
- 行の要素は `setRow` と同じ規則で直す
- 1 件でも直せなければまとめごと断る(`batch-rejected`、`detail` は `unknown-param: <id>` / `spawner-in-batch: <id>` / `set` や `setRow` と同じ理由 / `stale-surface: batch`)。ロック中の部品・行を含むときも、まとめごと断る
- 送れた後は、保持対象(`state` で `standalone` が `false` でないパラメータと `state` のレコードの行)を保持値に記録し、送信ログ(`origin: "action"`)に残す

### `catalogAdopt` — 設計図から既定の画面を作る(HID-386・D-112)

`host`(`catalog` の `pcs` の `host`)の PC の設計図から、既定の画面をブリッジが作って採用する。画面の名前は `blueprint-<PC 名>-<PC 名の CRC32 の 8 桁の 16 進>`(PC 名の英数字・`_`・`-` 以外は `-` に置き換える。置き換えで同じ形になる別の PC 名を末尾で区別する)。同じ名前で保存した画面が読めない(壊れた JSON など)ときは作り直さずに `catalog-adopt-rejected` で断る。同じ名前で保存した画面があれば、それを優先して採用する(並べ替えて保存した結果を作り直しで上書きしない)。無ければ作った定義を保存して採用する。

- **作り方**: 1 項目 1 パラメータ。`kind` が `state` / `trigger`、`type` が `f` / `i` / `s` / `bool` の項目だけを使い、知らないものは画面に出さない(設計図の側には残る)。キーは `label` → ラベル、`min` / `max` → `range`、`step`、`widget`(知っている表示ヒントだけ)、`options`(`s`)、`default`(state)、`value`(trigger。無ければ `i` / `f` は 1、`s` は空、`bool` は真)。アドレスの先頭 2 つの区切り(`/パッケージ/対象/…`)ごとに `group` にまとめる
- 採用すると要求元へ `notice`(`code: "catalog-adopted"`、`level: "info"`、`detail` は画面の名前)を返す。PC が無い・保存できないときは `catalog-adopt-rejected`(`level: "error"`)

```json
{"v":1,"type":"catalogAdopt","host":"192.168.1.20"}
```

### `lock` / `unlock` — 操作中のロック(HID-378・D-111)

ブラウザがある部品の操作を始めたら(スライダーのドラッグ開始・入力欄へのフォーカスなど)、`lock` でロックを求める。ロックの単位は部品(`ref: {"param": "<id>"}`)と Record の行(`ref: {"record": "<id>", "key": "<キー・行の ID>"}`)である。

```json
{"v":1,"type":"lock","ref":{"param":"master"},"holder":"page-7f3a","label":"192.168.1.10"}
{"v":1,"type":"unlock","ref":{"param":"master"},"holder":"page-7f3a"}
```

- **持ち主**: 接続(`hello.clientId`)と `holder` の組。UI のプロセスは複数のブラウザのページを 1 本の接続にまとめるので、`holder` はページごとに UI が振る(1〜64 文字)。`label` は他のブラウザに出す持ち主の名前(ページの IP など。64 文字まで)
- **期限**: 2 秒。操作が続く間は同じ `lock` を送り直して延ばす(NiceGUI の UI は 0.5 秒ごと)。期限の無いロックは無い。期限切れ・持ち主の `unlock`・接続の切断で外れる。持ち主以外の `unlock` は何もしない
- **ほかの持ち主が持っているとき**: `lock` は要求元へ `notice`(`code: "lock-rejected"`、`level: "warn"`、`detail: "held: <label>"`)を返す
- **採用中の定義に無い単位**: 定義に無いパラメータ・Record、その Record に無い行(反映済みのキーの一覧にも保持値の行にも無いキー)の `lock` は、`lock-rejected`(`detail: "unknown-ref: <単位>"`)で断る。無い単位のロックで全量の `locks` を膨らませられないようにするため(HID-392)
- **値の変更の拒否**: ロック中の部品・行への、持ち主の `holder` を付けない変更は送らずに断る。`set` は `set-rejected`、`setRow` と `osc.message`(Record の行・定義のパラメータのアドレス)は `code: "locked"`、`batch` / `osc.batch` は `batch-rejected` で、`detail` は `locked: <単位> by <label>`。まとめ送りは、含まれる部品・行のどれかがロック中ならまとめごと断る(1 データグラムでまとめて届く前提を崩さないため)
- 値の変更のフレーム(`set` / `setRow` / `batch` / `osc.message` / `osc.batch`)は、操作したページの `holder` を省略可のキーとして持つ

### `osc.message` — Unity へ送る OSC

`address` と型タグ付き `args` を送る。OSC 専用の生の送信で、NiceGUI の UI は使わない(定義のパラメータの操作は `set`、レコードの行は `setRow`、まとめ送りは `batch`。HID-389)。`from`、`target`、配列形式の旧イベント名などは付けない。ブリッジは設定された全ての Unity 宛先（主系と副系）へ転送し、内部予約アドレスへの送信は拒否する。

```json
{"v":1,"type":"osc.message","address":"/avatar/pos",
 "args":[{"type":"f","value":0.1},{"type":"f","value":0.9}]}
```

上り(`osc.message` と `osc.batch` の各要素)の `address` と `s` の引数は、NUL(U+0000)と孤立サロゲートを含めない。含むフレームは不正なフレームとして捨てる(HID-392)。OSC の文字列は NUL で終わるので `/set/level\u0000` は `/set/level` と同じバイト列で Unity へ届くが、ロックの照合(完全一致)だけを外れるため。孤立サロゲートも UTF-8 へ直すと U+FFFD に置き換わり、照合した文字列と送るバイト列が食い違う。下りの `osc.message` は Unity から届いた文字列をそのまま載せる。

### `osc.batch` — 複数の OSC を 1 データグラムで送る

`messages` に 1 件以上の OSC メッセージを、送信順に並べる。各要素は `address` と `args` だけを持ち、`osc.message` と同じ型タグ付き引数を使用する。ブリッジはこれを即時タイムタグの OSC bundle 1 個へ変換し、1 データグラムとして全ての Unity 宛先へ送る(主系への送信に失敗したときはバッチ全体を拒否し、副系へも送らない)。ブリッジはメッセージの意味を解釈せず、保持対象のアドレスだけを保持値に記録する。OSC 専用の生のまとめ送りで、NiceGUI の UI のアクション(まとめ送りボタン)は共通のフレーム `batch` を使う(HID-389)。

1 バッチの上限は 512 メッセージ(`batch` も同じ)、OSC bundle のエンコード後サイズの実用上限は 60 KiB (60 × 1024 byte) である。空の `messages`、上限超過、内部予約アドレスを含むバッチは拒否する。

```json
{"v":1,"type":"osc.batch","messages":[
  {"address":"/slot/01","args":[{"type":"f","value":0.25}]},
  {"address":"/slot/02","args":[{"type":"f","value":0.75}]},
  {"address":"/cue/apply","args":[{"type":"i","value":1}]}
]}
```

### `resend` — 保持値の再送

ブリッジが保持する `state` の値（`desired` と同じ。`trigger` は含まない）を Unity の宛先へ全部送り直させる。`target` に `hello.targets[].name` を指定するとその宛先だけ、省くと全宛先へ送る。クラッシュ・再起動した台を他の台に追いつかせる用途で、宛先が到達不能でも送る。未知の `target` は要求元だけへ `notice`（`level:"error"`、`code:"resend-rejected"`）を返す。

```json
{"v":1,"type":"resend","target":"backup"}
```

### `reconcile` — この PC を生成の記録に合わせる(HID-385・D-115)

`target`(`hello.targets[].name`)の宛先の PC にだけ、生成の記録(前述の `desired` の「生成の記録」)に合わせる操作をさせる。ブリッジは次の順で、その PC だけへ送る(送信ログの `origin` は `resend`)。

1. **余分なものを消す**: その PC の設計図(`catalog`)にある `/<パッケージ名>/<名前>/…` のうち、名前が生成担当の振る形(記録の名前・定義の生成担当の `value` から番号を除いた部分 + 数字。例 `spark7`)で、その PC の記録に無いものへ `/<パッケージ名>/<対象名>/destroy ,s 名前` を送る。番号の付かない名前・別の名前の対象(シーンに最初からあるもの)は消さない
2. **欠けているものを生成する**: その PC の記録のうち、設計図に `/<パッケージ名>/<名前>/` で始まる項目が無いものを生成する。その PC の設計図が無ければ(Sync に答えない受け口)、記録のすべてを欠けているとみなして生成する。止まっている間にほかの PC で消された印のあるもので欠けているものは、生成せずに記録から外す
3. **保持値を送り直す**(`resend` と同じ)

名前がぶつかって生成が失敗したとき(`/sys/failed` の `name in use`)も、設計図を Sync で取り直してからこの操作で直せる(ぶつかるのは PC の間で状態がずれているときだけ)。結果は要求元へ `notice`(`level:"info"`、`code:"reconciled"`、`detail:"<宛先名>: spawned <N>, destroyed <M>"`)、未知の `target` は `notice`(`level:"error"`、`code:"reconcile-rejected"`、`detail:"unknown-target: <名前>"`)。取り込んだプロジェクトをまだ送っていない間(`desiredStatus.unsent`)は合わせず、`notice`(`level:"error"`、`code:"reconcile-rejected"`、`detail:"unsent-project"`)を返す(送ると決める前の取り込んだ記録の生成を Unity へ届けないため。全宛先への `resend` の後は合わせられる)。

```json
{"v":1,"type":"reconcile","target":"backup"}
```

### `runtimeOptionsRefresh` — Unity の一覧の取り直し

`list` を省くと、採用中の定義の一覧の結び付けのすべての `request` へ、全宛先(到達不能の台を含む)に引数なしの OSC を送らせる(UI の「一覧を更新」)。応答の一覧で中身が変われば `runtimeOptions` が全 UI へ届く。ただし、その宛先の初報でなければ応答は届いた一覧に入るだけで、画面に使う一覧は `runtimeOptionsApply` まで変わらない(`pending` に載る。D-088)。変わらなければ何も届かない。`request` を持つ一覧が無ければ何もしない。

```json
{"v":1,"type":"runtimeOptionsRefresh"}
```

省略可能な `list`(一覧の id)を付けると、その一覧の要求だけを全宛先へ送らせる(一覧の近くの「Sync」。`DESIGN.md` D-077)。どのアドレスへ送るかは結び付けが決める(HID-389)。応答の扱いは省いたときと同じで、一覧が変わらなければ何も届かない。`list` が採用中の定義の一覧でないとき・その一覧が `request` を持たないとき(定義が無いときを含む)は Unity へ何も送らず、要求元だけへ `notice`(`level:"error"`、`code:"runtime-options-refresh-rejected"`、`detail:"unknown-request: <一覧 id>"`)を返す。任意のアドレスへ引数なしの OSC を撒く口にしないためである。取り込んだプロジェクトの値をまだ送っていない間(`desiredStatus` の `unsent: true`。D-090)は、`list` の有無にかかわらず何も送らず、`detail:"unsent-project"` で断る。

```json
{"v":1,"type":"runtimeOptionsRefresh","list":"segments"}
```

### `runtimeOptionsApply` — 届いた一覧の反映

届いたが反映していない一覧(`runtimeOptions` の `pending`)を反映済みの一覧に取り込ませる(UI の「新しい一覧があります」の「反映」と「すべて反映」。`DESIGN.md` D-088)。`list`(一覧の id)を付けるとその一覧の全出所を、省くと全一覧を反映する。宛先ごとには反映させない。反映済みの一覧が変われば、`runtimeOptions` を全 UI へ配り、反映したキーの一覧に行の無いキーがあれば `default` で行を作って到達可能な宛先へ送り(送信ログの `origin` は `row`)、`desired`(`full: false`)を配る(前述の「行の生成」)。反映待ちが無ければ何もしない。`list` が採用中の定義の Unity から受ける一覧(`optionsFrom` の一覧と、`source: "ui"` でない `keysFrom` の一覧)でないとき(定義が無いときを含む)は何もせず、要求元だけへ `notice`(`level:"error"`、`code:"runtime-options-apply-rejected"`、`detail:"unknown-list: <一覧 id>"`)を返す。

```json
{"v":1,"type":"runtimeOptionsApply","list":"members"}
```

### `recordKeyAdd` / `recordKeyRemove` / `recordKeyRename` — レコードの行の追加・削除・改名

`record`(レコード id)と `key`(空でない文字列)を持つ(D-075)。行は同じ `keysFrom.list` を共有する全レコードでまとめて増減する。`keysFrom.source` が `"ui"` のレコードでは、`recordKeyAdd` の `key` は新しい行の Name(ID はブリッジが振る)、`recordKeyRemove` と `recordKeyRename` の `key` は行の ID(D-087)。

- **`recordKeyAdd`**: `keysFrom.source` が `"ui"` なら、新しい ID を振って Name の行を一覧の末尾に足し、一覧のアドレスへ一覧(ID の並び)の全量を Unity に送り(全宛先)、`runtimeOptions` を全 UI へ配る。既にあるかは Name で判定する。どちらの出どころでも、共有する `state` レコードに `default` の行を作って到達可能な宛先へ送り(送信ログの `origin` は `row`)、`desired`(`full: false`)で配って保存する。既にあるキー・上限に達した一覧・空のキー・未知のレコードは `notice`(`code: "record-key-rejected"`、`detail` は `exists: <キー>` / `full: <キー>` / `empty-key` / `unknown-record: <id>`)を要求元だけに返す
- **`recordKeyRemove`**: `"ui"` なら一覧から消して一覧の全量を Unity に送り直し、`runtimeOptions` を配る。共有する全レコードからそのキーの行の保持値を消し、`desired` を `full: true` で配って保存する(差分では行の削除を表せないため)。Unity の一覧から行ができるレコードでは、一覧にある間は行が残り、値は `default` から作り直される。消す行も一覧のキーも無ければ `notice`(`not-found: <キー>`)
- **`recordKeyRename`**(`"ui"` のレコードだけ。D-087): `key`(ID)の行の Name を `name`(空でない文字列)に変える。ID・行の値・一覧の並びは変わらないので一覧は送り直さず、`runtimeOptions` を全 UI へ配り、一覧を共有する `state` レコードの行を同じ ID・値・新しい Name で全宛先へ送り直し(送信ログの `origin` は `ui`)、`desired`(`full: false`)で配って保存する。同じ Name なら何もしない。同じ一覧の他の行と重なる Name・空の Name・無い ID・`"ui"` でないレコード・未知のレコードは `notice`(`record-key-rejected`、`detail` は `exists: <Name>` / `empty-key` / `not-found: <ID>` / `not-renamable: <レコード id>` / `unknown-record: <id>`)を要求元だけに返す
- `"ui"` の一覧に無いキーの行への上り `setRow` / `batch` は `unknown-row` で断る。OSC 専用の `osc.message` / `osc.batch` は、Unity へは送るが保持しない(別の画面で消した行へ、古い画面から書き込んだ場合)。`"ui"` の一覧は再送(初回到達・回復・定義の採用・上り `resend`)のたびに行より先に送り直す

```json
{"v":1,"type":"recordKeyAdd","record":"mb","key":"MB 3"}
{"v":1,"type":"recordKeyRemove","record":"member","key":"メンバーC"}
{"v":1,"type":"recordKeyRename","record":"mb","key":"11111111-1111-4111-8111-111111111111","name":"MB A"}
```

### `destinationsScan` / `destinationsSelect` / `destinationsReset` — 送り先の選択(宛先パネル)

`DESIGN.md` D-078 / D-079 / D-085。応答はどれも `destinations` の全量で、選択の変更は全 UI へ、断ったときは要求元だけへ届く(要求元のチェックを、ブリッジが持つ選択へ戻させるため)。

- **`destinationsScan`**: 引数を持たない。LAN を走査させる(「更新」ボタン)。走査中なら新しい走査を始めず、走査中の `destinations` を要求元へ返す。ブリッジは起動時に走査しない(UI を使わない起動で LAN へ撒かないため)ので、UI は `scannedAt` が `null` で走査中でない `destinations` を受けたら、これを 1 回送る
- **`destinationsSelect`**: `allDevices`(真偽値、省略不可)と `networks`(`broadcasts` の `network`、最大 4 個、省略不可。選ばないときは空の配列)と `hosts`(空でない文字列、最大 256 個)を持つ。`allDevices: true` なら `broadcasts` の各アドレスへ(先頭が主系)、`false` なら `networks` の各ネットワークのブロードキャストアドレス(`net-<a>-<b>-<c>-<d>-<prefix>` という名前で `sendPort` へ)と `hosts` の各端末へ送る(ブロードキャストの宛先が先に並ぶ)。選んだネットワークの中のホストのうち `sendPort` へ送るものは、ブロードキャストと二重に届かないよう個別には送らない(`config` の宛先で `sendPort` が違うものは個別に送る。`config` の宛先がホスト名なら名前解決したアドレスで判定する)。この PC を指す宛先(ループバック・この PC のどの NIC のアドレスも)は、ブロードキャストがこの PC 自身にも届くので、ネットワークを 1 つでも選べば個別には送らない。ブロードキャストの宛先(`allDevices` を含む)は、ネットワークの中とループバックに加えてこの PC のどの NIC のアドレスから返った pong も受ける(同じ PC の Unity が別の NIC のアドレスから答えるため)。ネットワークの宛先の pong とエコーの扱いは「全てのデバイス」と同じ(pong を返したホストを Unity とみなし、保持値はそのホストへユニキャストで再送する。D-079)。`config` にあるホストはその宛先(名前・`sendPort`)のまま使い、それ以外は `ip-<a>-<b>-<c>-<d>` という名前で `sendPort` へ送る。主系は、`config` の主系が個別の宛先に残っていればそれ、`config` の主系が選んだネットワークの中ならそのネットワークの宛先、どちらでもなければ先頭。選択はファイル(`destinations.file`)へ原子的に保存し、ブリッジ再起動後も保たれる。新しく加わった宛先は初回の pong で保持値を受け取る。`hosts` に書けるのは、`config` の宛先のホストと、ブリッジの PC の有効なネットワーク(`broadcasts` のネットワーク。この PC 自身のアドレスを含む)の中のユニキャストアドレスだけである(ネットワークアドレス・ブロードキャストアドレス、ほかのネットワーク・公開アドレス・ループバックは書けない。ブロードキャストは `allDevices` で選ぶ)。IPv4 は正規形(先頭ゼロの無い dotted-quad)だけを受け、`192.168.001.255` のような非正規の表記は `invalid-host` で断る。走査で見つかったかどうかは問わない。保存した選択を起動時に戻すとき、および再走査でこの PC のネットワークが変わったときも同じ規則で検証し直し、外れたホストと、この PC がもういないネットワークは警告して落とす(個別の選択とネットワークが全部落ちたら `config` の宛先に戻る)。D-085 より前に保存したファイル(`networks` が無い)は `networks` が空として読む。断る場合は `notice`(`code:"destinations-rejected"`、`detail` は `empty-selection`(`allDevices: false` で `networks` と `hosts` がどちらも空)/ `invalid-host: <ホスト>` / `invalid-network: <ネットワーク>`(`broadcasts` に無い)/ `no-broadcast-network`(`broadcasts` が空))
- **`destinationsReset`**: 引数を持たない。保存した選択を消し、`config` の宛先へ戻す

```json
{"v":1,"type":"destinationsScan"}
{"v":1,"type":"destinationsSelect","allDevices":false,"networks":[],"hosts":["192.168.1.20","192.168.1.21"]}
{"v":1,"type":"destinationsSelect","allDevices":false,"networks":["192.168.1.0/24"],"hosts":["10.0.0.40"]}
{"v":1,"type":"destinationsReset"}
```

### `destinationsAlias` — 端末の名前(別名)

`DESIGN.md` D-092。宛先パネルの端末に、UI から名前(別名)を付ける・消す。逆引きも OS の名前解決も名前を返さない LAN でも、端末を見分けられるようにするため。

```json
{"v":1,"type":"destinationsAlias","host":"192.168.1.21","alias":"ステージ左 iPad"}
{"v":1,"type":"destinationsAlias","host":"192.168.1.21","alias":null}
```

- **`host`**: `destinations` の `devices` にある端末の `host`(1〜253 文字)。一覧に無い端末には付けられない
- **`alias`**: 256 文字までの文字列か `null`(省略不可)。ブリッジは前後の空白を外し、`null` か空白だけなら名前を消す。名前は 64 文字まで(文字数は UTF-16 の単位で数える。絵文字などは 1 文字で 2)で、超える名前・制御文字を含む名前は理由つきで断る(フレームとしては 256 文字まで受ける。フレームの検査で落とすと UI に理由が返らないため)
- **覚えるキー**: ブリッジは、その端末の MAC が分かれば(`devices` の `mac`。走査の ARP 表、この PC は NIC の MAC、直近の走査に出なかった端末は最後に分かった MAC)MAC で、分からなければ(別のセグメント・`config` のホスト名など)`host` の文字列で覚える。MAC は UI から受け取らない。MAC で付け直すと、同じ `host` で覚えていた名前は消す(MAC の名前へ移す)。消すときは MAC と `host` の両方の名前を消す。MAC の名前には最後に見えたホストも一緒に覚え、走査で同じ MAC が別のホストに見えたら更新する
- **表示の照合**: `devices` の `alias` は、MAC の名前、無ければ `host` の名前。MAC で覚えた名前は、DHCP で IP が変わっても同じ MAC の端末に付き、端末が走査に出ない間(電源断・ブリッジ再起動直後の初回走査前)も最後に見えたホストの行に出る。`host` で覚えた名前は IP が変わると外れ、その IP に後から来た別の端末に付いて見えることがある
- **保存**: 名前は `destinations.aliasesFile`(省略時は `<保持値の保存先>/.device-aliases.json`)へ原子的に保存し、ブリッジ再起動後も保たれる。覚える名前は 512 件まで。ファイルの各件は `{ "key": "mac:aa:bb:cc:dd:ee:ff" | "host:<host>", "alias": "...", "host": "<最後に見えたホスト。MAC の件だけ>" }`。手で直したときの書き損じの件は警告して捨て、残りを読む(MAC の大文字・ハイフン区切りは直して受ける)。ファイルそのものが読めないときは別名なしで起動し、そのファイルを上書きしない
- **応答**: 受け付けたら `destinations` の全量を全 UI へ配る。断るときは要求元だけへ `notice`(`level:"error"`、`code:"destination-alias-rejected"`、`detail` は `unknown-host: <ホスト>` / `unaliasable-host: <ホスト>`(制御文字を含むなど、キーに使えない host)/ `alias-too-long: ...` / `alias-has-control-characters` / `alias-has-lone-surrogates`(対になっていない UTF-16 サロゲート。保存すると UI が `destinations` を符号化・描画できなくなるため。この検査の前に保存された該当エントリは、起動時の読み込みで警告とともに捨てられ、次の保存でファイルからも消える) / `too-many-aliases: ...`)と、その UI へ `destinations` を返す。ファイルへ書けなかったとき(読めなかったファイルを上書きしないときを含む)は名前を実行中だけ効かせ、全 UI へ `notice`(`level:"error"`、`code:"destination-aliases-save-failed"`)を送る

### `surfaceRequest` — 定義の再要求

引数を持たない。`surfaceList`、採用中の定義があれば `surface` を、要求元の UI だけへ返す。UI は接続のたびに(再接続を含む)これを送る。定義があれば続けて `desired`(`full: true`)・`runtimeOptions` も返し、最後に定義の有無にかかわらず `desiredStatus` を返す。接続時にブリッジが自動では送らないのは、接続手順(`hello` → `link` → `osc.sentLog`)を最小に保ち、定義と保持値の取得を UI の要求に揃えるためである。

```json
{"v":1,"type":"surfaceRequest"}
```

### `surfaceLoad` — 保存済み定義の読み込み

`name` の定義をフォルダから読み込み、検証に通れば採用して全 UI へ配る。ファイルが無い・壊れている場合は直前の定義を維持し、要求元へ `surface-rejected` の `notice` を返す。

```json
{"v":1,"type":"surfaceLoad","name":"stage"}
```

### `surfaceSave` — 定義の保存

`definition`(本体)と `bindings`(結び付け。省略可)を 1 つの定義として検証し、`name` で保存する(D-117。本体と結び付けを 1 回で保存し、食い違った組を残さないため)。保存するファイルは本体の最上位に `bindings` を足した形になる。既存の同名ファイルがあれば直前の内容を `.backups/` へ退避してから置き換える(名前ごとに直近 20 件を残す)。`activate` を省略または `true` にすると採用して全 UI へ配り、`false` のときは保存だけして `surfaceList` を全 UI へ送る。検証に通らなければ何も保存せず、要求元へ `surface-rejected` の `notice` を返す。`bindings.osc` の無い定義も断る(`osc bindings are required`)。`definition` と `bindings` の中身はフレームの形式検査では見ず、ブリッジが検証して理由を返す。版 1 の定義(`bindings` を持たず、パラメータに `address` を書く形)も受け、保存の前に版 2 へ移す(前述)。

```json
{"v":1,"type":"surfaceSave","name":"stage","activate":true,
 "definition":{"format":"oscdesk-surface","version":2,"name":"Stage",
   "parameters":[{"id":"master","label":"Master","type":"f","kind":"state","range":[0,1],"default":0.5}],"screens":[]},
 "bindings":{"osc":{"parameters":[{"id":"master","address":"/mix/master"}]}}}
```

**名前の規則**: `surfaceLoad` / `surfaceSave` / `surface` / `surfaceList` の `name` は、英数字で始まり英数字・`_`・`-` だけからなる 1〜64 文字で、Windows の予約デバイス名(`CON` `PRN` `AUX` `NUL` `COM1`〜`COM9` `LPT1`〜`LPT9`、大文字小文字を問わない)ではない。ブリッジはこれをそのままファイル名(`<name>.json`)に使うため、パス区切り・ドット・先頭の `.`(`.backups` を含む)は表現できず、保管フォルダの外へは書けない。違反するフレームは `invalid-frame` の `notice` で破棄される。

### `osc.padRequest` / `osc.padLoad` / `osc.padSave` — OSC パッドの取得・切り替え・保存

- **`osc.padRequest`**(引数なし): `osc.padList` と、採用中のパッドがあれば `osc.pad` を要求元だけへ返す。UI は接続のたびに(再接続を含む)`surfaceRequest` と一緒に送る
- **`osc.padLoad`**(`name`): 保存済みのパッドを読み込んで採用し、全 UI へ配る。無い・壊れている場合は直前のパッドを維持して `pad-rejected` を返す
- **`osc.padSave`**(`name`・`pad`): `pad` を検証して保存し、採用して全 UI へ配る。`pad` の中身はフレームの形式検査では見ず、ブリッジが検証して理由を返す(`surfaceSave` と同じ)。保存だけして採用しない指定は無い

```json
{"v":1,"type":"osc.padRequest"}
{"v":1,"type":"osc.padLoad","name":"take-02"}
{"v":1,"type":"osc.padSave","name":"take-03","pad":{"format":"oscdesk-pad","version":1,"rows":1,"columns":2,"buttons":[]}}
```

### `osc.padPress` — OSC パッドの押下

`name`(押したパッドの名前)・`version`(押した画面が描いたパッドの `osc.pad` フレームの `version`。必須)・`button`(ボタンの `id`)だけを送る。アドレスと引数は送らず、ブリッジが採用中のパッドから引いて**全宛先へ 1 メッセージ**(bundle にしない)で送る。送る中身の正をブリッジに置き、どの端末から押しても保存されたとおりに送るため、任意のアドレスを撃つ上りの経路は作らない。

- **保持値・再送に載せない**: 押下はきっかけであり、`desired` を書き換えず、再送もしない(サーフェス定義の `state` と同じアドレスを撃っても保持値は変わらない。食い違いはエコーの警告ログに出る)
- **送信ログ**: `osc.sentLog` の `origin` は `pad`
- **断る場合**: 採用中のパッドの名前か版(`version`)と違う(別の端末が切り替えた・同じ名前で上書き保存した直後の古い画面や、ブリッジの再起動の前に描いた画面。同じ `id` の別のボタンを撃たないため。`revision` は再起動で 1 に戻るので照合に使わない)・未知のボタン・予約アドレス・一覧のアドレス(`bindings.osc.lists[].address`)は、何も送らずに要求元だけへ `notice`(`level: error`、`code: pad-press-rejected`、`detail` は `stale-pad: <name>@<version>` / `unknown-button: <id>` / `internal-address: <address>` / `option-list-address: <address>`)を返す

```json
{"v":1,"type":"osc.padPress","name":"take-03","version":"3f9a1c0b7e2d-2","button":"b1"}
```

### `projectExport` / `projectImport` — プロジェクトファイルの書き出し・取り込み

`DESIGN.md` D-090。プロジェクトファイル(前述の `project`)は、採用中の定義・その保持値・採用中のパッドを 1 つにまとめたもので、UI はブラウザのダウンロード・アップロードで扱う(ブリッジのフォルダへは書き出さない)。

- **`projectExport`**(`requestId`: 1〜64 文字の文字列。必須): 採用中の定義・保持値・パッドをまとめ、取り込みと同じ検査(`ProjectFileSchema`。後述の `surface.values` の上限を含む)を通してから `project` を要求元だけへ返す。定義もパッドも採用していない・12 MiB を超える・検査に通らない(取り込めないファイルになる)場合は `notice`(`code:"project-export-rejected"`、`detail` は `empty: ...` / `too-large: ...` / `invalid: ...`)。この notice は `requestId` を持たない。ブリッジは 1 本の接続の上りを受けた順に処理してその場で答えるので、UI は最も古い応答待ちの `projectExport` への答えとして扱える
- **`projectImport`**(`project`: JSON オブジェクト): プロジェクトファイルを取り込む。`project` の中身はフレームの形式検査では見ず、ブリッジが大きさ(12 MiB)・形式(`ProjectFileSchema`)・パッドの保管の上限(8 MiB)を、何も書き換えないうちに確かめる。版 2 と版 1 のどちらも受け、版 1 の定義は版 2 へ移す(前述の `project`)。通れば、`surface` があれば定義を `name` で保存(直前の内容は `.backups/` へ退避。`surfaceSave` と同じ)して採用し、保持値をプロジェクトの `values` で置き換える。メモリ上の値は引き継がず、プロジェクトに無いパラメータ・行は `default`、UI で管理する一覧はプロジェクトのもの(無い一覧は空)になる。照合は保存ファイルからの復元と同じ(id・アドレス・型・値域。版 2 の値は定義の結び付けで id からアドレスを引いて照合する)。`osc.pad`(版 1 は `pad`)があればパッドを `name` で保存して採用する(`osc.padSave` と同じ)。`surface` / パッドが `null` の部分には触れない。配信は通常の採用と同じ(`surface`・`surfaceList`・`desired`(`full: true`)・`runtimeOptions`・`desiredStatus`・`pad`・`osc.padList` を全 UI へ)で、最後に要求元へ `notice`(`code:"project-imported"`、`level:"info"`)を返す
- **生成の記録**: `surface.osc.spawns`(版 1 は `surface.values.spawns`)があれば、今の記録を捨てて取り込んだ記録に置き換える(無ければ空にする)。全宛先への `resend` を受けたときに、記録の PC ごとに生成してから保持値を送る。それまでは起動の合図を受けても生成しない(HID-385)
- **Unity へは送らない**: 取り込んだ保持値は Unity へ送らず、`desiredStatus` が `unsent: true` になる。全宛先への `resend` を受けるまで、自動の再送(初回の到達・回復・定義の採用)も止める(前述の `desired`)。この状態はブリッジの再起動をまたいで保たれる(保存ファイルの `unsentSince`)
- **断る場合**: `notice`(`code:"project-import-rejected"`、`detail` は `too-large: ...` / `invalid: ...` / `surface: <保存の失敗の理由>` / `pad: <保存の失敗の理由>`)。検証で断るときは何も書き換えない。定義の保存・採用の後にパッドの書き込みだけが失敗したときは、定義と保持値は取り込まれたまま `pad: ... (the surface and its values were imported)` を返す
- **競合**: 作業コピーの照合はしない(後勝ち)。UI は送る前に確認のダイアログを出す

```json
{"v":1,"type":"projectExport","requestId":"page-1-3"}
{"v":1,"type":"projectImport","project":{"format":"oscdesk-project","version":2,"exportedAt":"2026-10-28T10:00:00.000Z","surface":null,"osc":{"pad":{"name":"take-03","pad":{"format":"oscdesk-pad","version":1,"rows":1,"columns":1,"buttons":[]}}}}}
```

### `catalogRequest` — 設計図の Sync

`{ "v": 1, "type": "catalogRequest" }`。ブリッジが全宛先へ `/sys/catalog/request` を送り、ターゲットに設計図を送り直させる(D-104)。応答は `catalog` フレームで届く。保持値は変えない。

### `networkSettingsSet` — ネットワークの設定の変更

`DESIGN.md` D-113。3 つの設定(前述の `networkSettings` の `targetInterface`・`targetRanges`・`allowedBrowsers`)をまとめて置き換える。どれも省略できない(部分更新はしない)。どの UI からでも変えられ、通れば保存して全 UI へ `networkSettings` を配る。

- **`targetInterface`**: `null`(すべて。`"0.0.0.0"` も同じ)か、`networkSettings` の `interfaces` にあるアドレス。変わったら Unity 向けの UDP ソケットを同じポートのまま付け替える(今のソケットを閉じてから新しいアドレスで開く。付け替えの間の数ミリ秒に届いた・送ろうとした OSC は落ちる)。開けなければ元のアドレスへ戻して断る
- **`targetRanges`**: IPv4 の CIDR(接頭辞は必須)。ブリッジがネットワークアドレスへ丸め(`192.168.1.10/24` → `192.168.1.0/24`)、重複を除く。変わると宛先パネルの走査範囲を決め直し(走査はしない)、範囲の外になった端末を一覧と選択から外して `destinations` を配る
- **`allowedBrowsers`**: CIDR か 1 台のアドレス(`/32`・`/128` にする)。正規形にして重複を除く。変わると範囲の外になった WebSocket の接続を切る
- **`revision`**: 操作した画面が持っていた設定の版(`networkSettings.revision`)。処理する時点の版と違えば何も変えずに断る(ほかのブラウザが先に変えた後の、古い画面からの上書きを防ぐ)
- **`browser`**(省略可): UI のプロセスが中継するときの、操作したブラウザのアドレス。ブリッジはこの接続の送信元に加えて、このアドレスも今の許可リストと新しい許可リストの両方に入ることを確かめる(判定を厳しくするだけで、許可には使わない)
- **許可の外からの変更は断る**: 送信元と `browser` が処理する時点の `allowedBrowsers` に入らなければ断る(localhost は常に入る)。複数のページが UI のプロセスの 1 本の接続を共有するので、許可を取り消されたブラウザの要求が接続に残っていても、それで設定を戻させない
- **自分を締め出す変更は断る**: 送信元と `browser` のうち localhost でないものが新しい `allowedBrowsers` に入らなければ、何も変えずに断る(読めないアドレスも断る側に倒す)。localhost からは空(localhost だけ)にもできる
- **断る場合**: 要求元へ `notice`(`code:"network-settings-rejected"`、`detail` は `stale-revision: <届いた版> (current <今の版>)` / `not-allowed: <アドレス>` / `would-lock-out: <アドレス>` / `invalid-target-interface: <値>` / `invalid-target-range: <値>` / `invalid-allowed-browser: <値>` / `rebind-failed: <理由>`)と、今の `networkSettings` を返す。変更は届いた順に 1 つずつ処理し、版と許可の照合は前の変更を適用した後に行う

```json
{"v":1,"type":"networkSettingsSet","revision":3,"targetInterface":"192.168.1.10","targetRanges":["192.168.1.0/24"],"allowedBrowsers":["192.168.1.0/24"],"browser":"192.168.1.30"}
```

### `heartbeatAck` — 心拍応答

`heartbeat` の `t` をそのまま返す。ブリッジはこの受信を接続の生存確認に使う。

```json
{"v":1,"type":"heartbeatAck","t":1720000000000}
```

## 定義のダウンロード・アップロード(HTTP)

WebSocket と同じポート(`wsPort`)は通常の HTTP も受け付ける。認証はなく、CORS ヘッダも付けない(ブラウザから直接ではなく、UI サーバ経由か `curl` 等で使う)。

| メソッド・パス | 動作 |
|---|---|
| `GET /surfaces` | `{"names":[...],"active":"stage"\|null}` を返す |
| `GET /surfaces/<name>.json` | 保存済みの定義ファイルを `attachment` として返す。無ければ 404 |
| `PUT /surfaces/<name>.json` | 本文(JSON、1 MiB まで)を検証して保存し、既定では採用して全 UI へ配る。`?activate=0` で保存のみ |

不正な名前は 400、JSON として読めない本文は 400、定義の検証に通らない本文(`bindings.osc` の無い定義を含む)は 422(本文に理由)、1 MiB 超は 413、上記以外のパスは 404 を返す。保存の挙動(バックアップ、採用の契機、版 1 の定義を版 2 へ移すこと)は `surfaceSave` と同じである。本文は本体と `bindings` を 1 つにした定義(保存するファイルと同じ形)。`GET` は保存したファイルをそのまま返す(版 1 のファイルは、ブリッジが一度読み込んだ時点で版 2 に書き直されている)。

## 接続時とエラー時の動作

1. UI が WebSocket 接続を確立する。
2. ブリッジが `hello`、`link`、`osc.sentLog`(`full: true`。送信の記録の既存分)、`destinations`、`networkSettings` の順に送る。
3. UI は `surfaceRequest` と `osc.padRequest` を送り、`surfaceList`・`surface`・`desired`(`full: true`)・`runtimeOptions`・`desiredStatus` と `osc.padList`・`osc.pad` を受け取って画面と表示値と選択肢と OSC パッドを作る。以後 `heartbeat` に応答し、`link` を状態へ反映する。
4. UI の通常操作はパラメータを上り `set`、レコードの行を上り `setRow` で、アクション(まとめ送り)は上り `batch` で送る。ブリッジは全宛先へ送り、`state` の値を保持値に記録して全 UI へ `desired`(`full: false`)を配る。主系の Unity からのエコーバックは下り `echo` で受け取り、届いたことの確認に使う(保持値は書き換わらない)。
5. JSON 構文、版数、未知キー、未知種別、型タグなどの検証に失敗したフレームは破棄される。接続は維持され、ブリッジが処理した上り不正フレームには可能なら `notice` も返す。
6. 心拍タイムアウトで切断された場合、UI は再接続し、接続後に `surfaceRequest` を送って状態を再取得する。

## ワイヤ見本との対応

すべての実例は `protocol/wire-samples.json` に手書きで収録している。同ファイルの `cases` の `name` と本書の種類は次の対応になる。

| 本書 | `wire-samples.json` の `name` |
|---|---|
| 下り `hello` | `downstream-hello`(拒否例: `downstream-hello-no-adapters`) |
| 下り `osc.message` | `downstream-osc-float` |
| 下り `link` | `downstream-link` |
| 下り `heartbeat` | `downstream-heartbeat` |
| 下り `notice` | `downstream-notice` |
| 下り `surface` | `downstream-surface`、`downstream-surface-with-selector`(拒否例: `downstream-surface-invalid-definition`、`downstream-surface-definition-with-bindings`、`downstream-surface-legacy-version`) |
| 下り `surfaceList` | `downstream-surface-list`、`downstream-surface-list-none-active` |
| 下り `desired` | `downstream-desired-full`、`downstream-desired-partial`、`downstream-desired-records`(拒否例: `downstream-desired-unknown-key`、`downstream-desired-tagged-value`) |
| 下り `echo` | `downstream-echo`(拒否例: `downstream-echo-with-address`) |
| 下り `catalog` | `downstream-catalog`(拒否例: `downstream-catalog-bad-prop-type`、`downstream-catalog-address`) |
| 下り `runtimeOptions` | `downstream-runtime-options`、`downstream-runtime-options-empty`、`downstream-runtime-options-records`、`downstream-runtime-options-records-empty`、`downstream-runtime-options-ui-row-names`、`downstream-runtime-options-pending`(拒否例: `downstream-runtime-options-non-string`、`downstream-runtime-options-keys-non-string`、`downstream-runtime-options-keys-unknown-key`、`downstream-runtime-options-field-choices-missing-field`、`downstream-runtime-options-ui-row-names-length-mismatch`、`downstream-runtime-options-pending-missing-removed`、`downstream-runtime-options-pending-address`) |
| 下り `osc.sentLog` | `downstream-sent-log`、`downstream-sent-log-backlog-empty`(拒否例: `downstream-sent-log-unknown-origin`、`downstream-sent-log-missing-batch`) |
| 下り `destinations` | `downstream-destinations`、`downstream-destinations-all-devices`、`downstream-destinations-networks`、`downstream-destinations-unsaved`、`downstream-destinations-aliases`(拒否例: `downstream-destinations-no-target`、`downstream-destinations-alias-too-long`、`downstream-destinations-missing-alias`) |
| 下り `osc.sentLog` | `downstream-sent-log`、`downstream-sent-log-backlog-empty`、`downstream-sent-log-pad`(拒否例: `downstream-sent-log-unknown-origin`、`downstream-sent-log-missing-batch`) |
| 下り `osc.pad` / `osc.padList` | `downstream-pad`、`downstream-pad-list`、`downstream-pad-list-none-active`(拒否例: `downstream-pad-invalid`) |
| 下り `project` | `downstream-project`、`downstream-project-pad-only`(拒否例: `downstream-project-empty`) |
| 下り `delivery` | `downstream-delivery`、`downstream-delivery-no-param`(拒否例: `downstream-delivery-bad-result`、`downstream-delivery-empty`、`downstream-delivery-negative-elapsed`、`downstream-delivery-osc-address`) |
| 下り `desiredStatus` | `downstream-desired-status-unsent`、`downstream-desired-status-sent`(拒否例: `downstream-desired-status-missing-since`) |
| 下り `networkSettings` | `downstream-network-settings`、`downstream-network-settings-default`(拒否例: `downstream-network-settings-missing-source`) |
| 下り `locks` | `downstream-locks`、`downstream-locks-empty` |
| 下り `blueprintStatus` | `downstream-blueprint-status`、`downstream-blueprint-status-none` |
| 上り `catalogAdopt` | `upstream-catalog-adopt` |
| 上り `lock` / `unlock` | `upstream-lock-param`、`upstream-lock-record-row`、`upstream-unlock`(拒否例: `upstream-lock-without-holder`、`upstream-lock-mixed-ref`) |
| 上り `set` | `upstream-set-float`、`upstream-set-bool`、`upstream-set-trigger`、`upstream-set-with-holder`(拒否例: `upstream-set-typed-arg`、`upstream-set-empty-param`) |
| 上り `setRow` | `upstream-set-row`(拒否例: `upstream-set-row-nul-key`、`upstream-set-row-tagged-value`) |
| 上り `batch` | `upstream-batch`(拒否例: `upstream-batch-empty`、`upstream-batch-address`) |
| 上り `osc.message` | `upstream-osc-multi`、`upstream-osc-record-row`、`upstream-osc-record-row-with-id`(拒否例: `upstream-osc-message-nul-in-address`、`upstream-osc-message-nul-in-string-arg`) |
| 上り `osc.batch` | `upstream-osc-batch`(拒否例: `upstream-osc-batch-empty`、`upstream-osc-batch-lone-surrogate`) |
| 上り `resend` | `upstream-resend-all`、`upstream-resend-target`(拒否例: `upstream-resend-unknown-key`) |
| 上り `reconcile` | `upstream-reconcile`(拒否例: `upstream-reconcile-without-target`) |
| 上り `runtimeOptionsRefresh` | `upstream-runtime-options-refresh`、`upstream-runtime-options-refresh-one-list`(拒否例: `upstream-runtime-options-refresh-unknown-key`、`upstream-runtime-options-refresh-address`) |
| 上り `runtimeOptionsApply` | `upstream-runtime-options-apply-all`、`upstream-runtime-options-apply-one-list`(拒否例: `upstream-runtime-options-apply-address`、`upstream-runtime-options-apply-unknown-key`) |
| 上り `recordKeyAdd` / `recordKeyRemove` / `recordKeyRename` | `upstream-record-key-add`、`upstream-record-key-remove`、`upstream-record-key-rename`(拒否例: `upstream-record-key-add-empty`、`upstream-record-key-rename-empty-name`) |
| 上り `destinationsScan` / `destinationsSelect` / `destinationsReset` | `upstream-destinations-scan`、`upstream-destinations-select`、`upstream-destinations-select-all-devices`、`upstream-destinations-select-networks`、`upstream-destinations-reset`(拒否例: `upstream-destinations-select-missing-all-devices`、`upstream-destinations-select-missing-networks`) |
| 上り `destinationsAlias` | `upstream-destinations-alias`、`upstream-destinations-alias-clear`、`upstream-destinations-alias-over-limit`(拒否例: `upstream-destinations-alias-missing`、`upstream-destinations-alias-too-long`) |
| 上り `osc.padRequest` / `osc.padLoad` / `osc.padSave` / `osc.padPress` | `upstream-pad-request`、`upstream-pad-load`、`upstream-pad-save`、`upstream-pad-press`(拒否例: `upstream-pad-save-path-traversal`、`upstream-pad-press-with-address`、`upstream-pad-press-without-version`) |
| 上り `projectExport` / `projectImport` | `upstream-project-export`、`upstream-project-import`(拒否例: `upstream-project-export-without-request-id`、`upstream-project-import-array`) |
| 上り `networkSettingsSet` | `upstream-network-settings-set`、`upstream-network-settings-set-all-interfaces`(拒否例: `upstream-network-settings-set-missing-ranges`、`upstream-network-settings-set-missing-revision`) |
| 上り `heartbeatAck` | `upstream-heartbeat-ack` |
| 上り `surfaceRequest` | `upstream-surface-request` |
| 上り `surfaceLoad` | `upstream-surface-load`(拒否例: `upstream-surface-load-path-traversal`、`upstream-surface-load-reserved-name`) |
| 上り `surfaceSave` | `upstream-surface-save`(拒否例: `upstream-surface-save-hidden-name`) |

見本には、単一引数でも配列を保持する例、blob の base64、`osc.batch`、空バッチ、および異常系（旧配列形式、未知キー、`v:2`、未知種別、不正な型タグ）が含まれる。撤去したフレーム(`manifest`・`manifestRequest`・`link` の `manifest` 項目)が拒否されることを示す無効サンプル(`downstream-manifest-retired`、`upstream-manifest-request-retired`、`downstream-link-retired-manifest-field`)も残している。実装時は `direction`、`valid`、`frame` を照合し、正しいフレームの全種類と拒否規則を本書の記述どおりに実装する。

## 互換性と更新順序

マニフェスト経路の撤去(D-051)で、`manifest`・`manifestRequest` フレーム、`hello` の `expectedProjectId`、`link` の `manifest` / `lastRejection` は無くなった。撤去前の UI クライアントと新しいブリッジ(またはその逆)は、未知キー・未知種別の拒否により組み合わせられない。同じく、OSC 専用のフレームを `osc.*` へ改名し `hello` に `adapters` を足した版(HID-373・D-110)と、共通のフレームをパラメータ ID の語彙へ移した版(HID-389・D-117)の前後の UI とブリッジも組み合わせられない(`v` は 1 のまま。ブリッジと UI は同じランチャーで一緒に起動する前提のため、版数は上げていない)。第三の UI クライアントを追加・更新する場合は、まず本書と `wire-samples.json` に合わせて UI クライアントを更新し、動作確認後にブリッジを更新する順序にする。
