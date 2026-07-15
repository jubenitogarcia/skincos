[CmdletBinding()]
param([string]$RuntimeRoot = (Join-Path $env:TEMP ('skincos-github-autonomy-test-' + [Guid]::NewGuid().ToString('N'))))

$ErrorActionPreference='Stop'
$scriptRoot=Split-Path -Parent $PSScriptRoot
$broker=Join-Path $scriptRoot 'broker.ps1'
$policy=Join-Path $scriptRoot 'gate-policy.json'
. (Join-Path $scriptRoot 'lib.ps1')
$passed=0
function Assert-That { param([bool]$Condition,[string]$Message); if(-not $Condition){throw "FAIL: $Message"}; $script:passed++ }
function Write-Json { param([string]$Path,$Value); $directory=Split-Path -Parent $Path; New-Item -ItemType Directory -Force -Path $directory | Out-Null; [IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 16 -Compress),[Text.UTF8Encoding]::new($false)) }
function Invoke-TestEvent { param([int]$Id,[string]$Mock); $event=Join-Path $RuntimeRoot "event-$Id.json"; Write-Json $event @{run_id=$Id;mock_run_file=$Mock}; return (& $broker -Mode Process -RuntimeRoot $RuntimeRoot -PolicyPath $policy -EventFile $event -SkipCodex | ConvertFrom-Json) }

try {
  Assert-That ((Get-HmacHex 'key' 'The quick brown fox jumps over the lazy dog') -eq 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8') 'HMAC SHA-256 is deterministic'
  Assert-That (Test-FixedTimeEquals 'aabb' 'AABB') 'fixed-time equality accepts equivalent value'
  Assert-That (-not (Test-FixedTimeEquals 'aabb' 'aabc')) 'fixed-time equality rejects mismatch'
  New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeRoot 'config'),(Join-Path $RuntimeRoot 'secrets'),(Join-Path $RuntimeRoot 'worktrees') | Out-Null
  $hmac=Join-Path $RuntimeRoot 'secrets\ingress-hmac.txt'; [IO.File]::WriteAllText($hmac,'test-secret',[Text.UTF8Encoding]::new($false))
  Write-Json (Join-Path $RuntimeRoot 'config\runtime.config.json') @{schema_version=1;enabled=$true;paused=$false;repository='jubenitogarcia/skincos';codex_path='unused';codex_home=(Join-Path $RuntimeRoot 'codex-home');worktree_root=(Join-Path $RuntimeRoot 'worktrees');mirror_path=(Join-Path $RuntimeRoot 'mirror.git');github_app_id='test';github_installation_id='test';github_private_key_path='unused';hmac_secret_path=$hmac;broker_port=48189}
  $success=Join-Path $RuntimeRoot 'success.json'; Write-Json $success @{id=1001;name='CI Smoke (Assert)';conclusion='success';head_sha=('a'*40);head_branch='codex/admin/test';repository=@{full_name='jubenitogarcia/skincos'};head_repository=@{full_name='jubenitogarcia/skincos'}}
  $result=Invoke-TestEvent 1001 $success; Assert-That ($result.decision -eq 'processed') 'success event processes'; Assert-That ($result.session_id -eq 'test-session') 'first event creates session';
  $duplicate=Invoke-TestEvent 1001 $success; Assert-That ($duplicate.decision -eq 'duplicate') 'duplicate is ignored';
  $failure=Join-Path $RuntimeRoot 'failure.json'; Write-Json $failure @{id=1002;name='CI Smoke (Assert)';conclusion='failure';head_sha=('a'*40);head_branch='codex/admin/test';repository=@{full_name='jubenitogarcia/skincos'};head_repository=@{full_name='jubenitogarcia/skincos'}}
  $repaired=Invoke-TestEvent 1002 $failure; Assert-That ($repaired.status -eq 'repairing') 'failure resumes repair'; Assert-That ($repaired.session_id -eq 'test-session') 'failure retains session';
  $fork=Join-Path $RuntimeRoot 'fork.json'; Write-Json $fork @{id=1003;name='CI Smoke (Assert)';conclusion='failure';head_sha=('b'*40);head_branch='codex/admin/test';repository=@{full_name='jubenitogarcia/skincos'};head_repository=@{full_name='attacker/skincos'}}
  $rejected=Invoke-TestEvent 1003 $fork; Assert-That ($rejected.decision -eq 'rejected' -and $rejected.reason -eq 'foreign_or_fork') 'fork is rejected';
  $cancelled=Join-Path $RuntimeRoot 'cancelled.json'; Write-Json $cancelled @{id=1004;name='Central E2E Smoke';conclusion='cancelled';head_sha=('c'*40);head_branch='codex/admin/cancel';repository=@{full_name='jubenitogarcia/skincos'};head_repository=@{full_name='jubenitogarcia/skincos'}}
  $waiting=Invoke-TestEvent 1004 $cancelled; Assert-That ($waiting.status -eq 'awaiting_replacement') 'cancelled is deferred';
  $invalid=Join-Path $RuntimeRoot 'invalid.json'; Write-Json $invalid @{id=1005;name='CI Smoke (Assert)';conclusion='failure';head_sha='bad';head_branch='codex/admin/bad';repository=@{full_name='jubenitogarcia/skincos'};head_repository=@{full_name='jubenitogarcia/skincos'}}
  $bad=Invoke-TestEvent 1005 $invalid; Assert-That ($bad.reason -eq 'invalid_sha') 'invalid sha is rejected';
  Write-Output "PASS: $passed github autonomy regression assertions"
} finally { Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force -ErrorAction SilentlyContinue }
