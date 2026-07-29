[CmdletBinding()]
param(
  [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$TargetRoot = (Join-Path $env:USERPROFILE '.agents\skills'),
  [switch]$ReplaceExistingLink,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
$skillName = 'skincos-project-orchestrator'
$source = Join-Path $projectRoot "skills\$skillName"
$target = Join-Path $TargetRoot $skillName

if (-not (Test-Path -LiteralPath (Join-Path $source 'SKILL.md') -PathType Leaf)) {
  throw "Versioned skill source was not found: $source"
}

function Assert-ReparsePoint([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  if (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw "Refusing to modify a non-link skill directory: $Path"
  }
  return $item
}

if ($Uninstall) {
  if (Test-Path -LiteralPath $target) {
    Assert-ReparsePoint -Path $target | Out-Null
    Remove-Item -LiteralPath $target -Force
    Write-Output "Removed local skill link: $target"
  } else {
    Write-Output "No local skill link found: $target"
  }
  exit 0
}

New-Item -ItemType Directory -Path $TargetRoot -Force | Out-Null
if (Test-Path -LiteralPath $target) {
  $item = Assert-ReparsePoint -Path $target
  $resolvedTarget = $item.Target | Select-Object -First 1
  if ($resolvedTarget -and
      (Resolve-Path -LiteralPath $resolvedTarget).Path -eq (Resolve-Path -LiteralPath $source).Path) {
    Write-Output "Local skill link already current: $target"
    exit 0
  }
  if (-not $ReplaceExistingLink) {
    throw "A different skill link occupies $target. Re-run with -ReplaceExistingLink after verifying its source."
  }
  Remove-Item -LiteralPath $target -Force
}

New-Item -ItemType Junction -Path $target -Target $source | Out-Null
Write-Output "Installed local skill link: $target -> $source"
