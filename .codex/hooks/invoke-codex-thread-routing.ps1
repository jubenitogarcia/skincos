$ErrorActionPreference = 'Continue'

$root = (& git rev-parse --show-toplevel 2>$null | Select-Object -First 1).Trim()
if ([string]::IsNullOrWhiteSpace($root)) {
    exit 0
}

$resolver = Join-Path $root 'scripts\resolve-codex-thread-worktree.ps1'
if (-not (Test-Path -LiteralPath $resolver -PathType Leaf)) {
    exit 0
}

& $resolver -ProjectRoot $root -Intent qualify -SkipGitHub -SkipProcessScan
exit 0
