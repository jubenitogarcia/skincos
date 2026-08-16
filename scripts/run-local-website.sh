#!/usr/bin/env bash
set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
ROOT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")/.." && pwd)"
SCRIPT_PATH="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)/$(basename "$SCRIPT_SOURCE")"
WEBSITE_SOURCE_ROOT="${WEBSITE_SOURCE_ROOT:-$ROOT_DIR}"
WEBSITE_DIR="$WEBSITE_SOURCE_ROOT/website"
WEBSITE_HOST="${WEBSITE_HOST:-0.0.0.0}"
if [[ -n "${WEBSITE_PORT+x}" ]]; then
  WEBSITE_PORT_EXPLICIT=1
else
  WEBSITE_PORT_EXPLICIT=0
fi
WEBSITE_PORT="${WEBSITE_PORT:-3000}"
WEBSITE_STATE_DIR="${WEBSITE_STATE_DIR:-$ROOT_DIR}"
PID_FILE="${WEBSITE_PID_FILE:-$WEBSITE_STATE_DIR/.website-local-dev.pid}"
LOG_FILE="${WEBSITE_LOG_FILE:-$WEBSITE_STATE_DIR/website-local-dev.log}"
PORT_FILE="${WEBSITE_PORT_FILE:-$WEBSITE_STATE_DIR/website-local-dev.port}"
WEBSITE_ROUTE="${WEBSITE_ROUTE:-/}"
WEBSITE_DETACH="${WEBSITE_DETACH:-0}"
WEBSITE_SUPERVISOR_MODE="${WEBSITE_SUPERVISOR_MODE:-0}"
WEBSITE_START_TIMEOUT="${WEBSITE_START_TIMEOUT:-90}"
WEBSITE_SKIP_WORKERD_CHECK="${WEBSITE_SKIP_WORKERD_CHECK:-0}"
# The generic website launcher deliberately remains usable without an identity
# contract.  The Codex local-preview action opts into the stricter branch below
# by supplying both values.  Keeping that distinction here prevents a generic
# `website:local` caller from being coupled to the private preview protocol.
WEBSITE_INSTANCE_FINGERPRINT="${WEBSITE_INSTANCE_FINGERPRINT:-}"
WEBSITE_INSTANCE_ID="${WEBSITE_INSTANCE_ID:-}"
WEBSITE_INSTANCE_EXPECTED_FINGERPRINT="${WEBSITE_INSTANCE_EXPECTED_FINGERPRINT:-$WEBSITE_INSTANCE_FINGERPRINT}"
WEBSITE_INSTANCE_EXPECTED_ID="${WEBSITE_INSTANCE_EXPECTED_ID:-$WEBSITE_INSTANCE_ID}"
WEBSITE_INSTANCE_FINGERPRINT_HEADER="${WEBSITE_INSTANCE_FINGERPRINT_HEADER:-X-Skincos-Preview-Fingerprint}"
WEBSITE_INSTANCE_ID_HEADER="${WEBSITE_INSTANCE_ID_HEADER:-X-Skincos-Preview-Instance}"
WEBSITE_LOCAL_PREVIEW_DIST_DIR="${WEBSITE_LOCAL_PREVIEW_DIST_DIR:-${SKINCOS_LOCAL_PREVIEW_DIST_DIR:-}}"
SKINCOS_LOCAL_PREVIEW_DIST_DIR="${SKINCOS_LOCAL_PREVIEW_DIST_DIR:-$WEBSITE_LOCAL_PREVIEW_DIST_DIR}"
SKINCOS_LOCAL_PREVIEW_FINGERPRINT="${SKINCOS_LOCAL_PREVIEW_FINGERPRINT:-$WEBSITE_INSTANCE_FINGERPRINT}"
SKINCOS_LOCAL_PREVIEW_INSTANCE="${SKINCOS_LOCAL_PREVIEW_INSTANCE:-$WEBSITE_INSTANCE_ID}"
WEBSITE_INSTANCE_STATE_FILE="${WEBSITE_INSTANCE_STATE_FILE:-$WEBSITE_STATE_DIR/instance.json}"
WEBSITE_SUPERVISOR_TOKEN_FILE="${WEBSITE_SUPERVISOR_TOKEN_FILE:-$WEBSITE_STATE_DIR/.website-local-supervisor.token}"
WEBSITE_SUPERVISOR_TOKEN="${WEBSITE_SUPERVISOR_TOKEN:-}"
WEBSITE_ALLOW_PORT_FALLBACK="${WEBSITE_ALLOW_PORT_FALLBACK:-0}"

