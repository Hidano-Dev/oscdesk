import { describe, expect, it } from 'vitest'

import { OSC_PAD, oscPadSerializedBytes, type OscPad, type OscPadButton, type OscPadEdit } from '@oscdesk/shared'

import { addressProblem, applyPadEdit, parseArgValue, PadEditError } from './pad-editor'

// UI の test_osc_pad.py の編集の規則の検査を移した(D-126)。UI は命令を送って答えを描くだけになった

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const newPad = (rows = 4, columns = 4): OscPad => ({ format: 'oscdesk-pad', version: 1, rows, columns, buttons: [] })

/** 命令を当てた結果のパッド(断られたら理由でテストを落とす) */
function edit(pad: OscPad, command: OscPadEdit): OscPad {
  const result = applyPadEdit(pad, command)
  if (!result.ok) throw new Error(`refused: ${result.detail}`)
  return result.pad
}

/** 命令が断られた理由 */
function refusal(pad: OscPad, command: OscPadEdit): string {
  const result = applyPadEdit(pad, command)
  if (result.ok) throw new Error('accepted')
  return result.detail
}

const find = (pad: OscPad, id: string): OscPadButton | undefined => pad.buttons.find(button => button.id === id)

function withButton(rows = 4, columns = 4): OscPad {
  return edit(newPad(rows, columns), { op: 'addButton', row: 0, column: 0 })
}

function imageOf(size: number): string {
  const groups = Math.floor(size / 3)
  const tail = ['', 'AA==', 'AAA='][size % 3]!
  return `data:image/png;base64,${'AAAA'.repeat(groups)}${tail}`
}

