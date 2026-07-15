[CmdletBinding()]
param(
    [string]$Distro = "Ubuntu-24.04",
    [string]$StateDirectory = (Join-Path $env:LOCALAPPDATA "Codex\skincos")
)

$ErrorActionPreference = "Stop"
$wslPath = Join-Path $env:SystemRoot "System32\wsl.exe"
$pidPath = Join-Path $stateDirectory "wsl-runtime-keepalive.pid"

function Test-SkincosWslKeepaliveProcess {
    param(
        [Parameter(Mandatory)]
        [object]$Process,
        [Parameter(Mandatory)]
        [string]$ExpectedDistro
    )

    if ($Process.Name -ine "wsl.exe") {
        return $false
    }

    $commandLine = [string]$Process.CommandLine
    $distroPattern = [regex]::Escape($ExpectedDistro)
    return $commandLine -match ('(?i)(?:^|\s)-d\s+"?{0}(?:"?|\s)' -f $distroPattern) -and
        $commandLine -match "(?i)(?:^|\s)-u\s+root(?:\s|$)" -and
        $commandLine -match "(?i)/bin/sleep\s+infinity(?:\s|$)"
}

if (Test-Path -LiteralPath $pidPath) {
    $existingPid = (Get-Content -LiteralPath $pidPath -Raw -ErrorAction SilentlyContinue).Trim()
    if ($existingPid -match '^\d+$') {
        $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$existingPid" -ErrorAction SilentlyContinue
        if ($existingProcess -and (Test-SkincosWslKeepaliveProcess -Process $existingProcess -ExpectedDistro $Distro)) {
            exit 0
        }
    }

    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

# A prior launcher can have lost its PID file. Reuse only a verified WSL client;
# never treat a recycled Windows PID as proof that the runtime is still alive.
$existingKeepalive = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    Test-SkincosWslKeepaliveProcess -Process $_ -ExpectedDistro $Distro
} | Select-Object -First 1
if ($existingKeepalive) {
    New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
    Set-Content -LiteralPath $pidPath -Value $existingKeepalive.ProcessId -Encoding ascii
    exit 0
}

# Detach from Task Scheduler so the WSL client survives after this launcher exits.
$process = Start-Process `
    -FilePath $wslPath `
    -ArgumentList @("-d", $Distro, "-u", "root", "--", "/bin/sleep", "infinity") `
    -WindowStyle Hidden `
    -PassThru

New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null
Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
