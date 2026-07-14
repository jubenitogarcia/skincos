[CmdletBinding()]
param(
    [ValidateSet("Install", "Uninstall")]
    [string]$Mode = "Install",
    [string]$Distro = "Ubuntu-24.04",
    [ValidateRange(60000, 2147483647)]
    [int]$VmIdleTimeoutMilliseconds = 300000
)

$ErrorActionPreference = "Stop"
$taskName = "SkincosWslRuntimeKeepalive"
$wslConfigPath = Join-Path $env:USERPROFILE ".wslconfig"
$hiddenLauncherPath = Join-Path $PSScriptRoot "start-wsl-runtime-keepalive-hidden.vbs"
$wscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"
$stateDirectory = Join-Path $env:LOCALAPPDATA "Codex\skincos"
$pidPath = Join-Path $stateDirectory "wsl-runtime-keepalive.pid"
$legacyStartupPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\start-orb-stack-wsl.cmd"
if ($Mode -eq "Uninstall") {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process | Where-Object {
        $_.Name -ieq "wsl.exe" -and
        $_.CommandLine -match [regex]::Escape("-d $Distro") -and
        $_.CommandLine -match [regex]::Escape("/bin/sleep infinity")
    } | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    Write-Host "Removed $taskName."
    exit 0
}

if (-not (Test-Path -LiteralPath $wscriptPath)) {
    throw "wscript.exe is required to run the WSL keepalive without a visible console: $wscriptPath"
}
if (-not (Test-Path -LiteralPath $hiddenLauncherPath)) {
    throw "Hidden WSL keepalive launcher not found: $hiddenLauncherPath"
}

$userId = "$env:USERDOMAIN\$env:USERNAME"
# wscript.exe is a GUI host, so the recurring task never creates a visible console.
# The helper only rearms the WSL client if Windows terminates it during a transition.
$action = New-ScheduledTaskAction `
    -Execute $wscriptPath `
    -Argument "`"$hiddenLauncherPath`" `"$Distro`" `"$stateDirectory`""
$heartbeatStart = (Get-Date).AddMinutes(1)
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $userId),
    (New-ScheduledTaskTrigger `
        -Once `
        -At $heartbeatStart `
        -RepetitionInterval (New-TimeSpan -Minutes 1) `
        -RepetitionDuration (New-TimeSpan -Days 365))
)
$taskPrincipal = New-ScheduledTaskPrincipal `
    -UserId $userId `
    -LogonType Interactive `
    -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $triggers `
    -Principal $taskPrincipal `
    -Settings $settings `
    -Description "Keeps the Skincos Ubuntu runtime alive for systemd services." `
    -Force | Out-Null

if (Test-Path -LiteralPath $legacyStartupPath) {
    $legacyContent = Get-Content -LiteralPath $legacyStartupPath -Raw
    if ($legacyContent -match '(?i)orb-stack-supervisor\.ps1') {
        Remove-Item -LiteralPath $legacyStartupPath -Force
        Write-Host "Removed legacy OrbStack Startup launcher: $legacyStartupPath"
    }
    else {
        Write-Warning "Startup launcher was not removed because it no longer matches the known OrbStack supervisor signature: $legacyStartupPath"
    }
}

$wslConfig = "[wsl2]`r`nvmIdleTimeout=$VmIdleTimeoutMilliseconds`r`n"
Set-Content -LiteralPath $wslConfigPath -Value $wslConfig -Encoding ascii
Start-ScheduledTask -TaskName $taskName

Write-Host "Installed and started $taskName for $userId ($Distro); vmIdleTimeout=$VmIdleTimeoutMilliseconds."
