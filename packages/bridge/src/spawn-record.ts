import { isValidSpawnName, SPAWN_RECORD, type SurfaceParameter } from '@oscdesk/shared'

import type { PersistedSpawn } from './desired-values'

// 生成の記録(HID-385・D-115)。生成担当へ送った生成の命令を送り先の PC(host)ごとに持ち、PC が起動したとき・
// 「記録に合わせる」で送り直す。名前の割り当てもここで 1 か所で行う(複数のブラウザから同時に生成しても重ならないように)。
// 純粋なロジックで、送信・設計図・到達性は呼び出し側(surface-core)が引数で渡す。
//
// 生成担当の命令の形は受け口の OscSpawner(HID-382)に合わせる:
//   /パッケージ名/対象名/spawn ,s "名前"   → 生成したものは /パッケージ名/<名前>/… で受ける
//   /パッケージ名/対象名/destroy ,s "名前" → 消す

export type SpawnCommand = 'spawn' | 'destroy'

/** 定義のパラメータが生成担当の命令か。アドレスが /spawn か /destroy で終わる s の trigger だけ(受け口の契約に合わせる) */
export function spawnCommandOf(parameter: Pick<SurfaceParameter, 'kind' | 'type' | 'address'>): SpawnCommand | null {
  if (parameter.kind !== 'trigger' || parameter.type !== 's') return null
  if (spawnerPackage(parameter.address) === null) return null
  if (parameter.address.endsWith('/spawn')) return 'spawn'
  if (parameter.address.endsWith('/destroy')) return 'destroy'
  return null
}

/** 生成担当のアドレス(/パッケージ名/対象名/spawn|destroy)のパッケージ名。形が違えば null */
export function spawnerPackage(address: string): string | null {
  const segments = address.split('/')
  // ['', パッケージ名, 対象名, spawn|destroy]
  if (segments.length !== 4 || segments[0] !== '' || segments.slice(1).some(segment => segment === '')) return null
  return segments[1]!
}

/** 生成担当(/…/spawn と /…/destroy の組)を表す、末尾の命令を除いたアドレス */
export function spawnerOf(address: string): string {
  return address.slice(0, address.lastIndexOf('/'))
}

/** 生成したものが受けるアドレスの接頭辞(/パッケージ名/<名前>/) */
export function spawnedPrefix(packageName: string, name: string): string {
  return `/${packageName}/${name}/`
}

/** 設計図の項目のアドレス /パッケージ名/<名前>/… から、パッケージ名と名前を取り出す */
export function spawnedNameOf(itemAddress: string): { packageName: string; name: string } | null {
  const segments = itemAddress.split('/')
  if (segments.length < 4 || segments[0] !== '' || segments[1] === '' || segments[2] === '') return null
  return { packageName: segments[1]!, name: segments[2]! }
}

// 名前の末尾の番号。値に番号が付いていればそのまま使い、無ければ空いている番号を振る
const NUMBERED = /^(.*?)(\d+)$/u

/** 名前の番号を除いた部分(spark12 → spark)。番号が無ければそのまま */
export function spawnBase(name: string): string {
  const matched = NUMBERED.exec(name)
  return matched === null || matched[1] === '' ? name : matched[1]!
}

export type SpawnEntry = PersistedSpawn

export interface SpawnRecordDeps {
  now?: () => number
  /** 消した名前・送ったがまだ記録の無い名前を、ほかの生成に使わずに取っておく時間 */
  reserveMs?: number
}

export interface SpawnReconcilePlan {
  /** 記録にあって、その PC の設計図に無いもの(生成し直す) */
  missing: SpawnEntry[]
  /** その PC の設計図にあって、記録に無いもの(消す)。destroyAddress へ name を送る */
  extras: { destroyAddress: string; name: string }[]
  /** 止まっている間にほかの PC で消された印があり、欠けていたので記録から外したもの */
  dropped: SpawnEntry[]
}

