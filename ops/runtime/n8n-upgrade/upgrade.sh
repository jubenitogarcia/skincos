#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
TARBALL=${N8N_ARTIFACT_PATH:-}
LOCK_DIR="$(dirname "$0")/runtime-lock"
if dry_run_notice; then
  info 'upgrade planejado: verificar tarball, instalar somente n8n 2.32.5 e preservar o diretório anterior.'
  exit 0
fi
assert_apply_gate
[[ -n "$TARBALL" ]] || die 'N8N_ARTIFACT_PATH ausente.'
verify_tarball "$TARBALL"
INSTALL_ROOT=${N8N_INSTALL_ROOT:-}
[[ -n "$INSTALL_ROOT" ]] || die 'N8N_INSTALL_ROOT ausente.'
require_private_path "$INSTALL_ROOT"
if [[ "$N8N_UPGRADE_ENV" == production ]]; then
  [[ "${N8N_RELEASE_SHA:-}" == "${N8N_APPROVED_SHA:-}" ]] || die 'release SHA precisa coincidir com SHA aprovado.'
  [[ "$INSTALL_ROOT" == "/opt/skincos/releases/${N8N_APPROVED_SHA}/n8n" ]] || die 'produção exige instalação n8n na release imutável aprovada.'
else
  [[ "$INSTALL_ROOT" == /tmp/* ]] || die 'staging exige instalação em /tmp isolado.'
fi
assert_no_secret_args "$TARBALL" "$INSTALL_ROOT"
require_cmd npm
require_cmd sha256sum
[[ -f "$LOCK_DIR/package.json" && -f "$LOCK_DIR/package-lock.json" ]] || die 'lockfile do runtime ausente.'
expected_lock=$(manifest_value runtime_lock sha256)
actual_lock=$(sha256sum "$LOCK_DIR/package-lock.json" | awk '{print $1}')
[[ "$actual_lock" == "$expected_lock" ]] || die 'integridade do lockfile do runtime não confere.'
[[ "$(manifest_value runtime_lock artifact_reference)" == 'file:../artifacts/n8n-2.32.5.tgz' ]] || die 'referência do artifact no lock não é canônica.'
[[ ! -e "$INSTALL_ROOT/node_modules" ]] || die 'instalação versionada já contém node_modules; recusa sobrescrever.'
artifact_dir="$(dirname "$INSTALL_ROOT")/artifacts"
artifact_dest="$artifact_dir/n8n-2.32.5.tgz"
install -d -m 0750 "$INSTALL_ROOT" "$artifact_dir"
install -m 0640 "$TARBALL" "$artifact_dest"
install -m 0640 "$LOCK_DIR/package.json" "$INSTALL_ROOT/package.json"
install -m 0640 "$LOCK_DIR/package-lock.json" "$INSTALL_ROOT/package-lock.json"
npm ci --prefix "$INSTALL_ROOT" --ignore-scripts --omit=optional
info 'artifact e lockfile instalados com npm ci; nenhuma migration ou ativação de workflow foi executada por este script.'
