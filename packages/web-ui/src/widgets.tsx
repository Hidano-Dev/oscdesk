// どのパネルでも使う小さな部品(D-138)。
import { createContext, render, type ComponentChildren } from 'preact'
import { useContext, useLayoutEffect, useRef } from 'preact/hooks'

/**
 * ダイアログ(.backdrop)を描く先。App が画面の枠の直下に置く(D-161)。右の列のように sticky などで重なりの文脈を作る要素の
 * 中に描くと、固定配置の背景の z-index がその要素の外に効かず、タブ・ログのボタン・ドロワーより奥になる。
 * App の外で描くパネル(パネルごとのテスト)では null で、その場に描く
 */
export const ModalRoot = createContext<HTMLElement | null>(null)

/**
 * ダイアログの背景と中身。ModalRoot があればそこに置いた自分の置き場へ描く。preact/compat の createPortal は使わない
 * (compat を読み込むと、全体の入力欄の onChange・value の扱いが React 流に変わり、主画面の欄の振る舞いが変わる)。
 * 置き場は別の描画の根なので、中身は store の signal を自分で読む部品にする(いまのダイアログはどれもそう)
 */
export function Modal({ children }: { children: ComponentChildren }) {
  const root = useContext(ModalRoot)
  const host = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (root === null) return undefined
    const element = document.createElement('div')
    root.append(element)
    host.current = element
    return () => {
      render(null, element)
      element.remove()
      host.current = null
    }
  }, [root])
  useLayoutEffect(() => {
    if (host.current !== null) render(<>{children}</>, host.current)
  })
  return root === null ? <>{children}</> : null
}

/**
 * チェックボックスとラベル。見た目は渡した checked(store の状態)で描き、押した結果は onChange で知らせるだけにする。
 * DOM の checked は押した直後に一旦戻す: store が先に付けた(または断った)状態で描き直すので、断られたときに
 * 押した見た目が残らない
 */
export function Check(props: { label: string; checked: boolean; disabled: boolean; title?: string; onChange: (checked: boolean) => void }) {
  return (
    <label class="check" title={props.title}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => {
          const next = event.currentTarget.checked
          event.currentTarget.checked = props.checked
          props.onChange(next)
        }}
      />
      <span>{props.label}</span>
    </label>
  )
}
