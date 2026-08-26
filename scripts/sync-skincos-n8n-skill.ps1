param(
    [string]$Destination = "$env:USERPROFILE\.codex\skills\skincos-n8n",
    [string]$OrbRepository = 'C:\CodexShared\Projetos\orb'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot 'skills\skincos-n8n\SKILL.md'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Compatibility alias is missing: $source" }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $Destination 'SKILL.md') -Force
$orbSync = Join-Path $OrbRepository 'scripts\sync-orb-n8n-skill.ps1'
if (Test-Path -LiteralPath $orbSync -PathType Leaf) {
    Write-Output "Installed temporary skincos-n8n alias. Install the canonical source with: $orbSync"
} else {
    Write-Output 'Installed temporary skincos-n8n alias. Obtain orb-n8n from the independent Orb repository.'
}
