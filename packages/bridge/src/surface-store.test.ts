import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SAMPLE_DEFINITION } from './surface-fixture'
import { createSurfaceStore } from './surface-store'


let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-surfaces-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('createSurfaceStore', () => {
  it('lists nothing when the folder does not exist yet', () => {
    expect(createSurfaceStore({ dir: path.join(dir, 'missing') }).list()).toEqual([])
  })

  it('saves, lists and reads back a definition', () => {
    const store = createSurfaceStore({ dir })
    expect(store.save('stage', SAMPLE_DEFINITION).ok).toBe(true)
    expect(store.list()).toEqual(['stage'])
    const read = store.read('stage')
    expect(read.ok && read.value.name).toBe('Stage')
  })

  it('keeps the previous content as a backup on every overwrite', () => {
    let clock = Date.UTC(2026, 9, 8, 10, 0, 0)
    const store = createSurfaceStore({ dir, now: () => clock })
    store.save('stage', SAMPLE_DEFINITION)
    expect(fs.existsSync(path.join(dir, '.backups'))).toBe(false)

    clock += 1000
    store.save('stage', { ...SAMPLE_DEFINITION, name: 'Stage v2' })
    clock += 1000
    store.save('stage', { ...SAMPLE_DEFINITION, name: 'Stage v3' })

    const backups = fs.readdirSync(path.join(dir, '.backups')).sort()
    expect(backups).toEqual(['stage.20261008T100001000Z.json', 'stage.20261008T100002000Z.json'])
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.backups', backups[0]), 'utf8')).name).toBe('Stage')
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.backups', backups[1]), 'utf8')).name).toBe('Stage v2')
    // 一覧にバックアップは混ざらない
    expect(store.list()).toEqual(['stage'])
  })

  it('prunes old backups beyond the per-name limit', () => {
    let clock = Date.UTC(2026, 9, 8, 10, 0, 0)
    const store = createSurfaceStore({ dir, now: () => clock })
    for (let i = 0; i < 30; i += 1) {
      store.save('stage', SAMPLE_DEFINITION)
      clock += 1000
    }
    expect(fs.readdirSync(path.join(dir, '.backups'))).toHaveLength(20)
  })

  it('rejects an invalid definition without touching the existing file', () => {
    const store = createSurfaceStore({ dir })
    store.save('stage', SAMPLE_DEFINITION)
    const before = fs.readFileSync(path.join(dir, 'stage.json'), 'utf8')
    const result = store.save('stage', { ...SAMPLE_DEFINITION, extra: true })
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.kind).toBe('invalid-definition')
    expect(fs.readFileSync(path.join(dir, 'stage.json'), 'utf8')).toBe(before)
    expect(fs.existsSync(path.join(dir, '.backups'))).toBe(false)
  })

  it.each(['../evil', 'a/b', 'a\\b', '.backups', '', 'CON', 'x.json'])('refuses the name %j', (name) => {
    const store = createSurfaceStore({ dir })
    expect(store.save(name, SAMPLE_DEFINITION)).toMatchObject({ ok: false, error: { kind: 'invalid-name' } })
    expect(store.read(name)).toMatchObject({ ok: false, error: { kind: 'invalid-name' } })
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('reports not-found, invalid JSON and invalid definitions on read', () => {
    const store = createSurfaceStore({ dir })
    expect(store.read('nope')).toMatchObject({ ok: false, error: { kind: 'not-found' } })
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json')
    expect(store.read('broken')).toMatchObject({ ok: false, error: { kind: 'invalid-json' } })
    fs.writeFileSync(path.join(dir, 'wrong.json'), '{"format":"x"}')
    expect(store.read('wrong')).toMatchObject({ ok: false, error: { kind: 'invalid-definition' } })
  })

  it('reads a UTF-8 file with a BOM', () => {
    fs.writeFileSync(path.join(dir, 'bom.json'), `﻿${JSON.stringify(SAMPLE_DEFINITION)}`)
    expect(createSurfaceStore({ dir }).read('bom').ok).toBe(true)
  })
})
