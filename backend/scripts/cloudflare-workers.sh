#!/usr/bin/env bash
set -euo pipefail

# NOTE: This file is generated/managed by repo automation.

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"
. "$ROOT_DIR/backend/scripts/node_pkg.sh"

usage() {
  cat <<'EOF'
SKINCOS Cloudflare Workers deploy helper

Usage: backend/scripts/cloudflare-workers.sh <command> [args]

Commands:
  deploy [--before <sha>] [--after <sha>] [--env <name>]
      Deploy workers. If before/after are provided, deploy only what changed.

  deploy-all [--env <name>]
      Deploy all workers regardless of changes.

Notes:
  - skincos-api shares implementation with apps/insumos/src, so changes under
    backend/apps/insumos/** will deploy BOTH workers.
  - Requires CLOUDFLARE_API_TOKEN (+ optional CLOUDFLARE_ACCOUNT_ID) in env.

Examples:
  backend/scripts/cloudflare-workers.sh deploy-all
  backend/scripts/cloudflare-workers.sh deploy --before "$GITHUB_BEFORE_SHA" --after "$GITHUB_SHA"
  backend/scripts/cloudflare-workers.sh deploy --env staging
EOF
}

ensure_backend_deps() {
  if [[ ! -d "$BACKEND_DIR/node_modules" ]]; then
    echo "[workers] Installing backend workspace deps (pnpm)..."
    install_node_deps "$BACKEND_DIR" install >/dev/null 2>&1 || true
  fi
}

resolve_env_flag() {
  if [[ -z "${ENV_NAME:-}" ]]; then
    ENV_NAME=""
  fi
}

resolve_insumos_db_name() {
  INSUMOS_DB_NAME="${INSUMOS_D1_DB_NAME:-skincos-db}"
  if [[ -n "${ENV_NAME:-}" ]]; then
    case "$ENV_NAME" in
      staging)
        INSUMOS_DB_NAME="${INSUMOS_D1_DB_NAME_STAGING:-skincos-db-staging}"
        ;;
    esac
  fi
}

resolve_build_var_flag() {
  local sha="${WORKER_BUILD_SHA:-${GITHUB_SHA:-}}"
  if [[ -z "${sha:-}" ]]; then
    sha="$(git rev-parse HEAD 2>/dev/null || true)"
  fi
  if [[ -n "${sha:-}" ]]; then
    BUILD_VAR_VALUE="${sha}"
  else
    BUILD_VAR_VALUE=""
  fi
}

deploy_api() {
  echo "[workers] Deploying skincos-api..."
  pushd "$BACKEND_DIR" >/dev/null
  # NOTE: pnpm filtered exec runs with the package's CWD, so use package-local config path.
  local args=(--config wrangler.toml --keep-vars)
  if [[ -n "${ENV_NAME:-}" ]]; then
    args+=(--env "$ENV_NAME")
  fi
  if [[ -n "${BUILD_VAR_VALUE:-}" ]]; then
    args+=(--var "PONTO_BUILD_SHA:${BUILD_VAR_VALUE}")
  fi
  run_pnpm -F @skincos/api-worker exec wrangler deploy "${args[@]}"
  popd >/dev/null
}

deploy_insumos() {
  echo "[workers] Applying D1 migrations (best effort) ..."
  pushd "$BACKEND_DIR" >/dev/null
  # NOTE: pnpm filtered exec runs with the package's CWD, so use package-local config path.
  # Best-effort: D1 remote access requires extra API token scopes. Keep deploy unblocked.
  local d1_args=(--config wrangler.toml)
  if [[ -n "${ENV_NAME:-}" ]]; then
    d1_args+=(--env "$ENV_NAME")
  fi
  run_pnpm -F @skincos/insumos-worker exec wrangler d1 migrations apply "$INSUMOS_DB_NAME" "${d1_args[@]}" || true
  popd >/dev/null
  echo "[workers] Deploying skincos-insumos..."
  pushd "$BACKEND_DIR" >/dev/null
  local args=(--config wrangler.toml --keep-vars)
  if [[ -n "${ENV_NAME:-}" ]]; then
    args+=(--env "$ENV_NAME")
  fi
  if [[ -n "${BUILD_VAR_VALUE:-}" ]]; then
    args+=(--var "PONTO_BUILD_SHA:${BUILD_VAR_VALUE}")
  fi
  run_pnpm -F @skincos/insumos-worker exec wrangler deploy "${args[@]}"
  popd >/dev/null
}

deploy_by_changes() {
  local before_sha="${1:-}"
  local after_sha="${2:-}"

  if [[ -z "$before_sha" || -z "$after_sha" ]]; then
    echo "[workers] Missing --before/--after; deploying all."
    deploy_api
    deploy_insumos
    return 0
  fi

  local changed
  changed="$(git diff --name-only "$before_sha" "$after_sha" 2>/dev/null || true)"
  if [[ -z "$changed" ]]; then
    echo "[workers] No diff (or unable to diff); deploying all."
    deploy_api
    deploy_insumos
    return 0
  fi

  local do_api="false"
  local do_insumos="false"

  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    case "$f" in
      backend/apps/api/*)
        do_api="true"
        ;;
      backend/apps/insumos/*)
        do_insumos="true"
        do_api="true" # shared implementation
        ;;
      backend/pnpm-lock.yaml|backend/pnpm-workspace.yaml|.github/workflows/deploy-insumos-worker.yml)
        do_api="true"
        do_insumos="true"
        ;;
    esac
  done <<< "$changed"

  if [[ "$do_api" != "true" && "$do_insumos" != "true" ]]; then
    echo "[workers] No relevant changes; skipping deploy."
    return 0
  fi

  if [[ "$do_api" == "true" ]]; then
    deploy_api
  fi
  if [[ "$do_insumos" == "true" ]]; then
    deploy_insumos
  fi
}

cmd="${1:-help}"
shift || true

ENV_NAME="${DEPLOY_ENV:-}"
INSUMOS_DB_NAME=""
BUILD_VAR_VALUE=""

ensure_backend_deps

case "$cmd" in
  deploy)
    before=""
    after=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --before) before="${2:-}"; shift 2 ;;
        --after) after="${2:-}"; shift 2 ;;
        --env) ENV_NAME="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "[workers] Unknown arg: $1" >&2; usage; exit 1 ;;
      esac
    done
    resolve_env_flag
    resolve_insumos_db_name
    resolve_build_var_flag
    deploy_by_changes "$before" "$after"
    ;;
  deploy-all)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --env) ENV_NAME="${2:-}"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "[workers] Unknown arg: $1" >&2; usage; exit 1 ;;
      esac
    done
    resolve_env_flag
    resolve_insumos_db_name
    resolve_build_var_flag
    deploy_api
    deploy_insumos
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "[workers] Unknown command: $cmd" >&2
    usage
    exit 1
    ;;
esac
