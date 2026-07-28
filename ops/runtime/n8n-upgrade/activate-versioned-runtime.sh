#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

assert_environment
assert_manifest

INSTALL_ROOT=${N8N_INSTALL_ROOT:-}
DROPIN_DIR=${N8N_RUNTIME_DROPIN_DIR:-/etc/systemd/system/orb.service.d}
DROPIN_FILE="$DROPIN_DIR/10-n8n-versioned-runtime.conf"

if dry_run_notice; then
  info 'ativação planejada: apontar somente o ExecStart do Orb para n8n versionado; não haverá daemon-reload nem restart neste passo.'
  exit 0
fi

assert_apply_gate
[[ -n "$INSTALL_ROOT" ]] || die 'N8N_INSTALL_ROOT ausente.'
require_private_path "$INSTALL_ROOT"
N8N_BIN="$INSTALL_ROOT/node_modules/.bin/n8n"
[[ -x "$N8N_BIN" ]] || die 'binário n8n versionado ausente.'
[[ "$("$N8N_BIN" --version)" == "$(manifest_value environment_policy target_version)" ]] || die 'binário n8n não corresponde ao alvo fixado.'

if [[ "$N8N_UPGRADE_ENV" == production ]]; then
  [[ "${N8N_RELEASE_SHA:-}" == "${N8N_APPROVED_SHA:-}" ]] || die 'release SHA precisa coincidir com SHA aprovado.'
  [[ "$INSTALL_ROOT" == "/opt/skincos/releases/${N8N_APPROVED_SHA}/n8n" ]] || die 'produção exige runtime n8n dentro da release imutável aprovada.'
  [[ "$DROPIN_DIR" == /etc/systemd/system/orb.service.d ]] || die 'produção exige drop-in canônico do orb.service.'
  require_cmd sudo
  sudo -n true
  sudo -n install -d -m 0750 "$DROPIN_DIR"
  sudo -n bash -s -- "$DROPIN_FILE" "$N8N_BIN" "$INSTALL_ROOT/node_modules" <<'ROOT'
set -euo pipefail
dropin=$1
bin=$2
node_path=$3
umask 027
printf '[Service]\nExecStart=\nExecStart=%s start\nEnvironment=NODE_PATH=%s\n' "$bin" "$node_path" > "$dropin"
chmod 0640 "$dropin"
ROOT
else
  [[ "$DROPIN_DIR" == /tmp/* ]] || die 'staging exige drop-in em /tmp isolado.'
  install -d -m 0750 "$DROPIN_DIR"
  umask 027
  printf '[Service]\nExecStart=\nExecStart=%s start\nEnvironment=NODE_PATH=%s\n' "$N8N_BIN" "$INSTALL_ROOT/node_modules" > "$DROPIN_FILE"
  chmod 0640 "$DROPIN_FILE"
fi
info 'drop-in versionado preparado; daemon-reload, controlled startup e validação pertencem aos próximos gates.'
