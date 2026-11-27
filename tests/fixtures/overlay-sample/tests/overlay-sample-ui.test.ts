// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest'

import { mountSpa, padDocumentFrame, padListFrame } from '../../../../packages/web-ui/src/overlay-test-support'

// フォークのオーバーレイ(D-132)の画面のテストの見本(D-162・D-170)。パッドの文書を読み込ませて画面に出る・操作で送るフレームを
// 確かめる。tests/scripts/overlays.test.ts が OSCDESK_OVERLAYS でこのディレクトリを指して、unit のプロジェクトで走ることを確かめる
afterEach(() => {
  document.body.innerHTML = ''
})

test('overlay sample ui test runs', () => {
  const spa = mountSpa()
  // パッドはふつうブリッジが配る(ここでは見本のパッド)。フォークは自分のパッドの JSON を読んで padDocumentFrame に渡す
  spa.receive(padListFrame())
  spa.receive(padDocumentFrame())
  expect(spa.container.textContent).toContain('Fire')

  const fire = spa.container.querySelector<HTMLElement>('[data-widget="fire"]')
  expect(fire).not.toBeNull()
  // ボタンは押し下げ(pointerdown)で送る
  spa.act(() => fire?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })))
  expect(spa.sent('osc.padPress').at(-1)).toMatchObject({ button: 'fire' })
  spa.unmount()
})
