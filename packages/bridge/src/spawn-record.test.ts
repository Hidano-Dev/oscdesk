import { describe, expect, it } from 'vitest'

import { createSpawnRecord, spawnBase, spawnCommandOf, spawnedNameOf, spawnerPackage } from './spawn-record'

const SPAWN = '/effect/spawner/spawn'
const DESTROY = '/effect/spawner/destroy'
const none = () => false

describe('spawn commands (HID-385)', () => {
  it('treats only s triggers whose address ends with /spawn or /destroy as spawner commands', () => {
    expect(spawnCommandOf({ kind: 'trigger', type: 's', address: SPAWN })).toBe('spawn')
    expect(spawnCommandOf({ kind: 'trigger', type: 's', address: DESTROY })).toBe('destroy')
    expect(spawnCommandOf({ kind: 'state', type: 's', address: SPAWN })).toBeNull()
    expect(spawnCommandOf({ kind: 'trigger', type: 'i', address: SPAWN })).toBeNull()
    expect(spawnCommandOf({ kind: 'trigger', type: 's', address: '/effect/spawn' })).toBeNull()
    expect(spawnCommandOf({ kind: 'trigger', type: 's', address: '/effect/spawner/fire' })).toBeNull()
  })

  it('reads the package and the spawned name from addresses', () => {
    expect(spawnerPackage(SPAWN)).toBe('effect')
    expect(spawnedNameOf('/effect/spark1/stop')).toEqual({ packageName: 'effect', name: 'spark1' })
    expect(spawnedNameOf('/effect/spark1')).toBeNull()
    expect(spawnBase('spark12')).toBe('spark')
    expect(spawnBase('spark')).toBe('spark')
    expect(spawnBase('42')).toBe('42')
  })
})

describe('name allocation', () => {
  it('skips names used in any PC blueprint, in the record and reserved, and never repeats for back-to-back requests', () => {
    const record = createSpawnRecord({ now: () => 0 })
    const inBlueprint = (packageName: string, name: string) => packageName === 'effect' && name === 'spark1'
    const first = record.allocate(SPAWN, 'spark', inBlueprint)
    expect(first).toBe('spark2')
    // 記録する前の 2 つめの要求(別のブラウザ)も同じ名前を出さない(予約)
    const second = record.allocate(SPAWN, 'spark', inBlueprint)
    expect(second).toBe('spark3')
    record.recordSpawn('spawn', SPAWN, first, ['10.0.0.1'])
    record.recordSpawn('spawn', SPAWN, second, ['10.0.0.2'])
    expect(record.allocate(SPAWN, 'spark', inBlueprint)).toBe('spark4')
    // 別のパッケージの同じ名前はぶつからない
    expect(record.allocate('/other/spawner/spawn', 'spark', inBlueprint)).toBe('spark1')
  })

  it('uses a value that already ends with a number as it is', () => {
    const record = createSpawnRecord()
    record.recordSpawn('spawn', SPAWN, 'spark3', ['10.0.0.1'])
    expect(record.allocate(SPAWN, 'spark3', none)).toBe('spark3')
  })

  it('keeps a destroyed name reserved for a while before reusing it', () => {
    let clock = 0
    const record = createSpawnRecord({ now: () => clock, reserveMs: 1_000 })
    clock = 0
    record.recordSpawn('spawn', SPAWN, record.allocate(SPAWN, 'spark', none), ['10.0.0.1'])
    clock = 5_000
    record.recordDestroy(DESTROY, 'spark1', ['10.0.0.1'])
    expect(record.allocate(SPAWN, 'spark', none)).toBe('spark2')
    clock = 20_000
    expect(record.allocate(SPAWN, 'spark', none)).toBe('spark1')
  })
})

