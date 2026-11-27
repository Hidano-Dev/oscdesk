#Requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
# launchers/ に置いているので、リポジトリ root は 1 つ上。起動ランチャーが環境の不足を
# 見つけたときにも自動で呼ばれる(D-068)が、単体で実行してもよい。
# UI はブリッジが配る SPA だけなので(D-162)、Python の仮想環境は作らない(Node.js だけで揃う)
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $repoRoot
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'

function Assert-ExitCode {
    param([Parameter(Mandatory = $true)][string]$What)
    if ($LASTEXITCODE -ne 0) {
        throw "${What}に失敗しました（終了コード $LASTEXITCODE）。"
    }
}

function Write-Step {
    param([Parameter(Mandatory = $true)][int]$Number, [Parameter(Mandatory = $true)][string]$Title)
    Write-Host "[$Number/2] $Title" -ForegroundColor Cyan
}

function Write-Skipped {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "      スキップ: $Message" -ForegroundColor DarkGray
}

try {
    Write-Host '=== OSCDesk セットアップ ===' -ForegroundColor White
    if ($Force) {
        Write-Host '強制再実行モード' -ForegroundColor Yellow
    }

    Write-Step 1 'ワークスペース依存を導入'
    # node_modules の存在だけを見てスキップすると、依存が増えた更新後のチェックアウトで
    # 古いまま先へ進んでビルドが失敗する。pnpm install は最新なら即終了する冪等コマンド
    # なので、毎回そのまま実行して鮮度判定は pnpm に任せる
    corepack pnpm install
    Assert-ExitCode 'ワークスペース依存の導入'
    Write-Host '      完了' -ForegroundColor Green

    Write-Step 2 '全パッケージをビルド'
    # 1 つの成果物の存在で全体を「ビルド済み」と判定すると、ソース更新後の pull で
    # 古い dist を使い続ける。ビルドは冪等で数秒なので毎回実行し、鮮度を保証する
    $bridgeBundle = Join-Path $repoRoot 'packages\bridge\dist\oscdesk-bridge.js'
    corepack pnpm -r run build
    Assert-ExitCode '全パッケージのビルド'
    if (-not (Test-Path $bridgeBundle -PathType Leaf)) {
        throw 'ビルドは成功しましたが bridge の成果物が見つかりません。'
    }
    Write-Host '      完了' -ForegroundColor Green

    Write-Host '=== セットアップ完了 ===' -ForegroundColor Green
    exit 0
}
catch {
    Write-Host '=== セットアップ失敗 ===' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
