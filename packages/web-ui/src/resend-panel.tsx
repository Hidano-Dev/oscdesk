// 「再送」タブ(D-158)と、ヘッダーの Unity の接続状態。
// 宛先ごとに 1 行(D-094。横一列に並べると、ブロードキャストへ答えた台が増えたときに折り返して押し分けにくい)。
// 状態は unity-link-store の signal を読むだけ
import { targetLabel, unityLinkLabel, type LinkTone } from './unity-link-logic'
import type { UnityLinkStore } from './unity-link-store'

const TONE_CLASS: Record<LinkTone, string> = { ok: 'ok', lost: 'blocked', unknown: 'unknown' }

/** ヘッダーの Unity の接続状態(主系の到達・RTT・連続喪失)。 */
export function UnityLinkStatus({ store }: { store: UnityLinkStore }) {
  const label = unityLinkLabel(store.unity.value)
  return <p class={`link ${TONE_CLASS[label.tone]}`} data-mark="unity-link" data-tone={label.tone}>{label.text}</p>
}

export function ResendPanel({ store }: { store: UnityLinkStore }) {
  const connected = store.connected.value
  const targets = store.targets.value
  return (
    <section class="panel" aria-label="再送">
      <header class="panel-head">
        <h2>再送</h2>
        {targets.length > 0 && (
          <button type="button" class="primary" disabled={!connected} data-mark="resend-all" onClick={() => store.resend()}>全台へ再送</button>
        )}
      </header>
      <p class="caption">
        Unity へ保持値を送り直します。宛先ごとに押すか、全台へまとめて送ります。「記録に合わせる」はその PC の生成したもの(エフェクトなど)を記録どおりに揃えてから送ります
      </p>
      {targets.length === 0
        ? <p class="muted">宛先がまだありません(ブリッジの接続待ち)</p>
        : (
          <div class="list">
            {targets.map((target) => {
              const label = targetLabel(target)
              return (
                <div class="card resend-row" key={target.name} data-target={target.name}>
                  <button type="button" class="flat" disabled={!connected} data-mark="resend" onClick={() => store.resend(target.name)}>再送</button>
                  {/* 生成の記録に合わせる(HID-385) */}
                  <button type="button" class="flat" disabled={!connected} data-mark="reconcile" onClick={() => store.reconcile(target.name)}>記録に合わせる</button>
                  <div class="resend-body">
                    <p class="title break">{target.name}</p>
                    <p class="caption">{label.detail}</p>
                  </div>
                  <span class={`link ${TONE_CLASS[label.tone]}`} data-mark="target-state">{label.badge}</span>
                </div>
              )
            })}
          </div>
        )}
    </section>
  )
}
