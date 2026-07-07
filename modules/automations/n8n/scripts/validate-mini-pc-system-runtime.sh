#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/lib/runtime-paths.sh"

N8N_HEALTH_URL="${N8N_HEALTH_URL:-http://127.0.0.1:5678/healthz}"
ORB_PROXY_HEALTH_URL="${ORB_PROXY_HEALTH_URL:-http://127.0.0.1:8788/meta-review/healthz}"
ORB_PUBLIC_HEALTH_URL="${ORB_PUBLIC_HEALTH_URL:-https://orb.skincos.com.br/healthz}"
legacy_patterns=(
  "/home/julia"
  "/srv/skincos"
  "/etc/skincos"
  "systemctl --user"
)

check_url() {
  local label="$1"
  local url="$2"
  local attempts="${3:-5}"
  local sleep_seconds="${4:-3}"
  local attempt=1
  local output
  echo "== $label =="
  while (( attempt <= attempts )); do
    if output="$(curl -fsS --max-time 15 "$url" 2>&1)"; then
      printf '%s\n\n' "$output"
      return 0
    fi

    if (( attempt == attempts )); then
      printf '%s\n' "$output" >&2
      return 1
    fi

    printf 'retry %s/%s in %ss\n' "$attempt" "$attempts" "$sleep_seconds" >&2
    sleep "$sleep_seconds"
    ((attempt++))
  done
}

check_no_legacy_patterns() {
  local label="$1"
  shift
  local paths=("$@")
  local found=0
  local pattern

  for pattern in "${legacy_patterns[@]}"; do
    if grep -R -n -F "$pattern" "${paths[@]}" >/dev/null 2>&1; then
      echo "Legacy reference detected in $label: $pattern"
      grep -R -n -F "$pattern" "${paths[@]}" || true
      found=1
    fi
  done

  if [[ "$found" == "1" ]]; then
    exit 1
  fi
}

echo "== runtime files =="
for path in \
  "$N8N_ENV_FILE" \
  "$N8N_BUSINESS_ENV_FILE" \
  "$EVOLUTION_ENV_FILE" \
  "$CLOUDFLARED_HOME/orb-config.yml"; do
  if [[ ! -f "$path" ]]; then
    echo "Missing runtime file: $path"
    exit 1
  fi
  printf 'ok %s\n' "$path"
done

echo "== permissions =="
sudo -n -u skincos test -r "$N8N_ENV_FILE" && echo "skincos_can_read_n8n_env"
sudo -n -u skincos test -r "$N8N_BUSINESS_ENV_FILE" && echo "skincos_can_read_business_env"
sudo -n -u skincos test -r "$EVOLUTION_ENV_FILE" && echo "skincos_can_read_evolution_env"
sudo -n -u skincos test -w "$N8N_LOG_DIR" && echo "skincos_can_write_logs"
sudo -n -u skincos test -w "$N8N_BINARY_DATA_DIR" && echo "skincos_can_write_binary_data"
sudo -n -u skincos test -w "$N8N_TMP_DIR" && echo "skincos_can_write_tmp"

echo "== legacy path audit =="
check_no_legacy_patterns "runtime env files" \
  "$N8N_ENV_FILE" \
  "$N8N_BUSINESS_ENV_FILE" \
  "$EVOLUTION_ENV_FILE"
check_no_legacy_patterns "installed orb system units" \
  "/etc/systemd/system/$SKINCOS_N8N_SERVICE" \
  "/etc/systemd/system/$SKINCOS_ORB_PROXY_SERVICE" \
  "/etc/systemd/system/$SKINCOS_CLOUDFLARED_ORB_SERVICE" \
  "/etc/systemd/system/$SKINCOS_EVOLUTION_SERVICE" \
  "/etc/systemd/system/$SKINCOS_WATCHDOG_SERVICE" \
  "/etc/systemd/system/$SKINCOS_WATCHDOG_TIMER"

echo "== system services =="
sudo -n systemctl --no-pager --plain status \
  "$SKINCOS_N8N_SERVICE" \
  "$SKINCOS_ORB_PROXY_SERVICE" \
  "$SKINCOS_CLOUDFLARED_ORB_SERVICE" \
  "$SKINCOS_EVOLUTION_SERVICE" \
  "$SKINCOS_WATCHDOG_TIMER"

echo "== legacy blockers =="
if systemctl --user is-active --quiet n8n.service orb-proxy.service cloudflared-orb.service evolution-api.service mini-pc-watchdog.timer; then
  echo "Legacy systemctl --user services are still active."
  exit 1
fi
echo "legacy_user_services_inactive"

check_url "n8n local" "$N8N_HEALTH_URL"
check_url "orb-proxy local" "$ORB_PROXY_HEALTH_URL"
check_url "orb public" "$ORB_PUBLIC_HEALTH_URL"

echo "System runtime validation OK."
