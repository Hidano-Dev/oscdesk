import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { MANIFEST_SIZE, ManifestSchema } from '@oscdesk/shared'

import { ScenarioRuntime, ScenarioSchema, loadScenarioDefinition } from './scenario'

describe('loadScenarioDefinition', () => {
  it('loads the default scenario file with Japanese character name candidates', () => {
    const definition = loadScenarioDefinition(
      path.resolve(__dirname, '../scenarios/default.json'),
    )

    expect(definition.characterName?.candidates).toEqual(['初音ミク', '鏡音リン', '巡音ルカ'])
    expect(definition.projectId).toBe('oscdesk-demo')
    expect(definition.entries[0]).toMatchObject({
      address: '/avatar/blend/smile',
      label: '{characterName} Smile',
    })
  })

  it('loads the normal input/select scenario and preserves all widget cases', () => {
    const definition = loadScenarioDefinition(
      path.resolve(__dirname, '../scenarios/input-select.json'),
    )

    const manifest = ManifestSchema.parse(
      JSON.parse(new ScenarioRuntime(definition).manifestJson()),
    )
    expect(manifest.entries).toHaveLength(7)
    expect(manifest.optionLists).toEqual({
      devices: ['Face Device A', 'Face Device B', 'Face Device C'],
    })
    expect(manifest.entries.filter((entry) => entry.widget === 'input').map((entry) => entry.type)).toEqual([
      's',
      'i',
      'f',
    ])
    expect(manifest.entries.filter((entry) => entry.widget === 'select')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ options: ['Auto', 'External', 'Disabled'] }),
        expect.objectContaining({ optionsRef: 'devices' }),
        expect.objectContaining({ options: [] }),
        expect.objectContaining({ default: 'Disconnected Device' }),
      ]),
    )
  })

  it('emits staging metadata only from the scenario staging section', () => {
    const definition = loadScenarioDefinition(
      path.resolve(__dirname, '../scenarios/staging.json'),
    )

    const manifest = ManifestSchema.parse(
      JSON.parse(new ScenarioRuntime(definition).manifestJson()),
    )
    const byAddress = new Map(manifest.entries.map((entry) => [entry.address, entry]))

    expect(byAddress.get('/member/01/update')).toMatchObject({
      appliesTo: ['/member/01/*'],
    })
    expect(byAddress.get('/member/01/name')).toMatchObject({ staged: true })
    expect(byAddress.get('/member/all/enabled')).not.toHaveProperty('staged')
    expect(byAddress.get('/legacy/status')).not.toHaveProperty('staged')
    expect(byAddress.get('/legacy/status')).not.toHaveProperty('appliesTo')
  })

  it('loads the deterministic large input/select scenario', () => {
    const definition = loadScenarioDefinition(
      path.resolve(__dirname, '../scenarios/large-input-select.json'),
    )

    const manifestJson = new ScenarioRuntime(definition).manifestJson()
    const manifest = ManifestSchema.parse(JSON.parse(manifestJson))

    expect(manifest.entries).toHaveLength(260)
    // 実運用に近い長さ・日本語混在のデバイス名 8 件(generate-large-scenario.mjs)
    expect(manifest.optionLists?.devices).toHaveLength(8)
    for (const device of manifest.optionLists?.devices ?? []) {
      expect(device.length).toBeGreaterThanOrEqual(20)
      expect(device.length).toBeLessThanOrEqual(40)
    }
    expect(manifest.optionLists?.devices?.some((device) => /[぀-ヿ一-鿿]/u.test(device))).toBe(true)
    expect(manifest.entries.filter((entry) => entry.widget === 'input')).toHaveLength(194)
    expect(manifest.entries.filter((entry) => entry.widget === 'select')).toHaveLength(66)
    expect(manifest.entries.filter((entry) => entry.optionsRef === 'devices')).toHaveLength(64)
    expect(manifest.entries.filter((entry) => entry.group === 'Global')).toHaveLength(4)
  })

  it('keeps the large scenario manifest inside a single UDP datagram only via shared option lists', () => {
    const definition = loadScenarioDefinition(
      path.resolve(__dirname, '../scenarios/large-input-select.json'),
    )
    const manifestJson = new ScenarioRuntime(definition).manifestJson()
    const manifest = ManifestSchema.parse(JSON.parse(manifestJson))

    // 共有参照(optionsRef / optionLists)で送る実際の JSON は実用上限に収まる。
    // 警告閾値も超えないことを見て、上限までの余裕が削られていないことを保証する
    const sharedBytes = Buffer.byteLength(manifestJson, 'utf8')
    expect(sharedBytes).toBeLessThan(MANIFEST_SIZE.WARNING_BYTES)
    expect(sharedBytes).toBeLessThan(MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES)

    // 同じ内容を各エントリへインライン展開すると上限を超える。共有参照が
    // 「あると便利」ではなく 64 スロット構成を送るための必須機構であることの回帰ガード
    const devices = manifest.optionLists?.devices ?? []
    const inlined = {
      ...manifest,
      optionLists: undefined,
      entries: manifest.entries.map((entry) =>
        entry.optionsRef === 'devices'
          ? { ...entry, optionsRef: undefined, options: devices }
          : entry,
      ),
    }
    const inlinedBytes = Buffer.byteLength(JSON.stringify(inlined), 'utf8')
    expect(inlinedBytes).toBeGreaterThan(MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES)
    expect(inlinedBytes - sharedBytes).toBeGreaterThan(20 * 1024)
  })
})

