$ErrorActionPreference = 'Stop'
$temporary = Join-Path $env:TEMP "skincos-observability-test-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $temporary | Out-Null
try {
  $script = Join-Path $PSScriptRoot 'Invoke-SkincosObservability.ps1'
  $catalog = Join-Path (Split-Path -Parent $PSScriptRoot) 'catalog.json'
  $result = & $script -CatalogPath $catalog -StateDirectory $temporary
  $doc = $result | ConvertFrom-Json
  if (-not $doc.results -or $doc.monitor -ne 'windows-scheduled-probe') { throw 'monitor output contract missing' }
  if (-not (Test-Path (Join-Path $temporary 'metrics.prom'))) { throw 'metrics output missing' }
  if (-not (Test-Path (Join-Path $temporary 'dashboard.html'))) { throw 'dashboard output missing' }
  Write-Output "Observability monitor test OK ($($doc.results.Count) units)"
} finally { if (Test-Path $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force } }
