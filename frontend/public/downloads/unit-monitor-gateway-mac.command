#!/usr/bin/env bash
set -euo pipefail

banner() {
  cat <<'EOF'
===========================================================
 Skincos — Unit Monitor Gateway (macOS)
===========================================================

Este instalador vai:
  1) Checar/instalar dependências (Homebrew + Node + ffmpeg + mediamtx + cloudflared)
  2) Baixar/atualizar o gateway (repo skincos)
  3) Iniciar o gateway na sua LAN (API + MediaMTX + Tunnel)

EOF
}

prompt() {
  local label="$1"
  local def="${2:-}"
  local out
  if [[ -n "$def" ]]; then
    read -r -p "$label [$def]: " out
    echo "${out:-$def}"
  else
    read -r -p "$label: " out
    echo "$out"
  fi
}

prompt_secret() {
  local label="$1"
  local out
  read -r -s -p "$label: " out
  echo
  echo "$out"
}

confirm() {
  local label="$1"
  local def="${2:-N}"
  local out
  read -r -p "$label (y/N): " out
  out="${out:-$def}"
  [[ "$out" == "y" || "$out" == "Y" ]]
}

install_launchagent() {
  local label="com.skincos.unit-monitor-gateway"
  local cfg_dir="$HOME/.skincos/unit-monitor-gateway"
  local plist="$HOME/Library/LaunchAgents/${label}.plist"
  local env_file="$cfg_dir/gateway.env"
  local start_sh="$cfg_dir/start.sh"
  local log_out="$cfg_dir/gateway.out.log"
  local log_err="$cfg_dir/gateway.err.log"

  mkdir -p "$cfg_dir"
  chmod 700 "$cfg_dir" || true

  cat >"$env_file" <<EOF
CLOUDFLARE_TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
CRM_UNIT_MONITOR_PROXY_TOKEN=${CRM_UNIT_MONITOR_PROXY_TOKEN}
CRM_API_PORT=${CRM_API_PORT}
PORT=${PORT}
EOF
  chmod 600 "$env_file" || true

  cat >"$start_sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

CFG_DIR="$HOME/.skincos/unit-monitor-gateway"
ENV_FILE="$CFG_DIR/gateway.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

INSTALL_DIR="${SKINCOS_GATEWAY_DIR:-$HOME/skincos-unit-monitor-gateway}"
cd "$INSTALL_DIR"
exec node "backend/tools/unit-monitor-gateway/run.mjs"
EOF
  chmod +x "$start_sh"

  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${start_sh}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log_out}</string>
  <key>StandardErrorPath</key><string>${log_err}</string>
</dict>
</plist>
EOF

  # Best-effort reload. Different macOS versions support different subcommands.
  launchctl unload "$plist" >/dev/null 2>&1 || true
  launchctl load "$plist" >/dev/null 2>&1 || true
  launchctl start "$label" >/dev/null 2>&1 || true

  echo
  echo "[gateway] Instalado como serviço (LaunchAgent): $label"
  echo "[gateway] Logs:"
  echo "  $log_out"
  echo "  $log_err"
}

ensure_cmd() {
  local cmd="$1"
  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi
  echo "[gateway] Falta: $cmd" >&2
  return 1
}

ensure_brew() {
  if command -v brew >/dev/null 2>&1; then
    return 0
  fi
  echo "[gateway] Homebrew não encontrado."
  echo "Instale em: https://brew.sh/"
  if confirm "Deseja tentar instalar o Homebrew agora?"; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
  command -v brew >/dev/null 2>&1 || { echo "[gateway] Homebrew ainda não disponível. Abortando." >&2; exit 2; }
}

brew_install_if_missing() {
  local formula="$1"
  local cmd="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    return 0
  fi
  echo "[gateway] Instalando $formula..."
  brew install "$formula"
  command -v "$cmd" >/dev/null 2>&1 || { echo "[gateway] Falha ao instalar $formula (comando $cmd não encontrado)." >&2; exit 2; }
}

brew_install_mediamtx() {
  if command -v mediamtx >/dev/null 2>&1; then return 0; fi
  echo "[gateway] Instalando mediamtx..."
  if brew install bluenviron/mediamtx/mediamtx >/dev/null 2>&1; then
    true
  elif brew install mediamtx >/dev/null 2>&1; then
    true
  else
    echo "[gateway] Não consegui instalar mediamtx via brew." >&2
    echo "Instale manualmente: https://github.com/bluenviron/mediamtx" >&2
    exit 2
  fi
  command -v mediamtx >/dev/null 2>&1 || { echo "[gateway] mediamtx ainda não disponível no PATH." >&2; exit 2; }
}

