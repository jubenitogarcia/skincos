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

function Assert-Contains {
    param(
        [Parameter(Mandatory = $true)][string]$Value,
        [Parameter(Mandatory = $true)][string]$Expected,
        [Parameter(Mandatory = $true)][string]$Message
    )
    Assert-True -Condition $Value.Contains($Expected) -Message $Message
}

function Assert-Throws {
    param(
        [Parameter(Mandatory = $true)][scriptblock]$Action,
        [Parameter(Mandatory = $true)][string]$Message
    )
    try {
        & $Action
    } catch {
        return
    }
    throw "ASSERTION FAILED: $Message"
}

$gatewayPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\invoke-skincos-wsl.ps1")).Path
$parseErrors = $null
[void][Management.Automation.Language.Parser]::ParseFile(
    $gatewayPath,
    [ref]$null,
    [ref]$parseErrors
)
Assert-True -Condition ($parseErrors.Count -eq 0) -Message "gateway must parse without PowerShell errors"

# Passing a typed placeholder while dot-sourcing loads only the pure renderer.
# The gateway's dot-source guard guarantees that this test never invokes wsl.exe.
. $gatewayPath -NpmScript "__gateway_unit_test__"

$npm = New-SkincosWslInvocation `
    -Mode NpmScript `
    -Target "codex:context" `
    -ProjectRoot "C:\CodexShared\Projetos\skincos" `
    -Argument @("--online", "literal; touch /tmp/not-run", "single'quote") `
    -EnvVar @("SAFE_VALUE=literal; echo not-run") `
    -SkipBootstrapCheck `
    -SkipGitCheck

Assert-Contains `
    -Value $npm.BashCommand `
    -Expected "export SAFE_VALUE='literal; echo not-run'" `
    -Message "environment values must be single-quoted literals"
Assert-Contains `
    -Value $npm.BashCommand `
    -Expected "npm run 'codex:context' -- '--online' 'literal; touch /tmp/not-run'" `
    -Message "npm arguments must cross as quoted argv entries"
Assert-Contains `
    -Value $npm.BashCommand `
    -Expected '''single''"''"''quote''' `
    -Message "embedded apostrophes must use the safe bash literal form"
Assert-True `
    -Condition (
        $npm.BashCommand.IndexOf("command -v node", [StringComparison]::Ordinal) -lt
        $npm.BashCommand.LastIndexOf("npm run", [StringComparison]::Ordinal)
    ) `
    -Message "toolchain checks must precede the npm execution"

$processArguments = @(New-SkincosWslProcessArgumentList -BashCommand $npm.BashCommand)
Assert-True -Condition ($processArguments[0] -eq "--distribution") -Message "distribution must be explicit"
Assert-True -Condition ($processArguments[1] -eq "Ubuntu-24.04") -Message "Ubuntu-24.04 must be selected"
Assert-True -Condition ($processArguments[2] -eq "--user") -Message "operator flag must be explicit"
Assert-True -Condition ($processArguments[3] -eq "admin") -Message "the admin operator must be selected"
Assert-True -Condition ($processArguments[4] -eq "--") -Message "WSL options must end before bash argv"
$encodedMatch = [regex]::Match(
    $processArguments[7],
    '^printf %s (?<payload>[A-Za-z0-9+/=]+) \| base64 --decode \| bash$'
)
Assert-True -Condition $encodedMatch.Success -Message "bash program must use the quote-safe base64 transport"
$decodedProgram = [Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($encodedMatch.Groups["payload"].Value)
)
Assert-True -Condition ($decodedProgram -eq $npm.BashCommand) -Message "base64 transport must preserve the exact rendered program"
$npmProbeSource = "const p=require('./package.json');const n=process.argv[1];process.exit(p.scripts&&Object.prototype.hasOwnProperty.call(p.scripts,n)?0:1)"
Assert-Contains `
    -Value $decodedProgram `
    -Expected ("node -e " + (Convert-ToBashLiteral -Value $npmProbeSource)) `
    -Message "the effective npm preflight must preserve JavaScript string quotes"

$governedWorktree = New-SkincosWslInvocation `
    -Mode Executable `
    -Target "node" `
    -ProjectRoot "C:\CodexShared\Worktrees\skincos\admin\ponto-progressive-release" `
    -Argument @("--version")
Assert-Contains `
    -Value $governedWorktree.BashCommand `
    -Expected "git -C / config --global --get-all safe.directory" `
    -Message "bootstrap must inspect global Git config without discovering a Windows-native worktree pointer"
