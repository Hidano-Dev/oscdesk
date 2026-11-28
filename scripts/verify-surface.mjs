// 手動検証(docs/VERIFICATION.md)の準備を機械的に行う補助スクリプト(HID-222)。
// launchers/start-oscdesk-verify.ps1 から呼ばれるほか、見本のパッドを単体で取り出すのにも使う。
// サーフェス定義は撤去した(D-172)ので、見本は protocol/pad-document-samples.json のパッド(版 2。D-167)を使う。
// ファイル名は手順書から呼ばれている名前のまま残す。
//
//   node scripts/verify-surface.mjs export <見本名> <出力先>
//   node scripts/verify-surface.mjs prepare --out <config の出力先> [--base <元の config>]
//        [--sample <見本名>] [--name <保存名>] [--reset] [--secondary <name>:<host>:<port>]...
//
// 追跡対象の config を書き換えずに一時 config を作るのは、検証のたびに config を手で直して
// 戻す運用だと、戻し忘れがそのままコミットされるため。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const SAMPLES_PATH = path.join(repositoryRoot, 'protocol', 'pad-document-samples.json')
// packages/shared の SURFACE_NAME_PATTERN(パッドの名前の規則)と同じ規則。ここで弾かないと、ブリッジが起動時の
// 採用で読めずに「パッドなし」で立ち上がり、原因が分かりにくくなる
const PAD_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
// ブリッジが採用中のパッドの名前を覚えるファイル(packages/bridge の adapters/pad-active-file と同じ名前と形)
const ACTIVE_FILE_NAME = '.active.json'
const ACTIVE_FORMAT = 'oscdesk-pad-active'
// 保管先の既定(packages/bridge の app/bridge-server と同じ。surfaces.padsDir を省くと <surfaces.dir>/pads)
const DEFAULT_PADS_DIR_NAME = 'pads'

function findSample(caseName) {
  const { cases } = JSON.parse(fs.readFileSync(SAMPLES_PATH, 'utf8'))
  const found = cases.find((entry) => entry.name === caseName)
  if (!found) {
    throw new Error(`見本 "${caseName}" が ${path.basename(SAMPLES_PATH)} にありません`)
  }
  return found
}

// 拒否を確かめる手順では不正な見本も取り出すので、export は valid を問わない
export function exportSample(caseName, outPath) {
  writeJson(outPath, findSample(caseName).pad)
  return outPath
}

function parseSecondary(spec) {
  const match = /^([^:]+):([^:]+):(\d+)$/.exec(spec)
  if (!match) {
    throw new Error(`--secondary は <name>:<host>:<port> の形で指定してください: ${spec}`)
  }
  return { name: match[1], host: match[2], sendPort: Number(match[3]) }
}

/**
 * 見本のパッドをパッドの保管先に置き、それを起動時に採用させる(採用中の名前のファイルを書く)一時 config を書き出す。
 * 既存のパッドは -reset が無い限り上書きしない(検証の途中でパッドを画面で変えてから起動し直す手順があるため)。
 */
export function prepareVerification(options) {
  const { root = repositoryRoot, base, out, sample, name, reset = false, secondary = [] } = options
  const basePath = path.resolve(root, base ?? path.join('config', 'oscdesk.config.json'))
  const config = JSON.parse(fs.readFileSync(basePath, 'utf8'))
  const messages = []

  if (sample !== undefined) {
    const padName = name ?? sample
    if (!PAD_NAME_PATTERN.test(padName) || WINDOWS_RESERVED_NAME.test(padName)) {
      throw new Error(`保存名に使えない名前です: ${padName}`)
    }
    const found = findSample(sample)
    if (found.valid === false) {
      // 不正な見本はブリッジが読めずに「パッドなし」で起動するだけで、検証にならない
      throw new Error(`見本 "${sample}" は検証に通らない見本です(valid: false)。起動には使えません`)
    }
    // 保管先はブリッジの作業ディレクトリ(リポジトリ root)からの相対で解決される
    const surfacesDir = config.surfaces?.dir ?? 'surfaces'
    const padsDir = config.surfaces?.padsDir ?? path.join(surfacesDir, DEFAULT_PADS_DIR_NAME)
    const padPath = path.resolve(root, padsDir, `${padName}.json`)
    if (fs.existsSync(padPath) && !reset) {
      messages.push(`既存の ${path.relative(root, padPath)} を使います(見本から作り直すには -Reset)`)
    } else {
      if (fs.existsSync(padPath)) {
        const backupPath = backupPad(root, padsDir, padName, padPath)
        messages.push(`既存のパッドを ${path.relative(root, backupPath)} へ退避しました`)
      }
      writeJson(padPath, found.pad)
      messages.push(`見本 "${sample}" を ${path.relative(root, padPath)} に置きました`)
    }
    // ブリッジは最後に採用したパッドを起動時に採用し直す。その名前をこのパッドにする
    writeJson(path.resolve(root, padsDir, ACTIVE_FILE_NAME), { format: ACTIVE_FORMAT, active: padName })
    messages.push(`起動時に "${padName}" を採用します`)
  }

  if (secondary.length > 0) {
    config.unity = { ...config.unity, secondary: secondary.map(parseSecondary) }
    for (const target of config.unity.secondary) {
      messages.push(`副系 ${target.name} (${target.host}:${target.sendPort}) を宛先に足しました`)
    }
  }

  const outPath = path.resolve(root, out)
  writeJson(outPath, config)
  return { configPath: outPath, messages }
}

function backupPad(root, padsDir, padName, padPath) {
  // 退避先は保管先の隠しフォルダ(先頭の . はパッドの名前の規則に合わないので一覧に混ざらない)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.resolve(root, padsDir, '.backups', `${padName}.${stamp}.json`)
  fs.mkdirSync(path.dirname(backupPath), { recursive: true })
  fs.copyFileSync(padPath, backupPath)
  return backupPath
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function parseArgs(argv) {
  const options = { secondary: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined) throw new Error(`${flag} に値がありません`)
      index += 1
      return next
    }
    switch (flag) {
      case '--out': options.out = value(); break
      case '--base': options.base = value(); break
      case '--sample': options.sample = value(); break
      case '--name': options.name = value(); break
      case '--secondary': options.secondary.push(value()); break
      case '--reset': options.reset = true; break
      default: throw new Error(`不明な引数です: ${flag}`)
    }
  }
  if (options.out === undefined) throw new Error('--out が必要です')
  return options
}

function main(argv) {
  const [command, ...rest] = argv
  if (command === 'export') {
    const [caseName, outPath] = rest
    if (caseName === undefined || outPath === undefined) {
      throw new Error('使い方: node scripts/verify-surface.mjs export <見本名> <出力先>')
    }
    console.log(`見本 "${caseName}" を ${exportSample(caseName, path.resolve(outPath))} に書き出しました`)
    return
  }
  if (command === 'prepare') {
    const { configPath, messages } = prepareVerification(parseArgs(rest))
    for (const message of messages) console.log(message)
    console.log(`検証用の設定を ${configPath} に書き出しました`)
    return
  }
  throw new Error('使い方: node scripts/verify-surface.mjs export|prepare ...')
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
