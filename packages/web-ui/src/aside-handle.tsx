// 右の列の幅を変えるつまみ(D-159)。広い画面でだけ本体と右の列の間に置く。
// 幅は枠(.app-body)の CSS 変数 --aside-width に入れ、上下限は aside-width-logic と app.css の clamp() の両方で抑える
// (覚えた幅は広い画面で決めたものかもしれないので、狭い窓で開き直したときに本体が潰れないよう CSS でも常に抑える)。
// 引いている間は枠の変数だけを書き換え、App を描き直さない(ポインタが動くたびにすべてのパネルを描き直さないように)
import type { RefObject } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import {
  ASIDE_DEFAULT,
  ASIDE_MIN,
  browserStorage,
  readSavedWidth,
  saveWidth,
  widthFromKey,
  widthFromPointer,
  type WidthStorage,
} from './aside-width-logic'

export const ASIDE_WIDTH_VAR = '--aside-width'

function apply(frame: HTMLElement | null, width: number): void {
  frame?.style.setProperty(ASIDE_WIDTH_VAR, `${String(width)}px`)
}

export function AsideHandle({ frame, storage = browserStorage() }: { frame: RefObject<HTMLElement>; storage?: WidthStorage | null }) {
  const [width, setWidth] = useState(ASIDE_DEFAULT)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const saved = readSavedWidth(storage)
    if (saved === null) return
    setWidth(saved)
    apply(frame.current, saved)
  }, [])

  const onPointerDown = (down: PointerEvent) => {
    const element = frame.current
    if (element === null || down.button !== 0) return
    // タッチで引いたときにページがスクロールしない・文字が選ばれないように
    down.preventDefault()
    const handle = down.currentTarget as HTMLElement
    const rect = element.getBoundingClientRect()
    let moved: number | null = null
    try {
      handle.setPointerCapture(down.pointerId)
    } catch {
      // 取り込めない環境でも、つまみの上で動かせば効く
    }
    setDragging(true)
    const move = (event: PointerEvent) => {
      moved = widthFromPointer(rect.right, event.clientX, rect.width)
      apply(element, moved)
      setWidth(moved)
    }
    const up = () => {
      setDragging(false)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      if (moved !== null) saveWidth(storage, moved)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const element = frame.current
    if (element === null) return
    const next = widthFromKey(event.key, width, element.getBoundingClientRect().width)
    if (next === null) return
    event.preventDefault()
    apply(element, next)
    setWidth(next)
    saveWidth(storage, next)
  }

  return (
    <div
      class={dragging ? 'aside-handle dragging' : 'aside-handle'}
      role="separator"
      aria-orientation="vertical"
      aria-label="送信先・Inspector の幅を変える"
      aria-valuenow={width}
      aria-valuemin={ASIDE_MIN}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
