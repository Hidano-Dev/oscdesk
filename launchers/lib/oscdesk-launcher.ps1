#Requires -Version 5.1
# ランチャーの共通部品(D-068)。launchers/*.ps1 と、フォークの自前ランチャー(start-oscdesk-vp.ps1 等)から
# dot-source して使う。
#
#   . (Join-Path <リポジトリ root> 'launchers\lib\oscdesk-launcher.ps1')
#
# dot-source すると次の変数と関数が呼び出し側のスコープに入る。
#   $OscdeskRoot          リポジトリ root(この部品の位置から解決する。呼び出し側の置き場所に依らない)
#   $OscdeskLaunchersDir  launchers/ の絶対パス
#   Initialize-OscdeskEnvironment  依存・ビルド成果物・.venv を確かめ、足りなければ setup を自動で実行する
#   Test-OscdeskEnvironment        上の確認だけを行い、足りないものの説明を返す(空なら揃っている)
#   Invoke-OscdeskSetup            launchers/setup-oscdesk.ps1 を別プロセスで実行する
#   Stop-ProcessTree / Get-OutputText / ConvertTo-ArgumentString / Find-BridgeReadyLine / Get-LanAddresses
#   Initialize-LauncherJob / Add-LauncherJobProcess / Stop-OrphanedLauncherProcesses(launcher-guard.ps1、D-039)
#
# 起動の手順をそのまま使いたいだけなら、この部品を読まずに
#   & (Join-Path $root 'launchers\start-oscdesk.ps1') -ConfigPath <config>
# と呼べばよい(環境の確認と自動 setup も含まれる)。

$OscdeskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$OscdeskLaunchersDir = Join-Path $OscdeskRoot 'launchers'

. (Join-Path $PSScriptRoot 'launcher-guard.ps1')

function Get-NewestWriteTime {
    # 指定ディレクトリ配下の .ts(単体テストを除く)と package.json の最終更新時刻のうち最新を返す
    param([string[]]$PackageDirs)
    $newest = [DateTime]::MinValue
    foreach ($dir in $PackageDirs) {
        $files = @()
        $src = Join-Path $dir 'src'
        if (Test-Path -LiteralPath $src) {
            $files += @(Get-ChildItem -LiteralPath $src -Recurse -File -Filter '*.ts' -ErrorAction SilentlyContinue |
                Where-Object { -not $_.Name.EndsWith('.test.ts') })
        }
        $manifest = Join-Path $dir 'package.json'
        if (Test-Path -LiteralPath $manifest) { $files += Get-Item -LiteralPath $manifest }
        foreach ($file in $files) {
            if ($file.LastWriteTime -gt $newest) { $newest = $file.LastWriteTime }
        }
    }
    return $newest
}

function Test-SameTextIgnoringNewlines {
    # pnpm は写しを LF で書くが、core.autocrlf=true の PC では pnpm-lock.yaml が CRLF でチェックアウトされる。
    # バイトで比べると中身が同じでも食い違い、pnpm も「up to date」で写しを書き直さないため、setup を
    # 何度実行しても起動できなくなる。改行の違いだけは同じとみなす
    param([string]$PathA, [string]$PathB)
    $a = [System.IO.File]::ReadAllText($PathA) -replace "`r`n", "`n"
    $b = [System.IO.File]::ReadAllText($PathB) -replace "`r`n", "`n"
    return [string]::Equals($a, $b, [System.StringComparison]::Ordinal)
}

function Test-OscdeskEnvironment {
    # 起動の前に毎回呼ぶので、プロセスを起動せずファイルの有無・中身・時刻だけで判定する(数十 ms)。
    # pnpm install / build / pip install を毎回走らせると起動が数十秒遅くなるため、ここでは
    # 「setup が要るか」だけを決め、実際の同期は冪等な setup に任せる
    $reasons = @()
    $root = $OscdeskRoot

    # 1. ワークスペース依存。pnpm は導入済みのロックファイルの写しを node_modules/.pnpm/lock.yaml に置く。
    #    pull で pnpm-lock.yaml が変わると写しと食い違うので、存在だけでなく中身で比べる(改行の違いは無視する)
    $lockFile = Join-Path $root 'pnpm-lock.yaml'
    $installedLock = Join-Path $root 'node_modules\.pnpm\lock.yaml'
    if (-not (Test-Path -LiteralPath $installedLock -PathType Leaf)) {
        $reasons += 'ワークスペース依存(node_modules)が導入されていません'
    } elseif ((Test-Path -LiteralPath $lockFile -PathType Leaf) -and
        -not (Test-SameTextIgnoringNewlines -PathA $lockFile -PathB $installedLock)) {
        $reasons += 'pnpm-lock.yaml が導入済みの依存と一致しません(pull で依存が変わった可能性)'
    }

    # 2. ビルド成果物。成果物がバンドルするパッケージ(shared / osc-codec と自分自身)のソースより
    #    古ければ、pull や編集の後の古い dist で起動してしまうので作り直す
    $packages = Join-Path $root 'packages'
    $libraryDirs = @((Join-Path $packages 'shared'), (Join-Path $packages 'osc-codec'))
    $artifacts = @(
        @{ Path = Join-Path $packages 'bridge\dist\oscdesk-bridge.js'; Dirs = $libraryDirs + @(Join-Path $packages 'bridge'); Name = 'ブリッジの' },
        @{ Path = Join-Path $packages 'mock-unity\dist\mock-unity.js'; Dirs = $libraryDirs + @(Join-Path $packages 'mock-unity'); Name = 'mock-unity の' }
    )
    foreach ($artifact in $artifacts) {
        if (-not (Test-Path -LiteralPath $artifact.Path -PathType Leaf)) {
            $reasons += "$($artifact.Name)ビルド成果物がありません"
            continue
        }
        $built = (Get-Item -LiteralPath $artifact.Path).LastWriteTime
        if ((Get-NewestWriteTime -PackageDirs $artifact.Dirs) -gt $built) {
            $reasons += "$($artifact.Name)ビルド成果物がソースより古くなっています"
        }
    }

    # 3. UI の Python 仮想環境と UI パッケージ。editable インストールなのでソースの更新は追従する。
    #    依存の宣言(pyproject.toml)がインストールより新しいときだけ入れ直す
    $uiRoot = Join-Path $packages 'nicegui-ui'
    $venvPython = Join-Path $uiRoot '.venv\Scripts\python.exe'
    $sitePackages = Join-Path $uiRoot '.venv\Lib\site-packages'
    if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        $reasons += 'UI の Python 仮想環境(packages/nicegui-ui/.venv)がありません'
    } else {
        $distInfo = @(Get-ChildItem -LiteralPath $sitePackages -Directory -Filter 'oscdesk_nicegui_ui-*.dist-info' -ErrorAction SilentlyContinue)
        $metadata = if ($distInfo.Count -gt 0) { Join-Path $distInfo[0].FullName 'METADATA' } else { $null }
        if ($null -eq $metadata -or -not (Test-Path -LiteralPath $metadata -PathType Leaf)) {
            $reasons += 'UI パッケージ(oscdesk-nicegui-ui)が仮想環境に入っていません'
        } elseif ((Get-Item -LiteralPath (Join-Path $uiRoot 'pyproject.toml')).LastWriteTime -gt (Get-Item -LiteralPath $metadata).LastWriteTime) {
            $reasons += 'UI パッケージの依存の宣言(pyproject.toml)がインストールより新しくなっています'
        }
    }

    return , $reasons
}

