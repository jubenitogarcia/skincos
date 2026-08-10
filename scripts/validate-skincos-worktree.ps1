[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [string]$TaskSlug,
    [string]$Branch,
    [ValidateSet("edit", "read-only")]
    [string]$Mode = "edit",
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$CanonicalRoot = "C:\CodexShared\Projetos\skincos"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-ExistingPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Path does not exist: $Path"
    }
    return [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path).TrimEnd([IO.Path]::DirectorySeparatorChar)
}

function Test-PathWithin {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )
    $normalizedPath = $Path.TrimEnd([IO.Path]::DirectorySeparatorChar)
    $normalizedRoot = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar)
    return $normalizedPath.Equals($normalizedRoot, [StringComparison]::OrdinalIgnoreCase) -or
        $normalizedPath.StartsWith($normalizedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Normalize-Slug {
    param([Parameter(Mandatory = $true)][string]$Value)
    $normalized = $Value.Trim().ToLowerInvariant()
    if ($normalized -notmatch '^[a-z0-9][a-z0-9._-]{0,95}$') {
        throw "TaskSlug must match ^[a-z0-9][a-z0-9._-]{0,95}$"
    }
    return $normalized
}

$resolvedProjectRoot = Resolve-ExistingPath -Path $ProjectRoot
$resolvedCanonicalRoot = Resolve-ExistingPath -Path $CanonicalRoot
$resolvedWorktreeRoot = Resolve-ExistingPath -Path $WorktreeRoot
$gitTop = (& git -C $resolvedProjectRoot rev-parse --show-toplevel 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitTop)) {
    throw "ProjectRoot is not a Git checkout: $resolvedProjectRoot"
}
$gitTop = Resolve-ExistingPath -Path $gitTop
$actualBranch = (& git -C $resolvedProjectRoot symbolic-ref --quiet --short HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($actualBranch)) {
    throw "A non-trivial SKINCOS edit may not run from a detached HEAD."
}

if ($Mode -eq "read-only") {
    if (-not (Test-PathWithin -Path $gitTop -Root $resolvedCanonicalRoot) -and
        -not (Test-PathWithin -Path $gitTop -Root $resolvedWorktreeRoot)) {
        throw "Read-only context must be the canonical checkout or an approved SKINCOS worktree."
    }
}
else {
    if ($gitTop.Equals($resolvedCanonicalRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Non-trivial SKINCOS edits are forbidden in the shared canonical checkout. Create a dedicated worktree."
    }
    if (-not (Test-PathWithin -Path $gitTop -Root $resolvedWorktreeRoot)) {
        throw "Non-trivial SKINCOS edits require a worktree below $resolvedWorktreeRoot."
    }
    if ([string]::IsNullOrWhiteSpace($TaskSlug)) {
        throw "TaskSlug is required for a non-trivial SKINCOS edit."
    }
    $normalizedTask = Normalize-Slug -Value $TaskSlug
    $relative = $gitTop.Substring($resolvedWorktreeRoot.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
    $segments = @($relative.Split([IO.Path]::DirectorySeparatorChar, [StringSplitOptions]::RemoveEmptyEntries))
    if ($segments.Count -ne 2) {
        throw "Worktree must be exactly <actor>\<task-slug> below $resolvedWorktreeRoot."
    }
    if ($segments[1].ToLowerInvariant() -ne $normalizedTask) {
        throw "TaskSlug '$normalizedTask' does not match worktree directory '$($segments[1])'."
    }
    $expectedBranch = "codex/$($segments[0].ToLowerInvariant())/$normalizedTask"
    if ($actualBranch -ne $expectedBranch) {
        throw "Branch '$actualBranch' does not match the dedicated worktree identity '$expectedBranch'."
    }
    if (-not [string]::IsNullOrWhiteSpace($Branch) -and $Branch -ne $actualBranch) {
        throw "Requested branch '$Branch' does not match the current branch '$actualBranch'."
    }
}

[pscustomobject]@{
    schemaVersion = 1
    verified = $true
    mode = $Mode
    projectRoot = $gitTop
    canonicalRoot = $resolvedCanonicalRoot
    worktreeRoot = $resolvedWorktreeRoot
    branch = $actualBranch
    taskSlug = if ($Mode -eq "edit") { $normalizedTask } else { $null }
} | ConvertTo-Json -Depth 4
