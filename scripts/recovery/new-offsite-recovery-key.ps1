[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$KeyPath,
    [Parameter(Mandatory)][string]$KeyId,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$parent = Split-Path -Parent $KeyPath
if (-not $parent) { throw 'KeyPath must include a parent directory.' }
if ((Test-Path -LiteralPath $KeyPath) -and -not $Force) { throw "Key file already exists: $KeyPath" }
New-Item -ItemType Directory -Force -Path $parent | Out-Null

$key = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($key) } finally { $rng.Dispose() }
$protected = [Security.Cryptography.ProtectedData]::Protect(
    $key,
    [Text.Encoding]::UTF8.GetBytes('SKINCOS offsite recovery key v1'),
    [Security.Cryptography.DataProtectionScope]::CurrentUser
)

@{
    schemaVersion = 1
    keyId = $KeyId
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    protection = 'DPAPI CurrentUser'
    protectedKey = [Convert]::ToBase64String($protected)
} | ConvertTo-Json -Depth 3 | ForEach-Object {
    [IO.File]::WriteAllText($KeyPath, $_, [Text.UTF8Encoding]::new($false))
}

& icacls.exe $KeyPath /inheritance:r /grant:r '*S-1-5-18:F' "*$([Security.Principal.WindowsIdentity]::GetCurrent().User.Value):F" /Q | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict key file ACL.' }

$sha = [Security.Cryptography.SHA256]::Create()
try { $fingerprint = $sha.ComputeHash($key) } finally { $sha.Dispose() }
Write-Output "key_id=$KeyId"
Write-Output "key_fingerprint=$(([BitConverter]::ToString($fingerprint) -replace '-', '').ToLowerInvariant())"
