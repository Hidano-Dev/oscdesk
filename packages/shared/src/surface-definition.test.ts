import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { zodToJsonSchema } from 'zod-to-json-schema'

import {
  collectSurfaceDefinitionIssues,
  resolveSelectors,
  splitSurfaceBindings,
  SurfaceDefinitionSchema,
  SurfaceDefinitionStructureSchema,
  type SurfaceDefinitionStructure,
} from './surface-definition'
import { OSC_BATCH } from './limits'

const protocolDirectory = path.resolve(__dirname, '../../../protocol')
const samplesPath = path.join(protocolDirectory, 'surface-definition-samples.json')
const jsonSchemaPath = path.join(protocolDirectory, 'surface-definition.schema.json')

type Sample = { name: string; valid: boolean; note: string; definition: unknown }
const samples = (JSON.parse(readFileSync(samplesPath, 'utf8')) as { cases: Sample[] }).cases
const sample = (name: string) => samples.find(candidate => candidate.name === name)!.definition as SurfaceDefinitionStructure

function generateJsonSchema(): string {
  const schema = zodToJsonSchema(SurfaceDefinitionStructureSchema, {
    name: 'SurfaceDefinition',
    $refStrategy: 'root',
    target: 'jsonSchema7',
  })
  return `${JSON.stringify(schema, null, 2)}\n`
}

describe('SurfaceDefinitionSchema shared acceptance fixtures', () => {
  it('validates every acceptance and rejection case', () => {
    expect(samples.length).toBeGreaterThan(0)
    for (const entry of samples) {
      const result = SurfaceDefinitionSchema.safeParse(entry.definition)
      expect(result.success, `${entry.name}: ${entry.note}`).toBe(entry.valid)
    }
  })

  it('keeps the body rules when the bindings are taken off (what the UI receives)', () => {
    for (const entry of samples.filter(candidate => candidate.valid)) {
      const parsed = SurfaceDefinitionSchema.parse(entry.definition)
      expect(SurfaceDefinitionSchema.safeParse(splitSurfaceBindings(parsed).definition).success, entry.name).toBe(true)
    }
  })
})

describe('surface-definition.schema.json', () => {
  it('matches the schema generated from zod (regenerate with UPDATE_JSON_SCHEMA=1)', () => {
    const generated = generateJsonSchema()
    if (process.env.UPDATE_JSON_SCHEMA === '1') {
      writeFileSync(jsonSchemaPath, generated, 'utf8')
    }
    expect(readFileSync(jsonSchemaPath, 'utf8').replaceAll('\r\n', '\n'), 'zod を変えたら UPDATE_JSON_SCHEMA=1 で再生成する').toBe(generated)
  })

  it('keeps reserved-address rejection in the generated address pattern', () => {
    const text = readFileSync(jsonSchemaPath, 'utf8')
    const pattern = (text.match(/"pattern": "(\^\(\?!\\\\\/.*?)"/) ?? [])[1]
    expect(pattern).toBeDefined()
    const expression = new RegExp(JSON.parse(`"${pattern}"`) as string)
    expect(expression.test('/mix/master')).toBe(true)
    for (const reserved of ['/sys/ping', '/sys', '/oscdesk/status', '/oscdesk']) {
      expect(expression.test(reserved), reserved).toBe(false)
    }
  })
})

describe('splitSurfaceBindings', () => {
  it('takes the bindings off the body without touching the rest', () => {
    const definition = SurfaceDefinitionSchema.parse(sample('bindings-minimal'))
    const { definition: body, bindings } = splitSurfaceBindings(definition)
    expect('bindings' in body).toBe(false)
    expect(bindings).toEqual(definition.bindings)
    expect(JSON.stringify(body)).not.toContain('/mix/')
  })
})

describe('resolveSelectors', () => {
  it('lists the parameter ids a selector hits, in definition order', () => {
    const definition = SurfaceDefinitionSchema.parse(sample('bindings-minimal'))
    expect(resolveSelectors(definition)).toEqual([{ selector: 'mixAll', params: ['master', 'scene'] }])
  })

  it('leaves a selector without bindings empty', () => {
    const { definition } = splitSurfaceBindings(SurfaceDefinitionSchema.parse(sample('bindings-minimal')))
    expect(resolveSelectors(definition)).toEqual([{ selector: 'mixAll', params: [] }])
  })
})

