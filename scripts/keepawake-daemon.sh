#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/shared-paths.sh"

HEALTH_DIR="$N8N_HEALTH_DIR"
PID_FILE="$HEALTH_DIR/keepawake-caffeinate.pid"
STATE_FILE="$HEALTH_DIR/keepawake.state"

KEEP_AWAKE_ON_BATTERY="${KEEPAWAKE_ON_BATTERY:-true}"
KEEP_AWAKE_BATTERY_SCHEDULE_ENABLED="${KEEPAWAKE_BATTERY_SCHEDULE_ENABLED:-true}"
KEEP_AWAKE_BATTERY_START_HOUR="${KEEPAWAKE_BATTERY_START_HOUR:-6}"
KEEP_AWAKE_BATTERY_END_HOUR="${KEEPAWAKE_BATTERY_END_HOUR:-22}"
KEEP_AWAKE_CHECK_INTERVAL_SEC="${KEEPAWAKE_CHECK_INTERVAL_SEC:-30}"
KEEP_AWAKE_IDLE_LOCK_ENABLED="${KEEPAWAKE_IDLE_LOCK_ENABLED:-true}"
KEEP_AWAKE_IDLE_LOCK_SEC="${KEEPAWAKE_IDLE_LOCK_SEC:-180}"
KEEP_AWAKE_IDLE_FORCE_DISPLAY_SLEEP="${KEEPAWAKE_IDLE_FORCE_DISPLAY_SLEEP:-true}"

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

KEEP_AWAKE_BATTERY_START_HOUR="$(sanitize_int "$KEEP_AWAKE_BATTERY_START_HOUR" "6")"
KEEP_AWAKE_BATTERY_END_HOUR="$(sanitize_int "$KEEP_AWAKE_BATTERY_END_HOUR" "22")"
KEEP_AWAKE_CHECK_INTERVAL_SEC="$(sanitize_int "$KEEP_AWAKE_CHECK_INTERVAL_SEC" "30")"
KEEP_AWAKE_IDLE_LOCK_SEC="$(sanitize_int "$KEEP_AWAKE_IDLE_LOCK_SEC" "180")"

if (( KEEP_AWAKE_BATTERY_START_HOUR < 0 || KEEP_AWAKE_BATTERY_START_HOUR > 23 )); then
  KEEP_AWAKE_BATTERY_START_HOUR=6
fi
if (( KEEP_AWAKE_BATTERY_END_HOUR < 0 || KEEP_AWAKE_BATTERY_END_HOUR > 23 )); then
  KEEP_AWAKE_BATTERY_END_HOUR=22
fi
if (( KEEP_AWAKE_CHECK_INTERVAL_SEC < 10 )); then
  KEEP_AWAKE_CHECK_INTERVAL_SEC=10
fi
if (( KEEP_AWAKE_IDLE_LOCK_SEC < 30 )); then
  KEEP_AWAKE_IDLE_LOCK_SEC=30
fi

log() {
  printf '%s [keepawake-daemon] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

is_ac_power() {
  pmset -g batt 2>/dev/null | head -n1 | grep -q "AC Power"
}

in_battery_schedule() {
  if ! to_bool "$KEEP_AWAKE_BATTERY_SCHEDULE_ENABLED"; then
    return 0
  fi

  local now_hour
  now_hour="$(date +%H)"
  now_hour=$((10#$now_hour))
  local start end
  start=$((10#$KEEP_AWAKE_BATTERY_START_HOUR))
  end=$((10#$KEEP_AWAKE_BATTERY_END_HOUR))

  if (( start == end )); then
    return 0
  fi
  if (( start < end )); then
    (( now_hour >= start && now_hour < end ))
    return $?
  fi
  (( now_hour >= start || now_hour < end ))
}

current_state="none"
idle_lock_armed="true"

persist_state() {
  cat >"$STATE_FILE" <<EOF
mode=$current_state
idle_lock_armed=$idle_lock_armed
EOF
}

idle_seconds() {
  local raw
  raw="$(ioreg -c IOHIDSystem 2>/dev/null | awk '/HIDIdleTime/ {print $NF; exit}')"
  if [[ -z "$raw" || ! "$raw" =~ ^[0-9]+$ ]]; then
    echo "0"
    return 0
  fi
  echo $((raw / 1000000000))
}

lock_screen_now() {
  if to_bool "$KEEP_AWAKE_IDLE_FORCE_DISPLAY_SLEEP"; then
    pmset displaysleepnow >/dev/null 2>&1 || true
  fi
  if [[ -x "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession" ]]; then
    "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession" -suspend >/dev/null 2>&1 || true
  else
    osascript -e 'tell application "System Events" to keystroke "q" using {control down, command down}' >/dev/null 2>&1 || true
  fi
}

maybe_lock_on_idle() {
  if ! to_bool "$KEEP_AWAKE_IDLE_LOCK_ENABLED"; then
    return 0
  fi
  local idle
  idle="$(idle_seconds)"
  if (( idle < KEEP_AWAKE_IDLE_LOCK_SEC / 3 )); then
    idle_lock_armed="true"
    return 0
  fi
  if (( idle >= KEEP_AWAKE_IDLE_LOCK_SEC )) && [[ "$idle_lock_armed" == "true" ]]; then
    log "idle lock acionado (${idle}s ocioso)"
    lock_screen_now
    idle_lock_armed="false"
  fi
}

stop_caffeinate() {
  if [[ -f "$PID_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$old_pid" ]] && kill -0 "$old_pid" >/dev/null 2>&1; then
      kill "$old_pid" >/dev/null 2>&1 || true
      sleep 0.2
      kill -9 "$old_pid" >/dev/null 2>&1 || true
    fi
    rm -f "$PID_FILE"
  fi
}

start_caffeinate() {
  local mode="$1"
  local flags="-i"
  if [[ "$mode" == "ac" ]]; then
    flags="-is"
  fi

  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    rm -f "$PID_FILE"
  fi

  /usr/bin/caffeinate "$flags" >/dev/null 2>&1 &
  local new_pid=$!
  echo "$new_pid" >"$PID_FILE"
}

apply_state() {
  local wanted_state="$1"
  if [[ "$wanted_state" == "$current_state" ]]; then
    persist_state
    return 0
  fi
  stop_caffeinate
  case "$wanted_state" in
    ac|battery)
      start_caffeinate "$wanted_state"
      log "estado=$wanted_state"
      ;;
    none)
      log "estado=none"
      ;;
  esac
  current_state="$wanted_state"
  persist_state
}

cleanup() {
  stop_caffeinate
}
trap cleanup EXIT INT TERM

log "iniciado (battery=${KEEP_AWAKE_ON_BATTERY}, schedule=${KEEP_AWAKE_BATTERY_SCHEDULE_ENABLED}, ${KEEP_AWAKE_BATTERY_START_HOUR}-${KEEP_AWAKE_BATTERY_END_HOUR}, idle_lock=${KEEP_AWAKE_IDLE_LOCK_ENABLED}:${KEEP_AWAKE_IDLE_LOCK_SEC}s)"

while true; do
  if is_ac_power; then
    apply_state "ac"
  else
    if ! to_bool "$KEEP_AWAKE_ON_BATTERY"; then
      apply_state "none"
    elif in_battery_schedule; then
      apply_state "battery"
    else
      apply_state "none"
    fi
  fi
  if [[ "$current_state" != "none" ]]; then
    maybe_lock_on_idle
    persist_state
  fi
  sleep "$KEEP_AWAKE_CHECK_INTERVAL_SEC"
done
