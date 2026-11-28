// @vitest-environment happy-dom
// プロジェクトファイル(版 3。D-175)の書き出しと読み込みの画面。main.tsx と同じ組み立て(stores.ts)で描き、
// 「同期」タブのプロジェクトのパネルから送るフレームと、確認のダイアログ・通知を確かめる
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { App } from './app'
import { padListFrame } from './pad-test-support'
import { PROJECT_TIMEOUT_MS } from './project-store'
import { createAppStores } from './stores'
import { createTestLink, wireSample } from './test-support'

function mount() {
  const test = createTestLink()
  const downloads: { name: string; text: string }[] = []
  const stores = createAppStores({
    link: test.link, notices: test.notices, now: test.timers.now, setTimer: test.timers.setTimer, clearTimer: test.timers.clearTimer,
    holder: 'project-test', randomId: () => 'r',
  })
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(<App link={test.link} notices={test.notices} {...stores} />, container))
  const receive = (frame: unknown) => act(() => test.socket().receive(frame))
  const panel = () => container.querySelector<HTMLElement>('[data-mark="project"]')
  const button = (label: string) => [...(panel()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(item => item.textContent === label)
  const texts = () => test.notices.items.value.map(notice => notice.text)
  return { ...test, stores, container, receive, panel, button, texts, downloads }
}

afterEach(() => {
  document.body.innerHTML = ''
})

const V2_FILE = {
  format: 'oscdesk-project', version: 2, exportedAt: '2026-10-28T10:00:00.000Z',
  surface: { name: 'stage', definition: {}, values: { values: [{}], rows: [] } },
  osc: { pad: { name: 'take-01', pad: { format: 'oscdesk-pad', version: 1, rows: 1, columns: 1, buttons: [] } } },
}

describe('project panel (happy-dom, D-175)', () => {
  it('sits in the sync tab and asks the bridge for an export', () => {
    const { receive, panel, button, socket } = mount()
    receive(wireSample('downstream-hello'))
    expect(panel()?.closest('#panel-sync')).not.toBeNull()
    act(() => button('書き出す')?.click())
    expect(socket().ofType('projectExport')).toEqual([{ v: 1, type: 'projectExport', requestId: 'export-1-r' }])
    expect(button('書き出し中…')?.disabled).toBe(true)
  })

  it('inspects a chosen file, shows what it would import and what it drops, and imports only on confirm', () => {
    const { receive, stores, socket, container, texts } = mount()
    receive(wireSample('downstream-hello'))
    receive(padListFrame('live'))
    act(() => stores.project.inspectBytes(new TextEncoder().encode(JSON.stringify(V2_FILE))))
    const inspect = socket().ofType('projectInspect')
    expect(inspect).toEqual([{ v: 1, type: 'projectInspect', requestId: 'inspect-1-r', project: V2_FILE }])
    expect(socket().ofType('projectImport')).toEqual([])

    receive({
      v: 1, type: 'projectInspection', requestId: 'inspect-1-r',
      result: { ok: true, summary: {
        exportedAt: '2026-10-28T10:00:00.000Z', sourceVersion: 2, pad: { name: 'take-01', widgets: 0 }, values: { widgets: 0, rows: 0 },
        destinations: 0, droppedSurface: { name: 'stage', values: 1, rows: 0 },
      } },
    })
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.textContent).toContain('パッド「take-01」')
    expect(dialog?.textContent).toContain('採用中のパッド「live」')
    expect(dialog?.querySelector('[data-mark="dropped-surface"]')?.textContent).toContain('サーフェス定義「stage」')
    act(() => [...(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(item => item.textContent === '読み込む')?.click())
    expect(socket().ofType('projectImport')).toEqual([{ v: 1, type: 'projectImport', project: V2_FILE }])
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    receive({ v: 1, type: 'notice', level: 'info', code: 'project-imported', detail: 'pad "take-01", 0 value(s), surface definition "stage" was not imported' })
    expect(texts().at(-1)).toContain('まだ送り先へ送っていません')
  })

  it('tells why a file was refused, and gives up waiting after the time limit or a disconnect', () => {
    const { receive, stores, texts, timers, socket } = mount()
    receive(wireSample('downstream-hello'))
    act(() => stores.project.inspectBytes(new TextEncoder().encode('{"format":"oscdesk-surface"}')))
    receive({ v: 1, type: 'projectInspection', requestId: 'inspect-1-r', result: { ok: false, detail: 'surface-file: x' } })
    expect(texts().at(-1)).toContain('サーフェス定義のファイル')

    act(() => stores.project.inspectBytes(new TextEncoder().encode('{}')))
    act(() => timers.advance(PROJECT_TIMEOUT_MS + 1))
    expect(texts().at(-1)).toBe('プロジェクトの確認の応答がありませんでした')

    act(() => stores.project.exportProject())
    act(() => socket().drop())
    expect(texts().at(-1)).toBe('ブリッジとの接続が切れたため、プロジェクトを書き出せませんでした')
  })
})