describe('record per PC', () => {
  it('records per host, removes on destroy only from the hosts it was sent to', () => {
    const record = createSpawnRecord()
    record.recordSpawn('spawn', SPAWN, 'spark1', ['a', 'b'])
    record.recordSpawn('spawn', SPAWN, 'spark2', ['a'])
    record.recordSpawn('spawn', SPAWN, 'spark1', ['a'])
    expect(record.forHost('a').map(entry => entry.name)).toEqual(['spark1', 'spark2'])
    expect(record.forHost('b').map(entry => entry.name)).toEqual(['spark1'])
    expect(record.recordDestroy(DESTROY, 'spark1', ['b'])).toBe(true)
    expect(record.forHost('b')).toEqual([])
    expect(record.forHost('a').map(entry => entry.name)).toEqual(['spark1', 'spark2'])
    expect(record.recordDestroy('/effect/other/destroy', 'spark1', ['a'])).toBe(false)
  })

  it('removes on a catalog remove from that PC, and marks the same thing on PCs that are down', () => {
    const record = createSpawnRecord()
    record.recordSpawn('spawn', SPAWN, 'spark1', ['a', 'b', 'c'])
    const down = new Set(['b'])
    expect(record.catalogRemoved('a', '/effect/spark1/stop', host => down.has(host))).toBe(true)
    expect(record.forHost('a')).toEqual([])
    expect(record.forHost('b')[0]?.removedElsewhere).toBe(true)
    expect(record.forHost('c')[0]?.removedElsewhere).toBeUndefined()

    // 止まっていた b が戻ると、印のあるものは復元しない。c は動いたまま持っている
    expect(record.takeRestore('b')).toEqual({ restore: [], dropped: [expect.objectContaining({ name: 'spark1', host: 'b' })] })
    expect(record.forHost('b')).toEqual([])
    expect(record.takeRestore('c').restore.map(entry => entry.name)).toEqual(['spark1'])
  })

  it('clears the mark when the PC shows it still has the thing', () => {
    const record = createSpawnRecord()
    record.recordSpawn('spawn', SPAWN, 'spark1', ['a', 'b'])
    record.catalogRemoved('a', '/effect/spark1/stop', () => true)
    expect(record.catalogSeen('b', '/effect/spark1/stop')).toBe(true)
    expect(record.takeRestore('b').restore.map(entry => entry.name)).toEqual(['spark1'])
  })

  it('drops the record of hosts that are no longer destinations and replaces it on import', () => {
    const record = createSpawnRecord()
    record.recordSpawn('spawn', SPAWN, 'spark1', ['a', 'b'])
    expect(record.retainHosts(host => host === 'a')).toBe(true)
    expect(record.entries().map(entry => entry.host)).toEqual(['a'])
    record.replace([
      { param: 'spawn', address: SPAWN, name: 'spark9', host: 'z' },
      { param: 'spawn', address: SPAWN, name: 'bad/name', host: 'z' },
      { param: 'spawn', address: '/not-a-spawner', name: 'x1', host: 'z' },
    ])
    expect(record.entries()).toEqual([{ param: 'spawn', address: SPAWN, name: 'spark9', host: 'z' }])
  })
})

describe('reconcile', () => {
  const spawners = [{ address: SPAWN, bases: ['spark'] }]

  it('lists what the PC lacks and what it has beyond the record', () => {
    const record = createSpawnRecord()
    record.recordSpawn('spawn', SPAWN, 'spark1', ['a'])
    record.recordSpawn('spawn', SPAWN, 'spark2', ['a'])
    const items = ['/effect/spark2/stop', '/effect/spark5/stop', '/effect/lamp/level', '/effect/lamp2/level']
    const plan = record.reconcile('a', items, spawners)
    expect(plan.missing.map(entry => entry.name)).toEqual(['spark1'])
    // シーンに最初からある対象(lamp・lamp2 は生成担当の振る形でない)は消さない
    expect(plan.extras).toEqual([{ destroyAddress: DESTROY, name: 'spark5' }])
    expect(plan.dropped).toEqual([])
  })

  it('treats every record as missing when the PC has no blueprint', () => {
    const record = createSpawnRecord()
    record.recordSpawn('spawn', SPAWN, 'spark1', ['a'])
    expect(record.reconcile('a', null, spawners)).toEqual({
      missing: [expect.objectContaining({ name: 'spark1' })], extras: [], dropped: [],
    })
  })

  it('drops marked records the PC lacks instead of spawning them again', () => {
    const record = createSpawnRecord()
    record.recordSpawn('spawn', SPAWN, 'spark1', ['a', 'b'])
    record.catalogRemoved('a', '/effect/spark1/stop', () => true)
    const plan = record.reconcile('b', [], spawners)
    expect(plan.missing).toEqual([])
    expect(plan.dropped.map(entry => entry.name)).toEqual(['spark1'])
    expect(record.forHost('b')).toEqual([])
  })
})
