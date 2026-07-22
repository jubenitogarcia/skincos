#!/usr/bin/env bash
# Shared local CRM runtime bookkeeping. State deliberately lives outside Git.

crm_runtime_init() {
  CRM_OPERATOR_RUNTIME_ROOT="${CRM_OPERATOR_RUNTIME_ROOT:-/mnt/c/CodexRuntime/operator/admin/skincos}"
  CRM_RUNTIME_ROOT="${CRM_RUNTIME_ROOT:-$CRM_OPERATOR_RUNTIME_ROOT/runtime/crm-local}"
  CRM_RUNTIME_MANIFEST="${CRM_RUNTIME_MANIFEST:-$CRM_RUNTIME_ROOT/current.json}"
  CRM_RUNTIME_LOCK_DIR="${CRM_RUNTIME_LOCK_DIR:-$CRM_RUNTIME_ROOT/launch.lock}"
  CRM_RUNTIME_SESSION_ID="${CRM_RUNTIME_SESSION_ID:-crm-$(date +%Y%m%d%H%M%S)-$$}"
  CRM_RUNTIME_LOCK_HELD=0
  CRM_RUNTIME_PREFERRED_PAGES_PORT="${CRM_RUNTIME_PREFERRED_PAGES_PORT:-8791}"
  CRM_RUNTIME_PREFERRED_VITE_PORT="${CRM_RUNTIME_PREFERRED_VITE_PORT:-5173}"
  CRM_RUNTIME_PREFERRED_WA_PORT="${CRM_RUNTIME_PREFERRED_WA_PORT:-8110}"
  CRM_RUNTIME_PREFERRED_INSUMOS_PORT="${CRM_RUNTIME_PREFERRED_INSUMOS_PORT:-8787}"
  CRM_RUNTIME_PORT_RANGE="${CRM_RUNTIME_PORT_RANGE:-30}"
  CRM_RUNTIME_COMMIT="$(crm_runtime_git_commit)"
  mkdir -p "$CRM_RUNTIME_ROOT" "$CRM_RUNTIME_ROOT/sessions"
}

crm_runtime_git_commit() {
  local commit
  commit="$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
  if [[ -z "$commit" && -f "$ROOT_DIR/.git" ]] && command -v wslpath >/dev/null 2>&1; then
    local git_dir_raw git_dir
    git_dir_raw="$(sed -n 's/^gitdir: //p' "$ROOT_DIR/.git" | head -n 1)"
    git_dir="$(wslpath -u "$git_dir_raw" 2>/dev/null || true)"
    if [[ -n "$git_dir" ]]; then
      commit="$(git --git-dir="$git_dir" --work-tree="$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || true)"
    fi
  fi
  printf '%s' "${commit:-unknown}"
}

crm_runtime_release_lock() {
  if [[ "${CRM_RUNTIME_LOCK_HELD:-0}" == "1" ]]; then
    rm -f "$CRM_RUNTIME_LOCK_DIR/pid" "$CRM_RUNTIME_LOCK_DIR/session" 2>/dev/null || true
    rmdir "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null || true
    CRM_RUNTIME_LOCK_HELD=0
  fi
}

crm_runtime_acquire_lock() {
  local remaining="${1:-120}"
  while ! mkdir "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null; do
    local owner_pid=""
    owner_pid="$(cat "$CRM_RUNTIME_LOCK_DIR/pid" 2>/dev/null || true)"
    if [[ -n "$owner_pid" && ! "$owner_pid" =~ ^[0-9]+$ ]]; then
      owner_pid=""
    fi
    if [[ -n "$owner_pid" ]] && ! kill -0 "$owner_pid" 2>/dev/null; then
      rm -f "$CRM_RUNTIME_LOCK_DIR/pid" "$CRM_RUNTIME_LOCK_DIR/session" 2>/dev/null || true
      rmdir "$CRM_RUNTIME_LOCK_DIR" 2>/dev/null || true
      continue
    fi
    if [[ "$remaining" -le 0 ]]; then
      echo "[crm-local] Outro launcher ainda está preparando o CRM local; tente novamente em instantes." >&2
      return 1
    fi
    sleep 1
    remaining=$((remaining - 1))
  done
  printf '%s\n' "$$" > "$CRM_RUNTIME_LOCK_DIR/pid"
  printf '%s\n' "$CRM_RUNTIME_SESSION_ID" > "$CRM_RUNTIME_LOCK_DIR/session"
  CRM_RUNTIME_LOCK_HELD=1
}

