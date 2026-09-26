// /sys/* プロトコルのアドレス定数。仕様は docs/UNITY_PROTOCOL.md を正とする。

export const SYS = {
    PING: '/sys/ping',
    PONG: '/sys/pong',
    STATS_REQUEST: '/sys/stats/request',
    STATS: '/sys/stats',
    MANIFEST_REQUEST: '/sys/manifest/request',
    MANIFEST: '/sys/manifest',
} as const

export const OSCDESK = {
    STATUS_REQUEST: '/oscdesk/status/request',
    STATUS: '/oscdesk/status',
    // OSC ネイティブ UI がエコーバック宛先として自分を登録する名乗り。
    HELLO: '/oscdesk/hello',
    // 自作 UI 向けのマニフェスト配信。
    MANIFEST: '/oscdesk/manifest',
    // 自作 UI からの再配信要求。
    MANIFEST_REQUEST: '/oscdesk/manifest/request',
} as const

export const OSCDESK_DIAG = {
    REQUEST: '/oscdesk/diag/request',
    SNAPSHOT: '/oscdesk/diag',
} as const

export const INTERNAL_PREFIXES = ['/sys/', '/oscdesk/'] as const

// /sys/manifest は単一 UDP データグラムで送る(docs/UNITY_PROTOCOL.md 互換性ノート)。
// RECOMMENDED は IP フラグメンテーションを避ける推奨値、PRACTICAL_LIMIT は IPv4 UDP の
// 理論上限から見た実用上限、WARNING は上限へ近づいたことを送信側が警告する閾値。
export const MANIFEST_SIZE = {
    RECOMMENDED_BYTES: 1400,
    WARNING_BYTES: 48 * 1024,
    PRACTICAL_LIMIT_BYTES: 60 * 1024,
} as const

export function isInternalAddress(address: string): boolean {
    return INTERNAL_PREFIXES.some((prefix) => address.startsWith(prefix))
}

export function isOscdeskAddress(address: string): boolean {
    return address.startsWith('/oscdesk/')
}

export const ADDRESSES = {
    SYS,
    OSCDESK,
    OSCDESK_DIAG,
} as const

export type SysAddress = (typeof SYS)[keyof typeof SYS]
export type OscdeskAddress = (typeof OSCDESK)[keyof typeof OSCDESK]
export type OscdeskDiagAddress = (typeof OSCDESK_DIAG)[keyof typeof OSCDESK_DIAG]
export type ProtocolAddress = SysAddress | OscdeskAddress | OscdeskDiagAddress

export * from './osc-types'
export * from './address-pattern'
export * from './schemas'
export * from './wire'
