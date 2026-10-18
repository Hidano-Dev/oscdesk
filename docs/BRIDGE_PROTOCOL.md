# ブリッジ接続仕様

この文書は、`oscdesk-bridge` と UI クライアントの間で交換する WebSocket フレームの正典である。新しい UI クライアントは、この文書と `protocol/wire-samples.json` だけを参照して実装できる。

## 前提と接続

ブリッジは Unity との OSC/UDP 通信と、UI クライアントとの WebSocket 通信を中継する。UI クライアントはブリッジの WebSocket ポートへ接続し、1 WebSocket メッセージにつき 1 個の JSON オブジェクトを送受信する。フレームはすべて UTF-8 JSON であり、配列形式や未知のキーは使用しない。

この接続には認証機構がない。`0.0.0.0` で待ち受ける構成を含むため、信頼された LAN 内だけで使用し、インターネットや信頼できないネットワークへ公開してはならない。

### ブリッジの起動

リポジトリのルートで Node.js 20 以降と pnpm を用意し、次を実行する。

```powershell
corepack pnpm install
corepack pnpm --filter @oscdesk/bridge run build
node packages/bridge/dist/oscdesk-bridge.js --config config/oscdesk.config.json
```

保管フォルダは設定の `surfaces.dir`(既定 `surfaces`、実行時のカレントディレクトリ基準)、起動時に採用する定義は `surfaces.defaultName`(省略可)で指定する。保持値(後述の `desired`)の保存先は `surfaces.valuesDir`(省略時は `<surfaces.dir>/.values`)で、定義名ごとに `<name>.values.json` を置く(`DESIGN.md` D-058)。

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

ブリッジから UI へ送る種類は次の 10 種類である。操作対象の定義は OscDesk 側のサーフェス定義(`surface`)で配り、値の正はブリッジが持つ(`desired`)。Unity が実行時に持つ文字列の一覧は `runtimeOptions` で、ブリッジが Unity へ送った OSC の記録は `sentLog` で配る。Unity からマニフェストを受け取る経路は撤去した(DESIGN.md D-051)。

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

- **レコード**: `id`(パラメータ id と重ねない)、`address`(具体アドレス)、`label`、`kind`(`state` / `trigger`)、`key`(省略可。`{ label? }` でキーの表示名)、`keysFrom`(必須。`optionsFrom` と同じ `{ address, request? }`)、`fields`(`state` は 1 件以上、`trigger` は 0 件以上)。キーの型は `s` だけで、型の欄は無い。`standalone` は無い
- **フィールド**: `id`(レコード内で一意)、`label`、`type`(`i` / `f` / `s` / `bool`)と、型ごとの `range` `step` `options` `optionsFrom` `default` `value`(パラメータと同じ規則。`optionsFrom` は `s` だけ)。`kind` と `standalone` は持たない
  - `state` レコード: `default` 必須、`value` 不可(新しいキーの行はフィールドの `default` で作る)。`optionsFrom` を持つ `s` は `default` が静的な `options` に無くてよい
  - `trigger` レコード: `value` 必須(固定値)、`default` `range` `step` `options` `optionsFrom` 不可
