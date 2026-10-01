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

ブリッジから UI へ送る種類は次の 6 種類である。

### `hello` — 接続情報

接続直後に、その UI クライアントだけへ 1 回送る。`clientId` は接続を識別する値である。`expectedProjectId` は設定が無い場合 `null`。`pingIntervalMs` は Unity への死活確認周期であり、WebSocket 心拍とは別である。

```json
{
  "v":1,"type":"hello","clientId":"ui-1","protocolVersion":1,
  "server":{"name":"oscdesk-bridge","version":"0.1.0"},
  "unity":{"host":"127.0.0.1","sendPort":7090},
  "bridge":{"oscListenPort":7091,"wsPort":7080},
  "expectedProjectId":"oscdesk-demo",
  "heartbeat":{"intervalMs":15000,"timeoutMs":30000},
  "pingIntervalMs":15000,"debug":false
}
```

### `manifest` — 操作対象のマニフェスト

接続時、Unity から新しいマニフェストを受理した時、または UI が `manifestRequest` を送った時に送る。`manifest` は次の形で、`version` は常に `1`、`projectId` は空でない文字列である。

```json
{
  "v":1,"type":"manifest",
  "adoption":{"seq":3,"at":"2026-09-26T09:00:00.000+00:00"},
  "manifest":{
    "version":1,"projectId":"oscdesk-demo",
    "entries":[
      {
        "address":"/avatar/blend/smile","label":"Smile","type":"f",
        "widget":"fader","range":[0,1],"default":0.5,"group":"avatar"
      },
      {
        "address":"/member/01/name","label":"Member 01 Name","type":"s",
        "widget":"input","default":"Alice","staged":true
      },
      {
        "address":"/member/01/update","label":"Member 01 Update","type":"i",
        "widget":"button","default":0,"appliesTo":["/member/01/*"]
      }
    ]
  }
}
```

各 `entries` 要素の `address` と `label` は必須。`type` は `i` / `f` / `s` / `b` / `bool`、`widget` は `fader` / `button` / `toggle` / `xy` / `text` / `input` / `select` である。`range` は数値 2 個の配列、`default` は数値・文字列・真偽値、`group`、`options`、`optionsRef`、`pattern` は任意項目である。

`manifest` フレームには、今回の採用を識別する `adoption` を必ず含める。`adoption.seq` は採用ごとに 1 から増加する正の整数、`adoption.at` は採用時刻の ISO 8601 文字列である。UI は同じ `adoption` の再送を無視し、異なる `adoption` を受信したときは、内容が同一でも各エントリの表示値を `default` へ再同期する。ただし編集中の値は上書きしない。

マニフェストのエントリには、従来項目に加えて次を指定できる。

- `staged`: ステージング対象である場合だけ `true` を出す。非 staged エントリにはキーを出さない。
- `appliesTo`: `button` エントリにだけ指定できる、適用範囲のアドレスパターン配列。空配列は使用せず、1 件以上のパターンを指定する。`*` は同じアドレス部分内の 0 文字以上に一致し、`/` をまたがない。

`appliesTo` と `staged` はブリッジが削除せず、そのまま UI へ配信する。適用範囲を持つ UI のボタンは、値を定義順に並べてからトリガを送るために、上り `oscBatch` を使用する。

### `osc` — Unity から受信した OSC

Unity から受信した通常の OSC を UI へ配信する。`from` は受信元の UDP ピアで、`host` は文字列、`port` は 1〜65535 の整数である。

```json
{"v":1,"type":"osc","address":"/avatar/blend/smile",
 "args":[{"type":"f","value":0.5}],
 "from":{"host":"127.0.0.1","port":7090}}
```

### `link` — Unity とマニフェストの状態

接続時と状態変化時に送る。`unity.reachability` は `unknown` / `reachable` / `lost`、`lastRttMs` と `lastPongSeq` は未確定なら `null`、`consecutiveLosses` は連続喪失数である。`manifest` は未受理なら `{ "state":"none" }`、受理済みなら `state:"accepted"` と `projectId`、`entryCount` を持つ。`lastRejection` は通常 `null` で、拒否があれば `ts`、`reason`（`project-mismatch` / `schema-error` / `json-parse-error`）、`detail`、`receivedProjectId` を持つ。

```json
{"v":1,"type":"link",
 "unity":{"reachability":"reachable","lastRttMs":4,"consecutiveLosses":0,"lastPongSeq":12},
 "manifest":{"state":"accepted","projectId":"oscdesk-demo","entryCount":1},
 "lastRejection":null}
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

## 上りフレーム（UI → ブリッジ）

UI から送る種類は次の 4 種類である。

### `osc` — Unity へ送る OSC

`address` と型タグ付き `args` を送る。`from`、`target`、配列形式の旧イベント名などは付けない。ブリッジは設定された Unity の `host` と `sendPort` へ転送し、内部予約アドレスへの送信は拒否する。

```json
{"v":1,"type":"osc","address":"/avatar/pos",
 "args":[{"type":"f","value":0.1},{"type":"f","value":0.9}]}
