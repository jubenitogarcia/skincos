[CmdletBinding()]
param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
)

$ErrorActionPreference = 'Stop'
$sourceSubdirectory = Join-Path $RepositoryRoot 'skills\skincos-project-orchestrator'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('skincos-hook-windows-' + [guid]::NewGuid().ToString('N'))
$redirectRoot = Join-Path ([IO.Path]::GetTempPath()) ('skincos-hook-windows-redirect-' + [guid]::NewGuid().ToString('N'))
$externalRoot = Join-Path ([IO.Path]::GetTempPath()) ('skincos-hook-windows-external-' + [guid]::NewGuid().ToString('N'))
$nonGitRoot = Join-Path ([IO.Path]::GetTempPath()) ('skincos-hook-windows-no-git-' + [guid]::NewGuid().ToString('N'))

function New-StopPayload(
  [string]$SessionId,
  [string]$TurnId,
  [string]$WorkingDirectory,
  [string]$LastAssistantMessage = 'No structured supervisor contract.',
  [bool]$StopHookActive = $false
) {
  return @{
    hook_event_name = 'Stop'
    session_id = $SessionId
    turn_id = $TurnId
    cwd = $WorkingDirectory
    transcript_path = $null
    stop_hook_active = $StopHookActive
    last_assistant_message = $LastAssistantMessage
  } | ConvertTo-Json -Compress
}

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

