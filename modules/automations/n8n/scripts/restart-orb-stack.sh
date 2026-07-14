#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  . "$ROOT_DIR/.env"
  set +a
fi

USER_ID="$(id -u)"
GUI_DOMAIN="gui/$USER_ID"
N8N_HEALTH_URL="${N8N_PROTOCOL:-http}://127.0.0.1:${N8N_PORT:-5678}/healthz"
ORB_PROXY_HEALTH_URL="http://${ORB_PROXY_LISTEN_ADDRESS:-127.0.0.1}:${ORB_PROXY_PORT:-8788}/meta-review/healthz"
ORB_PUBLIC_HEALTH_URL="${ORB_PUBLIC_HEALTH_URL:-https://orb.skincos.com.br/healthz}"
NETWORK_PROBE_URL="${NETWORK_PROBE_URL:-https://cp.cloudflare.com/generate_204}"
NETWORK_WAIT_TIMEOUT_SEC="${NETWORK_WAIT_TIMEOUT_SEC:-90}"
CURL_CONNECT_TIMEOUT_SEC="${CURL_CONNECT_TIMEOUT_SEC:-5}"
CURL_MAX_TIME_SEC="${CURL_MAX_TIME_SEC:-10}"
LAUNCHD_WAIT_TIMEOUT_SEC="${LAUNCHD_WAIT_TIMEOUT_SEC:-30}"
LAUNCHD_START_RETRIES="${LAUNCHD_START_RETRIES:-4}"
N8N_WAIT_TIMEOUT_SEC="${N8N_WAIT_TIMEOUT_SEC:-90}"
ORB_PROXY_WAIT_TIMEOUT_SEC="${ORB_PROXY_WAIT_TIMEOUT_SEC:-60}"
ORB_PUBLIC_WAIT_TIMEOUT_SEC="${ORB_PUBLIC_WAIT_TIMEOUT_SEC:-120}"
ORB_PUBLIC_RETRY_AFTER_RELOAD_SEC="${ORB_PUBLIC_RETRY_AFTER_RELOAD_SEC:-45}"

N8N_LABEL="com.jubenito.n8n-evolution"
ORB_PROXY_LABEL="com.skincos.orb-proxy"
ORB_TUNNEL_LABEL="com.skincos.cloudflared.orb"
N8N_PLIST="$HOME/Library/LaunchAgents/com.jubenito.n8n-evolution.plist"
ORB_PROXY_PLIST="$HOME/Library/LaunchAgents/com.skincos.orb-proxy.plist"
ORB_TUNNEL_PLIST="$HOME/Library/LaunchAgents/com.skincos.cloudflared.orb.plist"
ORB_TUNNEL_CONFIG="$HOME/.cloudflared/orb-config.yml"
ORB_TUNNEL_ERR_LOG="$HOME/.cloudflared/orb.launchd.err.log"
ORB_TUNNEL_OUT_LOG="$HOME/.cloudflared/orb.launchd.log"
N8N_OUT_LOG="$ROOT_DIR/launchd-n8n-evolution.out.log"
N8N_ERR_LOG="$ROOT_DIR/launchd-n8n-evolution.err.log"
ORB_PROXY_OUT_LOG="$ROOT_DIR/orb-proxy.launchd.out.log"
ORB_PROXY_ERR_LOG="$ROOT_DIR/orb-proxy.launchd.err.log"

