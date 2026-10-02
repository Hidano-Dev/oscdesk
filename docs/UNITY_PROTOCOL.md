# UNITY_PROTOCOL.md - `/sys/*` プロトコル仕様

> 互換性ノートを含む仕様書 兼 実 Unity 接続手順書。仕様(§1〜§3)・実装指針(§4)・接続手順(§5)・互換性チェックリスト(§6)からなる本文は特定の OSC ライブラリに依存せず、本文だけで `/sys/*` の Unity 側実装と接続確認が完結する。
> 本仕様は OSC 1.0 標準の機能(基本型タグ・bundle・timetag)のみで成立させる。特定の OSC ライブラリ固有の挙動を前提にしてはならない。特定ライブラリを使った具体例は付録 A にのみ置く。

## 前提

- Unity が真実の源(source of truth)。UI は表示キャッシュにすぎず、値の確定は常に Unity からのエコーバックによる。
- トランスポートは UDP。アドレス・ポートは実行時設定(`config/oscdesk.config.json`)で与える。

## 1. 到達性・診断

| 方向 | アドレス | 引数 | 用途 |
|---|---|---|---|
| oscdesk → Unity | `/sys/ping` | `int seq` | 到達性確認。2 秒間隔で送信 |
| Unity → oscdesk | `/sys/pong` | `int seq` | `/sys/ping` 受信時に **同じ seq を即時** 返信 |
| oscdesk → Unity | `/sys/stats/request` | (なし) | 受信統計の要求 |
| Unity → oscdesk | `/sys/stats` | `string json` | 受信統計 JSON を返信 |

`/sys/stats` の JSON ペイロード:

```json
{ "received": 0, "parseErrors": 0, "lastReceivedAt": "ISO-8601 文字列", "bootId": "起動の識別子(任意)", "structureGeneration": 1 }
```

`bootId` と `structureGeneration` は任意の組である(両方あるか、両方ないかのどちらか)。意味は §2 を参照する。

### Phase 1 詳細仕様

- oscdesk 側は RTT、連続喪失数、最後に採用した pong の `seq` を保持する。
- ping は 2 秒間隔で送信し、未応答 ping は常に最大 1 件だけ保持する。
- 次の ping 送信時点で前回 ping が未応答なら、その ping は喪失として扱い、連続喪失数を `+1` して新しい `seq` に置き換える。
- `pong` は保持中の `seq` と一致した場合のみ採用し、その時点で RTT を確定し、連続喪失数を `0` に戻す。
- 未知 `seq`、期限切れ `seq`、重複 `seq` の `pong` は破棄し、RTT と連続喪失数を更新しない。

### `/sys/stats` 計数規則

- `received` は **正常に decode できた全メッセージ数** を表す。
- `/sys/*` 以外の通常メッセージも `received` に含める。
- `/sys/stats/request` 自体も `received` に含める。
- OSC bundle は bundle 全体を 1 件とは数えず、**展開後の各メッセージを個別に 1 件** として数える。
- decode 失敗したデータグラムは `received` に含めず、`parseErrors` のみを `+1` する。
- `lastReceivedAt` は最後に正常 decode したメッセージの受信時刻を ISO-8601 文字列で保持する。
- `/sys/stats/request` 自体も正常受信として数えるため、`/sys/stats` 応答時点では少なくともその要求の受信時刻まで `lastReceivedAt` が更新済みである。

## 2. マニフェストハンドシェイク

| 方向 | アドレス | 引数 | 用途 |
|---|---|---|---|
| oscdesk → Unity | `/sys/manifest/request` | (なし) | マニフェスト要求 |
| Unity → oscdesk | `/sys/manifest` | `string json` | マニフェスト JSON を返信 |

`/sys/manifest` の型タグは `s` 1 引数のみ。bundle や拡張型タグは使わず、OSC 1.0 標準の機能のみで成立させる。

マニフェストのスキーマ(正規定義は `packages/shared` の zod `ManifestSchema` を参照する):

```ts
{
  version: 1,
  projectId: string,          // 必須。空でない、人間が決める任意の識別子
  bootId?: string,            // Unity の起動ごとに異なる識別子(1〜64 文字)。structureGeneration と組
  structureGeneration?: number, // 起動ごとに 1 から始まる、マニフェスト内容の世代(1 以上の整数。受信側は 0 も許容する)
  entries: [{
    address: string,        // 例: "/avatar/blend/smile"
    label: string,          // 表示名(日本語可) 例: "笑顔"
    type: "i" | "f" | "s" | "b" | "bool",
    widget: "fader" | "button" | "toggle" | "xy" | "text" | "input" | "select",
    range?: [number, number],
    default?: number | string | boolean,
    group?: string,         // UI セクション分け用
    options?: string[],     // select のインライン選択肢
    optionsRef?: string,    // select の共有選択肢キー
    pattern?: string,       // input の文字列検証用正規表現
    staged?: true,          // 受信値をステージングし、適用トリガで適用する対象
    appliesTo?: string[]    // button の適用範囲。ワイルドカードパターンを1件以上
  }]
  optionLists?: { [key: string]: string[] } // 共有選択肢辞書
}
```

- `projectId` はプロジェクトを識別するための必須フィールドである。値は人間が決める任意の非空文字列とし、UUID や特定の命名規則は要求しない。`version` は `1` のままであり、`projectId` を持たない旧形式のマニフェストは受理しない。
- `bootId` と `structureGeneration` は、受信側が「受理済みのマニフェストと同じものか、内容が公開し直されたものか」を内容の比較なしで判定するための任意の組である。`bootId` は Unity の起動(Play の開始)ごとに異なる値、`structureGeneration` は起動ごとに 1 から始まり、内容が変わった公開(F-6 の内容更新・F-8 の再注入の成功)のときだけ 1 進む。`/sys/manifest/request` への応答・起動時や有効化時の自発送信・内容の変わらない公開では進まない。同じ組を持つマニフェストは同一の内容であり、受信側は再採用しなくてよい。組を持たない旧形式のマニフェストも従来どおり受理する。片方だけを持つペイロードは不正である。`/sys/stats` にも同じ組を載せ、受信側が定期照合に使う。
- 各エントリには現在値を `default` として含め、UI 表示を Unity の実状態に同期させる。
- `type` の意味:
  - `"i"` = int32、`"f"` = float32、`"s"` = string
  - `"b"` = blob(byte array。OSC 1.0 の `b` タグに対応)。UI の値同期の対象外(互換性ノート参照)
  - `"bool"` = 真偽値。Phase 2 時点の確定挙動として int(`i` タグ)の 0/1 で送受信する。`T`/`F` タグへの変換は未実装の将来オプション(互換性ノート参照)

### Phase 6 拡張スキーマ: input / select

- `widget: "input"` は確定操作を伴う入力欄で、`type` は `"s"` / `"i"` / `"f"` のいずれかでなければならない。`pattern` を指定できるのは `type: "s"` の場合だけで、文字列全体に適用する正規表現として確定時に検証する。
- `widget: "select"` は選択肢を持つ文字列ドロップダウンで、`type` は必ず `"s"` とする。`options`(インラインの文字列配列)または `optionsRef`(共有辞書のキー)を **ちょうど一つ** 指定する。両方の指定、またはどちらも指定しないエントリは不正である。
- トップレベルの `optionLists` は共有選択肢辞書であり、各キーは空でない文字列、値は null を含まない文字列配列とする。`optionsRef` はこの辞書に存在するキーを参照しなければならない。参照解決後の配列を UI に渡し、インライン指定と共有指定の違いを UI 描画層へ持ち込まない。
- `options: []` は有効な空選択肢を表す。select は操作不可として表示し、ダミー項目は追加しない。初期値やエコーバックが選択肢外でもマニフェスト全体は不採用にせず、選択状態を空にして受信文字列を表示する。
- `options`、`optionsRef`、`optionLists`、`pattern` は値がない場合にキーごと省略し、`null` は使用しない。拡張後もマニフェスト `version` は `1` のままとする。
- `pattern` は TypeScript の `RegExp` と Python の `re` の双方で同じ意味になる基本的な正規表現機能だけを使う。片方の実装にしかない構文・フラグ・Unicode 固有拡張に依存してはならない。スキーマ検証時にコンパイルできない pattern は不採用とする。
- `staged` は値がステージング対象の場合だけ `true` を指定し、`false` は指定しない。`appliesTo` は `widget: "button"` のエントリにだけ指定できる非空配列で、各要素は §4.3.1 のワイルドカードパターンとする。どちらも値がない場合はキーごと省略し、`null` や空配列は使用しない。

### Phase 2 確定仕様: 要求・再送・回復

- oscdesk は起動して宛先へ送信可能になった直後に `/sys/manifest/request` を送信し、応答を **採用** するまで 2 秒間隔で無制限に再送する。採用した時点で再送を停止する。
- 個別要求への応答期限は設けない。応答が届かない・届いても検証に失敗する間は、単に再送が続く。
- ping/pong の到達性が喪失状態(連続喪失 1 以上)から回復した時点で、採用済みであっても要求を再開し、最新のマニフェストを取得し直す(Unity 再起動でパラメータ構成やキャラクター名が変わっている可能性があるため)。
- Unity 側は受信した要求それぞれに応答してよい。重複応答への特別な配慮は不要で、**重複応答を冪等に扱えばよい**。oscdesk 側では同一内容の再採用は冪等(UI 状態は同一に収束する)。
- Unity は起動時などに、要求を受けていなくても `/sys/manifest` を **自発送信してよい**。oscdesk は要求の有無に関係なく受信したマニフェストを検証して冪等に受理する(Unity の高速再起動が oscdesk の喪失検出をすり抜けた場合でも、最新マニフェストが届く経路を確保するため)。

### Phase 2 確定仕様: 応答の検証と採用

- oscdesk は受信ペイロードを JSON パースし、`packages/shared` の zod `ManifestSchema` で検証する。これが唯一の受け入れ判定である。
- 検証失敗(JSON パース不能・スキーマ違反)の場合: 当該マニフェストは **不採用** とし、原因(zod issue の path 含む)をログへ出力し(同一理由の連続拒否はログ抑制)、直前に採用済みのマニフェストと UI 状態を維持したまま稼働を継続する。要求の再送も継続する。
- 検証成功の場合: 最新版として採用し、UI(ラベル・レンジ・動的生成ウィジェット)へ適用する。

### 誤接続ガード(プロジェクト識別子の照合)

- oscdesk の config には、必要に応じて `expectedProjectId` を設定できる。未設定の場合は `projectId` の照合を行わず、スキーマ検証に成功したマニフェストを採用する。空文字は設定値として無効である。
- `expectedProjectId` が設定されている場合、oscdesk は JSON パースと `ManifestSchema` による検証が成功した後に、受信した `projectId` と `expectedProjectId` を厳密な文字列比較で照合する。大文字・小文字、前後の空白、Unicode 正規化を暗黙に変換してはならない。
- 一致した場合だけマニフェストを採用し、UI を生成・更新する。不一致の場合は `project-mismatch` として不採用にし、直前に採用済みのマニフェスト、UI、表示キャッシュを変更しない。要求中であれば要求の再送を継続し、採用済みであれば採用状態を維持する。
- 不一致は debug 設定に関係なく、`kind: "guard-reject"`、`expectedProjectId`、受信した `receivedProjectId` を含む NDJSON (`osc-guard-*.ndjson`) に記録し、診断パネルの誤接続ガード行にも反映する。同一理由の連続拒否はログを抑制してよいが、拒否判定とパネルの累計は維持する。

このガードは誤ったマニフェストの採用を防ぐためのものであり、認証・暗号化ではない。また、マニフェスト以外の OSC メッセージには識別子を付与しないため、アドレスが偶然一致した別プロジェクトからの値エコーバックや値更新を防ぐものではない。状態保護の対象は `project-mismatch` の拒否だけである。JSON パース失敗またはスキーマ違反は従来どおり不採用として要求を再送するため、採用済み状態でそれらを受信した場合は、正しい応答の再受信後に UI が再適用されることがある。

### Phase 2 確定仕様: 現在値による表示同期

- 採用したマニフェストの各エントリ `default`(Unity の現在値)は、対応ウィジェットの **表示更新としてのみ** 反映する。この反映で oscdesk から Unity への OSC 送信は発生しない(フィードバックループ禁止)。
- 値の確定は引き続き Unity からのエコーバックのみによる(§3)。マニフェストの `default` は接続直後・再接続直後の表示を実状態へ寄せる初期同期にすぎない。
- `type: "b"`(blob)のエントリは値同期の対象外としてスキップし、警告ログのみ残す。`type: "bool"` の値同期は `i` タグの 0/1 で表現する。

## 3. 双方向同期の規律

1. UI 操作 -> OSC 送信(oscdesk -> Unity)
2. Unity が値を確定し、**同一アドレス** にエコーバック(Unity -> oscdesk)
3. oscdesk はエコーバックを受けてウィジェット表示を確定する
4. ドラッグ操作中のウィジェットに対する受信値は無視する。操作終了後の最終エコーバックで整合する

マニフェストを新たに採用したときは、内容が前回と同一であっても各エントリの表示を `default` へ再同期する。ただし入力中などホールド中のウィジェットは上書きせず、ホールド解除後に受信したエコーバックで確定する。これは Unity の再起動・再接続後も、表示を Unity の現在値へ戻すための規則である。

## 4. 実装指針(擬似コード)

本節は、任意の OSC ライブラリの上で `/sys/*` プロトコルの Unity 側を実装するための指針である。特定ライブラリの API には依存しない。擬似コードが前提とする仮想操作は次の 2 つだけである。

- `osc_decode(data)` — 受信データグラムを OSC パケット(メッセージまたは bundle)に復号する
- `osc_send(address, args)` — **設定された返信先(ホスト・ポート)** へ OSC メッセージを単一データグラムで送信する。受信データグラムの送信元へ返す操作ではない(互換性ノート参照)

### 4.1 受信統計の持ち方

保持する状態:

```text
state:
  received: int = 0                   // 正常に decode できた「展開後」メッセージ数
  parseErrors: int = 0                // decode に失敗したデータグラム数
  lastReceivedAt: timestamp           // 最後に正常 decode したメッセージの受信時刻
  currentValues: map<address, value>  // 通常メッセージの現在値(マニフェスト default 用。§4.3)
  bootId: string                      // 起動ごとに 1 度だけ生成する識別子(§4.3)
  structureGeneration: int = 1        // マニフェスト内容の世代。起動時は 1(§4.3)
```

受信処理の骨格(全メッセージ共通の前段。計数規則は §1 の定義に従う):

```text
on datagramReceived(data):
  packet = osc_decode(data)
  if decode 失敗:
    parseErrors += 1                  // received と lastReceivedAt は更新しない
    return
  handlePacket(packet)

handlePacket(packet):
  if packet is bundle:
    for element in packet.elements:
      handlePacket(element)           // 再帰展開。計数は展開後のメッセージ単位
    return
  received += 1                       // 計数と時刻更新はディスパッチより先に行う。
  lastReceivedAt = now()              // したがって /sys/stats/request 自身も数えられる
  dispatch(packet)

dispatch(message):
  switch message.address:
    case "/sys/ping":             replyPong(message.args)       // §4.2
    case "/sys/stats/request":    replyStats()                  // 本節末尾
    case "/sys/manifest/request": replyManifest()               // §4.3
    case 上記以外の "/sys/*":      return                        // 計数のみ。応答しない
    default:                      handleNormalMessage(message)  // §4.3(値記録 + §3 のエコーバック)
```

stats 応答:

```text
replyStats():
  payload = {
    received: received,
    parseErrors: parseErrors,
    lastReceivedAt: iso8601_utc(lastReceivedAt),  // 例: "2026-07-24T12:34:56.789Z"
    bootId: bootId,                               // 任意。マニフェストと同じ組(§2)
    structureGeneration: structureGeneration
  }
  osc_send("/sys/stats", [ string(json_encode(payload)) ])
```

補足:

- 利用ライブラリが bundle を自動展開して要素単位でコールバックを呼ぶ場合、`handlePacket` の bundle 分岐は書かなくてよい(骨格と等価な挙動になる)
- timetag による実行遅延は要求しない。bundle の timetag は無視し、受信後すぐ処理してよい
- 利用ライブラリが decode 失敗を通知しない場合、`parseErrors` は観測できない。その場合は常に 0 を報告し、統計の読み手がその前提を了解しておく
- `lastReceivedAt` は ISO-8601 のオフセット付き表記が必須(`Z` 終端の UTC を規範例とする)

### 4.2 pong 実装

```text
replyPong(args):
  seq = args[0]                        // int32。検査・保持・解釈はしない
  osc_send("/sys/pong", [ int(seq) ])  // 受信した seq をそのまま即時返信
```

- 受信した `seq` をそのまま返す以外の責務はない。喪失判定・RTT 計測・再送はすべて oscdesk 側の責務である(§1)
- 「即時」はイベントループやフレーム処理の次の送信機会で十分。処理遅延は oscdesk 側で RTT として観測されるだけで、プロトコル上の害はない

### 4.3 マニフェスト生成と応答

アプリ側はエントリ定義(何を操作可能として公開するか)を持ち、値は `currentValues` を優先して埋める。エントリ定義は起動時にスナップショットとして固定し、以後の `replyManifest` はそのスナップショットと `currentValues` だけから組み立てる(定義の元データを外部で書き換えただけでは応答の内容は変わらない)。`bootId` は起動ごとに 1 度だけ決め、`structureGeneration` は 1 から始めて、定義の内容を変えて公開し直したときだけ進める。

```text
entryDefs: list of {
  address, label, type, widget,   // 必須
  range?, initial?, group?        // 任意(initial は起動直後の default 用)
}

replyManifest():
  entries = []
  for def in entryDefs:
    entry = { address: def.address, label: def.label, type: def.type, widget: def.widget }
    if def.range が定義済み:   entry.range = def.range
    current = currentValues[def.address] ?? def.initial
    if current が定義済み:     entry.default = current     // 現在値を default として埋める(§2 値同期)
    if def.group が定義済み:   entry.group = def.group
    entries.append(entry)
  payload = { version: 1, projectId: projectId,
              bootId: bootId, structureGeneration: structureGeneration,   // 任意の組(§2)
              entries: entries }
  osc_send("/sys/manifest", [ string(json_encode_utf8(payload)) ])  // s 1 引数・単一データグラム
```

- `projectId` は送信側プロジェクト固有の非空文字列として、すべての `/sys/manifest` 応答に含める。`expectedProjectId` を設定している oscdesk と接続する場合は、両者が同じ文字列を事前に設定しておく。
- Unity 側でマニフェスト定義アセットが未割当、`projectId` が空、またはエントリ定義が不正な場合は、起動時にエラーを記録してマニフェストを送信しない。ping/pong、stats、通常値のエコーバックは継続する。
- 参照実装は、エントリ定義の検証・計画・現在値・`bootId`・`structureGeneration` を、`UnityEngine` に依存しない 1 つのセッション(付録 A.2.9)に持たせ、アダプタ(付録 A.2.4)は初期化・受信・送信をセッションへ委譲する。マニフェストの自発送信・要求への応答は、セッションが準備完了のときだけ行い、サイズ(実用上限)では拒否しない(警告閾値を超えたら警告ログに残す)。
- 実行時の公開 API(参照実装): `SetManifestAsset`(F-5。有効化前だけ定義を差し替える。null と消費済みは false)、`SendManifestNow`(F-6。非アクティブなら送らず false。表示の項目や選択肢リストの更新だけなら世代を 1 進めて現在の内容を 1 回送り、構造の変更やサイズ超過は送らずに false を返す)。失敗の理由はエラーログにも出る。

通常メッセージの処理(現在値の記録とエコーバック):

```text
handleNormalMessage(message):
  value = message.args の先頭にある対応可能な値   // int / float / string(真偽値は 0/1 の int)
  if value が取れた:
    currentValues[message.address] = value        // 次回マニフェストの default に反映される
  osc_send(message.address, message.args)         // 同一アドレスへ受信引数をそのまま返す(§3)
```

#### 4.3.1 ステージング(任意の実装機構)

ステージングはシステムプロトコルの必須要件ではなく、Unity 側が任意に実装できる機構である。実装しない Unity 側は、上記の通常メッセージ処理(受信値の即時記録と同一アドレスへのエコーバック)のまま適合する。実装する場合も、ステージング対象・適用トリガ・展開規則はマニフェスト定義アセットのデータとして宣言し、案件ごとに受信処理の C# を書き換えない。

ステージング対象の値を受信したときは、値をステージング領域(`currentValues`)へ保持し、受信引数を同一アドレスへそのままエコーバックする。したがって UI の表示は直ちに確定するが、アプリケーションへの適用イベントは発火しない。`currentValues` はマニフェストの `default` の供給源でもあるため、再接続時には適用済み値ではなく現在のステージング値を返す。適用処理そのものは実装側の責務であり、参照実装は C# の `event` を購読者へ公開する。

適用トリガは button エントリに適用範囲のワイルドカードパターンを宣言する。トリガの非ゼロ値を受信したときだけ、適用範囲に解決されたアドレスのうち `staged` 宣言済みで現在値を持つものを、エントリ定義順の辞書としてイベントへ渡す。値を破棄・リセットせず、対象が 0 件でもエラーにはしない。トリガ自身は通常どおりエコーバックする。適用トリガは**非ゼロ値の受信でのみ発火**させる。NiceGUI の button は押下時に `1`、解放時に `0` の 2 メッセージを送るためであり、押下時に `0` を送る外部 OSC コントローラでは適用イベントは発火しない。

**UI 側の送信規律(Unity 側の意味論は不変)**: oscdesk の UI は適用トリガの押下時に、マニフェストの `appliesTo` と `staged` から適用範囲を解決し、その範囲に含まれる各エントリの現在の表示値を定義順に並べ、末尾にトリガの on 値を置いた **1 つの OSC bundle**(即時タイムタグ)として送る。トリガの off 値は従来どおり単発メッセージで送る。Unity 側は bundle を展開後メッセージ単位で通常どおり処理すればよく(§4.1 の骨格)、値の記録 → エコーバック → トリガ受信時の適用という順序は単発メッセージを順に受けた場合と同じである。これにより「画面に見えている値がそのまま適用される」ことを、Unity 側の受信処理やステージングエンジンを変えずに成立させる。UI はトリガのエコーバックを 2 秒待ち、届かなければ「適用を確認できなかった」と通知する(未適用の断定ではない)。xy(2 引数)のエントリはステージングが最初の引数しか記録しない(互換性ノート「複数引数メッセージの記録」)ため、`staged` な xy を適用範囲に含むトリガは UI が押下を拒否する(xy をステージング対象にする構成は非対応)。bool は 0 / 1 に正規化して送る。

一括操作の展開元アドレスには、展開先のワイルドカードパターンを宣言できる。受信値は展開先の各アドレスにも同値で記録し、展開元へ受信引数をそのままエコーバックした後、展開先へ単一引数の個別エコーバックを行う。展開先の `currentValues` も更新する。展開は 1 段だけとし、展開先を別の展開元として再展開しない。展開だけでは適用イベントを発火しない。

ワイルドカードは適用範囲と展開先で同じ 1 種類の規則を使う。パターンとアドレスを `/` で分割し、part 数が一致するときだけ照合する。各 part の `*` はその part 内の 0 文字以上に一致するが、`/` は跨がない。`?`、`[]`、`{}`、`,`、`//` は採用しない。例えば `/vp/member/*/*` は `/vp/member/01/active` に一致するが、`/vp/member/*` は part 数が違うため一致しない。

照合は**パターン側とアドレス側の双方に S3 と同じ形の検証**を先に適用し、どちらかが壊れた形(先頭が `/` でない、末尾が `/`、空 part、`//`、未採用のワイルドカード文字)であれば一致しないものとして扱う。エントリのアドレス自体は S3 の検証対象ではないため、壊れた形のアドレスが宣言されても展開先・適用範囲へは解決されない。

受信値の記録規則は次のとおりである。これらは受信アドレスと展開書き込みの双方に適用し、記録しない場合もエコーバックは行う。

| 規則 | 要旨 |
|---|---|
| R1 | 宣言にないアドレスは記録しない |
| R2 | `Int`←`Int`、`Float`←`Int`/`Float`、`String`←`String`、`Bool`←`Int` の 0 または 1 のみ記録し、`Blob` は記録しない |
| R3 | `Bool` の記録値は常に `Int` の 0 または 1 へ正規化する。アセット既定値も同様に扱う |
| R4 | 記録可否にかかわらず、受信アドレスへの通常のエコーバックを行う |

起動時の宣言検証では、次の S1〜S9 をエラーとして全件収集する。検証に失敗した場合はエラーを記録し、マニフェストを送信しないが、ping/pong・stats・エコーバックは継続する。宣言がない場合は空の計画として従来挙動へ戻る。

| 規則 | エラーとなる条件の要旨 |
|---|---|
| S1 | `AppliesTo` が非空なのに button でない |
| S2 | `AppliesTo` が非空なのにトリガ自身が `staged` |
| S3 | パターンの先頭/末尾 `/`、空 part、未採用のワイルドカードまたは `//` |
| S4 | トリガの適用範囲と `staged` の積が空 |
| S5 | 展開先パターンが宣言済みアドレスを 1 件も解決しない |
| S6 | 展開先と展開元の型が異なる |
| S7 | 展開元自身を除く展開先が空(解決集合そのものが空なら S5、型不一致なら S6 が原因を表すため S7 は重ねない) |
| S8 | `Blob` 型エントリを `staged` にしている |
| S9 | ステージング宣言がある状態で同一アドレスのエントリが重複している |

ステージングを含む通常メッセージの処理順序は、エコーバックが適用イベントより先に完了することを保証する。記録可能引数がない場合は記録・展開・適用を行わず、受信アドレスへのエコーだけを行う。

記録可能引数は**値として解釈できる最初の引数 1 つ**(型タグ `i` / `f` / `s`)を指す。エントリ型と突き合わせて引数列から探し直すことはしない。型が合うかどうかは記録規則 R2 の判断であり、抽出の判断ではない。

```text
handleNormalMessage(message):
  value = firstRecordableValue(message.args)
  reaction = staging.handle(message.address, value)  // 記録・展開・適用判定

  osc_send(message.address, message.args)            // 受信アドレスへ verbatim エコー
  for write in reaction.expansionWrites:             // 展開元のときだけ
    osc_send(write.address, [ write.value ])         // 展開先へ個別エコー

  if reaction.applyRequested:                        // 非ゼロ値のトリガだけ
    applyRequested(message.address, reaction.applyValues)
```

補足:

- 要求 1 件ごとに応答してよい。oscdesk は重複応答を冪等に受理するため(§2)、応答の抑制やデバウンスは不要
- 起動直後などに、要求を受けていなくても自発送信してよい(§2)
- JSON は UTF-8。任意フィールド(range / default / group)は値がないとき **キーごと省略** し、`null` を書かない(`ManifestSchema` は null を許容しない)
- JSON 全体は単一データグラムに収まること(~1.4KB 以内を推奨、実用上限 ~60KB。共有参照を使う 64 スロット相当のステージング付き構成の実測は 53,233 bytes で、56 KiB(57,344 bytes)の警告閾値未満。互換性ノート参照)

### 4.4 不変条件(§4 共通)

