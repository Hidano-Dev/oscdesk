// どのパネルでも使う小さな部品(D-138)。

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