crm_runtime_port_is_free() {
  local port="$1"
  # WSL can expose a Windows-owned localhost listener through wslrelay without
  # showing an owning Linux PID in lsof/ss. Every CRM-local dependency is HTTP,
  # so probe the loopback endpoint as a final guard before choosing a port.
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 1
    fi
  fi
  if ss -ltn "sport = :$port" 2>/dev/null | grep -q ":$port"; then
    return 1
  fi
  if curl --connect-timeout 1 --max-time 1 -sS "http://127.0.0.1:${port}/" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

crm_runtime_select_port() {
  local preferred="$1"
  local label="$2"
  local candidate
  local offset
  for ((offset = 0; offset <= CRM_RUNTIME_PORT_RANGE; offset += 1)); do
    candidate=$((preferred + offset))
    if crm_runtime_port_is_free "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  echo "[crm-local] Não há porta disponível para $label no intervalo ${preferred}-$((preferred + CRM_RUNTIME_PORT_RANGE))." >&2
  return 1
}

crm_runtime_select_ports() {
  CRM_VITE_PORT="$(crm_runtime_select_port "$CRM_RUNTIME_PREFERRED_VITE_PORT" vite)"
  CRM_PAGES_PORT="$(crm_runtime_select_port "$CRM_RUNTIME_PREFERRED_PAGES_PORT" pages)"
  if [[ "${CRM_WITH_WHATSAPP:-0}" == "1" ]]; then
    CRM_WA_ORCHESTRATOR_PORT="$(crm_runtime_select_port "$CRM_RUNTIME_PREFERRED_WA_PORT" whatsapp)"
  fi
  if [[ "${CRM_WITH_INSUMOS:-0}" == "1" ]]; then
    CRM_INSUMOS_PORT="$(crm_runtime_select_port "$CRM_RUNTIME_PREFERRED_INSUMOS_PORT" insumos)"
  fi
}

crm_runtime_fingerprint() {
  local dist_file="${FRONTEND_RUNTIME_DIR:-}/dist/index.html"
  local dist_hash="pending"
  if [[ -f "$dist_file" ]]; then
    dist_hash="$(sha256sum "$dist_file" | awk '{print substr($1, 1, 16)}')"
  fi
  printf '%s:%s' "$CRM_RUNTIME_COMMIT" "$dist_hash"
}

crm_runtime_write_manifest() {
  local state="$1"
  local manifest_tmp
  local session_manifest
  # Resolve at the write boundary as well: a Windows Git commit can occur
  # between launcher startup and the final readiness transition.
  CRM_RUNTIME_COMMIT="$(crm_runtime_git_commit)"
  mkdir -p "$(dirname "$CRM_RUNTIME_MANIFEST")" "$CRM_RUNTIME_ROOT/sessions"
  manifest_tmp="$(mktemp "${CRM_RUNTIME_MANIFEST}.tmp.XXXXXX")"
  session_manifest="$CRM_RUNTIME_ROOT/sessions/${CRM_RUNTIME_SESSION_ID}.json"
  CRM_RUNTIME_STATE="$state" \
  ROOT_DIR="$ROOT_DIR" \
  CRM_RUNTIME_SESSION_ID="$CRM_RUNTIME_SESSION_ID" \
  CRM_RUNTIME_COMMIT="$CRM_RUNTIME_COMMIT" \
  CRM_ROUTE="$CRM_ROUTE" \
  CRM_MODULE="$CRM_MODULE" \
  CRM_PAGES_PORT="$CRM_PAGES_PORT" \
  CRM_VITE_PORT="$CRM_VITE_PORT" \
  CRM_WA_ORCHESTRATOR_PORT="${CRM_WA_ORCHESTRATOR_PORT:-}" \
  CRM_INSUMOS_PORT="${CRM_INSUMOS_PORT:-}" \
  CRM_WITH_WHATSAPP="${CRM_WITH_WHATSAPP:-0}" \
  CRM_WITH_INSUMOS="${CRM_WITH_INSUMOS:-0}" \
  LOG_FILE="$LOG_FILE" \
  GATE_REPORT_FILE="${GATE_REPORT_FILE:-}" \
  CRM_RUNTIME_FINGERPRINT="$(crm_runtime_fingerprint)" \
  CRM_RUNTIME_URL="$DEFAULT_URL" \
  CRM_RUNTIME_CREATED_AT="${CRM_RUNTIME_CREATED_AT:-$(date -Iseconds)}" \
  CRM_RUNTIME_UPDATED_AT="$(date -Iseconds)" \
  CRM_RUNTIME_LAUNCHER_PID="$$" \
  CRM_RUNTIME_CRM_PID="${CRM_PID:-}" \
  CRM_RUNTIME_WA_PID="${WHATSAPP_ORCHESTRATOR_PID:-}" \
  CRM_RUNTIME_INSUMOS_PID="${INSUMOS_PID:-}" \
  node - "$manifest_tmp" "$session_manifest" <<'NODE'
const fs = require('fs')
const [temporary, sessionPath] = process.argv.slice(2)
const bool = (value) => String(value) === '1'
const numeric = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}
const payload = {
  version: 1,
  state: process.env.CRM_RUNTIME_STATE,
  sessionId: process.env.CRM_RUNTIME_SESSION_ID,
  startedAt: process.env.CRM_RUNTIME_CREATED_AT,
  updatedAt: process.env.CRM_RUNTIME_UPDATED_AT,
  launcherPid: numeric(process.env.CRM_RUNTIME_LAUNCHER_PID),
  url: process.env.CRM_RUNTIME_URL,
  route: process.env.CRM_ROUTE || '/',
  module: process.env.CRM_MODULE || null,
  worktree: process.env.ROOT_DIR,
  commit: process.env.CRM_RUNTIME_COMMIT,
  fingerprint: process.env.CRM_RUNTIME_FINGERPRINT,
  ports: {
    pages: numeric(process.env.CRM_PAGES_PORT),
    vite: numeric(process.env.CRM_VITE_PORT),
    whatsappAdapter: bool(process.env.CRM_WITH_WHATSAPP) ? numeric(process.env.CRM_WA_ORCHESTRATOR_PORT) : null,
    insumos: bool(process.env.CRM_WITH_INSUMOS) ? numeric(process.env.CRM_INSUMOS_PORT) : null,
  },
  pids: {
    launcher: numeric(process.env.CRM_RUNTIME_LAUNCHER_PID),
    pages: numeric(process.env.CRM_RUNTIME_CRM_PID),
    whatsappAdapter: numeric(process.env.CRM_RUNTIME_WA_PID),
    insumos: numeric(process.env.CRM_RUNTIME_INSUMOS_PID),
  },
  whatsapp: {
    enabled: bool(process.env.CRM_WITH_WHATSAPP),
    mode: bool(process.env.CRM_WITH_WHATSAPP) ? 'real' : 'disabled',
    localStub: false,
    effectiveTarget: bool(process.env.CRM_WITH_WHATSAPP) ? `http://127.0.0.1:${process.env.CRM_WA_ORCHESTRATOR_PORT}` : null,
  },
  logs: { launcher: process.env.LOG_FILE || null, gate: process.env.GATE_REPORT_FILE || null },
}
const data = JSON.stringify(payload, null, 2) + '\n'
fs.writeFileSync(temporary, data, { mode: 0o600 })
fs.writeFileSync(sessionPath, data, { mode: 0o600 })
NODE
  mv -f "$manifest_tmp" "$CRM_RUNTIME_MANIFEST"
}

