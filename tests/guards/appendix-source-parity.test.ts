import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MANIFEST_SIZE } from '../../packages/shared/src/limits'

const repositoryRoot = resolve(__dirname, '../..')
const protocolDocumentPath = resolve(repositoryRoot, 'docs/UNITY_PROTOCOL.md')

const appendixSources = [
  {
    heading: '#### A.2.1 `OscSurfaceBridge.Staging.asmdef` 全文',
    path: 'OscSurface/Assets/OscSurfaceBridge/Staging/OscSurfaceBridge.Staging.asmdef',
    language: 'json',
  },
  {
    heading: '#### A.2.2 `OscSurfaceStaging.cs` 全文',
    path: 'OscSurface/Assets/OscSurfaceBridge/Staging/OscSurfaceStaging.cs',
    language: 'csharp',
  },
  {
    heading: '#### A.2.3 `OscSurfaceManifestAsset.cs` 全文',
    path: 'OscSurface/Assets/OscSurfaceBridge/OscSurfaceManifestAsset.cs',
    language: 'csharp',
  },
  {
    heading: '#### A.2.4 `OscSurfaceBridge.cs` 全文',
    path: 'OscSurface/Assets/OscSurfaceBridge/OscSurfaceBridge.cs',
    language: 'csharp',
  },
  {
    heading: '#### A.2.5 `OscSurfaceBridge.Staging.Tests.asmdef` 全文',
    path: 'OscSurface/Assets/OscSurfaceBridge/Tests/Editor/OscSurfaceBridge.Staging.Tests.asmdef',
    language: 'json',
  },
  {
    heading: '#### A.2.6 `StagingEngineTests.cs` 全文',
    path: 'OscSurface/Assets/OscSurfaceBridge/Tests/Editor/StagingEngineTests.cs',
    language: 'csharp',
  },
  {
    heading: '#### A.2.7 `StagingFixtureTests.cs` 全文',
    path: 'OscSurface/Assets/OscSurfaceBridge/Tests/Editor/StagingFixtureTests.cs',
    language: 'csharp',
  },
  {
    heading: '#### A.2.8 `OscSurfaceManifestModel.cs` 全文',
    path: 'OscSurface/Assets/OscSurfaceBridge/Staging/OscSurfaceManifestModel.cs',
    language: 'csharp',
  },
  {
    heading: '#### A.2.9 `OscSurfaceManifestSession.cs` 全文',
    path: 'OscSurface/Assets/OscSurfaceBridge/Staging/OscSurfaceManifestSession.cs',
    language: 'csharp',
  },
  {
    heading: '#### A.2.10 `ManifestSessionTests.cs` 全文',
    path: 'OscSurface/Assets/OscSurfaceBridge/Tests/Editor/ManifestSessionTests.cs',
    language: 'csharp',
  },
] as const

const normalize = (contents: string): string => contents
  .replaceAll('\r\n', '\n')
  .replaceAll('\r', '\n')
  .replace(/\n+$/, '')

const extractCodeBlock = (document: string, heading: string, language: string): string => {
  const headingStart = document.indexOf(`${heading}\n`)
  if (headingStart < 0) throw new Error(`付録見出しが見つかりません: ${heading}`)

  const section = document.slice(headingStart + heading.length)
  const blockStart = section.indexOf(`\n\`\`\`${language}\n`)
  if (blockStart < 0) throw new Error(`付録コードブロックが見つかりません: ${heading}`)

  const contentsStart = blockStart + `\n\`\`\`${language}\n`.length
  const blockEnd = section.indexOf('\n```', contentsStart)
  if (blockEnd < 0) throw new Error(`付録コードブロックの終端が見つかりません: ${heading}`)

  return section.slice(contentsStart, blockEnd)
}

describe('UNITY_PROTOCOL appendix source parity guard', () => {
  it.each(appendixSources)('keeps $path identical to its Appendix A.2 code block', ({ heading, path, language }) => {
    const document = readFileSync(protocolDocumentPath, 'utf8')
    const appendixSource = normalize(extractCodeBlock(document, heading, language))
    const repositorySource = normalize(readFileSync(resolve(repositoryRoot, path), 'utf8'))

    expect(appendixSource, `付録コードブロックと実ファイルが一致しません: ${path}`).toBe(repositorySource)
  })
})

describe('Unity ManifestLimits constants', () => {
  const modelSource = readFileSync(
    resolve(repositoryRoot, 'OscSurface/Assets/OscSurfaceBridge/Staging/OscSurfaceManifestModel.cs'),
    'utf8',
  )
  const readConstant = (name: string): number => {
    const match = new RegExp(`public const int ${name} = (\\d+);`).exec(modelSource)
    if (!match) throw new Error(`ManifestLimits.${name} が見つかりません`)
    return Number(match[1])
  }

  it('keeps WarningBytes equal to shared MANIFEST_SIZE.WARNING_BYTES', () => {
    expect(readConstant('WarningBytes')).toBe(MANIFEST_SIZE.WARNING_BYTES)
  })

  it('keeps PracticalLimitBytes equal to shared MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES', () => {
    expect(readConstant('PracticalLimitBytes')).toBe(MANIFEST_SIZE.PRACTICAL_LIMIT_BYTES)
  })
})
