$ErrorActionPreference = 'Stop'
$temporary = Join-Path $env:TEMP "skincos-observability-test-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $temporary | Out-Null
try {
  $script = Join-Path $PSScriptRoot 'Invoke-SkincosObservability.ps1'
  $catalog = Join-Path (Split-Path -Parent $PSScriptRoot) 'catalog.json'
  $result = & $script -CatalogPath $catalog -StateDirectory $temporary -SuppressHumanNotification
  $doc = $result | ConvertFrom-Json
  if (-not $doc.results -or $doc.monitor -ne 'windows-scheduled-probe') { throw 'monitor output contract missing' }
  & $script -CatalogPath $catalog -StateDirectory $temporary -ControlledFailure -SuppressHumanNotification | Out-Null
  & $script -CatalogPath $catalog -StateDirectory $temporary -SuppressHumanNotification | Out-Null
  $notifications = Get-Content -LiteralPath (Join-Path $temporary 'notifications.jsonl') | ForEach-Object { $_ | ConvertFrom-Json }
  if (-not ($notifications.kind -contains 'alert') -or -not ($notifications.kind -contains 'resolved')) { throw 'controlled alert and resolution were not recorded' }
  if (-not (Test-Path (Join-Path $temporary 'metrics.prom'))) { throw 'metrics output missing' }
  if ((Get-Content -LiteralPath (Join-Path $temporary 'metrics-history.jsonl')).Count -lt 3) { throw 'metrics retention output missing' }
  if (-not (Test-Path (Join-Path $temporary 'monitor-health.json'))) { throw 'monitor health output missing' }
  if (-not (Test-Path (Join-Path $temporary 'dashboard.html'))) { throw 'dashboard output missing' }
  Write-Output "Observability monitor test OK ($($doc.results.Count) units)"
} finally { if (Test-Path $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force } }
