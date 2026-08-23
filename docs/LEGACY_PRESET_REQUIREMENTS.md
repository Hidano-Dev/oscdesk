# LEGACY_PRESET_REQUIREMENTS.md — レガシー版再現プリセットと upstream 開発要件

> 本書は 2 つの役割を持つ。
>
> 1. **upstream(OscDesk 本体)への開発要件**: レガシー版 VP_OscClient の再現に必要な 3 機能(input ウィジェット / select ウィジェット / Unity 側ステージング)の要件定義。本書単体で upstream へ渡せるよう、前提と背景を自己完結で記す。
> 2. **本フォーク側のデフォルトプリセット仕様**: upstream 実装完了後に本フォークで作成するデフォルトプリセット(マニフェスト定義 + mock-unity シナリオ)の正となる定義。
>
> 作成日: 2026-08-23。レガシー版の調査対象: `D:\Activ8\UnityProjects\BasicConcertDevelopment_URP\VP_OscClient`(WinForms / .NET 8 / Rug.Osc / MemoryPack / NAudio)。

## 1. 背景と目的

レガシー版「Activ8 OSC Client」(VP_OscClient)は、コンサート運用で Unity アプリ内のメンバー(キャラクター)スロットを操作する Windows デスクトップアプリである。本フォークではこれを OscDesk の `/sys/*` マニフェスト方式(`docs/UNITY_PROTOCOL.md`)の上で再現し、実運用可能なデフォルトプリセットとする。

レガシー版のプロトコル(MemoryPack blob を `/vp_member` 等で送る方式、ポート 3578/3579)は **引き継がない**。Unity 側をマニフェスト方式へ移行する前提で、値は素の OSC 型 + 同一アドレスへのエコーバックで扱う(確定済み判断。§3)。

## 2. レガシー版の要素目録(再現対象の正)

### 2.1 画面要素

| 要素 | 内容 | 既定値・挙動 |
|---|---|---|
| メンバースロット行(初期 1、`HostInfo` 受信で動的増加、最大 100) | Active チェックボックス | 初期 off。「All」で一括切替 |
| 〃 | キャラクター名(読取専用テキスト) | Unity からの `HostInfo.MemberNames` で自動充填 |
| 〃 | Facial Client IP(テキスト入力) | 初期 `127.0.0.1`。IPv4 形式を UI 側で正規表現検証し、不正値は反映しない |
| 〃 | LipSync Device(ドロップダウン) | ローカル録音デバイス(NAudio 列挙)と `HostInfo.AudioDeviceNames` のマージ。デバイスなしは `"Not Found!"` |
| 〃 | Update ボタン | 押下時のみスロット全フィールドを Unity へ送信 |
| ヘッダ | All チェックボックス | 全スロットの Active を一括切替(ローカル状態のみ。送信は Update 時) |
| 〃 | Update All ボタン | 全スロットを一括送信 |
| MotionBuilder 設定 | MB Address(テキスト) / MB Port(数値テキスト) / MB Sync ボタン | 既定 `192.168.101.11` : `22000`。MB Sync 押下時のみ送信。前回値を設定に保存 |
| 宛先 IP コンボボックス | 送信先 Unity ホストの選択(ブロードキャスト `192.168.x.255` / 直接 IP / `127.0.0.1`) | `HostInfo.PcIpAddress` から候補生成 |

### 2.2 レガシープロトコル(参考。引き継がない)

| 方向 | アドレス | 内容 |
|---|---|---|
| Client → Unity(port 3578) | `/vp_member` | MemoryPack blob: `SlotInfo { IsEnable: bool, Name: string, Index: int, IP: string, Lip: string }` |
| Client → Unity(port 3578) | `/vp_mbaddress` | MemoryPack blob: `MotionBuilderInfo { ipAddress: string, port: int }` |
| Unity → Client(port 3579) | `/vp_host_info` | MemoryPack blob: `HostInfo { MemberNames: string[], PcIpAddress: string, AudioDeviceNames: string[] }` |

### 2.3 レガシー版のその他の挙動

- スロット状態(名前・IP・デバイス・Active・宛先 IP)を `%LOCALAPPDATA%\VP_OscClient\member_slot_state.json` に保存し、次回起動時に復元。
- メンバー名は NFC 正規化 + trim、最大 128 文字。デバイス名は最大 256 文字、最大 100 件、重複除去。
- コマンドライン `-members "A,B,C"` によるメンバー名指定(実運用では `HostInfo` 経路が主)。

## 3. 確定済みの設計判断

