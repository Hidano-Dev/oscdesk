import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { ManifestSchema } from '@oscdesk/shared'

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

  it('loads the deterministic large input/select scenario', () => {
    const definition = loadScenarioDefinition(
      path.resolve(__dirname, '../scenarios/large-input-select.json'),
    )

    const manifest = ManifestSchema.parse(
      JSON.parse(new ScenarioRuntime(definition).manifestJson()),
    )

    expect(manifest.entries).toHaveLength(260)
    expect(manifest.optionLists).toEqual({
      devices: ['Device A', 'Device B', 'Device C', 'Device D'],
    })
    expect(manifest.entries.filter((entry) => entry.widget === 'input')).toHaveLength(194)
    expect(manifest.entries.filter((entry) => entry.widget === 'select')).toHaveLength(66)
    expect(manifest.entries.filter((entry) => entry.optionsRef === 'devices')).toHaveLength(64)
    expect(manifest.entries.filter((entry) => entry.group === 'Global')).toHaveLength(4)
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
