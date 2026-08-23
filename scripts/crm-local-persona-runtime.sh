#!/usr/bin/env bash

crm_persona_runtime_init() {
  CRM_PERSONA="${CRM_PERSONA:-GESTOR}"
  CRM_RUNTIME_MODULE="${CRM_RUNTIME_MODULE:-${CRM_MODULE:-full}}"
  CRM_RUNTIME_ID="${CRM_RUNTIME_ID:-${CRM_PERSONA,,}--${CRM_RUNTIME_MODULE}}"
  CRM_RUNTIME_ROOT="${CRM_RUNTIME_ROOT:-/mnt/c/CodexRuntime/operator/admin/skincos/runtime/crm-local/instances/${CRM_PERSONA,,}/${CRM_RUNTIME_MODULE}}"
  CRM_RUNTIME_MANIFEST="${CRM_RUNTIME_MANIFEST:-$CRM_RUNTIME_ROOT/current.json}"
  CRM_RUNTIME_LOCK_DIR="${CRM_RUNTIME_LOCK_DIR:-$CRM_RUNTIME_ROOT/launch.lock}"
  CRM_BUILD_STATE_FILE="${CRM_BUILD_STATE_FILE:-$CRM_RUNTIME_ROOT/build-state.json}"
  CRM_RUNTIME_STARTED_AT="${CRM_RUNTIME_STARTED_AT:-$(date -Iseconds)}"
  CRM_TARGET_COMMIT="${CRM_TARGET_COMMIT:-$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || printf unknown)}"
  CRM_SOURCE_FINGERPRINT="${CRM_SOURCE_FINGERPRINT:-commit:$CRM_TARGET_COMMIT}"
  CRM_SOURCE_ORIGIN="${CRM_SOURCE_ORIGIN:-$ROOT_DIR}"
  CRM_RUNTIME_CONFIG_FINGERPRINT="${CRM_RUNTIME_CONFIG_FINGERPRINT:-}"
  CRM_BUILD_INPUT_FINGERPRINT="${CRM_BUILD_INPUT_FINGERPRINT:-}"
  CRM_BUILD_LOCKFILE_FINGERPRINT="${CRM_BUILD_LOCKFILE_FINGERPRINT:-}"
  CRM_BUILD_ARTIFACT_FINGERPRINT="${CRM_BUILD_ARTIFACT_FINGERPRINT:-}"
  CRM_BUILD_COMMIT="${CRM_BUILD_COMMIT:-}"
  CRM_RUNTIME_LOCK_HELD=0
  CRM_RUNTIME_LOCK_TOKEN=""
  CRM_RUNTIME_OBSERVED_LOCK_TOKEN=""
  CRM_RUNTIME_OBSERVED_LOCK_PID=""
  CRM_RUNTIME_OBSERVED_LOCK_START_TICKS=""
  CRM_RUNTIME_LOCK_PARTIAL_TTL="${CRM_RUNTIME_LOCK_PARTIAL_TTL:-30}"
  CRM_RUNTIME_LOCK_WAIT_ATTEMPTS="${CRM_RUNTIME_LOCK_WAIT_ATTEMPTS:-320}"
  export CRM_PERSONA CRM_RUNTIME_MODULE CRM_RUNTIME_ID CRM_RUNTIME_STARTED_AT
  export CRM_TARGET_COMMIT CRM_SOURCE_FINGERPRINT CRM_SOURCE_ORIGIN
  export CRM_RUNTIME_CONFIG_FINGERPRINT
  mkdir -p "$CRM_RUNTIME_ROOT"
}

crm_runtime_port_is_free() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    if ss -H -ltn "sport = :$port" | grep -q .; then
      return 1
    fi
  elif lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | grep -q .; then
    return 1
  fi
  # A Windows-owned wslrelay listener is not always visible to ss/lsof inside
  # the distro. Probe raw TCP as a second, protocol-neutral boundary.
  if command -v timeout >/dev/null 2>&1 &&
     timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/${port}" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

crm_runtime_pid_start_ticks() {
  local pid="${1:-}"
  if [[ ! "$pid" =~ ^[0-9]+$ || ! -r "/proc/$pid/stat" ]]; then
    return 1
  fi
  # Field 2 (comm) is parenthesized and may contain spaces or closing
  # parentheses. Strip through its final ") " delimiter; starttime is then
  # field 20 of the remaining sequence (original /proc field 22).
  tr '\n' ' ' < "/proc/$pid/stat" 2>/dev/null | sed 's/^.*) //' | awk '{print $20}'
}

crm_runtime_pid_identity_matches() {
  local pid="${1:-}"
  local expected_ticks="${2:-}"
  [[ "$pid" =~ ^[0-9]+$ && "$expected_ticks" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  [[ "$(crm_runtime_pid_start_ticks "$pid" 2>/dev/null || true)" == "$expected_ticks" ]]
}

crm_persona_runtime_manifest_is_ready() {
  [[ -f "$CRM_RUNTIME_MANIFEST" ]] || return 1
  local owner_identity
  local owner_pid
  local owner_ticks
  owner_identity="$(
    CRM_EXPECTED_RUNTIME_ID="$CRM_RUNTIME_ID" \
    CRM_EXPECTED_MODULE="$CRM_RUNTIME_MODULE" \
    CRM_EXPECTED_PERSONA="$CRM_PERSONA" \
    CRM_EXPECTED_TARGET_COMMIT="$CRM_TARGET_COMMIT" \
    CRM_EXPECTED_SOURCE_FINGERPRINT="$CRM_SOURCE_FINGERPRINT" \
    CRM_EXPECTED_SOURCE_ORIGIN="$CRM_SOURCE_ORIGIN" \
    CRM_EXPECTED_CONFIG_FINGERPRINT="$CRM_RUNTIME_CONFIG_FINGERPRINT" \
    node - "$CRM_RUNTIME_MANIFEST" <<'NODE'
const fs = require('fs')
try {
  const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const exact = (actual, expected) => String(actual || '') === String(expected || '')
  const ready = value?.version === 3 &&
    value.state === 'ready' &&
    exact(value.runtimeId, process.env.CRM_EXPECTED_RUNTIME_ID) &&
    exact(value.module, process.env.CRM_EXPECTED_MODULE) &&
    String(value.persona || '').toUpperCase() === String(process.env.CRM_EXPECTED_PERSONA || '').toUpperCase() &&
    exact(value.targetCommit, process.env.CRM_EXPECTED_TARGET_COMMIT) &&
    exact(value.sourceFingerprint, process.env.CRM_EXPECTED_SOURCE_FINGERPRINT) &&
    exact(value.sourceOrigin, process.env.CRM_EXPECTED_SOURCE_ORIGIN) &&
    exact(value.configFingerprint, process.env.CRM_EXPECTED_CONFIG_FINGERPRINT) &&
    Number.isInteger(value?.pids?.launcher) &&
    Number.isInteger(value?.pidStartTicks?.launcher)
  if (!ready) process.exit(2)
  process.stdout.write(`${value.pids.launcher}:${value.pidStartTicks.launcher}`)
} catch {
  process.exit(2)
}
NODE
  )" || return 1
  IFS=: read -r owner_pid owner_ticks <<< "$owner_identity"
  if [[ -n "${CRM_RUNTIME_OBSERVED_LOCK_TOKEN:-}" ]]; then
    local lock_owner=""
    local lock_token lock_pid lock_ticks lock_runtime_id lock_source lock_config lock_created
    lock_owner="$(crm_runtime_read_lock_owner "$CRM_RUNTIME_LOCK_DIR/owner.json" 2>/dev/null || true)"
    [[ -n "$lock_owner" ]] || return 1
    IFS='|' read -r lock_token lock_pid lock_ticks lock_runtime_id lock_source lock_config lock_created <<< "$lock_owner"
    [[ "$lock_token" == "$CRM_RUNTIME_OBSERVED_LOCK_TOKEN" &&
       "$lock_pid" == "$CRM_RUNTIME_OBSERVED_LOCK_PID" &&
       "$lock_ticks" == "$CRM_RUNTIME_OBSERVED_LOCK_START_TICKS" &&
       "$owner_pid" == "$lock_pid" &&
       "$owner_ticks" == "$lock_ticks" ]] || return 1
  fi
  crm_runtime_pid_identity_matches "$owner_pid" "$owner_ticks"
}

crm_persona_runtime_wait_ready() {
  local timeout_seconds="${1:-360}"
  [[ -n "${CRM_RUNTIME_OBSERVED_LOCK_TOKEN:-}" &&
     -n "${CRM_RUNTIME_OBSERVED_LOCK_PID:-}" &&
     -n "${CRM_RUNTIME_OBSERVED_LOCK_START_TICKS:-}" ]] || return 1
  local deadline=$(( $(date +%s) + timeout_seconds ))
  while (( $(date +%s) < deadline )); do
    if crm_persona_runtime_manifest_is_ready; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

crm_runtime_new_lock_token() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    tr -d '\r\n' < /proc/sys/kernel/random/uuid
    return
  fi
  printf '%s-%s-%s\n' "$$" "$(date +%s%N)" "$RANDOM"
}

crm_runtime_write_lock_owner() {
  local token="$1"
  local owner_file="$CRM_RUNTIME_LOCK_DIR/owner.json"
  local temporary="$CRM_RUNTIME_LOCK_DIR/.owner.${token}.tmp"
  local start_ticks
  start_ticks="$(crm_runtime_pid_start_ticks "$$")" || return 1

  CRM_LOCK_TOKEN="$token" \
  CRM_LOCK_PID="$$" \
  CRM_LOCK_START_TICKS="$start_ticks" \
  CRM_LOCK_RUNTIME_ID="$CRM_RUNTIME_ID" \
  CRM_LOCK_SOURCE_FINGERPRINT="$CRM_SOURCE_FINGERPRINT" \
  CRM_LOCK_CONFIG_FINGERPRINT="$CRM_RUNTIME_CONFIG_FINGERPRINT" \
  CRM_LOCK_CREATED_AT="$(date +%s)" \
  node - "$temporary" <<'NODE'
const fs = require('fs')
fs.writeFileSync(process.argv[2], `${JSON.stringify({
  version: 1,
  token: process.env.CRM_LOCK_TOKEN,
  pid: Number(process.env.CRM_LOCK_PID),
  startTicks: Number(process.env.CRM_LOCK_START_TICKS),
  runtimeId: process.env.CRM_LOCK_RUNTIME_ID,
  sourceFingerprint: process.env.CRM_LOCK_SOURCE_FINGERPRINT,
  configFingerprint: process.env.CRM_LOCK_CONFIG_FINGERPRINT,
  createdAtEpoch: Number(process.env.CRM_LOCK_CREATED_AT),
})}\n`, { mode: 0o600 })
NODE
  mv -f "$temporary" "$owner_file"
}

crm_runtime_read_lock_owner() {
  local owner_file="$1"
  [[ -f "$owner_file" ]] || return 1
  node - "$owner_file" <<'NODE'
const fs = require('fs')
try {
  const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const valid = value?.version === 1 &&
    typeof value.token === 'string' && value.token.length > 0 &&
    Number.isInteger(value.pid) && value.pid > 0 &&
    Number.isInteger(value.startTicks) && value.startTicks > 0 &&
    typeof value.runtimeId === 'string' && value.runtimeId.length > 0 &&
    typeof value.sourceFingerprint === 'string' &&
    typeof value.configFingerprint === 'string' &&
    Number.isInteger(value.createdAtEpoch)
  if (!valid) process.exit(2)
  const fields = [
    value.token,
    value.pid,
    value.startTicks,
    value.runtimeId,
    value.sourceFingerprint,
    value.configFingerprint,
    value.createdAtEpoch,
  ]
  if (fields.some((field) => String(field).includes('|') || String(field).includes('\n'))) process.exit(2)
  process.stdout.write(fields.join('|'))
} catch {
  process.exit(2)
}
NODE
}

crm_runtime_dispose_quarantined_lock() {
  local quarantine="$1"
  rm -f -- "$quarantine/owner.json" "$quarantine"/.owner.*.tmp 2>/dev/null || true
  if ! rmdir "$quarantine" 2>/dev/null; then
    echo "[crm-local] Lock em quarentena contém estado desconhecido e não será removido: $quarantine" >&2
    return 1
  fi
}

crm_runtime_quarantine_stale_lock() {
  local reason="$1"
  local token
  local quarantine
  token="$(crm_runtime_new_lock_token)"
  quarantine="${CRM_RUNTIME_LOCK_DIR}.stale.${token}"
  if ! mv "$CRM_RUNTIME_LOCK_DIR" "$quarantine" 2>/dev/null; then
    return 1
  fi
  echo "[crm-local] Recuperando lock órfão de $CRM_RUNTIME_ID ($reason)."
  crm_runtime_dispose_quarantined_lock "$quarantine"
}

crm_persona_runtime_acquire_lock() {
  local attempt=0
  local token
  local owner_line
  local owner_token owner_pid owner_ticks owner_runtime_id owner_source owner_config owner_created
  local lock_mtime lock_age now
  CRM_RUNTIME_OBSERVED_LOCK_TOKEN=""
  CRM_RUNTIME_OBSERVED_LOCK_PID=""
  CRM_RUNTIME_OBSERVED_LOCK_START_TICKS=""

  while (( attempt < CRM_RUNTIME_LOCK_WAIT_ATTEMPTS )); do
    token="$(crm_runtime_new_lock_token)"
    if mkdir "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null; then
      if ! crm_runtime_write_lock_owner "$token"; then
        rm -f -- "$CRM_RUNTIME_LOCK_DIR"/.owner.*.tmp "$CRM_RUNTIME_LOCK_DIR/owner.json" 2>/dev/null || true
        rmdir "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null || true
        echo "[crm-local] Não foi possível publicar o owner atômico do lock de $CRM_RUNTIME_ID." >&2
        return 1
      fi
      CRM_RUNTIME_LOCK_TOKEN="$token"
      CRM_RUNTIME_LOCK_HELD=1
      return 0
    fi

    owner_line="$(crm_runtime_read_lock_owner "$CRM_RUNTIME_LOCK_DIR/owner.json" 2>/dev/null || true)"
    if [[ -n "$owner_line" ]]; then
      IFS='|' read -r owner_token owner_pid owner_ticks owner_runtime_id owner_source owner_config owner_created <<< "$owner_line"
      if crm_runtime_pid_identity_matches "$owner_pid" "$owner_ticks"; then
        if [[ "$owner_runtime_id" != "$CRM_RUNTIME_ID" ]]; then
          echo "[crm-local] O diretório de lock pertence ao runtime vivo '$owner_runtime_id'; '$CRM_RUNTIME_ID' não irá removê-lo." >&2
          return 4
        fi
        if [[ "$owner_source" != "$CRM_SOURCE_FINGERPRINT" || "$owner_config" != "$CRM_RUNTIME_CONFIG_FINGERPRINT" ]]; then
          echo "[crm-local] $CRM_RUNTIME_ID está em transição por outra revisão/configuração (PID $owner_pid)." >&2
          return 3
        fi
        CRM_RUNTIME_OBSERVED_LOCK_TOKEN="$owner_token"
        CRM_RUNTIME_OBSERVED_LOCK_PID="$owner_pid"
        CRM_RUNTIME_OBSERVED_LOCK_START_TICKS="$owner_ticks"
        echo "[crm-local] Runtime $CRM_RUNTIME_ID já está ativo (PID $owner_pid)."
        return 2
      fi
      crm_runtime_quarantine_stale_lock "owner morto ou PID reutilizado" || true
      attempt=$((attempt + 1))
      continue
    fi

    now="$(date +%s)"
    lock_mtime="$(stat -c %Y "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null || printf '%s' "$now")"
    lock_age=$((now - lock_mtime))
    if (( lock_age >= CRM_RUNTIME_LOCK_PARTIAL_TTL )); then
      crm_runtime_quarantine_stale_lock "owner ausente/inválido há ${lock_age}s" || true
      attempt=$((attempt + 1))
      continue
    fi
    sleep 0.1
    attempt=$((attempt + 1))
  done

  echo "[crm-local] Tempo limite ao aguardar a publicação atômica do lock de $CRM_RUNTIME_ID." >&2
  return 1
}

crm_persona_runtime_release_lock() {
  if [[ "${CRM_RUNTIME_LOCK_HELD:-0}" == "1" ]]; then
    local owner_line=""
    local owner_token owner_pid owner_ticks owner_runtime_id owner_source owner_config owner_created
    local quarantine
    owner_line="$(crm_runtime_read_lock_owner "$CRM_RUNTIME_LOCK_DIR/owner.json" 2>/dev/null || true)"
    if [[ -n "$owner_line" ]]; then
      IFS='|' read -r owner_token owner_pid owner_ticks owner_runtime_id owner_source owner_config owner_created <<< "$owner_line"
    fi
    if [[ "$owner_token" == "$CRM_RUNTIME_LOCK_TOKEN" && "$owner_pid" == "$$" && "$owner_runtime_id" == "$CRM_RUNTIME_ID" ]]; then
      quarantine="${CRM_RUNTIME_LOCK_DIR}.release.${CRM_RUNTIME_LOCK_TOKEN}"
      if mv "$CRM_RUNTIME_LOCK_DIR" "$quarantine" 2>/dev/null; then
        crm_runtime_dispose_quarantined_lock "$quarantine" || true
      fi
    else
      echo "[crm-local] O lock de $CRM_RUNTIME_ID mudou de owner; o token antigo não irá removê-lo." >&2
    fi
    CRM_RUNTIME_LOCK_HELD=0
    CRM_RUNTIME_LOCK_TOKEN=""
  fi
}