| # | 論点 | 判断 |
|---|---|---|
| D-L1 | プロトコル | **新プロトコル(`/sys/*` マニフェスト + 素の OSC 値 + エコーバック)に統一**。Unity 側を移行する。MemoryPack blob 互換は実装しない |
| D-L2 | メンバー名・デバイス一覧の供給 | レガシーの `HostInfo` に代わり、**Unity 発のマニフェスト**が担う(ラベル・group・select の選択肢として) |
| D-L3 | 更新タイミング | **Unity 側ステージング方式**。各フィールドは OscDesk 流に即時送信するが、Unity は受信値をステージング領域に保持するだけで、`…/update` ボタン受信時にキャラクターへ適用する(§6.3) |
| D-L4 | スロット数 | デフォルトプリセットは **64 スロット**(数十体の同時操作を想定) |
| D-L5 | マニフェストサイズ | 64 スロット分(概算 24〜30KB)は**単一 UDP データグラムで送る(容認)**。有線 LAN / 同一ホスト運用を前提とし、不成立時は既存の 2 秒間隔自動再要求で回復する。Wi-Fi 等で不安定が実測されたら、その時点でマニフェスト分割(チャンク)拡張を別途起案する |
| D-L6 | LipSync Device | select ウィジェット(§6.2)を upstream で実装し、プリセットに含める |
| D-L7 | 実装の場所 | input / select ウィジェットと Unity 側ステージングは **upstream(OscDesk 本体)で開発**する。本フォークはプリセット(データ)と mock-unity シナリオを担当する |

再現しない要素(スコープ外):

- **宛先 IP コンボボックス・ブロードキャスト送信** — OscDesk では宛先は config(`unity.host` : `unity.sendPort`)/起動引数の責務。レガシーの `192.168.{x}.255` 固定ブロードキャストは引き継がない。
- **UI 側のローカル状態保存**(`member_slot_state.json` 相当)— 「Unity が真実の源」の規律に従い、再接続時の表示復元はマニフェストの `default`(Unity の現在値 = ステージング値)が担う。
- **UI 側のローカルオーディオデバイス列挙**(NAudio)— ブラウザ UI では不可能。デバイス一覧は Unity がマニフェストで供給する。
- **コマンドライン `-members` 指定** — マニフェスト定義(Unity 側アセット)で代替。

## 4. デフォルトプリセット仕様(本フォーク側)

### 4.1 アドレス設計

スロット番号は `01`〜`64` のゼロ埋め 2 桁。

| アドレス | type | widget | range / options | 既定値 | group |
|---|---|---|---|---|---|
| `/vp/member/{NN}/active` | `bool` | `toggle` | — | `0` | `{NN} {メンバー名}` |
| `/vp/member/{NN}/ip` | `s` | `input` | — | `127.0.0.1` | 〃 |
| `/vp/member/{NN}/lip` | `s` | `select` | オーディオデバイス一覧 | 一覧の先頭 | 〃 |
| `/vp/member/{NN}/update` | `i` | `button` | — | — | 〃 |
| `/vp/all/active` | `bool` | `toggle` | — | `0` | `All Members` |
| `/vp/all/update` | `i` | `button` | — | — | `All Members` |
| `/vp/mb/address` | `s` | `input` | — | `192.168.101.11` | `MotionBuilder` |
| `/vp/mb/port` | `i` | `input` | `[1, 65535]` | `22000` | `MotionBuilder` |
| `/vp/mb/update` | `i` | `button` | — | — | `MotionBuilder` |

- メンバー名は group 文字列に含めて表示する(レガシーの読取専用「キャラクター名」欄の代替)。Unity 側マニフェスト定義でメンバー名を差し替えるだけで UI に反映される。
- `projectId` は案件ごとに Unity 側アセットで定める。デフォルトプリセット(mock-unity シナリオ)では `vp-concert-default` とする。

### 4.2 ステージングと適用の対応(レガシー挙動との対応表)

| レガシー操作 | 新方式での流れ |
|---|---|
| スロットの値を編集 | 各フィールドを即時送信 → Unity はステージング保持 + 同一アドレスへエコーバック(表示確定) |
| Update(スロット単位) | `/vp/member/{NN}/update` 送信 → Unity が当該スロットのステージング値をキャラクターへ適用 |
| Update All | `/vp/all/update` 送信 → Unity が全スロットを適用 |
| All チェック | `/vp/all/active` 送信 → Unity が全スロットのステージング `active` を書き換え、各 `/vp/member/{NN}/active` へエコーバック(UI の各トグルが追従) |
| MB Sync | `/vp/mb/update` 送信 → Unity がステージング済みの MB address/port を適用 |

### 4.3 マニフェストサイズ試算

| 構成 | 概算サイズ | 備考 |
|---|---|---|
| 64 スロット × (active + ip + update) + グローバル | 24〜30KB | D-L5 で容認済み |
| + select(選択肢を各エントリにインライン格納) | **50〜55KB** | デバイス 8 件 × 平均 20 文字想定で選択肢が 64 回重複。実用上限 ~60KB すれすれで、デバイス名次第で超過リスク |
| + select(選択肢をマニフェストレベルで共有参照) | 30〜32KB | §6.2 の `optionsRef` 採用時 |

