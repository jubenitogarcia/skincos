[CmdletBinding(DefaultParameterSetName = "LegacyRepoCommand")]
param(
    [Parameter(Mandatory = $true, ParameterSetName = "BashScript")]
    [ValidateNotNullOrEmpty()]
    [string]$ScriptPath,

    [Parameter(Mandatory = $true, ParameterSetName = "Executable")]
    [ValidateNotNullOrEmpty()]
    [string]$Executable,

    [Parameter(Mandatory = $true, ParameterSetName = "NpmScript")]
    [ValidateNotNullOrEmpty()]
    [string]$NpmScript,

    [Parameter(Mandatory = $true, ParameterSetName = "PythonScript")]
    [ValidateNotNullOrEmpty()]
    [string]$PythonScript,

    # Raw shell text is retained only for existing shortcut compatibility.
    # New callers must use one of the typed parameter sets above.
    [Parameter(Mandatory = $true, ParameterSetName = "LegacyRepoCommand")]
    [ValidateNotNullOrEmpty()]
    [string]$RepoCommand,

    [Parameter(ParameterSetName = "BashScript")]
    [Parameter(ParameterSetName = "Executable")]
    [Parameter(ParameterSetName = "NpmScript")]
    [Parameter(ParameterSetName = "PythonScript")]
    [Alias("Arguments", "ArgumentList")]
    [AllowEmptyCollection()]
    [string[]]$Argument = @(),

    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",

    [string]$WslExecutable = "wsl.exe",

    [Alias("Environment", "EnvironmentVariable", "EnvironmentVariables")]
    [AllowEmptyCollection()]
    [string[]]$EnvVar = @(),

    [switch]$SkipBootstrapCheck,
    [switch]$SkipNodeCheck,
    [switch]$SkipNpmCheck,
    [switch]$SkipGitCheck,
    [switch]$SkipRepoCheck
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$script:SkincosWslDistribution = "Ubuntu-24.04"
$script:SkincosWslOperator = "admin"
$script:BlockedEnvironmentNames = @(
    "BASH_ENV",
    "CDPATH",
    "CODEX_HOME",
    "ENV",
    "GIT_DIR",
    "GIT_WORK_TREE",
    "HOME",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "LOGNAME",
    "OLDPWD",
    "PATH",
    "PROMPT_COMMAND",
    "PS4",
    "PWD",
    "SHELL",
    "USER",
    "WSLENV"
)

function Convert-WindowsPathToWsl {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($Path -match '^(?<drive>[A-Za-z]):[\\/](?<rest>.*)$') {
        $drive = $Matches.drive.ToLowerInvariant()
        $rest = $Matches.rest -replace '\\', '/'
        if ([string]::IsNullOrWhiteSpace($rest)) {
            return "/mnt/$drive"
        }
        return "/mnt/$drive/$rest"
    }

    return ($Path -replace '\\', '/')
}

function Convert-ToBashLiteral {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$Value
    )

    if ($Value.Contains([char]0)) {
        throw "NUL bytes are not supported at the Windows-to-WSL boundary."
    }

    if ($Value.Contains([char]0)) {
        throw "NUL bytes are not supported at the Windows-to-WSL boundary."
    }
    return "'" + $Value.Replace("'", "'""'""'") + "'"
}

