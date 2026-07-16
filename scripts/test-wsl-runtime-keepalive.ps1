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
    '\$commandLine -match "\(\?i\)\(\?:\^\|\\s\)--cd\\s\+/',
    '-ArgumentList @\("-d", \$Distro, "-u", "root", "--cd", "/", "--", "/bin/sleep", "infinity"\)',
    'Test-SkincosWslKeepaliveProcess -Process \$existingProcess -ExpectedDistro \$Distro',
    'Test-SkincosWslKeepaliveProcess -Process \$_ -ExpectedDistro \$Distro'
)

foreach ($pattern in $requiredPatterns) {
    if ($content -notmatch $pattern) {
        throw "Keepalive regression guard missing required behavior: $pattern"
    }
}

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $launcher,
    [ref]$tokens,
    [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
    throw "Keepalive launcher has PowerShell parse errors: $($parseErrors -join '; ')"
}
$functionAst = $ast.Find(
    { param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Test-SkincosWslKeepaliveProcess' },
    $true
)
if (-not $functionAst) {
    throw "Keepalive process validator function could not be loaded."
}
Invoke-Expression $functionAst.Extent.Text

$legacyProcess = [pscustomobject]@{
    Name = "wsl.exe"
    CommandLine = 'wsl.exe -d Ubuntu-24.04 -u root -- /bin/sleep infinity'
}
$nativeProcess = [pscustomobject]@{
    Name = "wsl.exe"
    CommandLine = 'wsl.exe -d Ubuntu-24.04 -u root --cd / -- /bin/sleep infinity'
}
if (Test-SkincosWslKeepaliveProcess -Process $legacyProcess -ExpectedDistro "Ubuntu-24.04") {
    throw "Keepalive must reject a WSL anchor whose current directory can be inherited from DrvFS."
}
if (-not (Test-SkincosWslKeepaliveProcess -Process $nativeProcess -ExpectedDistro "Ubuntu-24.04")) {
    throw "Keepalive must accept the native-root WSL anchor."
}

Write-Host "PASS: WSL keepalive verifies process identity before trusting a PID file."