export interface SpawnRecord {
  entries(): SpawnEntry[]
  forHost(host: string): SpawnEntry[]
  /**
   * 生成の名前を決めて予約する。value に番号が付いていれば(spark3)そのまま使い、無ければ(spark)設計図・記録・予約の
   * どれにも無い最小の番号を振る(spark1, spark2, …)。usedInBlueprints はパッケージ名と名前がどの PC の設計図にあるか
   */
  allocate(spawnAddress: string, value: string, usedInBlueprints: (packageName: string, name: string) => boolean): string
  /** 生成の命令を送った。送り先の PC ごとに 1 件ずつ記録する(同じものは重ねない) */
  recordSpawn(param: string, spawnAddress: string, name: string, hosts: readonly string[]): void
  /** 消す命令を送った。送った PC の記録から外す。外したものがあれば true */
  recordDestroy(destroyAddress: string, name: string, hosts: readonly string[]): boolean
  /**
   * その PC から設計図の削除通知が来た。その PC の記録から外し、同じものを記録しているほかの PC のうち止まっている
   * (isDown)ものには「ほかの PC で消された」印を付ける。変わったら true
   */
  catalogRemoved(host: string, itemAddress: string, isDown: (host: string) => boolean): boolean
  /** その PC の設計図にそのものが現れた(生きていて持っている)。「ほかの PC で消された」印を外す。変わったら true */
  catalogSeen(host: string, itemAddress: string): boolean
  /**
   * その PC が起動した。印の付いたもの(止まっている間にほかの PC で消された)は記録から外して dropped に、
   * 残りを restore に返す(呼び出し側が生成し直す)
   */
  takeRestore(host: string): { restore: SpawnEntry[]; dropped: SpawnEntry[] }
  /**
   * 「記録に合わせる」の差分。items はその PC の設計図の項目のアドレス(設計図が無ければ null で、記録のすべてを欠けている
   * とみなす)。spawners は生成担当の spawn のアドレスと、その生成担当が振る名前の番号を除いた部分(余分なものの判定に使う)
   */
  reconcile(host: string, items: readonly string[] | null, spawners: readonly { address: string; bases: readonly string[] }[]): SpawnReconcilePlan
  /** keep が false の PC の記録を消す(送り先の一覧から外した PC)。消したものがあれば true */
  retainHosts(keep: (host: string) => boolean): boolean
  /** 記録を置き換える(プロジェクトの取り込み・保存ファイルからの復元) */
  replace(entries: readonly PersistedSpawn[]): void
}

const DEFAULT_RESERVE_MS = 10_000

