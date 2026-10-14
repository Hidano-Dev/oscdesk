import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { zodToJsonSchema } from 'zod-to-json-schema'

import {
  collectSurfaceDefinitionIssues,
  resolveActionSteps,
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
    for (const sample of samples) {
      const result = SurfaceDefinitionSchema.safeParse(sample.definition)
      expect(result.success, `${sample.name}: ${sample.note}`).toBe(sample.valid)
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

describe('resolveActionSteps', () => {
  const definition = (samples.find(sample => sample.name === 'action-sequence')!.definition) as SurfaceDefinitionStructure

  it('expands match and param steps in definition order with fixed values', () => {
    const action = { id: 'x', label: 'X', steps: [{ param: 'mode', value: 'b' }, { match: '/slot/*' }] }
    const steps = resolveActionSteps(action, definition.parameters)
    expect(steps.map(step => [step.parameter.id, step.fixedValue])).toEqual([
      ['mode', 'b'],
      ['slot01', undefined],
      ['slot02', undefined],
      ['mode', undefined],
    ])
  })

  it('ignores unknown parameters (reported by the semantic check instead)', () => {
    expect(resolveActionSteps({ id: 'x', label: 'X', steps: [{ param: 'ghost' }] }, definition.parameters)).toEqual([])
  })

  it('stops expanding once past the bundle limit instead of scanning every step', () => {
    const parameters = Array.from({ length: 600 }, (_, index) => ({ ...definition.parameters[0]!, id: `p${index}`, address: `/bulk/${index}` }))
    const steps = resolveActionSteps({ id: 'x', label: 'X', steps: [{ match: '/bulk/*' }, { match: '/bulk/*' }] }, parameters)
    expect(steps.length).toBe(OSC_BATCH.MAX_MESSAGES + 1)
  })
})

describe('collectSurfaceDefinitionIssues on many rowActions', () => {
  it('scans the steps of a row action once, not once per rowActions entry', () => {
    const base = SurfaceDefinitionSchema.parse(samples.find(sample => sample.name === 'records-basic')!.definition)
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
    // アクション自体の検証で 1 回、rowActions のキー集合の集約で 1 回。rowActions の数には比例しない
    expect(iterations).toBeLessThanOrEqual(2)
  })
})

describe('collectSurfaceDefinitionIssues on column actions (D-066)', () => {
  const issuesOf = (name: string): { path: string; message: string }[] =>
    collectSurfaceDefinitionIssues(samples.find(sample => sample.name === name)!.definition as SurfaceDefinitionStructure).map(
      issue => ({ path: issue.path.join('/'), message: issue.message }),
    )
  const columnPath = 'screens/0/children/1/columns/0/actions/0'

  it('accepts scope all actions under a column', () => {
    expect(issuesOf('records-column-actions')).toEqual([])
  })

  it.each([
    ['records-column-action-unknown', 'unknown action: missing'],
    ['records-column-action-row-scope', 'column action must have scope all: update'],
    ['records-column-action-unscoped', 'column action must have scope all: masterReset'],
    ['records-column-action-other-keys', 'column action records must share the keysFrom address of record member'],
  ])('%s reports the column action', (name, message) => {
    expect(issuesOf(name)).toEqual([{ path: columnPath, message }])
  })
})

describe('collectSurfaceDefinitionIssues on oversized actions', () => {
  it('rejects more steps than the bundle limit without expanding them', () => {
    const base = samples.find(sample => sample.name === 'action-sequence')!.definition as SurfaceDefinitionStructure
    const steps = Array.from({ length: OSC_BATCH.MAX_MESSAGES + 1 }, () => ({ match: '/slot/*' }))
    const issues = collectSurfaceDefinitionIssues({ ...base, actions: [{ id: 'big', label: 'Big', steps }] })
    expect(issues.map(issue => issue.message)).toContain(`action has more than ${OSC_BATCH.MAX_MESSAGES} steps`)
    expect(issues.some(issue => issue.message.includes('expands'))).toBe(false)
  })
})
