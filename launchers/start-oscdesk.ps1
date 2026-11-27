#Requires -Version 5.1
<#
通常起動(ブリッジ 1 プロセス。UI はブリッジが配る SPA。D-162)。リポジトリ直下の start-oscdesk.bat から呼ばれる。
起動前に依存・ビルド成果物を確かめ、足りなければ setup を自動で実行する(D-068)。

  -ConfigPath <path>  使う config(相対パスはリポジトリ root から)。省略時はブリッジの既定
  -CheckOnly          環境の確認だけを行い、起動も setup もしない(揃っていれば 0、足りなければ 2)
  -SkipSetup          足りないものがあっても setup を自動で実行しない(エラーで止める)
#>
[CmdletBinding()]
param(
    [string]$ConfigPath,
    [switch]$CheckOnly,
    [switch]$SkipSetup
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\oscdesk-launcher.ps1')
Set-Location -LiteralPath $OscdeskRoot

$bridgeArtifact = Join-Path $OscdeskRoot 'packages\bridge\dist\oscdesk-bridge.js'
$launcherJob = [IntPtr]::Zero
$bridgeProcess = $null
$bridgeStdout = $null
$bridgeStderr = $null

function Write-Info {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host $Message -ForegroundColor Cyan
}

function Write-ErrorMessage {
    param([Parameter(Mandatory = $true)][string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

$bridgeOutputOffsets = @{}

function Write-NewBridgeOutput {
    # ブリッジは非表示で起動して出力を一時ファイルへ流している。そのままだと再送・復元・一覧要求の
    # ログ(Resending / Restored / Requesting)が見えず、手動検証の多くの手順が確かめられない(HID-222)。
    # 前回読んだ位置から改行までの完了行だけを中継する(書きかけの行や UTF-8 の途中で切らないため)
    param([string]$Path, [ConsoleColor]$Color)
    if ($null -eq $Path -or -not (Test-Path -LiteralPath $Path)) { return }

    $offset = if ($bridgeOutputOffsets.ContainsKey($Path)) { $bridgeOutputOffsets[$Path] } else { 0 }
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        if ($stream.Length -le $offset) { return }
        $stream.Position = $offset
        $buffer = New-Object byte[] ($stream.Length - $offset)
        $read = $stream.Read($buffer, 0, $buffer.Length)
    } finally {
        $stream.Dispose()
    }
    if ($read -le 0) { return }
    $lastNewline = [Array]::LastIndexOf($buffer, [byte]10, $read - 1)
    if ($lastNewline -lt 0) { return }
    $bridgeOutputOffsets[$Path] = $offset + $lastNewline + 1

    $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $lastNewline + 1)
    foreach ($line in ($text -split "`r?`n")) {
        # 起動完了行は機械向けの JSON で、要点は「ブリッジの起動完了」として別に表示する
        if ($line -eq '' -or $line.StartsWith('OSCDESK_BRIDGE_READY ')) { continue }
        Write-Host "  [bridge] $line" -ForegroundColor $Color
    }
}

function Write-BridgeOutput {
    Write-NewBridgeOutput -Path $bridgeStdout -Color Gray
    Write-NewBridgeOutput -Path $bridgeStderr -Color Yellow
}

try {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'Node.js が見つかりません。Node.js 20 以降を導入してください。'
    }
    $resolvedConfig = $null
    if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
        if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) { throw "config が見つかりません: $ConfigPath" }
        $resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
    }

    if ($CheckOnly) {
        if ($null -ne $resolvedConfig) { Write-Host "config: $resolvedConfig" }
        if (Initialize-OscdeskEnvironment -CheckOnly) { exit 0 }
        exit 2
    }
    if ($SkipSetup) {
        $missing = Test-OscdeskEnvironment
        if ($missing.Count -gt 0) {
            throw ('環境が揃っていません(-SkipSetup のため setup は実行しません): ' + ($missing -join ' / '))
        }
    } else {
        Initialize-OscdeskEnvironment
    }

    # 前回ウィンドウを × で閉じた等で残った孤立プロセスがポートを握っていると bind に失敗する。
    # 起動前に回収し、今回の子は Job Object に入れて親の終了と道連れにする。
    # 回収はこのチェックアウトのものだけ(別の worktree のブリッジは止めない。D-135)。oscdesk_ui は撤去した
    # NiceGUI 版の UI(D-162)。撤去前に起動して孤立したものが残っていれば一緒に回収する
    Stop-OrphanedLauncherProcesses -CommandLinePatterns @('oscdesk-bridge.js', 'oscdesk_ui')
    $launcherJob = Initialize-LauncherJob

    # 出力ファイルは logs\launcher\ に置き、強制終了で残った前回の分をここで片付ける(D-135)
    Clear-LauncherOutputFiles
    $bridgeStdout = New-LauncherOutputFile -Name 'bridge-stdout'
    $bridgeStderr = New-LauncherOutputFile -Name 'bridge-stderr'

    $bridgeArguments = @($bridgeArtifact)
    if ($null -ne $resolvedConfig) {
        $bridgeArguments += @('--config', $resolvedConfig)
    }

    Write-Info 'ブリッジを起動しています...'
    $bridgeProcess = Start-Process -FilePath 'node.exe' -ArgumentList (ConvertTo-ArgumentString $bridgeArguments) `
        -WorkingDirectory $OscdeskRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $bridgeStdout -RedirectStandardError $bridgeStderr
    Add-LauncherJobProcess -Job $launcherJob -Process $bridgeProcess

    $ready = $null
    $deadline = (Get-Date).AddSeconds(30)
    while ($null -eq $ready -and (Get-Date) -lt $deadline) {
        if ($bridgeProcess.HasExited) {
            $detail = Get-OutputText $bridgeStderr
            if ([string]::IsNullOrWhiteSpace($detail)) { $detail = Get-OutputText $bridgeStdout }
            throw "ブリッジの起動に失敗しました (exit $($bridgeProcess.ExitCode)): $detail"
        }
        $ready = Find-BridgeReadyLine $bridgeStdout
        Write-BridgeOutput
        if ($null -eq $ready) { Start-Sleep -Milliseconds 100 }
    }
    if ($null -eq $ready) {
        throw "ブリッジの起動完了行が 30 秒以内に出ませんでした: $(Get-OutputText $bridgeStderr)"
    }
    if ($null -eq $ready.wsPort) {
        throw 'ブリッジの起動完了行にポート情報がありません。'
    }

    Write-Info "ブリッジの起動完了: WebSocket と UI(SPA) $($ready.wsPort) / Unity から受信 $($ready.oscListenPort)"
    Write-Host ''
    Write-WebUiUrls -Ready $ready
    Write-Host ''
    Write-Host 'このウィンドウを閉じるとブリッジを停止します。以下にブリッジの出力を表示します。' -ForegroundColor DarkGray

    # UI はブリッジが配るので、監視するのはブリッジ 1 つだけ
    while ($true) {
        Write-BridgeOutput
        if ($bridgeProcess.HasExited) {
            $detail = Get-OutputText $bridgeStderr
            if ([string]::IsNullOrWhiteSpace($detail)) { $detail = Get-OutputText $bridgeStdout }
            throw "ブリッジが終了しました (exit $($bridgeProcess.ExitCode)): $detail"
        }
        Start-Sleep -Milliseconds 500
    }
} catch {
    Write-ErrorMessage $_.Exception.Message
    exit 1
} finally {
    Stop-ProcessTree $bridgeProcess
    foreach ($path in @($bridgeStdout, $bridgeStderr)) {
        if ($null -ne $path -and (Test-Path -LiteralPath $path)) {
            Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        }
    }
}