export function createSpawnRecord(deps: SpawnRecordDeps = {}): SpawnRecord {
  const now = deps.now ?? Date.now
  const reserveMs = deps.reserveMs ?? DEFAULT_RESERVE_MS
  let list: SpawnEntry[] = []
  // パッケージ名\0名前 → 取っておく期限
  const reserved = new Map<string, number>()
  const nameKey = (packageName: string, name: string) => `${packageName}\u0000${name}`

  const packageOfEntry = (entry: SpawnEntry) => spawnerPackage(entry.address)
  const sameThing = (entry: SpawnEntry, packageName: string, name: string) => entry.name === name && packageOfEntry(entry) === packageName
  const reserve = (packageName: string, name: string) => reserved.set(nameKey(packageName, name), now() + reserveMs)
  const isReserved = (packageName: string, name: string) => {
    const until = reserved.get(nameKey(packageName, name))
    if (until === undefined) return false
    if (until > now()) return true
    reserved.delete(nameKey(packageName, name))
    return false
  }

  return {
    entries: () => list.map(entry => ({ ...entry })),
    forHost: host => list.filter(entry => entry.host === host).map(entry => ({ ...entry })),

    allocate(spawnAddress, value, usedInBlueprints) {
      const packageName = spawnerPackage(spawnAddress) ?? ''
      const used = (name: string) => usedInBlueprints(packageName, name)
        || list.some(entry => sameThing(entry, packageName, name))
        || isReserved(packageName, name)
      let name = value
      // 番号付きの値は利用者が名前を指定したものとして、そのまま使う(ぶつかれば受け口が name in use で断り、
      // 「記録に合わせる」で直せる)。番号の無い値だけを番号の振り出しにする
      if (!NUMBERED.test(value)) {
        let index = 1
        while (used(`${value}${String(index)}`)) index += 1
        name = `${value}${String(index)}`
      }
      reserve(packageName, name)
      return name
    },

    recordSpawn(param, spawnAddress, name, hosts) {
      for (const host of new Set(hosts)) {
        const held = list.find(entry => entry.host === host && entry.address === spawnAddress && entry.name === name)
        if (held !== undefined) {
          // 送り直した(同じ名前を明示して生成した)なら印は外す。送った以上、その PC にはあるべきもの
          delete held.removedElsewhere
          continue
        }
        if (list.length >= SPAWN_RECORD.MAX_ENTRIES) break
        list.push({ param, address: spawnAddress, name, host })
      }
    },

    recordDestroy(destroyAddress, name, hosts) {
      const spawner = spawnerOf(destroyAddress)
      const packageName = spawnerPackage(destroyAddress)
      if (packageName !== null) reserve(packageName, name)
      const targets = new Set(hosts)
      const before = list.length
      list = list.filter(entry => !(targets.has(entry.host) && entry.name === name && spawnerOf(entry.address) === spawner))
      return list.length !== before
    },

    catalogRemoved(host, itemAddress, isDown) {
      const spawned = spawnedNameOf(itemAddress)
      if (spawned === null) return false
      const matching = (entry: SpawnEntry) => sameThing(entry, spawned.packageName, spawned.name)
      const before = list.length
      list = list.filter(entry => !(entry.host === host && matching(entry)))
      let changed = list.length !== before
      // ほかの PC は基準ではなく、意図して消されたことの証拠として使う。止まっている PC にだけ印を付け、
      // 起動して戻ったときに復元しない。動いている PC はそのものを持ったまま(その PC の削除通知で外れる)
      for (const entry of list) {
        if (entry.host !== host && matching(entry) && entry.removedElsewhere !== true && isDown(entry.host)) {
          entry.removedElsewhere = true
          changed = true
        }
      }
      return changed
    },

    catalogSeen(host, itemAddress) {
      const spawned = spawnedNameOf(itemAddress)
      if (spawned === null) return false
      let changed = false
      for (const entry of list) {
        if (entry.host === host && entry.removedElsewhere === true && sameThing(entry, spawned.packageName, spawned.name)) {
          delete entry.removedElsewhere
          changed = true
        }
      }
      return changed
    },

    takeRestore(host) {
      const restore: SpawnEntry[] = []
      const dropped: SpawnEntry[] = []
      list = list.filter(entry => {
        if (entry.host !== host) return true
        if (entry.removedElsewhere === true) {
          dropped.push({ ...entry })
          return false
        }
        restore.push({ ...entry })
        return true
      })
      return { restore, dropped }
    },

    reconcile(host, items, spawners) {
      const present = new Set<string>()
      for (const address of items ?? []) {
        const spawned = spawnedNameOf(address)
        if (spawned !== null) present.add(nameKey(spawned.packageName, spawned.name))
      }
      const isPresent = (entry: SpawnEntry) => items !== null && present.has(nameKey(packageOfEntry(entry) ?? '', entry.name))
      // 止まっている間にほかの PC で消された印のあるもの(起動の合図を取りこぼした PC)は、欠けていれば復元せずに外す。
      // 持っていれば(設計図にあれば)生きているので印だけを外す
      const dropped: SpawnEntry[] = []
      list = list.filter(entry => {
        if (entry.host !== host || entry.removedElsewhere !== true) return true
        if (isPresent(entry)) {
          delete entry.removedElsewhere
          return true
        }
        dropped.push({ ...entry })
        return false
      })
      const mine = list.filter(entry => entry.host === host)
      const missing = mine.filter(entry => !isPresent(entry)).map(entry => ({ ...entry }))
      // 余分なもの: その PC の設計図にある /パッケージ名/<名前>/ のうち、名前がその生成担当の振る形(番号を除いた部分 +
      // 番号)で、その PC の記録に無いもの。シーンに最初からある対象(番号の付かない名前・別の名前)は消さない
      const extras: SpawnReconcilePlan['extras'] = []
      const seen = new Set<string>()
      for (const key of present) {
        const [packageName, name] = key.split('\u0000') as [string, string]
        if (!NUMBERED.test(name) || seen.has(key)) continue
        if (mine.some(entry => sameThing(entry, packageName, name))) continue
        const spawner = spawners.find(candidate => spawnerPackage(candidate.address) === packageName
          && candidate.bases.includes(spawnBase(name)))
        if (spawner === undefined) continue
        seen.add(key)
        extras.push({ destroyAddress: `${spawnerOf(spawner.address)}/destroy`, name })
      }
      return { missing, extras, dropped }
    },

    retainHosts(keep) {
      const before = list.length
      list = list.filter(entry => keep(entry.host))
      return list.length !== before
    },

    replace(entries) {
      list = entries
        .filter(entry => isValidSpawnName(entry.name) && spawnerPackage(entry.address) !== null)
        .slice(0, SPAWN_RECORD.MAX_ENTRIES)
        .map(entry => ({
          param: entry.param, address: entry.address, name: entry.name, host: entry.host,
          ...(entry.removedElsewhere === true ? { removedElsewhere: true as const } : {}),
        }))
      reserved.clear()
    },
  }
}
