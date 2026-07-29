[CmdletBinding()]
param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
)

$ErrorActionPreference = 'Stop'
$tempBase = [IO.Path]::GetTempPath()
$testRoot = Join-Path $tempBase ("skincos-supervisor-rollback-" + [guid]::NewGuid().ToString('N'))
$resolvedTempBase = (Resolve-Path -LiteralPath $tempBase).Path

function Invoke-Control([string]$Action) {
  $controller = Join-Path $RepositoryRoot 'scripts\manage-skincos-supervisor-hook.ps1'
  $raw = & $controller -Action $Action -RepositoryRoot $testRoot
  return $raw | ConvertFrom-Json
}

function Invoke-Runner([string]$Payload) {
  $runner = Join-Path $testRoot '.codex\hooks\invoke-skincos-supervisor.ps1'
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = 'powershell.exe'
  $start.Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`""
  $start.UseShellExecute = $false
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) {
    throw 'Could not start rollback-test hook runner.'
  }
  $process.StandardInput.Write($Payload)
  $process.StandardInput.Close()
  $output = $process.StandardOutput.ReadToEnd()
  $errors = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "Rollback-test runner exited $($process.ExitCode): $errors"
  }
  return $output | ConvertFrom-Json
}

try {
  New-Item -ItemType Directory -Path (Join-Path $testRoot '.codex\runtime\supervisor') -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $testRoot 'skills') -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $RepositoryRoot '.codex\hooks.json') -Destination (Join-Path $testRoot '.codex\hooks.json')
  Copy-Item -LiteralPath (Join-Path $RepositoryRoot '.codex\supervisor.json') -Destination (Join-Path $testRoot '.codex\supervisor.json')
  Copy-Item -LiteralPath (Join-Path $RepositoryRoot '.codex\hooks') -Destination (Join-Path $testRoot '.codex') -Recurse
  Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'skills\skincos-project-orchestrator') -Destination (Join-Path $testRoot 'skills') -Recurse
  Set-Content -LiteralPath (Join-Path $testRoot '.codex\runtime\supervisor\evidence-sentinel.txt') -Value 'preserve'

  $originalHash = (Get-FileHash -LiteralPath (Join-Path $testRoot '.codex\hooks.json') -Algorithm SHA256).Hash
  $disabled = Invoke-Control -Action Disable
  if ($disabled.enabled -ne $false -or $disabled.registration_present -ne $true) {
    throw "Disable did not preserve registration while stopping the gate: $($disabled | ConvertTo-Json -Compress)"
  }

  $disabledPayload = @{
    hook_event_name = 'Stop'
    session_id = 'rollback-disabled'
    turn_id = 'rollback-disabled-1'
    cwd = $testRoot
    stop_hook_active = $false
    last_assistant_message = 'No supervisor contract.'
  } | ConvertTo-Json -Compress
  $disabledResult = Invoke-Runner -Payload $disabledPayload
  if ($disabledResult.continue -ne $true -or $disabledResult.stopReason -notmatch 'locally disabled') {
    throw "Disabled gate did not allow Stop normally: $($disabledResult | ConvertTo-Json -Compress)"
  }

  $removed = Invoke-Control -Action RemoveRegistration
  if ($removed.registration_present -ne $false -or $removed.registration_backup_present -ne $true) {
    throw "Registration-only rollback failed: $($removed | ConvertTo-Json -Compress)"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $testRoot 'skills\skincos-project-orchestrator\SKILL.md'))) {
    throw 'Registration rollback removed the Skill.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $testRoot '.codex\runtime\supervisor\evidence-sentinel.txt'))) {
    throw 'Registration rollback removed runtime evidence.'
  }

  $restored = Invoke-Control -Action RestoreRegistration
  if ($restored.registration_present -ne $true -or $restored.enabled -ne $true) {
    throw "Registration restore failed: $($restored | ConvertTo-Json -Compress)"
  }
  $restoredHash = (Get-FileHash -LiteralPath (Join-Path $testRoot '.codex\hooks.json') -Algorithm SHA256).Hash
  if ($restoredHash -ne $originalHash) {
    throw 'Restored registration hash differs from the reviewed registration.'
  }

  $restoredPayload = @{
    hook_event_name = 'Stop'
    session_id = 'rollback-restored'
    turn_id = 'rollback-restored-1'
    cwd = $testRoot
    stop_hook_active = $false
    last_assistant_message = 'No supervisor contract.'
  } | ConvertTo-Json -Compress
  $restoredResult = Invoke-Runner -Payload $restoredPayload
  if ($restoredResult.continue -ne $true -or $restoredResult.stopReason -match 'corrupt|disabled') {
    throw "Restored gate synthetic test failed: $($restoredResult | ConvertTo-Json -Compress)"
  }

  Write-Output 'Supervisor rollback disable/remove/restore/reactivate: OK'
} finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
    if (-not $resolvedTestRoot.StartsWith($resolvedTempBase, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing cleanup outside the process temp directory: $resolvedTestRoot"
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}
