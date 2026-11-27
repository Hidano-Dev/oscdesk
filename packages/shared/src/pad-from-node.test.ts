import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { PadDocumentSchema } from './pad-document'
import { OscQueryNodeInfoSchema, padWidgetFromNode, type NodeWidgetOverrides } from './pad-from-node'

const samples = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../protocol/pad-from-node-samples.json'), 'utf8'),
) as { cases: Array<{ name: string; node: unknown; overrides?: NodeWidgetOverrides; expected: { ok: boolean; reason?: string; kinds?: string[]; widget?: unknown } }> }

describe('padWidgetFromNode', () => {
  it('decides the widget of every shared sample as the sample says', () => {
    expect(samples.cases.length).toBeGreaterThan(20)
    for (const sample of samples.cases) {
      const node = OscQueryNodeInfoSchema.parse(sample.node)
      const result = padWidgetFromNode(node, sample.overrides)
      if (sample.expected.ok) {
        expect(result, sample.name).toEqual({ ok: true, kinds: sample.expected.kinds, widget: sample.expected.widget })
      } else {
        expect(result.ok, sample.name).toBe(false)
        expect(result.ok ? undefined : result.reason, sample.name).toBe(sample.expected.reason)
      }
    }
  })

  it('makes widgets that pass the pad schema once placed', () => {
    for (const sample of samples.cases) {
      const result = padWidgetFromNode(OscQueryNodeInfoSchema.parse(sample.node), sample.overrides)
      if (!result.ok) continue
      const pad = { format: 'oscdesk-pad', version: 2, rows: 1, columns: 1, widgets: [{ ...result.widget, id: 'w1', row: 0, column: 0 }] }
      expect(PadDocumentSchema.safeParse(pad).success, sample.name).toBe(true)
    }
  })

  it('makes every allowed kind', () => {
    // 上書きの候補(kinds)に出した種類は、どれを選んでも部品になる
    for (const sample of samples.cases) {
      const node = OscQueryNodeInfoSchema.parse(sample.node)
      const first = padWidgetFromNode(node)
      for (const kind of first.kinds) {
        const result = padWidgetFromNode(node, { kind })
        expect(result.ok && result.widget.kind, `${sample.name} as ${kind}`).toBe(kind)
      }
    }
  })

  it('does not make a select from values that OSC cannot carry', () => {
    const result = padWidgetFromNode({ address: '/x', type: 's', range: [{ VALS: ['a\u0000b'] }] })
    expect(result.ok && result.widget.kind).toBe('text')
  })

  it('cuts a long description to the label limit', () => {
    const result = padWidgetFromNode({ address: '/x', type: 'f', description: 'あ'.repeat(100) })
    expect(result.ok && result.widget.label).toBe('あ'.repeat(64))
  })
})
