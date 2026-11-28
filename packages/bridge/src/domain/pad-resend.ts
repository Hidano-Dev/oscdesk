import type { DownstreamFrame, UpstreamFrame } from '@oscdesk/shared'

// 自動の再送の設定と、ターゲットの起動 ID の記録(D-165・D-169)。
// 起動はターゲットの起動 ID(pong の第 2 引数と OSCQuery の HOST_INFO の X_OSCDESK_BOOT_ID。D-164)が前に見たものから
// 変わったことで知る。ping の抜けからの回復(同じ起動 ID のまま答えが戻った)は起動とみなさない。
// 見た起動 ID はブリッジの再起動をまたいで残す(残さないと、ブリッジを起動し直すたびに動いていたターゲットを「起動した」とみなし、
// 自動の再送を入れていると勝手に送り直す)。一度も見たことのないターゲットの最初の起動 ID は起動とみなす(ブリッジより後に
// 立ち上がったターゲット。切り分けられないので、利用者が自動の再送を選んだ意図に沿って送る)。
// 起動の同期は最大で数秒かかる(段に分けて送る)。起動 ID は同期を始める前に記録するので、途中でブリッジを閉じると
// 再起動後は同期済みとみなして残りを送らない。そこで終わっていない起動の同期の送り先も残し(HID-499)、再起動後に同じ起動 ID で
// 答えたら一度だけ起動とみなしてやり直す。送り終えた同期は記録から外すので、正常に終わった同期は再起動で繰り返さない。

type ClientId = string
type LogFn = (message?: unknown, ...optionalParams: unknown[]) => void

/** 起動 ID の形。受け口は GUID を載せる。印字できる ASCII の 64 文字までだけを受ける(HOST_INFO と同じ上限) */
export const BOOT_ID_PATTERN = /^[\x21-\x7e]{1,64}$/
/** 覚えておくターゲットの数。ブロードキャストの宛先は答えた PC ごとに覚えるので、LAN の 1 つのネットワークを収める数にする */
export const MAX_BOOT_IDS = 256

/** 起動 ID の記録の印(送り先の host:port)。pong・HOST_INFO の記録と同期の記録で同じ印を使う */
export function resendTargetKey(to: { host: string; port: number }): string {
  return `${to.host}:${String(to.port)}`
}

export interface PadResendState {
  auto: boolean
  boots: { target: string; bootId: string }[]
  /** 起動の同期を始めて、まだ送り終えていない送り先(boots の target)。省略は空 */
  unfinished?: string[]
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
  /**
   * 起動の同期を始めた(observeBoot が true を返した送り先へ)。送り終えるまで記録に残し、途中でブリッジを閉じたら
   * 再起動後に同じ起動 ID を見たときにやり直す
   */
  syncStarted(target: string): void
  /** その送り先への同期(起動・手動を問わない)を送り終えた。終わっていない起動の同期の記録を外す */
  syncFinished(target: string): void
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
  // 終わっていない起動の同期の送り先(保存する)。起動 ID を覚えていない送り先は持たない(やり直しの判定は起動 ID で行う)
  const unfinished = new Set((loaded?.unfinished ?? []).filter(target => boots.has(target)))
  // 前の起動から持ち越した、やり直す送り先(保存しない)。同じ起動 ID の答えで一度だけ起動とみなす(この起動の中で始めた同期は、
  // 同じ起動 ID の pong が続いても始め直さない。次の pong のたびに同期を始めると、大きなパッドの同期が終わらない)
  const retry = new Set(unfinished)

  const save = () => deps.store?.save({
    auto,
    boots: [...boots].map(([target, bootId]) => ({ target, bootId })),
    ...(unfinished.size > 0 ? { unfinished: [...unfinished] } : {}),
  })
  const frame = (): DownstreamFrame => ({ v: 1, type: 'osc.padResend', auto })

  return {
    isAuto: () => auto,
    observeBoot(target, bootId) {
      if (!BOOT_ID_PATTERN.test(bootId)) return false
      const previous = boots.get(target)
      if (previous === bootId) {
        if (!retry.delete(target)) return false
        if (!auto) {
          // 自動の再送を切ってからブリッジを起動し直した。やり直さず、記録も外す
          unfinished.delete(target)
          save()
          return false
        }
        logInfo('(INFO, BRIDGE)', `Target ${target} answered with boot id ${bootId}; resuming the startup sync left unfinished when the bridge stopped.`)
        return true
      }
      retry.delete(target)
      // 新しい起動の同期は始めるときに記録し直す(自動の再送を切っていれば始めないので、前の起動の記録は要らない)
      unfinished.delete(target)
      boots.delete(target)
      boots.set(target, bootId)
      while (boots.size > MAX_BOOT_IDS) {
        const oldest = boots.keys().next().value as string
        boots.delete(oldest)
        unfinished.delete(oldest)
        retry.delete(oldest)
      }
      save()
      logInfo('(INFO, BRIDGE)', previous === undefined
        ? `Target ${target} answered with boot id ${bootId} for the first time.`
        : `Target ${target} started (boot id ${previous} -> ${bootId}).`)
      return true
    },
    syncStarted(target) {
      if (!boots.has(target) || unfinished.has(target)) return
      unfinished.add(target)
      save()
    },
    syncFinished(target) {
      retry.delete(target)
      if (!unfinished.delete(target)) return
      save()
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
