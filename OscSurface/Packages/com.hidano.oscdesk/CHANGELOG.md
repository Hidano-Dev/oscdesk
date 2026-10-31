# Changelog

`com.hidano.oscdesk` の変更履歴です。版は [Semantic Versioning](https://semver.org/lang/ja/) に従い、Unity との契約(oscdesk リポジトリの `docs/UNITY_PROTOCOL.md`)の Unity 側の振る舞いを互換でなく変える変更は major を上げます。版と契約の対応は [README.md](README.md) の「版と契約の対応」を参照してください。

## [1.0.0] - 未公開

最初の版。oscdesk リポジトリの `OscSurface/Assets/OscReceiver/` を UPM パッケージにしたもの(DESIGN.md D-096)。

- 対応する契約: `docs/UNITY_PROTOCOL.md` の D-096 時点(`/sys/ping`・`/sys/pong`、同一アドレスへのエコー、UI で管理する行の `[s:ID, s:Name, ...]`(D-087)、自前の UDP / OSC(D-095))
- 構成: `Runtime/Core/`(`OscDesk.Receiver`、`UnityEngine` 非依存)、`Runtime/`(`OscDesk.Receiver.Runtime`、`OscReceiver`)、`Editor/`(`OscDesk.Receiver.Editor`)、`Tests/Editor/`(`OscDesk.Receiver.Tests`)、サンプル `Minimal Receiver`
- `Assets/OscReceiver/` にあった頃と、名前空間 `OscDesk.Receiver`・asmdef `OscDesk.Receiver`・スクリプトの GUID は変わらない。`OscReceiver` と `OscReceiverEditor` は `Assembly-CSharp` から専用のアセンブリ(`OscDesk.Receiver.Runtime` / `OscDesk.Receiver.Editor`)へ移った。`Assembly-CSharp` のスクリプトからはこれまでどおり参照でき、自前の asmdef からも `references` に `OscDesk.Receiver.Runtime` を足せば参照できるようになった
- EditMode テストが読む OSC のバイト列の見本は、リポジトリの `protocol/` を辿らずパッケージに同梱した写しを読む(利用側の `testables` でも通る)
