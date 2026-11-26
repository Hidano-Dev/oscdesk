// ブラウザから直接ブリッジへつなぐ接続(SPA。D-137・D-138)の判定と、断るときに出す案内。
//
// ブリッジの HTTP と WebSocket は 2 つを確かめる:
// - Host: IP アドレスの直書きと、この PC の名前(localhost・OS のホスト名・その .local)だけを受ける。DNS の再束縛
//   (攻撃者の名前 evil.example をこの PC の IP へ向け直す)では、許可された LAN のブラウザから同じオリジンとして
//   ブリッジを操作できてしまい、接続元の IP では見分けられない。ブラウザが送る Host が攻撃者の名前になることでしか
//   見分けられないので、Host を確かめる(NiceGUI 版の UI の network_access.is_expected_host と同じ規則。D-113)
// - Origin(付いているときだけ): ブリッジ自身が配ったページか。Origin の host:port が Host と同じで、Host が上の検査に
//   通るとき。第三者のページ(Origin が Host と違う)は断る。Origin の無い接続(NiceGUI 版の UI のサーバー側・curl)は
//   これまでどおり受ける
// 接続元の IP の判定(接続してよいブラウザの範囲。D-113)はこの前に ui-hub が行う。

import { isIpv4 } from './ipv4'

/** この PC を指す名前(Host で受けてよい名前)。osHostname は OS のホスト名(os.hostname())。 */
export function localHostNames(osHostname: string): ReadonlySet<string> {
  const names = new Set(['localhost'])
  const name = osHostname.trim().toLowerCase().replace(/\.$/, '')
  if (name !== '') {
    const short = name.split('.', 1)[0]
    names.add(name)
    names.add(short)
    names.add(`${short}.local`)
  }
  return names
}

/** Host ヘッダからポートを外した名前(小文字)。[IPv6]:port の角括弧も外す。 */
export function hostNameOf(header: string): string {
  const text = header.trim().toLowerCase()
  if (text.startsWith('[')) return text.slice(1).split(']', 1)[0]
  const colons = text.split(':').length - 1
  return colons === 1 ? text.split(':', 1)[0] : text
}

// 角括弧を外した IPv6 の直書き(ゾーン ID は Host に載らない)。IPv4 射影(::ffff:1.2.3.4)も含む
const IPV6_LITERAL = /^[0-9a-f:]*:[0-9a-f:]*(?:\d{1,3}(?:\.\d{1,3}){3})?$/

function isIpLiteral(name: string): boolean {
  return isIpv4(name) || (name.includes(':') && IPV6_LITERAL.test(name))
}

/** DNS の再束縛を断るための Host の検査。IP アドレスの直書きと、この PC の名前だけを受ける。 */
export function isExpectedHost(header: string | undefined, names: ReadonlySet<string>): boolean {
  if (header === undefined || header.trim() === '') return false
  const name = hostNameOf(header)
  if (isIpLiteral(name)) return true
  return names.has(name.replace(/\.$/, ''))
}

/** host:port を比べられる形にする(既定のポートは落とす。URL は落とし、Host ヘッダは付けたまま届くことがあるため)。 */
function normalizeAuthority(authority: string, protocol: 'http:' | 'https:'): string {
  const defaultPort = protocol === 'https:' ? ':443' : ':80'
  const text = authority.trim().toLowerCase()
  return text.endsWith(defaultPort) ? text.slice(0, -defaultPort.length) : text
}

/** ブリッジ自身が配ったページからの要求か(Origin の host:port が Host と同じで、Host が isExpectedHost に通る)。 */
export function isSameOriginPage(origin: string, hostHeader: string | undefined, names: ReadonlySet<string>): boolean {
  if (hostHeader === undefined || !isExpectedHost(hostHeader, names)) return false
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  return normalizeAuthority(parsed.host, parsed.protocol) === normalizeAuthority(hostHeader, parsed.protocol)
}

// 403 の本文。ブラウザでそのまま読めるよう日本語を先に、英語を後に置く(NiceGUI 版の network_access と同じ言い方)
export const FORBIDDEN_PEER_TEXT = (address: string) =>
  `このブラウザ(接続元 ${address})からは OscDesk に接続できません。`
  + 'サーバー PC の http://localhost から「ネットワーク」タブで、接続してよいブラウザの範囲を確かめてください。\n'
  + `This browser (${address}) is not in the allowed browser range of OscDesk.\n`

export const FORBIDDEN_HOST_TEXT = (host: string) =>
  `OscDesk はこの名前(${host})では開けません。http://<サーバー PC の IP アドレス>:<ポート>/ か、この PC の名前で開いてください。\n`
  + `OscDesk does not answer to this host name (${host}). Open it by the IP address of the server PC.\n`

export const FORBIDDEN_ORIGIN_TEXT =
  'ほかのサイトのページからの操作は受け付けません。OscDesk のページ(http://<サーバー PC の IP アドレス>:<ポート>/)から操作してください。\n'
  + 'OscDesk does not accept requests from pages of other sites.\n'
