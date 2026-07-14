#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/shared-paths.sh"

HEALTH_DIR="$N8N_HEALTH_DIR"
STATE_FILE="$HEALTH_DIR/network-fallback.state"

NETWORK_FALLBACK_ENABLED="${NETWORK_FALLBACK_ENABLED:-true}"
NETWORK_FALLBACK_CHECK_INTERVAL_SEC="${NETWORK_FALLBACK_CHECK_INTERVAL_SEC:-30}"
NETWORK_FALLBACK_PROBE_URL="${NETWORK_FALLBACK_PROBE_URL:-https://cp.cloudflare.com/generate_204}"
NETWORK_FALLBACK_PROBE_TIMEOUT_SEC="${NETWORK_FALLBACK_PROBE_TIMEOUT_SEC:-6}"
NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC="${NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC:-120}"
NETWORK_FALLBACK_SSIDS="${NETWORK_FALLBACK_SSIDS:-}"
NETWORK_FALLBACK_WIFI_INTERFACE="${NETWORK_FALLBACK_WIFI_INTERFACE:-}"
NETWORK_FALLBACK_AUTO_DETECT_IPHONE="${NETWORK_FALLBACK_AUTO_DETECT_IPHONE:-true}"
NETWORK_FALLBACK_AUTO_PATTERN="${NETWORK_FALLBACK_AUTO_PATTERN:-iPhone,Hotspot,Android,Galaxy,Pixel}"
NETWORK_FALLBACK_PRIMARY_SSID="${NETWORK_FALLBACK_PRIMARY_SSID:-}"
NETWORK_FALLBACK_PRIMARY_PASSWORD="${NETWORK_FALLBACK_PRIMARY_PASSWORD:-}"

mkdir -p "$HEALTH_DIR"

