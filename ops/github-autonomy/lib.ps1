Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-AutonomyRoot {
    param([string]$RuntimeRoot)
    if ($RuntimeRoot) { return $RuntimeRoot }
    if ($env:SKINCOS_GITHUB_AUTONOMY_ROOT) { return $env:SKINCOS_GITHUB_AUTONOMY_ROOT }
    return 'C:\CodexRuntime\operator\admin\skincos\github-autonomy'
}

function Ensure-AutonomyLayout {
    param([string]$RuntimeRoot)
    foreach ($name in @('config','secrets','state','events','logs','reports','locks','worktrees','broker')) {
        $path = Join-Path $RuntimeRoot $name
        if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Force -Path $path | Out-Null }
    }
}

function Get-AutonomyConfig {
    param([string]$RuntimeRoot)
    $path = Join-Path $RuntimeRoot 'config\runtime.config.json'
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing private configuration: $path" }
    return (Get-Content -Raw -LiteralPath $path | ConvertFrom-Json)
}

function Get-AutonomyPolicy {
    param([string]$PolicyPath)
    return (Get-Content -Raw -LiteralPath $PolicyPath | ConvertFrom-Json)
}

function ConvertTo-CanonicalJson {
    param($Value)
    return ($Value | ConvertTo-Json -Depth 32 -Compress)
}

function Write-AutonomyJsonAtomic {
    param([string]$Path, $Value)
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $temporary = Join-Path $directory ('.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    [System.IO.File]::WriteAllText($temporary, (ConvertTo-CanonicalJson $Value), [System.Text.UTF8Encoding]::new($false))
    if (-not ('SkincosAutonomyNative' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SkincosAutonomyNative {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool MoveFileEx(string existingFileName, string newFileName, int flags);
}
'@
    }
    if (-not [SkincosAutonomyNative]::MoveFileEx($temporary, $Path, 1)) {
        $code = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "Atomic state replacement failed (Win32=$code): $Path"
    }
}

function Read-AutonomyJson {
    param([string]$Path, $Default = $null)
    if (-not (Test-Path -LiteralPath $Path)) { return $Default }
    return (Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json)
}

function Write-AutonomyLog {
    param([string]$RuntimeRoot, [string]$Kind, $Data)
    $entry = [ordered]@{ timestamp = [DateTime]::UtcNow.ToString('o'); kind = $Kind; data = $Data }
    $path = Join-Path $RuntimeRoot ('logs\' + (Get-Date -Format 'yyyyMMdd') + '.jsonl')
    [System.IO.File]::AppendAllText($path, ((ConvertTo-CanonicalJson $entry) + [Environment]::NewLine), [System.Text.UTF8Encoding]::new($false))
}

function Get-Sha256Hex {
    param([string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '') } finally { $sha.Dispose() }
}

function Get-HmacHex {
    param([string]$Secret, [string]$Data)
    $hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes($Secret))
    try { return ([BitConverter]::ToString($hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Data)))).Replace('-', '').ToLowerInvariant() } finally { $hmac.Dispose() }
}

function Test-FixedTimeEquals {
    param([string]$Left, [string]$Right)
    $a = [System.Text.Encoding]::UTF8.GetBytes($Left.ToLowerInvariant())
    $b = [System.Text.Encoding]::UTF8.GetBytes($Right.ToLowerInvariant())
    if ($a.Length -ne $b.Length) { return $false }
    $difference = 0
    for ($i = 0; $i -lt $a.Length; $i++) { $difference = $difference -bor ($a[$i] -bxor $b[$i]) }
    return $difference -eq 0
}

function Enter-AutonomyLock {
    param([string]$RuntimeRoot, [string]$Name)
    $safe = ($Name -replace '[^A-Za-z0-9._-]', '_')
    $path = Join-Path $RuntimeRoot ("locks\\$safe.lock")
    try { return [System.IO.File]::Open($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None) } catch [System.IO.IOException] { return $null }
}

function Exit-AutonomyLock {
    param($Lock, [string]$RuntimeRoot, [string]$Name)
    if ($null -ne $Lock) { $Lock.Dispose() }
    $safe = ($Name -replace '[^A-Za-z0-9._-]', '_')
    Remove-Item -LiteralPath (Join-Path $RuntimeRoot ("locks\\$safe.lock")) -Force -ErrorAction SilentlyContinue
}

