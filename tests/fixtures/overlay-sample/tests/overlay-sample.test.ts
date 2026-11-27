import { expect, test } from 'vitest'

import { PadDocumentSchema } from '../../../../packages/shared/src'

// フォークのオーバーレイ(D-132)の見本。tests/scripts/overlays.test.ts が OSCDESK_OVERLAYS でこのディレクトリを指して、
// unit のプロジェクトで走ることを確かめる。通常の pnpm test では走らない(tests/fixtures/ は include の外)
test('overlay sample unit test runs', () => {
  expect(typeof PadDocumentSchema.parse).toBe('function')
})
