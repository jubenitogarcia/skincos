#!/usr/bin/env bash

# Resolves a complete local CRM port bundle without disturbing unrelated
# listeners. The caller provides crm_runtime_port_is_free from
# crm-local-persona-runtime.sh; that probe covers both visible WSL listeners and
# Windows-owned relay listeners that are not always listed by ss/lsof.

# Thread previews can be launched independently from different worktrees. Keep
# the allocation lock open until every local listener has passed its first
# readiness probe so two launchers cannot select the same apparently-free
# bundle during their startup window. flock releases the lease automatically
# when its launcher exits or is interrupted.
CRM_PORT_BUNDLE_LOCK_HELD="${CRM_PORT_BUNDLE_LOCK_HELD:-0}"
CRM_PORT_BUNDLE_LOCK_FD="${CRM_PORT_BUNDLE_LOCK_FD:-}"

crm_port_plan_is_valid_port() {
  local value="${1:-}"
  [[ "$value" =~ ^[0-9]+$ ]] && (( value >= 1 && value <= 65535 ))
}

crm_port_plan_refresh_urls() {
  DEFAULT_URL="http://${CRM_PUBLIC_HOST}:${CRM_PAGES_PORT}${CRM_ROUTE}"
  NETWORK_URL="http://${CRM_HOST}:${CRM_PAGES_PORT}${CRM_ROUTE}"
}

crm_port_plan_lock_file() {
  if [[ -n "${CRM_PORT_BUNDLE_LOCK_FILE:-}" ]]; then
    printf '%s\n' "$CRM_PORT_BUNDLE_LOCK_FILE"
    return 0
  fi
  printf '%s\n' "$CRM_RUNTIME_ROOT/port-bundles.lock"
}

crm_port_plan_acquire_bundle_lock() {
  [[ "${CRM_DYNAMIC_PORT_BUNDLE:-0}" == "1" ]] || return 0
  [[ "$CRM_PORT_BUNDLE_LOCK_HELD" == "1" ]] && return 0

  local lock_file
  local wait_seconds="${CRM_PORT_BUNDLE_LOCK_TIMEOUT_SECONDS:-900}"
  local lock_fd
  lock_file="$(crm_port_plan_lock_file)"
  if ! command -v flock >/dev/null 2>&1; then
    echo '[crm-local] flock é obrigatório para reservar bundles dinâmicos de portas.' >&2
    return 1
  fi
  if ! [[ "$wait_seconds" =~ ^[0-9]+$ ]] || (( wait_seconds < 1 )); then
    echo '[crm-local] Tempo de espera inválido para o lock de portas.' >&2
    return 1
  fi
  mkdir -p "$(dirname "$lock_file")"
  if ! exec {lock_fd}>"$lock_file"; then
    echo "[crm-local] Não foi possível abrir o lock de portas: $lock_file" >&2
    return 1
  fi
  if ! flock -w "$wait_seconds" "$lock_fd"; then
    eval "exec ${lock_fd}>&-"
    echo "[crm-local] Tempo limite ao reservar bundles de portas em $lock_file." >&2
    return 1
  fi
  CRM_PORT_BUNDLE_LOCK_FD="$lock_fd"
  CRM_PORT_BUNDLE_LOCK_HELD=1
}

crm_port_plan_release_bundle_lock() {
  [[ "$CRM_PORT_BUNDLE_LOCK_HELD" == "1" ]] || return 0
  if [[ "$CRM_PORT_BUNDLE_LOCK_FD" =~ ^[0-9]+$ ]]; then
    flock -u "$CRM_PORT_BUNDLE_LOCK_FD" >/dev/null 2>&1 || true
    eval "exec ${CRM_PORT_BUNDLE_LOCK_FD}>&-"
  fi
  CRM_PORT_BUNDLE_LOCK_FD=""
  CRM_PORT_BUNDLE_LOCK_HELD=0
}

crm_port_plan_require_port() {
  local label="$1"
  local value="$2"
  if ! crm_port_plan_is_valid_port "$value"; then
    echo "[crm-local] Porta inválida para $label: '$value'." >&2
    return 1
  fi
}

