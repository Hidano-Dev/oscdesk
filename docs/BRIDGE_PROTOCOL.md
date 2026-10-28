# ブリッジ接続仕様

この文書は、`oscdesk-bridge` と UI クライアントの間で交換する WebSocket フレームの正典である。新しい UI クライアントは、この文書と `protocol/wire-samples.json` だけを参照して実装できる。

## 前提と接続

ブリッジは Unity との OSC/UDP 通信と、UI クライアントとの WebSocket 通信を中継する。UI クライアントはブリッジの WebSocket ポートへ接続し、1 WebSocket メッセージにつき 1 個の JSON オブジェクトを送受信する。フレームはすべて UTF-8 JSON であり、配列形式や未知のキーは使用しない。

この接続には認証機構がない。`0.0.0.0` で待ち受ける構成を含むため、信頼された LAN 内だけで使用し、インターネットや信頼できないネットワークへ公開してはならない。

ただしブラウザを踏み台にした接続は塞ぐ(D-082)。ブリッジは `Origin` ヘッダ付きの WebSocket ハンドシェイク(ブラウザ発)を HTTP 403 で拒否し、`(WARN, BRIDGE)` に記録する。ブラウザは `Origin` を必ず付け、ページ側から外せない。正規の UI クライアント(NiceGUI のサーバ側の `websockets`)は付けないので影響を受けない。ブラウザから直接つなぐ第三のクライアントは、現状では対象外(許可リストは設けていない)。

### ブリッジの起動

リポジトリのルートで Node.js 20 以降と pnpm を用意し、次を実行する。

```powershell
corepack pnpm install
corepack pnpm --filter @oscdesk/bridge run build
node packages/bridge/dist/oscdesk-bridge.js --config config/oscdesk.config.json
```

保管フォルダは設定の `surfaces.dir`(既定 `surfaces`、実行時のカレントディレクトリ基準)、起動時に採用する定義は `surfaces.defaultName`(省略可)で指定する。保持値(後述の `desired`)の保存先は `surfaces.valuesDir`(省略時は `<surfaces.dir>/.values`)で、定義名ごとに `<name>.values.json` を置く(`DESIGN.md` D-058)。OSC パッド(後述の `pad`)の保管先は `surfaces.padsDir`(省略時は `<surfaces.dir>/pads`)で、パッド名ごとに `<name>.json` を、採用中のパッドの名前を `.active.json` に置く(D-080)。

宛先パネル(後述の `destinations`、`DESIGN.md` D-078 / D-086)の選択の保存先は `destinations.file`(省略時は `<保持値の保存先>/.destinations.json`。先頭のドットでサーフェス名と重ならない)、LAN 走査の時間上限は `destinations.scanTimeoutMs`(1,000〜60,000、既定 8,000)、端末の名前(D-092)の保存先は `destinations.aliasesFile`(省略時は `<保持値の保存先>/.device-aliases.json`)で指定する。どれも省略できる(`"destinations"` ブロックごと省いてよい)。選択を保存していない間は `unity`(主系 + 副系)が送り先で、保存した選択はそれより優先する。

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

### OSC 引数の型タグ

`osc` の `args` は、引数が 1 個でも必ず配列で、順序を保つ。各要素は次のいずれかのオブジェクトである。

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

