// 設計図のタブの状態(D-152)。
// PC ごとの設計図の一覧と、いま採用している設計図の画面の取得元だけを持つ表示キャッシュ。
// 「設計図を取り直す」(catalogRequest)と「この設計図から画面を作る」(catalogAdopt)を送るだけで、画面を作るのも
// 保存した画面を優先するのもブリッジ(HID-373 の決定 3)。作った画面は surface で主画面に届く
import { batch, signal } from '@preact/signals'

import { WIRE_PROTOCOL_VERSION } from '@oscdesk/shared'

import { mergeCatalog, type CatalogPc } from './blueprint-logic'
import type { BridgeLink, FrameOf } from './bridge-link'
import type { Notices } from './notices'

export interface BlueprintStoreDeps {
  link: BridgeLink
  notices: Notices
}

export type BlueprintStore = ReturnType<typeof createBlueprintStore>
export function createBlueprintStore(deps: BlueprintStoreDeps) {
  const { link } = deps
  const notify = deps.notices.notify
  const pcs = signal<readonly CatalogPc[]>([])
  /** 採用中の画面が設計図から作ったものなら、その取得元の PC(blueprintStatus の pc)。 */
  const source = signal<{ host: string; name: string } | null>(null)

  const onNotice = (notice: FrameOf<'notice'>) => {
    // 押した結果が主画面に出ないときに理由が分からないので出す(D-152)
    if (notice.code === 'catalog-adopt-rejected') notify('error', `設計図から画面を作れません: ${notice.detail}`)
    if (notice.code === 'catalog-adopted') notify('info', `設計図の画面「${notice.detail}」を採用しました`)
  }

  const unsubscribe = [
    link.on('catalog', (frame) => {
      pcs.value = mergeCatalog(pcs.value, frame)
    }),
    link.on('blueprintStatus', (frame) => {
      source.value = frame.pc
    }),
    link.on('notice', onNotice),
    link.onConnectionChange((connected) => {
      if (connected) return
      // つなぎ直すとブリッジが全 PC を配り直す(PC が無ければ空の hosts を 1 回)。ブリッジが再起動していれば
      // 設計図は消えているので、古い一覧を残さない
      batch(() => {
        pcs.value = []
        source.value = null
      })
    }),
  ]

  return {
    connected: link.connected,
    pcs,
    source,
    dispose() {
      for (const stop of unsubscribe) stop()
    },
    /** 設計図の Sync(D-104)。ブリッジが全宛先へ送り直しを求める。 */
    requestCatalog() {
      if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'catalogRequest' })) notify('warn', 'ブリッジに接続していないため設計図を取り直せませんでした')
    },
    /** その PC の設計図から既定の画面を作って採用させる(HID-386)。 */
    adopt(host: string) {
      if (!link.send({ v: WIRE_PROTOCOL_VERSION, type: 'catalogAdopt', host })) notify('warn', 'ブリッジに接続していないため画面を作れませんでした')
    },
  }
}
