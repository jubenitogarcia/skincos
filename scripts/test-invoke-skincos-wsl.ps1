[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$gateway = Join-Path $PSScriptRoot "invoke-skincos-wsl.ps1"

$syntaxErrors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
    $gateway,
    [ref]$null,
    [ref]$syntaxErrors
)
if ($syntaxErrors.Count -gt 0) {
    throw "WSL gateway has PowerShell parse errors: $($syntaxErrors -join '; ')"
}

$failureOutput = @()
$failedClosed = $false
try {
    $failureOutput = @(& $gateway `
        -ProjectRoot $ProjectRoot `
        -Executable true `
        -WslExecutable "skincos-wsl-intentionally-unavailable.exe" 2>&1)
}
catch {
    $failedClosed = $true
    $failureOutput += $_.Exception.Message
}
if (-not $failedClosed) {
    throw "The WSL gateway accepted an unavailable wsl.exe."
}
if (($failureOutput -join "`n") -notmatch "No Skincos service was started") {
    throw "The unavailable-WSL failure did not prove fail-closed behavior."
}

$nodeVersion = @(& $gateway -ProjectRoot $ProjectRoot -Executable node -ArgumentList @("--version"))
if ($LASTEXITCODE -ne 0 -or [string]($nodeVersion | Select-Object -Last 1) -notmatch '^v\d+\.\d+\.\d+$') {
    throw "The typed WSL executable operation did not return a Node version."
}

Write-Host "PASS: typed WSL gateway validates syntax, fails closed and executes Ubuntu tools."
