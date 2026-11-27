import type { DownstreamFrame, UpstreamFrame } from '@oscdesk/shared'

// 自動の再送の設定と、ターゲットの起動 ID の記録(D-165・D-169)。
// 起動はターゲットの起動 ID(pong の第 2 引数と OSCQuery の HOST_INFO の X_OSCDESK_BOOT_ID。D-164)が前に見たものから
// 変わったことで知る。ping の抜けからの回復(同じ起動 ID のまま答えが戻った)は起動とみなさない。
// 見た起動 ID はブリッジの再起動をまたいで残す(残さないと、ブリッジを起動し直すたびに動いていたターゲットを「起動した」とみなし、
// 自動の再送を入れていると勝手に送り直す)。一度も見たことのないターゲットの最初の起動 ID は起動とみなす(ブリッジより後に
// 立ち上がったターゲット。切り分けられないので、利用者が自動の再送を選んだ意図に沿って送る)。

type ClientId = string
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

/** 起動 ID の形。受け口は GUID を載せる。印字できる ASCII の 64 文字までだけを受ける(HOST_INFO と同じ上限) */
export const BOOT_ID_PATTERN = /^[\x21-\x7e]{1,64}$/
/** 覚えておくターゲットの数。ブロードキャストの宛先は答えた PC ごとに覚えるので、LAN の 1 つのネットワークを収める数にする */
export const MAX_BOOT_IDS = 256

export interface PadResendState {
  auto: boolean
  boots: { target: string; bootId: string }[]
}

/** 設定の保存先。ファイルでの実装は adapters/pad-resend-file */
export interface PadResendStore {
  load(): PadResendState | null
  save(state: PadResendState): void
}

export interface PadResendSettings {
  isAuto(): boolean
  /**
   * 受けた起動 ID を記録し、起動(前に見た起動 ID からの変化か、初めて見たターゲット)なら true。
   * target は送り先の PC の印(host:port)。形の合わない起動 ID は記録せず false
   */
  observeBoot(target: string, bootId: string): boolean
  /** osc.padResendSet なら処理して true */
  handleUiFrame(frame: UpstreamFrame, clientId: ClientId): boolean
  publish(clientId?: ClientId): void
}

export function createPadResendSettings(deps: {
  store?: PadResendStore
  publish: (frame: DownstreamFrame, target?: ClientId) => void
  logInfo?: LogFn
}): PadResendSettings {
  const logInfo = deps.logInfo ?? console.info
  const loaded = deps.store?.load() ?? null
  let auto = loaded?.auto ?? false
  // 挿入順を新しさの順に使う(見直したら入れ直す)。上限を超えたら一番古いものから忘れる
  const boots = new Map<string, string>()
  for (const entry of (loaded?.boots ?? []).slice(-MAX_BOOT_IDS)) boots.set(entry.target, entry.bootId)

  const save = () => deps.store?.save({ auto, boots: [...boots].map(([target, bootId]) => ({ target, bootId })) })
  const frame = (): DownstreamFrame => ({ v: 1, type: 'osc.padResend', auto })

  return {
    isAuto: () => auto,
    observeBoot(target, bootId) {
      if (!BOOT_ID_PATTERN.test(bootId)) return false
      const previous = boots.get(target)
      if (previous === bootId) return false
      boots.delete(target)
      boots.set(target, bootId)
      while (boots.size > MAX_BOOT_IDS) boots.delete(boots.keys().next().value as string)
      save()
      logInfo('(INFO, BRIDGE)', previous === undefined
        ? `Target ${target} answered with boot id ${bootId} for the first time.`
        : `Target ${target} started (boot id ${previous} -> ${bootId}).`)
      return true
    },
    handleUiFrame(uiFrame) {
      if (uiFrame.type !== 'osc.padResendSet') return false
      if (uiFrame.auto !== auto) {
        auto = uiFrame.auto
        save()
        logInfo('(INFO, BRIDGE)', `Automatic resend of pad values ${auto ? 'enabled' : 'disabled'} by UI request.`)
      }
      // 変わらなくても全 UI へ配る(別の画面が古い表示のまま押したときに揃える)
      deps.publish(frame())
      return true
    },
    publish(clientId) {
      deps.publish(frame(), clientId)
    },
  }
}