function Invoke-OscdeskSetup {
    # 別プロセスで実行する。setup は失敗時に exit するので、同じプロセスで呼ぶと
    # 呼び出し側のランチャーごと終わってしまう。-Force は setup にそのまま渡す
    param([switch]$Force)
    $setupScript = Join-Path $OscdeskLaunchersDir 'setup-oscdesk.ps1'
    $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $setupScript)
    if ($Force) { $arguments += '-Force' }
    # 出力を取り込まずに同じコンソールへ直接出す(パイプで受けると進捗が溜まって見えず、
    # 子の日本語がコードページ経由で読み直されて化けることがある)
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList (ConvertTo-ArgumentString $arguments) `
        -WorkingDirectory $OscdeskRoot -NoNewWindow -Wait -PassThru
    return $process.ExitCode
}

function Initialize-OscdeskEnvironment {
    # 足りないものがあれば setup を自動で実行し、実行後にもう一度確かめる(揃わなければ例外)。
    # 何も返さない。-CheckOnly では setup を実行せず、揃っていれば $true、足りなければ $false を返す
    param([switch]$CheckOnly)

    $reasons = Test-OscdeskEnvironment
    if ($reasons.Count -eq 0) {
        if ($CheckOnly) {
            Write-Host '環境の確認: 揃っています。' -ForegroundColor Green
            return $true
        }
        return
    }

    Write-Host '環境の確認: 次のものが足りません。' -ForegroundColor Yellow
    foreach ($reason in $reasons) { Write-Host "  - $reason" -ForegroundColor Yellow }
    if ($CheckOnly) {
        Write-Host '起動時に setup(launchers\setup-oscdesk.ps1)を自動で実行します。' -ForegroundColor Yellow
        return $false
    }

    Write-Host 'setup を自動で実行します...' -ForegroundColor Cyan
    $exitCode = Invoke-OscdeskSetup
    if ($exitCode -ne 0) {
        throw "setup に失敗しました(終了コード $exitCode)。上のメッセージを確認してください。"
    }
    $remaining = Test-OscdeskEnvironment
    if ($remaining.Count -gt 0) {
        throw ('setup の後も環境が揃いません: ' + ($remaining -join ' / '))
    }
}

function Stop-ProcessTree {
    param([System.Diagnostics.Process]$Process)
    if ($null -eq $Process) { return }
    try {
        if (-not $Process.HasExited) { & taskkill.exe /PID $Process.Id /T /F *> $null }
    } catch {
        Write-Host "プロセス $($Process.Id) の回収に失敗しました: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Get-OutputText {
    param([string]$Path)
    if ($null -eq $Path -or -not (Test-Path -LiteralPath $Path)) { return '' }
    # 空ファイルでは Get-Content が $null を返し、[string]::Join が例外を出して本来のエラーを隠すため配列に包む
    return [string]::Join([Environment]::NewLine, @(Get-Content -LiteralPath $Path -Encoding UTF8))
}

function ConvertTo-ArgumentString {
    # Start-Process の ArgumentList は要素を空白結合するだけでクオートしないため、
    # 空白を含むパスが複数引数に割れる。ここで明示的にクオートして 1 本の文字列にする
    param([string[]]$Arguments)
    return ($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join ' '
}

function Find-BridgeReadyLine {
    # ブリッジの標準出力を書いたファイルから OSCDESK_BRIDGE_READY 行を探し、JSON を解析して返す(未出力なら $null)
    param([string]$Path)
    if ($null -eq $Path -or -not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
        if (-not $line.StartsWith('OSCDESK_BRIDGE_READY ')) { continue }
        try {
            return ($line.Substring('OSCDESK_BRIDGE_READY '.Length) | ConvertFrom-Json)
        } catch {
            throw "ブリッジの起動完了行を解析できません: $line"
        }
    }
    return $null
}

function Get-LanAddresses {
    try {
        return @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
            Select-Object -ExpandProperty IPAddress -Unique)
    } catch {
        return @()
    }
}
