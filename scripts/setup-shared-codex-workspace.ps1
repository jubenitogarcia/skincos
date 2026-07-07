param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$RuntimeRoot = "C:\CodexRuntime\n8n",
    [switch]$SkipAclRefresh,
    [switch]$DeepAclRefresh
)

$ErrorActionPreference = "Stop"

function Normalize-PathString {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    return $Path.Replace('\', '/').TrimEnd('/').ToLowerInvariant()
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
    $normalizedRepoPath = Normalize-PathString -Path $RepoPath
    $forwardSlashRepoPath = $RepoPath.Replace('\', '/')
    $normalizedExisting = @($existing | ForEach-Object { Normalize-PathString -Path $_ })

    if ($normalizedExisting -notcontains $normalizedRepoPath) {
        git config --global --add safe.directory $RepoPath
        git config --global --add safe.directory $forwardSlashRepoPath
    }
}

function Get-CodexEnvironmentStatus {
    param([string]$RepoPath)

    $environmentPath = Join-Path $RepoPath ".codex\environments\environment.toml"
    $tracked = $false
    $ignored = $false

    if (Test-Path -LiteralPath $environmentPath) {
        $trackedOutput = @(& git -C $RepoPath ls-files .codex/environments/environment.toml 2>$null)
        $tracked = $trackedOutput.Count -gt 0
    }

    & git -C $RepoPath check-ignore .codex/environments/environment.toml 1>$null 2>$null
    $ignored = $LASTEXITCODE -eq 0

    [pscustomobject]@{
        path = $environmentPath
        exists = Test-Path -LiteralPath $environmentPath
        tracked = $tracked
        ignored = $ignored
        manualOpenRequired = $true
        note = "Each Windows user still needs to open the repo or worktree manually in Codex App for the top-bar actions to appear in that account."
    }
}

function Grant-SharedAcl {
    param(
        [string]$TargetPath,
        [switch]$Recursive
    )

    $args = @($TargetPath, "/grant", "Users:(OI)(CI)M")
    if ($Recursive) {
        $args += @("/T", "/C")
    }

    icacls @args | Out-Null
}

Ensure-Directory -Path $ProjectRoot
Ensure-Directory -Path $WorktreeRoot
Ensure-Directory -Path (Join-Path $WorktreeRoot $env:USERNAME)
Ensure-Directory -Path $RuntimeRoot

$runtimeDirs = @(
    $RuntimeRoot,
    (Join-Path $RuntimeRoot "env"),
    (Join-Path $RuntimeRoot "logs"),
    (Join-Path $RuntimeRoot "health"),
    (Join-Path $RuntimeRoot "tmp"),
    (Join-Path $RuntimeRoot "binary-data"),
    (Join-Path $RuntimeRoot "exports"),
    (Join-Path $RuntimeRoot "backups"),
    (Join-Path $RuntimeRoot "n8n-home"),
    (Join-Path $RuntimeRoot "cloudflared"),
    (Join-Path $RuntimeRoot "evolution-api"),
    (Join-Path $RuntimeRoot "evolution-api\instances"),
    (Join-Path $RuntimeRoot "evolution-api\store")
)

foreach ($dir in $runtimeDirs) {
    Ensure-Directory -Path $dir
}

$localStateRoot = Join-Path $env:LOCALAPPDATA "Codex\skincos"
$localStateDirs = @(
    $localStateRoot,
    (Join-Path $localStateRoot "logs"),
    (Join-Path $localStateRoot "tmp"),
    (Join-Path $localStateRoot "profiles"),
    (Join-Path $localStateRoot "env-overrides")
)

foreach ($dir in $localStateDirs) {
    Ensure-Directory -Path $dir
}

$codexEnvironment = Get-CodexEnvironmentStatus -RepoPath $ProjectRoot

if (-not $SkipAclRefresh) {
    Grant-SharedAcl -TargetPath $ProjectRoot -Recursive:$DeepAclRefresh
    Grant-SharedAcl -TargetPath $WorktreeRoot -Recursive:$DeepAclRefresh
    Grant-SharedAcl -TargetPath $RuntimeRoot -Recursive:$DeepAclRefresh
}

Ensure-SafeDirectory -RepoPath $ProjectRoot

$result = [pscustomobject]@{
    projectRoot = $ProjectRoot
    worktreeRoot = $WorktreeRoot
    actorWorktreeRoot = (Join-Path $WorktreeRoot $env:USERNAME)
    runtimeRoot = $RuntimeRoot
    runtimeDirs = $runtimeDirs
    localStateRoot = $localStateRoot
    localStateDirs = $localStateDirs
    codexEnvironment = $codexEnvironment
    aclRefreshed = (-not $SkipAclRefresh.IsPresent)
    deepAclRefresh = $DeepAclRefresh.IsPresent
    currentUser = $env:USERNAME
}

$result | ConvertTo-Json -Depth 4
