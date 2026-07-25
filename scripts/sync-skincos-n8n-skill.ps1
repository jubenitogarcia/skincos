param(
    [string]$Destination = "$env:USERPROFILE\.codex\skills\skincos-n8n"
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot 'skills\skincos-n8n\SKILL.md'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Skill source is missing: $source" }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -LiteralPath $source -Destination (Join-Path $Destination 'SKILL.md') -Force
Write-Output "Installed skincos-n8n Skill from repository source into $Destination"
