// ネットワークのタブ(D-113・D-153)の純粋な部品。NiceGUI 版の network_panel.py / network_access.py から、画面の文と
// 入力欄の出し入れだけを移した。CIDR の読み方・接続してよいかの判定・締め出しの検査はブリッジだけが行う
// (packages/bridge/src/adapters/network-settings.ts)。ここに写しを持つと、ブリッジと食い違ったときに画面の予告と
// 実際の判定がずれるため(D-153)

import { NETWORK_SETTINGS } from '@oscdesk/shared'

import type { FrameOf } from './bridge-link'

export type NetworkSettingsFrame = FrameOf<'networkSettings'>

/** 入力欄の値。interface の '' は「すべてのネットワーク」(送るときは null)。 */
export interface NetworkInputs {
  readonly targetInterface: string
  readonly targetRanges: string
  readonly allowedBrowsers: string
}

export const ALL_INTERFACES = ''
/** 「すべて許可」で入れる範囲(ブリッジが保存していない間の既定と同じ)。 */
export const ALLOW_ALL: readonly string[] = ['0.0.0.0/0', '::/0']

export const SOURCE_LABELS: Record<NetworkSettingsFrame['source'], string> = {
  default: '保存していません(既定のまま)',
  saved: '保存済み',
  unsaved: 'ファイルへ書けなかったため、ブリッジを止めるまでだけ効いています',
}

/** ブリッジの設定を入力欄の形にする。 */
export function inputsOf(frame: NetworkSettingsFrame): NetworkInputs {
  return {
    targetInterface: frame.targetInterface ?? ALL_INTERFACES,
    targetRanges: frame.targetRanges.join('\n'),
    allowedBrowsers: frame.allowedBrowsers.join('\n'),
  }
}

export function sameInputs(a: NetworkInputs, b: NetworkInputs): boolean {
  return a.targetInterface === b.targetInterface && a.targetRanges === b.targetRanges && a.allowedBrowsers === b.allowedBrowsers
}

/** 入力欄の文字列を項目に分ける(改行・カンマ・空白区切り。空は捨て、重なりは先の 1 つだけ残す)。 */
export function splitEntries(text: string): string[] {
  const entries: string[] = []
  for (const part of text.replace(/,/g, ' ').split(/\s+/)) {
    if (part !== '' && !entries.includes(part)) entries.push(part)
  }
  return entries
}

/** 「このブラウザを足す」。もう入っていれば変えない(同じ文字列かだけを見る。範囲に入るかはブリッジが判定する)。 */
export function withBrowser(text: string, address: string): string {
  const entries = splitEntries(text)
  return entries.includes(address) ? text : [...entries, address].join('\n')
}

/** ラジオの候補。今の設定と入力中の値は、候補から消えても選んだまま見せる(NIC が外れた・DHCP で変わった)。 */
export function interfaceOptions(frame: NetworkSettingsFrame, inputs: NetworkInputs): { value: string; label: string }[] {
  const options = [{ value: ALL_INTERFACES, label: 'すべてのネットワーク' }]
  for (const choice of frame.interfaces) {
    if (!options.some((option) => option.value === choice.address)) options.push({ value: choice.address, label: `${choice.name} (${choice.address})` })
  }
  for (const value of [frame.targetInterface ?? ALL_INTERFACES, inputs.targetInterface]) {
    if (!options.some((option) => option.value === value)) options.push({ value, label: value })
  }
  return options
}

export type BuiltSettings =
  | { ok: true; targetInterface: string | null; targetRanges: string[]; allowedBrowsers: string[] }
  | { ok: false; message: string }

/**
 * 入力欄から送る値を作る。件数と 1 項目の長さだけを先に確かめる(shared のスキーマの上限。超えるとスキーマが送信を断り、
 * 利用者には理由が分からないため)。CIDR として読めるかはブリッジが確かめ、断られたら理由が通知に出る
 */
export function buildSettings(inputs: NetworkInputs): BuiltSettings {
  const targetRanges = splitEntries(inputs.targetRanges)
  const allowedBrowsers = splitEntries(inputs.allowedBrowsers)
  if (targetRanges.length > NETWORK_SETTINGS.MAX_TARGET_RANGES) {
    return { ok: false, message: `ターゲットがいる範囲は ${String(NETWORK_SETTINGS.MAX_TARGET_RANGES)} 件までです` }
  }
  if (allowedBrowsers.length > NETWORK_SETTINGS.MAX_ALLOWED_BROWSERS) {
    return { ok: false, message: `接続してよいブラウザの範囲は ${String(NETWORK_SETTINGS.MAX_ALLOWED_BROWSERS)} 件までです` }
  }
  const tooLong = [...targetRanges, ...allowedBrowsers].find((entry) => entry.length > NETWORK_SETTINGS.MAX_CIDR_CHARS)
  if (tooLong !== undefined) return { ok: false, message: `「${tooLong.slice(0, 20)}…」は長すぎます(CIDR かアドレスで書きます)` }
  return { ok: true, targetInterface: inputs.targetInterface === ALL_INTERFACES ? null : inputs.targetInterface, targetRanges, allowedBrowsers }
}

/** network-settings-rejected の理由(BRIDGE_PROTOCOL.md)を画面向けの文にする。知らない理由はそのまま見せる。 */
export function describeRejection(detail: string): string {
  const separator = detail.indexOf(': ')
  const reason = separator < 0 ? detail : detail.slice(0, separator)
  const value = separator < 0 ? '' : detail.slice(separator + 2)
  switch (reason) {
    case 'would-lock-out': return `この変更をすると、操作しているブラウザ(${value})が接続できなくなります`
    case 'invalid-target-interface': return `${value} はこの PC のアドレスではありません`
    case 'invalid-target-range': return `ターゲットがいる範囲「${value}」は IPv4 の CIDR(例 192.168.1.0/24)ではありません`
    case 'invalid-allowed-browser': return `接続してよい範囲「${value}」は CIDR かアドレスではありません`
    case 'rebind-failed': return `ターゲット向けのネットワークで待ち受けられませんでした(${value})`
    case 'stale-revision': return 'ほかのブラウザが先に設定を変えました。今の設定を確かめてから、もう一度保存してください'
    case 'not-allowed': return `このブラウザ(${value})は接続してよい範囲の外です`
    default: return detail
  }
}
