[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$InputPath,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][string]$KeyPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$magic = [Text.Encoding]::ASCII.GetBytes("SKINCOS-OFFSITE-ARCHIVE-V1`n")
$entropy = [Text.Encoding]::UTF8.GetBytes('SKINCOS offsite recovery key v1')

function Get-RecoveryKey([string]$path) {
    $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($record.schemaVersion -ne 1 -or [string]::IsNullOrWhiteSpace($record.protectedKey)) { throw 'Invalid protected recovery key record.' }
    return [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String([string]$record.protectedKey), $entropy, [Security.Cryptography.DataProtectionScope]::CurrentUser)
}
function Derive-Key([byte[]]$master, [string]$label) { $h = [Security.Cryptography.HMACSHA256]::new($master); try { return $h.ComputeHash([Text.Encoding]::UTF8.GetBytes($label)) } finally { $h.Dispose() } }
function Test-FixedTime([byte[]]$a, [byte[]]$b) { if ($a.Length -ne $b.Length) { return $false }; $d=0; for($i=0;$i -lt $a.Length;$i++){ $d = $d -bor ($a[$i] -bxor $b[$i]) }; return $d -eq 0 }

if (-not (Test-Path -LiteralPath $InputPath -PathType Leaf)) { throw "Ciphertext not found: $InputPath" }
$length = (Get-Item -LiteralPath $InputPath).Length
$headerLength = $magic.Length + 16
if ($length -le ($headerLength + 32)) { throw 'Ciphertext is too short.' }
$master = Get-RecoveryKey $KeyPath; $encKey = Derive-Key $master 'SKINCOS offsite AES-256 encryption v1'; $macKey = Derive-Key $master 'SKINCOS offsite HMAC-SHA-256 v1'
$partial = "$OutputPath.partial"
$cipherPayload = "$OutputPath.cipher.partial"
Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $cipherPayload -Force -ErrorAction SilentlyContinue
try {
    $contentLength = $length - 32
    $hmac = [Security.Cryptography.HMACSHA256]::new($macKey)
    try {
        $in = [IO.File]::OpenRead($InputPath)
        try {
            $buffer = New-Object byte[] 1048576; $remaining=$contentLength
            while($remaining -gt 0){ $read=$in.Read($buffer,0,[Math]::Min($buffer.Length,$remaining)); if($read -le 0){throw 'Unexpected end of ciphertext.'}; [void]$hmac.TransformBlock($buffer,0,$read,$null,0); $remaining -= $read }
            [void]$hmac.TransformFinalBlock(@(),0,0); $expected=$hmac.Hash
            $tag=New-Object byte[] 32; if($in.Read($tag,0,32) -ne 32){throw 'Ciphertext tag is missing.'}
            if(-not (Test-FixedTime $expected $tag)){throw 'Ciphertext integrity verification failed.'}
        } finally { $in.Dispose() }
    } finally { $hmac.Dispose() }
    $source=[IO.File]::OpenRead($InputPath); $payload=[IO.File]::Create($cipherPayload)
    try {
        $remaining=$contentLength; $buffer=New-Object byte[] 1048576
        while($remaining -gt 0) { $read=$source.Read($buffer,0,[Math]::Min($buffer.Length,$remaining)); if($read -le 0){throw 'Unexpected end of ciphertext.'}; $payload.Write($buffer,0,$read); $remaining-=$read }
    } finally { $source.Dispose(); $payload.Dispose() }
    $in=[IO.File]::OpenRead($cipherPayload); $out=[IO.File]::Create($partial)
    try {
        $actualMagic=New-Object byte[] $magic.Length; if($in.Read($actualMagic,0,$actualMagic.Length) -ne $actualMagic.Length -or -not (Test-FixedTime $actualMagic $magic)){throw 'Unknown ciphertext format.'}
        $iv=New-Object byte[] 16; if($in.Read($iv,0,16) -ne 16){throw 'Ciphertext IV is missing.'}
        $aes=[Security.Cryptography.Aes]::Create(); $aes.KeySize=256; $aes.Mode=[Security.Cryptography.CipherMode]::CBC; $aes.Padding=[Security.Cryptography.PaddingMode]::PKCS7; $aes.Key=$encKey; $aes.IV=$iv
        try { $crypto=[Security.Cryptography.CryptoStream]::new($in,$aes.CreateDecryptor(),[Security.Cryptography.CryptoStreamMode]::Read,$true); try { $crypto.CopyTo($out) } finally { $crypto.Dispose() } } finally { $aes.Dispose() }
    } finally { $in.Dispose(); $out.Dispose() }
    Move-Item -LiteralPath $partial -Destination $OutputPath -Force
} finally { [Array]::Clear($master,0,$master.Length); [Array]::Clear($encKey,0,$encKey.Length); [Array]::Clear($macKey,0,$macKey.Length); Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $cipherPayload -Force -ErrorAction SilentlyContinue }

@{ schemaVersion=1; plaintextSha256=(Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant(); restoredAtUtc=[DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress
