#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--apply] [--dry-run] [--include-sessions] [--include-browser-profiles]

Removes local, regenerable artifacts (node_modules, .venv, caches, logs, chrome profiles).
Default is --dry-run.

Examples:
  $(basename "$0") --dry-run
  $(basename "$0") --apply
  $(basename "$0") --apply --include-sessions
  $(basename "$0") --apply --include-browser-profiles
EOF
}

MODE="dry-run"
INCLUDE_SESSIONS="0"
INCLUDE_BROWSER_PROFILES="0"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) MODE="apply" ;;
    --dry-run) MODE="dry-run" ;;
    --include-sessions) INCLUDE_SESSIONS="1" ;;
    --include-browser-profiles) INCLUDE_BROWSER_PROFILES="1" ;;
    -h|--help|help) usage; exit 0 ;;
    *) echo "[clean] Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift || true
done

targets=(
  "$ROOT_DIR/.vite"
  "$ROOT_DIR/frontend/.vite"
)

patterns=(
  "node_modules"
  ".venv"
  ".venv*"
  "venv"
  "venv*"
  "__pycache__"
  "logs"
  ".pytest_cache"
  ".mypy_cache"
  ".ruff_cache"
  "dist"
  "build"
)

file_patterns=(
  ".DS_Store"
  "*.pyc"
  "*.pyo"
  "*.pid"
  "*.log"
  "*.tmp"
  ".coverage"
  "coverage.xml"
)

if [[ "$INCLUDE_SESSIONS" == "1" ]]; then
  targets+=("$ROOT_DIR/.wa-sessions" "$ROOT_DIR/.wwebjs_cache" "$ROOT_DIR/.wwebjs_auth")
  patterns+=(".wwebjs_cache" ".wwebjs_auth" ".wwebjs_auth_local_*")
fi

if [[ "$INCLUDE_BROWSER_PROFILES" == "1" ]]; then
  patterns+=(
    ".chrome_profile_*"
    ".chrome_profile*"
    ".chrome-profile*"
    "chrome_profile_sprinta"
    "chrome_profile_*"
    "chrome_profile*"
  )
fi

echo "[clean] Mode: $MODE"
echo "[clean] Root: $ROOT_DIR"
echo "[clean] Include sessions: $INCLUDE_SESSIONS"
echo "[clean] Include browser profiles: $INCLUDE_BROWSER_PROFILES"
echo ""

list_rm() {
  local path="$1"
  if [[ -e "$path" ]]; then
    echo "$path"
  fi
}

declare -a to_remove=()

for t in "${targets[@]}"; do
  [[ -e "$t" ]] && to_remove+=("$t")
done

find_matches=()
for pat in "${patterns[@]}"; do
  find_matches+=(-name "$pat" -o)
done
unset 'find_matches[${#find_matches[@]}-1]' 2>/dev/null || true

while IFS= read -r d; do
  [[ -n "$d" ]] && to_remove+=("$d")
done < <(find "$ROOT_DIR" \
  -path "$ROOT_DIR/.git" -prune -o \
  -path "$ROOT_DIR/backend/var" -prune -o \
  -type d \( "${find_matches[@]}" \) -prune -print 2>/dev/null)

file_find_matches=()
for pat in "${file_patterns[@]}"; do
  file_find_matches+=(-name "$pat" -o)
done
unset 'file_find_matches[${#file_find_matches[@]}-1]' 2>/dev/null || true

while IFS= read -r f; do
  [[ -n "$f" ]] && to_remove+=("$f")
done < <(find "$ROOT_DIR" \
  -path "$ROOT_DIR/.git" -prune -o \
  -path "$ROOT_DIR/backend/var" -prune -o \
  -type f \( "${file_find_matches[@]}" \) -print 2>/dev/null)

echo "[clean] Candidates:"
uniq_list="$(printf "%s\n" "${to_remove[@]:-}" | LC_ALL=C sort -u)"
count="$(printf "%s\n" "$uniq_list" | sed '/^$/d' | wc -l | tr -d ' ')"
echo "[clean] Total: $count"
printf "%s\n" "$uniq_list" | sed -n '1,200p'

if [[ "$MODE" == "dry-run" ]]; then
  echo ""
  echo "[clean] Dry-run only. Re-run with --apply to delete."
  exit 0
fi

echo ""
echo "[clean] Deleting..."
printf "%s\n" "$uniq_list" | while IFS= read -r p; do
  [[ -n "$p" ]] || continue
  rm -rf "$p" 2>/dev/null || true
done

echo "[clean] Done."
