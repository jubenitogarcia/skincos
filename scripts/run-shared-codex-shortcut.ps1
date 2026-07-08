param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        "SharedStatus",
        "CodexContext",
        "ThreadBootstrap",
        "NewWorktree"
    )]
    [string]$Action,
    [string]$ProjectRoot,
    [string]$TaskSlug,
    [string]$TaskBrief,
    [string[]]$ValidationCommands
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Resolve-ProjectRoot {
    param([string]$RequestedPath)

    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    return (Resolve-Path -LiteralPath (Split-Path -Parent $scriptRoot)).Path
}

$ProjectRoot = Resolve-ProjectRoot -RequestedPath $ProjectRoot

switch ($Action) {
    "SharedStatus" {
        & (Join-Path $scriptRoot "show-shared-codex-status.ps1") -ProjectRoot $ProjectRoot
    }
    "CodexContext" {
        Push-Location $ProjectRoot
        try {
            npm run codex:context
        }
        finally {
            Pop-Location
        }
    }
    "ThreadBootstrap" {
        $params = @{
            TaskSlug = $TaskSlug
            TaskBrief = $TaskBrief
        }

        if ($ValidationCommands) {
            $params.ValidationCommands = $ValidationCommands
        }

        if ([string]::IsNullOrWhiteSpace($TaskSlug) -and [string]::IsNullOrWhiteSpace($TaskBrief)) {
            $params.Interactive = $true
        }

        & (Join-Path $scriptRoot "print-codex-thread-bootstrap.ps1") @params
    }
    "NewWorktree" {
        & (Join-Path $scriptRoot "new-shared-worktree.ps1") -TaskSlug $TaskSlug -ProjectRoot $ProjectRoot -Fetch
    }
}
