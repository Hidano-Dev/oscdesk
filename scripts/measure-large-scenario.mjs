// docs/VERIFICATION.md「大規模シナリオの描画・操作計測」の自動計測。
//
// mock-unity(大規模シナリオ) / ブリッジ / NiceGUI UI を一時ポートで起動し、
// 開発用の軽量ブラウザ(Playwright 同梱 Chromium の headless)で手順 2〜4 を測る。
// ユーザーの常用ブラウザには一切触れない。
//
//   node scripts/measure-large-scenario.mjs [--runs 3] [--headed]
//
// 標準出力の末尾に docs/VERIFICATION.md へ貼れる Markdown 表を出す。

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import dgram from 'node:dgram'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'

import osc from 'osc'
import { chromium } from 'playwright'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const SCENARIO = path.join(REPO_ROOT, 'packages/mock-unity/scenarios/large-input-select.json')
const EXPECTED_ENTRIES = 324
// config/oscdesk.config.json の expectedProjectId。シナリオ側の projectId を上書きして誤接続ガードを通す。
const PROJECT_ID = 'oscdesk-demo'

const options = parseArgs(process.argv.slice(2))

const processes = []
let browser

try {
  await main()
} finally {
  if (browser !== undefined) await browser.close().catch(() => undefined)
  for (const child of processes.reverse()) await stopProcess(child).catch(() => undefined)
}

async function main() {
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
    '--scenario', SCENARIO,
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

  // NiceGUI が張る socket.io の受信フレームに時刻を打つ。select のエコーバックは
  // 表示値が変わらず DOM に痕跡が出ないため、受信フレームの到着時刻で確定を捉える。
  await context.addInitScript(() => {
    window.__oscdeskFrames = []
    const NativeWebSocket = window.WebSocket
    window.WebSocket = function (...args) {
      const socket = new NativeWebSocket(...args)
      socket.addEventListener('message', (event) => {
        const text = typeof event.data === 'string' ? event.data : `<binary ${event.data?.size ?? event.data?.byteLength ?? '?'}>`
        window.__oscdeskFrames.push({ at: performance.now(), text })
      })
      return socket
    }
    window.WebSocket.prototype = NativeWebSocket.prototype
    Object.assign(window.WebSocket, NativeWebSocket)
  })

  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(String(error)))

  const rows = {
    initialRender: [],
    expandFirst: [],
    expandMiddle: [],
    expandLast: [],
    inputEcho: [],
    selectEcho: [],
    selectApplied: [],
    selectEchoBack: [],
  }

  for (let run = 1; run <= options.runs; run += 1) {
    log(`--- 試行 ${run}/${options.runs} ---`)

    rows.initialRender.push(await measureInitialRender(page, url))

    const groups = await page.locator('.q-expansion-item').all()
    log(`グループ数: ${groups.length}`)

    rows.expandFirst.push(await measureExpand(page, 0))
    rows.expandMiddle.push(await measureExpand(page, Math.floor(groups.length / 2)))
    rows.expandLast.push(await measureExpand(page, groups.length - 1))

    rows.inputEcho.push(await measureInputEcho(page))
    const select = await measureSelectEcho(page)
    rows.selectEcho.push(select.total)
    rows.selectApplied.push(select.applied)
    rows.selectEchoBack.push(await measureSelectEchoBack(page, mockPort, run))
  }

  const groupCount = await page.locator('.q-expansion-item').count()
  const fieldCount = await page.locator('.q-field__native').count()

  printReport(rows, { groupCount, fieldCount, consoleErrors })
}

// --- 個別の計測 -------------------------------------------------------------

async function measureInitialRender(page, url) {
  const started = Date.now()
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  // ヘッダーの採用表示(件数)と、全エントリぶんの入力欄が出そろうまでを 1 回とする。
  await page.getByText(`${EXPECTED_ENTRIES} 件`).first().waitFor({ timeout: 60_000 })
  await page
    .locator('.q-field__native')
    .nth(EXPECTED_ENTRIES - 1)
    .waitFor({ state: 'attached', timeout: 60_000 })
  return Date.now() - started
}

async function measureExpand(page, index) {
  const item = page.locator('.q-expansion-item').nth(index)
  const header = item.locator('.q-expansion-item__container > .q-item').first()
  const content = item.locator('.q-expansion-item__content').first()

  // 既定で開いた状態なので、まず閉じてから「開く」を測る。
  await header.click()
  await content.waitFor({ state: 'hidden', timeout: 15_000 })

  const started = Date.now()
  await header.click()
  await content.waitFor({ state: 'visible', timeout: 15_000 })
  await content.locator('.q-field__native').first().waitFor({ timeout: 15_000 })
  return Date.now() - started
}

