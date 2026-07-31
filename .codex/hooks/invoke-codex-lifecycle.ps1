$ErrorActionPreference = 'Stop'
$root = (& git rev-parse --show-toplevel 2>$null | Select-Object -First 1).Trim()
if ([string]::IsNullOrWhiteSpace($root)) { exit 0 }
$runner = Join-Path $root '.codex\hooks\codex-lifecycle-hook.py'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) { exit 0 }
$python = Get-Command python.exe -ErrorAction SilentlyContinue
if ($null -eq $python) { exit 0 }
& $python.Source $runner --repo-root $root
exit $LASTEXITCODE
