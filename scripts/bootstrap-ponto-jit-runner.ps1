[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$Repository = 'jubenitogarcia/skincos',
    [ValidateSet('Validate', 'Prepare', 'Start')]
    [string]$Mode = 'Validate',
    [string]$RunnerVersion = '',
    [string]$RunnerSha256 = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-GitHubJson {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = & gh @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'GitHub API request failed; no Ponto runner action was attempted.'
    }
    $text = ($output -join [Environment]::NewLine).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) {
        throw 'GitHub API returned an empty response; no Ponto runner action was attempted.'
    }
    return $text | ConvertFrom-Json
}

function Invoke-GitHubValue {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = & gh @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw 'GitHub API request failed; no Ponto runner action was attempted.'
    }
    $value = ($output -join [Environment]::NewLine).Trim()
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw 'GitHub API returned an empty value; no Ponto runner action was attempted.'
    }
    return $value
}

function Get-PrivatePontoJitMaterial {
    param([Parameter(Mandatory = $true)][string]$VaultPath)

    Add-Type -AssemblyName System.Security
    $raw = [Security.Cryptography.ProtectedData]::Unprotect(
        [IO.File]::ReadAllBytes($VaultPath),
        $null,
        [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    try {
        $records = ([Text.Encoding]::UTF8.GetString($raw) | ConvertFrom-Json)
        $jit = $records.private.jitRunner
        if (
            $null -eq $jit -or
            [string]::IsNullOrWhiteSpace([string]$jit.attestationPrivateKeyPem) -or
            [string]::IsNullOrWhiteSpace([string]$jit.encryptionPrivateKeyPem)
        ) {
            throw 'The private Ponto JIT key material is unavailable in the operator vault.'
        }
        return [ordered]@{
            attestationPrivateKeyPem = [string]$jit.attestationPrivateKeyPem
            encryptionPrivateKeyPem = [string]$jit.encryptionPrivateKeyPem
        }
    }
    finally {
        [Array]::Clear($raw, 0, $raw.Length)
        $raw = $null
    }
}

function Get-PontoRunnerPolicy {
    param([Parameter(Mandatory = $true)][string]$PolicyPath)

    $document = Get-Content -LiteralPath $PolicyPath -Raw | ConvertFrom-Json
    $runner = $document.pilotRunner.production
    $labels = @($runner.requiredLabels | ForEach-Object { [string]$_ })
    if (
        $null -eq $runner -or
        [string]::IsNullOrWhiteSpace([string]$runner.runnerName) -or
        [string]$runner.runnerName -notmatch '^ponto-jit-[a-z0-9][a-z0-9-]{15,63}$' -or
        $labels.Count -ne 4 -or
        ($labels -join '|') -ne ("self-hosted|Linux|X64|" + [string]$runner.runnerName) -or
        [string]$runner.encryptionPublicKeySha256 -notmatch '^[0-9a-f]{64}$' -or
        [string]::IsNullOrWhiteSpace([string]$runner.jitAttestationKeyId) -or
        [string]::IsNullOrWhiteSpace([string]$runner.jitAttestationPublicKeyPem) -or
        [string]::IsNullOrWhiteSpace([string]$runner.runnerIsolationRef) -or
        [string]::IsNullOrWhiteSpace([string]$runner.networkContextCustodyRef) -or
        [string]::IsNullOrWhiteSpace([string]$runner.jitSupervisorCustodyRef) -or
        [string]::IsNullOrWhiteSpace([string]$runner.jitCleanupHookCustodyRef)
    ) {
        throw 'The versioned production Ponto runner policy remains fail-closed.'
    }
    return [ordered]@{
        id = [string]$runner.runnerId
        name = [string]$runner.runnerName
        labels = $labels
        runnerIsolationRef = [string]$runner.runnerIsolationRef
        networkContextCustodyRef = [string]$runner.networkContextCustodyRef
        encryptionPublicKeySha256 = ([string]$runner.encryptionPublicKeySha256).ToLowerInvariant()
        jitAttestationKeyId = [string]$runner.jitAttestationKeyId
        jitAttestationPublicKeyPem = [string]$runner.jitAttestationPublicKeyPem
        jitSupervisorCustodyRef = [string]$runner.jitSupervisorCustodyRef
        jitCleanupHookCustodyRef = [string]$runner.jitCleanupHookCustodyRef
    }
}

function Get-LinuxPath {
    param([Parameter(Mandatory = $true)][string]$WindowsPath)
    if ($WindowsPath -notmatch '^([A-Za-z]):\\(.*)$') {
        throw 'ProjectRoot must be a Windows filesystem path.'
    }
    return ('/mnt/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\', '/'))
}

function Test-ExactLabelSet {
    param(
        [Parameter(Mandatory = $true)][string[]]$Actual,
        [Parameter(Mandatory = $true)][string[]]$Expected
    )

    if ($Actual.Count -ne $Expected.Count) { return $false }
    $actualSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($label in $Actual) { [void]$actualSet.Add($label) }
    if ($actualSet.Count -ne $Expected.Count) { return $false }
    foreach ($label in $Expected) {
        if (-not $actualSet.Contains($label)) { return $false }
    }
    return $true
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "ProjectRoot does not exist: $ProjectRoot"
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
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
$installer = Join-Path $ProjectRoot 'scripts\runtime\install-ponto-jit-runner.sh'
$policyPath = Join-Path $ProjectRoot '.github\governance\progressive-release-policy.json'
$vaultPath = 'C:\CodexRuntime\operator\admin\skincos\ponto-vault\ponto-vault.dpapi'
if (
    -not (Test-Path -LiteralPath $gateway -PathType Leaf) -or
    -not (Test-Path -LiteralPath $installer -PathType Leaf) -or
    -not (Test-Path -LiteralPath $policyPath -PathType Leaf)
) {
    throw 'The typed WSL gateway, installer, or versioned Ponto runner policy is unavailable.'
}

$policy = Get-PontoRunnerPolicy -PolicyPath $policyPath
$release = Invoke-GitHubJson -Arguments @('api', 'repos/actions/runner/releases/latest')
$asset = @($release.assets | Where-Object { $_.name -match '^actions-runner-linux-x64-[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz$' } | Select-Object -First 1)
if ($asset.Count -ne 1 -or [string]::IsNullOrWhiteSpace([string]$release.tag_name) -or [string]::IsNullOrWhiteSpace([string]$asset[0].digest)) {
    throw 'The latest GitHub Actions runner release did not expose one verifiable Linux x64 asset.'
}
$latestVersion = ([string]$release.tag_name) -replace '^v', ''
$latestDigest = ([string]$asset[0].digest) -replace '^sha256:', ''
if ($latestVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or $latestDigest -notmatch '^[A-Fa-f0-9]{64}$') {
    throw 'The latest GitHub Actions runner identity is invalid.'
}
if (-not $RunnerVersion) {
    $RunnerVersion = $latestVersion
    $RunnerSha256 = $latestDigest
}
if ($RunnerVersion -ne $latestVersion -or $RunnerSha256.ToLowerInvariant() -ne $latestDigest.ToLowerInvariant()) {
    throw 'The requested runner pin is not the current verified GitHub runner release.'
}

$linuxRoot = Get-LinuxPath -WindowsPath $ProjectRoot
$contractArgs = @('--repository', $Repository, '--runner-version', $RunnerVersion, '--runner-sha256', $RunnerSha256, '--runner-name', $policy.name, '--runner-label', $policy.name)

if ($Mode -eq 'Validate') {
    & $gateway `
        -ProjectRoot $ProjectRoot `
        -ScriptPath 'scripts/runtime/install-ponto-jit-runner.sh' `
        -Argument $contractArgs `
        -SkipNpmCheck `
        -SkipNodeCheck
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Output "ponto_jit_runner_bootstrap=ready repository=$Repository version=$RunnerVersion runner=$($policy.name) apply=false"
    return
}

$runners = Invoke-GitHubJson -Arguments @('api', "repos/$Repository/actions/runners?per_page=100")
$matching = @($runners.runners | Where-Object { $_.name -eq $policy.name })

if ($Mode -eq 'Prepare') {
    if ($matching.Count -ne 0) {
        throw 'A runner with the policy-pinned Ponto name already exists; refusing to replace its identity automatically.'
    }
    if (-not (Test-Path -LiteralPath $vaultPath -PathType Leaf)) {
        throw 'The private Ponto operator vault is unavailable; no runner was configured.'
    }
    $registrationToken = $null
    $privateMaterial = $null
    $bootstrapJson = $null
    try {
        $registrationToken = Invoke-GitHubValue -Arguments @('api', '--method', 'POST', "repos/$Repository/actions/runners/registration-token", '--jq', '.token')
        if ($registrationToken -match '[\r\n]') {
            throw 'GitHub returned an invalid multi-line runner registration token.'
        }
        $installerArguments = @('-n', 'bash', "$linuxRoot/scripts/runtime/install-ponto-jit-runner.sh") + $contractArgs + @('--apply')
        & $gateway `
            -ProjectRoot $ProjectRoot `
            -Executable sudo `
            -Argument $installerArguments `
            -StandardInputText ($registrationToken + [char]10) `
            -SkipNpmCheck `
            -SkipNodeCheck
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

        $runners = Invoke-GitHubJson -Arguments @('api', "repos/$Repository/actions/runners?per_page=100")
        $matching = @($runners.runners | Where-Object { $_.name -eq $policy.name })
        if ($matching.Count -ne 1) {
            throw 'GitHub did not register one unique Ponto runner identity.'
        }
        $observedLabels = @($matching[0].labels | ForEach-Object { [string]$_.name })
        if (-not (Test-ExactLabelSet -Actual $observedLabels -Expected $policy.labels)) {
            throw 'The registered Ponto runner labels differ from the versioned policy.'
        }
        $privateMaterial = Get-PrivatePontoJitMaterial -VaultPath $vaultPath
        $manifest = [ordered]@{
            schemaVersion = 1
            repository = $Repository
            runner = [ordered]@{
                id = [string]$matching[0].id
                name = $policy.name
                user = 'skincos-ponto-jit'
                labels = $policy.labels
            }
            policy = [ordered]@{
                runnerIsolationRef = $policy.runnerIsolationRef
                networkContextCustodyRef = $policy.networkContextCustodyRef
                encryptionPublicKeySha256 = $policy.encryptionPublicKeySha256
                jitAttestationKeyId = $policy.jitAttestationKeyId
                jitAttestationPublicKeyPem = $policy.jitAttestationPublicKeyPem
                jitSupervisorCustodyRef = $policy.jitSupervisorCustodyRef
                jitCleanupHookCustodyRef = $policy.jitCleanupHookCustodyRef
            }
        }
        $bootstrapJson = ([ordered]@{
            schemaVersion = 1
            manifest = $manifest
            attestationPrivateKeyPem = $privateMaterial.attestationPrivateKeyPem
            encryptionPrivateKeyPem = $privateMaterial.encryptionPrivateKeyPem
        } | ConvertTo-Json -Depth 12 -Compress)
        & $gateway `
            -ProjectRoot $ProjectRoot `
            -Executable sudo `
            -Argument @('-n', '/usr/local/sbin/skincos-provision-ponto-jit', 'bootstrap') `
            -StandardInputText ($bootstrapJson + [char]10) `
            -SkipNpmCheck `
            -SkipNodeCheck
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Output "ponto_jit_runner_bootstrap=prepared runner=$($policy.name) runner_id=$($matching[0].id) service_started=false policy_runner_id=$($policy.id) policy_update_required=true"
    }
    finally {
        $registrationToken = $null
        $privateMaterial = $null
        $bootstrapJson = $null
    }
    return
}

if ($matching.Count -ne 1) {
    throw 'The prepared Ponto runner is not uniquely registered in GitHub.'
}
if ([string]$matching[0].id -ne $policy.id) {
    throw 'The versioned policy does not yet pin the prepared GitHub runner ID; the service remains stopped.'
}
$observedLabels = @($matching[0].labels | ForEach-Object { [string]$_.name })
if (-not (Test-ExactLabelSet -Actual $observedLabels -Expected $policy.labels)) {
    throw 'The registered Ponto runner labels differ from the versioned policy.'
}
& $gateway `
    -ProjectRoot $ProjectRoot `
    -Executable sudo `
    -Argument @('-n', 'systemctl', 'start', 'skincos-ponto-jit-runner.service') `
    -SkipNpmCheck `
    -SkipNodeCheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $gateway `
    -ProjectRoot $ProjectRoot `
    -Executable sudo `
    -Argument @('-n', 'systemctl', 'is-active', '--quiet', 'skincos-ponto-jit-runner.service') `
    -SkipNpmCheck `
    -SkipNodeCheck
if ($LASTEXITCODE -ne 0) { throw 'The Ponto runner service did not remain active.' }
$ready = $false
$deadline = [DateTime]::UtcNow.AddSeconds(30)
while ([DateTime]::UtcNow -lt $deadline) {
    $runners = Invoke-GitHubJson -Arguments @('api', "repos/$Repository/actions/runners?per_page=100")
    $matching = @($runners.runners | Where-Object { $_.name -eq $policy.name })
    if (
        $matching.Count -eq 1 -and
        [string]$matching[0].id -eq $policy.id -and
        [string]$matching[0].status -eq 'online' -and
        $matching[0].busy -eq $false -and
        (Test-ExactLabelSet -Actual @($matching[0].labels | ForEach-Object { [string]$_.name }) -Expected $policy.labels)
    ) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    & $gateway `
        -ProjectRoot $ProjectRoot `
        -Executable sudo `
        -Argument @('-n', 'systemctl', 'stop', 'skincos-ponto-jit-runner.service') `
        -SkipNpmCheck `
        -SkipNodeCheck
    throw 'The Ponto runner did not become the exact online idle policy match; the service was stopped.'
}
Write-Output "ponto_jit_runner_bootstrap=started runner=$($policy.name) runner_id=$($matching[0].id) policy_pinned=true online=true idle=true"
