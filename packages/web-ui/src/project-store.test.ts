import { describe, expect, it } from 'vitest'

import { createEditMode } from './edit-mode'
import { createProjectStore, PROJECT_TIMEOUT_MS } from './project-store'
import { createTestLink, wireSample } from './test-support'

function setup(options: { editing?: boolean } = {}) {
  const test = createTestLink()
  const editMode = createEditMode(options.editing ?? true)
  const downloads: { name: string; text: string }[] = []
  const store = createProjectStore({
    link: test.link,
    notices: test.notices,
    editing: editMode.editing,
    download: (name, text) => downloads.push({ name, text }),
    now: () => new Date(2026, 10, 27, 9, 5, 7),
    setTimer: test.timers.setTimer,
    clearTimer: test.timers.clearTimer,
    randomId: () => 'r',
  })
  const texts = () => test.notices.items.value.map((notice) => notice.text)
  return { ...test, store, editMode, downloads, texts }
}

const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe('project store: export', () => {
  it('asks the bridge and downloads the answer for the same request id', () => {
    const { store, socket, downloads, texts } = setup()
    store.exportProject()
    const sent = socket().ofType('projectExport')
    expect(sent).toEqual([{ v: 1, type: 'projectExport', requestId: 'export-1-r' }])
    expect(store.exporting.value).toBe(true)

    const sample = wireSample('downstream-project')
    socket().receive({ ...sample, requestId: 'someone-else' })
    expect(downloads).toEqual([])

    socket().receive({ ...sample, requestId: 'export-1-r' })
    expect(downloads.map((item) => item.name)).toEqual(['stage-20261127-090507.oscdesk-project.json'])
    expect(JSON.parse(downloads[0].text)).toMatchObject({ format: 'oscdesk-project', surface: { name: 'stage' } })
    expect(texts()).toContain('プロジェクトを書き出しました(定義「stage」・パッド「take-03」)')
    expect(store.exporting.value).toBe(false)
  })

  it('settles the oldest request when the bridge refuses, and warns when no answer comes', () => {
    const { store, socket, timers, texts } = setup()
    store.exportProject()
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'project-export-rejected', detail: 'empty: no surface or pad is adopted' })
    expect(texts()).toContain('プロジェクトを書き出せません: empty: no surface or pad is adopted')
    expect(store.exporting.value).toBe(false)

    store.exportProject()
    timers.advance(PROJECT_TIMEOUT_MS + 1)
    expect(texts()).toContain('プロジェクトの書き出しの応答がありませんでした')
  })

  it('says so when it cannot send, and forgets the request on a disconnect', () => {
    const { store, socket, texts } = setup()
    store.exportProject()
    socket().drop()
    expect(texts()).toContain('ブリッジとの接続が切れたため、プロジェクトを書き出せませんでした')
    store.exportProject()
    expect(texts()).toContain('ブリッジに接続していないため書き出せません')
  })
})

describe('project store: import', () => {
  it('inspects the file at the bridge, confirms with its summary and imports on confirm', () => {
    const { store, socket, texts } = setup()
    socket().receive({ v: 1, type: 'surfaceList', names: ['live'], active: 'live' })
    const project = { format: 'oscdesk-project', version: 2 }
    store.inspectBytes(bytesOf(project))
    expect(socket().ofType('projectInspect')).toEqual([{ v: 1, type: 'projectInspect', requestId: 'inspect-1-r', project }])
    expect(store.inspecting.value).toBe(true)

    const answer = wireSample('downstream-project-inspection-ok')
    socket().receive({ ...answer, requestId: 'inspect-1-r' })
    expect(store.confirm.value).toMatchObject({ project, activeSurface: 'live', activePad: null, summary: { surface: { name: 'stage', spawns: 2 } } })

    store.confirmImport()
    expect(socket().ofType('projectImport')).toEqual([{ v: 1, type: 'projectImport', project }])
    expect(store.confirm.value).toBeNull()
    expect(texts()).toContain('プロジェクトの読み込みを要求しました')
  })

  it('shows the bridge reason when the inspection fails, and does not open the dialog', () => {
    const { store, socket, texts } = setup()
    store.inspectBytes(bytesOf({ format: 'oscdesk-surface' }))
    socket().receive({ ...wireSample('downstream-project-inspection-rejected'), requestId: 'inspect-1-r' })
    expect(store.confirm.value).toBeNull()
    expect(texts()[0]).toContain('サーフェス定義のファイル')
  })

  it('does not ask the bridge about a file that is not JSON', () => {
    const { store, socket, texts } = setup()
    store.inspectBytes(new TextEncoder().encode('not json'))
    expect(socket().ofType('projectInspect')).toEqual([])
    expect(texts()[0]).toMatch(/^プロジェクトを読み込めません: JSON として読めません/)
  })

  it('only imports in edit mode, and drops the answer when edit mode was turned off while waiting', () => {
    const { store, socket, editMode, texts } = setup({ editing: false })
    store.inspectBytes(bytesOf({}))
    expect(socket().ofType('projectInspect')).toEqual([])

    editMode.set(true)
    store.inspectBytes(bytesOf({}))
    editMode.set(false)
    socket().receive({ ...wireSample('downstream-project-inspection-ok'), requestId: 'inspect-1-r' })
    expect(store.confirm.value).toBeNull()
    expect(texts()).toContain('編集モードを切ったため、プロジェクトの読み込みをやめました')
  })

  it('forgets an inspection after the time limit (a late answer is ignored)', () => {
    const { store, socket, timers, texts } = setup()
    store.inspectBytes(bytesOf({}))
    timers.advance(PROJECT_TIMEOUT_MS + 1)
    expect(texts()).toContain('プロジェクトの確認の応答がありませんでした')
    socket().receive({ ...wireSample('downstream-project-inspection-ok'), requestId: 'inspect-1-r' })
    expect(store.confirm.value).toBeNull()
  })

  it('refuses a file that is too large before reading it', async () => {
    const { store, socket, texts } = setup()
    await store.inspectFile({ size: 64 * 1024 * 1024, arrayBuffer: () => Promise.reject(new Error('read')) } as unknown as Blob)
    expect(socket().ofType('projectInspect')).toEqual([])
    expect(texts()).toContain('ファイルが大きすぎるため読み込めません')
  })
})

describe('project store: unsent values', () => {
  it('follows desiredStatus and sends resend to all targets on confirm', () => {
    const { store, socket, texts } = setup()
    socket().receive(wireSample('downstream-desired-status-unsent'))
    expect(store.unsentSince.value).toBe('2026-10-28T10:00:00.000Z')
    socket().receive({ v: 1, type: 'notice', level: 'info', code: 'project-imported', detail: 'surface stage, pad take-03' })
    expect(texts()).toContain('プロジェクトを読み込みました(surface stage, pad take-03)。保持値はまだ Unity へ送っていません')

    store.openSend()
    store.confirmSend()
    expect(socket().ofType('resend')).toEqual([{ v: 1, type: 'resend' }])
    socket().receive(wireSample('downstream-desired-status-sent'))
    expect(store.unsentSince.value).toBeNull()
  })

  it('requests the surface state (and the pad list with an OSC adapter) on hello', () => {
    const { socket } = setup()
    socket().receive(wireSample('downstream-hello'))
    expect(socket().ofType('surfaceRequest')).toHaveLength(1)
    expect(socket().ofType('osc.padRequest')).toHaveLength(1)
  })
})
