import { describe, expect, it } from 'vitest'

import type { ProjectFile } from '@oscdesk/shared'

import { describeRejection, projectDownloadName, projectDownloadText, PROJECT_UPLOAD_MAX_BYTES, readProjectBytes } from './project-logic'

const PROJECT: ProjectFile = {
  format: 'oscdesk-project', version: 3, exportedAt: '2026-11-28T10:00:00.000Z',
  osc: { pad: { name: 'take-03', pad: { format: 'oscdesk-pad', version: 2, rows: 1, columns: 1, widgets: [] } }, values: { widgets: [], rows: [] } },
  destinations: [],
}
const bytesOf = (text: string) => new TextEncoder().encode(text)

describe('project logic (D-150・D-172)', () => {
  it('reads a JSON object and refuses anything else with a reason', () => {
    expect(readProjectBytes(bytesOf('{"format":"oscdesk-project"}'))).toEqual({ ok: true, project: { format: 'oscdesk-project' } })
    expect(readProjectBytes(bytesOf('﻿{"a":1}'))).toEqual({ ok: true, project: { a: 1 } })
    expect(readProjectBytes(bytesOf('[1]'))).toMatchObject({ ok: false, message: expect.stringContaining('JSON のオブジェクトではありません') })
    expect(readProjectBytes(bytesOf('{'))).toMatchObject({ ok: false, message: expect.stringContaining('JSON として読めません') })
    expect(readProjectBytes(bytesOf('{"a":1e400}'))).toEqual({ ok: false, message: '有限の数として読めない数値があります' })
    expect(readProjectBytes(Uint8Array.from([0xff, 0xfe]))).toEqual({ ok: false, message: 'UTF-8 のテキストとして読めません' })
    expect(readProjectBytes(new Uint8Array(PROJECT_UPLOAD_MAX_BYTES + 1)).ok).toBe(false)
  })

  it('names the download after the pad and the local time', () => {
    expect(projectDownloadName(PROJECT, new Date(2026, 10, 28, 9, 5, 7))).toBe('take-03-20261128-090507.oscdesk-project.json')
    expect(JSON.parse(projectDownloadText(PROJECT))).toEqual(PROJECT)
  })

  it('rephrases the reasons the bridge gives', () => {
    expect(describeRejection('surface-file: x')).toContain('サーフェス定義のファイル')
    expect(describeRejection('surface-only: x')).toContain('パッドが無く')
    expect(describeRejection('unsupported-version: 9')).toContain('この版')
    expect(describeRejection('too-large: 1 bytes')).toContain('大きすぎる')
    expect(describeRejection('invalid: x')).toBe('プロジェクトを読み込めません: invalid: x')
  })
})