**インライン格納は 64 スロット構成では実用上限に接触しうるため、§6.2 の共有参照機構を強く推奨する。**

## 5. upstream 要件の前提(共通)

- 対象リポジトリ構成は OscDesk 本体(bridge / nicegui-ui / shared / mock-unity / osc-codec、および `docs/UNITY_PROTOCOL.md` 付録 A の uOSC 参照実装)。
- ワイヤプロトコル(UI ↔ ブリッジの WebSocket、`WireArgSchema`)は既に `s`(文字列)引数の送信に対応しており、**ブリッジ本体の改造は不要**の見込み。変更対象はマニフェストスキーマ(`packages/shared` の zod と Python 側ミラー)、NiceGUI ウィジェット層、mock-unity、Unity 参照実装(`OscSurfaceManifestAsset` の enum と `OscSurfaceBridge`)、`docs/UNITY_PROTOCOL.md`。
- 既存の規律を維持すること: Unity が真実の源 / 値の確定はエコーバックのみ / OSC 1.0 基本型タグのみ(`s` で送る) / 任意フィールドは値がないときキーごと省略し `null` を書かない。
- スキーマ変更はマニフェスト `version: 1` のまま後方互換で行う(既存ウィジェットのみのマニフェストは従来どおり受理される。新 widget 値を知らない旧 UI が受けた場合の挙動は upstream 判断でよいが、検証エラーで全体を不採用にするのが現行流儀)。

## 6. upstream 開発要件

### 6.1 R1: 編集可能な入力ウィジェット `widget: "input"`

現行 UI は `text` ウィジェットが表示専用であり、文字列(`s`)型を操作系ウィジェットに割り当てても表示専用に落とされる(`INTERACTIVE_VALUE_TYPES = ("i", "f", "bool")`)。レガシー再現に必須の「Facial Client IP 入力」「MB Address / Port 入力」が現行では表現できないため、編集可能な入力ウィジェットを追加する。

**必須要件:**

1. マニフェストスキーマの `widget` enum に `"input"` を追加する(zod `ManifestEntrySchema` と Python 側ミラーの両方)。
2. 対応する `type` は `s` / `i` / `f`。`s` は文字列入力、`i` / `f` は数値入力として描画する。
3. 送信タイミングは**確定時**(Enter キーまたはフォーカス喪失)とする。1 キーストロークごとに送信しない(レガシーの「入力途中の値を飛ばさない」意図、およびエコーバック確定の規律と整合させるため)。
4. 送信タグは `type` に従う(`s` → `s` タグ、`i` → `i` タグ 0/1 でなく整数値、`f` → `f` タグ)。`i` は int32 の値域チェックを UI 側で行う(ブリッジの `WireArgSchema` は逸脱を拒否する)。
5. エコーバックの規律: 編集中(フォーカス保持中)は受信値で入力欄を上書きしない。確定・フォーカス喪失後の受信値で表示を確定する(既存 fader の hold 機構と同等の保護)。
6. `default` は入力欄の初期値として表示に反映する(既存の値同期規律どおり、反映時に送信は発生させない)。
7. `type: "i"` かつ `range` があるときは範囲外入力を UI 側で拒否またはクランプする(例: ポート番号 `[1, 65535]`)。

**任意要件(あると望ましい):**

8. 書式検証の宣言手段(例: エントリに `pattern`(正規表現文字列)を追加し、不一致の入力は確定させない)。レガシーは IPv4 形式を UI 側で検証していた。見送る場合、形式不正の値も Unity へ送られるため、Unity 側ステージング(R3)で不正値を無視できることを前提とする。

### 6.2 R2: 選択式ウィジェット `widget: "select"`

レガシーの LipSync Device ドロップダウン(オーディオデバイス選択)を再現する。選択肢は Unity がマニフェストで供給する(レガシーの `HostInfo.AudioDeviceNames` と同じ役割)。

**必須要件:**

1. マニフェストスキーマの `widget` enum に `"select"` を追加する。
2. 対応する `type` は `s`(選択された選択肢の文字列をそのまま `s` タグで送信する)。
3. 選択肢の宣言手段を追加する。**次の 2 形態の併存を推奨**する:
   - `options: string[]` — エントリにインライン格納(少数エントリでの簡便さ)。
   - `optionsRef: string` + マニフェストトップレベルの `optionLists: { [key]: string[] }` — 同じ選択肢を多数のエントリで共有する参照形式。**64 スロットが同一のデバイス一覧を参照するプリセットでは、インライン格納だとマニフェストが 50〜55KB に膨らみ単一データグラムの実用上限(~60KB)に接触しうるため、共有参照が実質必須**(§4.3)。
   - 1 エントリに両方があるときの優先、参照先キー欠落時の扱い(エントリ不正としてマニフェスト全体を不採用にするのが現行流儀)は upstream で定義する。
