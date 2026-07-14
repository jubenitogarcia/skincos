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

$result = [pscustomobject]@{
    actor = $normalizedActor
    taskSlug = $normalizedTask
    branchName = $BranchName
    baseRef = $BaseRef
    projectRoot = $ProjectRoot
    worktreePath = $worktreePath
}

$result | ConvertTo-Json -Depth 4
