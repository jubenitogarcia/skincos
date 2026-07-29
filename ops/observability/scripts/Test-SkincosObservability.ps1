$ErrorActionPreference = 'Stop'
$temporary = Join-Path $env:TEMP "skincos-observability-test-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $temporary | Out-Null

function Set-ResponseRules([hashtable]$Rules) {
  [System.IO.File]::WriteAllText($responsePath, ($Rules | ConvertTo-Json -Compress))
}
function Invoke-Monitor([string]$StateDirectory, [string]$MessageExecutable = '') {
  if ($MessageExecutable) { $output = & $monitor -CatalogPath $catalogPath -StateDirectory $StateDirectory -MessageExecutable $MessageExecutable }
  else { $output = & $monitor -CatalogPath $catalogPath -StateDirectory $StateDirectory -SuppressHumanNotification }
  if ($output) { return $output | ConvertFrom-Json }
  return $null
}
function Get-Notifications([string]$StateDirectory) {
  $path = Join-Path $StateDirectory 'notifications.jsonl'
  if (-not (Test-Path $path)) { return @() }
  return @(Get-Content -LiteralPath $path | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
}

try {
  $monitor = Join-Path $PSScriptRoot 'Invoke-SkincosObservability.ps1'
  $watch = Join-Path $PSScriptRoot 'Watch-SkincosObservability.ps1'
  $responsePath = Join-Path $temporary 'responses.json'
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start(); $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port; $listener.Stop()
  $readyPath = Join-Path $temporary 'listener-ready'
  $server = Start-Job -ScriptBlock {
    param($ServerPort, $RulesPath, $ReadyPath)
    $http = [System.Net.HttpListener]::new()
    $http.Prefixes.Add("http://127.0.0.1:$ServerPort/")
    $http.Start(); [System.IO.File]::WriteAllText($ReadyPath, 'ready')
    while ($http.IsListening) {
      try {
        $context = $http.GetContext(); $mode = 'healthy'
        try { $rules = Get-Content -Raw -LiteralPath $RulesPath | ConvertFrom-Json; $property = $rules.PSObject.Properties[$context.Request.Url.AbsolutePath]; if ($property) { $mode = [string]$property.Value } } catch {}
        if ($mode -eq 'slow') { Start-Sleep -Milliseconds 900 }
        $ok = $mode -eq 'healthy'; $body = if ($ok) { '{"ok":true,"version":"test"}' } else { '{"ok":false,"version":"test"}' }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
        $context.Response.StatusCode = if ($ok) { 200 } else { 503 }; $context.Response.ContentType = 'application/json'; $context.Response.ContentLength64 = $bytes.Length
        $context.Response.OutputStream.Write($bytes, 0, $bytes.Length); $context.Response.Close()
      } catch { if (-not $http.IsListening) { break } }
    }
    $http.Close()
  } -ArgumentList $port, $responsePath, $readyPath
  $deadline = [DateTime]::UtcNow.AddSeconds(10); while (-not (Test-Path $readyPath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path $readyPath)) { throw 'local monitor test listener did not start' }

  $base = "http://127.0.0.1:$port"
  $catalogPath = Join-Path $temporary 'catalog.json'
  $units = @(
    @{id='shared';environment='staging';enabled=$true;health="$base/staging-shared/health";readiness="$base/staging-shared/readiness";latencyBudgetMs=500;impact='test';probableCause='test'},
    @{id='shared';environment='production';enabled=$true;health="$base/production-shared/health";readiness="$base/production-shared/readiness";latencyBudgetMs=500;impact='test';probableCause='test'},
    @{id='independent';environment='staging';enabled=$true;health="$base/staging-independent/health";readiness="$base/staging-independent/readiness";latencyBudgetMs=500;impact='test';probableCause='test'}
  )
  @{schema_version=4;primaryMonitor=@{retentionDays=30;notificationPolicy=@{alertAfterConsecutiveFailures=2;recoverAfterConsecutiveHealthyRuns=2;desktopAlertCooldownSeconds=900;desktopMessageTimeoutSeconds=30;desktopNotifyRecovery=$false}};units=$units} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $catalogPath -Encoding utf8
  $rules=@{}; foreach($unit in $units){$rules[([uri]$unit.health).AbsolutePath]='healthy';$rules[([uri]$unit.readiness).AbsolutePath]='healthy'}; Set-ResponseRules $rules

  $state = Join-Path $temporary 'state'; New-Item -ItemType Directory -Force -Path $state | Out-Null
  $doc = Invoke-Monitor $state
  if (-not $doc.results -or $doc.monitor -ne 'windows-scheduled-probe') { throw 'monitor output contract missing' }
  $expiredAt = [DateTime]::UtcNow.AddDays(-31).ToString('o')
  Add-Content -LiteralPath (Join-Path $state 'history.jsonl') -Value (@{generated_at=$expiredAt;results=@()} | ConvertTo-Json -Compress)
  Add-Content -LiteralPath (Join-Path $state 'metrics-history.jsonl') -Value (@{generated_at=$expiredAt;samples=@()} | ConvertTo-Json -Compress)
  Add-Content -LiteralPath (Join-Path $state 'notifications.jsonl') -Value (@{occurred_at=$expiredAt;kind='expired-test'} | ConvertTo-Json -Compress)

  # One isolated failure is pending; the second creates exactly one alert.
  $rules['/staging-shared/health']='failed'; Set-ResponseRules $rules; Invoke-Monitor $state | Out-Null
  if (Get-Notifications $state | Where-Object { $_.environment -eq 'staging' -and $_.unit -eq 'shared' }) { throw 'an isolated failed probe must not alert' }
  Invoke-Monitor $state | Out-Null
  $firstAlert = @(Get-Notifications $state | Where-Object { $_.environment -eq 'staging' -and $_.unit -eq 'shared' -and $_.kind -eq 'alert' })
  if ($firstAlert.Count -ne 1 -or $firstAlert[0].human_notification_delivery -ne 'suppressed') { throw 'two failed probes must create one suppressed desktop alert in the controlled drill' }

  # Recovery is also confirmed and never emits a desktop message.
  $rules['/staging-shared/health']='healthy'; Set-ResponseRules $rules; Invoke-Monitor $state | Out-Null; Invoke-Monitor $state | Out-Null
  $resolved = @(Get-Notifications $state | Where-Object { $_.environment -eq 'staging' -and $_.unit -eq 'shared' -and $_.kind -eq 'resolved' })
  if ($resolved.Count -ne 1 -or $resolved[0].human_notification_delivery -ne 'not-applicable') { throw 'persistent recovery must resolve once without a desktop notification' }

  # A separate incident inside the cooldown is recorded but cannot pop up.
  $rules['/staging-shared/health']='failed'; Set-ResponseRules $rules; Invoke-Monitor $state | Out-Null; Invoke-Monitor $state | Out-Null
  $alerts = @(Get-Notifications $state | Where-Object { $_.environment -eq 'staging' -and $_.unit -eq 'shared' -and $_.kind -eq 'alert' })
  if ($alerts.Count -ne 2 -or $alerts[1].human_notification_delivery -ne 'cooldown-suppressed') { throw 'a new failure inside the cooldown must not pop up' }

  # Environment and unit keys are independent, so each can confirm its first incident.
  $rules['/production-shared/health']='failed'; $rules['/staging-independent/health']='failed'; Set-ResponseRules $rules
  Invoke-Monitor $state | Out-Null; Invoke-Monitor $state | Out-Null
  foreach($key in @('production/shared','staging/independent')) { $parts=$key.Split('/'); $match=@(Get-Notifications $state | Where-Object { $_.environment -eq $parts[0] -and $_.unit -eq $parts[1] -and $_.kind -eq 'alert' }); if($match.Count -ne 1 -or $match[0].human_notification_delivery -ne 'suppressed'){throw "notification state is not independent for $key"} }

  # Legacy or corrupt persisted JSON must fail safe, then be rebuilt.
  $legacyState=Join-Path $temporary 'legacy-state'; New-Item -ItemType Directory -Force -Path $legacyState | Out-Null
  Set-Content -LiteralPath (Join-Path $legacyState 'notification-state.json') -Value '{bad json'
  $rules['/staging-shared/health']='healthy'; $rules['/production-shared/health']='healthy'; $rules['/staging-independent/health']='healthy'; Set-ResponseRules $rules
  Invoke-Monitor $legacyState | Out-Null
  if (-not (Test-Path (Join-Path $legacyState 'notification-state.json'))) { throw 'legacy notification state was not safely rebuilt' }

  # A failed msg.exe route is captured as failed, without a live popup.
  $deliveryState=Join-Path $temporary 'delivery-state'; New-Item -ItemType Directory -Force -Path $deliveryState | Out-Null
  Invoke-Monitor $deliveryState | Out-Null; $rules['/staging-independent/health']='failed'; Set-ResponseRules $rules
  Invoke-Monitor $deliveryState (Join-Path $temporary 'missing-msg.exe') | Out-Null; Invoke-Monitor $deliveryState (Join-Path $temporary 'missing-msg.exe') | Out-Null
  $failedDelivery=@(Get-Notifications $deliveryState | Where-Object { $_.environment -eq 'staging' -and $_.unit -eq 'independent' -and $_.kind -eq 'alert' })
  if($failedDelivery.Count -ne 1 -or $failedDelivery[0].human_notification_delivery -ne 'windows-message-failed'){throw 'msg.exe delivery failures must be recorded'}

  # The per-probe mutex serializes concurrent invocations, avoiding duplicate/racing alerts.
  $concurrentState=Join-Path $temporary 'concurrent-state'; New-Item -ItemType Directory -Force -Path $concurrentState | Out-Null
  $rules['/staging-independent/health']='healthy'; Set-ResponseRules $rules; Invoke-Monitor $concurrentState | Out-Null
  $rules['/staging-independent/health']='failed'; Set-ResponseRules $rules
  $jobs=@(1,2 | ForEach-Object { Start-Job -ScriptBlock { param($Path,$Catalog,$State) & $Path -CatalogPath $Catalog -StateDirectory $State -SuppressHumanNotification } -ArgumentList $monitor,$catalogPath,$concurrentState })
  $jobs | Wait-Job | Out-Null; $jobs | Receive-Job | Out-Null; $jobs | Remove-Job -Force
  if(@(Get-Notifications $concurrentState | Where-Object { $_.environment -eq 'staging' -and $_.unit -eq 'independent' -and $_.kind -eq 'alert' }).Count -ne 1){throw 'concurrent monitor runs must produce one confirmed alert'}

  # Watchdog follows the same two-run confirmation and cooldown policy.
  $watchState=Join-Path $temporary 'watch-state'; New-Item -ItemType Directory -Force -Path $watchState | Out-Null; Copy-Item $catalogPath (Join-Path $watchState 'catalog.json')
  & $watch -StateDirectory $watchState -CatalogPath (Join-Path $watchState 'catalog.json') -DashboardTaskName '' -SuppressHumanNotification | Out-Null
  $watchdogAlert=Get-Content -Raw (Join-Path $watchState 'watchdog-alert.json')|ConvertFrom-Json
  if($watchdogAlert.human_notification_delivery -ne 'pending-confirmation'){throw 'watchdog must not alert on its first stale observation'}
  & $watch -StateDirectory $watchState -CatalogPath (Join-Path $watchState 'catalog.json') -DashboardTaskName '' -SuppressHumanNotification | Out-Null
  $watchdogAlert=Get-Content -Raw (Join-Path $watchState 'watchdog-alert.json')|ConvertFrom-Json
  if($watchdogAlert.human_notification_delivery -ne 'suppressed'){throw 'watchdog did not confirm and alert once'}
  & $watch -StateDirectory $watchState -CatalogPath (Join-Path $watchState 'catalog.json') -DashboardTaskName '' -SuppressHumanNotification | Out-Null
  $watchdogAlert=Get-Content -Raw (Join-Path $watchState 'watchdog-alert.json')|ConvertFrom-Json
  if($watchdogAlert.human_notification_delivery -ne 'already-confirmed'){throw 'watchdog duplicated a confirmed alert'}
  @{last_success_at=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $watchState 'monitor-health.json') -Encoding utf8
  & $watch -StateDirectory $watchState -CatalogPath (Join-Path $watchState 'catalog.json') -DashboardTaskName '' -SuppressHumanNotification | Out-Null
  Remove-Item -LiteralPath (Join-Path $watchState 'monitor-health.json') -Force
  & $watch -StateDirectory $watchState -CatalogPath (Join-Path $watchState 'catalog.json') -DashboardTaskName '' -SuppressHumanNotification | Out-Null; & $watch -StateDirectory $watchState -CatalogPath (Join-Path $watchState 'catalog.json') -DashboardTaskName '' -SuppressHumanNotification | Out-Null
  $watchdogAlert=Get-Content -Raw (Join-Path $watchState 'watchdog-alert.json')|ConvertFrom-Json
  if($watchdogAlert.human_notification_delivery -ne 'cooldown-suppressed'){throw 'watchdog must preserve cooldown across a recovered incident'}

  if (-not (Test-Path (Join-Path $state 'metrics.prom')) -or -not (Test-Path (Join-Path $state 'monitor-health.json')) -or -not (Test-Path (Join-Path $state 'dashboard.html'))) { throw 'monitor artifacts missing' }
  foreach($retainedFile in @('history.jsonl','metrics-history.jsonl','notifications.jsonl')) { if (Select-String -LiteralPath (Join-Path $state $retainedFile) -SimpleMatch $expiredAt -Quiet) { throw "retention did not purge expired sample from $retainedFile" } }
  Write-Output 'Observability monitor policy tests OK'
} catch {
  throw "Observability monitor policy tests failed: $($_.Exception.Message)"
} finally {
  if ($server) { Stop-Job $server -ErrorAction SilentlyContinue; Remove-Job $server -Force -ErrorAction SilentlyContinue }
  if (Test-Path $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
