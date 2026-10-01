param(
    [string]$TaskSlug,
    [string]$Actor = $env:USERNAME,
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$BaseRef = "origin/main",
    [string]$BranchName,
    [switch]$Fetch,
    [string]$IsolationReason,
    [string]$ExistingWorktreePath,
    [switch]$DryRun,
    [switch]$ConfirmLargeVolume
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($TaskSlug)) {
    $TaskSlug = Read-Host "TaskSlug"
}

if ([string]::IsNullOrWhiteSpace($TaskSlug)) {
    throw "TaskSlug is required."
}

function Normalize-Actor {
    param([string]$Value)
    return ($Value.Trim().ToLowerInvariant() -replace '[^a-z0-9._-]', '-')
}

function Normalize-Slug {
    param([string]$Value)
    $normalized = ($Value.Trim().ToLowerInvariant() -replace '[^a-z0-9._-]', '-')
    if ($normalized -notmatch '^[a-z0-9][a-z0-9._-]{0,95}$') {
        throw "TaskSlug must normalize to ^[a-z0-9][a-z0-9._-]{0,95}$."
    }
    return $normalized
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Ensure-SafeDirectory {
    param([string]$RepoPath)
    $existing = @(git config --global --get-all safe.directory 2>$null)
    $variants = @($RepoPath, $RepoPath.Replace('\', '/'))
    foreach ($variant in $variants) {
        if ($existing -notcontains $variant) {
            git config --global --add safe.directory $variant
        }
    }
}

function Write-WorktreeLifecycleRecord {
    param(
        [Parameter(Mandatory = $true)][string]$RepoPath,
        [Parameter(Mandatory = $true)][string]$TaskSlug,
        [Parameter(Mandatory = $true)][string]$Branch,
        [Parameter(Mandatory = $true)][string]$Base
    )

    $lifecycleRoot = 'C:\CodexRuntime\operator\admin\skincos\storage-governance\worktrees'
    New-Item -ItemType Directory -Force -Path $lifecycleRoot | Out-Null
    $hash = [Security.Cryptography.SHA256]::Create()
    try {
        $digest = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($RepoPath))).Replace('-', '').ToLowerInvariant()
    } finally { $hash.Dispose() }
    $recordPath = Join-Path $lifecycleRoot "$digest.json"
    $record = [ordered]@{
        schema_version = 1
        path = (Resolve-Path -LiteralPath $RepoPath).Path
        owner = $Actor
        task_slug = $TaskSlug
        branch = $Branch
        base_ref = $Base
        commit = ((git -C $RepoPath rev-parse --verify 'HEAD^{commit}' 2>$null | Select-Object -First 1).Trim().ToLowerInvariant())
        created_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        last_seen_at_utc = (Get-Date).ToUniversalTime().ToString('o')
        lifecycle_status = 'active'
        pinned = $false
        lease = $null
        dependency_state = 'unknown'
        associated_artifacts = @()
    }
    $temporary = "$recordPath.$([Guid]::NewGuid().ToString('N')).tmp"
    $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $recordPath -Force
    return $recordPath
}

$normalizedActor = Normalize-Actor -Value $Actor
$normalizedTask = Normalize-Slug -Value $TaskSlug

if (-not $BranchName) {
    $BranchName = "codex/$normalizedActor/$normalizedTask"
}

$expectedBranchName = "codex/$normalizedActor/$normalizedTask"
if ($BranchName -ne $expectedBranchName) {
    throw "BranchName must preserve the task identity and equal '$expectedBranchName'."
}

$actorRoot = Join-Path $WorktreeRoot $normalizedActor
$worktreePath = Join-Path $actorRoot $normalizedTask
if (-not [string]::IsNullOrWhiteSpace($ExistingWorktreePath)) {
    if (-not (Test-Path -LiteralPath $ExistingWorktreePath -PathType Container)) {
        throw "ExistingWorktreePath must exist; it is never a new creation destination."
    }
    $worktreePath = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $ExistingWorktreePath).Path)
}