function Resolve-SafeRepoRelativePath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ParameterName,
        [string]$RequiredExtension
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or
        $Path.Contains([char]0) -or
        $Path.Contains("`r") -or
        $Path.Contains("`n")) {
        throw "$ParameterName must be a non-empty repository-relative path."
    }

    $normalized = $Path.Replace('\', '/')
    if ($normalized -match '^[A-Za-z]:' -or $normalized.StartsWith('/')) {
        throw "$ParameterName must be relative to ProjectRoot. Received: $Path"
    }
    if ($normalized.Contains('//')) {
        throw "$ParameterName contains an ambiguous empty path segment. Received: $Path"
    }

    while ($normalized.StartsWith('./')) {
        $normalized = $normalized.Substring(2)
    }
    if ([string]::IsNullOrWhiteSpace($normalized) -or $normalized -eq '.') {
        throw "$ParameterName must identify a file below ProjectRoot."
    }

    $segments = @($normalized.Split('/'))
    if ($segments -contains '..') {
        throw "$ParameterName may not traverse outside ProjectRoot. Received: $Path"
    }

    if (-not [string]::IsNullOrWhiteSpace($RequiredExtension) -and
        -not $normalized.EndsWith($RequiredExtension, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$ParameterName must identify a $RequiredExtension file. Received: $Path"
    }

    return $normalized
}

function Resolve-SafeExecutable {
    param([Parameter(Mandatory = $true)][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value) -or
        $Value.Contains([char]0) -or
        $Value.Contains("`r") -or
        $Value.Contains("`n")) {
        throw "Executable must be a non-empty command name or repository-relative path."
    }

    if ($Value -match '^/(?:usr/)?bin/[A-Za-z0-9_][A-Za-z0-9_.+-]*$') {
        return $Value
    }
    if ($Value.Contains('/') -or $Value.Contains('\')) {
        return Resolve-SafeRepoRelativePath -Path $Value -ParameterName "Executable"
    }

    if ($Value -notmatch '^[A-Za-z0-9_][A-Za-z0-9_.+-]*$') {
        throw "Executable contains unsupported command-name characters. Received: $Value"
    }

    return $Value
}

function Resolve-EnvVarEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Entry,
        [switch]$ExpandWindowsEnvironmentVariables
    )

    $separator = $Entry.IndexOf('=')
    if ($separator -le 0) {
        throw "EnvVar entry must use NAME=value format."
    }

    $name = $Entry.Substring(0, $separator).Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        throw "EnvVar name is invalid: $name"
    }
    if ($script:BlockedEnvironmentNames -contains $name.ToUpperInvariant()) {
        throw "EnvVar $name is reserved by the Windows-to-WSL execution boundary."
    }

    $value = $Entry.Substring($separator + 1)
    if ($ExpandWindowsEnvironmentVariables) {
        # Preserve the historical RepoCommand behavior without applying implicit
        # Windows expansion to the new typed boundary.
        $value = [Environment]::ExpandEnvironmentVariables($value)
    }
    if ($value -match '^[A-Za-z]:[\\/]') {
        $value = Convert-WindowsPathToWsl -Path $value
    }
    return [pscustomobject]@{
        Name = $name
        Value = $value
    }
}

function Resolve-WindowsWorktreeEnvironment {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    $gitMarker = Join-Path $RepoRoot ".git"
    if (-not (Test-Path -LiteralPath $gitMarker -PathType Leaf)) {
        return @()
    }

    $markerText = (Get-Content -LiteralPath $gitMarker -Raw).Trim()
    if ($markerText -notmatch '^gitdir:\s*(?<path>.+)$') {
        throw "The Windows worktree has an invalid .git pointer: '$gitMarker'."
    }

    $gitDirectory = $Matches.path.Trim()
    if (-not [IO.Path]::IsPathRooted($gitDirectory)) {
        $gitDirectory = Join-Path $RepoRoot $gitDirectory
    }
    $gitDirectory = [IO.Path]::GetFullPath($gitDirectory)
    $approvedRoot = [IO.Path]::GetFullPath(
        "C:\CodexShared\Projetos\skincos\.git\worktrees"
    ).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if (-not $gitDirectory.StartsWith(
        $approvedRoot + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase
    )) {
        throw "The Windows worktree .git pointer is outside the approved shared repository: '$gitDirectory'."
    }

    return @(
        "GIT_DIR=$(Convert-WindowsPathToWsl -Path $gitDirectory)",
        "GIT_WORK_TREE=$(Convert-WindowsPathToWsl -Path $RepoRoot)"
    )
}

