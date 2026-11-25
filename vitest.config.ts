import os from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, defineProject } from 'vitest/config'

import { overlayVitestIncludes, resolveOverlays } from './scripts/overlays.mjs'

const exclude = ['**/node_modules/**', '**/dist/**', '**/.git/**']

// フォークのオーバーレイ(oscdesk.overlays.json)のテストを機構のテストと同じ入口で走らせる(D-132)
const overlays = overlayVitestIncludes(resolveOverlays(dirname(fileURLToPath(import.meta.url))))

// E2E の 1 ファイルはブリッジと mock-unity の実プロセスを数本立て、ping(2 秒)や再起動待ちの時間に頼る。
// CPU を取り合うとその待ちが崩れて flake になるので、コア数の 1/4 を 2〜6 に収める(同じ PC で別の作業の
// テストも走るため上限を置く)。vitest 3 はワーカーの組を全プロジェクトで 1 つだけ作り、プロジェクトごとの
// maxForks を読まないので、上限は全体の maxWorkers に置く(unit も同じ上限になるが数秒で終わる)。
// 上書きは `--maxWorkers` か環境変数 VITEST_MAX_FORKS(D-133)
const MAX_WORKERS = Math.min(6, Math.max(2, Math.floor(os.availableParallelism() / 4)))

export default defineConfig({
  test: {
    passWithNoTests: true,
    maxWorkers: MAX_WORKERS,
    projects: [
      defineProject({
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'tests/guards/**/*.test.ts', 'tests/scripts/**/*.test.ts', ...overlays.unit],
          // オーバーレイの tests/ の *.e2e.test.ts は *.test.ts にも当たる。e2e は e2e のプロジェクトで 1 回だけ走らせる
          exclude: [...exclude, '**/*.e2e.test.ts'],
        },
      }),
      defineProject({
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.e2e.test.ts', ...overlays.e2e],
          exclude,
          // ファイルを並列のワーカーで動かす。ポートはワーカーごとの帯(tests/e2e/helpers/ports.ts)、ブリッジの
          // 作業フォルダと保管先は起動ごとの一時フォルダで分ける(D-133)
          testTimeout: 120000,
          hookTimeout: 120000,
        },
      }),
    ],
  },
})