describe('ScenarioRuntime', () => {
  it('accepts top-level staging declarations and retains current and applied values', () => {
    const runtime = new ScenarioRuntime(ScenarioSchema.parse({
      projectId: 'oscdesk-demo',
      entries: [
        { address: '/member/01/name', label: 'Name', type: 's', widget: 'input', default: 'initial' },
        { address: '/member/01/active', label: 'Active', type: 'bool', widget: 'toggle', default: false },
        { address: '/member/01/update', label: 'Update', type: 'i', widget: 'button', default: 0 },
      ],
      staging: {
        staged: ['/member/01/name', '/member/01/active'],
        triggers: [{ address: '/member/01/update', appliesTo: ['/member/01/*'] }],
        expansions: [],
      },
    }))

    runtime.recordValue('/member/01/name', 'edited')
    runtime.recordValue('/member/01/active', true)
    expect(runtime.stagingSnapshot().applyLog).toEqual([])
    expect(JSON.parse(runtime.manifestJson()).entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: '/member/01/name', default: 'edited' }),
      expect.objectContaining({ address: '/member/01/active', default: 1 }),
    ]))

    const reaction = runtime.recordValue('/member/01/update', 1)
    expect(reaction?.applyTriggered).toBe(true)
    const snapshot = runtime.stagingSnapshot()
    expect(snapshot.applyLog).toEqual([expect.objectContaining({
      sequence: 1,
      triggerAddress: '/member/01/update',
      values: [
        { address: '/member/01/name', value: { kind: 's', value: 'edited' } },
        { address: '/member/01/active', value: { kind: 'i', value: 1 } },
      ],
    })])
    expect(snapshot.appliedValues.get('/member/01/active')).toEqual({ kind: 'i', value: 1 })
  })

  it('rejects invalid staging declarations while loading a scenario', () => {
    expect(() => new ScenarioRuntime(ScenarioSchema.parse({
      projectId: 'oscdesk-demo',
      entries: [
        { address: '/value', label: 'Value', type: 'i', widget: 'fader' },
        { address: '/apply', label: 'Apply', type: 'i', widget: 'button' },
      ],
      staging: { staged: ['/value'], triggers: [{ address: '/apply', appliesTo: ['bad//pattern'] }], expansions: [] },
    }))).toThrow('Invalid staging declaration')
  })

  it('rejects staged metadata written directly on scenario entries', () => {
    expect(() => ScenarioSchema.parse({
      projectId: 'oscdesk-demo',
      entries: [{
        address: '/value',
        label: 'Value',
        type: 'i',
        widget: 'input',
        staged: true,
      }],
    })).toThrow()

    expect(() => ScenarioSchema.parse({
      projectId: 'oscdesk-demo',
      entries: [{
        address: '/apply',
        label: 'Apply',
        type: 'i',
        widget: 'button',
        appliesTo: ['/value'],
      }],
    })).toThrow()
  })

  it('expands placeholders and reflects current values in the manifest JSON', () => {
    const runtime = new ScenarioRuntime(
      ScenarioSchema.parse({
        projectId: 'oscdesk-demo',
        characterName: {
          candidates: ['初音ミク', '巡音ルカ'],
        },
        entries: [
          {
            address: '/avatar/blend/smile',
            label: '{characterName} Smile',
            type: 'f',
            widget: 'fader',
            range: [0, 1],
            default: 0.25,
            group: 'Face',
          },
          {
            address: '/avatar/text/name',
            label: 'Character Name',
            type: 's',
            widget: 'text',
            default: '{characterName}',
            group: 'Profile',
          },
          {
            address: '/avatar/toggle/visible',
            label: 'Visible',
            type: 'bool',
            widget: 'toggle',
            default: true,
          },
        ],
      }),
      { characterName: '鏡音リン' },
    )

    runtime.recordValue('/avatar/blend/smile', 0.75)
    runtime.recordValue('/avatar/text/name', '鏡音リン')
    runtime.recordValue('/avatar/toggle/visible', false)
    runtime.recordValue('/sys/manifest/request', 1)
    runtime.recordValue('/avatar/blend/smile', true)

    const manifest = ManifestSchema.parse(JSON.parse(runtime.manifestJson()))

    expect(runtime.characterName).toBe('鏡音リン')
    expect(manifest.projectId).toBe('oscdesk-demo')
    expect(manifest.entries).toEqual([
      {
        address: '/avatar/blend/smile',
        label: '鏡音リン Smile',
        type: 'f',
        widget: 'fader',
        range: [0, 1],
        default: 0.75,
        group: 'Face',
      },
      {
        address: '/avatar/text/name',
        label: 'Character Name',
        type: 's',
        widget: 'text',
        default: '鏡音リン',
        group: 'Profile',
      },
      {
        address: '/avatar/toggle/visible',
        label: 'Visible',
        type: 'bool',
        widget: 'toggle',
        default: 0,
      },
    ])
  })

  it('passes shared option lists through to the manifest and omits them when absent', () => {
    const withOptions = new ScenarioRuntime(
      ScenarioSchema.parse({
        projectId: 'oscdesk-demo',
        optionLists: { devices: ['Device A', 'Device B'] },
        entries: [
          {
            address: '/avatar/device',
            label: 'Device',
            type: 's',
            widget: 'select',
            optionsRef: 'devices',
          },
        ],
      }),
    )
    const withoutOptions = new ScenarioRuntime(
      ScenarioSchema.parse({
        projectId: 'oscdesk-demo',
        entries: [],
      }),
    )

    expect(ManifestSchema.parse(JSON.parse(withOptions.manifestJson())).optionLists).toEqual({
      devices: ['Device A', 'Device B'],
    })
    expect(ManifestSchema.parse(JSON.parse(withoutOptions.manifestJson()))).not.toHaveProperty(
      'optionLists',
    )
  })

  it('generates a deterministic character name with a random suffix when requested', () => {
    const randomValues = [0.75, 0.042]
    const runtime = new ScenarioRuntime(
      ScenarioSchema.parse({
        projectId: 'oscdesk-demo',
        characterName: {
          candidates: ['初音ミク', '鏡音リン', '巡音ルカ'],
          randomSuffix: true,
        },
        entries: [
          {
            address: '/avatar/text/name',
            label: '{characterName}',
            type: 's',
            widget: 'text',
            default: '{characterName}',
          },
        ],
      }),
      {
        random: () => randomValues.shift() ?? 0,
      },
    )

    expect(runtime.characterName).toBe('巡音ルカ-042')
    expect(ManifestSchema.parse(JSON.parse(runtime.manifestJson())).entries[0]?.default).toBe(
      '巡音ルカ-042',
    )
  })

  it('returns the raw manifest override unchanged', () => {
    const runtime = new ScenarioRuntime(
      ScenarioSchema.parse({
        projectId: 'oscdesk-demo',
        entries: [],
        rawManifestOverride: '{"version":"broken"}',
      }),
    )

    runtime.recordValue('/avatar/blend/smile', 0.5)

    expect(runtime.characterName).toBeNull()
    expect(runtime.manifestJson()).toBe('{"version":"broken"}')
  })

  it('creates a manifest with the wrong project identifier for the misconnection scenario', () => {
    const definition = loadScenarioDefinition(
      path.resolve(__dirname, '../scenarios/wrong-project.json'),
    )

    const manifest = ManifestSchema.parse(
      JSON.parse(new ScenarioRuntime(definition).manifestJson()),
    )

    expect(manifest.projectId).not.toBe('oscdesk-demo')
  })
})