- 全送信は設定された返信先へ行う。受信データグラムの送信元ホスト・ポートへ返さない
- 使用する OSC 機能は基本型タグ `i` / `f` / `s` / `b` と bundle / timetag のみ。真偽値は `i` の 0/1 で送る(`T` / `F` タグは使わない)
- 配列引数・カラー型・64bit 整数・ライブラリ独自の bool 変換など、OSC 1.0 で解釈が割れやすい機能は使わない。表現上必要になった場合も使用せず、代替表現と理由を互換性ノートに記録する
- `/sys/stats` の JSON は `StatsPayloadSchema`、`/sys/manifest` の JSON は `ManifestSchema`(いずれも `packages/shared`)に適合させる
- `/sys/manifest` の JSON には、空でない `projectId` を必ず含める。`expectedProjectId` が設定された受信側は、スキーマ検証後に Unicode 正規化を行わず厳密比較する

### 4.5 input / select の実装指針

`input` と `select` は通常メッセージと同じアドレスへ値を送信し、Unity は §3 の規律どおり受信値を同一アドレスへエコーバックする。マニフェストの `default` は表示初期化だけに使い、初期化を契機に送信してはならない。

#### input

- 文字列・整数・小数を編集できる入力欄として表示する。編集途中の各キーストロークでは送信せず、Enter またはフォーカス喪失を確定イベントとする。
- 確定時に `pattern`、int32 の値域、`range`、有限値などを検証する。検証に失敗した値は送信せず、クランプや暗黙の書式変換も行わない。Enter での拒否は編集を継続し、フォーカス喪失での拒否は現在値へ表示を戻す。
- 編集中はホールドを設定し、Unity からのエコーバックで表示を上書きしない。ホールドは**フォーカスを得た時点**から始まり(最初の 1 文字を打つ前に届いたエコーバックでも欄は書き換わらない)、確定成功またはフォーカス喪失で解除する。その後のエコーバックを表示の確定値とする。
- ホールドの期限(参照実装は 120 秒)は、ページが消えて blur を取りこぼしたときの保険であり、フォーカス中は UI の同期タイマーが期限を延長し続けるため、キー入力が止まっていても期限切れにならない。クライアント切断時はそのクライアント由来のホールドを即時解放する。
- 未編集のままフォーカスを失った場合(Tab で通り抜けた・クリックして離れた)は送信せず、ホールド解除のみ行う。同じ値を意図的に送り直したい場合は Enter で確定する(Enter は編集の有無に関わらず送信する)。
- 送信する OSC 型タグは `type` に従う(`s` / `i` / `f`)。確定送信は 1 回だけ行い、値の確定は必ずエコーバックで行う。

#### select

- `options` または `optionsRef` を解決した文字列配列をドロップダウンへ表示する。選択操作は即時に 1 回だけ同一アドレスへ `s` タグで送信し、ホールドは使用しない。
- エコーバックが選択肢内なら選択状態を確定する。選択肢外の値は一覧へ追加せず選択状態を空にし、ドロップダウン直下などの表示部へ受信文字列をそのまま表示する。選択肢内の値に戻ったらこの補助表示を解除する。
- 選択肢が空の場合はドロップダウンを無効化し、「選択肢なし」を表示する。`default` やエコーバックが選択肢外でも受信値を表示し、マニフェストを不採用にしない。

### 4.6 実行時のマニフェスト再注入(F-8)

ホストアプリがシーンの内容(行の追加・削除など)を実行時に変えたとき、マニフェストの定義も同じ内容へ差し替えて UI へ公開し直す機構である。ワイヤプロトコルは変えない(§2 の `structureGeneration` が 1 進むだけで、`bootId` は起動中変わらない)。使わない Unity 側は従来どおり適合する。参照実装(付録 A.2.4 / A.2.9)は次の 3 つの API を公開する。

- `PrecheckManifestAsset(asset)`: 差し替え先のアセットを検査する。副作用はなく、送信も、保持するアセットの差し替えも、セッションの状態の変更もしない。結果に合否・失敗理由・候補から組み立てた JSON のバイト数が入る
- `TryReinjectManifest(check)`: 事前検査の結果を渡して確定する。成功したら保持するアセットの参照を差し替え、アクティブなら `/sys/manifest` を 1 回送る。非アクティブなら送らず、次の有効化時の自発送信に任せる。失敗したときは送信もアセットの差し替えも起きない
- `TryReinjectManifestAsset(asset)`: 上の 2 つを続けて行う簡易版

いずれも Awake の前は未初期化(`NotInitialized`)として拒否し、失敗の理由と問題はエラーログにも出る。すべてメインスレッドから呼ぶ。

**ホストの呼び出し順**: 事前検査 → 実状態の変更 → 再注入。事前検査に通らなければ実状態を変えない。事前検査の後に値が記録されるなど状態が変わった場合、確定は同じ判定をやり直し、落ちたら `StateChangedSinceCheck` を付けて返す。

**失敗時の責務**: 再注入が失敗したとき、UI と Unity の定義は直前の成功状態のまま動き続ける。実状態(シーン上のオブジェクトなど)を変えてしまっていた場合は、ホストが実状態を元に戻すか、事前検査からやり直す。

| 失敗理由 | ホストの対応 |
|---------|-------------|
| `NotInitialized` | Awake の後に呼ぶ |
| `InvalidManifest` | アセットを直す |
| `ProjectIdMismatch` | `projectId` を変えない。変えるならブリッジの設定変更と再起動 |
| `AddressReused` | アドレスを識別子から作る。同じ識別子なら同じアドレスに戻す |
| `StagingCompileFailed` | staging の宣言を直す |
| `PayloadTooLarge` | エントリを減らす、選択肢を共有参照にする |
| `StateChangedSinceCheck = true` | 実状態を戻すか、事前検査からやり直す |

**F-6(`SendManifestNow`)との関係**: 再注入を使わずに取り込めるのは、表示の項目(`label` など)・選択肢リストの更新と、button 以外どうしの `widget` の変更(fader → input など)だけで、構造の世代が 1 進む。エントリの集合・順序、`type` / `address` / `id` / `staged` / `appliesTo` / `expandsTo`、既定値、button と button 以外の間の変更は `StructuralChangeRequiresReinject` で拒否される。これらは再注入 API で差し替える。非アクティブなら `Inactive`、構造の変更を伴う抑止中は `Suppressed` で拒否される。

## 5. 実 Unity 接続手順

### 5.1 前提条件とポート対応

トランスポートは UDP。次の 3 者(config・oscdesk 起動引数・Unity 側設定)が互いに一致している必要がある。

| 経路 | config(`config/oscdesk.config.json`) | ブリッジ起動引数(config を上書きする場合) | Unity 側 |
|---|---|---|---|
| oscdesk → Unity(ping・各要求・値送信) | `unity.host` : `unity.sendPort`(既定 `127.0.0.1:7090`) | `--unity-host <host>` / `--unity-port <port>` | OSC 受信の待受ポート = `unity.sendPort` |
| Unity → oscdesk(pong・各応答・エコーバック) | `bridge.oscListenPort`(既定 `7091`) | `--osc-listen-port <port>` | OSC 送信の宛先 = oscdesk マシンの IP : `bridge.oscListenPort` |

- ブリッジは UDP ソケット 1 本で待受と送出を兼ねるため、**Unity から見た送信元ポートは `bridge.oscListenPort` と一致する**。それでも返信先は設定で明示すること(下記)
- **返信先は設定で明示する**(互換性ノート再掲)。Unity 側は「受信データグラムの送信元へ返す」実装にせず、上表の宛先を設定値として持つこと
- **同一マシン構成**(Unity Editor と oscdesk を同じ PC で動かす): config は既定のまま。Unity 側は待受 7090、送信宛先 127.0.0.1:7091
- **LAN 分離構成**(Unity 実機が別マシン): `unity.host` を Unity 機の IP(例 `192.168.1.20`)へ変更し、Unity 側の送信宛先を oscdesk 機の IP(例 `192.168.1.10`)+ `7091` にする。config を書き換えない場合は起動引数 `--unity-host 192.168.1.20 --unity-port 7090` で上書きする。両マシンのファイアウォールで UDP 受信(Unity 機: 7090 / oscdesk 機: 7091)を許可する
- 接続確認の間は debug ON の config(`config/oscdesk.debug.config.json`。NDJSON ログが有効)での起動を推奨する。`OSCDESK_CONFIG` は **絶対パス** で指定する(相対パスは oscdesk がブリッジのディレクトリ基準で解決するため、リポジトリ root 基準の相対指定は失敗し既定 config で起動してしまう):

  ```powershell
  $env:OSCDESK_CONFIG="$PWD\config\oscdesk.debug.config.json"
  node packages/bridge/dist/oscdesk-bridge.js
  Remove-Item Env:OSCDESK_CONFIG
  ```

### 5.2 段階的疎通確認

前提: §4 を実装した Unity 側アプリ(具体例は付録 A)が起動済み、`start-oscdesk.bat` でブリッジと NiceGUI 版 UI が §5.1 の設定で起動済み、ブラウザで UI(既定 `http://<oscdesk ホスト>:8080`)を開いている。

観測点は 3 つある。**診断パネルは廃止された(D-3 / D-031)**ので、以下を使う:

- **UI ヘッダの 3 段ステータス** — (a) ブリッジとの接続、(b) Unity の到達性・RTT・連続喪失回数、(c) マニフェスト状態と直近の拒否理由
- **ブリッジの標準出力** — 起動完了行 `OSCDESK_BRIDGE_READY` と、種別つき 1 行形式のログ
- **NDJSON ログ** — debug ON のとき `logs/diagnostics/oscdesk-debug-*.ndjson` に送受信が記録される

**① ping/pong の成立(到達性)**

- oscdesk は起動直後から 2 秒間隔で `/sys/ping` を送信している。UI ヘッダの Unity 段が「Unity 接続中」になり RTT に数値(ms)が出ることを確認する
- 失敗したら → §5.3 の「到達性が『喪失』のまま」

**② マニフェストの採用**

- oscdesk は採用に成功するまで 2 秒間隔で `/sys/manifest/request` を送信している。UI ヘッダのマニフェスト段に `projectId` とエントリ件数が出て、マニフェスト由来のウィジェットが描画されることを確認する
- 失敗したら → §5.3 の「到達するがマニフェストが採用されない」

**③ 値のエコーバック確定**

- 任意のウィジェットを操作し、離した後に表示が確定する(Unity からのエコーバックで値が定まる)ことを確認する。debug ON なら NDJSON ログで、送信(out)と同一アドレスの受信(in)のペアとして観測できる
- 失敗したら → §5.3 の「値が確定しない」

①〜③ が揃えば接続は成立している。

**④ /sys/stats の取得(任意・Unity 実装の確認)**

- oscdesk の通常運用は `/sys/stats/request` を送信しない(§1 の stats は診断・実装確認用のプロトコルである)。Unity 側の受信統計実装を確認したい場合は、任意の送信手段で `/sys/stats/request` を Unity の待受ポートへ送る
- 応答 `/sys/stats` は Unity に設定された返信先(= oscdesk の受信ポート)へ届くため、NDJSON ログ(debug ON)またはブリッジ標準出力で JSON(received / parseErrors / lastReceivedAt)を確認する
- 本リポジトリのあるマシンからは、次のワンライナーで要求を送れる(リポジトリ root で実行。宛先は Unity の待受に合わせる):

  ```powershell
  node -e "const osc=require('osc'); const p=new osc.UDPPort({localAddress:'0.0.0.0',localPort:0,remoteAddress:'127.0.0.1',remotePort:7090}); p.on('ready',()=>{p.send({address:'/sys/stats/request',args:[]}); setTimeout(()=>process.exit(0),200)}); p.open()"
  ```

### 5.3 接続できないときの切り分け

| 症状 | 主な原因候補 | 確認・対処 |
|---|---|---|
| 到達性が「喪失」のまま / RTT が出ない | ポート・宛先の不一致 | §5.1 の 3 者対応を再確認。特に `unity.host` : `unity.sendPort` ↔ Unity 側の待受、`bridge.oscListenPort` ↔ Unity 側の送信宛先ポート |
| 〃 | ファイアウォールの UDP 受信ブロック | Unity 機の待受ポート(7090)と oscdesk 機の受信ポート(7091)の UDP 受信を許可する |
| 〃 | 別サブネット | 診断スナップショット(`/oscdesk/diag/request` への応答)のサブネット判定が「別サブネット」なら、同一セグメントへの接続か経路設定を確認する |
| 〃 | Unity 側の未起動・pong 未実装 | Unity 側アプリの起動と §4.2 の実装を確認する |
| Editor の Pause 中だけ「喪失」になる | 正常挙動 | pong 返信はフレーム処理に依存するため Pause 中は応答が止まる。Play 再開で回復する |
| 到達するがマニフェストが採用されない | JSON がスキーマ検証に失敗 | oscdesk 側コンソールログの検証失敗(zod issue の path 付き)を確認し、`ManifestSchema` に適合させる(§2) |
| 〃 | ペイロードが大きすぎる | 単一データグラムに収まっているか確認する(~1.4KB 推奨。互換性ノート) |
| UI の操作が Unity に届かない | Unity 宛先の設定ミス | UI からの値は必ず `unity.host` : `unity.sendPort` にのみ送出される。UI ヘッダの「Unity 宛先」表示と Unity 側の待受を突き合わせる |
| 値が確定しない(操作後に表示が戻る・変わらない) | エコーバック未実装・別アドレスへの返信 | §3 のとおり **同一アドレス** へ受信引数をそのまま返しているか確認する |
| 〃 | エコーバック宛先の誤り | Unity → oscdesk の宛先(oscdesk 機 IP : `receivePort`)を確認する |
| ④ 実施時に stats 応答が来ない | dispatch 分岐・返信先の誤り | §4.1 の `/sys/stats/request` 分岐と返信先設定を確認する |

診断手段: UI ヘッダの 3 段ステータス(ブリッジ接続・Unity 到達性と RTT・マニフェスト状態と直近拒否)、診断スナップショット(`/oscdesk/diag/request` を送ると `/oscdesk/diag` で到達性・損失率・サブネット判定・ログ使用量が JSON で返る)、デバッグモードの NDJSON ログ(`logs/diagnostics/oscdesk-debug-*.ndjson`)、ブリッジの標準出力。起動方法と観測手順の詳細は `docs/VERIFICATION.md` を参照。

## 6. ライブラリ互換性チェックリスト

利用予定の OSC ライブラリ(独自 Fork 含む)が次を満たすか確認する。不適合の項目は右列の代替策を検討し、判断に迷う差異は互換性ノートの記録方針に従う。

| # | チェック項目 | 満たさない場合の代替策 |
|---|---|---|
| 1 | UTF-8 文字列(`s` タグ)を欠損なく送受信できる(日本語ラベル・JSON ペイロード) | JSON の非 ASCII 文字を `\uXXXX` エスケープする ASCII-safe 化(互換性ノート「文字列は UTF-8」) |
| 2 | 基本型タグ `i` / `f` / `s` を送受信できる(`b` は受信許容のみでよい) | 代替なし。本プロトコルの前提であり、満たさない場合は利用不可 |
| 3 | 送信宛先(ホスト・ポート)を設定で明示指定できる(受信元への自動返信に依存しない) | 代替なし(互換性ノート「返信先」)。必須要件 |
| 4 | bundle を受信展開できる(自動展開または要素へアクセスできる) | 代替なし。oscdesk の UI は適用トリガの押下時に適用範囲の値とトリガを 1 つの bundle で送る(§4.3.1)ため、bundle を展開できないライブラリでは適用セットが届かない。展開後メッセージ単位の計数(§4.1)を守れる形で吸収する |
| 5 | 想定ペイロードサイズのデータグラムを送受信できる(~1.4KB 推奨、実用上限 ~60KB) | マニフェストのエントリ数を減らして JSON を小さくする。それでも不足する場合の拡張はユーザー判断(互換性ノート「単一 UDP データグラム」) |
| 6 | アドレスをリテラル一致でディスパッチできる(OSC パターンマッチング機能は不要) | 本プロトコルはパターンを使わないため通常は問題にならない。受信側で意図せずパターン展開されないことだけ確認する |
| 7 | 真偽値を `i` の 0/1 として送信できる(`T` / `F` タグの強制がない、または回避できる) | 送信前に 0/1 の int へ変換する層を挟む(§4.4。互換性ノート「bool の実装状況」) |

## 互換性ノート

- Phase 1 以降、標準仕様と各ライブラリの差異が判明するたびここに追記する。
- 返信先は「受信データグラムの送信元に必ず返る」とはみなさない。運用上は返信先ホスト・ポートを設定で明示できる前提で実装する。
- mock-unity とテスト系では `osc` npm をコーデックとして使うが、プロトコル仕様自体は `osc` 固有仕様に依存しない。
- Phase 1 で許容する OSC 型は基本型タグ `i` / `f` / `s` / `b` と bundle / timetag のみである。
- `metadata: true` のようなライブラリ固有表現は実装都合にすぎず、相互接続仕様ではない。
- 配列引数、カラー型、64bit 整数、ライブラリ独自の bool 変換など、OSC 1.0 で解釈が割れやすい機能は使わない。
- 複数値が必要な場合は複数引数または JSON 文字列で表現し、特定ライブラリ固有の配列表現に依存しない。
- `received` の意味はライブラリ依存ではなく、本仕様で定義した「正常 decode できた展開後メッセージ件数」を正とする。
- bundle の計数も bundle 全体ではなく展開後メッセージ単位とする。ライブラリ側のイベント粒度が異なっても、この仕様に合わせて吸収する。
- 追加の解釈差異が見つかり、本体改造やプロトコル変更が必要な場合は、この節に差分と選択肢を記録した上でユーザー判断へ返す。

### Phase 2 追記(マニフェストハンドシェイク)

- **`/sys/manifest` は単一 UDP データグラムに収める**。OSC 1.0 にメッセージ分割・再結合の機構はない。IP フラグメンテーションを避けるには JSON 全体で **~1.4KB 以内を推奨**(一般的な MTU 1500 を想定)。フラグメント許容でも IPv4 UDP の理論上限から **実用上限は ~60KB** とみなす。これを超えるマニフェストが必要になった場合は、独断でプロトコルを拡張せず、選択肢(エントリ分割の拡張仕様・TCP 等の別トランスポート・エントリ数の削減)を添えてユーザー判断へ返す。数値は `packages/shared` の `MANIFEST_SIZE`(推奨 1400 B / 警告 56 KiB / 実用上限 60 KiB)に置き、mock-unity は送信直前のマニフェストが警告閾値を超えるとサイズを警告ログに出す。大規模シナリオ(`packages/mock-unity/scenarios/large-input-select.json`、64 スロット × 4 + グローバル 4 = 260 エントリ、日本語混在のデバイス名 8 件)の実測は共有参照で約 47KB、各エントリへインライン展開すると約 66KB で上限を超える。ステージング付きの 64 スロット相当シナリオ(`scenarios/large-staging.json`、各スロットの update と全体 update、MB 群を加えた 324 エントリ)の実測は **53,233 bytes**、同一エントリで `staging` 節を省いた対照の **47,780 bytes** に対するステージング(`staged` / `appliesTo`)の増加分は **5,453 bytes** で、56 KiB(57,344 bytes)の警告閾値未満かつ 60 KiB の実用上限未満だった(2026-09-26)。`optionsRef` / `optionLists` はこの規模を送るための必須機構であり、mock-unity のシナリオテストが両方のシナリオのサイズを回帰ガードしている。
- **文字列は UTF-8**。OSC 1.0 は文字列のエンコーディングを規定しないため、本プロトコルでは `s` タグの文字列(`/sys/manifest` の JSON ペイロード含む)を UTF-8 と定める。Phase 2 の E2E で、UTF-8 マルチバイトの日本語キャラクター名が mock-unity(`osc` npm)→ oscdesk → ブラウザ UI の全経路を欠損なく往復することを実測済み。相手ライブラリが UTF-8 文字列を扱えない場合は、JSON ペイロードの非 ASCII 文字を `\uXXXX` エスケープする ASCII-safe 化が選択肢になる(JSON 仕様上は等価な表現。既定では行わない)。
- **`bool` の実装状況**: Phase 2 時点では値の送受信・表示同期とも `i` タグの 0/1 で行う(oscdesk ウィジェットの値が数値であるため)。§2 に記載していた `T`/`F` タグ変換と config フォールバックは未実装の将来オプションであり、`T`/`F` を要求する Unity 側ライブラリが現れた時点で差分をこの節に記録して判断へ返す。
- **`b`(blob)型の値同期非対応**: blob は UI ウィジェットの表示値として表現できないため、値同期の対象外(警告付きスキップ)を確定挙動とする。エントリ定義自体は許容する。
- **未対応 OSC 型タグ**: 本プロトコルで対応しない型タグを受信した場合、その引数またはメッセージは破棄し、警告を記録する。対応する引数だけを推測して処理してはならない。
- **Phase 5 のプロジェクト識別子**: `projectId` は `/sys/manifest` の JSON ペイロード内のフィールドであり、OSC の型タグは従来どおり `s` 1 引数のままである。したがって OSC ライブラリの変更は不要で、JSON の必須フィールドとして扱う。`expectedProjectId` が設定されている場合の照合はスキーマ検証後の厳密な文字列比較であり、Unicode 正規化・大文字小文字変換・空白除去は行わない。識別子は人間が決める任意の非空文字列である。
- **誤接続ガードの制限**: 識別子不一致のマニフェストは採用せず、採用済み UI を維持するが、値エコーバックの受信は遮断しない。また、スキーマ不正や JSON パース失敗は識別子不一致とは別の拒否であり、要求再送による UI 再適用が発生し得る。拒否の NDJSON 記録は debug 設定に依存しない。
- **oscdesk リモートコマンドで実現できない更新要件の扱い**(開発規律): マニフェスト適用は oscdesk のリモートコマンド(`/EDIT` 等)の範囲で実現する。この範囲で実現できない更新要件が判明した場合は、本体改造や回避策を独断で実装せず、差分をこの節に記録し選択肢を添えてユーザーへ報告する。Phase 2 の実装(ラベル・レンジ更新、動的生成、現在値の表示同期)は `/EDIT` と表示専用の受信経路の範囲で全要件を実現でき、該当事項は発生しなかった。上記の `bool` 0/1 と `b` 型スキップが、実装中に判明した仕様と実装の差分・確定事項の全てである。

### Phase 4 追記(実装指針と実機検証)

- **timetag の遅延実行は要求しない**: bundle の timetag は無視して受信後すぐ処理してよい(§4.1 補足)。mock-unity・参照実装とも即時処理であり、遅延実行に依存する送信は行わない
- **`/sys/stats/request` は oscdesk の通常運用では送信されない**: §1 の stats は診断・実装確認用のプロトコルであり、oscdesk が自動送信するのは `/sys/ping` と `/sys/manifest/request` のみ。stats の動作確認手順は §5.2 ④ に記載した
- **uOSC(付録 A)で判明した差異**: decode 失敗が観測できず `parseErrors` は常に 0 / C# `bool` は送信できず 0/1 の `int` へ正規化 / 受信コールバックがフレーム同期のため RTT にフレーム時間が乗る。いずれもプロトコル自体の変更は不要で、詳細は付録 A.4 に記録した
- **実機検証済み**: Unity Editor(6000.0.36f1)+ uOSC 2.2.0 + 付録 A.2 の参照実装で、§5.2 の全段階(到達性・マニフェスト採用・エコーバック・stats)、Pause 中の喪失表示と Play 再開での回復、回復時のマニフェスト自動再要求、操作後の現在値が `default` に反映された再マニフェストまでをループバック構成で確認した(2026-07-24)

### Phase 6 追記(input / select とバージョン互換性)

- **バージョン 1 の後方互換**: `input` / `select`、`options`、`optionsRef`、`optionLists`、`pattern` は `version: 1` のマニフェストへ追加する任意フィールドであり、既存の `fader` / `button` / `toggle` / `xy` / `text` エントリと既存の OSC アドレス・型タグを変更しない。新フィールドを使わない旧マニフェストは従来どおり受理できる。
- **旧 UI の挙動**: 現行の旧 UI は widget enum や条件付きフィールドを共有スキーマで検証するため、新しい widget 値または新しい制約を知らない場合、マニフェストの一部だけを無視せず検証エラーとしてマニフェスト全体を不採用にする。旧 UI と接続する場合は旧 widget のみを出力するか、UI 側を先に更新する。
- **新 UI の挙動**: 新 UI は `optionsRef` を `optionLists` で解決できない、select に選択肢がない、排他指定に違反する、または `pattern` をコンパイルできないマニフェストを不採用にする。直前に採用したマニフェストと表示状態は維持し、要求の再送を継続する。
- **実装間の正規表現差**: `pattern` は TS / Python / C# のすべてで検証・評価可能な基本機能に限定する。高度なエンジン固有構文を使うと、送信側の早期検証を通っても UI 側で拒否され得るため、マニフェスト作成者は使用しない。
- **付録 A の参照実装**: `OscSurfaceManifestAsset` は input / select と共有選択肢・pattern の検証を送信前に行い、違反時は `/sys/manifest` を送信しない。付録 A.2 の C# 全文は `OscSurface/Assets/OscSurfaceBridge/` の実ファイルと同期させる。

### Phase 7 追記(ステージング適用と互換性)

- **ステージングの位置づけ**: ステージングはワイヤプロトコルを変更しない Unity 側の任意実装機構である。ワイヤ上は通常の受信値エコーバックと区別がつかず、ステージングを実装しない Unity 側も従来どおり適合する。
- **`bool` の現在値記録**: `bool` エントリの現在値記録が有効化され、マニフェスト `default` の出力形は従来の真偽値(`true` / `false`)から `i` タグに対応する数値(`0` / `1`)へ変わる。これは従来、`bool` の現在値が記録されず更新されないことが既定挙動だったためである。
- **適用トリガの発火条件**: ステージングの適用トリガは非ゼロ値を受信したときだけ発火する。NiceGUI の button は押下で `1`、解放で `0` を送るため、1 回の押下で適用は 1 回だけとなる。押下時に `0` を送る外部 OSC コントローラでは適用イベントは発火しない。
- **複数引数メッセージの記録**: 記録に使うのは値として解釈できる最初の引数 1 つだけであり、エントリ型に合う引数を引数列から探し直さない。ラベルなどを先頭に付けて送る外部 OSC コントローラでは、先頭引数の型がエントリ型と合わなければ記録されない(エコーバックは通常どおり行う)。oscdesk の UI と mock-unity は常に単一引数で送るため、この差は外部コントローラを直結した場合にだけ現れる。
- **`T` / `F` 型タグの受理差**: 参照実装(付録 A.2)は `T` / `F` を記録可能引数として扱わない。§4.4 の規律どおり真偽値は `i` の 0/1 で送るためである。一方 mock-unity は受信した `T` / `F` を真偽値として取り込む(テスト用の寛容措置)。`T` / `F` を送る外部コントローラを使う場合、mock-unity では記録され実機 Unity では記録されない差が出る。
- **ワイヤ上の任意フィールド**: `staged` と `appliesTo` は `version: 1` のマニフェストへ追加できる任意フィールドであり、ステージングを使わない Unity は両キーを省略する。`staged: false` や空の `appliesTo` を送らず、既存のエントリと `/sys/*` の要求・応答・エコーバックは変更しない。

### Phase 8 追記(実行時のマニフェスト再注入)

