[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$launcher = Join-Path $PSScriptRoot "start-wsl-runtime-keepalive.ps1"
$content = Get-Content -LiteralPath $launcher -Raw

$requiredPatterns = @(
    'function Test-SkincosWslKeepaliveProcess',
    '\$Process\.Name -ine "wsl\.exe"',
    'Get-CimInstance Win32_Process -Filter "ProcessId=\$existingPid"',
    'never treat a recycled Windows PID as proof',
    'Test-SkincosWslKeepaliveProcess -Process \$existingProcess -ExpectedDistro \$Distro',
    'Test-SkincosWslKeepaliveProcess -Process \$_ -ExpectedDistro \$Distro'
)

foreach ($pattern in $requiredPatterns) {
    if ($content -notmatch $pattern) {
        throw "Keepalive regression guard missing required behavior: $pattern"
    }
}

Write-Host "PASS: WSL keepalive verifies process identity before trusting a PID file."
