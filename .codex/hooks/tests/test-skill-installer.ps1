[CmdletBinding()]
param(
  [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
  $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
}
$tempBase = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path
$testRoot = Join-Path $tempBase ("skincos-skill-installer-" + [guid]::NewGuid().ToString('N'))
$sourceOne = Join-Path $testRoot 'source-one'
$sourceTwo = Join-Path $testRoot 'source-two'
$targetRoot = Join-Path $testRoot 'installed'
$target = Join-Path $targetRoot 'skincos-project-orchestrator'
$defaultTargetRoot = Join-Path $testRoot 'default-installed'
$defaultTarget = Join-Path $defaultTargetRoot 'skincos-project-orchestrator'
$installer = Join-Path $RepositoryRoot 'scripts\install-project-skill.ps1'

try {
  & $installer -TargetRoot $defaultTargetRoot
  $defaultLink = Get-Item -LiteralPath $defaultTarget -Force
  if (-not ($defaultLink.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Installer did not resolve its default source root.'
  }
  & $installer -TargetRoot $defaultTargetRoot -Uninstall

  foreach ($source in @($sourceOne, $sourceTwo)) {
    New-Item -ItemType Directory -Path (Join-Path $source 'skills\skincos-project-orchestrator') -Force | Out-Null
  }
  [IO.File]::WriteAllText(
    (Join-Path $sourceOne 'skills\skincos-project-orchestrator\SKILL.md'),
    "source-one`n",
    (New-Object Text.UTF8Encoding($false))
  )
  [IO.File]::WriteAllText(
    (Join-Path $sourceTwo 'skills\skincos-project-orchestrator\SKILL.md'),
    "source-two`n",
    (New-Object Text.UTF8Encoding($false))
  )

  & $installer -SourceRoot $sourceOne -TargetRoot $targetRoot
  $first = Get-Item -LiteralPath $target -Force
  if (-not ($first.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Installer did not create a junction.'
  }

  $refused = $false
  try {
    & $installer -SourceRoot $sourceTwo -TargetRoot $targetRoot
  } catch {
    $refused = $true
  }
  if (-not $refused) {
    throw 'Installer replaced a different junction without explicit authorization.'
  }

  & $installer -SourceRoot $sourceTwo -TargetRoot $targetRoot -ReplaceExistingLink
  if ((Get-Content -LiteralPath (Join-Path $target 'SKILL.md') -Raw) -ne "source-two`n") {
    throw 'Authorized junction replacement did not select source two.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceOne 'skills\skincos-project-orchestrator\SKILL.md'))) {
    throw 'Replacing the junction removed content from the previous source.'
  }

  & $installer -SourceRoot $sourceTwo -TargetRoot $targetRoot -Uninstall
  if (Test-Path -LiteralPath $target) {
    throw 'Uninstall left the junction in place.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $sourceTwo 'skills\skincos-project-orchestrator\SKILL.md'))) {
    throw 'Uninstall removed content from the source.'
  }

  New-Item -ItemType Directory -Path $target -Force | Out-Null
  [IO.File]::WriteAllText(
    (Join-Path $target 'sentinel.txt'),
    "preserve`n",
    (New-Object Text.UTF8Encoding($false))
  )
  $normalDirectoryRefused = $false
  try {
    & $installer -SourceRoot $sourceOne -TargetRoot $targetRoot -ReplaceExistingLink
  } catch {
    $normalDirectoryRefused = $true
  }
  if (-not $normalDirectoryRefused -or -not (Test-Path -LiteralPath (Join-Path $target 'sentinel.txt'))) {
    throw 'Installer did not preserve a normal directory at the target.'
  }

  Write-Output 'Skill installer junction replacement/uninstall/refusal: OK'
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolved = (Resolve-Path -LiteralPath $testRoot).Path
    if (-not $resolved.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing cleanup outside the process temp directory: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