- **アドレスの衝突**: 値のアドレス(全パラメータと全レコードの `address`)は互いに重ねない。一覧のアドレス(全 `optionsFrom.address` と全 `keysFrom.address`)と要求のアドレス(全 `optionsFrom.request` と全 `keysFrom.request`)は値のアドレスと重ねない。要求のアドレスは一覧のアドレスと重ねない。同じ一覧・同じ要求を複数の箇所で共有するのは可で、`keysFrom.address` と別の欄の `optionsFrom.address` が同じ一覧を指してもよい
- **アクション**: アクションに省略可能な `scope`(`"row"` / `"all"`)を足した。`scope` を持つアクションは `{"record":"<レコード id>","value":{"<フィールド id>":<固定値>}}` の step だけを持ち、その全レコードが同じ `keysFrom.address` を持つ。`state` レコードは行の現在値を送り、`value` に書いたフィールドだけ固定値で上書きする(値はフィールドの型・値域・`options` に収まること。`optionsFrom` を持つ `s` は所属を問わない)。`trigger` レコードはフィールドの `value` を送り、`value` は書けない。`scope` の無いアクションは `record` step を持てない。展開は UI が行い、`row` は押した行のキーについて steps を定義順に、`all` は表示中の全行について行ごとに steps を定義順に並べ(行 1 の全 step → 行 2 の全 step …)、1 つの `oscBatch` で送る。`all` の件数は行数で決まるので定義では上限を見ず、展開後に 512 件 / 60 KiB を超えたら UI が送らずに通知する
- **画面層**: `{"kind":"record","record":"<レコード id>","label":?,"width":?,"columns":?,"rowActions":?,"tableActions":?}` でレコード表を置く。`columns` は `[{"field":"<フィールド id>","widget":?,"label":?,"actions":?,"toggle":?}]` で列の順序・部分集合・部品のヒント(省略時は全フィールドを定義順。同じ `field` の重複・未知の `field` は不可。`widget` はフィールドを「`kind` がレコードの `kind` のパラメータ」とみなして合うこと)。列の `actions` は表の枠内でその列の直下(フッター行)に出す `scope: "all"` のアクション id で、列の一括操作(例: 全行の Active を On / Off)の置き場である(`DESIGN.md` D-066。`columns` を省略した表には置けない)。列の `toggle` は `{"label":"<共通ラベル>","on":"<アクション id>","off":"<アクション id>"}` で、同じ場所にラベルとスイッチ 1 つの一括トグルを出す(D-073。`bool` のフィールドの列に限る。表示は全行オンでオン・全行オフでオフ・混在で不定、操作でオンなら `on`、オフなら `off` の `scope: "all"` のアクションを送る)。`rowActions` は各行の末尾に出す `scope: "row"` のアクション id。`tableActions` は表の右側に行の並びいっぱいの縦長ボタンで出す `scope: "all"` のアクション id で、表全体の確定(例: Update All)の置き場である(D-074)。いずれも、そのアクションのレコードはこの表のレコードと同じ `keysFrom.address` を持つこと。`{"kind":"action"}` ノードは `scope: "row"` のアクションを置けない(行が決まらない)。`{"kind":"control"}` はレコード id を参照できない。行の並び順は UI の規則(キーの一覧の順 → 一覧に無いが保持値を持つキー)で、定義には書かない
- **ワイヤ**: 上り `osc` / `oscBatch` は 1 行 = 1 メッセージ(`address` = レコードの `address`、`args` = `[s:key, ...fields]`)。`state` の欄を 1 つ編集しても行の全フィールドを載せる。保持値(`desired`)はキーごとに 1 エントリ、キーの一覧と選択肢は `runtimeOptions` の `keys` / `fieldChoices`(後述)。ブリッジは `state` のレコードをキーごとに保持・再送・保存する(後述の `desired`。`DESIGN.md` D-062)。`trigger` のレコードは保持せず、通常どおり中継するだけ。UI のレコード表は HID-216、Unity の受け口は HID-217 で扱う

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

`state` のレコード(前述)の保持値は**キーごとに 1 エントリ**で、`{ "address": レコードの address, "args": [s:key, ...fields] }` の形になる(同じ `address` が行の数だけ並ぶ)。`full: true` は全パラメータと全レコードの全キーを、`full: false` は変わったキーだけを含む。フレームの形は変わらない(`DESIGN.md` D-061 / D-062)。

