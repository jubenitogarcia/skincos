[CmdletBinding()]
param(
  [string]$CatalogPath = '',
  [string]$StateDirectory = 'C:\CodexRuntime\operator\admin\skincos\observability',
  [string]$NotificationWebhook = $env:SKINCOS_OBS_NOTIFICATION_WEBHOOK,
  [string]$NotificationToken = $env:SKINCOS_OBS_NOTIFICATION_TOKEN,
  [switch]$ControlledFailure,
  [switch]$SuppressHumanNotification
)

$ErrorActionPreference = 'Stop'
$null = Add-Type -AssemblyName System.Net.Http
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
if ([string]::IsNullOrWhiteSpace($CatalogPath)) { $CatalogPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'catalog.json' }

function Write-AtomicText([string]$Path, [string]$Content) {
  $temporary = "$Path.$([guid]::NewGuid().ToString('N')).tmp"
  [System.IO.File]::WriteAllText($temporary, $Content, $utf8NoBom)
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}
function Write-AtomicJson([string]$Path, $Value) { Write-AtomicText $Path ($Value | ConvertTo-Json -Depth 16) }
function Append-JsonLine([string]$Path, $Value) { [System.IO.File]::AppendAllText($Path, (($Value | ConvertTo-Json -Depth 16 -Compress) + "`n"), $utf8NoBom) }
function Retain-JsonLines([string]$Path, [datetime]$Cutoff) {
  if (-not (Test-Path $Path)) { return }
  $kept = foreach ($line in Get-Content -LiteralPath $Path) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try { $row = $line | ConvertFrom-Json; $timestamp = if ($row.generated_at) { $row.generated_at } else { $row.occurred_at }; if ([datetime]::Parse($timestamp).ToUniversalTime() -ge $Cutoff) { $line } } catch {}
  }
  Write-AtomicText $Path (($kept -join "`n") + $(if ($kept) { "`n" } else { '' }))
}
function Emit-OperationalEvent([int]$EventId, [string]$Message, [string]$EntryType) {
  try { Write-EventLog -LogName Application -Source 'SkincosObservability' -EventId $EventId -EntryType $EntryType -Message $Message; return $true }
  catch { Write-Warning "event-log-write-failed: $($_.Exception.Message)"; return $false }
}
function Send-HumanNotification($Payload) {
  if ($SuppressHumanNotification) { return 'suppressed' }
  $message = "SKINCOS $($Payload.kind): $($Payload.environment)/$($Payload.unit) is $($Payload.state). Cause: $($Payload.probable_cause)."
  try { & "$env:SystemRoot\System32\msg.exe" * /TIME:120 $message | Out-Null; if ($LASTEXITCODE -eq 0) { return 'windows-message-delivered' } } catch {}
  return 'windows-message-failed'
}
function Get-Probe($Unit) {
  $requestId = "obs-$([guid]::NewGuid().ToString('N'))"; $endpointResults = @()
  foreach ($kind in @('health', 'readiness')) {
    $url = [string]$Unit.$kind; if ([string]::IsNullOrWhiteSpace($url)) { continue }
    $watch = [Diagnostics.Stopwatch]::StartNew(); $status = 0; $body = ''; $error = $null; $contentType = ''
    try {
      $client = New-Object System.Net.Http.HttpClient; $client.Timeout = [TimeSpan]::FromSeconds(10)
      $request = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $url)
      [void]$request.Headers.TryAddWithoutValidation('x-request-id', $requestId); [void]$request.Headers.TryAddWithoutValidation('user-agent', 'skincos-observability/2.0')
      $response = $client.SendAsync($request).GetAwaiter().GetResult(); $status = [int]$response.StatusCode; $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult(); $contentType = [string]$response.Content.Headers.ContentType; $client.Dispose()
    } catch { $error = $_.Exception.Message }
    $watch.Stop(); $json = $null; if ($body) { try { $json = $body | ConvertFrom-Json } catch {} }
    $isJson = $contentType -match 'application/json' -and $null -ne $json; $payloadOk = $json -and (($json.ok -eq $true) -or ($json.status -eq 'ok'))
    $endpointResults += [pscustomobject]@{ kind=$kind; status=$status; duration_ms=$watch.ElapsedMilliseconds; ok=($status -ge 200 -and $status -lt 300 -and $isJson -and $payloadOk); error=$error; response_version=if ($json.version) {[string]$json.version} else {'unknown'}; dependencies=if ($json.dependencies) {$json.dependencies} else {@{}}; request_id=$requestId }
  }
  $health = $endpointResults | Where-Object kind -eq 'health' | Select-Object -First 1; $readiness = $endpointResults | Where-Object kind -eq 'readiness' | Select-Object -First 1
  $requiresReadiness = $Unit.PSObject.Properties.Name -notcontains 'readinessRequired' -or [bool]$Unit.readinessRequired
  $state = if (-not $health.ok) {'failed'} elseif ($readiness -and -not $readiness.ok -and $requiresReadiness) {'degraded'} elseif ($health.duration_ms -gt [int]$Unit.latencyBudgetMs) {'degraded'} else {'healthy'}
  [pscustomobject]@{ unit=$Unit.id; environment=$Unit.environment; state=$state; contract_status=if ($Unit.contractStatus) {[string]$Unit.contractStatus} else {'complete'}; version=$health.response_version; impact=$Unit.impact; probable_cause=$Unit.probableCause; health=$health; readiness=$readiness; request_id=$requestId; checked_at=[DateTime]::UtcNow.ToString('o') }
}
function Get-Metrics([object[]]$Results) {
  $lines = @('# HELP skincos_probe_success Synthetic probe success (1 healthy, 0 otherwise).', '# TYPE skincos_probe_success gauge', '# HELP skincos_probe_duration_ms Synthetic health latency.', '# TYPE skincos_probe_duration_ms gauge')
  foreach ($result in $Results) { if (-not $result.disabled) { $labels = "unit=`"$($result.unit)`",environment=`"$($result.environment)`",version=`"$($result.version)`""; $lines += "skincos_probe_success{$labels} $(if ($result.state -eq 'healthy') {1} else {0})"; $lines += "skincos_probe_duration_ms{$labels} $($result.health.duration_ms)" } }
  $lines -join "`n"
}
function New-Dashboard([object[]]$Results, [string]$GeneratedAt) {
  $rows = foreach ($result in $Results) { $status = if ($result.disabled) {"disabled: $($result.disabled_reason)"} else {$result.state}; "<tr><td>$($result.unit)</td><td>$($result.environment)</td><td>$status</td><td>$($result.version)</td><td>$($result.health.status)</td><td>$($result.health.duration_ms)</td><td>$($result.impact)</td><td>$($result.request_id)</td></tr>" }
  "<!doctype html><html lang='pt-BR'><meta charset='utf-8'><title>SKINCOS Operations</title><style>body{font:14px system-ui;margin:2rem;color:#18212f}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d8dee8;padding:.55rem;text-align:left}th{background:#f2f5f9}tr:nth-child(even){background:#fafbfc}</style><h1>SKINCOS Operations</h1><p>Monitor externo gerado: $GeneratedAt UTC. <a href='/health'>monitor health</a> · <a href='/metrics'>metrics</a></p><table><thead><tr><th>Unidade</th><th>Ambiente</th><th>Estado</th><th>Versão</th><th>Health</th><th>ms</th><th>Impacto</th><th>request_id</th></tr></thead><tbody>$($rows -join "`n")</tbody></table></html>"
}

New-Item -ItemType Directory -Force -Path $StateDirectory | Out-Null
$catalog = Get-Content -Raw -LiteralPath $CatalogPath | ConvertFrom-Json; $previousPath = Join-Path $StateDirectory 'latest.json'; $previous = if (Test-Path $previousPath) { Get-Content -Raw $previousPath | ConvertFrom-Json } else {$null}; $results = @()
foreach ($unit in $catalog.units) { if (-not $unit.enabled) { $results += [pscustomobject]@{ unit=$unit.id; environment=$unit.environment; disabled=$true; disabled_reason=$unit.disabledReason; state='disabled'; version='not-deployed'; impact=$unit.impact; probable_cause=$unit.probableCause; request_id=''; health=[pscustomobject]@{status=0;duration_ms=0}; readiness=$null; checked_at=[DateTime]::UtcNow.ToString('o') } } else { $results += Get-Probe $unit } }
$drillState = if ($ControlledFailure) {'failed'} else {'healthy'}; $results += [pscustomobject]@{ unit='controlled-alert-drill'; environment='staging'; state=$drillState; version='drill'; impact='No production service is changed; only the monitor evaluates an intentionally unreachable endpoint.'; probable_cause=if ($ControlledFailure) {'intentional controlled test'} else {'drill idle'}; request_id="obs-drill-$([guid]::NewGuid().ToString('N'))"; health=[pscustomobject]@{status=if ($ControlledFailure) {0} else {200};duration_ms=0}; readiness=$null; checked_at=[DateTime]::UtcNow.ToString('o') }
$healthy = @($results | Where-Object {$_.state -eq 'healthy'} | ForEach-Object unit); $priorByKey = @{}; if ($previous -and $previous.results) { foreach ($item in $previous.results) {$priorByKey["$($item.environment)/$($item.unit)"]=$item.state} }; $transitions=@()
foreach ($result in $results | Where-Object {-not $_.disabled}) { $prior=$priorByKey["$($result.environment)/$($result.unit)"]; if ($prior -and $prior -ne $result.state) { $kind=if($result.state -eq 'healthy'){'resolved'}else{'alert'}; $payload=[ordered]@{kind=$kind;unit=$result.unit;environment=$result.environment;version=$result.version;impact=$result.impact;probable_cause=$result.probable_cause;healthy_modules=$healthy;request_id=$result.request_id;state=$result.state;previous_state=$prior;occurred_at=[DateTime]::UtcNow.ToString('o')}; $eventDelivered=Emit-OperationalEvent $(if($kind -eq 'alert'){1001}else{1002}) ($payload|ConvertTo-Json -Compress) $(if($kind -eq 'alert'){'Warning'}else{'Information'}); $payload['event_log_delivery']=if($eventDelivered){'delivered'}else{'failed'}; $payload['human_notification_delivery']=Send-HumanNotification $payload; if($NotificationWebhook){try{$headers=@{'content-type'='application/json';'x-alert-source'='skincos-external-monitor'};if($NotificationToken){$headers['x-obs-token']=$NotificationToken};Invoke-RestMethod -Method Post -Uri $NotificationWebhook -Headers $headers -Body ($payload|ConvertTo-Json -Compress) -TimeoutSec 10|Out-Null;$payload['webhook_delivery']='delivered'}catch{$payload['webhook_delivery']='failed'}}; Append-JsonLine (Join-Path $StateDirectory 'notifications.jsonl') $payload; $transitions += [pscustomobject]$payload } }
$generatedAt=[DateTime]::UtcNow.ToString('o'); $document=[ordered]@{schema_version=2;generated_at=$generatedAt;monitor='windows-scheduled-probe';results=$results;transitions=$transitions;notification_route=if($NotificationWebhook){'windows-message+event-log+https-webhook'}else{'windows-message+event-log'}}; Write-AtomicJson $previousPath $document; Append-JsonLine (Join-Path $StateDirectory 'history.jsonl') $document
$samples = @($results | Where-Object {-not $_.disabled} | ForEach-Object { [ordered]@{unit=$_.unit;environment=$_.environment;state=$_.state;duration_ms=$_.health.duration_ms;version=$_.version} })
$metricSample=[ordered]@{generated_at=$generatedAt;samples=$samples}; Append-JsonLine (Join-Path $StateDirectory 'metrics-history.jsonl') $metricSample; [System.IO.File]::WriteAllText((Join-Path $StateDirectory 'metrics.prom'),(Get-Metrics $results),$utf8NoBom); [System.IO.File]::WriteAllText((Join-Path $StateDirectory 'dashboard.html'),(New-Dashboard $results $generatedAt),$utf8NoBom)
$retentionDays=[int]$catalog.primaryMonitor.retentionDays; $cutoff=[DateTime]::UtcNow.AddDays(-$retentionDays); foreach($file in @('history.jsonl','metrics-history.jsonl','notifications.jsonl')) { Retain-JsonLines (Join-Path $StateDirectory $file) $cutoff }; $monitorHealth=[ordered]@{ok=$true;monitor='windows-scheduled-probe';generated_at=$generatedAt;last_success_at=$generatedAt;retention_days=$retentionDays;dashboard='loopback';notification='windows-message'}; Write-AtomicJson (Join-Path $StateDirectory 'monitor-health.json') $monitorHealth
$document | ConvertTo-Json -Depth 16
