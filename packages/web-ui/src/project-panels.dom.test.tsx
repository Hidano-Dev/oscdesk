// @vitest-environment happy-dom
// 設計図・プロジェクト・「新しい一覧があります」の画面との結線(D-139・D-150〜D-152)。happy-dom の DOM に App を描き、
// 偽の WebSocket にフレームを流して、押したときに送るフレームと描き直された DOM を確かめる
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './app'
import { createBlueprintStore } from './blueprint-store'
import { createDestinationsStore } from './destinations-store'
import { createEditMode } from './edit-mode'
import { createPendingOptionsStore } from './pending-options-store'
import { createProjectStore } from './project-store'
import { createTestLink, wireSample } from './test-support'

function mount() {
  const test = createTestLink()
  const deps = { link: test.link, notices: test.notices }
  const timers = { now: test.timers.now, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer }
  const destinations = createDestinationsStore({ ...deps, ...timers })
  const editMode = createEditMode()
  const downloads: string[] = []
  const project = createProjectStore({
    ...deps,
    editing: editMode.editing,
    download: (name) => downloads.push(name),
    setTimer: test.timers.setTimer,
    clearTimer: test.timers.clearTimer,
    randomId: () => 'r',
  })
  const pendingOptions = createPendingOptionsStore(deps)
  const blueprint = createBlueprintStore(deps)
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(
    <App link={test.link} notices={test.notices} destinations={destinations} editMode={editMode} pendingOptions={pendingOptions} project={project} blueprint={blueprint} />,
    container,
  ))
  const receive = (frame: unknown) => act(() => test.socket().receive(frame))
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent === text)
  const click = (text: string) => act(() => {
    const target = button(text)
    if (target === undefined) throw new Error(`no button ${text}`)
    target.click()
  })
  const notices = () => container.querySelector('.notices')?.textContent ?? ''
  return { ...test, container, receive, button, click, notices, downloads }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('blueprint panel (happy-dom)', () => {
  it('lists the PCs, asks for a resync and adopts a blueprint', () => {
    const { container, receive, click, socket, button } = mount()
    expect(container.textContent).toContain('まだ設計図を受けていません')

    receive(wireSample('downstream-catalog'))
    const cards = [...container.querySelectorAll<HTMLElement>('[data-blueprint-host]')]
    expect(cards.map((card) => card.dataset.blueprintHost)).toEqual(['192.168.0.11', '192.168.0.12'])
    expect(cards[0].textContent).toContain('PC1(192.168.0.11)')
    expect(cards[0].textContent).toContain('1 項目')
    expect(cards[1].textContent).toContain('食い違い')

    click('設計図を取り直す')
    expect(socket().ofType('catalogRequest')).toEqual([{ v: 1, type: 'catalogRequest' }])

    act(() => cards[1].querySelector('button')?.click())
    expect(socket().ofType('catalogAdopt')).toEqual([{ v: 1, type: 'catalogAdopt', host: '192.168.0.12' }])

    receive({ v: 1, type: 'blueprintStatus', pc: { host: '192.168.0.12', name: 'PC2' }, absent: [] })
    expect(container.querySelector('[data-blueprint-host="192.168.0.12"] button')?.textContent).toBe('表示中')
    expect(button('この設計図から画面を作る')).toBeDefined()
  })

  it('tells why the bridge refused to adopt', () => {
    const { receive, notices } = mount()
    receive({ v: 1, type: 'notice', level: 'error', code: 'catalog-adopt-rejected', detail: 'unknown-pc: 192.168.0.99' })
    expect(notices()).toContain('設計図から画面を作れません: unknown-pc: 192.168.0.99')
  })
})

describe('pending options panel (happy-dom)', () => {
  it('appears only while lists are waiting, and applies one list or all', () => {
    const { container, receive, socket } = mount()
    expect(container.textContent).not.toContain('新しい一覧があります')

    receive(wireSample('downstream-runtime-options-pending'))
    expect(container.textContent).toContain('新しい一覧があります')
    expect(container.textContent).toContain('unity の一覧が変わりました(追加: メンバーC / 削除: メンバーB)')
    expect(container.textContent).toContain('all-devices(192.168.0.20) の一覧が変わりました(並び順だけが変わりました)')

    act(() => container.querySelector<HTMLButtonElement>('[data-pending-list="members"] button')?.click())
    expect(socket().ofType('runtimeOptionsApply').at(-1)).toEqual({ v: 1, type: 'runtimeOptionsApply', list: 'members' })
    act(() => container.querySelector<HTMLButtonElement>('[data-mark="pending-apply-all"]')?.click())
    expect(socket().ofType('runtimeOptionsApply').at(-1)).toEqual({ v: 1, type: 'runtimeOptionsApply' })

    receive(wireSample('downstream-runtime-options'))
    expect(container.textContent).not.toContain('新しい一覧があります')
  })
})

describe('project panel (happy-dom)', () => {
  it('exports to a download and shows the import button only in edit mode', () => {
    const { container, receive, click, socket, downloads, notices } = mount()
    expect(container.querySelector('input[type="file"]')).toBeNull()

    click('書き出す')
    receive({ ...wireSample('downstream-project'), requestId: socket().ofType('projectExport')[0].requestId })
    expect(downloads).toHaveLength(1)
    expect(notices()).toContain('プロジェクトを書き出しました')

    const toggle = [...container.querySelectorAll<HTMLInputElement>('.app-head input[type="checkbox"]')][0]
    act(() => toggle.click())
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
  })

  it('reads the chosen file, confirms with the bridge summary and imports', async () => {
    const test = mount()
    const { container, receive, click, socket } = test
    act(() => container.querySelector<HTMLInputElement>('.app-head input[type="checkbox"]')?.click())
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    if (input === null) throw new Error('no file input')
    const file = new File([JSON.stringify({ format: 'oscdesk-project' })], 'p.oscdesk-project.json', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
      for (let tries = 0; tries < 50 && socket().ofType('projectInspect').length === 0; tries += 1) await new Promise((resolve) => setTimeout(resolve, 5))
    })
    expect(test.notices()).toBe('')
    expect(socket().ofType('projectInspect')).toEqual([{ v: 1, type: 'projectInspect', requestId: 'inspect-1-r', project: { format: 'oscdesk-project' } }])

    receive({ ...wireSample('downstream-project-inspection-ok'), requestId: 'inspect-1-r' })
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('定義「stage」と保持値(値 1 件・行 1 件)')
    expect(dialog?.textContent).toContain('OSC パッド「take-03」(ボタン 1 個)')
    // 見出しの「読み込む」(ファイルを選ぶ)ではなく、ダイアログの「読み込む」
    act(() => [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((element) => element.textContent === '読み込む')?.click())
    expect(socket().ofType('projectImport')).toEqual([{ v: 1, type: 'projectImport', project: { format: 'oscdesk-project' } }])
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('shows the unsent banner and sends the held values after confirmation', () => {
    const { container, receive, click, socket } = mount()
    receive(wireSample('downstream-desired-status-unsent'))
    expect(container.textContent).toContain('まだ Unity へ送っていません')
    click('Unity へ送る')
    click('送る')
    expect(socket().ofType('resend')).toEqual([{ v: 1, type: 'resend' }])
    receive(wireSample('downstream-desired-status-sent'))
    expect(container.textContent).not.toContain('まだ Unity へ送っていません')
  })
})
