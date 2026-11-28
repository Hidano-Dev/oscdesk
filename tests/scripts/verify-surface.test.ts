import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// @ts-expect-error -- 型定義の無い .mjs(ランチャーの補助スクリプト)を直接読む
import { exportSample, prepareVerification } from '../../scripts/verify-surface.mjs'

const samples = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../protocol/pad-document-samples.json'), 'utf8'),
) as { cases: { name: string; valid: boolean; pad: unknown }[] }
const samplePad = (name: string) => samples.cases.find((entry) => entry.name === name)?.pad
const ACTIVE = (name: string) => ({ format: 'oscdesk-pad-active', active: name })

describe('verify-surface (HID-222・D-175)', () => {
  let root: string
  const baseConfig = {
    unity: { host: '127.0.0.1', sendPort: 7090 },
    bridge: { oscListenPort: 7091, wsPort: 7080 },
    debug: false,
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-verify-'))
    fs.mkdirSync(path.join(root, 'config'))
    fs.writeFileSync(path.join(root, 'config', 'oscdesk.config.json'), JSON.stringify(baseConfig))
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const readJson = (relative: string) => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'))

  it('places the sample pad, marks it as the adopted pad and writes a config without touching the base config', () => {
    const { configPath } = prepareVerification({ root, out: 'logs/verify/c.json', sample: 'full-example', name: 'stage' })

    expect(readJson('surfaces/pads/stage.json')).toEqual(samplePad('full-example'))
    expect(readJson('surfaces/pads/.active.json')).toEqual(ACTIVE('stage'))
    // 撤去した surfaces.defaultName は書かない(ブリッジが警告して読み捨てる)
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual(baseConfig)
    expect(readJson('config/oscdesk.config.json')).toEqual(baseConfig)
  })

  it('uses surfaces.padsDir when the base config sets it', () => {
    fs.writeFileSync(path.join(root, 'config', 'oscdesk.config.json'), JSON.stringify({ ...baseConfig, surfaces: { dir: 'data', padsDir: 'my-pads' } }))
    prepareVerification({ root, out: 'c.json', sample: 'empty-pad' })
    expect(readJson('my-pads/empty-pad.json')).toEqual(samplePad('empty-pad'))
    expect(readJson('my-pads/.active.json')).toEqual(ACTIVE('empty-pad'))
  })

  it('keeps an existing pad unless reset, and backs it up on reset', () => {
    fs.mkdirSync(path.join(root, 'surfaces', 'pads'), { recursive: true })
    fs.writeFileSync(path.join(root, 'surfaces', 'pads', 'stage.json'), '{"edited":true}')

    const kept = prepareVerification({ root, out: 'c.json', sample: 'full-example', name: 'stage' })
    expect(readJson('surfaces/pads/stage.json')).toEqual({ edited: true })
    expect(readJson('surfaces/pads/.active.json')).toEqual(ACTIVE('stage'))
    expect(kept.messages.join('\n')).toContain('-Reset')

    prepareVerification({ root, out: 'c.json', sample: 'full-example', name: 'stage', reset: true })
    expect(readJson('surfaces/pads/stage.json')).toEqual(samplePad('full-example'))
    const backups = fs.readdirSync(path.join(root, 'surfaces', 'pads', '.backups'))
    expect(backups).toHaveLength(1)
    expect(readJson(`surfaces/pads/.backups/${backups[0]}`)).toEqual({ edited: true })
  })

  it('adds secondary targets', () => {
    const { configPath } = prepareVerification({ root, out: 'c.json', secondary: ['backup:127.0.0.1:7092'] })
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).unity.secondary).toEqual([
      { name: 'backup', host: '127.0.0.1', sendPort: 7092 },
    ])
  })

  it('rejects invalid samples, unknown samples and unusable names', () => {
    const invalid = samples.cases.find((entry) => !entry.valid)!.name
    expect(() => prepareVerification({ root, out: 'c.json', sample: invalid })).toThrow(/valid: false/)
    expect(() => prepareVerification({ root, out: 'c.json', sample: 'no-such-sample' })).toThrow(/ありません/)
    expect(() => prepareVerification({ root, out: 'c.json', sample: 'full-example', name: '../x' })).toThrow(/保存名/)
    expect(() => prepareVerification({ root, out: 'c.json', secondary: ['backup'] })).toThrow(/<name>:<host>:<port>/)
  })

  it('exports any sample including invalid ones', () => {
    const invalid = samples.cases.find((entry) => !entry.valid)!
    const outPath = path.join(root, 'invalid.json')
    exportSample(invalid.name, outPath)
    expect(JSON.parse(fs.readFileSync(outPath, 'utf8'))).toEqual(invalid.pad)
  })
})