crm_runtime_manifest_url() {
  [[ -f "$CRM_RUNTIME_MANIFEST" ]] || return 1
  node - "$CRM_RUNTIME_MANIFEST" <<'NODE'
const fs = require('fs')
try {
  const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const url = new URL(value.url)
  if (!/^https?:$/.test(url.protocol)) process.exit(1)
  process.stdout.write(url.toString())
} catch {
  process.exit(1)
}
NODE
}

crm_runtime_identity_url() {
  node - "$1" <<'NODE'
try {
  const url = new URL(process.argv[2])
  process.stdout.write(`${url.origin}/_local-runtime`)
} catch {
  process.exit(1)
}
NODE
}

crm_runtime_validate_identity() {
  local runtime_url="${1:-$DEFAULT_URL}"
  local identity_url
  local runtime_status
  identity_url="$(crm_runtime_identity_url "$runtime_url")" || return 1
  runtime_status="$(curl -fsS --max-time 5 "$identity_url" 2>/dev/null || true)"
  node - "$runtime_status" "$CRM_RUNTIME_SESSION_ID" "$ROOT_DIR" "$CRM_PAGES_PORT" "${CRM_WA_ORCHESTRATOR_PORT:-}" "${CRM_WITH_WHATSAPP:-0}" <<'NODE'
try {
  const [body, sessionId, worktree, pagesPort, waPort, whatsappEnabled] = process.argv.slice(2)
  const runtime = JSON.parse(body)
  const valid = runtime?.ok === true
    && runtime.sessionId === sessionId
    && runtime.worktree === worktree
    && Number(runtime?.ports?.pages) === Number(pagesPort)
  if (!valid) {
    console.error(`[crm-local] Identidade recebida: ${JSON.stringify({ ok: runtime?.ok, sessionId: runtime?.sessionId, worktree: runtime?.worktree, pages: runtime?.ports?.pages })}`)
    process.exit(1)
  }
  if (whatsappEnabled === '1') {
    const expectedTarget = `http://127.0.0.1:${waPort}`
    if (runtime?.whatsapp?.mode !== 'real' || runtime?.localStub !== false || runtime?.whatsapp?.effectiveTarget !== expectedTarget) {
      console.error(`[crm-local] Proxy WhatsApp recebido: ${JSON.stringify({ mode: runtime?.whatsapp?.mode, localStub: runtime?.localStub, effectiveTarget: runtime?.whatsapp?.effectiveTarget })}`)
      process.exit(1)
    }
  }
} catch {
  console.error('[crm-local] O endpoint /_local-runtime não retornou identidade JSON válida.')
  process.exit(1)
}
NODE
}

crm_runtime_reuse_if_healthy() {
  [[ -f "$CRM_RUNTIME_MANIFEST" ]] || return 1
  local candidate
  candidate="$(node - "$CRM_RUNTIME_MANIFEST" "$ROOT_DIR" "$CRM_RUNTIME_COMMIT" <<'NODE'
const fs = require('fs')
try {
  const [file, worktree, commit] = process.argv.slice(2)
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (value.state === 'ready' && value.worktree === worktree && value.commit === commit && value.url) process.stdout.write(JSON.stringify(value))
} catch {}
NODE
  )"
  [[ -n "$candidate" ]] || return 1
  local url session
  url="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(x.url)' "$candidate")"
  session="$(node -e 'const x=JSON.parse(process.argv[1]);process.stdout.write(x.sessionId)' "$candidate")"
  local runtime_status
  local identity_url
  identity_url="$(crm_runtime_identity_url "$url")" || return 1
  runtime_status="$(curl -fsS --max-time 3 "$identity_url" 2>/dev/null || true)"
  if node - "$candidate" "$runtime_status" "$session" <<'NODE'
try {
  const manifest = JSON.parse(process.argv[2])
  const runtime = JSON.parse(process.argv[3])
  if (runtime?.ok && runtime.sessionId === process.argv[4] && runtime.worktree === manifest.worktree && runtime.localStub === false) process.exit(0)
} catch {}
process.exit(1)
NODE
  then
    DEFAULT_URL="$url"
    echo "[crm-local] Reutilizando runtime saudável: $DEFAULT_URL"
    echo "CRM_LOCAL_RUNTIME_MANIFEST=$CRM_RUNTIME_MANIFEST"
    echo "CRM_LOCAL_URL=$DEFAULT_URL"
    return 0
  fi
  return 1
}

crm_runtime_export_pages_bindings() {
  export LOCAL_RUNTIME_SESSION_ID="$CRM_RUNTIME_SESSION_ID"
  export LOCAL_RUNTIME_WORKTREE="$ROOT_DIR"
  export LOCAL_RUNTIME_COMMIT="$CRM_RUNTIME_COMMIT"
  export LOCAL_RUNTIME_FINGERPRINT="$(crm_runtime_fingerprint)"
  export LOCAL_RUNTIME_STARTED_AT="$CRM_RUNTIME_CREATED_AT"
  export LOCAL_RUNTIME_MODULE="$CRM_MODULE"
  export LOCAL_RUNTIME_PAGES_PORT="$CRM_PAGES_PORT"
  export LOCAL_RUNTIME_VITE_PORT="$CRM_VITE_PORT"
  export LOCAL_RUNTIME_WA_PORT="${CRM_WA_ORCHESTRATOR_PORT:-}"
  export LOCAL_RUNTIME_INSUMOS_PORT="${CRM_INSUMOS_PORT:-}"
  export LOCAL_RUNTIME_WA_MODE="$([[ "${CRM_WITH_WHATSAPP:-0}" == "1" ]] && printf real || printf disabled)"
  export LOCAL_RUNTIME_WA_LOCAL_STUB=false
  export LOCAL_RUNTIME_WA_TARGET="$([[ "${CRM_WITH_WHATSAPP:-0}" == "1" ]] && printf 'http://127.0.0.1:%s' "$CRM_WA_ORCHESTRATOR_PORT")"
}

