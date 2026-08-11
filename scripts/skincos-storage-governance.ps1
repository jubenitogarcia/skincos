[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [ValidateSet('audit', 'cleanup', 'emergency', 'classify-worktrees')]
    [string]$Mode = 'audit',
    [string]$PolicyPath = '',
    [string]$OutputPath = '',
    [switch]$Deep,
    [switch]$Apply,
    [switch]$AllowWorktreeCleanup,
    [switch]$AllowWorktreeRemoval,
    [switch]$AllowArtifactHardlinkDeduplication,
    [switch]$IncludeWorktreeStatus,
    [switch]$IncludeFocalArtifacts,
    [switch]$IncludeWorktreeFocalArtifacts,
    [int]$MaxWorktrees = 700
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$script:ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:RepositoryRoot = Split-Path -Parent $script:ScriptRoot
if ([string]::IsNullOrWhiteSpace($PolicyPath)) {
    $PolicyPath = Join-Path $script:RepositoryRoot 'ops\codex\storage-retention-policy.json'
}

function Expand-StoragePath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $expanded = [Environment]::ExpandEnvironmentVariables($Path)
    if ($expanded.StartsWith('~')) {
        $expanded = Join-Path $HOME $expanded.Substring(1).TrimStart('\', '/')
    }
    return [IO.Path]::GetFullPath($expanded)
}

function Read-Policy {
    if (-not (Test-Path -LiteralPath $PolicyPath -PathType Leaf)) {
        throw "Storage policy was not found: $PolicyPath"
    }
    $policy = Get-Content -Raw -LiteralPath $PolicyPath | ConvertFrom-Json
    if ([int]$policy.schemaVersion -ne 1) { throw 'Unsupported storage policy schema.' }
    return $policy
}

function Write-AtomicJson {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Value)
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
    $json = $Value | ConvertTo-Json -Depth 30
    [IO.File]::WriteAllText($temporary, $json, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Append-JsonLine {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)]$Value)
    $parent = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    [IO.File]::AppendAllText($Path, (($Value | ConvertTo-Json -Depth 30 -Compress) + "`n"), (New-Object Text.UTF8Encoding($false)))
}

function Get-BytesGB {
    param([long]$Bytes)
    return [math]::Round($Bytes / 1GB, 3)
}

function Get-DriveSnapshot {
    $drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    [pscustomobject]@{
        device = 'C:'
        size_bytes = [int64]$drive.Size
        free_bytes = [int64]$drive.FreeSpace
        size_gb = Get-BytesGB $drive.Size
        free_gb = Get-BytesGB $drive.FreeSpace
        free_percent = [math]::Round(100 * $drive.FreeSpace / $drive.Size, 3)
    }
}

function Get-ThresholdState {
    param([double]$FreeGB, [object]$Thresholds)
    if ($FreeGB -lt [double]$Thresholds.emergency) { return 'emergency' }
    if ($FreeGB -lt [double]$Thresholds.critical) { return 'critical' }
    if ($FreeGB -lt [double]$Thresholds.high) { return 'high' }
    if ($FreeGB -lt [double]$Thresholds.warning) { return 'warning' }
    return 'healthy'
}

function Test-PathWithin {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Root)
    $candidate = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $boundary = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    return $candidate.Equals($boundary, [StringComparison]::OrdinalIgnoreCase) -or
        $candidate.StartsWith($boundary + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Get-ProcessSnapshot {
    $interesting = @('node', 'git', 'wsl', 'wslhost', 'vmmemWSL', 'workerd', 'npm', 'pnpm', 'wrangler')
    $rows = @()
    foreach ($process in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $interesting -contains $_.Name.Replace('.exe', '') })) {
        $rows += [pscustomobject]@{
            name = [string]$process.Name
            pid = [int]$process.ProcessId
            parent_pid = [int]$process.ParentProcessId
            started = $null
            commandline_path_match = $false
        }
    }
    return $rows
}

