#Requires -Version 5.1
# OSC ネイティブ UI(TouchOSC 等)の評価起動。mock-unity とブリッジを起動する。
# 起動前に環境を確かめ、足りなければ setup を自動で実行する(D-068)。-CheckOnly は確認だけで終わる
[CmdletBinding()]
param(
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\oscdesk-launcher.ps1')
Set-Location -LiteralPath $OscdeskRoot

$bridgeArtifact = Join-Path $OscdeskRoot 'packages\bridge\dist\oscdesk-bridge.js'
$mockUnityArtifact = Join-Path $OscdeskRoot 'packages\mock-unity\dist\mock-unity.js'
$configPath = Join-Path $OscdeskRoot 'config\oscdesk.touchosc.config.json'
$launcherJob = [IntPtr]::Zero
$mockProcess = $null
$bridgeProcess = $null
$bridgeStdout = $null
$bridgeStderr = $null
$mockStdout = $null
$mockStderr = $null

try {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'Node.js が見つかりません。Node.js 20 以降を導入してください。'
    }
    if ($CheckOnly) {
        if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "config が見つかりません: $configPath" }
        if (Initialize-OscdeskEnvironment -CheckOnly) { exit 0 }
        exit 2
    }
    Initialize-OscdeskEnvironment
    foreach ($required in @($bridgeArtifact, $mockUnityArtifact, $configPath)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
            throw "必要なファイルがありません: $required"
        }
    }

    # 前回ウィンドウを × で閉じた等で残った孤立プロセスを回収し、今回の子は Job Object で親と道連れにする
    Stop-OrphanedLauncherProcesses -CommandLinePatterns @('oscdesk-bridge.js', 'mock-unity.js')
    $launcherJob = Initialize-LauncherJob

    $bridgeStdout = [System.IO.Path]::GetTempFileName()
    $bridgeStderr = [System.IO.Path]::GetTempFileName()
    $mockStdout = [System.IO.Path]::GetTempFileName()
    $mockStderr = [System.IO.Path]::GetTempFileName()

    Write-Host 'mock-unity を起動しています...' -ForegroundColor Cyan
    $mockProcess = Start-Process -FilePath 'node.exe' `
        -ArgumentList (ConvertTo-ArgumentString @($mockUnityArtifact, '--listen-port', '7090')) `
        -WorkingDirectory $OscdeskRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $mockStdout -RedirectStandardError $mockStderr
    Add-LauncherJobProcess -Job $launcherJob -Process $mockProcess

    # mock-unity がポートを掴めないまま(Unity Editor が 7090 を使用中など)ブリッジだけ
    # 起動すると、Unity 不在の評価環境を延々と案内してしまう。READY 行を待ってから進む
    $mockReady = $false
    $mockDeadline = (Get-Date).AddSeconds(15)
    while (-not $mockReady -and (Get-Date) -lt $mockDeadline) {
        if ($mockProcess.HasExited) {
            $detail = Get-OutputText $mockStderr
            if ([string]::IsNullOrWhiteSpace($detail)) { $detail = Get-OutputText $mockStdout }
            throw "mock-unity の起動に失敗しました (exit $($mockProcess.ExitCode))。ポート 7090 を使用中のプロセス(Unity Editor 等)が無いか確認してください: $detail"
        }
        if ((Get-OutputText $mockStdout) -match 'MOCK_UNITY_READY') { $mockReady = $true }
        if (-not $mockReady) { Start-Sleep -Milliseconds 100 }
    }
    if (-not $mockReady) {
        throw "mock-unity の起動完了行が 15 秒以内に出ませんでした: $(Get-OutputText $mockStderr)"
    }

    Write-Host 'ブリッジを起動しています...' -ForegroundColor Cyan
    $bridgeProcess = Start-Process -FilePath 'node.exe' `
        -ArgumentList (ConvertTo-ArgumentString @($bridgeArtifact, '--config', $configPath)) `
        -WorkingDirectory $OscdeskRoot -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $bridgeStdout -RedirectStandardError $bridgeStderr
    Add-LauncherJobProcess -Job $launcherJob -Process $bridgeProcess

    $ready = $null
    $deadline = (Get-Date).AddSeconds(30)
    while ($null -eq $ready -and (Get-Date) -lt $deadline) {
        if ($bridgeProcess.HasExited) {
            throw "ブリッジの起動に失敗しました (exit $($bridgeProcess.ExitCode)): $(Get-OutputText $bridgeStderr)"
        }
        $ready = Find-BridgeReadyLine $bridgeStdout
        if ($null -eq $ready) { Start-Sleep -Milliseconds 100 }
    }
    if ($null -eq $ready) { throw "ブリッジの起動完了行が 30 秒以内に出ませんでした: $(Get-OutputText $bridgeStderr)" }

    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Select-Object -ExpandProperty IPAddress -Unique)
    if ($addresses.Count -eq 0) { $addresses = @('127.0.0.1') }

    Write-Host ''
    Write-Host 'OSC ネイティブ UI 評価環境が起動しました。' -ForegroundColor Green
    Write-Host 'TouchOSC の送信先 IP:' -ForegroundColor Green
    foreach ($address in $addresses) { Write-Host "  $address" -ForegroundColor Green }
    Write-Host "OSC 受信ポート: $($ready.oscListenPort)" -ForegroundColor Green
    Write-Host ''
    Write-Host 'このウィンドウを閉じるとブリッジと mock-unity を停止します。' -ForegroundColor DarkGray

    # どちらか一方が落ちたら気づけるよう、両方のプロセスを監視する
    while ($true) {
        if ($bridgeProcess.HasExited) {
            if ($bridgeProcess.ExitCode -ne 0) {
                throw "ブリッジが終了しました (exit $($bridgeProcess.ExitCode))。mock-unity も停止します: $(Get-OutputText $bridgeStderr)"
            }
            break
        }
        if ($mockProcess.HasExited) {
            throw "mock-unity が終了しました (exit $($mockProcess.ExitCode))。ブリッジも停止します: $(Get-OutputText $mockStderr)"
        }
        Start-Sleep -Milliseconds 500
    }
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    Stop-ProcessTree $bridgeProcess
    Stop-ProcessTree $mockProcess
    foreach ($path in @($bridgeStdout, $bridgeStderr, $mockStdout, $mockStderr)) {
        if ($null -ne $path -and (Test-Path -LiteralPath $path)) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
    }
}
