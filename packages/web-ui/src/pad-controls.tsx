// パッドの値の操作の部品(D-170)。主画面(surface-panel)の部品の手触りを、版 2 のパッドの操作(PadControl)へ移したもの。
// 部品は「1 つの値の出し入れ(Binding)」を受けて描くので、値の部品・組み合わせの型の引数・表のマスで同じ部品を使う。
// 状態は持たず(入力欄の打ちかけの文字だけを手元に持つ)、送る・保護する・ロックするは Binding の先(pad-store)が決める
import { useEffect, useRef, useState } from 'preact/hooks'

import type { PadControl } from '@oscdesk/shared'

import { clampTo, inputTextOf, optionIndex, sliderStepOf, validateControlInput } from './pad-logic'
import { asNumber, formatValue, isPrimaryPress, type Scalar } from './value-channel'
import { Check } from './widgets'

const INVALID_INPUT_TEXT = '形式不正のため送信しませんでした'

/** 1 つの値の部品が使う出し入れ。false を返した操作は断られた(ほかのブラウザが操作中)ので、部品は表示を戻す。 */
export interface Binding {
  value: Scalar | null
  disabled: boolean
  holdBegin(kind: string): boolean
  holdEnd(): void
  setEditing(editing: boolean): void
  setLocal(value: Scalar): boolean
  setDiscrete(value: Scalar): boolean
  setDraft?(raw: string): void
  draft?: string | null
  /** 通知の列へ出す(入力欄の形式不正) */
  warn(text: string): void
}

export function ControlView({ control, binding, label }: { control: PadControl; binding: Binding; label: string }) {
  switch (control.kind) {
    case 'toggle':
      return <Check label={label} checked={binding.value === true} disabled={binding.disabled} onChange={(checked) => binding.setDiscrete(checked)} />
    case 'slider':
      return <SliderControl control={control} binding={binding} label={label} />
    case 'select':
      return <SelectControl control={control} binding={binding} label={label} />
    default:
      return <InputControl control={control} binding={binding} label={label} />
  }
}

