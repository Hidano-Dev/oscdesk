import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { startBridge, type BridgeProcess } from './helpers/bridge'
import { reserveTcpPort, reserveUdpPort } from './helpers/ports'
import { connectWsE2eClient, type WsE2eClient } from './helpers/ws-client'

const DEFINITION = {
  format: 'oscdesk-surface',
  version: 1,
  name: 'Stage',
  parameters: [
    { id: 'master', address: '/mix/master', label: 'Master', type: 'f', kind: 'state', range: [0, 1], default: 0.5 },
  ],
  screens: [{ id: 'main', label: 'Main', children: [{ kind: 'control', param: 'master', widget: 'slider' }] }],
}

describe('surface definition storage and distribution', () => {
  let workDir: string
  let surfacesDir: string
  let bridge: BridgeProcess | undefined
  const clients: WsE2eClient[] = []

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oscdesk-e2e-surfaces-'))
    surfacesDir = path.join(workDir, 'surfaces')
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map(client => client.close().catch(() => undefined)))
    await bridge?.stop().catch(() => undefined)
    bridge = undefined
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  async function start(defaultName?: string): Promise<string> {
    const configPath = path.join(workDir, 'config.json')
    fs.writeFileSync(configPath, JSON.stringify({
      unity: { host: '127.0.0.1', sendPort: await reserveUdpPort() },
      bridge: {},
      debug: false,
      boolFallbackToInt: false,
      surfaces: { dir: surfacesDir, ...(defaultName === undefined ? {} : { defaultName }) },
    }))
    bridge = await startBridge({
      configPath,
      wsPort: await reserveTcpPort(),
      oscListenPort: await reserveUdpPort(),
      readyTimeoutMs: 30_000,
    })
    return `127.0.0.1:${String(bridge.ready.wsPort)}`
  }

  async function connect(host: string): Promise<WsE2eClient> {
    const client = await connectWsE2eClient(`ws://${host}`)
    clients.push(client)
    return client
  }

  test('a save by one client is stored, backed up on overwrite, and redistributed to every client', async () => {
    const host = await start()
    const alice = await connect(host)
    const bob = await connect(host)

    alice.send({ v: 1, type: 'surfaceSave', name: 'stage', definition: DEFINITION })
    for (const client of [alice, bob]) {
      const frame = await client.waitForFrame(candidate => candidate.type === 'surface')
      expect(frame).toMatchObject({ type: 'surface', name: 'stage', revision: 1, definition: { name: 'Stage' } })
      expect(await client.waitForFrame(candidate => candidate.type === 'surfaceList'))
        .toMatchObject({ names: ['stage'], active: 'stage' })
    }
    expect(fs.existsSync(path.join(surfacesDir, 'stage.json'))).toBe(true)

    bob.send({ v: 1, type: 'surfaceSave', name: 'stage', definition: { ...DEFINITION, name: 'Stage v2' } })
    const second = await alice.waitForFrame(candidate => candidate.type === 'surface')
    expect(second).toMatchObject({ revision: 2, definition: { name: 'Stage v2' } })
    const backups = fs.readdirSync(path.join(surfacesDir, '.backups'))
    expect(backups).toHaveLength(1)
    expect(JSON.parse(fs.readFileSync(path.join(surfacesDir, '.backups', backups[0]), 'utf8')).name).toBe('Stage')
  })

  test('a late client receives the active definition with surfaceRequest, and a load switches everyone', async () => {
    const host = await start()
    const alice = await connect(host)
    alice.send({ v: 1, type: 'surfaceSave', name: 'first', definition: DEFINITION })
    alice.send({ v: 1, type: 'surfaceSave', name: 'second', definition: { ...DEFINITION, name: 'Second' } })
    await alice.waitForFrame(candidate => candidate.type === 'surface' && candidate.name === 'second')

    const late = await connect(host)
    late.send({ v: 1, type: 'surfaceRequest' })
    expect(await late.waitForFrame(candidate => candidate.type === 'surfaceList'))
      .toMatchObject({ names: ['first', 'second'], active: 'second' })
    expect(await late.waitForFrame(candidate => candidate.type === 'surface'))
      .toMatchObject({ name: 'second', revision: 2 })

    alice.send({ v: 1, type: 'surfaceLoad', name: 'first' })
    expect(await late.waitForFrame(candidate => candidate.type === 'surface' && candidate.name === 'first'))
      .toMatchObject({ revision: 3, definition: { name: 'Stage' } })
  })

  test('an invalid definition is refused with a reason and the previous one stays active', async () => {
    const host = await start()
    const client = await connect(host)
    client.send({ v: 1, type: 'surfaceSave', name: 'stage', definition: DEFINITION })
    await client.waitForFrame(candidate => candidate.type === 'surface')

    client.send({ v: 1, type: 'surfaceSave', name: 'stage', definition: { ...DEFINITION, extra: true } })
    expect(await client.waitForFrame(candidate => candidate.type === 'notice'))
      .toMatchObject({ level: 'error', code: 'surface-rejected' })

    client.send({ v: 1, type: 'surfaceRequest' })
    expect(await client.waitForFrame(candidate => candidate.type === 'surface'))
      .toMatchObject({ name: 'stage', revision: 1, definition: { name: 'Stage' } })
  })

  test('a name that would escape the surfaces folder never reaches the disk', async () => {
    const host = await start()
    const client = await connect(host)
    client.sendRaw(JSON.stringify({ v: 1, type: 'surfaceSave', name: '../escaped', definition: DEFINITION }))
    expect(await client.waitForFrame(candidate => candidate.type === 'notice'))
      .toMatchObject({ code: 'invalid-frame', detail: 'schema-error' })
    expect(fs.existsSync(path.join(workDir, 'escaped.json'))).toBe(false)
    expect(fs.existsSync(path.join(surfacesDir, '..', 'escaped.json'))).toBe(false)
  })

  test('adopts the configured default definition at startup', async () => {
    fs.mkdirSync(surfacesDir, { recursive: true })
    fs.writeFileSync(path.join(surfacesDir, 'stage.json'), JSON.stringify(DEFINITION))
    const client = await connect(await start('stage'))
    client.send({ v: 1, type: 'surfaceRequest' })
    expect(await client.waitForFrame(candidate => candidate.type === 'surface'))
      .toMatchObject({ name: 'stage', revision: 1 })
  })

  test('starts without an active definition when the default file is invalid', async () => {
    fs.mkdirSync(surfacesDir, { recursive: true })
    fs.writeFileSync(path.join(surfacesDir, 'stage.json'), '{ broken')
    const client = await connect(await start('stage'))
    client.send({ v: 1, type: 'surfaceRequest' })
    expect(await client.waitForFrame(candidate => candidate.type === 'surfaceList'))
      .toMatchObject({ names: ['stage'], active: null })
  })

  test('HTTP download and upload share the WebSocket port', async () => {
    const host = await start()
    const client = await connect(host)

    const upload = await fetch(`http://${host}/surfaces/uploaded.json`, {
      method: 'PUT',
      body: JSON.stringify(DEFINITION),
    })
    expect(upload.status).toBe(200)
    expect(await client.waitForFrame(candidate => candidate.type === 'surface'))
      .toMatchObject({ name: 'uploaded' })

    const download = await fetch(`http://${host}/surfaces/uploaded.json`)
    expect(download.status).toBe(200)
    expect(download.headers.get('content-disposition')).toContain('uploaded.json')
    expect(await download.json()).toMatchObject({ name: 'Stage' })

    expect(await (await fetch(`http://${host}/surfaces`)).json()).toEqual({ names: ['uploaded'], active: 'uploaded' })
    expect((await fetch(`http://${host}/surfaces/missing.json`)).status).toBe(404)
    expect((await fetch(`http://${host}/surfaces/bad.json`, { method: 'PUT', body: '{' })).status).toBe(400)
    expect((await fetch(`http://${host}/surfaces/bad.json`, { method: 'PUT', body: '{"format":"x"}' })).status).toBe(422)
    expect((await fetch(`http://${host}/surfaces/CON.json`)).status).toBe(400)
    expect((await fetch(`http://${host}/elsewhere`)).status).toBe(404)
  })
})
