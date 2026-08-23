# Requirements Document

## Project Description (Input)
Unity 側参照実装(OscSurface/Assets/OscSurfaceBridge の OscSurfaceBridge / OscSurfaceManifestAsset)に「蓄えて Update で適用」のステージング機能を追加する。要件の出所はフォーク側からの upstream 開発要件書 docs/LEGACY_PRESET_REQUIREMENTS.md の §6.3(R3)。レガシー版 VP_OscClient の「Update ボタンを押した時だけキャラクターへ反映」という運用感を、ワイヤプロトコル無改造(マニフェスト version 1 のまま)で再現する。必須要件: (1) マニフェストエントリのアセット定義に「ステージング対象」(staged: bool 案)と button エントリの「適用トリガ」(applies: 対象アドレス接頭辞/グループ案)を宣言でき、C# を書き換えずアセット定義だけでステージング構成を組めること(案件差分はコードでなくデータの規律)。(2) ステージング対象アドレスの値受信時はステージング領域に保持しつつ同一アドレスへ通常どおりエコーバックし(UI 表示確定は即時、キャラクター適用のみ遅延)、currentValues もステージング値で更新して再接続時の UI がステージング状態を復元できること。(3) 適用トリガ(button)受信で対象範囲のステージング値をアプリへ適用するコールバック/イベントを発火する(適用処理自体はアプリ固有実装に委ねる)。(4) 一括操作: あるステージング対象アドレス(例 /vp/all/active)の受信を複数アドレス(例 /vp/member/{NN}/active)への書き込みに展開でき、展開先の各アドレスへも個別にエコーバックして UI の各ウィジェットが追従できること。展開規則もアセット定義で宣言できること。(5) 適用前のステージング値と適用済み値の乖離を許容し、マニフェストの default はステージング値を返すこと。変更対象: Unity 参照実装(OscSurfaceManifestAsset / OscSurfaceBridge)、mock-unity のステージング挙動模擬(フォーク側 E2E の前提)、docs/UNITY_PROTOCOL.md(§4 実装指針・付録 A・互換性ノート)。既存規律の維持: Unity が真実の源 / 値の確定はエコーバックのみ / OSC 1.0 基本型タグのみ。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