async function measureInputEcho(page) {
  // float の input は、確定値が Unity から返るときに数値として整形し直される。
  // 入力した文字列とエコーバック後の表示が変わるので、DOM だけで確定を捉えられる。
  const field = page.locator('.q-field').filter({ hasText: 'Slot 01 Intensity' }).first()
  const input = field.locator('input.q-field__native').first()

  // OSC の f は 32bit なので、確定値は往復すると必ず別の文字列表現で戻る
  // (例: 入力 0.870000 → エコーバック 0.8700000047683716)。
  // 表示が入力文字列から変わった時点をエコーバック確定とみなす。
  const typed = randomIntensity().toFixed(6)

  await input.click()
  await input.fill(typed)

  const handle = await input.elementHandle()
  const started = Date.now()
  await input.press('Enter')
  try {
    await page.waitForFunction(
      ([element, sent]) => element.value !== sent,
      [handle, typed],
      { timeout: 15_000 },
    )
  } catch {
    throw new Error(`input のエコーバック確定を検出できません (入力: ${typed} のまま)`)
  }
  return Date.now() - started
}

async function measureSelectEcho(page) {
  const field = page.locator('.q-select').filter({ hasText: 'Slot 01 Device' }).first()

  // フィルタなしの QSelect は input ではなく div.q-field__native に表示値を持つ。
  const current = (await field.locator('.q-field__native').first().innerText()).trim()
  const scenario = JSON.parse(fs.readFileSync(SCENARIO, 'utf8'))
  const next = scenario.optionLists.devices.find((option) => option !== current)

  await page.evaluate(() => {
    window.__oscdeskFrames.length = 0
  })

  const started = Date.now()
  await field.click()
  await page.locator('.q-menu .q-item').filter({ hasText: next }).first().click()
  const picked = Date.now()

  if (options.probe) {
    await delay(3_000)
    const frames = await page.evaluate(() => window.__oscdeskFrames.map((f) => `${Math.round(f.at)} ${f.text.slice(0, 160)}`))
    log(`probe: 選択後 3s に受信したフレーム ${frames.length} 件`)
    for (const frame of frames) log(`  ${frame}`)
  }

  // 選択した値が画面へ反映されるまで(ブラウザから見える範囲)。
  // エコーバックは同じ文字列で戻るため、この先の確定は DOM にもフレームにも
  // 痕跡が出ない。エコーバック経路そのものは measureSelectEchoBack で測る。
  await page.waitForFunction(
    ([element, expected]) => element.innerText.trim() === expected,
    [await field.locator('.q-field__native').first().elementHandle(), next],
    { timeout: 15_000 },
  )

  const finished = Date.now()
  return { total: finished - started, applied: finished - picked }
}

async function measureSelectEchoBack(page, mockPort, sequence) {
  // Unity 発の値が画面に載るまでを測る。選択肢外の値なら display-value 側の
  // 表示に切り替わるので、エコーバックの到達を DOM だけで判定できる。
  const field = page.locator('.q-select').filter({ hasText: 'Slot 01 Device' }).first()
  const native = await field.locator('.q-field__native').first().elementHandle()
  const value = `External ${sequence}`

  const packet = osc.writePacket(
    { address: '/slots/01/device', args: [{ type: 's', value }] },
    { metadata: true },
  )

  const socket = dgram.createSocket('udp4')
  try {
    const started = Date.now()
    await new Promise((resolve, reject) => {
      socket.send(Buffer.from(packet), mockPort, '127.0.0.1', (error) => (error ? reject(error) : resolve()))
    })
    await page.waitForFunction(
      ([element, expected]) => element.innerText.trim() === expected,
      [native, value],
      { timeout: 15_000 },
    )
    return Date.now() - started
  } finally {
    socket.close()
  }
}

function randomIntensity() {
  // 0.01 刻み。整形後の表示が入力文字列と必ず変わる値を選ぶ。
  return Math.round((0.05 + Math.random() * 0.9) * 100) / 100
}

// --- 出力 -------------------------------------------------------------------

function printReport(rows, meta) {
  const table = [
    ['測定項目', ...runHeaders(options.runs), '平均 / 備考'],
    ['---', ...options.runs > 0 ? Array(options.runs).fill('---:') : [], '---'],
    row('初回マニフェスト採用〜全描画完了 (ms)', rows.initialRender),
    row('グループ開閉 (先頭) (ms)', rows.expandFirst),
    row('グループ開閉 (中央) (ms)', rows.expandMiddle),
    row('グループ開閉 (末尾) (ms)', rows.expandLast),
    row('input 操作開始〜エコーバック確定 (ms)', rows.inputEcho),
    row('select 操作開始〜画面反映 (ms)', rows.selectEcho),
    row('うち 選択肢クリック〜画面反映 (ms)', rows.selectApplied),
    row('select エコーバック到達〜画面反映 (ms)', rows.selectEchoBack),
    [
      'ブラウザエラー / 欠落 / フリーズ',
      ...Array(options.runs).fill(meta.consoleErrors.length === 0 ? 'なし' : '検出'),
      meta.consoleErrors.length === 0
        ? `なし (グループ ${meta.groupCount} / 入力欄 ${meta.fieldCount})`
        : meta.consoleErrors.slice(0, 3).join(' / '),
    ],
  ]

  console.log('')
  for (const line of table) console.log(`| ${line.join(' | ')} |`)
}

function runHeaders(runs) {
  return Array.from({ length: runs }, (_, index) => `${index + 1}回目`)
}

function row(label, values) {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  return [label, ...values.map(String), `平均 ${Math.round(average)}`]
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
  const parsed = { runs: 3, headed: false, probe: false }
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--runs') {
      parsed.runs = Number(argv[index + 1])
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
  console.log(`[measure] ${message}`)
}
