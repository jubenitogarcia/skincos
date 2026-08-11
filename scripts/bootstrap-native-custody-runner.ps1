[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Repository = 'jubenitogarcia/skincos',
    [string]$RunnerVersion = '',
    [string]$RunnerSha256 = '',
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-GitHubJson {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = & gh @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'GitHub API request failed; no bootstrap action was attempted.'
    }
    if ($null -eq $output -or [string]::IsNullOrWhiteSpace(($output -join ''))) {
        throw 'GitHub API returned an empty response; no bootstrap action was attempted.'
    }
    return (($output -join [Environment]::NewLine) | ConvertFrom-Json)
}

function Invoke-GitHubValue {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = & gh @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'GitHub API request failed; no bootstrap action was attempted.'
    }
    $value = (($output -join [Environment]::NewLine).Trim())
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw 'GitHub API returned an empty value; no bootstrap action was attempted.'
    }
    return $value
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "ProjectRoot does not exist: $ProjectRoot"
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
if ($ProjectRoot -notmatch '^[A-Za-z]:\\') {
    throw 'ProjectRoot must be a Windows filesystem path.'
}
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') {
    throw 'Repository must use owner/name form.'
}
if (($RunnerVersion -and -not $RunnerSha256) -or ($RunnerSha256 -and -not $RunnerVersion)) {
    throw 'RunnerVersion and RunnerSha256 must be provided together.'
}
if ($RunnerSha256 -and $RunnerSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
    throw 'RunnerSha256 must be a SHA-256 hexadecimal digest.'
}

$gateway = Join-Path $ProjectRoot 'scripts\invoke-skincos-wsl.ps1'
$installer = Join-Path $ProjectRoot 'scripts\runtime\install-native-custody-runner.sh'
if (-not (Test-Path -LiteralPath $gateway -PathType Leaf) -or -not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw 'The typed WSL gateway or native custody installer is unavailable.'
}

$release = Invoke-GitHubJson -Arguments @('api', 'repos/actions/runner/releases/latest')
$asset = @($release.assets | Where-Object { $_.name -match '^actions-runner-linux-x64-[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz$' } | Select-Object -First 1)
if ($asset.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$release.tag_name) -or [string]::IsNullOrWhiteSpace([string]$asset[0].digest)) {
    throw 'The latest GitHub Actions runner release did not expose one verifiable Linux x64 asset.'
}
$latestVersion = ([string]$release.tag_name) -replace '^v', ''
$latestDigest = ([string]$asset[0].digest) -replace '^sha256:', ''
if ($latestVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or $latestDigest -notmatch '^[A-Fa-f0-9]{64}$') {
    throw 'The latest GitHub Actions runner release identity is invalid.'
}
if (-not $RunnerVersion) {
    $RunnerVersion = $latestVersion
    $RunnerSha256 = $latestDigest
}
if ($RunnerVersion -ne $latestVersion -or $RunnerSha256.ToLowerInvariant() -ne $latestDigest.ToLowerInvariant()) {
    throw 'The requested runner pin is not the current verified GitHub runner release.'
}

$runners = Invoke-GitHubJson -Arguments @('api', "repos/$Repository/actions/runners?per_page=100")
$registeredRunner = @($runners.runners | Where-Object { $_.name -eq 'skincos-native-custody' } | Select-Object -First 1)

# Keep the local service idempotent. If this native install already owns a
# runner identity, do not mint another registration token merely to restart it.
$linuxRoot = '/mnt/' + $ProjectRoot.Substring(0, 1).ToLowerInvariant() + $ProjectRoot.Substring(2).Replace('\', '/')
$localRunnerCheck = & $gateway `
    -ProjectRoot $ProjectRoot `
    -Executable sudo `
    -Argument @('-n', 'test', '-f', '/var/lib/skincos-runtime/github-actions-runner/.runner') `
    -SkipNpmCheck `
    -SkipNodeCheck
$localRunnerExists = ($LASTEXITCODE -eq 0)
if ($Apply -and $localRunnerExists -and $registeredRunner.Count -ne 1) {
    throw 'The native runner is installed locally but no matching GitHub registration exists; refusing to overwrite runner identity automatically.'
}

$installerArguments = @(
    '-n',
    'bash',
    "$linuxRoot/scripts/runtime/install-native-custody-runner.sh",
    '--repository', $Repository,
    '--runner-version', $RunnerVersion,
    '--runner-sha256', $RunnerSha256
)
if ($Apply) {
    $installerArguments += '--apply'
}

$registrationToken = $null
$standardInput = ''
try {
    if ($Apply -and -not $localRunnerExists) {
        $registrationToken = Invoke-GitHubValue -Arguments @(
            'api',
            '--method', 'POST',
            "repos/$Repository/actions/runners/registration-token",
            '--jq', '.token'
        )
        if ($registrationToken -match '[\r\n]') {
            throw 'GitHub returned an invalid multi-line runner registration token.'
        }
        # Bash read contracts require LF; Windows [Environment]::NewLine is CRLF.
        $standardInput = $registrationToken + [char]10
    }

    if (-not $Apply) {
        & $gateway `
            -ProjectRoot $ProjectRoot `
            -ScriptPath 'scripts/runtime/install-native-custody-runner.sh' `
            -Argument @('--repository', $Repository, '--runner-version', $RunnerVersion, '--runner-sha256', $RunnerSha256) `
            -SkipNpmCheck `
            -SkipNodeCheck
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Output "native_custody_runner_bootstrap=ready repository=$Repository version=$RunnerVersion digest=$RunnerSha256 local_runner=$localRunnerExists registered_runner=$($registeredRunner.Count -eq 1) apply=false"
        return
    }

    & $gateway `
        -ProjectRoot $ProjectRoot `
        -Executable sudo `
        -Argument $installerArguments `
        -StandardInputText $standardInput `
        -SkipNpmCheck `
        -SkipNodeCheck
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Output "native_custody_runner_bootstrap=applied repository=$Repository version=$RunnerVersion digest=$RunnerSha256 token_transport=stdin-only"
}
finally {
    $registrationToken = $null
    $standardInput = $null
    $localRunnerCheck = $null
}
