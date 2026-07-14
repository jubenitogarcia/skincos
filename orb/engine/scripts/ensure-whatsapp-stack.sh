#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/runtime-paths.sh"

EVOLUTION_ROOT="$N8N_ROOT/evolution-api"
EVOLUTION_ENV="$EVOLUTION_ENV_FILE"
EVOLUTION_START="$EVOLUTION_ROOT/start-evolution-api.sh"
EVOLUTION_LOG="$N8N_ROOT/evolution-api.log"
EVOLUTION_PIDFILE="$N8N_ROOT/evolution-api.pid"
HEALTH_DIR="$N8N_HEALTH_DIR"
HEALTH_LOG="$HEALTH_DIR/whatsapp-watchdog.log"
STATE_FILE="$HEALTH_DIR/whatsapp-watchdog.state"
INCIDENT_DIR="$HEALTH_DIR/incidents"
ALERT_SCRIPT="$N8N_ROOT/scripts/send-alert.py"
LOCK_DIR="/tmp/skincos-whatsapp-watchdog.lock"
CRM_HEALTH_URL="http://127.0.0.1:8099/health"
N8N_HEALTH_URL="http://127.0.0.1:5678/healthz"
EVO_LOCAL_URL="http://127.0.0.1:8080/instance/fetchInstances"
EVO_PUBLIC_URL="https://wa.skincos.com.br/instance/fetchInstances"
ORB_PUBLIC_HEALTH_URL="https://orb.skincos.com.br/healthz"
ALERT_INITIAL_DELAY_SEC="${ALERT_INITIAL_DELAY_SEC:-300}"
ALERT_REMINDER_INTERVAL_SEC="${ALERT_REMINDER_INTERVAL_SEC:-3600}"
ALERT_SEND_RECOVERY="${ALERT_SEND_RECOVERY:-false}"
ALERT_QUIET_START_HOUR="${ALERT_QUIET_START_HOUR:-23}"
ALERT_QUIET_END_HOUR="${ALERT_QUIET_END_HOUR:-7}"
ALERT_MAX_REMINDERS_PER_DAY="${ALERT_MAX_REMINDERS_PER_DAY:-6}"
WATCHDOG_MANAGE_KEEPAWAKE="${WATCHDOG_MANAGE_KEEPAWAKE:-false}"
KEEP_AWAKE_ON_BATTERY="${KEEPAWAKE_ON_BATTERY:-true}"
KEEP_AWAKE_BATTERY_SCHEDULE_ENABLED="${KEEPAWAKE_BATTERY_SCHEDULE_ENABLED:-true}"
KEEP_AWAKE_BATTERY_START_HOUR="${KEEPAWAKE_BATTERY_START_HOUR:-6}"
KEEP_AWAKE_BATTERY_END_HOUR="${KEEPAWAKE_BATTERY_END_HOUR:-22}"
KEEP_AWAKE_ASSERTION_TTL_SEC="${KEEPAWAKE_ASSERTION_TTL_SEC:-300}"
KEEP_AWAKE_PID_FILE="$HEALTH_DIR/keepawake-assertion.pid"
KEEP_AWAKE_MODE_FILE="$HEALTH_DIR/keepawake.mode"
KEEP_AWAKE_LOG_FILE="$HEALTH_DIR/keepawake-assertion.log"
LAUNCHD_LABEL_CRM="com.skincos.crm-api"
LAUNCHD_LABEL_TUNNEL="com.skincos.cloudflared.cs"
LAUNCHD_LABEL_ORB_TUNNEL="com.skincos.cloudflared.orb"
LAUNCHD_LABEL_EVOLUTION="com.skincos.evolution-api"
LAUNCHD_LABEL_N8N="com.jubenito.n8n-evolution"
LAUNCHD_PLIST_N8N="$HOME/Library/LaunchAgents/com.jubenito.n8n-evolution.plist"
LAUNCHD_PLIST_TUNNEL="$HOME/Library/LaunchAgents/com.skincos.cloudflared.cs.plist"
LAUNCHD_PLIST_ORB_TUNNEL="$HOME/Library/LaunchAgents/com.skincos.cloudflared.orb.plist"
LAUNCHD_PLIST_EVOLUTION="$HOME/Library/LaunchAgents/com.skincos.evolution-api.plist"

