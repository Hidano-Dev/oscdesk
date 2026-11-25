// テストの段階別の入口(HID-438)。`corepack pnpm test` / `test:fast` / `test:unit` / `test:py` /
// `test:e2e` / `test:guards` / `test:changed` はすべてここを通る。
//
// なぜ: エージェントは修正のたびに検証を回す。各ツールの出力をそのまま流すとテスト 1 件ごとに 1 行が並び、
// 失敗の場所を探すだけで文脈を使い切る。そこで各段の出力は logs/test-results/ のログと機械可読の結果
// (vitest の json、pytest の junitxml)に書き、画面には「通過 N 件、失敗 M 件」と、失敗ごとの
// 名前・ファイル:行・メッセージの先頭数行だけを出す。全文が要るときはログを読むか --verbose で流す。
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const resultsDir = path.join(repositoryRoot, 'logs', 'test-results')
// pytest の rootdir は pyproject.toml のある UI パッケージになるので、junitxml の file はそこからの相対で出る
const uiRelative = 'packages/nicegui-ui'

// 1 件の失敗に出すメッセージの行数と、要約に並べる失敗の件数の上限。
// 1 件の失敗が 10 行程度に収まることを狙う(HID-438 の完了条件)
const MESSAGE_LINES = 4
const MAX_FAILURES_SHOWN = 15
const LOG_TAIL_LINES = 15

// --- 純粋関数(tests/scripts/run-tests.test.ts が検査する) ---

const ANSI = /\u001b\[[0-9;]*m/g

export function stripAnsi(text) {
  return String(text ?? '').replace(ANSI, '')
}

function toRelative(file, root) {
  const relative = path.relative(root, file)
  return (relative.startsWith('..') || path.isAbsolute(relative) ? file : relative).replaceAll('\\', '/')
}

// 失敗メッセージから、スタックの行を除いた先頭の数行を取る(場所はファイル:行で別に出すので、スタックは不要)
export function messageHead(message, limit = MESSAGE_LINES) {
  return stripAnsi(message)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '' && !/^\s*at\s/.test(line) && !/^\s*❯\s/.test(line))
    .slice(0, limit)
}

// スタックの中で、テストファイル自身を指す最初のフレームの行番号。宣言の行より、落ちた行の方が直す場所に近い
export function lineFromStack(message, file) {
  const base = path.basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = stripAnsi(message).match(new RegExp(`${base}:(\\d+):\\d+`))
  return match ? Number(match[1]) : undefined
}

// vitest の json reporter の結果を、件数と失敗の一覧にする
export function summarizeVitest(report, root = repositoryRoot) {
  const failures = []
  let passed = 0
  let failed = 0
  let skipped = 0
  for (const file of report.testResults ?? []) {
    const relative = toRelative(file.name, root)
    let failedInFile = 0
    for (const test of file.assertionResults ?? []) {
      if (test.status === 'passed') {
        passed += 1
      } else if (test.status === 'failed') {
        failed += 1
        failedInFile += 1
        const message = (test.failureMessages ?? []).join('\n')
        const line = lineFromStack(message, file.name) ?? test.location?.line
        failures.push({ name: test.fullName ?? test.title, file: relative, line, message: messageHead(message) })
      } else {
        skipped += 1
      }
    }
    // ファイルの読み込みに失敗すると個々のテストは無く、ファイルにだけメッセージが付く。数えないと「失敗 0 件」で落ちる
    if (file.status === 'failed' && failedInFile === 0) {
      failed += 1
      const message = file.message ?? ''
      failures.push({ name: '(ファイル全体)', file: relative, line: lineFromStack(message, file.name), message: messageHead(message) })
    }
  }
  return { passed, failed, skipped, failures }
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
}

function attributes(text) {
  const result = {}
  for (const match of text.matchAll(/([\w:-]+)="([^"]*)"/g)) result[match[1]] = decodeEntities(match[2])
  return result
}