```

### `oscBatch` — 複数の OSC を 1 データグラムで送る

`messages` に 1 件以上の OSC メッセージを、送信順に並べる。各要素は `address` と `args` だけを持ち、`osc` と同じ型タグ付き引数を使用する。ブリッジはこれを即時タイムタグの OSC bundle 1 個へ変換し、1 データグラムとして Unity へ送る。ブリッジはメッセージの意味や `staged` の状態を解釈しない。

1 バッチの上限は 512 メッセージ、OSC bundle のエンコード後サイズの実用上限は 60 KiB (60 × 1024 byte) である。空の `messages`、上限超過、内部予約アドレスを含むバッチは拒否する。

```json
{"v":1,"type":"oscBatch","messages":[
  {"address":"/member/01/name","args":[{"type":"s","value":"Zed"}]},
  {"address":"/member/01/enabled","args":[{"type":"i","value":1}]},
  {"address":"/member/01/update","args":[{"type":"i","value":1}]}
]}
```

### `manifestRequest` — マニフェスト再要求

引数を持たない。ブリッジが既に受理したマニフェストを、その要求元の UI だけへ再送する。まだ受理していなければ何も返さない。このフレームは Unity へ転送しない。

```json
{"v":1,"type":"manifestRequest"}
```

### `heartbeatAck` — 心拍応答

`heartbeat` の `t` をそのまま返す。ブリッジはこの受信を接続の生存確認に使う。

```json
{"v":1,"type":"heartbeatAck","t":1720000000000}
```

## 接続時とエラー時の動作

1. UI が WebSocket 接続を確立する。
2. ブリッジが `hello`、`link`、受理済みなら `manifest` の順に送る。
3. UI は `heartbeat` に応答し、`link` と `manifest` を状態へ反映する。
4. UI の通常操作は上り `osc` で送り、適用範囲を持つトリガのセット送信は上り `oscBatch` で送る。Unity からのエコーバックは下り `osc` で受け取り、下り `osc` の値だけを UI の確定値として扱う。
5. JSON 構文、版数、未知キー、未知種別、型タグなどの検証に失敗したフレームは破棄される。接続は維持され、ブリッジが処理した上り不正フレームには可能なら `notice` も返す。
6. 心拍タイムアウトで切断された場合、UI は再接続し、接続後に `manifestRequest` を送って状態を再取得する。

### 起動の識別子と構造の世代(`bootId` / `structureGeneration`)

`manifest` の中身(`/sys/manifest` の JSON)と `/sys/stats` の JSON は、任意項目として `bootId`(1〜64 文字の文字列)と `structureGeneration`(0〜2,147,483,647 の整数)の組を持てる。両方あるか両方ないかのどちらかで、片方だけのペイロードはスキーマ違反として従来どおり不採用になる。組を持つ例は `downstream-manifest-with-origin`。`manifest` フレームの形式(`adoption`)は変えず、組は `manifest` の中に入る。旧 UI は未知の項目を無視する。

ブリッジの採否の規則(スキーマと `expectedProjectId` の検査を通った後、上から順に判定):

1. 到達性の回復後の最初の受信は、組に関係なく採用する(強制採用)
2. まだ何も受理していなければ採用する
3. 受信が組を持たなければ採用する(組を持たない送信元は受信ごとに採用される。従来どおり)
4. 受信の組が受理済みの組と完全に同じなら重複とし、採用しない
5. それ以外(組が違う、または受理済みが組なし)は採用する。組の大小は比べない

**採用を発行しない条件**: 重複のとき、ブリッジは `adoption.seq` を進めず、`manifest` フレームも `link` フレームも配信しない。UI の `manifestRequest` と接続時の配信は従来どおり受理済みのマニフェストを返す。

**Unity の再起動の検出**: 採用したマニフェストの `bootId` が直前の受理済みの `bootId` と変わったとき、ブリッジは INFO ログで Unity の再起動を 1 行出す。到達不能を経ない再起動でも、再起動直後の自発送信か、次の照合で取り直したマニフェストにより検出する。

**stats による照合**: 組を持つマニフェストを受理済みの間だけ、ブリッジは 4 秒間隔で `/sys/stats/request` を Unity へ送り、応答の `/sys/stats` の組を受理済みの組と比べる。不一致なら INFO ログを 1 行出し、すぐ `/sys/manifest/request` を送って、目標の組を受理するまで 2 秒ごとに要求を続ける(途中で届いた別の組のマニフェストも採用する)。`/sys/stats` は UI へ配信せず、設定された Unity ホスト以外から届いたものは捨てる。組を持たないマニフェストを受理済みの間は stats を要求しない。

**Unity の受信数への影響**: 照合のための `/sys/stats/request` は Unity の `/sys/stats` の `received` を約 4 秒ごとに 1 増やす(要求自身も計数対象のため)。

## ワイヤ見本との対応

すべての実例は `protocol/wire-samples.json` に手書きで収録している。同ファイルの `cases` の `name` と本書の種類は次の対応になる。

| 本書 | `wire-samples.json` の `name` |
|---|---|
| 下り `hello` | `downstream-hello` |
| 下り `manifest` | `downstream-manifest` |
| 下り `manifest`(組あり) | `downstream-manifest-with-origin` |
| 下り `osc` | `downstream-osc-float` |
| 下り `link` | `downstream-link` |
| 下り `heartbeat` | `downstream-heartbeat` |
| 下り `notice` | `downstream-notice` |
| 上り `osc` | `upstream-osc-multi` |
| 上り `oscBatch` | `upstream-osc-batch` |
| 上り `manifestRequest` | `upstream-manifest-request` |
| 上り `heartbeatAck` | `upstream-heartbeat-ack` |

見本には、単一引数でも配列を保持する例、blob の base64、`adoption`・`staged`・`appliesTo` を含むマニフェスト、`oscBatch`、空バッチ、および異常系（旧配列形式、未知キー、`v:2`、未知種別、不正な型タグ）が含まれる。実装時は `direction`、`valid`、`frame` を照合し、正しい 10 種のフレームと拒否規則を本書の記述どおりに実装する。

## 互換性と更新順序

`manifest.adoption` は必須項目であり、`manifest` フレームの形式は更新された UI クライアントを前提とする。第三の UI クライアントを追加・更新する場合は、まずその UI クライアントを `adoption` と `oscBatch` に対応させ、動作確認後にブリッジを更新する順序にする。旧 UI クライアントと新ブリッジを混在させない。
