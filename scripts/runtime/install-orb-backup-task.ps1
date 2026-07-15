[CmdletBinding()]
param(
    [string]$TaskName = 'SkincosOrbBackup',
    [string]$RuntimeScript = 'C:\CodexRuntime\config\orb\publish-backup.ps1',
    [datetime]$DailyAt = '03:20',
    [switch]$RunNow
)

$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'An elevated Windows PowerShell session is required to install the Orb backup task.'
}

$source = Join-Path $PSScriptRoot 'publish-orb-backup.ps1'
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Backup publisher source is unavailable: $source"
}

$runtimeDirectory = Split-Path -Parent $RuntimeScript
New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null
Copy-Item -LiteralPath $source -Destination $RuntimeScript -Force

$currentSid = $identity.User.Value
& icacls.exe $runtimeDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' "*$($currentSid):(OI)(CI)F" /T /C /Q | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Failed to restrict runtime script ACLs with exit code $LASTEXITCODE."
}

$powerShell = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$action = New-ScheduledTaskAction -Execute $powerShell -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$RuntimeScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At $DailyAt
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Force | Out-Null

if ($RunNow) {
    Start-ScheduledTask -TaskName $TaskName
}

$task = Get-ScheduledTask -TaskName $TaskName
Write-Output "task=$TaskName"
Write-Output "state=$($task.State)"
Write-Output "runtime_script=$RuntimeScript"