crm_port_plan_hydrate_from_manifest() {
  local manifest="${CRM_RUNTIME_MANIFEST:-}"
  local values
  local manifest_url
  local pages_port
  local vite_port
  local insumos_port
  local timekeeping_port
  local whatsapp_port

  [[ -f "$manifest" ]] || return 1
  values="$(
    CRM_PORT_PLAN_WITH_INSUMOS="$CRM_WITH_INSUMOS" \
    CRM_PORT_PLAN_WITH_TIMEKEEPING="$CRM_WITH_TIMEKEEPING" \
    CRM_PORT_PLAN_WITH_WHATSAPP="$CRM_WITH_WHATSAPP" \
    node - "$manifest" <<'NODE'
const fs = require('fs')
try {
  const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  const ports = value?.ports || {}
  const validPort = (candidate) => Number.isInteger(candidate) && candidate >= 1 && candidate <= 65535
  const required = ['pages', 'vite']
  if (process.env.CRM_PORT_PLAN_WITH_INSUMOS === '1') required.push('insumos')
  if (process.env.CRM_PORT_PLAN_WITH_TIMEKEEPING === '1') required.push('timekeeping')
  if (process.env.CRM_PORT_PLAN_WITH_WHATSAPP === '1') required.push('whatsapp')
  if (required.some((name) => !validPort(ports[name]))) process.exit(2)
  const url = new URL(String(value?.url || ''))
  if (url.protocol !== 'http:' || !url.hostname || Number(url.port) !== ports.pages) process.exit(2)
  process.stdout.write([url.toString(), ports.pages, ports.vite, ports.insumos ?? '', ports.timekeeping ?? '', ports.whatsapp ?? ''].join('\t'))
} catch {
  process.exit(2)
}
NODE
  )" || return 1

  IFS=$'\t' read -r manifest_url pages_port vite_port insumos_port timekeeping_port whatsapp_port <<< "$values"
  crm_port_plan_require_port pages "$pages_port" || return 1
  crm_port_plan_require_port vite "$vite_port" || return 1
  if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then crm_port_plan_require_port insumos "$insumos_port" || return 1; fi
  if [[ "$CRM_WITH_TIMEKEEPING" == "1" ]]; then crm_port_plan_require_port workforce-timekeeping "$timekeeping_port" || return 1; fi
  if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then crm_port_plan_require_port whatsapp "$whatsapp_port" || return 1; fi

  CRM_PAGES_PORT="$pages_port"
  CRM_VITE_PORT="$vite_port"
  if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then CRM_INSUMOS_PORT="$insumos_port"; fi
  if [[ "$CRM_WITH_TIMEKEEPING" == "1" ]]; then CRM_TIMEKEEPING_PORT="$timekeeping_port"; fi
  if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then CRM_WA_ORCHESTRATOR_PORT="$whatsapp_port"; fi
  DEFAULT_URL="$manifest_url"
  NETWORK_URL="$manifest_url"
}

