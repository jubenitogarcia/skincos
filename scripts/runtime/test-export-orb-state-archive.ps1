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
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}

Write-Output 'export-orb-state-archive tests passed.'
