#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"

assert_environment
assert_manifest

ENV_FILE=${N8N_COMMUNITY_ENV_FILE:-/etc/skincos/orb-n8n-community-packages.env}
DROPIN_DIR=${N8N_COMMUNITY_DROPIN_DIR:-/etc/systemd/system/orb.service.d}
DROPIN_FILE="$DROPIN_DIR/20-n8n-community-packages.conf"

if dry_run_notice; then
  info 'community packages planejados: gravar inventário fixo com checksums e drop-in do orb; nenhum restart será executado.'
  exit 0
fi

assert_apply_gate
require_cmd node
if [[ "$N8N_UPGRADE_ENV" == production ]]; then
  [[ "$ENV_FILE" == /etc/skincos/orb-n8n-community-packages.env ]] || die 'produção exige o environment file canônico.'
  [[ "$DROPIN_DIR" == /etc/systemd/system/orb.service.d ]] || die 'produção exige o drop-in canônico do orb.service.'
  require_cmd sudo
  sudo -n true
else
  [[ "$ENV_FILE" == /tmp/* ]] || die 'staging exige environment file em /tmp isolado.'
  [[ "$DROPIN_DIR" == /tmp/* ]] || die 'staging exige drop-in em /tmp isolado.'
fi

package_json=$(node --input-type=module - "$N8N_MANIFEST" <<'NODE'
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const packages = manifest.additional_packages;
if (!Array.isArray(packages) || packages.length !== 9) throw new Error('inventário de community packages inválido');
const names = new Set();
for (const item of packages) {
  if (!item || typeof item.name !== 'string' || typeof item.version !== 'string' || !/^sha512-/.test(item.integrity || '')) throw new Error('package sem nome, versão ou integridade SHA-512');
  if (names.has(item.name)) throw new Error(`package duplicado: ${item.name}`);
  names.add(item.name);
}
if (names.has('n8n-nodes-evolution-api')) throw new Error('package Evolution original redundante recusado');
if (!names.has('n8n-nodes-evolution-api-en')) throw new Error('package Evolution namespace usado ausente');
process.stdout.write(JSON.stringify(packages.map(({name, version, integrity}) => ({name, version, checksum: integrity}))));
NODE
)

write_files() {
  install -d -m 0750 "$(dirname "$ENV_FILE")" "$DROPIN_DIR"
  umask 027
  {
    printf 'N8N_COMMUNITY_PACKAGES_ENABLED=true\n'
    printf 'N8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV=true\n'
    printf 'N8N_UNVERIFIED_PACKAGES_ENABLED=false\n'
    printf 'N8N_COMMUNITY_PACKAGES=%s\n' "$package_json"
  } > "$ENV_FILE"
  {
    printf '[Service]\n'
    printf 'EnvironmentFile=%s\n' "$ENV_FILE"
  } > "$DROPIN_FILE"
  chmod 0640 "$ENV_FILE" "$DROPIN_FILE"
}

if [[ "$N8N_UPGRADE_ENV" == production ]]; then
  sudo -n bash -s -- "$ENV_FILE" "$DROPIN_DIR" "$DROPIN_FILE" "$package_json" <<'ROOT'
set -euo pipefail
ENV_FILE=$1
DROPIN_DIR=$2
DROPIN_FILE=$3
PACKAGE_JSON=$4
install -d -m 0750 "$(dirname "$ENV_FILE")" "$DROPIN_DIR"
umask 027
printf 'N8N_COMMUNITY_PACKAGES_ENABLED=true\nN8N_COMMUNITY_PACKAGES_MANAGED_BY_ENV=true\nN8N_UNVERIFIED_PACKAGES_ENABLED=false\nN8N_COMMUNITY_PACKAGES=%s\n' "$PACKAGE_JSON" > "$ENV_FILE"
printf '[Service]\nEnvironmentFile=%s\n' "$ENV_FILE" > "$DROPIN_FILE"
chmod 0640 "$ENV_FILE" "$DROPIN_FILE"
ROOT
else
  write_files
fi
info 'community package configuration written; caller must run daemon-reload and controlled startup separately.'
