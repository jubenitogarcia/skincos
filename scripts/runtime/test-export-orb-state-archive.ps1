[CmdletBinding()]
param(
    [string]$ScriptPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
    $ScriptPath = Join-Path $PSScriptRoot 'export-orb-state-archive.ps1'
}

$tokens = $null
$errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile(
    $ScriptPath,
    [ref]$tokens,
    [ref]$errors
)
if ($errors.Count -gt 0) {
    $messages = ($errors | ForEach-Object { $_.Message }) -join '; '
    throw "PowerShell parser errors in ${ScriptPath}: $messages"
}

$source = Get-Content -LiteralPath $ScriptPath -Raw
if ($source -match 'Test-Path\s+-LiteralPath\s+\$archive\s+-or\s+Test-Path\s+-LiteralPath') {
    throw 'The archive collision guard must parenthesize each Test-Path invocation before -or.'
}
if ($source -notmatch '\(\(Test-Path\s+-LiteralPath\s+\$archive\)\s+-or\s+\(Test-Path\s+-LiteralPath\s+\$manifest\)\)') {
    throw 'The archive collision guard is missing the expected parenthesized Test-Path expression.'
}
if ($source -match 'Set-Content\s+-LiteralPath\s+\$manifest\s+-Encoding\s+utf8NoBOM') {
    throw 'Windows PowerShell 5.1 does not support utf8NoBOM for Set-Content; use the .NET UTF-8 writer.'
}
if ($source -notmatch '\[System\.IO\.File\]::WriteAllText\(') {
    throw 'The manifest must be written through the PowerShell-5.1-compatible .NET UTF-8 writer.'
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("skincos-orb-export-test-{0}" -f [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $temporaryRoot -Force | Out-Null
    $archive = Join-Path $temporaryRoot 'n8n-home-state.tar'
    $manifest = Join-Path $temporaryRoot 'n8n-home-state.manifest.json'
    if ((Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath $manifest)) {
        throw 'A fresh temporary collision guard unexpectedly reported an existing artifact.'
    }

    Set-Content -LiteralPath $archive -Value 'state' -NoNewline
    if (-not ((Test-Path -LiteralPath $archive) -or (Test-Path -LiteralPath $manifest))) {
        throw 'The collision guard failed to detect an existing archive.'
    }

    $manifestPayload = [ordered]@{ archive = 'n8n-home-state.tar'; sha256 = 'test' } | ConvertTo-Json
    [System.IO.File]::WriteAllText($manifest, $manifestPayload, (New-Object System.Text.UTF8Encoding($false)))
    $manifestBytes = [System.IO.File]::ReadAllBytes($manifest)
    if ($manifestBytes.Length -ge 3 -and $manifestBytes[0] -eq 0xEF -and $manifestBytes[1] -eq 0xBB -and $manifestBytes[2] -eq 0xBF) {
        throw 'The manifest was written with a UTF-8 BOM.'
    }
    if ((Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).sha256 -ne 'test') {
        throw 'The manifest written with the .NET UTF-8 writer is not valid JSON.'
    }
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}

Write-Output 'export-orb-state-archive tests passed.'