- **並び**: `full: true` ではパラメータを定義順に並べた後、レコードを定義順に、各レコードの行を「行ができた順」に並べる。UI の表の行の順は UI が決める(キーの一覧の順が先。D-064)
- **行の生成**: キーの一覧(どの宛先から届いたものでも)に、まだ行の無いキーが現れると、ブリッジはフィールドの `default` で行を作り、到達可能な宛先へその行を 1 メッセージずつ送り、作った行だけの `desired`(`full: false`)を全 UI へ配る。同じ契機の `runtimeOptions` が先に届く。まだ到達していない宛先には、初回の到達・回復の再送で届く。定義の採用時に、引き継いだ一覧に行の無いキーがあれば同じく作る(この場合は採用の `full: true` に載る)
- **保持の更新**: 上り `osc` / `oscBatch` と OSC ネイティブ UI の中継で、レコードの `address` に「先頭が空でない `s` のキー + フィールドの数・型が一致 + 値域・`options` に収まる(`optionsFrom` を持つ `s` は所属を問わない)」1 行が来たときだけ、そのキーの行を置き換える。合わないものは保持しないが、Unity へは通常どおり送る(パラメータと同じ)。一覧に無いキーでも正しい行なら保持する
- **一覧から消えたキー**: 行は残り、再送も続ける。キーの改名は別キーとして扱い、古いキーの行は残る
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

保存ファイルの形式(`version: 2`)は次のとおり。`version: 1`(`records` の無い HID-211 の形式)も読み、次の保存で `version: 2` に書き直す。

```json
{
  "format": "oscdesk-desired-values",
  "version": 2,
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
- 引数は `i`(int32)・`f`(有限)・`s` だけで、blob は受けない。未知のキー・版は「壊れたファイル」として扱う

### `runtimeOptions` — Unity が実行時に持つ文字列の一覧

採用中の定義の `optionsFrom`(前述)に Unity が返した一覧を配る(`DESIGN.md` D-053 / D-055)。毎回全量で、UI は丸ごと置き換える。

```json
{"v":1,"type":"runtimeOptions",
 "lists":[{"address":"/mb/segments","targets":[
   {"name":"unity","options":["Intro","Song A"]},
   {"name":"backup","options":["Song A","Song B"]}]}],
 "choices":[{"param":"segment1","options":["(none)","Intro","Song A","Song B"]}]}
```

- `lists` — 定義が参照する一覧のアドレスごとに 1 件(定義順)。`targets` は一覧を返した宛先だけを `hello.targets` の順に並べ、まだ返していない宛先は含まない(空の `targets` は「まだ届いていない」、空の `options` は「その台には名前が無い」)。宛先ごとの一覧は、Unity が返した順のまま(重複も含めて)載せる。
- `choices` — `optionsFrom` を持つパラメータごとに 1 件(定義順、`param` はパラメータの `id`)。選択肢は、静的な `options` → 主系の一覧の順 → 副系にしか無い名前を `hello.targets` の順に続けたもので、重複は除く。UI はこれをそのまま選択欄の候補にする。
- `keys`(省略可、HID-214)— `keysFrom` を持つ全レコードごとに 1 件 `{ "record": <レコード id>, "keys": [<キー>...] }`(定義順)。キーは主系の一覧の順 → 副系にしか無い名前を `hello.targets` の順に続けた和集合で、重複と空文字を除く。一覧が未着なら `keys: []`。
- `fieldChoices`(省略可、HID-214)— `optionsFrom` を持つレコードのフィールドごとに 1 件 `{ "record", "field", "options" }`(定義順)。順序の規則は `choices` と同じ。
- `keys` と `fieldChoices` はブリッジが常に送る(レコードが無ければ空の配列)。UI は欄が無ければ空として扱う。`lists` には `keysFrom.address` の一覧も含める(一覧のアドレス単位で、`optionsFrom` と同じ一覧を指していれば 1 件にまとまる。宛先ごとの一覧は空文字も含めて届いたまま載せ、`keys` からだけ空文字を除く)。
- キーの一覧は `optionsFrom` の一覧と同じ仕組み(下記の受け取り・保持・送る契機・要求)で扱う。キーの一覧が変わって新しい行ができたときは、この `runtimeOptions` に続けて作った行の `desired`(`full: false`)が届く(前述)。

```json
{"v":1,"type":"runtimeOptions",
 "lists":[{"address":"/vp/members/list","targets":[{"name":"unity","options":["メンバーA","メンバーB"]}]},
          {"address":"/vp/segments/list","targets":[]}],
 "choices":[],
 "keys":[{"record":"member","keys":["メンバーA","メンバーB"]},{"record":"memberUpdate","keys":["メンバーA","メンバーB"]}],
 "fieldChoices":[{"record":"member","field":"segment","options":["(none)"]}]}
