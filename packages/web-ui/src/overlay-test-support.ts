// フォークのオーバーレイのテスト(D-132・D-162)が SPA の画面を確かめるための入口。本番と同じ組み立て(createAppStores)で
// App を happy-dom の DOM に描き、偽の WebSocket にフレームを流して、送ったフレームと描き直された DOM を確かめる。
// オーバーレイはワークスペースのパッケージでないので preact を直接解決できない。描画とイベントの区切り(act)はここで包んで渡す。
// JSX を使わないのも同じ理由(オーバーレイの *.test.ts は packages/web-ui の tsconfig の外にある)。本体からは import しない
import { h, render } from 'preact'
import { act } from 'preact/test-utils'

import { App } from './app'
import { createAppStores, type AppStores } from './stores'
import { createTestLink, type FakeSocket, type FakeTimers } from './test-support'

export { wireSample } from './test-support'
// 主画面はパッド(D-170)。フォークは自分のパッドの文書を padDocumentFrame に渡して描かせる
export { STAGE_PAD, padDocumentFrame, padListFrame, padValuesFrame } from './pad-test-support'
// サーフェス定義の画面は外した(HID-491 で撤去する)。surfaceFrame を流しても何も描かれない。古いテストが import で落ちないように残す
export { STAGE_DEFINITION, surfaceFrame } from './surface-test-support'

export interface MountedSpa {
  container: HTMLElement
  stores: AppStores
  timers: FakeTimers
  /** 今の偽の WebSocket(送ったフレームは sent に溜まる)。 */
  socket(): FakeSocket
  /** ブリッジからフレームが届いたことにする(描き直しまで待つ)。 */
  receive(frame: unknown): void
  /** ページが送った、その種類のフレーム。 */
  sent(type: string): Record<string, unknown>[]
  /** クリック・入力などの操作を、描き直しまで待って行う。 */
  act(action: () => void): void
  unmount(): void
}

/** SPA を描く。テストの環境は happy-dom にする(ファイルの先頭に `// @vitest-environment happy-dom`)。 */
export function mountSpa(options: { holder?: string } = {}): MountedSpa {
  const test = createTestLink()
  const stores = createAppStores({
    link: test.link,
    notices: test.notices,
    now: test.timers.now,
    setTimer: test.timers.setTimer,
    clearTimer: test.timers.clearTimer,
    holder: options.holder ?? 'overlay-test',
  })
  const container = document.createElement('div')
  document.body.append(container)
  act(() => render(h(App, { link: test.link, notices: test.notices, ...stores }), container))
  return {
    container,
    stores,
    timers: test.timers,
    socket: test.socket,
    receive: (frame) => act(() => test.socket().receive(frame)),
    sent: (type) => test.socket().ofType(type),
    act: (action) => act(action),
    unmount: () => {
      act(() => render(null, container))
      container.remove()
    },
  }
}
