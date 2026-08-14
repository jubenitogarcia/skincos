[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$LASTEXITCODE = 0

# This launcher intentionally resolves the checkout from its own location. It
# therefore follows the worktree that contains the Action instead of a shared
# campaign checkout or the former private environment.
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptRoot
$wslInvoker = Join-Path $scriptRoot 'invoke-skincos-wsl.ps1'
$websiteRoot = Join-Path $projectRoot 'website'

$route = '/beleza-em-movimento/local-preview'
$port = 3417
$url = "http://127.0.0.1:$port$route"

if (-not (Test-Path -LiteralPath $wslInvoker -PathType Leaf)) {
    throw "The typed WSL gateway is unavailable: $wslInvoker"
}
if (-not (Test-Path -LiteralPath $websiteRoot -PathType Container)) {
    throw "The website directory is unavailable in this checkout: $websiteRoot"
}
if ([string]::IsNullOrWhiteSpace([string]$env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is required for the private local-preview state.'
}

$stateRoot = Join-Path $env:LOCALAPPDATA 'Codex\skincos\beauty-movement-local-preview'
$manifestPath = Join-Path $stateRoot 'current.json'
$pidPath = Join-Path $stateRoot 'server.pid'
$portPath = Join-Path $stateRoot 'server.port'
$logPath = Join-Path $stateRoot 'server.log'

function Convert-WindowsPathToWsl {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($Path -match '^(?<drive>[A-Za-z]):[\\/](?<rest>.*)$') {
        return "/mnt/$($Matches.drive.ToLowerInvariant())/$($Matches.rest -replace '\\', '/')"
    }

    throw "Cannot convert the checkout path to WSL: $Path"
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Value)

    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        return (($hasher.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $hasher.Dispose()
    }
}

function Get-SourceIdentity {
    $commit = (& git -C $projectRoot rev-parse --verify 'HEAD^{commit}' 2>$null | Select-Object -First 1).Trim().ToLowerInvariant()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[0-9a-f]{40}$') {
        throw "Could not resolve the checkout commit from $projectRoot."
    }

    $trackedDiff = (& git -C $projectRoot diff --binary HEAD -- website 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect website changes in $projectRoot."
    }

    $status = (& git -C $projectRoot status --short --untracked-files=all -- website 2>$null | Out-String)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect website status in $projectRoot."
    }

    $untrackedPaths = @(& git -C $projectRoot ls-files --others --exclude-standard -- 'website/*' 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect untracked website files in $projectRoot."
    }

    $untrackedDigests = foreach ($relativePath in $untrackedPaths) {
        $candidate = Join-Path $projectRoot ([string]$relativePath)
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $hash = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
            "${relativePath}:$hash"
        }
    }

    $payload = @(
        "commit=$commit"
        "status=$status"
        "diff=$trackedDiff"
        "untracked=$($untrackedDigests -join "`n")"
    ) -join "`n"
    $digest = Get-Sha256 -Value $payload

    [ordered]@{
        commit = $commit
        digest = $digest
        fingerprint = "local:${commit}:$digest"
    }
}

function Test-PreviewReady {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
        return $response.StatusCode -eq 200 -and
            $response.Content -match 'Beleza que se move com você' -and
            $response.Content -match 'Novo Hamburgo'
    }
    catch {
        return $false
    }
}

function Invoke-WebsiteLauncher {
    param(
        [Parameter(Mandatory = $true)][string[]]$EnvironmentVariables,
        [string[]]$Arguments = @()
    )

    $output = & $wslInvoker `
        -ProjectRoot $projectRoot `
        -ScriptPath './scripts/run-local-website.sh' `
        -Argument $Arguments `
        -EnvVar $EnvironmentVariables `
        -SkipBootstrapCheck

    $exitCode = $LASTEXITCODE
    foreach ($line in @($output)) {
        if ($null -ne $line) {
            Write-Host ([string]$line)
        }
    }
    if ($exitCode -ne 0) {
        throw "The website local preview command failed with exit code $exitCode."
    }
}

New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$sourceIdentity = Get-SourceIdentity
$sourceRootWsl = Convert-WindowsPathToWsl -Path $projectRoot
$stateRootWsl = Convert-WindowsPathToWsl -Path $stateRoot
$pidPathWsl = Convert-WindowsPathToWsl -Path $pidPath
$portPathWsl = Convert-WindowsPathToWsl -Path $portPath
$logPathWsl = Convert-WindowsPathToWsl -Path $logPath

$environmentVariables = @(
    "WEBSITE_SOURCE_ROOT=$sourceRootWsl",
    'WEBSITE_HOST=127.0.0.1',
    "WEBSITE_PORT=$port",
    "WEBSITE_ROUTE=$route",
    "WEBSITE_STATE_DIR=$stateRootWsl",
    "WEBSITE_PID_FILE=$pidPathWsl",
    "WEBSITE_PORT_FILE=$portPathWsl",
    "WEBSITE_LOG_FILE=$logPathWsl",
    'WEBSITE_DETACH=1',
    'OPEN_BROWSER=0',
    'SKINCOS_LOCAL_PREVIEW=true',
    'NEXT_TELEMETRY_DISABLED=1'
)

if ($Stop) {
    Invoke-WebsiteLauncher -EnvironmentVariables $environmentVariables -Arguments @('--stop')
    Remove-Item -LiteralPath $manifestPath -Force -ErrorAction SilentlyContinue
    Write-Output 'Cartas da Beleza – Prévia Local encerrada.'
    exit 0
}

if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    try {
        $current = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
        if ([string]$current.sourceFingerprint -eq [string]$sourceIdentity.fingerprint -and (Test-PreviewReady)) {
            Write-Output "Cartas da Beleza – Prévia Local já está pronta: $url"
            if (-not $NoBrowser) {
                Start-Process $url | Out-Null
            }
            exit 0
        }
    }
    catch {
        # A stale or damaged manifest is replaced only after the route is healthy.
    }
}

Invoke-WebsiteLauncher -EnvironmentVariables $environmentVariables -Arguments @($route)
if (-not (Test-PreviewReady)) {
    throw "The Beauty Movement local preview did not become healthy at $url. See $logPath."
}

[ordered]@{
    version = 1
    state = 'ready'
    sourceCommit = $sourceIdentity.commit
    sourceFingerprint = $sourceIdentity.fingerprint
    projectRoot = $projectRoot
    route = $route
    url = $url
    port = $port
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Output "Cartas da Beleza – Prévia Local pronta: $url"
if (-not $NoBrowser) {
    Start-Process $url | Out-Null
}
