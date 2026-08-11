$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$script = Join-Path (Split-Path -Parent $PSScriptRoot) 'skincos-storage-governance.ps1'
$policy = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'ops\codex\storage-retention-policy.json'
$installer = Join-Path (Split-Path -Parent $PSScriptRoot) 'install-skincos-storage-governance-task.ps1'
if (-not (Test-Path -LiteralPath $script)) { throw 'governance script missing' }
if (-not (Test-Path -LiteralPath $policy)) { throw 'governance policy missing' }
if (-not (Test-Path -LiteralPath $installer)) { throw 'governance task installer missing' }

$result = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Mode audit -PolicyPath $policy
$document = ($result -join "`n") | ConvertFrom-Json
if ($document.schema_version -ne 1) { throw 'unexpected schema version' }
if ($document.drive.device -ne 'C:') { throw 'drive snapshot missing' }
if ($document.threshold_state -notin @('healthy','warning','high','critical','emergency')) { throw 'invalid threshold state' }
if ($document.limitations.Count -lt 3) { throw 'safety limitations missing' }
$taskPreview = (& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer -RepositoryRoot (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) -ScriptPath $script | Out-String) | ConvertFrom-Json
if ($taskPreview.action -ne 'dry-run' -or $taskPreview.include_worktree_status) { throw 'scheduled audit must default to quick mode' }
if (-not $taskPreview.include_focal_artifacts -or $taskPreview.arguments -notmatch '-IncludeFocalArtifacts') { throw 'scheduled audit must include focal artifact scan' }
Write-Output 'PASS: storage governance audit emits a versioned, fail-closed report.'