curl_quiet() {
  local url="$1"
  local curl_args=(-fsS -o /dev/null --connect-timeout "$CURL_CONNECT_TIMEOUT_SEC" --max-time "$CURL_MAX_TIME_SEC")

  if [[ "$url" == https://* ]]; then
    curl_args+=(-k)
  fi

  curl "${curl_args[@]}" "$url" >/dev/null 2>&1
}

tail_if_exists() {
  local title="$1"
  local file="$2"
  local lines="${3:-20}"

  if [ -f "$file" ]; then
    echo ""
    echo "== $title ($file) =="
    tail -n "$lines" "$file" || true
  fi
}

print_launch_agent_summary() {
  local label="$1"
  local title="$2"

  echo ""
  echo "== launchd: $title ($label) =="
  if launchctl print "$GUI_DOMAIN/$label" >/dev/null 2>&1; then
    launchctl print "$GUI_DOMAIN/$label" 2>&1 \
      | sed -n '/state =/p;/pid =/p;/runs =/p;/last exit code =/p;/last terminating signal =/p;/path =/p' \
      || true
  else
    echo "nao carregado"
  fi
}

print_diagnostics() {
  echo ""
  echo "== diagnostico rapido =="
  date
  echo "URLs:"
  echo "  network: $NETWORK_PROBE_URL"
  echo "  n8n:     $N8N_HEALTH_URL"
  echo "  proxy:   $ORB_PROXY_HEALTH_URL"
  echo "  publico: $ORB_PUBLIC_HEALTH_URL"

  print_launch_agent_summary "$N8N_LABEL" "n8n"
  print_launch_agent_summary "$ORB_PROXY_LABEL" "orb-proxy"
  print_launch_agent_summary "$ORB_TUNNEL_LABEL" "cloudflared orb"

  echo ""
  echo "== processos e portas =="
  ps aux | grep -Ei "cloudflared|n8n start|orb-proxy/server.js" | grep -v grep || true
  lsof -nP -iTCP -sTCP:LISTEN | grep -E ":(5678|5679|8788|20241)\b" || true

  tail_if_exists "n8n stdout" "$N8N_OUT_LOG" 30
  tail_if_exists "n8n stderr" "$N8N_ERR_LOG" 30
  tail_if_exists "orb-proxy stdout" "$ORB_PROXY_OUT_LOG" 30
  tail_if_exists "orb-proxy stderr" "$ORB_PROXY_ERR_LOG" 30
  tail_if_exists "cloudflared orb stdout" "$ORB_TUNNEL_OUT_LOG" 40
  tail_if_exists "cloudflared orb stderr" "$ORB_TUNNEL_ERR_LOG" 40
}

fail_with_diagnostics() {
  local message="$1"
  echo "❌ $message"
  print_diagnostics
  exit 1
}

require_file() {
  local file="$1"
  local label="$2"

  if [ ! -f "$file" ]; then
    fail_with_diagnostics "$label nao encontrado: $file"
  fi
}

wait_for_network() {
  local timeout="${1:-$NETWORK_WAIT_TIMEOUT_SEC}"
  local waited=0

  echo "🌐 Aguardando rede: $NETWORK_PROBE_URL"
  until curl_quiet "$NETWORK_PROBE_URL"; do
    waited=$((waited + 1))
    if [ "$waited" -ge "$timeout" ]; then
      fail_with_diagnostics "Rede nao estabilizou em ${timeout}s."
    fi
    sleep 1
  done

  echo "✅ Rede respondeu: $NETWORK_PROBE_URL"
}

wait_for_launch_agent() {
  local label="$1"
  local name="$2"
  local timeout="${3:-$LAUNCHD_WAIT_TIMEOUT_SEC}"
  local waited=0

  until launchctl print "$GUI_DOMAIN/$label" >/dev/null 2>&1 \
    && launchctl print "$GUI_DOMAIN/$label" 2>/dev/null | grep -q "state = running"; do
    waited=$((waited + 1))
    if [ "$waited" -ge "$timeout" ]; then
      fail_with_diagnostics "LaunchAgent nao entrou em estado running para $name: $label"
    fi
    sleep 1
  done

  echo "✅ LaunchAgent rodando: $name"
}

kickstart_launch_agent() {
  local label="$1"
  local name="$2"
  local attempt=1

  while [ "$attempt" -le "$LAUNCHD_START_RETRIES" ]; do
    if launchctl kickstart -k "$GUI_DOMAIN/$label" >/dev/null 2>&1; then
      wait_for_launch_agent "$label" "$name"
      return 0
    fi

    echo "⚠️  $name ainda nao aceitou kickstart (tentativa $attempt/$LAUNCHD_START_RETRIES)."
    sleep "$attempt"
    attempt=$((attempt + 1))
  done

  fail_with_diagnostics "Falha ao iniciar $name apos $LAUNCHD_START_RETRIES tentativas."
}

restart_launch_agent() {
  local label="$1"
  local plist="$2"
  local name="$3"

  require_file "$plist" "LaunchAgent de $name"

  if launchctl print "$GUI_DOMAIN/$label" >/dev/null 2>&1; then
    echo "♻️ Reiniciando $name..."
    kickstart_launch_agent "$label" "$name"
    return 0
  fi

  echo "🚀 Carregando $name..."
  launchctl bootstrap "$GUI_DOMAIN" "$plist" >/dev/null 2>&1 || true
  kickstart_launch_agent "$label" "$name"
}

reload_launch_agent() {
  local label="$1"
  local plist="$2"
  local name="$3"

  require_file "$plist" "LaunchAgent de $name"

  if launchctl print "$GUI_DOMAIN/$label" >/dev/null 2>&1; then
    echo "♻️ Reiniciando $name..."
  else
    echo "🚀 Carregando $name..."
    launchctl bootstrap "$GUI_DOMAIN" "$plist" >/dev/null 2>&1 || true
  fi

  kickstart_launch_agent "$label" "$name"
}

wait_for_http() {
  local url="$1"
  local timeout="${2:-60}"
  local name="$3"
  local waited=0

  until curl_quiet "$url"; do
    waited=$((waited + 1))
    if [ "$waited" -ge "$timeout" ]; then
      echo "❌ Health check falhou para $name: $url"
      return 1
    fi
    sleep 1
  done

  echo "✅ $name respondeu: $url"
}

report_tunnel_failure() {
  echo "⚠️  O stack local voltou, mas o endpoint público ainda está offline."
  print_diagnostics
}

echo "🔁 Reiniciando stack do n8n/orb..."

require_file "$ORB_TUNNEL_CONFIG" "Config do tunnel orb"
wait_for_network "$NETWORK_WAIT_TIMEOUT_SEC"

restart_launch_agent \
  "$N8N_LABEL" \
  "$N8N_PLIST" \
  "n8n"

restart_launch_agent \
  "$ORB_PROXY_LABEL" \
  "$ORB_PROXY_PLIST" \
  "orb-proxy"

reload_launch_agent \
  "$ORB_TUNNEL_LABEL" \
  "$ORB_TUNNEL_PLIST" \
  "Cloudflare tunnel orb.skincos.com.br"

wait_for_http "$N8N_HEALTH_URL" "$N8N_WAIT_TIMEOUT_SEC" "n8n local" \
  || fail_with_diagnostics "n8n local nao ficou saudavel."
wait_for_http "$ORB_PROXY_HEALTH_URL" "$ORB_PROXY_WAIT_TIMEOUT_SEC" "orb-proxy local" \
  || fail_with_diagnostics "orb-proxy local nao ficou saudavel."

if ! wait_for_http "$ORB_PUBLIC_HEALTH_URL" "$ORB_PUBLIC_WAIT_TIMEOUT_SEC" "orb.skincos.com.br público"; then
  echo "⚠️  Endpoint público ainda falhou; recarregando tunnel mais uma vez."
  reload_launch_agent \
    "$ORB_TUNNEL_LABEL" \
    "$ORB_TUNNEL_PLIST" \
    "Cloudflare tunnel orb.skincos.com.br"

  if ! wait_for_http "$ORB_PUBLIC_HEALTH_URL" "$ORB_PUBLIC_RETRY_AFTER_RELOAD_SEC" "orb.skincos.com.br público"; then
    report_tunnel_failure
    exit 1
  fi
fi

print_launch_agent_summary "$N8N_LABEL" "n8n"
print_launch_agent_summary "$ORB_PROXY_LABEL" "orb-proxy"
print_launch_agent_summary "$ORB_TUNNEL_LABEL" "cloudflared orb"
echo "🎯 Stack pronta para uso."