Assert-Contains `
    -Value $governedWorktree.BashCommand `
    -Expected "WSL bootstrap for this checkout is not ready." `
    -Message "an unregistered worktree must remain fail-closed"

$shell = New-SkincosWslInvocation `
    -Mode ScriptPath `
    -Target ".\scripts\codex-context.sh" `
    -ProjectRoot "C:\CodexShared\Projetos\skincos" `
    -Argument @("--online") `
    -SkipBootstrapCheck `
    -SkipNodeCheck `
    -SkipNpmCheck `
    -SkipGitCheck
Assert-Contains `
    -Value $shell.BashCommand `
    -Expected "bash -- 'scripts/codex-context.sh' '--online'" `
    -Message "ScriptPath must normalize and invoke a repository-relative shell script"

$python = New-SkincosWslInvocation `
    -Mode PythonScript `
    -Target "integration/ef/selftest.py" `
    -ProjectRoot "C:\CodexShared\Projetos\skincos" `
    -Argument @("--safe") `
    -SkipBootstrapCheck `
    -SkipNodeCheck `
    -SkipNpmCheck `
    -SkipGitCheck
Assert-Contains `
    -Value $python.BashCommand `
    -Expected "python3 -- 'integration/ef/selftest.py' '--safe'" `
    -Message "PythonScript must use WSL python3 with quoted argv"

$executableInvocation = New-SkincosWslInvocation `
    -Mode Executable `
    -Target "git" `
    -ProjectRoot "C:\CodexShared\Projetos\skincos" `
    -Argument @("status", "--short") `
    -SkipBootstrapCheck `
    -SkipNodeCheck `
    -SkipNpmCheck `
    -SkipGitCheck
Assert-Contains `
    -Value $executableInvocation.BashCommand `
    -Expected "if ! command -v -- 'git'" `
    -Message "Executable must be checked before it is invoked"
Assert-Contains `
    -Value $executableInvocation.BashCommand `
    -Expected "'git' 'status' '--short'" `
    -Message "Executable arguments must remain separate quoted entries"

$legacy = New-SkincosWslInvocation `
    -Mode LegacyRepoCommand `
    -Target "printf 'legacy compatibility only'" `
    -ProjectRoot "C:\CodexShared\Projetos\skincos" `
    -SkipBootstrapCheck `
    -SkipNodeCheck `
    -SkipNpmCheck `
    -SkipGitCheck
Assert-True `
    -Condition $legacy.BashCommand.EndsWith("printf 'legacy compatibility only'", [StringComparison]::Ordinal) `
    -Message "RepoCommand compatibility must preserve the existing raw shell payload"

Assert-Throws `
    -Action {
        New-SkincosWslInvocation `
            -Mode ScriptPath `
            -Target "../outside.sh" `
            -ProjectRoot "C:\CodexShared\Projetos\skincos"
    } `
    -Message "typed paths must reject traversal"
Assert-Throws `
    -Action {
        New-SkincosWslInvocation `
            -Mode PythonScript `
            -Target "script.sh" `
            -ProjectRoot "C:\CodexShared\Projetos\skincos"
    } `
    -Message "PythonScript must reject non-Python paths"
Assert-Throws `
    -Action {
        New-SkincosWslInvocation `
            -Mode NpmScript `
            -Target "context; whoami" `
            -ProjectRoot "C:\CodexShared\Projetos\skincos"
    } `
    -Message "NpmScript must reject shell syntax"
Assert-Throws `
    -Action {
        New-SkincosWslInvocation `
            -Mode Executable `
            -Target "git;whoami" `
            -ProjectRoot "C:\CodexShared\Projetos\skincos"
    } `
    -Message "Executable must reject shell syntax"
Assert-Throws `
    -Action {
        New-SkincosWslInvocation `
            -Mode NpmScript `
            -Target "codex:context" `
            -ProjectRoot "C:\CodexShared\Projetos\skincos" `
            -EnvVar @("HOME=C:\unsafe")
    } `
    -Message "environment input must not repurpose HOME"
Assert-Throws `
    -Action {
        New-SkincosWslInvocation `
            -Mode NpmScript `
            -Target "codex:context" `
            -ProjectRoot "C:\CodexShared\Projetos\skincos" `
            -EnvVar @("SAFE=one", "safe=two")
    } `
    -Message "environment input must reject duplicate names"

Write-Host "invoke-skincos-wsl.test.ps1: PASS"
