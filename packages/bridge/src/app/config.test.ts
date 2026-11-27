import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { BridgeConfigSchema } from '@oscdesk/shared'

import {
  DEFAULT_BRIDGE_CONFIG_PATH,
  BRIDGE_CONFIG_ENV_VAR,
  defaultBridgeConfigPath,
  loadBridgeConfig,
  parseBridgeConfig,
  resolveBridgeConfigPath,
  resolveWebUiDir,
} from './config'

describe('resolveBridgeConfigPath', () => {
  it('uses the environment override when present', () => {
    expect(
      resolveBridgeConfigPath({
        [BRIDGE_CONFIG_ENV_VAR]: 'C:/tmp/custom-surface.config.json',
      } as NodeJS.ProcessEnv),
    ).toBe('C:/tmp/custom-surface.config.json')
  })

  it('falls back to the default repository config path', () => {
    // 式を写さず、リポジトリに実在する config を指すことを確かめる(ソースから読んだ場合)
    const repositoryConfig = path.resolve(__dirname, '../../../../config/oscdesk.config.json')
    expect(fs.existsSync(repositoryConfig)).toBe(true)
    expect(DEFAULT_BRIDGE_CONFIG_PATH).toBe(repositoryConfig)
    expect(resolveBridgeConfigPath({} as NodeJS.ProcessEnv)).toBe(DEFAULT_BRIDGE_CONFIG_PATH)
  })

  it('points at the same repository config from the bundle in packages/bridge/dist (D-134)', () => {
    const repositoryConfig = path.resolve(__dirname, '../../../../config/oscdesk.config.json')
    expect(defaultBridgeConfigPath(path.resolve(__dirname, '../../dist'))).toBe(repositoryConfig)
    expect(defaultBridgeConfigPath(path.resolve(__dirname, '../../src/app'))).toBe(repositoryConfig)
  })
})

describe('resolveWebUiDir (D-138)', () => {
  const webUiDist = path.resolve(__dirname, '../../../web-ui/dist')
  it('finds packages/web-ui/dist next to the bundle and the sources', () => {
    expect(resolveWebUiDir(path.resolve(__dirname, '../../dist'), undefined)).toBe(webUiDist)
    expect(resolveWebUiDir(path.resolve(__dirname, '../../src/app'), undefined)).toBe(webUiDist)
  })

  it('resolves a configured dir from the working directory', () => {
    expect(resolveWebUiDir(__dirname, 'custom/dist', path.resolve('/work'))).toBe(path.resolve('/work', 'custom/dist'))
  })
})

describe('repository runtime configurations', () => {
  const configDirectory = path.resolve(__dirname, '../../../../config')
  const configurations = [
    ['oscdesk.config.json', { debug: false, oscUiEnabled: false }],
    ['oscdesk.debug.config.json', { debug: true, oscUiEnabled: false }],
    ['oscdesk.touchosc.config.json', { debug: true, oscUiEnabled: true }],
  ] as const

  it.each(configurations)('%s passes BridgeConfigSchema validation', (filename, expected) => {
    const raw = JSON.parse(fs.readFileSync(path.join(configDirectory, filename), 'utf8'))
    const result = BridgeConfigSchema.safeParse(raw)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.debug).toBe(expected.debug)
      expect(result.data.oscUi.enabled).toBe(expected.oscUiEnabled)
    }
  })
})