4. 選択操作で即時送信し、エコーバックで表示を確定する(toggle と同じ discrete 系の扱い)。
5. `default` は選択肢のいずれかであることを期待する。選択肢にない `default`・選択肢にないエコーバック値を受けた場合は、選択を変えずに受信値を表示できる形(または未選択表示)へ落とし、マニフェスト全体は不採用にしない。
6. 選択肢の変化(デバイスの抜き差し等)はマニフェスト再送で反映する(既存の「採用は冪等」「回復時再要求」の仕組みに乗る。専用の差分プロトコルは追加しない)。
7. 空の選択肢配列の扱いを定義する(レガシーは `"Not Found!"` を 1 件入れていた。UI 側で「選択肢なし」を表示できるならそれでもよい)。

### 6.3 R3: Unity 側ステージング(「蓄えて Update で適用」)

レガシーの「Update ボタンを押した時だけ反映」という運用感を、プロトコル無改造で再現するための Unity 側機能。参照実装(`docs/UNITY_PROTOCOL.md` 付録 A の `OscSurfaceBridge` / `OscSurfaceManifestAsset`)への追加として upstream で開発する。

**必須要件:**

1. マニフェストエントリに「ステージング対象」と「適用トリガ」を宣言できる仕組みを追加する。案: エントリのアセット定義に `staged: bool`(受信値をステージング領域へ保持し、即時適用しない)と、button エントリに `applies: string`(適用対象のアドレス接頭辞またはグループ)を持たせる。宣言形式は upstream 設計に委ねるが、**案件差分はコードでなくデータ**の規律に従い、C# を書き換えずにアセット定義だけでステージング構成を組めること。
2. ステージング対象アドレスの値を受信したとき: ステージング領域に保持し、**同一アドレスへ通常どおりエコーバック**する(UI の表示確定は即時。キャラクターへの適用のみ遅延)。`currentValues`(マニフェスト `default` の供給源)もステージング値で更新し、再接続時の UI がステージング状態を復元できるようにする。
3. 適用トリガ(button)の受信で、対象範囲のステージング値をアプリケーション(キャラクター等)へ適用するコールバック/イベントを発火する。適用処理自体はアプリ固有実装に委ねる。
4. 一括操作: あるステージング対象アドレス(例 `/vp/all/active`)の受信を「複数アドレスへの書き込み」に展開できること。展開先の各アドレス(例 `/vp/member/{NN}/active`)へも**個別にエコーバック**し、UI の各ウィジェットが追従できるようにする。展開規則もアセット定義で宣言できること。
5. 適用前のステージング値と適用済み値が乖離している状態を許容する(レガシーと同じ)。マニフェストの `default` はステージング値を返す。

**本フォークのプリセットが前提とする具体構成**(§4.2): `/vp/member/{NN}/*` がステージング対象、`/vp/member/{NN}/update` が当該スロットの適用トリガ、`/vp/all/update` が全スロット適用、`/vp/all/active` が全スロット `active` への展開書き込み、`/vp/mb/*` がステージング対象で `/vp/mb/update` が適用トリガ。

### 6.4 非機能要件

1. **描画性能**: デフォルトプリセットは約 260 エントリ(64 スロット × 4 + グローバル)。NiceGUI 版 UI がこの規模で実用的に描画・操作できること(必要ならグループの折りたたみ・遅延描画などは upstream 判断)。
2. **マニフェストサイズ**: 共有参照(§6.2-3)採用時のプリセットは概算 30〜32KB。単一データグラム容認の判断(D-L5)は本フォーク側の運用判断であり、upstream の推奨値(~1.4KB)の変更は要求しない。
3. **文書**: `docs/UNITY_PROTOCOL.md` の §2(スキーマ)・§4(実装指針)・付録 A、および互換性ノートへ、input / select / optionLists / ステージングの追記を行う。

## 7. 今後の進め方

1. 本書 §6 を upstream へ提出し、input / select / ステージングを upstream で実装する。
2. upstream 実装の完了後、本フォークで以下を行う(Kiro スペック化を想定。validate 系タスクは Codex に委譲):
   - デフォルトプリセットの Unity 側マニフェストアセット(64 スロット、§4.1)を作成する。
   - mock-unity にプリセット相当のシナリオ(ステージング挙動の模擬を含む)を追加し、ブリッジ〜UI の E2E テストを整備する。
   - `docs/VERIFICATION.md` へ手動検証手順を追記する。
   - 単一データグラム容認(D-L5)の判断を `docs/UNITY_PROTOCOL.md` の互換性ノートへ記録する。
3. BasicConcertDevelopment_URP 側の受け側実装(ステージング適用先)は、参照実装 + アセット定義を移植して構成する。
