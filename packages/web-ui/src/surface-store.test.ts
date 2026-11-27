import { describe, expect, it } from 'vitest'

import { LOCK } from '@oscdesk/shared'

import { ACTION_ECHO_TIMEOUT_MS, HOLD_TIMEOUT_MS, INPUT_HOLD_TIMEOUT_MS, LOCK_RENEW_INTERVAL_MS, MIN_SEND_INTERVAL_MS, TICK_MS } from './surface-logic'
import { createSurfaceStore } from './surface-store'
import { STAGE_DEFINITION, surfaceFrame } from './surface-test-support'
import { createTestLink } from './test-support'

// 主画面の状態(NiceGUI 版の test_state_* の値・レコード・まとめ送り・ロックに当たる)。偽の WebSocket にフレームを流し、
// 送ったフレームと signal を確かめる

const HOLDER = 'spa-test-holder'

function setup() {
  const test = createTestLink()
  const store = createSurfaceStore({
    link: test.link,
    notices: test.notices,
    now: test.timers.now,
    setTimer: test.timers.setTimer,
    holder: HOLDER,
    holderLabel: 'テストのタブ',
    logInfo: () => undefined,
  })
  const socket = () => test.socket()
  socket().receive({ v: 1, type: 'hello', clientId: 'c1', protocolVersion: 1, server: { name: 'oscdesk-bridge', version: '0' }, unity: { host: '127.0.0.1', sendPort: 7090 }, targets: [{ name: 'unity', host: '127.0.0.1', sendPort: 7090, primary: true }], bridge: { oscListenPort: 7091, wsPort: 7080 }, heartbeat: { intervalMs: 5000, timeoutMs: 15000 }, pingIntervalMs: 1000, debug: false, adapters: ['osc'] })
  socket().receive(surfaceFrame())
  const view = store.content.value!.view
  const spec = (param: string) => view.parameters.find((item) => item.param === param)!
  const placed = (param: string) => view.controls.find((item) => item.param === param)!
  const record = (id: string) => view.records.find((item) => item.record === id)!
  const action = (id: string) => view.actions.find((item) => item.action === id)!
  const advance = (ms: number) => {
    test.timers.advance(ms)
    // 偽の時計は進めた分の予約だけを走らせるので、定期の処理は明示して回す
    store.tick()
  }
  const notices = () => test.notices.items.value.map((notice) => `${notice.level}: ${notice.text}`)
  return { ...test, store, socket, view, spec, placed, record, action, advance, notices }
}