// pytest の junitxml(junit_family=xunit1。file と line が付く)を、件数と失敗の一覧にする。
// 依存を増やさないため XML は正規表現で読む。pytest が書く形(testcase の下に failure / error / skipped)だけを扱う
export function summarizeJunit(xml, prefix = uiRelative) {
  const failures = []
  let passed = 0
  let failed = 0
  let skipped = 0
  for (const match of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = attributes(match[1])
    const body = match[3] ?? ''
    const problem = body.match(/<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/)
    if (problem) {
      failed += 1
      // 色付きで書かれた junitxml では ESC が "#x1B" として残る。行の照合が外れないよう両方の形を消す
      const detail = stripAnsi(decodeEntities(problem[3] ?? '')).replace(/#x1B\[[0-9;]*m/g, '')
      const problemAttrs = attributes(problem[2])
      // 本文の "E   " の行が assert の中身。無ければ message 属性(収集時の error など)に戻る
      const eLines = detail.split(/\r?\n/).filter((line) => line.startsWith('E ')).map((line) => line.slice(1).trim())
      const message = eLines.length > 0 ? eLines.slice(0, MESSAGE_LINES) : messageHead(problemAttrs.message ?? detail)
      // 落ちた行は traceback の最後の "path.py:行: 例外" に出る。無ければテストの宣言の行(xunit1 は 0 始まり)
      const locations = [...detail.matchAll(/^(.+\.py):(\d+): /gm)]
      const file = attrs.file ? `${prefix}/${attrs.file.replaceAll('\\', '/')}` : attrs.classname
      const last = locations.at(-1)
      const line = last && path.basename(last[1]) === path.basename(attrs.file ?? '')
        ? Number(last[2])
        : attrs.line !== undefined ? Number(attrs.line) + 1 : undefined
      const kind = problem[1] === 'error' ? ' [error]' : ''
      failures.push({ name: `${attrs.name}${kind}`, file, line, message })
    } else if (/<skipped\b/.test(body)) {
      skipped += 1
    } else {
      passed += 1
    }
  }
  return { passed, failed, skipped, failures }
}

// typecheck の出力から tsc のエラー行だけを抜く(pnpm -r が付けるパッケージの接頭辞はそのまま残す)
export function typecheckErrors(output) {
  return stripAnsi(output)
    .split(/\r?\n/)
    .filter((line) => /error TS\d+/.test(line))
    .map((line) => line.trim())
}

// 変わったファイルのうち、pytest の結果を変え得るもの。UI のテストはブリッジのビルド成果物
// (surface-view-tool.js。shared を同梱する)と protocol/ の見本も読むので、それらの変更でも回す
export function affectsPython(files) {
  return files.some((file) => /^(packages\/(nicegui-ui|bridge|shared)\/|protocol\/)/.test(file.replaceAll('\\', '/')))
}

function formatDuration(ms) {
  return `${(ms / 1000).toFixed(1)}s`
}

// 段ごとの結果を最終の要約にする。段は { label, ok, counts?, failures?, notes?, logs? }
export function formatSummary(steps, elapsedMs) {
  const lines = []
  let passed = 0
  let failed = 0
  let skipped = 0
  const failures = []
  for (const step of steps) {
    if (step.counts) {
      passed += step.counts.passed
      failed += step.counts.failed
      skipped += step.counts.skipped
    }
    for (const failure of step.failures ?? []) failures.push({ ...failure, label: step.label })
  }
  const brokenSteps = steps.filter((step) => !step.ok && (step.failures ?? []).length === 0)
  for (const [index, failure] of failures.entries()) {
    if (index >= MAX_FAILURES_SHOWN) {
      lines.push(`... ほか ${failures.length - MAX_FAILURES_SHOWN} 件(全文は logs/test-results/)`)
      break
    }
    const where = failure.line ? `${failure.file}:${failure.line}` : failure.file
    lines.push(`FAIL [${failure.label}] ${where}`)
    lines.push(`  ${failure.name}`)
    for (const message of failure.message ?? []) lines.push(`    ${message}`)
  }
  // 件数の取れない失敗(typecheck・ビルド・結果ファイルを書けなかった実行)は、出力の要所を出す
  for (const step of brokenSteps) {
    lines.push(`FAIL [${step.label}]`)
    for (const note of step.notes ?? []) lines.push(`    ${note}`)
  }
  for (const step of steps) {
    if (step.skippedReason) lines.push(`SKIP [${step.label}] ${step.skippedReason}`)
  }
  const ok = steps.every((step) => step.ok)
  const counts = `通過 ${passed} 件、失敗 ${failed} 件、スキップ ${skipped} 件`
  const stepsFailed = brokenSteps.map((step) => step.label)
  const tail = stepsFailed.length > 0 ? `、失敗した段: ${stepsFailed.join(', ')}` : ''
  lines.push(`${ok ? 'OK' : 'NG'}: ${counts}${tail}(${formatDuration(elapsedMs)})`)
  const logs = steps.filter((step) => !step.ok).flatMap((step) => step.logs ?? [])
  if (!ok && logs.length > 0) lines.push(`全文: ${logs.join(' ')}`)
  return lines
}

// --- 実行 ---

const MODES = {
  // `corepack pnpm test`: すべて(DEVELOPMENT.md の単一の入口)。ビルドが失敗したら後段は意味が無いので止める
  all: ['build', 'vitest:all', 'pytest'],
  // 一次ゲート(checks.fast)。e2e を含めない。ビルドは pytest がブリッジの成果物を読むため(D-124)
  fast: ['build', 'typecheck', 'vitest:unit', 'pytest'],
  unit: ['vitest:unit'],
  py: ['build', 'pytest'],
  e2e: ['build', 'vitest:e2e'],
  guards: ['vitest:guards'],
  changed: ['build', 'vitest:changed', 'pytest:changed'],
}
const SINGLE_TOOL_MODES = new Set(['unit', 'py', 'e2e', 'guards'])

function relativeLog(file) {
  return toRelative(file, repositoryRoot)
}

function run(command, args, { logFile, verbose, shell = false }) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(logFile)
    let captured = ''
    // 色を止める。FORCE_COLOR は値に関係なく「色を付ける」と読むツール(pytest)があるので消し、NO_COLOR で止める
    const env = { ...process.env, NO_COLOR: '1' }
    delete env.FORCE_COLOR
    const child = spawn(command, args, { cwd: repositoryRoot, shell, env })
    const take = (chunk) => {
      out.write(chunk)
      captured += chunk.toString()
      if (verbose) process.stdout.write(chunk)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', (error) => {
      captured += `\n${error.message}`
      out.end(() => resolve({ status: 1, output: captured }))
    })
    child.on('close', (status) => out.end(() => resolve({ status: status ?? 1, output: captured })))
  })
}

