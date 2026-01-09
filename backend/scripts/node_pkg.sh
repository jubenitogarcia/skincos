#!/usr/bin/env bash
set -euo pipefail

# Shared helpers for installing Node deps across mixed package managers.

pkg_manager_from_package_json() {
  local dir="$1"
  local pkg_json="$dir/package.json"
  [[ -f "$pkg_json" ]] || return 0

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<PY 2>/dev/null || true
import json
try:
  with open("${pkg_json}", "r", encoding="utf-8") as f:
    data=json.load(f)
  pm=str(data.get("packageManager","") or "").strip()
  if pm:
    print(pm.split("@",1)[0])
except Exception:
  pass
PY
    return 0
  fi

  # Best-effort fallback (not a full JSON parser).
  local line
  line="$(grep -E '\"packageManager\"' "$pkg_json" 2>/dev/null | head -n 1 || true)"
  if [[ -n "$line" ]]; then
    echo "$line" | sed -nE 's/.*"packageManager"[[:space:]]*:[[:space:]]*"([^@"]+).*/\\1/p' | head -n 1
  fi
}

detect_pkg_manager() {
  local dir="$1"
  local pm=""
  pm="$(pkg_manager_from_package_json "$dir" || true)"
  case "$pm" in
    pnpm|yarn|npm) echo "$pm"; return 0 ;;
  esac

  # If inside a pnpm workspace root, prefer pnpm for listed packages.
  local cur="$dir"
  while [[ "$cur" != "/" && -n "$cur" ]]; do
    if [[ -f "$cur/pnpm-workspace.yaml" && -f "$cur/package.json" ]]; then
      local root_pm
      root_pm="$(pkg_manager_from_package_json "$cur" || true)"
      if [[ "$root_pm" == "pnpm" ]]; then
        local rel="${dir#$cur/}"
        if [[ "$rel" != "$dir" ]]; then
          local ws="$cur/pnpm-workspace.yaml"
          if grep -Fq -- "- \"${rel}\"" "$ws" 2>/dev/null || grep -Fq -- "- '${rel}'" "$ws" 2>/dev/null || grep -Fq -- "- ${rel}" "$ws" 2>/dev/null; then
            echo "pnpm"
            return 0
          fi
        fi
      fi
      break
    fi
    cur="$(dirname "$cur")"
  done

  if [[ -f "$dir/pnpm-lock.yaml" ]]; then echo "pnpm"; return 0; fi
  if [[ -f "$dir/yarn.lock" ]]; then echo "yarn"; return 0; fi
  if [[ -f "$dir/package-lock.json" ]]; then echo "npm"; return 0; fi
  echo "npm"
}

run_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm "$@"
    return $?
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack pnpm "$@"
    return $?
  fi
  echo "[node-pkg] ERROR: pnpm not found (install pnpm or enable corepack)" >&2
  return 2
}

run_yarn() {
  if command -v yarn >/dev/null 2>&1; then
    yarn "$@"
    return $?
  fi
  if command -v corepack >/dev/null 2>&1; then
    corepack yarn "$@"
    return $?
  fi
  echo "[node-pkg] ERROR: yarn not found (install yarn or enable corepack)" >&2
  return 2
}

install_node_deps() {
  local dir="$1"
  local mode="${2:-install}" # install|ci

  [[ -d "$dir" ]] || { echo "[node-pkg] Skip (missing dir): $dir"; return 0; }
  [[ -f "$dir/package.json" ]] || { echo "[node-pkg] Skip (no package.json): $dir"; return 0; }

  local pm
  pm="$(detect_pkg_manager "$dir")"

  (
    cd "$dir"
    case "$pm" in
      pnpm)
        if [[ "$mode" == "ci" && -f pnpm-lock.yaml ]]; then
          run_pnpm install --frozen-lockfile
        else
          run_pnpm install
        fi
        ;;
      yarn)
        if [[ "$mode" == "ci" ]]; then
          run_yarn install --immutable
        else
          run_yarn install
        fi
        ;;
      npm|*)
        if [[ "$mode" == "ci" && -f package-lock.json ]]; then
          npm ci --no-audit --no-fund
        else
          npm install --no-audit --no-fund
        fi
        ;;
    esac
  )
}
