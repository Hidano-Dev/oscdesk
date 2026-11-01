# UNITY_PROTOCOL.md - Unity との OSC 契約

> OscDesk のブリッジと Unity(または同じ契約を実装した任意の OSC 受信アプリ)の間の取り決めと、実 Unity の接続手順。仕様(§1〜§4)は特定の OSC ライブラリに依存せず、OSC 1.0 標準の機能(基本型タグ・bundle・timetag)だけで成立させる。受け口の実装の詳細と特定ライブラリとの差異は付録 A にだけ置く。
>
> **セキュリティ前提**: この経路に認証・暗号化はない。信頼できる LAN 内でだけ使い、インターネットや信頼できないネットワークへ公開してはならない。

## 前提

- **操作対象の定義は OscDesk が持つ**。どのアドレスにどの型の値を送るかは、OscDesk 側のサーフェス定義 JSON(`protocol/surface-definition.schema.json`、DESIGN.md D-043〜D-044)で決める
- **UI の設計図はターゲット(Unity)から Sync で受け取る方針**(DESIGN.md D-101。D-051 の「Unity は自分の構造を申告しない」を覆した)。設計図はコントローラーの UI を作るためのテンプレートで、OscDesk(サーバー)が PC ごとに取得元の PC 名付きで保持し、ターゲットとの紐づけは切り離す(ある PC の設計図の UI から全ターゲットや複数のターゲットへ送れる)。照合の対象ではないので、誤接続ガードや世代照合は持たない。**Sync のうちブリッジ側の受信・保持と、送るデータの形は §1 の「設計図の Sync」で定めた(D-104)。Unity 側の送信(Catalog)は未実装**で、設計図とサーフェス定義の関係、実行時の登録・削除は後続の Issue で決めて本書に追記する。撤去したマニフェストの経路(D-051)は戻さない
- **値の正は OscDesk(ブリッジ)が持つ**。ブリッジは定義の `kind: state` の値ごとに「狙いの値」を保持し、Unity の再起動・再接続のときに送り直す(D-045)。Unity のエコーは「届いた」確認であり、保持値を書き換えない
- **現行の Unity の仕事は「アドレスと値を受け取り、同じアドレスへエコーを返す」こと**(と §1 の pong、§2 の任意の一覧の応答)。Sync を実装したらそれが加わる。受け取った値でアプリの状態を変える処理は、汎用レシーバ(§5)の UnityEvent か、各アプリのスクリプトで書く
- トランスポートは UDP。アドレス・ポートは実行時設定(`config/oscdesk.config.json`)で与える。案件固有の Unity 構成の制御(システム構成の切り替えなど)はフォークで実装し、本リポジトリの契約には含めない

## 1. 到達性(`/sys/ping` / `/sys/pong`)

| 方向 | アドレス | 引数 | 用途 |
|---|---|---|---|
| OscDesk → Unity | `/sys/ping` | `int seq` | 到達性確認。宛先ごとに 2 秒間隔で送る |
| Unity → OscDesk | `/sys/pong` | `int seq` | `/sys/ping` を受けたら **同じ seq を即時** 返す |

- ブリッジは宛先ごとに RTT、連続喪失数、最後に採用した pong の `seq` を持つ。未応答の ping は常に最大 1 件で、次の ping の時点で未応答なら喪失として連続喪失数を `+1` する
- pong は保持中の `seq` と一致し、かつ**その宛先のホストから届いたものだけ**を採用する。未知・期限切れ・重複の `seq`、設定にないホストからの pong は捨てる。`seq` は全宛先で一意なので、複数台が同じ受信ポートへ返しても出所を取り違えない
- Unity 側の責務は受けた `seq` をそのまま返すことだけ。喪失判定・RTT 計測・再送はブリッジの責務である。「即時」はフレーム処理の次の送信機会で十分(遅れは RTT として観測されるだけ)
- **喪失→回復は Unity の再起動の合図として使われる**(§3)。pong を返さない実装では保持値の自動再送が働かない

### `/sys/stats`(任意)

`/sys/stats/request`(引数なし)に `/sys/stats`(`string json`、`{"received":N,"parseErrors":N,"lastReceivedAt":"ISO-8601"}`)を返してよい。ブリッジは送らず、受け取っても使わない。手動の実装確認用であり、実装しなくても契約違反ではない。

### 設計図の Sync(任意。D-104)

ターゲットが UI の設計図(何があるか。アドレス・種別・型・制約・表示ヒント)をコントローラーへ送る契約。実装しなくても契約違反ではなく、送らないターゲットは設計図が空の PC として扱われる。OSC への書き方は通信アダプタの 1 つで、設計図の中身の形(`packages/shared/src/catalog.ts`)は OSC に寄せない。

| 方向 | アドレス | 引数 | 用途 |
|---|---|---|---|
| Unity → OscDesk | `/sys/catalog/begin` | `string PC名, int 件数` | 全体を送り直す始まり。PC 名は 64 文字まで |
| Unity → OscDesk | `/sys/catalog/add` | `string アドレス, string kind, string type, [string キー, 値]…` | 1 項目 1 メッセージ。値は `i` / `f` / `s` |
| Unity → OscDesk | `/sys/catalog/remove` | `string アドレス` | 削除通知。保持中の設計図から外す |
| Unity → OscDesk | `/sys/catalog/end` | `int 件数, int CRC32` | 全体の終わり。受け取った内容と照合する |
| Unity → OscDesk | `/sys/catalog/digest` | `int 件数, int CRC32` | `begin` を伴わない `add` / `remove` の後に、その時点の要約値を送る |
| OscDesk → Unity | `/sys/catalog/request` | なし | Sync ボタン。ターゲットは `begin` … `end` で全体を送り直す |