describe('collectSurfaceDefinitionIssues on many rowActions', () => {
  it('scans the steps of a row action once, not once per rowActions entry', () => {
    const base = SurfaceDefinitionSchema.parse(sample('records-basic'))
    let iterations = 0
    const steps = new Proxy(Array.from({ length: 100 }, () => ({ record: 'member' })), {
      get(target, property, receiver) {
        if (property === Symbol.iterator || property === 'forEach' || property === 'some') iterations += 1
        return Reflect.get(target, property, receiver)
      },
    })
    const record = base.screens[0]!.children.find(node => node.kind === 'record')!
    const definition: SurfaceDefinitionStructure = {
      ...base,
      actions: [...base.actions!, { id: 'many', label: 'Many', scope: 'row', steps }],
      screens: [{ ...base.screens[0]!, children: [{ ...record, rowActions: Array.from({ length: 1000 }, () => 'many') } as never] }],
    }
    expect(collectSurfaceDefinitionIssues(definition)).toEqual([])
    // アクション自体の検証で 1 回、rowActions のキー集合の集約で 1 回、結び付けの selector の有無で 1 回。rowActions の数には比例しない
    expect(iterations).toBeLessThanOrEqual(3)
  })
})

describe('collectSurfaceDefinitionIssues on column actions (D-066)', () => {
  const issuesOf = (name: string): { path: string; message: string }[] =>
    collectSurfaceDefinitionIssues(sample(name)).map(issue => ({ path: issue.path.join('/'), message: issue.message }))
  const columnPath = 'screens/0/children/1/columns/0/actions/0'

  it('accepts scope all actions under a column', () => {
    expect(issuesOf('records-column-actions')).toEqual([])
  })

  it.each([
    ['records-column-action-unknown', 'unknown action: missing'],
    ['records-column-action-row-scope', 'column action must have scope all: update'],
    ['records-column-action-unscoped', 'column action must have scope all: masterReset'],
    ['records-column-action-other-keys', 'column action records must share the keysFrom list of record member'],
  ])('%s reports the column action', (name, message) => {
    expect(issuesOf(name)).toEqual([{ path: columnPath, message }])
  })
})

describe('collectSurfaceDefinitionIssues on bindings (D-117)', () => {
  const issuesOf = (name: string) => collectSurfaceDefinitionIssues(sample(name)).map(issue => `${issue.path.join('/')}: ${issue.message}`)

  it.each([
    ['bindings-parameter-missing', 'bindings/osc/parameters: parameter has no osc binding: scene'],
    ['bindings-parameter-unknown', 'bindings/osc/parameters/2/id: unknown parameter: ghost'],
    ['bindings-parameter-address-duplicate', 'bindings/osc/parameters/1/address: duplicate parameter address'],
    ['bindings-list-missing', 'bindings/osc/lists: list has no osc binding: scenes'],
    ['bindings-list-request-is-list', 'bindings/osc/lists/0/request: list request must not be a list address'],
    ['bindings-selector-missing', 'bindings/osc/selectors: selector has no osc binding: mixAll'],
    ['bindings-selector-hits-nothing', 'bindings/osc/selectors/0/match: match hits no parameter: /none/*'],
  ])('%s points at the binding', (name, issue) => {
    expect(issuesOf(name)).toContain(issue)
  })
})

describe('collectSurfaceDefinitionIssues on oversized actions', () => {
  it('rejects more steps than the bundle limit without expanding them', () => {
    const base = sample('action-sequence')
    const steps = Array.from({ length: OSC_BATCH.MAX_MESSAGES + 1 }, () => ({ selector: base.bindings!.osc!.selectors![0]!.id }))
    const issues = collectSurfaceDefinitionIssues({ ...base, actions: [{ id: 'big', label: 'Big', steps }] })
    expect(issues.map(issue => issue.message)).toContain(`action has more than ${OSC_BATCH.MAX_MESSAGES} steps`)
    expect(issues.some(issue => issue.message.includes('expands'))).toBe(false)
  })

  it('counts what the selectors expand to through the osc bindings', () => {
    const parameters = Array.from({ length: OSC_BATCH.MAX_MESSAGES + 1 }, (_, index) => ({
      id: `p${String(index)}`, label: 'P', type: 'f' as const, kind: 'state' as const, default: 0,
    }))
    const definition: SurfaceDefinitionStructure = {
      format: 'oscdesk-surface',
      version: 2,
      name: 'Bulk',
      parameters,
      actions: [{ id: 'all', label: 'All', steps: [{ selector: 'bulk' }] }],
      screens: [],
      bindings: {
        osc: {
          parameters: parameters.map(parameter => ({ id: parameter.id, address: `/bulk/${parameter.id}` })),
          selectors: [{ id: 'bulk', match: '/bulk/*' }],
        },
      },
    }
    expect(collectSurfaceDefinitionIssues(definition).map(issue => issue.message))
      .toEqual([`action expands to more than ${OSC_BATCH.MAX_MESSAGES} messages`])
    const { bindings: _bindings, ...body } = definition
    // 結び付けが無ければ、selector が何件になるかは決まらないので上限では落とさない
    expect(collectSurfaceDefinitionIssues(body)).toEqual([])
  })
})