- **組の項目の追加**: `/sys/manifest` と `/sys/stats` の JSON に、任意項目 `bootId`(string、1〜64 文字)と `structureGeneration`(整数)を追加した。両方あるか両方ないかであり、いずれも JSON ペイロード内の項目なので、OSC の型タグ(`s` 1 引数)・`/sys/*` のアドレス体系・OSC 1.0 標準の範囲は変わらない。`version` は `1` のままで、組を持たない従来の Unity 実装との接続は従来どおり成立する(受信側は組が無いときは重複判定をせず従来どおり採用する)。マニフェスト JSON では `projectId` の直後に出力する。エントリの識別子(アセットの `id`)はワイヤに載せない。
- **`{characterName}` の置換時点の変更**: 参照実装は `label` と文字列の既定値の `{characterName}` を、送信のたびではなく、アセットをスナップショットに写す時点(Awake と、F-6 / F-8 の成功時)で置換する。起動後にインスペクタの `characterName` を書き換えても、次にスナップショットを取り直すまで `/sys/manifest` には反映されない。
- **アセットの `id` の追加**: `OscSurfaceManifestAsset.Entry` に任意の `id`(既定は空文字)を足した。既存のアセットは空として読まれ、空のときはアドレスが識別子になる。F-6 はエントリの識別子の変更を構造の変更として拒否する。

## 付録 A: uOSC 参照実装

uOSC(hecomi 版 v2 系、検証バージョン 2.2.0)を採用する場合の具体例。本文 §1〜§6 はこの付録に依存しない。別ライブラリの利用者は A.3 の読み替え表を自分のライブラリの API に置き換えるだけで、本文 §4 の擬似コードをそのまま実装できる。

### A.1 導入(UPM)

`Packages/manifest.json` にスコープドレジストリと依存を追加する:

```json
{
  "dependencies": {
    "com.hecomi.uosc": "2.2.0"
  },
  "scopedRegistries": [
    {
      "name": "hecomi",
      "url": "https://registry.npmjs.com",
      "scopes": ["com.hecomi"]
    }
  ]
}
```

- スコープドレジストリを初めて追加した直後の Editor 起動では「Importing a scoped registry」の確認ダイアログが表示され、閉じるまで Editor が停止して見えることがある。`Close` で閉じてよい
- 代替導入(レジストリ障害時など): UPM の git URL `https://github.com/hecomi/uOSC.git#upm`、または GitHub Releases の `.unitypackage`

### A.2 参照実装(中核アセンブリ + アダプタ + テストアセンブリ)

使い方: 空の GameObject に `OscSurfaceBridge` を追加し(`RequireComponent` で `uOscServer` / `uOscClient` も自動追加される)、インスペクタで次を設定して Play する。

- `uOscServer.port` = oscdesk config の `unity.sendPort`(既定 7090)
- `uOscClient.address` / `port` = oscdesk ホスト : `unity.receivePort`(既定 `127.0.0.1` : 7091)
- `manifestAsset` = `OscSurfaceManifestAsset` の同梱アセット(またはプロジェクト固有のアセット)

中核(ステージングエンジン、マニフェストのモデルとセッション)は `UnityEngine` と OSC ライブラリを参照しない純 C# アセンブリであり、宣言の検証・値の保持・反応の決定・マニフェストと stats の JSON の組み立て・起動の識別子と構造の世代の管理を担当する。`OscSurfaceBridge` は薄いアダプタで、Unity のメインスレッド上でアセットをスナップショットに写して中核のセッションへ委譲し、uOSC への送受信とイベント通知、公開 API(`SetManifestAsset` / `SendManifestNow`)を担当する。EditMode テストは中核アセンブリだけを対象とし、実 UDP を送信する `OscSurfaceBridge` 本体は対象外とする。

付録 A.2 のコードブロックは、次のリポジトリ実ファイルの全文を UTF-8 のままコピーしたものである。コードブロックの内容と対応する実ファイルが文字列一致することを不変条件とし、修正時は対応するファイルと同時に更新する。

#### A.2.1 `OscSurfaceBridge.Staging.asmdef` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/Staging/OscSurfaceBridge.Staging.asmdef` である。

```json
{
  "name": "OscSurfaceBridge.Staging",
  "rootNamespace": "OscDesk.Staging",
  "references": [],
  "includePlatforms": [],
  "excludePlatforms": [],
  "allowUnsafeCode": false,
  "overrideReferences": false,
  "precompiledReferences": [],
  "autoReferenced": true,
  "defineConstraints": [],
  "versionDefines": [],
  "noEngineReferences": true
}
```

#### A.2.2 `OscSurfaceStaging.cs` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/Staging/OscSurfaceStaging.cs` である。

```csharp
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace OscDesk.Staging
{
    public enum StagingValueKind
    {
        None,
        Int,
        Float,
        String
    }

    public readonly struct StagingValue : IEquatable<StagingValue>
    {
        public StagingValueKind Kind { get; }
        public int IntValue { get; }
        public float FloatValue { get; }
        public string StringValue { get; }

        public static StagingValue None => new StagingValue(StagingValueKind.None, 0, 0f, null);

        private StagingValue(StagingValueKind kind, int intValue, float floatValue, string stringValue)
        {
            Kind = kind;
            IntValue = intValue;
            FloatValue = floatValue;
            StringValue = stringValue;
        }

        public static StagingValue FromInt(int value)
        {
            return new StagingValue(StagingValueKind.Int, value, 0f, null);
        }

        public static StagingValue FromFloat(float value)
        {
            return new StagingValue(StagingValueKind.Float, 0, value, null);
        }

        public static StagingValue FromString(string value)
        {
            return new StagingValue(StagingValueKind.String, 0, 0f, value ?? string.Empty);
        }

        public bool IsTruthy
        {
            get
            {
                switch (Kind)
                {
                    case StagingValueKind.Int:
                        return IntValue != 0;
                    case StagingValueKind.Float:
                        return FloatValue != 0f;
                    case StagingValueKind.String:
                        return !string.IsNullOrEmpty(StringValue);
                    default:
                        return false;
                }
            }
        }

        public bool Equals(StagingValue other)
        {
            return Kind == other.Kind
                && IntValue == other.IntValue
                && FloatValue.Equals(other.FloatValue)
                && string.Equals(StringValue, other.StringValue, StringComparison.Ordinal);
        }

        public override bool Equals(object obj)
        {
            return obj is StagingValue && Equals((StagingValue)obj);
        }

        public override int GetHashCode()
        {
            unchecked
            {
                var hash = (int)Kind;
                hash = (hash * 397) ^ IntValue;
                hash = (hash * 397) ^ FloatValue.GetHashCode();
                hash = (hash * 397) ^ (StringValue == null ? 0 : StringValue.GetHashCode());
                return hash;
            }
        }

        public static bool operator ==(StagingValue left, StagingValue right)
        {
            return left.Equals(right);
        }

        public static bool operator !=(StagingValue left, StagingValue right)
        {
            return !left.Equals(right);
        }

        public string ToJsonLiteral()
        {
            switch (Kind)
            {
                case StagingValueKind.Int:
                    return IntValue.ToString(CultureInfo.InvariantCulture);
                case StagingValueKind.Float:
                    return FloatValue.ToString("R", CultureInfo.InvariantCulture);
                case StagingValueKind.String:
                    return Quote(StringValue);
                default:
                    throw new InvalidOperationException("A None staging value has no JSON literal.");
            }
        }

        private static string Quote(string value)
        {
            var builder = new StringBuilder(value.Length + 2);
            builder.Append('"');

            foreach (var character in value)
            {
                switch (character)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (character < ' ')
                        {
                            builder.Append("\\u")
                                .Append(((int)character).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            builder.Append(character);
                        }
                        break;
                }
            }

            builder.Append('"');
            return builder.ToString();
        }
    }

    public enum StagingEntryType
    {
        Int,
        Float,
        String,
        Blob,
        Bool
    }

    public sealed class StagingEntryDeclaration
    {
        public string Address { get; }
        public StagingEntryType Type { get; }
        public bool IsButton { get; }
        public bool Staged { get; }
        public IReadOnlyList<string> AppliesTo { get; }
        public IReadOnlyList<string> ExpandsTo { get; }

        public StagingEntryDeclaration(
            string address,
            StagingEntryType type,
            bool isButton,
            bool staged,
            IReadOnlyList<string> appliesTo,
            IReadOnlyList<string> expandsTo)
        {
            Address = address;
            Type = type;
            IsButton = isButton;
            Staged = staged;
            AppliesTo = Copy(appliesTo);
            ExpandsTo = Copy(expandsTo);
        }

        private static IReadOnlyList<string> Copy(IReadOnlyList<string> values)
        {
            if (values == null || values.Count == 0)
            {
                return Array.Empty<string>();
            }

            var copy = new string[values.Count];
            for (var i = 0; i < values.Count; i++)
            {
                copy[i] = values[i];
            }

            return copy;
        }
    }

    public sealed class StagingDeclaration
    {
        public IReadOnlyList<StagingEntryDeclaration> Entries { get; }

        public StagingDeclaration(IReadOnlyList<StagingEntryDeclaration> entries)
        {
            Entries = entries ?? Array.Empty<StagingEntryDeclaration>();
        }
    }

    public sealed class StagingCompileError
    {
        public string Code { get; }
        public string Address { get; }
        public string Message { get; }

        public StagingCompileError(string code, string address, string message)
        {
            Code = code;
            Address = address ?? string.Empty;
            Message = message;
        }
    }

    public sealed class StagingCompiledEntry
    {
        public StagingEntryDeclaration Declaration { get; }
        public bool Staged { get; }

        internal StagingCompiledEntry(StagingEntryDeclaration declaration)
        {
            Declaration = declaration;
            Staged = declaration != null && declaration.Staged;
        }
    }

    public sealed class StagingCompiledTrigger
    {
        public string Address { get; }
        public IReadOnlyList<string> AppliesTo { get; }

        internal StagingCompiledTrigger(string address, IReadOnlyList<string> appliesTo)
        {
            Address = address;
            AppliesTo = appliesTo ?? Array.Empty<string>();
        }
    }

    public sealed class StagingCompiledExpansion
    {
        public string Address { get; }
        public IReadOnlyList<string> Targets { get; }

        internal StagingCompiledExpansion(string address, IReadOnlyList<string> targets)
        {
            Address = address;
            Targets = targets ?? Array.Empty<string>();
        }
    }

    public sealed class StagingPlan
    {
        private readonly Dictionary<string, StagingCompiledEntry> entriesByAddress;
        private readonly Dictionary<string, StagingCompiledTrigger> triggersByAddress;
        private readonly Dictionary<string, StagingCompiledExpansion> expansionsByAddress;

        public static StagingPlan Empty { get; } = new StagingPlan(
            Array.Empty<StagingCompiledEntry>(),
            new Dictionary<string, StagingCompiledTrigger>(StringComparer.Ordinal),
            new Dictionary<string, StagingCompiledExpansion>(StringComparer.Ordinal),
            false);

        public bool HasStagingDeclarations { get; }
        public IReadOnlyList<StagingCompiledEntry> Entries { get; }

        private StagingPlan(
            IReadOnlyList<StagingCompiledEntry> entries,
            Dictionary<string, StagingCompiledTrigger> triggers,
            Dictionary<string, StagingCompiledExpansion> expansions,
            bool hasStagingDeclarations)
        {
            Entries = entries;
            entriesByAddress = new Dictionary<string, StagingCompiledEntry>(StringComparer.Ordinal);
            foreach (var entry in entries)
            {
                entriesByAddress[entry.Declaration.Address] = entry;
            }

            triggersByAddress = triggers;
            expansionsByAddress = expansions;
            HasStagingDeclarations = hasStagingDeclarations;
        }

        public bool TryGetEntry(string address, out StagingCompiledEntry entry)
        {
            return entriesByAddress.TryGetValue(address, out entry);
        }

        public bool TryGetTrigger(string address, out StagingCompiledTrigger trigger)
        {
            return triggersByAddress.TryGetValue(address, out trigger);
        }

        public bool TryGetExpansion(string address, out StagingCompiledExpansion expansion)
        {
            return expansionsByAddress.TryGetValue(address, out expansion);
        }

        public static bool TryCompile(
            StagingDeclaration declaration,
            out StagingPlan plan,
            out IReadOnlyList<StagingCompileError> errors)
        {
            var found = new List<StagingCompileError>();
            var sourceEntries = declaration == null || declaration.Entries == null
                ? Array.Empty<StagingEntryDeclaration>()
                : declaration.Entries;
            var declared = new Dictionary<string, StagingEntryDeclaration>(StringComparer.Ordinal);

            // 宣言ゼロのアセットは従来挙動のまま通す。重複は先勝ちで許容し 1.6 の非退行を優先する
            var hasStagingDeclaration = false;
            foreach (var entry in sourceEntries)
            {
                if (entry != null
                    && (entry.Staged || entry.AppliesTo.Count > 0 || entry.ExpandsTo.Count > 0))
                {
                    hasStagingDeclaration = true;
                    break;
                }
            }

            for (var i = 0; i < sourceEntries.Count; i++)
            {
                var entry = sourceEntries[i];
                if (entry == null || string.IsNullOrEmpty(entry.Address))
                {
                    continue;
                }

                if (declared.ContainsKey(entry.Address))
                {
                    if (hasStagingDeclaration)
                    {
                        AddError(found, "S9", entry.Address, "The address is declared more than once.");
                    }
                }
                else
                {
                    declared.Add(entry.Address, entry);
                }
            }

            var validEntries = new List<StagingEntryDeclaration>();
            foreach (var entry in sourceEntries)
            {
                if (entry == null || string.IsNullOrEmpty(entry.Address) || !declared.ContainsKey(entry.Address))
                {
                    continue;
                }

                validEntries.Add(entry);
                if (entry.Staged && entry.Type == StagingEntryType.Blob)
                {
                    AddError(found, "S8", entry.Address, "A Blob entry cannot be staged.");
                }

                ValidatePatterns(entry.AppliesTo, entry.Address, found);
                ValidatePatterns(entry.ExpandsTo, entry.Address, found);

                if (entry.AppliesTo.Count > 0 && !entry.IsButton)
                {
                    AddError(found, "S1", entry.Address, "Only a button entry may declare AppliesTo.");
                }

                if (entry.AppliesTo.Count > 0 && entry.Staged)
                {
                    AddError(found, "S2", entry.Address, "An apply trigger cannot itself be staged.");
                }
            }

            var compiledTriggers = new Dictionary<string, StagingCompiledTrigger>(StringComparer.Ordinal);
            foreach (var entry in validEntries)
            {
                if (entry.AppliesTo.Count == 0 || compiledTriggers.ContainsKey(entry.Address))
                {
                    continue;
                }

                var resolved = ResolvePatterns(entry.AppliesTo, declared.Keys);
                var stagedResolved = FilterStaged(resolved, declared);
                if (resolved.Count == 0 || stagedResolved.Count == 0)
                {
                    AddError(found, "S4", entry.Address, "AppliesTo resolves to no staged address.");
                }

                compiledTriggers.Add(entry.Address, new StagingCompiledTrigger(entry.Address, stagedResolved));
            }

            var compiledExpansions = new Dictionary<string, StagingCompiledExpansion>(StringComparer.Ordinal);
            foreach (var entry in validEntries)
            {
                if (entry.ExpandsTo.Count == 0 || compiledExpansions.ContainsKey(entry.Address))
                {
                    continue;
                }

                var resolved = ResolvePatterns(entry.ExpandsTo, declared.Keys);
                if (resolved.Count == 0)
                {
                    // 1 件も解決しないことは S5 が表す。S7 を重ねると原因が読みづらくなる
                    AddError(found, "S5", entry.Address, "ExpandsTo resolves to no declared address.");
                    compiledExpansions.Add(entry.Address, new StagingCompiledExpansion(entry.Address, Array.Empty<string>()));
                    continue;
                }

                var targets = new List<string>();
                var hasTargetOtherThanSource = false;
                foreach (var target in resolved)
                {
                    if (string.Equals(target, entry.Address, StringComparison.Ordinal))
                    {
                        continue;
                    }

                    hasTargetOtherThanSource = true;
                    if (declared[target].Type != entry.Type)
                    {
                        AddError(found, "S6", entry.Address, "An expansion target has a different entry type.");
                    }
                    else
                    {
                        targets.Add(target);
                    }
                }

                // S7 は「解決集合から展開元自身を除くと空」だけを表す。型不一致は S6 の責務
                if (!hasTargetOtherThanSource)
                {
                    AddError(found, "S7", entry.Address, "Expansion resolves only to its source.");
                }

                compiledExpansions.Add(entry.Address, new StagingCompiledExpansion(entry.Address, targets));
            }

            if (found.Count > 0)
            {
                found.Sort((left, right) =>
                {
                    var code = string.CompareOrdinal(left.Code, right.Code);
                    return code != 0 ? code : string.CompareOrdinal(left.Address, right.Address);
                });
                plan = Empty;
                errors = found;
                return false;
            }

            var compiledEntries = new List<StagingCompiledEntry>();
            foreach (var entry in validEntries)
            {
                compiledEntries.Add(new StagingCompiledEntry(entry));
            }

            plan = new StagingPlan(
                compiledEntries,
                compiledTriggers,
                compiledExpansions,
                compiledTriggers.Count > 0 || compiledExpansions.Count > 0 || compiledEntries.Exists(e => e.Staged));
            errors = Array.Empty<StagingCompileError>();
            return true;
        }

        public static bool MatchesPattern(string pattern, string address)
        {
            if (!TrySplitAddress(pattern, out var patternParts) || !TrySplitAddress(address, out var addressParts)
                || patternParts.Length != addressParts.Length)
            {
                return false;
            }

            for (var i = 0; i < patternParts.Length; i++)
            {
                if (!MatchesPart(patternParts[i], addressParts[i]))
                {
                    return false;
                }
            }

            return true;
        }

        // part 内の `*` は 0 文字以上に一致する。`/` を跨がないため part 単位で照合する
        private static bool MatchesPart(string pattern, string text)
        {
            var patternIndex = 0;
            var textIndex = 0;
            var lastStar = -1;
            var lastStarText = 0;

            while (textIndex < text.Length)
            {
                if (patternIndex < pattern.Length && pattern[patternIndex] == '*')
                {
                    lastStar = patternIndex++;
                    lastStarText = textIndex;
                }
                else if (patternIndex < pattern.Length && pattern[patternIndex] == text[textIndex])
                {
                    patternIndex++;
                    textIndex++;
                }
                else if (lastStar >= 0)
                {
                    patternIndex = lastStar + 1;
                    textIndex = ++lastStarText;
                }
                else
                {
                    return false;
                }
            }

            while (patternIndex < pattern.Length && pattern[patternIndex] == '*')
            {
                patternIndex++;
            }

            return patternIndex == pattern.Length;
        }

        private static void ValidatePatterns(IReadOnlyList<string> patterns, string address, List<StagingCompileError> errors)
        {
            foreach (var pattern in patterns)
            {
                if (!TrySplitAddress(pattern, out _))
                {
                    AddError(errors, "S3", address, "A pattern has an invalid OSC address shape or wildcard syntax.");
                }
            }
        }

        private static List<string> ResolvePatterns(IReadOnlyList<string> patterns, IEnumerable<string> addresses)
        {
            var resolved = new List<string>();
            foreach (var address in addresses)
            {
                foreach (var pattern in patterns)
                {
                    if (MatchesPattern(pattern, address))
                    {
                        resolved.Add(address);
                        break;
                    }
                }
            }

            return resolved;
        }

        private static List<string> FilterStaged(IEnumerable<string> addresses, Dictionary<string, StagingEntryDeclaration> declared)
        {
            var staged = new List<string>();
            foreach (var address in addresses)
            {
                if (declared[address].Staged)
                {
                    staged.Add(address);
                }
            }

            return staged;
        }

        private static bool TrySplitAddress(string address, out string[] parts)
        {
            parts = null;
            if (string.IsNullOrEmpty(address) || address[0] != '/' || address.Length == 1
                || address[address.Length - 1] == '/' || address.IndexOf("//", StringComparison.Ordinal) >= 0
                || address.IndexOfAny(new[] { '?', '[', ']', '{', '}', ',' }) >= 0)
            {
                return false;
            }

            var split = address.Substring(1).Split('/');
            foreach (var part in split)
            {
                if (part.Length == 0)
                {
                    return false;
                }
            }

            parts = split;
            return true;
        }

        private static void AddError(List<StagingCompileError> errors, string code, string address, string message)
        {
            errors.Add(new StagingCompileError(code, address, message));
        }
    }

    public readonly struct StagingWrite
    {
        public string Address { get; }
        public StagingValue Value { get; }

        public StagingWrite(string address, StagingValue value)
        {
            Address = address;
            Value = value;
        }
    }

    public readonly struct StagingApplyContext
    {
        public string TriggerAddress { get; }
        public IReadOnlyDictionary<string, StagingValue> Values { get; }

        /// <summary>Values の列挙順を保証する読み取り専用リスト(エントリ定義順)。</summary>
        public IReadOnlyList<string> Addresses { get; }

        public StagingApplyContext(string triggerAddress, IReadOnlyList<StagingWrite> payload)
        {
            TriggerAddress = triggerAddress ?? string.Empty;
            var values = new Dictionary<string, StagingValue>(StringComparer.Ordinal);
            var addresses = new List<string>(payload == null ? 0 : payload.Count);
            if (payload != null)
            {
                foreach (var write in payload)
                {
                    // Dictionary は列挙順を保証しないため、定義順は Addresses が持つ
                    if (!values.ContainsKey(write.Address))
                    {
                        addresses.Add(write.Address);
                    }

                    values[write.Address] = write.Value;
                }
            }

            Values = values;
            Addresses = addresses;
        }

        public bool TryGetInt(string address, out int value)
        {
            if (Values.TryGetValue(address, out var stagingValue)
                && stagingValue.Kind == StagingValueKind.Int)
            {
                value = stagingValue.IntValue;
                return true;
            }

            value = 0;
            return false;
        }

        public bool TryGetFloat(string address, out float value)
        {
            if (Values.TryGetValue(address, out var stagingValue)
                && stagingValue.Kind == StagingValueKind.Float)
            {
                value = stagingValue.FloatValue;
                return true;
            }

            value = 0f;
            return false;
        }

        public bool TryGetString(string address, out string value)
        {
            if (Values.TryGetValue(address, out var stagingValue)
                && stagingValue.Kind == StagingValueKind.String)
            {
                value = stagingValue.StringValue;
                return true;
            }

            value = null;
            return false;
        }
    }

    public readonly struct StagingReaction
    {
        public bool Recorded { get; }
        public IReadOnlyList<StagingWrite> ExpansionWrites { get; }
        public bool ApplyTriggered { get; }
        public IReadOnlyList<StagingWrite> ApplyPayload { get; }

        public StagingReaction(
            bool recorded,
            IReadOnlyList<StagingWrite> expansionWrites,
            bool applyTriggered,
            IReadOnlyList<StagingWrite> applyPayload)
        {
            Recorded = recorded;
            ExpansionWrites = expansionWrites ?? Array.Empty<StagingWrite>();
            ApplyTriggered = applyTriggered;
            ApplyPayload = applyPayload ?? Array.Empty<StagingWrite>();
        }
    }

    public sealed class StagingEngine
    {
        private readonly StagingPlan plan;
        private readonly Dictionary<string, StagingValue> currentValues =
            new Dictionary<string, StagingValue>(StringComparer.Ordinal);

        public StagingEngine(StagingPlan plan)
        {
            this.plan = plan ?? StagingPlan.Empty;
        }

        /// <summary>アセット既定値を投入する。エントリ型と合わない既定値は投入しない。
        /// 中核はログを出さないため、投入しなかったことは戻り値で呼び出し側へ返す。</summary>
        /// <returns>投入した場合は true。型不一致などで投入しなかった場合は false。</returns>
        public bool SeedInitialValue(string address, StagingValue value)
        {
            if (string.IsNullOrEmpty(address) || !TryNormalizeForEntry(address, value, out var normalized))
            {
                return false;
            }

            currentValues[address] = normalized;
            return true;
        }

        public StagingReaction Handle(string address, StagingValue value)
        {
            if (string.IsNullOrEmpty(address)
                || !TryNormalizeForEntry(address, value, out var normalized))
            {
                return BuildReaction(address, false, StagingValue.None);
            }

            currentValues[address] = normalized;

            var expansionWrites = new List<StagingWrite>();
            if (plan.TryGetExpansion(address, out var expansion))
            {
                foreach (var target in expansion.Targets)
                {
                    if (!TryNormalizeForEntry(target, normalized, out var targetValue))
                    {
                        continue;
                    }

                    currentValues[target] = targetValue;
                    expansionWrites.Add(new StagingWrite(target, targetValue));
                }
            }

            var applyTriggered = plan.TryGetTrigger(address, out var trigger) && normalized.IsTruthy;
            var applyPayload = new List<StagingWrite>();
            if (applyTriggered)
            {
                foreach (var entry in plan.Entries)
                {
                    if (!entry.Staged || !Contains(trigger.AppliesTo, entry.Declaration.Address))
                    {
                        continue;
                    }

                    if (currentValues.TryGetValue(entry.Declaration.Address, out var current))
                    {
                        applyPayload.Add(new StagingWrite(entry.Declaration.Address, current));
                    }
                }
            }

            return new StagingReaction(true, expansionWrites, applyTriggered, applyPayload);
        }

        public bool TryGetCurrentValue(string address, out StagingValue value)
        {
            return currentValues.TryGetValue(address, out value);
        }

        public IReadOnlyDictionary<string, StagingValue> Snapshot()
        {
            return new Dictionary<string, StagingValue>(currentValues, StringComparer.Ordinal);
        }

        private StagingReaction BuildReaction(string address, bool recorded, StagingValue value)
        {
            var expansionWrites = new List<StagingWrite>();
            if (recorded && plan.TryGetExpansion(address, out var expansion))
            {
                foreach (var target in expansion.Targets)
                {
                    currentValues[target] = value;
                    expansionWrites.Add(new StagingWrite(target, value));
                }
            }

            return new StagingReaction(recorded, expansionWrites, false, Array.Empty<StagingWrite>());
        }

        private bool TryNormalizeForEntry(string address, StagingValue value, out StagingValue normalized)
        {
            normalized = StagingValue.None;
            if (!plan.TryGetEntry(address, out var entry) || value.Kind == StagingValueKind.None)
            {
                return false;
            }

            switch (entry.Declaration.Type)
            {
                case StagingEntryType.Int:
                    if (value.Kind == StagingValueKind.Int)
                    {
                        normalized = value;
                        return true;
                    }
                    return false;
                case StagingEntryType.Float:
                    if (value.Kind == StagingValueKind.Float)
                    {
                        normalized = value;
                        return true;
                    }
                    if (value.Kind == StagingValueKind.Int)
                    {
                        normalized = StagingValue.FromFloat(value.IntValue);
                        return true;
                    }
                    return false;
                case StagingEntryType.String:
                    if (value.Kind == StagingValueKind.String)
                    {
                        normalized = value;
                        return true;
                    }
                    return false;
                case StagingEntryType.Bool:
                    if (value.Kind == StagingValueKind.Int && (value.IntValue == 0 || value.IntValue == 1))
                    {
                        normalized = StagingValue.FromInt(value.IntValue);
                        return true;
                    }
                    return false;
                default:
                    return false;
            }
        }

        private static bool Contains(IReadOnlyList<string> values, string address)
        {
            for (var i = 0; i < values.Count; i++)
            {
                if (string.Equals(values[i], address, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }
    }
}
```