```

- **受け取り**: ブリッジは `optionsFrom.address` に届いた 1 メッセージを、その宛先の一覧として置き換える。引数はすべて `s` で、0 個(空の一覧)も可。`s` 以外を含むメッセージは捨てて警告ログを 1 回出す。Unity の宛先以外(OSC ネイティブ UI の端末など)から届いたものは受けない。副系から届いた一覧も受ける。
- **保持**: 到達不能になった台の一覧は最後に受けたものを残す。定義の再採用では、参照が残るアドレスの一覧を引き継ぎ、参照が消えたアドレスの一覧は捨てる。ブリッジ再起動では保存しない。
- **送る契機**: Unity から届いた一覧で中身が変わったとき(同じ一覧の繰り返しでは送らない)と、定義を採用したとき(`desired` の後。中身が変わっていなくても送る)に全 UI へ。`surfaceRequest` の応答として要求元へ(`desired` の後)。定義が無いときは送らない。
- **要求**: ブリッジは `optionsFrom.request` へ引数なしの OSC を送る。契機は、その宛先が初めて pong を返したとき、喪失から回復したとき(その宛先だけ)、到達可能な状態で定義を採用し新しい一覧のアドレスか要求のアドレスが増えたとき(到達可能な宛先)、上り `runtimeOptionsRefresh` を受けたとき(全宛先)。`request` の無い一覧は Unity の自発送信を待つだけで、いつ届いても受ける。
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
- **`origin`**(送った契機): `ui`(上り `osc`)、`action`(上り `oscBatch`)、`resend`(保持値の再送。初回到達・回復・定義の採用・上り `resend`)、`row`(キーの一覧に現れた新しい行)、`request`(`optionsFrom.request` / `keysFrom.request` への要求)、`relay`(OSC ネイティブ UI の中継)。`/sys/ping` と、要求元へ直接返す `/oscdesk/*` の応答は記録しない
- **`seq`**: ブリッジの起動ごとに 1 から振る正整数。**`at`**: 最後に送った時刻(ISO 8601、オフセット付き)
- **`count`**(間引き): `ui` と `relay` で、直前の記録と同じ契機・宛先・アドレス(レコードは先頭の `s` のキーも同じ)への送信が、その記録の最初の送信から 1,000 ms 以内に続いたときは、新しい記録を作らずに直前の記録の `count` を増やし、`at` と `args` を最後の送信のものにする。更新した記録は**同じ `seq` のまま**届き直す
- **`batch`**: `oscBatch` の各メッセージは `{ id, index, size }`(`id` はバッチごとに 1 から振る番号、`index` はバッチ内の 0 始まりの位置、`size` はバッチのメッセージ数)。それ以外は `null`(省略しない)。`targets` は bundle を送れた宛先(主系 + 送れた副系)
- **`clipped`**: 表示用に引数を切り詰めたとき `true`。`s` は 120 文字、`b` は先頭 32 バイト、引数は先頭 16 個まで。有限でない `f`(NaN など)は JSON で表せないため `s` の文字列にして `clipped: true` にする
- **配る契機**:
  - 接続直後、`hello`・`link` の後に、その UI だけへ保持している全量を送る。先頭のフレームが `full: true` で、UI は手元の記録を捨ててこれで置き換える。続きのフレームは `full: false`。記録が無くても `full: true` の空のフレームを 1 つ送る(ブリッジ再起動後の再接続で古い記録を捨てさせるため)
  - 送信のたびには送らず、新しい記録と更新した記録を **250 ms ごとに**まとめて全 UI へ `full: false` で送る。UI は `seq` をキーに追加・置き換えする
- **上限**: ブリッジは直近 **1,000 件**を保持し、古いものから捨てる(捨てた記録は配らない)。1 フレームは **100 件**まで(超える分は複数のフレームに分ける)。UI の WebSocket クライアントの受信上限(Python `websockets` の既定 1 MiB)に十分収めるため
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

## 上りフレーム（UI → ブリッジ）

UI から送る種類は次の 8 種類である。

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

引数を持たない。採用中の定義のすべての `optionsFrom.request` と `keysFrom.request` へ、全宛先(到達不能の台を含む)に引数なしの OSC を送らせる(UI の「一覧を更新」)。応答の一覧で中身が変われば `runtimeOptions` が全 UI へ届く。変わらなければ何も届かない。`request` を持つ定義が無ければ何もしない。

```json
{"v":1,"type":"runtimeOptionsRefresh"}
```

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
2. ブリッジが `hello`、`link`、`sentLog`(`full: true`。送信の記録の既存分)の順に送る。
3. UI は `surfaceRequest` を送り、`surfaceList`・`surface`・`desired`(`full: true`)・`runtimeOptions` を受け取って画面と表示値と選択肢を作る。以後 `heartbeat` に応答し、`link` を状態へ反映する。
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
| 下り `runtimeOptions` | `downstream-runtime-options`、`downstream-runtime-options-empty`、`downstream-runtime-options-records`、`downstream-runtime-options-records-empty`(拒否例: `downstream-runtime-options-non-string`、`downstream-runtime-options-keys-non-string`、`downstream-runtime-options-keys-unknown-key`、`downstream-runtime-options-field-choices-missing-field`) |
| 下り `sentLog` | `downstream-sent-log`、`downstream-sent-log-backlog-empty`(拒否例: `downstream-sent-log-unknown-origin`、`downstream-sent-log-missing-batch`) |
| 上り `osc` | `upstream-osc-multi`、`upstream-osc-record-row` |
| 上り `oscBatch` | `upstream-osc-batch`(拒否例: `upstream-osc-batch-empty`) |
| 上り `resend` | `upstream-resend-all`、`upstream-resend-target`(拒否例: `upstream-resend-unknown-key`) |
| 上り `runtimeOptionsRefresh` | `upstream-runtime-options-refresh`(拒否例: `upstream-runtime-options-refresh-unknown-key`) |
| 上り `heartbeatAck` | `upstream-heartbeat-ack` |
| 上り `surfaceRequest` | `upstream-surface-request` |
| 上り `surfaceLoad` | `upstream-surface-load`(拒否例: `upstream-surface-load-path-traversal`、`upstream-surface-load-reserved-name`) |
| 上り `surfaceSave` | `upstream-surface-save`(拒否例: `upstream-surface-save-hidden-name`) |

見本には、単一引数でも配列を保持する例、blob の base64、`oscBatch`、空バッチ、および異常系（旧配列形式、未知キー、`v:2`、未知種別、不正な型タグ）が含まれる。撤去したフレーム(`manifest`・`manifestRequest`・`link` の `manifest` 項目)が拒否されることを示す無効サンプル(`downstream-manifest-retired`、`upstream-manifest-request-retired`、`downstream-link-retired-manifest-field`)も残している。実装時は `direction`、`valid`、`frame` を照合し、正しいフレームの全種類と拒否規則を本書の記述どおりに実装する。

## 互換性と更新順序

マニフェスト経路の撤去(D-051)で、`manifest`・`manifestRequest` フレーム、`hello` の `expectedProjectId`、`link` の `manifest` / `lastRejection` は無くなった。撤去前の UI クライアントと新しいブリッジ(またはその逆)は、未知キー・未知種別の拒否により組み合わせられない。第三の UI クライアントを追加・更新する場合は、まず本書と `wire-samples.json` に合わせて UI クライアントを更新し、動作確認後にブリッジを更新する順序にする。
