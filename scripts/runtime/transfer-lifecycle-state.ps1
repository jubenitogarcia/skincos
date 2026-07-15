[CmdletBinding()]
param(
  [string]$RuntimeRoot = 'C:\CodexRuntime',
  [string]$Distribution = 'Ubuntu-24.04',
  [string]$LinuxUser = 'admin',
  [string]$TransferId = (Get-Date -Format 'yyyyMMddTHHmmssZ'),
  [switch]$FinalSync
)

$ErrorActionPreference = 'Stop'

function Get-TreeInventory([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return [ordered]@{ exists = $false; files = 0; bytes = 0; latestUtc = $null }
  }
  $items = @(Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction Stop)
  $latest = $items | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  return [ordered]@{
    exists = $true
    files = $items.Count
    bytes = [Int64](($items | Measure-Object -Property Length -Sum).Sum)
    latestUtc = if ($latest) { $latest.LastWriteTimeUtc.ToString('o') } else { (Get-Item -LiteralPath $Path).LastWriteTimeUtc.ToString('o') }
  }
}

function Copy-File([string]$Source, [string]$Destination, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "Required private runtime file is missing: $Label" }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
  $item = Get-Item -LiteralPath $Source
  return [ordered]@{ exists = $true; files = 1; bytes = [Int64]$item.Length; latestUtc = $item.LastWriteTimeUtc.ToString('o') }
}

function Get-EnvValue([string]$Path, [string]$Name) {
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split '=', 2)[1].Trim().Trim('"')
}

function Get-TunnelCredential([string]$Config) {
  $line = Get-Content -LiteralPath $Config | Where-Object { $_ -match '^\s*credentials-file\s*:' } | Select-Object -First 1
  if (-not $line) { throw "Tunnel config has no credentials-file entry: $Config" }
  return (($line -split ':', 2)[1]).Trim().Trim('"')
}