#### A.2.3 `OscSurfaceManifestAsset.cs` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/OscSurfaceManifestAsset.cs` である。

```csharp
using System;
using System.Collections.Generic;
using OscDesk.Staging;
using UnityEngine;

[CreateAssetMenu(menuName = "OSCDesk/Manifest Asset", fileName = "OscDeskManifest")]
public sealed class OscSurfaceManifestAsset : ScriptableObject
{
    public string projectId = "";
    public List<Entry> entries = new List<Entry>();
    public List<OptionList> optionLists = new List<OptionList>();

    /// <summary>
    /// アセットの現在の内容を、UnityEngine に依存しない不変なスナップショットへ写す。
    /// 列挙型は整数で写し(範囲外の値は中核の検証で拒否される)、ラベルと文字列の既定値の
    /// {characterName} はこの時点で置換する。null のリストや要素は検証で理由を返せるよう保持する。
    /// </summary>
    public ManifestSnapshot ToSnapshot(string characterName)
    {
        List<ManifestSnapshotEntry> snapshotEntries = null;
        if (entries != null)
        {
            snapshotEntries = new List<ManifestSnapshotEntry>(entries.Count);
            foreach (var entry in entries)
            {
                snapshotEntries.Add(entry == null ? null : entry.ToSnapshotEntry(characterName));
            }
        }

        List<ManifestSnapshotOptionList> snapshotOptionLists = null;
        if (optionLists != null)
        {
            snapshotOptionLists = new List<ManifestSnapshotOptionList>(optionLists.Count);
            foreach (var optionList in optionLists)
            {
                snapshotOptionLists.Add(
                    optionList == null ? null : new ManifestSnapshotOptionList(optionList.key, optionList.values));
            }
        }

        return new ManifestSnapshot(projectId, snapshotEntries, snapshotOptionLists);
    }

    private static string ReplaceCharacterName(string template, string characterName)
    {
        return template == null
            ? string.Empty
            : template.Replace("{characterName}", characterName ?? string.Empty);
    }

    public enum EntryType
    {
        Int,
        Float,
        String,
        Blob,
        Bool,
    }

    public enum WidgetType
    {
        Fader,
        Button,
        Toggle,
        Xy,
        Text,
        Input,
        Select,
    }

    public enum DefaultKind
    {
        None,
        Int,
        Float,
        String,
        Bool,
    }

    [Serializable]
    public sealed class OptionList
    {
        public string key = "";
        public List<string> values = new List<string>();
    }

    [Serializable]
    public sealed class Entry
    {
        // 任意の安定した識別子。空なら address が識別子になる(既存のアセットは空として読まれる)
        public string id = "";
        public string address = "";
        public string label = "";
        public EntryType type;
        public WidgetType widget;
        public bool hasRange;
        public float rangeMin;
        public float rangeMax;
        public DefaultKind defaultKind;
        public int defaultInt;
        public float defaultFloat;
        public string defaultString = "";
        public bool defaultBool;
        public string group = "";
        public bool hasOptions;
        public List<string> options = new List<string>();
        public string optionsRef = "";
        public string pattern = "";
        public bool staged;
        public List<string> appliesTo = new List<string>();
        public List<string> expandsTo = new List<string>();

        public ManifestSnapshotEntry ToSnapshotEntry(string characterName)
        {
            return new ManifestSnapshotEntry(
                id,
                address,
                ReplaceCharacterName(label, characterName),
                (StagingEntryType)(int)type,
                (ManifestWidgetKind)(int)widget,
                hasRange,
                rangeMin,
                rangeMax,
                (ManifestDefaultKind)(int)defaultKind,
                defaultInt,
                defaultFloat,
                ReplaceCharacterName(defaultString, characterName),
                defaultBool,
                group,
                hasOptions,
                options,
                optionsRef,
                pattern,
                staged,
                appliesTo,
                expandsTo);
        }
    }
}
```

#### A.2.4 `OscSurfaceBridge.cs` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs` である。

```csharp
﻿// OscSurfaceBridge.cs — docs/UNITY_PROTOCOL.md 付録 A.2 の参照実装(uOSC 2.2.0)
// 本文 §4(実装指針)の擬似コードを 1:1 で具体化した単一 MonoBehaviour。
// 使い方: 空の GameObject に本コンポーネントを追加し(uOscServer / uOscClient は自動追加される)、
//   - uOscServer.port   = Surface config の unity.sendPort(既定 7090)
//   - uOscClient.address/port = Surface ホスト : unity.receivePort(既定 127.0.0.1 : 7091)
// をインスペクタで設定する(§5.1 のポート対応)。
using System;
using System.Globalization;
using UnityEngine;
using uOSC;
using OscDesk.Staging;

[RequireComponent(typeof(uOscServer), typeof(uOscClient))]
public sealed class OscSurfaceBridge : MonoBehaviour
{
    /// <summary>適用トリガ受信時に、適用範囲のステージング値を通知する。</summary>
    public event Action<StagingApplyContext> ApplyRequested;

    // デモ用の表示名。エントリ定義中の {characterName} を置き換える
    [Tooltip("デモ・検証用の表示名。マニフェストエントリの label / string 初期値に含まれる {characterName} をこの値で置き換える。プレースホルダを使っていなければ動作に影響しない。")]
    [SerializeField] private string characterName = "UnityBridge";
    [Tooltip("Surface へ送るマニフェスト定義(必須)。projectId は Surface config の expectedProjectId と一致させること。")]
    [SerializeField] private OscSurfaceManifestAsset manifestAsset;

    // §4.1 受信統計
    private int received;
    private int parseErrors; // uOSC は decode 失敗を通知しないため常に 0 を報告する(付録 A.4)
    private string lastReceivedAt = "1970-01-01T00:00:00.000Z"; // ISO-8601 UTC(Z 終端)

    // 検証・計画・現在値・JSON 組み立て・起動の識別子と構造の世代は中核のセッションが持つ。
    // Awake で作る。Awake より前は null(F-5 の注入 API だけが使える)。
    private ManifestSession session;
    private bool manifestAssetConsumed; // Awake が manifestAsset を消費したら true。以後 SetManifestAsset は受け付けない
    private int lastWarnedManifestBytes = -1; // 警告閾値超過を同じバイト数で繰り返さないための記録

    private uOscServer server;
    private uOscClient client; // 全送信の出口 = 設定された返信先(§4.4)

    /// <summary>
    /// F-5。Awake の前だけ、マニフェストアセットを差し替える。
    /// null、または Awake で消費済みの場合は保持しているアセットを変えず、エラーログを残して false を返す。
    /// </summary>
    public bool SetManifestAsset(OscSurfaceManifestAsset asset)
    {
        if (asset == null)
        {
            Debug.LogError("OscSurfaceBridge.SetManifestAsset requires a non-null OscSurfaceManifestAsset.", this);
            return false;
        }

        if (manifestAssetConsumed)
        {
            Debug.LogError(
                "OscSurfaceBridge.SetManifestAsset was called after Awake consumed the manifest asset. "
                + "Inject the asset before the component is first activated.",
                this);
            return false;
        }

        manifestAsset = asset;
        return true;
    }

    /// <summary>F-6。フォークとの互換のため引数なしを残す。結果の詳細が要るときは out 付きを使う。</summary>
    public bool SendManifestNow()
    {
        return SendManifestNow(out _);
    }

    /// <summary>
    /// F-6。保持しているアセットの現在の内容を公開して、/sys/manifest を 1 回送る。
    /// 非アクティブなら送らずに false。表示の項目・選択肢リストの更新だけなら構造の世代を 1 進めて送り、
    /// 構造の変更(エントリの集合・アドレス・型・staging の属性など)やサイズ超過は送らずに false を返す。
    /// 失敗の理由と問題はエラーログにも出す。
    /// </summary>
    public bool SendManifestNow(out ManifestChangeResult result)
    {
        if (session == null)
        {
            result = Rejected(ManifestChangeFailure.NotInitialized, "OscSurfaceBridge has not been initialized (Awake has not run).");
            LogChangeFailure("SendManifestNow", result);
            return false;
        }

        if (!isActiveAndEnabled || client == null)
        {
            result = Rejected(ManifestChangeFailure.Inactive, "OscSurfaceBridge is not active.");
            LogChangeFailure("SendManifestNow", result);
            return false;
        }

        var asset = manifestAsset;
        result = session.PublishContentUpdate(asset == null ? null : asset.ToSnapshot(characterName));
        if (!result.Succeeded)
        {
            LogChangeFailure("SendManifestNow", result);
            return false;
        }

        return SendManifest();
    }

    /// <summary>F-8 の事前検査の結果。TryReinjectManifest に渡す。</summary>
    public sealed class ManifestAssetCheck
    {
        internal ManifestAssetCheck(
            OscSurfaceManifestAsset asset,
            ManifestCandidate candidate,
            ManifestChangeResult result)
        {
            Asset = asset;
            Candidate = candidate;
            Result = result;
        }

        public bool Passed => Result.Succeeded;

        /// <summary>候補から組み立てた JSON の UTF-8 バイト数。測っていなければ -1。</summary>
        public int PayloadBytes => Result.PayloadBytes;

        public ManifestChangeResult Result { get; }

        internal OscSurfaceManifestAsset Asset { get; }
        internal ManifestCandidate Candidate { get; }
    }

    /// <summary>
    /// F-8 の事前検査。副作用なし(送信も、保持するアセットの差し替えも、セッションの状態の変更もしない)。
    /// Awake 前は NotInitialized で拒否する。失敗の理由と問題はエラーログにも出る。
    /// </summary>
    public ManifestAssetCheck PrecheckManifestAsset(OscSurfaceManifestAsset asset)
    {
        if (session == null)
        {
            var result = Rejected(ManifestChangeFailure.NotInitialized, "OscSurfaceBridge has not been initialized (Awake has not run).", "F8");
            LogChangeFailure("PrecheckManifestAsset", result);
            return new ManifestAssetCheck(asset, null, result);
        }

        var candidate = session.Precheck(asset == null ? null : asset.ToSnapshot(characterName));
        if (!candidate.Passed)
        {
            LogChangeFailure("PrecheckManifestAsset", candidate.Result);
        }

        return new ManifestAssetCheck(asset, candidate, candidate.Result);
    }

    /// <summary>
    /// F-8 の確定。事前検査の結果を渡す。成功したら保持するアセットの参照を差し替え、
    /// アクティブなら /sys/manifest を 1 回送る。非アクティブなら送らない(次の OnEnable が送る)。
    /// 失敗したときは送信もアセットの差し替えも起きない。
    /// </summary>
    public bool TryReinjectManifest(ManifestAssetCheck check, out ManifestChangeResult result)
    {
        if (session == null)
        {
            result = Rejected(ManifestChangeFailure.NotInitialized, "OscSurfaceBridge has not been initialized (Awake has not run).", "F8");
            LogChangeFailure("TryReinjectManifest", result);
            return false;
        }

        if (check != null && check.Candidate == null && !check.Result.Succeeded)
        {
            // 初期化前の事前検査など、候補を作れなかった検査はその失敗理由のまま返す
            result = check.Result;
            LogChangeFailure("TryReinjectManifest", result);
            return false;
        }

        if (check == null || check.Candidate == null)
        {
            result = Rejected(ManifestChangeFailure.InvalidManifest, "TryReinjectManifest requires a check returned by PrecheckManifestAsset.", "F8");
            LogChangeFailure("TryReinjectManifest", result);
            return false;
        }

        result = session.Commit(check.Candidate);
        if (!result.Succeeded)
        {
            LogChangeFailure("TryReinjectManifest", result);
            return false;
        }

        manifestAsset = check.Asset;

        // シードできなかった既定値は Awake と同じく警告に残す
        foreach (var address in check.Candidate.UnseededAddresses)
        {
            Debug.LogWarning(
                "OscSurfaceManifestAsset default value at \"" + address
                + "\" does not match the entry type and was not seeded.",
                check.Asset);
        }

        // 非アクティブなら送らない。次の OnEnable の自発送信が現在の内容を送る
        if (isActiveAndEnabled && client != null)
        {
            SendManifest();
        }

        return true;
    }

    /// <summary>F-8。事前検査と確定を続けて行う簡易版。</summary>
    public bool TryReinjectManifestAsset(OscSurfaceManifestAsset asset, out ManifestChangeResult result)
    {
        return TryReinjectManifest(PrecheckManifestAsset(asset), out result);
    }

    private void Awake()
    {
        // 起動時にアセット検証 → 宣言写像 → 計画コンパイル → シードを、中核のセッションで一度だけ行う。
        // 失敗しても通常のエコーと sys 系の生存性は維持する(マニフェストは送らない)。
        manifestAssetConsumed = true;
        session = new ManifestSession(Guid.NewGuid().ToString("N"));

        var asset = manifestAsset;
        var result = session.Initialize(asset == null ? null : asset.ToSnapshot(characterName));

        if (asset == null)
        {
            Debug.LogError("OscSurfaceBridge requires an OscSurfaceManifestAsset.", this);
        }
        else
        {
            foreach (var issue in result.Issues)
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset " + issue.Code
                    + (string.IsNullOrEmpty(issue.Address) ? string.Empty : " at \"" + issue.Address + "\"")
                    + ": " + issue.Message,
                    asset);
            }
        }

        // エントリ型と合わない既定値は投入されない。無言だと原因が追えないため警告に残す
        foreach (var address in result.UnseededAddresses)
        {
            Debug.LogWarning(
                "OscSurfaceManifestAsset default value at \"" + address
                + "\" does not match the entry type and was not seeded.",
                asset);
        }
    }

    private void OnEnable()
    {
        server = GetComponent<uOscServer>();
        client = GetComponent<uOscClient>();
        server.onDataReceived.AddListener(OnDataReceived);

        // 要求を受けていなくても起動時に自発送信してよい(§2 / §4.3 補足)
        SendManifest();
    }

    private void OnDisable()
    {
        server.onDataReceived.RemoveListener(OnDataReceived);
    }

    // §4.1 受信処理の骨格。uOSC は bundle を自動展開して展開後メッセージ単位で
    // このコールバックを呼ぶため、bundle 分岐は不要(§4.1 補足 / 付録 A.3)
    private void OnDataReceived(Message message)
    {
        // 計数と時刻更新はディスパッチより先(/sys/stats/request 自身も数える)
        received += 1;
        lastReceivedAt = NowIso8601();

        switch (message.address)
        {
            case "/sys/ping": // §4.2
                if (message.values.Length > 0 && message.values[0] is int seq)
                {
                    SendPong(seq);
                }
                return;
            case "/sys/stats/request": // §4.1
                SendStats();
                return;
            case "/sys/manifest/request": // §4.3
                SendManifest();
                return;
        }

        if (message.address.StartsWith("/sys/", StringComparison.Ordinal))
        {
            return; // 上記以外の /sys/* は計数のみ。応答しない
        }

        HandleNormalMessage(message);
    }

    // §4.2 受信した seq をそのまま即時返信。検査・保持・解釈はしない
    private void SendPong(int seq)
    {
        client.Send("/sys/pong", seq);
    }

    private void SendStats()
    {
        client.Send("/sys/stats", session.BuildStatsJson(received, parseErrors, lastReceivedAt));
    }

    // 起動時・有効化時・要求への応答の送信。準備完了のときだけ送り、サイズでは拒否しない(超過は警告ログ)
    private bool SendManifest()
    {
        if (session == null
            || !session.TryBuildManifestJson(out var json, out var payloadBytes, out _))
        {
            return false;
        }

        WarnIfManifestLarge(payloadBytes);
        client.Send("/sys/manifest", json);
        return true;
    }

    private void WarnIfManifestLarge(int payloadBytes)
    {
        if (payloadBytes <= ManifestLimits.WarningBytes)
        {
            lastWarnedManifestBytes = -1; // 閾値以下に戻ったら、再び超えたときに警告できるようにする
            return;
        }

        if (payloadBytes == lastWarnedManifestBytes)
        {
            return;
        }

        lastWarnedManifestBytes = payloadBytes;
        Debug.LogWarning(
            "OscSurfaceBridge /sys/manifest is " + payloadBytes.ToString(CultureInfo.InvariantCulture)
            + " bytes, over the warning threshold of "
            + ManifestLimits.WarningBytes.ToString(CultureInfo.InvariantCulture) + " bytes.",
            this);
    }

    private ManifestChangeResult Rejected(ManifestChangeFailure failure, string message, string code = "F6")
    {
        return new ManifestChangeResult(
            failure,
            new[] { new ManifestIssue(code, string.Empty, message) },
            -1,
            session != null ? session.Origin.StructureGeneration : 1,
            false);
    }

    // 失敗理由と問題をエラーログに残す(ホストが戻り値を捨てても原因が追えるようにする)
    private void LogChangeFailure(string api, ManifestChangeResult result)
    {
        var message = "OscSurfaceBridge." + api + " failed: " + result.Failure;
        foreach (var issue in result.Issues)
        {
            message += "\n  " + issue.Code
                + (string.IsNullOrEmpty(issue.Address) ? string.Empty : " at \"" + issue.Address + "\"")
                + ": " + issue.Message;
        }

        Debug.LogError(message, this);
    }

    // §4.3 通常メッセージ: 現在値の記録 + 同一アドレスへのエコーバック(§3)
    private void HandleNormalMessage(Message message)
    {
        var recordable = TryGetRecordableValue(message.values, out var stagingValue);
        var reaction = session.Handle(
            message.address,
            recordable ? stagingValue : StagingValue.None);

        var echoed = new object[message.values.Length];
        for (var i = 0; i < message.values.Length; i++)
        {
            echoed[i] = NormalizeValue(message.values[i]);
        }

        client.Send(message.address, echoed);

        foreach (var write in reaction.ExpansionWrites)
        {
            client.Send(write.Address, ToOscValue(write.Value));
        }

        if (reaction.ApplyTriggered)
        {
            RaiseApplyRequested(new StagingApplyContext(message.address, reaction.ApplyPayload));
        }
    }

    // 値として解釈できる最初の引数だけを取り出す。エントリ型との適否は中核が判定する(§4.3 / 要件 1.6)
    private static bool TryGetRecordableValue(object[] values, out StagingValue stagingValue)
    {
        stagingValue = StagingValue.None;
        if (values == null)
        {
            return false;
        }

        foreach (var value in values)
        {
            if (value is int intValue)
            {
                stagingValue = StagingValue.FromInt(intValue);
                return true;
            }

            if (value is float floatValue)
            {
                stagingValue = StagingValue.FromFloat(floatValue);
                return true;
            }

            if (value is string stringValue)
            {
                stagingValue = StagingValue.FromString(stringValue);
                return true;
            }
        }

        return false;
    }

    private void RaiseApplyRequested(StagingApplyContext context)
    {
        var handlers = ApplyRequested;
        if (handlers == null)
        {
            return;
        }

        foreach (Action<StagingApplyContext> handler in handlers.GetInvocationList())
        {
            try
            {
                handler(context);
            }
            catch (Exception exception)
            {
                Debug.LogException(exception, this);
            }
        }
    }

    private static object ToOscValue(StagingValue value)
    {
        switch (value.Kind)
        {
            case StagingValueKind.Int: return value.IntValue;
            case StagingValueKind.Float: return value.FloatValue;
            case StagingValueKind.String: return value.StringValue;
            default: return null;
        }
    }

    // §4.4 真偽値は i の 0/1 で送る(T/F タグを使わない)
    private static object NormalizeValue(object value)
    {
        if (value is bool flag)
        {
            return flag ? 1 : 0;
        }

        return value;
    }

    private static string NowIso8601()
    {
        return DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
    }
}
```

#### A.2.5 `OscSurfaceBridge.Staging.Tests.asmdef` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/Tests/Editor/OscSurfaceBridge.Staging.Tests.asmdef` である。

```json
{
  "name": "OscSurfaceBridge.Staging.Tests",
  "rootNamespace": "OscDesk.Staging.Tests",
  "references": [
    "OscSurfaceBridge.Staging",
    "UnityEngine.TestRunner",
    "UnityEditor.TestRunner"
  ],
  "includePlatforms": [
    "Editor"
  ],
  "excludePlatforms": [],
  "allowUnsafeCode": false,
  "overrideReferences": true,
  "precompiledReferences": [
    "nunit.framework.dll"
  ],
  "autoReferenced": false,
  "defineConstraints": [
    "UNITY_INCLUDE_TESTS"
  ],
  "versionDefines": [],
  "noEngineReferences": false
}
```

#### A.2.6 `StagingEngineTests.cs` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/Tests/Editor/StagingEngineTests.cs` である。

```csharp
using System;
using System.Collections.Generic;
using NUnit.Framework;

namespace OscDesk.Staging.Tests
{
    public sealed class StagingEngineTests
    {
        [Test]
        public void MatchesPattern_respects_segment_boundaries()
        {
            Assert.That(StagingPlan.MatchesPattern("/vp/member/*/active", "/vp/member/01/active"), Is.True);
            Assert.That(StagingPlan.MatchesPattern("/vp/member/*/active", "/vp/member/01/name/active"), Is.False);
            Assert.That(StagingPlan.MatchesPattern("/vp/member/*/active", "/vp/member/01"), Is.False);
            Assert.That(StagingPlan.MatchesPattern("/vp/member/*/active", "/vp/member//active"), Is.False);
        }

        [Test]
        public void TryCompile_collects_all_validation_codes()
        {
            var entries = new List<StagingEntryDeclaration>
            {
                new StagingEntryDeclaration("/s1", StagingEntryType.Int, false, false, new[] { "/s1/*" }, Array.Empty<string>()),
                new StagingEntryDeclaration("/s2", StagingEntryType.Int, true, true, new[] { "/s2/*" }, Array.Empty<string>()),
                new StagingEntryDeclaration("/s3", StagingEntryType.Int, true, false, new[] { "/s3/[bad" }, Array.Empty<string>()),
                new StagingEntryDeclaration("/s4", StagingEntryType.Int, true, false, new[] { "/missing/*" }, Array.Empty<string>()),
                new StagingEntryDeclaration("/s5", StagingEntryType.Int, false, false, Array.Empty<string>(), new[] { "/missing/*" }),
                new StagingEntryDeclaration("/s6", StagingEntryType.Int, false, false, Array.Empty<string>(), new[] { "/s6-target" }),
                new StagingEntryDeclaration("/s6-target", StagingEntryType.String, false, false, Array.Empty<string>(), Array.Empty<string>()),
                new StagingEntryDeclaration("/s7", StagingEntryType.Int, false, false, Array.Empty<string>(), new[] { "/s7" }),
                new StagingEntryDeclaration("/s8", StagingEntryType.Blob, false, true, Array.Empty<string>(), Array.Empty<string>()),
                new StagingEntryDeclaration("/s9", StagingEntryType.Int, false, false, Array.Empty<string>(), Array.Empty<string>()),
                new StagingEntryDeclaration("/s9", StagingEntryType.Int, false, false, Array.Empty<string>(), Array.Empty<string>())
            };

            Assert.That(StagingPlan.TryCompile(new StagingDeclaration(entries), out _, out var errors), Is.False);
            var codes = new HashSet<string>();
            foreach (var error in errors) codes.Add(error.Code);
            CollectionAssert.IsSupersetOf(codes, new[] { "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9" });
        }

        [Test]
        public void Handle_records_values_and_triggers_only_on_nonzero()
        {
            var entries = new[]
            {
                new StagingEntryDeclaration("/value", StagingEntryType.Int, false, true, Array.Empty<string>(), Array.Empty<string>()),
                new StagingEntryDeclaration("/apply", StagingEntryType.Int, true, false, new[] { "/*" }, Array.Empty<string>())
            };
            Assert.That(StagingPlan.TryCompile(new StagingDeclaration(entries), out var plan, out _), Is.True);
            var engine = new StagingEngine(plan);
            Assert.That(engine.Handle("/value", StagingValue.FromInt(4)).Recorded, Is.True);
            Assert.That(engine.Handle("/apply", StagingValue.FromInt(0)).ApplyTriggered, Is.False);
            Assert.That(engine.Handle("/apply", StagingValue.FromInt(1)).ApplyTriggered, Is.True);
        }
    }
}
```

