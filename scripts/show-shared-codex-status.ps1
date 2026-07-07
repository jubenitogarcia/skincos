param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$RuntimeRoot = "C:\CodexRuntime\n8n"
)

$ErrorActionPreference = "Stop"

function Normalize-PathString {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    return $Path.Replace('\', '/').TrimEnd('/').ToLowerInvariant()
}

function Get-GitStatusSummary {
    param([string]$RepoPath)

    $branch = (& git -C $RepoPath rev-parse --abbrev-ref HEAD).Trim()
    $statusLines = @(& git -C $RepoPath status --short)

    [pscustomobject]@{
        branch = $branch
        dirtyCount = $statusLines.Count
        isDirty = $statusLines.Count -gt 0
        sample = @($statusLines | Select-Object -First 10)
    }
}

function Get-WorktreeSummary {
    param([string]$Root)

    if (-not (Test-Path -LiteralPath $Root)) {
        return @()
    }

    $items = @()
    foreach ($actorDir in Get-ChildItem -LiteralPath $Root -Directory -Force | Sort-Object Name) {
        foreach ($taskDir in Get-ChildItem -LiteralPath $actorDir.FullName -Directory -Force | Sort-Object Name) {
            $branch = $null
            if (Test-Path -LiteralPath (Join-Path $taskDir.FullName '.git')) {
                $branch = (& git -C $taskDir.FullName rev-parse --abbrev-ref HEAD 2>$null).Trim()
            }

            $items += [pscustomobject]@{
                actor = $actorDir.Name
                task = $taskDir.Name
                path = $taskDir.FullName
                branch = $branch
            }
        }
    }

    return $items
}

$safeDirectories = @(git config --global --get-all safe.directory 2>$null)
$normalizedProjectRoot = Normalize-PathString -Path $ProjectRoot
$normalizedSafeDirectories = @($safeDirectories | ForEach-Object { Normalize-PathString -Path $_ })

$localStateRoot = Join-Path $env:LOCALAPPDATA "Codex\skincos"
$runtimeEnvRoot = Join-Path $RuntimeRoot "env"
$status = [pscustomobject]@{
    currentUser = $env:USERNAME
    computerName = $env:COMPUTERNAME
    projectRoot = $ProjectRoot
    projectStatus = Get-GitStatusSummary -RepoPath $ProjectRoot
    worktreeRoot = $WorktreeRoot
    worktrees = @(Get-WorktreeSummary -Root $WorktreeRoot)
    safeDirectoryRegistered = $normalizedSafeDirectories -contains $normalizedProjectRoot
    safeDirectories = $safeDirectories
    localStateRoot = $localStateRoot
    localStateExists = Test-Path -LiteralPath $localStateRoot
    runtimeRoot = $RuntimeRoot
    runtimeExists = Test-Path -LiteralPath $RuntimeRoot
    runtimeEnvRoot = $runtimeEnvRoot
    runtimeEnvFiles = @(
        "n8n.env",
        "n8n-business.env",
        "evolution-api.env"
    ) | ForEach-Object {
        $path = Join-Path $runtimeEnvRoot $_
        [pscustomobject]@{
            name = $_
            exists = Test-Path -LiteralPath $path
            path = $path
        }
    }
}

$status | ConvertTo-Json -Depth 5
