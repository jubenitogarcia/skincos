param(
    [Parameter(Mandatory = $true)]
    [string]$RepoCommand,
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string[]]$EnvVar = @(),
    [switch]$SkipBootstrapCheck,
    [switch]$SkipNodeCheck,
    [switch]$SkipNpmCheck,
    [switch]$SkipGitCheck,
    [switch]$SkipRepoCheck
)

$ErrorActionPreference = "Stop"

function Convert-WindowsPathToWsl {
    param([string]$Path)

    if ($Path -match '^(?<drive>[A-Za-z]):\\(?<rest>.*)$') {
        $drive = $Matches.drive.ToLowerInvariant()
        $rest = $Matches.rest -replace '\\', '/'
        if ([string]::IsNullOrWhiteSpace($rest)) {
            return "/mnt/$drive"
        }
        return "/mnt/$drive/$rest"
    }

    return $Path
}

function Convert-ToBashLiteral {
    param([string]$Value)

    return "'" + $Value.Replace("'", "'""'""'") + "'"
}

function Resolve-EnvVarEntry {
    param([string]$Entry)

    $parts = $Entry.Split('=', 2)
    if ($parts.Count -ne 2 -or [string]::IsNullOrWhiteSpace($parts[0])) {
        throw "EnvVar entry must use NAME=value format. Received: $Entry"
    }

    $name = $parts[0].Trim()
    $value = [Environment]::ExpandEnvironmentVariables($parts[1])
    if ($value -match '^[A-Za-z]:\\') {
        $value = Convert-WindowsPathToWsl -Path $value
    }

    return [pscustomobject]@{
        Name = $name
        Value = $value
    }
}

$wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
if (-not $wsl) {
    throw "wsl.exe not found. Install or enable Windows Subsystem for Linux before using shared Skincos shortcuts."
}

$repoMountPath = Convert-WindowsPathToWsl -Path $ProjectRoot
$defaultDistro = $null
$defaultDistroLine = @(& $wsl.Source -l -v 2>$null) |
    ForEach-Object { $_ -replace [char]0, '' } |
    Where-Object { $_ -match '^\s*\*' } |
    Select-Object -First 1
if ($defaultDistroLine -match '^\s*\*\s+(?<name>.+?)\s{2,}') {
    $defaultDistro = $Matches.name.Trim()
}

$bashLines = [System.Collections.Generic.List[string]]::new()
$bashLines.Add("set -euo pipefail")

if (-not $SkipRepoCheck) {
    $bashLines.Add("if [[ ! -d $(Convert-ToBashLiteral -Value $repoMountPath) ]]; then echo 'Shared repo not found at $repoMountPath.'; exit 1; fi")
}
if (-not $SkipGitCheck) {
    $bashLines.Add("if ! command -v git >/dev/null 2>&1; then echo 'git is not available in WSL. Install Git or fix the WSL toolchain first.'; exit 1; fi")
}
if (-not $SkipNodeCheck) {
    $bashLines.Add("if ! command -v node >/dev/null 2>&1; then echo 'node is not available in WSL. Install Node.js or fix the WSL toolchain first.'; exit 1; fi")
}
if (-not $SkipNpmCheck) {
    $bashLines.Add("if ! command -v npm >/dev/null 2>&1; then echo 'npm is not available in WSL. Install npm or fix the WSL toolchain first.'; exit 1; fi")
}
if (-not $SkipBootstrapCheck) {
    $safeRepoLiteral = Convert-ToBashLiteral -Value $repoMountPath
    $canonicalRepoMount = '/mnt/c/CodexShared/Projetos/skincos'
    $privatePreviewMount = '/mnt/c/CodexRuntime/operator/admin/skincos/source/'
    $trustedPreview = $repoMountPath -eq $canonicalRepoMount -or $repoMountPath.StartsWith($privatePreviewMount, [StringComparison]::OrdinalIgnoreCase)
    if ($trustedPreview) {
        # CRM snapshots are purposefully created in unique private worktrees.
        # Requiring a manual bootstrap for every fingerprint makes a valid
        # preview non-reproducible. Register only the canonical checkout and
        # the operator-private preview root; arbitrary caller paths still fail
        # closed below.
        $bashLines.Add("if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq $safeRepoLiteral; then git config --global --add safe.directory $safeRepoLiteral; fi")
    } else {
        $bashLines.Add("if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq $safeRepoLiteral; then echo 'WSL bootstrap for this user is not ready. Run: bash $repoMountPath/orb/engine/scripts/bootstrap-imported-wsl-account.sh'; exit 1; fi")
    }
}

foreach ($entry in $EnvVar) {
    $resolved = Resolve-EnvVarEntry -Entry $entry
    $bashLines.Add("export $($resolved.Name)=" + (Convert-ToBashLiteral -Value $resolved.Value))
}

$bashLines.Add("cd " + (Convert-ToBashLiteral -Value $repoMountPath))
$bashLines.Add($RepoCommand)
$bashCommand = ($bashLines -join "`n")

if ($defaultDistro) {
    Write-Host "WSL default distro: $defaultDistro"
}
Write-Host "Running in WSL repo: $repoMountPath"

& $wsl.Source bash -lc $bashCommand
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
