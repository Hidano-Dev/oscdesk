// IPv4 の 32 bit 整数表現と相互変換(宛先タブの走査とブロードキャストの判定。D-078 / D-079)。
// 整数は常に符号なし(>>> 0)で持つ。ビット演算の結果は符号付き 32 bit になり、比較が 128.x.x.x 以上で食い違うため

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

export function ipv4ToInt(value: string): number | null {
  const match = IPV4_PATTERN.exec(value)
  if (match === null) return null
  let result = 0
  for (const part of match.slice(1)) {
    const octet = Number(part)
    if (octet > 255) return null
    result = result * 256 + octet
  }
  return result >>> 0
}

export function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map(shift => String((value >>> shift) & 0xff)).join('.')
}

export function isIpv4(value: string): boolean {
  return ipv4ToInt(value) !== null
}

/** ネットマスクの接頭辞長。連続した 1 でないマスクは null。 */
export function prefixLength(maskInt: number): number | null {
  const inverted = (~maskInt) >>> 0
  // 連続した 1 のマスクなら、反転は 0…01…1 の形(+1 すると 2 のべき)
  if ((inverted & (inverted + 1)) !== 0) return null
  return 32 - Math.round(Math.log2(inverted + 1))
}

export function maskOf(prefix: number): number {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

/** 同じネットワークにある機器の宛先として選べるアドレスか(未指定・全体ブロードキャスト・マルチキャスト・予約域を除く)。 */
export function isUnicastIpv4(value: string): boolean {
  const int = ipv4ToInt(value)
  if (int === null) return false
  const first = int >>> 24
  return int !== 0 && first !== 0 && first < 224
}