- **PC は送信元ホストで区別する**。ブリッジは PC ごとに名前(`begin` の引数。無ければホスト)・最終受信時刻・内容・照合結果を持ち、ターゲット(宛先)との紐づけは持たない。どの PC の設計図の UI からも任意の送り先へ送れる
- `begin` から `end` までに受けた `add` が、その PC の設計図の**全量**になる(それまでの内容と置き換える)。`begin` の外の `add` は 1 項目の追加・置き換え(アドレスが同じなら上書き)、`remove` は削除
- `kind` は `state` / `trigger` を想定し、`type` は `f` / `i` / `s` / `bool` を想定するが、**知らない値も捨てずに保持する**(後から足せるように)。キーと値の組は `min` / `max` / `step` / `widget` / `label` / `options` など(サーフェス定義の `range` / `step` / `options` / `widget` / `label` に対応。D-103)。**知らないキーは無視する**。同じキーを繰り返してよく(`options` は 1 回に 1 つ)、順序は送った順。1 項目は 32 組まで、文字列は 1024 文字まで、1 項目を JSON にして 8 KiB まで
- 1 PC あたり 4096 項目、PC は 64 台までを超えるものは受けずに警告する。全 PC の項目の大きさの合計も 8 MiB まで(認証が無い LAN で、メモリを際限なく使わせないため)
- 全体が 60 KiB を超えるときは、複数の bundle(または複数のデータグラム)に分けてよい。`begin` / `end` で囲む
- **要約値(件数と CRC32)で照合する**。1 通ごとのアプリ側のチェックサムは付けない(1 通ごとの検査は UDP が行い、すり抜けても要約値で気づく)。受け側は受け取った内容から同じ計算をし、食い違えば `catalog` フレームの `verified` を `false` にして notice(`catalog-mismatch`)を出す。欠落・内容の食い違い・データ化けをまとめて検出する。受け取れた分は捨てずに持つ
- **要約値の計算**: 設計図の項目を次の正規形のテキストにし、UTF-8 バイト列の CRC-32(IEEE 802.3、多項式 0xEDB88320。zlib や .NET の一般的な実装と同じ)を**符号付き int32**で `i` に載せる(例: `0xCBF43926` は `-873187034`)。件数は項目の数
  - アドレスの UTF-8 バイト順に並べ、1 項目を 1 行(末尾は LF)にする。同じアドレスは 1 つだけ
  - 行は `アドレス TAB kind TAB type` に、**キーの UTF-8 バイト順**(同じキーは送られた順)に並べた `キー=型:値` を TAB で続ける
  - 値: `i` は 10 進の整数、`f` は float32 のビット列を 8 桁の小文字 16 進(10 進の最短表記は言語ごとに違うため)、`s` は文字列。アドレス・kind・type・文字列は `%` → `%25`、TAB → `%09`、LF → `%0A`、CR → `%0D` に置き換える(それ以外はそのまま)
  - PC 名は含めない。共通の見本は `protocol/catalog-samples.json`(TS の単体テストで確かめ、C# の実装も同じ見本で確かめる)
- 受け口が `/sys/catalog/request` に応えない古い実装・他のアプリでも害は無い(ブリッジは要求を投げるだけで、応答を待たない)。ブリッジは UI から `/sys/*` への送信を拒否するが、`catalogRequest` フレームからだけは `/sys/catalog/request` を全宛先へ送る
- D-053 の「`/sys/*` を増やさない」は一覧の要求・応答についての判断で、Sync は設計図の受け渡しとして `/sys/catalog/*` を予約アドレスに加える(DESIGN.md D-104)

### `/sys/ignored` と `/sys/failed`(任意。D-105)

エコーは「パケットが届いた」確認で、行の有無や処理の成否を表さない。コントローラーが送り先ごとに「届いて処理された / 届いたが対象がいない / 届いたが処理できなかった」を見分けられるよう、受け口は処理しなかったものを次の 2 つで知らせてよい(Unity → OscDesk、`Reply Host : Reply Port` 宛て)。

| アドレス | 引数 | 意味 |
|---|---|---|
| `/sys/ignored` | `s` アドレス × N | 振り分け先(行)が無かったアドレス。同じアドレスは 1 回 |
| `/sys/failed` | (`s` アドレス, `s` 理由) × N 組 | 行はあるのに処理できなかったもの。理由は `type mismatch`(型の不一致)/ `record mismatch`(Record の形の不一致)/ `exception`(受け手の例外) |

- **順序**: そのデータグラムのエコーをすべて送った後に送る。bundle は 1 個につき `/sys/ignored`・`/sys/failed` を最大 1 メッセージずつにまとめる(64 件の bundle で 64 データグラムを返さない)
- **上限**: 認証の無い LAN で受信 1 回が増幅して返らないよう、`/sys/ignored` は 32 アドレス、`/sys/failed` は 16 組、1 つの文字列は 128 文字(UTF-16)までとし、超えた分は黙って切り捨てる。切り捨てても「黙っている行がある」ことは伝わる
- **`/sys/*` は対象外**: `/sys/` で始まる受信は報告しない
- **任意**: 返さない受け口(古い `OscReceiver`・他のアプリ)があるので、コントローラーはこの 2 つが無いことを「処理された」と読んでよい。ブリッジは `/sys/*` を UI へ流さず、受け取っても今は使わない(送り先の表示は別 Issue)
- 実装: `OscReceiver` の `Report Outcomes`(既定オン。`ReportOutcomes`)。mock-unity は `--known-address <アドレス>`(これ以外を ignored にする。複数可)と `--failing <アドレス>=<理由>` で再現する

### その他の `/sys/*`

`/sys/` で始まるアドレスは予約である。Unity は上記以外の `/sys/*`(`/sys/catalog/*` を含む)を受けても、定められた応答以外は返さず、エコーも返さない。ブリッジは UI から `/sys/*` と `/oscdesk/*` への送信を拒否し、Unity から届いた `/sys/*` を生の OSC として UI へ流さない(`/sys/catalog/*` は設計図として受けて `catalog` フレームにする)(撤去前の Unity が `/sys/manifest` などを送ってきても捨てるだけで害はない)。

## 2. 値の送受信とエコーバック

1. UI の操作(または保持値の再送)で、ブリッジが定義のアドレスへ OSC を送る
2. Unity は値を受け取り、**同一アドレスへ受信した引数をそのまま**エコーバックする(真偽値は §4 のとおり `i` の 0/1)
3. ブリッジはエコーを UI へ流す。UI はエコーで表示を揃え、アクション(まとめ送り)の到達を確認する

- エコーは、Unity が受け取ったアドレスを自分で処理するかどうかに関わらず返す(処理する行が無い・型が合わないときも返す)。エコーが無いと、UI はまとめ送りを「確認できませんでした」と報告する
- 購読者(アプリ側の処理)の例外でエコーを止めない。先にエコーを返し、その後に処理するのが安全である
- `trigger`(きっかけ)のパラメータもエコーを返す。UI は値を問わず到着だけを見る(Unity がトリガーを戻して 0 を返しても未達にならない)
- Unity が自発的に値を送ってもよいが、ブリッジは保持値を書き換えない。保持値と食い違うエコーには警告ログが 1 回出る(同じアドレスは一致に戻るまで繰り返さない)。操作直後 1 秒以内の遅れたエコーは食い違いとして扱わない
- **同じ値が何度届いても結果が同じになるように処理する**(冪等)。保持値の再送で、既に入っている値がもう一度届くことがある

### bundle(まとめ送り)

UI のアクション(定義の `actions`、D-050)は、複数のメッセージを即時タイムタグの OSC bundle 1 個(1 データグラム)で送る。Unity は bundle を展開し、**中のメッセージを順に** 通常のメッセージとして処理・エコーする。timetag による遅延実行は要求しない(受信後すぐ処理してよい)。1 bundle は最大 512 メッセージ、エンコード後 60 KiB 以内(ブリッジが送信前に検査する)。

### 型

| 定義の `type` | OSC 型タグ | 備考 |
|---|---|---|
| `f` | `f`(float32) | |
| `i` | `i`(int32) | −2147483648〜2147483647 |
| `s` | `s`(string) | UTF-8 |
| `bool` | `i` の 0/1 | `T` / `F` タグは使わない |

blob(`b`)は UI の値として扱わない。未対応の型タグを受けた引数は推測で処理せず、捨ててよい。

### 定義が宣言したアドレスへの一覧の応答(任意)

Unity が実行時にしか知らない名前(例: セグメント名)を UI の選択肢にしたいときは、サーフェス定義の `s` の `state` パラメータに `optionsFrom: { address, request? }` を書く(DESIGN.md D-053 / D-054)。Unity はこの契約に応えなくてもよく、応えない場合は定義の静的な `options` だけが選択肢になる。

定義の版 2(D-117)では、本体は `optionsFrom: { list: "<一覧 id>" }`・`keysFrom: { list, ... }` と一覧の id で指し、アドレスは OSC の結び付け `bindings.osc.lists: [{ id, address, request? }]` に置く。以下の `optionsFrom.address` / `optionsFrom.request`・`keysFrom.address` / `keysFrom.request` は、その一覧の結び付けの `address` / `request` と読み替える(Unity とのやり取りは変わらない。版 1 の書き方の定義はブリッジが版 2 へ移す)。

| 方向 | アドレス | 引数 | 用途 |
|---|---|---|---|
| OscDesk → Unity | `optionsFrom.request`(定義に書いたとき) | なし | 一覧の要求 |
| Unity → OscDesk | `optionsFrom.address` | `s` を N 個(0 個も可) | 一覧そのもの。1 メッセージで全量 |

- `request` を受けたら、`address` へ一覧を **1 メッセージ**で返す。名前を `s` 引数として並べる。名前が 1 つも無ければ引数 0 個で返す(空の一覧)。`request` へのエコーは §2 のとおり返してよい(ブリッジは UI へ流さない)
- 一覧が変わったとき(セグメントの追加・削除など)は、要求を待たずに `address` へ送ってよい。ブリッジはいつ届いても受け、その台の一覧として**置き換える**
- `s` 以外の型の引数を含む一覧は捨てられる。一覧は 1 データグラムに収まる大きさまで(bundle と同じ 60 KiB を目安)
- `address` と `request` は予約外の通常アドレスで、どのパラメータのアドレスとも重ならず、`request` は一覧のアドレスとも重ならない(定義の検証が保証する)。`/sys/*` は増えない
- ブリッジが要求を送るのは、その台が初めて pong を返したとき、喪失から回復したとき、到達可能な状態で新しい一覧のアドレスを持つ定義を採用したとき、UI の「一覧を更新」のとき。複数台構成では各台の一覧を別々に保持し、和集合が UI の選択肢になる(§4)
- 一覧は選択肢を増やすだけで、定義も保持値も変えない。一覧に無い名前が送られてくることもある(他の台にだけある名前、一覧から消えた名前の再送)。そのときも受けてエコーを返し、自分に無い名前は無視するなど、害の無い扱いにする

## 3. 値の保持と再送

ブリッジは定義の `kind: state` のパラメータについて、最後に UI が操作した値(未操作なら定義の `default`)を保持し、次の契機で Unity へ送り直す。`kind: trigger` と `standalone: false` のパラメータは保持も再送もしない(再送でボタンが押し直されることはない)。ただし生成担当の命令(`/<パッケージ名>/<対象名>/spawn ,s 名前`)で「生成されて、まだ消されていないもの」の一覧は例外で、ブリッジが PC ごとに記録し、その PC の起動の合図と「記録に合わせる」で生成し直す(下の「生成の記録」。DESIGN.md D-115)。

| 契機 | 送り先 | 送る値 |
|---|---|---|
| その宛先が初めて pong を返した | その宛先だけ | 保持値すべて |
| その宛先が喪失から回復した(Unity の再起動・ネットワーク断の回復) | その宛先だけ | 保持値すべて |
| 定義を採用した | その時点で到達可能な宛先 | 採用で値が決まり直したアドレスだけ |
| UI の「再送」操作 | 指定した宛先、または全宛先 | 保持値すべて(到達不能でも送る) |
| その PC から起動の合図(Sync の要求に答えたのでない `/sys/catalog/begin`)が届いた | その PC だけ | 生成の記録のうちその PC へ送ったもの → 保持値すべて |
| UI の「記録に合わせる」 | 指定した宛先の PC だけ | 余分なものの `destroy` → 欠けているものの `spawn` → 保持値すべて |

- **ping 間隔(2 秒)より速い再起動は、pong だけでは検知できない**。起動時に設計図を全体で送る受け口(§1「設計図の Sync」)なら、その `begin` が起動の合図になり、速い再起動でも値と生成したものが戻る。送らない受け口で値が戻らない場合は、UI の「再送」を押す
- Unity 側は「起動直後は既定値で動き、OscDesk からの再送で狙いの値に揃う」前提で作る。Unity が起動時に自分の値を OscDesk へ申告する仕組みは無い
- **保持値はブリッジの再起動をまたいで残る**(DESIGN.md D-058)。ブリッジを再起動すると、各宛先の初回の到達(表の 1 行目)で、再起動前に操作された値が送られる(定義の `default` には戻らない)。そのため受け口が再送をそのまま適用する作りでも、ブリッジの再起動で実機が既定値へ戻ることはない。定義を変えて id・型・値域が合わなくなったパラメータだけが `default` から始まる
- **プロジェクトファイルを読み込んだ後は、UI の「Unity へ送る」(全宛先への再送)まで自動の再送をしない**(DESIGN.md D-090)。読み込みは OscDesk の画面と保持値を置き換えるだけで、その間に Unity を再起動・再接続しても上の表の自動の契機では何も届かない(操作した値は従来どおり届く)。Unity 側の契約(受けてエコーを返す)は変わらない

### 生成の記録(HID-385、DESIGN.md D-115)

生成担当(§5「実行時の受け手の登録」の `OscSpawner`)で実行中に生成したもの(キャラクターの追加など、消すまで残り続けるもの)は、ブリッジが「今あるべき状態」として送り先の PC ごとに記録し、再起動した PC へ復元する。複数のターゲットに主従は無く、「ほかの PC に合わせる」のではなく「コントローラーの記録に合わせる」。

- **生成担当の命令の見分け方**: サーフェス定義のパラメータのうち、アドレスが `/<パッケージ名>/<対象名>/spawn` か `/<パッケージ名>/<対象名>/destroy` で、`type: "s"` の `trigger` のもの。生成したものは `/<パッケージ名>/<名前>/…` で受ける前提(受け口の生成担当の規約)
- **名前はブリッジが振る**: `spawn` の値(例 `spark`)に、全 PC の設計図と送ったがまだ設計図に載っていない名前を見て、どの PC でも使われていない番号を付ける(`spark1`、埋まっていれば `spark2`)。受け口では番号を振らない。値の末尾がすでに数字なら(`spark3`)そのまま送る
- **記録を外すとき**: OscDesk が `destroy` を送った PC、その PC から設計図の削除通知(`/sys/catalog/remove` で `/<パッケージ名>/<名前>/…`)が来たとき(シーンの切り替えなど、命令以外で消えた場合も含む)、その PC を送り先の一覧から外したとき。クラッシュでは削除通知が来ないので記録は残るが、止まっている間に同じものを送ったほかの PC から削除通知が来ていれば、意図して消されたとみなし、起動して戻ったときに復元せず記録から外す(ほかの PC は基準ではなく証拠として使う)
- **起動の合図**: ブリッジは Sync の要求を送ってから 5 秒以内でない `/sys/catalog/begin` を、その PC が起動した合図として扱う。受け口は起動時(Play の開始)に設計図を全体で送る(HID-379)。生成したものは設計図に載せ、消したら `/sys/catalog/remove` を送る(Registry に従う Catalog がそうする)
- **受け口が気にすること**: 起動直後に `spawn` がまとめて届く。生成し直しは名前を指定した `spawn` で、受け口から見るとふだんの生成と同じ。名前がすでにある(`name in use`)ときは `/sys/failed` で知らせる。UI の「記録に合わせる」で、その PC の余分なもの(設計図にある、生成担当の振る形の名前で、記録に無いもの)の `destroy` と欠けているものの `spawn` が届く
- **プロジェクトファイル**を読み込んだ後は、生成の記録も読み込んだ内容に置き換わり、UI の「Unity へ送る」まで生成しない(D-090 と同じ)
## 4. 複数台構成(冗長構成)

`config` の `unity` に `secondary` を足すと、主系に加えて副系の Unity へ同じ操作を送る(D-046)。

```json
"unity": {
  "name": "unity", "host": "192.168.1.20", "sendPort": 7090,
  "secondary": [{ "name": "backup", "host": "192.168.1.21", "sendPort": 7090 }]
}
```

- **全台を同時に動かす**。UI の操作・まとめ送りは全宛先へ送られる(bundle は主系への送信に失敗したら副系へも送らない)
- **エコーの表示は主系だけ**。副系のエコーは UI へ流さず、保持値との食い違いの警告にだけ使う。副系の到達性は UI の「Unity 宛先」のバッジで見える
- 副系の Unity も返信先は同じブリッジの受信ポート(既定 7091)でよい。pong は宛先ごとに一意な `seq` とホストで区別される
- **一覧(§2「定義が宣言したアドレスへの一覧の応答」)は副系からも受ける**。台ごとに保持し、主系の一覧の順に副系にしか無い名前を config の順で足した和集合が選択肢になる。到達不能になった台の一覧は残る。同じ PC に主系と副系を立てる検証では、送信元ポートが `sendPort` と一致しない受け口(`OscReceiver` を含む)の一覧は主系のものとして扱われる(エコーと同じ制限。DESIGN.md D-046 / D-055)
- **クラッシュ・再起動した 1 台は、その台だけへの再送で追いつく**。pong の回復で自動的に再送されるほか、UI の宛先ごとの「再送」で手動でも送れる。他の台へは送らない
- 宛先の `name` は英数字で始まる英数字・`_`・`-` の 32 文字以内で、重複できない

### 宛先パネルで送り先を変える(DESIGN.md D-078 / D-079 / D-086)

UI の右側の宛先パネルで、送り先を実行中に LAN の端末から選び直せる。選択を保存している間は、`config` の `unity`(主系 + 副系)より選択が優先する。Unity 側の契約(§1〜§3)は変わらない。

- **個別の端末**: チェックした端末ごとに 1 宛先になる。`config` にあるホストはその宛先(名前・`sendPort`)のまま、それ以外は `ip-192-168-1-30` のような名前で `unity.sendPort` へ送る。新しく加わった宛先は、初めて pong を返したときに保持値をすべて受け取る(§3 の 1 行目)
- **全てのデバイス**: そのネットワークのブロードキャストアドレス(例 `192.168.1.255`)へ、`unity.sendPort` で送る。ping・操作・まとめ送りはブロードキャストの 1 データグラムで全台に届く
  - **互換性ノート**: 受け口の UDP ソケットはブロードキャストを受けられる形で待ち受ける(`0.0.0.0` に bind する。§5 の `OscReceiver` はこうなっている)。特定の IP に bind すると、OS によってはブロードキャストが届かない。pong とエコーは従来どおりブリッジの受信ポートへユニキャストで返す
  - 1 回の ping に複数台が pong を返す。ブリッジは「その周期に 1 台でも答えたか」で到達性を出し、**初めて答えた台・周期を取りこぼしてから戻った台には、その台のアドレスへ直接(ユニキャストで)保持値を再送する**。他の台へは送らない
  - pong を返した台のエコーは主系のエコーとして UI に届く(同じ値が台の数だけ届く)。pong を返していないホストからの OSC は Unity とみなさない(同じ LAN の OSC ネイティブ UI の端末と区別するため)
  - ブロードキャストは同じネットワーク(ルータの内側)にしか届かない。ルータやスイッチの設定でブロードキャストを止めているネットワークでは使えないので、個別の端末を選ぶ
- 認証はない。走査とブロードキャストは信頼できる LAN の中だけで使い、インターネットや信頼できないネットワークに公開しない

## 5. 汎用レシーバ(OscReceiver)

Unity 側の受け口として、本リポジトリは UPM パッケージ `com.hidano.oscdesk`(本体は `OscSurface/Packages/com.hidano.oscdesk/`、HID-164・D-096)を提供する。§1〜§2 の Unity 側の責務(pong・エコー・stats)をすべて持ち、受けたアドレスを UnityEvent に振り分ける。自前スクリプトの public 関数をインスペクタで登録するだけで、特定の OSC が来たときに実行できる。

### 導入

Unity 6000.0 以降のプロジェクトの `Packages/manifest.json` に、npmjs のスコープ付きレジストリと依存を足す(ファイルを写す必要はない。外部の OSC ライブラリも要らない)。

```json
{
  "dependencies": {
    "com.hidano.oscdesk": "1.0.0"
  },
  "scopedRegistries": [
    {
      "name": "Hidano",
      "url": "https://registry.npmjs.com",
      "scopes": ["com.hidano"]
    }
  ]
}
```

- 既に `com.hidano` のスコープを持つレジストリがあれば、`dependencies` だけ足す
- パッケージの版と、それが対応する本契約の時点はパッケージの `README.md`「版と契約の対応」と `CHANGELOG.md` にある。本契約の Unity 側の振る舞いを互換でなく変えるときは major を上げる(公開の手順は `docs/UPM_PACKAGE.md`)
- 最小の受け口シーンとそれに合うサーフェス定義を、Package Manager の **Samples** の **Minimal Receiver** から取り込める
- 利用側のプロジェクトでパッケージの EditMode テストを走らせるときは、manifest に `"testables": ["com.hidano.oscdesk"]` を足す
- 以前の `OscSurface/Assets/OscReceiver/` を写して使っていた場合は、写したファイルを消してから入れる(同じ名前の asmdef が 2 つあるとコンパイルできない。写した `.meta` の GUID が違えば付けてあるコンポーネントが Missing Script になる。パッケージの `README.md`「ファイルを写して導入していた場合」)

### 使い方

1. 空の GameObject に `OscReceiver` を追加する。`Listen Port` = config の `unity.sendPort`(既定 7090)、`Reply Host` / `Reply Port` = OscDesk ホスト : `bridge.oscListenPort`(既定 `127.0.0.1` : 7091)。外部の OSC ライブラリは要らない(D-095)。スクリプトからは `ListenPort` / `ReplyHost` / `ReplyPort` で読み書きでき、有効な間に変えると待ち受けを開き直す
2. `Bindings` に行を足す。行は「アドレス」「型(Trigger / Int / Float / String / Bool / Record / Strings)」と、型に対応する UnityEvent からなる。イベントに自前スクリプトの public 関数を登録する(Int なら `void F(int)`、引数なしの Trigger なら `void F()`)
3. 任意: 「定義ファイル」に OscDesk のサーフェス定義 JSON(`format: oscdesk-surface`)を設定し、「定義にあって行が無いアドレスの行を追加」を押すと、アドレスの一覧から行を作る(型は定義の `type` / `kind` から提案。`trigger` は Trigger)。定義ファイルはインスペクタでの警告と行の作成に使うだけで、実行時の動作には関与しない
   - 任意: 関数をイベントへ手で登録する代わりに、受ける関数に `[OscAddress("/アドレス")]` を付けて「定義から配線([OscAddress] の関数を登録)」を押すと、行の追加と Record の行の揃えに続けて、`OscReceiver` と同じ GameObject とその子のスクリプトの宣言を、定義にある行のうち型が引数と合う行へ永続リスナー(Runtime Only、Dynamic)として登録する(D-100)。引数は Trigger なら無し、Int / Float / String / Bool なら `int` / `float` / `string` / `bool`、Record なら `OscRecord`、Strings なら `string[]` の 1 個で、関数は public のインスタンスメソッドで戻り値は void。何度押しても同じ関数は足さず、手で登録した関数は消さない。型が合わない・行が無い・定義にない宣言と、宣言も関数も無い行は、インスペクタと Console に警告として出す。別の GameObject の関数やエディタのスクリプトから配線するときは `OscReceiverWiring.WireFromDefinition`(行を足さずに登録だけなら `WireListeners`)を呼び、結果の `OscWiringReport` を見る

4. 任意: 定義の `optionsFrom` で Unity の一覧を使う場合(§2「定義が宣言したアドレスへの一覧の応答」)は、次のとおりにする
   - `optionsFrom.request` のアドレスに **Trigger の行** を足し、イベントにアプリの関数を登録する。関数の中で `OscReceiver.SendStrings(address, values)` を呼び、`optionsFrom.address` へ一覧を返す(例: `receiver.SendStrings("/mb/segments", names)`)。「定義にあって行が無いアドレスの行を追加」は、`request` の行を Trigger で足す
   - 構成が変わったとき(例: セグメントの追加)は、要求を待たずに同じ `SendStrings` を呼んでよい(自発送信)
   - `optionsFrom.address` に行は要らない(Unity が送る側なので、行の不足として警告しない)
   - 一覧が 1 データグラムの上限(60 KiB)を超える、またはアドレスが不正なときは送らずにログへ出し、`SendStrings` は false を返す
   - 名前の整え方と送る契機は補助を使える(D-098)。`OscNameList.Normalize(raw, options)` / `NormalizeSources(sources, options)` が、空白のみ(ゼロ幅スペースなどの見えない書式文字だけの名前を含む)・制御文字・対になっていないサロゲート・固定候補(`options.Reserved`。定義の静的な `options` の「(none)」など)・重複(大文字小文字を区別)を除いて入力順を保ち、除いた理由と目安(`MaxCount` / `MaxLength`)の超過を `OscNameListWarning` で返す。`OscNameList.SequenceEqual` は前回送った一覧との順序込みの比較
   - 部品 `OscNameListPublisher` を使うと、`Address` に `optionsFrom.address` を書き、供給元をコードから `AddSource(() => names)` で渡し、`request` の Trigger の行の On Trigger に `SendNow` を登録するだけで、要求には必ず、`Refresh Interval Seconds`(既定 3 秒)ごとの作り直しでは変わったときだけ一覧を送る。供給元の変化を自分で知ったときは `MarkDirty()` を呼ぶ。中身は `UnityEngine` に依存しない `OscNameListFeed` で、自前の時計・送信関数とも組み合わせられる

   ```csharp
   using OscDesk.Receiver;
   using UnityEngine;

   public sealed class DeviceListSource : MonoBehaviour
   {
       [SerializeField] private OscNameListPublisher publisher; // Address: /app/devices、Reserved Names: (none)

       private void Awake()
       {
           publisher.AddSource(() => Microphone.devices);
       }
   }
   ```

5. 任意: 定義の `records`(個数が実行時に変わる対象。DESIGN.md D-059)を受ける場合は、次のとおりにする(HID-217、D-063)
   - レコードのアドレスに **Record の行** を 1 本置く。キー(メンバー名など)が何個に増えても行は 1 本でよい。`state` と `trigger` のレコードはどちらも Record の行で受ける
   - イベント `On Record` に `void F(OscRecord record)` の形の関数を **Dynamic OscRecord** として登録する。`record.Key` が先頭の `s`(キー)、続く引数がフィールドで、`record.Count` 個ある。取り出しは番号(0 始まり、キーを除いた位置)かフィールド id で、`GetInt` / `GetFloat` / `GetString` / `GetBool`(値が無い・型が合わないと例外)と `TryGetInt` などの `TryGet` 系(false を返す)がある。変換の規則は単一値の行と同じ(Int は整数値の float も、Bool は `i` の 0/1 も受ける)。`GetValue` は受信値をそのまま返す
   - 行の `Record Fields` にフィールド id を定義の `fields` の宣言順に並べる(例: `active` `slot` `ip` `segment`)。id で取り出せるようになり(`record.GetInt("slot")`)、数が合わない受信ではイベントを呼ばない。空にするとフィールドの数を検査せず、番号でだけ取り出せる
   - 「定義にあって行が無いアドレスの行を追加」は、レコードのアドレスに Record の行を `Record Fields` つきで足す。定義のフィールドを足し引きしたあとは「Record の行のフィールド id を定義に合わせる」で既存の行の `Record Fields` を揃える(登録した関数は残る)
   - キーの一覧(`keysFrom`)は `optionsFrom` と同じく、`keysFrom.request` の **Trigger の行** に関数を登録し、その中で既存の `SendStrings(keysFrom.address, keys)` を呼んで返す(例: `receiver.SendStrings("/vp/members/list", memberNames)`)。メンバーが増えたときは要求を待たずに同じ `SendStrings` を呼んでよい。`keysFrom.address` に行は要らない。`optionsFrom` と同じく `OscNameList` / `OscNameListPublisher`(D-098)で整えて送れる(キーの一覧には固定候補を置かないので `Reserved Names` は空にする)
   - `keysFrom.source` が `"ui"` のレコード(D-075。例: MB の接続先のように OscDesk の画面で追加・削除する一覧)は向きが逆で、OscDesk が `keysFrom.address` へ **行の ID の一覧の全量**(`s` を追加順に 0 個以上)を送ってくる。`keysFrom.address` に **Strings の行**(`void F(string[])` を Dynamic で登録)を置いて受け、並び順と削除(一覧から消えた ID)をそこで知る。全部消したときは引数 0 個で届き、空の配列で呼ばれる。一覧は追加・削除のたびと、保持値の再送(初回到達・回復・定義の採用・UI の再送)のたびに、行の値より先に届く。「定義にあって行が無いアドレスの行を追加」はこの Strings の行も足す
   - `"ui"` のレコードの行は、変わらない **ID**(OscDesk が振る UUID の文字列)と、OscDesk の画面で後から変えられる **Name** を持つ(D-087)。行のメッセージは `[s:ID, s:Name, フィールドを宣言順に]` で、Record の行の **Record Row Ids** をオンにして受ける(「定義にあって行が無いアドレスの行を追加」はオンで足す)。`record.Id` が ID、`record.Key` が Name で、フィールドの番号・id での取り出しは従来どおり。Name が変わると同じ ID の行が新しい Name で届き直すので、Unity 側で行を ID で覚えておけば改名をまたいで同じ行と分かる(一覧は ID の並びなので改名では届かない)。Record Row Ids がオフの行(Unity の一覧から行ができるレコード)では `record.Id` は `record.Key` と同じ
   - レコードのフィールドの `optionsFrom.request` も、パラメータの `optionsFrom` と同じく Trigger の行で受ける
   - 値を受けた時点で保持し、トリガで適用する場合は、中核の帳簿を使える(D-099)。`OscKeyedBook<T>` は Unity 側の一覧のレコード用で、キーごとの直近の値・再送の窓の中で届いたキー(`Store` の `inWindow`)・対象が現れるまでの適用待ち(`Await` / `TakeAppeared`)・居ないキーの警告を 1 回に絞る印を持ち、キーは初めて受けた順に返す。`OscUiRowBook<T>` は `"ui"` のレコード用で、`keysFrom.address` の Strings の行で `SetIds`、値の行で `Store(record, value)` を呼ぶと、ID の一覧の順(`Ids`)に値と Name を読め、消えた ID の値は捨て、行 ID ごとの連番(`SerialOf`)は並べ替え・改名・削除をまたいで変わらない。レコードから値を組み立てるときは `OscRecordReader` が、Record Fields があれば id で、無ければ位置で読み、読めなかったフィールドの理由をまとめて返す

   ```csharp
   using OscDesk.Receiver;
   using UnityEngine;

   public sealed class MemberHost : MonoBehaviour
   {
       [SerializeField] private OscReceiver receiver;

       // /vp/member の Record の行(Record Fields: active, slot, ip, segment)に Dynamic で登録する。
       // 属性を付けておくと、インスペクタの「定義から配線」がこの登録を行う(D-100)
       [OscAddress("/vp/member")]
       public void OnMember(OscRecord record)
       {
           var name = record.Key;
           var active = record.GetBool("active");
           var slot = record.GetInt("slot");
           Debug.Log(name + " active=" + active + " slot=" + slot + " ip=" + record.GetString("ip"));
       }

       // /vp/members/request の Trigger の行に登録する
       [OscAddress("/vp/members/request")]
       public void OnMembersRequested()
       {
           receiver.SendStrings("/vp/members/list", new[] { "メンバーA", "メンバーB" });
       }
   }
   ```

### 振る舞い

- **受信**: アドレスが行と完全一致したときだけ、その行のイベントを呼ぶ(記法の文字を含むアドレスは下のパターン)。同じアドレスの行が複数あればすべて呼ぶ。行の無いアドレスはエラーにせず何もしない(エコーは返す)。別プロジェクトの PC にも同じ命令を一括で送り、自分に無い対象への命令は受け側で黙って捨てるのが通常の運用で、無視したことを OscDesk へ通知するのは任意(§1 の `/sys/ignored`・`/sys/failed`。D-105)
- **アドレスのパターン**(DESIGN.md D-106): 届いたアドレスが OSC 1.0 のパターンの記法(`*` `?` `[...]` `[!...]` `{a,b}`)を含むときは、パターンに一致した行と `OscTarget` の操作をすべて(Registry の登録の順で。対応表の行はアドレスが最初に現れた順にまとまる。D-108)呼ぶ。例: `/effect/spark*/stop` は `/effect/spark1/stop` と `/effect/spark2/stop` の行に届く。どの記法も `/` には一致しない(`*` は 1 段の中だけ)。大文字と小文字は区別する。記法を含まないアドレスは今までどおり完全一致。読めないパターン(閉じていない `[` `{`・空の `[]`・逆向きの範囲・`{}` の入れ子や記法・記法の中の `/`)と 256 文字を超えるパターンは、パターンとして扱わず完全一致で引く(未登録のアドレスと同じく、エラーにせず何もしない)。パターン 1 つで振り分けるのは 256 件(Registry の登録の数。対応表の 1 つのアドレスの行は 1 件と数える)までで、超えた分は呼ばずに警告を 1 回出す(`Log Mismatches` がオンのとき。同じパターンはそのコンポーネントにつき 1 回)。1 フレームに振り分けるパターンのメッセージは 64 通まで、それで呼ぶ受け手(Registry の登録)は合計 1024 件まで、判定で埋める表のマス(パターンのトークン数 + 1 と、登録のアドレスの長さ + 1 の積の合計)は 2,097,152 まで(フレームの最初のパターンにも効く)で、超えたパターンのメッセージは振り分けずに捨てる(パターンでない受信と、読めない・長すぎて完全一致で引くパターンは数えない。256 文字を超える登録のアドレスはパターンでは当たらず、同じ文字列が届いたときだけ当たる。`Log Mismatches` がオンならフレームの最初の 1 回だけ警告)。エコーは届いたアドレス(パターンのまま)へ返す。`/sys/*`(ping・stats)はパターンで指さない(完全一致だけ)。
- **型の変換**: Int は int と整数値の float、Float は float と int、String は string、Bool は int の 0/1・bool・float(0 以外が true)を受ける。合わない引数は呼ばずにログに出す。Trigger は引数の有無を問わず呼ぶ。Strings は引数がすべて string のとき(0 個を含む)だけ、その並びの配列で呼ぶ
- **Record の行**: 引数の先頭が `s` で、`Record Fields` を設定しているならフィールドの数(引数の数 − 1)が一致したときだけ呼ぶ。`Record Row Ids` がオンの行は先頭 2 つ(ID と Name)がどちらも `s` で、フィールドの数は引数の数 − 2(D-087)。引数が無い・先頭が `s` でない・数が違う受信は、呼ばずに `record mismatch for ...` の警告と理由をログに出す(エコーは他の受信と同じく返す)。フィールドの型は行では検査せず、`OscRecord` から取り出すときに検査する。`OscRecord` は受信ごとに新しく作るので、受け取った関数が保持し続けてよい
- **エコーバック**: `/sys/` 以外の受信は、行の有無・型の適否にかかわらず同じアドレスへ受信値をそのまま返す(bool は `i` の 0/1)。エコーはイベントより先に送る。購読者の例外はログに出し、他の行の発火とエコーを止めない
- **ログ**(DESIGN.md D-102): `Log Mismatches`(既定オン。`LogMismatches`)は、行はあるのに型が合わない受信(`argument type mismatch for ...`)・Record の形が合わない受信(`record mismatch for ...`)と、読めないデータグラムを受けるたびに警告で出す。登録はあるのに処理できないのは本当の問題なので既定で出す。`Log Unbound Addresses`(既定オフ。`LogUnboundAddresses`)は、行の無いアドレスの受信を `no binding for ...` の警告で出す。行の登録漏れを調べるときにオンにし、オンでも同じアドレスはそのコンポーネントにつき 1 回だけ出す(有効化をやり直すとまた出る。覚えるのは 256 個までで、超えたらその旨を 1 回出して以後の新しいアドレスは出さない)。D-102 より前の `Log Unhandled` は `Log Mismatches` に改名し、保存済みのシーン・プレハブの値はそのまま引き継ぐ(以前は行の無いアドレスも既定で毎回出していた)
- **ping / stats**: `/sys/ping` に同じ seq の `/sys/pong` を返す。`/sys/stats/request` に `received` / `parseErrors`(読めずに捨てたデータグラムの数)/ `lastReceivedAt` を返す
- **UDP**: 1 本のソケットで `0.0.0.0:Listen Port` に待ち受け、pong・エコー・一覧も同じソケットから `Reply Host : Reply Port` へ送る(送信元ポートは待受ポートと同じになる)。受信は専用スレッドで行い、処理(振り分け・エコー)はメインスレッドの `Update` で行う。待ち受けられない(ポートが使用中など)ときと返信先を引けないときは、有効化のときにエラーをログに出す。`IsListening` で待ち受けの状態を読める
- **デコード**: OSC 1.0 の `i` / `f` / `s` / `b` と `T` / `F`(bool として受ける)を読み、bundle は入れ子も含めて中のメッセージを順に処理する(timetag は読み捨てる)。大きさの決まった未対応の型(`h` `d` `t` `c` `r` `m` `N` `I` `S`)の引数は読み飛ばして含めない。大きさの分からない型タグ(配列 `[` `]` や未知のタグ)と壊れたデータグラムは、bundle ごと丸ごと捨てて警告を出し、`parseErrors` に数える
- **受信の観測**: `HasReceived` / `LastReceivedRealtime` / `SecondsSinceLastReceive` で最後の受信(`/sys/ping` を含む)を読める。`Silence Timeout Seconds`(0 で無効)を設定すると、受信が途絶えたとき `onLinkLost`、再開したとき `onLinkResumed` を呼ぶ。観測するだけで、pong・エコーなど受け口の振る舞いは変えない(D-052)
- **警告**: 有効化時に、不正なアドレス(A2)・同じアドレスと型の重複(A3)・イベントが空の行(A4)をログに出す。インスペクタでは定義を読み込んだときに限り、定義にないアドレス(A1)と、定義にあるのに行が無いアドレス(A5)、定義のレコードのアドレスにある Record の行の `Record Fields` が定義のフィールド id(宣言順)と違うこと(A6)、`Record Row Ids` が定義(`keysFrom.source` が `"ui"` ならオン)と違うこと(A7)も出す。A6 と A7 は「Record の行のフィールド id を定義に合わせる」で揃う。A1・A5 の「定義のアドレス」は、パラメータとレコードのアドレス、`optionsFrom.request`・`keysFrom.request`(パラメータとレコードのフィールドの両方)で、`optionsFrom.address`・`keysFrom.address` は含まない(Unity が送る側のため)。A4 の判定はインスペクタで登録した関数だけを数える(コードから `AddListener` した関数は数えない)
- **構成**: 振り分け(`OscRouter` と `OscRegistry`、対応表の行の型の変換は `OscDispatcher`)と検査、接続確認とエコー(`OscLink`)、OSC のエンコード・デコード(`OscCodec`)、UDP(`OscUdpTransport`)は `UnityEngine` に依存しない中核のアセンブリ `OscDesk.Receiver`(パッケージの `Runtime/Core/`)にあり、`OscReceiver`(`Runtime/`、アセンブリ `OscDesk.Receiver.Runtime`)はそれを MonoBehaviour につなぐだけ。インスペクタ拡張は `Editor/`(`OscDesk.Receiver.Editor`)。外部パッケージへの依存は無い。自前の asmdef から参照するときは `references` に `OscDesk.Receiver.Runtime`(と中核の型を使うなら `OscDesk.Receiver`)を足す。EditMode テストは `Tests/Editor/` の `OscDesk.Receiver.Tests`(`OscSurface` の manifest の `testables` で CI の `Unity CI` が実行)。OSC のバイト列は `protocol/osc-binary-samples.json` を TS の `osc-codec` と同じ見本で確かめる(受け口のテストはパッケージに同梱した写しを読む。D-096)
- **名前空間**: `OscReceiver`・インスペクタ拡張 `OscReceiverEditor`・中核の型は、すべて名前空間 `OscDesk.Receiver` にある。スクリプトから参照するときは `using OscDesk.Receiver;` を書く(HID-210 の破壊的変更。下の互換性ノート)

別の OSC ライブラリで受け口を書く場合も、§1〜§2 を満たせばよい。中核 `OscDesk.Receiver` の振り分け(`OscDispatcher`)は OSC の読み書きと独立しているので、ライブラリのメッセージ(アドレスと `int` / `float` / `string` / `byte[]` / `bool` の引数)を渡せば再利用できる(付録 A.3)。

### 実行時の受け手の登録(`OscRegistry` / `OscTarget` / `OscSpawner`、DESIGN.md D-107)

拡張パッケージや生成したオブジェクトが、実行中に受けるアドレスを登録・解除するための部品。`OscReceiver` が受けた OSC は、対応表の行と同じ経路でこれらの登録にも届く(下の「Registry 経由の振り分け」)。

- **Registry**: `OscRegistry.Shared`(中核、`UnityEngine` 非依存)。初めて使うときに作るので、シーンに置かなくてよく、登録の順序を気にしなくてよい。Play の開始ごとに `RuntimeInitializeOnLoadMethod(SubsystemRegistration)` で空にする(ドメインのリロードを切った環境で前回の登録を残さない)。変化は C# の event `Registered` / `Unregistered` / `Rejected` で知らせる(外部ライブラリは使わない)。`Shared` を空にすると、前の登録簿への購読は新しい登録簿へ引き継がれない(購読する側も Play ごとに購読し直す)
- **アドレス 1 つに受け手 1 つ**: 実行中に同じアドレスが重なったら、後から登録された方を受け付けず(`Duplicate`)、`OscTarget` が Console に警告を出す。受け付けられなかった方を解除しても、先に登録した方は外れない。不正なアドレス(対応表の A2 と同じ規則)は登録しない
- **重複した対象名の付け直し**(DESIGN.md D-109): シーンに置いた `OscTarget` のアドレスが同じシーンの中で重なったら、シーンの保存時と Play の開始時に、エディタが階層で後に並ぶ方の `Target Name` に `_2`, `_3`, … を足して付け直す(後に並ぶ対象の元の名前とも重ならない番号を選ぶ)。付け直したことは Console の警告とインスペクタに出し、Undo で戻せる。名前はシーンに保存されるので、同じシーンを使うすべての PC で同じになる(Play の開始時の付け直しはシーンを未保存にするだけなので、残すには保存する)。シーンをまたいだ重なりは付け直さず、Play の開始時に警告だけ出す(実行中は後から有効になった方が受け付けられない)
- **受け手の基底 `OscTarget`**: 派生クラスが `DeclareOperations` で操作(名前・型・制約・表示ヒント・処理)を宣言する。アドレスは `/パッケージ名/対象名/操作名`(推奨の規約。コアは文字列の一致だけを見る)。パッケージ名は `Package Name`(空なら派生クラスの既定)、対象名は `Target Name`(空なら GameObject 名から `(Clone)` を除いたもの)。`OnEnable` で登録し、`OnDisable` で解除する(非アクティブになったものに命令を届けない。破棄のときも `OnDisable` が先に呼ばれる)。有効な間に名前を変えると(Play 中のインスペクタでの変更を含む)登録し直す。パッケージ名・対象名・操作名は段ごとに検査し、空(パッケージ名は可)・空白・制御文字・`/`・`* ? [ ] { } ,`・`#` を含む名前では登録しない。型の変換は対応表の行と同じ(上の「型の変換」)。インスペクタに受け付けるアドレスと形の警告が出る
- **生成担当 `OscSpawner`**: `/パッケージ名/対象名/spawn ,s "名前"` で `Prefab` を生成し、生成したものとその子の `OscTarget` の対象名をその名前にしてから有効にする(例: `/effect/spawner/spawn ,s "spark1"` → `/effect/spark1/stop`)。`destroy ,s "名前"` で消す(同じフレームのうちに登録も外れる)。名前の番号はコントローラーが振り、受け口では振らない。失敗の理由: `name in use`(この生成担当が同じ名前で生成済み、または生成したものの登録がシーンの別の対象と重なった)・`invalid name`(空・空白・`/`・`* ? [ ] { } , #` を含む)・`not found`(`destroy` で名前が無い)・`no prefab`・`too many`(同時に残す数が `Max Instances`(既定 64)に達した)・`rate limited`(1 フレームの生成が `Max Spawns Per Frame`(既定 8)に達した)・`inactive parent`(`Parent` が非アクティブ)。根が非アクティブな Prefab・ひな形からも、生成したものは有効にして登録する。理由は `/sys/failed`(D-105)にそのまま載る短い英語
- **失敗の扱い**: `OscRegistry.Deliver` は、登録が無い(`NoTarget`)・型や Record が合わない(`Mismatch`、理由 `type mismatch` / `record mismatch`)・処理が理由を返した(`Failed`)を返す。処理の例外は呼び出し側へそのまま伝える

### Registry 経由の振り分け(DESIGN.md D-108)

`OscReceiver` は、受信(Transport = `OscUdpTransport`)・接続確認とエコー(Link = `OscLink`)・振り分け(Router = `OscRouter`)を中核の部品に分け、振り分けを `OscRegistry.Shared` 経由にした。`OscReceiver` はコンポーネントとして残し、シリアライズするフィールド(ポート・返信先・対応表・ログと報告の設定・途絶のイベント)とスクリプトの GUID は変えていないので、既存のシーン・プレハブとフォークのホストはそのまま動く(移行の作業は要らない)。

- **対応表は「インスペクタで組む登録」**: `OscReceiver` は有効化のときに、対応表の行のアドレスごとに 1 件を Registry に登録し、無効化で外す。同じアドレスに型の違う行が何本あっても今までどおりすべて呼ぶ(アドレスごとの登録が、受けた引数を変換せずに受け、その中で行ごとに型を変換する)。不正なアドレス(A2)の行も、以前と同じく完全一致で届くよう登録する(警告は有効化のときに出る)。D-100 の `[OscAddress]` の配線は対応表の行のイベントを組むだけなので、そのまま使える
- **届く範囲**: どの `OscReceiver` に届いた受信も、Registry のすべての登録(対応表の行と `OscTarget` の操作)へ振り分ける。パターン(D-106)は登録の順に、1 つのパターンで 256 件(登録の数)まで、1 フレームではパターンのメッセージ 64 通・受け手の合計 1024 件まで。対応表の行の不一致の警告は、受けた `OscReceiver` ではなく行を持つ `OscReceiver` が出す。行の無いアドレス・不一致・例外の扱い、エコー・pong・stats・`/sys/ignored`・`/sys/failed` は変わらない。`OscTarget` の操作の型の不一致・失敗は、`Log Mismatches` がオンなら受けた `OscReceiver` が `argument type mismatch for ...` / `record mismatch for ...` / `failed for ...: 理由` の警告を出す
- **重なり**: 対応表の行のアドレスが `OscTarget` の操作や別の `OscReceiver` の行と重なったら、後から有効になった方は受け付けられず、`OscReceiver` が「対応表の行 … は既に登録されているので、この行には届きません」の警告を出す。以前は `OscReceiver` ごとに対応表が独立していたので、**同じアドレスの行を複数の `OscReceiver` に持たせる構成だけは振る舞いが変わる**(下の互換性ノート)
- **bundle の途中の無効化**: 購読者が bundle の途中で `OscReceiver` を無効にしても、そのデータグラムの残りは今までどおり振り分け、対応表の登録はデータグラムの処理の後に外す

### 設計図の送信(Catalog、DESIGN.md D-114)

`OscReceiver` は Registry に沿って設計図を §1「設計図の Sync」の形で送る(`Send Catalog`、既定オン)。中身の組み立ては中核の `OscCatalog` / `OscCatalogDigest`。

- **いつ送るか**: 待ち受けを始めたとき(有効化・ポートや返信先の変更)と `/sys/catalog/request` を受けたときに、全体を `begin` … `end` で送る。全体の送り直しは 1 秒に 1 回まで(要求が続いても増幅しない。間隔が空くまで待ってから送る)。実行中の変化(登録・解除・重複)は、そのフレームの分を `LateUpdate` でまとめて `add` / `remove` と最後の `digest` にし、1 データグラム(60 KiB を超えれば複数の bundle)で送る。送る前に消えたものは送らず、同じ内容で登録し直しただけなら送らない。差分は `remove` をすべて先に、`add` を後に送る(受け側の件数・大きさの上限で入れ替わる項目が捨てられないように)
- **PC 名**: `Catalog Name`(空なら `SystemInfo.deviceName`。NUL と単独のサロゲートを除いて 64 文字まで。何も残らなければ `unity`)
- **項目**: 登録 1 件(対応表の行のアドレス、`OscTarget` の操作)が 1 項目。`kind` は値を持たない Trigger と命令(`AsCommand`。生成担当の `spawn` / `destroy`)が `trigger`、それ以外が `state`。`type` は Int → `i`、Float → `f`、String → `s`、Bool → `bool`、Trigger → `trigger`、Record → `record`、Strings → `strings`(生成担当の命令は `trigger` / `s`)。キーは `min` / `max` / `step`(Int の操作は `i`、ほかは `f`)・`label`・`widget`・`options`(1 つずつ)。対応表の行は型だけ(同じアドレスに型の違う行があれば最初の行の型)で、制約は載らない。設計図に載せられないアドレス(対応表の A2 の行)は載せない。文字列は 1024 文字、組は 32 個までに切り、1 項目は(JSON にした大きさで)8 KiB に収める。項目は受け側の上限に合わせて登録の順の先頭から 4096 件まで、かつ見積もった大きさの合計が 8 MiB までで、超えている間は警告を 1 回出す(受け側の 8 MiB は全 PC の合計なので、ほかの PC の設計図が大きいと受け側で捨てられ得る)。空の選択肢も載せる
- **重複**: 受け付けなかった重複(実行中に同じアドレスで後から有効になったもの)は、登録された方の項目にキー `duplicate`(受け付けなかった持ち主の GameObject 名)で載せる。受け付けなかった方が無効になれば外す

### トリガ待ちのアプリでの再送の扱い(`OscResendWindow`)

値を「届いた時点では保持だけ、適用はトリガ(Update ボタンなど)を待つ」意味論にするアプリでは、§3 の再送(初めての pong・喪失からの回復)にトリガが伴わないので、Unity を再起動するたびに操作者がトリガを押し直すことになる。再送とふだんの操作は OSC 上ではどちらも「同じアドレスへの値」で区別できない。そこで **再送が起きる契機にだけ窓を開き、窓の中で届いた値を再送とみなしてトリガを待たずに適用する**。窓の外の値はふだんの操作としてトリガを待つ。中核 `OscDesk.Receiver` の `OscResendWindow`(パッケージの `Runtime/Core/OscResendWindow.cs`、DESIGN.md D-097)がこの状態機械を持つ。届いた値をすぐ適用するアプリには要らない。

| 契機 | 窓 |
|---|---|
| `Open(OscResendWindowReason.PlayStart)`(Play 開始・利用側の有効化で呼ぶ) | 開く。前の窓で届いた値は忘れる |
| 受信が `GapSeconds`(既定 6 秒)以上途絶えた後の最初の受信(`NoteReceive` / `NoteValue` / `NoteTrigger` のどれでもよい) | 閉じていれば開く(`Reason` は `ReceiveGap`。`ReopenOnGap = false` で切れる)。ブリッジの停止・再起動、ネットワーク断、Editor の Pause 明け。メソッドが `true` を返したら、利用側は前の窓で集めた対象を忘れる |
| 窓の中で保持する値が届く(`NoteValue`) | 開いたまま。最後の値の時刻を記録する。利用側は値の届いた対象(キーなど)を覚えておく |
| 窓の中で最後の値から `QuietSeconds`(既定 0.75 秒)静か(`Tick` が `Quiet` を返す) | 閉じる。利用側は窓の中で値が届いた対象を、通常の適用の規則で適用する |
| 窓の中でトリガが届く(`NoteTrigger` が `Trigger` を返す) | 閉じる。トリガの範囲は通常どおり適用し、窓で集めた値の自動適用はしない |

時刻は呼び出し側が渡す(秒、単調増加)。`OscReceiver.LastReceivedRealtime` と同じ `Time.realtimeSinceStartup` を使う。

```csharp
using OscDesk.Receiver;
using UnityEngine;

public sealed class TriggeredHost : MonoBehaviour
{
    [SerializeField] private OscReceiver receiver;
    private readonly OscResendWindow window = new OscResendWindow();

    private static double Now => Time.realtimeSinceStartup;

    private void OnEnable()
    {
        window.Open(OscResendWindowReason.PlayStart);
        // 集めた対象を忘れる
    }

    private void Update()
    {
        // 受け口の受信の観測(/sys/ping を含む最終受信時刻)を毎フレーム渡す
        if (receiver != null && receiver.HasReceived && window.NoteReceive(receiver.LastReceivedRealtime))
        {
            // 途絶明けで窓が開いた。集めた対象を忘れる
        }

        if (window.Tick(Now) == OscResendWindowClose.Quiet)
        {
            // 窓の中で値が届いた対象を適用する
        }
    }

    // 値の行(Bindings)に登録する
    public void OnValue(float value)
    {
        if (window.NoteValue(Now)) { /* 途絶明けで窓が開いた。集めた対象を忘れる */ }
        // 値を保持する。window.IsOpen なら対象を「窓の中で届いた」として覚える
    }

    // トリガの行(Bindings)に登録する
    public void OnApply()
    {
        window.NoteTrigger(Now); // Trigger が返ったら、窓で集めた対象を忘れる
        // トリガの範囲を通常どおり適用する
    }
}
```

- **受信の途絶の検出は `HasReceived` / `LastReceivedRealtime` を毎フレーム渡して行う**。値の受け取りでも同じ時計の現在時刻を渡すので、途絶の後に最初に届いたのが値でも ping でも、直前の受信との空きで窓が開く(ping だけが届いたフレームでは、次のフレームの `Update` が空きのある受信を見て開く)。受信の時刻が先に渡した現在時刻より前でも最後の受信は巻き戻らない
- **`onLinkLost` / `onLinkResumed` を使わない理由**: 受け口の途絶の判定は受け口の `Update` で行われるので、Editor の Pause のように途絶中にフレームが進まないと、再開の最初のフレームで受け口と利用側の `Update` の順序次第で `onLinkResumed` が呼ばれず、Pause 明けの自動適用が抜ける。また受け口の `Silence Timeout Seconds`(既定 0 = 判定しない)を `GapSeconds` と二重に設定することになる。最終受信時刻の比較なら順序に依存せず、閾値も 1 か所で済む
- **既定値の根拠**: `GapSeconds`(`DefaultGapSeconds` = 6)はブリッジの ping 間隔 2 秒の 3 倍で、ping を 2 回落としても途絶と誤検出しない。`QuietSeconds`(`DefaultQuietSeconds` = 0.75)は再送の burst(保持値ごとの個別メッセージの連続。100 件程度でも数 ms〜数十 ms)を待ち切る長さ。どちらも 0 以下は `ArgumentOutOfRangeException` で拒否する。インスペクタで調整できるようにするなら、有効化のたびに `GapSeconds` / `QuietSeconds` / `ReopenOnGap` へ入れ直す
- **途絶からの再開で開く既定(`ReopenOnGap = true`)**: ブリッジは保持値を保存して再起動後も復元・再送する(D-058)ので、ブリッジの再起動で定義の `default` が実機に適用されることはない。保存ファイルが壊れていた・定義と合わない値は `default` から始まり、途絶からの再開でその値が自動適用される(§3)
- **`GapSeconds` 未満の途絶の回復**: ブリッジは ping を 1 回取りこぼした後の pong(ブリッジの再起動後は初めての pong)でも再送する(§3)ので、短い Pause・ネットワーク断・ブリッジの素早い再起動の回復でも再送は届くが、窓は開かず、ふだんの値としてトリガを待つ。このとき Unity は値を失っていない(Unity の再起動は Play 開始の窓が受ける)ので、届くのは既に受けた値と同じで、適用しなくても状態は変わらない。途絶中に UI で操作した値だけは、そのままトリガを待つ
- **窓の中の Pause**: 窓の中で値が届いた直後に Pause して `GapSeconds` 以上後に再開しても、途絶の前の値の時刻で窓は閉じない。最後の受信から `GapSeconds` 以上経っている間は `Tick` が閉じず(再開の最初のフレームで受け口がまだ受信を処理していない順序も含む)、再開の受信が静穏時間を数え直すので、再開の後に届く再送も同じ窓に入る
- **既知の限界(2 秒未満の再起動)**: ping 間隔より速い Unity の再起動はブリッジが喪失を観測できず、再送も起きない(§3)。Play 開始の窓は開いたままになり、最初の操作で値が届くと、静穏時間の後にその値がトリガを待たずに適用されて閉じる(この場合に限りトリガを待たない適用になる)。値が戻らないときは UI の「再送」を押す
- **再送の直後のトリガ**: 静穏時間の中で操作者がトリガを押すと窓が閉じ、他の対象の再送値は自動適用されない(それぞれのトリガで適用される)
- 冪等な適用(同じ値なら何もしない)にしておくと、同じ値の再送(Pause 明け、UI の「再送」、ネットワーク断の回復)で余計な処理が起きない

## 6. 実 Unity 接続手順

### 6.1 ポートの対応

次の 3 者(config・ブリッジ起動引数・Unity 側設定)が一致している必要がある。

| 経路 | config(`config/oscdesk.config.json`) | ブリッジ起動引数(上書きする場合) | Unity 側 |
|---|---|---|---|
| OscDesk → Unity(ping・値) | `unity.host` : `unity.sendPort`(既定 `127.0.0.1:7090`) | `--unity-host <host>` / `--unity-port <port>` | OSC 受信の待受ポート = `unity.sendPort` |
| Unity → OscDesk(pong・エコー) | `bridge.oscListenPort`(既定 `7091`) | `--osc-listen-port <port>` | OSC 送信の宛先 = OscDesk マシンの IP : `bridge.oscListenPort` |

- **返信先は設定で明示する**。Unity 側は「受信データグラムの送信元へ返す」実装にせず、上表の宛先を設定値として持つ(ブリッジは待受と送出を 1 本の UDP ソケットで兼ねるので送信元ポートも 7091 になるが、それに頼らない)
- **同一マシン構成**(Unity Editor と OscDesk を同じ PC で動かす): config は既定のまま。Unity 側は待受 7090、送信宛先 `127.0.0.1:7091`
- **LAN 分離構成**(Unity が別マシン): `unity.host` を Unity 機の IP(例 `192.168.1.20`)にし、Unity 側の送信宛先を OscDesk 機の IP(例 `192.168.1.10`)+ `7091` にする。両マシンのファイアウォールで UDP 受信(Unity 機: 7090 / OscDesk 機: 7091)を許可する
- 接続確認の間は debug ON の config(`config/oscdesk.debug.config.json`。NDJSON に送受信が記録される)での起動を推奨する。`launchers\start-oscdesk-debug.bat` で起動できる

### 6.2 段階的な疎通確認

前提: §5 の `OscReceiver`(または §1〜§2 を実装した受け口)を置いた Unity が Play 中で、`start-oscdesk.bat` でブリッジと UI が §6.1 の設定で起動済み、ブラウザで UI(既定 `http://<OscDesk ホスト>:8080`)を開き、サーフェス定義を採用している。

観測点:

- **UI の上部** — ブリッジとの接続、Unity の到達性・RTT・連続喪失回数、複数台構成なら宛先ごとのバッジ
- **ブリッジの標準出力** — 起動完了行 `OSCDESK_BRIDGE_READY` と、`(INFO, BRIDGE)` / `(WARN, BRIDGE)` などの 1 行ログ(再送・エコーの食い違い)
- **NDJSON** — debug ON のとき `logs/diagnostics/oscdesk-*.ndjson` に送受信が記録される

手順:

1. **ping/pong**: UI の Unity の表示が「接続中」になり、RTT に数値が出る。出なければ §6.3
2. **値とエコー**: スライダーやボタンを操作すると、Unity の UnityEvent が呼ばれ、NDJSON に送信(out)と同じアドレスの受信(in)が対で残る
3. **再送**: スライダーを動かしてから Unity の Play を止めて再開する。数秒以内にブリッジの標準出力に `Resending N desired value(s) to Unity "unity" (Unity recovered).` が出て、Unity 側の値が操作した値に戻る

### 6.3 接続できないときの切り分け

| 症状 | 主な原因候補 | 確認・対処 |
|---|---|---|
| 到達性が「喪失」のまま / RTT が出ない | ポート・宛先の不一致 | §6.1 の 3 者対応を見直す。特に `unity.host` : `unity.sendPort` ↔ Unity の待受、`bridge.oscListenPort` ↔ Unity の送信宛先ポート |
| 〃 | ファイアウォール | Unity 機の 7090 と OscDesk 機の 7091 の UDP 受信を許可する |
| 〃 | pong の送信元ホストが設定と違う | ブリッジは `unity.host`(名前なら解決したアドレス)から届いた pong だけを採用する。Unity 機に複数の IP がある場合、送信に使われる IP と `unity.host` を揃える。標準出力の `Ignored /sys/pong from non-Unity source ...` で分かる |
| 〃 | 別サブネット | debug 起動中に `/oscdesk/diag/request` を送ると、`/oscdesk/diag` の JSON でサブネットの判定が返る |
| Editor の Pause 中だけ「喪失」になる | 正常 | pong はフレーム処理に乗るため Pause 中は止まる。再開で回復し、回復時に保持値が再送される |
| UI の操作が Unity に届かない | 宛先の誤り・UnityEvent の未登録 | UI の「Unity 宛先」表示と Unity の待受を突き合わせる。届いているのにイベントが呼ばれないなら、Console の `argument type mismatch` / `record mismatch` を見る(既定で出る)。行の無いアドレスの `no binding for ...` は既定では出ないので、`OscReceiver` の `Log Unbound Addresses` をオンにして見る(§5「ログ」) |
| まとめ送りが「確認できませんでした」になる | エコー未実装・別アドレスへの返信 | §2 のとおり **同一アドレス** へ返しているか確認する。bundle を展開できないライブラリでは中のメッセージが届かない |
| `Unity echo differs from desired value` の警告が出る | Unity が値を書き換えて返している | Unity 側で値を丸めたり拒否したりしていないか確認する。OscDesk は保持値を変えないので、次の再送でまた狙いの値が送られる |

## 7. ライブラリ互換性チェックリスト

利用予定の OSC ライブラリ(独自 Fork 含む)が次を満たすか確認する。

| # | チェック項目 | 満たさない場合 |
|---|---|---|
| 1 | UTF-8 文字列(`s` タグ)を欠損なく送受信できる | 日本語を含む文字列の値が化ける。ASCII だけで運用するか、ライブラリを替える |
| 2 | 基本型タグ `i` / `f` / `s` を送受信できる | 利用不可(本契約の前提) |
| 3 | 送信宛先(ホスト・ポート)を設定で明示できる | 利用不可(返信先は設定で決める) |
| 4 | bundle を受信して展開できる | まとめ送り(アクション)が届かない。単発の操作だけで運用する |
| 5 | 60 KiB までのデータグラムを受信できる | 大きなまとめ送りが届かない。アクションの件数を減らす |
| 6 | アドレスをリテラル一致で振り分けられる(パターンを含まないアドレスで、意図せずパターン展開されない) | 受信側で意図せずパターン展開されないことだけ確認する。まとめて操作する OSC 1.0 のパターン(`OscReceiver` は D-106 で対応)を使うなら、そのライブラリがパターンを解釈できるかも確かめる |
| 7 | 真偽値を `i` の 0/1 で送れる(`T` / `F` が強制されない) | 送信前に 0/1 の int へ変換する層を挟む |

## 互換性ノート

標準仕様と各ライブラリの差異が判明するたびにここへ追記する。本体改造やプロトコル変更が必要になった場合は、差分と選択肢を記録したうえでユーザーの判断を仰ぐ。

- **返信先**: 「受信データグラムの送信元に必ず返る」とはみなさない。返信先のホスト・ポートを設定で明示する前提で実装する
- **使う OSC 機能**: 基本型タグ `i` / `f` / `s` / `b` と bundle / timetag だけ。配列引数・カラー型・64bit 整数・ライブラリ独自の bool 変換など、OSC 1.0 で解釈が割れやすい機能は使わない。複数の値が要る場合は複数引数か JSON 文字列で表す
- **文字列は UTF-8**: OSC 1.0 は文字列のエンコーディングを規定しないため、本契約では UTF-8 と定める
- **真偽値**: `i` の 0/1 で送受信する。`T` / `F` を要求する受信側ライブラリが現れたら、差分をここに記録して判断を仰ぐ
- **timetag**: 遅延実行は要求しない。bundle の timetag は無視して受信後すぐ処理してよい。ブリッジは即時タイムタグで送る
- **単一データグラム**: OSC 1.0 にメッセージ分割・再結合の機構はない。まとめ送りの bundle は 60 KiB(512 メッセージ)を上限とし、ブリッジが超過を拒否する。IP フラグメンテーションを避けたい場合はアクションを小さく保つ
- **UDP の順序・欠落**: 版による順序付けは行わない。遅れて届いた古いエコーで表示が一時的に戻ることがあるが、保持値は変わらず、再送で最終的に揃う。単発のメッセージが欠落した場合も、次の操作か再送で揃う(trigger の欠落は回復しない)
- **`/sys/ignored`・`/sys/failed` の追加(HID-375、D-105)**: 受け口が処理しなかった受信を任意で知らせる 2 つの予約アドレスを足した。返さない受け口との互換は保たれる(エコーの意味は変わらない)。`OscReceiver` は既定で返すので、`/sys/*` の予期しない受信を数えている独自のブリッジ・ツールは、この 2 つが増えることに注意する。D-053 の「`/sys/*` を増やさない」は一覧の要求・応答についての判断で、これは届いたことの確認の一部として足した
- **ライブラリの扱い**: mock-unity とテストでは `osc` npm をコーデックとして使うが、契約は `osc` 固有の挙動に依存しない。`metadata: true` のようなライブラリ固有表現は実装都合にすぎない
- **マニフェスト経路の撤去(D-051)**: `/sys/manifest/request`・`/sys/manifest` と、それに伴う `projectId` の照合・ステージング・再注入は廃止した。撤去前の Unity 実装から新しい受け口への移行手段は用意していない(フォークを含む)。撤去前の Unity をつないでも ping/pong とエコーは従来どおり成立するが、`/sys/manifest` などは捨てられる
- **UI で管理する行の ID(HID-323、D-087、破壊的変更)**: `keysFrom.source` が `"ui"` のレコードは、行のメッセージが `[s:キー, ...]` から `[s:ID, s:Name, ...]` に、`keysFrom.address` の一覧が Name の並びから ID の並びに変わった。既存の Record の行は `Record Row Ids` がオフのままだと、ID を名前とみなし、Name を最初のフィールドとして読む(`Record Fields` を設定していればフィールドの数が合わず呼ばれない)。インスペクタに A7 が出るので「Record の行のフィールド id を定義に合わせる」でオンにし、`record.Key` で名前を読んでいた処理はそのまま(Name)、一覧で行を消していた処理は ID で照合するよう直す。ブリッジ側の保持値のファイルは起動後の最初の採用で自動的に ID を振って移行する。Unity の一覧から行ができるレコードは変わらない
- **`OscReceiver` の名前空間の移動(HID-210、破壊的変更)**: `OscReceiver` はグローバル名前空間から `OscDesk.Receiver` へ移った(インスペクタ拡張 `OscReceiverEditor` も同じ)。シーン・プレハブに付けたコンポーネントはスクリプトの GUID で参照されるので、付け直しは要らず、インスペクタで登録した関数・対応表もそのまま残る。コードから `OscReceiver` を参照しているスクリプト(`GetComponent<OscReceiver>()`、`OscReceiver.Binding` など)は `using OscDesk.Receiver;` を足すか `OscDesk.Receiver.OscReceiver` と書く。同名のクラスを持つ別ライブラリ(ホスト側の別実装の `OscReceiver` など)と同じアセンブリに置いても、グローバル型が優先されて既存コードの参照が奪われることはなくなった
- **`OscReceiver` の uOSC 依存の撤去(HID-353、D-095、破壊的変更)**: `OscReceiver` は uOSC(`uOscServer` / `uOscClient`)を使わず、自分で UDP と OSC を扱うようになった。待ち受けと返信先の設定は `OscReceiver` 自身の `Listen Port` / `Reply Host` / `Reply Port` に移り、`[RequireComponent]` も外れた。既存のシーン・プレハブは次の順で移す(付録 A.2)。(1) uOSC を入れたまま、`OscReceiver` のインスペクタに出る「uOSC の設定を取り込んでコンポーネントを外す」を押す(`uOscServer.port` → `Listen Port`、`uOscClient.address` / `port` → `Reply Host` / `Reply Port` を写し、uOSC のコンポーネントを外す)。プレハブのインスタンスではコンポーネントを外せないので、プレハブを開いて押す。(2) 保存する。(3) ほかに uOSC を使うものが無ければ `Packages/manifest.json` から `com.hecomi.uosc` とスコープドレジストリ `com.hecomi` を外す。先に uOSC を外すと、残ったコンポーネントは Missing Script になって設定を読めなくなる(その場合は Missing Script を外し、`Listen Port` などを手で入れる)。`uOscServer` を残したまま再生すると同じポートを奪い合い、`OscReceiver` が「待ち受けられません」のエラーを出す。インスペクタで登録した関数と対応表はそのまま残る。pong・エコーの送信元ポートが uOSC のエフェメラルなポートから待受ポートに変わる(ブリッジは送信元ホストで照合するので影響しない)。デコードは uOSC より厳しく、UTF-8 として読めない文字列や大きさの分からない型タグを含むデータグラムは(bundle なら中のメッセージごと)捨てる。ブリッジが送るものは常に読めるが、ほかの送り手から直接受けている場合は Console の「読めないデータグラムを捨てました」を確かめる
- **`OscReceiver` の振り分けの Registry への移行(HID-384、D-108)**: `OscReceiver` は残し、シリアライズするフィールドとスクリプトの GUID を変えていないので、移行の作業は要らない。振る舞いが変わるのは、同じアドレスの行を複数の `OscReceiver` に持たせていた構成だけで、後から有効になった `OscReceiver` のその行は呼ばれなくなる(警告が出る)。また、どの `OscReceiver` に届いた受信も、ほかの `OscReceiver` の対応表の行と `OscTarget` に届くようになった(待受ポートで受け口を分けていた構成では、行のアドレスを分ける)。1 つのシーンに `OscReceiver` を 1 つ置く通常の構成では変わらない
- **アドレスのパターン(HID-381、D-106)**: `OscReceiver` は届いたアドレスの OSC 1.0 のパターンを解釈するようになった。記法の文字(`*` `?` `[` `{`)を含まないアドレスの振り分けは変わらない。記法の文字を含むアドレスの行(OSC 1.0 ではメソッドのアドレスに使えない文字)は、同じ文字列が届けば今までどおり呼ばれる(加えて、`/*` のようなパターンの受信にも一致し得る)
- **UPM パッケージ化(HID-354、D-096)**: 受け口は `OscSurface/Assets/OscReceiver/` から UPM パッケージ `com.hidano.oscdesk`(`OscSurface/Packages/com.hidano.oscdesk/`)へ移った。契約(§1〜§4)と受け口の振る舞いは変わらない。名前空間 `OscDesk.Receiver`・中核の asmdef `OscDesk.Receiver`・`OscReceiver` のスクリプトの GUID も変わらないので、`OscSurface` のシーン・プレハブの参照はそのまま残る。`OscReceiver` は `Assembly-CSharp` から `OscDesk.Receiver.Runtime` へ、`OscReceiverEditor` は `OscDesk.Receiver.Editor` へ移った(`Assembly-CSharp` からの参照は変わらない)。ファイルを写して使っていたプロジェクトの移し方は §5「導入」

## 付録 A: 受け口の実装メモ

本文 §1〜§7 はこの付録に依存しない。実装の全文は `OscSurface/Packages/com.hidano.oscdesk/` を参照する(文書へのソースの全文コピーはしない)。

### A.1 `OscReceiver` の UDP と OSC(D-095)

`OscReceiver` は外部の OSC ライブラリを使わない。OSC 1.0 の必要範囲(`i` / `f` / `s` / `b`、bundle、4 バイト境界の詰め)を `OscCodec` に、UDP を `OscUdpTransport` に、どちらも `UnityEngine` 非依存の純粋 C# で持つ。

- **ソケット**: `System.Net.Sockets.Socket`(IPv4 UDP)1 本を `0.0.0.0:Listen Port` に bind し、受信と送信を兼ねる。専用スレッドが `Poll` と同期の `ReceiveFrom` で受けてバイト列を `ConcurrentQueue` に積み、メインスレッドの `Update` が取り出してデコード・振り分け・エコーする。停止は `Socket.Close` でブロックを解く(`Poll` は 200 ms ごとに戻るので、Close で解けない実行環境でも止まる)
- **`SIO_UDP_CONNRESET`**: Windows では、自分が送ったデータグラムに ICMP Port Unreachable が返ると(返信先のブリッジが止まっているなど)、次の `ReceiveFrom` が WSAECONNRESET(10054)で失敗する。受信と送信を同じソケットで行うので、ブリッジを止めている間の pong で毎回これが起きる。`IOControl(SIO_UDP_CONNRESET, false)` でこの通知を切り、切れない実行環境(Windows 以外、IL2CPP で未対応の場合)では受信ループが ConnectionReset を読み流す
- **受信のキュー**: 取り出されないまま 4096 個を超えたデータグラムは捨てる(Editor の Pause 中などにメモリを食い潰さない)。Pause 中は pong も止まる(§6.3 の正常挙動)。RTT にはフレーム時間ぶんの揺らぎが加わる
- **IL2CPP**: リフレクションや動的なコード生成を使わないので、ストリッピングの設定は要らない。IL2CPP ビルドでの受信・送信は `docs/VERIFICATION.md` の手順で確かめる

### A.2 uOSC からの移行

D-095 より前の `OscReceiver` は uOSC(hecomi 版 v2 系、検証バージョン 2.2.0、`com.hecomi.uosc`)を使い、同じ GameObject に `uOscServer` / `uOscClient` を要求していた。移行の手順は互換性ノートの「`OscReceiver` の uOSC 依存の撤去」を参照する。旧版の導入手順(スコープドレジストリ)は次のとおりで、移行の間だけ必要になる:

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

### A.3 uOSC で受け口を書く場合の差異(参考)

自前の受け口を uOSC 2.2.0 で書く場合に、ソースで確かめた差異(D-095 の調査)。

- **bundle は自動展開**: uOSC は bundle を展開し、中のメッセージごとに `onDataReceived` を呼ぶ
- **`parseErrors` が観測不能**: decode の失敗を外部へ通知しない。範囲の検査も無く、壊れたデータは受信スレッドの例外としてログに出るだけ
- **対応型は int / float / string / byte[] と T / F(bool)**: それ以外の型タグは引数の位置に `null` を残し、後続の引数の位置もずれたまま読む。C# の `bool` は送れないため、エコーでは 0/1 の `int` へ正規化する(`OscDispatcher.NormalizeForEcho`)
- **受信コールバックはメインスレッド(フレーム同期)**: `uOscServer.Update` が呼ぶ。受信スレッドは `UdpClient.Available` を一定間隔で見て読む
- **受信は `uOscServer`・送信は `uOscClient` に分離**: 送信は別のソケットのエフェメラルなポートから出る。待受のソケットは送らないので、ICMP による WSAECONNRESET は待受側では起きない(フォークのホストで見えた「再受信時の不具合」は、少なくとも ICMP では説明できない。D-095)
- **待受は IPv6 のデュアルスタック**(`IPv6Any` + `IPv6Only = 0`): IPv6 を無効にした環境では bind に失敗し、失敗しても `uOscServer` は起動済みとして扱い、無効化と有効化をやり直すまで受け直さない
