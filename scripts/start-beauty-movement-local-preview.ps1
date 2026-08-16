[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$NoBrowser,
    [ValidateRange(1024, 65535)][int]$Port = 3417,
    [string]$StateRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$LASTEXITCODE = 0

$previewProtocol = 'beauty-movement-local-preview-v2'
$buildContract = 'next-dev-isolated-v1'
$moduleName = 'website'
$route = '/beleza-em-movimento/local-preview'
$fingerprintHeader = 'X-Skincos-Preview-Fingerprint'
$instanceHeader = 'X-Skincos-Preview-Instance'

# Resolve only the worktree that owns this Action; never search for a different
# Beauty Movement checkout by branch, timestamp, or fixed path.
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $scriptRoot)).Path
$wslInvoker = Join-Path $scriptRoot 'invoke-skincos-wsl.ps1'
$materializer = Join-Path $scriptRoot 'materialize-website-local-preview-source.sh'
$websiteRoot = Join-Path $projectRoot $moduleName
$previewPage = Join-Path $websiteRoot 'src\app\beleza-em-movimento\local-preview\page.tsx'

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Value)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        return (($hasher.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally { $hasher.Dispose() }
}

function Convert-WindowsPathToWsl {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ($Path -match '^(?<drive>[A-Za-z]):[\\/](?<rest>.*)$') {
        return "/mnt/$($Matches.drive.ToLowerInvariant())/$($Matches.rest -replace '\\', '/')"
    }
    throw "Cannot convert the checkout path to WSL: $Path"
}

function Test-ExactPath {
    param([AllowNull()][string]$Left, [AllowNull()][string]$Right)
    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
    $normalizedLeft = $Left.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $normalizedRight = $Right.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    return $normalizedLeft.Equals($normalizedRight, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-ActionSourceRoot {
    if (-not (Test-Path -LiteralPath $wslInvoker -PathType Leaf)) {
        throw "The typed WSL gateway is unavailable: $wslInvoker"
    }
    if (-not (Test-Path -LiteralPath $materializer -PathType Leaf)) {
        throw "The private preview materializer is unavailable: $materializer"
    }
    if (-not (Test-Path -LiteralPath $websiteRoot -PathType Container) -or -not (Test-Path -LiteralPath $previewPage -PathType Leaf)) {
        throw "This Codex Action must be opened from a worktree containing $moduleName and the Beauty Movement local-preview route. Resolved worktree: $projectRoot"
    }
    $gitTopOutput = @(& git -C $projectRoot rev-parse --show-toplevel 2>$null)
    $gitTopExitCode = $LASTEXITCODE
    $gitTop = ([string]($gitTopOutput | Select-Object -First 1)).Trim()
    if ($gitTopExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($gitTop)) {
        throw "The Action worktree is not a Git checkout: $projectRoot"
    }
    $resolvedGitTop = (Resolve-Path -LiteralPath $gitTop).Path
    if (-not (Test-ExactPath -Left $resolvedGitTop -Right $projectRoot)) {
        throw "The Action script is not rooted at its Git checkout. Script worktree: $projectRoot; Git worktree: $resolvedGitTop"
    }
}

function Invoke-PreviewWsl {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Executable', 'BashScript')][string]$Mode,
        [Parameter(Mandatory = $true)][string]$Target,
        [string[]]$Arguments = @(),
        [string[]]$EnvironmentVariables = @()
    )
    $parameters = @{
        ProjectRoot = $projectRoot
        Argument = $Arguments
        EnvVar = $EnvironmentVariables
        SkipBootstrapCheck = $true
    }
    if ($Mode -eq 'Executable') {
        $parameters.Executable = $Target
    }
    else {
        $parameters.ScriptPath = $Target
    }
    $output = & $wslInvoker @parameters
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        $detail = (@($output) -join [Environment]::NewLine).Trim()
        if ([string]::IsNullOrWhiteSpace($detail)) { $detail = 'no diagnostic output' }
        throw "The Beauty Movement local preview command failed ($Target, exit $exitCode): $detail"
    }
    return @($output)
}

function Invoke-PreviewStateTool {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $output = Invoke-PreviewWsl -Mode Executable -Target 'node' -Arguments (@('scripts/website-local-preview-state.mjs') + $Arguments)
    $json = (@($output) -join [Environment]::NewLine).Trim()
    if ([string]::IsNullOrWhiteSpace($json)) { throw 'The preview identity helper returned no JSON.' }
    try { $document = $json | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "The preview identity helper returned invalid JSON: $json" }
    if ($document.ok -ne $true) { throw "The preview identity helper rejected the request: $json" }
    return $document
}

function Get-PreviewIdentity {
    param([Parameter(Mandatory = $true)][string]$SourceRootWsl)
    $identity = Invoke-PreviewStateTool -Arguments @(
        'identity', '--source-root', $SourceRootWsl, '--route', $route,
        '--protocol', $previewProtocol, '--build-contract', $buildContract, '--json'
    )
    if ([int]$identity.version -ne 2 -or
        [string]$identity.module -ne $moduleName -or
        [string]$identity.route -ne $route -or
        [string]$identity.protocol -ne $previewProtocol -or
        [string]$identity.buildContract -ne $buildContract -or
        [string]$identity.instanceFingerprint -notmatch '^sha256:[0-9a-f]{64}$' -or
        [string]$identity.inputFingerprint -notmatch '^sha256:[0-9a-f]{64}$' -or
        [string]$identity.contractFingerprint -notmatch '^sha256:[0-9a-f]{64}$' -or
        [string]$identity.cacheKey -notmatch '^[0-9a-f]{64}$') {
        throw 'The preview identity helper returned an invalid v2 identity.'
    }
    return $identity
}

function Get-DependencyFingerprint {
    param([Parameter(Mandatory = $true)][string]$WebsitePath)
    $names = @('package.json', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc')
    $descriptor = New-Object Text.StringBuilder
    [void]$descriptor.Append("skincos:website-local-preview-dependencies:v1`0")
    foreach ($name in $names) {
        $path = Join-Path $WebsitePath $name
        [void]$descriptor.Append($name).Append("`0")
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $fileHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
            [void]$descriptor.Append($fileHash)
        }
        else { [void]$descriptor.Append('missing') }
        [void]$descriptor.Append("`n")
    }
    return "sha256:$(Get-Sha256 -Value $descriptor.ToString())"
}

function Get-MaterializedSourcePath {
    param([Parameter(Mandatory = $true)][object]$Identity)
    return (Join-Path (Join-Path $stateRoot 'source') ([string]$Identity.cacheKey))
}

function Get-MaterializedDependencyPath {
    param([Parameter(Mandatory = $true)][string]$DependencyFingerprint)
    $key = (Get-Sha256 -Value $DependencyFingerprint).Substring(0, 40)
    return (Join-Path (Join-Path $stateRoot 'dependencies') $key)
}

function Materialize-PreviewSource {
    param([Parameter(Mandatory = $true)][object]$Identity, [Parameter(Mandatory = $true)][string]$ActionSourceRootWsl)
    $destination = Get-MaterializedSourcePath -Identity $Identity
    $dependencyFingerprint = Get-DependencyFingerprint -WebsitePath $websiteRoot
    $dependencyRoot = Get-MaterializedDependencyPath -DependencyFingerprint $dependencyFingerprint
    $dependencyStatePath = Join-Path $dependencyRoot 'website\.preview-dependencies.state'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination), $dependencyRoot | Out-Null
    $destinationWsl = Convert-WindowsPathToWsl -Path $destination
    $dependencyRootWsl = Convert-WindowsPathToWsl -Path $dependencyRoot
    $dependencyStateWsl = Convert-WindowsPathToWsl -Path $dependencyStatePath
    $output = Invoke-PreviewWsl -Mode BashScript -Target './scripts/materialize-website-local-preview-source.sh' -EnvironmentVariables @(
        "PREVIEW_MATERIALIZE_SOURCE_ROOT=$ActionSourceRootWsl", "PREVIEW_MATERIALIZE_DESTINATION_ROOT=$destinationWsl",
        "PREVIEW_MATERIALIZE_ALLOWED_ROOT=$stateRootWsl", "PREVIEW_MATERIALIZE_DEPENDENCY_ROOT=$dependencyRootWsl",
        "PREVIEW_MATERIALIZE_DEPENDENCY_STATE_FILE=$dependencyStateWsl"
    )
    foreach ($line in @($output)) { if ($null -ne $line) { Write-Host ([string]$line) } }
    return [pscustomobject]@{
        sourceRoot = $destination
        sourceRootWsl = $destinationWsl
        dependencyRoot = $dependencyRoot
        dependencyFingerprint = $dependencyFingerprint
    }
}

