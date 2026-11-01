# Changelog

`com.hidano.oscdesk` の変更履歴です。版は [Semantic Versioning](https://semver.org/lang/ja/) に従い、Unity との契約(oscdesk リポジトリの `docs/UNITY_PROTOCOL.md`)の Unity 側の振る舞いを互換でなく変える変更は major を上げます。版と契約の対応は [README.md](README.md) の「版と契約の対応」を参照してください。

## Unreleased

- 追加: `OscResendWindow`(`Runtime/Core/`、DESIGN.md D-097)。値の適用をトリガまで待つアプリで、ブリッジの再送(Play 開始と受信の途絶からの再開の後に届く値)をトリガなしで適用するための窓。既定は `GapSeconds` 6 秒・`QuietSeconds` 0.75 秒。使い方は `docs/UNITY_PROTOCOL.md` §5「トリガ待ちのアプリでの再送の扱い」
- 追加: 名前の一覧の正規化 `OscNameList`(`Normalize` / `NormalizeSources` / `SequenceEqual`、設定 `OscNameListOptions`、警告 `OscNameListWarning`)と、供給元から作り直して変わったときだけ送る `OscNameListFeed`(`Runtime/Core/`)、要求と周期で一覧を送る MonoBehaviour `OscNameListPublisher`(`Runtime/`)(DESIGN.md D-098)
- レコードの保持値と適用待ちの帳簿を足した(DESIGN.md D-099)。`OscKeyedBook<T>`(`keysFrom` が Unity 側の一覧のレコード。キーごとの直近の値・再送の窓の中で届いたキー・対象が現れるまでの適用待ち・居ないキーの警告を 1 回に絞る印。キーは初めて受けた順)、`OscUiRowBook<T>`(`keysFrom.source` が `"ui"` のレコード。行 ID の一覧が並びと削除の正、行 ID ごとの値と Name、行 ID ごとに一度振った連番)、`OscRecordReader`(フィールド id があれば id で、無ければ位置で読み、読めなかった理由をまとめて返す)。いずれも `Runtime/Core/`(`OscDesk.Receiver`)
- 受ける関数に `[OscAddress("/アドレス")]`(`OscAddressAttribute`、中核の `OscDesk.Receiver`)を付けておくと、インスペクタの「定義から配線([OscAddress] の関数を登録)」が、宣言したアドレスの行のうち型が引数と合う行のイベントへ永続リスナーとして登録する。エディタのスクリプトからは `OscReceiverWiring.WireFromDefinition` / `WireListeners` で同じことができ、結果を `OscWiringReport` で返す。同じ関数は足さず、手で登録した関数は消さない(DESIGN.md D-100)
- 変更: 行の無いアドレスの受信で既定では警告を出さないようにした(DESIGN.md D-102)。自分に無い対象への命令は通常の運用で届くため。`OscReceiver` の `Log Unhandled` を `Log Mismatches`(型・Record の不一致と読めないデータグラム。既定オン)に改名し(保存済みの値は `FormerlySerializedAs` で引き継ぐ)、行の無いアドレスは新しい `Log Unbound Addresses`(既定オフ。オンでも同じアドレスは 1 回だけ)で出す。エコー・pong の振る舞いは変わらない。出し分けは中核の `OscReceiveWarnings`(`Runtime/Core/`)
- 追加: 実行時に受け手を登録・解除する Registry(DESIGN.md D-107)。中核に `OscRegistry`(遅延生成の `Shared`、`Registered` / `Unregistered` / `Rejected` の event、`Deliver`)・操作の宣言 `OscOperation` / `OscOperationList`・アドレスの補助 `OscAddressNames`、`Runtime/` に拡張パッケージが継承する基底 `OscTarget`(`OnEnable` で登録、`OnDisable` で解除。アドレスは `/パッケージ名/対象名/操作名`)と、名前を付けて Prefab を生成・破棄する `OscSpawner`、インスペクタ `OscTargetEditor`。`Shared` は Play の開始ごとに `RuntimeInitializeOnLoadMethod(SubsystemRegistration)` で空にする。`OscReceiver` の振り分けはまだ Registry を通らない(HID-384)
- 追加: シーンに置いた `OscTarget` のアドレスが同じシーンの中で重なったら、保存時と Play の開始時に後に並ぶ方の対象名へ `_2` などを足して付け直す `OscTargetNameDeduplicator`(`Editor/`、DESIGN.md D-109)。Console とインスペクタに知らせ、Undo で戻せる。シーンをまたいだ重なりは警告だけ
- PlayMode テストのアセンブリ `OscDesk.Receiver.PlayModeTests`(`Tests/PlayMode/`)を足した
- テストの受け側の MonoBehaviour を置くテスト専用のアセンブリ `OscDesk.Receiver.Tests.Fixtures`(`Tests/Runtime/`。テストのアセンブリなので `testables` に入れたときだけコンパイルされる)を足した

## [1.0.0] - 未公開

最初の版。oscdesk リポジトリの `OscSurface/Assets/OscReceiver/` を UPM パッケージにしたもの(DESIGN.md D-096)。

- 対応する契約: `docs/UNITY_PROTOCOL.md` の D-096 時点(`/sys/ping`・`/sys/pong`、同一アドレスへのエコー、UI で管理する行の `[s:ID, s:Name, ...]`(D-087)、自前の UDP / OSC(D-095))
- 構成: `Runtime/Core/`(`OscDesk.Receiver`、`UnityEngine` 非依存)、`Runtime/`(`OscDesk.Receiver.Runtime`、`OscReceiver`)、`Editor/`(`OscDesk.Receiver.Editor`)、`Tests/Editor/`(`OscDesk.Receiver.Tests`)、サンプル `Minimal Receiver`
- `Assets/OscReceiver/` にあった頃と、名前空間 `OscDesk.Receiver`・asmdef `OscDesk.Receiver`・スクリプトの GUID は変わらない。`OscReceiver` と `OscReceiverEditor` は `Assembly-CSharp` から専用のアセンブリ(`OscDesk.Receiver.Runtime` / `OscDesk.Receiver.Editor`)へ移った。`Assembly-CSharp` のスクリプトからはこれまでどおり参照でき、自前の asmdef からも `references` に `OscDesk.Receiver.Runtime` を足せば参照できるようになった
- EditMode テストが読む OSC のバイト列の見本は、リポジトリの `protocol/` を辿らずパッケージに同梱した写しを読む(利用側の `testables` でも通る)
