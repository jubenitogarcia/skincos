[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [string]$RepositoryRoot = 'C:\CodexShared\Projetos\skincos',
    [string]$TaskName = 'SKINCOS Storage Governance Audit',
    [string]$ScriptPath = '',
    [int]$IntervalHours = 6,
    [switch]$IncludeWorktreeStatus,
    [switch]$SkipFocalArtifacts,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
    $ScriptPath = Join-Path $RepositoryRoot 'scripts\skincos-storage-governance.ps1'
}
if (-not (Test-Path -LiteralPath $ScriptPath -PathType Leaf)) { throw "Governance script not found: $ScriptPath" }
if ($IntervalHours -lt 1 -or $IntervalHours -gt 24) { throw 'IntervalHours must be between 1 and 24.' }

$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$statusArgument = if ($IncludeWorktreeStatus) { ' -IncludeWorktreeStatus' } else { '' }
$includeFocalArtifacts = -not $SkipFocalArtifacts
$focalArgument = if ($includeFocalArtifacts) { ' -IncludeFocalArtifacts' } else { '' }
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Mode audit$statusArgument$focalArgument"
$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory (Split-Path -Parent $ScriptPath)
$start = (Get-Date).AddMinutes(5)
$trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Hours $IntervalHours) -RepetitionDuration (New-TimeSpan -Days 3650)
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$triggers = @($trigger, $logonTrigger)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew -StartWhenAvailable

if (-not $Apply) {
    [pscustomobject]@{ task_name = $TaskName; script = $ScriptPath; arguments = $arguments; interval_hours = $IntervalHours; include_worktree_status = [bool]$IncludeWorktreeStatus; include_focal_artifacts = $includeFocalArtifacts; run_at_logon = $true; action = 'dry-run'; user = "$env:USERDOMAIN\$env:USERNAME" } | ConvertTo-Json
    exit 0
}
if ($PSCmdlet.ShouldProcess($TaskName, 'Register scheduled read-only storage audit')) {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
    [pscustomobject]@{ task_name = $TaskName; script = $ScriptPath; arguments = $arguments; interval_hours = $IntervalHours; include_worktree_status = [bool]$IncludeWorktreeStatus; include_focal_artifacts = $includeFocalArtifacts; run_at_logon = $true; action = 'registered'; user = "$env:USERDOMAIN\$env:USERNAME" } | ConvertTo-Json
}
