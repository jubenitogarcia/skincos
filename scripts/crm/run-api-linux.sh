#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNTIME_HOME="${CRM_RUNTIME_HOME:-/var/lib/skincos-runtime/crm}"
ENV_FILE="${SKINCOS_CRM_API_ENV_FILE:-/etc/skincos/crm.env}"
NATIVE_RELEASE_ROOT="${CRM_NATIVE_RELEASE_ROOT:-}"
NATIVE_DEPLOYMENT_TARGET="${CRM_NATIVE_DEPLOYMENT_TARGET:-}"

if [[ -n "$NATIVE_RELEASE_ROOT" ]]; then
  # This is the crm.service contract, not a general-purpose launcher. Capture
  # fixed private/runtime paths before loading credentials so they cannot be
  # redirected by a caller or by an EnvironmentFile entry.
  FIXED_RUNTIME_HOME="$RUNTIME_HOME"
  FIXED_ENV_FILE="$ENV_FILE"
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -n "$NATIVE_RELEASE_ROOT" ]]; then
  command -v readlink >/dev/null 2>&1 || { echo 'readlink is required for a native CRM release.' >&2; exit 78; }
  resolved_script_root="$(readlink -f -- "$ROOT_DIR")"
  resolved_native_root="$(readlink -f -- "$NATIVE_RELEASE_ROOT")"
  case "$NATIVE_DEPLOYMENT_TARGET" in
    staging)
      [[ "$resolved_native_root" =~ ^/opt/skincos/staging/releases/[0-9a-f]{40}/crm-service$ ]] || {
        echo 'CRM_NATIVE_RELEASE_ROOT must resolve to an immutable staging CRM-only release.' >&2
        exit 78
      }
      ;;
    production)
      [[ "$resolved_native_root" =~ ^/opt/skincos/releases/[0-9a-f]{40}/crm-service$ ]] || {
        echo 'CRM_NATIVE_RELEASE_ROOT must resolve to an immutable production CRM-only release.' >&2
        exit 78
      }
      ;;
    *)
      echo 'CRM_NATIVE_DEPLOYMENT_TARGET must be staging or production for a native CRM release.' >&2
      exit 78
      ;;
  esac
  [[ "$resolved_script_root" == "$resolved_native_root" ]] || {
    echo 'CRM launcher does not originate from CRM_NATIVE_RELEASE_ROOT.' >&2
    exit 78
  }
  # The private environment may contain credentials, endpoints and ports, but
  # never the executable source locations or loader overrides.
  unset NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE NODE_V8_COVERAGE NODE_REDIRECT_WARNINGS LD_PRELOAD LD_LIBRARY_PATH BASH_ENV ENV
  export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  RUNTIME_HOME="$FIXED_RUNTIME_HOME"
  ENV_FILE="$FIXED_ENV_FILE"
  ROOT_DIR="$resolved_native_root"
  export BACKEND_DIR="$ROOT_DIR/backend"
  export FRONTEND_DIR="$ROOT_DIR/crm/console"
  export CONFIG_DIR="$ROOT_DIR/backend/config"
  # EnvironmentFile contents are private deployment configuration, but a
  # The dedicated CRM release retires this legacy writer at its process
  # boundary. Reassert after the private file so it cannot reactivate it.
  export PONTO_LEGACY_RUNTIME_MODE='disabled'
  export VAR_DIR="$RUNTIME_HOME/var"
else
  export BACKEND_DIR="${BACKEND_DIR:-$ROOT_DIR/backend}"
  export FRONTEND_DIR="${FRONTEND_DIR:-$ROOT_DIR/crm/console}"
  export CONFIG_DIR="${CONFIG_DIR:-$ROOT_DIR/backend/config}"
  export VAR_DIR="${VAR_DIR:-$RUNTIME_HOME/var}"
fi
export ROOT_DIR

mkdir -p "$RUNTIME_HOME/var" "$RUNTIME_HOME/var/logs" "$RUNTIME_HOME/var/pids"

exec "$ROOT_DIR/crm/api/scripts/run.sh" start --port "${CRM_API_PORT:-${PORT:-8099}}"