function Resolve-WindowsRuntimePath([string]$Path) {
  $candidate = $Path.Trim().Trim('"')
  if ($candidate -match '^/mnt/([A-Za-z])/(.+)$') {
    return ('{0}:\{1}' -f $matches[1].ToUpperInvariant(), ($matches[2] -replace '/', '\'))
  }
  return $candidate
}

function Copy-PrivateRuntimeFile([string]$Source, [string]$Destination, [string]$Label, [string]$Relative, [System.Collections.IDictionary]$NativeSources) {
  $windowsPath = Resolve-WindowsRuntimePath $Source
  if (Test-Path -LiteralPath $windowsPath -PathType Leaf) {
    return Copy-File $windowsPath $Destination $Label
  }
  # Some legacy tunnel units already keep only their credential in native
  # /etc/skincos. Record that private native origin for the Linux apply step;
  # do not read it back through /mnt/c or expose its contents in this manifest.
  if ($Source -match '^/etc/skincos/') {
    $NativeSources[$Relative] = $Source
    return [ordered]@{ exists = $true; files = 1; bytes = $null; latestUtc = $null; origin = 'native-linux' }
  }
  throw "Required private runtime file is missing: $Label"
}

$wslRoot = "\\wsl$\$Distribution\home\$LinuxUser\skincos-lifecycle-transfer\$TransferId"
$artifactRoot = Join-Path $RuntimeRoot "artifacts\lifecycle-transfer\$TransferId"
New-Item -ItemType Directory -Force -Path $artifactRoot | Out-Null
New-Item -ItemType Directory -Force -Path $wslRoot | Out-Null

$source = @{
  'n8n/evolution-api/instances' = Join-Path $RuntimeRoot 'n8n\evolution-api\instances'
  'n8n/evolution-api/store' = Join-Path $RuntimeRoot 'n8n\evolution-api\store'
  'crm-api/var' = Join-Path $RuntimeRoot 'crm-api\var'
  'booking-api/chrome-profile' = Join-Path $RuntimeRoot 'booking-api\chrome-profile'
  'booking-api/report' = Join-Path $RuntimeRoot 'booking-api\report'
  'booking-api/debug' = Join-Path $RuntimeRoot 'booking-api\debug'
}

$inventory = [ordered]@{}
$nativeSources = [ordered]@{}
$tarEntries = [System.Collections.Generic.List[string]]::new()
foreach ($entry in $source.GetEnumerator()) {
  $inventory[$entry.Key] = Get-TreeInventory $entry.Value
  if ($inventory[$entry.Key].exists) { [void]$tarEntries.Add($entry.Key) }
}

# A single Windows-created tar is copied through \\wsl$ and extracted only on
# ext4. Direct UNC traversal of thousands of active WhatsApp session files is
# too slow for the short cutover window; this still avoids recursive WSL reads
# of C: while preserving the source tree's names and timestamps.
$payloadArchive = Join-Path $artifactRoot 'lifecycle-state.tar'
if ($tarEntries.Count -gt 0) {
  & tar.exe -cf $payloadArchive -C $RuntimeRoot @($tarEntries)
} else {
  & tar.exe -cf $payloadArchive --files-from NUL
}
if ($LASTEXITCODE -ne 0) { throw 'Windows tar failed while creating lifecycle state transfer.' }
$archiveHash = (Get-FileHash -LiteralPath $payloadArchive -Algorithm SHA256).Hash.ToLowerInvariant()
Copy-Item -LiteralPath $payloadArchive -Destination (Join-Path $wslRoot 'payload.tar') -Force

$legacyN8n = Join-Path $RuntimeRoot 'n8n'
$legacyCrm = Join-Path $RuntimeRoot 'crm-api'
$legacyBooking = Join-Path $RuntimeRoot 'booking-api'
$privateFiles = @{
  'config/orb.env' = Join-Path $legacyN8n 'env\n8n.env'
  'config/orb-business.env' = Join-Path $legacyN8n 'env\n8n-business.env'
  'config/messaging-whatsapp.env' = Join-Path $legacyN8n 'env\evolution-api.env'
  'config/crm.env' = Join-Path $legacyCrm 'env\crm-api.env'
  'config/booking.env' = Join-Path $legacyBooking 'env\booking-api.env'
}
foreach ($entry in $privateFiles.GetEnumerator()) {
  $inventory[$entry.Key] = Copy-File $entry.Value (Join-Path $wslRoot $entry.Key) $entry.Key
}

$orbConfig = Join-Path $legacyN8n 'cloudflared\orb-config.yml'
$orbCredential = Get-TunnelCredential $orbConfig
$inventory['config/cloudflare/orb/config.yml'] = Copy-File $orbConfig (Join-Path $wslRoot 'config\cloudflare\orb\config.yml') 'orb tunnel config'
$inventory['config/cloudflare/orb/credential.json'] = Copy-PrivateRuntimeFile $orbCredential (Join-Path $wslRoot 'config\cloudflare\orb\credential.json') 'orb tunnel credential' 'config/cloudflare/orb/credential.json' $nativeSources

$runtimeTunnelEnv = Join-Path $RuntimeRoot 'cloudflared\cs\cloudflared-cs.env'
$runtimeConfig = Resolve-WindowsRuntimePath (Get-EnvValue $runtimeTunnelEnv 'CLOUDFLARED_CONFIG_PATH')
if (-not $runtimeConfig) { throw 'Runtime Cloudflare tunnel environment has no CLOUDFLARED_CONFIG_PATH.' }
$runtimeCredential = Get-TunnelCredential $runtimeConfig
$inventory['config/cloudflare/runtime/config.yml'] = Copy-File $runtimeConfig (Join-Path $wslRoot 'config\cloudflare\runtime\config.yml') 'runtime tunnel config'
$inventory['config/cloudflare/runtime/credential.json'] = Copy-PrivateRuntimeFile $runtimeCredential (Join-Path $wslRoot 'config\cloudflare\runtime\credential.json') 'runtime tunnel credential' 'config/cloudflare/runtime/credential.json' $nativeSources

# The inventory intentionally contains only metadata and no hashes of private
# contents or variable values. It stays in the Linux-private transfer root.
$manifest = [ordered]@{
  schema = 1
  transferId = $TransferId
  mode = if ($FinalSync) { 'final' } else { 'precopy' }
  createdUtc = (Get-Date).ToUniversalTime().ToString('o')
  runtimeRoot = $RuntimeRoot
  stateArchive = [ordered]@{ name = 'payload.tar'; sha256 = $archiveHash; bytes = (Get-Item -LiteralPath $payloadArchive).Length }
  nativeSources = $nativeSources
  entries = $inventory
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $wslRoot 'inventory.json') -Encoding UTF8

Write-Output "LIFECYCLE_TRANSFER_ROOT=/home/$LinuxUser/skincos-lifecycle-transfer/$TransferId"
Write-Output "MODE=$($manifest.mode)"
foreach ($entry in $inventory.GetEnumerator()) {
  Write-Output ("{0}: files={1} bytes={2} latestUtc={3}" -f $entry.Key, $entry.Value.files, $entry.Value.bytes, $entry.Value.latestUtc)
}
