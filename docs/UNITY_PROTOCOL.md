# UNITY_PROTOCOL.md - Unity との OSC 契約

> OscDesk のブリッジと Unity(または同じ契約を実装した任意の OSC 受信アプリ)の間の取り決めと、実 Unity の接続手順。仕様(§1〜§4)は特定の OSC ライブラリに依存せず、OSC 1.0 標準の機能(基本型タグ・bundle・timetag)だけで成立させる。受け口の実装の詳細と特定ライブラリとの差異は付録 A にだけ置く。
>
> **セキュリティ前提**: この経路に認証・暗号化はない。信頼できる LAN 内でだけ使い、インターネットや信頼できないネットワークへ公開してはならない。

## 前提

- **操作対象の定義は OscDesk が持つ**。どのアドレスにどの型の値を送るかは、OscDesk 側のサーフェス定義 JSON(`protocol/surface-definition.schema.json`、DESIGN.md D-043〜D-044)で決める。Unity は自分の構造を申告しない(マニフェストの経路は撤去した。D-051)
- **値の正は OscDesk(ブリッジ)が持つ**。ブリッジは定義の `kind: state` の値ごとに「狙いの値」を保持し、Unity の再起動・再接続のときに送り直す(D-045)。Unity のエコーは「届いた」確認であり、保持値を書き換えない
- **Unity の仕事は「アドレスと値を受け取り、同じアドレスへエコーを返す」ことだけ**。受け取った値でアプリの状態を変える処理は、汎用レシーバ(§5)の UnityEvent か、各アプリのスクリプトで書く
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

### その他の `/sys/*`

`/sys/` で始まるアドレスは予約である。Unity は上記以外の `/sys/*` を受けても応答せず、エコーも返さない。ブリッジは UI から `/sys/*` と `/oscdesk/*` への送信を拒否し、Unity から届いた `/sys/*` を UI へ流さない(撤去前の Unity が `/sys/manifest` などを送ってきても捨てるだけで害はない)。

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

ブリッジは定義の `kind: state` のパラメータについて、最後に UI が操作した値(未操作なら定義の `default`)を保持し、次の契機で Unity へ送り直す。`kind: trigger` と `standalone: false` のパラメータは保持も再送もしない(再送でボタンが押し直されることはない)。

| 契機 | 送り先 | 送る値 |
|---|---|---|
| その宛先が初めて pong を返した | その宛先だけ | 保持値すべて |
| その宛先が喪失から回復した(Unity の再起動・ネットワーク断の回復) | その宛先だけ | 保持値すべて |
| 定義を採用した | その時点で到達可能な宛先 | 採用で値が決まり直したアドレスだけ |
| UI の「再送」操作 | 指定した宛先、または全宛先 | 保持値すべて(到達不能でも送る) |

- **ping 間隔(2 秒)より速い再起動は検知できない**。Unity を再起動したのに値が戻らない場合は、UI の「再送」を押す
- Unity 側は「起動直後は既定値で動き、OscDesk からの再送で狙いの値に揃う」前提で作る。Unity が起動時に自分の値を OscDesk へ申告する仕組みは無い
- **保持値はブリッジの再起動をまたいで残る**(DESIGN.md D-058)。ブリッジを再起動すると、各宛先の初回の到達(表の 1 行目)で、再起動前に操作された値が送られる(定義の `default` には戻らない)。そのため受け口が再送をそのまま適用する作りでも、ブリッジの再起動で実機が既定値へ戻ることはない。定義を変えて id・型・値域が合わなくなったパラメータだけが `default` から始まる
- **プロジェクトファイルを読み込んだ後は、UI の「Unity へ送る」(全宛先への再送)まで自動の再送をしない**(DESIGN.md D-090)。読み込みは OscDesk の画面と保持値を置き換えるだけで、その間に Unity を再起動・再接続しても上の表の自動の契機では何も届かない(操作した値は従来どおり届く)。Unity 側の契約(受けてエコーを返す)は変わらない

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