main() {
  banner

  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "[gateway] Este instalador é apenas para macOS." >&2
    exit 2
  fi

  local default_dir="$HOME/skincos-unit-monitor-gateway"
  local install_dir
  install_dir="$(prompt "Diretório para instalar/atualizar o gateway" "$default_dir")"

  local api_port
  api_port="$(prompt "Porta local do gateway (CRM API)" "8099")"

  local public_url
  public_url="$(prompt "URL pública do gateway (hostname do Tunnel, ex: https://unit-monitor-gw.seudominio.com)" "")"
  while [[ -z "${public_url// }" ]]; do
    echo "[gateway] A URL pública é obrigatória (será usada no Cloudflare Pages como UNIT_MONITOR_API_TARGET)." >&2
    public_url="$(prompt "URL pública do gateway (hostname do Tunnel, ex: https://unit-monitor-gw.seudominio.com)" "")"
  done

  local tunnel_token
  tunnel_token="$(prompt_secret "Cole o CLOUDFLARE_TUNNEL_TOKEN (Cloudflare Zero Trust)")"
  if [[ -z "$tunnel_token" ]]; then
    echo "[gateway] CLOUDFLARE_TUNNEL_TOKEN é obrigatório." >&2
    exit 2
  fi

  local proxy_token
  proxy_token="$(prompt "CRM_UNIT_MONITOR_PROXY_TOKEN (enter para gerar)" "")"
  if [[ -z "$proxy_token" ]]; then
    if command -v openssl >/dev/null 2>&1; then
      proxy_token="$(openssl rand -hex 16)"
    elif command -v uuidgen >/dev/null 2>&1; then
      proxy_token="$(uuidgen | tr '[:upper:]' '[:lower:]' | tr -d '-')"
    else
      proxy_token="$(date +%s)_$RANDOM"
    fi
  fi

  echo
  echo "[gateway] Preparando dependências..."
  ensure_brew

  # Git (Xcode CLI tools)
  if ! command -v git >/dev/null 2>&1; then
    echo "[gateway] Git não encontrado. Instale o Xcode Command Line Tools:" >&2
    echo "  xcode-select --install" >&2
    exit 2
  fi

  brew_install_if_missing node node
  brew_install_if_missing ffmpeg ffmpeg
  command -v ffprobe >/dev/null 2>&1 || { echo "[gateway] ffprobe não encontrado (deveria vir com ffmpeg)." >&2; exit 2; }
  brew_install_mediamtx
  brew_install_if_missing cloudflare/cloudflare/cloudflared cloudflared

  echo
  echo "[gateway] Baixando/atualizando o gateway..."
  if [[ -d "$install_dir/.git" ]]; then
    git -C "$install_dir" pull --ff-only
  else
    rm -rf "$install_dir"
    git clone --depth 1 https://github.com/jubenitogarcia/skincos.git "$install_dir"
  fi

  echo
  echo "[gateway] Instalando deps do crm-api..."
  npm --prefix "$install_dir/backend/apps/crm-api" install --no-fund --no-audit

  echo
  echo "==========================================================="
  echo " Configure no Cloudflare Pages (CRM online):"
  echo "   UNIT_MONITOR_API_TARGET=$public_url"
  echo "   UNIT_MONITOR_PROXY_TOKEN=$proxy_token"
  echo "==========================================================="
  echo
  export CLOUDFLARE_TUNNEL_TOKEN="$tunnel_token"
  export CRM_UNIT_MONITOR_PROXY_TOKEN="$proxy_token"
  export CRM_API_PORT="$api_port"
  export PORT="$api_port"
  export SKINCOS_GATEWAY_DIR="$install_dir"

  if confirm "Deseja instalar como serviço (iniciar automaticamente ao ligar o Mac)?" "Y"; then
    install_launchagent
    echo
    echo "[gateway] Serviço instalado. Você pode fechar esta janela."
    exit 0
  fi

  echo "[gateway] Iniciando gateway (Ctrl+C para parar)..."
  exec node "$install_dir/backend/tools/unit-monitor-gateway/run.mjs"
}

main "$@"
