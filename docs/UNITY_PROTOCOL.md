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
{ "received": 0, "parseErrors": 0, "lastReceivedAt": "ISO-8601 文字列" }
```

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
    pattern?: string       // input の文字列検証用正規表現
  }]
  optionLists?: { [key: string]: string[] } // 共有選択肢辞書
}
```

- `projectId` はプロジェクトを識別するための必須フィールドである。値は人間が決める任意の非空文字列とし、UUID や特定の命名規則は要求しない。`version` は `1` のままであり、`projectId` を持たない旧形式のマニフェストは受理しない。
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
    lastReceivedAt: iso8601_utc(lastReceivedAt)   // 例: "2026-07-24T12:34:56.789Z"
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

アプリ側はエントリ定義(何を操作可能として公開するか)を静的に持ち、値は `currentValues` を優先して埋める。

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
  payload = { version: 1, projectId: projectId, entries: entries }
  osc_send("/sys/manifest", [ string(json_encode_utf8(payload)) ])  // s 1 引数・単一データグラム
```

- `projectId` は送信側プロジェクト固有の非空文字列として、すべての `/sys/manifest` 応答に含める。`expectedProjectId` を設定している oscdesk と接続する場合は、両者が同じ文字列を事前に設定しておく。
- Unity 側でマニフェスト定義アセットが未割当、`projectId` が空、またはエントリ定義が不正な場合は、エラーを記録してマニフェストを送信しない。ping/pong、stats、通常値のエコーバックは継続する。

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

一括操作の展開元アドレスには、展開先のワイルドカードパターンを宣言できる。受信値は展開先の各アドレスにも同値で記録し、展開元へ受信引数をそのままエコーバックした後、展開先へ単一引数の個別エコーバックを行う。展開先の `currentValues` も更新する。展開は 1 段だけとし、展開先を別の展開元として再展開しない。展開だけでは適用イベントを発火しない。

ワイルドカードは適用範囲と展開先で同じ 1 種類の規則を使う。パターンとアドレスを `/` で分割し、part 数が一致するときだけ照合する。各 part の `*` はその part 内の 0 文字以上に一致するが、`/` は跨がない。`?`、`[]`、`{}`、`,`、`//` は採用しない。例えば `/vp/member/*/*` は `/vp/member/01/active` に一致するが、`/vp/member/*` は part 数が違うため一致しない。

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
| S7 | 展開元自身を除く展開先が空 |
| S8 | `Blob` 型エントリを `staged` にしている |
| S9 | ステージング宣言がある状態で同一アドレスのエントリが重複している |

ステージングを含む通常メッセージの処理順序は、エコーバックが適用イベントより先に完了することを保証する。記録可能引数がない場合は記録・展開・適用を行わず、受信アドレスへのエコーだけを行う。

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
- JSON 全体は単一データグラムに収まること(~1.4KB 以内を推奨、実用上限 ~60KB。互換性ノート参照)

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
- 編集中はホールドを設定し、Unity からのエコーバックで表示を上書きしない。確定成功またはフォーカス喪失でホールドを解除し、その後のエコーバックを表示の確定値とする。切断時・期限切れ時にもホールドを解放する。
- 送信する OSC 型タグは `type` に従う(`s` / `i` / `f`)。確定送信は 1 回だけ行い、値の確定は必ずエコーバックで行う。

#### select

- `options` または `optionsRef` を解決した文字列配列をドロップダウンへ表示する。選択操作は即時に 1 回だけ同一アドレスへ `s` タグで送信し、ホールドは使用しない。
- エコーバックが選択肢内なら選択状態を確定する。選択肢外の値は一覧へ追加せず選択状態を空にし、ドロップダウン直下などの表示部へ受信文字列をそのまま表示する。選択肢内の値に戻ったらこの補助表示を解除する。
- 選択肢が空の場合はドロップダウンを無効化し、「選択肢なし」を表示する。`default` やエコーバックが選択肢外でも受信値を表示し、マニフェストを不採用にしない。

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
| 4 | bundle を受信展開できる(自動展開または要素へアクセスできる) | oscdesk の現行実装は bundle を送信しないため即座には問題にならないが、§4.1 の展開後メッセージ単位の計数を守れる形で吸収する |
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