4. 任意: 定義の `optionsFrom` で Unity の一覧を使う場合(§2「定義が宣言したアドレスへの一覧の応答」)は、次のとおりにする
   - `optionsFrom.request` のアドレスに **Trigger の行** を足し、イベントにアプリの関数を登録する。関数の中で `OscReceiver.SendStrings(address, values)` を呼び、`optionsFrom.address` へ一覧を返す(例: `receiver.SendStrings("/mb/segments", names)`)。「定義にあって行が無いアドレスの行を追加」は、`request` の行を Trigger で足す
   - 構成が変わったとき(例: セグメントの追加)は、要求を待たずに同じ `SendStrings` を呼んでよい(自発送信)
   - `optionsFrom.address` に行は要らない(Unity が送る側なので、行の不足として警告しない)
   - 一覧が 1 データグラムの上限(60 KiB)を超える、またはアドレスが不正なときは送らずにログへ出し、`SendStrings` は false を返す

5. 任意: 定義の `records`(個数が実行時に変わる対象。DESIGN.md D-059)を受ける場合は、次のとおりにする(HID-217、D-063)
   - レコードのアドレスに **Record の行** を 1 本置く。キー(メンバー名など)が何個に増えても行は 1 本でよい。`state` と `trigger` のレコードはどちらも Record の行で受ける
   - イベント `On Record` に `void F(OscRecord record)` の形の関数を **Dynamic OscRecord** として登録する。`record.Key` が先頭の `s`(キー)、続く引数がフィールドで、`record.Count` 個ある。取り出しは番号(0 始まり、キーを除いた位置)かフィールド id で、`GetInt` / `GetFloat` / `GetString` / `GetBool`(値が無い・型が合わないと例外)と `TryGetInt` などの `TryGet` 系(false を返す)がある。変換の規則は単一値の行と同じ(Int は整数値の float も、Bool は `i` の 0/1 も受ける)。`GetValue` は受信値をそのまま返す
   - 行の `Record Fields` にフィールド id を定義の `fields` の宣言順に並べる(例: `active` `slot` `ip` `segment`)。id で取り出せるようになり(`record.GetInt("slot")`)、数が合わない受信ではイベントを呼ばない。空にするとフィールドの数を検査せず、番号でだけ取り出せる
   - 「定義にあって行が無いアドレスの行を追加」は、レコードのアドレスに Record の行を `Record Fields` つきで足す。定義のフィールドを足し引きしたあとは「Record の行のフィールド id を定義に合わせる」で既存の行の `Record Fields` を揃える(登録した関数は残る)
   - キーの一覧(`keysFrom`)は `optionsFrom` と同じく、`keysFrom.request` の **Trigger の行** に関数を登録し、その中で既存の `SendStrings(keysFrom.address, keys)` を呼んで返す(例: `receiver.SendStrings("/vp/members/list", memberNames)`)。メンバーが増えたときは要求を待たずに同じ `SendStrings` を呼んでよい。`keysFrom.address` に行は要らない
   - `keysFrom.source` が `"ui"` のレコード(D-075。例: MB の接続先のように OscDesk の画面で追加・削除する一覧)は向きが逆で、OscDesk が `keysFrom.address` へ **行の ID の一覧の全量**(`s` を追加順に 0 個以上)を送ってくる。`keysFrom.address` に **Strings の行**(`void F(string[])` を Dynamic で登録)を置いて受け、並び順と削除(一覧から消えた ID)をそこで知る。全部消したときは引数 0 個で届き、空の配列で呼ばれる。一覧は追加・削除のたびと、保持値の再送(初回到達・回復・定義の採用・UI の再送)のたびに、行の値より先に届く。「定義にあって行が無いアドレスの行を追加」はこの Strings の行も足す
   - `"ui"` のレコードの行は、変わらない **ID**(OscDesk が振る UUID の文字列)と、OscDesk の画面で後から変えられる **Name** を持つ(D-087)。行のメッセージは `[s:ID, s:Name, フィールドを宣言順に]` で、Record の行の **Record Row Ids** をオンにして受ける(「定義にあって行が無いアドレスの行を追加」はオンで足す)。`record.Id` が ID、`record.Key` が Name で、フィールドの番号・id での取り出しは従来どおり。Name が変わると同じ ID の行が新しい Name で届き直すので、Unity 側で行を ID で覚えておけば改名をまたいで同じ行と分かる(一覧は ID の並びなので改名では届かない)。Record Row Ids がオフの行(Unity の一覧から行ができるレコード)では `record.Id` は `record.Key` と同じ
   - レコードのフィールドの `optionsFrom.request` も、パラメータの `optionsFrom` と同じく Trigger の行で受ける

   ```csharp
   using OscDesk.Receiver;
   using UnityEngine;

   public sealed class MemberHost : MonoBehaviour
   {
       [SerializeField] private OscReceiver receiver;

       // /vp/member の Record の行(Record Fields: active, slot, ip, segment)に Dynamic で登録する
       public void OnMember(OscRecord record)
       {
           var name = record.Key;
           var active = record.GetBool("active");
           var slot = record.GetInt("slot");
           Debug.Log(name + " active=" + active + " slot=" + slot + " ip=" + record.GetString("ip"));
       }

       // /vp/members/request の Trigger の行に登録する
       public void OnMembersRequested()
       {
           receiver.SendStrings("/vp/members/list", new[] { "メンバーA", "メンバーB" });
       }
   }
   ```