function Invoke-RegisteredCommand(
  [string]$Command,
  [string]$WorkingDirectory,
  [string]$InputPayload
) {
  return Invoke-RedirectedProcess `
    -FileName 'cmd.exe' `
    -Arguments "/d /s /c `"$Command`"" `
    -WorkingDirectory $WorkingDirectory `
    -InputPayload $InputPayload
}

function Assert-Allow(
  [string]$Output,
  [string]$Context,
  [bool]$ExpectCanonicalFailure = $false
) {
  $parsed = $Output | ConvertFrom-Json
  if ($parsed.continue -ne $true) {
    throw "$Context did not safely allow Stop: $Output"
  }
  if ($ExpectCanonicalFailure) {
    if ($parsed.stopReason -notmatch 'canonical Git root unavailable or invalid') {
      throw "$Context did not report canonical-root refusal: $Output"
    }
    return
  }
  if ($parsed.stopReason -match 'internal error|canonical Git root unavailable|process failed|runner failed') {
    throw "$Context did not execute the canonical runner: $Output"
  }
}

function Initialize-CanonicalFixture([string]$Root) {
  $hooks = Join-Path $Root '.codex\hooks'
  $skill = Join-Path $Root 'skills\skincos-project-orchestrator'
  New-Item -ItemType Directory -Path $hooks -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path -Parent $skill) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $RepositoryRoot '.codex\supervisor.json') -Destination (Join-Path $Root '.codex\supervisor.json')
  Copy-Item -LiteralPath (Join-Path $RepositoryRoot '.codex\hooks\invoke-skincos-supervisor.ps1') -Destination $hooks
  Copy-Item -LiteralPath (Join-Path $RepositoryRoot '.codex\hooks\skincos-supervisor-gate.py') -Destination $hooks
  Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'skills\skincos-project-orchestrator') -Destination $skill -Recurse
  & git -C $Root init --quiet
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not initialize the canonical Windows hook fixture.'
  }
}

try {
  $directPayload = New-StopPayload `
    -SessionId 'wrapper-windows-direct' `
    -TurnId 'wrapper-windows-direct-1' `
    -WorkingDirectory $sourceSubdirectory
  $runner = Join-Path $RepositoryRoot '.codex\hooks\invoke-skincos-supervisor.ps1'
  $directOutput = Invoke-RedirectedProcess `
    -FileName 'powershell.exe' `
    -Arguments "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`"" `
    -WorkingDirectory $sourceSubdirectory `
    -InputPayload $directPayload
  Assert-Allow -Output $directOutput -Context 'Direct Windows wrapper'

  $registration = Get-Content -LiteralPath (Join-Path $RepositoryRoot '.codex\hooks.json') -Raw | ConvertFrom-Json
  $commandWindows = $registration.hooks.Stop[0].hooks[0].commandWindows

  Initialize-CanonicalFixture -Root $fixtureRoot
  $fixtureSubdirectory = Join-Path $fixtureRoot 'workspace\intermediate\deep'
  New-Item -ItemType Directory -Path $fixtureSubdirectory -Force | Out-Null

  $rootPayload = New-StopPayload `
    -SessionId 'wrapper-windows-root' `
    -TurnId 'wrapper-windows-root-1' `
    -WorkingDirectory $fixtureRoot
  $rootOutput = Invoke-RegisteredCommand `
    -Command $commandWindows `
    -WorkingDirectory $fixtureRoot `
    -InputPayload $rootPayload
  Assert-Allow -Output $rootOutput -Context 'Registered Windows command from repository root'

  $decoyMarker = Join-Path $fixtureRoot 'decoy-windows-executed.txt'
  $decoyHooks = Join-Path $fixtureRoot 'workspace\.codex\hooks'
  New-Item -ItemType Directory -Path $decoyHooks -Force | Out-Null
  $decoyScript = @"
[IO.File]::WriteAllText('$($decoyMarker.Replace("'", "''"))', 'executed')
[Console]::Out.WriteLine('{"continue":true,"stopReason":"decoy runner executed"}')
"@
  [IO.File]::WriteAllText(
    (Join-Path $decoyHooks 'invoke-skincos-supervisor.ps1'),
    $decoyScript,
    [Text.UTF8Encoding]::new($false)
  )
  $subdirectoryPayload = New-StopPayload `
    -SessionId 'wrapper-windows-subdirectory' `
    -TurnId 'wrapper-windows-subdirectory-1' `
    -WorkingDirectory $fixtureSubdirectory
  $subdirectoryOutput = Invoke-RegisteredCommand `
    -Command $commandWindows `
    -WorkingDirectory $fixtureSubdirectory `
    -InputPayload $subdirectoryPayload
  Assert-Allow -Output $subdirectoryOutput -Context 'Registered Windows command from nested subdirectory'
  if (Test-Path -LiteralPath $decoyMarker) {
    throw 'Registered Windows command executed a homonymous intermediate wrapper.'
  }

  New-Item -ItemType Directory -Path $redirectRoot -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $externalRoot '.codex\hooks') -Force | Out-Null
  & git -C $redirectRoot init --quiet
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not initialize the Windows reparse-point fixture.'
  }
  $redirectMarker = Join-Path $externalRoot 'redirect-windows-executed.txt'
  $redirectScript = @"
[IO.File]::WriteAllText('$($redirectMarker.Replace("'", "''"))', 'executed')
[Console]::Out.WriteLine('{"continue":true,"stopReason":"redirected runner executed"}')
"@
  [IO.File]::WriteAllText(
    (Join-Path $externalRoot '.codex\hooks\invoke-skincos-supervisor.ps1'),
    $redirectScript,
    [Text.UTF8Encoding]::new($false)
  )
  New-Item -ItemType Junction -Path (Join-Path $redirectRoot '.codex') -Target (Join-Path $externalRoot '.codex') | Out-Null
  $redirectPayload = New-StopPayload `
    -SessionId 'wrapper-windows-reparse' `
    -TurnId 'wrapper-windows-reparse-1' `
    -WorkingDirectory $redirectRoot
  $redirectOutput = Invoke-RegisteredCommand `
    -Command $commandWindows `
    -WorkingDirectory $redirectRoot `
    -InputPayload $redirectPayload
  Assert-Allow -Output $redirectOutput -Context 'Registered Windows command with reparse point' -ExpectCanonicalFailure $true
  if (Test-Path -LiteralPath $redirectMarker) {
    throw 'Registered Windows command followed a reparse point to a redirected wrapper.'
  }

  New-Item -ItemType Directory -Path $nonGitRoot -Force | Out-Null
  $nonGitPayload = New-StopPayload `
    -SessionId 'wrapper-windows-no-git' `
    -TurnId 'wrapper-windows-no-git-1' `
    -WorkingDirectory $nonGitRoot
  $nonGitOutput = Invoke-RegisteredCommand `
    -Command $commandWindows `
    -WorkingDirectory $nonGitRoot `
    -InputPayload $nonGitPayload
  Assert-Allow -Output $nonGitOutput -Context 'Registered Windows command outside Git' -ExpectCanonicalFailure $true

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
  $continuePayload = New-StopPayload `
    -SessionId $session `
    -TurnId 'wrapper-windows-continue' `
    -WorkingDirectory $fixtureSubdirectory `
    -LastAssistantMessage $continueMessage

  $previousSkillRoot = $env:SKINCOS_ORCHESTRATOR_SKILL_ROOT
  $env:SKINCOS_ORCHESTRATOR_SKILL_ROOT = Join-Path $fixtureRoot 'skills\skincos-project-orchestrator'
  try {
    $continueOutput = Invoke-RegisteredCommand `
      -Command $commandWindows `
      -WorkingDirectory $fixtureSubdirectory `
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
    $completePayload = New-StopPayload `
      -SessionId $session `
      -TurnId 'wrapper-windows-complete' `
      -WorkingDirectory $fixtureSubdirectory `
      -LastAssistantMessage $completeMessage `
      -StopHookActive $true
    $completeOutput = Invoke-RegisteredCommand `
      -Command $commandWindows `
      -WorkingDirectory $fixtureSubdirectory `
      -InputPayload $completePayload
    $completed = $completeOutput | ConvertFrom-Json
    if ($completed.continue -ne $true -or $completed.stopReason -notmatch 'terminal state: complete') {
      throw "Registered Windows command did not stop on the terminal contract: $completeOutput"
    }
  } finally {
    $env:SKINCOS_ORCHESTRATOR_SKILL_ROOT = $previousSkillRoot
  }
} finally {
  foreach ($path in @($fixtureRoot, $redirectRoot, $externalRoot, $nonGitRoot)) {
    if ($path -and (Test-Path -LiteralPath $path)) {
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }
}

Write-Output 'Windows project-hook canonical-root, redirect refusal, continue and terminal paths: OK'
