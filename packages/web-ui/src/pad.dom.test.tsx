// @vitest-environment happy-dom
// パッドの主画面(D-170)の画面との結線。main.tsx と同じ組み立てで描き、部品を押した・動かした・打ったときに送るフレーム、
// 保持値・エコーの映り方(版の照合・操作中の保護)、編集(空きマスへの追加・パレットからの配置・Inspector)、同期のタブを確かめる
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from './app'
import { PAD_NAME, PAD_VERSION, STAGE_PAD, padDocumentFrame, padListFrame, padValuesFrame } from './pad-test-support'
import { createAppStores } from './stores'
import { createTestLink, wireSample } from './test-support'
import { MIN_SEND_INTERVAL_MS } from './value-channel'

function mount() {
  const test = createTestLink()
  const stores = createAppStores({
    link: test.link, notices: test.notices, now: test.timers.now, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer,
    holder: 'pad-test', randomId: () => 'r',
  })
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(<App link={test.link} notices={test.notices} {...stores} />, container))
  const receive = (frame: unknown) => act(() => test.socket().receive(frame))
  const panel = (id: string) => container.querySelector<HTMLElement>(`#panel-${id}`)!
  const widget = (id: string) => panel('pad').querySelector<HTMLElement>(`[data-widget="${id}"]`)
  const sent = (type: string) => test.socket().ofType(type)
  const input = (element: HTMLInputElement | null | undefined, value: string) => act(() => {
    if (element === null || element === undefined) throw new Error('no input')
    element.focus()
    element.value = value
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const advance = (ms: number) => act(() => {
    test.timers.advance(ms)
    stores.pad.tick()
  })
  receive(wireSample('downstream-hello'))
  receive(padListFrame())
  receive(padDocumentFrame())
  return { ...test, stores, container, receive, panel, widget, sent, input, advance }
}

const switchOf = (container: HTMLElement) => container.querySelector<HTMLInputElement>('input[aria-label="パッドを編集"]')!

afterEach(() => {
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('pad main screen: run (happy-dom)', () => {
  it('draws every widget kind on the grid and sends each operation with the drawn version', () => {
    const { widget, sent } = mount()
    expect(widget('level')?.style.gridColumn).toBe('3 / span 2')

    act(() => { widget('fire')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })) })
    expect(sent('osc.padPress').at(-1)).toEqual({ v: 1, type: 'osc.padPress', name: PAD_NAME, version: PAD_VERSION, button: 'fire' })
    // 右クリックでは送らない
    act(() => { widget('fire')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 })) })
    expect(sent('osc.padPress')).toHaveLength(1)

    act(() => widget('mute')?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click())
    expect(sent('osc.padSet').at(-1)).toEqual({ v: 1, type: 'osc.padSet', name: PAD_NAME, version: PAD_VERSION, widget: 'mute', value: true, holder: 'pad-test' })

    const select = widget('mode')?.querySelector<HTMLSelectElement>('select')
    act(() => {
      select!.value = '1'
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(sent('osc.padSet').at(-1)).toMatchObject({ widget: 'mode', value: 'b' })
  })

  it('throttles a slider while it is held, sends the last value on release and locks the widget meanwhile', () => {
    const { widget, sent, advance } = mount()
    const slider = widget('level')?.querySelector<HTMLInputElement>('input[type="range"]')
    if (slider === null || slider === undefined) throw new Error('no slider')
    act(() => { slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })) })
    expect(sent('lock').at(-1)).toMatchObject({ ref: { widget: 'level' }, holder: 'pad-test' })
    for (const value of ['0.1', '0.2', '0.3']) {
      act(() => {
        slider.value = value
        slider.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    // 最初の値だけがすぐに出て、残りは間引く
    expect(sent('osc.padSet').map((frame) => frame.value)).toEqual([0.1])
    advance(MIN_SEND_INTERVAL_MS + 1)
    expect(sent('osc.padSet').map((frame) => frame.value)).toEqual([0.1, 0.3])
    act(() => { slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) })
    expect(sent('unlock').at(-1)).toMatchObject({ ref: { widget: 'level' } })
  })

  it('shows held values and echoes of the drawn version only, and keeps a held control from jumping', () => {
    const { widget, receive } = mount()
    const shownLevel = () => widget('level')?.querySelector('.s-field-head .caption:last-child')?.textContent
    receive(padValuesFrame([{ widget: 'level', value: 0.5 }, { widget: 'pose', value: [1.5, true] }], [{ widget: 'members', key: 'm02', column: 'active', value: true }]))
    expect(shownLevel()).toBe('0.5')
    expect(widget('pose')?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true)
    expect(widget('members')?.querySelector<HTMLInputElement>('[data-row="m02"] input[type="checkbox"]')?.checked).toBe(true)

    // 別の版(別の端末が上書きした直後の旧い版など)の値・エコーは当てない
    receive(padValuesFrame([{ widget: 'level', value: 0.9 }], [], { version: 'epoch-0', full: false }))
    receive({ v: 1, type: 'osc.padEcho', version: 'epoch-0', widgets: [{ widget: 'level', value: 0.8 }], rows: [] })
    expect(shownLevel()).toBe('0.5')

    // 操作中はエコーで動かさない(離したら届いた値に戻る)
    const slider = widget('level')!.querySelector<HTMLInputElement>('input[type="range"]')!
    act(() => { slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })) })
    receive({ v: 1, type: 'osc.padEcho', version: PAD_VERSION, widgets: [{ widget: 'level', value: 0.25 }], rows: [] })
    expect(shownLevel()).toBe('0.5')
    act(() => { slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })) })
    expect(shownLevel()).toBe('0.25')
  })

  it('keeps an input being typed in when the same pad is adopted again, and drops it when the pad changes', () => {
    const { widget, receive, input, sent } = mount()
    const count = () => widget('count')!.querySelector<HTMLInputElement>('input')!
    input(count(), '7')
    // 同じ内容の再採用(版だけが進む)では作り直さない。続く確定は新しい版で送る
    receive(padDocumentFrame(STAGE_PAD, { version: 'epoch-2', revision: 2 }))
    expect(count().value).toBe('7')
    act(() => { count().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(sent('osc.padSet').at(-1)).toMatchObject({ widget: 'count', value: 7, version: 'epoch-2' })

    // 範囲の外は送らずに理由を出す
    input(count(), '11')
    act(() => { count().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(sent('osc.padSet')).toHaveLength(1)
    expect(widget('count')?.textContent).toContain('10 以下にしてください')

    // 内容の違うパッドに替わったら作り直す(旧い部品の打ちかけを新しい部品へ持ち込まない)
    const changed = { ...STAGE_PAD, widgets: STAGE_PAD.widgets.filter((item) => item.id !== 'count') }
    receive(padDocumentFrame(changed, { version: 'epoch-3', revision: 3 }))
    expect(widget('count')).toBeNull()
  })

  it('sends table cells, row actions, the bulk toggle and UI row edits', () => {
    const { widget, sent, receive, container } = mount()
    const table = widget('members')!
    act(() => table.querySelector<HTMLInputElement>('[data-row="m01"] input[type="checkbox"]')?.click())
    expect(sent('osc.padSetCell').at(-1)).toEqual({ v: 1, type: 'osc.padSetCell', name: PAD_NAME, version: PAD_VERSION, widget: 'members', key: 'm01', column: 'active', value: true, holder: 'pad-test' })

    act(() => [...table.querySelectorAll<HTMLButtonElement>('[data-row="m02"] button')].find((button) => button.textContent === 'Reset')?.click())
    expect(sent('osc.padAction').at(-1)).toMatchObject({ widget: 'members', action: 'reset', key: 'm02' })
    act(() => [...table.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'All off')?.click())
    expect(sent('osc.padAction').at(-1)).toEqual({ v: 1, type: 'osc.padAction', name: PAD_NAME, version: PAD_VERSION, widget: 'members', action: 'all' })

    act(() => table.querySelector<HTMLInputElement>('[data-mark="bulk"] input[type="checkbox"]')?.click())
    expect(sent('osc.padSetCell').slice(-2).map((frame) => [frame.key, frame.value])).toEqual([['m01', true], ['m02', true]])

    // UI で管理する行の追加は、採用中のパッドを編集して(答えを待って)保存する
    const key = table.querySelector<HTMLInputElement>('input[aria-label="追加する行の ID"]')!
    act(() => {
      key.value = 'm03'
      key.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => [...table.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '行を追加')?.click())
    const edit = sent('osc.padDocumentEdit').at(-1) as { requestId: string; edit: Record<string, unknown> }
    expect(edit.edit).toEqual({ op: 'addRow', widget: 'members', key: 'm03', label: 'm03' })
    const members = STAGE_PAD.widgets.find((item) => item.id === 'members')!
    const added = { ...STAGE_PAD, widgets: STAGE_PAD.widgets.map((item) => item === members && item.kind === 'table' && item.rows.source === 'ui' ? { ...item, rows: { ...item.rows, keys: [...item.rows.keys, { key: 'm03', label: 'm03' }] } } : item) }
    receive({ v: 1, type: 'osc.padDocumentEdited', requestId: edit.requestId, result: { ok: true, pad: added } })
    // もとにした版を付けて保存する(同じ版から別の端末が先に保存していればブリッジが断る。D-170)
    expect(sent('osc.padSave').at(-1)).toMatchObject({ name: PAD_NAME, pad: added, baseVersion: PAD_VERSION })

    // 断られたら今のパッドを取り直して知らせる
    const requests = sent('osc.padDocumentRequest').length
    receive({ v: 1, type: 'notice', level: 'error', code: 'pad-rejected', detail: `stale-pad: ${PAD_NAME}@${PAD_VERSION}` })
    expect(sent('osc.padDocumentRequest')).toHaveLength(requests + 1)
    expect(container.querySelector('.notices')?.textContent).toContain('別の端末がパッドを変えていたため、保存しませんでした')
  })

  it('does not save a row edit when the pad was replaced while waiting for the answer', () => {
    const { widget, sent, receive, notices } = mount()
    const table = widget('members')!
    act(() => [...table.querySelectorAll<HTMLButtonElement>('[aria-label^="行 Alice を削除"]')][0]?.click())
    act(() => [...table.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '「Alice」を削除')?.click())
    const edit = sent('osc.padDocumentEdit').at(-1) as { requestId: string }
    receive(padDocumentFrame(STAGE_PAD, { version: 'epoch-9', revision: 9 }))
    receive({ v: 1, type: 'osc.padDocumentEdited', requestId: edit.requestId, result: { ok: true, pad: STAGE_PAD } })
    expect(sent('osc.padSave')).toHaveLength(0)
    expect(notices.history.value.at(-1)?.text).toContain('保存しませんでした')
  })

  it('reloads the held values when the bridge refuses a value', () => {
    const { receive, sent } = mount()
    const before = sent('osc.padDocumentRequest').length
    receive({ v: 1, type: 'notice', level: 'error', code: 'pad-set-rejected', detail: 'out-of-range: count' })
    expect(sent('osc.padDocumentRequest')).toHaveLength(before + 1)
  })
})

describe('pad main screen: edit and palette (happy-dom)', () => {
  it('adds a widget on an empty cell and edits it in the inspector on the right column', () => {
    const { container, panel, sent, receive } = mount()
    act(() => switchOf(container).click())
    const cell = panel('pad').querySelector<HTMLButtonElement>('[data-cell="2,0"]')
    // 表が 3 行目を占めているので空きマスではない
    expect(cell).toBeNull()
    const empty = panel('pad').querySelector<HTMLButtonElement>('[data-cell="1,3"]')!
    act(() => empty.click())
    // 広い画面では Inspector が右の列(送信先の場所)を借りる
    const aside = container.querySelector<HTMLElement>('#panel-destinations')!
    const kind = aside.querySelector<HTMLSelectElement>('select[aria-label="足す部品の種類"]')!
    act(() => {
      kind.value = 'slider'
      kind.dispatchEvent(new Event('change', { bubbles: true }))
    })
    act(() => [...aside.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '部品を足す')?.click())
    const edit = sent('osc.padDocumentEdit').at(-1) as { requestId: string; edit: Record<string, unknown>; draft: unknown }
    expect(edit.edit).toEqual({ op: 'addWidget', kind: 'slider', row: 1, column: 3 })
    expect(edit.draft).toEqual(STAGE_PAD)

    const withSlider = { ...STAGE_PAD, widgets: [...STAGE_PAD.widgets, { id: 'w1', kind: 'slider', row: 1, column: 3, label: 'w1', address: '/pad/w1', type: 'f', min: 0, max: 1, resend: true }] }
    receive({ v: 1, type: 'osc.padDocumentEdited', requestId: edit.requestId, result: { ok: true, pad: withSlider } })
    // 足した部品が選ばれ、Inspector に出る
    const inspector = aside.querySelector<HTMLElement>('[aria-label="パッドの部品"]')!
    expect(inspector.textContent).toContain('スライダー (w1)')
    act(() => inspector.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click())
    expect((sent('osc.padDocumentEdit').at(-1) as { edit: unknown }).edit).toEqual({ op: 'setResend', widget: 'w1', resend: false })
  })

  it('places a palette candidate with addWidgetFromNode, lists the unsupported nodes and refreshes', () => {
    const { container, panel, sent, receive } = mount()
    receive(wireSample('downstream-osc-query-targets'))
    act(() => switchOf(container).click())
    const palette = panel('pad').querySelector<HTMLElement>('section[aria-label="パレット"]')!
    expect(palette.textContent).toContain('/scene/level')
    expect(palette.querySelector('[data-unsupported="/scene/stamp"]')?.textContent).toContain('部品にできない型')

    act(() => palette.querySelector<HTMLButtonElement>('[data-address="/scene/level"] button')?.click())
    expect((sent('osc.padDocumentEdit').at(-1) as { edit: unknown }).edit).toEqual({
      op: 'addWidgetFromNode', row: 1, column: 3,
      node: { address: '/scene/level', type: 'f', access: 3, description: '音量', range: [{ MIN: 0, MAX: 1 }] },
    })

    act(() => [...palette.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '再読み込み')?.click())
    expect(sent('osc.queryRefresh')).toHaveLength(1)
  })

  it('asks before discarding unsaved changes and saves the working copy as a version 2 pad', () => {
    const { container, panel, sent, receive } = mount()
    act(() => switchOf(container).click())
    act(() => panel('pad').querySelector<HTMLElement>('[data-widget="fire"]')?.click())
    const aside = container.querySelector<HTMLElement>('#panel-destinations')!
    act(() => [...aside.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '削除')?.click())
    const edit = sent('osc.padDocumentEdit').at(-1) as { requestId: string }
    const without = { ...STAGE_PAD, widgets: STAGE_PAD.widgets.filter((item) => item.id !== 'fire') }
    receive({ v: 1, type: 'osc.padDocumentEdited', requestId: edit.requestId, result: { ok: true, pad: without } })
    expect(panel('pad').textContent).toContain('未保存の変更があります')

    act(() => [...panel('pad').querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '保存')?.click())
    expect(sent('osc.padSave').at(-1)).toMatchObject({ name: PAD_NAME, pad: without })

    // 編集を終えるときは、まだ保存の採用が届いていないので破棄を確かめる
    act(() => switchOf(container).click())
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('保存していない変更があります')
  })
})

describe('sync tab (happy-dom)', () => {
  it('toggles the automatic resend and syncs to a chosen PC', () => {
    const { container, panel, sent, receive, notices } = mount()
    act(() => [...container.querySelectorAll<HTMLButtonElement>('.app-tabs [role="tab"]')].find((item) => item.textContent === '同期')?.click())
    const sync = panel('sync')
    const auto = sync.querySelector<HTMLInputElement>('input[aria-label="自動の再送"]')!
    // 設定が届くまでは入り切りできない
    expect(auto.disabled).toBe(true)
    receive({ v: 1, type: 'osc.padResend', auto: false })
    act(() => auto.click())
    expect(sent('osc.padResendSet').at(-1)).toEqual({ v: 1, type: 'osc.padResendSet', auto: true })
    // 見た目はブリッジの答えで変わる
    expect(auto.checked).toBe(false)
    receive({ v: 1, type: 'osc.padResend', auto: true })
    expect(auto.checked).toBe(true)

    expect(sync.querySelector('[data-mark="resend-summary"]')?.textContent).toContain('送り直す部品: 5 / 値を持つ部品 6')
    receive(wireSample('downstream-osc-query-targets'))
    act(() => sync.querySelector<HTMLButtonElement>('[data-sync="192.168.1.20:7090"] button')?.click())
    const request = sent('osc.padSync').at(-1) as { requestId: string }
    expect(request).toMatchObject({ host: '192.168.1.20', port: 7090 })
    receive({ v: 1, type: 'notice', level: 'info', code: 'pad-synced', detail: 'Unity (192.168.1.20): 4 value(s)', requestId: request.requestId })
    expect(notices.history.value.at(-1)?.text).toBe('「Unity (192.168.1.20:7090)」へ同期しました: Unity (192.168.1.20): 4 value(s)')

    act(() => sync.querySelector<HTMLButtonElement>('[data-sync="all"] button')?.click())
    expect(sent('osc.padSync').at(-1)).toEqual({ v: 1, type: 'osc.padSync', requestId: 'padsync-2-r' })
  })
})
