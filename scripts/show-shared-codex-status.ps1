param(
    [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"

function Resolve-ProjectRoot {
    param([string]$RequestedPath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    return (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
}

$ProjectRoot = Resolve-ProjectRoot -RequestedPath $ProjectRoot
$branch = (& git -C $ProjectRoot branch --show-current).Trim()
$status = @(git -C $ProjectRoot status --short)
$worktrees = @(git -C $ProjectRoot worktree list --porcelain)
$safeDirectories = @(git config --global --get-all safe.directory 2>$null)

[pscustomobject]@{
    projectRoot = $ProjectRoot
    branch = $branch
    hasLocalChanges = ($status.Count -gt 0)
    status = $status
    worktrees = $worktrees
    safeDirectories = $safeDirectories
} | ConvertTo-Json -Depth 4
