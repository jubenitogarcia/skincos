#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
BACKUP_DIR=${N8N_BACKUP_DIR:-}
if [[ -z "$BACKUP_DIR" ]]; then
  dry_run_notice && { info 'defina N8N_BACKUP_DIR apontando para um snapshot restore-verified privado.'; exit 0; }
  die 'N8N_BACKUP_DIR ausente.'
fi
require_private_path "$BACKUP_DIR"
[[ -d "$BACKUP_DIR" ]] || die 'diretório de backup ausente.'
[[ -f "$BACKUP_DIR/manifest.json" ]] || die 'manifest.json ausente.'
require_cmd node
node --input-type=module - "$BACKUP_DIR/manifest.json" <<'NODE'
import fs from 'node:fs';
const m=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if (m.RestoreVerified !== true && m.restore_verified !== true) throw new Error('backup não marcado RestoreVerified=True');
if (m.database_sha256 === undefined && m.database_sha === undefined) throw new Error('hash do banco ausente');
if (m.storage_sha256 === undefined && m.storage_sha === undefined) throw new Error('hash do storage ausente');
console.log('backup_manifest=restore_verified; hashes presentes; valores omitidos');
NODE
info 'backup e restauração verificada; nenhum dado foi alterado.'
