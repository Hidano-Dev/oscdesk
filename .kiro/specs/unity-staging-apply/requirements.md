# Requirements Document

## Project Description (Input)
unity-staging-apply: Unity 側参照実装(OscSurface/Assets/OscSurfaceBridge/ の OscSurfaceBridge / OscSurfaceManifestAsset)に「受信値を蓄えて Update ボタン受信時にアプリへ適用する」ステージング機能を追加する。ワイヤプロトコルは無改造(マニフェスト version: 1 のまま)で、UI から見れば通常のエコーバック付き送信と区別がつかない設計により、既存の UI・ブリッジ・プロトコルを一切変えずにレガシー(VP_OscClient)の「Update ボタンを押した時だけ反映」という運用感を再現する。ステージング構成(対象・適用トリガ・一括操作の展開規則)は C# を書き換えずアセット定義だけで宣言できること。mock-unity へのステージング挙動の模擬と docs/UNITY_PROTOCOL.md への追記を含む。要件の正は docs/LEGACY_PRESET_REQUIREMENTS.md §6.3(R3)。詳細な背景・決定済み事項・スコープ・未決事項は .kiro/multi-spec/legacy-preset-upstream.md の「全体コンテクスト」「共通の決定済み事項」「Spec: unity-staging-apply」の各節に記載されており、requirements 生成・dig インタビュー・design の前提として必ず読み込むこと。関連 spec: .kiro/specs/manifest-input-select-widgets/ も参照(同一ファイル docs/UNITY_PROTOCOL.md・mock-unity・OscSurfaceBridge/*.cs を変更するため)。

## Requirements
<!-- Will be generated in /kiro-spec-requirements phase -->
