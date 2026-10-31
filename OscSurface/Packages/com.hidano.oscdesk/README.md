# OscDesk Receiver(`com.hidano.oscdesk`)

OscDesk(LAN 内のブラウザ・スマートフォンから Unity を操作する OSC コントロールサーフェス)の、Unity 側の汎用の受け口です。受けた OSC のアドレスをインスペクタで登録した UnityEvent に振り分け、`/sys/ping` に `/sys/pong` を、値には同じアドレスへのエコーを返します。OSC 1.0 のコーデックと UDP を自前で持ち、外部パッケージには依存しません。

> **セキュリティ前提**: この経路に認証・暗号化はありません。信頼できる LAN 内でだけ使い、インターネットや信頼できないネットワークへ公開しないでください。

契約(アドレス・エコー・ping/pong・型)の正典は oscdesk リポジトリの [`docs/UNITY_PROTOCOL.md`](https://github.com/Hidano-Dev/oscdesk/blob/main/docs/UNITY_PROTOCOL.md) です。使い方(対応表の作り方・Record / Strings の行・定義 JSON の取り込み)は同文書の §5「汎用レシーバ」を参照してください。

## 導入

Unity 6000.0 以降。`Packages/manifest.json` に npmjs のスコープ付きレジストリと依存を足します。

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

空の GameObject に `OscReceiver` を追加し、`Listen Port` を OscDesk の `unity.sendPort`(既定 7090)に、`Reply Host` / `Reply Port` を OscDesk を動かす PC : `bridge.oscListenPort`(既定 `127.0.0.1` : 7091)に合わせます。これだけで OscDesk の画面に到達性(RTT)が出ます。

## 構成

| フォルダ | アセンブリ(asmdef) | 中身 |
|---|---|---|
| `Runtime/Core/` | `OscDesk.Receiver`(`noEngineReferences: true`) | `UnityEngine` に依存しない純粋 C#。OSC のコーデック(`OscCodec`)、UDP(`OscUdpTransport`)、振り分け(`OscRouter`・`OscDispatcher`・アドレスのパターン `OscAddressPattern`)、接続確認とエコー(`OscLink`)、対応表の検査(`OscBindingAudit`)、定義 JSON の読み取り(`OscDefinitionReader`)、`OscRecord`、トリガ待ちのアプリで再送を適用する窓(`OscResendWindow`)、名前の一覧の正規化(`OscNameList`・`OscNameListFeed`)、レコードの帳簿(`OscKeyedBook<T>` / `OscUiRowBook<T>`)と読み取りの補助(`OscRecordReader`)、受け手の登録簿(`OscRegistry`・`OscOperation`・`OscAddressNames`)など |
| `Runtime/` | `OscDesk.Receiver.Runtime` | MonoBehaviour。`OscReceiver`(中核を Unity のフレームと UnityEvent につなぐ)、`OscNameListPublisher`(名前の一覧を要求と変化で送る)、受け手の基底 `OscTarget` と生成担当 `OscSpawner` |
| `Editor/` | `OscDesk.Receiver.Editor`(Editor のみ) | インスペクタ拡張 `OscReceiverEditor` / `OscTargetEditor`、`[OscAddress]` の宣言からの配線 `OscReceiverWiring` |
| `Tests/Editor/` | `OscDesk.Receiver.Tests`(Editor のみ、`UNITY_INCLUDE_TESTS`) | EditMode テスト。OSC のバイト列の見本 `osc-binary-samples.json`(リポジトリの `protocol/` の写し)を同梱 |
| `Tests/PlayMode/` | `OscDesk.Receiver.PlayModeTests`(テストのアセンブリ、`UNITY_INCLUDE_TESTS`) | PlayMode テスト(`OscTarget` の有効化・無効化・破棄と `OscSpawner`) |
| `Tests/Runtime/` | `OscDesk.Receiver.Tests.Fixtures`(テストのアセンブリ、`UNITY_INCLUDE_TESTS`) | EditMode テストが GameObject に付ける受け側の MonoBehaviour(Editor のアセンブリの MonoBehaviour は付けられないため) |
| `Samples~/MinimalReceiver/` | なし(取り込むと `Assets/` の既定のアセンブリに入る) | 最小の受け口シーンと、それに合うサーフェス定義 |

- 型はすべて名前空間 `OscDesk.Receiver` にあります(`using OscDesk.Receiver;`)
- 機能を足すときは、Unity に依存しない処理を `Runtime/Core/`(`OscDesk.Receiver`)に、MonoBehaviour を `Runtime/`(`OscDesk.Receiver.Runtime`)に、エディタだけの補助を `Editor/` に置きます。`Core` は `UnityEngine` を参照できないので、Unity の型が要る処理を `Core` に入れないでください
- 自前の asmdef から参照するときは `OscDesk.Receiver.Runtime`(`OscReceiver` を使う場合)と `OscDesk.Receiver`(`OscRecord` などの中核の型を使う場合)を `references` に足します。asmdef の無いスクリプト(`Assembly-CSharp`)からはそのまま参照できます

## 名前の一覧を返す(`optionsFrom` / `keysFrom`)

定義の `optionsFrom` / `keysFrom` に Unity の名前の一覧を返すときは、`OscNameListPublisher` を追加します。`Receiver` に `OscReceiver` を、`Address` に定義の `optionsFrom.address`(または `keysFrom.address`)を設定し、`OscReceiver` の `request` の Trigger の行の On Trigger に `OscNameListPublisher.SendNow` を登録します。供給元はコードから渡します。

```csharp
publisher.AddSource(() => Microphone.devices);
```

要求には同じ一覧でも必ず送り、`Refresh Interval Seconds`(既定 3 秒)ごとに作り直して、前回送れた一覧と順序込みで違うときだけ送ります。空白のみ・制御文字・`Reserved Names`(定義の静的な選択肢の「(none)」など)・重複は除き、理由を警告としてログに出します。整えるだけなら `OscNameList.Normalize` を直接呼べます。規則の詳細は `docs/UNITY_PROTOCOL.md` §5 と DESIGN.md D-098 を参照してください。

## トリガ待ちのアプリでの再送

値を受けた時点では保持だけして、適用をトリガ(Update ボタンなど)まで待つアプリでは、OscDesk のブリッジが Unity の再起動・再接続で送り直す保持値にトリガが伴いません。`OscResendWindow` は、再送が起きる契機(Play 開始と、受信の途絶からの再開)にだけ窓を開き、窓の中で届いた値をトリガを待たずに適用してよいかを知らせます。`OscReceiver.HasReceived` / `LastReceivedRealtime` を毎フレーム渡す使い方・既定値の根拠・既知の限界は、`docs/UNITY_PROTOCOL.md` §5「トリガ待ちのアプリでの再送の扱い」を参照してください。

## 関数の登録を宣言する(`[OscAddress]`)

行のイベントに関数を手で登録する代わりに、受ける関数にアドレスを宣言できます。

```csharp
using OscDesk.Receiver;
using UnityEngine;

public sealed class AppHost : MonoBehaviour
{
    [OscAddress("/app/volume")]          // Float の行
    public void SetVolume(float value) { }

    [OscAddress("/app/member/values")]   // Record の行
    public void ReceiveMember(OscRecord record) { }

    [OscAddress("/app/device/keys")]     // Strings の行(UI で管理する行の ID の一覧)
    public void ReceiveDeviceKeys(string[] ids) { }

    [OscAddress("/app/segments/request")] // Trigger の行。1 つの関数に複数のアドレスを宣言できる
    [OscAddress("/app/lipdevices/request")]
    public void SendOptionLists() { }
}
```

このスクリプトを `OscReceiver` と同じ GameObject(かその子)に付け、インスペクタで定義ファイルを設定して **定義から配線([OscAddress] の関数を登録)** を押すと、足りない行を足したうえで、宣言したアドレスの行のうち型が引数と合う行のイベントへ永続リスナーとして登録します。何度押しても同じ関数は足さず、手で登録した関数は消しません。結果(変更と警告)はインスペクタと Console に出ます。

- 引数と行の型: 無し = Trigger、`int` = Int、`float` = Float、`string` = String、`bool` = Bool、`OscRecord` = Record、`string[]` = Strings。関数は public のインスタンスメソッドで、戻り値は void
- 型が合わない・行が無い・定義にない宣言と、宣言も関数も無い行は警告になり、登録しません
- エディタのスクリプトから配線するときは `OscReceiverWiring.WireFromDefinition(receiver, targets, parameters, records)` を呼びます。行を自分で整えてから登録だけを行うなら `OscReceiverWiring.WireListeners(receiver, targets, expected)` です。どちらも `OscWiringReport`(`Changes` / `Warnings`)を返します
- 宣言を消しても、前に登録したリスナーは外しません(インスペクタで Missing と出たら手で外します)

## 実行時に受け手を登録する(`OscTarget` / `OscSpawner`)

拡張パッケージは `OscTarget` を継承し、受け付ける操作を宣言します。有効になると `/パッケージ名/対象名/操作名` のアドレスで `OscRegistry.Shared` に登録し、無効になると外します。対象名はインスペクタの `Target Name` で決め、空なら GameObject 名から `(Clone)` を除いたものです。

```csharp
using OscDesk.Receiver;

public sealed class SparkEffect : OscTarget
{
    protected override string DefaultPackageName => "effect";

    protected override void DeclareOperations(OscOperationList operations)
    {
        operations.Trigger("stop", Stop);                                           // /effect/<対象名>/stop
        operations.Float("rate", SetRate).WithRange(0f, 1f).WithWidget("slider");   // 制約と表示ヒント(D-103)
    }

    private void Stop() { }
    private void SetRate(float value) { }
}
```

- 実行中に同じアドレスが重なったら、後から有効になった方は受け付けられず、Console に警告が出ます
- `OscSpawner` は `/パッケージ名/対象名/spawn ,s "名前"` で `Prefab` を生成し、生成したものの `OscTarget` をその名前で登録します。`destroy ,s "名前"` で消します。使われている名前・使えない名前では生成しません(失敗の理由 `name in use` / `invalid name`)
- シーンに `OscReceiver` を 1 つ置けば、受けた OSC は対応表の行と同じく `OscTarget` の操作にも届きます(D-108)。`/effect/spark*/stop` のような OSC 1.0 のパターンで、まとめて操作できます(D-106)。詳細は `docs/UNITY_PROTOCOL.md` §5「実行時の受け手の登録」「Registry 経由の振り分け」と DESIGN.md D-107 / D-108

## サンプル

Package Manager の本パッケージの **Samples** から **Minimal Receiver** を Import すると、`Assets/Samples/` に次が入ります。

- `MinimalReceiver.unity` — `OscReceiver`(待受 7090、返信先 `127.0.0.1:7091`)と、受けた値を Console に出す `MinimalReceiverLogger` を置いたシーン。`/sample/value`(Float)と `/sample/hello`(Trigger)の行を登録済み
- `MinimalReceiver.surface.json` — このシーンに合う OscDesk のサーフェス定義。OscDesk の画面で読み込むと、スライダー(`/sample/value`)とボタン(`/sample/hello`)が出る

シーンを再生して OscDesk(ブリッジと UI)を既定の設定で起動すると、到達性が「接続中」になり、スライダーやボタンの操作が Console に出ます。

## テストを利用側で走らせる

利用側のプロジェクトの `Packages/manifest.json` に `testables` を足すと、Test Runner の EditMode に本パッケージのテストが出ます。テストはパッケージに同梱した見本だけを読むので、oscdesk リポジトリが無くても通ります(UDP のテストはループバックの空きポートを使います)。

```json
{
  "testables": ["com.hidano.oscdesk"]
}
```

## 版と契約の対応

版は [Semantic Versioning](https://semver.org/lang/ja/) に従います。Unity との契約(`docs/UNITY_PROTOCOL.md`)の Unity 側の振る舞いを互換でなく変える変更(アドレス・引数の形・エコーの規則の変更、公開 API・シリアライズするフィールドの削除や改名など)は major を上げます。契約の互換を保つ機能追加は minor、不具合の修正は patch です。

| パッケージの版 | 対応する Unity との契約 | ブリッジ |
|---|---|---|
| 1.0.0 | `docs/UNITY_PROTOCOL.md` の D-096 時点(`/sys/ping`・`/sys/pong`、同一アドレスへのエコー、UI で管理する行の `[s:ID, s:Name, ...]`(D-087)、自前の UDP / OSC(D-095)) | oscdesk の `main`(HID-354 以降) |

契約の変更点と移行の手順は `docs/UNITY_PROTOCOL.md` の「互換性ノート」に、版ごとの変更は [CHANGELOG.md](CHANGELOG.md) に記録します。

## ファイルを写して導入していた場合

以前の `OscSurface/Assets/OscReceiver/` を写して使っていたプロジェクトは、写した `.cs` / `.asmdef` を消してから本パッケージを入れます(同じ名前の asmdef `OscDesk.Receiver` が 2 つあるとコンパイルできません)。写した `OscReceiver.cs` の `.meta` の GUID が本パッケージの GUID(`450301b3c49b4642936f40978a3fd642`)と違う場合、シーン・プレハブに付けた `OscReceiver` は Missing Script になります。付け直すか、Unity を閉じた状態でシーン・プレハブの中の旧 GUID を本パッケージの GUID に置き換えてください(どちらを採るかは利用側で判断してください)。

## ライセンス

未設定です(npmjs への公開前に決めます)。
