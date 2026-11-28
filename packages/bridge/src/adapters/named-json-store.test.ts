import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PadDocumentStoredSchema, upgradePadDocument } from '@oscdesk/shared'

import { createNamedJsonStore } from './named-json-store'

const SAMPLE_PAD = {
  format: 'oscdesk-pad', version: 2, rows: 2, columns: 2,
  widgets: [{ id: 'fire', kind: 'button', row: 0, column: 0, label: 'Fire', address: '/fx/fire', args: [{ type: 'i', value: 1 }] }],
}
const V1_PAD = {
  format: 'oscdesk-pad', version: 1, rows: 2, columns: 2,
  buttons: [{ id: 'fire', row: 0, column: 0, label: 'Fire', address: '/fx/fire', args: [{ type: 'i', value: 1 }] }],
}

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-pads-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const storeAt = (options: { dir?: string; now?: () => number } = {}) =>
  createNamedJsonStore({ dir: options.dir ?? dir, schema: PadDocumentStoredSchema, upgrade: upgradePadDocument, logInfo: () => {}, logWarn: () => {}, ...(options.now === undefined ? {} : { now: options.now }) })

describe('createNamedJsonStore', () => {
  it('lists nothing when the folder does not exist yet', () => {
    expect(storeAt({ dir: path.join(dir, 'missing') }).list()).toEqual([])
  })

  it('saves, lists and reads back a document', () => {
    const store = storeAt()
    expect(store.save('stage', SAMPLE_PAD).ok).toBe(true)
    expect(store.list()).toEqual(['stage'])
    const read = store.read('stage')
    expect(read.ok && read.value.widgets[0]?.id).toBe('fire')
  })

  it('keeps the previous content as a backup on every overwrite and prunes beyond the per-name limit', () => {
    let clock = Date.UTC(2026, 9, 8, 10, 0, 0)
    const store = storeAt({ now: () => clock })
    store.save('stage', SAMPLE_PAD)
    expect(fs.existsSync(path.join(dir, '.backups'))).toBe(false)
    clock += 1000
    store.save('stage', { ...SAMPLE_PAD, rows: 3 })
    expect(fs.readdirSync(path.join(dir, '.backups'))).toEqual(['stage.20261008T100001000Z.json'])
    // 一覧にバックアップは混ざらない
    expect(store.list()).toEqual(['stage'])
    for (let i = 0; i < 30; i += 1) {
      clock += 1000
      store.save('stage', SAMPLE_PAD)
    }
    expect(fs.readdirSync(path.join(dir, '.backups'))).toHaveLength(20)
  })

  it('rejects an invalid document without touching the existing file', () => {
    const store = storeAt()
    store.save('stage', SAMPLE_PAD)
    const before = fs.readFileSync(path.join(dir, 'stage.json'), 'utf8')
    const result = store.save('stage', { ...SAMPLE_PAD, extra: true })
    expect(result.ok === false && result.error.kind).toBe('invalid-definition')
    expect(fs.readFileSync(path.join(dir, 'stage.json'), 'utf8')).toBe(before)
  })

  it.each(['../evil', 'a/b', 'a\\b', '.backups', '', 'CON', 'x.json'])('refuses the name %j', (name) => {
    const store = storeAt()
    expect(store.save(name, SAMPLE_PAD)).toMatchObject({ ok: false, error: { kind: 'invalid-name' } })
    expect(store.read(name)).toMatchObject({ ok: false, error: { kind: 'invalid-name' } })
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('reports not-found and invalid JSON, reads a BOM and rewrites an old version in the current one', () => {
    const store = storeAt()
    expect(store.read('nope')).toMatchObject({ ok: false, error: { kind: 'not-found' } })
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json')
    expect(store.read('broken')).toMatchObject({ ok: false, error: { kind: 'invalid-json' } })
    fs.writeFileSync(path.join(dir, 'bom.json'), `﻿${JSON.stringify(SAMPLE_PAD)}`)
    expect(store.read('bom').ok).toBe(true)
    fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify(V1_PAD))
    expect(store.read('old').ok).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'old.json'), 'utf8')).version).toBe(2)
  })
})