function ConvertTo-Base64Url {
    param([byte[]]$Bytes)
    return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function Get-RsaParametersFromPem {
    param([string]$PemPath)
    $text = Get-Content -Raw -LiteralPath $PemPath
    if ($text -notmatch 'BEGIN RSA PRIVATE KEY') { throw 'Only PKCS#1 RSA private keys are supported for the GitHub App.' }
    $body = ($text -replace '-----BEGIN RSA PRIVATE KEY-----','' -replace '-----END RSA PRIVATE KEY-----','' -replace '\s','')
    $bytes = [Convert]::FromBase64String($body); $state = [pscustomobject]@{ Offset = 0 }
    $readLength = {
        if ($bytes[$state.Offset] -lt 0x80) { $value = [int]$bytes[$state.Offset]; $state.Offset++; return $value }
        $count = [int]($bytes[$state.Offset] -band 0x7f); $state.Offset++; $value = 0
        for ($i=0; $i -lt $count; $i++) { $value = ($value -shl 8) -bor $bytes[$state.Offset]; $state.Offset++ }
        return $value
    }
    if ($bytes[$state.Offset++] -ne 0x30) { throw 'Invalid RSA private key sequence.' }; $null = & $readLength
    $readInteger = {
        if ($bytes[$state.Offset++] -ne 0x02) { throw 'Invalid RSA private key integer.' }; $length = & $readLength
        $value = New-Object byte[] $length; [Array]::Copy($bytes, $state.Offset, $value, 0, $length); $state.Offset += $length
        if ($value.Length -gt 1 -and $value[0] -eq 0) { return $value[1..($value.Length-1)] }
        return $value
    }
    $null = & $readInteger
    $values = @(); 1..8 | ForEach-Object { $values += ,(& $readInteger) }
    return [System.Security.Cryptography.RSAParameters]@{ Modulus=$values[0]; Exponent=$values[1]; D=$values[2]; P=$values[3]; Q=$values[4]; DP=$values[5]; DQ=$values[6]; InverseQ=$values[7] }
}

function New-GitHubAppJwt {
    param([string]$AppId, [string]$PemPath)
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $header = ConvertTo-Base64Url ([System.Text.Encoding]::UTF8.GetBytes('{"alg":"RS256","typ":"JWT"}'))
    $payload = ConvertTo-Base64Url ([System.Text.Encoding]::UTF8.GetBytes((@{ iat=$now-30; exp=$now+540; iss=$AppId } | ConvertTo-Json -Compress)))
    $unsigned = "$header.$payload"
    $rsa = [System.Security.Cryptography.RSA]::Create()
    try { $rsa.ImportParameters((Get-RsaParametersFromPem $PemPath)); $signature = $rsa.SignData([System.Text.Encoding]::UTF8.GetBytes($unsigned), [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1); return "$unsigned.$(ConvertTo-Base64Url $signature)" } finally { $rsa.Dispose() }
}

function Invoke-GitHubApi {
    param([string]$Method, [string]$Path, [string]$Token, $Body = $null)
    $headers = @{ Authorization = "Bearer $Token"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28'; 'User-Agent' = 'skincos-github-autonomy' }
    $parameters = @{ Method=$Method; Uri=('https://api.github.com' + $Path); Headers=$headers; ErrorAction='Stop' }
    if ($null -ne $Body) { $parameters.ContentType='application/json'; $parameters.Body=(ConvertTo-CanonicalJson $Body) }
    return Invoke-RestMethod @parameters
}

function Get-GitHubInstallationToken {
    param($Config)
    $jwt = New-GitHubAppJwt -AppId ([string]$Config.github_app_id) -PemPath ([string]$Config.github_private_key_path)
    $result = Invoke-GitHubApi -Method 'POST' -Path ("/app/installations/{0}/access_tokens" -f $Config.github_installation_id) -Token $jwt
    if ([string]::IsNullOrWhiteSpace([string]$result.token)) { throw 'GitHub did not return an installation token.' }
    return [string]$result.token
}
