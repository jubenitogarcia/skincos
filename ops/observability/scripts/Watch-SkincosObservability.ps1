[CmdletBinding()]
param(
  [string]$StateDirectory='C:\CodexRuntime\operator\admin\skincos\observability',
  [string]$DashboardTaskName='SkincosObservabilityDashboard',
  [string]$CatalogPath='',
  [int]$AlertCooldownSeconds=0,
  [int]$MessageTimeoutSeconds=0,
  [string]$MessageExecutable="$env:SystemRoot\System32\msg.exe",
  [switch]$SuppressHumanNotification
)
$ErrorActionPreference='Stop'
$defaultPolicy=[ordered]@{alertAfterConsecutiveFailures=2;desktopAlertCooldownSeconds=900;desktopMessageTimeoutSeconds=30}
if([string]::IsNullOrWhiteSpace($CatalogPath)){$CatalogPath=Join-Path $StateDirectory 'catalog.json'}
if(Test-Path $CatalogPath){try{$catalog=Get-Content -Raw -LiteralPath $CatalogPath|ConvertFrom-Json;$configuredPolicy=$catalog.primaryMonitor.notificationPolicy;if($configuredPolicy){foreach($name in $defaultPolicy.Keys){if($configuredPolicy.PSObject.Properties.Name -contains $name -and [int]$configuredPolicy.$name -gt 0){$defaultPolicy[$name]=[int]$configuredPolicy.$name}}}}catch{}}
if($AlertCooldownSeconds -gt 0){$defaultPolicy.desktopAlertCooldownSeconds=$AlertCooldownSeconds}
if($MessageTimeoutSeconds -gt 0){$defaultPolicy.desktopMessageTimeoutSeconds=$MessageTimeoutSeconds}
$healthPath=Join-Path $StateDirectory 'monitor-health.json'
$notificationStatePath=Join-Path $StateDirectory 'watchdog-notification-state.json'
$stale=$true
if(Test-Path $healthPath){try{$health=Get-Content -Raw $healthPath|ConvertFrom-Json;$stale=([DateTime]::UtcNow-[DateTime]::Parse($health.last_success_at).ToUniversalTime()).TotalSeconds -gt 180}catch{}}
if($stale){
  $now=[DateTime]::UtcNow
  $state=$null
  if(Test-Path $notificationStatePath){try{$state=Get-Content -Raw $notificationStatePath|ConvertFrom-Json}catch{}}
  $candidateRuns=if($state){[int]$state.candidate_stale_runs}else{0}
  $candidateRuns++
  $confirmed=$state -and [bool]$state.confirmed_stale
  $cooldownElapsed=$true
  if($state -and $state.last_desktop_alert_at){try{$cooldownElapsed=($now-[DateTime]::Parse([string]$state.last_desktop_alert_at).ToUniversalTime()).TotalSeconds -ge $defaultPolicy.desktopAlertCooldownSeconds}catch{}}
  $delivery=if($confirmed){'already-confirmed'}else{'pending-confirmation'}
  if(-not $confirmed -and $candidateRuns -ge $defaultPolicy.alertAfterConsecutiveFailures){
    $confirmed=$true
    $candidateRuns=0
    $delivery='cooldown-suppressed'
    if($cooldownElapsed){
    $message='SKINCOS ALERT: external monitor is stale; watchdog is restarting the local dashboard.'
    try{Write-EventLog -LogName Application -Source 'SkincosObservability' -EventId 1003 -EntryType Warning -Message $message}catch{}
    if($SuppressHumanNotification){$delivery='suppressed'}else{try{& $MessageExecutable * "/TIME:$($defaultPolicy.desktopMessageTimeoutSeconds)" $message|Out-Null;if($LASTEXITCODE -eq 0){$delivery='windows-message-delivered'}else{$delivery='windows-message-failed'}}catch{$delivery='windows-message-failed'}}
    if($delivery -in @('suppressed','windows-message-delivered')){$stateLastAlert=$now.ToString('o')}
    }
  }
  $nextState=[ordered]@{schema_version=1;candidate_stale_runs=$candidateRuns;confirmed_stale=$confirmed;last_desktop_alert_at=if($stateLastAlert){$stateLastAlert}elseif($state){$state.last_desktop_alert_at}else{$null};updated_at=$now.ToString('o')}
  [System.IO.File]::WriteAllText($notificationStatePath,($nextState|ConvertTo-Json))
  [System.IO.File]::WriteAllText((Join-Path $StateDirectory 'watchdog-alert.json'),(@{ok=$false;observed_at=$now.ToString('o');reason='monitor-stale';candidate_runs=$candidateRuns;confirmed=$confirmed;human_notification_delivery=$delivery}|ConvertTo-Json))
}else{
  $lastAlertAt=$null
  if(Test-Path $notificationStatePath){try{$lastAlertAt=(Get-Content -Raw $notificationStatePath|ConvertFrom-Json).last_desktop_alert_at}catch{}}
  [System.IO.File]::WriteAllText($notificationStatePath,(@{schema_version=1;candidate_stale_runs=0;confirmed_stale=$false;last_desktop_alert_at=$lastAlertAt;updated_at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json))
}
if(-not [string]::IsNullOrWhiteSpace($DashboardTaskName)){try{$task=Get-ScheduledTask -TaskName $DashboardTaskName -ErrorAction Stop; if($task.State -ne 'Running'){Start-ScheduledTask -TaskName $DashboardTaskName}}catch{}}