describe('applyPadEdit', () => {
  it('fills an empty cell with a valid placeholder button and does not change the draft', () => {
    const pad = newPad(2, 2)
    const first = edit(pad, { op: 'addButton', row: 0, column: 1 })
    const second = edit(first, { op: 'addButton', row: 1, column: 0 })
    expect(pad.buttons).toEqual([])
    expect(second.buttons.map(button => button.id)).toEqual(['b1', 'b2'])
    expect(find(second, 'b1')).toEqual({ id: 'b1', row: 0, column: 1, label: 'b1', address: '/pad/b1', args: [] })
    expect(refusal(second, { op: 'addButton', row: 0, column: 1 })).toContain('既にボタン')
    expect(refusal(second, { op: 'addButton', row: 2, column: 0 })).toContain('格子の外')
    // 消した後の番号は空いているものから振る
    expect(edit(edit(second, { op: 'removeButton', button: 'b1' }), { op: 'addButton', row: 1, column: 1 }).buttons.map(button => button.id)).toEqual(['b2', 'b1'])
  })

  it('pastes copied settings over another button, keeping its id and cell and dropping what the copy lacks', () => {
    let pad = withButton(2, 2)
    pad = edit(pad, { op: 'addButton', row: 1, column: 1 })
    pad = edit(pad, { op: 'setImage', button: 'b2', data: PNG_1PX })
    const settings = { label: 'Fire', color: '#FF0000', address: '/fx/fire', args: [{ type: 's', value: '' }] }
    const pasted = edit(pad, { op: 'pasteSettings', button: 'b2', settings })
    expect(find(pasted, 'b2')).toEqual({ id: 'b2', row: 1, column: 1, label: 'Fire', color: '#FF0000', address: '/fx/fire', args: [{ type: 's', value: '' }] })
    expect(refusal(pad, { op: 'pasteSettings', button: 'nope', settings })).toBe('ボタン nope がありません')
    // 写した設定の中身はパッド全体の検証で見る
    expect(refusal(pad, { op: 'pasteSettings', button: 'b2', settings: { ...settings, args: [{ type: 'i', value: 1.5 }] } })).toContain('パッドとして不正です')
  })

  it('respects the total image budget when pasting images', () => {
    const image = imageOf(OSC_PAD.MAX_IMAGE_BYTES)
    const count = OSC_PAD.MAX_TOTAL_IMAGE_BYTES / OSC_PAD.MAX_IMAGE_BYTES
    const pad: OscPad = {
      ...newPad(12, 12),
      buttons: Array.from({ length: count + 1 }, (_, index) => ({
        id: `b${String(index)}`, row: Math.floor(index / 12), column: index % 12, label: '', address: '/x', args: [],
        ...(index < count ? { image } : {}),
      })),
    }
    expect(refusal(pad, { op: 'pasteSettings', button: `b${String(count)}`, settings: { label: '', image, address: '/x', args: [] } })).toContain('MiB を超えます')
  })

  it('refuses to resize when buttons would fall outside', () => {
    let pad = edit(newPad(3, 3), { op: 'addButton', row: 2, column: 2 })
    pad = edit(pad, { op: 'setLabel', button: 'b1', label: 'Fire' })
    expect(refusal(pad, { op: 'resize', rows: 2, columns: 3 })).toBe('格子の外に出るボタンがあります: Fire')
    expect(edit(pad, { op: 'resize', rows: 3, columns: 12 }).columns).toBe(12)
    expect(refusal(pad, { op: 'resize', rows: 13, columns: 3 })).toBe('行数は 1〜12、列数は 1〜12 です')
    expect(refusal(pad, { op: 'resize', rows: 0, columns: 3 })).toBe('行数は 1〜12、列数は 1〜12 です')
  })

  it('counts labels like JavaScript strings', () => {
    const pad = withButton()
    expect(find(edit(pad, { op: 'setLabel', button: 'b1', label: '😀'.repeat(32) }), 'b1')?.label).toHaveLength(64)
    expect(refusal(pad, { op: 'setLabel', button: 'b1', label: '😀'.repeat(33) })).toBe('ラベルは 64 文字までです')
    // 孤立サロゲートは表示だけのラベルなら許す(OSC には載らない)
    expect(find(edit(pad, { op: 'setLabel', button: 'b1', label: '\ud800' }), 'b1')?.label).toBe('\ud800')
  })

  it('rejects reserved, pattern and over-long addresses with a reason for the field', () => {
    const pad = withButton()
    expect(find(edit(pad, { op: 'setAddress', button: 'b1', address: '/fx/fire' }), 'b1')?.address).toBe('/fx/fire')
    for (const [address, reason] of [
      ['fx', '/ で始め'], ['/sys/ping', '予約'], ['/oscdesk', '予約'], ['/fx/*', '使えません'], ['/fx/', '使えません'], ['/a b', '使えません'],
      ['/a\0b', 'NUL 文字は使えません'], ['/x\udc00', '孤立サロゲート'], [`/${'a'.repeat(256)}`, '256 文字までです'],
    ] as const) {
      expect(addressProblem(address)).toContain(reason)
      expect(refusal(pad, { op: 'setAddress', button: 'b1', address })).toContain(reason)
    }
    expect(addressProblem(`/${'a'.repeat(255)}`)).toBeNull()
  })

  it('types and range-checks arguments', () => {
    let pad = withButton()
    pad = edit(pad, { op: 'addArg', button: 'b1', type: 'i' })
    pad = edit(pad, { op: 'setArgValue', button: 'b1', index: 0, raw: '2147483647' })
    pad = edit(pad, { op: 'addArg', button: 'b1', type: 'f' })
    pad = edit(pad, { op: 'setArgValue', button: 'b1', index: 1, raw: '0.25' })
    pad = edit(pad, { op: 'addArg', button: 'b1', type: 's' })
    pad = edit(pad, { op: 'setArgValue', button: 'b1', index: 2, raw: ' メンバーA ' })
    expect(find(pad, 'b1')?.args).toEqual([{ type: 'i', value: 2147483647 }, { type: 'f', value: 0.25 }, { type: 's', value: ' メンバーA ' }])
    for (const [type, raw] of [['i', '2147483648'], ['i', '1.5'], ['i', '0x10'], ['f', 'nan'], ['f', 'inf'], ['f', 'x'], ['f', '1e300'], ['f', '0x10']] as const) {
      expect(() => parseArgValue(type, raw)).toThrow(PadEditError)
    }
    expect(() => parseArgValue('f', '1e300')).toThrow('float32')
    expect(parseArgValue('i', ' -1_000 ')).toBe(-1000)
    expect(parseArgValue('f', '3.4028234663852886e38')).toBe(3.4028234663852886e38)
    expect(refusal(pad, { op: 'setArgValue', button: 'b1', index: 0, raw: '1.5' })).toBe('整数を入力してください')
    expect(refusal(pad, { op: 'setArgValue', button: 'b1', index: 9, raw: '1' })).toBe('その引数はありません')
    // 型を変えると、読める値は引き継ぎ、読めない値は既定値にする
    expect(find(edit(pad, { op: 'setArgType', button: 'b1', index: 1, type: 's' }), 'b1')?.args[1]).toEqual({ type: 's', value: '0.25' })
    expect(find(edit(pad, { op: 'setArgType', button: 'b1', index: 2, type: 'i' }), 'b1')?.args[2]).toEqual({ type: 'i', value: 0 })
    expect(find(edit(pad, { op: 'setArgType', button: 'b1', index: 0, type: 'f' }), 'b1')?.args[0]).toEqual({ type: 'f', value: 2147483647 })
    expect(find(edit(pad, { op: 'moveArg', button: 'b1', index: 0, delta: 1 }), 'b1')?.args.map(arg => arg.type)).toEqual(['f', 'i', 's'])
    expect(refusal(pad, { op: 'moveArg', button: 'b1', index: 0, delta: -1 })).toBe('これ以上動かせません')
    expect(find(edit(pad, { op: 'removeArg', button: 'b1', index: 1 }), 'b1')?.args.map(arg => arg.type)).toEqual(['i', 's'])
  })

  it('refuses NUL and lone surrogates in string arguments, and limits their count and length', () => {
    let pad = edit(withButton(), { op: 'addArg', button: 'b1', type: 's' })
    expect(refusal(pad, { op: 'setArgValue', button: 'b1', index: 0, raw: 'a\0b' })).toContain('NUL')
    expect(refusal(pad, { op: 'setArgValue', button: 'b1', index: 0, raw: 'a\ud800' })).toContain('孤立サロゲート')
    expect(refusal(pad, { op: 'setArgValue', button: 'b1', index: 0, raw: 'x'.repeat(OSC_PAD.MAX_STRING_ARG_CHARS + 1) })).toBe('文字列は 1024 文字までです')
    expect(parseArgValue('s', '😀')).toBe('😀')
    for (let index = 1; index < OSC_PAD.MAX_ARGS; index += 1) pad = edit(pad, { op: 'addArg', button: 'b1', type: 'i' })
    expect(refusal(pad, { op: 'addArg', button: 'b1', type: 'i' })).toBe('引数は 16 個までです')
  })

  it('normalizes colors and builds images from their leading bytes', () => {
    const pad = withButton()
    const colored = edit(pad, { op: 'setColor', button: 'b1', color: ' #1e88e5 ' })
    expect(find(colored, 'b1')?.color).toBe('#1E88E5')
    expect(find(edit(colored, { op: 'setColor', button: 'b1', color: null }), 'b1')).not.toHaveProperty('color')
    expect(find(edit(colored, { op: 'setColor', button: 'b1', color: '' }), 'b1')).not.toHaveProperty('color')
    expect(refusal(pad, { op: 'setColor', button: 'b1', color: 'blue' })).toBe('色は #rrggbb の形で指定してください')

    const withImage = edit(pad, { op: 'setImage', button: 'b1', data: PNG_1PX })
    expect(find(withImage, 'b1')?.image).toBe(`data:image/png;base64,${PNG_1PX}`)
    expect(find(edit(withImage, { op: 'setImage', button: 'b1', data: null }), 'b1')).not.toHaveProperty('image')
    const base64 = (bytes: number[]) => Buffer.from(bytes).toString('base64')
    expect(find(edit(pad, { op: 'setImage', button: 'b1', data: base64([0xff, 0xd8, 0xff, 0xe0]) }), 'b1')?.image).toMatch(/^data:image\/jpeg;base64,/)
    expect(find(edit(pad, { op: 'setImage', button: 'b1', data: Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1').toString('base64') }), 'b1')?.image).toMatch(/^data:image\/webp;base64,/)
    expect(find(edit(pad, { op: 'setImage', button: 'b1', data: Buffer.from('GIF89a', 'latin1').toString('base64') }), 'b1')?.image).toMatch(/^data:image\/gif;base64,/)
    // ブラウザが付ける種類は当てにしない。SVG は受けない
    expect(refusal(pad, { op: 'setImage', button: 'b1', data: Buffer.from('<svg/>').toString('base64') })).toContain('PNG / JPEG / GIF / WebP')
    expect(refusal(pad, { op: 'setImage', button: 'b1', data: 'not base64!' })).toBe('画像のデータを読めません')
    const tooBig = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(OSC_PAD.MAX_IMAGE_BYTES)]).toString('base64')
    expect(refusal(pad, { op: 'setImage', button: 'b1', data: tooBig })).toBe('画像は 256 KiB までです(256 KiB)')
  })

  it('refuses an image that would exceed the total image budget', () => {
    const count = OSC_PAD.MAX_TOTAL_IMAGE_BYTES / OSC_PAD.MAX_IMAGE_BYTES
    const image = imageOf(OSC_PAD.MAX_IMAGE_BYTES)
    const pad: OscPad = {
      ...newPad(12, 12),
      buttons: Array.from({ length: count + 1 }, (_, index) => ({
        id: `b${String(index)}`, row: Math.floor(index / 12), column: index % 12, label: '', address: '/x', args: [],
        ...(index < count ? { image } : {}),
      })),
    }
    expect(refusal(pad, { op: 'setImage', button: `b${String(count)}`, data: PNG_1PX })).toBe('パッド全体の画像が 4 MiB を超えます')
    // 同じボタンの画像の差し替えは、そのボタンの今の画像を数えない
    expect(applyPadEdit(pad, { op: 'setImage', button: 'b0', data: PNG_1PX }).ok).toBe(true)
  })

  it('refuses a broken draft and edits that would make the pad too large to save', () => {
    expect(applyPadEdit({ ...newPad(), rows: 0 }, { op: 'resize', rows: 1, columns: 1 })).toMatchObject({ ok: false, detail: expect.stringContaining('作業中のパッドが不正です') })
    // 保存と同じ検査(JSON の大きさを含む)に通らない作業コピーは返さない
    const big: OscPad = {
      ...newPad(12, 12),
      buttons: Array.from({ length: 144 }, (_, index) => ({
        id: `b${String(index)}`, row: Math.floor(index / 12), column: index % 12, label: '', address: '/x',
        args: Array.from({ length: OSC_PAD.MAX_ARGS }, () => ({ type: 's' as const, value: 'あ'.repeat(OSC_PAD.MAX_STRING_ARG_CHARS) })),
        ...(index < 3 ? { image: imageOf(OSC_PAD.MAX_IMAGE_BYTES) } : {}),
      })),
    }
    expect(oscPadSerializedBytes(big)).toBeLessThanOrEqual(OSC_PAD.MAX_SERIALIZED_BYTES)
    const result = applyPadEdit(big, { op: 'setImage', button: 'b3', data: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(OSC_PAD.MAX_IMAGE_BYTES - 3)]).toString('base64') })
    expect(result).toMatchObject({ ok: false, detail: expect.stringContaining('bytes as JSON') })
  })

  it('refuses edits that point at a missing button', () => {
    const pad = withButton()
    for (const command of [
      { op: 'removeButton', button: 'zz' }, { op: 'setLabel', button: 'zz', label: 'x' }, { op: 'setColor', button: 'zz', color: null },
      { op: 'setAddress', button: 'zz', address: '/x' }, { op: 'setImage', button: 'zz', data: null }, { op: 'addArg', button: 'zz', type: 'i' },
    ] satisfies OscPadEdit[]) {
      expect(refusal(pad, command)).toBe('ボタン zz がありません')
    }
  })
})
