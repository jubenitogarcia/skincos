[CmdletBinding()]
param([string]$StateDirectory='C:\CodexRuntime\operator\admin\skincos\observability',[string]$CatalogPath='',[int]$DashboardPort=18799)
$ErrorActionPreference='Continue'; $bin=Split-Path -Parent $MyInvocation.MyCommand.Path; if([string]::IsNullOrWhiteSpace($CatalogPath)){$CatalogPath=Join-Path $StateDirectory 'catalog.json'}; $invoke=Join-Path $bin 'Invoke-SkincosObservability.ps1'; $serve=Join-Path $bin 'Serve-SkincosObservabilityDashboard.ps1'; $watch=Join-Path $bin 'Watch-SkincosObservability.ps1'; $dashboard=$null
$createdNew=$false; $mutex=[System.Threading.Mutex]::new($true,'Local\SkincosObservabilitySupervisor',[ref]$createdNew); if(-not $createdNew){exit 0}
try{
  while($true){
    if($null -eq $dashboard -or $dashboard.HasExited){$dashboard=Start-Process -FilePath powershell.exe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$serve`" -StateDirectory `"$StateDirectory`" -Port $DashboardPort" -WindowStyle Hidden -PassThru}
    try{& $invoke -CatalogPath $CatalogPath -StateDirectory $StateDirectory | Out-Null}catch{[System.IO.File]::WriteAllText((Join-Path $StateDirectory 'supervisor-error.txt'),"$([DateTime]::UtcNow.ToString('o')) $($_.Exception.Message)")}
    try{& $watch -StateDirectory $StateDirectory -DashboardTaskName ''|Out-Null}catch{}
    Start-Sleep -Seconds 60
  }
}finally{$mutex.ReleaseMutex();$mutex.Dispose()}
