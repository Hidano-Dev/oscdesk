#Requires -Version 5.1
# ランチャーの後始末の共通部品(D-039)。oscdesk-launcher.ps1 が dot-source するので、ランチャーからは直接読まなくてよい。
#
# 1. Job Object: 起動した子プロセスを JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 付きの Job に入れる。
#    コンソールウィンドウの × で閉じると PowerShell は finally を実行せずに終了し、
#    -WindowStyle Hidden で起動した子には CTRL_CLOSE_EVENT も届かないため、
#    node / python が親なしで残ってポートを握り続ける。Job に入れておけば、
#    親がどう終了しても OS がハンドルを閉じた時点で子を道連れにする。
# 2. 孤立プロセスの回収: 起動前に、前回の残骸(親が消えた oscdesk のプロセス)を停止する。
#    Job 対応前に残ったものや、Job 割り当てに失敗した環境の保険。回収はこのチェックアウトから起動したものに限る(D-135)。
# 3. 出力ファイル: 子の標準出力・標準エラーは <root>\logs\launcher\ に置き、起動時に前回の残りを片付ける(D-135)。

if (-not ([System.Management.Automation.PSTypeName]'OscdeskLauncherJob').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class OscdeskLauncherJob
{
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private const int JobObjectExtendedLimitInformation = 9;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr securityAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint infoLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    // KILL_ON_JOB_CLOSE 付きの Job を作る。返したハンドルは閉じない
    // (このプロセスの終了時に OS が閉じ、その時点で Job 内の全プロセスが終了する)。
    public static IntPtr Create()
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, buffer, (uint)size))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
        return job;
    }

    public static void Assign(IntPtr job, IntPtr processHandle)
    {
        if (!AssignProcessToJobObject(job, processHandle))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
'@
}

function Initialize-LauncherJob {
    # 失敗しても起動は続ける(従来どおり finally の taskkill だけに頼る)。
    try {
        return [OscdeskLauncherJob]::Create()
    } catch {
        Write-Host "Job Object を作成できませんでした。ウィンドウを閉じても子プロセスが残ることがあります: $($_.Exception.Message)" -ForegroundColor Yellow
        return [IntPtr]::Zero
    }
}

