[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InputPath,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][string]$KeyPath,
    [Parameter(Mandatory)][string]$KeyId
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$magic = [Text.Encoding]::ASCII.GetBytes("SKINCOS-OFFSITE-ARCHIVE-V1`n")
$entropy = [Text.Encoding]::UTF8.GetBytes('SKINCOS offsite recovery key v1')

function Get-RecoveryKey([string]$path) {
    $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($record.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace($record.protectedKey)) { throw 'Invalid protected recovery key record.' }
    return [Security.Cryptography.ProtectedData]::Unprotect(
        [Convert]::FromBase64String([string]$record.protectedKey), $entropy,
        [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
}
function Derive-Key([byte[]]$master, [string]$label) {
    $h = [Security.Cryptography.HMACSHA256]::new($master)
    try { return $h.ComputeHash([Text.Encoding]::UTF8.GetBytes($label)) } finally { $h.Dispose() }
}

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) { throw "Input file not found: $InputPath" }
$outputParent = Split-Path -Parent $OutputPath
if (-not $outputParent) { throw 'OutputPath must include a parent directory.' }
New-Item -ItemType Directory -Force -Path $outputParent | Out-Null
$partial = "$OutputPath.partial"
Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue

$master = Get-RecoveryKey $KeyPath
$encKey = Derive-Key $master 'SKINCOS offsite AES-256 encryption v1'
$macKey = Derive-Key $master 'SKINCOS offsite HMAC-SHA-256 v1'
$iv = New-Object byte[] 16
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($iv)
    $aes = [Security.Cryptography.Aes]::Create()
    $aes.KeySize = 256; $aes.Mode = [Security.Cryptography.CipherMode]::CBC; $aes.Padding = [Security.Cryptography.PaddingMode]::PKCS7
    $aes.Key = $encKey; $aes.IV = $iv
    $input = [IO.File]::OpenRead($InputPath)
    $output = [IO.File]::Create($partial)
    try {
        $output.Write($magic, 0, $magic.Length); $output.Write($iv, 0, $iv.Length)
        $crypto = [Security.Cryptography.CryptoStream]::new($output, $aes.CreateEncryptor(), [Security.Cryptography.CryptoStreamMode]::Write, $true)
        try { $input.CopyTo($crypto); $crypto.FlushFinalBlock() } finally { $crypto.Dispose() }
    } finally { $input.Dispose(); $output.Dispose(); $aes.Dispose() }
    $hmac = [Security.Cryptography.HMACSHA256]::new($macKey)
    try {
        $stream = [IO.File]::OpenRead($partial)
        try { $tag = $hmac.ComputeHash($stream) } finally { $stream.Dispose() }
    } finally { $hmac.Dispose() }
    $append = [IO.File]::Open($partial, [IO.FileMode]::Append)
    try { $append.Write($tag, 0, $tag.Length) } finally { $append.Dispose() }
    Move-Item -LiteralPath $partial -Destination $OutputPath -Force
} finally {
    $rng.Dispose()
    [Array]::Clear($master, 0, $master.Length); [Array]::Clear($encKey, 0, $encKey.Length); [Array]::Clear($macKey, 0, $macKey.Length)
    Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
}

$inputHash = (Get-FileHash -LiteralPath $InputPath -Algorithm SHA256).Hash.ToLowerInvariant()
$cipherHash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
@{ schemaVersion=1; keyId=$KeyId; algorithm='AES-256-CBC+HMAC-SHA-256'; sourceSha256=$inputHash; ciphertextSha256=$cipherHash; createdAtUtc=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress
