#!/usr/bin/env bash

crm_persona_runtime_init() {
  CRM_PERSONA="${CRM_PERSONA:-GESTOR}"
  CRM_RUNTIME_ROOT="${CRM_RUNTIME_ROOT:-/mnt/c/CodexRuntime/operator/admin/skincos/runtime/crm-local/${CRM_PERSONA,,}}"
  CRM_RUNTIME_MANIFEST="${CRM_RUNTIME_MANIFEST:-$CRM_RUNTIME_ROOT/current.json}"
  CRM_RUNTIME_LOCK_DIR="${CRM_RUNTIME_LOCK_DIR:-$CRM_RUNTIME_ROOT/launch.lock}"
  CRM_BUILD_STATE_FILE="${CRM_BUILD_STATE_FILE:-$CRM_RUNTIME_ROOT/build-state.json}"
  CRM_RUNTIME_STARTED_AT="${CRM_RUNTIME_STARTED_AT:-$(date -Iseconds)}"
  CRM_TARGET_COMMIT="${CRM_TARGET_COMMIT:-$(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || printf unknown)}"
  CRM_BUILD_COMMIT="${CRM_BUILD_COMMIT:-}"
  CRM_RUNTIME_LOCK_HELD=0
  mkdir -p "$CRM_RUNTIME_ROOT"
}

crm_persona_runtime_acquire_lock() {
  if mkdir "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "$$" > "$CRM_RUNTIME_LOCK_DIR/pid"
    CRM_RUNTIME_LOCK_HELD=1
    return 0
  fi

  local owner_pid=""
  owner_pid="$(cat "$CRM_RUNTIME_LOCK_DIR/pid" 2>/dev/null || true)"
  if [[ "$owner_pid" =~ ^[0-9]+$ ]] && kill -0 "$owner_pid" 2>/dev/null; then
    echo "[crm-local] Runtime de $CRM_PERSONA já está ativo (PID $owner_pid)."
    return 2
  fi

  rm -f "$CRM_RUNTIME_LOCK_DIR/pid" 2>/dev/null || true
  rmdir "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null || true
  mkdir "$CRM_RUNTIME_LOCK_DIR"
  printf '%s\n' "$$" > "$CRM_RUNTIME_LOCK_DIR/pid"
  CRM_RUNTIME_LOCK_HELD=1
}

crm_persona_runtime_release_lock() {
  if [[ "${CRM_RUNTIME_LOCK_HELD:-0}" == "1" ]]; then
    rm -f "$CRM_RUNTIME_LOCK_DIR/pid" 2>/dev/null || true
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
  CRM_RUNTIME_CRM_PID="${CRM_PID:-}" \
  CRM_RUNTIME_INSUMOS_PID="${INSUMOS_PID:-}" \
  CRM_RUNTIME_TIMEKEEPING_PID="${TIMEKEEPING_PID:-}" \
  CRM_RUNTIME_WHATSAPP_PID="${WHATSAPP_ORCHESTRATOR_PID:-}" \
  CRM_RUNTIME_TARGET_COMMIT="$CRM_TARGET_COMMIT" \
  CRM_RUNTIME_BUILD_COMMIT="$CRM_BUILD_COMMIT" \
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
  version: 2,
  state: process.env.CRM_RUNTIME_STATE,
  persona: process.env.CRM_PERSONA,
  startedAt: process.env.CRM_RUNTIME_STARTED_AT,
  updatedAt: process.env.CRM_RUNTIME_UPDATED_AT,
  worktree: process.env.ROOT_DIR,
  url: process.env.DEFAULT_URL,
  targetCommit: process.env.CRM_RUNTIME_TARGET_COMMIT || null,
  buildCommit: process.env.CRM_RUNTIME_BUILD_COMMIT || null,
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
  CRM_BUILD_UPDATED_AT="$(date -Iseconds)" node - "$CRM_BUILD_STATE_FILE" <<'NODE'
const fs = require('fs')
fs.writeFileSync(process.argv[2], JSON.stringify({
  persona: process.env.CRM_PERSONA,
  commit: process.env.CRM_BUILD_COMMIT,
  updatedAt: process.env.CRM_BUILD_UPDATED_AT,
}, null, 2) + '\n', { mode: 0o600 })
NODE
}

crm_persona_runtime_stop_manifest_owner() {
  [[ -f "$CRM_RUNTIME_MANIFEST" ]] || return 0
  local owner_pid=""
  owner_pid="$(ROOT_DIR="$ROOT_DIR" node - "$CRM_RUNTIME_MANIFEST" <<'NODE'
const fs = require('fs')
try {
  const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  if (value.worktree === process.env.ROOT_DIR && Number.isInteger(value?.pids?.launcher)) {
    process.stdout.write(String(value.pids.launcher))
  }
} catch {}
NODE
)"
  if [[ "$owner_pid" =~ ^[0-9]+$ ]] && kill -0 "$owner_pid" 2>/dev/null; then
    echo "[crm-local] Encerrando runtime identificado de $CRM_PERSONA (PID $owner_pid)."
    terminate_pid "$owner_pid"
  fi
}
