import { describe, expect, it } from 'vitest'

import { findDefaultPorts, findDefaultPortsInConfig } from '../e2e/helpers/default-ports'

// E2E のブリッジが既定のポートで起動したら startBridge が落とす(D-133)。副の宛先は READY 行に出ないので
// 設定から読む(HID-449)。ここが緩むと、書き換え忘れた副の宛先から開発機の実 Unity や別のブリッジへ ping が届く
describe('e2e default-port check (D-133, HID-449)', () => {
  const ready = { wsPort: 20001, oscListenPort: 20002, unity: { sendPort: 20003 } }

  it('passes when no port is a default one', () => {
    const config = { unity: { host: '127.0.0.1', sendPort: 20003, secondary: [{ name: 'backup', host: '127.0.0.1', sendPort: 20004 }] } }
    expect(findDefaultPorts(ready, config)).toEqual([])
  })

  it('reports the primary ports from the READY line', () => {
    expect(findDefaultPorts({ wsPort: 7080, oscListenPort: 7091, unity: { sendPort: 7090 } }, {})).toEqual([
      'wsPort=7080',
      'oscListenPort=7091',
      'unity.sendPort=7090',
    ])
  })

  it.each([7090, 7091, 7080])('reports a secondary target left on %i', (port) => {
    const config = { unity: { secondary: [{ name: 'ok', sendPort: 20004 }, { name: 'backup', sendPort: port }] } }
    expect(findDefaultPorts(ready, config)).toEqual([`unity.secondary[backup].sendPort=${port}`])
  })

  it('reports an OSC UI static peer left on a default port', () => {
    const config = { oscUi: { enabled: true, staticPeers: [{ host: '127.0.0.1', port: 20005 }, { host: '127.0.0.1', port: 7091 }] } }
    expect(findDefaultPorts(ready, config)).toEqual(['oscUi.staticPeers[1].port=7091'])
  })

  // 無効な OSC UI はルーターを作らず固定の宛先へ送らないので、既定のポートが残っていても落とさない(HID-457)
  it.each([{ enabled: false }, {}])('ignores static peers while OSC UI is not enabled (%j)', (flags) => {
    const config = { oscUi: { ...flags, staticPeers: [{ host: '127.0.0.1', port: 7091 }] } }
    expect(findDefaultPorts(ready, config)).toEqual([])
  })

  // startBridge は起動前に設定だけで決まる送り先を確かめる(ブリッジは READY 行の前に送り始める)
  it('checks the config-only destinations without a READY line', () => {
    const config = { unity: { sendPort: 7090, secondary: [{ name: 'backup', sendPort: 7090 }] } }
    // 主の宛先は起動引数で上書きされ得るので、起動前の検査には含めない(READY 行で確かめる)
    expect(findDefaultPortsInConfig(config)).toEqual(['unity.secondary[backup].sendPort=7090'])
  })

  // UI のポートはブリッジが待ち受けない(READY 行に写すだけ)ので対象にしない
  it('ignores the UI port', () => {
    expect(findDefaultPorts({ ...ready, uiPort: 8080 } as typeof ready, { ui: { port: 8080 } })).toEqual([])
  })

  it.each([undefined, null, [], { unity: null }, { unity: { secondary: 'x' } }])('tolerates a config without secondary targets (%j)', (config) => {
    expect(findDefaultPorts(ready, config)).toEqual([])
  })
})
