#!/usr/bin/env bash
set -euo pipefail

# Atendimento must use the same isolated Pages/proxy/adapter runtime as the
# Gestor shell.  Keeping a second standalone Vite + API launcher here allowed
# the shortcut to bypass the local proxy and PostgreSQL-backed adapter, which
# produced unauthenticated 401 responses and stale readiness failures.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# A snapshot selected by the Windows shortcut lives on DrvFS. Node's package
# install and the local adapter are not reliable there under concurrent file
# watchers, so materialize the *entire selected snapshot* once in the private
# native WSL runtime before starting it. The source fingerprint is propagated
# unchanged by the shortcut and recorded by run-local-crm; this is a transport
# step, not a fallback to another checkout or an allowlisted copy of files.
if [[ -n "${CRM_LOCAL_NATIVE_SOURCE_ROOT:-}" && "${CRM_LOCAL_NATIVE_SOURCE_ROOT}" != "$ROOT_DIR" ]]; then
  native_source_root="$CRM_LOCAL_NATIVE_SOURCE_ROOT"
  case "$native_source_root" in
    /home/admin/.local/state/skincos/crm-local-preview-source/*) ;;
    *)
      echo "CRM_LOCAL_NATIVE_SOURCE_ROOT is outside the private preview root: $native_source_root" >&2
      exit 2
      ;;
  esac

  mkdir -p "$(dirname "$native_source_root")"
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'test-results' \
    "$ROOT_DIR/" "$native_source_root/"

  export CRM_LOCAL_NATIVE_SOURCE_ROOT=''
  cd "$native_source_root"
  exec bash "$native_source_root/scripts/run-local-atendimento.sh" "$@"
fi

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
