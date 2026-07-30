[CmdletBinding()]
param(
    [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
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

$gitRoot = @(& $gateway `
    -ProjectRoot $ProjectRoot `
    -Executable git `
    -ArgumentList @("rev-parse", "--show-toplevel") `
    -SkipNodeCheck `
    -SkipNpmCheck)
if ($LASTEXITCODE -ne 0 -or [string]($gitRoot | Select-Object -Last 1) -notmatch '^/mnt/[a-z]/') {
    throw "The typed WSL gateway did not translate the Windows worktree Git metadata."
}

$opaqueValue = "Gestor Local C:\source__module"
$roundTrip = @(& $gateway `
    -ProjectRoot $ProjectRoot `
    -Executable /usr/bin/printenv `
    -ArgumentList @("SKINCOS_TYPED_VALUE") `
    -EnvVar @("SKINCOS_TYPED_VALUE=$opaqueValue") `
    -SkipNodeCheck `
    -SkipNpmCheck `
    -SkipGitCheck)
if ($LASTEXITCODE -ne 0 -or [string]($roundTrip | Select-Object -Last 1) -ne $opaqueValue) {
    throw "The typed WSL gateway did not preserve an opaque argument with spaces and backslashes."
}

Write-Host "PASS: typed WSL gateway validates syntax, fails closed and executes Ubuntu tools from a Windows worktree."
