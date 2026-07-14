param(
    [string]$ProjectRoot = "C:\CodexShared\Projetos\skincos",
    [string]$WorktreeRoot = "C:\CodexShared\Worktrees\skincos",
    [string]$RuntimeRoot = "C:\CodexRuntime\n8n",
    [string]$OperatorRuntimeRoot = "C:\CodexRuntime\operator\admin\skincos"
)

$ErrorActionPreference = "Stop"

function Normalize-PathString {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    return $Path.Replace('\', '/').TrimEnd('/').ToLowerInvariant()
}

function Get-AccessEntry {
    param(
        [System.Security.AccessControl.DirectorySecurity]$Acl,
        [string]$Identity
    )

    return $Acl.Access | Where-Object {
        $_.IdentityReference.Value -eq $Identity -and
        $_.AccessControlType -eq "Allow"
    }
}

function Test-ModifyAccess {
    param([string]$TargetPath)

    $acl = Get-Acl -LiteralPath $TargetPath
    $entry = Get-AccessEntry -Acl $acl -Identity "BUILTIN\Users"
    $hasModify = $false

    if ($entry) {
        foreach ($rule in @($entry)) {
            if ($rule.FileSystemRights.ToString().Contains("Modify")) {
                $hasModify = $true
                break
            }
        }
    }

    [pscustomobject]@{
        path = $TargetPath
        exists = (Test-Path -LiteralPath $TargetPath)
        hasUsersModify = $hasModify
        owner = $acl.Owner
    }
}

function Test-PrivateOperatorRuntime {
    param([string]$TargetPath)

    if (-not (Test-Path -LiteralPath $TargetPath)) {
        return [pscustomobject]@{ path = $TargetPath; exists = $false; hasUsersAccess = $false; hasCurrentUserFullControl = $false; owner = $null }
    }

    $acl = Get-Acl -LiteralPath $TargetPath
    $currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $currentRules = @(Get-AccessEntry -Acl $acl -Identity $currentIdentity)
    $hasCurrentUserFullControl = @($currentRules | Where-Object { $_.FileSystemRights.ToString().Contains("FullControl") }).Count -gt 0
    $hasUsersAccess = @(Get-AccessEntry -Acl $acl -Identity "BUILTIN\Users").Count -gt 0

    return [pscustomobject]@{
        path = $TargetPath
        exists = $true
        hasUsersAccess = $hasUsersAccess
        hasCurrentUserFullControl = $hasCurrentUserFullControl
        owner = $acl.Owner
    }
}

function Get-EnabledUserCoverage {
    $enabledUsers = @(Get-LocalUser | Where-Object Enabled)
    $usersMembers = @((Get-LocalGroupMember -Group "Users").Name)
    $adminsMembers = @((Get-LocalGroupMember -Group "Administrators").Name)

    foreach ($user in $enabledUsers) {
        $qualified = "$env:COMPUTERNAME\$($user.Name)"
        [pscustomobject]@{
            user = $qualified
            coveredByUsersGroup = $usersMembers -contains $qualified
            coveredByAdministratorsGroup = $adminsMembers -contains $qualified
            hasWorkspaceAccess = ($usersMembers -contains $qualified) -or ($adminsMembers -contains $qualified)
        }
    }
}

function Get-CodexEnvironmentStatus {
    param([string]$RepoPath)

    $environmentPath = Join-Path $RepoPath ".codex\environments\environment.toml"
    $tracked = $false
    $ignored = $false

    if (Test-Path -LiteralPath $environmentPath) {
        $trackedOutput = @(& git -C $RepoPath ls-files .codex/environments/environment.toml 2>$null)
        $tracked = $trackedOutput.Count -gt 0
    }

    & git -C $RepoPath check-ignore .codex/environments/environment.toml 1>$null 2>$null
    $ignored = $LASTEXITCODE -eq 0

    [pscustomobject]@{
        path = $environmentPath
        exists = Test-Path -LiteralPath $environmentPath
        tracked = $tracked
        ignored = $ignored
        manualOpenRequired = $true
        note = "Each Windows user still needs to open the repo or worktree manually in Codex App for the top-bar actions to appear in that account."
    }
}

$projectCheck = Test-ModifyAccess -TargetPath $ProjectRoot
$worktreeCheck = Test-ModifyAccess -TargetPath $WorktreeRoot
$runtimeCheck = Test-ModifyAccess -TargetPath $RuntimeRoot
$operatorRuntimeCheck = Test-PrivateOperatorRuntime -TargetPath $OperatorRuntimeRoot
$childChecks = @()
$runtimeChildChecks = @()

if (Test-Path -LiteralPath $ProjectRoot) {
    $childChecks = Get-ChildItem -LiteralPath $ProjectRoot -Directory -Force |
        Sort-Object Name |
        ForEach-Object { Test-ModifyAccess -TargetPath $_.FullName }
}

if (Test-Path -LiteralPath $RuntimeRoot) {
    $runtimeChildChecks = Get-ChildItem -LiteralPath $RuntimeRoot -Directory -Force |
        Sort-Object Name |
        ForEach-Object { Test-ModifyAccess -TargetPath $_.FullName }
}

$localStateRoot = Join-Path $env:LOCALAPPDATA "Codex\skincos"
$localStateDirs = @(
    $localStateRoot,
    (Join-Path $localStateRoot "tmp"),
    (Join-Path $localStateRoot "profiles"),
    (Join-Path $localStateRoot "env-overrides")
)

$safeDirectories = @(git config --global --get-all safe.directory 2>$null)
$normalizedProjectRoot = Normalize-PathString -Path $ProjectRoot
$normalizedSafeDirectories = @($safeDirectories | ForEach-Object { Normalize-PathString -Path $_ })
$codexEnvironment = Get-CodexEnvironmentStatus -RepoPath $ProjectRoot

$result = [pscustomobject]@{
    project = $projectCheck
    worktrees = $worktreeCheck
    runtime = $runtimeCheck
    operatorRuntime = $operatorRuntimeCheck
    projectChildren = $childChecks
    runtimeChildren = $runtimeChildChecks
    enabledUserCoverage = @(Get-EnabledUserCoverage)
    currentUser = $env:USERNAME
    safeDirectoryRegistered = $normalizedSafeDirectories -contains $normalizedProjectRoot
    safeDirectories = $safeDirectories
    codexEnvironment = $codexEnvironment
    localStateDirs = @(
        foreach ($dir in $localStateDirs) {
            [pscustomobject]@{
                path = $dir
                exists = (Test-Path -LiteralPath $dir)
            }
        }
    )
}

$result | ConvertTo-Json -Depth 5
