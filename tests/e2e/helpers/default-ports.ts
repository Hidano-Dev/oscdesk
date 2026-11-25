// E2E のブリッジが既定のポートを使っていないかの判定(D-133・HID-449)。ファイルや OS に触らない純粋な部分だけを
// ここに置き、ガードテスト(tests/guards/e2e-default-ports.test.ts)から直接確かめる

/**
 * ブリッジが実際に掴む・送るポートの既定値。UI の 8080 は含めない: ブリッジは設定の `ui.port` を READY 行に
 * 写すだけで待ち受けず、E2E は UI を起動しないので、8080 のまま残っても並列のワーカーと取り合わない
 */
export const DEFAULT_BRIDGE_PORTS: ReadonlySet<number> = new Set([7080, 7090, 7091])

export interface ReadyPorts {
  wsPort: number
  oscListenPort: number
  unity?: { sendPort?: number }
}

/**
 * READY 行と、ブリッジが読んだ設定ファイルの中身から、既定のポートを使っている箇所を返す(空なら問題なし)。
 * READY 行は主の宛先しか出さないので、副の宛先(`unity.secondary[].sendPort`)は設定から読む。ベースの設定を
 * 写して副の宛先を足したテストで 7090/7091 を書き換え忘れると、開発機の実 Unity や別のブリッジへ ping が届く
 */
export function findDefaultPorts(ready: ReadyPorts, config: unknown): string[] {
  const used: string[] = []
  const check = (label: string, port: unknown) => {
    if (typeof port === 'number' && DEFAULT_BRIDGE_PORTS.has(port)) used.push(`${label}=${port}`)
  }
  check('wsPort', ready.wsPort)
  check('oscListenPort', ready.oscListenPort)
  check('unity.sendPort', ready.unity?.sendPort)
  for (const [index, target] of secondaryTargets(config).entries()) {
    const name = typeof target.name === 'string' ? target.name : String(index)
    check(`unity.secondary[${name}].sendPort`, target.sendPort)
  }
  return used
}

function secondaryTargets(config: unknown): Record<string, unknown>[] {
  if (!isRecord(config) || !isRecord(config.unity)) return []
  const secondary = config.unity.secondary
  return Array.isArray(secondary) ? secondary.filter(isRecord) : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
