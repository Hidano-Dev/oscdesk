// 右の列(送信先と OSC パッドの Inspector の共用。D-091・D-159)の幅の規則。NiceGUI 版の page.py(ASIDE_RESIZE_JS)と同じ
// 上下限と保存のしかたにする。幅はこのブラウザにだけ覚える(端末ごとの画面の広さに合わせる好みで、他の端末と共有するものではない)

/** 覚えた幅の保存キー(NiceGUI 版と同じ名前。オリジンが違えば別に覚える)。 */
export const ASIDE_WIDTH_KEY = 'oscdesk.asideWidth'
/** 右の列の最小の幅。 */
export const ASIDE_MIN = 260
/** 本体(左の列)に残す幅。右の列を広げても本体の部品が潰れないように */
export const MAIN_MIN = 360
/** つまみの幅(app.css の .app-body の列と同じ値)。上限は本体とつまみの分を残す */
export const HANDLE_WIDTH = 12
/** 覚えた幅が無いときの幅(つまみを足す前の SPA の右の列の幅のまま)。 */
export const ASIDE_DEFAULT = 380
/** キーボード(矢印キー)で 1 回に変える幅。 */
export const ASIDE_KEY_STEP = 16

/** 保存領域のうち使うところだけ(テストで差し替える)。 */
export interface WidthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 幅を上下限に収める。上限は「本体に MAIN_MIN とつまみの幅を残す幅」で(app.css の clamp() と同じ式)、枠が狭くて上限が
 * 下限を割るときは下限にする(frameWidth は本体・つまみ・右の列を含む枠の幅)
 */
export function clampAsideWidth(width: number, frameWidth: number): number {
  const max = Math.max(ASIDE_MIN, frameWidth - MAIN_MIN - HANDLE_WIDTH)
  return Math.round(Math.min(max, Math.max(ASIDE_MIN, width)))
}

/** つまみを引いている指(ポインタ)の位置から幅を出す。右の列は枠の右端までなので、枠の右端からの距離が幅になる。 */
export function widthFromPointer(frameRight: number, clientX: number, frameWidth: number): number {
  return clampAsideWidth(frameRight - clientX, frameWidth)
}

/**
 * 覚えた幅。無い・数でない・下限より小さいときは null(既定の幅のまま)。保存領域が使えないブラウザ(プライベートウィンドウなど)では
 * 読めないだけで、つまみは動かせる
 */
export function readSavedWidth(storage: WidthStorage | null): number | null {
  if (storage === null) return null
  try {
    const saved = Number.parseFloat(storage.getItem(ASIDE_WIDTH_KEY) ?? '')
    return Number.isFinite(saved) && saved >= ASIDE_MIN ? Math.round(saved) : null
  } catch {
    return null
  }
}

export function saveWidth(storage: WidthStorage | null, width: number): void {
  if (storage === null) return
  try {
    storage.setItem(ASIDE_WIDTH_KEY, String(Math.round(width)))
  } catch {
    // 覚えられないだけで、今の画面の幅は変わっている
  }
}

/** 矢印キーで変えた幅。左の矢印は右の列を広げる(つまみが左へ動く)。ほかのキーは null。 */
export function widthFromKey(key: string, current: number, frameWidth: number): number | null {
  if (key === 'ArrowLeft') return clampAsideWidth(current + ASIDE_KEY_STEP, frameWidth)
  if (key === 'ArrowRight') return clampAsideWidth(current - ASIDE_KEY_STEP, frameWidth)
  if (key === 'Home') return clampAsideWidth(ASIDE_MIN, frameWidth)
  if (key === 'End') return clampAsideWidth(Number.POSITIVE_INFINITY, frameWidth)
  return null
}

/** window.localStorage。アクセスするだけで例外になるブラウザがあるので、ここで受けて null にする。 */
export function browserStorage(): WidthStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}