#### A.2.7 `StagingFixtureTests.cs` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/Tests/Editor/StagingFixtureTests.cs` である。

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace OscDesk.Staging.Tests
{
    public sealed class StagingFixtureTests
    {
        private static readonly FixtureEnvelope Fixture = LoadFixture();

        public static IEnumerable<TestCaseData> FixtureCases()
        {
            foreach (var testCase in Fixture.cases)
            {
                yield return new TestCaseData(testCase).SetName(testCase.id);
            }
        }

        [TestCaseSource(nameof(FixtureCases))]
        public void Executes_fixture_case(FixtureCase testCase)
        {
            var compiled = StagingPlan.TryCompile(DeclarationFor(testCase), out var plan, out var errors);
            var expectedErrors = testCase.expected.errors ?? Array.Empty<string>();

            if (expectedErrors.Length > 0)
            {
                // 期待コードは実際のコンパイル結果から採る(同一コードが複数出ても集合で比較する)
                Assert.That(compiled, Is.False);
                CollectionAssert.AreEquivalent(Distinct(expectedErrors), Distinct(ErrorCodes(errors)));
                return;
            }

            Assert.That(compiled, Is.True, string.Join("; ", ErrorCodes(errors)));
            var engine = new StagingEngine(plan);
            var echoes = new List<FixtureWrite>();
            var apply = new FixtureApply { fired = false, trigger = string.Empty, values = new FixtureWrite[0] };

            foreach (var receive in testCase.receives)
            {
                echoes.Add(receive);
                if (!TryReadValue(receive.value, out var value))
                {
                    continue;
                }

                var reaction = engine.Handle(receive.address, value);
                foreach (var write in reaction.ExpansionWrites)
                {
                    echoes.Add(ToFixtureWrite(write));
                }

                if (reaction.ApplyTriggered)
                {
                    apply = new FixtureApply
                    {
                        fired = true,
                        trigger = receive.address,
                        values = ToFixtureWrites(reaction.ApplyPayload)
                    };
                }
            }

            var expandedAddresses = new HashSet<string>();
            foreach (var expansion in testCase.expansions)
            {
                if (plan.TryGetExpansion(expansion.address, out var compiledExpansion))
                {
                    foreach (var target in compiledExpansion.Targets)
                    {
                        expandedAddresses.Add(target);
                    }
                }
            }

            var currentValues = new List<FixtureWrite>();
            var defaults = new List<FixtureDefault>();
            foreach (var pair in engine.Snapshot())
            {
                if (!plan.TryGetEntry(pair.Key, out var entry) || entry.Declaration.IsButton)
                {
                    continue;
                }

                if (entry.Declaration.ExpandsTo.Count == 0 || expandedAddresses.Contains(pair.Key))
                {
                    currentValues.Add(ToFixtureWrite(pair.Key, pair.Value));
                    // default リテラルは中核の実装を通す(付録 A.2 の直列化と同一経路)
                    defaults.Add(new FixtureDefault { address = pair.Key, literal = pair.Value.ToJsonLiteral() });
                }
            }

            Assert.That(echoes, Is.EqualTo(testCase.expected.echoes));
            Assert.That(apply, Is.EqualTo(testCase.expected.apply));
            Assert.That(currentValues, Is.EqualTo(testCase.expected.currentValues));
            Assert.That(defaults, Is.EqualTo(testCase.expected.defaults));
        }

        private static FixtureEnvelope LoadFixture()
        {
            var path = Path.Combine(Application.dataPath, "OscSurfaceBridge/Tests/Editor/Fixtures/staging-cases.json");
            return JsonUtility.FromJson<FixtureEnvelope>(File.ReadAllText(path));
        }

        private static StagingDeclaration DeclarationFor(FixtureCase testCase)
        {
            var triggers = new Dictionary<string, string[]>();
            foreach (var trigger in testCase.triggers)
            {
                triggers[trigger.address] = trigger.applyPatterns ?? Array.Empty<string>();
            }

            var expansions = new Dictionary<string, string[]>();
            foreach (var expansion in testCase.expansions)
            {
                expansions[expansion.address] = expansion.targetPatterns ?? Array.Empty<string>();
            }

            var entries = new List<StagingEntryDeclaration>();
            foreach (var entry in testCase.entries ?? Array.Empty<FixtureEntry>())
            {
                entries.Add(ToDeclaration(entry, triggers, expansions));
            }

            foreach (var trigger in testCase.triggers)
            {
                if (!ContainsEntry(entries, trigger.address))
                {
                    entries.Add(new StagingEntryDeclaration(trigger.address, StagingEntryType.Int, true, false, trigger.applyPatterns, Array.Empty<string>()));
                }
            }

            if (testCase.id == "05-empty-apply-payload")
            {
                entries.Add(new StagingEntryDeclaration("/empty/__fixture_placeholder", StagingEntryType.Int, false, true, Array.Empty<string>(), Array.Empty<string>()));
            }

            return new StagingDeclaration(entries);
        }

        private static StagingEntryDeclaration ToDeclaration(FixtureEntry entry, Dictionary<string, string[]> triggers, Dictionary<string, string[]> expansions)
        {
            var type = entry.type == "int" || entry.type == "button" ? StagingEntryType.Int
                : entry.type == "float" ? StagingEntryType.Float
                : entry.type == "string" ? StagingEntryType.String
                : entry.type == "bool" ? StagingEntryType.Bool
                : StagingEntryType.Blob;
            triggers.TryGetValue(entry.address, out var appliesTo);
            expansions.TryGetValue(entry.address, out var expandsTo);
            return new StagingEntryDeclaration(entry.address, type, entry.type == "button", entry.staged, appliesTo, expandsTo);
        }

        private static bool ContainsEntry(List<StagingEntryDeclaration> entries, string address)
        {
            foreach (var entry in entries) if (entry.Address == address) return true;
            return false;
        }

        private static bool TryReadValue(FixtureValue source, out StagingValue value)
        {
            switch (source.kind)
            {
                case "int": value = StagingValue.FromInt(source.i); return true;
                case "float": value = StagingValue.FromFloat(source.f); return true;
                case "string": value = StagingValue.FromString(source.s); return true;
                default: value = StagingValue.None; return false;
            }
        }

        private static FixtureWrite[] ToFixtureWrites(IReadOnlyList<StagingWrite> writes)
        {
            var result = new FixtureWrite[writes.Count];
            for (var i = 0; i < writes.Count; i++) result[i] = ToFixtureWrite(writes[i]);
            return result;
        }

        private static FixtureWrite ToFixtureWrite(StagingWrite write) => ToFixtureWrite(write.Address, write.Value);

        private static FixtureWrite ToFixtureWrite(string address, StagingValue value)
        {
            return new FixtureWrite { address = address, value = FixtureValue.From(value) };
        }

        private static string[] Distinct(IReadOnlyList<string> codes)
        {
            var seen = new List<string>();
            foreach (var code in codes)
            {
                if (!seen.Contains(code)) seen.Add(code);
            }

            seen.Sort(StringComparer.Ordinal);
            return seen.ToArray();
        }

        private static string[] ErrorCodes(IReadOnlyList<StagingCompileError> errors)
        {
            var result = new string[errors.Count];
            for (var i = 0; i < errors.Count; i++) result[i] = errors[i].Code;
            return result;
        }
    }

    [Serializable] public sealed class FixtureEnvelope { public FixtureCase[] cases; }
    [Serializable] public sealed class FixtureCase { public string id; public FixtureEntry[] entries; public FixtureTrigger[] triggers; public FixtureExpansion[] expansions; public FixtureWrite[] receives; public FixtureExpected expected; }
    [Serializable] public sealed class FixtureEntry { public string address; public string type; public bool staged; }
    [Serializable] public sealed class FixtureTrigger { public string address; public string[] applyPatterns; }
    [Serializable] public sealed class FixtureExpansion { public string address; public string[] targetPatterns; }
    [Serializable] public sealed class FixtureExpected { public FixtureWrite[] echoes; public FixtureApply apply; public FixtureWrite[] currentValues; public FixtureDefault[] defaults; public string[] errors; }
    // 配列は参照比較にならないよう必ず要素単位で突き合わせる
    internal static class FixtureCompare
    {
        public static bool SequenceEquals<T>(T[] left, T[] right) where T : class, IEquatable<T>
        {
            if (ReferenceEquals(left, right)) return true;
            if (left == null || right == null || left.Length != right.Length) return false;
            for (var i = 0; i < left.Length; i++)
            {
                if (left[i] == null ? right[i] != null : !left[i].Equals(right[i])) return false;
            }

            return true;
        }
    }

    [Serializable] public sealed class FixtureApply : IEquatable<FixtureApply> { public bool fired; public string trigger; public FixtureWrite[] values; public bool Equals(FixtureApply other) => other != null && fired == other.fired && trigger == other.trigger && FixtureCompare.SequenceEquals(values, other.values); public override bool Equals(object obj) => Equals(obj as FixtureApply); public override int GetHashCode() => (fired, trigger, values == null ? 0 : values.Length).GetHashCode(); public override string ToString() => fired ? $"apply({trigger})[{(values == null ? "" : string.Join<FixtureWrite>(", ", values))}]" : "no-apply"; }
    [Serializable] public sealed class FixtureWrite : IEquatable<FixtureWrite> { public string address; public FixtureValue value; public bool Equals(FixtureWrite other) => other != null && address == other.address && value.Equals(other.value); public override bool Equals(object obj) => Equals(obj as FixtureWrite); public override int GetHashCode() => (address, value).GetHashCode(); public override string ToString() => $"{address}={value}"; }
    [Serializable] public struct FixtureValue : IEquatable<FixtureValue> { public string kind; public int i; public float f; public string s; public static FixtureValue From(StagingValue value) => value.Kind == StagingValueKind.Int ? new FixtureValue { kind = "int", i = value.IntValue, s = "" } : value.Kind == StagingValueKind.Float ? new FixtureValue { kind = "float", f = value.FloatValue, s = "" } : new FixtureValue { kind = "string", s = value.StringValue ?? "" }; public bool Equals(FixtureValue other) => kind == other.kind && i == other.i && f.Equals(other.f) && (s ?? "") == (other.s ?? ""); public override bool Equals(object obj) => obj is FixtureValue && Equals((FixtureValue)obj); public override int GetHashCode() => (kind, i, f, s).GetHashCode(); public override string ToString() => kind == "int" ? $"int({i})" : kind == "float" ? $"float({f})" : $"string(\"{s}\")"; }
    [Serializable] public sealed class FixtureDefault : IEquatable<FixtureDefault> { public string address; public string literal; public bool Equals(FixtureDefault other) => other != null && address == other.address && literal == other.literal; public override bool Equals(object obj) => Equals(obj as FixtureDefault); public override int GetHashCode() => (address, literal).GetHashCode(); public override string ToString() => $"{address}={literal}"; }
}
```

同梱アセットは、上記 C# 型を Unity の YAML として保存した例である。以下は構造確認用の抜粋であり、アセット全文の一致を検証対象にはしない。特に `m_Script` の GUID はプロジェクトごとに異なるため、**スクリプト参照 GUID は不変条件の対象外**である。

```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!114 &11400000
MonoBehaviour:
  m_Script: {fileID: 11500000, guid: <プロジェクト固有の GUID>, type: 3}
  m_Name: OscSurfaceManifest
  projectId: oscdesk-demo
  entries:
  - address: /avatar/blend/smile
    label: '{characterName} Smile'
    type: 1
    widget: 0
    hasRange: 1
    rangeMin: 0
    rangeMax: 1
    defaultKind: 2
    defaultFloat: 0.35
    group: Face
  # 以下のエントリは省略
```

#### A.2.8 `OscSurfaceManifestModel.cs` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/Staging/OscSurfaceManifestModel.cs` である。Unity に依存しない中核のモデル。マニフェストのスナップショット(`ManifestSnapshot`)、検証 V1〜V17(`ManifestValidator`)、JSON の組み立て(`ManifestJsonWriter`)、サイズ定数(`ManifestLimits`)を持つ。サイズ定数 2 つは `packages/shared` の `MANIFEST_SIZE.WARNING_BYTES` / `PRACTICAL_LIMIT_BYTES` と同値で、付録一致ガードが照合する。

```csharp
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace OscDesk.Staging
{
    // 列挙型の数値の並びは OscSurfaceManifestAsset の WidgetType / DefaultKind と一致させる。
    // アダプタは整数のキャストで写し、範囲外の値は検証(V9)で拒否する
    public enum ManifestWidgetKind
    {
        Fader,
        Button,
        Toggle,
        Xy,
        Text,
        Input,
        Select
    }

    public enum ManifestDefaultKind
    {
        None,
        Int,
        Float,
        String,
        Bool
    }

    /// <summary>起動の識別子と構造の世代の組。マニフェストと stats に載せる。</summary>
    public readonly struct ManifestOrigin
    {
        public const int MaxBootIdLength = 64;

        public ManifestOrigin(string bootId, int structureGeneration)
        {
            if (string.IsNullOrEmpty(bootId) || bootId.Length > MaxBootIdLength)
            {
                throw new ArgumentException("bootId must be 1 to 64 characters.", nameof(bootId));
            }

            if (structureGeneration < 1)
            {
                throw new ArgumentOutOfRangeException(nameof(structureGeneration), "structureGeneration must be 1 or greater.");
            }

            BootId = bootId;
            StructureGeneration = structureGeneration;
        }

        public string BootId { get; }
        public int StructureGeneration { get; }
    }

    public sealed class ManifestIssue
    {
        public ManifestIssue(string code, string address, string message)
        {
            Code = code ?? string.Empty;
            Address = address ?? string.Empty;
            Message = message ?? string.Empty;
        }

        /// <summary>"V1".. の検証コード、または staging の "S1".."S9"。</summary>
        public string Code { get; }

        /// <summary>対象のアドレス。無ければ空文字。</summary>
        public string Address { get; }

        public string Message { get; }
    }

    public sealed class ManifestSnapshotOptionList
    {
        public ManifestSnapshotOptionList(string key, IReadOnlyList<string> values)
        {
            Key = key;
            Values = ManifestModelCopy.List(values);
        }

        public string Key { get; }

        /// <summary>null を許す(検証で拒否する)。</summary>
        public IReadOnlyList<string> Values { get; }
    }

    public sealed class ManifestSnapshotEntry
    {
        public ManifestSnapshotEntry(
            string id,
            string address,
            string label,
            StagingEntryType type,
            ManifestWidgetKind widget,
            bool hasRange,
            float rangeMin,
            float rangeMax,
            ManifestDefaultKind defaultKind,
            int defaultInt,
            float defaultFloat,
            string defaultString,
            bool defaultBool,
            string group,
            bool hasOptions,
            IReadOnlyList<string> options,
            string optionsRef,
            string pattern,
            bool staged,
            IReadOnlyList<string> appliesTo,
            IReadOnlyList<string> expandsTo)
        {
            Id = id;
            Address = address;
            Label = label;
            Type = type;
            Widget = widget;
            HasRange = hasRange;
            RangeMin = rangeMin;
            RangeMax = rangeMax;
            DefaultKind = defaultKind;
            DefaultInt = defaultInt;
            DefaultFloat = defaultFloat;
            DefaultString = defaultString;
            DefaultBool = defaultBool;
            Group = group;
            HasOptions = hasOptions;
            Options = ManifestModelCopy.List(options);
            OptionsRef = optionsRef;
            Pattern = pattern;
            Staged = staged;
            AppliesTo = ManifestModelCopy.List(appliesTo);
            ExpandsTo = ManifestModelCopy.List(expandsTo);
        }

        public string Id { get; }
        public string Address { get; }
        public string Label { get; }
        public StagingEntryType Type { get; }
        public ManifestWidgetKind Widget { get; }
        public bool HasRange { get; }
        public float RangeMin { get; }
        public float RangeMax { get; }
        public ManifestDefaultKind DefaultKind { get; }
        public int DefaultInt { get; }
        public float DefaultFloat { get; }
        public string DefaultString { get; }
        public bool DefaultBool { get; }
        public string Group { get; }
        public bool HasOptions { get; }
        public IReadOnlyList<string> Options { get; }
        public string OptionsRef { get; }
        public string Pattern { get; }
        public bool Staged { get; }
        public IReadOnlyList<string> AppliesTo { get; }
        public IReadOnlyList<string> ExpandsTo { get; }

        /// <summary>id が null または空ならアドレス。</summary>
        public string EffectiveId => string.IsNullOrEmpty(Id) ? Address : Id;
    }

    /// <summary>アセットの不変な写し。構築時に全リストを複製し、以後変わらない。</summary>
    public sealed class ManifestSnapshot
    {
        public ManifestSnapshot(
            string projectId,
            IReadOnlyList<ManifestSnapshotEntry> entries,
            IReadOnlyList<ManifestSnapshotOptionList> optionLists)
        {
            ProjectId = projectId;
            Entries = ManifestModelCopy.List(entries);
            OptionLists = ManifestModelCopy.List(optionLists);
        }

        public string ProjectId { get; }

        /// <summary>null を許す(検証で拒否する)。null の要素も保持する。</summary>
        public IReadOnlyList<ManifestSnapshotEntry> Entries { get; }

        /// <summary>null を許す(検証で拒否する)。null の要素も保持する。</summary>
        public IReadOnlyList<ManifestSnapshotOptionList> OptionLists { get; }
    }

    internal static class ManifestModelCopy
    {
        // null は null のまま保持し、null でなければ要素ごと(null 要素を含めて)複製する
        public static IReadOnlyList<T> List<T>(IReadOnlyList<T> source)
        {
            if (source == null)
            {
                return null;
            }

            var copy = new T[source.Count];
            for (var i = 0; i < source.Count; i++)
            {
                copy[i] = source[i];
            }

            return copy;
        }
    }

    public static class ManifestLimits
    {
        /// <summary>shared の MANIFEST_SIZE.WARNING_BYTES と同値。付録一致ガードが照合する。</summary>
        public const int WarningBytes = 57344;

        /// <summary>shared の MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES と同値。付録一致ガードが照合する。</summary>
        public const int PracticalLimitBytes = 61440;
    }

    public static class ManifestValidator
    {
        /// <summary>妥当なら空のリスト。最初の違反で打ち切らず、従来の検証と同じ順で集める。</summary>
        public static IReadOnlyList<ManifestIssue> Validate(ManifestSnapshot snapshot)
        {
            var issues = new List<ManifestIssue>();
            if (snapshot == null)
            {
                issues.Add(new ManifestIssue("V1", string.Empty, "A manifest snapshot is required."));
                return issues;
            }

            if (string.IsNullOrWhiteSpace(snapshot.ProjectId))
            {
                issues.Add(new ManifestIssue("V2", string.Empty, "projectId must not be empty."));
            }

            if (snapshot.Entries == null)
            {
                issues.Add(new ManifestIssue("V3", string.Empty, "entries must not be null."));
            }

            if (snapshot.OptionLists == null)
            {
                issues.Add(new ManifestIssue("V4", string.Empty, "optionLists must not be null."));
            }

            var optionListKeys = new HashSet<string>(StringComparer.Ordinal);
            if (snapshot.OptionLists != null)
            {
                foreach (var optionList in snapshot.OptionLists)
                {
                    if (optionList == null || string.IsNullOrEmpty(optionList.Key))
                    {
                        issues.Add(new ManifestIssue("V5", string.Empty, "An option list has a null or empty key."));
                        continue;
                    }

                    if (!optionListKeys.Add(optionList.Key))
                    {
                        issues.Add(new ManifestIssue(
                            "V6", string.Empty, "Duplicate option list key \"" + optionList.Key + "\"."));
                    }

                    if (optionList.Values == null || ContainsNull(optionList.Values))
                    {
                        issues.Add(new ManifestIssue(
                            "V7", string.Empty, "Option list \"" + optionList.Key + "\" contains null values."));
                    }
                }
            }

            if (snapshot.Entries != null)
            {
                foreach (var entry in snapshot.Entries)
                {
                    ValidateEntry(entry, snapshot.OptionLists != null, optionListKeys, issues);
                }
            }

            return issues;
        }

        private static void ValidateEntry(
            ManifestSnapshotEntry entry,
            bool optionListsPresent,
            HashSet<string> optionListKeys,
            List<ManifestIssue> issues)
        {
            if (entry == null || string.IsNullOrWhiteSpace(entry.Address))
            {
                issues.Add(new ManifestIssue("V8", entry?.Address, "An entry is null or has an empty address."));
                return;
            }

            var address = entry.Address;

            if (!Enum.IsDefined(typeof(StagingEntryType), entry.Type)
                || !Enum.IsDefined(typeof(ManifestWidgetKind), entry.Widget)
                || !Enum.IsDefined(typeof(ManifestDefaultKind), entry.DefaultKind))
            {
                issues.Add(new ManifestIssue("V9", address, "The entry has an undefined enum value."));
                return;
            }

            if (entry.Widget == ManifestWidgetKind.Input
                && entry.Type != StagingEntryType.String
                && entry.Type != StagingEntryType.Int
                && entry.Type != StagingEntryType.Float)
            {
                issues.Add(new ManifestIssue("V10", address, "An input entry must use string, int, or float type."));
            }

            if (entry.Widget == ManifestWidgetKind.Select && entry.Type != StagingEntryType.String)
            {
                issues.Add(new ManifestIssue("V11", address, "A select entry must use string type."));
            }

            var hasOptionsRef = !string.IsNullOrEmpty(entry.OptionsRef);
            if (entry.Widget == ManifestWidgetKind.Select && entry.HasOptions == hasOptionsRef)
            {
                issues.Add(new ManifestIssue(
                    "V12", address, "A select entry must define exactly one of options or optionsRef."));
            }

            if (entry.HasOptions && (entry.Options == null || ContainsNull(entry.Options)))
            {
                issues.Add(new ManifestIssue("V13", address, "options must not contain null values."));
            }

            // optionLists 自体が null のときは V4 が原因なので、参照切れを重ねて報告しない
            if (hasOptionsRef && optionListsPresent && !optionListKeys.Contains(entry.OptionsRef))
            {
                issues.Add(new ManifestIssue(
                    "V14", address, "optionsRef references missing option list \"" + entry.OptionsRef + "\"."));
            }

            if (!string.IsNullOrEmpty(entry.Pattern))
            {
                if (entry.Type != StagingEntryType.String)
                {
                    issues.Add(new ManifestIssue("V15", address, "pattern requires string type."));
                }
                else
                {
                    try
                    {
                        new Regex(entry.Pattern);
                    }
                    catch (ArgumentException exception)
                    {
                        issues.Add(new ManifestIssue(
                            "V16", address, "Invalid pattern \"" + entry.Pattern + "\": " + exception.Message));
                    }
                }
            }

            if (!string.IsNullOrEmpty(entry.Id) && string.IsNullOrWhiteSpace(entry.Id))
            {
                issues.Add(new ManifestIssue("V17", address, "id must not be whitespace only."));
            }
        }

        private static bool ContainsNull(IReadOnlyList<string> values)
        {
            for (var i = 0; i < values.Count; i++)
            {
                if (values[i] == null)
                {
                    return true;
                }
            }

            return false;
        }
    }

    public static class ManifestJsonWriter
    {
        /// <summary>Validate が空を返したスナップショットにだけ使う。
        /// 同じスナップショット・同じ現在値・同じ組からは同じバイト列が出る。</summary>
        public static string WriteManifest(ManifestSnapshot snapshot, StagingEngine values, ManifestOrigin origin)
        {
            var sb = new StringBuilder();
            sb.Append("{\"version\":1,\"projectId\":").Append(Quote(snapshot.ProjectId));
            AppendOrigin(sb, origin);
            sb.Append(",\"entries\":[");

            for (var i = 0; i < snapshot.Entries.Count; i++)
            {
                var entry = snapshot.Entries[i];

                if (i > 0)
                {
                    sb.Append(',');
                }

                sb.Append("{\"address\":").Append(Quote(entry.Address));
                sb.Append(",\"label\":").Append(Quote(entry.Label));
                sb.Append(",\"type\":").Append(Quote(TypeName(entry.Type)));
                sb.Append(",\"widget\":").Append(Quote(WidgetName(entry.Widget)));

                if (entry.HasRange)
                {
                    sb.Append(",\"range\":[").Append(FormatNumber(entry.RangeMin))
                        .Append(',').Append(FormatNumber(entry.RangeMax)).Append(']');
                }

                if (values != null && values.TryGetCurrentValue(entry.Address, out var current))
                {
                    sb.Append(",\"default\":").Append(current.ToJsonLiteral());
                }

                if (!string.IsNullOrEmpty(entry.Group))
                {
                    sb.Append(",\"group\":").Append(Quote(entry.Group));
                }

                if (entry.HasOptions)
                {
                    sb.Append(",\"options\":");
                    AppendStringArray(sb, entry.Options);
                }

                if (!string.IsNullOrEmpty(entry.OptionsRef))
                {
                    sb.Append(",\"optionsRef\":").Append(Quote(entry.OptionsRef));
                }

                if (!string.IsNullOrEmpty(entry.Pattern))
                {
                    sb.Append(",\"pattern\":").Append(Quote(entry.Pattern));
                }

                if (entry.Staged)
                {
                    sb.Append(",\"staged\":true");
                }

                if (entry.Widget == ManifestWidgetKind.Button
                    && entry.AppliesTo != null
                    && entry.AppliesTo.Count > 0)
                {
                    sb.Append(",\"appliesTo\":");
                    AppendStringArray(sb, entry.AppliesTo);
                }

                sb.Append('}');
            }

            sb.Append(']');

            if (snapshot.OptionLists.Count > 0)
            {
                sb.Append(",\"optionLists\":{");
                for (var listIndex = 0; listIndex < snapshot.OptionLists.Count; listIndex++)
                {
                    if (listIndex > 0)
                    {
                        sb.Append(',');
                    }

                    var optionList = snapshot.OptionLists[listIndex];
                    sb.Append(Quote(optionList.Key)).Append(": ");
                    AppendStringArray(sb, optionList.Values);
                }

                sb.Append('}');
            }

            sb.Append('}');
            return sb.ToString();
        }

        /// <summary>従来の stats JSON の末尾に bootId と structureGeneration を足す。</summary>
        public static string WriteStats(int received, int parseErrors, string lastReceivedAt, ManifestOrigin origin)
        {
            var sb = new StringBuilder();
            sb.Append("{\"received\":").Append(received.ToString(CultureInfo.InvariantCulture))
                .Append(",\"parseErrors\":").Append(parseErrors.ToString(CultureInfo.InvariantCulture))
                .Append(",\"lastReceivedAt\":").Append(Quote(lastReceivedAt ?? string.Empty));
            AppendOrigin(sb, origin);
            sb.Append('}');
            return sb.ToString();
        }

        public static int Utf8ByteCount(string json)
        {
            return Encoding.UTF8.GetByteCount(json ?? string.Empty);
        }

        private static void AppendOrigin(StringBuilder sb, ManifestOrigin origin)
        {
            sb.Append(",\"bootId\":").Append(Quote(origin.BootId))
                .Append(",\"structureGeneration\":")
                .Append(origin.StructureGeneration.ToString(CultureInfo.InvariantCulture));
        }

        private static void AppendStringArray(StringBuilder sb, IReadOnlyList<string> values)
        {
            sb.Append('[');
            for (var i = 0; i < values.Count; i++)
            {
                if (i > 0)
                {
                    sb.Append(',');
                }

                sb.Append(Quote(values[i]));
            }

            sb.Append(']');
        }

        private static string TypeName(StagingEntryType type)
        {
            switch (type)
            {
                case StagingEntryType.Int: return "i";
                case StagingEntryType.Float: return "f";
                case StagingEntryType.String: return "s";
                case StagingEntryType.Blob: return "b";
                case StagingEntryType.Bool: return "bool";
                default: return "";
            }
        }

        private static string WidgetName(ManifestWidgetKind widget)
        {
            switch (widget)
            {
                case ManifestWidgetKind.Fader: return "fader";
                case ManifestWidgetKind.Button: return "button";
                case ManifestWidgetKind.Toggle: return "toggle";
                case ManifestWidgetKind.Xy: return "xy";
                case ManifestWidgetKind.Text: return "text";
                case ManifestWidgetKind.Input: return "input";
                case ManifestWidgetKind.Select: return "select";
                default: return "";
            }
        }

        private static string FormatNumber(float value)
        {
            return value.ToString("R", CultureInfo.InvariantCulture);
        }

        private static string Quote(string value)
        {
            var sb = new StringBuilder(value.Length + 2);
            sb.Append('"');

            foreach (var ch in value)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (ch < ' ')
                        {
                            sb.Append("\\u").Append(((int)ch).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(ch);
                        }
                        break;
                }
            }

            sb.Append('"');
            return sb.ToString();
        }
    }
}
```

#### A.2.9 `OscSurfaceManifestSession.cs` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/Staging/OscSurfaceManifestSession.cs` である。Unity に依存しない中核のセッション。状態(未初期化・有効なマニフェストなし・抑止中・準備完了)、起動の識別子と構造の世代、アドレスと識別子の対応表、状態の版を持ち、F-6(`PublishContentUpdate`)の許可リストとサイズ検査を判定する。事前検査と確定(F-8)は後続のタスクで足す。

