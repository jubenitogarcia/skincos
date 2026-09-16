$ErrorActionPreference = 'Continue'

$root = (& git rev-parse --show-toplevel 2>$null | Select-Object -First 1).Trim()
if ([string]::IsNullOrWhiteSpace($root)) {
    exit 0
}

$lifecycle = Join-Path $root '.codex\hooks\invoke-codex-lifecycle.ps1'
$routing = Join-Path $root '.codex\hooks\invoke-codex-thread-routing.ps1'
if (Test-Path -LiteralPath $lifecycle -PathType Leaf) {
    & $lifecycle
}
if (Test-Path -LiteralPath $routing -PathType Leaf) {
    & $routing
}
exit 0