function Add-LauncherJobProcess {
    param(
        [IntPtr]$Job,
        [System.Diagnostics.Process]$Process
    )
    if ($Job -eq [IntPtr]::Zero -or $null -eq $Process) { return }
    try {
        [OscdeskLauncherJob]::Assign($Job, $Process.Handle)
    } catch {
        Write-Host "プロセス $($Process.Id) を Job Object に入れられませんでした。ウィンドウを閉じても残ることがあります: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function ConvertTo-LauncherPathKey {
    # パスの比べ方を揃える: / と \ の違い、続いた区切り、末尾の区切り、大文字小文字を無視する
    param([string]$Path)
    if ([string]::IsNullOrEmpty($Path)) { return '' }
    return ($Path -replace '[\\/]+', '\').TrimEnd('\').ToLowerInvariant()
}

function Test-LauncherProcessInRoot {
    # プロセスがこのチェックアウトから起動したものかを、コマンドラインと実行ファイルのパスだけで判定する(D-135)。
    # ランチャーは子を必ず <root>\packages\ の下の絶対パスで起動する(ブリッジ・mock-unity は node に渡す .js、
    # UI は .venv\Scripts\python.exe。venv の python.exe が起動する本体の python もコマンドラインに venv のパスを持つ)。
    # root を含むだけで判定すると、root の下に置いた worktree(<root>\.claude\worktrees\…)のプロセスまで
    # 当たって止めてしまうので、root の直下の packages\ までを含めて比べる
    param(
        [string]$CommandLine,
        [string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string]$Root
    )
    $rootKey = ConvertTo-LauncherPathKey $Root
    if ($rootKey -eq '') { return $false }
    $marker = $rootKey + '\packages\'
    foreach ($text in @($CommandLine, $ExecutablePath)) {
        if ((ConvertTo-LauncherPathKey $text).Contains($marker)) { return $true }
    }
    return $false
}

function Stop-OrphanedLauncherProcesses {
    # 親プロセスが消えている(または PID が再利用されて親のほうが新しい)node / python のうち、
    # コマンドラインが指定パターンを含み、かつこのチェックアウト(-Root。省略時は $OscdeskRoot)から
    # 起動したものをツリーごと停止する。
    # 別のランチャーが生きている場合(親が存在する)と、別のチェックアウトのプロセスは触らない(D-135)。
    param(
        [Parameter(Mandatory = $true)][string[]]$CommandLinePatterns,
        [string]$Root = $OscdeskRoot
    )
    if ([string]::IsNullOrWhiteSpace($Root)) {
        throw 'Stop-OrphanedLauncherProcesses: リポジトリ root が分かりません(-Root を指定してください)。'
    }

    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $byId = @{}
    foreach ($process in $processes) { $byId[[int]$process.ProcessId] = $process }

    $stopped = @()
    foreach ($process in $processes) {
        if ($process.Name -notmatch '^(node|python|pythonw)\.exe$') { continue }
        $commandLine = [string]$process.CommandLine
        if ([string]::IsNullOrEmpty($commandLine)) { continue }

        $matched = $false
        foreach ($pattern in $CommandLinePatterns) {
            if ($commandLine.IndexOf($pattern, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $matched = $true; break }
        }
        if (-not $matched) { continue }
        if (-not (Test-LauncherProcessInRoot -CommandLine $commandLine -ExecutablePath ([string]$process.ExecutablePath) -Root $Root)) { continue }

        $parent = $byId[[int]$process.ParentProcessId]
        $orphan = ($null -eq $parent) -or
            ($null -ne $parent.CreationDate -and $null -ne $process.CreationDate -and $parent.CreationDate -gt $process.CreationDate)
        if (-not $orphan) { continue }

        & taskkill.exe /PID $process.ProcessId /T /F *> $null
        $stopped += "$($process.Name) PID $($process.ProcessId)"
    }

    if ($stopped.Count -gt 0) {
        Write-Host ('前回の起動で残っていたプロセスを停止しました: ' + ($stopped -join ', ')) -ForegroundColor Yellow
    }
}

function Get-LauncherOutputDirectory {
    param([string]$Root = $OscdeskRoot)
    return Join-Path $Root 'logs\launcher'
}

function Clear-LauncherOutputFiles {
    # 前回の起動の出力ファイルを片付ける(D-135)。ランチャーが強制終了されると finally が走らず、
    # 子の標準出力・標準エラーを受けたファイルが残る。ファイル名の先頭のランチャーの PID がまだ生きている
    # (同じチェックアウトで別のランチャーが動いている)ものは残す。消せないもの(子が書き込み中)も黙って残す
    param([string]$Root = $OscdeskRoot)
    $directory = Get-LauncherOutputDirectory -Root $Root
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { return }
    foreach ($file in @(Get-ChildItem -LiteralPath $directory -File -Filter '*.log' -ErrorAction SilentlyContinue)) {
        $ownerId = 0
        if ($file.Name -match '^(\d+)-' -and [int]::TryParse($Matches[1], [ref]$ownerId) -and
            $null -ne (Get-Process -Id $ownerId -ErrorAction SilentlyContinue)) { continue }
        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
    }
}

function New-LauncherOutputFile {
    # 子の出力を受けるファイルを <root>\logs\launcher\ に作る(D-135)。%TEMP% に置くと、強制終了で残ったものを
    # 次の起動で見分けられない。名前の先頭にこのランチャーの PID を付け、Clear-LauncherOutputFiles が
    # 動いているランチャーのファイルを消さないようにする
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Root = $OscdeskRoot
    )
    $directory = Get-LauncherOutputDirectory -Root $Root
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $path = Join-Path $directory ('{0}-{1}-{2}.log' -f $PID, $Name, [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType File -Path $path | Out-Null
    return $path
}
