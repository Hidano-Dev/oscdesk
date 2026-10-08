import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { zodToJsonSchema } from 'zod-to-json-schema'

import { SurfaceDefinitionSchema, SurfaceDefinitionStructureSchema } from './surface-definition'

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
