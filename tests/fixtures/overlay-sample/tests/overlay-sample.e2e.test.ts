import { expect, test } from 'vitest'

import { connectWsE2eClient, startStack } from '../../../e2e/helpers'

// フォークのオーバーレイ(D-132)の E2E の見本。E2E の補助を入口(tests/e2e/helpers/index.ts)から import できることだけを確かめ、
// プロセスは起動しない(tests/scripts/overlays.test.ts から e2e のプロジェクトで走らせる)
test('overlay sample e2e test runs', () => {
  expect(typeof startStack).toBe('function')
  expect(typeof connectWsE2eClient).toBe('function')
})
