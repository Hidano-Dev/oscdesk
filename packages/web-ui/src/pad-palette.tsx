// パッドの編集のパレット(D-170)。OSCQuery で見つけたターゲット(osc.queryTargets。D-168)の、書けるノードから作った部品の候補を
// ターゲットごとに並べ、「置く」で選んだ空きマス(無ければ最初の空きマス)に addWidgetFromNode で置く。部品の種類と送り直すかの
// 既定はブリッジが padWidgetFromNode で決める(D-171)。部品にできないノードは「未対応」として理由と一緒に見せる
import { useState } from 'preact/hooks'

import type { OscQueryTargetView } from '@oscdesk/shared'

import type { PadEditStore } from './pad-edit-store'
import { KIND_LABELS } from './pad-logic'
import type { PadStore } from './pad-store'

const MDNS_TEXT = { off: 'mDNS での発見は切ってあります(設定の oscQuery.mdns)', running: 'mDNS で探しています', failed: 'mDNS を始められませんでした(UDP 5353 がふさがれているなど)' } as const
const STATUS_TEXT = { loading: '読み込み中', ready: '読み込み済み', error: '読めませんでした' } as const
const REASON_TEXT = { 'unsupported-type': '部品にできない型', 'invalid-address': 'パッドから送れないアドレス' } as const
/** 候補の絞り込みの文字の上限(打った文字で毎回全件を走査するので、長い文字は受けない) */
const MAX_FILTER_CHARS = 128
/** 1 つのターゲットで描く候補の上限(候補は 4,096 件まで届く。全部を DOM にすると画面が固まるので、残りは絞り込みで出す) */
export const MAX_SHOWN_ITEMS = 200

export function PalettePanel({ pad, edit }: { pad: PadStore; edit: PadEditStore }) {
  const targets = pad.queryTargets.value
  const mdns = pad.mdns.value
  const [filter, setFilter] = useState('')
  const picked = edit.selection.value
  const where = picked !== null && 'cell' in picked ? `${String(picked.cell.row + 1)} 行 ${String(picked.cell.column + 1)} 列` : '最初の空きマス'
  const needle = filter.trim().toLowerCase()
  return (
    <section class="card palette" aria-label="パレット">
      <header class="panel-head">
        <h3>パレット(OSCQuery)</h3>
        <button type="button" class="flat" disabled={!pad.connected.value} onClick={() => pad.refreshQuery()}>再読み込み</button>
        <span class="caption">「置く」で {where} に置きます</span>
      </header>
      {mdns !== null && <p class="caption">{MDNS_TEXT[mdns]}</p>}
      <input type="search" aria-label="候補を絞り込む" placeholder="アドレス・説明で絞り込む" maxLength={MAX_FILTER_CHARS} value={filter} onInput={(event) => setFilter(event.currentTarget.value)} />
      {targets.length === 0
        ? <p class="muted">OSCQuery のターゲットが見つかっていません</p>
        : targets.map((target) => <TargetPalette key={target.id} target={target} edit={edit} needle={needle} />)}
    </section>
  )
}

function TargetPalette({ target, edit, needle }: { target: OscQueryTargetView; edit: PadEditStore; needle: string }) {
  const items = needle === '' ? target.palette : target.palette.filter((item) => item.address.toLowerCase().includes(needle) || (item.description ?? '').toLowerCase().includes(needle))
  return (
    <details class="fold" open data-target={target.id}>
      <summary>
        {target.name ?? target.id}
        <span class="caption"> {target.host}{target.oscPort === null ? '' : `:${String(target.oscPort)}`} / {STATUS_TEXT[target.status]} / 候補 {target.palette.length}</span>
      </summary>
      {target.error !== null && <p class="caption negative">{target.error}</p>}
      <div class="list">
        {items.slice(0, MAX_SHOWN_ITEMS).map((item) => (
          <div class="palette-item" key={item.address} data-address={item.address}>
            <span class="palette-kind">{KIND_LABELS[item.kind]}</span>
            <span class="palette-body">
              <span class="break">{item.address}</span>
              <span class="caption">{item.type ?? '(値なし)'}{item.description === null ? '' : ` ${item.description}`}{item.hold ? '' : ' / 送るだけ'}</span>
            </span>
            <button type="button" class="small" onClick={() => edit.place(item)}>置く</button>
          </div>
        ))}
        {items.length === 0 && target.palette.length > 0 && <p class="caption">絞り込みに合う候補はありません</p>}
        {items.length > MAX_SHOWN_ITEMS && <p class="caption">ほかに {items.length - MAX_SHOWN_ITEMS} 件あります(絞り込んでください)</p>}
      </div>
      {(target.unsupported.length > 0 || target.dropped > 0) && (
        <details class="fold child">
          <summary>未対応 {target.unsupported.length}{target.dropped > 0 ? `(ほかに上限で載せなかった ${String(target.dropped)} 件)` : ''}</summary>
          <div class="list">
            {target.unsupported.slice(0, MAX_SHOWN_ITEMS).map((item) => (
              <p class="caption break" key={item.address} data-unsupported={item.address}>{item.address} {item.type ?? ''} — {REASON_TEXT[item.reason]}</p>
            ))}
          </div>
        </details>
      )}
    </details>
  )
}