function Read-JsonFile {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop) }
    catch { return $null }
}

function Write-AtomicJson {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][object]$Value)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $temporaryPath = Join-Path $directory (".$([IO.Path]::GetFileName($Path)).$([Guid]::NewGuid().ToString('N')).tmp")
    try {
        $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $temporaryPath -Encoding utf8 -NoNewline
        Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
    }
    finally { Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue }
}

function Get-HeaderValue {
    param([Parameter(Mandatory = $true)][object]$Response, [Parameter(Mandatory = $true)][string]$Name)
    $value = $Response.Headers[$Name]
    if ($value -is [Array]) { return ([string]($value | Select-Object -First 1)).Trim() }
    return ([string]$value).Trim()
}

function Test-PreviewReady {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Fingerprint,
        [Parameter(Mandatory = $true)][string]$InstanceId
    )
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        $valid = $response.StatusCode -eq 200 -and
            (Get-HeaderValue -Response $response -Name $fingerprintHeader) -ceq $Fingerprint -and
            (Get-HeaderValue -Response $response -Name $instanceHeader) -ceq $InstanceId -and
            $response.Content -match 'Beleza que se move com você' -and
            $response.Content -match 'Novo Hamburgo'
        return [pscustomobject]@{ Ready = $valid; Response = $response }
    }
    catch { return [pscustomobject]@{ Ready = $false; Response = $null } }
}

