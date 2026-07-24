[CmdletBinding()]
param([Parameter(Mandatory)][string]$ScratchRoot)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
New-Item -ItemType Directory -Force -Path $ScratchRoot | Out-Null
$source = Join-Path $ScratchRoot 'source.bin'
$key = Join-Path $ScratchRoot 'key.dpapi.json'
$cipher = Join-Path $ScratchRoot 'source.skba'
$restored = Join-Path $ScratchRoot 'restored.bin'
[IO.File]::WriteAllBytes($source, [byte[]](1..255))

& (Join-Path $PSScriptRoot 'new-offsite-recovery-key.ps1') -KeyPath $key -KeyId 'selftest' | Out-Null
& (Join-Path $PSScriptRoot 'protect-offsite-archive.ps1') -InputPath $source -OutputPath $cipher -KeyPath $key -KeyId 'selftest' | Out-Null
& (Join-Path $PSScriptRoot 'restore-offsite-archive.ps1') -InputPath $cipher -OutputPath $restored -KeyPath $key | Out-Null
if ((Get-FileHash $source -Algorithm SHA256).Hash -ne (Get-FileHash $restored -Algorithm SHA256).Hash) { throw 'Archive round trip checksum mismatch.' }

$tampered = Join-Path $ScratchRoot 'tampered.skba'; Copy-Item -LiteralPath $cipher -Destination $tampered
$stream = [IO.File]::Open($tampered, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite)
try { $stream.Seek(32, [IO.SeekOrigin]::Begin) | Out-Null; $byte=$stream.ReadByte(); $stream.Seek(32, [IO.SeekOrigin]::Begin) | Out-Null; $stream.WriteByte($byte -bxor 1) } finally { $stream.Dispose() }
$tamperRejected = $false
try { & (Join-Path $PSScriptRoot 'restore-offsite-archive.ps1') -InputPath $tampered -OutputPath (Join-Path $ScratchRoot 'tampered.out') -KeyPath $key | Out-Null } catch { $tamperRejected = $_.Exception.Message -match 'integrity' }
if (-not $tamperRejected) { throw 'Tampered archive was not rejected.' }
Write-Output 'offsite archive self-test passed'