### 振る舞い

- **受信**: アドレスが行と完全一致したときだけ、その行のイベントを呼ぶ(ワイルドカードは使わない)。同じアドレスの行が複数あればすべて呼ぶ
- **型の変換**: Int は int と整数値の float、Float は float と int、String は string、Bool は int の 0/1・bool・float(0 以外が true)を受ける。合わない引数は呼ばずにログに出す。Trigger は引数の有無を問わず呼ぶ。Strings は引数がすべて string のとき(0 個を含む)だけ、その並びの配列で呼ぶ
- **Record の行**: 引数の先頭が `s` で、`Record Fields` を設定しているならフィールドの数(引数の数 − 1)が一致したときだけ呼ぶ。`Record Row Ids` がオンの行は先頭 2 つ(ID と Name)がどちらも `s` で、フィールドの数は引数の数 − 2(D-087)。引数が無い・先頭が `s` でない・数が違う受信は、呼ばずに `record mismatch for ...` の警告と理由をログに出す(エコーは他の受信と同じく返す)。フィールドの型は行では検査せず、`OscRecord` から取り出すときに検査する。`OscRecord` は受信ごとに新しく作るので、受け取った関数が保持し続けてよい
- **エコーバック**: `/sys/` 以外の受信は、行の有無・型の適否にかかわらず同じアドレスへ受信値をそのまま返す(bool は `i` の 0/1)。エコーはイベントより先に送る。購読者の例外はログに出し、他の行の発火とエコーを止めない
- **ping / stats**: `/sys/ping` に同じ seq の `/sys/pong` を返す。`/sys/stats/request` に `received` / `parseErrors`(読めずに捨てたデータグラムの数)/ `lastReceivedAt` を返す
- **UDP**: 1 本のソケットで `0.0.0.0:Listen Port` に待ち受け、pong・エコー・一覧も同じソケットから `Reply Host : Reply Port` へ送る(送信元ポートは待受ポートと同じになる)。受信は専用スレッドで行い、処理(振り分け・エコー)はメインスレッドの `Update` で行う。待ち受けられない(ポートが使用中など)ときと返信先を引けないときは、有効化のときにエラーをログに出す。`IsListening` で待ち受けの状態を読める
- **デコード**: OSC 1.0 の `i` / `f` / `s` / `b` と `T` / `F`(bool として受ける)を読み、bundle は入れ子も含めて中のメッセージを順に処理する(timetag は読み捨てる)。大きさの決まった未対応の型(`h` `d` `t` `c` `r` `m` `N` `I` `S`)の引数は読み飛ばして含めない。大きさの分からない型タグ(配列 `[` `]` や未知のタグ)と壊れたデータグラムは、bundle ごと丸ごと捨てて警告を出し、`parseErrors` に数える
- **受信の観測**: `HasReceived` / `LastReceivedRealtime` / `SecondsSinceLastReceive` で最後の受信(`/sys/ping` を含む)を読める。`Silence Timeout Seconds`(0 で無効)を設定すると、受信が途絶えたとき `onLinkLost`、再開したとき `onLinkResumed` を呼ぶ。観測するだけで、pong・エコーなど受け口の振る舞いは変えない(D-052)
- **警告**: 有効化時に、不正なアドレス(A2)・同じアドレスと型の重複(A3)・イベントが空の行(A4)をログに出す。インスペクタでは定義を読み込んだときに限り、定義にないアドレス(A1)と、定義にあるのに行が無いアドレス(A5)、定義のレコードのアドレスにある Record の行の `Record Fields` が定義のフィールド id(宣言順)と違うこと(A6)、`Record Row Ids` が定義(`keysFrom.source` が `"ui"` ならオン)と違うこと(A7)も出す。A6 と A7 は「Record の行のフィールド id を定義に合わせる」で揃う。A1・A5 の「定義のアドレス」は、パラメータとレコードのアドレス、`optionsFrom.request`・`keysFrom.request`(パラメータとレコードのフィールドの両方)で、`optionsFrom.address`・`keysFrom.address` は含まない(Unity が送る側のため)。A4 の判定はインスペクタで登録した関数だけを数える(コードから `AddListener` した関数は数えない)
- **構成**: 振り分けと検査、OSC のエンコード・デコード(`OscCodec`)、UDP(`OscUdpTransport`)は `UnityEngine` に依存しない中核のアセンブリ `OscDesk.Receiver`(パッケージの `Runtime/Core/`)にあり、`OscReceiver`(`Runtime/`、アセンブリ `OscDesk.Receiver.Runtime`)はそれを MonoBehaviour につなぐだけ。インスペクタ拡張は `Editor/`(`OscDesk.Receiver.Editor`)。外部パッケージへの依存は無い。自前の asmdef から参照するときは `references` に `OscDesk.Receiver.Runtime`(と中核の型を使うなら `OscDesk.Receiver`)を足す。EditMode テストは `Tests/Editor/` の `OscDesk.Receiver.Tests`(`OscSurface` の manifest の `testables` で CI の `Unity CI` が実行)。OSC のバイト列は `protocol/osc-binary-samples.json` を TS の `osc-codec` と同じ見本で確かめる(受け口のテストはパッケージに同梱した写しを読む。D-096)
- **名前空間**: `OscReceiver`・インスペクタ拡張 `OscReceiverEditor`・中核の型は、すべて名前空間 `OscDesk.Receiver` にある。スクリプトから参照するときは `using OscDesk.Receiver;` を書く(HID-210 の破壊的変更。下の互換性ノート)