function Get-VerifiedRunnerState {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][object]$Identity,
        [Parameter(Mandatory = $true)][string]$SourceRootWsl,
        [Parameter(Mandatory = $true)][string]$InstanceId,
        [Parameter(Mandatory = $true)][int]$ExpectedPort,
        [Parameter(Mandatory = $true)][string]$ExpectedDistDir
    )
    $state = Read-JsonFile -Path $Path
    if ($null -eq $state -or
        [int]$state.version -ne 1 -or
        [string]$state.sourceRoot -ne $SourceRootWsl -or
        [string]$state.websiteDir -ne "$SourceRootWsl/$moduleName" -or
        [string]$state.route -ne $route -or
        [string]$state.host -ne '127.0.0.1' -or
        [int]$state.port -ne $ExpectedPort -or
        [string]$state.fingerprint -ne [string]$Identity.instanceFingerprint -or
        [string]$state.instanceId -ne $InstanceId -or
        [string]$state.distDir -ne $ExpectedDistDir -or
        [int]$state.supervisorPid -le 0 -or
        [string]$state.supervisorStartTicks -notmatch '^[0-9]+$') { return $null }
    return $state
}

function Test-VerifiedSupervisor {
    param([Parameter(Mandatory = $true)][object]$RunnerState, [Parameter(Mandatory = $true)][string]$SourceRootWsl)
    try {
        $probe = Invoke-PreviewStateTool -Arguments @(
            'process', '--pid', ([string]$RunnerState.supervisorPid), '--source-root', $SourceRootWsl,
            '--expected-start-ticks', ([string]$RunnerState.supervisorStartTicks),
            '--script-marker', 'scripts/run-local-website.sh', '--json'
        )
        return $probe.valid -eq $true
    }
    catch { return $false }
}

