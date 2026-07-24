[CmdletBinding()]
param(
  [string]$RuntimeDirectory = 'C:\CodexRuntime\operator\admin\skincos\observability',
  [string]$TaskName = 'SkincosObservabilityProbe'
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path (Join-Path $RuntimeDirectory 'bin') | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'catalog.json') -Destination (Join-Path $RuntimeDirectory 'catalog.json') -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Invoke-SkincosObservability.ps1') -Destination (Join-Path $RuntimeDirectory 'bin\Invoke-SkincosObservability.ps1') -Force
$scriptPath = Join-Path $RuntimeDirectory 'bin\Invoke-SkincosObservability.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -CatalogPath `"$(Join-Path $RuntimeDirectory 'catalog.json')`" -StateDirectory `"$RuntimeDirectory`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Description 'SKINCOS external synthetic health/readiness monitor; no production writes.' -Force | Out-Null
& $scriptPath -CatalogPath (Join-Path $RuntimeDirectory 'catalog.json') -StateDirectory $RuntimeDirectory | Out-Null
Write-Output "Installed $TaskName. State: $RuntimeDirectory"
