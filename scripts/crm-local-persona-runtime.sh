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
  # the distro. Probe loopback as a second, fail-closed ownership boundary.
  if command -v curl >/dev/null 2>&1 && curl -sS --connect-timeout 1 --max-time 1 "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

crm_runtime_pid_start_ticks() {
  local pid="${1:-}"
  if [[ ! "$pid" =~ ^[0-9]+$ || ! -r "/proc/$pid/stat" ]]; then
    return 1
  fi
  awk '{print $22}' "/proc/$pid/stat" 2>/dev/null
}

crm_runtime_pid_identity_matches() {
  local pid="${1:-}"
  local expected_ticks="${2:-}"
  [[ "$pid" =~ ^[0-9]+$ && "$expected_ticks" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  [[ "$(crm_runtime_pid_start_ticks "$pid" 2>/dev/null || true)" == "$expected_ticks" ]]
}

crm_persona_runtime_acquire_lock() {
  if mkdir "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$CRM_RUNTIME_LOCK_DIR/pid"
    crm_runtime_pid_start_ticks "$$" > "$CRM_RUNTIME_LOCK_DIR/start-ticks"
    printf '%s\n' "$CRM_RUNTIME_ID" > "$CRM_RUNTIME_LOCK_DIR/runtime-id"
    CRM_RUNTIME_LOCK_HELD=1
    return 0
  fi

  local owner_pid=""
  local owner_ticks=""
  local owner_runtime_id=""
  owner_pid="$(cat "$CRM_RUNTIME_LOCK_DIR/pid" 2>/dev/null || true)"
  owner_ticks="$(cat "$CRM_RUNTIME_LOCK_DIR/start-ticks" 2>/dev/null || true)"
  owner_runtime_id="$(cat "$CRM_RUNTIME_LOCK_DIR/runtime-id" 2>/dev/null || true)"
  if crm_runtime_pid_identity_matches "$owner_pid" "$owner_ticks" && [[ "$owner_runtime_id" == "$CRM_RUNTIME_ID" ]]; then
    echo "[crm-local] Runtime $CRM_RUNTIME_ID já está ativo (PID $owner_pid)."
    return 2
  fi

  rm -f "$CRM_RUNTIME_LOCK_DIR/pid" "$CRM_RUNTIME_LOCK_DIR/start-ticks" "$CRM_RUNTIME_LOCK_DIR/runtime-id" 2>/dev/null || true
  rmdir "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null || true
  mkdir "$CRM_RUNTIME_LOCK_DIR"
  printf '%s\n' "$$" > "$CRM_RUNTIME_LOCK_DIR/pid"
  crm_runtime_pid_start_ticks "$$" > "$CRM_RUNTIME_LOCK_DIR/start-ticks"
  printf '%s\n' "$CRM_RUNTIME_ID" > "$CRM_RUNTIME_LOCK_DIR/runtime-id"
  CRM_RUNTIME_LOCK_HELD=1
}

crm_persona_runtime_release_lock() {
  if [[ "${CRM_RUNTIME_LOCK_HELD:-0}" == "1" ]]; then
    rm -f "$CRM_RUNTIME_LOCK_DIR/pid" "$CRM_RUNTIME_LOCK_DIR/start-ticks" "$CRM_RUNTIME_LOCK_DIR/runtime-id" 2>/dev/null || true
    rmdir "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null || true
    CRM_RUNTIME_LOCK_HELD=0
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
    if [[ "$owner_pid" != "$$" ]] && crm_runtime_pid_identity_matches "$owner_pid" "$owner_ticks"; then
      echo "[crm-local] Encerrando processo identificado de $CRM_RUNTIME_ID ($owner_name, PID $owner_pid)."
      terminate_pid "$owner_pid"
    fi
  done <<< "$owner_identities"
}