crm_port_plan_select_dynamic_bundle() {
  [[ "${CRM_DYNAMIC_PORT_BUNDLE:-0}" == "1" ]] || return 0
  if [[ "$CRM_PORT_BUNDLE_LOCK_HELD" != "1" ]]; then
    echo '[crm-local] O bundle dinâmico de portas exige o lock de alocação.' >&2
    return 1
  fi

  local preferred_pages="$CRM_PAGES_PORT"
  local preferred_vite="$CRM_VITE_PORT"
  local preferred_insumos="$CRM_INSUMOS_PORT"
  local preferred_timekeeping="$CRM_TIMEKEEPING_PORT"
  local preferred_whatsapp="$CRM_WA_ORCHESTRATOR_PORT"
  local vite_offset
  local insumos_offset
  local timekeeping_offset
  local whatsapp_offset
  local largest_offset=0
  local configured_stride="${CRM_PORT_BUNDLE_STRIDE:-10}"
  local attempts="${CRM_PORT_BUNDLE_MAX_ATTEMPTS:-200}"
  local stride
  local index

  crm_port_plan_require_port pages "$preferred_pages" || return 1
  crm_port_plan_require_port vite "$preferred_vite" || return 1
  if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
    crm_port_plan_require_port insumos "$preferred_insumos" || return 1
  fi
  if [[ "$CRM_WITH_TIMEKEEPING" == "1" ]]; then
    crm_port_plan_require_port workforce-timekeeping "$preferred_timekeeping" || return 1
  fi
  if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then
    crm_port_plan_require_port whatsapp "$preferred_whatsapp" || return 1
  fi
  if ! [[ "$configured_stride" =~ ^[0-9]+$ && "$attempts" =~ ^[0-9]+$ ]] ||
    (( configured_stride < 1 || attempts < 1 )); then
    echo '[crm-local] Plano dinâmico de portas possui stride ou tentativas inválidos.' >&2
    return 1
  fi

  vite_offset=$((preferred_vite - preferred_pages))
  (( vite_offset >= 0 )) || { echo '[crm-local] Vite deve usar uma porta igual ou posterior à Pages no plano dinâmico.' >&2; return 1; }
  largest_offset="$vite_offset"

  insumos_offset=$((preferred_insumos - preferred_pages))
  if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then
    (( insumos_offset >= 0 )) || { echo '[crm-local] Insumos deve usar uma porta igual ou posterior à Pages no plano dinâmico.' >&2; return 1; }
    (( insumos_offset > largest_offset )) && largest_offset="$insumos_offset"
  fi

  timekeeping_offset=$((preferred_timekeeping - preferred_pages))
  if [[ "$CRM_WITH_TIMEKEEPING" == "1" ]]; then
    (( timekeeping_offset >= 0 )) || { echo '[crm-local] Ponto deve usar uma porta igual ou posterior à Pages no plano dinâmico.' >&2; return 1; }
    (( timekeeping_offset > largest_offset )) && largest_offset="$timekeeping_offset"
  fi

  whatsapp_offset=$((preferred_whatsapp - preferred_pages))
  if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then
    (( whatsapp_offset >= 0 )) || { echo '[crm-local] WhatsApp deve usar uma porta igual ou posterior à Pages no plano dinâmico.' >&2; return 1; }
    (( whatsapp_offset > largest_offset )) && largest_offset="$whatsapp_offset"
  fi

  stride="$configured_stride"
  (( stride > largest_offset )) || stride=$((largest_offset + 1))

  for ((index = 0; index < attempts; index += 1)); do
    local pages_candidate=$((preferred_pages + (index * stride)))
    local vite_candidate=$((pages_candidate + vite_offset))
    local insumos_candidate=$((pages_candidate + insumos_offset))
    local timekeeping_candidate=$((pages_candidate + timekeeping_offset))
    local whatsapp_candidate=$((pages_candidate + whatsapp_offset))
    local ports=("$pages_candidate" "$vite_candidate")
    local candidate
    local unavailable=0

    if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then ports+=("$insumos_candidate"); fi
    if [[ "$CRM_WITH_TIMEKEEPING" == "1" ]]; then ports+=("$timekeeping_candidate"); fi
    if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then ports+=("$whatsapp_candidate"); fi

    for candidate in "${ports[@]}"; do
      crm_port_plan_is_valid_port "$candidate" || { unavailable=1; break; }
      crm_runtime_port_is_free "$candidate" || { unavailable=1; break; }
    done
    [[ "$unavailable" == "0" ]] || continue

    # A malformed plan with duplicate offsets cannot safely share a listener.
    if [[ "$(printf '%s\n' "${ports[@]}" | sort -u | wc -l | tr -d '[:space:]')" != "${#ports[@]}" ]]; then
      echo '[crm-local] Plano dinâmico de portas contém sobreposição de serviços.' >&2
      return 1
    fi

    CRM_PAGES_PORT="$pages_candidate"
    CRM_VITE_PORT="$vite_candidate"
    if [[ "$CRM_WITH_INSUMOS" == "1" ]]; then CRM_INSUMOS_PORT="$insumos_candidate"; fi
    if [[ "$CRM_WITH_TIMEKEEPING" == "1" ]]; then CRM_TIMEKEEPING_PORT="$timekeeping_candidate"; fi
    if [[ "$CRM_WITH_WHATSAPP" == "1" ]]; then CRM_WA_ORCHESTRATOR_PORT="$whatsapp_candidate"; fi
    crm_port_plan_refresh_urls

    if (( index > 0 )); then
      echo "[crm-local] Faixa preferida :$preferred_pages ocupada; reservando bundle dinâmico :$CRM_PAGES_PORT-:$((pages_candidate + largest_offset))." >&2
    fi
    return 0
  done

  echo "[crm-local] Nenhum bundle de portas livre foi encontrado a partir de :$preferred_pages após $attempts tentativas." >&2
  return 1
}
