[CmdletBinding(DefaultParameterSetName = "LegacyCommand")]
param(
    [Parameter(Mandatory = $true, ParameterSetName = "LegacyCommand")]
    [string]$RepoCommand,

    [Parameter(Mandatory = $true, ParameterSetName = "BashScript")]
    [string]$ScriptPath,

    [Parameter(Mandatory = $true, ParameterSetName = "Executable")]
    [string]$Executable,

    [Parameter(Mandatory = $true, ParameterSetName = "NpmScript")]
    [string]$NpmScript,

    [Parameter(Mandatory = $true, ParameterSetName = "PythonScript")]
    [string]$PythonScript,

    [Parameter(Mandatory = $true, ParameterSetName = "InvocationFile")]
    [string]$InvocationFile,

    [Parameter(ParameterSetName = "BashScript")]
    [Parameter(ParameterSetName = "Executable")]
    [Parameter(ParameterSetName = "NpmScript")]
    [Parameter(ParameterSetName = "PythonScript")]
    [string[]]$ArgumentList = @(),

    [string]$WorkingDirectory = ".",
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string[]]$EnvVar = @(),
    [string]$Distro = "Ubuntu-24.04",
    [string]$LinuxUser = "admin",
    [string]$WslExecutable = "wsl.exe",
    [switch]$SkipBootstrapCheck,
    [switch]$SkipNodeCheck,
    [switch]$SkipNpmCheck,
    [switch]$SkipGitCheck,
    [switch]$SkipRepoCheck
)

$ErrorActionPreference = "Stop"

function Convert-WindowsPathToWsl {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($Path -match '^(?<drive>[A-Za-z]):\\(?<rest>.*)$') {
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
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)

    return "'" + $Value.Replace("'", "'""'""'") + "'"
}

function Resolve-EnvVarEntry {
    param([Parameter(Mandatory = $true)][string]$Entry)

    $parts = $Entry.Split('=', 2)
    if ($parts.Count -ne 2 -or [string]::IsNullOrWhiteSpace($parts[0])) {
        throw "EnvVar entry must use NAME=value format. Received: $Entry"
    }

    $name = $parts[0].Trim()
    if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
        throw "Invalid environment variable name '$name'."
    }

    # Environment values are opaque application data. Callers must convert
    # actual Windows paths explicitly so provenance strings such as
    # `C:\source__module` are not silently rewritten.
    $value = [Environment]::ExpandEnvironmentVariables($parts[1])

    return [pscustomobject]@{
        Name = $name
        Value = $value
    }
}

function Assert-RelativeLinuxPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.Contains([char]0) -or $Path -match '[\r\n]') {
        throw "$Label must be a non-empty Linux path without control characters."
    }
    if ($Path -match '(^|/)\.\.(/|$)') {
        throw "$Label cannot escape the selected project root: '$Path'."
    }
}

function Resolve-InvocationFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolvedPath = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    $allowedRoots = @(
        (Join-Path $env:LOCALAPPDATA "Codex\skincos\tmp"),
        "C:\CodexRuntime\operator\admin\skincos\tmp"
    )
    $allowed = $false
    foreach ($root in $allowedRoots) {
        $fullRoot = [IO.Path]::GetFullPath($root).TrimEnd([IO.Path]::DirectorySeparatorChar)
        if ($resolvedPath.StartsWith($fullRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            $allowed = $true
            break
        }
    }
    if (-not $allowed) {
        throw "Detached WSL invocation files are allowed only in the private Codex runtime: '$resolvedPath'."
    }
    return $resolvedPath
}

function Invoke-WslCapture {
    param(
        [Parameter(Mandatory = $true)][System.Management.Automation.CommandInfo]$Wsl,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = @(& $Wsl.Source @Arguments 2>&1)
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorPreference
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output
    }
}

$invocationMode = $PSCmdlet.ParameterSetName
$invocationFileToRemove = $null

