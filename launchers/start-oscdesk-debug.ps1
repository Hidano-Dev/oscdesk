#Requires -Version 5.1
# デバッグ起動(診断 NDJSON あり)。環境の確認と自動 setup は start-oscdesk.ps1 が行う
[CmdletBinding()]
param(
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

& (Join-Path $PSScriptRoot 'start-oscdesk.ps1') -ConfigPath (Join-Path $repoRoot 'config\oscdesk.debug.config.json') -CheckOnly:$CheckOnly
exit $LASTEXITCODE