crm_runtime_print_status() {
  if [[ ! -f "$CRM_RUNTIME_MANIFEST" ]]; then
    printf '{"ok":false,"reason":"manifest_not_found","manifest":"%s"}\n' "$CRM_RUNTIME_MANIFEST"
    return 1
  fi
  node - "$CRM_RUNTIME_MANIFEST" <<'NODE'
const fs = require('fs')
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
console.log(JSON.stringify({
  ok: value.state === 'ready', state: value.state, sessionId: value.sessionId, url: value.url,
  worktree: value.worktree, commit: value.commit, fingerprint: value.fingerprint,
  ports: value.ports, whatsapp: value.whatsapp, startedAt: value.startedAt, updatedAt: value.updatedAt,
  manifest: process.argv[2],
}, null, 2))
NODE
}

crm_runtime_collect_descendants() {
  local parent_pid="$1" child_pid
  command -v pgrep >/dev/null 2>&1 || return 0
  while IFS= read -r child_pid; do
    [[ -n "$child_pid" ]] || continue
    crm_runtime_collect_descendants "$child_pid"
    printf '%s\n' "$child_pid"
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
}

crm_runtime_terminate_tree() {
  local root_pid="$1" descendants
  descendants="$(crm_runtime_collect_descendants "$root_pid" | tr '\n' ' ')"
  [[ -n "$descendants" ]] && kill -TERM $descendants 2>/dev/null || true
  kill -TERM "$root_pid" 2>/dev/null || true
  sleep 2
  [[ -n "$descendants" ]] && kill -KILL $descendants 2>/dev/null || true
  kill -KILL "$root_pid" 2>/dev/null || true
}

crm_runtime_mark_manifest_stopped() {
  node - "$CRM_RUNTIME_MANIFEST" <<'NODE'
const fs = require('fs')
try {
  const file = process.argv[2]
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  value.state = 'stopped'
  value.updatedAt = new Date().toISOString()
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
} catch {
  process.exit(1)
}
NODE
}

crm_runtime_safe_stop() {
  [[ -f "$CRM_RUNTIME_MANIFEST" ]] || { echo '[crm-local] Não existe manifesto de runtime para encerrar.'; return 0; }
  local candidate session_id
  candidate="$(node - "$CRM_RUNTIME_MANIFEST" "$ROOT_DIR" <<'NODE'
const fs = require('fs')
try { const x = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); if (x.worktree === process.argv[3] && Number.isInteger(x.launcherPid)) process.stdout.write(String(x.launcherPid)) } catch {}
NODE
  )"
  session_id="$(node - "$CRM_RUNTIME_MANIFEST" "$ROOT_DIR" <<'NODE'
const fs = require('fs')
try { const x = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); if (x.worktree === process.argv[3] && /^[a-z0-9-]+$/i.test(String(x.sessionId || ''))) process.stdout.write(x.sessionId) } catch {}
NODE
  )"
  if [[ ! "$candidate" =~ ^[0-9]+$ ]] || ! kill -0 "$candidate" 2>/dev/null; then
    candidate=""
  fi
  if [[ -n "$candidate" ]]; then
    local command_line process_cwd
    command_line="$(ps -p "$candidate" -o args= 2>/dev/null || true)"
    process_cwd="$(readlink "/proc/$candidate/cwd" 2>/dev/null || true)"
    if [[ "$command_line" != *"run-local-crm.sh"* || ( "$command_line" != *"$ROOT_DIR"* && "$process_cwd" != "$ROOT_DIR" ) ]]; then
      candidate=""
    fi
  fi
  if [[ -z "$candidate" && -n "$session_id" ]] && command -v pgrep >/dev/null 2>&1; then
    while IFS= read -r discovered_pid; do
      local discovered_command
      discovered_command="$(ps -p "$discovered_pid" -o args= 2>/dev/null || true)"
      if [[ "$discovered_command" == *"LOCAL_RUNTIME_SESSION_ID=$session_id"* && "$discovered_command" == *"LOCAL_RUNTIME_WORKTREE=$ROOT_DIR"* ]]; then
        candidate="$discovered_pid"
        break
      fi
    done < <(pgrep -f "LOCAL_RUNTIME_SESSION_ID=$session_id" 2>/dev/null || true)
  fi
  if [[ -z "$candidate" ]]; then
    echo '[crm-local] Manifesto está obsoleto; nenhum processo identificado foi encerrado.'
    return 0
  fi
  echo "[crm-local] Encerrando runtime identificado (PID $candidate)."
  crm_runtime_terminate_tree "$candidate"
  crm_runtime_mark_manifest_stopped
}
