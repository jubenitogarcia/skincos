[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Archive,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$Sha256,
    [string]$Distribution = 'Ubuntu-24.04',
    [string]$LinuxUser = 'admin'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedArchive = (Resolve-Path -LiteralPath $Archive).Path
if ((Get-Item -LiteralPath $resolvedArchive).PSIsContainer) {
    throw "Archive must be a file: $resolvedArchive"
}
$actualHash = (Get-FileHash -LiteralPath $resolvedArchive -Algorithm SHA256).Hash
if (-not $actualHash.Equals($Sha256, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Orb state archive checksum mismatch.'
}

# Validate the archive before extracting. This runs in Windows against the
# local file and rejects anything outside the expected n8n-home root.
$entries = & tar.exe -tf $resolvedArchive
if ($LASTEXITCODE -ne 0) {
    throw 'Windows tar could not list the Orb state archive.'
}
foreach ($entry in $entries) {
    if ($entry -notmatch '^n8n-home(/|$)' -or $entry -match '(^|/)\.\.(/|$)') {
        throw "Orb state archive has an invalid entry path: $entry"
    }
}

$stageId = "orb-n8n-transfer-$($actualHash.Substring(0, 16).ToLowerInvariant())"
$uncRoot = "\\wsl$\$Distribution\home\$LinuxUser\skincos-orb-transfer"
$uncStage = Join-Path $uncRoot $stageId
if (Test-Path -LiteralPath $uncStage) {
    throw "Refusing to overwrite existing transferred Orb state: $uncStage"
}
New-Item -ItemType Directory -Path $uncStage -Force | Out-Null

# The source is read by Windows from C:, then written through the WSL share to
# ext4. This avoids the unstable reverse traversal of /mnt/c by WSL tar.
& tar.exe -xf $resolvedArchive -C $uncStage
if ($LASTEXITCODE -ne 0) {
    throw "Windows tar transfer failed; retained partial Linux transfer at $uncStage"
}

$required = @(
    (Join-Path $uncStage 'n8n-home\.n8n\config'),
    (Join-Path $uncStage 'n8n-home\database.sqlite'),
    (Join-Path $uncStage 'n8n-home\storage'),
    (Join-Path $uncStage 'n8n-home\nodes\package.json'),
    (Join-Path $uncStage 'n8n-home\nodes\package-lock.json')
)
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Windows transfer is incomplete: missing $path"
    }
}
if (Test-Path -LiteralPath (Join-Path $uncStage 'n8n-home\nodes\node_modules')) {
    throw 'Transferred archive unexpectedly contains Windows node_modules.'
}

Write-Output "EXTRACTED_ORB_STATE_HOME=/home/$LinuxUser/skincos-orb-transfer/$stageId/n8n-home"
Write-Output "ORB_STATE_SHA256=$($actualHash.ToLowerInvariant())"
