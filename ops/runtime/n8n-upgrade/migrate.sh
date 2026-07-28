#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/common.sh"
assert_environment; assert_manifest
if dry_run_notice; then
  info 'migration planejada: executar somente após backup verificado e parada ordenada; downgrade direto é proibido.'
  exit 0
fi
assert_apply_gate
N8N_BIN=${N8N_BIN:-}
[[ -x "$N8N_BIN" ]] || die 'N8N_BIN ausente ou não executável.'
[[ "$("$N8N_BIN" --version)" == 2.32.5 ]] || die 'N8N_BIN não reporta 2.32.5.'
assert_no_secret_args "$N8N_BIN"
"$N8N_BIN" db:migrate
info 'migrations concluídas; registrar contagem e logs sanitizados antes do startup.'
