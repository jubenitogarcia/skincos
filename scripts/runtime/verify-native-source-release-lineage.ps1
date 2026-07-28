[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ReleaseId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$ParentReleaseId,

  [Parameter(Mandatory = $true)]
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$release = (git rev-parse "$ReleaseId^{commit}").Trim()
$parent = (git rev-parse "$ParentReleaseId^{commit}").Trim()
git merge-base --is-ancestor $parent $release
if ($LASTEXITCODE -ne 0) {
  throw "Release $release is not a descendant of effective release $parent. Use the explicit rollback path instead."
}

$payload = [ordered]@{
  schemaVersion = 1
  releaseId = $release
  parentReleaseId = $parent
  verifiedAncestor = $true
  verifiedAt = [DateTime]::UtcNow.ToString('o')
}
$parentDir = Split-Path -Parent $OutputPath
if ($parentDir) { New-Item -ItemType Directory -Force -Path $parentDir | Out-Null }
$json = $payload | ConvertTo-Json -Depth 3
[System.IO.File]::WriteAllText($OutputPath, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath | Select-Object Path, Hash
