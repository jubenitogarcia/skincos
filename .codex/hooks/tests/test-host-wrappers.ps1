[CmdletBinding()]
param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
)

$ErrorActionPreference = 'Stop'
$subdirectory = Join-Path $RepositoryRoot 'skills\skincos-project-orchestrator'
$payload = @{
  hook_event_name = 'Stop'
  session_id = 'wrapper-windows'
  turn_id = 'wrapper-windows-1'
  cwd = $subdirectory
  transcript_path = $null
  stop_hook_active = $false
  last_assistant_message = 'No structured supervisor contract.'
} | ConvertTo-Json -Compress

function Invoke-RedirectedProcess(
  [string]$FileName,
  [string]$Arguments,
  [string]$WorkingDirectory,
  [string]$InputPayload
) {
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = $FileName
  $start.Arguments = $Arguments
  $start.WorkingDirectory = $WorkingDirectory
  $start.UseShellExecute = $false
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $start
  if (-not $process.Start()) {
    throw 'Could not start the Windows project-hook runner.'
  }
  $process.StandardInput.Write($InputPayload)
  $process.StandardInput.Close()
  $output = $process.StandardOutput.ReadToEnd()
  $errorOutput = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) {
    throw "Windows project-hook runner exited $($process.ExitCode): $errorOutput"
  }
  return $output
}

Push-Location $subdirectory
try {
  $runner = Join-Path $RepositoryRoot '.codex\hooks\invoke-skincos-supervisor.ps1'
  $output = Invoke-RedirectedProcess `
    -FileName 'powershell.exe' `
    -Arguments "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`"" `
    -WorkingDirectory $subdirectory `
    -InputPayload $payload
  $parsed = $output | ConvertFrom-Json
  if ($parsed.continue -ne $true -or $parsed.stopReason -match 'internal error|process failed|runner failed') {
    throw "Windows wrapper did not return a safe allow response: $output"
  }

  $registration = Get-Content -LiteralPath (Join-Path $RepositoryRoot '.codex\hooks.json') -Raw | ConvertFrom-Json
  $commandWindows = $registration.hooks.Stop[0].hooks[0].commandWindows
  $registeredOutput = Invoke-RedirectedProcess `
    -FileName 'cmd.exe' `
    -Arguments "/d /s /c `"$commandWindows`"" `
    -WorkingDirectory $subdirectory `
    -InputPayload $payload
  $registered = $registeredOutput | ConvertFrom-Json
  if ($registered.continue -ne $true -or $registered.stopReason -match 'internal error|not found|process failed|runner failed') {
    throw "Registered Windows command did not resolve from a subdirectory: $registeredOutput"
  }

  $session = 'wrapper-windows-' + [guid]::NewGuid().ToString('N')
  $continueContract = @{
    schema_version = 1
    orchestration_status = 'continue'
    objective_status = 'in_progress'
    session_id = $null
    mission_id = $null
    completed_item = 'registered-command-resolved'
    next_item = 'registered-command-terminal-check'
    progress_made = $true
    human_blocker = $null
    credential_blocker = $null
    production_authorization_required = $false
    evidence_refs = @('host:windows-registered-command')
  } | ConvertTo-Json -Compress
  $continueMessage = "SKINCOS_SUPERVISOR_STATE_BEGIN`n$continueContract`nSKINCOS_SUPERVISOR_STATE_END"
  $continuePayload = @{
    hook_event_name = 'Stop'
    session_id = $session
    turn_id = 'wrapper-windows-continue'
    cwd = $subdirectory
    transcript_path = $null
    stop_hook_active = $false
    last_assistant_message = $continueMessage
  } | ConvertTo-Json -Compress

  $previousSkillRoot = $env:SKINCOS_ORCHESTRATOR_SKILL_ROOT
  $env:SKINCOS_ORCHESTRATOR_SKILL_ROOT = Join-Path $RepositoryRoot 'skills\skincos-project-orchestrator'
  try {
    $continueOutput = Invoke-RedirectedProcess `
      -FileName 'cmd.exe' `
      -Arguments "/d /s /c `"$commandWindows`"" `
      -WorkingDirectory $subdirectory `
      -InputPayload $continuePayload
    $continued = $continueOutput | ConvertFrom-Json
    if ($continued.decision -ne 'block' -or $continued.reason -notmatch 'skincos-project-orchestrator supervisor-cycle') {
      throw "Registered Windows command did not request supervised continuation: $continueOutput"
    }

    $completeContract = @{
      schema_version = 1
      orchestration_status = 'complete'
      objective_status = 'complete'
      session_id = $null
      mission_id = $null
      completed_item = 'registered-command-terminal-check'
      next_item = $null
      progress_made = $true
      human_blocker = $null
      credential_blocker = $null
      production_authorization_required = $false
      evidence_refs = @('host:windows-terminal-contract')
    } | ConvertTo-Json -Compress
    $completeMessage = "SKINCOS_SUPERVISOR_STATE_BEGIN`n$completeContract`nSKINCOS_SUPERVISOR_STATE_END"
    $completePayload = @{
      hook_event_name = 'Stop'
      session_id = $session
      turn_id = 'wrapper-windows-complete'
      cwd = $subdirectory
      transcript_path = $null
      stop_hook_active = $true
      last_assistant_message = $completeMessage
    } | ConvertTo-Json -Compress
    $completeOutput = Invoke-RedirectedProcess `
      -FileName 'cmd.exe' `
      -Arguments "/d /s /c `"$commandWindows`"" `
      -WorkingDirectory $subdirectory `
      -InputPayload $completePayload
    $completed = $completeOutput | ConvertFrom-Json
    if ($completed.continue -ne $true -or $completed.stopReason -notmatch 'terminal state: complete') {
      throw "Registered Windows command did not stop on the terminal contract: $completeOutput"
    }
  } finally {
    $env:SKINCOS_ORCHESTRATOR_SKILL_ROOT = $previousSkillRoot
  }
} finally {
  Pop-Location
}

Write-Output 'Windows project-hook registration continue/terminal path: OK'
