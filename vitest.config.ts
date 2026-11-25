import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, defineProject } from 'vitest/config'

import { overlayVitestIncludes, resolveOverlays } from './scripts/overlays.mjs'

const exclude = ['**/node_modules/**', '**/dist/**', '**/.git/**']

// フォークのオーバーレイ(oscdesk.overlays.json)のテストを機構のテストと同じ入口で走らせる(D-132)
const overlays = overlayVitestIncludes(resolveOverlays(dirname(fileURLToPath(import.meta.url))))

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      defineProject({
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'tests/guards/**/*.test.ts', 'tests/scripts/**/*.test.ts', ...overlays.unit],
          // オーバーレイの tests/ の *.e2e.test.ts は *.test.ts にも当たる。e2e は直列の設定で 1 回だけ走らせる
          exclude: [...exclude, '**/*.e2e.test.ts'],
        },
      }),
      defineProject({
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.e2e.test.ts', ...overlays.e2e],
          exclude,
          fileParallelism: false,
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
          testTimeout: 120000,
          hookTimeout: 120000,
        },
      }),
    ],
  },
})
