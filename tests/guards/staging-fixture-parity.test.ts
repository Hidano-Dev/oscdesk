import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(__dirname, '../..')
const fixturePaths = [
  resolve(repositoryRoot, 'protocol/staging-cases.json'),
  resolve(repositoryRoot, 'OscSurface/Assets/OscSurfaceBridge/Tests/Editor/Fixtures/staging-cases.json'),
]

const normalizeFixture = (contents: string): string => contents.replaceAll('\r\n', '\n').replaceAll('\r', '\n').replace(/\n+$/, '')

describe('staging fixture parity guard', () => {
  it('keeps the Unity fixture identical to the canonical fixture', () => {
    const [canonical, unityCopy] = fixturePaths.map((fixturePath) => normalizeFixture(readFileSync(fixturePath, 'utf8')))

    expect(unityCopy, '原本を編集したら複製も更新する').toBe(canonical)
  })
})