crm_persona_runtime_write_manifest() {
  local state="$1"
  local temporary
  temporary="$(mktemp "${CRM_RUNTIME_MANIFEST}.tmp.XXXXXX")"
  CRM_RUNTIME_STATE="$state" \
  CRM_RUNTIME_UPDATED_AT="$(date -Iseconds)" \
  CRM_RUNTIME_LAUNCHER_PID="$$" \
  CRM_RUNTIME_LAUNCHER_START_TICKS="$(crm_runtime_pid_start_ticks "$$" 2>/dev/null || true)" \
  CRM_RUNTIME_CRM_PID="${CRM_PID:-}" \
  CRM_RUNTIME_CRM_START_TICKS="$(crm_runtime_pid_start_ticks "${CRM_PID:-}" 2>/dev/null || true)" \
  CRM_RUNTIME_INSUMOS_PID="${INSUMOS_PID:-}" \
  CRM_RUNTIME_INSUMOS_START_TICKS="$(crm_runtime_pid_start_ticks "${INSUMOS_PID:-}" 2>/dev/null || true)" \
  CRM_RUNTIME_TIMEKEEPING_PID="${TIMEKEEPING_PID:-}" \
  CRM_RUNTIME_TIMEKEEPING_START_TICKS="$(crm_runtime_pid_start_ticks "${TIMEKEEPING_PID:-}" 2>/dev/null || true)" \
  CRM_RUNTIME_WHATSAPP_PID="${WHATSAPP_ORCHESTRATOR_PID:-}" \
  CRM_RUNTIME_WHATSAPP_START_TICKS="$(crm_runtime_pid_start_ticks "${WHATSAPP_ORCHESTRATOR_PID:-}" 2>/dev/null || true)" \
  CRM_RUNTIME_TARGET_COMMIT="$CRM_TARGET_COMMIT" \
  CRM_RUNTIME_BUILD_COMMIT="$CRM_BUILD_COMMIT" \
  CRM_RUNTIME_SOURCE_FINGERPRINT="$CRM_SOURCE_FINGERPRINT" \
  CRM_RUNTIME_SOURCE_ORIGIN="$CRM_SOURCE_ORIGIN" \
  CRM_RUNTIME_CONFIG_FINGERPRINT="$CRM_RUNTIME_CONFIG_FINGERPRINT" \
  CRM_RUNTIME_BUILD_INPUT_FINGERPRINT="$CRM_BUILD_INPUT_FINGERPRINT" \
  CRM_RUNTIME_BUILD_LOCKFILE_FINGERPRINT="$CRM_BUILD_LOCKFILE_FINGERPRINT" \
  CRM_RUNTIME_BUILD_ARTIFACT_FINGERPRINT="$CRM_BUILD_ARTIFACT_FINGERPRINT" \
  CRM_RUNTIME_BROWSER_PROFILE="${CRM_BROWSER_PROFILE_DIR:-}" \
  CRM_RUNTIME_PAGES_STATE="${R2_PERSIST_DIR:-}" \
  CRM_RUNTIME_INSUMOS_STATE="${CRM_INSUMOS_PERSIST_DIR:-}" \
  CRM_RUNTIME_TIMEKEEPING_STATE="${CRM_TIMEKEEPING_PERSIST_DIR:-}" \
  CRM_RUNTIME_WHATSAPP_STATE="${CRM_LOCAL_WA_RUNTIME_HOME:-}" \
  ROOT_DIR="$ROOT_DIR" \
  DEFAULT_URL="$DEFAULT_URL" \
  LOG_FILE="$LOG_FILE" \
  CRM_PAGES_PORT="$CRM_PAGES_PORT" \
  CRM_VITE_PORT="$CRM_VITE_PORT" \
  CRM_WITH_INSUMOS="$CRM_WITH_INSUMOS" \
  CRM_INSUMOS_PORT="$CRM_INSUMOS_PORT" \
  CRM_WITH_TIMEKEEPING="$CRM_WITH_TIMEKEEPING" \
  CRM_TIMEKEEPING_PORT="$CRM_TIMEKEEPING_PORT" \
  CRM_WITH_WHATSAPP="$CRM_WITH_WHATSAPP" \
  CRM_WA_ORCHESTRATOR_PORT="$CRM_WA_ORCHESTRATOR_PORT" \
  node - "$temporary" <<'NODE'
const fs = require('fs')
const output = process.argv[2]
const number = (value) => /^\d+$/.test(value || '') ? Number(value) : null
const enabled = (value) => value === '1'
const payload = {
  version: 3,
  state: process.env.CRM_RUNTIME_STATE,
  runtimeId: process.env.CRM_RUNTIME_ID,
  module: process.env.CRM_RUNTIME_MODULE,
  persona: process.env.CRM_PERSONA,
  startedAt: process.env.CRM_RUNTIME_STARTED_AT,
  updatedAt: process.env.CRM_RUNTIME_UPDATED_AT,
  worktree: process.env.ROOT_DIR,
  url: process.env.DEFAULT_URL,
  targetCommit: process.env.CRM_RUNTIME_TARGET_COMMIT || null,
  buildCommit: process.env.CRM_RUNTIME_BUILD_COMMIT || null,
  sourceFingerprint: process.env.CRM_RUNTIME_SOURCE_FINGERPRINT || null,
  sourceOrigin: process.env.CRM_RUNTIME_SOURCE_ORIGIN || null,
  configFingerprint: process.env.CRM_RUNTIME_CONFIG_FINGERPRINT || null,
  build: {
    inputFingerprint: process.env.CRM_RUNTIME_BUILD_INPUT_FINGERPRINT || null,
    lockfileFingerprint: process.env.CRM_RUNTIME_BUILD_LOCKFILE_FINGERPRINT || null,
    artifactFingerprint: process.env.CRM_RUNTIME_BUILD_ARTIFACT_FINGERPRINT || null,
  },
  ports: {
    pages: number(process.env.CRM_PAGES_PORT),
    vite: number(process.env.CRM_VITE_PORT),
    insumos: enabled(process.env.CRM_WITH_INSUMOS) ? number(process.env.CRM_INSUMOS_PORT) : null,
    timekeeping: enabled(process.env.CRM_WITH_TIMEKEEPING) ? number(process.env.CRM_TIMEKEEPING_PORT) : null,
    whatsapp: enabled(process.env.CRM_WITH_WHATSAPP) ? number(process.env.CRM_WA_ORCHESTRATOR_PORT) : null,
  },
  pids: {
    launcher: number(process.env.CRM_RUNTIME_LAUNCHER_PID),
    pages: number(process.env.CRM_RUNTIME_CRM_PID),
    insumos: number(process.env.CRM_RUNTIME_INSUMOS_PID),
    timekeeping: number(process.env.CRM_RUNTIME_TIMEKEEPING_PID),
    whatsapp: number(process.env.CRM_RUNTIME_WHATSAPP_PID),
  },
  pidStartTicks: {
    launcher: number(process.env.CRM_RUNTIME_LAUNCHER_START_TICKS),
    pages: number(process.env.CRM_RUNTIME_CRM_START_TICKS),
    insumos: number(process.env.CRM_RUNTIME_INSUMOS_START_TICKS),
    timekeeping: number(process.env.CRM_RUNTIME_TIMEKEEPING_START_TICKS),
    whatsapp: number(process.env.CRM_RUNTIME_WHATSAPP_START_TICKS),
  },
  statePaths: {
    pages: process.env.CRM_RUNTIME_PAGES_STATE || null,
    insumos: process.env.CRM_RUNTIME_INSUMOS_STATE || null,
    timekeeping: process.env.CRM_RUNTIME_TIMEKEEPING_STATE || null,
    whatsapp: process.env.CRM_RUNTIME_WHATSAPP_STATE || null,
  },
  browserProfile: process.env.CRM_RUNTIME_BROWSER_PROFILE || null,
  log: process.env.LOG_FILE,
}
fs.writeFileSync(output, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 })
NODE
  mv -f "$temporary" "$CRM_RUNTIME_MANIFEST"
}

