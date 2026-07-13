[CmdletBinding()]
param(
    [string]$Distro = "Ubuntu-24.04",
    [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA "Codex\skincos")
)

$ErrorActionPreference = "Stop"
$wslPath = Join-Path $env:SystemRoot "System32\wsl.exe"
$pidPath = Join-Path $stateDirectory "wsl-runtime-keepalive.pid"

if (Test-Path -LiteralPath $pidPath) {
    $existingPid = (Get-Content -LiteralPath $pidPath -Raw -ErrorAction SilentlyContinue).Trim()
    if ($existingPid -match '^\d+$' -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
        exit 0
    }

    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

# Detach from Task Scheduler so the WSL client survives after this launcher exits.
$process = Start-Process `
    -FilePath $wslPath `
    -ArgumentList @("-d", $Distro, "-u", "root", "--", "/bin/sleep", "infinity") `
    -WindowStyle Hidden `
    -PassThru

New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
