#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
if [[ "$N8N_UPGRADE_ENV" != production ]]; then
  if dry_run_notice; then info 'staging dry-run: usar snapshot isolado do harness; nunca disparar SkincosOrbBackup.'; exit 0; fi
  die 'SkincosOrbBackup é o proprietário do backup live; staging deve usar snapshot isolado separado.'
fi
if dry_run_notice; then
  info 'backup planejado pelo proprietário canônico SkincosOrbBackup; não executar dump manual concorrente.'
  exit 0
fi
assert_apply_gate
command -v powershell.exe >/dev/null 2>&1 || die 'powershell.exe ausente para o backup canônico.'
powershell.exe -NoProfile -NonInteractive -Command 'Start-ScheduledTask -TaskName SkincosOrbBackup'
info 'tarefa SkincosOrbBackup disparada; use verify-backup.sh antes de qualquer parada.'
