$ErrorActionPreference = "Stop"

function Write-Banner {
@"
===========================================================
 Skincos — Unit Monitor Gateway (Windows)
===========================================================

Este instalador vai:
  1) Checar dependências (Node, Git, ffmpeg, mediamtx, cloudflared)
  2) Baixar/atualizar o gateway (repo skincos)
  3) Iniciar o gateway na sua LAN (API + MediaMTX + Tunnel)

"@ | Write-Host
}

function Prompt-Default([string]$Label, [string]$DefaultValue) {
  $v = Read-Host "$Label [$DefaultValue]"
  if ([string]::IsNullOrWhiteSpace($v)) { return $DefaultValue }
  return $v
}

function Prompt-Required([string]$Label) {
  while ($true) {
    $v = Read-Host $Label
    if (-not [string]::IsNullOrWhiteSpace($v)) { return $v }
    Write-Host "Campo obrigatório." -ForegroundColor Yellow
  }
}

function Prompt-Secret([string]$Label) {
  $s = Read-Host -AsSecureString $Label
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Has-Command([string]$Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-Winget {
  if (Has-Command "winget") { return }
  throw "winget não encontrado. Instale o App Installer (Microsoft Store) e tente novamente."
}

function Ensure-MediaMTX([string]$BinDir) {
  if (Has-Command "mediamtx") { return }
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

  Write-Host "[gateway] Baixando mediamtx (Windows amd64)..." -ForegroundColor Cyan
  $release = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/bluenviron/mediamtx/releases/latest"
  $asset = $release.assets | Where-Object { $_.name -match "windows_amd64.*\\.zip$" } | Select-Object -First 1
  if (-not $asset) { throw "Não encontrei asset windows_amd64.zip do mediamtx." }

  $zipPath = Join-Path $BinDir $asset.name
  Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $zipPath
  Expand-Archive -Force -Path $zipPath -DestinationPath $BinDir

  Remove-Item -Force $zipPath -ErrorAction SilentlyContinue

  $env:PATH = "$BinDir;$env:PATH"
  if (-not (Has-Command "mediamtx")) {
    throw "mediamtx não ficou disponível no PATH. Verifique $BinDir."
  }
}

function Ensure-Repo([string]$InstallDir) {
  if (Test-Path (Join-Path $InstallDir ".git")) {
    Write-Host "[gateway] Atualizando repo..." -ForegroundColor Cyan
    git -C $InstallDir pull --ff-only | Out-Host
    return
  }

  if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
  }
  Write-Host "[gateway] Clonando repo..." -ForegroundColor Cyan
  git clone --depth 1 https://github.com/jubenitogarcia/skincos.git $InstallDir | Out-Host
}

function Confirm([string]$Label, [string]$DefaultYes = "Y") {
  $v = Read-Host "$Label (y/N)"
  if ([string]::IsNullOrWhiteSpace($v)) { $v = $DefaultYes }
  return ($v -eq "y" -or $v -eq "Y")
}

function Install-Autostart([string]$InstallDir, [string]$BinDir, [string]$ApiPort, [string]$TunnelToken, [string]$ProxyToken) {
  $cfgDir = Join-Path $env:USERPROFILE ".skincos\\unit-monitor-gateway"
  New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null

  $envFile = Join-Path $cfgDir "gateway.env"
  $nodePath = (Get-Command node).Source
  $startPs1 = Join-Path $cfgDir "start.ps1"
  $outLog = Join-Path $cfgDir "gateway.out.log"
  $errLog = Join-Path $cfgDir "gateway.err.log"

  @"
CLOUDFLARE_TUNNEL_TOKEN=$TunnelToken
CRM_UNIT_MONITOR_PROXY_TOKEN=$ProxyToken
CRM_API_PORT=$ApiPort
PORT=$ApiPort
SKINCOS_GATEWAY_DIR=$InstallDir
GATEWAY_BIN_DIR=$BinDir
NODE_BIN=$nodePath
"@ | Set-Content -Encoding UTF8 -Path $envFile

  # Best effort: restrict file permissions to current user.
  try {
    $user = "$env:USERDOMAIN\\$env:USERNAME"
    icacls $cfgDir /inheritance:r /grant:r "$user:(OI)(CI)F" | Out-Null
    icacls $envFile /inheritance:r /grant:r "$user:F" | Out-Null
  } catch {}

  @'
$ErrorActionPreference = "Stop"

function Read-EnvFile([string]$Path) {
  if (-not (Test-Path $Path)) { return @{} }
  $map = @{}
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if ([string]::IsNullOrWhiteSpace($line)) { return }
    if ($line.StartsWith("#")) { return }
    $idx = $line.IndexOf("=")
    if ($idx -lt 1) { return }
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1)
    $map[$k] = $v
  }
  return $map
}

$cfgDir = Join-Path $env:USERPROFILE ".skincos\\unit-monitor-gateway"
$envFile = Join-Path $cfgDir "gateway.env"
$outLog = Join-Path $cfgDir "gateway.out.log"
$errLog = Join-Path $cfgDir "gateway.err.log"

$vars = Read-EnvFile $envFile
foreach ($k in $vars.Keys) { $env:$k = $vars[$k] }

$port = [int]($env:CRM_API_PORT)
try {
  $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$port/health"
  if ($health.StatusCode -ge 200 -and $health.StatusCode -lt 300) { exit 0 }
} catch {}