```csharp
using System;
using System.Collections.Generic;

namespace OscDesk.Staging
{
    public enum ManifestSessionState
    {
        Uninitialized,
        NoValidManifest,
        Suppressed,
        Ready
    }

    public enum ManifestChangeFailure
    {
        None,
        NotInitialized,
        Inactive,
        Suppressed,
        InvalidManifest,
        ProjectIdMismatch,
        AddressReused,
        StagingCompileFailed,
        PayloadTooLarge,
        StructuralChangeRequiresReinject
    }

    public sealed class ManifestChangeResult
    {
        public ManifestChangeResult(
            ManifestChangeFailure failure,
            IReadOnlyList<ManifestIssue> issues,
            int payloadBytes,
            int structureGeneration,
            bool generationAdvanced,
            bool stateChangedSinceCheck = false)
        {
            Failure = failure;
            Issues = issues ?? Array.Empty<ManifestIssue>();
            PayloadBytes = payloadBytes;
            StructureGeneration = structureGeneration;
            GenerationAdvanced = generationAdvanced;
            StateChangedSinceCheck = stateChangedSinceCheck;
        }

        public bool Succeeded => Failure == ManifestChangeFailure.None;
        public ManifestChangeFailure Failure { get; }

        /// <summary>事前検査の後の状態変化で判定が変わった。</summary>
        public bool StateChangedSinceCheck { get; }

        /// <summary>測っていなければ -1。</summary>
        public int PayloadBytes { get; }

        public IReadOnlyList<ManifestIssue> Issues { get; }

        /// <summary>操作後の世代。</summary>
        public int StructureGeneration { get; }

        public bool GenerationAdvanced { get; }
    }

    /// <summary>
    /// 事前検査の結果(値オブジェクト)。検査した時点の状態の版と、シード済みの engine・コンパイル済み計画を持つ。
    /// 確定(Commit)に渡す。所属セッション以外には渡せない。
    /// </summary>
    public sealed class ManifestCandidate
    {
        internal ManifestCandidate(
            ManifestSession owner,
            int stateVersion,
            ManifestSnapshot snapshot,
            StagingEngine engine,
            IReadOnlyList<string> unseededAddresses,
            ManifestChangeResult result)
        {
            Owner = owner;
            StateVersion = stateVersion;
            Snapshot = snapshot;
            Engine = engine;
            UnseededAddresses = unseededAddresses ?? Array.Empty<string>();
            Result = result;
        }

        public bool Passed => Result.Succeeded;

        /// <summary>失敗理由。通ったときは Succeeded = true。</summary>
        public ManifestChangeResult Result { get; }

        /// <summary>候補から組み立てた JSON の UTF-8 バイト数。測っていなければ -1。</summary>
        public int PayloadBytes => Result.PayloadBytes;

        /// <summary>検査した時点の状態の版。</summary>
        public int StateVersion { get; }

        /// <summary>新しい既定値をシードできなかったアドレス(従来どおり警告の対象)。</summary>
        public IReadOnlyList<string> UnseededAddresses { get; }

        internal ManifestSession Owner { get; }
        internal ManifestSnapshot Snapshot { get; }
        internal StagingEngine Engine { get; }
    }

    public sealed class ManifestInitResult
    {
        public ManifestInitResult(
            ManifestSessionState state,
            IReadOnlyList<ManifestIssue> issues,
            IReadOnlyList<string> unseededAddresses)
        {
            State = state;
            Issues = issues ?? Array.Empty<ManifestIssue>();
            UnseededAddresses = unseededAddresses ?? Array.Empty<string>();
        }

        public ManifestSessionState State { get; }
        public IReadOnlyList<ManifestIssue> Issues { get; }
        public IReadOnlyList<string> UnseededAddresses { get; }
    }

    /// <summary>
    /// 現在のスナップショット・計画と現在値・起動の識別子・構造の世代・アドレスと識別子の対応表を持つ。
    /// すべての操作はメインスレッドから呼ぶ前提で、ロックは持たない。
    /// </summary>
    public sealed class ManifestSession
    {
        private const string NotReadyCode = "NotReady";
        private const string ContentUpdateCode = "F6";

        private readonly string bootId;
        private readonly Dictionary<string, string> idByAddress = new Dictionary<string, string>(StringComparer.Ordinal);
        private ManifestSnapshot snapshot;
        private StagingEngine engine = new StagingEngine(StagingPlan.Empty);
        private int structureGeneration = 1;
        private int stateVersion;

        public ManifestSession(string bootId)
        {
            // 組の検証(1〜64 文字)をここで行い、不正な値を持ち込ませない
            new ManifestOrigin(bootId, 1);
            this.bootId = bootId;
        }

        public ManifestSessionState State { get; private set; } = ManifestSessionState.Uninitialized;

        public ManifestOrigin Origin => new ManifestOrigin(bootId, structureGeneration);

        /// <summary>projectId の基準。検証が通った初期化で記録し、無ければ null。</summary>
        public string ProjectId { get; private set; }

        /// <summary>値の記録・確定・内容の公開で進む状態の版。</summary>
        public int StateVersion => stateVersion;

        public IReadOnlyDictionary<string, string> AddressToId => idByAddress;

        /// <summary>1 回だけ呼ぶ。失敗しても受信とエコーは続けられる(従来の Awake と同じ)。</summary>
        public ManifestInitResult Initialize(ManifestSnapshot initial)
        {
            if (State != ManifestSessionState.Uninitialized)
            {
                throw new InvalidOperationException("ManifestSession is already initialized.");
            }

            var issues = new List<ManifestIssue>(ManifestValidator.Validate(initial));
            if (issues.Count > 0)
            {
                State = ManifestSessionState.NoValidManifest;
                return new ManifestInitResult(State, issues, null);
            }

            snapshot = initial;
            ProjectId = initial.ProjectId;
            foreach (var entry in initial.Entries)
            {
                idByAddress[entry.Address] = entry.EffectiveId;
            }

            if (StagingPlan.TryCompile(ToDeclaration(initial), out var plan, out var compileErrors))
            {
                engine = new StagingEngine(plan);
                State = ManifestSessionState.Ready;
            }
            else
            {
                foreach (var error in compileErrors)
                {
                    issues.Add(new ManifestIssue(error.Code, error.Address, error.Message));
                }

                // fail-safe: 不正な staging 宣言でも通常の OSC 処理は止めない
                engine = new StagingEngine(StagingPlan.Empty);
                State = ManifestSessionState.Suppressed;
            }

            var unseeded = new List<string>();
            foreach (var entry in initial.Entries)
            {
                if (!TryGetDefaultValue(entry, out var defaultValue))
                {
                    continue;
                }

                if (!engine.SeedInitialValue(entry.Address, defaultValue))
                {
                    unseeded.Add(entry.Address);
                }
            }

            return new ManifestInitResult(State, issues, unseeded);
        }

        /// <summary>受信値を中核へ渡す。記録できたら状態の版を進める。</summary>
        public StagingReaction Handle(string address, StagingValue value)
        {
            var reaction = engine.Handle(address, value);
            if (reaction.Recorded)
            {
                stateVersion++;
            }

            return reaction;
        }

        public bool TryGetCurrentValue(string address, out StagingValue value)
        {
            return engine.TryGetCurrentValue(address, out value);
        }

        /// <summary>準備完了のときだけ組み立てる。何度呼んでも世代は進まない。</summary>
        public bool TryBuildManifestJson(out string json, out int payloadBytes, out IReadOnlyList<ManifestIssue> issues)
        {
            json = null;
            payloadBytes = -1;
            if (State != ManifestSessionState.Ready)
            {
                issues = new[]
                {
                    new ManifestIssue(NotReadyCode, string.Empty, "The session is not ready: " + State + ".")
                };
                return false;
            }

            json = ManifestJsonWriter.WriteManifest(snapshot, engine, Origin);
            payloadBytes = ManifestJsonWriter.Utf8ByteCount(json);
            issues = Array.Empty<ManifestIssue>();
            return true;
        }

        public string BuildStatsJson(int received, int parseErrors, string lastReceivedAt)
        {
            return ManifestJsonWriter.WriteStats(received, parseErrors, lastReceivedAt, Origin);
        }

        /// <summary>
        /// F-8 の事前検査。副作用は無い(スナップショット・計画・現在値・世代・対応表・状態の版を変えない)。
        /// 判定順: 初期化済みか → 検証 → projectId → アドレスの再利用 → コンパイル → 引き継ぎとシード後のサイズ。
        /// </summary>
        public ManifestCandidate Precheck(ManifestSnapshot candidate)
        {
            if (State == ManifestSessionState.Uninitialized)
            {
                return Rejected(ManifestChangeFailure.NotInitialized, null, -1);
            }

            var validation = ManifestValidator.Validate(candidate);
            if (validation.Count > 0)
            {
                return Rejected(ManifestChangeFailure.InvalidManifest, validation, -1);
            }

            // 有効なマニフェストが無い状態(ProjectId が null)では基準が無いので照合を省く
            if (ProjectId != null && !string.Equals(candidate.ProjectId, ProjectId, StringComparison.Ordinal))
            {
                return Rejected(
                    ManifestChangeFailure.ProjectIdMismatch,
                    Issue("projectId differs from the accepted manifest.", "F8"),
                    -1);
            }

            var reuse = FindAddressReuse(candidate);
            if (reuse.Count > 0)
            {
                return Rejected(ManifestChangeFailure.AddressReused, reuse, -1);
            }

            if (!StagingPlan.TryCompile(ToDeclaration(candidate), out var plan, out var compileErrors))
            {
                var issues = new List<ManifestIssue>();
                foreach (var error in compileErrors)
                {
                    issues.Add(new ManifestIssue(error.Code, error.Address, error.Message));
                }

                return Rejected(ManifestChangeFailure.StagingCompileFailed, issues, -1);
            }

            var nextEngine = new StagingEngine(plan);
            var unseeded = new List<string>();
            foreach (var entry in candidate.Entries)
            {
                if (TryCarryOver(entry, nextEngine))
                {
                    continue;
                }

                if (!TryGetDefaultValue(entry, out var defaultValue) || !nextEngine.SeedInitialValue(entry.Address, defaultValue))
                {
                    // 値の無いまま(None の既定値)は従来の初期化と同様に報告しない。型不一致の既定値だけ報告する
                    if (entry.DefaultKind != ManifestDefaultKind.None)
                    {
                        unseeded.Add(entry.Address);
                    }
                }
            }

            if (structureGeneration == int.MaxValue)
            {
                return Rejected(
                    ManifestChangeFailure.InvalidManifest,
                    Issue("structureGeneration cannot advance any further. Restart is required.", "F8"),
                    -1);
            }

            var json = ManifestJsonWriter.WriteManifest(
                candidate, nextEngine, new ManifestOrigin(bootId, structureGeneration + 1));
            var bytes = ManifestJsonWriter.Utf8ByteCount(json);
            if (bytes > ManifestLimits.PracticalLimitBytes)
            {
                return Rejected(
                    ManifestChangeFailure.PayloadTooLarge,
                    Issue("The manifest would be " + bytes + " bytes, over the limit of "
                        + ManifestLimits.PracticalLimitBytes + " bytes.", "F8"),
                    bytes);
            }

            return new ManifestCandidate(
                this,
                stateVersion,
                candidate,
                nextEngine,
                unseeded,
                new ManifestChangeResult(ManifestChangeFailure.None, null, bytes, structureGeneration, false));
        }

        /// <summary>
        /// F-8 の確定。事前検査から状態の版が変わっていなければ再判定せずに差し替える。
        /// 変わっていれば同じ判定をやり直し、落ちたら StateChangedSinceCheck を付けて返す。失敗時は何も変えない。
        /// </summary>
        public ManifestChangeResult Commit(ManifestCandidate candidate)
        {
            if (candidate == null || !ReferenceEquals(candidate.Owner, this))
            {
                return Fail(
                    ManifestChangeFailure.InvalidManifest,
                    Issue("The candidate was not produced by this session's Precheck.", "F8"));
            }

            if (!candidate.Passed)
            {
                return candidate.Result;
            }

            var effective = candidate;
            if (candidate.StateVersion != stateVersion)
            {
                effective = Precheck(candidate.Snapshot);
                if (!effective.Passed)
                {
                    var failed = effective.Result;
                    return new ManifestChangeResult(
                        failed.Failure,
                        failed.Issues,
                        failed.PayloadBytes,
                        structureGeneration,
                        false,
                        true);
                }
            }

            snapshot = effective.Snapshot;
            engine = effective.Engine;
            foreach (var entry in effective.Snapshot.Entries)
            {
                idByAddress[entry.Address] = entry.EffectiveId;
            }

            if (ProjectId == null)
            {
                ProjectId = effective.Snapshot.ProjectId;
            }

            State = ManifestSessionState.Ready;
            structureGeneration++;
            stateVersion++;
            return new ManifestChangeResult(
                ManifestChangeFailure.None, null, effective.PayloadBytes, structureGeneration, true);
        }

        private ManifestCandidate Rejected(
            ManifestChangeFailure failure,
            IReadOnlyList<ManifestIssue> issues,
            int payloadBytes)
        {
            var result = new ManifestChangeResult(failure, issues, payloadBytes, structureGeneration, false);
            return new ManifestCandidate(this, stateVersion, null, null, null, result);
        }

        // 対応表と候補内で、同じアドレスが別の識別子に結び付いていないか
        private List<ManifestIssue> FindAddressReuse(ManifestSnapshot candidate)
        {
            var issues = new List<ManifestIssue>();
            var seen = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var entry in candidate.Entries)
            {
                var id = entry.EffectiveId;
                if (idByAddress.TryGetValue(entry.Address, out var known)
                    && !string.Equals(known, id, StringComparison.Ordinal))
                {
                    issues.Add(new ManifestIssue(
                        "F8",
                        entry.Address,
                        "The address was already bound to id \"" + known + "\" during this run; id \"" + id
                            + "\" cannot reuse it."));
                }
                else if (seen.TryGetValue(entry.Address, out var earlier)
                    && !string.Equals(earlier, id, StringComparison.Ordinal))
                {
                    issues.Add(new ManifestIssue(
                        "F8",
                        entry.Address,
                        "The address is bound to different ids (\"" + earlier + "\" and \"" + id
                            + "\") in the candidate."));
                }
                else
                {
                    seen[entry.Address] = id;
                }
            }

            return issues;
        }

        // 識別子・アドレス・型がすべて一致し、旧い現在値があるときだけ引き継ぐ
        private bool TryCarryOver(ManifestSnapshotEntry entry, StagingEngine target)
        {
            if (snapshot == null)
            {
                return false;
            }

            foreach (var old in snapshot.Entries)
            {
                if (string.Equals(old.Address, entry.Address, StringComparison.Ordinal)
                    && string.Equals(old.EffectiveId, entry.EffectiveId, StringComparison.Ordinal)
                    && old.Type == entry.Type)
                {
                    return engine.TryGetCurrentValue(entry.Address, out var value)
                        && target.SeedInitialValue(entry.Address, value);
                }
            }

            return false;
        }

        /// <summary>
        /// F-6。許可リスト(表示の項目・トップレベルの選択肢リスト・button 以外どうしのウィジェットの種類)だけの
        /// 差分なら、スナップショットを差し替えて世代を 1 進める。成功時の送信はアダプタが行う。
        /// </summary>
        public ManifestChangeResult PublishContentUpdate(ManifestSnapshot current)
        {
            if (State == ManifestSessionState.Uninitialized)
            {
                return Fail(ManifestChangeFailure.NotInitialized);
            }

            if (State == ManifestSessionState.Suppressed)
            {
                return Fail(ManifestChangeFailure.Suppressed);
            }

            var validation = ManifestValidator.Validate(current);
            if (validation.Count > 0)
            {
                return Fail(ManifestChangeFailure.InvalidManifest, validation);
            }

            if (State == ManifestSessionState.NoValidManifest)
            {
                return Fail(
                    ManifestChangeFailure.StructuralChangeRequiresReinject,
                    Issue("There is no accepted manifest to compare with. Use reinject."));
            }

            if (!string.Equals(current.ProjectId, ProjectId, StringComparison.Ordinal))
            {
                return Fail(
                    ManifestChangeFailure.ProjectIdMismatch,
                    Issue("projectId differs from the accepted manifest."));
            }

            var structural = new List<ManifestIssue>();
            var hasContentChange = Diff(snapshot, current, structural);
            if (structural.Count > 0)
            {
                return Fail(ManifestChangeFailure.StructuralChangeRequiresReinject, structural);
            }

            if (!hasContentChange)
            {
                var sameJson = ManifestJsonWriter.WriteManifest(snapshot, engine, Origin);
                return new ManifestChangeResult(
                    ManifestChangeFailure.None,
                    null,
                    ManifestJsonWriter.Utf8ByteCount(sameJson),
                    structureGeneration,
                    false);
            }

            if (structureGeneration == int.MaxValue)
            {
                return Fail(
                    ManifestChangeFailure.StructuralChangeRequiresReinject,
                    Issue("structureGeneration cannot advance any further. Restart is required."));
            }

            var nextOrigin = new ManifestOrigin(bootId, structureGeneration + 1);
            var nextJson = ManifestJsonWriter.WriteManifest(current, engine, nextOrigin);
            var bytes = ManifestJsonWriter.Utf8ByteCount(nextJson);
            if (bytes > ManifestLimits.PracticalLimitBytes)
            {
                return new ManifestChangeResult(
                    ManifestChangeFailure.PayloadTooLarge,
                    Issue("The manifest would be " + bytes + " bytes, over the limit of "
                        + ManifestLimits.PracticalLimitBytes + " bytes."),
                    bytes,
                    structureGeneration,
                    false);
            }

            snapshot = current;
            structureGeneration++;
            stateVersion++;
            return new ManifestChangeResult(ManifestChangeFailure.None, null, bytes, structureGeneration, true);
        }

        private ManifestChangeResult Fail(ManifestChangeFailure failure, IReadOnlyList<ManifestIssue> issues = null)
        {
            return new ManifestChangeResult(failure, issues, -1, structureGeneration, false);
        }

        private static IReadOnlyList<ManifestIssue> Issue(string message, string code = ContentUpdateCode)
        {
            return new[] { new ManifestIssue(code, string.Empty, message) };
        }

        // 構造の差分は structural に集め、許可リストの項目に差分があれば true を返す
        private static bool Diff(ManifestSnapshot before, ManifestSnapshot after, List<ManifestIssue> structural)
        {
            var changed = false;

            if (before.Entries.Count != after.Entries.Count)
            {
                structural.Add(new ManifestIssue(ContentUpdateCode, string.Empty, "The number of entries changed."));
                return false;
            }

            for (var i = 0; i < before.Entries.Count; i++)
            {
                var a = before.Entries[i];
                var b = after.Entries[i];
                var address = a.Address;

                if (!string.Equals(a.Address, b.Address, StringComparison.Ordinal))
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "The entry order or address changed."));
                    continue;
                }

                if (!string.Equals(a.EffectiveId, b.EffectiveId, StringComparison.Ordinal))
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "The entry id changed."));
                }

                if (a.Type != b.Type)
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "The entry type changed."));
                }

                if (a.Staged != b.Staged)
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "staged changed."));
                }

                if (!SameList(a.AppliesTo, b.AppliesTo))
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "appliesTo changed."));
                }

                if (!SameList(a.ExpandsTo, b.ExpandsTo))
                {
                    structural.Add(new ManifestIssue(ContentUpdateCode, address, "expandsTo changed."));
                }

                if ((a.Widget == ManifestWidgetKind.Button) != (b.Widget == ManifestWidgetKind.Button))
                {
                    structural.Add(new ManifestIssue(
                        ContentUpdateCode, address, "The widget changed between button and a non-button kind."));
                }

                if (!SameDefault(a, b))
                {
                    structural.Add(new ManifestIssue(
                        ContentUpdateCode,
                        address,
                        "A default value change does not overwrite the current value of the same entity, "
                        + "so it would not appear in the table. Send the value over OSC or use F-7 (separate spec) "
                        + "to change it."));
                }

                if (a.Widget != b.Widget
                    || !string.Equals(a.Label, b.Label, StringComparison.Ordinal)
                    || a.HasRange != b.HasRange
                    || (a.HasRange && (!a.RangeMin.Equals(b.RangeMin) || !a.RangeMax.Equals(b.RangeMax)))
                    || !string.Equals(a.Group, b.Group, StringComparison.Ordinal)
                    || a.HasOptions != b.HasOptions
                    || (a.HasOptions && !SameList(a.Options, b.Options))
                    || !string.Equals(a.OptionsRef, b.OptionsRef, StringComparison.Ordinal)
                    || !string.Equals(a.Pattern, b.Pattern, StringComparison.Ordinal))
                {
                    changed = true;
                }
            }

            if (!SameOptionLists(before.OptionLists, after.OptionLists))
            {
                changed = true;
            }

            return changed;
        }

        private static bool SameDefault(ManifestSnapshotEntry a, ManifestSnapshotEntry b)
        {
            if (a.DefaultKind != b.DefaultKind)
            {
                return false;
            }

            switch (a.DefaultKind)
            {
                case ManifestDefaultKind.Int: return a.DefaultInt == b.DefaultInt;
                case ManifestDefaultKind.Float: return a.DefaultFloat.Equals(b.DefaultFloat);
                case ManifestDefaultKind.String: return string.Equals(a.DefaultString, b.DefaultString, StringComparison.Ordinal);
                case ManifestDefaultKind.Bool: return a.DefaultBool == b.DefaultBool;
                default: return true;
            }
        }

        // null と空は同じ扱い(アセットの未設定と空リストを区別しない)
        private static bool SameList(IReadOnlyList<string> a, IReadOnlyList<string> b)
        {
            var countA = a == null ? 0 : a.Count;
            var countB = b == null ? 0 : b.Count;
            if (countA != countB)
            {
                return false;
            }

            for (var i = 0; i < countA; i++)
            {
                if (!string.Equals(a[i], b[i], StringComparison.Ordinal))
                {
                    return false;
                }
            }

            return true;
        }

        // 出力は定義順なので、順序も含めて比べる
        private static bool SameOptionLists(
            IReadOnlyList<ManifestSnapshotOptionList> a,
            IReadOnlyList<ManifestSnapshotOptionList> b)
        {
            if (a.Count != b.Count)
            {
                return false;
            }

            for (var i = 0; i < a.Count; i++)
            {
                if (!string.Equals(a[i].Key, b[i].Key, StringComparison.Ordinal) || !SameList(a[i].Values, b[i].Values))
                {
                    return false;
                }
            }

            return true;
        }

        private static StagingDeclaration ToDeclaration(ManifestSnapshot source)
        {
            var declarations = new List<StagingEntryDeclaration>(source.Entries.Count);
            foreach (var entry in source.Entries)
            {
                declarations.Add(new StagingEntryDeclaration(
                    entry.Address,
                    entry.Type,
                    entry.Widget == ManifestWidgetKind.Button,
                    entry.Staged,
                    entry.AppliesTo,
                    entry.ExpandsTo));
            }

            return new StagingDeclaration(declarations);
        }

        // 型に合わない既定値は投入しない(従来どおり)。合否は engine のシードが判定する
        private static bool TryGetDefaultValue(ManifestSnapshotEntry entry, out StagingValue value)
        {
            switch (entry.DefaultKind)
            {
                case ManifestDefaultKind.Int:
                    value = StagingValue.FromInt(entry.DefaultInt);
                    return true;
                case ManifestDefaultKind.Float:
                    value = StagingValue.FromFloat(entry.DefaultFloat);
                    return true;
                case ManifestDefaultKind.String:
                    value = StagingValue.FromString(entry.DefaultString ?? string.Empty);
                    return true;
                case ManifestDefaultKind.Bool:
                    // bool の既定値は bool 型のエントリにだけ入る。他の型では None を渡してシード失敗として報告させる
                    value = entry.Type == StagingEntryType.Bool
                        ? StagingValue.FromInt(entry.DefaultBool ? 1 : 0)
                        : StagingValue.None;
                    return true;
                default:
                    value = StagingValue.None;
                    return false;
            }
        }
    }
}
```

#### A.2.10 `ManifestSessionTests.cs` 全文

正となるソースは `OscSurface/Assets/OscSurfaceBridge/Tests/Editor/ManifestSessionTests.cs` である。モデルとセッションの EditMode テスト。`UnityEngine` を参照せず、`tests/csharp-core` の `dotnet` 経路でも同じファイルを実行する。

