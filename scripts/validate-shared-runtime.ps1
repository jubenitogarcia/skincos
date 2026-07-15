param(
    [string]$RuntimeRoot = "C:\CodexRuntime"
)

$ErrorActionPreference = "Stop"
$resolved = [IO.Path]::GetFullPath($RuntimeRoot).TrimEnd('\')
if ($resolved -ne 'C:\CodexRuntime') {
    throw "RuntimeRoot must remain C:\CodexRuntime. Received: $resolved"
}

$backupRoot = Join-Path $resolved 'backups\orb\daily'
$latest = Get-ChildItem -LiteralPath $backupRoot -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -First 1
$manifest = $null
if ($latest) {
    $manifestPath = Join-Path $latest.FullName 'manifest.json'
    if (Test-Path -LiteralPath $manifestPath) {
        $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    }
}
$task = Get-ScheduledTask -TaskName 'SkincosOrbBackup' -ErrorAction SilentlyContinue
$taskInfo = if ($task) { Get-ScheduledTaskInfo -TaskName 'SkincosOrbBackup' } else { $null }

$native = & wsl.exe -d Ubuntu-24.04 -u admin -- systemctl --quiet is-active orb orb-proxy messaging-whatsapp crm booking cloudflare-orb cloudflare-runtime 2>&1
$nativeOk = $LASTEXITCODE -eq 0

$result = [pscustomobject]@{
    runtimeRoot = $resolved
    nativeRuntimeActive = $nativeOk
    backupTaskPresent = $null -ne $task
    backupTaskLastResult = if ($taskInfo) { $taskInfo.LastTaskResult } else { $null }
    latestBackup = if ($latest) { $latest.FullName } else { $null }
    restoreVerified = [bool]($manifest -and $manifest.restoreVerified)
    workflowCount = if ($manifest) { $manifest.workflowCount } else { $null }
    executionCount = if ($manifest) { $manifest.executionCount } else { $null }
}
$result | ConvertTo-Json -Depth 4
if (-not $result.nativeRuntimeActive -or -not $result.backupTaskPresent -or $result.backupTaskLastResult -ne 0 -or -not $result.restoreVerified) {
    exit 1
}
