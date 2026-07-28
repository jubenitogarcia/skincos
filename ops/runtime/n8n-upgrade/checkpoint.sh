#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
CHECKPOINT_DIR=${N8N_CHECKPOINT_DIR:-/var/backups/skincos/orb/n8n-upgrade-checkpoints}
require_private_path "$CHECKPOINT_DIR"
if dry_run_notice; then
  info "checkpoint planejado em $CHECKPOINT_DIR; incluirá links, unidades, metadados de config e release SHA."
  exit 0
fi
assert_apply_gate
mkdir -p "$CHECKPOINT_DIR"
date -u +%Y%m%dT%H%M%SZ > "$CHECKPOINT_DIR/created-at.txt"
readlink -f /opt/skincos/current/source > "$CHECKPOINT_DIR/current-source.txt"
sha256sum "$N8N_MANIFEST" > "$CHECKPOINT_DIR/version-manifest.sha256"
systemctl show orb orb-proxy -p FragmentPath -p ExecStart -p ActiveState -p SubState > "$CHECKPOINT_DIR/services.txt"
info 'checkpoint criado sem copiar segredos.'