function Get-FileLengthSafe {
    param([Parameter(Mandatory = $true)][string]$Path)
    try { return [int64](Get-Item -LiteralPath $Path -Force -ErrorAction Stop).Length } catch { return 0L }
}

function Get-DirectDirectorySnapshot {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return [pscustomobject]@{ path = $Path; exists = $false; files = 0; directories = 0; bytes = 0L; size_gb = 0; errors = 0 }
    }
    $files = 0L; $bytes = 0L; $directories = 0L; $errors = 0L
    try {
        foreach ($entry in @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop)) {
            if ($entry.PSIsContainer) { $directories++ } else { $files++; $bytes += [int64]$entry.Length }
        }
    } catch { $errors++ }
    [pscustomobject]@{ path = $Path; exists = $true; files = $files; directories = $directories; bytes = $bytes; size_gb = Get-BytesGB $bytes; errors = $errors }
}

function Get-DeepDirectorySnapshot {
    param([Parameter(Mandatory = $true)][string]$Path, [int]$TopFiles = 20)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        return [pscustomobject]@{ path = $Path; exists = $false; files = 0; directories = 0; bytes = 0L; size_gb = 0; errors = 0; top_files = @(); extensions = @{} }
    }
    $files = 0L; $directories = 0L; $bytes = 0L; $errors = 0L; $largest = @(); $extensions = @{}
    try {
        foreach ($entry in Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue) {
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            $files++; $bytes += [int64]$entry.Length
            $extension = if ([string]::IsNullOrWhiteSpace($entry.Extension)) { '[none]' } else { $entry.Extension.ToLowerInvariant() }
            if (-not $extensions.ContainsKey($extension)) { $extensions[$extension] = 0L }
            $extensions[$extension] += [int64]$entry.Length
            if ($largest.Count -lt $TopFiles) { $largest += [pscustomobject]@{ path = $entry.FullName; bytes = [int64]$entry.Length } }
            else {
                $smallest = $largest | Sort-Object bytes | Select-Object -First 1
                if ([int64]$entry.Length -gt [int64]$smallest.bytes) {
                    $largest = @($largest | Where-Object { $_.path -ne $smallest.path }) + [pscustomobject]@{ path = $entry.FullName; bytes = [int64]$entry.Length }
                }
            }
        }
        Get-ChildItem -LiteralPath $Path -Recurse -Force -Directory -ErrorAction SilentlyContinue | ForEach-Object { $directories++ }
    } catch { $errors++ }
    [pscustomobject]@{
        path = $Path; exists = $true; files = $files; directories = $directories; bytes = $bytes; size_gb = Get-BytesGB $bytes; errors = $errors
        top_files = @($largest | Sort-Object bytes -Descending)
        extensions = [ordered]@{}
    } | ForEach-Object {
        foreach ($key in ($extensions.Keys | Sort-Object)) { $_.extensions[$key] = $extensions[$key] }
        $_
    }
}

function Get-FileSnapshot {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $item = Get-Item -LiteralPath $Path -Force
    [pscustomobject]@{ path = $Path; exists = $true; bytes = [int64]$item.Length; size_gb = Get-BytesGB $item.Length; last_write_utc = $item.LastWriteTimeUtc.ToString('o') }
}

function Get-CodexSessionCwds {
    param([Parameter(Mandatory = $true)][string]$CodexHome)
    $sessionRoot = Join-Path $CodexHome 'sessions'
    if (-not (Test-Path -LiteralPath $sessionRoot -PathType Container)) { return @() }
    $rows = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $sessionRoot -Recurse -Force -File -Filter '*.jsonl' -ErrorAction SilentlyContinue)) {
        try {
            $firstLine = Get-Content -LiteralPath $file.FullName -TotalCount 1 -ErrorAction Stop
            $meta = $firstLine | ConvertFrom-Json -ErrorAction Stop
            if ($meta.payload.cwd) {
                $rows += [pscustomobject]@{
                    session_id = [string]$meta.payload.session_id
                    cwd = [string]$meta.payload.cwd
                    file = $file.FullName
                }
            }
        } catch {}
    }
    return $rows
}

