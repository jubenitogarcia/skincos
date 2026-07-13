[CmdletBinding()]
param(
    [string]$Distro = "Ubuntu-24.04",
    [string]$BackupRoot = "C:\CodexRuntime\n8n\backups\wsl",
    [switch]$SkipExport
)

$ErrorActionPreference = "Stop"

function Invoke-WslRoot {
    param([Parameter(Mandatory = $true)][string]$Script)
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Script))
    & wsl.exe -d $Distro -u root -- bash -lc "echo '$encoded' | base64 -d | bash"
    if ($LASTEXITCODE -ne 0) {
        throw "WSL root command failed with exit code $LASTEXITCODE."
    }
}

$adminEntry = (& wsl.exe -d $Distro -u root -- getent passwd admin 2>$null)
$juliaEntry = (& wsl.exe -d $Distro -u root -- getent passwd julia 2>$null)
if ($adminEntry -and (Test-Path "\\wsl.localhost\$Distro\home\admin")) {
    Write-Host "WSL operator is already admin."
    exit 0
}
if (-not $juliaEntry -and -not $adminEntry) {
    throw "Neither julia nor admin exists in $Distro."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

Invoke-WslRoot -Script "systemctl stop skincos-mini-pc-watchdog.timer skincos-n8n.service skincos-orb-proxy.service skincos-cloudflared-orb.service skincos-evolution.service || true"
& wsl.exe --terminate $Distro
if ($LASTEXITCODE -ne 0) { throw "Could not terminate $Distro." }

if (-not $SkipExport) {
    $exportPath = Join-Path $BackupRoot "$Distro-before-admin-$stamp.tar"
    & wsl.exe --export $Distro $exportPath
    if ($LASTEXITCODE -ne 0) { throw "WSL export failed." }
    Write-Host "WSL rollback export: $exportPath"
}

$renameScript = @'
set -euo pipefail
if getent passwd julia >/dev/null; then
  loginctl terminate-user julia 2>/dev/null || true
  pkill -KILL -u julia 2>/dev/null || true
  sed -i -e 's/^julia:/admin:/' -e 's#:/home/julia:#:/home/admin:#' /etc/passwd
  sed -i 's/\bjulia\b/admin/g' /etc/group /etc/gshadow
  sed -i 's/^julia:/admin:/' /etc/shadow
fi
getent passwd admin >/dev/null
for account_file in /etc/subuid /etc/subgid; do
  if [[ -f "$account_file" ]]; then sed -i 's/^julia:/admin:/' "$account_file"; fi
done
if [[ -d /home/julia && ! -e /home/admin ]]; then mv /home/julia /home/admin; fi
if grep -q '^default=julia$' /etc/wsl.conf; then
  sed -i 's/^default=julia$/default=admin/' /etc/wsl.conf
elif ! grep -q '^default=admin$' /etc/wsl.conf; then
  printf '\n[user]\ndefault=admin\n' >> /etc/wsl.conf
fi
chown -R admin:admin /home/admin
'@
Invoke-WslRoot -Script $renameScript

& wsl.exe --terminate $Distro
if ($LASTEXITCODE -ne 0) { throw "Could not restart $Distro after migration." }

$whoami = (& wsl.exe -d $Distro -- whoami).Trim()
if ($whoami -ne "admin") { throw "WSL default user migration failed: $whoami" }

Invoke-WslRoot -Script "systemctl daemon-reload && systemctl start skincos-evolution.service skincos-n8n.service skincos-orb-proxy.service skincos-cloudflared-orb.service skincos-mini-pc-watchdog.timer"

Write-Host "WSL operator migration completed."
Write-Host "default_user=$whoami"