mkdir -p "$HEALTH_DIR"
mkdir -p "$INCIDENT_DIR"
touch "$HEALTH_LOG"
touch "$STATE_FILE"
exec >>"$HEALTH_LOG" 2>&1

if [[ -f "$N8N_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$N8N_ENV_FILE"
  set +a
fi

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

log_info() {
  echo "$(timestamp) [INFO] $*"
}

log_warn() {
  echo "$(timestamp) [WARN] $*"
}

log_error() {
  echo "$(timestamp) [ERROR] $*"
}

send_alert() {
  local subject="$1"
  local body="$2"
  if [[ ! -x "$ALERT_SCRIPT" ]]; then
    log_warn "Script de alerta ausente/não executável: $ALERT_SCRIPT"
    return 1
  fi
  if python3 "$ALERT_SCRIPT" "$subject" "$body" >/dev/null 2>&1; then
    log_info "Alerta enviado: $subject"
    return 0
  fi
  log_warn "Falha ao enviar alerta: $subject"
  return 1
}

to_bool() {
  local value="${1:-false}"
  value="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
  [[ "$value" == "1" || "$value" == "true" || "$value" == "yes" || "$value" == "on" ]]
}

sanitize_non_negative_int() {
  local value="${1:-}"
  local default_value="${2:-0}"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "$value"
  else
    echo "$default_value"
  fi
}

sanitize_hour_or_disable() {
  local value="${1:-}"
  if [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 0 && value <= 23 )); then
    echo "$value"
  else
    echo ""
  fi
}

is_quiet_hours() {
  local start="${ALERT_QUIET_START_HOUR:-}"
  local end="${ALERT_QUIET_END_HOUR:-}"
  if [[ -z "$start" || -z "$end" || "$start" == "$end" ]]; then
    return 1
  fi

  local now_hour
  now_hour="$(date +%H)"
  now_hour=$((10#$now_hour))
  local start_int end_int
  start_int=$((10#$start))
  end_int=$((10#$end))

  if (( start_int < end_int )); then
    (( now_hour >= start_int && now_hour < end_int ))
    return $?
  fi

  (( now_hour >= start_int || now_hour < end_int ))
}

incident_state_file() {
  local key="$1"
  echo "$INCIDENT_DIR/${key}.state"
}

load_incident_state() {
  local key="$1"
  local state_file
  state_file="$(incident_state_file "$key")"
  local legacy_file="$INCIDENT_DIR/${key}.open"

  if [[ ! -f "$state_file" && -f "$legacy_file" ]]; then
    local now_epoch
    now_epoch="$(date +%s)"
    local legacy_start
    legacy_start="$(date -r "$legacy_file" +%s 2>/dev/null || echo "$now_epoch")"
    cat >"$state_file" <<EOF
start_epoch=$legacy_start
last_alert_epoch=0
daily_date=$(date +%F)
daily_count=0
EOF
    rm -f "$legacy_file"
  fi

  if [[ -f "$state_file" ]]; then
    # shellcheck disable=SC1090
    source "$state_file"
  else
    start_epoch=0
    last_alert_epoch=0
    daily_date=""
    daily_count=0
  fi

  if [[ -z "${daily_date:-}" ]]; then
    daily_date="$(date +%F)"
  fi
  daily_count="$(sanitize_non_negative_int "${daily_count:-0}" "0")"
}

persist_incident_state() {
  local key="$1"
  local state_file
  state_file="$(incident_state_file "$key")"
  cat >"$state_file" <<EOF
start_epoch=${start_epoch:-0}
last_alert_epoch=${last_alert_epoch:-0}
daily_date=${daily_date:-}
daily_count=${daily_count:-0}
EOF
}

reset_daily_counter_if_needed() {
  local today
  today="$(date +%F)"
  if [[ "${daily_date:-}" != "$today" ]]; then
    daily_date="$today"
    daily_count=0
  fi
}

format_downtime() {
  local total_seconds="$1"
  if (( total_seconds < 60 )); then
    echo "${total_seconds}s"
    return 0
  fi
  local minutes=$((total_seconds / 60))
  if (( minutes < 60 )); then
    echo "${minutes}m"
    return 0
  fi
  local hours=$((minutes / 60))
  local remain_minutes=$((minutes % 60))
  echo "${hours}h${remain_minutes}m"
}

keepawake_is_ac_power() {
  pmset -g batt 2>/dev/null | head -n1 | grep -q "AC Power"
}

keepawake_in_battery_schedule() {
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

stop_keepawake_assertion() {
  if [[ ! -f "$KEEP_AWAKE_PID_FILE" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "$KEEP_AWAKE_PID_FILE" 2>/dev/null || true)"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1; then
    local cmdline
    cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
    if printf '%s' "$cmdline" | grep -q "/usr/bin/caffeinate"; then
      log_info "KeepAwake encerrando assertion pid=$pid"
      kill "$pid" >/dev/null 2>&1 || true
      sleep 0.1
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$KEEP_AWAKE_PID_FILE"
}

start_keepawake_assertion() {
  local mode="$1"
  local flags="-dim"
  if [[ "$mode" == "ac" ]]; then
    flags="-dims"
  fi

  nohup /usr/bin/caffeinate "$flags" -t "$KEEP_AWAKE_ASSERTION_TTL_SEC" >>"$KEEP_AWAKE_LOG_FILE" 2>&1 &
  local new_pid=$!
  echo "$new_pid" >"$KEEP_AWAKE_PID_FILE"
  log_info "KeepAwake assertion iniciada pid=$new_pid mode=$mode ttl=${KEEP_AWAKE_ASSERTION_TTL_SEC}s"
}

set_keepawake_mode() {
  local wanted_mode="$1"
  local current_mode="none"
  if [[ -f "$KEEP_AWAKE_MODE_FILE" ]]; then
    current_mode="$(cat "$KEEP_AWAKE_MODE_FILE" 2>/dev/null || echo "none")"
  fi

  if [[ "$wanted_mode" == "$current_mode" ]]; then
    if [[ "$wanted_mode" != "none" ]]; then
      local pid_valid=false
      if [[ -f "$KEEP_AWAKE_PID_FILE" ]]; then
        local pid
        pid="$(cat "$KEEP_AWAKE_PID_FILE" 2>/dev/null || true)"
        if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" >/dev/null 2>&1; then
          local cmdline
          cmdline="$(ps -p "$pid" -o args= 2>/dev/null || true)"
          if printf '%s' "$cmdline" | grep -q "/usr/bin/caffeinate"; then
            pid_valid=true
          fi
        fi
      fi
      if [[ "$pid_valid" != "true" ]]; then
        start_keepawake_assertion "$wanted_mode"
      fi
    fi
    return 0
  fi

  stop_keepawake_assertion
  if [[ "$wanted_mode" != "none" ]]; then
    start_keepawake_assertion "$wanted_mode"
  fi
  echo "$wanted_mode" >"$KEEP_AWAKE_MODE_FILE"
  log_info "KeepAwake modo=$wanted_mode"
}

manage_keepawake_assertion() {
  local wanted_mode="none"
  if keepawake_is_ac_power; then
    wanted_mode="ac"
  elif to_bool "$KEEP_AWAKE_ON_BATTERY" && keepawake_in_battery_schedule; then
    wanted_mode="battery"
  fi
  set_keepawake_mode "$wanted_mode"
}

open_incident() {
  local key="$1"
  local message="$2"
  local now_epoch
  now_epoch="$(date +%s)"

  load_incident_state "$key"
  if [[ "${start_epoch:-0}" -le 0 ]]; then
    start_epoch="$now_epoch"
    last_alert_epoch=0
    persist_incident_state "$key"
    log_warn "Incidente aberto: $key"
    return 0
  fi

  local elapsed=$((now_epoch - start_epoch))
  if (( elapsed < ALERT_INITIAL_DELAY_SEC )); then
    return 0
  fi

  local due=false
  if [[ "${last_alert_epoch:-0}" -le 0 ]]; then
    due=true
  elif (( now_epoch - last_alert_epoch >= ALERT_REMINDER_INTERVAL_SEC )); then
    due=true
  fi

  if [[ "$due" == "true" ]]; then
    reset_daily_counter_if_needed
    local max_daily
    max_daily="$(sanitize_non_negative_int "${ALERT_MAX_REMINDERS_PER_DAY:-6}" "6")"
    if (( max_daily > 0 && daily_count >= max_daily )); then
      log_info "Lembrete suprimido para $key: limite diário (${max_daily}) atingido."
      persist_incident_state "$key"
      return 0
    fi

    if is_quiet_hours; then
      log_info "Lembrete suprimido para $key: janela de silêncio (${ALERT_QUIET_START_HOUR}-${ALERT_QUIET_END_HOUR})."
      persist_incident_state "$key"
      return 0
    fi

    local downtime_human
    downtime_human="$(format_downtime "$elapsed")"
    local subject_prefix="[SKINCOS][ALERTA]"
    if [[ "${last_alert_epoch:-0}" -gt 0 ]]; then
      subject_prefix="[SKINCOS][LEMBRETE]"
    fi
    local subject="${subject_prefix} ${key} indisponível há ${downtime_human}"
    local body="${message}

Duração da indisponibilidade: ${downtime_human}
Política de alertas: atraso inicial ${ALERT_INITIAL_DELAY_SEC}s, lembrete a cada ${ALERT_REMINDER_INTERVAL_SEC}s, limite diário ${max_daily}, silêncio ${ALERT_QUIET_START_HOUR}-${ALERT_QUIET_END_HOUR}."
    if send_alert "$subject" "$body"; then
      last_alert_epoch="$now_epoch"
      daily_count=$((daily_count + 1))
      persist_incident_state "$key"
    fi
  fi
}

close_incident() {
  local key="$1"
  local _message="$2"
  local state_file
  state_file="$(incident_state_file "$key")"
  local legacy_file="$INCIDENT_DIR/${key}.open"

  if [[ ! -f "$state_file" && ! -f "$legacy_file" ]]; then
    return 0
  fi

  if [[ -f "$state_file" ]]; then
    load_incident_state "$key"
    if to_bool "$ALERT_SEND_RECOVERY"; then
      local now_epoch
      now_epoch="$(date +%s)"
      local elapsed=0
      if [[ "${start_epoch:-0}" -gt 0 ]]; then
        elapsed=$((now_epoch - start_epoch))
      fi
      local downtime_human
      downtime_human="$(format_downtime "$elapsed")"
      send_alert "[SKINCOS][RECUPERADO] ${key}" "Serviço recuperado após ${downtime_human}."
    fi
  fi

  rm -f "$state_file" "$legacy_file"
  log_info "Incidente encerrado: $key"
}

release_lock() {
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log_warn "Watchdog already running, skipping this tick."
  exit 0
fi
trap release_lock EXIT

load_evolution_api_key() {
  if [[ ! -f "$EVOLUTION_ENV" ]]; then
    log_error "Arquivo .env do Evolution não encontrado em $EVOLUTION_ENV"
    return 1
  fi
  EVOLUTION_API_KEY="$(/usr/bin/grep -E '^AUTHENTICATION_API_KEY=' "$EVOLUTION_ENV" | head -n1 | cut -d= -f2- | tr -d '\r' || true)"
  if [[ -z "${EVOLUTION_API_KEY:-}" ]]; then
    log_error "AUTHENTICATION_API_KEY ausente em $EVOLUTION_ENV"
    return 1
  fi
  export EVOLUTION_API_KEY
}

http_ok() {
  local url="$1"
  shift || true
  /usr/bin/curl -fsS -m 8 "$url" "$@" >/dev/null 2>&1
}

evolution_healthy_local() {
  http_ok "$EVO_LOCAL_URL" -H "apikey: $EVOLUTION_API_KEY"
}

evolution_port_up() {
  /usr/bin/nc -z 127.0.0.1 8080 >/dev/null 2>&1
}

kill_pid_soft_then_hard() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    return 0
  fi
  kill "$pid" >/dev/null 2>&1 || true
  sleep 2
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi
}

restart_evolution() {
  log_warn "Evolution indisponível. Reiniciando processo."
  local uid
  uid="$(id -u)"

  if launchctl print "gui/$uid/$LAUNCHD_LABEL_EVOLUTION" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$uid/$LAUNCHD_LABEL_EVOLUTION" >/dev/null 2>&1 || true
    log_info "Evolution reiniciado via launchd ($LAUNCHD_LABEL_EVOLUTION)."
  elif [[ -f "$LAUNCHD_PLIST_EVOLUTION" ]]; then
    launchctl bootstrap "gui/$uid" "$LAUNCHD_PLIST_EVOLUTION" >/dev/null 2>&1 || true
    launchctl kickstart -k "gui/$uid/$LAUNCHD_LABEL_EVOLUTION" >/dev/null 2>&1 || true
    log_info "Evolution bootstrap + start via launchd."
  else
    if [[ -f "$EVOLUTION_PIDFILE" ]]; then
      local pid_from_file
      pid_from_file="$(cat "$EVOLUTION_PIDFILE" 2>/dev/null || true)"
      kill_pid_soft_then_hard "$pid_from_file"
    fi

    local pids_on_port
    pids_on_port="$(/usr/sbin/lsof -ti tcp:8080 2>/dev/null || true)"
    if [[ -n "$pids_on_port" ]]; then
      for pid in $pids_on_port; do
        kill_pid_soft_then_hard "$pid"
      done
    fi

    if [[ ! -x "$EVOLUTION_START" ]]; then
      log_error "Script de start não executável: $EVOLUTION_START"
      open_incident "evolution_down" "Evolution indisponível e script de start inválido."
      return 1
    fi

    nohup /bin/bash -lc "cd '$EVOLUTION_ROOT' && ./start-evolution-api.sh" >>"$EVOLUTION_LOG" 2>&1 &
    local new_pid=$!
    echo "$new_pid" >"$EVOLUTION_PIDFILE"
    log_info "Evolution start disparado por fallback (PID $new_pid)."
  fi

  local retries=45
  while (( retries > 0 )); do
    if evolution_healthy_local; then
      log_info "Evolution saudável novamente."
      return 0
    fi
    sleep 1
    ((retries--))
  done

  log_error "Evolution não respondeu no health após reinício."
  open_incident "evolution_down" "Evolution não voltou após tentativa de reinício automático."
  return 1
}

ensure_tunnel_up() {
  local uid
  uid="$(id -u)"
  if launchctl print "gui/$uid/$LAUNCHD_LABEL_TUNNEL" >/dev/null 2>&1; then
    close_incident "tunnel_down" "Cloudflare tunnel voltou a ficar disponível."
    return 0
  fi

  if [[ -f "$LAUNCHD_PLIST_TUNNEL" ]]; then
    log_warn "Tunnel não estava carregado; realizando bootstrap."
    launchctl bootstrap "gui/$uid" "$LAUNCHD_PLIST_TUNNEL" >/dev/null 2>&1 || true
    launchctl kickstart -k "gui/$uid/$LAUNCHD_LABEL_TUNNEL" >/dev/null 2>&1 || true
    open_incident "tunnel_down" "Cloudflare tunnel caiu e foi reiniciado automaticamente."
  else
    log_error "LaunchAgent do tunnel não encontrado: $LAUNCHD_PLIST_TUNNEL"
    open_incident "tunnel_down" "LaunchAgent do tunnel não encontrado."
  fi
}

ensure_orb_tunnel_up() {
  local uid
  uid="$(id -u)"
  if launchctl print "gui/$uid/$LAUNCHD_LABEL_ORB_TUNNEL" >/dev/null 2>&1; then
    close_incident "orb_tunnel_down" "Cloudflare tunnel do orb voltou a ficar disponível."
    return 0
  fi

  if [[ -f "$LAUNCHD_PLIST_ORB_TUNNEL" ]]; then
    log_warn "Tunnel orb não estava carregado; realizando bootstrap."
    launchctl bootstrap "gui/$uid" "$LAUNCHD_PLIST_ORB_TUNNEL" >/dev/null 2>&1 || true
    launchctl kickstart -k "gui/$uid/$LAUNCHD_LABEL_ORB_TUNNEL" >/dev/null 2>&1 || true
    open_incident "orb_tunnel_down" "Cloudflare tunnel orb caiu e foi reiniciado automaticamente."
  else
    log_error "LaunchAgent do tunnel orb não encontrado: $LAUNCHD_PLIST_ORB_TUNNEL"
    open_incident "orb_tunnel_down" "LaunchAgent do tunnel orb não encontrado."
  fi
}

ensure_crm_up() {
  if http_ok "$CRM_HEALTH_URL"; then
    close_incident "crm_down" "CRM API local voltou a responder /health."
    return 0
  fi

  local uid
  uid="$(id -u)"
  if launchctl print "gui/$uid/$LAUNCHD_LABEL_CRM" >/dev/null 2>&1; then
    log_warn "CRM API indisponível; reiniciando LaunchAgent."
    launchctl kickstart -k "gui/$uid/$LAUNCHD_LABEL_CRM" >/dev/null 2>&1 || true
    open_incident "crm_down" "CRM API local caiu e foi reiniciada automaticamente."
  else
    log_warn "CRM API local não gerenciada por launchd. Health atual indisponível."
    open_incident "crm_down" "CRM API local indisponível e sem LaunchAgent carregado."
  fi
}

ensure_n8n_up() {
  if http_ok "$N8N_HEALTH_URL"; then
    close_incident "n8n_down" "n8n local voltou a responder no /healthz."
    return 0
  fi

  local uid
  uid="$(id -u)"
  if launchctl print "gui/$uid/$LAUNCHD_LABEL_N8N" >/dev/null 2>&1; then
    log_warn "n8n local indisponível; reiniciando LaunchAgent."
    launchctl kickstart -k "gui/$uid/$LAUNCHD_LABEL_N8N" >/dev/null 2>&1 || true
    open_incident "n8n_down" "n8n local caiu e foi reiniciado automaticamente."
  elif [[ -f "$LAUNCHD_PLIST_N8N" ]]; then
    log_warn "n8n LaunchAgent não carregado; realizando bootstrap."
    launchctl bootstrap "gui/$uid" "$LAUNCHD_PLIST_N8N" >/dev/null 2>&1 || true
    launchctl kickstart -k "gui/$uid/$LAUNCHD_LABEL_N8N" >/dev/null 2>&1 || true
    open_incident "n8n_down" "n8n local indisponível e foi bootstrapado automaticamente."
  else
    log_error "LaunchAgent do n8n não encontrado: $LAUNCHD_PLIST_N8N"
    open_incident "n8n_down" "n8n local indisponível e sem LaunchAgent configurado."
  fi
}

ensure_orb_public_up() {
  if http_ok "$ORB_PUBLIC_HEALTH_URL"; then
    close_incident "orb_public_down" "Endpoint público orb.skincos.com.br voltou a responder /healthz."
    return 0
  fi

  log_warn "Endpoint público orb.skincos.com.br falhou no /healthz; tentando recuperação do tunnel."
  local uid
  uid="$(id -u)"
  if launchctl print "gui/$uid/$LAUNCHD_LABEL_ORB_TUNNEL" >/dev/null 2>&1; then
    launchctl kickstart -k "gui/$uid/$LAUNCHD_LABEL_ORB_TUNNEL" >/dev/null 2>&1 || true
  fi
  open_incident "orb_public_down" "Endpoint público orb.skincos.com.br falhou no /healthz."
}

read_failures() {
  local value
  value="$(cat "$STATE_FILE" 2>/dev/null || echo "0")"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    echo "$value"
  else
    echo "0"
  fi
}

write_failures() {
  local value="$1"
  echo "$value" >"$STATE_FILE"
}

main() {
  log_info "Watchdog tick iniciado."
  ALERT_INITIAL_DELAY_SEC="$(sanitize_non_negative_int "$ALERT_INITIAL_DELAY_SEC" "300")"
  ALERT_REMINDER_INTERVAL_SEC="$(sanitize_non_negative_int "$ALERT_REMINDER_INTERVAL_SEC" "3600")"
  ALERT_MAX_REMINDERS_PER_DAY="$(sanitize_non_negative_int "$ALERT_MAX_REMINDERS_PER_DAY" "6")"
  ALERT_QUIET_START_HOUR="$(sanitize_hour_or_disable "$ALERT_QUIET_START_HOUR")"
  ALERT_QUIET_END_HOUR="$(sanitize_hour_or_disable "$ALERT_QUIET_END_HOUR")"
  KEEP_AWAKE_BATTERY_START_HOUR="$(sanitize_hour_or_disable "$KEEP_AWAKE_BATTERY_START_HOUR")"
  KEEP_AWAKE_BATTERY_END_HOUR="$(sanitize_hour_or_disable "$KEEP_AWAKE_BATTERY_END_HOUR")"
  if [[ -z "$KEEP_AWAKE_BATTERY_START_HOUR" ]]; then KEEP_AWAKE_BATTERY_START_HOUR=6; fi
  if [[ -z "$KEEP_AWAKE_BATTERY_END_HOUR" ]]; then KEEP_AWAKE_BATTERY_END_HOUR=22; fi
  KEEP_AWAKE_ASSERTION_TTL_SEC="$(sanitize_non_negative_int "$KEEP_AWAKE_ASSERTION_TTL_SEC" "300")"
  if (( KEEP_AWAKE_ASSERTION_TTL_SEC < 30 )); then KEEP_AWAKE_ASSERTION_TTL_SEC=30; fi
  if to_bool "$WATCHDOG_MANAGE_KEEPAWAKE"; then
    manage_keepawake_assertion
  fi
  load_evolution_api_key || exit 1

  if ! /usr/bin/nc -z 127.0.0.1 5432 >/dev/null 2>&1; then
    log_error "PostgreSQL local (5432) indisponível; não é possível subir Evolution."
    open_incident "postgres_down" "PostgreSQL local (porta 5432) indisponível para stack WhatsApp."
    exit 1
  fi
  close_incident "postgres_down" "PostgreSQL local voltou a responder na porta 5432."

  ensure_tunnel_up
  ensure_orb_tunnel_up
  ensure_crm_up
  ensure_n8n_up

  local failures
  failures="$(read_failures)"

  if evolution_port_up && evolution_healthy_local; then
    write_failures 0
    close_incident "evolution_down" "Evolution API voltou a responder no health local."
  elif evolution_port_up; then
    failures=$((failures + 1))
    write_failures "$failures"
    log_warn "Evolution com porta ativa, mas health falhou (tentativa $failures/3)."
    if (( failures >= 3 )); then
      restart_evolution || true
      write_failures 0
    fi
  else
    failures=$((failures + 1))
    write_failures "$failures"
    log_warn "Evolution sem porta 8080 ativa (tentativa $failures)."
    restart_evolution || true
    write_failures 0
  fi

  if ! http_ok "$EVO_PUBLIC_URL" -H "apikey: $EVOLUTION_API_KEY"; then
    log_warn "Endpoint público wa.skincos.com.br não respondeu ao fetchInstances."
    open_incident "wa_public_down" "Endpoint público wa.skincos.com.br retornou falha no fetchInstances."
  else
    close_incident "wa_public_down" "Endpoint público wa.skincos.com.br voltou a responder."
  fi

  ensure_orb_public_up

  log_info "Watchdog tick finalizado."
}

main "$@"