```csharp
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using NUnit.Framework;

namespace OscDesk.Staging.Tests
{
    // UnityEngine を参照しない(dotnet 経路: tests/csharp-core でも同じファイルを実行する)
    public sealed class ManifestSessionTests
    {
        private static readonly string[] None = new string[0];

        private sealed class E
        {
            public string Id = "";
            public string Address = "/a";
            public string Label = "A";
            public StagingEntryType Type = StagingEntryType.Float;
            public ManifestWidgetKind Widget = ManifestWidgetKind.Fader;
            public bool HasRange;
            public float RangeMin;
            public float RangeMax;
            public ManifestDefaultKind DefaultKind = ManifestDefaultKind.None;
            public int DefaultInt;
            public float DefaultFloat;
            public string DefaultString = "";
            public bool DefaultBool;
            public string Group = "";
            public bool HasOptions;
            public string[] Options = None;
            public string OptionsRef = "";
            public string Pattern = "";
            public bool Staged;
            public string[] AppliesTo = None;
            public string[] ExpandsTo = None;

            public ManifestSnapshotEntry Build()
            {
                return new ManifestSnapshotEntry(
                    Id, Address, Label, Type, Widget, HasRange, RangeMin, RangeMax,
                    DefaultKind, DefaultInt, DefaultFloat, DefaultString, DefaultBool,
                    Group, HasOptions, Options, OptionsRef, Pattern, Staged, AppliesTo, ExpandsTo);
            }
        }

        private static ManifestSnapshot Snap(string projectId, IReadOnlyList<ManifestSnapshotEntry> entries, IReadOnlyList<ManifestSnapshotOptionList> lists = null)
        {
            return new ManifestSnapshot(projectId, entries, lists ?? new ManifestSnapshotOptionList[0]);
        }

        private static ManifestSnapshot Snap(params E[] entries)
        {
            return Snap("proj", entries.Select(e => e.Build()).ToArray());
        }

        private static string Codes(IReadOnlyList<ManifestIssue> issues)
        {
            return string.Join(",", issues.Select(i => i.Code));
        }

        private static ManifestSession ReadySession(ManifestSnapshot snapshot)
        {
            var session = new ManifestSession("boot-1");
            var result = session.Initialize(snapshot);
            Assert.That(result.State, Is.EqualTo(ManifestSessionState.Ready), Codes(result.Issues));
            return session;
        }

        // ---------- 6.1 スナップショットと検証 ----------

        [Test]
        public void Snapshot_copies_lists_and_keeps_null_lists_and_elements()
        {
            var options = new List<string> { "x" };
            var entry = new E { Options = options.ToArray(), HasOptions = true }.Build();
            var entries = new List<ManifestSnapshotEntry> { entry, null };
            var snapshot = new ManifestSnapshot("p", entries, null);
            entries.Clear();

            Assert.That(snapshot.Entries.Count, Is.EqualTo(2));
            Assert.That(snapshot.Entries[1], Is.Null);
            Assert.That(snapshot.OptionLists, Is.Null);
        }

        [Test]
        public void EffectiveId_falls_back_to_address_when_id_is_empty()
        {
            Assert.That(new E { Id = "", Address = "/x" }.Build().EffectiveId, Is.EqualTo("/x"));
            Assert.That(new E { Id = null, Address = "/x" }.Build().EffectiveId, Is.EqualTo("/x"));
            Assert.That(new E { Id = "id1", Address = "/x" }.Build().EffectiveId, Is.EqualTo("id1"));
        }

        [Test]
        public void Validate_returns_empty_for_valid_snapshot()
        {
            var snapshot = Snap(
                new E { Address = "/a" },
                new E { Address = "/s", Type = StagingEntryType.String, Widget = ManifestWidgetKind.Select, OptionsRef = "k", Pattern = "^a" });
            var withList = Snap("p", snapshot.Entries, new[] { new ManifestSnapshotOptionList("k", new[] { "a", "b" }) });
            Assert.That(ManifestValidator.Validate(withList), Is.Empty);
        }

        private static IEnumerable<TestCaseData> ViolationCases()
        {
            yield return new TestCaseData("V1", null).SetName("V1_null_snapshot");
            yield return new TestCaseData("V2", new ManifestSnapshot(" ", new ManifestSnapshotEntry[0], new ManifestSnapshotOptionList[0])).SetName("V2_blank_project");
            yield return new TestCaseData("V3", new ManifestSnapshot("p", null, new ManifestSnapshotOptionList[0])).SetName("V3_null_entries");
            yield return new TestCaseData("V4", new ManifestSnapshot("p", new ManifestSnapshotEntry[0], null)).SetName("V4_null_option_lists");
            yield return new TestCaseData("V5", Snap("p", new ManifestSnapshotEntry[0], new ManifestSnapshotOptionList[] { null })).SetName("V5_null_list");
            yield return new TestCaseData("V5", Snap("p", new ManifestSnapshotEntry[0], new[] { new ManifestSnapshotOptionList("", new[] { "a" }) })).SetName("V5_empty_key");
            yield return new TestCaseData("V6", Snap("p", new ManifestSnapshotEntry[0], new[] { new ManifestSnapshotOptionList("k", new[] { "a" }), new ManifestSnapshotOptionList("k", new[] { "b" }) })).SetName("V6_duplicate_key");
            yield return new TestCaseData("V7", Snap("p", new ManifestSnapshotEntry[0], new[] { new ManifestSnapshotOptionList("k", new string[] { null }) })).SetName("V7_null_value");
            yield return new TestCaseData("V7", Snap("p", new ManifestSnapshotEntry[0], new[] { new ManifestSnapshotOptionList("k", null) })).SetName("V7_null_values_list");
            yield return new TestCaseData("V8", Snap("p", new ManifestSnapshotEntry[] { null })).SetName("V8_null_entry");
            yield return new TestCaseData("V8", Snap(new E { Address = "  " })).SetName("V8_blank_address");
            yield return new TestCaseData("V9", Snap(new E { Widget = (ManifestWidgetKind)99 })).SetName("V9_widget");
            yield return new TestCaseData("V9", Snap(new E { Type = (StagingEntryType)99 })).SetName("V9_type");
            yield return new TestCaseData("V9", Snap(new E { DefaultKind = (ManifestDefaultKind)99 })).SetName("V9_default_kind");
            yield return new TestCaseData("V10", Snap(new E { Widget = ManifestWidgetKind.Input, Type = StagingEntryType.Bool })).SetName("V10_input_type");
            yield return new TestCaseData("V11", Snap(new E { Widget = ManifestWidgetKind.Select, Type = StagingEntryType.Int, HasOptions = true, Options = new[] { "a" } })).SetName("V11_select_type");
            yield return new TestCaseData("V12", Snap(new E { Widget = ManifestWidgetKind.Select, Type = StagingEntryType.String })).SetName("V12_select_neither");
            yield return new TestCaseData("V12", Snap("p", new[] { new E { Widget = ManifestWidgetKind.Select, Type = StagingEntryType.String, HasOptions = true, Options = new[] { "a" }, OptionsRef = "k" }.Build() }, new[] { new ManifestSnapshotOptionList("k", new[] { "a" }) })).SetName("V12_select_both");
            yield return new TestCaseData("V13", Snap(new E { HasOptions = true, Options = new string[] { null } })).SetName("V13_null_option");
            yield return new TestCaseData("V13", Snap(new E { HasOptions = true, Options = null })).SetName("V13_null_options");
            yield return new TestCaseData("V14", Snap(new E { OptionsRef = "missing" })).SetName("V14_missing_ref");
            yield return new TestCaseData("V15", Snap(new E { Type = StagingEntryType.Int, Pattern = "a" })).SetName("V15_pattern_type");
            yield return new TestCaseData("V16", Snap(new E { Type = StagingEntryType.String, Pattern = "[bad" })).SetName("V16_bad_pattern");
            yield return new TestCaseData("V17", Snap(new E { Id = "  " })).SetName("V17_blank_id");
        }

        [TestCaseSource(nameof(ViolationCases))]
        public void Validate_reports_each_violation(string code, ManifestSnapshot snapshot)
        {
            Assert.That(ManifestValidator.Validate(snapshot).Select(i => i.Code), Does.Contain(code));
        }

        [Test]
        public void Validate_collects_multiple_issues_in_legacy_order()
        {
            var snapshot = new ManifestSnapshot(
                "",
                new[] { new E { Id = " ", Widget = ManifestWidgetKind.Select, Type = StagingEntryType.Int }.Build() },
                new ManifestSnapshotOptionList[0]);
            Assert.That(Codes(ManifestValidator.Validate(snapshot)), Is.EqualTo("V2,V11,V12,V17"));
        }

        [Test]
        public void Size_constants_match_wire_limits()
        {
            Assert.That(ManifestLimits.WarningBytes, Is.EqualTo(56 * 1024));
            Assert.That(ManifestLimits.PracticalLimitBytes, Is.EqualTo(60 * 1024));
        }

        // ---------- 6.2 JSON の組み立て(移設前の出力を固定文字列で断言) ----------

        private static ManifestSnapshot GoldenSnapshot()
        {
            var entries = new[]
            {
                new E { Address = "/gain", Label = "Gain \"x\"", Type = StagingEntryType.Float, Widget = ManifestWidgetKind.Fader, HasRange = true, RangeMin = 0f, RangeMax = 1.5f, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 0.25f, Group = "Audio", Staged = true }.Build(),
                new E { Address = "/mode", Label = "Mode", Type = StagingEntryType.String, Widget = ManifestWidgetKind.Select, DefaultKind = ManifestDefaultKind.String, DefaultString = "b", HasOptions = true, Options = new[] { "a", "b" } }.Build(),
                new E { Address = "/dev", Label = "Dev", Type = StagingEntryType.String, Widget = ManifestWidgetKind.Select, OptionsRef = "devices", Pattern = "^d" }.Build(),
                new E { Address = "/apply", Label = "Apply", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button, AppliesTo = new[] { "/gain" } }.Build(),
                new E { Address = "/on", Label = "On", Type = StagingEntryType.Bool, Widget = ManifestWidgetKind.Toggle, DefaultKind = ManifestDefaultKind.Bool, DefaultBool = true, Id = "on-id" }.Build(),
            };
            return Snap("proj", entries, new[]
            {
                new ManifestSnapshotOptionList("devices", new[] { "cam1", "cam2" }),
                new ManifestSnapshotOptionList("empty", new string[0]),
            });
        }

        private const string GoldenBody =
            "\"entries\":[" +
            "{\"address\":\"/gain\",\"label\":\"Gain \\\"x\\\"\",\"type\":\"f\",\"widget\":\"fader\",\"range\":[0,1.5],\"default\":0.25,\"group\":\"Audio\",\"staged\":true}," +
            "{\"address\":\"/mode\",\"label\":\"Mode\",\"type\":\"s\",\"widget\":\"select\",\"default\":\"b\",\"options\":[\"a\",\"b\"]}," +
            "{\"address\":\"/dev\",\"label\":\"Dev\",\"type\":\"s\",\"widget\":\"select\",\"optionsRef\":\"devices\",\"pattern\":\"^d\"}," +
            "{\"address\":\"/apply\",\"label\":\"Apply\",\"type\":\"i\",\"widget\":\"button\",\"appliesTo\":[\"/gain\"]}," +
            "{\"address\":\"/on\",\"label\":\"On\",\"type\":\"bool\",\"widget\":\"toggle\",\"default\":1}" +
            "],\"optionLists\":{\"devices\": [\"cam1\",\"cam2\"],\"empty\": []}}";

        [Test]
        public void WriteManifest_matches_legacy_output_except_origin_fields()
        {
            var session = ReadySession(GoldenSnapshot());
            Assert.That(session.TryBuildManifestJson(out var json, out var bytes, out _), Is.True);

            const string legacyPrefix = "{\"version\":1,\"projectId\":\"proj\",";
            const string origin = "\"bootId\":\"boot-1\",\"structureGeneration\":1,";
            Assert.That(json, Is.EqualTo(legacyPrefix + origin + GoldenBody));
            Assert.That(bytes, Is.EqualTo(Encoding.UTF8.GetByteCount(json)));
            // 識別子は出力しない
            Assert.That(json, Does.Not.Contain("on-id"));
        }

        [Test]
        public void WriteManifest_omits_optional_keys_and_option_lists_when_absent()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Label = "A" }));
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Is.EqualTo(
                "{\"version\":1,\"projectId\":\"proj\",\"bootId\":\"boot-1\",\"structureGeneration\":1," +
                "\"entries\":[{\"address\":\"/a\",\"label\":\"A\",\"type\":\"f\",\"widget\":\"fader\"}]}"));
        }

        [Test]
        public void WriteManifest_carries_current_value_as_default()
        {
            var session = ReadySession(Snap(new E { Address = "/a", DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 0.5f }));
            session.Handle("/a", StagingValue.FromFloat(0.75f));
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Does.Contain("\"default\":0.75"));
        }

        [Test]
        public void WriteManifest_origin_fields_follow_project_id()
        {
            var session = ReadySession(Snap(new E()));
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json.IndexOf("\"projectId\":\"proj\",\"bootId\":\"boot-1\",\"structureGeneration\":1,\"entries\"", StringComparison.Ordinal), Is.GreaterThan(0));
        }

        [Test]
        public void WriteStats_appends_origin_to_legacy_shape()
        {
            var session = ReadySession(Snap(new E()));
            Assert.That(
                session.BuildStatsJson(3, 1, "2026-01-01T00:00:00.000Z"),
                Is.EqualTo("{\"received\":3,\"parseErrors\":1,\"lastReceivedAt\":\"2026-01-01T00:00:00.000Z\",\"bootId\":\"boot-1\",\"structureGeneration\":1}"));
        }

        [Test]
        public void Utf8ByteCount_counts_bytes_not_chars()
        {
            Assert.That(ManifestJsonWriter.Utf8ByteCount("あa"), Is.EqualTo(4));
        }

        [Test]
        public void Same_inputs_produce_identical_bytes()
        {
            var a = ReadySession(GoldenSnapshot());
            var b = ReadySession(GoldenSnapshot());
            a.TryBuildManifestJson(out var ja, out _, out _);
            b.TryBuildManifestJson(out var jb, out _, out _);
            Assert.That(ja, Is.EqualTo(jb));
        }

        [Test]
        public void Origin_rejects_invalid_values()
        {
            Assert.Throws<ArgumentException>(() => new ManifestOrigin("", 1));
            Assert.Throws<ArgumentException>(() => new ManifestOrigin(new string('x', 65), 1));
            Assert.Throws<ArgumentOutOfRangeException>(() => new ManifestOrigin("b", 0));
            Assert.That(new ManifestOrigin(new string('x', 64), int.MaxValue).StructureGeneration, Is.EqualTo(int.MaxValue));
        }

        // ---------- 6.3 セッション ----------

        [Test]
        public void New_session_is_uninitialized_and_cannot_build()
        {
            var session = new ManifestSession("boot-1");
            Assert.That(session.State, Is.EqualTo(ManifestSessionState.Uninitialized));
            Assert.That(session.TryBuildManifestJson(out var json, out var bytes, out var issues), Is.False);
            Assert.That(json, Is.Null);
            Assert.That(bytes, Is.EqualTo(-1));
            Assert.That(issues, Is.Not.Empty);
            Assert.That(session.ProjectId, Is.Null);
        }

        [Test]
        public void Initialize_valid_manifest_becomes_ready_with_generation_1_and_records_project_and_ids()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Id = "ida" }, new E { Address = "/b" }));
            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(1));
            Assert.That(session.Origin.BootId, Is.EqualTo("boot-1"));
            Assert.That(session.ProjectId, Is.EqualTo("proj"));
            Assert.That(session.AddressToId["/a"], Is.EqualTo("ida"));
            Assert.That(session.AddressToId["/b"], Is.EqualTo("/b"));
        }

        [Test]
        public void Initialize_twice_throws()
        {
            var session = ReadySession(Snap(new E()));
            Assert.Throws<InvalidOperationException>(() => session.Initialize(Snap(new E())));
        }

        [Test]
        public void Initialize_invalid_manifest_gives_NoValidManifest_but_keeps_handling()
        {
            var session = new ManifestSession("boot-1");
            var result = session.Initialize(Snap("", new ManifestSnapshotEntry[0]));
            Assert.That(result.State, Is.EqualTo(ManifestSessionState.NoValidManifest));
            Assert.That(Codes(result.Issues), Is.EqualTo("V2"));
            Assert.That(session.ProjectId, Is.Null);
            Assert.That(session.TryBuildManifestJson(out _, out _, out _), Is.False);
            Assert.That(() => session.Handle("/a", StagingValue.FromInt(1)), Throws.Nothing);
            Assert.That(session.BuildStatsJson(1, 0, "t"), Does.Contain("\"bootId\":\"boot-1\""));
        }

        [Test]
        public void Initialize_null_snapshot_reports_V1()
        {
            var result = new ManifestSession("boot-1").Initialize(null);
            Assert.That(result.State, Is.EqualTo(ManifestSessionState.NoValidManifest));
            Assert.That(Codes(result.Issues), Is.EqualTo("V1"));
        }

        [Test]
        public void Initialize_with_staging_compile_error_is_Suppressed_but_records_project_id()
        {
            var session = new ManifestSession("boot-1");
            var result = session.Initialize(Snap(
                new E { Address = "/s", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Fader, AppliesTo = new[] { "/a" } },
                new E { Address = "/a", Type = StagingEntryType.Int }));
            Assert.That(result.State, Is.EqualTo(ManifestSessionState.Suppressed));
            Assert.That(result.Issues.Select(i => i.Code), Does.Contain("S1"));
            Assert.That(session.ProjectId, Is.EqualTo("proj"));
            Assert.That(session.AddressToId.ContainsKey("/s"), Is.True);
            Assert.That(session.TryBuildManifestJson(out _, out _, out var issues), Is.False);
            Assert.That(issues, Is.Not.Empty);
        }

        [Test]
        public void Initialize_reports_addresses_whose_default_could_not_be_seeded()
        {
            var session = new ManifestSession("boot-1");
            var result = session.Initialize(Snap(
                new E { Address = "/ok", Type = StagingEntryType.Float, DefaultKind = ManifestDefaultKind.Int, DefaultInt = 2 },
                new E { Address = "/bad", Type = StagingEntryType.Int, DefaultKind = ManifestDefaultKind.String, DefaultString = "x" },
                new E { Address = "/badbool", Type = StagingEntryType.Int, DefaultKind = ManifestDefaultKind.Bool, DefaultBool = true },
                new E { Address = "/bool", Type = StagingEntryType.Bool, DefaultKind = ManifestDefaultKind.Bool, DefaultBool = true }));
            Assert.That(result.State, Is.EqualTo(ManifestSessionState.Ready));
            Assert.That(result.UnseededAddresses, Is.EquivalentTo(new[] { "/bad", "/badbool" }));
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Does.Contain("\"default\":2"));
        }

        [Test]
        public void Repeated_builds_do_not_advance_generation()
        {
            var session = ReadySession(Snap(new E()));
            for (var i = 0; i < 3; i++)
            {
                Assert.That(session.TryBuildManifestJson(out var json, out _, out _), Is.True);
                Assert.That(json, Does.Contain("\"structureGeneration\":1,"));
                session.BuildStatsJson(i, 0, "t");
            }

            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(1));
        }

        [Test]
        public void Handle_advances_state_version_only_when_recorded()
        {
            var session = ReadySession(Snap(new E { Address = "/a" }));
            var before = session.StateVersion;
            session.Handle("/unknown", StagingValue.FromFloat(1f));
            Assert.That(session.StateVersion, Is.EqualTo(before));
            Assert.That(session.Handle("/a", StagingValue.FromFloat(1f)).Recorded, Is.True);
            Assert.That(session.StateVersion, Is.EqualTo(before + 1));
        }

        [Test]
        public void Constructor_rejects_invalid_boot_id()
        {
            Assert.Throws<ArgumentException>(() => new ManifestSession(""));
        }

        // ---------- 6.4 F-6 ----------

        private static ManifestSnapshot WithList(string key, params string[] values)
        {
            return Snap("proj",
                new[] { new E { Address = "/dev", Type = StagingEntryType.String, Widget = ManifestWidgetKind.Select, OptionsRef = key }.Build() },
                new[] { new ManifestSnapshotOptionList(key, values) });
        }

        [Test]
        public void PublishContentUpdate_option_list_change_advances_generation_by_one()
        {
            var session = ReadySession(WithList("devices", "a"));
            var result = session.PublishContentUpdate(WithList("devices", "a", "b"));
            Assert.That(result.Succeeded, Is.True, result.Failure.ToString());
            Assert.That(result.GenerationAdvanced, Is.True);
            Assert.That(result.StructureGeneration, Is.EqualTo(2));
            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(2));
            session.TryBuildManifestJson(out var json, out var bytes, out _);
            Assert.That(json, Does.Contain("\"devices\": [\"a\",\"b\"]"));
            Assert.That(json, Does.Contain("\"structureGeneration\":2,"));
            Assert.That(result.PayloadBytes, Is.EqualTo(bytes));
        }

        [Test]
        public void PublishContentUpdate_advances_state_version()
        {
            var session = ReadySession(WithList("devices", "a"));
            var before = session.StateVersion;
            session.PublishContentUpdate(WithList("devices", "b"));
            Assert.That(session.StateVersion, Is.EqualTo(before + 1));
        }

        [Test]
        public void PublishContentUpdate_without_diff_succeeds_without_advancing()
        {
            var session = ReadySession(WithList("devices", "a"));
            var before = session.StateVersion;
            var result = session.PublishContentUpdate(WithList("devices", "a"));
            Assert.That(result.Succeeded, Is.True);
            Assert.That(result.GenerationAdvanced, Is.False);
            Assert.That(result.StructureGeneration, Is.EqualTo(1));
            Assert.That(session.StateVersion, Is.EqualTo(before));
        }

        [Test]
        public void PublishContentUpdate_accepts_display_fields_and_non_button_widget_change()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Label = "A", Widget = ManifestWidgetKind.Fader, Type = StagingEntryType.Float }));
            var result = session.PublishContentUpdate(Snap(new E { Address = "/a", Label = "B", Widget = ManifestWidgetKind.Input, Type = StagingEntryType.Float, HasRange = true, RangeMin = 0, RangeMax = 2, Group = "g" }));
            Assert.That(result.Succeeded, Is.True, result.Failure.ToString());
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Does.Contain("\"label\":\"B\"").And.Contain("\"widget\":\"input\"").And.Contain("\"group\":\"g\""));
        }

        [Test]
        public void PublishContentUpdate_ignores_range_difference_when_range_is_not_emitted()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Widget = ManifestWidgetKind.Input, Type = StagingEntryType.Float, HasRange = false, RangeMin = 0, RangeMax = 1 }));
            var result = session.PublishContentUpdate(Snap(new E { Address = "/a", Widget = ManifestWidgetKind.Input, Type = StagingEntryType.Float, HasRange = false, RangeMin = 5, RangeMax = 9 }));
            Assert.That(result.Succeeded, Is.True);
            Assert.That(result.GenerationAdvanced, Is.False);
        }

        [Test]
        public void PublishContentUpdate_keeps_current_values_across_widget_change()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Widget = ManifestWidgetKind.Fader }));
            session.Handle("/a", StagingValue.FromFloat(0.5f));
            session.PublishContentUpdate(Snap(new E { Address = "/a", Widget = ManifestWidgetKind.Text }));
            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Does.Contain("\"default\":0.5"));
        }

        private static IEnumerable<TestCaseData> StructuralCases()
        {
            var baseEntry = new Func<E>(() => new E { Address = "/a", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Fader });
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Snap(baseEntry(), new E { Address = "/b" }))).SetName("entry_added");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Snap())).SetName("entry_removed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Snap(new E { Address = "/z", Type = StagingEntryType.Int }))).SetName("address_changed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.Id = "other"; return Snap(e); })).SetName("id_changed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.Type = StagingEntryType.Float; return Snap(e); })).SetName("type_changed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.Staged = true; return Snap(e); })).SetName("staged_changed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.Widget = ManifestWidgetKind.Button; return Snap(e); })).SetName("to_button");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.ExpandsTo = new[] { "/a" }; return Snap(e); })).SetName("expandsTo_changed");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => { var e = baseEntry(); e.DefaultKind = ManifestDefaultKind.Int; e.DefaultInt = 5; return Snap(e); })).SetName("default_changed");
        }

        [TestCaseSource(nameof(StructuralCases))]
        public void PublishContentUpdate_rejects_structural_change_and_keeps_state(Func<ManifestSnapshot> candidate)
        {
            var session = ReadySession(Snap(new E { Address = "/a", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Fader }));
            session.TryBuildManifestJson(out var before, out _, out _);
            var version = session.StateVersion;

            var result = session.PublishContentUpdate(candidate());

            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.StructuralChangeRequiresReinject));
            Assert.That(result.GenerationAdvanced, Is.False);
            Assert.That(result.Issues, Is.Not.Empty);
            session.TryBuildManifestJson(out var after, out _, out _);
            Assert.That(after, Is.EqualTo(before));
            Assert.That(session.StateVersion, Is.EqualTo(version));
        }

        [Test]
        public void PublishContentUpdate_rejects_button_to_non_button_and_appliesTo_change()
        {
            var original = Snap(
                new E { Address = "/v", Type = StagingEntryType.Int, Staged = true },
                new E { Address = "/b", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button, AppliesTo = new[] { "/v" } });
            var session = ReadySession(original);
            var toToggle = Snap(
                new E { Address = "/v", Type = StagingEntryType.Int, Staged = true },
                new E { Address = "/b", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Toggle, AppliesTo = new[] { "/v" } });
            Assert.That(session.PublishContentUpdate(toToggle).Failure, Is.EqualTo(ManifestChangeFailure.StructuralChangeRequiresReinject));
            var noApplies = Snap(
                new E { Address = "/v", Type = StagingEntryType.Int, Staged = true },
                new E { Address = "/b", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button });
            Assert.That(session.PublishContentUpdate(noApplies).Failure, Is.EqualTo(ManifestChangeFailure.StructuralChangeRequiresReinject));
        }

        [Test]
        public void PublishContentUpdate_reports_default_change_reason()
        {
            var session = ReadySession(Snap(new E { Address = "/a", DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 1f }));
            var result = session.PublishContentUpdate(Snap(new E { Address = "/a", DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 2f }));
            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.StructuralChangeRequiresReinject));
            Assert.That(result.Issues.Single().Message, Does.Contain("current value").And.Contain("F-7"));
        }

        [Test]
        public void PublishContentUpdate_failure_order()
        {
            Assert.That(new ManifestSession("b").PublishContentUpdate(Snap(new E())).Failure, Is.EqualTo(ManifestChangeFailure.NotInitialized));

            var suppressed = new ManifestSession("b");
            suppressed.Initialize(Snap(new E { Address = "/s", Type = StagingEntryType.Int, AppliesTo = new[] { "/a" } }));
            Assert.That(suppressed.State, Is.EqualTo(ManifestSessionState.Suppressed));
            Assert.That(suppressed.PublishContentUpdate(null).Failure, Is.EqualTo(ManifestChangeFailure.Suppressed));

            var ready = ReadySession(Snap(new E()));
            Assert.That(ready.PublishContentUpdate(null).Failure, Is.EqualTo(ManifestChangeFailure.InvalidManifest));

            var none = new ManifestSession("b");
            none.Initialize(Snap("", new ManifestSnapshotEntry[0]));
            Assert.That(none.PublishContentUpdate(Snap(new E())).Failure, Is.EqualTo(ManifestChangeFailure.StructuralChangeRequiresReinject));
            Assert.That(none.PublishContentUpdate(Snap("", new ManifestSnapshotEntry[0])).Failure, Is.EqualTo(ManifestChangeFailure.InvalidManifest));

            Assert.That(ready.PublishContentUpdate(Snap("other", new[] { new E().Build() })).Failure, Is.EqualTo(ManifestChangeFailure.ProjectIdMismatch));
        }

        [Test]
        public void PublishContentUpdate_validates_changed_entry()
        {
            var session = ReadySession(Snap(new E { Address = "/a", Type = StagingEntryType.Float }));
            var result = session.PublishContentUpdate(Snap(new E { Address = "/a", Type = StagingEntryType.Float, Widget = ManifestWidgetKind.Select }));
            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.InvalidManifest));
            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(1));
        }

        [Test]
        public void PublishContentUpdate_rejects_payload_over_limit_and_keeps_state()
        {
            var session = ReadySession(WithList("devices", "a"));
            session.TryBuildManifestJson(out var before, out _, out _);
            var huge = new string('x', ManifestLimits.PracticalLimitBytes);
            var result = session.PublishContentUpdate(WithList("devices", huge));
            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.PayloadTooLarge));
            Assert.That(result.PayloadBytes, Is.GreaterThan(ManifestLimits.PracticalLimitBytes));
            Assert.That(result.GenerationAdvanced, Is.False);
            session.TryBuildManifestJson(out var after, out _, out _);
            Assert.That(after, Is.EqualTo(before));
        }

        [Test]
        public void PublishContentUpdate_accepts_payload_exactly_at_limit()
        {
            var session = ReadySession(WithList("devices", "a"));
            var overhead = ManifestJsonWriter.Utf8ByteCount(ManifestJsonWriter.WriteManifest(WithList("devices", ""), null, new ManifestOrigin("boot-1", 2)));
            var result = session.PublishContentUpdate(WithList("devices", new string('x', ManifestLimits.PracticalLimitBytes - overhead)));
            Assert.That(result.Succeeded, Is.True, result.Failure.ToString());
            Assert.That(result.PayloadBytes, Is.EqualTo(ManifestLimits.PracticalLimitBytes));
        }

        // ---------- 9.1 / 9.2 / 9.3 F-8 事前検査と確定 ----------

        private static string Fingerprint(ManifestSession session, params string[] addresses)
        {
            session.TryBuildManifestJson(out var json, out _, out _);
            var values = string.Join(
                ";",
                addresses.Select(a => a + "=" + (session.TryGetCurrentValue(a, out var v) ? v.ToJsonLiteral() : "-")));
            return json + "|" + values + "|g" + session.Origin.StructureGeneration + "|" + string.Join(
                ",", session.AddressToId.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => p.Key + ">" + p.Value));
        }

        private static E Fl(string address, string id = "", float? def = null)
        {
            return new E
            {
                Address = address,
                Id = id,
                Type = StagingEntryType.Float,
                DefaultKind = def.HasValue ? ManifestDefaultKind.Float : ManifestDefaultKind.None,
                DefaultFloat = def ?? 0f,
            };
        }

        private static ManifestSnapshot Rows(params E[] entries)
        {
            return Snap(entries);
        }

        [Test]
        public void Precheck_before_initialize_is_NotInitialized()
        {
            var candidate = new ManifestSession("boot-1").Precheck(Rows(Fl("/a")));
            Assert.That(candidate.Passed, Is.False);
            Assert.That(candidate.Result.Failure, Is.EqualTo(ManifestChangeFailure.NotInitialized));
        }

        [Test]
        public void Precheck_distinguishes_each_failure_reason()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f)));

            Assert.That(session.Precheck(null).Result.Failure, Is.EqualTo(ManifestChangeFailure.InvalidManifest));
            Assert.That(session.Precheck(Snap("other", new[] { Fl("/a", "ida").Build() })).Result.Failure,
                Is.EqualTo(ManifestChangeFailure.ProjectIdMismatch));
            Assert.That(session.Precheck(Rows(Fl("/a", "idb"))).Result.Failure,
                Is.EqualTo(ManifestChangeFailure.AddressReused));
            Assert.That(session.Precheck(Rows(Fl("/x", "same"), Fl("/x", "diff"))).Result.Failure,
                Is.EqualTo(ManifestChangeFailure.AddressReused));

            var badStaging = new E { Address = "/t", Type = StagingEntryType.Int, AppliesTo = new[] { "/a" } };
            var compile = session.Precheck(Rows(Fl("/a", "ida"), badStaging));
            Assert.That(compile.Result.Failure, Is.EqualTo(ManifestChangeFailure.StagingCompileFailed));
            Assert.That(compile.Result.Issues.Select(i => i.Code), Does.Contain("S1"));

            var big = session.Precheck(Rows(new E { Address = "/a", Id = "ida", Type = StagingEntryType.String, Label = new string('x', ManifestLimits.PracticalLimitBytes) }));
            Assert.That(big.Result.Failure, Is.EqualTo(ManifestChangeFailure.PayloadTooLarge));
            Assert.That(big.PayloadBytes, Is.GreaterThan(ManifestLimits.PracticalLimitBytes));
        }

        [Test]
        public void Precheck_failure_order_validation_before_project_before_reuse_before_compile()
        {
            var session = ReadySession(Rows(Fl("/a", "ida")));
            // projectId 違いと再利用が同時なら projectId が先
            var both = Snap("other", new[] { Fl("/a", "idb").Build() });
            Assert.That(session.Precheck(both).Result.Failure, Is.EqualTo(ManifestChangeFailure.ProjectIdMismatch));
            // 再利用とコンパイルエラーが同時なら再利用が先
            var reuseAndCompile = Rows(Fl("/a", "idb"), new E { Address = "/t", Type = StagingEntryType.Int, AppliesTo = new[] { "/a" } });
            Assert.That(session.Precheck(reuseAndCompile).Result.Failure, Is.EqualTo(ManifestChangeFailure.AddressReused));
            // 検証エラーが最優先
            var invalid = Snap("other", new[] { new E { Address = " " }.Build() });
            Assert.That(session.Precheck(invalid).Result.Failure, Is.EqualTo(ManifestChangeFailure.InvalidManifest));
        }

        [Test]
        public void Precheck_has_no_side_effects_on_success_or_failure()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f), Fl("/b", "idb", 2f)));
            session.Handle("/a", StagingValue.FromFloat(5f));
            var before = Fingerprint(session, "/a", "/b", "/c");
            var version = session.StateVersion;

            Assert.That(session.Precheck(Rows(Fl("/a", "ida", 9f), Fl("/c", "idc", 3f))).Passed, Is.True);
            Assert.That(session.Precheck(Rows(Fl("/a", "other"))).Passed, Is.False);
            Assert.That(session.Precheck(null).Passed, Is.False);

            Assert.That(Fingerprint(session, "/a", "/b", "/c"), Is.EqualTo(before));
            Assert.That(session.StateVersion, Is.EqualTo(version));
            Assert.That(session.State, Is.EqualTo(ManifestSessionState.Ready));
        }

        [Test]
        public void Precheck_skips_project_check_when_there_is_no_valid_manifest()
        {
            var session = new ManifestSession("boot-1");
            session.Initialize(Snap("", new ManifestSnapshotEntry[0]));
            var candidate = session.Precheck(Rows(Fl("/a")));
            Assert.That(candidate.Passed, Is.True, candidate.Result.Failure.ToString());
        }

        [Test]
        public void Precheck_carries_over_only_entries_matching_id_address_and_type()
        {
            var session = ReadySession(Rows(
                Fl("/keep", "k", 1f), Fl("/typed", "t", 1f), Fl("/renamed", "old", 1f), Fl("/gone", "g", 1f)));
            foreach (var a in new[] { "/keep", "/typed", "/renamed", "/gone" })
            {
                session.Handle(a, StagingValue.FromFloat(7f));
            }

            var next = Rows(
                Fl("/keep", "k", 0.5f),
                new E { Address = "/typed", Id = "t", Type = StagingEntryType.Int, DefaultKind = ManifestDefaultKind.Int, DefaultInt = 3 },
                Fl("/renamed", "old", 0.5f),
                Fl("/fresh", "f", 0.25f));
            var candidate = session.Precheck(next);
            Assert.That(candidate.Passed, Is.True, candidate.Result.Failure.ToString());
            var result = session.Commit(candidate);
            Assert.That(result.Succeeded, Is.True);

            session.TryGetCurrentValue("/keep", out var keep);
            session.TryGetCurrentValue("/typed", out var typed);
            session.TryGetCurrentValue("/fresh", out var fresh);
            Assert.That(keep, Is.EqualTo(StagingValue.FromFloat(7f)));
            Assert.That(typed, Is.EqualTo(StagingValue.FromInt(3)));
            Assert.That(fresh, Is.EqualTo(StagingValue.FromFloat(0.25f)));
            Assert.That(session.TryGetCurrentValue("/gone", out _), Is.False);
        }

        [Test]
        public void Precheck_does_not_seed_default_that_does_not_fit_type_and_reports_it()
        {
            var session = ReadySession(Rows(Fl("/a")));
            var candidate = session.Precheck(Rows(
                Fl("/a"),
                new E { Address = "/bad", Type = StagingEntryType.Int, DefaultKind = ManifestDefaultKind.String, DefaultString = "x" }));
            Assert.That(candidate.Passed, Is.True);
            Assert.That(candidate.UnseededAddresses, Is.EquivalentTo(new[] { "/bad" }));
            session.Commit(candidate);
            Assert.That(session.TryGetCurrentValue("/bad", out _), Is.False);
        }

        [Test]
        public void Precheck_measures_bytes_of_the_candidate_with_generation_plus_one()
        {
            var session = ReadySession(Rows(Fl("/a", "", 1f)));
            var candidate = session.Precheck(Rows(Fl("/a", "", 1f), Fl("/b", "", 2f)));
            Assert.That(candidate.Passed, Is.True);
            var expected = ManifestJsonWriter.Utf8ByteCount(
                ManifestJsonWriter.WriteManifest(
                    Rows(Fl("/a", "", 1f), Fl("/b", "", 2f)),
                    null,
                    new ManifestOrigin("boot-1", 2)));
            // default を含むため null engine より大きい。実際の確定後の JSON と一致することを見る
            Assert.That(candidate.PayloadBytes, Is.GreaterThan(expected));
            var committed = session.Commit(candidate);
            session.TryBuildManifestJson(out var json, out var bytes, out _);
            Assert.That(committed.PayloadBytes, Is.EqualTo(candidate.PayloadBytes));
            Assert.That(bytes, Is.EqualTo(candidate.PayloadBytes));
            Assert.That(json, Does.Contain("\"structureGeneration\":2,"));
            Assert.That(candidate.StateVersion, Is.LessThan(session.StateVersion));
        }

        [Test]
        public void Commit_swaps_plan_snapshot_map_and_advances_generation_and_version_once()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f)));
            var version = session.StateVersion;
            var result = session.Commit(session.Precheck(Rows(Fl("/b", "idb", 2f))));

            Assert.That(result.Succeeded, Is.True);
            Assert.That(result.GenerationAdvanced, Is.True);
            Assert.That(result.StructureGeneration, Is.EqualTo(2));
            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(2));
            Assert.That(session.StateVersion, Is.EqualTo(version + 1));
            Assert.That(session.TryGetCurrentValue("/a", out _), Is.False);
            Assert.That(session.TryGetCurrentValue("/b", out _), Is.True);
            // 消えた対も覚え続ける
            Assert.That(session.AddressToId["/a"], Is.EqualTo("ida"));
            Assert.That(session.AddressToId["/b"], Is.EqualTo("idb"));
        }

        [Test]
        public void Commit_can_be_repeated_any_number_of_times()
        {
            var session = ReadySession(Rows(Fl("/r0", "r0")));
            for (var i = 1; i <= 5; i++)
            {
                var result = session.Commit(session.Precheck(Rows(Fl("/r" + i, "r" + i))));
                Assert.That(result.Succeeded, Is.True);
                Assert.That(result.StructureGeneration, Is.EqualTo(i + 1));
            }
        }

        [Test]
        public void Commit_of_a_failed_candidate_returns_same_failure_and_changes_nothing()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f)));
            var before = Fingerprint(session, "/a");
            var candidate = session.Precheck(Rows(Fl("/a", "idb")));
            var result = session.Commit(candidate);
            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.AddressReused));
            Assert.That(result.StateChangedSinceCheck, Is.False);
            Assert.That(Fingerprint(session, "/a"), Is.EqualTo(before));
        }

        [Test]
        public void Commit_rejects_null_and_foreign_candidates_without_changes()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f)));
            var other = ReadySession(Rows(Fl("/a", "ida", 1f)));
            var before = Fingerprint(session, "/a");
            Assert.That(session.Commit(null).Succeeded, Is.False);
            Assert.That(session.Commit(other.Precheck(Rows(Fl("/b")))).Succeeded, Is.False);
            Assert.That(Fingerprint(session, "/a"), Is.EqualTo(before));
        }

        [Test]
        public void Commit_after_state_change_reuses_decision_when_still_acceptable_and_carries_latest_value()
        {
            var session = ReadySession(Rows(Fl("/a", "ida", 1f)));
            var candidate = session.Precheck(Rows(Fl("/a", "ida", 9f), Fl("/b", "idb", 2f)));
            session.Handle("/a", StagingValue.FromFloat(4f));

            var result = session.Commit(candidate);
            Assert.That(result.Succeeded, Is.True);
            session.TryGetCurrentValue("/a", out var a);
            Assert.That(a, Is.EqualTo(StagingValue.FromFloat(4f)));
            session.TryBuildManifestJson(out _, out var bytes, out _);
            Assert.That(result.PayloadBytes, Is.EqualTo(bytes));
        }

        [Test]
        public void Commit_reports_state_change_when_a_recorded_value_makes_the_candidate_too_large()
        {
            var session = ReadySession(Rows(new E { Address = "/s", Id = "ids", Type = StagingEntryType.String, DefaultKind = ManifestDefaultKind.String, DefaultString = "" }));
            var padding = new string('p', ManifestLimits.PracticalLimitBytes - 800);
            var next = Rows(
                new E { Address = "/s", Id = "ids", Type = StagingEntryType.String, DefaultKind = ManifestDefaultKind.String, DefaultString = "" },
                new E { Address = "/pad", Id = "pad", Type = StagingEntryType.String, Label = padding });
            var candidate = session.Precheck(next);
            Assert.That(candidate.Passed, Is.True, candidate.Result.Failure.ToString());

            session.Handle("/s", StagingValue.FromString(new string('v', 2000)));
            var before = Fingerprint(session, "/s");
            var result = session.Commit(candidate);

            Assert.That(result.Failure, Is.EqualTo(ManifestChangeFailure.PayloadTooLarge));
            Assert.That(result.StateChangedSinceCheck, Is.True);
            Assert.That(result.GenerationAdvanced, Is.False);
            Assert.That(Fingerprint(session, "/s"), Is.EqualTo(before));
            // 失敗の後も直前の成功状態で動く
            Assert.That(session.Handle("/s", StagingValue.FromString("ok")).Recorded, Is.True);
        }

        [Test]
        public void Commit_from_Suppressed_becomes_Ready_and_from_NoValidManifest_records_project()
        {
            var suppressed = new ManifestSession("boot-1");
            suppressed.Initialize(Snap(new E { Address = "/s", Type = StagingEntryType.Int, AppliesTo = new[] { "/a" } }));
            Assert.That(suppressed.State, Is.EqualTo(ManifestSessionState.Suppressed));
            Assert.That(suppressed.Commit(suppressed.Precheck(Rows(Fl("/s", "", 1f)))).Succeeded, Is.True);
            Assert.That(suppressed.State, Is.EqualTo(ManifestSessionState.Ready));
            Assert.That(suppressed.TryBuildManifestJson(out _, out _, out _), Is.True);

            var none = new ManifestSession("boot-1");
            none.Initialize(Snap("", new ManifestSnapshotEntry[0]));
            Assert.That(none.Commit(none.Precheck(Rows(Fl("/a")))).Succeeded, Is.True);
            Assert.That(none.State, Is.EqualTo(ManifestSessionState.Ready));
            Assert.That(none.ProjectId, Is.EqualTo("proj"));
            Assert.That(none.Precheck(Snap("elsewhere", new[] { Fl("/a").Build() })).Result.Failure,
                Is.EqualTo(ManifestChangeFailure.ProjectIdMismatch));
        }

        // ---------- 9.3 受け入れ条件 ----------

        private static IEnumerable<TestCaseData> FailureCandidates()
        {
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Rows(new E { Address = "/a", Id = "ida", Widget = ManifestWidgetKind.Select, Type = StagingEntryType.Float })), ManifestChangeFailure.InvalidManifest).SetName("invalid");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Rows(Fl("/a", "ida"), new E { Address = "/t", Type = StagingEntryType.Int, AppliesTo = new[] { "/a" } })), ManifestChangeFailure.StagingCompileFailed).SetName("compile");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Rows(new E { Address = "/a", Id = "ida", Type = StagingEntryType.String, Label = new string('x', ManifestLimits.PracticalLimitBytes) })), ManifestChangeFailure.PayloadTooLarge).SetName("size");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Snap("other", new[] { Fl("/a", "ida").Build() })), ManifestChangeFailure.ProjectIdMismatch).SetName("project");
            yield return new TestCaseData(new Func<ManifestSnapshot>(() => Rows(Fl("/a", "different"))), ManifestChangeFailure.AddressReused).SetName("reuse");
        }

        [TestCaseSource(nameof(FailureCandidates))]
        public void Failed_reinject_keeps_old_snapshot_plan_values_and_generation(Func<ManifestSnapshot> candidate, ManifestChangeFailure expected)
        {
            var session = ReadySession(Rows(
                new E { Address = "/a", Id = "ida", Type = StagingEntryType.Float, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 1f, Staged = true },
                new E { Address = "/go", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button, AppliesTo = new[] { "/a" } }));
            session.Handle("/a", StagingValue.FromFloat(3f));
            var before = Fingerprint(session, "/a");

            var checkedCandidate = session.Precheck(candidate());
            var result = session.Commit(checkedCandidate);

            Assert.That(result.Failure, Is.EqualTo(expected));
            Assert.That(Fingerprint(session, "/a"), Is.EqualTo(before));
            // 旧い計画のまま適用が動く
            var reaction = session.Handle("/go", StagingValue.FromInt(1));
            Assert.That(reaction.ApplyTriggered, Is.True);
            Assert.That(reaction.ApplyPayload.Single().Value, Is.EqualTo(StagingValue.FromFloat(3f)));
        }

        [Test]
        public void Size_check_counts_carried_over_long_value_that_the_asset_alone_does_not_have()
        {
            // 資産単体は上限未満だが、引き継いだ長い文字列を含めると超過する
            var session = ReadySession(Rows(new E { Address = "/s", Id = "ids", Type = StagingEntryType.String, DefaultKind = ManifestDefaultKind.String, DefaultString = "" }));
            var next = Rows(
                new E { Address = "/s", Id = "ids", Type = StagingEntryType.String, DefaultKind = ManifestDefaultKind.String, DefaultString = "" },
                new E { Address = "/pad", Id = "pad", Type = StagingEntryType.String, Label = new string('p', ManifestLimits.PracticalLimitBytes - 1000) });
            var assetOnly = ManifestJsonWriter.Utf8ByteCount(
                ManifestJsonWriter.WriteManifest(next, new StagingEngine(StagingPlan.Empty), new ManifestOrigin("boot-1", 2)));
            Assert.That(assetOnly, Is.LessThan(ManifestLimits.PracticalLimitBytes));

            Assert.That(session.Precheck(next).Passed, Is.True);
            session.Handle("/s", StagingValue.FromString(new string('v', 3000)));

            var candidate = session.Precheck(next);
            Assert.That(candidate.Result.Failure, Is.EqualTo(ManifestChangeFailure.PayloadTooLarge));
            Assert.That(candidate.PayloadBytes, Is.GreaterThan(ManifestLimits.PracticalLimitBytes));
            Assert.That(session.Commit(candidate).Succeeded, Is.False);
            Assert.That(session.Origin.StructureGeneration, Is.EqualTo(1));
        }

        [Test]
        public void Reinject_middle_row_removal_carries_only_matching_ids_and_no_stale_values_leak()
        {
            var session = ReadySession(Rows(Fl("/r1", "i1", 1f), Fl("/r2", "i2", 2f), Fl("/r3", "i3", 3f)));
            session.Handle("/r1", StagingValue.FromFloat(10f));
            session.Handle("/r2", StagingValue.FromFloat(20f));
            session.Handle("/r3", StagingValue.FromFloat(30f));

            Assert.That(session.Commit(session.Precheck(Rows(Fl("/r1", "i1", 1f), Fl("/r3", "i3", 3f)))).Succeeded, Is.True);

            session.TryGetCurrentValue("/r1", out var r1);
            session.TryGetCurrentValue("/r3", out var r3);
            Assert.That(r1, Is.EqualTo(StagingValue.FromFloat(10f)));
            Assert.That(r3, Is.EqualTo(StagingValue.FromFloat(30f)));
            Assert.That(session.TryGetCurrentValue("/r2", out _), Is.False);

            // 同じ識別子の同じアドレスへの復帰は受け付けるが、前の実体の値は残らない(既定値でシード)
            var back = session.Commit(session.Precheck(Rows(Fl("/r1", "i1", 1f), Fl("/r2", "i2", 2f), Fl("/r3", "i3", 3f))));
            Assert.That(back.Succeeded, Is.True);
            session.TryGetCurrentValue("/r2", out var r2);
            Assert.That(r2, Is.EqualTo(StagingValue.FromFloat(2f)));
        }

        [Test]
        public void Reinject_type_change_and_id_change_do_not_carry_values()
        {
            var session = ReadySession(Rows(Fl("/t", "it", 1f), Fl("/i", "oldid", 1f)));
            session.Handle("/t", StagingValue.FromFloat(8f));
            session.Handle("/i", StagingValue.FromFloat(8f));

            // 型の変更(識別子・アドレスは同じ)
            var typed = Rows(
                new E { Address = "/t", Id = "it", Type = StagingEntryType.Int, DefaultKind = ManifestDefaultKind.Int, DefaultInt = 4 },
                Fl("/i", "oldid", 1f));
            Assert.That(session.Commit(session.Precheck(typed)).Succeeded, Is.True);
            session.TryGetCurrentValue("/t", out var t);
            session.TryGetCurrentValue("/i", out var kept);
            Assert.That(t, Is.EqualTo(StagingValue.FromInt(4)));
            Assert.That(kept, Is.EqualTo(StagingValue.FromFloat(8f)));

            // 識別子の変更は同じアドレスの再利用として拒否され、新しいアドレスの新しい識別子は既定値で始まる
            Assert.That(session.Precheck(Rows(Fl("/i", "newid", 6f))).Result.Failure, Is.EqualTo(ManifestChangeFailure.AddressReused));
            Assert.That(session.Commit(session.Precheck(Rows(Fl("/i2", "newid", 6f)))).Succeeded, Is.True);
            session.TryGetCurrentValue("/i2", out var fresh);
            Assert.That(fresh, Is.EqualTo(StagingValue.FromFloat(6f)));
            Assert.That(session.TryGetCurrentValue("/i", out _), Is.False);
        }

        [Test]
        public void Staged_pending_value_carried_over_matches_json_default_and_apply_payload_and_resolves_against_new_plan()
        {
            var session = ReadySession(Rows(
                new E { Address = "/v1", Id = "v1", Staged = true, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 1f },
                new E { Address = "/v2", Id = "v2", Staged = true, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 2f },
                new E { Address = "/go", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button, AppliesTo = new[] { "/v*" } }));
            session.Handle("/v2", StagingValue.FromFloat(22f));

            // /v1 を消し、/v3 を足す。appliesTo は新しい計画のアドレス集合で解決される
            var next = Rows(
                new E { Address = "/v2", Id = "v2", Staged = true, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 2f },
                new E { Address = "/v3", Id = "v3", Staged = true, DefaultKind = ManifestDefaultKind.Float, DefaultFloat = 3f },
                new E { Address = "/go", Type = StagingEntryType.Int, Widget = ManifestWidgetKind.Button, AppliesTo = new[] { "/v*" } });
            Assert.That(session.Commit(session.Precheck(next)).Succeeded, Is.True);

            session.TryBuildManifestJson(out var json, out _, out _);
            Assert.That(json, Does.Contain("\"address\":\"/v2\"").And.Contain("\"default\":22"));

            var reaction = session.Handle("/go", StagingValue.FromInt(1));
            Assert.That(reaction.ApplyTriggered, Is.True);
            var payload = reaction.ApplyPayload.ToDictionary(w => w.Address, w => w.Value);
            Assert.That(payload.Keys, Is.EquivalentTo(new[] { "/v2", "/v3" }));
            Assert.That(payload["/v2"], Is.EqualTo(StagingValue.FromFloat(22f)));
            Assert.That(payload["/v3"], Is.EqualTo(StagingValue.FromFloat(3f)));
            Assert.That(json, Does.Contain("\"default\":3"));
        }

        [Test]
        public void Late_send_to_removed_address_is_not_recorded_and_does_not_touch_other_entities()
        {
            var session = ReadySession(Rows(Fl("/old", "iold", 1f), Fl("/keep", "ik", 2f)));
            session.Commit(session.Precheck(Rows(Fl("/keep", "ik", 2f), Fl("/new", "inew", 5f))));
            var version = session.StateVersion;

            var reaction = session.Handle("/old", StagingValue.FromFloat(99f));

            Assert.That(reaction.Recorded, Is.False);
            Assert.That(session.StateVersion, Is.EqualTo(version));
            Assert.That(session.TryGetCurrentValue("/old", out _), Is.False);
            session.TryGetCurrentValue("/keep", out var keep);
            session.TryGetCurrentValue("/new", out var fresh);
            Assert.That(keep, Is.EqualTo(StagingValue.FromFloat(2f)));
            Assert.That(fresh, Is.EqualTo(StagingValue.FromFloat(5f)));

            // 消えたアドレスは別の識別子では使えない(遅れた送信が別の実体に入らない)
            Assert.That(session.Precheck(Rows(Fl("/keep", "ik"), Fl("/old", "someone-else"))).Result.Failure,
                Is.EqualTo(ManifestChangeFailure.AddressReused));
        }
    }
}
```

