import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const project = join(repositoryRoot, 'tests', 'csharp-core', 'OscDesk.CoreCheck.csproj')

const probe = spawnSync('dotnet', ['--version'], { stdio: 'ignore' })
if (probe.error || probe.status !== 0) {
  console.warn('[SKIP] C# 中核テストをスキップしました。理由: dotnet が見つかりません。対処: .NET SDK 8 を導入してください(https://dotnet.microsoft.com/download/dotnet/8.0)')
  process.exit(0)
}

const result = spawnSync('dotnet', ['test', project, '--nologo', ...process.argv.slice(2)], {
  cwd: repositoryRoot,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`C# 中核テストの起動に失敗しました: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
