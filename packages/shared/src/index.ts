// /sys/* プロトコルのアドレス定数。仕様は docs/UNITY_PROTOCOL.md を正とする。

export const SYS = {
    PING: '/sys/ping',
    PONG: '/sys/pong',
    // 受けたが処理しなかったものの任意の報告(D-105)。Unity → OscDesk。UI へは流さない
    IGNORED: '/sys/ignored',
    FAILED: '/sys/failed',
    // 同期の合図(D-169)。OscDesk → Unity。保持値を送り直す前に begin(先頭の s は契機 boot / manual)、送り終えたら end
    SYNC_BEGIN: '/sys/sync/begin',
    SYNC_END: '/sys/sync/end',
} as const

/** 同期の合図の契機(/sys/sync/begin の先頭の s。D-169)。boot は起動で送り直す自動の再送、manual は手動の同期 */
export const SYNC_REASONS = ['boot', 'manual'] as const
export type SyncReason = (typeof SYNC_REASONS)[number]

export const OSCDESK = {
    STATUS_REQUEST: '/oscdesk/status/request',
    STATUS: '/oscdesk/status',
    // OSC ネイティブ UI がエコーバック宛先として自分を登録する名乗り。
    HELLO: '/oscdesk/hello',
} as const

export const OSCDESK_DIAG = {
    REQUEST: '/oscdesk/diag/request',
    SNAPSHOT: '/oscdesk/diag',
} as const

export const INTERNAL_PREFIXES = ['/sys/', '/oscdesk/'] as const

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
export * from './limits'
export * from './schemas'
export * from './wire'
export * from './osc-pad'
export * from './pad-document'
export * from './pad-migration'
export * from './pad-repair'
export * from './pad-from-node'
export * from './pad-document-edit'
export * from './project-file'
export * from './oscquery'
