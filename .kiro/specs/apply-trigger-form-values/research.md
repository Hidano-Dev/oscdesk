# Research & Design Decisions

---
**Purpose**: 設計判断の根拠となった調査結果と、design.md に載せるには詳細すぎる比較・トレードオフを記録する。
---

## Summary
- **Feature**: `apply-trigger-form-values`
- **Discovery Scope**: Complex Integration(shared / bridge / mock-unity / NiceGUI UI / Unity C# の 5 か所と 3 言語にまたがるプロトコル変更)
- **Key Findings**:
  - OSC bundle のエンコードは `osc-codec` に既にあり(`encodeOscPacket` が bundle を受理、`timeTag.raw` を尊重)、欠けているのはブリッジの UDP 送信経路・`SendFn` 型・UI→ブリッジのまとまりフレームだけである。受信側は mock-unity(`responder.ts` `visitPacket`)も uOSC(`Parser.cs` が bundle を再帰展開して `Queue<Message>` へ順序どおり enqueue、`DotNet/Udp.cs` は `UdpClient.Receive` で 1 データグラムをそのまま受ける)も順序展開済みで、送信側だけを作ればよい。
  - ワイルドカード照合器は TS(`packages/mock-unity/src/staging.ts`)と C#(`OscSurfaceStaging.cs` `MatchesPattern` / `TrySplitAddress`)に同一規則で存在するが Python には無い。`shared` は `mock-unity` を import できない(依存の向き)ため、形検証と照合を `shared` へ移して mock-unity から再エクスポートする。
  - UI 側の再同期を壊す要因は 2 つある。(1) `state.py:242` の同一内容早期 return、(2) `seed_defaults` が値のあるチャネルを触らないこと。一方、`page.py` は `manifest_revision` が変わると全ウィジェットを作り直すため、同一内容の再採用で `manifest_revision` を進めてはならない(フォーカス・スクロールが失われる)。
  - `surface_link.py` の `_Outbox` は 256 フレームで古い順に捨てるため、64 スロット(値 256 件 + トリガ)を個別 `osc` フレームで送ると黙って欠ける。「1 セット = 1 WebSocket フレーム」は必須である。
  - `OscSurfaceBridge.cs` は `docs/UNITY_PROTOCOL.md` 付録 A.2.4 に全文が複製され、`tests/guards/appendix-source-parity.test.ts` が一致を機械検証する。C# の変更は付録の同時更新を伴う。

## Research Log

### bundle 配送の実現可能性(送信側・受信側)
- **Context**: Req 4.1〜4.5 で「値とトリガが分離して届かない」配送保証が要る。候補は bundle か、エコーバック全件確認か。
- **Sources Consulted**: `packages/osc-codec/src/osc-codec.ts`(`toOscJsPacket` が `timeTag.raw` を書く)、`packages/bridge/src/udp-transport.ts`(`send` は単一メッセージのみ)、`packages/mock-unity/src/responder.ts`(`visitPacket` の再帰展開)、`packages/mock-unity/src/server.ts`(`handlePacket` 後に `applyLog` を差分読みして `MOCK_UNITY_APPLY` を出す)、`OscSurface/Library/PackageCache/com.hecomi.uosc@…/Runtime/Core/DotNet/Udp.cs`、[uOSC Parser.cs](https://github.com/hecomi/uOSC)(bundle を再帰展開し順序どおり enqueue)、[osc.js README](https://github.com/colinbdclark/osc.js/blob/main/README.md)(bundle は `timeTag` + `packets`、即時送信)
- **Findings**:
  - osc.js の `writePacket` は `timeTag.raw = [seconds, fractions]` を持つ bundle をそのまま書く。OSC の「即時」タイムタグは `[0, 1]`。
  - uOSC は受信スレッドで `UdpClient.Receive` を呼び、.NET の内部受信バッファは 64 KiB なので 10 KB 程度の bundle は分断されず 1 つの `byte[]` として届く。`Parser` は bundle 長が 4 の倍数でない場合だけエラーにし、要素数・入れ子深さの上限は持たない。
  - mock-unity は `handlePacket(packet)` が bundle 全体を処理してから `applyLog` を読むため、bundle 内の値 → トリガの順で記録・適用され、`MOCK_UNITY_APPLY` は 1 行出る。
  - Windows の既定 `SO_RCVBUF` はキュー全体の容量であり、1 データグラムのサイズ上限ではない。ただし IP フラグメント(> MTU 1500)はルータやホストの設定で落ちることがあり、「同一 LAN でのみ使う」前提(product.md)を再確認しておく。
- **Implications**: bundle 配送を採用する。受信側の改修は不要。ブリッジ側で 1 データグラムの実用上限(60 KiB)を超えるセットは送らずに `notice` で返す(Req 4.7)。フラグメント喪失は「セット全体が落ちる」だけで「古い値が適用される」ことはない。

### bundle だけでは満たせない要求(Req 4.2 のエラー表示)
- **Context**: bundle は原子性を与えるが、データグラム自体の喪失は検出できない。Req 4.2 は「保証できないときはトリガを送らず、適用が行われなかったことをエラー表示」を求める。
- **Sources Consulted**: `state.py`(エコーバックは `values.on_echo` へ流れるだけで完了通知が無い)、`page.py`(`sync` が 20 Hz で `state.tick()` を呼ぶ = D-021)、`docs/UNITY_PROTOCOL.md` §4.3.1(トリガ自身も通常どおりエコーバックされる)
- **Findings**: トリガの on 値エコーは「bundle 全体が Unity に届き、展開・記録・適用判定まで到達した」ことの証拠になる(§4.3.1 の処理順序: エコーは適用イベントより先)。UI は bundle 送信時にトリガアドレスの期限を登録し、非ゼロエコーで解除、期限切れ(2 秒 = ping 間隔と同じ)で失敗通知を出せる。ブリッジは値の意味を知る必要がない(責務分離)。
- **Implications**: 「bundle 配送 + トリガエコー待ち(検出のみ)」を組み合わせる。失敗時に UI が再送はしない(操作者がもう一度押す)。通知は D-021 に従いページ側タイマーで `ui.notify` する。

### 同一内容マニフェスト再採用の識別
- **Context**: Req 5.1〜5.2。ブリッジは全 `/sys/manifest` を採用して `manifest` フレームを配信するが、再接続時・`manifestRequest` 時にはキャッシュを再送するため、UI が「同一比較を外す」だけだと再送でも `default` に戻ってしまう(採用時点の古い `default` で表示を上書きする逆方向の事故)。
- **Sources Consulted**: `surface-core.ts:150-176, 307-328`(採用と再送の 3 経路)、`manifest-client.ts`(2 秒間隔の要求、回復時に要求再開)、`surface_link.py:163-169`(再接続ごとに `request_manifest`)
- **Findings**:
  - ブリッジ側で採用ごとに単調増加する `seq` を付け、再送は同じ `seq` を持たせれば「新たな採用」だけを識別できる。
  - ブリッジ再起動で `seq` が 1 に戻ると、UI が保持する `seq` と偶然一致して新採用を取りこぼす可能性がある。`seq` に採用時刻 `at`(ISO 8601)を添えれば等値比較だけで区別できる(順序比較はしない)。
  - Unity 起動時は自発送信 + 要求応答で同一内容が 2 秒以内に 2 回採用されることがある。`seq` は 2 回進み UI は 2 回再同期するが、`default` は同一(または後者の方が新しい)なので冪等。UI がその間に送った値のエコーが先に届き、直後に古い `default` が来て表示が戻るレースは理論上あるが窓は数十 ms で、かつ「画面の値が適用される」不変条件は保たれる。
- **Implications**: `manifest` フレームに `adoption: { seq, at }` を必須で追加する。UI は `(seq, at)` の等値で再送を判定し、異なれば内容が同一でも `default` へ強制再同期する。内容が同一なら `manifest_revision` は進めず、値チャネルの `revision` だけを進めて再描画なしで表示を更新する。

### 編集中(ホールド中)入力の値の取り出し
- **Context**: Req 3.9 は編集中の input についても「画面に表示されている編集中の値」を送ることを求める。
- **Sources Consulted**: `widgets.py:176-189`(`on_value_change` は `begin_hold` を呼ぶだけで値を保持しない)、`value_store.py`(`ValueChannel.values` は確定値のみ)、`entry_rules.py`(`validate_input_confirmation` は純関数)、D-033
- **Findings**: 編集中の生値はウィジェット(ブラウザ側 `input_box.value`)にしかない。`on_value_change` の時点で state へ「下書き」を渡せば、state は送信せずに保持できる。下書きは確定(送信)・blur・ホールド期限切れ・切断で破棄する。下書きが `validate_input_confirmation` を通らない(pattern 違反・範囲外)場合は送れないため、除外して警告ログに残す(不正値を Unity へ送るよりも安全)。fader / xy はドラッグ中も `on_local` で `values` が更新されるため下書きは不要。表示キャッシュの `values` には `seed_defaults` 由来の Python `bool` がそのまま入りうる(`manifest.py:181`、`value_store.py:198`)ため、セットに載せる前にワイヤ型へ正規化しないとブリッジの `Int32Schema` で拒否される(設計レビューで Critical として指摘)。
- **Implications**: `ValueChannel` に `draft` と編集前値 `pre_edit_values` を追加し、`WidgetFactory` に `on_draft` コールバックを足す。`apply_set.py` は値の取り出し元を Protocol で抽象化し、`to_wire_args` で必ず `int` / `float` / `str` へ正規化してから pure なまま単体テストする。

### NiceGUI ブラウザテストでの pointerdown / pointerup
- **Context**: Req 8.4 は押下時の送信順序と件数、解放時の off 送信をブラウザテストで確認する。
- **Sources Consulted**: [NiceGUI testing docs](https://nicegui.io/documentation/section_testing)、`nicegui/testing/user_interaction.py`(`trigger(event)` は各要素の `_event_listeners` を `listener.type == event` で選んで呼ぶ)、`packages/nicegui-ui/tests/test_browser_input_events.py`(`UserInteraction(user, elements, label).trigger("keydown.enter")` の既存パターン)
- **Findings**: `_build_button` は `button.on("pointerdown", press)` / `button.on("pointerup", release)` で登録しているため、`UserInteraction.trigger("pointerdown")` / `trigger("pointerup")` がそのまま届く。`click()` は `click` リスナーだけを呼ぶので使わない。
- **Implications**: `test_browser_button_events.py` を `test_browser_input_events.py` と同じ骨格(FakeLink + `user_simulation`)で書ける。FakeLink に `send_osc_batch` を足す。

### 64 スロット相当マニフェストのサイズ
- **Context**: Req 7.2〜7.4。フォーク実測 51,136 B(64 スロット)に `appliesTo`(66 トリガ)と `staged: true`(256 エントリ)を足すとどうなるか。
- **Sources Consulted**: `packages/mock-unity/scripts/generate-large-scenario.mjs`(64 × 4 + Global 4 = 260 エントリ、`optionsRef` 前提)、`packages/mock-unity/src/scenario.test.ts:72-100`(共有参照で警告閾値未満、インライン展開で上限超過を回帰ガード)、`packages/shared/src/index.ts` `MANIFEST_SIZE`、DESIGN.md D-034
- **Findings**:
  - 概算: `,"staged":true` は 14 B × 256 = 3,584 B。`,"appliesTo":["/vp/member/01/*"]` は約 34 B × 64 + `/vp/member/*/*` 系 2 件 ≈ 2,250 B。合計約 5.8 KB 増で 57.0 KB 前後 → 現行警告 48 KiB(49,152)を大きく超え、フォーク採用の 56 KiB(57,344)にも接近する。実用上限 60 KiB(61,440)には収まる見込みだが、実測なしに断定しない。
  - 現行 48 KiB では 64 スロット構成が常時警告になり、警告が「閾値に近づいた」合図として機能しない(フォークが 56 KiB に上げたのは同じ理由)。
  - 既存 `large-input-select` シナリオの共有参照サイズ(約 40 KB)は閾値を上げても `< WARNING` の断言が壊れない。
- **Implications**: 警告閾値を 56 KiB に上げてフォークと揃える(D-038)。64 スロット相当のステージング付きシナリオを生成して `scenario.test.ts` で `< PRACTICAL_LIMIT` を回帰ガードし、実測値を DESIGN.md に記録する(実測が 56 KiB を超えても配信は継続し警告のみ = Req 7.5)。

### C# 変更の局所化と検証経路
- **Context**: Req 6.5〜6.6。`TryBuildManifestJson` はフォークで行番号がずれており、C# はテスト入口の外。
- **Sources Consulted**: `OscSurfaceBridge.cs:355-425`(`pattern` の後に `sb.Append('}')`)、`OscSurfaceManifestAsset.cs`(`Entry.staged` / `appliesTo` は既存フィールド)、`tests/guards/appendix-source-parity.test.ts`、`docs/VERIFICATION.md:269-280`(batchmode コンパイル手順)、メモリ `csharp-not-in-test-entry.md`
- **Findings**: 追加は `pattern` ブロック直後の 2 ブロック(`staged` と `appliesTo`)だけで済み、`TryGetValidatedAsset` が S1 を検証済みなので「button 以外に `appliesTo` を出さない」は既存の検証で担保される。フォーク側は同関数を文字列一致で再移植するため、既存行を書き換えず追記だけにする。
- **Implications**: C# 差分は追記 2 ブロック + 付録 A.2.4 の同期。コンパイル確認は `Unity.exe -batchmode -quit -nographics -projectPath … -logFile` で行い、結果を `docs/VERIFICATION.md` に記録する。

### E2E で適用値を検証する手段
- **Context**: Req 8.2 は「`MOCK_UNITY_APPLY` の件数と適用値が UI 側の表示値と一致」を求めるが、現在の行は `MOCK_UNITY_APPLY <trigger> <count>` で値を含まず、stderr は `ProcessHarness` から読めない。
- **Sources Consulted**: `packages/mock-unity/src/index.ts:118-120`、`tests/e2e/helpers/process.ts`(`stdoutSnapshot()` のみ)、`tests/e2e/bridge-loopback.e2e.test.ts`(mock 再起動パターン)
- **Findings**: 既存の行形式の末尾に JSON 配列を足せば前方互換(`^MOCK_UNITY_APPLY <addr> <n>` は保たれる)。`ProcessHarness` は stderr を `#logs` に既に蓄えているので `stderrSnapshot()` を足すだけでよい。`docs/VERIFICATION.md:195` の手動手順は期待値として旧形式の行を書いているため、新形式へ更新対象に含める。
- **Implications**: `MOCK_UNITY_APPLY /member/01/update 2 [{"address":"/member/01/name","value":"Zed"},…]` 形式へ拡張し、E2E は値まで照合する。Req 7.2 の「増分」実測は、生成スクリプトに `--without-staging` の対照出力を持たせて `with - without` の差を取る。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| A. 最小差分(既存モジュール内に分岐追加) | `state.py` / `surface-core.ts` に直接ロジックを足す | ファイル数が増えない | 照合・範囲解決が NiceGUI 依存モジュールに埋まり純粋テストが書けない。責務が混ざる | 却下 |
| B. 全面分離(新パッケージ / 新サブシステム) | 適用セット専用の層をブリッジ・UI 双方に新設 | 境界が明確 | ブリッジは値の意味を持たない規律に反する(セットの意味を知る層をブリッジに作ってしまう) | 却下 |
| **C. ハイブリッド(採用)** | 純粋ロジックを新モジュール(shared `address-pattern.ts`、UI `address_pattern.py` / `apply_set.py`)へ置き、既存の I/O 層(udp-transport / surface-core / state / widgets)は薄く拡張 | structure.md「純粋ロジックと I/O の分離」「機能ごとの 1 ファイル」に沿う。ブリッジは「複数メッセージを 1 bundle で送る」だけを知る | 新旧のモジュール間でルールの二重化が起きないよう配置に注意(`is_display_only` を pure 側へ移す) | 採用 |

## Design Decisions

### Decision: 配送方式は OSC bundle(1 データグラム)+ UI のトリガエコー待ち(検出専用)
- **Context**: Req 4.1〜4.7。
- **Alternatives Considered**:
  1. bundle のみ — 原子性は得るが喪失時に操作者へ知らせられない(Req 4.2 未達)
  2. エコーバック全件確認後にトリガ送信 — 257 件のエコー待ちと欠損時の再送制御が UI に必要になり、値の一部が Unity に届いた「中途半端な記録」状態が残る(適用はされないが staged 値は書き換わる)
  3. **bundle + トリガ on エコー待ち(採用)** — 原子性は bundle、通知はエコー待ち
- **Selected Approach**: UI は `oscBatch` フレーム 1 つでセットを送り、ブリッジは bundle 1 データグラムにして送る。UI はトリガアドレスの期限(固定 2 秒)を登録し、非ゼロエコーで解除、期限切れは「確認できなかった」として通知し(未適用の断定はしない)、ブリッジの `notice`(error: `batch-rejected` / `invalid-frame`)で即時失敗通知を出す。再送はしない。
- **Rationale**: 受信側(uOSC / mock)が順序展開済みで改修不要。ブリッジは値の意味を知らないまま「まとめて送る」だけで済む(責務分離)。トリガエコーは §4.3.1 の処理順序により「値の記録が済んだ後」に出るため完了の証拠として十分。
- **Trade-offs**: セット全体が MTU を超えると IP フラグメントになる(64 スロットで約 8〜10 KB)。同一 LAN 前提で許容し、60 KiB 超はブリッジが送らず `notice` で返す。
- **Follow-up**: 実 Unity(uOSC)で 64 スロット相当の bundle を受けて `ApplyRequested` が 1 回・値 256 件で発火することを VERIFICATION.md の手動手順で確認する。

### Decision: 2 秒タイムアウトは「未確認」の判定であり「未適用」の証明ではない(設計レビュー反映)
- **Context**: レビュー指摘。bundle が遅延して届いた場合、UI が「適用されなかった」と断定すると Unity が実際には適用しているのに操作者が再操作する、または逆に信じて放置する。
- **Alternatives Considered**:
  1. タイムアウトを延ばす — 待たされる時間が増えるだけで断定できないことは変わらない
  2. **固定 2 秒のまま「確認できなかった」と表示し、遅延エコーを `info` で補正(採用、ユーザー判断)**
- **Selected Approach**: 期限切れ通知は「2 秒以内に確認できなかった。画面と Unity の値を確認してほしい」に留める。期限切れトリガを 10 秒間保持し、その間に非ゼロエコーが届けば「遅れて確認されました」を `info` で出す。
- **Trade-offs**: 操作者に判断を委ねる場面が残るが、誤った断定よりは安全。
- **Follow-up**: `test_state.py` で 10 秒窓の内外を検証。

### Decision: ホールド中のエントリは編集前値を保持し、未確定で離れたら編集前値へ戻す(設計レビュー反映)
- **Context**: レビュー指摘。`seed_defaults(force=True)` がホールド中のチャネルを単に飛ばすと、Unity 再起動後に編集中だった input はホールド解除後も古い表示のまま残り、次の Update でその古い値が送られる。
- **Alternatives Considered**:
  1. ホールド解除時に `manifestRequest` で再同期 — ブリッジのキャッシュは採用時点の `default` なので必ずしも最新でなく、往復も要る
  2. ホールド中も表示を上書き — D-033 の「編集中に欄が書き換わらない」規律に反する
  3. **編集前値(`pre_edit_values`)をチャネルに保持し、ホールド中の `default` / echo はそこだけ更新。未確定で離脱・期限切れ・切断解放なら下書きを捨てて編集前値を表示へ戻す(送信なし)。確定して離脱なら従来どおり送信(採用、ユーザー判断)**
- **Selected Approach**: 上記 3。復帰はチャネル内で完結し値を返さないため `SurfaceState` の送信経路は変わらない。
- **Rationale**: 「Unity が真実の源」を保ちつつ、編集中の欄を勝手に書き換えない。表示と Unity の乖離が「編集を離れた時点」で必ず解消する。
- **Trade-offs**: `ValueChannel` の状態が 1 つ増える。`release_holds`(切断時)でも復帰するため、他端末の切断で表示が更新される場面がある(正しい値への更新なので許容)。
- **Follow-up**: `test_value_store.py` と `test_browser_button_events.py` で未確定 blur / 確定 blur の両経路を検証。

### Decision: 適用セットの送信値はワイヤ型へ正規化する(設計レビュー反映)
- **Context**: レビュー指摘(Critical)。`manifest.py:181` は `default` に Python `bool` を許し、`value_store.py:198` はそれを `values` に入れる。`ApplySet` が `values_of` をそのまま `{"type":"i","value":False}` で送ると、ブリッジの `Int32Schema`(`wire.ts:10`)が `false` を拒否し **`oscBatch` フレーム全体**が `invalid-frame` で破棄される。未編集の toggle を含むセット(= 本機能の中核ケース)が常に失敗する。
- **Selected Approach**: `to_wire_args` で `i`(bool 型含む)は `bool → int(0/1)`、数値は `int()`、`f` は `float()` に正規化する。`test_apply_set.py` に「`seed_defaults` 由来の bool default を含むセット」を必須ケースにし、`messages` に `bool` インスタンスが現れないことまで断言する。あわせて UI は `notice(code: invalid-frame)` でも pending を即時失敗にし、万一の型違反で 2 秒待たされないようにする。
- **Rationale**: 既存の単発送信 `_send` は toggle の値を widget 側で 0/1 にしてから渡しているため露呈しなかった。セット送信は表示キャッシュを直接読むので、境界で正規化するしかない。
- **Follow-up**: E2E の `staging.json` シナリオ(`/member/01/enabled` の `default: false`)で未編集 toggle を含むセットが `MOCK_UNITY_APPLY` に到達することを確認する。

### Decision: `staged: true` と `appliesTo` をワイヤに出す(トリガ / staged エントリだけ)
- **Context**: Req 1.4〜1.5, 1.10, 2.7, 7.1。
- **Alternatives Considered**:
  1. `appliesTo` のみ — 展開元(`/member/all/enabled` など)が適用範囲に一致したときに再送され、展開で staged 値が上書きされる
  2. **両方(採用)** — UI は `staged: true` のエントリだけを送る
- **Selected Approach**: zod は `staged: z.literal(true).optional()`、`appliesTo: z.array(string).min(1).optional()`(button 以外にあればスキーマ違反、各要素は §4.3.1 の形検証)。Unity / mock は staged エントリにだけ `staged:true`、`AppliesTo` 非空の button にだけ `appliesTo` を出す。
- **Rationale**: 非 staged への同値再送は冪等でも、展開元の再送は冪等でない。Unity 側の宣言をそのまま UI の判断根拠にできる。
- **Trade-offs**: 256 エントリで約 3.5 KB 増。`min(1)` により `appliesTo: []` は不採用になるが、参照実装も mock も空配列は出さない。
- **Follow-up**: `staged: false` を明示した旧 Unity が現れた場合はスキーマ違反になる(`literal(true)`)。互換性ノートに「出さない」規則として明記する。

### Decision: 採用識別は `manifest` フレームの `adoption: { seq, at }`
- **Context**: Req 5.1〜5.2, 5.5。
- **Alternatives Considered**:
  1. UI の同一比較を外す — 再接続・`manifestRequest` の再送でも `default` に戻り、他端末の操作で更新された表示を採用時点の値で上書きする
  2. `seq` のみ — ブリッジ再起動で 1 に戻り、UI 保持値と衝突しうる
  3. **`{ seq, at }`(採用)** — 等値比較だけで「同じ採用の再送」と「新たな採用」を区別できる
- **Selected Approach**: ブリッジは採用ごとに `seq` を 1 から単調増加させ、`at` に採用時刻(ISO 8601)を入れる。再送(UI 接続時・`manifestRequest`)は同じ `adoption` を付ける。UI は `(seq, at)` が前回と等しければ何もしない。異なれば `default` へ強制再同期し、内容が異なる場合だけ `manifest_revision` を進める。UI は切断で `(seq, at)` を捨てない(同じブリッジへの再接続で古い `default` に戻さない)。
- **Rationale**: 「新たな採用」の定義がブリッジ側の事実(採用イベント)と一致する。UI プロセス再起動時は保持値が無いので採用扱いになるが、これは現行挙動(キャッシュの `default` で初期化)と同じ。
- **Trade-offs**: 2 秒以内の重複採用で 2 回再同期する(冪等)。ブリッジのキャッシュ `default` は採用時点の値なので、UI プロセス再起動直後の表示は次のエコーまで古い可能性がある(現行と同じ既知の限界)。
- **Follow-up**: `link` フレームには `adoption` を足さない(UI が `link` から採用を推定しない)。

### Decision: 警告閾値を 56 KiB へ引き上げ、64 スロット相当をテストで実測する
- **Context**: Req 7.2〜7.5。概算 57 KB で現行 48 KiB を常時超える。
- **Alternatives Considered**:
  1. 48 KiB 維持 — 64 スロット構成で常時警告。警告が「近づいた」合図でなくなる
  2. **56 KiB(採用)** — フォークと一致。60 KiB までの余裕は 4 KiB(概ね 20 エントリ分)
  3. 52 KiB — 中間だがフォークとの差分が残る
- **Selected Approach**: `MANIFEST_SIZE.WARNING_BYTES = 56 * 1024`。ステージング付き 64 スロットシナリオ(`large-staging.json`)を生成し、`scenario.test.ts` で `< PRACTICAL_LIMIT_BYTES` を断言、実測バイト数を DESIGN.md D-038 と UNITY_PROTOCOL.md 互換性ノートに記録する。
- **Rationale**: 警告は運用者への合図であり、常時鳴る警告は無視される。フォークとの数値一致でマージ差分も減る。
- **Trade-offs**: 余裕が小さい。上限に近づいたときの逃げ道(エントリ削減・ラベル短縮・`optionsRef`)は既存の警告文にある。
- **Follow-up**: 実測が 56 KiB を超えていたら、その事実と「配信は継続する」ことを DESIGN.md に併記する。

### Decision: 照合器を `shared` に置き、Python は同一規則を写す。共有ケースは新規フィクスチャ
- **Context**: Req 2.1, 2.5。`protocol/staging-cases.json` は変更不可(Req 6.3)。
- **Alternatives Considered**:
  1. Python から `staging-cases.json` を読んで trigger 解決だけ検証 — フィクスチャ形式がステージングエンジン向けで、Python には不要な `receives` / `expected` を解釈する負担が大きい
  2. **新規 `protocol/address-pattern-cases.json`(採用)** — `{ pattern, address, matches }` の平坦なケース集。TS(shared)と Python が読む
- **Selected Approach**: TS の `isValidAddressShape` / `matchesPattern` を `packages/shared/src/address-pattern.ts` へ移し(mock-unity は再エクスポートで互換維持)、zod の `appliesTo` 検証にも使う。C# との一致は既存の `staging-cases.json`(TS エンジンと C# エンジンの双方が実行)で担保されるため、C# 側にフィクスチャを追加しない(推移的に Python ↔ TS ↔ C# が揃う)。
- **Rationale**: C# の変更を最小に保つ(Req 6.5)。`shared` は zod 以外に依存しない規律を守れる(純粋関数のみ)。
- **Trade-offs**: C# の照合器を直接 Python ケースで検証しない。将来 C# 側だけ規則が変わると `staging-cases.json` の失敗で検出される。
- **Follow-up**: ケース集には `//`、末尾 `/`、`?[]{},`、part 数不一致、`*` の 0 文字一致を必ず含める。

### Decision: 適用セットの上限は「512 メッセージ / 60 KiB」、超過はブリッジが送らずに `notice`
- **Context**: Req 4.7。
- **Selected Approach**: zod で `messages` を `min(1).max(512)`。ブリッジはエンコード後のバイト数が `OSC_BATCH.PRACTICAL_LIMIT_BYTES`(60 KiB)を超えたら送信せず、送信元 UI へ `notice(level: error, code: batch-rejected)` を返す。UI は該当トリガの待ちを即時失敗にする。
- **Rationale**: 分割送信は原子性を失うので行わない。上限の数値はマニフェストと同じ根拠(IPv4 UDP の実用上限)。
- **Trade-offs**: 512 件を超える範囲を持つ案件は本機能で扱えない(要件の 64 スロット = 257 件の 2 倍弱の余裕)。

### Decision: `is_display_only` を `entry_rules.py` へ移す
- **Context**: Req 2.4 の除外規則を pure モジュール(`apply_set.py`)から使いたいが、現在は `widgets.py`(nicegui import)にある。
- **Selected Approach**: 関数本体を `entry_rules.py` へ移し、`widgets.py` は import して使う(挙動不変)。
- **Rationale**: 表示専用判定を 2 か所に書かない。

## Risks & Mitigations
- IP フラグメント化した bundle が特定の LAN 機器で落ちる — トリガエコー待ちのタイムアウトで操作者に失敗を通知する。VERIFICATION.md に実機での 64 スロット確認を置く。
- 重複採用(自発送信 + 要求応答)の直後に UI の操作エコーが古い `default` で上書きされるレース — 窓が数十 ms で「画面の値が適用される」不変条件は保たれる。DESIGN.md に既知の限界として記録。
- `staged: false` を明示出力する非公式 Unity 実装がスキーマ違反になる — 互換性ノートに「非 staged には `staged` キーを出さない」を明記。
- `ws-protocol.e2e.test.ts:43` の `manifest` 断言は `toMatchObject`(部分一致)なので `adoption` 追加で壊れない(レビューで確認)。`adoption` 込みの断言を追加してもよい。
- 期限切れ通知が「未適用」と誤読される — 文言を「確認できなかった」に統一し、10 秒以内の遅延エコーは `info` で補正する(設計レビュー反映)。
- ホールド中に飛ばした再同期がホールド解除後も残る — `pre_edit_values` への記録と未確定離脱時の復帰で解消する(設計レビュー反映)。
- NiceGUI `ui.notify` を state 側から呼ぶと D-021 違反 — 通知は state のログ(seq 付き)に積み、各ページが `sync()` で自分のカーソル以降だけ表示する。
- 下書き値が不正(pattern / range 違反)なときの扱いで操作者が混乱する — 除外して警告ログ + 通知(「N 件を除外」)を出し、黙って落とさない。

## References
- [hecomi/uOSC](https://github.com/hecomi/uOSC) — bundle 自動展開・順序保持(Parser.cs)、`UdpClient.Receive` による受信(DotNet/Udp.cs)
- [osc.js README](https://github.com/colinbdclark/osc.js/blob/main/README.md) — bundle の `timeTag` / `packets` 構造と即時送信
- [NiceGUI Testing](https://nicegui.io/documentation/section_testing) — `user` フィクスチャと `UserInteraction.trigger`
- [UdpClient.Receive](https://learn.microsoft.com/en-gb/dotnet/api/system.net.sockets.udpclient.receive?view=net-8.0) — 受信データグラムを実サイズの配列で返す
- `docs/UNITY_PROTOCOL.md` §2 / §3 / §4.3.1 / 互換性ノート、`docs/BRIDGE_PROTOCOL.md`、`DESIGN.md` D-021 / D-033 / D-034