function Join-BashArguments {
    param([AllowEmptyCollection()][string[]]$Values = @())

    $quoted = [System.Collections.Generic.List[string]]::new()
    foreach ($value in $Values) {
        if ($null -eq $value) {
            throw "Argument entries may not be null."
        }
        $quoted.Add((Convert-ToBashLiteral -Value $value))
    }
    return ($quoted -join " ")
}

function New-SkincosWslInvocation {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("BashScript", "Executable", "NpmScript", "PythonScript", "LegacyRepoCommand")]
        [string]$Mode,
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [AllowEmptyCollection()][string[]]$Argument = @(),
        [AllowEmptyCollection()][string[]]$EnvVar = @(),
        [switch]$SkipBootstrapCheck,
        [switch]$SkipNodeCheck,
        [switch]$SkipNpmCheck,
        [switch]$SkipGitCheck,
        [switch]$SkipRepoCheck
    )

    if ([string]::IsNullOrWhiteSpace($Target) -or $Target.Contains([char]0)) {
        throw "$Mode target must not be empty and may not contain NUL bytes."
    }

    $normalizedTarget = switch ($Mode) {
        "BashScript" {
            Resolve-SafeRepoRelativePath -Path $Target -ParameterName "ScriptPath" -RequiredExtension ".sh"
        }
        "PythonScript" {
            Resolve-SafeRepoRelativePath -Path $Target -ParameterName "PythonScript" -RequiredExtension ".py"
        }
        "NpmScript" {
            if ($Target -notmatch '^[A-Za-z0-9][A-Za-z0-9:_-]*$') {
                throw "NpmScript contains unsupported characters. Received: $Target"
            }
            $Target
        }
        "Executable" {
            Resolve-SafeExecutable -Value $Target
        }
        "LegacyRepoCommand" {
            $Target
        }
    }

    $argumentText = Join-BashArguments -Values $Argument
    $repoMountPath = Convert-WindowsPathToWsl -Path $ProjectRoot
    if ($repoMountPath -notmatch '^/mnt/[a-z](?:/|$)') {
        throw "ProjectRoot must be an absolute Windows drive path. Received: $ProjectRoot"
    }

    # Resolve every environment entry before any WSL process can start.
    $resolvedEnvironment = [System.Collections.Generic.List[object]]::new()
    $seenEnvironmentNames = [System.Collections.Generic.HashSet[string]]::new(
        [StringComparer]::OrdinalIgnoreCase
    )
    foreach ($entry in $EnvVar) {
        if ($null -eq $entry) {
            throw "EnvVar entries may not be null."
        }
        $resolved = Resolve-EnvVarEntry `
            -Entry $entry `
            -ExpandWindowsEnvironmentVariables:($Mode -eq "LegacyRepoCommand")
        if (-not $seenEnvironmentNames.Add($resolved.Name)) {
            throw "EnvVar contains a duplicate name: $($resolved.Name)"
        }
        $resolvedEnvironment.Add($resolved)
    }

    $bashLines = [System.Collections.Generic.List[string]]::new()
    $bashLines.Add("set -euo pipefail")

    $safeRepoLiteral = Convert-ToBashLiteral -Value $repoMountPath
    $implicitEnvironment = @(Resolve-WindowsWorktreeEnvironment -RepoRoot $ProjectRoot)
    if (-not $SkipRepoCheck) {
        $message = Convert-ToBashLiteral -Value "Shared repo not found at $repoMountPath."
        $bashLines.Add("if [[ ! -d $safeRepoLiteral ]]; then printf '%s\n' $message >&2; exit 1; fi")
    }
    if (-not $SkipGitCheck) {
        $bashLines.Add("if ! command -v git >/dev/null 2>&1; then printf '%s\n' 'git is not available in Ubuntu-24.04.' >&2; exit 1; fi")
    }

    $requiresNode = (-not $SkipNodeCheck) -or $Mode -eq "NpmScript"
    $requiresNpm = (-not $SkipNpmCheck) -or $Mode -eq "NpmScript"
    if ($requiresNode) {
        $bashLines.Add("if ! command -v node >/dev/null 2>&1; then printf '%s\n' 'node is not available in Ubuntu-24.04.' >&2; exit 1; fi")
    }
    if ($requiresNpm) {
        $bashLines.Add("if ! command -v npm >/dev/null 2>&1; then printf '%s\n' 'npm is not available in Ubuntu-24.04.' >&2; exit 1; fi")
    }

    if (-not $SkipBootstrapCheck) {
        $canonicalRepoMount = '/mnt/c/CodexShared/Projetos/skincos'
        $privatePreviewMount = '/mnt/c/CodexRuntime/operator/admin/skincos/source/'
        $trustedPreview = $repoMountPath -eq $canonicalRepoMount -or
            $repoMountPath.StartsWith($privatePreviewMount, [StringComparison]::OrdinalIgnoreCase) -or
            $repoMountPath.StartsWith('/home/admin/.local/state/skincos/crm-local-preview-source/', [StringComparison]::Ordinal)
        if ($trustedPreview) {
            # CRM snapshots are purposefully created in unique private worktrees.
            # Register only the canonical checkout and the private preview root.
            $bashLines.Add("if ! git -C / config --global --get-all safe.directory 2>/dev/null | grep -Fxq $safeRepoLiteral; then git -C / config --global --add safe.directory $safeRepoLiteral; fi")
        } else {
            $bootstrapMessage = Convert-ToBashLiteral -Value (
                "WSL bootstrap for this checkout is not ready. Run the approved shared-workspace setup first."
            )
            $bashLines.Add("if ! git -C / config --global --get-all safe.directory 2>/dev/null | grep -Fxq $safeRepoLiteral; then printf '%s\n' $bootstrapMessage >&2; exit 1; fi")
        }
    }

    foreach ($implicit in $implicitEnvironment) {
        $parts = $implicit.Split("=", 2)
        $bashLines.Add("export $($parts[0])=" + (Convert-ToBashLiteral -Value $parts[1]))
    }
    foreach ($resolved in $resolvedEnvironment) {
        $bashLines.Add(
            "export $($resolved.Name)=" + (Convert-ToBashLiteral -Value ([string]$resolved.Value))
        )
    }

    $bashLines.Add("cd -- $safeRepoLiteral")

    $targetLiteral = Convert-ToBashLiteral -Value $normalizedTarget
    $argumentSuffix = if ([string]::IsNullOrEmpty($argumentText)) { "" } else { " $argumentText" }
    switch ($Mode) {
        "BashScript" {
            $missingMessage = Convert-ToBashLiteral -Value "ScriptPath was not found below ProjectRoot."
            $bashLines.Add("if [[ ! -f $targetLiteral ]]; then printf '%s\n' $missingMessage >&2; exit 1; fi")
            $bashLines.Add("bash -- $targetLiteral$argumentSuffix")
        }
        "PythonScript" {
            $bashLines.Add("if ! command -v python3 >/dev/null 2>&1; then printf '%s\n' 'python3 is not available in Ubuntu-24.04.' >&2; exit 1; fi")
            $missingMessage = Convert-ToBashLiteral -Value "PythonScript was not found below ProjectRoot."
            $bashLines.Add("if [[ ! -f $targetLiteral ]]; then printf '%s\n' $missingMessage >&2; exit 1; fi")
            $bashLines.Add("python3 -- $targetLiteral$argumentSuffix")
        }
        "NpmScript" {
            $bashLines.Add("if [[ ! -f package.json ]]; then printf '%s\n' 'package.json was not found at ProjectRoot.' >&2; exit 1; fi")
            $probe = "const p=require('./package.json');const n=process.argv[1];process.exit(p.scripts&&Object.prototype.hasOwnProperty.call(p.scripts,n)?0:1)"
            $probeLiteral = Convert-ToBashLiteral -Value $probe
            $missingMessage = Convert-ToBashLiteral -Value "NpmScript is not declared in package.json."
            $bashLines.Add("if ! node -e $probeLiteral -- $targetLiteral; then printf '%s\n' $missingMessage >&2; exit 1; fi")
            $npmArgumentSuffix = if ([string]::IsNullOrEmpty($argumentText)) { "" } else { " -- $argumentText" }
            $bashLines.Add("npm run $targetLiteral$npmArgumentSuffix")
        }
        "Executable" {
            if ($normalizedTarget.Contains('/')) {
                $missingMessage = Convert-ToBashLiteral -Value "Executable is not an executable file below ProjectRoot."
                $bashLines.Add("if [[ ! -x $targetLiteral ]]; then printf '%s\n' $missingMessage >&2; exit 1; fi")
            } else {
                $missingMessage = Convert-ToBashLiteral -Value "Executable is not available in Ubuntu-24.04."
                $bashLines.Add("if ! command -v -- $targetLiteral >/dev/null 2>&1; then printf '%s\n' $missingMessage >&2; exit 1; fi")
            }
            $bashLines.Add("$targetLiteral$argumentSuffix")
        }
        "LegacyRepoCommand" {
            $bashLines.Add($normalizedTarget)
        }
    }

    return [pscustomobject]@{
        Mode = $Mode
        Target = $normalizedTarget
        RepoMountPath = $repoMountPath
        BashCommand = ($bashLines -join "`n")
    }
}

