[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)][string]$WorktreePath,
    [string]$ProjectRoot = 'C:\CodexShared\Projetos\skincos',
    [string]$WorktreeRoot = 'C:\CodexShared\Worktrees\skincos\admin',
    [string]$LifecycleRoot = 'C:\CodexRuntime\operator\admin\skincos\storage-governance\worktrees',
    [string]$CodexHome = '%USERPROFILE%\.codex',
    [switch]$RemoveRegenerable,
    [switch]$RemoveWorktree,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$WorktreePath = (Resolve-Path -LiteralPath $WorktreePath).Path
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$WorktreeRoot = (Resolve-Path -LiteralPath $WorktreeRoot).Path
$CodexHome = [Environment]::ExpandEnvironmentVariables($CodexHome)

function Test-Within([string]$Path, [string]$Root) {
    $p = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $r = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    return $p.StartsWith($r + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}
if (-not (Test-Within $WorktreePath $WorktreeRoot)) { throw "Refusing a path outside the approved worktree root: $WorktreePath" }
if ($WorktreePath.Equals($ProjectRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'The canonical checkout cannot be closed by this command.' }

$status = @(& git -C $WorktreePath status --porcelain 2>$null)
$branch = (& git -C $WorktreePath branch --show-current 2>$null | Select-Object -First 1)
$commit = (& git -C $WorktreePath rev-parse --verify 'HEAD^{commit}' 2>$null | Select-Object -First 1)
$merged = $false
if ($branch -and $branch -ne 'main') { & git -C $ProjectRoot merge-base --is-ancestor $branch origin/main 2>$null; $merged = $LASTEXITCODE -eq 0 }
$normalized = ($WorktreePath -replace '/', '\').ToLowerInvariant()
$protected = $normalized -match '\\(immutable|recovery|rollback|release|checkpoint|pinned)([-_][^\\]+|\\|$)'
$processMatch = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { [string]$_.CommandLine -and (([string]$_.CommandLine).Replace('/', '\').ToLowerInvariant().Contains($normalized)) })
$lifecycleRecord = $null
if (Test-Path -LiteralPath $LifecycleRoot -PathType Container) {
    foreach ($recordFile in @(Get-ChildItem -LiteralPath $LifecycleRoot -Force -File -Filter '*.json' -ErrorAction SilentlyContinue)) {
        try {
            $candidateRecord = Get-Content -LiteralPath $recordFile.FullName -Raw | ConvertFrom-Json
            if ($candidateRecord.path -and ([IO.Path]::GetFullPath([string]$candidateRecord.path)).TrimEnd('\').Equals($WorktreePath.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { $lifecycleRecord = $candidateRecord; break }
        } catch {}
    }
}
$sessionMatches = @()
$sessionRoot = Join-Path $CodexHome 'sessions'
if (Test-Path -LiteralPath $sessionRoot -PathType Container) {
    foreach ($sessionFile in @(Get-ChildItem -LiteralPath $sessionRoot -Recurse -Force -File -Filter '*.jsonl' -ErrorAction SilentlyContinue)) {
        try {
            $meta = (Get-Content -LiteralPath $sessionFile.FullName -TotalCount 1 -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop)
            $cwd = ([string]$meta.payload.cwd).Replace('/', '\').TrimEnd('\')
            if ($cwd -and $cwd.StartsWith($WorktreePath.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) { $sessionMatches += [pscustomobject]@{ session_id = [string]$meta.payload.session_id; cwd = $cwd; file = $sessionFile.FullName } }
        } catch {}
    }
}
$lifecyclePinned = $null -ne $lifecycleRecord -and $null -ne $lifecycleRecord.PSObject.Properties['pinned'] -and [bool]$lifecycleRecord.pinned
$lifecycleActive = $null -ne $lifecycleRecord -and $null -ne $lifecycleRecord.PSObject.Properties['lifecycle_status'] -and [string]$lifecycleRecord.lifecycle_status -eq 'active'
$lifecycleBlocked = $lifecyclePinned -or $lifecycleActive
$eligible = $status.Count -eq 0 -and $merged -and -not $protected -and $processMatch.Count -eq 0 -and -not $lifecycleBlocked -and $sessionMatches.Count -eq 0
$regenerableNames = @('node_modules', 'dist', '.vite', '.next', '.turbo', 'coverage', 'playwright-report')
$regenerableDirs = @()
foreach ($dir in @(Get-ChildItem -LiteralPath $WorktreePath -Recurse -Force -Directory -ErrorAction SilentlyContinue | Where-Object { $regenerableNames -contains $_.Name -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } | Sort-Object @{ Expression = { $_.FullName.Length } })) {
    if (-not ($regenerableDirs | Where-Object { Test-Within $dir.FullName $_.FullName })) { $regenerableDirs += $dir }
}
$regenerableInventory = @($regenerableDirs | ForEach-Object {
    $files = @(Get-ChildItem -LiteralPath $_.FullName -Recurse -Force -File -ErrorAction SilentlyContinue)
    $bytes = 0L
    if ($files.Count -gt 0) { $bytes = [int64](($files | Measure-Object Length -Sum).Sum) }
    [pscustomobject]@{ path = $_.FullName; bytes = $bytes; size_gb = [math]::Round($bytes / 1GB, 3) }
})
$regenerableBytes = 0L
if ($regenerableInventory.Count -gt 0) { $regenerableBytes = [int64](($regenerableInventory | Measure-Object bytes -Sum).Sum) }

$record = [ordered]@{
    schema_version = 1
    path = $WorktreePath
    branch = [string]$branch
    commit = [string]$commit
    dirty_count = $status.Count
    merged_into_origin_main = $merged
    protected_by_path = $protected
    process_matches = @($processMatch | ForEach-Object { [ordered]@{ name = $_.Name; pid = $_.ProcessId } })
    lifecycle_record = $null -ne $lifecycleRecord
    lifecycle_blocked = $lifecycleBlocked
    codex_session_matches = $sessionMatches
    eligible = $eligible
    regenerable_inventory = $regenerableInventory
    regenerable_bytes = $regenerableBytes
    regenerable_size_gb = [math]::Round($regenerableBytes / 1GB, 3)
    requested_remove_regenerable = [bool]$RemoveRegenerable
    requested_remove_worktree = [bool]$RemoveWorktree
    applied = [bool]$Apply
    generated_at_utc = [datetime]::UtcNow.ToString('o')
    actions = @()
}
if (-not $eligible) { $record.actions += 'blocked: dirty, unmerged, protected or process-associated worktree' }
elseif ($Apply) {
    if ($RemoveRegenerable) {
        foreach ($entry in $regenerableInventory) {
            if (-not (Test-Path -LiteralPath $entry.path -PathType Container)) { continue }
            if ($PSCmdlet.ShouldProcess($entry.path, 'Remove regenerable output from eligible closed worktree')) {
                Remove-Item -LiteralPath $entry.path -Recurse -Force
                $record.actions += [ordered]@{ action = 'removed'; path = $entry.path; bytes = $entry.bytes; size_gb = $entry.size_gb }
            }
        }
    }
    if ($RemoveWorktree) {
        if ($PSCmdlet.ShouldProcess($WorktreePath, 'Remove eligible clean integrated Git worktree')) {
            & git -C $ProjectRoot worktree remove $WorktreePath
            if ($LASTEXITCODE -ne 0) { throw "git worktree remove failed for $WorktreePath" }
            $record.actions += 'git-worktree-removed'
        }
    }
} else { $record.actions += 'dry-run' }

New-Item -ItemType Directory -Force -Path $LifecycleRoot | Out-Null
$key = [BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash([Text.Encoding]::UTF8.GetBytes($WorktreePath))).Replace('-', '').ToLowerInvariant()
$recordPath = Join-Path $LifecycleRoot "$key.json"
$record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $recordPath -Encoding UTF8
$record | ConvertTo-Json -Depth 12
