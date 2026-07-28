#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
TARBALL=${N8N_ARTIFACT_PATH:-}
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
npm install --prefix "$INSTALL_ROOT" --ignore-scripts --omit=optional "$TARBALL"
info 'artifact instalado; nenhuma migration ou ativação de workflow foi executada por este script.'
