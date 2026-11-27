// 設計図のタブの画面(D-152)。PC ごとの設計図の一覧・Sync・食い違いの表示と、
// 設計図から既定の画面を作る操作。状態は blueprint-store の signal を読むだけ
import { compositeNote, receivedAtLabel, verifiedLabel } from './blueprint-logic'
import type { BlueprintStore } from './blueprint-store'

export function BlueprintPanel({ store }: { store: BlueprintStore }) {
  const connected = store.connected.value
  const pcs = store.pcs.value
  const source = store.source.value
  return (
    <section class="panel" aria-label="設計図">
      <header class="panel-head">
        <h2>設計図</h2>
        <button type="button" class="flat" disabled={!connected} onClick={() => store.requestCatalog()}>設計図を取り直す</button>
      </header>
      <p class="caption">ターゲットに設計図(何を操作できるか)を送り直させます</p>
      {pcs.length === 0
        ? <p class="muted">まだ設計図を受けていません。ターゲットの起動時か「設計図を取り直す」で届きます。</p>
        : (
          <div class="list">
            {pcs.map((pc) => {
              const verified = verifiedLabel(pc.verified)
              const note = compositeNote(pc.items)
              const current = source !== null && source.host === pc.host
              return (
                <div class="card blueprint" key={pc.host} data-blueprint-host={pc.host}>
                  <div class="blueprint-body">
                    <p class="title">{pc.name}({pc.host})</p>
                    <p class="caption">{pc.items.length} 項目・受信 {receivedAtLabel(pc.receivedAt)}</p>
                    <p class={`caption ${verified.tone}`}>{verified.text}</p>
                    {note !== null && <p class="caption">{note}</p>}
                  </div>
                  <button type="button" class={current ? 'flat' : 'primary'} disabled={!connected} onClick={() => store.adopt(pc.host)}>
                    {current ? '表示中' : 'この設計図から画面を作る'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
    </section>
  )
}
