import { describe, expect, it } from 'vitest'

import { PROJECT_FILE, ProjectFileSchema, type ProjectFile } from '@oscdesk/shared'

import {
  describeInspectionFailure,
  describeNames,
  projectDownloadName,
  projectDownloadText,
  projectNames,
  PROJECT_UPLOAD_MAX_BYTES,
  readProjectBytes,
  unsentMessage,
} from './project-logic'
import { wireSample } from './test-support'

const bytesOf = (text: string) => new TextEncoder().encode(text)

function sampleProject(name = 'downstream-project'): ProjectFile {
  const frame = wireSample(name)
  if (frame.type !== 'project') throw new Error('not a project frame')
  return frame.project
}

describe('readProjectBytes', () => {
  it('reads a JSON object, dropping a BOM', () => {
    expect(readProjectBytes(bytesOf('﻿{"format":"oscdesk-project"}'))).toEqual({ ok: true, project: { format: 'oscdesk-project' } })
  })

  it('refuses what cannot be a project file, with a reason to show', () => {
    expect(readProjectBytes(new Uint8Array([0xff, 0xfe, 0x00]))).toEqual({ ok: false, message: 'UTF-8 のテキストとして読めません' })
    expect(readProjectBytes(bytesOf('{')).ok).toBe(false)
    expect(readProjectBytes(bytesOf('[1]'))).toEqual({ ok: false, message: 'プロジェクトファイルではありません(JSON のオブジェクトではありません)' })
    expect(readProjectBytes(bytesOf('null')).ok).toBe(false)
  })

  it('refuses numbers that JSON.parse turns into Infinity (they would reach the bridge as null)', () => {
    expect(readProjectBytes(bytesOf('{"a":[1e400]}'))).toEqual({ ok: false, message: '有限の数として読めない数値があります' })
  })

  it('refuses a file over the upload limit before decoding it', () => {
    const result = readProjectBytes(new Uint8Array(PROJECT_UPLOAD_MAX_BYTES + 1))
    expect(result.ok).toBe(false)
  })
})

describe('download', () => {
  it('indents the file and writes it back as the same project', () => {
    const project = sampleProject()
    const text = projectDownloadText(project)
    expect(text).toContain('\n  "format": "oscdesk-project"')
    const read = readProjectBytes(bytesOf(text))
    expect(read.ok && ProjectFileSchema.parse(read.project)).toEqual(project)
  })

  it('keeps lone surrogates as escapes so the downloaded file can be read back', () => {
    const project = sampleProject('downstream-project-pad-only')
    const pad = project.osc?.pad
    if (pad === undefined || pad === null) throw new Error('no pad')
    const odd: ProjectFile = { ...project, osc: { pad: { ...pad, pad: { ...pad.pad, buttons: [{ id: 'b1', row: 0, column: 0, label: 'x\ud800', address: '/a', args: [] }] } } } }
    const text = projectDownloadText(odd)
    expect(text).toContain('\\ud800')
    const read = readProjectBytes(bytesOf(text))
    expect(read.ok).toBe(true)
  })

  it('names the file after the surface (or the pad) and the local time', () => {
    const at = new Date(2026, 10, 27, 9, 5, 7)
    expect(projectDownloadName(sampleProject(), at)).toBe('stage-20261127-090507.oscdesk-project.json')
    expect(projectDownloadName(sampleProject('downstream-project-pad-only'), at)).toBe('take-03-20261127-090507.oscdesk-project.json')
    expect(projectNames(sampleProject())).toEqual({ surface: 'stage', pad: 'take-03' })
    expect(describeNames(projectNames(sampleProject()))).toBe('定義「stage」・パッド「take-03」')
  })

  it('upload limit stays above the bridge limit so an exported file always fits', () => {
    expect(PROJECT_UPLOAD_MAX_BYTES).toBeGreaterThan(PROJECT_FILE.MAX_SERIALIZED_BYTES)
  })
})

describe('messages', () => {
  it('rephrases the bridge reasons', () => {
    expect(describeInspectionFailure('surface-file: this is a surface')).toContain('サーフェス定義のファイル')
    expect(describeInspectionFailure('too-large: 13 MiB')).toBe('プロジェクトが大きすぎるため読み込めません: 13 MiB')
    expect(describeInspectionFailure('')).toBe('プロジェクトを読み込めません: 理由は届きませんでした')
    expect(describeInspectionFailure('invalid: x')).toBe('プロジェクトを読み込めません: invalid: x')
  })

  it('shows when the project was imported, in local time', () => {
    const since = new Date(2026, 9, 28, 19, 3).toISOString()
    expect(unsentMessage(since)).toContain('(10/28 19:03 に読み込み)')
    expect(unsentMessage('bad')).toContain('(bad に読み込み)')
  })
})
