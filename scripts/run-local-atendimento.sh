#!/usr/bin/env bash
set -euo pipefail

# Atendimento must use the same isolated Pages/proxy/adapter runtime as the
# Gestor shell.  Keeping a second standalone Vite + API launcher here allowed
# the shortcut to bypass the local proxy and PostgreSQL-backed adapter, which
# produced unauthenticated 401 responses and stale readiness failures.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${CRM_MODULE:-}" ]]; then
  export CRM_MODULE=atendimento
fi
if [[ -z "${CRM_ROUTE:-}" ]]; then
  export CRM_ROUTE='/?module=atendimento'
fi
if [[ -z "${CRM_WITH_WHATSAPP+x}" ]]; then
  # The isolated WhatsApp adapter also owns the Atendimento API.  It is the
  # only valid local target for this module; do not fall back to a shared or
  # native CRM endpoint.
  export CRM_WITH_WHATSAPP=1
fi

exec bash "$ROOT_DIR/scripts/run-local-crm.sh" --module atendimento "$@"
