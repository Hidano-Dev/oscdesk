// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest'

import { mountSpa, surfaceFrame } from '../../../../packages/web-ui/src/overlay-test-support'

// フォークのオーバーレイ(D-132)の画面のテストの見本(D-161)。以前 pytest で書いていた UI のテスト
// (定義を読み込ませて画面に出る・操作で送るフレーム)は、この形で vitest に書き直す。
// tests/scripts/overlays.test.ts が OSCDESK_OVERLAYS でこのディレクトリを指して、unit のプロジェクトで走ることを確かめる
afterEach(() => {
  document.body.innerHTML = ''
})

test('overlay sample ui test runs', () => {
  const spa = mountSpa()
  // 定義はふつうブリッジが配る(ここでは見本の定義)。フォークは自分のサーフェス定義の JSON を読んで surfaceFrame に渡す
  spa.receive(surfaceFrame())
  expect(spa.container.textContent).toContain('Stage')

  const go = spa.container.querySelector<HTMLButtonElement>('[data-param="go"] button')
  expect(go).not.toBeNull()
  // trigger のボタンは押し下げ(pointerdown)で送る
  spa.act(() => go?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
  expect(spa.sent('set').at(-1)).toMatchObject({ param: 'go', value: 1 })
  spa.unmount()
})