- **`/sys/manifest` は単一 UDP データグラムに収める**。OSC 1.0 にメッセージ分割・再結合の機構はない。IP フラグメンテーションを避けるには JSON 全体で **~1.4KB 以内を推奨**(一般的な MTU 1500 を想定)。フラグメント許容でも IPv4 UDP の理論上限から **実用上限は ~60KB** とみなす。これを超えるマニフェストが必要になった場合は、独断でプロトコルを拡張せず、選択肢(エントリ分割の拡張仕様・TCP 等の別トランスポート・エントリ数の削減)を添えてユーザー判断へ返す。
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

### A.2 参照実装(中核アセンブリ + C# 3 ファイル + テストアセンブリ)

使い方: 空の GameObject に `OscSurfaceBridge` を追加し(`RequireComponent` で `uOscServer` / `uOscClient` も自動追加される)、インスペクタで次を設定して Play する。

- `uOscServer.port` = oscdesk config の `unity.sendPort`(既定 7090)
- `uOscClient.address` / `port` = oscdesk ホスト : `unity.receivePort`(既定 `127.0.0.1` : 7091)
- `manifestAsset` = `OscSurfaceManifestAsset` の同梱アセット(またはプロジェクト固有のアセット)

中核ステージングエンジンは `UnityEngine` と OSC ライブラリを参照しない純 C# アセンブリであり、宣言の検証・値の保持・反応の決定を担当する。`OscSurfaceBridge` は Unity のメインスレッド上で中核を呼び出し、uOSC への送受信とイベント通知を担当する。EditMode テストは中核アセンブリだけを対象とし、実 UDP を送信する `OscSurfaceBridge` 本体は対象外とする。

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
                    AddError(found, "S5", entry.Address, "ExpandsTo resolves to no declared address.");
                }

                var targets = new List<string>();
                foreach (var target in resolved)
                {
                    if (string.Equals(target, entry.Address, StringComparison.Ordinal))
                    {
                        continue;
                    }

                    if (declared[target].Type != entry.Type)
                    {
                        AddError(found, "S6", entry.Address, "An expansion target has a different entry type.");
                    }
                    else
                    {
                        targets.Add(target);
                    }
                }

                if (targets.Count == 0)
                {
                    AddError(found, "S7", entry.Address, "Expansion resolves only to its source or to no target.");
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

        public StagingApplyContext(string triggerAddress, IReadOnlyList<StagingWrite> payload)
        {
            TriggerAddress = triggerAddress ?? string.Empty;
            var values = new Dictionary<string, StagingValue>(StringComparer.Ordinal);
            if (payload != null)
            {
                foreach (var write in payload)
                {
                    values[write.Address] = write.Value;
                }
            }

            Values = values;
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

        public void SeedInitialValue(string address, StagingValue value)
        {
            if (string.IsNullOrEmpty(address) || !TryNormalizeForEntry(address, value, out var normalized))
            {
                return;
            }

            currentValues[address] = normalized;
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
using UnityEngine;

[CreateAssetMenu(menuName = "OSCDesk/Manifest Asset", fileName = "OscDeskManifest")]
public sealed class OscSurfaceManifestAsset : ScriptableObject
{
    public string projectId = "";
    public List<Entry> entries = new List<Entry>();
    public List<OptionList> optionLists = new List<OptionList>();

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
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
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

    // 起動時にコンパイルした計画。宣言が無い場合も Empty を保持し、従来動作を維持する。
    private StagingEngine stagingEngine = new StagingEngine(StagingPlan.Empty);
    private bool stagingManifestSuppressed;

    private uOscServer server;
    private uOscClient client; // 全送信の出口 = 設定された返信先(§4.4)

    private void Awake()
    {
        // 起動時にアセット検証 → 宣言写像 → 計画コンパイルを一度だけ行う。
        // コンパイル失敗時は Empty 計画へ落とし、通常のエコーと sys 系の生存性は維持する。
        if (!TryGetValidatedAsset(out var asset))
        {
            return;
        }

        var declarations = new List<StagingEntryDeclaration>(asset.entries.Count);
        foreach (var entry in asset.entries)
        {
            declarations.Add(ToStagingDeclaration(entry));
        }

        if (!StagingPlan.TryCompile(
                new StagingDeclaration(declarations),
                out var compiledPlan,
                out var compileErrors))
        {
            stagingManifestSuppressed = true;
            foreach (var error in compileErrors)
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset staging declaration " + error.Code
                    + " at \"" + error.Address + "\": " + error.Message,
                    asset);
            }

            // fail-safe: invalid staging metadata must not disable normal OSC handling.
            stagingEngine = new StagingEngine(StagingPlan.Empty);
        }
        else
        {
            stagingEngine = new StagingEngine(compiledPlan);
        }

        // 起動直後の現在値をエントリ定義の初期値で埋める(§4.3)。
        // 計画にも同じ値をシードし、manifest の default と適用対象を一致させる。
        foreach (var entry in asset.entries)
        {
            if (TryGetDefaultValue(entry, out var initial))
            {
                var resolved = ResolveInitial(initial);
                if (TryToStagingValue(entry, resolved, out var stagingValue))
                {
                    stagingEngine.SeedInitialValue(entry.address, stagingValue);
                }
            }
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
        client.Send("/sys/stats", BuildStatsJson());
    }

    private void SendManifest()
    {
        if (stagingManifestSuppressed)
        {
            return;
        }

        if (TryBuildManifestJson(out var json))
        {
            client.Send("/sys/manifest", json);
        }
    }

    private static StagingEntryDeclaration ToStagingDeclaration(OscSurfaceManifestAsset.Entry entry)
    {
        return new StagingEntryDeclaration(
            entry.address,
            ToStagingEntryType(entry.type),
            entry.widget == OscSurfaceManifestAsset.WidgetType.Button,
            entry.staged,
            entry.appliesTo,
            entry.expandsTo);
    }

    private static StagingEntryType ToStagingEntryType(OscSurfaceManifestAsset.EntryType type)
    {
        switch (type)
        {
            case OscSurfaceManifestAsset.EntryType.Int: return StagingEntryType.Int;
            case OscSurfaceManifestAsset.EntryType.Float: return StagingEntryType.Float;
            case OscSurfaceManifestAsset.EntryType.String: return StagingEntryType.String;
            case OscSurfaceManifestAsset.EntryType.Bool: return StagingEntryType.Bool;
            default: return StagingEntryType.Blob;
        }
    }

    private static bool TryToStagingValue(
        OscSurfaceManifestAsset.Entry entry,
        object value,
        out StagingValue stagingValue)
    {
        switch (ToStagingEntryType(entry.type))
        {
            case StagingEntryType.Int:
                if (value is int intValue)
                {
                    stagingValue = StagingValue.FromInt(intValue);
                    return true;
                }
                break;
            case StagingEntryType.Float:
                if (value is float floatValue)
                {
                    stagingValue = StagingValue.FromFloat(floatValue);
                    return true;
                }
                if (value is int intAsFloat)
                {
                    stagingValue = StagingValue.FromFloat(intAsFloat);
                    return true;
                }
                break;
            case StagingEntryType.String:
                if (value is string stringValue)
                {
                    stagingValue = StagingValue.FromString(stringValue);
                    return true;
                }
                break;
            case StagingEntryType.Bool:
                if (value is bool boolValue)
                {
                    stagingValue = StagingValue.FromInt(boolValue ? 1 : 0);
                    return true;
                }
                if (value is int intAsBool && (intAsBool == 0 || intAsBool == 1))
                {
                    stagingValue = StagingValue.FromInt(intAsBool);
                    return true;
                }
                break;
        }

        stagingValue = StagingValue.None;
        return false;
    }

    // §4.3 通常メッセージ: 現在値の記録 + 同一アドレスへのエコーバック(§3)
    private void HandleNormalMessage(Message message)
    {
        var recordable = TryGetRecordableValue(message.address, message.values, out var stagingValue);
        var reaction = stagingEngine.Handle(
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

    private bool TryGetRecordableValue(string address, object[] values, out StagingValue stagingValue)
    {
        stagingValue = StagingValue.None;
        if (manifestAsset == null || manifestAsset.entries == null || values == null)
        {
            return false;
        }

        foreach (var entry in manifestAsset.entries)
        {
            if (entry == null || entry.address != address)
            {
                continue;
            }

            foreach (var value in values)
            {
                if (TryToStagingValue(entry, value, out stagingValue))
                {
                    return true;
                }
            }

            return false;
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

    private string BuildStatsJson()
    {
        return "{\"received\":" + received.ToString(CultureInfo.InvariantCulture)
            + ",\"parseErrors\":" + parseErrors.ToString(CultureInfo.InvariantCulture)
            + ",\"lastReceivedAt\":" + Quote(lastReceivedAt) + "}";
    }

    // §4.3 任意フィールド(range / default / group)は値がないときキーごと省略し、null を書かない
    private bool TryBuildManifestJson(out string json)
    {
        json = null;
        if (!TryGetValidatedAsset(out var asset))
        {
            return false;
        }

        var sb = new StringBuilder();
        sb.Append("{\"version\":1,\"projectId\":").Append(Quote(asset.projectId)).Append(",\"entries\":[");

        for (var i = 0; i < asset.entries.Count; i++)
        {
            var entry = asset.entries[i];

            if (i > 0)
            {
                sb.Append(',');
            }

            sb.Append("{\"address\":").Append(Quote(entry.address));
            sb.Append(",\"label\":").Append(Quote(ApplyCharacterName(entry.label)));
            sb.Append(",\"type\":").Append(Quote(TypeName(entry.type)));
            sb.Append(",\"widget\":").Append(Quote(WidgetName(entry.widget)));

            if (entry.hasRange)
            {
                sb.Append(",\"range\":[").Append(FormatNumber(entry.rangeMin))
                    .Append(',').Append(FormatNumber(entry.rangeMax)).Append(']');
            }

            if (stagingEngine.TryGetCurrentValue(entry.address, out var current))
            {
                sb.Append(",\"default\":").Append(current.ToJsonLiteral()); // 中核の現在値を default として埋める(§2)
            }

            if (!string.IsNullOrEmpty(entry.group))
            {
                sb.Append(",\"group\":").Append(Quote(entry.group));
            }

            if (entry.hasOptions)
            {
                sb.Append(",\"options\":[");
                for (var optionIndex = 0; optionIndex < entry.options.Count; optionIndex++)
                {
                    if (optionIndex > 0)
                    {
                        sb.Append(',');
                    }

                    sb.Append(Quote(entry.options[optionIndex]));
                }

                sb.Append(']');
            }

            if (!string.IsNullOrEmpty(entry.optionsRef))
            {
                sb.Append(",\"optionsRef\":").Append(Quote(entry.optionsRef));
            }

            if (!string.IsNullOrEmpty(entry.pattern))
            {
                sb.Append(",\"pattern\":").Append(Quote(entry.pattern));
            }

            sb.Append('}');
        }

        sb.Append(']');

        if (asset.optionLists.Count > 0)
        {
            sb.Append(",\"optionLists\":{");
            for (var listIndex = 0; listIndex < asset.optionLists.Count; listIndex++)
            {
                if (listIndex > 0)
                {
                    sb.Append(',');
                }

                var optionList = asset.optionLists[listIndex];
                sb.Append(Quote(optionList.key)).Append(": [");
                for (var optionIndex = 0; optionIndex < optionList.values.Count; optionIndex++)
                {
                    if (optionIndex > 0)
                    {
                        sb.Append(',');
                    }

                    sb.Append(Quote(optionList.values[optionIndex]));
                }

                sb.Append(']');
            }

            sb.Append('}');
        }

        sb.Append('}');
        json = sb.ToString();
        return true;
    }

    private bool TryGetValidatedAsset(out OscSurfaceManifestAsset asset)
    {
        asset = manifestAsset;
        if (asset == null)
        {
            Debug.LogError("OscSurfaceBridge requires an OscSurfaceManifestAsset.", this);
            return false;
        }

        if (string.IsNullOrWhiteSpace(asset.projectId))
        {
            Debug.LogError("OscSurfaceManifestAsset projectId must not be empty.", asset);
            return false;
        }

        if (asset.entries == null)
        {
            Debug.LogError("OscSurfaceManifestAsset entries must not be null.", asset);
            return false;
        }

        if (asset.optionLists == null)
        {
            Debug.LogError("OscSurfaceManifestAsset optionLists must not be null.", asset);
            return false;
        }

        var optionListKeys = new HashSet<string>();
        foreach (var optionList in asset.optionLists)
        {
            if (optionList == null || string.IsNullOrEmpty(optionList.key))
            {
                Debug.LogError("OscSurfaceManifestAsset contains an option list with an empty key.", asset);
                return false;
            }

            if (!optionListKeys.Add(optionList.key))
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset contains duplicate option list key \"" + optionList.key + "\".", asset);
                return false;
            }

            if (optionList.values == null || ContainsNull(optionList.values))
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset option list \"" + optionList.key + "\" contains null values.", asset);
                return false;
            }
        }

        foreach (var entry in asset.entries)
        {
            if (entry == null || string.IsNullOrWhiteSpace(entry.address))
            {
                Debug.LogError("OscSurfaceManifestAsset contains an entry with an empty address.", asset);
                return false;
            }

            // 壊れた YAML などで enum に範囲外の値が入っていたら送信を中止する(§4.3)
            if (!Enum.IsDefined(typeof(OscSurfaceManifestAsset.EntryType), entry.type)
                || !Enum.IsDefined(typeof(OscSurfaceManifestAsset.WidgetType), entry.widget)
                || !Enum.IsDefined(typeof(OscSurfaceManifestAsset.DefaultKind), entry.defaultKind))
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset entry \"" + entry.address + "\" has an undefined enum value.", asset);
                return false;
            }

            if (entry.widget == OscSurfaceManifestAsset.WidgetType.Input
                && entry.type != OscSurfaceManifestAsset.EntryType.String
                && entry.type != OscSurfaceManifestAsset.EntryType.Int
                && entry.type != OscSurfaceManifestAsset.EntryType.Float)
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset input entry \"" + entry.address + "\" must use string, int, or float type.",
                    asset);
                return false;
            }

            if (entry.widget == OscSurfaceManifestAsset.WidgetType.Select
                && entry.type != OscSurfaceManifestAsset.EntryType.String)
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset select entry \"" + entry.address + "\" must use string type.", asset);
                return false;
            }

            var hasOptionsRef = !string.IsNullOrEmpty(entry.optionsRef);
            if (entry.widget == OscSurfaceManifestAsset.WidgetType.Select
                && entry.hasOptions == hasOptionsRef)
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset select entry \"" + entry.address
                    + "\" must define exactly one of options or optionsRef.", asset);
                return false;
            }

            if (entry.hasOptions && (entry.options == null || ContainsNull(entry.options)))
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset entry \"" + entry.address + "\" options must not contain null values.", asset);
                return false;
            }

            if (hasOptionsRef && !optionListKeys.Contains(entry.optionsRef))
            {
                Debug.LogError(
                    "OscSurfaceManifestAsset entry \"" + entry.address + "\" references missing option list \""
                    + entry.optionsRef + "\".", asset);
                return false;
            }

            if (!string.IsNullOrEmpty(entry.pattern))
            {
                if (entry.type != OscSurfaceManifestAsset.EntryType.String)
                {
                    Debug.LogError(
                        "OscSurfaceManifestAsset entry \"" + entry.address + "\" pattern requires string type.", asset);
                    return false;
                }

                try
                {
                    new Regex(entry.pattern);
                }
                catch (ArgumentException exception)
                {
                    Debug.LogError(
                        "OscSurfaceManifestAsset entry \"" + entry.address + "\" has invalid pattern \""
                        + entry.pattern + "\": " + exception.Message, asset);
                    return false;
                }
            }
        }

        return true;
    }

    private static bool ContainsNull(List<string> values)
    {
        foreach (var value in values)
        {
            if (value == null)
            {
                return true;
            }
        }

        return false;
    }

    private static bool TryGetDefaultValue(OscSurfaceManifestAsset.Entry entry, out object value)
    {
        switch (entry.defaultKind)
        {
            case OscSurfaceManifestAsset.DefaultKind.Int: value = entry.defaultInt; return true;
            case OscSurfaceManifestAsset.DefaultKind.Float: value = entry.defaultFloat; return true;
            case OscSurfaceManifestAsset.DefaultKind.String: value = entry.defaultString; return true;
            case OscSurfaceManifestAsset.DefaultKind.Bool: value = entry.defaultBool; return true;
            default: value = null; return false;
        }
    }

    private static string TypeName(OscSurfaceManifestAsset.EntryType type)
    {
        switch (type)
        {
            case OscSurfaceManifestAsset.EntryType.Int: return "i";
            case OscSurfaceManifestAsset.EntryType.Float: return "f";
            case OscSurfaceManifestAsset.EntryType.String: return "s";
            case OscSurfaceManifestAsset.EntryType.Blob: return "b";
            case OscSurfaceManifestAsset.EntryType.Bool: return "bool";
            default: return "";
        }
    }

    private static string WidgetName(OscSurfaceManifestAsset.WidgetType widget)
    {
        switch (widget)
        {
            case OscSurfaceManifestAsset.WidgetType.Fader: return "fader";
            case OscSurfaceManifestAsset.WidgetType.Button: return "button";
            case OscSurfaceManifestAsset.WidgetType.Toggle: return "toggle";
            case OscSurfaceManifestAsset.WidgetType.Xy: return "xy";
            case OscSurfaceManifestAsset.WidgetType.Text: return "text";
            case OscSurfaceManifestAsset.WidgetType.Input: return "input";
            case OscSurfaceManifestAsset.WidgetType.Select: return "select";
            default: return "";
        }
    }

    private object ResolveInitial(object initial)
    {
        return initial is string text ? ApplyCharacterName(text) : initial;
    }

    private string ApplyCharacterName(string template)
    {
        return template.Replace("{characterName}", characterName ?? string.Empty);
    }

    private static string NowIso8601()
    {
        return DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
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
            var path = Path.Combine(Application.dataPath, "OscSurfaceBridge/Tests/Editor/staging-cases.json");
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

### A.3 本文 §4 との対応と読み替え表

| 本文 §4 の操作・前提 | uOSC(A.2)での実現 | 別ライブラリへの読み替え観点 |
|---|---|---|
| 受信ハンドラの登録(`on datagramReceived` → `handlePacket`) | `OscSurfaceBridge.cs` の `uOscServer.onDataReceived.AddListener(OnDataReceived)` | 受信コールバック(またはポーリング)の登録 API に置き換える |
| bundle の再帰展開(§4.1 骨格の手順 2) | uOSC が自動展開し、展開後メッセージ単位でコールバックが呼ばれるため bundle 分岐は書いていない | 自動展開しないライブラリでは §4.1 の骨格どおり再帰展開を自前で書く |
| マニフェスト定義の読み込み | `OscSurfaceBridge.cs` が `OscSurfaceManifestAsset.cs` の ScriptableObject を検証して JSON 化する | 設定アセットを読み込み、本文 §2 の JSON フィールドへシリアライズする |
| ステージング宣言の検証・値保持・適用反応 | `OscSurfaceStaging.asmdef` の純 C# `OscSurfaceStaging.cs` が担当し、OSC ライブラリを知らない | Unity/OSC アダプタから分離した純 C# の状態機械として実装する |
| ステージング反応の呼び出し | `OscSurfaceBridge.cs` が Unity のメインスレッドで中核を呼び、適用 `event` を購読する | 受信スレッドから直接 UI やアプリ状態を変更せず、ホストのメインスレッドへディスパッチする |
| `input` / `select` の宣言 | `WidgetType.Input` / `WidgetType.Select` と `Entry` の `hasOptions`・`options`・`optionsRef`・`pattern` を使用する | `input` は `s` / `i` / `f`、`select` は `s` に制限し、選択肢はインラインまたは共有参照の一方だけを出力する |
| 共有選択肢辞書 | `OscSurfaceManifestAsset.optionLists` の `OptionList(key, values)` をトップレベルの `optionLists` オブジェクトへ変換する | 辞書のキー重複・空キー・参照先不在を送信前に検証する |
| `pattern` の検証 | `OscSurfaceBridge.cs` が文字列型であることと `System.Text.RegularExpressions.Regex` のコンパイル可否を検証する | TS の `RegExp` と Python の `re` に共通する基本構文に限定する |
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
