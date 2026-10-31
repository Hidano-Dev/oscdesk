# UPM_PACKAGE.md - Unity の受け口パッケージ(`com.hidano.oscdesk`)の版と公開

> Unity 側の汎用の受け口 `OscReceiver` を、npmjs のスコープ付きレジストリから入れられる UPM パッケージとして配る手順。判断の背景は DESIGN.md D-096、使い方はパッケージの `README.md` と `docs/UNITY_PROTOCOL.md` §5 を参照する。
>
> **セキュリティ前提**: 受け口に認証・暗号化はない。パッケージを公開しても、受け口を使う Unity は信頼できる LAN 内でだけ動かし、インターネットや信頼できないネットワークへ公開してはならない。

## 置き場所

パッケージの本体は `OscSurface/Packages/com.hidano.oscdesk/`(`OscSurface` の埋め込みパッケージ)にある。`OscSurface` はこのパッケージを使う検証用の Unity プロジェクトで、manifest の `testables` で EditMode テストを Test Runner と Unity CI に出す。

| パス | 内容 |
|---|---|
| `package.json` | 名前・版・`unity`(6000.0)・サンプルの宣言 |
| `Runtime/Core/` | asmdef `OscDesk.Receiver`(`UnityEngine` 非依存の中核) |
| `Runtime/` | asmdef `OscDesk.Receiver.Runtime`(`OscReceiver`) |
| `Editor/` | asmdef `OscDesk.Receiver.Editor`(インスペクタ拡張) |
| `Tests/Editor/` | asmdef `OscDesk.Receiver.Tests` と、`protocol/osc-binary-samples.json` の写し |
| `Samples~/MinimalReceiver/` | 最小の受け口シーンと、それに合うサーフェス定義 |
| `README.md` / `CHANGELOG.md` | 導入・構成・版と契約の対応 / 版ごとの変更 |

`tests/guards/unity-package.test.ts`(`corepack pnpm test`)が、見本の写しが `protocol/` の原本と同じこと、すべてのファイルとフォルダに `.meta` があること(`Samples~` の下のフォルダを除く)、`package.json` の版が CHANGELOG の先頭の版と同じこと、サンプルの定義が OscDesk に受理されることを確かめる。`protocol/osc-binary-samples.json` を変えたら写しも更新する。

## 版の付け方

- [Semantic Versioning](https://semver.org/lang/ja/)。Unity との契約(`docs/UNITY_PROTOCOL.md`)の Unity 側の振る舞いを互換でなく変える変更(アドレス・引数の形・エコーの規則、公開 API やシリアライズするフィールドの削除・改名、スクリプトの GUID の変更)は major、互換を保つ機能追加は minor、修正は patch
- 版を上げる PR で、`package.json` の `version`、`CHANGELOG.md` の先頭の節(`## [x.y.z] - YYYY-MM-DD`)、`README.md` の「版と契約の対応」を同時に直す。契約を変えた場合は `docs/UNITY_PROTOCOL.md` の互換性ノートにも書く
- 公開した版の中身は変えない(npmjs は同じ版を再公開できない)。直すときは次の版を出す

## npmjs への公開(手動)

公開はリポジトリの外へ出る操作なので、エージェントは行わず、パッケージの所有者が手で行う。npm のトークンはリポジトリ・CI のシークレットに置かず、公開する人の手元(`npm login` が書く利用者の `~/.npmrc`)にだけ置く。タグ起点で GitHub Actions から公開する方式は、トークンを CI のシークレットに置くことになるので採っていない(後で採るなら別の Issue で判断する)。

### 初回だけ

1. **ライセンスを決める**。リポジトリにも本パッケージにもライセンスがまだ無い。決めたら `OscSurface/Packages/com.hidano.oscdesk/LICENSE.md`(と必要ならリポジトリ直下の `LICENSE`)を足し、`package.json` に `"license"` を書き、パッケージの README の「ライセンス」節を直す(`LICENSE.md.meta` は Unity で開いて作らせる)
2. npmjs のアカウント(`com.hidano.*` を公開している所有者)で 2 要素認証を有効にしておく。`com.hidano.oscdesk` は未使用の名前(2026-10-31 時点で `npm view` が 404)

### 毎回

1. 版を上げる PR(上の「版の付け方」)を `main` へマージする。Unity CI の EditMode テストが緑であること
2. マージ後の `main` を、未追跡ファイルの無い作業ツリーで取り出す(`git status` が空。Unity が作った一時ファイルや `.meta` の取り残しを含めない)
3. 中身を確かめる:

   ```powershell
   cd OscSurface/Packages/com.hidano.oscdesk
   npm pack --dry-run
   ```

   一覧に `package.json`・`README.md`・`CHANGELOG.md`・(ライセンスを決めた後は)`LICENSE.md`、`Runtime/` `Editor/` `Tests/` `Samples~/` の `.cs` と `.meta` が並び、版が意図どおりで、`Library/` やログなど余計なものが無いことを確かめる。レジストリから入れたパッケージは読み取り専用で Unity が `.meta` を作れないので、`.meta` の欠けは利用側で「ファイルが無視される」障害になる

4. 公開する:

   ```powershell
   npm login            # 初回か期限切れのときだけ。トークンは手元の ~/.npmrc に入る
   npm publish --otp <2 要素認証のコード>
   ```

5. タグを打つ(公開した版を後から追えるように): `git tag com.hidano.oscdesk/v<版>` → `git push origin com.hidano.oscdesk/v<版>`
6. 確かめる: `npm view com.hidano.oscdesk versions` に版が出る。空の Unity 6000.0 プロジェクトに README の「導入」のとおりスコープ付きレジストリと依存を足し、`OscReceiver` を置いて再生し、OscDesk(`start-oscdesk.bat`、mock-unity なし)の画面で到達性が「接続中」になり、サンプルの定義を読み込んで操作した値が Console に出ることを確かめる(`docs/VERIFICATION.md` の HID-354)

## 利用側の更新

利用側は `Packages/manifest.json` の `com.hidano.oscdesk` の版を上げるだけでよい。major が上がった版は、CHANGELOG と `docs/UNITY_PROTOCOL.md` の互換性ノートの移行手順を先に読む。