describe('surface store', () => {
  it('asks for the surface on connect and seeds defaults until the desired values arrive', () => {
    const { socket, store } = setup()
    expect(socket().ofType('surfaceRequest')).toHaveLength(1)
    expect(store.info.value).toMatchObject({ name: 'stage', label: 'Stage', revision: 1 })
    expect(store.channelOf('master').values).toEqual([0.5])
    expect(store.channelOf('tint').values).toEqual([1, 0, 0])

    socket().receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.8 }, { param: 'tint', value: { r: 0, g: 1, b: 0 } }], rows: [] })
    expect(store.channelOf('master').values).toEqual([0.8])
    expect(store.channelOf('tint').values).toEqual([0, 1, 0])
    // 全量に無い state の値は消す(前の定義の値を残さない)
    expect(store.channelOf('mute').values).toBeNull()
  })

  it('does not rebuild on a re-delivery of the same definition, but does when it changes', () => {
    const { socket, store } = setup()
    const before = store.content.value
    socket().receive(surfaceFrame(STAGE_DEFINITION, 2))
    expect(store.content.value).toBe(before)
    expect(store.info.value?.revision).toBe(2)
    socket().receive(surfaceFrame({ ...STAGE_DEFINITION, name: 'Stage 2' }, 3))
    expect(store.content.value?.version).toBe((before?.version ?? 0) + 1)
  })

  it('sends a slider with thinning, the holder and the revision, and keeps the lock alive while held', () => {
    const { socket, store, placed, advance } = setup()
    const master = placed('master')
    expect(store.beginHold(master)).toBe(true)
    expect(socket().ofType('lock').at(-1)).toEqual({ v: 1, type: 'lock', ref: { param: 'master' }, holder: HOLDER, label: 'テストのタブ' })
    store.setLocal(master, [0.1])
    store.setLocal(master, [0.2])
    expect(socket().ofType('set')).toEqual([{ v: 1, type: 'set', param: 'master', value: 0.1, holder: HOLDER, revision: 1 }])
    advance(MIN_SEND_INTERVAL_MS + 1)
    expect(socket().ofType('set').at(-1)).toMatchObject({ value: 0.2 })

    // 押したまま動かさない間もロックを延長する(期限より短い間隔で)
    const locks = socket().ofType('lock').length
    advance(LOCK_RENEW_INTERVAL_MS)
    expect(socket().ofType('lock').length).toBe(locks + 1)
    expect(LOCK_RENEW_INTERVAL_MS).toBeLessThan(LOCK.LEASE_MS)

    store.setLocal(master, [0.3])
    store.endHold(master)
    expect(socket().ofType('set').at(-1)).toMatchObject({ value: 0.3 })
    expect(socket().ofType('unlock').at(-1)).toEqual({ v: 1, type: 'unlock', ref: { param: 'master' }, holder: HOLDER })
  })

  it('ignores echoes while held and drops a hold whose release never came', () => {
    const { socket, store, placed, advance } = setup()
    const master = placed('master')
    store.beginHold(master)
    store.setLocal(master, [0.9])
    socket().receive({ v: 1, type: 'echo', values: [{ param: 'master', value: 0.1 }], rows: [] })
    expect(store.channelOf('master').values).toEqual([0.9])
    advance(HOLD_TIMEOUT_MS + TICK_MS)
    expect(store.channelOf('master').values).toEqual([0.1])
    // 期限で切れたホールドのロックは延長をやめて外す
    expect(socket().ofType('unlock').at(-1)).toMatchObject({ ref: { param: 'master' } })
  })

  it('refuses to operate a control another browser holds', () => {
    const { socket, store, placed } = setup()
    socket().receive({ v: 1, type: 'locks', locks: [{ ref: { param: 'mute' }, clientId: 'c2', holder: 'other', label: 'iPad' }] })
    expect(store.paramLockLabel('mute')).toBe('iPad')
    expect(store.setDiscrete(placed('mute'), [true])).toBe(false)
    expect(store.beginHold(placed('mute'))).toBe(false)
    expect(socket().ofType('set')).toHaveLength(0)
    // 自分のロックは自分を止めない
    socket().receive({ v: 1, type: 'locks', locks: [{ ref: { param: 'mute' }, clientId: 'c1', holder: HOLDER, label: 'テストのタブ' }] })
    expect(store.setDiscrete(placed('mute'), [true])).toBe(true)
    expect(socket().ofType('set').at(-1)).toMatchObject({ param: 'mute', value: true })
  })

  it('does not send a parameter that is not standalone, nor from a replaced screen', () => {
    const { socket, store, placed, spec } = setup()
    store.pressTrigger(placed('part'))
    expect(socket().ofType('set')).toHaveLength(0)
    const old = placed('go')
    socket().receive(surfaceFrame({ ...STAGE_DEFINITION, name: 'Changed' }, 2))
    store.pressTrigger(old)
    expect(socket().ofType('set')).toHaveLength(0)
    store.pressTrigger(spec('go'))
    expect(socket().ofType('set')).toHaveLength(0)
    store.pressTrigger(store.content.value!.view.controls.find((item) => item.param === 'go')!)
    expect(socket().ofType('set').at(-1)).toMatchObject({ param: 'go', value: 1, revision: 2 })
  })

  it('sends an action as one batch and confirms it by the echoes', () => {
    const { socket, store, action, advance, notices } = setup()
    socket().receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.25 }], rows: [] })
    store.pressAction(action('all'))
    // mute は全量に値が無かったので外して知らせる
    expect(notices()).toContain('warn: 「Send all」: 値が未設定の 1 件は送りませんでした (Mute)')
    expect(socket().ofType('batch').at(-1)).toEqual({ v: 1, type: 'batch', items: [{ param: 'master', value: 0.25 }, { param: 'go' }], holder: HOLDER, revision: 1 })
    socket().receive({ v: 1, type: 'echo', values: [{ param: 'master', value: Math.fround(0.25) }, { param: 'go' }], rows: [] })
    expect(notices()).toContain('info: 「Send all」を送信しました(2 件を確認)')

    store.pressAction(action('all'))
    advance(ACTION_ECHO_TIMEOUT_MS + TICK_MS)
    expect(notices().at(-1)).toBe('error: 「Send all」: 2 / 2 件のエコーを確認できませんでした (Master, GO)')
  })

  it('reports a batch the bridge refused without waiting for its echoes', () => {
    const { socket, store, action, advance, notices } = setup()
    socket().receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.25 }, { param: 'mute', value: false }], rows: [] })
    store.pressAction(action('all'))
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'batch-rejected', detail: 'locked: master' })
    advance(ACTION_ECHO_TIMEOUT_MS + TICK_MS)
    expect(notices()).toEqual(['error: 「Send all」を送れませんでした: locked: master'])
  })

  it('builds record rows from the key list and desired, and sends a whole row on a field edit', () => {
    const { socket, store, record } = setup()
    const member = record('member')
    socket().receive({
      v: 1, type: 'runtimeOptions', lists: [{ list: 'members', targets: [] }], choices: [],
      keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }], fieldChoices: [],
    })
    expect(store.rowsOf(member).map((row) => row.name)).toEqual(['Alice', 'Bob'])
    // 保持値が届くまでは新しい行の値で見せる
    expect(store.rowChannelOf('member', 'id-1').values).toEqual([false, 1])
    socket().receive({ v: 1, type: 'desired', full: false, values: [], rows: [{ record: 'member', key: 'id-2', values: { active: true, slot: 5 } }] })
    expect(store.rowChannelOf('member', 'id-2').values).toEqual([true, 5])

    store.setRowField(member, 'id-2', 1, 7, true)
    expect(socket().ofType('setRow').at(-1)).toEqual({ v: 1, type: 'setRow', record: 'member', key: 'id-2', values: { active: true, slot: 7 }, holder: HOLDER, revision: 1 })
  })

  it('keeps the edited field of a held row and shows the echo on the other fields', () => {
    const { socket, store, record } = setup()
    const member = record('member')
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    store.beginRowHold(member, 'id-1', 'input')
    expect(socket().ofType('lock').at(-1)).toMatchObject({ ref: { record: 'member', key: 'id-1' } })
    store.setRowField(member, 'id-1', 1, 9, false)
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 2 } }] })
    expect(store.rowChannelOf('member', 'id-1').values).toEqual([true, 9])
    store.endRowHold(member, 'id-1')
    expect(socket().ofType('unlock').at(-1)).toMatchObject({ ref: { record: 'member', key: 'id-1' } })
  })

  it('expands row and table actions over the shown rows', () => {
    const { socket, store, record, action } = setup()
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    store.pressAction(action('on'))
    expect(socket().ofType('batch').at(-1)?.items).toEqual([
      { record: 'member', key: 'id-1', values: { active: true, slot: 1 } },
      { record: 'member', key: 'id-2', values: { active: true, slot: 1 } },
    ])
    // 次のまとめは、前のまとめの対象がすべて片付いてから送る
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }, { record: 'member', key: 'id-2', values: { active: true, slot: 1 } }] })
    store.pressAction(action('send'), 'id-2')
    // 届いたエコー(active: true)が行の表示値になっている
    expect(socket().ofType('batch').at(-1)?.items).toEqual([{ record: 'member', key: 'id-2', values: { active: true, slot: 1 } }])
    store.pressRowTrigger(record('cue'), 'x')
    expect(socket().ofType('setRow').at(-1)).toMatchObject({ record: 'cue', key: 'x', values: { fire: 1 } })
  })

  it('adds, renames and removes rows through the bridge, with the local checks', () => {
    const { socket, store, record } = setup()
    const member = record('member')
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    expect(store.addRow(member, '  ')).toBe('名前を入力してください')
    expect(store.addRow(member, ' Alice ')).toBe('「Alice」は既にあります')
    expect(store.addRow(member, 'Carol')).toBeNull()
    expect(socket().ofType('recordKeyAdd').at(-1)).toEqual({ v: 1, type: 'recordKeyAdd', record: 'member', key: 'Carol' })
    expect(store.renameRow(member, 'id-1', 'Bob')).toBe('「Bob」は既にあります')
    expect(store.renameRow(member, 'id-1', 'Ann')).toBeNull()
    expect(socket().ofType('recordKeyRename').at(-1)).toEqual({ v: 1, type: 'recordKeyRename', record: 'member', key: 'id-1', name: 'Ann' })
    expect(store.removeRow(member, 'id-2')).toBeNull()
    expect(socket().ofType('recordKeyRemove').at(-1)).toEqual({ v: 1, type: 'recordKeyRemove', record: 'member', key: 'id-2' })

    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2', 'id-3'], names: ['Alice', 'Bob', 'Carol'] }] })
    expect(store.rowLimitReached(member)).toBe(true)
    expect(store.addRow(member, 'Dave')).toBe('上限の 3 件に達しています')
  })

  it('asks for the desired values again when the bridge refuses a value', () => {
    const { socket, notices } = setup()
    socket().receive({ v: 1, type: 'notice', level: 'warn', code: 'set-rejected', detail: 'stale-surface: master' })
    expect(notices()).toEqual(['warn: 値を送れませんでした: stale-surface: master'])
    expect(socket().ofType('surfaceRequest')).toHaveLength(2)
  })

  it('forgets the lists, locks and in-flight sends on a disconnect, and asks again after reconnecting', () => {
    const { socket, sockets, store, placed, timers } = setup()
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [{ list: 'segments', targets: [{ name: 'unity', options: ['Intro'] }] }], choices: [{ param: 'segment', options: ['(none)', 'Intro'] }] })
    socket().receive({ v: 1, type: 'locks', locks: [{ ref: { param: 'mute' }, clientId: 'c2', holder: 'other', label: 'iPad' }] })
    expect(store.optionsFor(placed('segment'))).toEqual({ options: ['(none)', 'Intro'], arrived: true })
    socket().drop()
    expect(store.optionsFor(placed('segment'))).toEqual({ options: ['(none)'], arrived: false })
    expect(store.paramLockLabel('mute')).toBeNull()
    timers.advance(1_000)
    sockets.at(-1)?.open()
    // 要求は bridge-link が hello の後に送る(D-155)
    socket().receive({ v: 1, type: 'hello', clientId: 'c1', protocolVersion: 1, server: { name: 'oscdesk-bridge', version: '0' }, unity: { host: '127.0.0.1', sendPort: 7090 }, targets: [{ name: 'unity', host: '127.0.0.1', sendPort: 7090, primary: true }], bridge: { oscListenPort: 7091, wsPort: 7080 }, heartbeat: { intervalMs: 5000, timeoutMs: 15000 }, pingIntervalMs: 1000, debug: false, adapters: ['osc'] })
    expect(socket().ofType('surfaceRequest')).toHaveLength(1)
  })

  it('tells "no adopted definition" apart from "still waiting" by the saved list (D-155)', () => {
    const test = createTestLink()
    const store = createSurfaceStore({ link: test.link, notices: test.notices, now: test.timers.now, setTimer: test.timers.setTimer, holder: HOLDER, logInfo: () => undefined })
    // 一覧がまだ届いていない間は待つ
    expect(store.noSurface.value).toBe(false)
    // 一覧が採用中の定義を指していれば、続く surface を待つ
    test.socket().receive({ v: 1, type: 'surfaceList', names: ['stage'], active: 'stage' })
    expect(store.noSurface.value).toBe(false)
    // 採用中の定義が無い(既定の定義が無いブリッジ)。surface は届かないので待たない
    test.socket().receive({ v: 1, type: 'surfaceList', names: ['stage'], active: null })
    expect(store.noSurface.value).toBe(true)
    test.socket().receive(surfaceFrame())
    expect(store.noSurface.value).toBe(false)
    // 切れたら、つなぎ直して一覧が届くまでは待つ側に戻す
    test.socket().receive({ v: 1, type: 'surfaceList', names: [], active: null })
    expect(store.noSurface.value).toBe(true)
    test.socket().drop()
    expect(store.noSurface.value).toBe(false)
  })

  it('rebuilds when only the bindings change, so a held operation is not sent to the newly bound address (PR #158)', () => {
    const { socket, store, placed, advance } = setup()
    const master = placed('master')
    store.beginHold(master)
    store.setLocal(master, [0.1])
    store.setLocal(master, [0.2])
    const rebound = {
      ...STAGE_DEFINITION,
      bindings: { osc: { ...STAGE_DEFINITION.bindings.osc, parameters: STAGE_DEFINITION.bindings.osc.parameters.map((item) => ({ ...item, address: `/q/${item.id}` })) } },
    }
    const before = store.content.value
    socket().receive(surfaceFrame(rebound, 2))
    expect(store.content.value).not.toBe(before)
    advance(MIN_SEND_INTERVAL_MS + 1)
    store.endHold(master)
    // 保留していた 0.2 は新しい版で送られない
    expect(socket().ofType('set').map((frame) => frame.value)).toEqual([0.1])
  })

  it('drops pending sends without a hold (keyboard) when the definition is replaced (PR #158)', () => {
    const { socket, store, placed, record, advance } = setup()
    const master = placed('master')
    // キーボードで動かすと pointerdown を通らず、ホールドしていないチャンネルに間引いた値が残る
    store.setLocal(master, [0.1])
    store.setLocal(master, [0.2])
    const member = record('member')
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    store.setRowField(member, 'id-1', 1, 5, false)
    store.setRowField(member, 'id-1', 1, 6, false)
    const rebound = {
      ...STAGE_DEFINITION,
      bindings: { osc: { ...STAGE_DEFINITION.bindings.osc, parameters: STAGE_DEFINITION.bindings.osc.parameters.map((item) => ({ ...item, address: `/q/${item.id}` })) } },
    }
    socket().receive(surfaceFrame(rebound, 2))
    advance(MIN_SEND_INTERVAL_MS + 1)
    expect(socket().ofType('set').map((frame) => frame.value)).toEqual([0.1])
    expect(socket().ofType('setRow').map((frame) => (frame.values as { slot: number }).slot)).toEqual([5])
    expect(store.channelOf('master').hasPending).toBe(false)
  })

  it('drops the edit state and the lock of a row removed while it is being edited (HID-475)', () => {
    const { socket, store, record, advance } = setup()
    const member = record('member')
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    socket().receive({ v: 1, type: 'desired', full: true, values: [], rows: [{ record: 'member', key: 'id-2', values: { active: true, slot: 5 } }] })
    store.beginRowHold(member, 'id-2', 'input')
    store.setRowEditing(member, 'id-2', true)
    store.setRowField(member, 'id-2', 1, 7, false)
    store.setRowField(member, 'id-2', 1, 8, false)
    const setRows = socket().ofType('setRow').length

    // 別のブラウザが行を消した: 一覧からも保持値からも無くなる。入力欄は blur の前に画面から消える
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    socket().receive({ v: 1, type: 'desired', full: true, values: [], rows: [] })
    expect(store.rowsOf(member).map((row) => row.key)).toEqual(['id-1'])
    expect(socket().ofType('unlock').at(-1)).toEqual({ v: 1, type: 'unlock', ref: { record: 'member', key: 'id-2' }, holder: HOLDER })
    expect(store.rowChannelOf('member', 'id-2').holding).toBe(false)

    // 以後の tick は消えた行のロックを延長せず、間引いた値も送らない
    const locks = socket().ofType('lock').length
    for (let at = 0; at < HOLD_TIMEOUT_MS * 2; at += LOCK_RENEW_INTERVAL_MS) advance(LOCK_RENEW_INTERVAL_MS)
    expect(socket().ofType('lock')).toHaveLength(locks)
    expect(socket().ofType('setRow')).toHaveLength(setRows)
    expect(store.rowChannelOf('member', 'id-2').holding).toBe(false)
  })

  it('keeps the hold of a row that is still shown from the key list or the desired values (HID-475)', () => {
    const { socket, store, record } = setup()
    const member = record('member')
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    socket().receive({ v: 1, type: 'desired', full: true, values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 5 } }] })
    store.beginRowHold(member, 'id-1', 'input')
    // 一覧から外れても保持値があれば行は残る(印付きで表示される)ので、操作は続ける
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: [], names: [] }] })
    expect(store.rowsOf(member).map((row) => row.key)).toEqual(['id-1'])
    expect(store.rowChannelOf('member', 'id-1').holding).toBe(true)
    expect(socket().ofType('unlock')).toHaveLength(0)
    // 保持値の全量から消えても一覧にあれば行は残る
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    socket().receive({ v: 1, type: 'desired', full: true, values: [], rows: [] })
    expect(store.rowsOf(member).map((row) => row.key)).toEqual(['id-1'])
    expect(store.rowChannelOf('member', 'id-1').holding).toBe(true)
    expect(socket().ofType('unlock')).toHaveLength(0)
  })

  it('drops a thinned value without a hold (keyboard) of a row that vanished (HID-475)', () => {
    const { socket, store, record } = setup()
    const member = record('member')
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    store.setRowField(member, 'id-2', 1, 5, false)
    store.setRowField(member, 'id-2', 1, 6, false)
    expect(store.rowChannelOf('member', 'id-2').hasPending).toBe(true)
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    expect(store.rowChannelOf('member', 'id-2').hasPending).toBe(false)
    expect(store.rowChannelOf('member', 'id-1').hasPending).toBe(false)
  })

  it('does not keep extending the hold of a row that came back after a reconnect (HID-475)', () => {
    const { socket, sockets, store, record, timers, advance } = setup()
    const member = record('member')
    const listed = { v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] } as const
    socket().receive(listed)
    store.beginRowHold(member, 'id-1', 'input')
    store.setRowEditing(member, 'id-1', true)
    // 一覧だけにある行は、切断で一覧を忘れると表示から消える(入力欄も消え、blur は来ない)
    socket().drop()
    timers.advance(1_000)
    sockets.at(-1)?.open()
    socket().receive(listed)
    expect(store.rowsOf(member).map((row) => row.key)).toEqual(['id-1'])
    advance(INPUT_HOLD_TIMEOUT_MS + 1)
    expect(store.rowChannelOf('member', 'id-1').holding).toBe(false)
    expect(socket().ofType('lock')).toHaveLength(0)
  })

  it('keeps a slider held while it keeps moving past the hold timeout (PR #158)', () => {
    const { store, placed, record, socket, advance } = setup()
    const master = placed('master')
    store.beginHold(master)
    for (let at = 0; at < HOLD_TIMEOUT_MS * 2; at += 200) {
      advance(200)
      store.setLocal(master, [at / 10_000])
    }
    expect(store.channelOf('master').holding).toBe(true)
    expect(socket().ofType('unlock')).toHaveLength(0)

    const member = record('member')
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    store.beginRowHold(member, 'id-1', 'slider')
    for (let at = 0; at < HOLD_TIMEOUT_MS * 2; at += 200) {
      advance(200)
      store.setRowField(member, 'id-1', 1, at % 60 + 1, false)
    }
    expect(store.rowChannelOf('member', 'id-1').holding).toBe(true)
  })

  it('ties a batch rejection to the batch that caused it (PR #158)', () => {
    const { socket, store, action, advance, notices } = setup()
    socket().receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.25 }, { param: 'mute', value: false }], rows: [] })
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    store.pressAction(action('all'))
    store.pressAction(action('on'))
    // 1 つ目の答えが来るまで 2 つ目は送らない(拒否にはどのまとめかの印が無いので、送った順で結び付ける)
    expect(socket().ofType('batch')).toHaveLength(1)
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'batch-rejected', detail: 'locked: master' })
    expect(socket().ofType('batch')).toHaveLength(2)
    expect(socket().ofType('batch').at(-1)?.items).toEqual([{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }])
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }] })
    advance(ACTION_ECHO_TIMEOUT_MS + TICK_MS)
    expect(notices()).toEqual(['error: 「Send all」を送れませんでした: locked: master', 'info: 「On」を送信しました(1 件を確認)'])
  })

  it('sends the next batch only after every target of the previous one is settled (PR #158)', () => {
    const { socket, store, advance, notices } = setup()
    // A = master・mute・go、B = go、C = 行。A の一部のエコーで B を送ると、A の残りのエコーで B を成功とみなし、
    // C まで送ってしまい、後から届く B の拒否が C に付く
    socket().receive(surfaceFrame({
      ...STAGE_DEFINITION,
      actions: [...STAGE_DEFINITION.actions, { id: 'goOnly', label: 'Go only', steps: [{ param: 'go' }] }],
    }, 2))
    const view = store.content.value!.view
    const actionOf = (id: string) => view.actions.find((item) => item.action === id)!
    socket().receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.25 }, { param: 'mute', value: false }], rows: [] })
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    store.pressAction(actionOf('all'))
    store.pressAction(actionOf('goOnly'))
    store.pressAction(actionOf('on'))
    socket().receive({ v: 1, type: 'echo', values: [{ param: 'master', value: Math.fround(0.25) }], rows: [] })
    expect(socket().ofType('batch')).toHaveLength(1)
    socket().receive({ v: 1, type: 'echo', values: [{ param: 'mute', value: false }, { param: 'go' }], rows: [] })
    // A が片付いてから B を送る。C は B が片付くまで送らない
    expect(socket().ofType('batch').map((frame) => frame.items)).toEqual([
      [{ param: 'master', value: 0.25 }, { param: 'mute', value: false }, { param: 'go' }],
      [{ param: 'go' }],
    ])
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'batch-rejected', detail: 'locked: go' })
    expect(socket().ofType('batch')).toHaveLength(3)
    // 時間切れで片付いた後も次を送る
    advance(ACTION_ECHO_TIMEOUT_MS + TICK_MS)
    expect(notices()).toEqual([
      'info: 「Send all」を送信しました(3 件を確認)',
      'error: 「Go only」を送れませんでした: locked: go',
      'error: 「On」: 1 / 1 件のエコーを確認できませんでした (Member [Alice])',
    ])
  })

  it('does not report a timeout for a row removed while its batch waits for the echoes (HID-480)', () => {
    const { socket, store, action, advance, notices } = setup()
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    store.pressAction(action('on'))
    expect(socket().ofType('batch')).toHaveLength(1)
    // 別のブラウザが Bob を消した。削除の後に届いた Alice のエコーで、時間切れを待たずに片付く(消えた行は確認の対象から外す。HID-481)
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }] })
    expect(notices()).toEqual(['info: 「On」を送信しました(1 件を確認。削除された行の 1 件は除きました)'])

    // 対象の行がすべて消えても、答え(拒否か時間切れ)までは送信中のまま。時間切れでは「削除された」と知らせる
    store.pressAction(action('send'), 'id-1')
    expect(socket().ofType('batch')).toHaveLength(2)
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: [], names: [] }] })
    expect(notices()).toHaveLength(1)
    advance(ACTION_ECHO_TIMEOUT_MS + TICK_MS)
    expect(notices().at(-1)).toBe('warn: 「Send」: 対象の 1 件はエコーを確かめる前に行が削除されました')
    expect(notices().filter((text) => text.startsWith('error:'))).toEqual([])
  })

  it('ties the rejection of a batch whose rows were all removed to that batch, not to the next press (HID-480)', () => {
    const { socket, store, action, advance, notices } = setup()
    socket().receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.25 }, { param: 'mute', value: false }], rows: [] })
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }] })
    store.pressAction(action('send'), 'id-1')
    store.pressAction(action('all'))
    // ブリッジが削除を先に処理したので、届いた「Send」を unknown-row で断る。一覧の更新は拒否より先に届く
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: [], names: [] }] })
    expect(socket().ofType('batch')).toHaveLength(1)
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'batch-rejected', detail: 'unknown-row: member[id-1]' })
    expect(socket().ofType('batch')).toHaveLength(2)
    socket().receive({ v: 1, type: 'echo', values: [{ param: 'master', value: Math.fround(0.25) }, { param: 'mute', value: false }, { param: 'go' }], rows: [] })
    advance(ACTION_ECHO_TIMEOUT_MS + TICK_MS)
    expect(notices()).toEqual([
      'error: 「Send」を送れませんでした: unknown-row: member[id-1]',
      'info: 「Send all」を送信しました(3 件を確認)',
    ])
  })

  it('keeps the timeout of the rows still shown, and leaves the removed rows out of its count (HID-480)', () => {
    const { socket, store, action, advance, notices } = setup()
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    store.pressAction(action('on'))
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    advance(ACTION_ECHO_TIMEOUT_MS + TICK_MS)
    expect(notices()).toEqual(['error: 「On」: 1 / 1 件のエコーを確認できませんでした (Member [Alice])。削除された行の 1 件は除きました'])
  })

  it('does not send the rows removed while a pressed batch waits behind the previous one (HID-480)', () => {
    const { socket, store, action, notices } = setup()
    socket().receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.25 }, { param: 'mute', value: false }], rows: [] })
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    store.pressAction(action('all'))
    store.pressAction(action('on'))
    store.pressAction(action('send'), 'id-2')
    expect(socket().ofType('batch')).toHaveLength(1)
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    socket().receive({ v: 1, type: 'echo', values: [{ param: 'master', value: Math.fround(0.25) }, { param: 'mute', value: false }, { param: 'go' }], rows: [] })
    // 「On」は残った Alice だけを送る。「Send」は対象が消えたので送らない
    expect(socket().ofType('batch').map((frame) => frame.items)).toEqual([
      [{ param: 'master', value: 0.25 }, { param: 'mute', value: false }, { param: 'go' }],
      [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }],
    ])
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }] })
    expect(socket().ofType('batch')).toHaveLength(2)
    expect(notices()).toEqual([
      'info: 「Send all」を送信しました(3 件を確認)',
      'info: 「On」を送信しました(1 件を確認。削除された行の 1 件は除きました)',
      'warn: 「Send」: 対象の 1 件が送る前に行が削除されたため送りませんでした',
    ])
  })

  it('waits for the answer when the batch was settled before its row was removed (HID-481)', () => {
    const { socket, store, action, advance, notices } = setup()
    socket().receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.25 }, { param: 'mute', value: false }], rows: [] })
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    store.pressAction(action('on'))
    store.pressAction(action('all'))
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }] })
    // Bob のエコーだけを待っている間に Bob が消えた。ブリッジが先に削除を処理していれば直後に拒否が届くので、
    // 一覧の受信の中では片付けず、次の押下も送らない(送ると、その拒否を次の押下に付けてしまう。PR #158)
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    expect(socket().ofType('batch')).toHaveLength(1)
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'batch-rejected', detail: 'unknown-row: member[id-2]' })
    expect(socket().ofType('batch')).toHaveLength(2)
    socket().receive({ v: 1, type: 'echo', values: [{ param: 'master', value: Math.fround(0.25) }, { param: 'mute', value: false }, { param: 'go' }], rows: [] })
    advance(ACTION_ECHO_TIMEOUT_MS + TICK_MS)
    expect(notices()).toEqual([
      'error: 「On」を送れませんでした: unknown-row: member[id-2]',
      'info: 「Send all」を送信しました(3 件を確認)',
    ])
  })

  it('checks the echo of a row again when the same ID comes back while the batch waits (HID-481)', () => {
    const { socket, store, action, advance, notices } = setup()
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    store.pressAction(action('on'))
    // プロジェクトの読み込みなどで一覧が一瞬空になり、同じ ID の行が戻った
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: [], names: [] }] })
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }] })
    expect(notices()).toEqual([])
    // 戻った行のエコーも確かめる。届かなければ「削除された」ではなく確認できなかったと知らせる
    advance(ACTION_ECHO_TIMEOUT_MS + TICK_MS)
    expect(notices()).toEqual(['error: 「On」: 1 / 2 件のエコーを確認できませんでした (Member [Bob])'])
  })

  it('counts the echoes that came while their rows were gone (HID-481)', () => {
    const { socket, store, action, notices } = setup()
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2'], names: ['Alice', 'Bob'] }] })
    store.pressAction(action('on'))
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: [], names: [] }] })
    // 行が消えている間に、両方の行のエコーが届いた(ブリッジはまとめを受け付けていた)
    socket().receive({ v: 1, type: 'echo', values: [], rows: [
      { record: 'member', key: 'id-1', values: { active: true, slot: 1 } },
      { record: 'member', key: 'id-2', values: { active: true, slot: 1 } },
    ] })
    // 削除の後に届いたエコーで揃ったので、時間切れを待たずに片付く。届いた行は確認に数える
    expect(notices()).toEqual(['info: 「On」を送信しました(2 件を確認)'])
  })

  it('does not take a trigger echo after the removal as proof that the bridge took the batch (HID-481)', () => {
    const { socket, store, advance, notices } = setup()
    // 同じ一覧(members)の行を持つトリガーのレコード。エコーは値を問わずに確認とする
    socket().receive(surfaceFrame({
      ...STAGE_DEFINITION,
      records: [...STAGE_DEFINITION.records, { id: 'ping', label: 'Ping', kind: 'trigger', keysFrom: { list: 'members', source: 'ui', max: 3 }, fields: [{ id: 'fire', label: 'Fire', type: 'i', value: 1 }] }],
      actions: [...STAGE_DEFINITION.actions, { id: 'goOn', label: 'Go on', scope: 'all', steps: [{ record: 'ping' }, { record: 'member', value: { active: true } }] }],
      bindings: { osc: { ...STAGE_DEFINITION.bindings.osc, records: [...STAGE_DEFINITION.bindings.osc.records, { id: 'ping', address: '/ping' }] } },
    }, 2))
    const view = store.content.value!.view
    const actionOf = (id: string) => view.actions.find((item) => item.action === id)!
    socket().receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.25 }, { param: 'mute', value: false }], rows: [] })
    const members = (keys: string[], names: string[]) => [{ record: 'member', keys, names }, { record: 'ping', keys, names }]
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: members(['id-1', 'id-2'], ['Alice', 'Bob']) })
    store.pressAction(actionOf('goOn'))
    store.pressAction(actionOf('all'))
    expect(socket().ofType('batch')).toHaveLength(1)
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }] })
    // Bob が消えた後に Alice の Ping のエコーが届いた。値を問わないのでほかの操作の Ping と見分けられず、受け付けられた印にはしない
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: members(['id-1'], ['Alice']) })
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'ping', key: 'id-1', values: { fire: 1 } }] })
    expect(socket().ofType('batch')).toHaveLength(1)
    socket().receive({ v: 1, type: 'notice', level: 'error', code: 'batch-rejected', detail: 'unknown-row: member[id-2]' })
    expect(socket().ofType('batch')).toHaveLength(2)
    socket().receive({ v: 1, type: 'echo', values: [{ param: 'master', value: Math.fround(0.25) }, { param: 'mute', value: false }, { param: 'go' }], rows: [] })
    advance(ACTION_ECHO_TIMEOUT_MS + TICK_MS)
    expect(notices()).toEqual([
      'error: 「Go on」を送れませんでした: unknown-row: member[id-2]',
      'info: 「Send all」を送信しました(3 件を確認)',
    ])
  })

  it('keeps the proof of a post-removal echo when another row is removed later (HID-481)', () => {
    const { socket, store, action } = setup()
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-2', 'id-3'], names: ['Alice', 'Bob', 'Carol'] }] })
    store.pressAction(action('on'))
    store.pressAction(action('off'))
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1', 'id-3'], names: ['Alice', 'Carol'] }] })
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }] })
    // Bob の削除の後に Alice のエコーが届いたので、ブリッジはもう受け付けている。後で Carol が消えても待たない
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    socket().receive({ v: 1, type: 'echo', values: [], rows: [] })
    expect(socket().ofType('batch')).toHaveLength(2)
  })

  it('still sends a row that came back while its press waited behind the previous batch (HID-481)', () => {
    const { socket, store, action, notices } = setup()
    socket().receive({ v: 1, type: 'desired', full: true, values: [{ param: 'master', value: 0.25 }, { param: 'mute', value: false }], rows: [] })
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    store.pressAction(action('all'))
    store.pressAction(action('on'))
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: [], names: [] }] })
    socket().receive({ v: 1, type: 'runtimeOptions', lists: [], choices: [], keys: [{ record: 'member', keys: ['id-1'], names: ['Alice'] }] })
    socket().receive({ v: 1, type: 'echo', values: [{ param: 'master', value: Math.fround(0.25) }, { param: 'mute', value: false }, { param: 'go' }], rows: [] })
    expect(socket().ofType('batch').at(-1)?.items).toEqual([{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }])
    socket().receive({ v: 1, type: 'echo', values: [], rows: [{ record: 'member', key: 'id-1', values: { active: true, slot: 1 } }] })
    expect(notices()).toEqual(['info: 「Send all」を送信しました(3 件を確認)', 'info: 「On」を送信しました(1 件を確認)'])
  })

  it('clears the screen when the bridge has no active surface', () => {
    const { socket, store } = setup()
    socket().receive({ v: 1, type: 'surfaceList', names: [], active: null })
    expect(store.content.value).toBeNull()
    expect(store.info.value).toBeNull()
  })
})
