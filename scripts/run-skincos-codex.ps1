param(
    [string]$ProjectRoot,
    [switch]$NoSearch
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'AGENTS.md') -PathType Leaf)) {
    throw "The selected directory is not a SKINCOS project root: $ProjectRoot"
}

$codexCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\OpenAI\Codex\bin\codex.exe'),
    (Join-Path ${env:ProgramFiles} 'OpenAI\Codex\codex.exe')
)
$codexPath = $codexCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($codexPath)) {
    $command = Get-Command codex.exe -ErrorAction SilentlyContinue
    if ($null -ne $command) { $codexPath = $command.Source }
}
if ([string]::IsNullOrWhiteSpace($codexPath)) {
    throw 'Codex CLI was not found. Install the Windows Codex client or add codex.exe to PATH.'
}

$arguments = @('--profile', 'skincos-autonomous', '--cd', $ProjectRoot)
if (-not $NoSearch) { $arguments += '--search' }
& $codexPath @arguments
exit $LASTEXITCODE