export function SliderControl({ control, binding, label }: { control: PadControl; binding: Binding; label: string }) {
  const low = control.min ?? 0
  const high = control.max ?? 1
  const number = asNumber(binding.value)
  // 値が無ければつまみは下限に置き、数値の表示は「-」にする
  const position = clampTo(control, number ?? low)
  const end = () => binding.holdEnd()
  return (
    <label class="s-field">
      {label !== '' && (
        <span class="s-field-head">
          <span class="caption">{label}</span>
          <span class="caption">{binding.value === null ? '-' : formatValue(binding.value)}</span>
        </span>
      )}
      <input
        type="range"
        min={low}
        max={high}
        step={sliderStepOf(control)}
        value={position}
        disabled={binding.disabled}
        aria-label={label === '' ? undefined : label}
        onPointerDown={(event) => {
          if (!isPrimaryPress(event)) return
          // つまみを掴んでいる間に指が部品の外へ出ても、離すまでを 1 つの操作として受ける
          event.currentTarget.setPointerCapture?.(event.pointerId)
          binding.holdBegin('slider')
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
        onInput={(event) => {
          const raw = Number(event.currentTarget.value)
          const next = control.type === 'i' ? Math.round(raw) : raw
          // 断られたら(ほかのブラウザが操作中)つまみを表示中の値へ戻す。値は送っていないので描き直しでは戻らない
          if (!binding.setLocal(next)) event.currentTarget.value = String(position)
        }}
      />
    </label>
  )
}

function SelectControl({ control, binding, label }: { control: PadControl; binding: Binding; label: string }) {
  const options = control.options ?? []
  const index = optionIndex(control, binding.value)
  const current = index >= 0 ? String(index) : binding.value === null ? 'none' : 'outside'
  const selectRef = useRef<HTMLSelectElement>(null)
  // 値の配り直しで、DOM の選択を表示中の値に揃える(断られた選択を残さない)
  useEffect(() => {
    if (selectRef.current !== null) selectRef.current.value = current
  })
  return (
    <label class="s-field">
      {label !== '' && <span class="caption">{label}</span>}
      <select
        ref={selectRef}
        value={current}
        disabled={binding.disabled}
        aria-label={label === '' ? undefined : label}
        onPointerDown={(event) => {
          if (isPrimaryPress(event)) binding.holdBegin('select')
        }}
        onBlur={() => binding.holdEnd()}
        onChange={(event) => {
          const picked = options[Number(event.currentTarget.value)]
          if (picked === undefined) return
          if (!binding.setDiscrete(picked.value)) event.currentTarget.value = current
          binding.holdEnd()
        }}
      >
        {current === 'none' && <option value="none" disabled>—</option>}
        {/* 候補に無い値(保持値が候補の変更より古い)は消さずに表示だけで残す */}
        {current === 'outside' && <option value="outside" disabled>{`${formatValue(binding.value!)}(候補に無い)`}</option>}
        {options.map((option, position) => <option key={position} value={String(position)}>{option.label ?? formatValue(option.value)}</option>)}
      </select>
    </label>
  )
}

export function InputControl({ control, binding, label }: { control: PadControl; binding: Binding; label: string }) {
  const shownText = inputTextOf(control, binding.value)
  // 作り直した部品でも、操作中なら打ちかけの文字(下書き)から始める
  const [text, setText] = useState(binding.draft ?? shownText)
  const [error, setError] = useState<string | null>(null)
  const editing = useRef(false)
  // 表示中の値から利用者が書き換えたか。書き換えずに離れたら同じ値を送り直さない
  const edited = useRef(false)
  // Enter で確定した後に続けて届く blur で、同じ確定を二度送らない
  const confirmedByEnter = useRef(false)

  // 消える(行が表から消えた・編集へ切り替えた・パッドが替わった)ときは、blur を待たずに操作を終える。フォーカス中の要素を
  // 取り除いても blur が届かないブラウザがあり、残すと入力欄のホールドとロックの延長が止まらない(PR #177 のレビュー)。
  // 打ちかけの文字は送らない(確定していない)
  const latest = useRef(binding)
  latest.current = binding
  // 消えた後に届く blur(フォーカス中の要素を取り除くと blur を出すブラウザがある)では確定しない。取り込みで作り直した部品の
  // 前の欄の打ちかけの文字を、新しい版で送らないため(PR #187 のレビュー)
  const gone = useRef(false)
  useEffect(() => () => {
    gone.current = true
    if (!editing.current) return
    editing.current = false
    latest.current.holdEnd()
    latest.current.setEditing(false)
  }, [])

  // フォーカスの外では表示中の値(エコー・保持値)に合わせる。フォーカスの中では打ちかけの文字を書き換えない
  useEffect(() => {
    if (editing.current) return
    setText(shownText)
    setError(null)
    edited.current = false
  }, [shownText])

  const begin = () => {
    if (!binding.holdBegin('input')) return false
    editing.current = true
    binding.setEditing(true)
    return true
  }
  const end = () => {
    editing.current = false
    binding.holdEnd()
  }

  const confirm = (fromBlur: boolean): boolean => {
    const result = validateControlInput(control, text)
    if (!result.ok) {
      // Enter では欄に理由を出して直させる。フォーカスを外したときは、断った値は送っていないので表示中の値へ戻し、理由は通知で知らせる
      setError(fromBlur ? null : result.error)
      if (fromBlur) {
        end()
        setText(shownText)
        edited.current = false
        binding.setDraft?.('')
        binding.warn(`${INVALID_INPUT_TEXT}: ${result.error}`)
      }
      return false
    }
    setError(null)
    edited.current = false
    if (!binding.setDiscrete(result.value)) setText(shownText)
    end()
    return true
  }

  const numeric = control.kind === 'number'
  return (
    <label class="s-field">
      {label !== '' && <span class="caption">{label}</span>}
      <input
        type={numeric ? 'number' : 'text'}
        step={numeric ? 'any' : undefined}
        min={numeric ? control.min : undefined}
        max={numeric ? control.max : undefined}
        maxLength={numeric ? undefined : control.maxLength}
        value={text}
        disabled={binding.disabled}
        aria-label={label === '' ? undefined : label}
        aria-invalid={error !== null}
        onFocus={() => {
          confirmedByEnter.current = false
          // フォーカスした時点から操作中とみなす(最初の 1 文字を打つ前に届いたエコーで、これから打つ欄を書き換えない)
          begin()
        }}
        onInput={(event) => {
          const raw = event.currentTarget.value
          if (!editing.current && !begin()) {
            event.currentTarget.value = text
            return
          }
          confirmedByEnter.current = false
          edited.current = true
          setText(raw)
          binding.setDraft?.(raw)
        }}
        onKeyDown={(event) => {
          // IME の変換を確定する Enter では決定しない(Safari は keyCode 229 で見分ける)
          if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return
          confirmedByEnter.current = confirm(false)
        }}
        onBlur={() => {
          if (gone.current) return
          if (confirmedByEnter.current) {
            confirmedByEnter.current = false
            return
          }
          if (!edited.current) {
            // 欄を通り抜けただけ。同じ値を送り直さず、始めたホールドだけ終える
            setError(null)
            end()
            return
          }
          confirm(true)
        }}
      />
      {error !== null && <span class="caption negative">{error}</span>}
    </label>
  )
}
