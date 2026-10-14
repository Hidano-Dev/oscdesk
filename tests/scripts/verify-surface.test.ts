import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// @ts-expect-error -- 型定義の無い .mjs(ランチャーの補助スクリプト)を直接読む
import { exportSample, prepareVerification } from '../../scripts/verify-surface.mjs'

const samples = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../protocol/surface-definition-samples.json'), 'utf8'),
) as { cases: { name: string; valid: boolean; definition: unknown }[] }
const sampleDefinition = (name: string) => samples.cases.find((entry) => entry.name === name)?.definition

describe('verify-surface (HID-222)', () => {
  let root: string
  const baseConfig = {
    unity: { host: '127.0.0.1', sendPort: 7090 },
    bridge: { oscListenPort: 7091, wsPort: 7080 },
    ui: { port: 8080 },
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

  it('places the sample and writes a config that adopts it without touching the base config', () => {
    const { configPath } = prepareVerification({ root, out: 'logs/verify/c.json', sample: 'full-example', name: 'stage' })

    expect(readJson('surfaces/stage.json')).toEqual(sampleDefinition('full-example'))
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual({
      ...baseConfig,
      surfaces: { dir: 'surfaces', defaultName: 'stage' },
    })
    expect(readJson('config/oscdesk.config.json')).toEqual(baseConfig)
  })

  it('keeps an existing definition unless reset, and backs it up on reset', () => {
    fs.mkdirSync(path.join(root, 'surfaces'))
    fs.writeFileSync(path.join(root, 'surfaces', 'stage.json'), '{"edited":true}')

    const kept = prepareVerification({ root, out: 'c.json', sample: 'full-example', name: 'stage' })
    expect(readJson('surfaces/stage.json')).toEqual({ edited: true })
    expect(kept.messages.join('\n')).toContain('-Reset')

    prepareVerification({ root, out: 'c.json', sample: 'full-example', name: 'stage', reset: true })
    expect(readJson('surfaces/stage.json')).toEqual(sampleDefinition('full-example'))
    const backups = fs.readdirSync(path.join(root, 'surfaces', '.backups'))
    expect(backups).toHaveLength(1)
    expect(readJson(`surfaces/.backups/${backups[0]}`)).toEqual({ edited: true })
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
    expect(JSON.parse(fs.readFileSync(outPath, 'utf8'))).toEqual(invalid.definition)
  })
})