function New-SkincosWslProcessArgumentList {
    param([Parameter(Mandatory = $true)][string]$BashCommand)

    # wsl.exe applies an additional Windows command-line parsing pass before
    # handing argv to Linux. Embedded shell quotes are otherwise stripped
    # (for example require('./package.json') becomes require(./package.json)).
    # Carry the rendered script as inert base64 and decode it inside the fixed
    # Ubuntu/admin boundary instead of relying on cross-platform quote rules.
    $bashBytes = [Text.Encoding]::UTF8.GetBytes($BashCommand)
    $bashBase64 = [Convert]::ToBase64String($bashBytes)
    $bootstrapCommand = "printf %s $bashBase64 | base64 --decode | bash"

    return [string[]]@(
        "--distribution",
        $script:SkincosWslDistribution,
        "--user",
        $script:SkincosWslOperator,
        "--",
        "bash",
        "-lc",
        $bootstrapCommand
    )
}

# Dot-sourcing is used only by the Windows-native unit test to exercise the
# pure renderer without starting WSL.
if ($MyInvocation.InvocationName -eq '.') {
    return
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "ProjectRoot does not exist on Windows: $ProjectRoot"
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

$mode = $PSCmdlet.ParameterSetName
$target = switch ($mode) {
    "BashScript" { $ScriptPath }
    "Executable" { $Executable }
    "NpmScript" { $NpmScript }
    "PythonScript" { $PythonScript }
    "LegacyRepoCommand" { $RepoCommand }
}

$invocation = New-SkincosWslInvocation `
    -Mode $mode `
    -Target $target `
    -ProjectRoot $ProjectRoot `
    -Argument $Argument `
    -EnvVar $EnvVar `
    -SkipBootstrapCheck:$SkipBootstrapCheck `
    -SkipNodeCheck:$SkipNodeCheck `
    -SkipNpmCheck:$SkipNpmCheck `
    -SkipGitCheck:$SkipGitCheck `
    -SkipRepoCheck:$SkipRepoCheck

if ($mode -eq "LegacyRepoCommand") {
    Write-Warning "-RepoCommand is a legacy raw-shell compatibility path. Use a typed invocation for new automation."
}

$wsl = Get-Command -Name $WslExecutable -CommandType Application -ErrorAction SilentlyContinue
if (-not $wsl) {
    throw "WSL is unavailable: '$WslExecutable' was not found. No Skincos service was started."
}
$wslArguments = New-SkincosWslProcessArgumentList -BashCommand $invocation.BashCommand

Write-Host "Running as $script:SkincosWslOperator in $script:SkincosWslDistribution repo: $($invocation.RepoMountPath)"
& $wsl.Source @wslArguments
$wslExitCode = $LASTEXITCODE
if ($wslExitCode -ne 0) {
    exit $wslExitCode
}