function tail(output, count = LOG_TAIL_LINES) {
  return stripAnsi(output).split(/\r?\n/).filter((line) => line.trim() !== '').slice(-count)
}

function changedFiles(base) {
  const git = (args) => spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' })
  const diff = git(['diff', '--name-only', base])
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
  if (diff.status !== 0) throw new Error(`git diff ${base} に失敗しました: ${diff.stderr.trim()}`)
  return [...diff.stdout.split(/\r?\n/), ...untracked.stdout.split(/\r?\n/)].filter((line) => line !== '')
}

// 比較の基準。引数が無ければ origin/main との分岐点(作業ブランチで積んだコミットと未コミットの変更の両方が入る)
function changedBase(explicit) {
  if (explicit) return explicit
  const mergeBase = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: repositoryRoot, encoding: 'utf8' })
  return mergeBase.status === 0 ? mergeBase.stdout.trim() : 'HEAD'
}

async function runVitest(label, name, vitestArgs, options) {
  const jsonFile = path.join(resultsDir, `vitest-${name}.json`)
  const logFile = path.join(resultsDir, `vitest-${name}.log`)
  fs.rmSync(jsonFile, { force: true })
  const vitest = path.join(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs')
  const reporters = ['--reporter=json', `--outputFile.json=${jsonFile}`, '--includeTaskLocation']
  if (options.verbose) reporters.push('--reporter=default')
  const { status, output } = await run(process.execPath, [vitest, 'run', '--config', 'vitest.config.ts', ...reporters, ...vitestArgs], { logFile, verbose: options.verbose })
  const logs = [relativeLog(jsonFile), relativeLog(logFile)]
  if (!fs.existsSync(jsonFile)) return { label, ok: false, notes: tail(output), logs }
  const summary = summarizeVitest(JSON.parse(fs.readFileSync(jsonFile, 'utf8')))
  // 件数で失敗が見えないのに終了コードが失敗(未処理のエラーなど)のときは、出力の末尾を出して見落とさない
  const ok = status === 0 && summary.failed === 0
  return { label, ok, counts: summary, failures: summary.failures, notes: ok ? [] : tail(output), logs }
}

async function runPytest(label, pytestArgs, options) {
  const xmlFile = path.join(resultsDir, 'pytest.xml')
  const logFile = path.join(resultsDir, 'pytest.log')
  fs.rmSync(xmlFile, { force: true })
  const args = [path.join(repositoryRoot, 'scripts', 'run-python-tests.mjs'), '-q', '--color=no', '-p', 'no:cacheprovider', `--junitxml=${xmlFile}`, '-o', 'junit_family=xunit1', ...pytestArgs]
  const { status, output } = await run(process.execPath, args, { logFile, verbose: options.verbose })
  const logs = [relativeLog(xmlFile), relativeLog(logFile)]
  if (output.includes('[SKIP]') && !fs.existsSync(xmlFile)) {
    return { label, ok: true, skippedReason: tail(output, 1)[0] }
  }
  if (!fs.existsSync(xmlFile)) return { label, ok: false, notes: tail(output), logs }
  const summary = summarizeJunit(fs.readFileSync(xmlFile, 'utf8'))
  const ok = status === 0 && summary.failed === 0
  return { label, ok, counts: summary, failures: summary.failures, notes: ok ? [] : tail(output), logs }
}

async function runStep(step, extraArgs, options) {
  const corepack = (label, command) => {
    const logFile = path.join(resultsDir, `${label}.log`)
    // Windows の corepack は .cmd なので shell 経由で起動する。引数の配列と shell を併用すると Node が
    // 非推奨の警告(DEP0190)を出すので、固定の 1 行のコマンドとして渡す
    return run(`corepack ${command}`, [], { logFile, verbose: options.verbose, shell: true })
      .then(({ status, output }) => ({ status, output, logs: [relativeLog(logFile)] }))
  }
  switch (step) {
    case 'build': {
      const { status, output, logs } = await corepack('build', 'pnpm -r --if-present run build')
      return { label: 'build', ok: status === 0, notes: status === 0 ? [] : tail(output), logs, required: true }
    }
    case 'typecheck': {
      const { status, output, logs } = await corepack('typecheck', 'pnpm -r run typecheck')
      const errors = typecheckErrors(output)
      const notes = errors.length > 0 ? [...errors.slice(0, 10), ...(errors.length > 10 ? [`... ほか ${errors.length - 10} 件`] : [])] : tail(output)
      return { label: 'typecheck', ok: status === 0, notes: status === 0 ? [] : notes, logs }
    }
    case 'vitest:all':
      return runVitest('vitest', 'all', extraArgs, options)
    case 'vitest:unit':
      return runVitest('unit', 'unit', ['--project', 'unit', ...extraArgs], options)
    case 'vitest:e2e':
      return runVitest('e2e', 'e2e', ['--project', 'e2e', ...extraArgs], options)
    case 'vitest:guards':
      return runVitest('guards', 'guards', ['--project', 'unit', 'tests/guards', ...extraArgs], options)
    case 'vitest:changed':
      return runVitest('unit', 'changed', ['--project', 'unit', '--changed', options.base], options)
    case 'pytest':
      return runPytest('pytest', extraArgs, options)
    case 'pytest:changed': {
      const files = changedFiles(options.base)
      if (!affectsPython(files)) return { label: 'pytest', ok: true, skippedReason: 'UI・ブリッジ・shared・protocol に変更が無いので回しません' }
      return runPytest('pytest', [], options)
    }
    default:
      throw new Error(`未知の段です: ${step}`)
  }
}

async function main(argv) {
  const [mode, ...rest] = argv
  const verbose = rest.includes('--verbose') || process.env.OSCDESK_TEST_VERBOSE === '1'
  const args = rest.filter((arg) => arg !== '--verbose')
  const plan = MODES[mode]
  if (!plan) {
    console.error(`使い方: node scripts/run-tests.mjs <${Object.keys(MODES).join('|')}> [--verbose] [テストへ渡す引数]`)
    process.exit(2)
  }
  // 追加の引数(ファイルの絞り込み・-k など)は、テストの段が 1 つのモードでだけ渡す。
  // 複数の段に同じ引数を配ると、vitest のファイル指定を pytest が解釈できずに落ちる。changed では比較の基準になる
  const extraArgs = SINGLE_TOOL_MODES.has(mode) ? args : []
  const options = { verbose, base: mode === 'changed' ? changedBase(args[0]) : undefined }
  fs.mkdirSync(resultsDir, { recursive: true })
  const started = Date.now()
  const results = []
  for (const step of plan) {
    const stepStarted = Date.now()
    process.stdout.write(`... ${step}${step.endsWith('changed') ? ` (基準 ${options.base.slice(0, 12)})` : ''}\n`)
    const result = await runStep(step, extraArgs, options)
    results.push(result)
    const counts = result.counts ? ` 通過 ${result.counts.passed} / 失敗 ${result.counts.failed}` : ''
    process.stdout.write(`    ${result.ok ? 'ok' : 'NG'}${counts} (${formatDuration(Date.now() - stepStarted)})\n`)
    if (!result.ok && result.required) break
  }
  for (const line of formatSummary(results, Date.now() - started)) console.log(line)
  process.exit(results.every((result) => result.ok) ? 0 : 1)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
