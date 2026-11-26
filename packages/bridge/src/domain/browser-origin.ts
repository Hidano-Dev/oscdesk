// ブラウザから直接つなぐ WebSocket の Origin の判定(HID-461 の SPA 試作。--spa-prototype のときだけ使う)。
//
// 既定のブリッジは Origin 付きのハンドシェイクをすべて断る(D-082)。正規の UI(NiceGUI のサーバー側)は Origin を付けず、
// 付いていれば第三者のページが利用者のブラウザを踏み台にしているため。SPA はブラウザがブリッジに直接つなぐので必ず Origin が付く。
// そこで「ブリッジ自身が配ったページ」だけを通す: Origin の host:port が要求の Host と同じで、名前が IP の直書きか localhost のとき。
// - 第三者のページ(evil.example)からの接続は Origin が Host と違うので断る
// - DNS の再束縛(evil.example をこの PC の IP へ向け直す)では Origin と Host がどちらも evil.example になり一致するが、
//   名前が IP の直書きでないので断る(IP の直書きは名前を解決しないので再束縛の対象にならない。UI の network_access と同じ考え方)

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/

function isIpLiteralOrLocalhost(hostname: string): boolean {
  const name = hostname.toLowerCase()
  if (name === 'localhost') return true
  if (IPV4.test(name)) return true
  // URL は IPv6 を角括弧付きで返す
  return name.startsWith('[') && name.endsWith(']') && name.includes(':')
}

export function isSameOriginIpLiteral(origin: string, hostHeader: string | undefined): boolean {
  if (hostHeader === undefined || hostHeader === '') return false
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (!isIpLiteralOrLocalhost(parsed.hostname)) return false
  // URL は既定のポート(http の 80)を host から落とす。Host ヘッダは付けたまま届くことがあるので揃えて比べる
  const defaultPort = parsed.protocol === 'https:' ? '443' : '80'
  const normalize = (host: string) => host.toLowerCase().replace(new RegExp(`:${defaultPort}$`), '')
  return normalize(parsed.host) === normalize(hostHeader.trim())
}