# Inspect before any directory, global config, fetch, or lifecycle write.
$registered = @(& git -C $ProjectRoot worktree list --porcelain)
if ($LASTEXITCODE -ne 0) { throw "Cannot inspect registered worktrees." }
$lifecycleRecord = $null
$estimatedTrackedBytes = $null
$baseCommit = $null
$action = 'reused'
if (Test-Path -LiteralPath $worktreePath) {
    $target = [IO.Path]::GetFullPath($worktreePath)
    $isRegistered = @($registered | Where-Object {
        $_.StartsWith('worktree ') -and
        [IO.Path]::GetFullPath($_.Substring(9).Replace('/', '\')) -eq $target
    }).Count -eq 1
    if (-not $isRegistered) { throw "Existing path is not a registered project worktree: $worktreePath" }
    $actualBranch = (& git -C $worktreePath symbolic-ref --quiet --short HEAD)
    if ($LASTEXITCODE -ne 0 -or $actualBranch -ne $BranchName) {
        throw "Existing worktree identity differs; preserve it and choose a compatible registered worktree."
    }
    # Return its identity only. This does not acquire a writer lease or reset Git.
} else {
    if ([string]::IsNullOrWhiteSpace($IsolationReason)) {
        throw "Reuse a compatible existing worktree first. New creation requires -IsolationReason (concurrency, incompatible branch/base, or useful isolation). Use -DryRun to inspect."
    }
    $branchExists = (& git -C $ProjectRoot branch --list $BranchName)
    if ($LASTEXITCODE -ne 0) { throw "Cannot inspect branch identity." }
    if ($branchExists) {
        throw "Branch '$BranchName' exists. Inspect git worktree list and reuse its compatible checkout; do not invent another task slug to bypass this."
    }
    if ($Fetch) {
        throw "Implicit fetch is unsupported for new worktrees, including -DryRun. Authorize and run any fetch separately for network/object storage, then rerun without -Fetch. -ConfirmLargeVolume covers the tracked checkout estimate only."
    }
    # Resolve local input exactly once; estimation and checkout use this same SHA.
    $baseCommit = [string](& git -C $ProjectRoot rev-parse --verify --end-of-options "$BaseRef^{commit}" 2>$null)
    if ($LASTEXITCODE -ne 0 -or $baseCommit -notmatch '^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$') {
        throw "BaseRef must resolve to a local commit. Any fetch needs separate authorization before planning."
    }
    $baseCommit = $baseCommit.ToLowerInvariant()
    $treeMetadata = @(& git -C $ProjectRoot ls-tree -r -l $baseCommit)
    if ($LASTEXITCODE -ne 0) { throw "BaseRef unavailable locally; fetch explicitly before planning." }
    $estimatedTrackedBytes = [long]0
    foreach ($entry in $treeMetadata) {
        if ($entry -match '^\d+\s+blob\s+[0-9a-f]+\s+(\d+)\s') {
            $estimatedTrackedBytes += [long]$Matches[1]
        }
    }
    if ($estimatedTrackedBytes -ge 1GB -and -not $ConfirmLargeVolume -and -not $DryRun) {
        throw "Tracked checkout estimate exceeds 1 GiB; obtain explicit volume authorization before using -ConfirmLargeVolume. Dependencies, LFS and hooks may add more."
    }
    $action = 'planned'
    if (-not $DryRun) {
        Ensure-Directory -Path $actorRoot
        Ensure-SafeDirectory -RepoPath $ProjectRoot
        & git -C $ProjectRoot worktree add $worktreePath -b $BranchName $baseCommit
        if ($LASTEXITCODE -ne 0) { throw "Worktree creation failed; preserve any partial state for inspection." }
        Ensure-SafeDirectory -RepoPath $worktreePath
        $lifecycleRecord = Write-WorktreeLifecycleRecord -RepoPath $worktreePath -TaskSlug $normalizedTask -Branch $BranchName -Base $baseCommit
        $action = 'created'
    }
}

$result = [pscustomobject]@{
    actor = $normalizedActor
    taskSlug = $normalizedTask
    branchName = $BranchName
    baseRef = $BaseRef
    baseCommit = $baseCommit
    fetchPerformed = $false
    fetchScope = 'No implicit fetch; authorize and run object refresh separately. Creation volume confirmation does not authorize fetch.'
    planScope = 'Local immutable commit only. To execute the same dry-run revision later, pass baseCommit as -BaseRef.'
    projectRoot = $ProjectRoot
    worktreePath = $worktreePath
    validationCommand = "powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\validate-skincos-worktree.ps1 -ProjectRoot '$worktreePath' -TaskSlug '$normalizedTask' -Mode edit -ExistingRegisteredWorktree"
    lifecycleRecord = $lifecycleRecord
    action = $action
    dryRun = [bool]$DryRun
    isolationReason = $IsolationReason
    estimatedTrackedBytes = $estimatedTrackedBytes
    volumeEstimateScope = 'Tracked blobs only; excludes dependencies, LFS expansion and hook output.'
    writerOwnership = 'Validate task identity and exclusive writer lease/handoff before editing.'
}

$result | ConvertTo-Json -Depth 4