function Get-WorktreeRecords {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$WorktreeRoot,
        [string]$LifecycleRoot = '',
        [object[]]$ProcessDetails = @(),
        [object[]]$SessionDetails = @(),
        [switch]$IncludeStatus
    )
    $lines = @(& git -C $ProjectRoot worktree list --porcelain 2>$null)
    $lifecycle = @{}
    if (-not [string]::IsNullOrWhiteSpace($LifecycleRoot) -and (Test-Path -LiteralPath $LifecycleRoot -PathType Container)) {
        foreach ($recordFile in Get-ChildItem -LiteralPath $LifecycleRoot -Force -File -Filter '*.json' -ErrorAction SilentlyContinue) {
            try {
                $record = Get-Content -Raw -LiteralPath $recordFile.FullName | ConvertFrom-Json
                if ($record.path) { $lifecycle[(($record.path -replace '/', '\').TrimEnd('\')).ToLowerInvariant()] = $record }
            } catch {}
        }
    }
    $records = @(); $current = $null
    foreach ($line in $lines + '') {
        if ($line -like 'worktree *') { $current = [ordered]@{ path = $line.Substring(9); branch = $null; commit = $null; detached = $false }; continue }
        if ($line -like 'HEAD *' -and $current) { $current.commit = $line.Substring(5); continue }
        if ($line -like 'branch refs/heads/*' -and $current) { $current.branch = $line.Substring(18); continue }
        if ($line -eq 'detached' -and $current) { $current.detached = $true; continue }
        if ([string]::IsNullOrWhiteSpace($line) -and $current) {
            $path = [string]$current.path
            $exists = Test-Path -LiteralPath $path -PathType Container
            $dirty = $null; $merged = $false; $lastWrite = $null
            if ($exists -and $IncludeStatus) {
                $dirty = @(& git -C $path status --porcelain 2>$null).Count
                if ($current.branch -and $current.branch -ne 'main') { & git -C $ProjectRoot merge-base --is-ancestor $current.branch origin/main 2>$null; $merged = $LASTEXITCODE -eq 0 }
                try { $lastWrite = (Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc.ToString('o') } catch {}
            }
            $normalized = ($path -replace '/', '\').TrimEnd('\', '/').ToLowerInvariant()
            $rootNorm = ($WorktreeRoot -replace '/', '\').TrimEnd('\', '/').ToLowerInvariant()
            $protected = $normalized -match '\\(immutable|recovery|rollback|release|checkpoint|pinned)([-_][^\\]+|\\|$)'
            $life = if ($lifecycle.ContainsKey($normalized)) { $lifecycle[$normalized] } else { $null }
            $processMatches = @($ProcessDetails | Where-Object { [string]$_.CommandLine -and ([string]$_.CommandLine).Replace('/', '\').ToLowerInvariant().Contains($normalized) })
            $processAssociated = $processMatches.Count -gt 0
            $sessionMatches = @($SessionDetails | Where-Object { [string]$_.cwd -and ([string]$_.cwd).Replace('/', '\').TrimEnd('\').ToLowerInvariant().StartsWith($normalized) })
            $sessionAssociated = $sessionMatches.Count -gt 0
            $lifecyclePinned = $null -ne $life -and $null -ne $life.PSObject.Properties['pinned'] -and [bool]$life.pinned
            $lifecycleActive = $null -ne $life -and $null -ne $life.PSObject.Properties['lifecycle_status'] -and [string]$life.lifecycle_status -eq 'active'
            $classification = if (-not $exists) { 'orphan' } elseif ($protected -or $lifecyclePinned) { 'rollback-required' } elseif ($processAssociated -or $sessionAssociated) { 'active' } elseif ($null -eq $dirty) { 'uncertain' } elseif ($dirty -gt 0 -or $lifecycleActive) { 'potential-active' } elseif ($merged) { 'integrated-clean' } else { 'uncertain' }
            $classCode = switch ($classification) { 'active' { 'A' } 'potential-active' { 'B' } 'integrated-clean' { 'C' } 'orphan' { 'D' } 'rollback-required' { 'E' } default { 'F' } }
            $records += [pscustomobject]@{ path = $path; under_worktree_root = $normalized.StartsWith($rootNorm + '\'); branch = $current.branch; commit = $current.commit; detached = [bool]$current.detached; exists = $exists; dirty_count = $dirty; merged_into_origin_main = $merged; last_write_utc = $lastWrite; protected_by_path = $protected; lifecycle_record = $null -ne $life; lifecycle_pinned = $lifecyclePinned; process_associated = $processAssociated; process_count = $processMatches.Count; codex_session_cwd_associated = $sessionAssociated; codex_session_count = $sessionMatches.Count; classification_code = $classCode; classification = $classification; eligible_for_cleanup = ($classification -eq 'integrated-clean' -and $normalized.StartsWith($rootNorm + '\') -and -not $processAssociated -and -not $sessionAssociated -and -not $lifecyclePinned) }
            $current = $null
        }
    }
    return $records
}

function Get-SourceTarRecords {
    param([Parameter(Mandatory = $true)][string]$RuntimeRoot, [string[]]$RelativeRoots = @(), [switch]$ComputeHash)
    $root = Join-Path $RuntimeRoot 'operator\admin\skincos'
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { return @() }
    $scanRoots = @($root)
    if (@($RelativeRoots).Count -gt 0) { $scanRoots = @($RelativeRoots | ForEach-Object { Join-Path $root $_ }) }
    $files = @()
    foreach ($scanRoot in $scanRoots) {
        if (-not (Test-Path -LiteralPath $scanRoot -PathType Container)) { continue }
        $files += @(Get-ChildItem -LiteralPath $scanRoot -Recurse -Force -File -Filter '*source*.tar*' -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'source.*\.tar(?:\.gz)?$' })
    }
    $rows = foreach ($file in $files) {
        $hash = $null
        if ($ComputeHash) { try { $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256 -ErrorAction Stop).Hash.ToUpperInvariant() } catch {} }
        [pscustomobject]@{ path = $file.FullName; bytes = [int64]$file.Length; size_gb = Get-BytesGB $file.Length; sha256 = $hash; last_write_utc = $file.LastWriteTimeUtc.ToString('o') }
    }
    return $rows
}

function Get-WorkerdRecords {
    param([Parameter(Mandatory = $true)][string[]]$Roots)
    $rows = [System.Collections.Generic.List[object]]::new()
    foreach ($root in $Roots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        $pending = [System.Collections.Generic.Stack[string]]::new()
        $pending.Push([IO.Path]::GetFullPath($root))
        while ($pending.Count -gt 0) {
            $current = $pending.Pop()
            try {
                foreach ($filePath in [IO.Directory]::EnumerateFiles($current, 'workerd*', [IO.SearchOption]::TopDirectoryOnly)) {
                    try {
                        $file = Get-Item -LiteralPath $filePath -Force -ErrorAction Stop
                        $rows.Add([pscustomobject]@{ path = $file.FullName; bytes = [int64]$file.Length; size_mb = [math]::Round($file.Length / 1MB, 3); sha256 = $null; link_type = [string]$file.LinkType })
                    } catch {}
                }
                foreach ($directoryPath in [IO.Directory]::EnumerateDirectories($current)) {
                    try {
                        $attributes = [IO.File]::GetAttributes($directoryPath)
                        if (($attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) { $pending.Push($directoryPath) }
                    } catch {}
                }
            } catch {}
        }
    }
    return @($rows)
}

function Get-CleanupCandidates {
    param([Parameter(Mandatory = $true)]$Policy, [Parameter(Mandatory = $true)]$Now)
    $rows = @()
    $cutoff = $Now.AddDays(-[double]$Policy.retentionDays.temporary)
    foreach ($rootValue in @($Policy.safeCleanupRoots)) {
        $root = Expand-StoragePath ([string]$rootValue)
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($file in @(Get-ChildItem -LiteralPath $root -Recurse -Force -File -ErrorAction SilentlyContinue)) {
            if ($file.LastWriteTimeUtc -gt $cutoff -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
            if ([string]$file.Name -match '\.(env|dev\.vars|cloudflared|jsonl|sqlite|vhdx|dmp|etl|tar|zip|mp4|mov|MOV|HEIC)$') { continue }
            $rows += [pscustomobject]@{ path = $file.FullName; safe_root = $root; category = 'regenerable-temporary'; bytes = [int64]$file.Length; size_gb = Get-BytesGB $file.Length; reason = "older-than-$([int]$Policy.retentionDays.temporary)-days"; eligible = $true }
        }
    }
    return $rows | Sort-Object bytes -Descending
}

function Remove-SafeFile {
    [CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
    param([Parameter(Mandatory = $true)]$Candidate, [switch]$Execute)
    if (-not (Test-PathWithin -Path $Candidate.path -Root $Candidate.safe_root)) { return [pscustomobject]@{ path = $Candidate.path; action = 'blocked'; bytes = $Candidate.bytes; reason = 'outside-safe-root' } }
    if (-not $Execute) { return [pscustomobject]@{ path = $Candidate.path; action = 'dry-run'; bytes = $Candidate.bytes; reason = $Candidate.reason } }
    if ($PSCmdlet.ShouldProcess($Candidate.path, 'Remove regenerable expired temporary')) {
        try { Remove-Item -LiteralPath $Candidate.path -Force -ErrorAction Stop; return [pscustomobject]@{ path = $Candidate.path; action = 'removed'; bytes = $Candidate.bytes; reason = $Candidate.reason } }
        catch { return [pscustomobject]@{ path = $Candidate.path; action = 'error'; bytes = $Candidate.bytes; reason = $_.Exception.Message } }
    }
    return [pscustomobject]@{ path = $Candidate.path; action = 'what-if'; bytes = $Candidate.bytes; reason = $Candidate.reason }
}

function Get-RegenerableInventory {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string[]]$Names
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return [pscustomobject]@{ entries = @(); bytes = 0L } }
    $topDirs = @()
    foreach ($dir in @(Get-ChildItem -LiteralPath $Path -Recurse -Force -Directory -ErrorAction SilentlyContinue | Where-Object { $Names -contains $_.Name -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } | Sort-Object @{ Expression = { $_.FullName.Length } })) {
        if (-not ($topDirs | Where-Object { Test-PathWithin -Path $dir.FullName -Root $_.FullName })) { $topDirs += $dir }
    }
    $entries = @()
    foreach ($dir in $topDirs) {
        $bytes = 0L
        $files = @(Get-ChildItem -LiteralPath $dir.FullName -Recurse -Force -File -ErrorAction SilentlyContinue)
        if ($files.Count -gt 0) { $bytes = [int64](($files | Measure-Object Length -Sum).Sum) }
        $entries += [pscustomobject]@{ path = $dir.FullName; bytes = $bytes; size_gb = [math]::Round($bytes / 1GB, 3) }
    }
    $total = 0L
    if ($entries.Count -gt 0) { $total = [int64](($entries | Measure-Object bytes -Sum).Sum) }
    [pscustomobject]@{ entries = $entries; bytes = $total }
}

function Get-WorktreeCleanupCandidates {
    param([object[]]$Worktrees, [Parameter(Mandatory = $true)]$Policy, [Parameter(Mandatory = $true)]$Now)
    $cutoff = $Now.AddDays(-[double]$Policy.retentionDays.endedWorktree)
    foreach ($worktree in @($Worktrees | Where-Object { $_.eligible_for_cleanup -and $_.last_write_utc })) {
        $lastWrite = $null
        try { $lastWrite = [datetime]$worktree.last_write_utc } catch {}
        if ($null -eq $lastWrite -or $lastWrite.ToUniversalTime() -gt $cutoff) { continue }
        $inventory = Get-RegenerableInventory -Path $worktree.path -Names @($Policy.regenerableDirectoryNames)
        [pscustomobject]@{
            path = $worktree.path
            category = 'integrated-clean-worktree'
            classification = $worktree.classification
            classification_code = $worktree.classification_code
            branch = $worktree.branch
            commit = $worktree.commit
            last_write_utc = $worktree.last_write_utc
            bytes = $inventory.bytes
            size_gb = [math]::Round($inventory.bytes / 1GB, 3)
            regenerable_inventory = $inventory.entries
            reason = "clean-merged-and-older-than-$([int]$Policy.retentionDays.endedWorktree)-days"
            eligible = $true
        }
    }
}

$Policy = Read-Policy
$now = [DateTime]::UtcNow
$stateRoot = Expand-StoragePath ([string]$Policy.paths.privateStateRoot)
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$drive = Get-DriveSnapshot
$thresholdState = Get-ThresholdState -FreeGB $drive.free_gb -Thresholds $Policy.thresholdsGB
$paths = [ordered]@{}
foreach ($property in $Policy.paths.PSObject.Properties) { $paths[$property.Name] = Expand-StoragePath ([string]$property.Value) }
$quickRoots = @($paths.projectRoot, $paths.worktreeRoot, $paths.runtimeRoot, $paths.codexHome)
$directorySnapshots = @()
foreach ($root in $quickRoots) { $directorySnapshots += Get-DirectDirectorySnapshot -Path $root }
if ($Deep -or [bool]$Policy.defaults.deepScan) {
    $directorySnapshots = @()
    foreach ($root in $quickRoots) { $directorySnapshots += Get-DeepDirectorySnapshot -Path $root }
}
$fileSnapshots = @()
foreach ($filePath in @('C:\pagefile.sys', 'C:\swapfile.sys', 'C:\Users\admin\AppData\Local\wsl\{aa973afc-c57c-49d3-810d-ff364865ce84}\ext4.vhdx', 'C:\WSL\Ubuntu-24.04\ext4.vhdx')) {
    $snapshot = Get-FileSnapshot -Path $filePath
    if ($null -ne $snapshot) { $fileSnapshots += $snapshot }
}
$processes = @(Get-ProcessSnapshot)
$worktrees = @()
$codexSessionCwds = @()
if ($IncludeWorktreeStatus -or $Mode -in @('cleanup', 'emergency', 'classify-worktrees')) {
    $processDetails = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine })
    $codexSessionCwds = @(Get-CodexSessionCwds -CodexHome $paths.codexHome)
    $worktrees = @(Get-WorktreeRecords -ProjectRoot $paths.projectRoot -WorktreeRoot $paths.worktreeRoot -LifecycleRoot (Join-Path $stateRoot 'worktrees') -ProcessDetails $processDetails -SessionDetails $codexSessionCwds -IncludeStatus)
    if ($worktrees.Count -gt $MaxWorktrees) { throw "Refusing to classify $($worktrees.Count) worktrees; MaxWorktrees=$MaxWorktrees." }
}
$sourceTars = @()
$workerd = @()
if ($Deep -or $IncludeFocalArtifacts) {
    $sourceTarRoots = @()
    if (-not $Deep) { $sourceTarRoots = @($Policy.protectedArtifactDirectories) }
    $sourceTars = @(Get-SourceTarRecords -RuntimeRoot $paths.runtimeRoot -RelativeRoots $sourceTarRoots -ComputeHash:$Deep)
    $focalRoots = @($paths.projectRoot)
    if ($Deep -or $IncludeWorktreeFocalArtifacts) { $focalRoots = @($paths.projectRoot, $paths.worktreeRoot, (Join-Path $paths.runtimeRoot 'operator\admin\skincos\source')) }
    $workerd = @(Get-WorkerdRecords -Roots $focalRoots)
}
$candidates = @()
$worktreeCandidates = @()
$actions = @()
if ($Mode -in @('cleanup', 'emergency', 'classify-worktrees')) {
    $candidates = @(Get-CleanupCandidates -Policy $Policy -Now $now)
    $worktreeCandidates = @(Get-WorktreeCleanupCandidates -Worktrees $worktrees -Policy $Policy -Now $now)
    foreach ($candidate in $candidates) { $actions += Remove-SafeFile -Candidate $candidate -Execute:$Apply }
    if ($AllowWorktreeCleanup) {
        foreach ($candidate in $worktreeCandidates) {
            if (-not $Apply) { $actions += [pscustomobject]@{ path = $candidate.path; action = 'dry-run'; bytes = 0L; reason = $candidate.reason } ; continue }
            if ($PSCmdlet.ShouldProcess($candidate.path, 'Close eligible integrated clean worktree and remove regenerable contents')) {
                $closeScript = Join-Path $script:ScriptRoot 'close-shared-worktree.ps1'
                $closeParams = [ordered]@{ WorktreePath = $candidate.path; ProjectRoot = $paths.projectRoot; WorktreeRoot = $paths.worktreeRoot; RemoveRegenerable = $true; Apply = $true }
                if ($AllowWorktreeRemoval) { $closeParams.RemoveWorktree = $true }
                $closeOutput = @(& $closeScript @closeParams -Confirm:$false 2>&1)
                $actions += [pscustomobject]@{ path = $candidate.path; action = if ($LASTEXITCODE -eq 0) { if ($AllowWorktreeRemoval) { 'worktree-closed' } else { 'worktree-regenerable-cleaned' } } else { 'worktree-close-error' }; bytes = [int64]$candidate.bytes; reason = (@($closeOutput) -join "`n") }
            }
        }
    }
}
$document = [ordered]@{
    schema_version = 1
    generated_at_utc = $now.ToString('o')
    mode = $Mode
    applied = [bool]$Apply
    deep_scan = [bool]$Deep
    focal_artifact_scan = [bool]($Deep -or $IncludeFocalArtifacts)
    focal_worktree_scan = [bool]($Deep -or $IncludeWorktreeFocalArtifacts)
    source_tar_hashes_computed = [bool]$Deep
    threshold_state = $thresholdState
    drive = $drive
    paths = $paths
    directories = $directorySnapshots
    files = $fileSnapshots
    processes = $processes
    codex_session_cwds = $codexSessionCwds
    worktrees = $worktrees
    worktree_cleanup_candidates = $worktreeCandidates
    source_tars = $sourceTars
    workerd = $workerd
    cleanup_candidates = $candidates
    actions = $actions
    limitations = @(
        'Directory sizes are logical file-length sums; hardlinks can overcount physical allocation.',
        'Reparse points are skipped by deep scans.',
        'WSL VHDX mutation is never performed by this script.',
        'Codex sessions and protected release/checkpoint directories are report-only unless a separate explicit policy is added.'
    )
}
$latestPath = Join-Path $stateRoot 'latest.json'
$historyPath = Join-Path $stateRoot 'history.jsonl'
Write-AtomicJson -Path $latestPath -Value $document
Append-JsonLine -Path $historyPath -Value $document
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) { Write-AtomicJson -Path (Expand-StoragePath $OutputPath) -Value $document }
$document | ConvertTo-Json -Depth 30
