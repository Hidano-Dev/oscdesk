import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(__dirname, '../..')

const trackedFiles = (): string[] => execFileSync(
  'git',
  ['ls-files', '-z'],
  { cwd: repositoryRoot, encoding: 'buffer' },
).toString('utf8')
  .split('\0')
  .filter((filePath) => filePath.length > 0 && existsSync(resolve(repositoryRoot, filePath)))

const withExtension = (files: string[], extensions: string[]): string[] =>
  files.filter((filePath) => extensions.some((extension) => filePath.toLowerCase().endsWith(extension)))

describe('launcher script guard', () => {
  // cmd はバッチをコードページ依存で行単位に解釈するため、UTF-8 の日本語は chcp 65001 を置いても壊れ、
  // 「内部コマンドまたは外部コマンド…」のエラーが並ぶ。日本語は .ps1 に置く(D-068)
  it('keeps .bat / .cmd files pure ASCII', () => {
    const offenders = withExtension(trackedFiles(), ['.bat', '.cmd']).flatMap((filePath) => {
      const bytes = readFileSync(resolve(repositoryRoot, filePath))
      const index = bytes.findIndex((byte) => byte >= 0x80)
      return index >= 0 ? [`${filePath} (byte offset ${index})`] : []
    })
    expect(offenders, `Non-ASCII bytes found:\n${offenders.join('\n')}`).toEqual([])
  })

  // Windows PowerShell 5.1 は BOM の無い .ps1 を ANSI コードページで読み、日本語の文字列やコメントが化けて
  // 構文エラーになることがある
  it('saves .ps1 files as UTF-8 with BOM', () => {
    const offenders = withExtension(trackedFiles(), ['.ps1']).filter((filePath) => {
      const bytes = readFileSync(resolve(repositoryRoot, filePath))
      return !(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    })
    expect(offenders, `.ps1 without UTF-8 BOM:\n${offenders.join('\n')}`).toEqual([])
  })

  // 直下には通常起動の bat だけを置き、用途別ランチャーと setup は launchers/ にまとめる(D-068)
  it('keeps only start-oscdesk.bat as a launcher at the repository root', () => {
    const rootLaunchers = withExtension(trackedFiles(), ['.bat', '.cmd', '.ps1'])
      .filter((filePath) => !filePath.includes('/'))
    expect(rootLaunchers).toEqual(['start-oscdesk.bat'])
  })

  // bat は %~dp0 からの相対で .ps1 を呼ぶ。移動や改名で呼び先を失うと、ダブルクリックで初めて気づく
  it('points every launcher .bat at an existing .ps1', () => {
    const broken = withExtension(trackedFiles(), ['.bat', '.cmd']).flatMap((filePath) => {
      const text = readFileSync(resolve(repositoryRoot, filePath), 'latin1')
      const directory = resolve(repositoryRoot, filePath, '..')
      return [...text.matchAll(/%~dp0([^"%\s]+\.ps1)/g)]
        .map((match) => match[1].replaceAll('\\', '/'))
        .filter((target) => !existsSync(resolve(directory, target)))
        .map((target) => `${filePath} -> ${target}`)
    })
    expect(broken, `Missing launcher targets:\n${broken.join('\n')}`).toEqual([])
  })
})