if [[ -n "$WEBSITE_INSTANCE_FINGERPRINT$WEBSITE_INSTANCE_ID$WEBSITE_INSTANCE_EXPECTED_FINGERPRINT$WEBSITE_INSTANCE_EXPECTED_ID" ]]; then
  if [[ -z "$WEBSITE_INSTANCE_FINGERPRINT" || -z "$WEBSITE_INSTANCE_ID" || -z "$WEBSITE_INSTANCE_EXPECTED_FINGERPRINT" || -z "$WEBSITE_INSTANCE_EXPECTED_ID" ]]; then
    echo "WEBSITE_INSTANCE_FINGERPRINT and WEBSITE_INSTANCE_ID must be provided together for an attested preview." >&2
    exit 1
  fi
  if [[ "${SKINCOS_LOCAL_PREVIEW:-}" != "true" ]]; then
    echo "An attested preview requires SKINCOS_LOCAL_PREVIEW=true." >&2
    exit 1
  fi
  if [[ "$WEBSITE_INSTANCE_EXPECTED_FINGERPRINT" != "$WEBSITE_INSTANCE_FINGERPRINT" || "$WEBSITE_INSTANCE_EXPECTED_ID" != "$WEBSITE_INSTANCE_ID" || "$SKINCOS_LOCAL_PREVIEW_FINGERPRINT" != "$WEBSITE_INSTANCE_FINGERPRINT" || "$SKINCOS_LOCAL_PREVIEW_INSTANCE" != "$WEBSITE_INSTANCE_ID" ]]; then
    echo "The SKINCOS local-preview headers must represent the requested website instance." >&2
    exit 1
  fi
  WEBSITE_INSTANCE_CONTRACT_ACTIVE=1
else
  WEBSITE_INSTANCE_CONTRACT_ACTIVE=0
fi

if [[ -n "${OPEN_BROWSER+x}" ]]; then
  OPEN_BROWSER_EXPLICIT=1
else
  OPEN_BROWSER_EXPLICIT=0
fi

is_codex_app_shell() {
  [[ "${CODEX_SHELL:-}" == "1" || "${CODEX_CI:-}" == "1" || "${CODEX_INTERNAL_ORIGINATOR_OVERRIDE:-}" == "Codex Desktop" ]]
}

if [[ "$OPEN_BROWSER_EXPLICIT" == "0" ]] && is_codex_app_shell; then
  OPEN_BROWSER=0
else
  OPEN_BROWSER="${OPEN_BROWSER:-1}"
fi

STOP_ONLY=0

usage() {
  cat <<EOF
SKINCOS • Website local

Uso:
  $(basename "$0") [rota] [opções]

Opções:
  --browser      Abre navegador automaticamente
  --no-browser   Não abre navegador automaticamente
  --stop         Encerra a instância local rastreada e sai
  -h, --help     Mostrar ajuda
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser) OPEN_BROWSER=1; OPEN_BROWSER_EXPLICIT=1 ;;
    --no-browser) OPEN_BROWSER=0; OPEN_BROWSER_EXPLICIT=1 ;;
    --stop) STOP_ONLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *)
      if [[ "$1" == -* ]]; then
        echo "Opção desconhecida: $1" >&2
        usage
        exit 1
      fi
      WEBSITE_ROUTE="$1"
      ;;
  esac
  shift || true
done

