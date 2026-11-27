// ネットワークのタブの画面(D-113・D-153)。状態は network-store の signal を読むだけで、文と入力の出し入れは network-logic に置く。
// 入力欄は下書き(無ければブリッジの設定)を描く。ほかのブラウザの保存で設定が届き直しても、入力中の値は消えない
import { NETWORK_SETTINGS } from '@oscdesk/shared'

import { interfaceOptions, SOURCE_LABELS } from './network-logic'
import type { NetworkStore } from './network-store'

export function NetworkPanel({ store }: { store: NetworkStore }) {
  const frame = store.frame.value
  const inputs = store.inputs.value
  const peer = store.peer.value
  const connected = store.connected.value
  return (
    <section class="panel network" aria-label="ネットワーク">
      <header class="panel-head">
        <h2>ネットワーク</h2>
        <span class="caption">{frame === null ? 'ブリッジから設定が届くのを待っています' : `状態: ${SOURCE_LABELS[frame.source]}`}</span>
      </header>
      <p class="caption">
        OscDesk のサーバー(ブリッジ)が使うネットワークの設定です。どのブラウザから変えても、すべてのブラウザに反映されます。
        許可リストは認証の代わりではありません。信頼できる LAN の中だけで使ってください。
      </p>
      <p class="caption">このブラウザ: {peer ?? '不明'}</p>
      {frame !== null && inputs !== null && (
        <>
          <fieldset class="field">
            <legend>サーバーが使うネットワーク(ターゲット向け)</legend>
            <p class="caption">
              Unity との送受信に使うこの PC のアドレスです。ブラウザとの接続は常にすべてのネットワークで受けるので、変えても切れません。
              特定のアドレスを選ぶと、同じ PC の Unity が 127.0.0.1 へ返す応答は届かなくなります(同じ PC の Unity だけなら localhost を選びます)。
            </p>
            {interfaceOptions(frame, inputs).map((option) => (
              <label class="check" key={option.value}>
                <input
                  type="radio"
                  name="network-target-interface"
                  value={option.value}
                  checked={inputs.targetInterface === option.value}
                  onChange={() => store.edit({ targetInterface: option.value })}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>

          <label class="field">
            <span class="field-title">ターゲットがいる範囲</span>
            <span class="caption">
              1 行に 1 つ、IPv4 の CIDR(例 192.168.1.0/24)で書きます。空なら自動(この PC のネットワークそのまま)。送信先パネルの走査と、個別に選べる端末をこの範囲に絞ります。
            </span>
            <textarea
              rows={2}
              placeholder="自動"
              maxLength={NETWORK_SETTINGS.MAX_TARGET_RANGES * (NETWORK_SETTINGS.MAX_CIDR_CHARS + 1)}
              value={inputs.targetRanges}
              onInput={(event) => store.edit({ targetRanges: event.currentTarget.value })}
            />
          </label>

          <label class="field">
            <span class="field-title">接続してよいブラウザの範囲</span>
            <span class="caption">
              1 行に 1 つ、CIDR かアドレス(例 192.168.1.0/24、192.168.1.30)で書きます。空ならこの PC の localhost だけ。この PC の localhost(http://localhost:…)からは、どの設定でも常に接続できます。
              このブラウザが範囲の外になる変更は、ブリッジが断ります。
            </span>
            <textarea
              rows={3}
              maxLength={NETWORK_SETTINGS.MAX_ALLOWED_BROWSERS * (NETWORK_SETTINGS.MAX_CIDR_CHARS + 1)}
              value={inputs.allowedBrowsers}
              onInput={(event) => store.edit({ allowedBrowsers: event.currentTarget.value })}
            />
          </label>
          <div class="panel-head">
            <button type="button" class="flat" onClick={() => store.allowAll()}>すべて許可</button>
            {peer !== null && <button type="button" class="flat" onClick={() => store.addThisBrowser()}>このブラウザを足す</button>}
          </div>

          <footer class="panel-foot">
            <button type="button" class="flat" disabled={store.draft.value === null} onClick={() => store.discard()}>元に戻す</button>
            <button type="button" class="primary" disabled={!store.canApply.value} aria-busy={store.pending.value !== null} onClick={() => store.apply()}>
              {store.pending.value !== null ? '適用中…' : '保存して適用'}
            </button>
          </footer>
          {!connected && <p class="caption">ブリッジに接続していない間は保存できません。</p>}
        </>
      )}
    </section>
  )
}