### A.3 本文 §4 との対応と読み替え表

| 本文 §4 の操作・前提 | uOSC(A.2)での実現 | 別ライブラリへの読み替え観点 |
|---|---|---|
| 受信ハンドラの登録(`on datagramReceived` → `handlePacket`) | `OscSurfaceBridge.cs` の `uOscServer.onDataReceived.AddListener(OnDataReceived)` | 受信コールバック(またはポーリング)の登録 API に置き換える |
| bundle の再帰展開(§4.1 骨格の手順 2) | uOSC が自動展開し、展開後メッセージ単位でコールバックが呼ばれるため bundle 分岐は書いていない | 自動展開しないライブラリでは §4.1 の骨格どおり再帰展開を自前で書く |
| マニフェスト定義の読み込み | `OscSurfaceManifestAsset.cs` の ScriptableObject を不変なスナップショットへ写し(`ToSnapshot`)、`OscSurfaceManifestSession.cs` の中核が検証して JSON 化する。`OscSurfaceBridge.cs` はその結果を送る | 設定アセットを読み込み、本文 §2 の JSON フィールドへシリアライズする |
| ステージング宣言の検証・値保持・適用反応 | `OscSurfaceBridge.Staging.asmdef` の純 C# `OscSurfaceStaging.cs` が担当し、OSC ライブラリを知らない | Unity/OSC アダプタから分離した純 C# の状態機械として実装する |
| ステージング反応の呼び出し | `OscSurfaceBridge.cs` が Unity のメインスレッドで中核を呼び、適用 `event` を購読する | 受信スレッドから直接 UI やアプリ状態を変更せず、ホストのメインスレッドへディスパッチする |
| `input` / `select` の宣言 | `WidgetType.Input` / `WidgetType.Select` と `Entry` の `hasOptions`・`options`・`optionsRef`・`pattern` を使用する | `input` は `s` / `i` / `f`、`select` は `s` に制限し、選択肢はインラインまたは共有参照の一方だけを出力する |
| 共有選択肢辞書 | `OscSurfaceManifestAsset.optionLists` の `OptionList(key, values)` をトップレベルの `optionLists` オブジェクトへ変換する | 辞書のキー重複・空キー・参照先不在を送信前に検証する |
| `pattern` の検証 | `OscSurfaceManifestModel.cs` の `ManifestValidator` が文字列型であることと `System.Text.RegularExpressions.Regex` のコンパイル可否を検証する | TS の `RegExp` と Python の `re` に共通する基本構文に限定する |
| 計数と時刻更新をディスパッチに先行(§4.1) | `OscSurfaceBridge.cs` の `OnDataReceived` 冒頭で `received` / `lastReceivedAt` を更新 | そのまま同じ順序で実装する |
| `osc_send`(設定された返信先へ送信) | `uOscClient.Send(address, args...)`。宛先はインスペクタの `address` / `port` で固定 | 送信 API で宛先ホスト・ポートを明示指定できること(§6 の #3) |
| 真偽値は `i` の 0/1(§4.4) | `OscSurfaceBridge.cs` の `NormalizeValue` で C# `bool` を 0/1 の `int` へ変換してから送信 | ライブラリが bool を `T`/`F` タグにする場合は同様の変換層を挟む |
| 排他制御 | 不要。uOSC は `onDataReceived` を **メインスレッド** で呼ぶ | 受信スレッドでコールバックするライブラリでは共有状態に排他が必要 |
| `parseErrors` の計数(§4.1) | `OscSurfaceBridge.cs` は観測不能のため常に 0(A.4) | decode 失敗を通知する API があれば §4.1 どおり計数する |

### A.4 uOSC 固有の差異と制約

- **`parseErrors` が観測不能**: uOSC は decode に失敗したデータグラムを外部へ通知しない。参照実装は常に 0 を報告する(§4.1 補足の「通知しないライブラリ」の具体例)
- **対応型は int / float / string / byte[]**: C# の `bool` は送信できないため、0/1 の `int` へ正規化して送る(§4.4 と一致。`T`/`F` タグは使われない)
- **受信コールバックはメインスレッド(フレーム同期)**: pong 返信がフレーム処理に乗るため、RTT にフレーム時間ぶんの揺らぎが加わる。Editor の Pause 中は応答が止まり、oscdesk 側は喪失と表示する(§5.3 の正常挙動)
- **ステージング中核は uOSC 非依存**: `OscSurfaceStaging.cs` は `UnityEngine`、`uOSC`、UDP I/O を参照しない。`OscSurfaceBridge.cs` がメインスレッド上で受信値を中核へ渡し、適用イベントをアプリ側へ中継する
- **ステージングのスレッド前提**: 参照実装の状態保持と適用イベントは Unity のメインスレッドから呼び出す。別スレッドで受信するライブラリへ移植する場合は、メインスレッドへのディスパッチまたは同等の排他をアダプタ側で追加する
- **受信は `uOscServer`・送信は `uOscClient` に分離**: 送信宛先は常に `uOscClient` の設定値であり、「返信先を設定で明示する」前提(§4.4・互換性ノート)と自然に一致する
