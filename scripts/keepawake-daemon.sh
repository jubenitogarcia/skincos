#!/usr/bin/env bash
set -euo pipefail

HEALTH_DIR="/Users/jubenitogarcia/Automation/n8n/health"
PID_FILE="$HEALTH_DIR/keepawake-caffeinate.pid"

KEEP_AWAKE_ON_BATTERY="${KEEPAWAKE_ON_BATTERY:-true}"
KEEP_AWAKE_BATTERY_SCHEDULE_ENABLED="${KEEPAWAKE_BATTERY_SCHEDULE_ENABLED:-true}"
KEEP_AWAKE_BATTERY_START_HOUR="${KEEPAWAKE_BATTERY_START_HOUR:-6}"
KEEP_AWAKE_BATTERY_END_HOUR="${KEEPAWAKE_BATTERY_END_HOUR:-22}"
KEEP_AWAKE_CHECK_INTERVAL_SEC="${KEEPAWAKE_CHECK_INTERVAL_SEC:-30}"

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

if (( KEEP_AWAKE_BATTERY_START_HOUR < 0 || KEEP_AWAKE_BATTERY_START_HOUR > 23 )); then
  KEEP_AWAKE_BATTERY_START_HOUR=6
fi
if (( KEEP_AWAKE_BATTERY_END_HOUR < 0 || KEEP_AWAKE_BATTERY_END_HOUR > 23 )); then
  KEEP_AWAKE_BATTERY_END_HOUR=22
fi
if (( KEEP_AWAKE_CHECK_INTERVAL_SEC < 10 )); then
  KEEP_AWAKE_CHECK_INTERVAL_SEC=10
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
  local flags="-dimu"
  if [[ "$mode" == "ac" ]]; then
    flags="-dimus"
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
}

cleanup() {
  stop_caffeinate
}
trap cleanup EXIT INT TERM

log "iniciado (battery=${KEEP_AWAKE_ON_BATTERY}, schedule=${KEEP_AWAKE_BATTERY_SCHEDULE_ENABLED}, ${KEEP_AWAKE_BATTERY_START_HOUR}-${KEEP_AWAKE_BATTERY_END_HOUR})"

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
  sleep "$KEEP_AWAKE_CHECK_INTERVAL_SEC"
done
