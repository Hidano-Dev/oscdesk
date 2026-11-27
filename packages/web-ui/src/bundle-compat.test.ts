// SPA のバンドルが対応するブラウザ(iOS 15 の Safari まで。build-options.mjs)で読み込めるか(D-138)。
// esbuild は対象のブラウザが読めない正規表現の構文をそのまま通すので、1 つでも混ざるとモジュールの読み込みで SyntaxError になり、
// 古い iPhone で画面全体が真っ白になる(PR #153 のレビュー。shared の孤立サロゲートの判定が後読みを使っていた)。
// dist に頼らず、ここでバンドルし直して中身を見る(test:unit を単独で回してもビルド前の古い dist を見ない)
import path from 'node:path'

import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

import { bundleOptions } from '../build-options.mjs'

// Safari 16.4 より前が読めない正規表現の構文: 後読み((?<= / (?<!)。名前付きの捕獲((?<name>)は Safari 11.1 から読める
const UNSUPPORTED_BEFORE_SAFARI_16_4 = [/\(\?<=/, /\(\?<!/]

describe('SPA bundle compatibility', () => {
  it('contains no regular expression syntax that Safari 15 cannot parse', async () => {
    const result = await build({ ...bundleOptions(path.resolve(__dirname, '..')), write: false, logLevel: 'silent' })
    const code = result.outputFiles.map((file) => file.text).join('\n')
    expect(code.length).toBeGreaterThan(10_000)
    const found = UNSUPPORTED_BEFORE_SAFARI_16_4.flatMap((pattern) => {
      const index = code.search(pattern)
      return index < 0 ? [] : [`${pattern.source} near: ${code.slice(Math.max(0, index - 60), index + 60)}`]
    })
    expect(found).toEqual([])
  }, 30_000)
})
