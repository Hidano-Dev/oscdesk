#Requires -Version 5.1
<#
手動検証(docs/VERIFICATION.md)用の起動(HID-222)。検証のたびに人が行っていた準備を肩代わりする。

- protocol/surface-definition-samples.json の見本を surfaces/ に置き、それを起動時に採用する
- 追跡対象の config を書き換えず、logs/verify/ に一時 config を生成して start-oscdesk.ps1 に渡す
- 副系の宛先を足し、mock-unity(1〜2 台、一覧の応答つき)をそれぞれ別ウィンドウで起動する
- 起動前に環境を確かめ、足りなければ setup を自動で実行する(D-068)。-CheckOnly は確認だけで終わる

例:
  .\launchers\start-oscdesk-verify.ps1 -Mock
  .\launchers\start-oscdesk-verify.ps1 -Sample records-basic -Name members -Mock -OptionsReply '/vp/members/request|/vp/members/list|Alpha|Bravo'
  .\launchers\start-oscdesk-verify.ps1 -Sample options-from-shared-address -Name segments -Mock -Secondary `
      -OptionsReply '/mb/segments/get|/mb/segments|Intro|Song A' -SecondaryOptionsReply '/mb/segments/get|/mb/segments|Song A|Song B'
#>
[CmdletBinding()]
param(
    # 採用する見本の名前。省略時は基本の手動検証で使う full-example
    [string]$Sample = 'full-example',
    # 保存名(surfaces/<Name>.json)。省略時は -Sample を省略していれば stage、指定していれば見本名
    [string]$Name,
    # 既存の surfaces/<Name>.json を見本で作り直す(元のファイルは surfaces/.backups/ へ退避する)
    [switch]$Reset,
    # 診断 NDJSON を出す(config/oscdesk.debug.config.json を元にする)
    [switch]$Diagnostics,
    # mock-unity を起動する(主系 7090。-Secondary なら副系 7092 も)
    [switch]$Mock,
    # mock-unity(主系)の --options-reply。<要求アドレス>|<一覧のアドレス>|<名前>...
    [string[]]$OptionsReply = @(),
    # 副系 backup(127.0.0.1:7092)を宛先に足す
    [switch]$Secondary,
    # mock-unity(副系)の --options-reply
    [string[]]$SecondaryOptionsReply = @(),
    # 環境の確認だけを行い、見本の配置も起動もしない(揃っていれば 0、足りなければ 2)
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\oscdesk-launcher.ps1')
Set-Location -LiteralPath $OscdeskRoot

$mockUnityArtifact = Join-Path $OscdeskRoot 'packages\mock-unity\dist\mock-unity.js'
$mockProcesses = @()
$mockJob = [IntPtr]::Zero

function Start-MockUnityWindow {
    # mock-unity の受信ログを見る手順と、一覧を変えて起動し直す手順があるため、非表示にせず
    # 別ウィンドウ(cmd /k)で起動する。Ctrl+C で止めてもウィンドウは残るので、最初に表示した
    # コマンドを編集して打ち直せる
    param([string]$Title, [int]$ListenPort, [string[]]$Replies)

    $arguments = @('node', "`"$mockUnityArtifact`"", '--listen-port', "$ListenPort", '--reply-host', '127.0.0.1', '--reply-port', '7091')
    foreach ($reply in $Replies) { $arguments += @('--options-reply', "`"$reply`"") }
    $commandLine = $arguments -join ' '
    # /s: 先頭と末尾の引用符だけを外し、内側の引用符(パスと一覧の |)をそのまま cmd に渡す
    $inner = "title $Title && echo 起動し直すときのコマンド: && echo $commandLine && echo. && $commandLine"
    $process = Start-Process -FilePath 'cmd.exe' -ArgumentList "/s /k `"$inner`"" -WorkingDirectory $OscdeskRoot -PassThru
    Add-LauncherJobProcess -Job $mockJob -Process $process
    return $process
}

try {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'Node.js が見つかりません。Node.js 20 以降を導入してください。'
    }
    if (-not $PSBoundParameters.ContainsKey('Name')) {
        $Name = if ($PSBoundParameters.ContainsKey('Sample')) { $Sample } else { 'stage' }
    }
    if (-not $Secondary -and $SecondaryOptionsReply.Count -gt 0) {
        throw '-SecondaryOptionsReply は -Secondary と一緒に指定してください。'
    }
    if (-not $Mock -and ($OptionsReply.Count -gt 0 -or $SecondaryOptionsReply.Count -gt 0)) {
        throw '-OptionsReply / -SecondaryOptionsReply は -Mock と一緒に指定してください。'
    }
    if ($CheckOnly) {
        if (Initialize-OscdeskEnvironment -CheckOnly) { exit 0 }
        exit 2
    }
    # 見本の配置(node)と mock-unity の起動の前に揃える。start-oscdesk.ps1 も確かめるが、そこでは揃っている
    Initialize-OscdeskEnvironment

    $baseConfig = if ($Diagnostics) { 'config\oscdesk.debug.config.json' } else { 'config\oscdesk.config.json' }
    $prepareArguments = @('scripts\verify-surface.mjs', 'prepare', '--base', $baseConfig, '--out', 'logs\verify\oscdesk.verify.config.json',
        '--sample', $Sample, '--name', $Name)
    if ($Reset) { $prepareArguments += '--reset' }
    if ($Secondary) { $prepareArguments += @('--secondary', 'backup:127.0.0.1:7092') }

    # 出力は取り込まずコンソールへ直接出す(PowerShell 5.1 が node の UTF-8 出力を
    # コードページで読んで日本語が化けるため)。config の置き場所は --out で決めている
    & node.exe @prepareArguments
    if ($LASTEXITCODE -ne 0) { throw '検証の準備に失敗しました(上のメッセージを確認してください)。' }
    $configPath = Join-Path $OscdeskRoot 'logs\verify\oscdesk.verify.config.json'

    if ($Mock) {
        if (-not (Test-Path -LiteralPath $mockUnityArtifact -PathType Leaf)) {
            throw 'mock-unity のビルド成果物がありません。.\launchers\setup-oscdesk.bat を実行してください。'
        }
        Stop-OrphanedLauncherProcesses -CommandLinePatterns @('mock-unity.js')
        $mockJob = Initialize-LauncherJob
        Write-Host 'mock-unity を別ウィンドウで起動しています...' -ForegroundColor Cyan
        $mockProcesses += Start-MockUnityWindow -Title 'mock-unity (unity 7090)' -ListenPort 7090 -Replies $OptionsReply
        if ($Secondary) {
            $mockProcesses += Start-MockUnityWindow -Title 'mock-unity (backup 7092)' -ListenPort 7092 -Replies $SecondaryOptionsReply
        }
    }

    & (Join-Path $PSScriptRoot 'start-oscdesk.ps1') -ConfigPath $configPath
    exit $LASTEXITCODE
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    # ウィンドウの × で閉じたときは Job Object が、Ctrl+C やエラーのときはここで止める
    foreach ($process in $mockProcesses) {
        if ($null -ne $process -and -not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F *> $null }
    }
}