try {
    if ($invocationMode -eq "InvocationFile") {
        $invocationFileToRemove = Resolve-InvocationFile -Path $InvocationFile
        $spec = Get-Content -LiteralPath $invocationFileToRemove -Raw | ConvertFrom-Json
        if ([int]$spec.version -ne 1) {
            throw "Unsupported detached WSL invocation version '$($spec.version)'."
        }
        $invocationMode = [string]$spec.mode
        if ($invocationMode -notin @("BashScript", "Executable", "NpmScript", "PythonScript")) {
            throw "Unsupported detached WSL invocation mode '$invocationMode'."
        }

        $ProjectRoot = [string]$spec.projectRoot
        $WorkingDirectory = if ([string]::IsNullOrWhiteSpace([string]$spec.workingDirectory)) { "." } else { [string]$spec.workingDirectory }
        $ArgumentList = @($spec.argumentList | ForEach-Object { [string]$_ })
        $EnvVar = @($spec.envVar | ForEach-Object { [string]$_ })
        $Distro = if ([string]::IsNullOrWhiteSpace([string]$spec.distro)) { "Ubuntu-24.04" } else { [string]$spec.distro }
        $LinuxUser = if ([string]::IsNullOrWhiteSpace([string]$spec.linuxUser)) { "admin" } else { [string]$spec.linuxUser }
        $SkipBootstrapCheck = [bool]$spec.skipBootstrapCheck
        $SkipNodeCheck = [bool]$spec.skipNodeCheck
        $SkipNpmCheck = [bool]$spec.skipNpmCheck
        $SkipGitCheck = [bool]$spec.skipGitCheck
        $SkipRepoCheck = [bool]$spec.skipRepoCheck

        switch ($invocationMode) {
            "BashScript" { $ScriptPath = [string]$spec.target }
            "Executable" { $Executable = [string]$spec.target }
            "NpmScript" { $NpmScript = [string]$spec.target }
            "PythonScript" { $PythonScript = [string]$spec.target }
        }
    }

    if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
        throw "ProjectRoot is required."
    }
    if ($Distro -ne "Ubuntu-24.04") {
        throw "Skincos actions must use the encapsulated Ubuntu-24.04 backend. Received: '$Distro'."
    }
    if ($LinuxUser -ne "admin") {
        throw "Skincos actions must use the interactive WSL operator 'admin'. Received: '$LinuxUser'."
    }

    $wsl = Get-Command $WslExecutable -ErrorAction SilentlyContinue
    if (-not $wsl) {
        throw "WSL is unavailable: '$WslExecutable' was not found. No Skincos service was started."
    }

    $distroProbe = Invoke-WslCapture -Wsl $wsl -Arguments @("-l", "-q")
    $installedDistros = @($distroProbe.Output |
        ForEach-Object { ([string]$_ -replace [char]0, "").Trim() } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($distroProbe.ExitCode -ne 0 -or $installedDistros -notcontains $Distro) {
        throw "WSL distro '$Distro' is unavailable. No Skincos service was started."
    }

    $identityProbe = Invoke-WslCapture -Wsl $wsl -Arguments @("-d", $Distro, "-u", $LinuxUser, "-e", "/usr/bin/id", "-un")
    $resolvedLinuxUser = [string]($identityProbe.Output | Select-Object -Last 1)
    if ($identityProbe.ExitCode -ne 0 -or $resolvedLinuxUser.Trim() -ne $LinuxUser) {
        throw "WSL operator '$LinuxUser' is unavailable in '$Distro'. No Skincos service was started."
    }

    $repoMountPath = (Convert-WindowsPathToWsl -Path $ProjectRoot).TrimEnd("/")
    if ([string]::IsNullOrWhiteSpace($repoMountPath)) {
        throw "Unable to resolve the WSL project root from '$ProjectRoot'."
    }
    $implicitEnv = @()
    $windowsGitMarker = Join-Path $ProjectRoot ".git"
    if (Test-Path -LiteralPath $windowsGitMarker -PathType Leaf) {
        $gitMarker = (Get-Content -LiteralPath $windowsGitMarker -Raw).Trim()
        if ($gitMarker -notmatch '^gitdir:\s*(?<path>.+)$') {
            throw "The Windows worktree has an invalid .git pointer: '$windowsGitMarker'."
        }
        $windowsGitDirectory = $Matches.path.Trim()
        if (-not [IO.Path]::IsPathRooted($windowsGitDirectory)) {
            $windowsGitDirectory = Join-Path $ProjectRoot $windowsGitDirectory
        }
        $windowsGitDirectory = [IO.Path]::GetFullPath($windowsGitDirectory)
        $approvedGitDirectoryRoot = [IO.Path]::GetFullPath(
            "C:\CodexShared\Projetos\skincos\.git\worktrees"
        ).TrimEnd([IO.Path]::DirectorySeparatorChar)
        if (-not $windowsGitDirectory.StartsWith(
            $approvedGitDirectoryRoot + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase
        )) {
            throw "The Windows worktree .git pointer is outside the approved shared repository: '$windowsGitDirectory'."
        }
        $implicitEnv = @(
            "GIT_DIR=$(Convert-WindowsPathToWsl -Path $windowsGitDirectory)",
            "GIT_WORK_TREE=$repoMountPath"
        )
    }

    Assert-RelativeLinuxPath -Path $WorkingDirectory -Label "WorkingDirectory"
    if ($WorkingDirectory.StartsWith("/")) {
        if ($WorkingDirectory -ne $repoMountPath -and -not $WorkingDirectory.StartsWith($repoMountPath + "/", [StringComparison]::Ordinal)) {
            throw "WorkingDirectory must remain inside '$repoMountPath': '$WorkingDirectory'."
        }
        $executionDirectory = $WorkingDirectory.TrimEnd("/")
    }
    else {
        $relativeWorkingDirectory = ($WorkingDirectory -replace '\\', '/').Trim("/")
        $executionDirectory = if ([string]::IsNullOrWhiteSpace($relativeWorkingDirectory) -or $relativeWorkingDirectory -eq ".") {
            $repoMountPath
        }
        else {
            "$repoMountPath/$relativeWorkingDirectory"
        }
    }

    if (-not $SkipRepoCheck) {
        $repoProbe = Invoke-WslCapture -Wsl $wsl -Arguments @("-d", $Distro, "-u", $LinuxUser, "-e", "/usr/bin/test", "-d", $repoMountPath)
        if ($repoProbe.ExitCode -ne 0) {
            throw "Skincos project root is unavailable in WSL at '$repoMountPath'. No service was started."
        }
        $workingDirectoryProbe = Invoke-WslCapture -Wsl $wsl -Arguments @("-d", $Distro, "-u", $LinuxUser, "-e", "/usr/bin/test", "-d", $executionDirectory)
        if ($workingDirectoryProbe.ExitCode -ne 0) {
            throw "WSL working directory is unavailable at '$executionDirectory'. No service was started."
        }
    }

    $toolChecks = [System.Collections.Generic.List[string]]::new()
    if (-not $SkipGitCheck) { $toolChecks.Add("git") }
    if (-not $SkipNodeCheck) { $toolChecks.Add("node") }
    if (-not $SkipNpmCheck) { $toolChecks.Add("npm") }
    foreach ($tool in $toolChecks) {
        $toolProbe = Invoke-WslCapture -Wsl $wsl -Arguments @("-d", $Distro, "-u", $LinuxUser, "-e", "/usr/bin/which", $tool)
        if ($toolProbe.ExitCode -ne 0) {
            throw "'$tool' is unavailable in Ubuntu-24.04. Fix the WSL toolchain before running Skincos actions."
        }
    }

    if (-not $SkipBootstrapCheck) {
        $safeDirectoryProbe = Invoke-WslCapture -Wsl $wsl -Arguments @(
            "-d", $Distro, "-u", $LinuxUser, "--cd", "/", "-e",
            "/usr/bin/git", "config", "--global", "--get-all", "safe.directory"
        )
        $safeDirectories = @($safeDirectoryProbe.Output | ForEach-Object { ([string]$_).Trim() })
        $canonicalRepoMount = "/mnt/c/CodexShared/Projetos/skincos"
        $sharedWorktreeMount = "/mnt/c/CodexShared/Worktrees/skincos/admin/"
        $privatePreviewMount = "/mnt/c/CodexRuntime/operator/admin/skincos/source/"
        $nativePreviewMount = "/home/admin/.local/state/skincos/crm-local-preview-source/"
        $trustedPreview = $repoMountPath -eq $canonicalRepoMount -or
            $repoMountPath.StartsWith($sharedWorktreeMount, [StringComparison]::OrdinalIgnoreCase) -or
            $repoMountPath.StartsWith($privatePreviewMount, [StringComparison]::OrdinalIgnoreCase) -or
            $repoMountPath.StartsWith($nativePreviewMount, [StringComparison]::Ordinal)

        if ($safeDirectories -notcontains $repoMountPath) {
            if (-not $trustedPreview) {
                throw "WSL bootstrap for this checkout is not ready. Run the WslAccountBootstrap action first."
            }
            $safeDirectoryWrite = Invoke-WslCapture -Wsl $wsl -Arguments @(
                "-d", $Distro, "-u", $LinuxUser, "--cd", "/", "-e",
                "/usr/bin/git", "config", "--global", "--add", "safe.directory", $repoMountPath
            )
            if ($safeDirectoryWrite.ExitCode -ne 0) {
                throw "Unable to register the approved WSL safe.directory '$repoMountPath'."
            }
        }
    }

    $resolvedEnv = @($implicitEnv)
    foreach ($entry in $EnvVar) {
        $resolved = Resolve-EnvVarEntry -Entry $entry
        $resolvedEnv += "$($resolved.Name)=$($resolved.Value)"
    }

    $linuxCommand = @()
    switch ($invocationMode) {
        "BashScript" {
            Assert-RelativeLinuxPath -Path $ScriptPath -Label "ScriptPath"
            $linuxCommand = @("/usr/bin/env") + $resolvedEnv + @("/bin/bash", ($ScriptPath -replace '\\', '/')) + $ArgumentList
        }
        "Executable" {
            if ([string]::IsNullOrWhiteSpace($Executable) -or $Executable -notmatch '^[A-Za-z0-9_./+-]+$') {
                throw "Executable contains unsupported characters: '$Executable'."
            }
            $linuxCommand = @("/usr/bin/env") + $resolvedEnv + @($Executable) + $ArgumentList
        }
        "NpmScript" {
            if ($NpmScript -notmatch '^[A-Za-z0-9:_-]+$') {
                throw "NpmScript contains unsupported characters: '$NpmScript'."
            }
            $npmArguments = @("run", $NpmScript)
            if ($ArgumentList.Count -gt 0) {
                $npmArguments += "--"
                $npmArguments += $ArgumentList
            }
            $linuxCommand = @("/usr/bin/env") + $resolvedEnv + @("npm") + $npmArguments
        }
        "PythonScript" {
            Assert-RelativeLinuxPath -Path $PythonScript -Label "PythonScript"
            $linuxCommand = @("/usr/bin/env") + $resolvedEnv + @("python3", ($PythonScript -replace '\\', '/')) + $ArgumentList
        }
        "LegacyCommand" {
            $bashLines = [System.Collections.Generic.List[string]]::new()
            $bashLines.Add("set -euo pipefail")
            foreach ($entry in $resolvedEnv) {
                $parts = $entry.Split("=", 2)
                $bashLines.Add("export $($parts[0])=" + (Convert-ToBashLiteral -Value $parts[1]))
            }
            $bashLines.Add("cd " + (Convert-ToBashLiteral -Value $executionDirectory))
            $bashLines.Add($RepoCommand)
            $linuxCommand = @("/bin/bash", "-lc", ($bashLines -join "`n"))
        }
        default {
            throw "Unsupported WSL invocation mode '$invocationMode'."
        }
    }

    Write-Verbose "WSL backend: $Distro ($LinuxUser)"
    Write-Verbose "Running in WSL directory: $executionDirectory"

    $wslArguments = @("-d", $Distro, "-u", $LinuxUser, "--cd", $executionDirectory, "-e") + $linuxCommand
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        & $wsl.Source @wslArguments
        $commandExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorPreference
    }
}
finally {
    if ($invocationFileToRemove -and (Test-Path -LiteralPath $invocationFileToRemove)) {
        Remove-Item -LiteralPath $invocationFileToRemove -Force -ErrorAction SilentlyContinue
    }
}

if ($commandExitCode -ne 0) {
    exit $commandExitCode
}