別の OSC ライブラリで受け口を書く場合も、§1〜§2 を満たせばよい。中核 `OscDesk.Receiver` の振り分け(`OscDispatcher`)は OSC の読み書きと独立しているので、ライブラリのメッセージ(アドレスと `int` / `float` / `string` / `byte[]` / `bool` の引数)を渡せば再利用できる(付録 A.3)。

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
| UI の操作が Unity に届かない | 宛先の誤り・UnityEvent の未登録 | UI の「Unity 宛先」表示と Unity の待受を突き合わせる。届いているのにイベントが呼ばれないなら、Console の `no binding for ...` / `argument type mismatch` を見る |
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
| 6 | アドレスをリテラル一致で振り分けられる(OSC のパターンマッチは不要) | 受信側で意図せずパターン展開されないことだけ確認する |
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
- **ライブラリの扱い**: mock-unity とテストでは `osc` npm をコーデックとして使うが、契約は `osc` 固有の挙動に依存しない。`metadata: true` のようなライブラリ固有表現は実装都合にすぎない
- **マニフェスト経路の撤去(D-051)**: `/sys/manifest/request`・`/sys/manifest` と、それに伴う `projectId` の照合・ステージング・再注入は廃止した。撤去前の Unity 実装から新しい受け口への移行手段は用意していない(フォークを含む)。撤去前の Unity をつないでも ping/pong とエコーは従来どおり成立するが、`/sys/manifest` などは捨てられる
- **UI で管理する行の ID(HID-323、D-087、破壊的変更)**: `keysFrom.source` が `"ui"` のレコードは、行のメッセージが `[s:キー, ...]` から `[s:ID, s:Name, ...]` に、`keysFrom.address` の一覧が Name の並びから ID の並びに変わった。既存の Record の行は `Record Row Ids` がオフのままだと、ID を名前とみなし、Name を最初のフィールドとして読む(`Record Fields` を設定していればフィールドの数が合わず呼ばれない)。インスペクタに A7 が出るので「Record の行のフィールド id を定義に合わせる」でオンにし、`record.Key` で名前を読んでいた処理はそのまま(Name)、一覧で行を消していた処理は ID で照合するよう直す。ブリッジ側の保持値のファイルは起動後の最初の採用で自動的に ID を振って移行する。Unity の一覧から行ができるレコードは変わらない
- **`OscReceiver` の名前空間の移動(HID-210、破壊的変更)**: `OscReceiver` はグローバル名前空間から `OscDesk.Receiver` へ移った(インスペクタ拡張 `OscReceiverEditor` も同じ)。シーン・プレハブに付けたコンポーネントはスクリプトの GUID で参照されるので、付け直しは要らず、インスペクタで登録した関数・対応表もそのまま残る。コードから `OscReceiver` を参照しているスクリプト(`GetComponent<OscReceiver>()`、`OscReceiver.Binding` など)は `using OscDesk.Receiver;` を足すか `OscDesk.Receiver.OscReceiver` と書く。同名のクラスを持つ別ライブラリ(ホスト側の別実装の `OscReceiver` など)と同じアセンブリに置いても、グローバル型が優先されて既存コードの参照が奪われることはなくなった
- **`OscReceiver` の uOSC 依存の撤去(HID-353、D-095、破壊的変更)**: `OscReceiver` は uOSC(`uOscServer` / `uOscClient`)を使わず、自分で UDP と OSC を扱うようになった。待ち受けと返信先の設定は `OscReceiver` 自身の `Listen Port` / `Reply Host` / `Reply Port` に移り、`[RequireComponent]` も外れた。既存のシーン・プレハブは次の順で移す(付録 A.2)。(1) uOSC を入れたまま、`OscReceiver` のインスペクタに出る「uOSC の設定を取り込んでコンポーネントを外す」を押す(`uOscServer.port` → `Listen Port`、`uOscClient.address` / `port` → `Reply Host` / `Reply Port` を写し、uOSC のコンポーネントを外す)。プレハブのインスタンスではコンポーネントを外せないので、プレハブを開いて押す。(2) 保存する。(3) ほかに uOSC を使うものが無ければ `Packages/manifest.json` から `com.hecomi.uosc` とスコープドレジストリ `com.hecomi` を外す。先に uOSC を外すと、残ったコンポーネントは Missing Script になって設定を読めなくなる(その場合は Missing Script を外し、`Listen Port` などを手で入れる)。`uOscServer` を残したまま再生すると同じポートを奪い合い、`OscReceiver` が「待ち受けられません」のエラーを出す。インスペクタで登録した関数と対応表はそのまま残る。pong・エコーの送信元ポートが uOSC のエフェメラルなポートから待受ポートに変わる(ブリッジは送信元ホストで照合するので影響しない)。デコードは uOSC より厳しく、UTF-8 として読めない文字列や大きさの分からない型タグを含むデータグラムは(bundle なら中のメッセージごと)捨てる。ブリッジが送るものは常に読めるが、ほかの送り手から直接受けている場合は Console の「読めないデータグラムを捨てました」を確かめる
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