crm_persona_runtime_write_build_state() {
  CRM_BUILD_COMMIT="$CRM_TARGET_COMMIT"
  if [[ -z "$CRM_BUILD_COMMIT" || "$CRM_BUILD_COMMIT" == "unknown" ]]; then
    CRM_BUILD_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || printf unknown)"
  fi
  export CRM_BUILD_COMMIT
  CRM_BUILD_UPDATED_AT="$(date -Iseconds)" CRM_SOURCE_FINGERPRINT="$CRM_SOURCE_FINGERPRINT" CRM_SOURCE_ORIGIN="$CRM_SOURCE_ORIGIN" node - "$CRM_BUILD_STATE_FILE" <<'NODE'
const fs = require('fs')
fs.writeFileSync(process.argv[2], JSON.stringify({
  persona: process.env.CRM_PERSONA,
  commit: process.env.CRM_BUILD_COMMIT,
  sourceFingerprint: process.env.CRM_SOURCE_FINGERPRINT || null,
  sourceOrigin: process.env.CRM_SOURCE_ORIGIN || null,
  updatedAt: process.env.CRM_BUILD_UPDATED_AT,
}, null, 2) + '\n', { mode: 0o600 })
NODE
}

crm_persona_runtime_stop_manifest_owner() {
  CRM_STOP_OWNER_LAUNCHER_PID=""
  CRM_STOP_OWNER_LAUNCHER_TICKS=""
  [[ -f "$CRM_RUNTIME_MANIFEST" ]] || return 0
  local owner_identities=""
  owner_identities="$(ROOT_DIR="$ROOT_DIR" CRM_RUNTIME_ID="$CRM_RUNTIME_ID" node - "$CRM_RUNTIME_MANIFEST" <<'NODE'
const fs = require('fs')
try {
  const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  if (value.worktree === process.env.ROOT_DIR && value.runtimeId === process.env.CRM_RUNTIME_ID) {
    const names = ['launcher', 'pages', 'insumos', 'timekeeping', 'whatsapp']
    const identities = names.flatMap((name) => (
      Number.isInteger(value?.pids?.[name]) && Number.isInteger(value?.pidStartTicks?.[name])
        ? [`${name}:${value.pids[name]}:${value.pidStartTicks[name]}`]
        : []
    ))
    process.stdout.write(identities.join('\n'))
  }
} catch {}
NODE
)"
  local owner_name
  local owner_pid
  local owner_ticks
  while IFS=: read -r owner_name owner_pid owner_ticks; do
    [[ -n "$owner_name" ]] || continue
    if [[ "$owner_name" == "launcher" ]]; then
      CRM_STOP_OWNER_LAUNCHER_PID="$owner_pid"
      CRM_STOP_OWNER_LAUNCHER_TICKS="$owner_ticks"
    fi
    if [[ "$owner_pid" != "$$" ]] && crm_runtime_pid_identity_matches "$owner_pid" "$owner_ticks"; then
      echo "[crm-local] Encerrando processo identificado de $CRM_RUNTIME_ID ($owner_name, PID $owner_pid)."
      terminate_pid "$owner_pid"
    fi
  done <<< "$owner_identities"

  if [[ -n "$CRM_STOP_OWNER_LAUNCHER_PID" && -n "$CRM_STOP_OWNER_LAUNCHER_TICKS" && -f "$PID_FILE" ]]; then
    local tracked_pid tracked_ticks tracked_runtime_id
    tracked_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    tracked_ticks="$(cat "${PID_FILE}.start-ticks" 2>/dev/null || true)"
    tracked_runtime_id="$(cat "${PID_FILE}.runtime-id" 2>/dev/null || true)"
    if [[ "$tracked_pid" == "$CRM_STOP_OWNER_LAUNCHER_PID" &&
          "$tracked_ticks" == "$CRM_STOP_OWNER_LAUNCHER_TICKS" &&
          "$tracked_runtime_id" == "$CRM_RUNTIME_ID" ]]; then
      rm -f "$PID_FILE" "${PID_FILE}.start-ticks" "${PID_FILE}.runtime-id"
    fi
  fi
}