function Test-ReusablePreview {
    param(
        [AllowNull()][object]$Manifest,
        [Parameter(Mandatory = $true)][object]$Identity,
        [Parameter(Mandatory = $true)][string]$ActionSourceRootWsl,
        [Parameter(Mandatory = $true)][string]$MaterializedSourceRootWsl,
        [Parameter(Mandatory = $true)][string]$RunnerStatePath
    )
    if ($null -eq $Manifest) { return [pscustomobject]@{ Reusable = $false; Reason = 'manifest_missing_or_invalid' } }
    if ([int]$Manifest.version -ne 2 -or [string]$Manifest.state -ne 'ready' -or
        [string]$Manifest.projectRoot -ne $projectRoot -or [string]$Manifest.sourceRootWsl -ne $ActionSourceRootWsl -or
        [string]$Manifest.materializedSourceRootWsl -ne $MaterializedSourceRootWsl -or
        [string]$Manifest.module -ne $moduleName -or [string]$Manifest.route -ne $route -or
        [string]$Manifest.protocol -ne $previewProtocol -or [string]$Manifest.buildContract -ne $buildContract -or
        [string]$Manifest.instanceFingerprint -ne [string]$Identity.instanceFingerprint -or
        [string]$Manifest.inputFingerprint -ne [string]$Identity.inputFingerprint -or
        [string]$Manifest.contractFingerprint -ne [string]$Identity.contractFingerprint -or
        [string]$Manifest.cacheKey -notmatch '^[0-9a-f]{64}$' -or
        [string]$Manifest.distDir -notmatch '^\.next-codex-preview/[0-9a-f]{64}-[0-9a-f]{12}$' -or
        [string]$Manifest.instanceId -notmatch '^[0-9a-f]{32}$' -or
        [int]$Manifest.port -lt 1024 -or [int]$Manifest.port -gt 65535 -or
        [int]$Manifest.supervisorPid -le 0 -or [string]$Manifest.supervisorStartTicks -notmatch '^[0-9]+$') {
        return [pscustomobject]@{ Reusable = $false; Reason = 'manifest_contract_mismatch' }
    }
    $expectedUrl = "http://127.0.0.1:$([int]$Manifest.port)$route"
    if ([string]$Manifest.url -ne $expectedUrl) { return [pscustomobject]@{ Reusable = $false; Reason = 'manifest_url_mismatch' } }
    $runnerState = Get-VerifiedRunnerState -Path $RunnerStatePath -Identity $Identity -SourceRootWsl $MaterializedSourceRootWsl `
        -InstanceId ([string]$Manifest.instanceId) -ExpectedPort ([int]$Manifest.port) -ExpectedDistDir ([string]$Manifest.distDir)
    if ($null -eq $runnerState -or [int]$runnerState.supervisorPid -ne [int]$Manifest.supervisorPid -or
        [string]$runnerState.supervisorStartTicks -ne [string]$Manifest.supervisorStartTicks) {
        return [pscustomobject]@{ Reusable = $false; Reason = 'runner_state_mismatch' }
    }
    if (-not (Test-VerifiedSupervisor -RunnerState $runnerState -SourceRootWsl $MaterializedSourceRootWsl)) {
        return [pscustomobject]@{ Reusable = $false; Reason = 'supervisor_not_proven' }
    }
    $ready = Test-PreviewReady -Url $expectedUrl -Fingerprint ([string]$Identity.instanceFingerprint) -InstanceId ([string]$Manifest.instanceId)
    if (-not $ready.Ready) { return [pscustomobject]@{ Reusable = $false; Reason = 'served_attestation_mismatch' } }
    return [pscustomobject]@{ Reusable = $true; Reason = 'verified'; Url = $expectedUrl; RunnerState = $runnerState }
}

function Get-OwnedPreviewSupervisor {
    param(
        [AllowNull()][object]$Manifest,
        [Parameter(Mandatory = $true)][string]$ActionSourceRootWsl,
        [Parameter(Mandatory = $true)][string]$RunnerStatePath
    )
    if ($null -eq $Manifest -or [int]$Manifest.version -ne 2 -or [string]$Manifest.projectRoot -ne $projectRoot -or
        [string]$Manifest.sourceRootWsl -ne $ActionSourceRootWsl -or [string]$Manifest.materializedSourceRootWsl -notlike "$stateRootWsl/source/*" -or
        [int]$Manifest.port -lt 1024 -or [int]$Manifest.port -gt 65535 -or [int]$Manifest.supervisorPid -le 0 -or
        [string]$Manifest.supervisorStartTicks -notmatch '^[0-9]+$' -or [string]$Manifest.instanceId -notmatch '^[0-9a-f]{32}$') {
        return $null
    }
    $runnerState = Read-JsonFile -Path $RunnerStatePath
    if ($null -eq $runnerState -or [int]$runnerState.version -ne 1 -or
        [string]$runnerState.sourceRoot -ne [string]$Manifest.materializedSourceRootWsl -or
        [string]$runnerState.websiteDir -ne "$($Manifest.materializedSourceRootWsl)/$moduleName" -or
        [string]$runnerState.route -ne $route -or [string]$runnerState.host -ne '127.0.0.1' -or
        [int]$runnerState.port -ne [int]$Manifest.port -or [string]$runnerState.instanceId -ne [string]$Manifest.instanceId -or
        [int]$runnerState.supervisorPid -ne [int]$Manifest.supervisorPid -or
        [string]$runnerState.supervisorStartTicks -ne [string]$Manifest.supervisorStartTicks) {
        return $null
    }
    if (-not (Test-VerifiedSupervisor -RunnerState $runnerState -SourceRootWsl ([string]$Manifest.materializedSourceRootWsl))) { return $null }
    return $runnerState
}

function Get-SelectedPort {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "The preview runner did not publish a selected port: $Path" }
    $raw = (Get-Content -LiteralPath $Path -Raw -ErrorAction Stop).Trim()
    $selected = 0
    if (-not [int]::TryParse($raw, [ref]$selected) -or $selected -lt 1024 -or $selected -gt 65535) {
        throw "The preview runner published an invalid port: $raw"
    }
    return $selected
}

function Invoke-WebsiteRunner {
    param([Parameter(Mandatory = $true)][string[]]$EnvironmentVariables, [string[]]$Arguments = @())
    $output = Invoke-PreviewWsl -Mode BashScript -Target './scripts/run-local-website.sh' -Arguments $Arguments -EnvironmentVariables $EnvironmentVariables
    foreach ($line in @($output)) { if ($null -ne $line) { Write-Host ([string]$line) } }
}

function Get-BaseRunnerEnvironment {
    param([Parameter(Mandatory = $true)][string]$RunnerSourceRootWsl)
    return @(
        "WEBSITE_SOURCE_ROOT=$RunnerSourceRootWsl", 'WEBSITE_HOST=127.0.0.1', "WEBSITE_PORT=$Port", "WEBSITE_ROUTE=$route",
        "WEBSITE_STATE_DIR=$stateRootWsl", "WEBSITE_PID_FILE=$pidPathWsl", "WEBSITE_PORT_FILE=$portPathWsl",
        "WEBSITE_LOG_FILE=$logPathWsl", "WEBSITE_INSTANCE_STATE_FILE=$runnerStatePathWsl",
        "WEBSITE_SUPERVISOR_TOKEN_FILE=$supervisorTokenPathWsl", 'WEBSITE_DETACH=1', 'WEBSITE_ALLOW_PORT_FALLBACK=1',
        'OPEN_BROWSER=0', 'SKINCOS_LOCAL_PREVIEW=true', 'NEXT_TELEMETRY_DISABLED=1'
    )
}

Assert-ActionSourceRoot
if ([string]::IsNullOrWhiteSpace([string]$env:LOCALAPPDATA)) { throw 'LOCALAPPDATA is required for the private local-preview state.' }

$worktreeKey = (Get-Sha256 -Value $projectRoot).Substring(0, 20)
if ([string]::IsNullOrWhiteSpace($StateRoot)) {
    $stateRoot = Join-Path $env:LOCALAPPDATA "Codex\skincos\beauty-movement-local-preview\v2\$worktreeKey"
}
else { $stateRoot = [IO.Path]::GetFullPath($StateRoot) }

$manifestPath = Join-Path $stateRoot 'current.json'
$pidPath = Join-Path $stateRoot 'server.pid'
$portPath = Join-Path $stateRoot 'server.port'
$logPath = Join-Path $stateRoot 'server.log'
$runnerStatePath = Join-Path $stateRoot 'instance.json'
$supervisorTokenPath = Join-Path $stateRoot 'supervisor.token'
$sourceRootWsl = Convert-WindowsPathToWsl -Path $projectRoot
$stateRootWsl = Convert-WindowsPathToWsl -Path $stateRoot
$pidPathWsl = Convert-WindowsPathToWsl -Path $pidPath
$portPathWsl = Convert-WindowsPathToWsl -Path $portPath
$logPathWsl = Convert-WindowsPathToWsl -Path $logPath
$runnerStatePathWsl = Convert-WindowsPathToWsl -Path $runnerStatePath
$supervisorTokenPathWsl = Convert-WindowsPathToWsl -Path $supervisorTokenPath

New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$mutex = New-Object Threading.Mutex($false, "Local\SkincosBeautyMovementPreviewV2_$worktreeKey")
$lockTaken = $false
try {
    try { $lockTaken = $mutex.WaitOne([TimeSpan]::FromSeconds(120)) }
    catch [Threading.AbandonedMutexException] { $lockTaken = $true }
    if (-not $lockTaken) { throw 'Another invocation of this Beauty Movement Action is still reconciling the local preview.' }

    $actionSourceRootWsl = $sourceRootWsl
    $identity = Get-PreviewIdentity -SourceRootWsl $actionSourceRootWsl
    $candidateMaterializedSource = Get-MaterializedSourcePath -Identity $identity
    $candidateMaterializedSourceWsl = Convert-WindowsPathToWsl -Path $candidateMaterializedSource
    $current = Read-JsonFile -Path $manifestPath

    if ($Stop) {
        $owned = Get-OwnedPreviewSupervisor -Manifest $current -ActionSourceRootWsl $actionSourceRootWsl -RunnerStatePath $runnerStatePath
        $stopSourceRootWsl = if ($null -ne $owned) { [string]$current.materializedSourceRootWsl } else { $candidateMaterializedSourceWsl }
        Invoke-WebsiteRunner -EnvironmentVariables (Get-BaseRunnerEnvironment -RunnerSourceRootWsl $stopSourceRootWsl) -Arguments @('--stop')
        Remove-Item -LiteralPath $manifestPath, $runnerStatePath, $supervisorTokenPath -Force -ErrorAction SilentlyContinue
        Write-Output "Cartas da Beleza – Prévia Local encerrada. worktree=$projectRoot"
        return
    }

    $reuse = Test-ReusablePreview -Manifest $current -Identity $identity -ActionSourceRootWsl $actionSourceRootWsl `
        -MaterializedSourceRootWsl $candidateMaterializedSourceWsl -RunnerStatePath $runnerStatePath
    if ($reuse.Reusable) {
        Write-Output "Cartas da Beleza – Prévia Local reutilizada. worktree=$projectRoot module=$moduleName fingerprint=$($identity.instanceFingerprint) instance=$($current.instanceId) url=$($reuse.Url)"
        if (-not $NoBrowser) { Start-Process $reuse.Url | Out-Null }
        return
    }

    # A stale process is stopped only when the v2 manifest, runner state and
    # /proc proof all agree that it belongs to this Action.  Anything less is
    # deliberately left alone; the runner will allocate a fresh local port.
    $owned = Get-OwnedPreviewSupervisor -Manifest $current -ActionSourceRootWsl $actionSourceRootWsl -RunnerStatePath $runnerStatePath
    if ($null -ne $owned) {
        Invoke-WebsiteRunner -EnvironmentVariables (Get-BaseRunnerEnvironment -RunnerSourceRootWsl ([string]$current.materializedSourceRootWsl)) -Arguments @('--stop')
    }

    $materialized = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        $sourceAtCopyStart = $identity
        $materialized = Materialize-PreviewSource -Identity $sourceAtCopyStart -ActionSourceRootWsl $actionSourceRootWsl
        $sourceAfterCopy = Get-PreviewIdentity -SourceRootWsl $actionSourceRootWsl
        if ([string]$sourceAtCopyStart.instanceFingerprint -eq [string]$sourceAfterCopy.instanceFingerprint -and
            [string]$sourceAtCopyStart.inputFingerprint -eq [string]$sourceAfterCopy.inputFingerprint -and
            [string]$sourceAtCopyStart.contractFingerprint -eq [string]$sourceAfterCopy.contractFingerprint) {
            $identity = $sourceAfterCopy
            break
        }
        $identity = $sourceAfterCopy
        $materialized = $null
    }
    if ($null -eq $materialized) {
        throw 'The website inputs changed while the private preview source was being materialized. Please run the Action again after the local edits settle.'
    }

    $baseEnvironment = Get-BaseRunnerEnvironment -RunnerSourceRootWsl ([string]$materialized.sourceRootWsl)
    $instanceId = [Guid]::NewGuid().ToString('N')
    $distDir = ".next-codex-preview/$($identity.cacheKey)-$($instanceId.Substring(0, 12))"
    $launchEnvironment = @($baseEnvironment + @(
        "WEBSITE_INSTANCE_FINGERPRINT=$($identity.instanceFingerprint)", "WEBSITE_INSTANCE_ID=$instanceId",
        "WEBSITE_INSTANCE_EXPECTED_FINGERPRINT=$($identity.instanceFingerprint)", "WEBSITE_INSTANCE_EXPECTED_ID=$instanceId",
        "WEBSITE_INSTANCE_FINGERPRINT_HEADER=$fingerprintHeader", "WEBSITE_INSTANCE_ID_HEADER=$instanceHeader",
        "WEBSITE_LOCAL_PREVIEW_DIST_DIR=$distDir", "SKINCOS_LOCAL_PREVIEW_FINGERPRINT=$($identity.instanceFingerprint)",
        "SKINCOS_LOCAL_PREVIEW_INSTANCE=$instanceId", "SKINCOS_LOCAL_PREVIEW_DIST_DIR=$distDir",
        "NEXT_PUBLIC_BUILD_SHA=$($identity.sourceCommit)"
    ))

    Remove-Item -LiteralPath $runnerStatePath -Force -ErrorAction SilentlyContinue
    Invoke-WebsiteRunner -EnvironmentVariables $launchEnvironment -Arguments @($route)
    $selectedPort = Get-SelectedPort -Path $portPath
    $url = "http://127.0.0.1:$selectedPort$route"
    $ready = Test-PreviewReady -Url $url -Fingerprint ([string]$identity.instanceFingerprint) -InstanceId $instanceId
    if (-not $ready.Ready) { throw "The Beauty Movement local preview did not attest the requested instance at $url. See $logPath." }
    $runnerState = Get-VerifiedRunnerState -Path $runnerStatePath -Identity $identity -SourceRootWsl ([string]$materialized.sourceRootWsl) `
        -InstanceId $instanceId -ExpectedPort $selectedPort -ExpectedDistDir $distDir
    if ($null -eq $runnerState -or -not (Test-VerifiedSupervisor -RunnerState $runnerState -SourceRootWsl ([string]$materialized.sourceRootWsl))) {
        throw "The preview response was reachable but its WSL supervisor could not be proven. The URL will not be published. See $logPath."
    }

    $manifest = [ordered]@{
        version = 2; state = 'ready'; protocol = $previewProtocol; buildContract = $buildContract; module = $moduleName
        projectRoot = $projectRoot; sourceRootWsl = $actionSourceRootWsl; materializedSourceRootWsl = $materialized.sourceRootWsl; sourceCommit = $identity.sourceCommit
        inputFingerprint = $identity.inputFingerprint; contractFingerprint = $identity.contractFingerprint
        sourceFingerprint = $identity.instanceFingerprint; instanceFingerprint = $identity.instanceFingerprint; cacheKey = $identity.cacheKey
        distDir = $distDir; route = $route; port = $selectedPort; url = $url; instanceId = $instanceId
        supervisorPid = [int]$runnerState.supervisorPid; supervisorStartTicks = [string]$runnerState.supervisorStartTicks
        runnerStatePath = $runnerStatePath; startedAt = (Get-Date).ToUniversalTime().ToString('o')
        attestation = [ordered]@{ fingerprintHeader = $fingerprintHeader; fingerprint = $identity.instanceFingerprint; instanceHeader = $instanceHeader; instanceId = $instanceId }
    }
    Write-AtomicJson -Path $manifestPath -Value $manifest
    Write-Output "Cartas da Beleza – Prévia Local reconstruída. reason=$($reuse.Reason) worktree=$projectRoot module=$moduleName fingerprint=$($identity.instanceFingerprint) instance=$instanceId url=$url"
    if (-not $NoBrowser) { Start-Process $url | Out-Null }
}
finally {
    if ($lockTaken) { $mutex.ReleaseMutex() | Out-Null }
    $mutex.Dispose()
}