ブリッジから UI へ送る種類は次の 13 種類である。操作対象の定義は OscDesk 側のサーフェス定義(`surface`)で配り、値の正はブリッジが持つ(`desired`)。Unity が実行時に持つ文字列の一覧は `runtimeOptions` で、ブリッジが Unity へ送った OSC の記録は `sentLog` で、OSC パッドは `pad` / `padList` で、送り先の選択と LAN 走査の結果は `destinations` で配る。Unity からマニフェストを受け取る経路は撤去した(DESIGN.md D-051)。

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
  "pingIntervalMs":2000,"debug":false
}
```

### `osc` — Unity から受信した OSC

Unity から受信した通常の OSC(主にエコーバック)を UI へ配信する。`from` は受信元の UDP ピアで、`host` は文字列、`port` は 1〜65535 の整数である。配信するのは主系のエコーだけで、副系のエコーは UI へ流さない(保持値との食い違いの警告にだけ使う)。`/sys/*` と `/oscdesk/*` は予約アドレスとして UI へ流さない。採用中の定義の `optionsFrom.address`(一覧)と `optionsFrom.request`(要求のエコー)に届いたものも `osc` としては流さない(一覧は `runtimeOptions` で配る)。

```json
{"v":1,"type":"osc","address":"/avatar/blend/smile",
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

ブリッジが採用した定義(`DESIGN.md` の D-043、`protocol/surface-definition.schema.json`)を配る。`name` は保管名(後述の名前規則)、`revision` はブリッジが採用するたびに 1 ずつ増える正整数(ブリッジの再起動で 1 に戻る。同じ内容の再採用でも増える)、`at` は採用時刻(ISO 8601、オフセット付き)、`definition` は検証済みの定義である。定義の検証に通らないフレームは UI も捨てる。

```json
{"v":1,"type":"surface","name":"stage","revision":1,"at":"2026-10-08T10:00:00.000Z","definition":{"format":"oscdesk-surface","version":1,"name":"Stage","parameters":[],"screens":[]}}
```

採用は次の契機で起き、そのたびに**全 UI へ** `surface`、続けて `surfaceList` を送る。

- 起動時に設定 `surfaces.defaultName` の定義を読み込めたとき(UI の接続前なので、UI は `surfaceRequest` で取得する)
- 上り `surfaceSave`(`activate` が `false` でない)または HTTP `PUT` で保存したとき
- 上り `surfaceLoad` で読み込んだとき

不正な定義は採用しない。直前の定義を維持し、要求した UI だけへ `notice`(`level: error`、`code: surface-rejected`、`detail` に理由)を返す。フォルダ上のファイルを手で書き換えても自動では再配信しない。反映するには `surfaceLoad` を送る。

#### アクション(`actions` と `kind: "action"`、HID-166)

定義の最上位に省略可能な `actions` 配列を持てる。アクションは「押すと複数のメッセージをこの順に 1 つの `oscBatch` で送る」ボタンの中身で、パラメータ層に置く。画面層は `{"kind":"action","action":"<id>"}` のノード(任意で `label` と `width`)で配置するだけである。ブリッジは `actions` を解釈せず、`oscBatch` として受け取って送る。

```json
"actions":[{"id":"applyAll","label":"Apply all","steps":[{"match":"/slot/*"},{"param":"apply"}]}]
```

- `steps`(1 件以上)の要素は次のどちらか。
  - `{"param":"<パラメータ id>"}` — そのパラメータ 1 件。`value` を足すと固定値を送る(`state` のみ。型・値域・`options` に収まること。`trigger` は自身の `value` を送るので上書きできない)。`value` が無ければ、`state` は UI が持つ現在値、`trigger` は定義の `value` を送る。
  - `{"match":"<アドレスパターン>"}` — アドレスが合う**全パラメータ**を定義順に送る。`*` は 1 パート(`/` で区切られた部分)内の 0 文字以上に一致し、`?` `[]` `{}` は使えない。1 件も当たらないパターンは定義として無効。
- 展開後の総数は 512 以下(`oscBatch` の上限)。超える定義は無効。
- 操作しても単独では送りたくないパラメータは `standalone: false` にする(部品を動かしても何も送られず、アクションを押したときだけ送られる)。ブリッジは `standalone: false` のパラメータを保持値にも再送にも含めない。
- 送信後、UI は対象アドレスの Unity からのエコーを 2 秒待つ(`state` は値が一致するもの、`trigger` は値を問わず届いたもの)。揃えば「送信しました」、揃わなければ未達のアドレスを挙げて警告する。再送はしない。
- 現在値がまだ無い `state`(`default` が無く未操作)は送らず、その旨を UI が警告する。
- アクションと `actions` の編集 UI は無い。JSON のアップロードかファイルの手編集で作る(パラメータの改名・削除には追従する)。

#### 実行時の候補(`optionsFrom`、HID-204)

`type: "s"` かつ `kind: "state"` のパラメータは、Unity が実行時に持つ文字列の一覧を候補として受ける宣言 `optionsFrom` を持てる(`DESIGN.md` D-053 / D-054)。一覧は定義を書き換えない「値」で、Unity は `address` へ `s` 引数を N 個並べた 1 メッセージで返す。

```json
{"id":"segment1","address":"/member/1/segment","label":"Segment","type":"s","kind":"state","options":["(none)"],"default":"(none)","optionsFrom":{"address":"/mb/segments","request":"/mb/segments/get"}}
```

- `address`(必須)— 一覧が届くアドレス。`request`(省略可)— 一覧の要求を送るアドレス(引数なし)。省略時は Unity の自発送信だけを待つ。どちらも具体アドレスで、`/sys/*` `/oscdesk/*` は使えない。
- `address` と `request` は、どのパラメータのアドレスとも重ねられない。`request` はどの `optionsFrom.address` とも重ねられない(要求のエコーが空の一覧として届くため)。複数のパラメータが同じ `address`・`request` を参照するのは可。
- 静的な `options` は省略可。書いた場合は一覧の先頭に固定で付く候補になる。`default` とアクションの固定値は、静的な `options` に無くてもよい。
- 部品のヒント `select` は、静的な `options` が無くても `optionsFrom` があれば指定できる。
- ブリッジの保持値(`desired`)と UI の入力欄も、`optionsFrom` を持つパラメータでは静的な `options` への所属を問わない。
- ブリッジは一覧を宛先ごとに受け取り、和集合を下り `runtimeOptions` で配る(後述)。UI の選択欄への反映は HID-206、Unity の受け口は HID-207 で扱う。それまで UI は `runtimeOptions` を読み捨て、静的な `options` があればそれだけの選択欄、無ければ(`select` を指定していても)入力欄を出す。

#### レコード型パラメータ(`records` と `kind: "record"`、HID-214)

個数が実行時に変わる対象(例: メンバー)は、定義の最上位に省略可能な `records` 配列で宣言する(`DESIGN.md` D-059 / D-061)。レコードは 1 アドレスの 1 メッセージで 1 行を運び、引数は**先頭が `s` のキー**、続いてフィールドを宣言順に並べたもの(`[s:key, ...fields]`)である。キー(行)の一覧は `keysFrom` のアドレスへ Unity が返す値で、定義は個数を持たない。

```json
"records":[
  {"id":"member","address":"/vp/member","label":"メンバー","kind":"state",
   "key":{"label":"メンバー名"},
   "keysFrom":{"address":"/vp/members/list","request":"/vp/members/request"},
   "fields":[
     {"id":"active","label":"Active","type":"bool","default":false},
     {"id":"slot","label":"Slot","type":"i","range":[1,64],"step":1,"default":1},
     {"id":"segment","label":"Segment","type":"s","options":["(none)"],
      "optionsFrom":{"address":"/vp/segments/list","request":"/vp/segments/request"},"default":"(none)"}]},
  {"id":"memberUpdate","address":"/vp/member/update","label":"Update","kind":"trigger",
   "keysFrom":{"address":"/vp/members/list","request":"/vp/members/request"},"fields":[]}]
```

上の `member` の 1 行は `/vp/member  s:"メンバーA"  i:1  i:3  s:"(none)"`(`bool` は D-017 どおり `i` の 0 / 1)、`memberUpdate` は `/vp/member/update  s:"メンバーA"` になる。

- **レコード**: `id`(パラメータ id と重ねない)、`address`(具体アドレス)、`label`、`kind`(`state` / `trigger`)、`key`(省略可。`{ label? }` でキーの表示名)、`keysFrom`(必須。`{ address, request?, source?, max? }`。`source` を省くか `"unity"` なら `optionsFrom` と同じく Unity が `address` へ返す一覧。`"ui"` なら UI で追加・削除し、ブリッジが追加順に保持・保存して `address` へ `s` の並びで Unity に送る一覧で、`request` は持てず、`max`(1〜1000)で上限を書ける。`max` は `"ui"` にだけ書ける。同じ `address` を共有するレコードは `source` と `max` を揃える。`"ui"` の `address` は `optionsFrom` に使えない。D-075)、`fields`(`state` は 1 件以上、`trigger` は 0 件以上)。キーの型は `s` だけで、型の欄は無い。`standalone` は無い
- **フィールド**: `id`(レコード内で一意)、`label`、`type`(`i` / `f` / `s` / `bool`)と、型ごとの `range` `step` `options` `optionsFrom` `default` `value`(パラメータと同じ規則。`optionsFrom` は `s` だけ)。`kind` と `standalone` は持たない
  - `state` レコード: `default` 必須、`value` 不可(新しいキーの行はフィールドの `default` で作る)。`optionsFrom` を持つ `s` は `default` が静的な `options` に無くてよい
  - `trigger` レコード: `value` 必須(固定値)、`default` `range` `step` `options` `optionsFrom` 不可
- **アドレスの衝突**: 値のアドレス(全パラメータと全レコードの `address`)は互いに重ねない。一覧のアドレス(全 `optionsFrom.address` と全 `keysFrom.address`)と要求のアドレス(全 `optionsFrom.request` と全 `keysFrom.request`)は値のアドレスと重ねない。要求のアドレスは一覧のアドレスと重ねない。同じ一覧・同じ要求を複数の箇所で共有するのは可で、`keysFrom.address` と別の欄の `optionsFrom.address` が同じ一覧を指してもよい
- **アクション**: アクションに省略可能な `scope`(`"row"` / `"all"`)を足した。`scope` を持つアクションは `{"record":"<レコード id>","value":{"<フィールド id>":<固定値>}}` の step だけを持ち、その全レコードが同じ `keysFrom.address` を持つ。`state` レコードは行の現在値を送り、`value` に書いたフィールドだけ固定値で上書きする(値はフィールドの型・値域・`options` に収まること。`optionsFrom` を持つ `s` は所属を問わない)。`trigger` レコードはフィールドの `value` を送り、`value` は書けない。`scope` の無いアクションは `record` step を持てない。展開は UI が行い、`row` は押した行のキーについて steps を定義順に、`all` は表示中の全行について行ごとに steps を定義順に並べ(行 1 の全 step → 行 2 の全 step …)、1 つの `oscBatch` で送る。`all` の件数は行数で決まるので定義では上限を見ず、展開後に 512 件 / 60 KiB を超えたら UI が送らずに通知する
- **画面層**: `{"kind":"record","record":"<レコード id>","label":?,"width":?,"columns":?,"rowActions":?,"tableActions":?}` でレコード表を置く。`columns` は `[{"field":"<フィールド id>","widget":?,"label":?,"actions":?,"toggle":?}]` で列の順序・部分集合・部品のヒント(省略時は全フィールドを定義順。同じ `field` の重複・未知の `field` は不可。`widget` はフィールドを「`kind` がレコードの `kind` のパラメータ」とみなして合うこと)。列の `actions` は表の枠内で見出しの直下(行の並びの上の一括操作の行。D-076)のその列の下に出す `scope: "all"` のアクション id で、列の一括操作(例: 全行の Active を On / Off)の置き場である(`DESIGN.md` D-066。`columns` を省略した表には置けない)。列の `toggle` は `{"label":"<共通ラベル>","on":"<アクション id>","off":"<アクション id>"}` で、同じ一括操作の行にラベルとスイッチ 1 つの一括トグルを出す(D-073。`bool` のフィールドの列に限る。表示は全行オンでオン・全行オフでオフ・混在で不定、操作でオンなら `on`、オフなら `off` の `scope: "all"` のアクションを送る)。`rowActions` は各行の末尾に出す `scope: "row"` のアクション id。`tableActions` は表の右側に行の並びいっぱいの縦長ボタンで出す `scope: "all"` のアクション id で、表全体の確定(例: Update All)の置き場である(D-074)。いずれも、そのアクションのレコードはこの表のレコードと同じ `keysFrom.address` を持つこと。`{"kind":"action"}` ノードは `scope: "row"` のアクションを置けない(行が決まらない)。`{"kind":"control"}` はレコード id を参照できない。行の並び順は UI の規則(キーの一覧の順 → 一覧に無いが保持値を持つキー)で、定義には書かない
- **UI で管理する行の ID と Name**(`keysFrom.source: "ui"`、`DESIGN.md` D-087): 行はブリッジが追加のときに振るランダムな ID(UUID)で指し、Name は別に持つ編集できるラベルである。行の引数は `[s:ID, s:Name, ...fields]`(`trigger` も同じ)で、以下の「キー」はこのレコードでは ID を指す。`keysFrom.address` へ Unity に送る一覧は ID の並び。Name は同じ一覧の中で重複も空も不可
- **ワイヤ**: 上り `osc` / `oscBatch` は 1 行 = 1 メッセージ(`address` = レコードの `address`、`args` = `[s:key, ...fields]`。UI で管理する行は `[s:ID, s:Name, ...fields]`)。`state` の欄を 1 つ編集しても行の全フィールドを載せる。保持値(`desired`)はキーごとに 1 エントリ、キーの一覧と選択肢は `runtimeOptions` の `keys` / `fieldChoices`(後述)。ブリッジは `state` のレコードをキーごとに保持・再送・保存する(後述の `desired`。`DESIGN.md` D-062)。`trigger` のレコードは保持せず、通常どおり中継するだけ。UI のレコード表は HID-216、Unity の受け口は HID-217 で扱う

### `surfaceList` — 保存済み定義の一覧

保存済みの名前の一覧(昇順)と、採用中の名前(未採用なら `null`)を送る。

```json
{"v":1,"type":"surfaceList","names":["stage","stage-b"],"active":"stage"}
```

### `desired` — ブリッジが保持する狙いの値

値の「正」はブリッジが持つ(`DESIGN.md` D-045)。採用中の定義の `kind: state` のパラメータごとに、最後に UI が操作した値(未操作なら定義の `default`。`default` が無ければ値なし)を保持し、`osc` フレームの Unity エコーでは書き換えない。

- `full: true` — 保持値の全量。UI は表示中の値を丸ごと置き換える。定義の採用のたびに全 UI へ、`surfaceRequest` の応答として要求元へ(`surface`・`surfaceList` の後)送る。
- `full: false` — 変更分のみ。UI の `osc` / `oscBatch` で保持対象のアドレスが更新されたとき全 UI へ送る(操作した UI 自身にも届く)。

```json
{"v":1,"type":"desired","full":true,"values":[{"address":"/light/level","args":[{"type":"f","value":0.5}]}]}
```

`state` のレコード(前述)の保持値は**キーごとに 1 エントリ**で、`{ "address": レコードの address, "args": [s:key, ...fields] }` の形になる(同じ `address` が行の数だけ並ぶ。UI で管理する行は `[s:ID, s:Name, ...fields]` で、Name はその時点の一覧の Name。D-087)。`full: true` は全パラメータと全レコードの全キーを、`full: false` は変わったキーだけを含む。フレームの形は変わらない(`DESIGN.md` D-061 / D-062)。

- **並び**: `full: true` ではパラメータを定義順に並べた後、レコードを定義順に、各レコードの行を「行ができた順」に並べる。UI の表の行の順は UI が決める(キーの一覧の順が先。D-064)
- **行の生成**: 反映済みのキーの一覧(どの宛先から届いたものでも。後述の `runtimeOptions` の「反映」)に、まだ行の無いキーが現れると、ブリッジはフィールドの `default` で行を作り、到達可能な宛先へその行を 1 メッセージずつ送り、作った行だけの `desired`(`full: false`)を全 UI へ配る。同じ契機の `runtimeOptions` が先に届く。まだ到達していない宛先には、初回の到達・回復の再送で届く。定義の採用時に、引き継いだ一覧に行の無いキーがあれば同じく作る(この場合は採用の `full: true` に載る)。届いたが反映していない一覧のキーでは行を作らず、Unity へも送らない(`DESIGN.md` D-088)
- **保持の更新**: 上り `osc` / `oscBatch` と OSC ネイティブ UI の中継で、レコードの `address` に「先頭が空でない `s` のキー + フィールドの数・型が一致 + 値域・`options` に収まる(`optionsFrom` を持つ `s` は所属を問わない)」1 行が来たときだけ、そのキーの行を置き換える。合わないものは保持しないが、Unity へは通常どおり送る(パラメータと同じ)。一覧に無いキーでも正しい行なら保持する
- **一覧から消えたキー**: 行は残り、再送も続ける。キーの改名は別キーとして扱い、古いキーの行は残る(Unity の一覧から行ができるレコード。UI で管理する行は ID が変わらないので、改名しても同じ行のまま。D-087)
- **UI で管理する行の Name**: 上り `osc` / `oscBatch` で一覧にある ID の行が来たら、ブリッジは Name を一覧の今の Name に揃えてから Unity へ送り、保持する(改名の直後に古い画面が古い Name のまま送っても、今の Name で届く)。一覧に無い ID の行は従来どおり Unity へは送るが保持しない
- **定義の再採用**: 同じ `id`・`address` の `state` レコードは、行ごとにフィールド単位で引き継ぐ(フィールドの `id` と型が一致し、値が値域に収まるものだけ。残りは `default`)。引き継ぎで行の中身・並びが変わった行だけを、採用時に到達可能な宛先へ送る。`id` が変わったレコード、`trigger` になったレコードの行は捨てる

```json
{"v":1,"type":"desired","full":false,"values":[
  {"address":"/vp/member","args":[{"type":"s","value":"メンバーA"},{"type":"i","value":1},{"type":"i","value":3},{"type":"s","value":"(none)"}]}]}
```

`kind: trigger` のパラメータは保持も配信もしない。ブリッジは次の契機で保持値を Unity へ再送する(`kind: state` のみ。UI の操作とは別にブリッジが送る)。

- Unity が初めて pong を返したとき、および到達不能から回復したとき(その宛先だけへ。Unity の再起動はこの喪失→回復で検知する。ping 間隔より速い再起動は検知できないため、上り `resend` で補う)
- 定義を採用した時点で到達可能な宛先へ(採用で値が決まり直したアドレスだけ。引き継いだ値は送らない)
- 上り `resend` を受けたとき

レコードの行は、どの契機でもキーごとに 1 メッセージ(個別送信)で送る。`trigger` のレコードは再送しない。

Unity のエコーが保持値と食い違う場合も保持値は変えず、ブリッジが警告ログを 1 回出す(同じアドレスは一致に戻るまで繰り返さない。レコードは行ごとに数え、ログにキーを含める)。`osc` フレームはそのまま UI へ流れる。

保持値はブリッジ再起動をまたいで残る(`DESIGN.md` D-058)。ブリッジは保持値が変わったときと定義の採用のときに、定義名ごとのファイル(`surfaces.valuesDir`、省略時 `<surfaces.dir>/.values/<name>.values.json`)へ 500 ms 間引いて書き、起動後最初の採用でそのファイルを読む。採用中の定義と id・アドレス・型が一致し、値域(`range` / `options`。`optionsFrom` を持つ `s` は所属を問わない)に収まる値だけを戻し、残りは `default` から始める。戻した値は最初の `desired`(`full: true`)にそのまま載り、Unity へは上記の契機(初回の到達など)で送られる。稼働中の再採用・定義の切り替えはファイルを読まず、従来どおりメモリ上の値を引き継ぐ。ファイルが壊れていれば警告ログを出して `default` から始め、起動は止めない。フレームの形は変わらない。

レコードの行もキー単位で同じファイルに保存し、同じ時機に戻す(`DESIGN.md` D-062)。戻すのは、採用中の定義に同じ `id`・`address` の `state` レコードがある行で、フィールドは `id` と型が一致し値域に収まるものだけを戻し、残りは `default` にする。キーの一覧に無いキーの行も戻す(一覧は再起動後に届き直す)。戻した行は、一覧に現れても作り直さない。

保存ファイルの形式(`version: 3`)は次のとおり。`version: 1`(`records` の無い HID-211 の形式)と `version: 2`(UI で管理する一覧が Name の並びで、行のキーも Name だった形式)も読み、次の保存で `version: 3` に書き直す。

```json
{
  "format": "oscdesk-desired-values",
  "version": 3,
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
- 引数は `i`(int32)・`f`(有限)・`s` だけで、blob は受けない。未知のキー・版は「壊れたファイル」として扱う

### `runtimeOptions` — Unity が実行時に持つ文字列の一覧

採用中の定義の `optionsFrom`(前述)に Unity が返した一覧を配る(`DESIGN.md` D-053 / D-055)。毎回全量で、UI は丸ごと置き換える。

ブリッジは一覧を「届いた一覧」と「反映済みの一覧」に分けて持つ(`DESIGN.md` D-088)。`lists`・`choices`・`keys`・`fieldChoices` はすべて反映済みの一覧から作り、届いた一覧が反映済みの一覧と食い違う間は、その出所を `pending` に載せる。収録に使っていない PC で誤って起動した Unity が一覧を返しても、操作者が反映するまで画面の行と選択肢が変わらないようにするためである。

```json
{"v":1,"type":"runtimeOptions",
 "lists":[{"address":"/mb/segments","targets":[
   {"name":"unity","options":["Intro","Song A"]},
   {"name":"backup","options":["Song A","Song B"]}]}],
 "choices":[{"param":"segment1","options":["(none)","Intro","Song A","Song B"]}]}
```

- `lists` — 定義が参照する一覧のアドレスごとに 1 件(定義順)。`targets` は反映済みの一覧がある宛先だけを `hello.targets` の順に並べ、まだ無い宛先は含まない(空の `targets` は「まだ届いていない」、空の `options` は「その台には名前が無い」)。宛先ごとの一覧は、Unity が返した順のまま(重複も含めて)載せる。ブロードキャストの宛先(D-079)で複数のホストの一覧を反映していれば、その宛先の `options` はホストの一覧の和集合(最初に届いたホストの順、重複を除く)になる。
- `choices` — `optionsFrom` を持つパラメータごとに 1 件(定義順、`param` はパラメータの `id`)。選択肢は、静的な `options` → 主系の一覧の順 → 副系にしか無い名前を `hello.targets` の順に続けたもので、重複は除く。UI はこれをそのまま選択欄の候補にする。
- `keys`(省略可、HID-214)— `keysFrom` を持つ全レコードごとに 1 件 `{ "record": <レコード id>, "keys": [<キー>...] }`(定義順)。キーは主系の一覧の順 → 副系にしか無い名前を `hello.targets` の順に続けた和集合で、重複と空文字を除く。一覧が未着なら `keys: []`。`keysFrom.source: "ui"` のレコードは、`keys` が追加順の行の ID で、同じ並び・同じ数の `names`(Name)を足す(D-087。`{ "record": "mb", "keys": ["<ID>"...], "names": ["MB 1"...] }`)。`names` はそれ以外のレコードには付かない
- `fieldChoices`(省略可、HID-214)— `optionsFrom` を持つレコードのフィールドごとに 1 件 `{ "record", "field", "options" }`(定義順)。順序の規則は `choices` と同じ。
- `keys` と `fieldChoices` はブリッジが常に送る(レコードが無ければ空の配列)。UI は欄が無ければ空として扱う。`lists` には `keysFrom.address` の一覧も含める(一覧のアドレス単位で、`optionsFrom` と同じ一覧を指していれば 1 件にまとまる。宛先ごとの一覧は空文字も含めて届いたまま載せ、`keys` からだけ空文字を除く)。
- `pending`(省略可、D-088)— 届いたが反映していない一覧。届いた一覧と反映済みの一覧が食い違う出所ごとに 1 件 `{ "address", "target", "host"?, "added", "removed" }` を、一覧のアドレスの定義順 → `hello.targets` の順 → (ブロードキャストの宛先では)ホストが最初に答えた順に並べる。`host` はブロードキャストの宛先でだけ付き、一覧を返したホスト。`added` / `removed` は反映済みの一覧から見た名前の増減(重複を除き、届いた一覧・反映済みの一覧の順)で、両方が空なら並びだけが違う。食い違いが無ければ空の配列。ブリッジは常に送り、UI は欄が無ければ空として扱う。
- キーの一覧は `optionsFrom` の一覧と同じ仕組み(下記の受け取り・保持・反映・送る契機・要求)で扱う。キーの一覧の反映で新しい行ができたときは、この `runtimeOptions` に続けて作った行の `desired`(`full: false`)が届く(前述)。

```json
{"v":1,"type":"runtimeOptions",
 "lists":[{"address":"/vp/members/list","targets":[{"name":"unity","options":["メンバーA","メンバーB"]}]},
          {"address":"/vp/segments/list","targets":[]}],
 "choices":[],
 "keys":[{"record":"member","keys":["メンバーA","メンバーB"]},{"record":"memberUpdate","keys":["メンバーA","メンバーB"]}],
 "fieldChoices":[{"record":"member","field":"segment","options":["(none)"]}]}
```

- **受け取り**: ブリッジは `optionsFrom.address` に届いた 1 メッセージを、その出所の届いた一覧として置き換える。出所は宛先で、ブロードキャストの宛先(D-079)では一覧を返したホストごとに分けて持つ(同じ宛先名で複数のホストが答えても、後から届いた方が上書きしない)。引数はすべて `s` で、0 個(空の一覧)も可。`s` 以外を含むメッセージは捨てて警告ログを 1 回出す。Unity の宛先以外(OSC ネイティブ UI の端末など)から届いたものは受けない。副系から届いた一覧も受ける。
- **反映**: その宛先にまだ反映済みの一覧が無い(ブリッジ起動後・宛先の追加後・定義で一覧のアドレスが新しく現れた後の最初の一覧)ときは、届いた一覧をそのまま反映する(初報)。初報の判定は宛先ごとで、ブロードキャストの宛先に後から答えたホストの一覧は初報として扱わない。それ以外の変化は届いた一覧に入るだけで、上り `runtimeOptionsApply`(後述)を受けるまで反映しない(`pending` に載り、ブリッジは `Holding option list ... until it is applied from the UI.` をログに出す)。届いた一覧が反映済みの一覧に戻れば `pending` から消える。宛先の差し替え(D-078)は、外した宛先と別の宛先に差し替えた同じ名前の宛先の一覧(届いた一覧も反映済みの一覧も)を捨ててすぐ配り直し、その宛先の次の一覧は初報として反映する。
- **保持**: 到達不能になった台の一覧は最後に受けたものを残す。定義の再採用では、参照が残るアドレスの一覧(届いた一覧と反映済みの一覧)を引き継ぎ、参照が消えたアドレスの一覧は捨てる。ブリッジ再起動では保存しない(反映済みの一覧も起動のたびに初報から始める)。
- **送る契機**: Unity から届いた一覧で、反映済みの一覧か反映待ちの状態(`pending`)が変わったとき(同じ一覧の繰り返しでは送らない)、`runtimeOptionsApply` で反映済みの一覧が変わったとき、宛先の差し替えで中身が変わったとき、定義を採用したとき(`desired` の後。中身が変わっていなくても送る)に全 UI へ。`surfaceRequest` の応答として要求元へ(`desired` の後)。定義が無いときは送らない。
- **要求**: ブリッジは `optionsFrom.request` へ引数なしの OSC を送る。契機は、その宛先が初めて pong を返したとき、喪失から回復したとき(その宛先だけ)、到達可能な状態で定義を採用し新しい一覧のアドレスか要求のアドレスが増えたとき(到達可能な宛先)、上り `runtimeOptionsRefresh` を受けたとき(全宛先。`request` 付きならその要求だけ)。`request` の無い一覧は Unity の自発送信を待つだけで、いつ届いても受ける。
- 保持値(`desired`)は一覧に左右されない。一覧に無い名前も保持し、一覧から消えた名前も再送し続ける。
- 一覧のアドレスは Unity から OscDesk への向きだけで使う。上り `osc` で一覧のアドレスへ送っても Unity へは送らず(警告ログのみ)、それを含む `oscBatch` は `batch-rejected` で拒否する。

### `sentLog` — Unity へ送った OSC の記録

ブリッジが Unity へ実際に送った OSC の直近の記録を配る(`DESIGN.md` D-067)。UI はこれを表示するだけで、保持値にも確認にも使わない。完全な証跡は debug 起動時の NDJSON 診断ログ(`logs/diagnostics/*.ndjson`、D-031)であり、この記録はブリッジのメモリにだけある揮発する窓である(ブリッジ再起動で消え、`seq` は 1 に戻る)。

```json
{"v":1,"type":"sentLog","full":false,"records":[
  {"seq":41,"at":"2026-10-14T10:00:00.250Z","origin":"ui","targets":["unity","backup"],
   "address":"/mix/master","args":[{"type":"f","value":0.75}],"count":12,"batch":null,"clipped":false},
  {"seq":42,"at":"2026-10-14T10:00:01.000Z","origin":"action","targets":["unity"],
   "address":"/slot/01","args":[{"type":"f","value":0.25}],"count":1,"batch":{"id":3,"index":0,"size":2},"clipped":false}]}
```

- **記録の単位**: 1 メッセージにつき 1 件。全宛先へ同じものを送った場合は 1 件にまとめ、`targets` に送った宛先の名前(`hello.targets[].name`)を並べる。宛先ごとに送る再送・行の生成・一覧の要求は、宛先ごとに 1 件になる
- **`origin`**(送った契機): `ui`(上り `osc`)、`action`(上り `oscBatch`)、`resend`(保持値の再送。初回到達・回復・定義の採用・上り `resend`)、`row`(キーの一覧に現れた新しい行)、`request`(`optionsFrom.request` / `keysFrom.request` への要求)、`relay`(OSC ネイティブ UI の中継)、`pad`(上り `padPress`。OSC パッドの押下)。`/sys/ping` と、要求元へ直接返す `/oscdesk/*` の応答は記録しない
- **`seq`**: ブリッジの起動ごとに 1 から振る正整数。**`at`**: 最後に送った時刻(ISO 8601、オフセット付き)
- **`count`**(間引き): `ui` と `relay` で(`pad` はまとめない。押した 1 回ずつを時刻つきで残す)、直前の記録と同じ契機・宛先・アドレス(レコードは先頭の `s` のキーも同じ)への送信が、その記録の最初の送信から 1,000 ms 以内に続いたときは、新しい記録を作らずに直前の記録の `count` を増やし、`at` と `args` を最後の送信のものにする。更新した記録は**同じ `seq` のまま**届き直す
- **`batch`**: `oscBatch` の各メッセージは `{ id, index, size }`(`id` はバッチごとに 1 から振る番号、`index` はバッチ内の 0 始まりの位置、`size` はバッチのメッセージ数)。それ以外は `null`(省略しない)。`targets` は bundle を送れた宛先(主系 + 送れた副系)
- **`clipped`**: 表示用に引数を切り詰めたとき `true`。`s` は 120 文字、`b` は先頭 32 バイト、引数は先頭 16 個まで。有限でない `f`(NaN など)は JSON で表せないため `s` の文字列にして `clipped: true` にする
- **配る契機**:
  - 接続直後、`hello`・`link` の後に、その UI だけへ保持している全量を送る。先頭のフレームが `full: true` で、UI は手元の記録を捨ててこれで置き換える。続きのフレームは `full: false`。記録が無くても `full: true` の空のフレームを 1 つ送る(ブリッジ再起動後の再接続で古い記録を捨てさせるため)
  - 送信のたびには送らず、新しい記録と更新した記録を **250 ms ごとに**まとめて全 UI へ `full: false` で送る。UI は `seq` をキーに追加・置き換えする
- **上限**: ブリッジは直近 **1,000 件**を保持し、古いものから捨てる(捨てた記録は配らない)。1 フレームは **100 件**まで(超える分は複数のフレームに分ける)。UI の WebSocket クライアントの受信上限(Python `websockets` の既定 1 MiB)に十分収めるため

### `destinations` — 送り先の選択と LAN 走査の結果

UI の宛先パネル(`DESIGN.md` D-078 / D-079 / D-085 / D-086)のための全量。定義に依存しないので、接続直後(`hello`・`link`・`sentLog` の後)にその UI へ送り、以後は走査の開始・終了、選択の変更、ブロードキャストへ新しいホストが pong を返したとき(`primaryHosts` が変わる)に全 UI へ送る。UI は丸ごと置き換える。

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

### `pad` — 採用中の OSC パッド

OSC パッド(`DESIGN.md` D-080)は、サーフェス定義とは別に、ユーザーが自由にアドレスと引数を書いて撃つボタンの格子である。収録回ごとに違う特殊な Unity 実装を発火させる用途で、名前付きで保存・切り替える。正はブリッジが持ち、サーフェス定義の採用とは独立に採用される。`name` は保管名(`surface` と同じ名前の規則)、`revision` は採用のたびに 1 ずつ増える正整数(ブリッジの再起動で 1 に戻る)、`version` は採用ごとに一意な版の印(1〜64 文字の文字列。起動ごとのランダムなエポックと `revision` の組で、ブリッジの再起動をまたいでも重ならない。中身の形は UI が解釈しない)、`at` は採用時刻、`pad` は検証済みのパッドである。パッドの検証に通らないフレームは UI も捨てる。

```json
{"v":1,"type":"pad","name":"take-03","revision":2,"version":"3f9a1c0b7e2d-2","at":"2026-10-18T10:00:00.000Z","pad":{
  "format":"oscdesk-pad","version":1,"rows":2,"columns":4,"buttons":[
    {"id":"b1","row":0,"column":0,"label":"Fire","color":"#E53935","address":"/fx/fire",
     "args":[{"type":"i","value":1},{"type":"s","value":"メンバーA"}]},
    {"id":"b2","row":1,"column":3,"label":"Next","address":"/scene/next","args":[]}]}}
```

- **パッド**: `format`(`"oscdesk-pad"`)・`version`(`1`)・`rows` / `columns`(1〜12)・`buttons`(144 個まで)。未知のキーは不可
- **ボタン**: `id`(英字始まりの `[A-Za-z0-9_-]` 64 文字以内、パッド内で一意)、`row` / `column`(0 始まりのマス。格子の外と重なりは不可)、`label`(64 文字まで。空でもよい)、`color`(省略可。`#rrggbb`)、`image`(省略可。`data:image/png|jpeg|gif|webp;base64,...` の data URL で、1 枚 256 KiB・パッド全体 4 MiB まで。SVG は不可)、`address`(256 文字まで、NUL 不可。サーフェス定義のパラメータと同じ具体アドレスの規則。`/sys/*`・`/oscdesk/*`・パターン文字・空白・空パート・末尾 `/` は不可)、`args`(16 個まで。`i`(int32)/ `f`(float32 へ丸めて有限な数。`1e300` のように float32 では +Inf になる値は不可)/ `s`(1,024 文字まで。NUL は不可)だけ。OSC 1.0 の `T` / `F` は wire に無く、bool は `i` の 0 / 1 で書く)
- **大きさ**: パッドの JSON(区切りの空白なし、UTF-8)は 8 MiB まで。`pad` フレームは全 UI へ配り、UI の受信上限は 16 MiB なので、超えるパッドは保存も採用もしない(`pad-rejected`)。起動時に復元しようとした採用中のパッドが超えていれば、採用せずに警告ログを出す(UI が受け切れないフレームで切断・再接続を繰り返さないように)。この上限はフレームの形式の検査には含めず、保存の正を持つブリッジだけが判定する
- 判定の正典は `packages/shared/src/osc-pad.ts`(zod)で、`protocol/osc-pad-samples.json` を TypeScript と Python の双方のテストが読んで判定の一致を確かめる

採用は次の契機で起き、そのたびに**全 UI へ** `pad`、続けて `padList` を送る。

- 起動時に、前回採用していたパッド(`.active.json`)を読み込めたとき(UI の接続前なので、UI は `padRequest` で取得する)
- 上り `padSave` で保存したとき、上り `padLoad` で読み込んだとき(どちらも `.active.json` を書き換え、ブリッジ再起動後も同じパッドを採用する)

不正なパッドは採用しない。直前のパッドを維持し、要求した UI だけへ `notice`(`level: error`、`code: pad-rejected`、`detail` に理由)を返す。保存は `surfaceSave` と同じく直前の内容を `<padsDir>/.backups/` へ退避してから置き換える(名前ごとに直近 20 件)。

### `padList` — 保存済みパッドの一覧

保存済みの名前の一覧(昇順)と、採用中の名前(未採用なら `null`)を送る。

```json
{"v":1,"type":"padList","names":["take-02","take-03"],"active":"take-03"}
```

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

`oscBatch` の内部予約アドレス、サイズ上限、または送信経路の検査に失敗した場合は、`level` が `error`、`code` が `batch-rejected` の `notice` を送る。`detail` には拒否理由を含める。この場合、バッチ内の OSC は Unity へ一つも送らない。

一覧の `code` は、定義に無い要求の Sync を断った `runtime-options-refresh-rejected` と、Unity から受ける一覧でないアドレスの反映を断った `runtime-options-apply-rejected`(どちらも要求元だけ。`level:"error"`)である。

宛先パネルの `code` は、選択を断った `destinations-rejected`(要求元だけ。`level:"error"`)、走査を打ち切った `destinations-scan-failed`(全 UI。`level:"warn"`)、選択をファイルへ書けなかった・`destinationsReset` でファイルを消せなかった `destinations-save-failed`(全 UI。`level:"error"`。書けなかった選択は `source: "unsaved"` で配る)、端末の名前を断った `destination-alias-rejected`(要求元だけ。`level:"error"`)、端末の名前をファイルへ書けなかった `destination-aliases-save-failed`(全 UI。`level:"error"`。名前は実行中だけ効く)である(後の 2 つは D-092)。

## 上りフレーム（UI → ブリッジ）

UI から送る種類は次のとおりである(OSC パッドの 4 種類は末尾)。

### `osc` — Unity へ送る OSC

`address` と型タグ付き `args` を送る。`from`、`target`、配列形式の旧イベント名などは付けない。ブリッジは設定された全ての Unity 宛先（主系と副系）へ転送し、内部予約アドレスへの送信は拒否する。

```json
{"v":1,"type":"osc","address":"/avatar/pos",
 "args":[{"type":"f","value":0.1},{"type":"f","value":0.9}]}
```

### `oscBatch` — 複数の OSC を 1 データグラムで送る

`messages` に 1 件以上の OSC メッセージを、送信順に並べる。各要素は `address` と `args` だけを持ち、`osc` と同じ型タグ付き引数を使用する。ブリッジはこれを即時タイムタグの OSC bundle 1 個へ変換し、1 データグラムとして全ての Unity 宛先へ送る(主系への送信に失敗したときはバッチ全体を拒否し、副系へも送らない)。ブリッジはメッセージの意味を解釈せず、保持対象のアドレスだけを保持値に記録する。UI のアクション(まとめ送りボタン)がこれを使う。

1 バッチの上限は 512 メッセージ、OSC bundle のエンコード後サイズの実用上限は 60 KiB (60 × 1024 byte) である。空の `messages`、上限超過、内部予約アドレスを含むバッチは拒否する。

```json
{"v":1,"type":"oscBatch","messages":[
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

### `runtimeOptionsRefresh` — Unity の一覧の取り直し

`request` を省くと、採用中の定義のすべての `optionsFrom.request` と `keysFrom.request` へ、全宛先(到達不能の台を含む)に引数なしの OSC を送らせる(UI の「一覧を更新」)。応答の一覧で中身が変われば `runtimeOptions` が全 UI へ届く。ただし、その宛先の初報でなければ応答は届いた一覧に入るだけで、画面に使う一覧は `runtimeOptionsApply` まで変わらない(`pending` に載る。D-088)。変わらなければ何も届かない。`request` を持つ定義が無ければ何もしない。

```json
{"v":1,"type":"runtimeOptionsRefresh"}
```

省略可能な `request`(`/` で始まるアドレス)を付けると、その要求アドレスだけを全宛先へ送らせる(一覧の近くの「Sync」。`DESIGN.md` D-077)。応答の扱いは省いたときと同じで、一覧が変わらなければ何も届かない。`request` が採用中の定義のどの `optionsFrom.request` / `keysFrom.request` でもないとき(定義が無いときを含む)は Unity へ何も送らず、要求元だけへ `notice`(`level:"error"`、`code:"runtime-options-refresh-rejected"`、`detail:"unknown-request: <アドレス>"`)を返す。任意のアドレスへ引数なしの OSC を撒く口にしないためである。

```json
{"v":1,"type":"runtimeOptionsRefresh","request":"/vp/segments/request"}
```

### `runtimeOptionsApply` — 届いた一覧の反映

届いたが反映していない一覧(`runtimeOptions` の `pending`)を反映済みの一覧に取り込ませる(UI の「新しい一覧があります」の「反映」と「すべて反映」。`DESIGN.md` D-088)。`address`(`/` で始まる一覧のアドレス)を付けるとその一覧の全出所を、省くと全一覧を反映する。宛先ごとには反映させない。反映済みの一覧が変われば、`runtimeOptions` を全 UI へ配り、反映したキーの一覧に行の無いキーがあれば `default` で行を作って到達可能な宛先へ送り(送信ログの `origin` は `row`)、`desired`(`full: false`)を配る(前述の「行の生成」)。反映待ちが無ければ何もしない。`address` が採用中の定義の Unity から受ける一覧(`optionsFrom.address` と、`source: "ui"` でない `keysFrom.address`)でないとき(定義が無いときを含む)は何もせず、要求元だけへ `notice`(`level:"error"`、`code:"runtime-options-apply-rejected"`、`detail:"unknown-list: <アドレス>"`)を返す。

```json
{"v":1,"type":"runtimeOptionsApply","address":"/vp/members/list"}
```

### `recordKeyAdd` / `recordKeyRemove` / `recordKeyRename` — レコードの行の追加・削除・改名

`record`(レコード id)と `key`(空でない文字列)を持つ(D-075)。行は同じ `keysFrom.address` を共有する全レコードでまとめて増減する。`keysFrom.source` が `"ui"` のレコードでは、`recordKeyAdd` の `key` は新しい行の Name(ID はブリッジが振る)、`recordKeyRemove` と `recordKeyRename` の `key` は行の ID(D-087)。

- **`recordKeyAdd`**: `keysFrom.source` が `"ui"` なら、新しい ID を振って Name の行を一覧の末尾に足し、`address` へ一覧(ID の並び)の全量を Unity に送り(全宛先)、`runtimeOptions` を全 UI へ配る。既にあるかは Name で判定する。どちらの出どころでも、共有する `state` レコードに `default` の行を作って到達可能な宛先へ送り(送信ログの `origin` は `row`)、`desired`(`full: false`)で配って保存する。既にあるキー・上限に達した一覧・空のキー・未知のレコードは `notice`(`code: "record-key-rejected"`、`detail` は `exists: <キー>` / `full: <キー>` / `empty-key` / `unknown-record: <id>`)を要求元だけに返す
- **`recordKeyRemove`**: `"ui"` なら一覧から消して一覧の全量を Unity に送り直し、`runtimeOptions` を配る。共有する全レコードからそのキーの行の保持値を消し、`desired` を `full: true` で配って保存する(差分では行の削除を表せないため)。Unity の一覧から行ができるレコードでは、一覧にある間は行が残り、値は `default` から作り直される。消す行も一覧のキーも無ければ `notice`(`not-found: <キー>`)
- **`recordKeyRename`**(`"ui"` のレコードだけ。D-087): `key`(ID)の行の Name を `name`(空でない文字列)に変える。ID・行の値・一覧の並びは変わらないので一覧は送り直さず、`runtimeOptions` を全 UI へ配り、一覧を共有する `state` レコードの行を同じ ID・値・新しい Name で全宛先へ送り直し(送信ログの `origin` は `ui`)、`desired`(`full: false`)で配って保存する。同じ Name なら何もしない。同じ一覧の他の行と重なる Name・空の Name・無い ID・`"ui"` でないレコード・未知のレコードは `notice`(`record-key-rejected`、`detail` は `exists: <Name>` / `empty-key` / `not-found: <ID>` / `not-renamable: <レコード id>` / `unknown-record: <id>`)を要求元だけに返す
- `"ui"` の一覧に無いキーの行への上り `osc` / `oscBatch` は、Unity へは送るが保持しない(別の画面で消した行へ、古い画面から書き込んだ場合)。`"ui"` の一覧は再送(初回到達・回復・定義の採用・上り `resend`)のたびに行より先に送り直す

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
- **応答**: 受け付けたら `destinations` の全量を全 UI へ配る。断るときは要求元だけへ `notice`(`level:"error"`、`code:"destination-alias-rejected"`、`detail` は `unknown-host: <ホスト>` / `unaliasable-host: <ホスト>`(制御文字を含むなど、キーに使えない host)/ `alias-too-long: ...` / `alias-has-control-characters` / `alias-has-lone-surrogates`(対になっていない UTF-16 サロゲート。保存すると Python の UI が `destinations` を符号化できずフレームごと捨てるため) / `too-many-aliases: ...`)と、その UI へ `destinations` を返す。ファイルへ書けなかったとき(読めなかったファイルを上書きしないときを含む)は名前を実行中だけ効かせ、全 UI へ `notice`(`level:"error"`、`code:"destination-aliases-save-failed"`)を送る

### `surfaceRequest` — 定義の再要求

引数を持たない。`surfaceList`、採用中の定義があれば `surface` を、要求元の UI だけへ返す。UI は接続のたびに(再接続を含む)これを送る。定義があれば続けて `desired`(`full: true`)と `runtimeOptions` も返す。接続時にブリッジが自動では送らないのは、接続手順(`hello` → `link` → `sentLog`)を最小に保ち、定義と保持値の取得を UI の要求に揃えるためである。

```json
{"v":1,"type":"surfaceRequest"}
```

### `surfaceLoad` — 保存済み定義の読み込み

`name` の定義をフォルダから読み込み、検証に通れば採用して全 UI へ配る。ファイルが無い・壊れている場合は直前の定義を維持し、要求元へ `surface-rejected` の `notice` を返す。

```json
{"v":1,"type":"surfaceLoad","name":"stage"}
```

### `surfaceSave` — 定義の保存

`definition` を検証し、`name` で保存する。既存の同名ファイルがあれば直前の内容を `.backups/` へ退避してから置き換える(名前ごとに直近 20 件を残す)。`activate` を省略または `true` にすると採用して全 UI へ配り、`false` のときは保存だけして `surfaceList` を全 UI へ送る。検証に通らなければ何も保存せず、要求元へ `surface-rejected` の `notice` を返す。`definition` の中身はフレームの形式検査では見ず、ブリッジが検証して理由を返す。

```json
{"v":1,"type":"surfaceSave","name":"stage","activate":true,"definition":{"format":"oscdesk-surface","version":1,"name":"Stage","parameters":[],"screens":[]}}
```

**名前の規則**: `surfaceLoad` / `surfaceSave` / `surface` / `surfaceList` の `name` は、英数字で始まり英数字・`_`・`-` だけからなる 1〜64 文字で、Windows の予約デバイス名(`CON` `PRN` `AUX` `NUL` `COM1`〜`COM9` `LPT1`〜`LPT9`、大文字小文字を問わない)ではない。ブリッジはこれをそのままファイル名(`<name>.json`)に使うため、パス区切り・ドット・先頭の `.`(`.backups` を含む)は表現できず、保管フォルダの外へは書けない。違反するフレームは `invalid-frame` の `notice` で破棄される。

### `padRequest` / `padLoad` / `padSave` — OSC パッドの取得・切り替え・保存

- **`padRequest`**(引数なし): `padList` と、採用中のパッドがあれば `pad` を要求元だけへ返す。UI は接続のたびに(再接続を含む)`surfaceRequest` と一緒に送る
- **`padLoad`**(`name`): 保存済みのパッドを読み込んで採用し、全 UI へ配る。無い・壊れている場合は直前のパッドを維持して `pad-rejected` を返す
- **`padSave`**(`name`・`pad`): `pad` を検証して保存し、採用して全 UI へ配る。`pad` の中身はフレームの形式検査では見ず、ブリッジが検証して理由を返す(`surfaceSave` と同じ)。保存だけして採用しない指定は無い

```json
{"v":1,"type":"padRequest"}
{"v":1,"type":"padLoad","name":"take-02"}
{"v":1,"type":"padSave","name":"take-03","pad":{"format":"oscdesk-pad","version":1,"rows":1,"columns":2,"buttons":[]}}
```

### `padPress` — OSC パッドの押下

`name`(押したパッドの名前)・`version`(押した画面が描いたパッドの `pad` フレームの `version`。必須)・`button`(ボタンの `id`)だけを送る。アドレスと引数は送らず、ブリッジが採用中のパッドから引いて**全宛先へ 1 メッセージ**(bundle にしない)で送る。送る中身の正をブリッジに置き、どの端末から押しても保存されたとおりに送るため、任意のアドレスを撃つ上りの経路は作らない。

- **保持値・再送に載せない**: 押下はきっかけであり、`desired` を書き換えず、再送もしない(サーフェス定義の `state` と同じアドレスを撃っても保持値は変わらない。食い違いはエコーの警告ログに出る)
- **送信ログ**: `sentLog` の `origin` は `pad`
- **断る場合**: 採用中のパッドの名前か版(`version`)と違う(別の端末が切り替えた・同じ名前で上書き保存した直後の古い画面や、ブリッジの再起動の前に描いた画面。同じ `id` の別のボタンを撃たないため。`revision` は再起動で 1 に戻るので照合に使わない)・未知のボタン・予約アドレス・一覧のアドレス(`optionsFrom.address` / `keysFrom.address`)は、何も送らずに要求元だけへ `notice`(`level: error`、`code: pad-press-rejected`、`detail` は `stale-pad: <name>@<version>` / `unknown-button: <id>` / `internal-address: <address>` / `option-list-address: <address>`)を返す

```json
{"v":1,"type":"padPress","name":"take-03","version":"3f9a1c0b7e2d-2","button":"b1"}
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

不正な名前は 400、JSON として読めない本文は 400、定義の検証に通らない本文は 422(本文に理由)、1 MiB 超は 413、上記以外のパスは 404 を返す。保存の挙動(バックアップ、採用の契機)は `surfaceSave` と同じである。

## 接続時とエラー時の動作

1. UI が WebSocket 接続を確立する。
2. ブリッジが `hello`、`link`、`sentLog`(`full: true`。送信の記録の既存分)、`destinations` の順に送る。
3. UI は `surfaceRequest` と `padRequest` を送り、`surfaceList`・`surface`・`desired`(`full: true`)・`runtimeOptions` と `padList`・`pad` を受け取って画面と表示値と選択肢と OSC パッドを作る。以後 `heartbeat` に応答し、`link` を状態へ反映する。
4. UI の通常操作は上り `osc` で、アクション(まとめ送り)は上り `oscBatch` で送る。ブリッジは全宛先へ送り、`state` の値を保持値に記録して全 UI へ `desired`(`full: false`)を配る。Unity からのエコーバックは下り `osc` で受け取り、届いたことの確認に使う(保持値は書き換わらない)。
5. JSON 構文、版数、未知キー、未知種別、型タグなどの検証に失敗したフレームは破棄される。接続は維持され、ブリッジが処理した上り不正フレームには可能なら `notice` も返す。
6. 心拍タイムアウトで切断された場合、UI は再接続し、接続後に `surfaceRequest` を送って状態を再取得する。

## ワイヤ見本との対応

すべての実例は `protocol/wire-samples.json` に手書きで収録している。同ファイルの `cases` の `name` と本書の種類は次の対応になる。

| 本書 | `wire-samples.json` の `name` |
|---|---|
| 下り `hello` | `downstream-hello` |
| 下り `osc` | `downstream-osc-float` |
| 下り `link` | `downstream-link` |
| 下り `heartbeat` | `downstream-heartbeat` |
| 下り `notice` | `downstream-notice` |
| 下り `surface` | `downstream-surface`(拒否例: `downstream-surface-invalid-definition`) |
| 下り `surfaceList` | `downstream-surface-list`、`downstream-surface-list-none-active` |
| 下り `desired` | `downstream-desired-full`、`downstream-desired-partial`、`downstream-desired-records`(拒否例: `downstream-desired-unknown-key`、`downstream-desired-bad-address`) |
| 下り `runtimeOptions` | `downstream-runtime-options`、`downstream-runtime-options-empty`、`downstream-runtime-options-records`、`downstream-runtime-options-records-empty`、`downstream-runtime-options-ui-row-names`、`downstream-runtime-options-pending`(拒否例: `downstream-runtime-options-non-string`、`downstream-runtime-options-keys-non-string`、`downstream-runtime-options-keys-unknown-key`、`downstream-runtime-options-field-choices-missing-field`、`downstream-runtime-options-ui-row-names-length-mismatch`、`downstream-runtime-options-pending-missing-removed`、`downstream-runtime-options-pending-relative-address`) |
| 下り `sentLog` | `downstream-sent-log`、`downstream-sent-log-backlog-empty`(拒否例: `downstream-sent-log-unknown-origin`、`downstream-sent-log-missing-batch`) |
| 下り `destinations` | `downstream-destinations`、`downstream-destinations-all-devices`、`downstream-destinations-networks`、`downstream-destinations-unsaved`、`downstream-destinations-aliases`(拒否例: `downstream-destinations-no-target`、`downstream-destinations-alias-too-long`、`downstream-destinations-missing-alias`) |
| 下り `sentLog` | `downstream-sent-log`、`downstream-sent-log-backlog-empty`、`downstream-sent-log-pad`(拒否例: `downstream-sent-log-unknown-origin`、`downstream-sent-log-missing-batch`) |
| 下り `pad` / `padList` | `downstream-pad`、`downstream-pad-list`、`downstream-pad-list-none-active`(拒否例: `downstream-pad-invalid`) |
| 上り `osc` | `upstream-osc-multi`、`upstream-osc-record-row`、`upstream-osc-record-row-with-id` |
| 上り `oscBatch` | `upstream-osc-batch`(拒否例: `upstream-osc-batch-empty`) |
| 上り `resend` | `upstream-resend-all`、`upstream-resend-target`(拒否例: `upstream-resend-unknown-key`) |
| 上り `runtimeOptionsRefresh` | `upstream-runtime-options-refresh`、`upstream-runtime-options-refresh-one-request`(拒否例: `upstream-runtime-options-refresh-unknown-key`、`upstream-runtime-options-refresh-relative-request`) |
| 上り `runtimeOptionsApply` | `upstream-runtime-options-apply-all`、`upstream-runtime-options-apply-one-list`(拒否例: `upstream-runtime-options-apply-relative-address`、`upstream-runtime-options-apply-unknown-key`) |
| 上り `recordKeyAdd` / `recordKeyRemove` / `recordKeyRename` | `upstream-record-key-add`、`upstream-record-key-remove`、`upstream-record-key-rename`(拒否例: `upstream-record-key-add-empty`、`upstream-record-key-rename-empty-name`) |
| 上り `destinationsScan` / `destinationsSelect` / `destinationsReset` | `upstream-destinations-scan`、`upstream-destinations-select`、`upstream-destinations-select-all-devices`、`upstream-destinations-select-networks`、`upstream-destinations-reset`(拒否例: `upstream-destinations-select-missing-all-devices`、`upstream-destinations-select-missing-networks`) |
| 上り `destinationsAlias` | `upstream-destinations-alias`、`upstream-destinations-alias-clear`、`upstream-destinations-alias-over-limit`(拒否例: `upstream-destinations-alias-missing`、`upstream-destinations-alias-too-long`) |
| 上り `padRequest` / `padLoad` / `padSave` / `padPress` | `upstream-pad-request`、`upstream-pad-load`、`upstream-pad-save`、`upstream-pad-press`(拒否例: `upstream-pad-save-path-traversal`、`upstream-pad-press-with-address`、`upstream-pad-press-without-version`) |
| 上り `heartbeatAck` | `upstream-heartbeat-ack` |
| 上り `surfaceRequest` | `upstream-surface-request` |
| 上り `surfaceLoad` | `upstream-surface-load`(拒否例: `upstream-surface-load-path-traversal`、`upstream-surface-load-reserved-name`) |
| 上り `surfaceSave` | `upstream-surface-save`(拒否例: `upstream-surface-save-hidden-name`) |

見本には、単一引数でも配列を保持する例、blob の base64、`oscBatch`、空バッチ、および異常系（旧配列形式、未知キー、`v:2`、未知種別、不正な型タグ）が含まれる。撤去したフレーム(`manifest`・`manifestRequest`・`link` の `manifest` 項目)が拒否されることを示す無効サンプル(`downstream-manifest-retired`、`upstream-manifest-request-retired`、`downstream-link-retired-manifest-field`)も残している。実装時は `direction`、`valid`、`frame` を照合し、正しいフレームの全種類と拒否規則を本書の記述どおりに実装する。

## 互換性と更新順序

マニフェスト経路の撤去(D-051)で、`manifest`・`manifestRequest` フレーム、`hello` の `expectedProjectId`、`link` の `manifest` / `lastRejection` は無くなった。撤去前の UI クライアントと新しいブリッジ(またはその逆)は、未知キー・未知種別の拒否により組み合わせられない。第三の UI クライアントを追加・更新する場合は、まず本書と `wire-samples.json` に合わせて UI クライアントを更新し、動作確認後にブリッジを更新する順序にする。
