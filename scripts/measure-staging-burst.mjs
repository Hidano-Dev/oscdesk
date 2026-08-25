// docs/VERIFICATION.md「展開バーストの実測記録」のうち、UI 反映幅の自動計測。
//
// 64 展開先のステージング構成で mock-unity / ブリッジ / NiceGUI UI を一時ポートで起動し、
// 開発用の軽量ブラウザ(Playwright 同梱 Chromium の headless)で
// 「先頭ウィジェット反映〜最後のウィジェット反映」を測る。
// ユーザーの常用ブラウザには一切触れない。
//
//   node scripts/measure-staging-burst.mjs [--runs 3] [--targets 64] [--headed] [--probe]
//
// 標準出力の末尾に docs/VERIFICATION.md へ貼れる Markdown 表を出す。

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import dgram from 'node:dgram'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { chromium } from 'playwright'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
// config/oscdesk.config.json の expectedProjectId。誤接続ガードを通すため合わせる。
const PROJECT_ID = 'oscdesk-demo'
const SOURCE_LABEL = 'Burst Source'

const options = parseArgs(process.argv.slice(2))

const processes = []
let browser
let workDir

try {
  await main()
} finally {
  if (browser !== undefined) await browser.close().catch(() => undefined)
  for (const child of processes.reverse()) await stopProcess(child).catch(() => undefined)
  if (workDir !== undefined) await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
}

async function main() {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oscdesk-burst-'))
  const scenarioPath = path.join(workDir, 'staging-burst.json')
  await fs.writeFile(scenarioPath, JSON.stringify(buildScenario(options.targets), null, 2), 'utf8')
  log(`シナリオ生成: 展開先 ${options.targets} 件`)

  const mockPort = await reserveUdpPort()
  const bridgeOscPort = await reserveUdpPort()
  const wsPort = await reserveTcpPort()
  const uiPort = await reserveTcpPort()

  log(`ポート: mock-unity=${mockPort} bridge-osc=${bridgeOscPort} ws=${wsPort} ui=${uiPort}`)

  await start('mock-unity', process.execPath, [
    path.join(REPO_ROOT, 'packages/mock-unity/dist/mock-unity.js'),
    '--listen-port', String(mockPort),
    '--reply-host', '127.0.0.1',
    '--reply-port', String(bridgeOscPort),
    '--scenario', scenarioPath,
    '--project-id', PROJECT_ID,
  ], /^MOCK_UNITY_READY /m)

  await start('bridge', process.execPath, [
    path.join(REPO_ROOT, 'packages/bridge/dist/oscdesk-bridge.js'),
    '--ws-port', String(wsPort),
    '--osc-listen-port', String(bridgeOscPort),
    '--unity-host', '127.0.0.1',
    '--unity-port', String(mockPort),
    '--ui-port', String(uiPort),
  ], /^OSCDESK_BRIDGE_READY /m)

  await start('ui', path.join(REPO_ROOT, 'packages/nicegui-ui/.venv/Scripts/python.exe'), [
    '-m', 'oscdesk_ui',
    '--osc-host', '127.0.0.1',
    '--osc-port', String(wsPort),
    '--ui-host', '127.0.0.1',
    '--ui-port', String(uiPort),
  ], null)

  const url = `http://127.0.0.1:${uiPort}/`
  await waitForHttp(url, 60_000)
  log(`UI 起動: ${url}`)

  browser = await chromium.launch({ headless: !options.headed })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.getByText(`${options.targets + 1} 件`).first().waitFor({ timeout: 60_000 })
  await page.getByText(targetLabel(options.targets)).first().waitFor({ timeout: 60_000 })
  log('マニフェスト採用と全ウィジェット描画を確認')

  if (options.probe) {
    const html = await page.evaluate((label) => {
      const nodes = [...document.querySelectorAll('*')].filter(
        (node) => node.children.length === 0 && node.textContent.trim() === label,
      )
      return nodes.map((node) => {
        const card = node.closest('.q-card')
        const container = card ?? node.parentElement?.parentElement ?? node
        return `card=${card !== null} ${container.outerHTML.slice(0, 1200)}`
      })
    }, targetLabel(1))
    log(`probe: "${targetLabel(1)}" を含む要素 ${html.length} 件`)
    for (const fragment of html) console.log(fragment, '\n---')
    return
  }

  const spans = []
  const arrivals = []
  for (let run = 1; run <= options.runs; run += 1) {
    const token = `burst-r${run}-${Date.now().toString(36)}`
    const result = await measureBurst(page, token)
    spans.push(result.spanMs)
    arrivals.push(result.arrivedMs)
    log(`試行 ${run}/${options.runs}: 反映幅 ${result.spanMs.toFixed(4)} ms / 送信〜最後の反映 ${result.arrivedMs.toFixed(4)} ms (${result.count} 件)`)
  }

  printReport({ spans, arrivals, consoleErrors })
}

// --- 計測 -------------------------------------------------------------------

