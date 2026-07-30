$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-True {
    param(
        [Parameter(Mandatory = $true)][bool]$Condition,
        [Parameter(Mandatory = $true)][string]$Message
    )
    if (-not $Condition) {
        throw "ASSERTION FAILED: $Message"
    }
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action,
        [Parameter(Mandatory = $true)][string]$Pattern,
        [Parameter(Mandatory = $true)][string]$Message
    )
    try {
        & $Action
    }
    catch {
        Assert-True `
            -Condition ($_.Exception.Message -match $Pattern) `
            -Message "$Message (received: $($_.Exception.Message))"
        return
    }
    throw "ASSERTION FAILED: $Message"
}

$gateway = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\invoke-skincos-wsl.ps1")).Path
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$source = Get-Content -LiteralPath $gateway -Raw

$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile(
    $gateway,
    [ref]$null,
    [ref]$parseErrors
)
Assert-True -Condition ($parseErrors.Count -eq 0) -Message "gateway must parse without PowerShell errors"

foreach ($contract in @(
    'ParameterSetName = "BashScript"',
    'ParameterSetName = "Executable"',
    'ParameterSetName = "NpmScript"',
    'ParameterSetName = "PythonScript"',
    'ParameterSetName = "InvocationFile"',
    '"--exec"'
)) {
    Assert-True -Condition $source.Contains($contract) -Message "missing typed gateway contract: $contract"
}
Assert-True `
    -Condition ($source.IndexOf('"/bin/bash", "-lc"', [StringComparison]::Ordinal) -gt 0) `
    -Message "legacy raw-shell compatibility must remain explicit"
Assert-True `
    -Condition ($source.IndexOf('Write-Warning "-RepoCommand is a legacy', [StringComparison]::Ordinal) -gt 0) `
    -Message "legacy raw-shell compatibility must warn callers"

Assert-Throws `
    -Action { & $gateway -ProjectRoot $projectRoot -ScriptPath "../outside.sh" } `
    -Pattern "traverse outside" `
    -Message "typed script paths must reject traversal"
Assert-Throws `
    -Action { & $gateway -ProjectRoot $projectRoot -PythonScript "script.sh" } `
    -Pattern "must identify a .py file" `
    -Message "PythonScript must reject non-Python targets"
Assert-Throws `
    -Action { & $gateway -ProjectRoot $projectRoot -NpmScript "context; whoami" } `
    -Pattern "unsupported characters" `
    -Message "NpmScript must reject shell syntax"
Assert-Throws `
    -Action { & $gateway -ProjectRoot $projectRoot -Executable "git;whoami" } `
    -Pattern "unsupported command-name characters" `
    -Message "Executable must reject shell syntax"
Assert-Throws `
    -Action {
        & $gateway `
            -ProjectRoot $projectRoot `
            -Executable true `
            -EnvVar @("HOME=C:\unsafe")
    } `
    -Pattern "reserved by the Windows-to-WSL execution boundary" `
    -Message "environment input must not repurpose HOME"
Assert-Throws `
    -Action {
        & $gateway `
            -ProjectRoot $projectRoot `
            -Executable true `
            -EnvVar @("SAFE=one", "safe=two")
    } `
    -Pattern "duplicate name" `
    -Message "environment input must reject duplicate names"

$literalArguments = @(
    "%s|%s|%s",
    "literal; touch /tmp/not-run",
    "single'quote",
    "Gestor Local C:\source__module"
)
$literalOutput = @(
    & $gateway `
        -ProjectRoot $projectRoot `
        -Executable "/usr/bin/printf" `
        -ArgumentList $literalArguments `
        -SkipNodeCheck `
        -SkipNpmCheck `
        -SkipGitCheck
)
$expectedLiteral = "literal; touch /tmp/not-run|single'quote|Gestor Local C:\source__module"
Assert-True `
    -Condition ([string]($literalOutput | Select-Object -Last 1) -eq $expectedLiteral) `
    -Message "typed executable arguments must cross as literal argv entries"

$environmentValue = "literal; echo not-run C:\private path"
$environmentOutput = @(
    & $gateway `
        -ProjectRoot $projectRoot `
        -Executable "/usr/bin/printenv" `
        -ArgumentList @("SKINCOS_TYPED_VALUE") `
        -EnvVar @("SKINCOS_TYPED_VALUE=$environmentValue") `
        -SkipNodeCheck `
        -SkipNpmCheck `
        -SkipGitCheck
)
Assert-True `
    -Condition ([string]($environmentOutput | Select-Object -Last 1) -eq $environmentValue) `
    -Message "typed environment values must remain opaque literals"

Write-Host "invoke-skincos-wsl.test.ps1: PASS"
