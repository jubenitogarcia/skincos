param(
    [string]$TaskSlug,
    [string]$Actor = $env:USERNAME,
    [string]$ProjectRoot,
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$BaseRef = "origin/main",
    [string]$BranchName,
    [switch]$Fetch
)

$ErrorActionPreference = "Stop"

function Resolve-ProjectRoot {
    param([string]$RequestedPath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    return (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
}

function Normalize-Value {
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

if ([string]::IsNullOrWhiteSpace($TaskSlug)) {
    $TaskSlug = Read-Host "TaskSlug"
}

if ([string]::IsNullOrWhiteSpace($TaskSlug)) {
    throw "TaskSlug is required."
}

$ProjectRoot = Resolve-ProjectRoot -RequestedPath $ProjectRoot
$normalizedActor = Normalize-Value -Value $Actor
$normalizedTask = Normalize-Value -Value $TaskSlug

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

[pscustomobject]@{
    actor = $normalizedActor
    taskSlug = $normalizedTask
    branchName = $BranchName
    baseRef = $BaseRef
    projectRoot = $ProjectRoot
    worktreePath = $worktreePath
} | ConvertTo-Json -Depth 4
