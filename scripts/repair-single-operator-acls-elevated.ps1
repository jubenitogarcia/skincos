[CmdletBinding()]
param(
    [ValidateSet("All", "Worktrees")]
    [string]$Scope = "All"
)

$ErrorActionPreference = "Stop"
$project = "C:\CodexShared\Projetos\skincos"
$worktrees = "C:\CodexShared\Worktrees\skincos"
$runtime = "C:\CodexRuntime\n8n"
$log = "C:\CodexRuntime\n8n\exports\acl-repair-elevated.log"

Start-Transcript -LiteralPath $log -Force | Out-Null
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "The ACL repair must run elevated."
    }

    $computer = $env:COMPUTERNAME
    $workspaceGrants = @(
        "$computer\admin:(OI)(CI)F",
        "BUILTIN\Administrators:(OI)(CI)F",
        "NT AUTHORITY\SYSTEM:(OI)(CI)F",
        "$computer\CodexSandboxOnline:(OI)(CI)M",
        "$computer\CodexSandboxOffline:(OI)(CI)M"
    )

    if ($Scope -eq "All") {
        & takeown.exe /F $project /R /D Y | Out-Null
        & takeown.exe /F $runtime /R /D Y | Out-Null
        & icacls.exe "$project\*" /reset /T /C /Q | Out-Host
        & icacls.exe "$runtime\*" /reset /T /C /Q | Out-Host

        & icacls.exe $project /reset /Q | Out-Null
        & icacls.exe $project /inheritance:r /Q | Out-Null
        & icacls.exe $project /remove:g "*S-1-5-32-545" /Q | Out-Null
        & icacls.exe $project /grant:r $workspaceGrants /Q | Out-Host

        & icacls.exe $runtime /reset /Q | Out-Null
        & icacls.exe $runtime /inheritance:r /Q | Out-Null
        & icacls.exe $runtime /remove:g "*S-1-5-32-545" /Q | Out-Null
        & icacls.exe $runtime /grant:r `
            "$computer\admin:(OI)(CI)F" `
            "BUILTIN\Administrators:(OI)(CI)F" `
            "NT AUTHORITY\SYSTEM:(OI)(CI)F" /Q | Out-Host
    }

    & takeown.exe /F $worktrees /R /D Y | Out-Null
    & icacls.exe "$worktrees\*" /reset /T /C /Q | Out-Host
    & icacls.exe $worktrees /reset /Q | Out-Null
    & icacls.exe $worktrees /inheritance:r /Q | Out-Null
    & icacls.exe $worktrees /remove:g "*S-1-5-32-545" /Q | Out-Null
    & icacls.exe $worktrees /grant:r $workspaceGrants /Q | Out-Host

    "ACL_REPAIR_OK $(Get-Date -Format o)" | Set-Content -LiteralPath "$log.ok" -Encoding ASCII
}
finally {
    Stop-Transcript | Out-Null
}
