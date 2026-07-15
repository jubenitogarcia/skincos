[CmdletBinding()]
param(
    [ValidateSet('Serve','Process','Reconcile','Status','TestEvent')][string]$Mode = 'Serve',
    [string]$RuntimeRoot,
    [string]$PolicyPath,
    [string]$EventFile,
    [switch]$SkipCodex
)

. (Join-Path $PSScriptRoot 'lib.ps1')
$RuntimeRoot = Get-AutonomyRoot $RuntimeRoot
if ([string]::IsNullOrWhiteSpace($PolicyPath)) { $PolicyPath = Join-Path $PSScriptRoot 'gate-policy.json' }
Ensure-AutonomyLayout $RuntimeRoot

function Get-StatePath { param([string]$Key) return (Join-Path $RuntimeRoot ('state\\' + (Get-Sha256Hex $Key).ToLowerInvariant() + '.json')) }

function Test-Ingress {
    param([string]$Body,[string]$Timestamp,[string]$Nonce,[string]$Signature,$Config,$Policy,[switch]$AllowReconcile)
    if ($Body.Length -gt 65536) { throw 'Event body exceeds 64 KiB.' }
    if ($Timestamp -notmatch '^\d{10}$' -or $Nonce -notmatch '^[A-Za-z0-9_-]{16,128}$' -or $Signature -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid ingress headers.' }
    if ([Math]::Abs([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - [Int64]$Timestamp) -gt [int]$Policy.event_max_age_seconds) { throw 'Stale ingress event.' }
    $secret = (Get-Content -Raw -LiteralPath $Config.hmac_secret_path).Trim()
    $expected = Get-HmacHex $secret ("$Timestamp`n$Nonce`n$Body")
    if (-not (Test-FixedTimeEquals $expected $Signature)) { throw 'Invalid ingress signature.' }
    $noncePath = Join-Path $RuntimeRoot ('state\\nonce-' + (Get-Sha256Hex $Nonce).ToLowerInvariant() + '.json')
    if (Test-Path -LiteralPath $noncePath) { throw 'Replay detected.' }
    Write-AutonomyJsonAtomic $noncePath @{ timestamp=[DateTime]::UtcNow.ToString('o'); nonce_hash=(Get-Sha256Hex $Nonce) }
    $event = $Body | ConvertFrom-Json
    if ($AllowReconcile -and [string]$event.action -eq 'reconcile') { return [Int64]0 }
    if ($null -eq $event.run_id -or [string]$event.run_id -notmatch '^\d+$') { throw 'run_id is required.' }
    return [Int64]$event.run_id
}

function Get-WorkflowEvent {
    param([Int64]$RunId,$Config,[string]$MockFile)
    if ($MockFile) { return (Get-Content -Raw -LiteralPath $MockFile | ConvertFrom-Json) }
    $token = Get-GitHubInstallationToken $Config
    try { return Invoke-GitHubApi -Method 'GET' -Path ("/repos/{0}/actions/runs/{1}" -f $Config.repository,$RunId) -Token $token } finally { $token = $null }
}

function Get-TrustDecision {
    param($Run,$Policy)
    $repo = [string]$Run.repository.full_name
    $headRepo = [string]$Run.head_repository.full_name
    $branch = [string]$Run.head_branch
    $sha = [string]$Run.head_sha
    if ($repo -ne [string]$Policy.repository -or $headRepo -ne [string]$Policy.repository) { return @{ eligible=$false; reason='foreign_or_fork' } }
    if ($sha -notmatch '^[a-fA-F0-9]{40}$') { return @{ eligible=$false; reason='invalid_sha' } }
    $matchesPrefix = @($Policy.trusted_head_prefixes | Where-Object { $branch.StartsWith([string]$_,[StringComparison]::Ordinal) }).Count -gt 0
    if (-not $matchesPrefix -and $branch -ne 'main') { return @{ eligible=$false; reason='untrusted_branch' } }
    if (@($Policy.watched_workflows) -notcontains [string]$Run.name) { return @{ eligible=$false; reason='unwatched_workflow' } }
    return @{ eligible=$true; reason='eligible' }
}

function Invoke-CodexContinuation {
    param($State,$Run,$Config,$Policy)
    if ($SkipCodex) { return @{ session_id='test-session'; mode='skipped'; exit_code=0 } }
    if (-not (Test-Path -LiteralPath $Config.codex_path)) { throw "Codex executable is unavailable: $($Config.codex_path)" }
    $worktree = Join-Path $Config.worktree_root (($State.key -replace '[^A-Za-z0-9._-]','-').Substring(0,[Math]::Min(80,$State.key.Length)))
    if (-not (Test-Path -LiteralPath $worktree)) { throw "Isolated worktree is not prepared: $worktree" }
    $prompt = @"
You are resuming the trusted Skincos GitHub autonomy task.
Repository: $($Config.repository)
Workflow: $($Run.name) run=$($Run.id) conclusion=$($Run.conclusion)
Branch: $($Run.head_branch) SHA: $($Run.head_sha)
Do not push, open a PR, merge, alter .github/workflows, or alter ops/github-autonomy. Work only in this isolated worktree. Diagnose the real gate state, make a minimal corrective commit when appropriate, run relevant validations, and end with a concise handoff. A broker will validate and publish eligible commits separately.
"@
    $env:CODEX_HOME = [string]$Config.codex_home
    $out = Join-Path $RuntimeRoot ('events\\codex-' + [Guid]::NewGuid().ToString('N') + '.jsonl')
    $args = @('exec','--json','--sandbox','workspace-write','--output-last-message',(Join-Path $RuntimeRoot ('reports\\last-message-' + [Guid]::NewGuid().ToString('N') + '.txt')))
    if ($State.session_id) { $args += @('resume',[string]$State.session_id,$prompt) } else { $args += @('--cd',$worktree,$prompt) }
    & $Config.codex_path @args 2>&1 | Tee-Object -FilePath $out | Out-Null
    $exit = $LASTEXITCODE
    $session = $null
    foreach ($line in Get-Content -LiteralPath $out) { if ($line -match '[0-9a-f]{8}-[0-9a-f-]{27,}' -and -not $session) { $session = $Matches[0] } }
    if (-not $session) { $session = $State.session_id }
    return @{ session_id=$session; mode=($(if($State.session_id){'resume'}else{'start'})); exit_code=$exit; event_log=$out }
}

function Invoke-ProcessEvent {
    param([Int64]$RunId,[string]$MockFile)
    $config = Get-AutonomyConfig $RuntimeRoot; $policy = Get-AutonomyPolicy $PolicyPath
    if (-not $config.enabled -or $config.paused) { Write-AutonomyLog $RuntimeRoot 'ignored' @{run_id=$RunId; reason='disabled_or_paused'}; return @{ decision='ignored'; reason='disabled_or_paused' } }
    $globalLock = Enter-AutonomyLock $RuntimeRoot 'broker'
    if ($null -eq $globalLock) { return @{ decision='deferred'; reason='broker_busy' } }
    try {
        $run = Get-WorkflowEvent -RunId $RunId -Config $config -MockFile $MockFile
        $trust = Get-TrustDecision $run $policy
        $summary = @{ run_id=[string]$run.id; workflow=[string]$run.name; conclusion=[string]$run.conclusion; sha=[string]$run.head_sha; branch=[string]$run.head_branch; trust=$trust.reason }
        if (-not $trust.eligible) { Write-AutonomyLog $RuntimeRoot 'rejected' $summary; return @{ decision='rejected'; reason=$trust.reason } }
        $key = "{0}:{1}" -f ([string]$run.head_branch),([string]$run.head_sha)
        $itemLock = Enter-AutonomyLock $RuntimeRoot $key
        if ($null -eq $itemLock) { Write-AutonomyLog $RuntimeRoot 'deferred' $summary; return @{ decision='deferred'; reason='item_busy' } }
        try {
            $statePath = Get-StatePath $key; $state = Read-AutonomyJson $statePath $null
            if ($null -eq $state) { $state = [ordered]@{ key=$key; session_id=$null; attempts=0; processed_runs=@(); status='new'; created_at=[DateTime]::UtcNow.ToString('o') } }
            if (@($state.processed_runs | ForEach-Object {[string]$_}) -contains [string]$run.id) { return @{ decision='duplicate'; reason='run_already_processed' } }
            if ([int]$state.attempts -ge [int]$policy.max_attempts_per_sha) { $state.status='paused_limit'; Write-AutonomyJsonAtomic $statePath $state; return @{ decision='paused'; reason='max_attempts' } }
            $state.attempts = [int]$state.attempts + 1; $state.processed_runs = @($state.processed_runs) + @([string]$run.id); $state.last_run=$summary; $state.updated_at=[DateTime]::UtcNow.ToString('o')
            switch ([string]$run.conclusion) {
                'success' { $state.status='gates_recheck'; $continuation = Invoke-CodexContinuation $state $run $config $policy }
                'failure' { $state.status='repairing'; $continuation = Invoke-CodexContinuation $state $run $config $policy }
                'cancelled' { $state.status='awaiting_replacement'; $continuation = @{mode='none';exit_code=0} }
                default { $state.status='inconclusive'; $continuation = @{mode='none';exit_code=0} }
            }
            if ($continuation -is [hashtable] -and $continuation.ContainsKey('session_id') -and $continuation['session_id']) { $state.session_id=[string]$continuation['session_id'] }
            $state.last_continuation=$continuation; Write-AutonomyJsonAtomic $statePath $state
            Write-AutonomyLog $RuntimeRoot 'processed' @{run_id=$summary.run_id; workflow=$summary.workflow; conclusion=$summary.conclusion; sha=$summary.sha; branch=$summary.branch; trust=$summary.trust; status=$state.status; session_id=$state.session_id; attempt=$state.attempts}
            return @{ decision='processed'; status=$state.status; session_id=$state.session_id }
        } finally { Exit-AutonomyLock $itemLock $RuntimeRoot $key }
    } finally { Exit-AutonomyLock $globalLock $RuntimeRoot 'broker' }
}

function Invoke-Reconcile {
    $config = Get-AutonomyConfig $RuntimeRoot; $policy = Get-AutonomyPolicy $PolicyPath
    if (-not $config.enabled -or $config.paused) { return @{decision='ignored';reason='disabled_or_paused'} }
    $token = Get-GitHubInstallationToken $config
    try { $runs = Invoke-GitHubApi -Method 'GET' -Path ("/repos/{0}/actions/runs?status=completed&per_page=100" -f $config.repository) -Token $token } finally { $token=$null }
    $cutoff=[DateTime]::UtcNow.AddHours(-6); $processed=@()
    foreach ($run in @($runs.workflow_runs | Where-Object { @($policy.watched_workflows) -contains [string]$_.name } | Sort-Object updated_at)) {
        $updated=[DateTime]::Parse([string]$run.updated_at).ToUniversalTime()
        if ($updated -lt $cutoff) { continue }
        $result=Invoke-ProcessEvent -RunId ([Int64]$run.id)
        $processed += @{run_id=$run.id;decision=$result.decision;reason=$result.reason;status=$result.status}
    }
    Write-AutonomyLog $RuntimeRoot 'reconciled' @{count=$processed.Count}
    return @{decision='reconciled';count=$processed.Count;items=$processed}
}

if ($Mode -eq 'Status') { Get-ChildItem (Join-Path $RuntimeRoot 'state') -Filter '*.json' | ForEach-Object { Read-AutonomyJson $_.FullName } | ConvertTo-Json -Depth 8; exit 0 }
if ($Mode -eq 'Process' -or $Mode -eq 'TestEvent') {
    if (-not $EventFile) { throw '-EventFile is required for Process/TestEvent.' }
    $file = Get-Content -Raw -LiteralPath $EventFile | ConvertFrom-Json
    Invoke-ProcessEvent -RunId ([Int64]$file.run_id) -MockFile $file.mock_run_file | ConvertTo-Json -Depth 8
    exit 0
}
if ($Mode -eq 'Reconcile') { Invoke-Reconcile | ConvertTo-Json -Depth 12; exit 0 }

$config = Get-AutonomyConfig $RuntimeRoot; $policy = Get-AutonomyPolicy $PolicyPath
$listener = [System.Net.HttpListener]::new(); $listener.Prefixes.Add("http://127.0.0.1:$($config.broker_port)/autonomy/"); $listener.Start()
Write-AutonomyLog $RuntimeRoot 'broker_started' @{port=$config.broker_port}
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext(); $response = $context.Response
        try {
            if ($context.Request.HttpMethod -ne 'POST' -or @('/autonomy/event','/autonomy/reconcile') -notcontains $context.Request.Url.AbsolutePath) { throw 'Route not found.' }
            $reader = [IO.StreamReader]::new($context.Request.InputStream,[Text.Encoding]::UTF8,$false,65536,$true); $body=$reader.ReadToEnd(); $reader.Dispose()
            if ($context.Request.Url.AbsolutePath -eq '/autonomy/reconcile') {
                $null = Test-Ingress $body $context.Request.Headers['X-Autonomy-Timestamp'] $context.Request.Headers['X-Autonomy-Nonce'] $context.Request.Headers['X-Autonomy-Signature'] $config $policy -AllowReconcile
                $result = Invoke-Reconcile
            } else {
                $runId = Test-Ingress $body $context.Request.Headers['X-Autonomy-Timestamp'] $context.Request.Headers['X-Autonomy-Nonce'] $context.Request.Headers['X-Autonomy-Signature'] $config $policy
                $result = Invoke-ProcessEvent -RunId $runId
            }
            $response.StatusCode=202; $payload=ConvertTo-CanonicalJson $result
        } catch { $response.StatusCode=400; $payload=ConvertTo-CanonicalJson @{error=$_.Exception.Message}; Write-AutonomyLog $RuntimeRoot 'ingress_error' @{message=$_.Exception.Message} }
        $bytes=[Text.Encoding]::UTF8.GetBytes($payload); $response.ContentType='application/json'; $response.OutputStream.Write($bytes,0,$bytes.Length); $response.Close()
    }
} finally { $listener.Stop(); $listener.Close() }
