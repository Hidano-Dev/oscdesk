// 「同期」タブ(D-165・D-169・D-170)。自動の再送の入り切り(osc.padResendSet)と、手動の同期(osc.padSync)の行き先を並べる。
// 送るのはパッドの保持値のうち「送り直す」の部品・表の欄だけ(部品ごとの設定はパッドの編集の Inspector)。
// 状態は pad-store の signal を読むだけで、送り先の照合(任意のアドレスへは送らない)はブリッジ
import { isHoldingWidget } from '@oscdesk/shared'

import type { PadStore } from './pad-store'

export function PadSyncPanel({ pad }: { pad: PadStore }) {
  const connected = pad.connected.value
  const auto = pad.autoResend.value
  const adopted = pad.adopted.value
  const holding = adopted === null ? [] : adopted.pad.widgets.filter(isHoldingWidget)
  const resending = holding.filter((widget) => widget.kind === 'table' ? widget.columns.some((column) => column.resend) : widget.resend && widget.readOnly !== true)
  return (
    <section class="panel" aria-label="同期">
      <header class="panel-head">
        <h2>同期</h2>
      </header>
      <div class="card">
        <span class="switch-row">
          <input
            type="checkbox"
            role="switch"
            class="switch"
            aria-label="自動の再送"
            checked={auto === true}
            disabled={!connected || auto === null}
            onChange={(event) => {
              const next = event.currentTarget.checked
              // 見た目はブリッジの答え(osc.padResend)で描き直す
              event.currentTarget.checked = auto === true
              pad.setAutoResend(next)
            }}
          />
          <span class="select-none">自動の再送</span>
        </span>
        <p class="caption">
          オンのとき、ターゲットが起動した(起動 ID が変わった)ら、その PC へパッドの保持値を送り直します。既定はオフです。
        </p>
      </div>
      <p class="caption" data-mark="resend-summary">
        {adopted === null ? 'パッドがありません' : `送り直す部品: ${String(resending.length)} / 値を持つ部品 ${String(holding.length)}(部品ごとの「送り直す」はパッドの編集で変えます)`}
      </p>
      <div class="list">
        {pad.syncChoices.value.map((choice) => (
          <div class="card resend-row" key={`${choice.target ?? ''}|${choice.host ?? ''}|${String(choice.port ?? '')}`} data-sync={choice.target ?? (choice.host === undefined ? 'all' : `${choice.host}:${String(choice.port)}`)}>
            <button type="button" class={choice.target === undefined && choice.host === undefined ? 'primary' : 'flat'} disabled={!connected || adopted === null} onClick={() => pad.sync(choice)}>同期</button>
            <div class="resend-body">
              <p class="title break">{choice.label}</p>
            </div>
          </div>
        ))}
      </div>
      <p class="caption">同期は「送り直す」の値を /sys/sync/begin と /sys/sync/end で挟んで送ります。生成物の作り直しは受け側が行います。</p>
    </section>
  )
}
