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
Write-Host "[gateway] Iniciando gateway (Ctrl+C para parar)..." -ForegroundColor Cyan

$env:CLOUDFLARE_TUNNEL_TOKEN = $tunnelToken
$env:CRM_UNIT_MONITOR_PROXY_TOKEN = $proxyToken
$env:CRM_API_PORT = $apiPort
$env:PORT = $apiPort
$env:PATH = "$binDir;$env:PATH"

node (Join-Path $installDir "backend/tools/unit-monitor-gateway/run.mjs")