describe('parseBridgeConfig', () => {
  it('serves the web UI by default and accepts webUi.enabled / webUi.dir (D-138)', () => {
    const base = { unity: { host: '127.0.0.1', sendPort: 9000 }, debug: false, boolFallbackToInt: false }
    expect(parseBridgeConfig(base).webUi).toEqual({ enabled: true })
    expect(parseBridgeConfig({ ...base, webUi: { enabled: false, dir: 'ui/dist' } }).webUi).toEqual({ enabled: false, dir: 'ui/dist' })
    expect(() => parseBridgeConfig({ ...base, webUi: { path: '/ui/' } })).toThrow(/webUi/)
  })

  it('accepts an optional surfaces.valuesDir and rejects unknown surfaces keys (D-058)', () => {
    const base = { unity: { host: '127.0.0.1', sendPort: 9000 }, debug: false, boolFallbackToInt: false }
    expect(parseBridgeConfig(base).surfaces).toEqual({ dir: 'surfaces' })
    expect(parseBridgeConfig({ ...base, surfaces: { valuesDir: 'state/values' } }).surfaces)
      .toEqual({ dir: 'surfaces', valuesDir: 'state/values' })
    expect(() => parseBridgeConfig({ ...base, surfaces: { valuesDir: '' } })).toThrow(/surfaces\.valuesDir/)
    expect(() => parseBridgeConfig({ ...base, surfaces: { valuesFile: 'x' } })).toThrow(/surfaces/)
  })

  it('parses a valid runtime config', () => {
    expect(
      parseBridgeConfig({
        unity: {
          host: '127.0.0.1',
          sendPort: 9000,
        },
        debug: false,
        boolFallbackToInt: true,
      }),
    ).toEqual(
      BridgeConfigSchema.parse({
        unity: {
          host: '127.0.0.1',
          sendPort: 9000,
        },
        debug: false,
        boolFallbackToInt: true,
        diagnostics: {
          ringBufferSize: 200,
          lossRateWindow: 30,
          ndjsonDir: 'logs/diagnostics',
          ndjsonMaxTotalBytes: 52_428_800,
        },
      }),
    )
  })

  it('reports nested validation failures with field paths', () => {
    expect(() =>
      parseBridgeConfig({
        unity: {
          host: '',
          sendPort: 0,
        },
        debug: 'false',
        boolFallbackToInt: false,
      }),
    ).toThrow(
      'unity.host: String must contain at least 1 character(s); unity.sendPort: Number must be greater than or equal to 1; debug: Expected boolean, received string',
    )
  })

  it('rejects the legacy Unity receivePort key instead of aliasing it', () => {
    expect(() => parseBridgeConfig({
      unity: { host: 'localhost', sendPort: 9000, receivePort: 9001 },
      debug: false,
      boolFallbackToInt: false,
    })).toThrow('unity: Unrecognized key(s) in object: \'receivePort\'')
  })
})

describe('loadBridgeConfig', () => {
  const validConfig = {
        unity: {
          host: 'localhost',
          sendPort: 9000,
        },
        debug: true,
        boolFallbackToInt: false,
      }

  it('loads config through the injected file reader', () => {
    const readFile = vi.fn(() => JSON.stringify(validConfig))

    const result = loadBridgeConfig({ path: 'D:/tmp/override.json', readFile })

    expect(readFile).toHaveBeenCalledWith('D:/tmp/override.json')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.unity.host).toBe('localhost')
    }
  })

  it('distinguishes a missing file from another read failure', () => {
    const notFound = loadBridgeConfig({
      path: 'D:/missing/surface.config.json',
      readFile: () => {
        const error = new Error('missing') as Error & { code: string }
        error.code = 'ENOENT'
        throw error
      },
    })
    const denied = loadBridgeConfig({
      path: 'D:/denied/surface.config.json',
      readFile: () => {
        throw new Error('EACCES')
      },
    })

    expect(notFound).toEqual({ ok: false, error: { kind: 'not-found', path: 'D:/missing/surface.config.json' } })
    expect(denied).toEqual({
      ok: false,
      error: { kind: 'read-failed', path: 'D:/denied/surface.config.json', detail: 'EACCES' },
    })
  })

  // フォークの設定ファイルに残る ui(NiceGUI 版の UI のポート)は、起動を止めずに外して警告する(D-162)
  it('drops the retired ui block with a warning instead of refusing the config', () => {
    const warnings: string[] = []
    const result = loadBridgeConfig({
      path: 'fork.json',
      readFile: () => JSON.stringify({ ...validConfig, ui: { host: '0.0.0.0', port: 8080 } }),
      onWarning: (message) => warnings.push(message),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect('ui' in result.value).toBe(false)
    expect(warnings).toEqual([expect.stringMatching(/"ui" is ignored.*D-162/)])

    const quiet: string[] = []
    expect(loadBridgeConfig({ path: 'x.json', readFile: () => JSON.stringify(validConfig), onWarning: (message) => quiet.push(message) }).ok).toBe(true)
    expect(quiet).toEqual([])
  })

  it('distinguishes invalid JSON from schema validation failures', () => {
    const invalidJson = loadBridgeConfig({ path: 'invalid.json', readFile: () => '{' })
    const invalidSchema = loadBridgeConfig({
      path: 'schema.json',
      readFile: () => JSON.stringify({ ...validConfig, unity: { ...validConfig.unity, sendPort: 70000 } }),
    })

    expect(invalidJson).toMatchObject({ ok: false, error: { kind: 'invalid-json', path: 'invalid.json' } })
    expect(invalidSchema).toEqual({
      ok: false,
      error: {
        kind: 'schema-invalid',
        path: 'schema.json',
        issues: ['unity.sendPort: Number must be less than or equal to 65535'],
      },
    })
  })
})
