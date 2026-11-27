#Requires -Version 5.1
# ランチャーの後始末の共通部品(D-039)。oscdesk-launcher.ps1 が dot-source するので、ランチャーからは直接読まなくてよい。
#
# 1. Job Object: 起動した子プロセスを JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 付きの Job に入れる。
#    コンソールウィンドウの × で閉じると PowerShell は finally を実行せずに終了し、
#    -WindowStyle Hidden で起動した子には CTRL_CLOSE_EVENT も届かないため、
#    node が親なしで残ってポートを握り続ける。Job に入れておけば、
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

if (-not ([System.Management.Automation.PSTypeName]'OscdeskLauncherPath').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class OscdeskLauncherPath
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetLongPathName(string shortPath, StringBuilder longPath, uint bufferLength);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetShortPathName(string longPath, StringBuilder shortPath, uint bufferLength);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(string fileName, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder path, uint bufferLength, uint flags);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    private const uint OPEN_EXISTING = 3;
    private const uint FILE_SHARE_ALL = 7;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;

    // 8.3 の短い名前を長い名前に直す。直せなければ null
    public static string Long(string path)
    {
        var buffer = new StringBuilder(32768);
        uint length = GetLongPathName(path, buffer, (uint)buffer.Capacity);
        return (length == 0 || length >= buffer.Capacity) ? null : buffer.ToString();
    }

    // 8.3 の短い名前。短い名前が無効なボリュームでは長い名前のまま返ることがある。取れなければ null
    public static string Short(string path)
    {
        var buffer = new StringBuilder(32768);
        uint length = GetShortPathName(path, buffer, (uint)buffer.Capacity);
        return (length == 0 || length >= buffer.Capacity) ? null : buffer.ToString();
    }

    // ジャンクション・シンボリックリンク・subst を解いた実体のパス(\\?\ を外した形)。取れなければ null
    public static string Final(string path)
    {
        IntPtr handle = CreateFile(path, 0, FILE_SHARE_ALL, IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, IntPtr.Zero);
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) { return null; }
        try
        {
            var buffer = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
            if (length == 0 || length >= buffer.Capacity) { return null; }
            string result = buffer.ToString();
            if (result.StartsWith(@"\\?\UNC\")) { return @"\\" + result.Substring(8); }
            if (result.StartsWith(@"\\?\")) { return result.Substring(4); }
            return result;
        }
        finally
        {
            CloseHandle(handle);
        }
    }
}
'@
}

function Assert-LauncherRoot {
    # root が空のまま進むと、logs\launcher が今いるフォルダの下にできたり、回収の判定が何にも当たらなくなったりする
    param([string]$Root, [Parameter(Mandatory = $true)][string]$FunctionName)
    if ([string]::IsNullOrWhiteSpace($Root)) {
        throw "${FunctionName}: リポジトリ root が分かりません。oscdesk-launcher.ps1 を dot-source して `$OscdeskRoot を定めるか、-Root を指定してください。"
    }
}

function ConvertTo-LauncherPathKey {
    # パスの比べ方を揃える: / と \ の違い、続いた区切り、末尾の区切り、大文字小文字を無視する
    param([string]$Path)
    if ([string]::IsNullOrEmpty($Path)) { return '' }
    return ($Path -replace '[\\/]+', '\').TrimEnd('\').ToLowerInvariant()
}

function Get-LauncherRootSpellings {
    # 同じ root の書き方をできる範囲で集める(D-135)。$OscdeskRoot は $PSScriptRoot から作るので、ランチャーを
    # どの書き方(8.3 の短い名前・ジャンクション・シンボリックリンク・subst)で起動したかで綴りが変わり、
    # 子のコマンドラインの綴りと食い違うことがある。与えた形・GetFullPath・長い名前・短い名前・
    # リンクを解いた実体(とその長い名前)のどれかに当たれば同じ root とみなす。取れないものは黙って飛ばす
    param([Parameter(Mandatory = $true)][string]$Root)
    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add($Root)
    try { $candidates.Add([System.IO.Path]::GetFullPath($Root)) } catch {}
    foreach ($base in @($candidates.ToArray())) {
        foreach ($converted in @([OscdeskLauncherPath]::Long($base), [OscdeskLauncherPath]::Short($base), [OscdeskLauncherPath]::Final($base))) {
            if (-not [string]::IsNullOrEmpty($converted)) { $candidates.Add($converted) }
        }
    }
    foreach ($final in @($candidates.ToArray())) {
        $long = [OscdeskLauncherPath]::Long($final)
        if (-not [string]::IsNullOrEmpty($long)) { $candidates.Add($long) }
    }
    $keys = @()
    foreach ($candidate in $candidates) {
        $key = ConvertTo-LauncherPathKey $candidate
        if ($key -ne '' -and $keys -notcontains $key) { $keys += $key }
    }
    return , $keys
}

function Test-LauncherProcessInRoot {
    # プロセスがこのチェックアウトから起動したものかを、コマンドラインと実行ファイルのパスだけで判定する(D-135)。
    # ランチャーは子を必ず <root>\packages\ の下の絶対パスで起動する(ブリッジ・mock-unity は node に渡す .js)。
    # 撤去した NiceGUI 版の UI(D-162)は .venv\Scripts\python.exe で起動していた。撤去前に起動して孤立したものも
    # 回収できるよう、python も同じ規則で見る。venv の python.exe(リダイレクタ)が起動する本体の python は、実行ファイルが
    # Python のインストール先でも、コマンドラインは venv の python.exe のまま引き継ぐ(Python 3.13 で確認:
    # ExecutablePath C:\…\Python313\python.exe / CommandLine "<root>\packages\nicegui-ui\.venv\Scripts\python.exe" -m …)。
    # root を含むだけで判定すると、root の下に置いた worktree(<root>\.claude\worktrees\…)のプロセスまで
    # 当たって止めてしまうので、root の直下の packages\ までを含めて比べる。
    # -Root には同じ root の書き方を複数渡せる(Get-LauncherRootSpellings)。どれか 1 つに当たれば真
    param(
        [string]$CommandLine,
        [string]$ExecutablePath,
        [Parameter(Mandatory = $true)][string[]]$Root
    )
    $texts = @((ConvertTo-LauncherPathKey $CommandLine), (ConvertTo-LauncherPathKey $ExecutablePath))
    foreach ($spelling in $Root) {
        $rootKey = ConvertTo-LauncherPathKey $spelling
        if ($rootKey -eq '') { continue }
        $marker = $rootKey + '\packages\'
        foreach ($text in $texts) {
            if ($text.Contains($marker)) { return $true }
        }
    }
    return $false
}

function Stop-OrphanedLauncherProcesses {
    # 親プロセスが消えている(または PID が再利用されて親のほうが新しい)node / python(撤去前の UI の残り。D-162)のうち、
    # コマンドラインが指定パターンを含み、かつこのチェックアウト(-Root。省略時は $OscdeskRoot)から
    # 起動したものをツリーごと停止する。
    # 別のランチャーが生きている場合(親が存在する)と、別のチェックアウトのプロセスは触らない(D-135)。
    # 触らなかった孤立プロセスは、ポートを握っていて bind に失敗したときに探せるよう PID とコマンドラインを出す
    param(
        [Parameter(Mandatory = $true)][string[]]$CommandLinePatterns,
        [string]$Root = $OscdeskRoot
    )
    Assert-LauncherRoot -Root $Root -FunctionName 'Stop-OrphanedLauncherProcesses'
    $spellings = Get-LauncherRootSpellings -Root $Root

    $processes = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $byId = @{}
    foreach ($process in $processes) { $byId[[int]$process.ProcessId] = $process }

    $stopped = @()
    $skipped = @()
    foreach ($process in $processes) {
        if ($process.Name -notmatch '^(node|python|pythonw)\.exe$') { continue }
        $commandLine = [string]$process.CommandLine
        if ([string]::IsNullOrEmpty($commandLine)) { continue }

        $matched = $false
        foreach ($pattern in $CommandLinePatterns) {
            if ($commandLine.IndexOf($pattern, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $matched = $true; break }
        }
        if (-not $matched) { continue }

        $parent = $byId[[int]$process.ParentProcessId]
        $orphan = ($null -eq $parent) -or
            ($null -ne $parent.CreationDate -and $null -ne $process.CreationDate -and $parent.CreationDate -gt $process.CreationDate)
        if (-not $orphan) { continue }

        if (-not (Test-LauncherProcessInRoot -CommandLine $commandLine -ExecutablePath ([string]$process.ExecutablePath) -Root $spellings)) {
            $skipped += "  PID $($process.ProcessId): $commandLine"
            continue
        }

        & taskkill.exe /PID $process.ProcessId /T /F *> $null
        $stopped += "$($process.Name) PID $($process.ProcessId)"
    }

    if ($stopped.Count -gt 0) {
        Write-Host ('前回の起動で残っていたプロセスを停止しました: ' + ($stopped -join ', ')) -ForegroundColor Yellow
    }
    if ($skipped.Count -gt 0) {
        Write-Host '別のチェックアウト(または相対パスでの起動)の孤立プロセスは止めません。ポートの bind に失敗したときは、次のプロセスがポートを握っていないか確認してください:' -ForegroundColor Yellow
        foreach ($line in $skipped) { Write-Host $line -ForegroundColor Yellow }
    }
}

function Get-LauncherOutputDirectory {
    param([string]$Root = $OscdeskRoot)
    Assert-LauncherRoot -Root $Root -FunctionName 'Get-LauncherOutputDirectory'
    return Join-Path $Root 'logs\launcher'
}

function Get-LauncherFallbackOutputDirectory {
    # <root>\logs\launcher を作れない・書けないとき(読み取り専用のチェックアウトなど)の置き場所。
    # 複数のチェックアウトで共有するが、片付けはファイル名の PID で持ち主を見るので、他人の動いている分は消さない
    return Join-Path ([System.IO.Path]::GetTempPath()) 'oscdesk-launcher'
}

function Clear-LauncherOutputFiles {
    # 前回の起動の出力ファイルを片付ける(D-135)。ランチャーが強制終了されると finally が走らず、
    # 子の標準出力・標準エラーを受けたファイルが残る。ファイル名の先頭のランチャーの PID がまだ生きている
    # (別のランチャーが動いている)ものは残す。消せないもの(子が書き込み中)も黙って残す。
    # <root>\logs\launcher と、書けなかったときの %TEMP%\oscdesk-launcher の両方を見る
    param([string]$Root = $OscdeskRoot)
    Assert-LauncherRoot -Root $Root -FunctionName 'Clear-LauncherOutputFiles'
    foreach ($directory in @((Get-LauncherOutputDirectory -Root $Root), (Get-LauncherFallbackOutputDirectory))) {
        if (-not (Test-Path -LiteralPath $directory -PathType Container)) { continue }
        foreach ($file in @(Get-ChildItem -LiteralPath $directory -File -Filter '*.log' -ErrorAction SilentlyContinue)) {
            # PID の付いていないファイルは自分の置いたものではないので触らない
            if ($file.Name -notmatch '^(\d+)-') { continue }
            $ownerId = 0
            if ([int]::TryParse($Matches[1], [ref]$ownerId) -and
                $null -ne (Get-Process -Id $ownerId -ErrorAction SilentlyContinue)) { continue }
            Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
        }
    }
}

function New-LauncherOutputFile {
    # 子の出力を受けるファイルを <root>\logs\launcher\ に作る(D-135)。%TEMP% に直接置くと、強制終了で残ったものを
    # 次の起動で見分けられない。名前の先頭にこのランチャーの PID を付け、Clear-LauncherOutputFiles が
    # 動いているランチャーのファイルを消さないようにする。作れなければ同じ名前の付け方で
    # %TEMP%\oscdesk-launcher\ に作る(起動そのものは止めない)
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Root = $OscdeskRoot
    )
    Assert-LauncherRoot -Root $Root -FunctionName 'New-LauncherOutputFile'
    $fileName = '{0}-{1}-{2}.log' -f $PID, $Name, [guid]::NewGuid().ToString('N').Substring(0, 8)
    $primary = Get-LauncherOutputDirectory -Root $Root
    try {
        New-Item -ItemType Directory -Force -Path $primary -ErrorAction Stop | Out-Null
        $path = Join-Path $primary $fileName
        New-Item -ItemType File -Path $path -ErrorAction Stop | Out-Null
        return $path
    } catch {
        $fallback = Get-LauncherFallbackOutputDirectory
        Write-Host "出力ファイルを $primary に作れないため $fallback に置きます: $($_.Exception.Message)" -ForegroundColor Yellow
        New-Item -ItemType Directory -Force -Path $fallback | Out-Null
        $path = Join-Path $fallback $fileName
        New-Item -ItemType File -Path $path | Out-Null
        return $path
    }
}