case "$WEBSITE_ROUTE" in
  /*) ;;
  *) WEBSITE_ROUTE="/$WEBSITE_ROUTE" ;;
esac

DEFAULT_URL="http://localhost:${WEBSITE_PORT}${WEBSITE_ROUTE}"
NETWORK_URL="http://${WEBSITE_HOST}:${WEBSITE_PORT}${WEBSITE_ROUTE}"

collect_descendants() {
  local parent_pid="$1"
  local child_pid

  if ! command -v pgrep >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r child_pid; do
    [ -n "$child_pid" ] || continue
    collect_descendants "$child_pid"
    echo "$child_pid"
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
}

terminate_pid() {
  local target_pid="$1"
  local descendant_pids

  if ! kill -0 "$target_pid" >/dev/null 2>&1; then
    return 0
  fi

  descendant_pids="$(collect_descendants "$target_pid" | tr '\n' ' ')"

  if [ -n "$descendant_pids" ]; then
    kill -TERM $descendant_pids >/dev/null 2>&1 || true
  fi
  kill -TERM "$target_pid" >/dev/null 2>&1 || true

  sleep 2

  if [ -n "$descendant_pids" ]; then
    kill -KILL $descendant_pids >/dev/null 2>&1 || true
  fi
  kill -KILL "$target_pid" >/dev/null 2>&1 || true
}

is_numeric_pid() {
  [[ "${1:-}" =~ ^[0-9]+$ ]]
}

pid_start_ticks() {
  local pid="$1"
  local stat_line
  local stat_fields

  is_numeric_pid "$pid" || return 1
  [[ -r "/proc/$pid/stat" ]] || return 1
  stat_line="$(<"/proc/$pid/stat")"
  # The command name is enclosed in parentheses and can contain spaces, so
  # parse only the fields after its final closing parenthesis.  starttime is
  # field 22 overall, i.e. offset 19 after the state field.
  stat_fields="${stat_line##*) }"
  local -a fields=()
  read -r -a fields <<<"$stat_fields"
  [[ "${fields[19]:-}" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "${fields[19]}"
}

pid_parent_pid() {
  local pid="$1"
  local stat_line
  local stat_fields

  is_numeric_pid "$pid" || return 1
  [[ -r "/proc/$pid/stat" ]] || return 1
  stat_line="$(<"/proc/$pid/stat")"
  stat_fields="${stat_line##*) }"
  local -a fields=()
  read -r -a fields <<<"$stat_fields"
  [[ "${fields[1]:-}" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "${fields[1]}"
}

pid_command_line() {
  local pid="$1"

  is_numeric_pid "$pid" || return 1
  [[ -r "/proc/$pid/cmdline" ]] || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline"
}

pid_is_descendant_of() {
  local candidate_pid="$1"
  local ancestor_pid="$2"
  local parent_pid
  local remaining=128

  is_numeric_pid "$candidate_pid" || return 1
  is_numeric_pid "$ancestor_pid" || return 1

  while (( remaining > 0 )); do
    [[ "$candidate_pid" == "$ancestor_pid" ]] && return 0
    [[ "$candidate_pid" == "1" ]] && return 1
    parent_pid="$(pid_parent_pid "$candidate_pid" 2>/dev/null || true)"
    [[ -n "$parent_pid" && "$parent_pid" != "$candidate_pid" ]] || return 1
    candidate_pid="$parent_pid"
    remaining=$((remaining - 1))
  done

  return 1
}

is_owned_website_supervisor() {
  local pid="$1"
  local expected_start_ticks="${2:-}"
  local actual_start_ticks
  local command_line
  local cwd

  is_numeric_pid "$pid" || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  actual_start_ticks="$(pid_start_ticks "$pid" 2>/dev/null || true)"
  [[ -n "$actual_start_ticks" ]] || return 1
  if [[ -n "$expected_start_ticks" && "$actual_start_ticks" != "$expected_start_ticks" ]]; then
    return 1
  fi

  command_line="$(pid_command_line "$pid" 2>/dev/null || true)"
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$cwd" == "$WEBSITE_SOURCE_ROOT" ]] || return 1
  [[ "$command_line" == *"$SCRIPT_PATH"* || "$command_line" == *"scripts/run-local-website.sh"* ]] || return 1
}

is_next_website_listener() {
  local pid="$1"
  local command_line
  local cwd

  is_numeric_pid "$pid" || return 1
  kill -0 "$pid" >/dev/null 2>&1 || return 1
  command_line="$(pid_command_line "$pid" 2>/dev/null || true)"
  cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
  [[ "$cwd" == "$WEBSITE_DIR" || "$cwd" == "$WEBSITE_SOURCE_ROOT" ]] || return 1

  # Next's listener is named `next-server` in current releases, while older
  # versions expose `next dev` or the bin path.  All forms are deliberate.
  [[ "$command_line" == *"next-server"* || "$command_line" == *"next dev"* || "$command_line" == *"npm run dev"* || "$command_line" == *"/next/dist/bin/next"* ]]
}

is_owned_website_listener() {
  local listener_pid="$1"
  local supervisor_pid="$2"
  local supervisor_start_ticks="${3:-}"

  is_next_website_listener "$listener_pid" || return 1
  is_owned_website_supervisor "$supervisor_pid" "$supervisor_start_ticks" || return 1
  pid_is_descendant_of "$listener_pid" "$supervisor_pid"
}

port_listener_pids() {
  local port="$1"
  local lsof_pids=""
  local ss_pids=""

  if command -v lsof >/dev/null 2>&1; then
    lsof_pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  fi

  if command -v ss >/dev/null 2>&1; then
    ss_pids="$(ss -ltnp "( sport = :$port )" 2>/dev/null |
      sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' |
      sort -u || true)"
  fi

  # `lsof` under WSL can return no listeners even when `ss` can see the
  # Next process.  Combine both observations instead of treating an empty
  # lsof result as authoritative.
  printf '%s\n%s\n' "$lsof_pids" "$ss_pids" | sed '/^$/d' | sort -u
}

is_port_free() {
  local port="$1"
  [[ -z "$(port_listener_pids "$port")" ]] || return 1

  # A Windows-owned relay can be reachable from WSL without exposing a PID to
  # either lsof or ss.  Treat a successful TCP handshake as occupied so an
  # unknown listener can never be mistaken for a free Action port.
  if command -v timeout >/dev/null 2>&1 &&
    timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

write_supervisor_attestation() {
  local supervisor_pid="$1"
  local supervisor_start_ticks="$2"
  local token="$3"
  local state_dir
  local temporary_file

  [[ -n "$token" ]] || return 1
  state_dir="$(dirname "$WEBSITE_SUPERVISOR_TOKEN_FILE")"
  mkdir -p "$state_dir"
  temporary_file="$WEBSITE_SUPERVISOR_TOKEN_FILE.tmp.$$"
  (umask 077; printf '%s\t%s\t%s\n' "$token" "$supervisor_pid" "$supervisor_start_ticks" > "$temporary_file")
  mv -f "$temporary_file" "$WEBSITE_SUPERVISOR_TOKEN_FILE"
}

read_supervisor_attestation() {
  local expected_token="${1:-}"
  local token
  local supervisor_pid
  local supervisor_start_ticks

  [[ -f "$WEBSITE_SUPERVISOR_TOKEN_FILE" ]] || return 1
  IFS=$'\t' read -r token supervisor_pid supervisor_start_ticks < "$WEBSITE_SUPERVISOR_TOKEN_FILE" || return 1
  [[ -n "$token" && -n "$supervisor_pid" && -n "$supervisor_start_ticks" ]] || return 1
  if [[ -n "$expected_token" && "$token" != "$expected_token" ]]; then
    return 1
  fi
  is_numeric_pid "$supervisor_pid" || return 1
  [[ "$supervisor_start_ticks" =~ ^[0-9]+$ ]] || return 1
  printf '%s\t%s\t%s\n' "$token" "$supervisor_pid" "$supervisor_start_ticks"
}

remove_supervisor_attestation_if_current() {
  local expected_token="${1:-}"
  local token
  local _supervisor_pid
  local _supervisor_start_ticks

  [[ -f "$WEBSITE_SUPERVISOR_TOKEN_FILE" ]] || return 0
  if ! IFS=$'\t' read -r token _supervisor_pid _supervisor_start_ticks < "$WEBSITE_SUPERVISOR_TOKEN_FILE"; then
    return 0
  fi
  if [[ -z "$expected_token" || "$token" == "$expected_token" ]]; then
    rm -f "$WEBSITE_SUPERVISOR_TOKEN_FILE"
  fi
}

resolve_owned_supervisor() {
  local candidate_pid=""
  local token=""
  local attested_pid=""
  local attested_start_ticks=""
  local current_start_ticks=""
  local -a candidates=()

  if [[ -f "$PID_FILE" ]]; then
    candidate_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    is_numeric_pid "$candidate_pid" && candidates+=("$candidate_pid")
  fi

  if IFS=$'\t' read -r token attested_pid attested_start_ticks < <(read_supervisor_attestation 2>/dev/null || true); then
    if is_numeric_pid "$attested_pid"; then
      candidates+=("$attested_pid")
    fi
  fi

  for candidate_pid in "${candidates[@]:-}"; do
    [[ -n "$candidate_pid" ]] || continue
    current_start_ticks=""
    if [[ "$candidate_pid" == "$attested_pid" ]]; then
      current_start_ticks="$attested_start_ticks"
    elif [[ "$WEBSITE_INSTANCE_CONTRACT_ACTIVE" == "1" ]]; then
      # A strict preview never authorizes a PID that lacks a recorded start
      # tick; a reused PID could otherwise target an unrelated WSL process.
      continue
    fi

    if is_owned_website_supervisor "$candidate_pid" "$current_start_ticks"; then
      printf '%s\t%s\n' "$candidate_pid" "$(pid_start_ticks "$candidate_pid")"
      return 0
    fi
  done

  return 1
}

stop_owned_port_listener() {
  local port="$1"
  local supervisor_pid="$2"
  local supervisor_start_ticks="${3:-}"
  local listening_pid

  while IFS= read -r listening_pid; do
    [[ -n "$listening_pid" ]] || continue
    if is_owned_website_listener "$listening_pid" "$supervisor_pid" "$supervisor_start_ticks"; then
      echo "Processo do website local preso na porta $port detectado (PID $listening_pid, supervisor $supervisor_pid). Finalizando..."
      terminate_pid "$supervisor_pid"
      return 0
    fi
  done < <(port_listener_pids "$port")

  return 1
}

resolve_website_port() {
  local preferred_port="$1"
  local port="$preferred_port"

  if is_port_free "$port"; then
    WEBSITE_PORT="$port"
    PORT_SELECTION_NOTE=""
    return 0
  fi

  if [[ "$WEBSITE_PORT_EXPLICIT" == "1" && "$WEBSITE_ALLOW_PORT_FALLBACK" != "1" ]]; then
    echo "Porta $port já está em uso. Defina WEBSITE_PORT para outra porta ou finalize o processo atual." >&2
    exit 1
  fi

  while (( port < preferred_port + 50 )); do
    port=$((port + 1))
    if is_port_free "$port"; then
      WEBSITE_PORT="$port"
      PORT_SELECTION_NOTE="Porta $preferred_port ocupada; usando $port."
      return 0
    fi
  done

  echo "Nenhuma porta livre encontrada para o website local a partir de $preferred_port." >&2
  exit 1
}

stop_existing_site() {
  local found_existing=0
  local owned_supervisor=""
  local owned_supervisor_pid=""
  local owned_supervisor_start_ticks=""
  local tracked_port

  if owned_supervisor="$(resolve_owned_supervisor 2>/dev/null || true)"; then
    IFS=$'\t' read -r owned_supervisor_pid owned_supervisor_start_ticks <<<"$owned_supervisor"
  fi

  if [[ -n "$owned_supervisor_pid" ]]; then
    found_existing=1
    echo "Instância anterior comprovada (PID $owned_supervisor_pid). Finalizando..."
    terminate_pid "$owned_supervisor_pid"
  fi

  if [ -f "$PORT_FILE" ]; then
    tracked_port="$(cat "$PORT_FILE" 2>/dev/null || true)"
    if [[ -n "$tracked_port" && -n "$owned_supervisor_pid" ]] && stop_owned_port_listener "$tracked_port" "$owned_supervisor_pid" "$owned_supervisor_start_ticks"; then
      found_existing=1
    fi
  fi

  # Stale PID/port files are not ownership proof.  Remove the pointers, but
  # leave an unverified listener alone; resolve_website_port will lease another
  # safe port instead of taking over or killing it.
  rm -f "$PID_FILE" "$PORT_FILE"
  if [[ "$found_existing" -eq 1 && "$WEBSITE_INSTANCE_CONTRACT_ACTIVE" == "1" ]]; then
    remove_supervisor_attestation_if_current
    rm -f "$WEBSITE_INSTANCE_STATE_FILE"
  fi

  if [ "$found_existing" -eq 1 ]; then
    echo "Reinicialização completa concluída. Subindo ambiente novamente..."
    echo ""
  fi
}

wait_for_site() {
  local url="$1"
  local retries="${2:-$WEBSITE_START_TIMEOUT}"
  while [ "$retries" -gt 0 ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done
  return 1
}

response_matches_instance_identity() {
  local url="$1"
  local headers_file
  local status=0

  [[ "$WEBSITE_INSTANCE_CONTRACT_ACTIVE" == "1" ]] || return 0
  headers_file="$(mktemp "${TMPDIR:-/tmp}/skincos-preview-headers.XXXXXX")"
  if ! curl -fsS -D "$headers_file" -o /dev/null --max-time 3 "$url" >/dev/null 2>&1; then
    status=1
  elif ! awk \
    -v fingerprint_header="$WEBSITE_INSTANCE_FINGERPRINT_HEADER" \
    -v fingerprint="$WEBSITE_INSTANCE_EXPECTED_FINGERPRINT" \
    -v instance_header="$WEBSITE_INSTANCE_ID_HEADER" \
    -v instance_id="$WEBSITE_INSTANCE_EXPECTED_ID" '
      BEGIN {
        fingerprint_header = tolower(fingerprint_header)
        instance_header = tolower(instance_header)
      }
      {
        sub(/\r$/, "")
        separator = index($0, ":")
        if (separator > 0) {
          name = tolower(substr($0, 1, separator - 1))
          value = substr($0, separator + 1)
          sub(/^[[:space:]]+/, "", value)
          sub(/[[:space:]]+$/, "", value)
          if (name == fingerprint_header) {
            fingerprint_count += 1
            if (value == fingerprint) fingerprint_match += 1
          }
          if (name == instance_header) {
            instance_count += 1
            if (value == instance_id) instance_match += 1
          }
        }
      }
      END { exit !(fingerprint_count == 1 && fingerprint_match == 1 && instance_count == 1 && instance_match == 1) }
    ' "$headers_file"; then
    status=1
  fi
  rm -f "$headers_file"
  return "$status"
}

wait_for_fresh_supervisor() {
  local expected_token="$1"
  local retries="${2:-$WEBSITE_START_TIMEOUT}"
  local attestation
  local _token
  local supervisor_pid
  local supervisor_start_ticks

  while [ "$retries" -gt 0 ]; do
    attestation="$(read_supervisor_attestation "$expected_token" 2>/dev/null || true)"
    if [[ -n "$attestation" ]]; then
      IFS=$'\t' read -r _token supervisor_pid supervisor_start_ticks <<<"$attestation"
      if is_owned_website_supervisor "$supervisor_pid" "$supervisor_start_ticks"; then
        printf '%s\t%s\n' "$supervisor_pid" "$supervisor_start_ticks"
        return 0
      fi
    fi
    sleep 1
    retries=$((retries - 1))
  done

  return 1
}

wait_for_attested_site_or_supervisor() {
  local url="$1"
  local supervisor_pid="$2"
  local supervisor_start_ticks="$3"
  local retries="${4:-$WEBSITE_START_TIMEOUT}"
  local listener_pid
  local listener_owned

  while [ "$retries" -gt 0 ]; do
    if ! is_owned_website_supervisor "$supervisor_pid" "$supervisor_start_ticks"; then
      return 2
    fi

    listener_owned=0
    while IFS= read -r listener_pid; do
      [[ -n "$listener_pid" ]] || continue
      if is_owned_website_listener "$listener_pid" "$supervisor_pid" "$supervisor_start_ticks"; then
        listener_owned=1
        break
      fi
    done < <(port_listener_pids "$WEBSITE_PORT")

    if [[ "$listener_owned" == "1" ]] && response_matches_instance_identity "$url"; then
      # Recheck the owned process after the response so a listener replacement
      # between the port probe and curl cannot be mistaken for this instance.
      if is_owned_website_supervisor "$supervisor_pid" "$supervisor_start_ticks" && is_owned_website_listener "$listener_pid" "$supervisor_pid" "$supervisor_start_ticks"; then
        return 0
      fi
    fi
    sleep 1
    retries=$((retries - 1))
  done

  return 1
}

wait_for_site_or_supervisor() {
  local url="$1"
  local supervisor_pid="$2"
  local retries="${3:-$WEBSITE_START_TIMEOUT}"

  while [ "$retries" -gt 0 ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    if [[ -n "$supervisor_pid" ]] && ! kill -0 "$supervisor_pid" >/dev/null 2>&1; then
      return 2
    fi
    sleep 1
    retries=$((retries - 1))
  done

  return 1
}

write_instance_state() {
  local supervisor_pid="$1"
  local supervisor_start_ticks="$2"
  local state_directory
  local temporary_file

  [[ "$WEBSITE_INSTANCE_CONTRACT_ACTIVE" == "1" ]] || return 0
  state_directory="$(dirname "$WEBSITE_INSTANCE_STATE_FILE")"
  mkdir -p "$state_directory"
  temporary_file="$WEBSITE_INSTANCE_STATE_FILE.tmp.$$"

  WEBSITE_INSTANCE_STATE_FILE="$WEBSITE_INSTANCE_STATE_FILE" \
    WEBSITE_INSTANCE_STATE_TEMPORARY_FILE="$temporary_file" \
    WEBSITE_INSTANCE_STATE_SUPERVISOR_PID="$supervisor_pid" \
    WEBSITE_INSTANCE_STATE_SUPERVISOR_START_TICKS="$supervisor_start_ticks" \
    WEBSITE_INSTANCE_STATE_SOURCE_ROOT="$WEBSITE_SOURCE_ROOT" \
    WEBSITE_INSTANCE_STATE_WEBSITE_DIR="$WEBSITE_DIR" \
    WEBSITE_INSTANCE_STATE_ROUTE="$WEBSITE_ROUTE" \
    WEBSITE_INSTANCE_STATE_HOST="$WEBSITE_HOST" \
    WEBSITE_INSTANCE_STATE_PORT="$WEBSITE_PORT" \
    WEBSITE_INSTANCE_STATE_FINGERPRINT="$WEBSITE_INSTANCE_EXPECTED_FINGERPRINT" \
    WEBSITE_INSTANCE_STATE_INSTANCE_ID="$WEBSITE_INSTANCE_EXPECTED_ID" \
    WEBSITE_INSTANCE_STATE_DIST_DIR="$WEBSITE_LOCAL_PREVIEW_DIST_DIR" \
    node -e '
      const fs = require("node:fs")
      const output = process.env.WEBSITE_INSTANCE_STATE_FILE
      const temporary = process.env.WEBSITE_INSTANCE_STATE_TEMPORARY_FILE
      const state = {
        version: 1,
        supervisorPid: Number(process.env.WEBSITE_INSTANCE_STATE_SUPERVISOR_PID),
        supervisorStartTicks: process.env.WEBSITE_INSTANCE_STATE_SUPERVISOR_START_TICKS,
        sourceRoot: process.env.WEBSITE_INSTANCE_STATE_SOURCE_ROOT,
        websiteDir: process.env.WEBSITE_INSTANCE_STATE_WEBSITE_DIR,
        route: process.env.WEBSITE_INSTANCE_STATE_ROUTE,
        host: process.env.WEBSITE_INSTANCE_STATE_HOST,
        port: Number(process.env.WEBSITE_INSTANCE_STATE_PORT),
        fingerprint: process.env.WEBSITE_INSTANCE_STATE_FINGERPRINT,
        instanceId: process.env.WEBSITE_INSTANCE_STATE_INSTANCE_ID,
        distDir: process.env.WEBSITE_INSTANCE_STATE_DIST_DIR || null,
        startedAt: new Date().toISOString(),
      }
      fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 })
      fs.renameSync(temporary, output)
    '
}

open_browser() {
  if command -v open >/dev/null 2>&1; then
    open "$DEFAULT_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$DEFAULT_URL" >/dev/null 2>&1 || true
  fi
}

run_website_supervisor() {
  local server_pid
  local supervisor_start_ticks

  if [[ "$WEBSITE_INSTANCE_CONTRACT_ACTIVE" == "1" ]]; then
    supervisor_start_ticks="$(pid_start_ticks "$$" 2>/dev/null || true)"
    if [[ -z "$WEBSITE_SUPERVISOR_TOKEN" ]]; then
      WEBSITE_SUPERVISOR_TOKEN="$(date '+%s').$$.$RANDOM"
    fi
    if [[ -n "$supervisor_start_ticks" ]]; then
      write_supervisor_attestation "$$" "$supervisor_start_ticks" "$WEBSITE_SUPERVISOR_TOKEN"
    fi
  fi

  if [[ "$WEBSITE_SUPERVISOR_MODE" == "1" ]]; then
    nohup npm --prefix "$WEBSITE_DIR" run dev -- --hostname "$WEBSITE_HOST" --port "$WEBSITE_PORT" >>"$LOG_FILE" 2>&1 < /dev/null &
    server_pid=$!
  else
    npm --prefix "$WEBSITE_DIR" run dev -- --hostname "$WEBSITE_HOST" --port "$WEBSITE_PORT" &
    server_pid=$!
  fi

  echo "$$" > "$PID_FILE"

  cleanup() {
    if [[ -n "${server_pid:-}" ]]; then
      terminate_pid "$server_pid"
    fi
    if [ -f "$PID_FILE" ]; then
      local tracked_pid
      tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
      if [ "$tracked_pid" = "$$" ]; then
        rm -f "$PID_FILE"
        rm -f "$PORT_FILE"
        if [[ "$WEBSITE_INSTANCE_CONTRACT_ACTIVE" == "1" ]]; then
          remove_supervisor_attestation_if_current "$WEBSITE_SUPERVISOR_TOKEN"
        fi
      fi
    fi
  }

  trap cleanup EXIT INT TERM
  wait "$server_pid"
}

start_detached_supervisor() {
  if [[ "$WEBSITE_INSTANCE_CONTRACT_ACTIVE" == "1" && -z "$WEBSITE_SUPERVISOR_TOKEN" ]]; then
    WEBSITE_SUPERVISOR_TOKEN="$(date '+%s').$$.$RANDOM"
  fi
  nohup setsid env \
    OPEN_BROWSER=0 \
    WEBSITE_SUPERVISOR_MODE=1 \
    WEBSITE_DETACH=0 \
    WEBSITE_SOURCE_ROOT="$WEBSITE_SOURCE_ROOT" \
    WEBSITE_HOST="$WEBSITE_HOST" \
    WEBSITE_PORT="$WEBSITE_PORT" \
    WEBSITE_STATE_DIR="$WEBSITE_STATE_DIR" \
    WEBSITE_PID_FILE="$PID_FILE" \
    WEBSITE_LOG_FILE="$LOG_FILE" \
    WEBSITE_PORT_FILE="$PORT_FILE" \
    WEBSITE_ROUTE="$WEBSITE_ROUTE" \
    WEBSITE_INSTANCE_FINGERPRINT="$WEBSITE_INSTANCE_FINGERPRINT" \
    WEBSITE_INSTANCE_ID="$WEBSITE_INSTANCE_ID" \
    WEBSITE_INSTANCE_EXPECTED_FINGERPRINT="$WEBSITE_INSTANCE_EXPECTED_FINGERPRINT" \
    WEBSITE_INSTANCE_EXPECTED_ID="$WEBSITE_INSTANCE_EXPECTED_ID" \
    WEBSITE_INSTANCE_FINGERPRINT_HEADER="$WEBSITE_INSTANCE_FINGERPRINT_HEADER" \
    WEBSITE_INSTANCE_ID_HEADER="$WEBSITE_INSTANCE_ID_HEADER" \
    WEBSITE_INSTANCE_STATE_FILE="$WEBSITE_INSTANCE_STATE_FILE" \
    WEBSITE_SUPERVISOR_TOKEN_FILE="$WEBSITE_SUPERVISOR_TOKEN_FILE" \
    WEBSITE_SUPERVISOR_TOKEN="$WEBSITE_SUPERVISOR_TOKEN" \
    WEBSITE_ALLOW_PORT_FALLBACK="$WEBSITE_ALLOW_PORT_FALLBACK" \
    WEBSITE_LOCAL_PREVIEW_DIST_DIR="$WEBSITE_LOCAL_PREVIEW_DIST_DIR" \
    SKINCOS_LOCAL_PREVIEW_DIST_DIR="$SKINCOS_LOCAL_PREVIEW_DIST_DIR" \
    SKINCOS_LOCAL_PREVIEW="${SKINCOS_LOCAL_PREVIEW:-}" \
    SKINCOS_LOCAL_PREVIEW_FINGERPRINT="$SKINCOS_LOCAL_PREVIEW_FINGERPRINT" \
    SKINCOS_LOCAL_PREVIEW_INSTANCE="$SKINCOS_LOCAL_PREVIEW_INSTANCE" \
    NEXT_TELEMETRY_DISABLED="${NEXT_TELEMETRY_DISABLED:-}" \
    NEXT_PUBLIC_BUILD_SHA="${NEXT_PUBLIC_BUILD_SHA:-}" \
    NEXT_PUBLIC_BUILD_TIME="${NEXT_PUBLIC_BUILD_TIME:-}" \
    TMPDIR="${TMPDIR:-}" \
    TMP="${TMP:-}" \
    TEMP="${TEMP:-}" \
    XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-}" \
    bash "$SCRIPT_PATH" >>"$LOG_FILE" 2>&1 < /dev/null &
  DETACHED_SUPERVISOR_PID=$!
}

website_workerd_ready() {
  (
    cd "$WEBSITE_DIR"
    node -e "require('workerd')" >/dev/null 2>&1
  )
}

ensure_website_dependencies() {
  if [ ! -d "$WEBSITE_DIR/node_modules" ]; then
    echo "Dependências do website não encontradas. Instalando..."
    npm --prefix "$WEBSITE_DIR" install
    return 0
  fi

  if [[ "$WEBSITE_SKIP_WORKERD_CHECK" != "1" ]] && ! website_workerd_ready; then
    echo "Dependências do website foram instaladas para outra plataforma. Reinstalando o workerd no WSL..."
    rm -rf "$WEBSITE_DIR/node_modules/workerd" "$WEBSITE_DIR/node_modules"/@cloudflare/workerd-*
    npm --prefix "$WEBSITE_DIR" install --no-save workerd
  fi
}

# Shell fixtures source the reusable process and readiness helpers without
# launching npm.  This branch is intentionally opt-in and has no effect on
# normal callers.
if [[ "${RUN_LOCAL_WEBSITE_LIBRARY:-0}" == "1" ]]; then
  return 0 2>/dev/null || exit 0
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm não encontrado no PATH."
  exit 1
fi

if [[ "$STOP_ONLY" = "1" ]]; then
  mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$PORT_FILE")"
  stop_existing_site
  echo "Website local encerrado."
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl não encontrado no PATH."
  exit 1
fi

mkdir -p "$(dirname "$PID_FILE")" "$(dirname "$LOG_FILE")" "$(dirname "$PORT_FILE")"
touch "$LOG_FILE"

if [[ ! -d "$WEBSITE_DIR" ]]; then
  echo "Diretório do website não encontrado em $WEBSITE_DIR." >&2
  exit 1
fi

cd "$WEBSITE_SOURCE_ROOT"

ensure_website_dependencies

if [[ "$WEBSITE_SUPERVISOR_MODE" == "1" ]]; then
  run_website_supervisor
  exit $?
fi

stop_existing_site
resolve_website_port "$WEBSITE_PORT"
DEFAULT_URL="http://localhost:${WEBSITE_PORT}${WEBSITE_ROUTE}"
NETWORK_URL="http://${WEBSITE_HOST}:${WEBSITE_PORT}${WEBSITE_ROUTE}"
echo "$WEBSITE_PORT" > "$PORT_FILE"

echo ""
echo "SKINCOS • Website local"
echo "Iniciando ambiente local em $DEFAULT_URL"
echo "Host: $WEBSITE_HOST"
echo "Porta: $WEBSITE_PORT"
if [[ -n "${PORT_SELECTION_NOTE:-}" ]]; then
  echo "$PORT_SELECTION_NOTE"
fi
echo ""
echo "URLs:"
echo "  Local  : $DEFAULT_URL"
echo "  Rede   : $NETWORK_URL"
echo "Log: $LOG_FILE"
echo "PID: $PID_FILE"
echo "Porta: $PORT_FILE"
echo ""

printf '\n[%s] Starting website local on %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$DEFAULT_URL" >>"$LOG_FILE"

if [[ "$WEBSITE_DETACH" == "1" ]]; then
  startup_status=0
  supervisor_attestation=""
  supervisor_pid=""
  supervisor_start_ticks=""
  rm -f "$WEBSITE_SUPERVISOR_TOKEN_FILE"
  start_detached_supervisor
  if [[ "$WEBSITE_INSTANCE_CONTRACT_ACTIVE" == "1" ]]; then
    supervisor_attestation="$(wait_for_fresh_supervisor "$WEBSITE_SUPERVISOR_TOKEN" || true)"
    if [[ -z "$supervisor_attestation" ]]; then
      startup_status=2
    else
      IFS=$'\t' read -r supervisor_pid supervisor_start_ticks <<<"$supervisor_attestation"
      wait_for_attested_site_or_supervisor "$DEFAULT_URL" "$supervisor_pid" "$supervisor_start_ticks" || startup_status=$?
    fi
  else
    wait_for_site_or_supervisor "$DEFAULT_URL" "${DETACHED_SUPERVISOR_PID:-}" || startup_status=$?
  fi
  if [[ "$startup_status" -eq 0 ]]; then
    if [[ "$WEBSITE_INSTANCE_CONTRACT_ACTIVE" == "1" ]]; then
      write_instance_state "$supervisor_pid" "$supervisor_start_ticks"
    fi
    echo "Website local pronto em $DEFAULT_URL"
    exit 0
  fi
  if [[ "$startup_status" -eq 2 ]]; then
    echo "O processo do website encerrou antes de responder. Veja o log em $LOG_FILE." >&2
  else
    echo "O site não respondeu em $DEFAULT_URL dentro do tempo esperado. Veja o log em $LOG_FILE." >&2
  fi
  stop_existing_site
  exit 1
fi

if [ "$OPEN_BROWSER" = "1" ]; then
  (
    if wait_for_site "$DEFAULT_URL"; then
      open_browser
    else
      echo "O site não respondeu em $DEFAULT_URL dentro do tempo esperado."
    fi
  ) &
fi

run_website_supervisor
