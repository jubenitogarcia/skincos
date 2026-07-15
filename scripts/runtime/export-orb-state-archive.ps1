[CmdletBinding()]
param(
    [string]$LegacyHome = 'C:\CodexRuntime\n8n\n8n-home',
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,
    [switch]$RequireLegacyOrbStopped
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $LegacyHome -PathType Container)) {
    throw "Legacy Orb home does not exist: $LegacyHome"
}

if ($RequireLegacyOrbStopped) {
    & wsl.exe -d Ubuntu-24.04 -u root -- systemctl is-active --quiet skincos-n8n.service
    if ($LASTEXITCODE -eq 0) {
        throw 'Refusing to create an authoritative Orb state archive while skincos-n8n.service is active.'
    }
}

$resolvedHome = (Resolve-Path -LiteralPath $LegacyHome).Path
$parent = Split-Path -Parent $resolvedHome
$leaf = Split-Path -Leaf $resolvedHome
if ($leaf -ne 'n8n-home') {
    throw "LegacyHome must end in n8n-home, got: $resolvedHome"
}

$resolvedArtifactRoot = [System.IO.Path]::GetFullPath($ArtifactRoot)
New-Item -ItemType Directory -Path $resolvedArtifactRoot -Force | Out-Null
$archive = Join-Path $resolvedArtifactRoot 'n8n-home-state.tar'
$manifest = Join-Path $resolvedArtifactRoot 'n8n-home-state.manifest.json'
if ((Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath $manifest)) {
    throw "Refusing to overwrite an existing Orb state archive in: $resolvedArtifactRoot"
}

# Windows tar cannot safely serialize its generated node_modules reparse
# points. They are rebuilt natively by stage-orb-state-archive.sh from the
# included package manifests; no state, configuration or custom-node source is
# excluded.
$tarArguments = @(
    '-cf', $archive,
    '--exclude=n8n-home/nodes/node_modules',
    '--exclude=n8n-home/.n8n/nodes/node_modules',
    '-C', $parent,
    $leaf
)

& tar.exe @tarArguments
if ($LASTEXITCODE -ne 0) {
    $failed = "$archive.partial-$(Get-Date -Format 'yyyyMMddTHHmmssZ')"
    if (Test-Path -LiteralPath $archive) {
        Move-Item -LiteralPath $archive -Destination $failed -Force
    }
    throw "Windows tar failed while creating Orb state archive; retained any partial output as $failed"
}

$item = Get-Item -LiteralPath $archive
if ($item.Length -le 0) {
    throw 'Orb state archive is empty.'
}
$sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$record = [ordered]@{
    createdUtc = (Get-Date).ToUniversalTime().ToString('o')
    source = $resolvedHome
    archive = $item.Name
    archiveBytes = $item.Length
    sha256 = $sha256
    nodesDependencies = 'excluded-and-rebuilt-natively'
    legacyOrbStoppedRequired = [bool]$RequireLegacyOrbStopped
}
$record | ConvertTo-Json | Set-Content -LiteralPath $manifest -Encoding utf8NoBOM
Write-Output "ORB_STATE_ARCHIVE=$archive"
Write-Output "ORB_STATE_SHA256=$sha256"