async function measureBurst(page, token) {
  const handles = []
  for (let index = 1; index <= options.targets; index += 1) {
    handles.push(await valueNodeHandle(page, targetLabel(index)))
  }

  await page.evaluate(({ nodes, token: expected }) => {
    const state = { first: null, last: null, count: 0, sentAt: null }
    const seen = new WeakSet()
    const scan = () => {
      for (const node of nodes) {
        if (seen.has(node) || !node.textContent.includes(expected)) continue
        const at = performance.now()
        seen.add(node)
        state.count += 1
        if (state.first === null) state.first = at
        state.last = at
      }
    }
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { subtree: true, childList: true, characterData: true })
    window.__burst = state
    window.__burstStop = () => observer.disconnect()
  }, { nodes: handles, token })

  const source = page.locator('.q-field').filter({ hasText: SOURCE_LABEL }).first()
  const input = source.locator('input.q-field__native').first()
  await input.click()
  await input.fill(token)

  await page.evaluate(() => {
    window.__burst.sentAt = performance.now()
  })
  await input.press('Enter')

  await page.waitForFunction(
    (expected) => window.__burst.count >= expected,
    options.targets,
    { timeout: 30_000 },
  )

  const state = await page.evaluate(() => {
    window.__burstStop()
    return { first: window.__burst.first, last: window.__burst.last, count: window.__burst.count, sentAt: window.__burst.sentAt }
  })

  for (const handle of handles) await handle.dispose()

  return {
    spanMs: state.last - state.first,
    arrivedMs: state.last - state.sentAt,
    count: state.count,
  }
}

// 表示専用ウィジェットの値テキストを持つ末端ノードを返す。
async function valueNodeHandle(page, label) {
  const handle = await page.evaluateHandle((needle) => {
    const labelNode = [...document.querySelectorAll('*')].find(
      (node) => node.children.length === 0 && node.textContent.trim() === needle,
    )
    if (labelNode === undefined) throw new Error(`ラベルが見つかりません: ${needle}`)
    // ラベルと値は同じカードに並ぶ。カード全体を監視対象にする。
    return labelNode.closest('.q-card') ?? labelNode.parentElement
  }, label)
  return handle
}

// --- シナリオ ---------------------------------------------------------------

function targetLabel(index) {
  return `Burst ${String(index).padStart(2, '0')}`
}

function buildScenario(targets) {
  const entries = [
    {
      address: '/burst/src',
      label: SOURCE_LABEL,
      type: 's',
      widget: 'input',
      default: 'idle',
    },
  ]
  for (let index = 1; index <= targets; index += 1) {
    entries.push({
      address: `/burst/t${String(index).padStart(2, '0')}`,
      label: targetLabel(index),
      type: 's',
      widget: 'text',
      default: 'idle',
    })
  }

  return {
    projectId: PROJECT_ID,
    entries,
    staging: {
      staged: [],
      triggers: [],
      expansions: [{ source: '/burst/src', targets: ['/burst/t*'] }],
    },
  }
}

// --- 出力 -------------------------------------------------------------------

function printReport({ spans, arrivals, consoleErrors }) {
  const table = [
    ['測定項目', ...spans.map((_, index) => `${index + 1}回目`), '平均 / 備考'],
    ['---', ...spans.map(() => '---:'), '---'],
    row('UI の先頭ウィジェット反映〜最後のウィジェット反映 (ms)', spans),
    row('input 確定〜最後のウィジェット反映 (ms)', arrivals),
    [
      'ブラウザエラー / 欠落 / フリーズ',
      ...spans.map(() => (consoleErrors.length === 0 ? 'なし' : '検出')),
      consoleErrors.length === 0
        ? `なし (展開先 ${options.targets} 件を毎回確認)`
        : consoleErrors.slice(0, 3).join(' / '),
    ],
  ]

  console.log('')
  for (const line of table) console.log(`| ${line.join(' | ')} |`)
}

function row(label, values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return [label, ...values.map((value) => value.toFixed(4)), `平均 ${average.toFixed(4)}`]
}

// --- プロセス管理 -----------------------------------------------------------

async function start(name, command, args, readyPattern) {
  const child = spawn(command, args, { cwd: REPO_ROOT, shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  let stdout = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr.on('data', () => undefined)

  processes.push({ name, child })

  if (readyPattern === null) return child

  const deadline = Date.now() + 60_000
  while (!readyPattern.test(stdout)) {
    if (child.exitCode !== null) throw new Error(`${name} が ready 前に終了しました (code ${child.exitCode})`)
    if (Date.now() > deadline) throw new Error(`${name} の ready 行を待てませんでした`)
    await Promise.race([once(child.stdout, 'data'), delay(100)])
  }

  log(`${name} 起動`)
  return child
}

async function stopProcess({ name, child }) {
  if (child.exitCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore' })
    await once(killer, 'exit')
  } else {
    child.kill('SIGKILL')
  }
  log(`${name} 停止`)
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const response = await fetch(url, { redirect: 'manual' })
      if (response.status < 500) return
    } catch {
      // 起動途中は接続できない。
    }
    if (Date.now() > deadline) throw new Error(`UI が ${timeoutMs}ms 以内に応答しませんでした: ${url}`)
    await delay(200)
  }
}

async function reserveUdpPort() {
  const socket = dgram.createSocket('udp4')
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(0, '127.0.0.1', resolve)
    })
    return socket.address().port
  } finally {
    await new Promise((resolve) => socket.close(resolve))
  }
}

async function reserveTcpPort() {
  const server = net.createServer()
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    return server.address().port
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function parseArgs(argv) {
  const parsed = { runs: 3, targets: 64, headed: false, probe: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runs') {
      parsed.runs = Number(argv[index + 1])
      index += 1
    } else if (argv[index] === '--targets') {
      parsed.targets = Number(argv[index + 1])
      index += 1
    } else if (argv[index] === '--headed') {
      parsed.headed = true
    } else if (argv[index] === '--probe') {
      parsed.probe = true
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`)
    }
  }
  return parsed
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function log(message) {
  console.log(`[burst] ${message}`)
}
