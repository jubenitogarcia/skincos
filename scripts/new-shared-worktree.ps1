param(
    [string]$TaskSlug,
    [string]$Actor = $env:USERNAME,
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$BaseRef = "origin/main",
    [string]$BranchName,
    [switch]$Fetch
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
    return ($Value.Trim().ToLowerInvariant() -replace '[^a-z0-9._-]', '-')
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

$actorRoot = Join-Path $WorktreeRoot $normalizedActor
$worktreePath = Join-Path $actorRoot $normalizedTask

Ensure-Directory -Path $actorRoot
Ensure-SafeDirectory -RepoPath $ProjectRoot

if ($Fetch) {
    git -C $ProjectRoot fetch origin
}

if (Test-Path -LiteralPath $worktreePath) {
    throw "Worktree already exists at '$worktreePath'."
}

$branchExists = (& git -C $ProjectRoot branch --list $BranchName)
if ($branchExists) {
    throw "Branch '$BranchName' already exists locally. Choose another TaskSlug or BranchName."
}

git -C $ProjectRoot worktree add $worktreePath -b $BranchName $BaseRef
Ensure-SafeDirectory -RepoPath $worktreePath
$lifecycleRecord = Write-WorktreeLifecycleRecord -RepoPath $worktreePath -TaskSlug $normalizedTask -Branch $BranchName -Base $BaseRef

$result = [pscustomobject]@{
    actor = $normalizedActor
    taskSlug = $normalizedTask
    branchName = $BranchName
    baseRef = $BaseRef
    projectRoot = $ProjectRoot
    worktreePath = $worktreePath
    lifecycleRecord = $lifecycleRecord
}

$result | ConvertTo-Json -Depth 4
