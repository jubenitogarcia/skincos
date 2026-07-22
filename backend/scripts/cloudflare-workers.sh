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
  - Finance migrations are never applied by this command. Apply them through a
    reviewed staging release before deploying an API that requires them.
  - Requires CLOUDFLARE_API_TOKEN (+ optional CLOUDFLARE_ACCOUNT_ID) in env.

Examples:
  backend/scripts/cloudflare-workers.sh deploy-all
  backend/scripts/cloudflare-workers.sh deploy --before "$GITHUB_BEFORE_SHA" --after "$GITHUB_SHA"
  backend/scripts/cloudflare-workers.sh deploy --env staging
EOF
}

ensure_worker_deps() {
  local worker_dir
  for worker_dir in "$ROOT_DIR/api" "$ROOT_DIR/inventory"; do
    if [[ ! -x "$worker_dir/node_modules/.bin/wrangler" ]]; then
      echo "[workers] Installing dependencies in ${worker_dir#$ROOT_DIR/} ..."
      install_node_deps "$worker_dir" ci
    fi
    if [[ ! -x "$worker_dir/node_modules/.bin/wrangler" ]]; then
      echo "[workers] ERROR: wrangler is unavailable in ${worker_dir#$ROOT_DIR/}" >&2
      return 1
    fi
  done
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
  pushd "$ROOT_DIR/api" >/dev/null
  local args=(--config wrangler.toml --keep-vars)
  if [[ -n "${ENV_NAME:-}" ]]; then
    args+=(--env "$ENV_NAME")
  fi
  if [[ -n "${BUILD_VAR_VALUE:-}" ]]; then
    args+=(--var "PONTO_BUILD_SHA:${BUILD_VAR_VALUE}")
  fi
  ./node_modules/.bin/wrangler deploy "${args[@]}"
  popd >/dev/null
}

deploy_insumos() {
  echo "[workers] Applying D1 migrations ..."
  pushd "$ROOT_DIR/inventory" >/dev/null
  # Auth and schema changes must fail closed: never deploy a Worker that expects
  # columns the remote D1 database does not yet have.
  local d1_args=(--config wrangler.toml --remote)
  if [[ -n "${ENV_NAME:-}" ]]; then
    d1_args+=(--env "$ENV_NAME")
  fi
  ./node_modules/.bin/wrangler d1 migrations apply "$INSUMOS_DB_NAME" "${d1_args[@]}"
  popd >/dev/null
  echo "[workers] Deploying skincos-insumos..."
  pushd "$ROOT_DIR/inventory" >/dev/null
  local args=(--config wrangler.toml --keep-vars)
  if [[ -n "${ENV_NAME:-}" ]]; then
    args+=(--env "$ENV_NAME")
  fi
  if [[ -n "${BUILD_VAR_VALUE:-}" ]]; then
    args+=(--var "PONTO_BUILD_SHA:${BUILD_VAR_VALUE}")
  fi
  ./node_modules/.bin/wrangler deploy "${args[@]}"
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
      api/*)
        do_api="true"
        ;;
      inventory/*)
        do_insumos="true"
        ;;
      finance/*|shared/finance-contracts/*|shared/crm-auth/*)
        do_api="true"
        ;;
      backend/pnpm-lock.yaml|backend/pnpm-workspace.yaml)
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

ensure_worker_deps

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
