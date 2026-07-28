#!/usr/bin/env bash
set -euo pipefail

N8N_CHANGE_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
N8N_MANIFEST=${N8N_MANIFEST:-"$N8N_CHANGE_ROOT/VERSION_MANIFEST.json"}
N8N_DRY_RUN=${N8N_DRY_RUN:-1}

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf 'INFO: %s\n' "$*"; }
require_cmd() { command -v "$1" >/dev/null 2>&1 || die "comando ausente: $1"; }

manifest_value() {
  require_cmd node
  node --input-type=module - "$N8N_MANIFEST" "$@" <<'NODE'
import fs from 'node:fs';
const [file, ...path] = process.argv.slice(2);
const value = path.reduce((item, key) => item?.[key], JSON.parse(fs.readFileSync(file, 'utf8')));
if (value === undefined) process.exit(2);
if (Array.isArray(value) || (value && typeof value === 'object')) process.stdout.write(JSON.stringify(value));
else process.stdout.write(String(value));
NODE
}

assert_environment() {
  local environment=${N8N_UPGRADE_ENV:-} expected=${N8N_EXPECTED_ENV:-}
  [[ "$environment" == staging || "$environment" == production ]] || die 'N8N_UPGRADE_ENV deve ser staging ou production.'
  [[ "$expected" == "$environment" ]] || die 'N8N_EXPECTED_ENV não confirma o ambiente selecionado.'
  if [[ "$environment" == staging ]]; then
    [[ "${N8N_STAGING_MARKER:-}" == orb-n8n-staging ]] || die 'marcador de staging ausente; recusa fechada.'
  else
    [[ "${N8N_PRODUCTION_CHANGE_APPROVED:-}" == YES ]] || die 'produção exige N8N_PRODUCTION_CHANGE_APPROVED=YES.'
    [[ -n "${N8N_APPROVAL_ID:-}" ]] || die 'produção exige N8N_APPROVAL_ID; não use token em argumento.'
  fi
}

assert_manifest() {
  local target artifact integrity
  target=$(manifest_value environment_policy target_version)
  artifact=$(manifest_value artifact version)
  integrity=$(manifest_value artifact integrity)
  [[ "$target" == 2.32.5 && "$artifact" == "$target" ]] || die 'manifest não fixa n8n 2.32.5.'
  [[ "$integrity" == sha512-* ]] || die 'integridade SHA-512 do artifact ausente.'
  [[ "${N8N_TARGET_VERSION:-$target}" == "$target" ]] || die 'N8N_TARGET_VERSION diverge do manifest.'
  [[ "${N8N_TARGET_SHA:-}" != latest && "${N8N_TARGET_SHA:-}" != main ]] || die 'SHA flutuante recusado.'
}

assert_apply_gate() {
  [[ "${N8N_UPGRADE_APPLY:-}" == YES ]] || die 'modo dry-run: defina N8N_UPGRADE_APPLY=YES somente após autorização humana.'
  if [[ "$N8N_UPGRADE_ENV" == staging ]]; then
    [[ "${N8N_STAGING_CHANGE_APPROVED:-}" == YES ]] || die 'staging exige N8N_STAGING_CHANGE_APPROVED=YES.'
  else
    [[ "${N8N_APPROVED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || die 'produção exige SHA Git exato de 40 hex.'
  fi
}

assert_no_secret_args() {
  local arg
  for arg in "$@"; do
    [[ "$arg" != *password* && "$arg" != *token* && "$arg" != *secret* && "$arg" != *cookie* ]] || die 'segredo/token em argumento recusado.'
  done
}

dry_run_notice() {
  if [[ "${N8N_DRY_RUN:-1}" == 1 ]]; then
    info 'DRY-RUN: nenhuma alteração será executada.'
    return 0
  fi
  return 1
}

require_private_path() {
  local path=$1
  [[ "$path" != /mnt/c/* && "$path" != *'.env'* && "$path" != *'.dev.vars'* ]] || die 'caminho de segredo/DrvFS recusado.'
}

verify_tarball() {
  local tarball=$1 expected
  require_private_path "$tarball"
  [[ -f "$tarball" ]] || die "artifact ausente: $tarball"
  expected=$(manifest_value artifact integrity)
  require_cmd openssl; require_cmd base64
  local actual
  actual="sha512-$(openssl dgst -sha512 -binary "$tarball" | base64 -w0)"
  [[ "$actual" == "$expected" ]] || die 'integridade do artifact não confere com o manifest.'
  info 'integridade do artifact conferida; valor não é impresso.'
}