$binDir = $env:GATEWAY_BIN_DIR
if (-not [string]::IsNullOrWhiteSpace($binDir)) { $env:PATH = "$binDir;$env:PATH" }

$node = $env:NODE_BIN
if ([string]::IsNullOrWhiteSpace($node)) { $node = "node" }

$repo = $env:SKINCOS_GATEWAY_DIR
if ([string]::IsNullOrWhiteSpace($repo)) { $repo = Join-Path $env:USERPROFILE "skincos-unit-monitor-gateway" }

$runner = Join-Path $repo "backend\\tools\\unit-monitor-gateway\\run.mjs"
if (-not (Test-Path $runner)) { throw "Gateway runner not found: $runner" }

Start-Process -WindowStyle Hidden -FilePath $node -WorkingDirectory $repo -ArgumentList @($runner) -RedirectStandardOutput $outLog -RedirectStandardError $errLog
'@ | Set-Content -Encoding UTF8 -Path $startPs1

  $startupDir = Join-Path $env:APPDATA "Microsoft\\Windows\\Start Menu\\Programs\\Startup"
  $cmdPath = Join-Path $startupDir "skincos-unit-monitor-gateway.cmd"
  $cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startPs1`""
  "@echo off`r`n$cmd`r`n" | Set-Content -Encoding ASCII -Path $cmdPath

  # Start now (hidden)
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $startPs1

  Write-Host ""
  Write-Host "[gateway] Auto-start instalado (Startup): $cmdPath" -ForegroundColor Green
  Write-Host "[gateway] Logs:" -ForegroundColor Green
  Write-Host "  $outLog"
  Write-Host "  $errLog"
}

Write-Banner

$installDirDefault = Join-Path $env:USERPROFILE "skincos-unit-monitor-gateway"
$installDir = Prompt-Default "Diretório para instalar/atualizar o gateway" $installDirDefault
$apiPort = Prompt-Default "Porta local do gateway (CRM API)" "8099"
$publicUrl = Prompt-Required "URL pública do gateway (hostname do Tunnel, ex: https://unit-monitor-gw.seudominio.com)"
$tunnelToken = Prompt-Secret "Cole o CLOUDFLARE_TUNNEL_TOKEN (Cloudflare Zero Trust)"
if ([string]::IsNullOrWhiteSpace($tunnelToken)) { throw "CLOUDFLARE_TUNNEL_TOKEN é obrigatório." }
$proxyToken = Read-Host "CRM_UNIT_MONITOR_PROXY_TOKEN (enter para gerar)"
if ([string]::IsNullOrWhiteSpace($proxyToken)) { $proxyToken = ([guid]::NewGuid().ToString("N")) }

Write-Host ""
Write-Host "[gateway] Dependências..." -ForegroundColor Cyan
Ensure-Winget

if (-not (Has-Command "git")) {
  Write-Host "[gateway] Instalando Git..." -ForegroundColor Cyan
  winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements | Out-Host
}

if (-not (Has-Command "node")) {
  Write-Host "[gateway] Instalando Node.js LTS..." -ForegroundColor Cyan
  winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements | Out-Host
}

if (-not (Has-Command "cloudflared")) {
  Write-Host "[gateway] Instalando cloudflared..." -ForegroundColor Cyan
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements | Out-Host
}

if (-not (Has-Command "ffmpeg")) {
  Write-Host "[gateway] Instalando ffmpeg..." -ForegroundColor Cyan
  winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements | Out-Host
}

$binDir = Join-Path $installDir "bin"
Ensure-MediaMTX $binDir

Write-Host ""
Write-Host "[gateway] Baixando/atualizando gateway..." -ForegroundColor Cyan
Ensure-Repo $installDir

Write-Host ""
Write-Host "[gateway] Instalando deps do crm-api..." -ForegroundColor Cyan
npm --prefix (Join-Path $installDir "backend/apps/crm-api") install --no-fund --no-audit | Out-Host

Write-Host ""
Write-Host "==========================================================="
Write-Host " Configure no Cloudflare Pages (CRM online):"
Write-Host "   UNIT_MONITOR_API_TARGET=$publicUrl"
Write-Host "   UNIT_MONITOR_PROXY_TOKEN=$proxyToken"
Write-Host "==========================================================="
Write-Host ""

if (Confirm "Deseja instalar para iniciar automaticamente ao ligar o Windows?" "Y") {
  Install-Autostart -InstallDir $installDir -BinDir $binDir -ApiPort $apiPort -TunnelToken $tunnelToken -ProxyToken $proxyToken
  Write-Host ""
  Write-Host "[gateway] Serviço instalado. Você pode fechar esta janela." -ForegroundColor Green
  exit 0
}

Write-Host "[gateway] Iniciando gateway (Ctrl+C para parar)..." -ForegroundColor Cyan

$env:CLOUDFLARE_TUNNEL_TOKEN = $tunnelToken
$env:CRM_UNIT_MONITOR_PROXY_TOKEN = $proxyToken
$env:CRM_API_PORT = $apiPort
$env:PORT = $apiPort
$env:PATH = "$binDir;$env:PATH"

node (Join-Path $installDir "backend/tools/unit-monitor-gateway/run.mjs")