to_bool() {
  local value="${1:-false}"
  value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

sanitize_int() {
  local value="${1:-}" default_value="${2:-0}"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "$value"
  else
    echo "$default_value"
  fi
}

trim() {
  local input="${1:-}"
  input="${input#"${input%%[![:space:]]*}"}"
  input="${input%"${input##*[![:space:]]}"}"
  printf '%s' "$input"
}

log_warn() {
  printf '%s [network-fallback][WARN] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

log_error() {
  printf '%s [network-fallback][ERROR] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

NETWORK_FALLBACK_CHECK_INTERVAL_SEC="$(sanitize_int "$NETWORK_FALLBACK_CHECK_INTERVAL_SEC" "30")"
NETWORK_FALLBACK_PROBE_TIMEOUT_SEC="$(sanitize_int "$NETWORK_FALLBACK_PROBE_TIMEOUT_SEC" "6")"
NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC="$(sanitize_int "$NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC" "120")"

if (( NETWORK_FALLBACK_CHECK_INTERVAL_SEC < 10 )); then
  NETWORK_FALLBACK_CHECK_INTERVAL_SEC=10
fi
if (( NETWORK_FALLBACK_PROBE_TIMEOUT_SEC < 2 )); then
  NETWORK_FALLBACK_PROBE_TIMEOUT_SEC=2
fi
if (( NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC < 30 )); then
  NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC=30
fi

detect_wifi_interface() {
  if [[ -n "$NETWORK_FALLBACK_WIFI_INTERFACE" ]]; then
    printf '%s' "$NETWORK_FALLBACK_WIFI_INTERFACE"
    return 0
  fi

  /usr/sbin/networksetup -listallhardwareports 2>/dev/null \
    | awk '/Hardware Port: Wi-Fi/{getline; if($1=="Device:"){print $2; exit}}'
}

current_ssid() {
  local iface="$1"
  local output
  output="$(/usr/sbin/networksetup -getairportnetwork "$iface" 2>/dev/null || true)"
  if printf '%s' "$output" | grep -qi "not associated"; then
    return 0
  fi
  if [[ "$output" == *": "* ]]; then
    printf '%s' "${output#*: }"
  fi
}

internet_ok() {
  /usr/bin/curl -fsS -m "$NETWORK_FALLBACK_PROBE_TIMEOUT_SEC" -o /dev/null "$NETWORK_FALLBACK_PROBE_URL"
}

append_unique_candidate() {
  local candidate="$1"
  if [[ -z "$candidate" ]]; then
    return 0
  fi
  local existing
  for existing in "${CANDIDATE_SSIDS[@]:-}"; do
    if [[ "$existing" == "$candidate" ]]; then
      return 0
    fi
  done
  CANDIDATE_SSIDS+=("$candidate")
}

build_candidates() {
  local iface="$1"
  local pattern_regex
  pattern_regex="$(printf '%s' "$NETWORK_FALLBACK_AUTO_PATTERN" | tr ',' '|')"
  CANDIDATE_SSIDS=()

  if [[ -n "$NETWORK_FALLBACK_PRIMARY_SSID" ]]; then
    append_unique_candidate "$(trim "$NETWORK_FALLBACK_PRIMARY_SSID")"
  fi

  local token
  IFS=',;' read -r -a manual_tokens <<<"$NETWORK_FALLBACK_SSIDS"
  for token in "${manual_tokens[@]:-}"; do
    append_unique_candidate "$(trim "$token")"
  done

  if to_bool "$NETWORK_FALLBACK_AUTO_DETECT_IPHONE"; then
    local preferred_ssid
    while IFS= read -r preferred_ssid; do
      preferred_ssid="$(trim "$preferred_ssid")"
      if [[ -n "$preferred_ssid" ]] && printf '%s' "$preferred_ssid" | /usr/bin/grep -Eiq "$pattern_regex"; then
        append_unique_candidate "$preferred_ssid"
      fi
    done < <(/usr/sbin/networksetup -listpreferredwirelessnetworks "$iface" 2>/dev/null | tail -n +2)
  fi
}

connect_to_ssid() {
  local iface="$1"
  local ssid="$2"
  /usr/sbin/networksetup -setairportpower "$iface" on >/dev/null 2>&1 || true
  if [[ -n "$NETWORK_FALLBACK_PRIMARY_SSID" ]] \
    && [[ "$ssid" == "$NETWORK_FALLBACK_PRIMARY_SSID" ]] \
    && [[ -n "$NETWORK_FALLBACK_PRIMARY_PASSWORD" ]]; then
    /usr/sbin/networksetup -setairportnetwork "$iface" "$ssid" "$NETWORK_FALLBACK_PRIMARY_PASSWORD" >/dev/null 2>&1
  else
    /usr/sbin/networksetup -setairportnetwork "$iface" "$ssid" >/dev/null 2>&1
  fi
}

persist_state() {
  local status="$1"
  local iface="$2"
  local ssid="$3"
  local candidate_count="$4"
  local message="$5"
  local now_epoch
  now_epoch="$(date +%s)"
  cat >"$STATE_FILE" <<EOF
timestamp=$(date '+%Y-%m-%d %H:%M:%S')
epoch=${now_epoch}
status=${status}
interface=${iface}
current_ssid=${ssid}
candidate_count=${candidate_count}
last_switch_epoch=${LAST_SWITCH_EPOCH}
check_interval_sec=${NETWORK_FALLBACK_CHECK_INTERVAL_SEC}
probe_url=${NETWORK_FALLBACK_PROBE_URL}
message=${message}
EOF
}

LAST_SWITCH_EPOCH="$(grep -E '^last_switch_epoch=' "$STATE_FILE" 2>/dev/null | head -n1 | cut -d= -f2- || true)"
LAST_SWITCH_EPOCH="$(sanitize_int "$LAST_SWITCH_EPOCH" "0")"
LAST_FAILURE_LOG_EPOCH=0
OFFLINE_NOTIFIED=false
NO_CANDIDATE_NOTIFIED=false

while true; do
  if ! to_bool "$NETWORK_FALLBACK_ENABLED"; then
    persist_state "disabled" "-" "-" "0" "network_fallback_disabled"
    sleep 60
    continue
  fi

  WIFI_IFACE="$(detect_wifi_interface || true)"
  if [[ -z "$WIFI_IFACE" ]]; then
    log_error "Interface Wi-Fi não encontrada."
    persist_state "error" "-" "-" "0" "wifi_interface_not_found"
    sleep "$NETWORK_FALLBACK_CHECK_INTERVAL_SEC"
    continue
  fi

  ACTIVE_SSID="$(current_ssid "$WIFI_IFACE" || true)"

  if internet_ok; then
    OFFLINE_NOTIFIED=false
    NO_CANDIDATE_NOTIFIED=false
    persist_state "online" "$WIFI_IFACE" "${ACTIVE_SSID:-none}" "0" "internet_ok"
    sleep "$NETWORK_FALLBACK_CHECK_INTERVAL_SEC"
    continue
  fi

  if [[ "$OFFLINE_NOTIFIED" != "true" ]]; then
    log_warn "Sem internet na interface ${WIFI_IFACE} (SSID: ${ACTIVE_SSID:-none}). Tentando fallback."
    OFFLINE_NOTIFIED=true
  fi

  NOW_EPOCH="$(date +%s)"
  if (( NOW_EPOCH - LAST_SWITCH_EPOCH < NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC )); then
    persist_state "offline_cooldown" "$WIFI_IFACE" "${ACTIVE_SSID:-none}" "0" "cooldown_active"
    sleep "$NETWORK_FALLBACK_CHECK_INTERVAL_SEC"
    continue
  fi

  build_candidates "$WIFI_IFACE"
  CANDIDATE_COUNT="${#CANDIDATE_SSIDS[@]}"
  if (( CANDIDATE_COUNT == 0 )); then
    if [[ "$NO_CANDIDATE_NOTIFIED" != "true" ]]; then
      log_error "Sem SSID candidato para fallback. Defina NETWORK_FALLBACK_SSIDS no $N8N_ENV."
      NO_CANDIDATE_NOTIFIED=true
    fi
    persist_state "offline_no_candidate" "$WIFI_IFACE" "${ACTIVE_SSID:-none}" "$CANDIDATE_COUNT" "no_candidate_ssids"
    sleep "$NETWORK_FALLBACK_CHECK_INTERVAL_SEC"
    continue
  fi

  NO_CANDIDATE_NOTIFIED=false
  CONNECTED=false
  TARGET_SSID=""
  for TARGET_SSID in "${CANDIDATE_SSIDS[@]}"; do
    if connect_to_ssid "$WIFI_IFACE" "$TARGET_SSID"; then
      sleep 4
      ACTIVE_SSID="$(current_ssid "$WIFI_IFACE" || true)"
      if internet_ok; then
        LAST_SWITCH_EPOCH="$(date +%s)"
        OFFLINE_NOTIFIED=false
        LAST_FAILURE_LOG_EPOCH=0
        log_warn "Fallback de internet ativo em '${ACTIVE_SSID:-$TARGET_SSID}'."
        persist_state "fallback_connected" "$WIFI_IFACE" "${ACTIVE_SSID:-$TARGET_SSID}" "$CANDIDATE_COUNT" "fallback_ok"
        CONNECTED=true
        break
      fi
    fi
  done

  if [[ "$CONNECTED" != "true" ]]; then
    if (( NOW_EPOCH - LAST_FAILURE_LOG_EPOCH >= NETWORK_FALLBACK_SWITCH_COOLDOWN_SEC )); then
      log_error "Falha ao recuperar internet via fallback (tentativas=${CANDIDATE_COUNT})."
      LAST_FAILURE_LOG_EPOCH="$NOW_EPOCH"
    fi
    ACTIVE_SSID="$(current_ssid "$WIFI_IFACE" || true)"
    persist_state "offline_retry_failed" "$WIFI_IFACE" "${ACTIVE_SSID:-none}" "$CANDIDATE_COUNT" "fallback_retry_failed"
  fi

  sleep "$NETWORK_FALLBACK_CHECK_INTERVAL_SEC"
done
