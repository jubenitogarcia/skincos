#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

MODE="dry-run"
KEEP="${KEEP:-2}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/prune-sprinta-profiles.sh --dry-run [--keep N]
  ./scripts/prune-sprinta-profiles.sh --apply [--keep N]

Prunes Sprinta temporary Chrome profiles:
  - keeps the newest N ".chrome-profile-step*" directories
  - leaves ".chrome-profile" and "legacy/chrome_profile_sprinta" untouched

Default is --dry-run. Default keep: 2.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) MODE="dry-run"; shift ;;
    --apply) MODE="apply"; shift ;;
    --keep) shift; KEEP="${1:-$KEEP}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

TARGET_DIR="$ROOT_DIR/backend/apps/automations/sprinta/v2"
if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Missing: ${TARGET_DIR#$ROOT_DIR/}" >&2
  exit 1
fi

candidates=()
while IFS= read -r p; do
  [[ -n "$p" ]] && candidates+=("$p")
done < <(
  for d in "$TARGET_DIR"/.chrome-profile-step*; do
    [[ -d "$d" ]] || continue
    stat -f '%m|%N' "$d"
  done \
    | sort -nr \
    | awk -F'\\|' '{print $2}'
)

total="${#candidates[@]}"
if [[ "$total" -le "$KEEP" ]]; then
  echo "[prune] Nothing to prune (found $total, keep $KEEP)"
  exit 0
fi

to_delete=()
idx=0
for p in "${candidates[@]}"; do
  idx=$((idx + 1))
  if [[ "$idx" -le "$KEEP" ]]; then
    continue
  fi
  to_delete+=("$p")
done

echo "[prune] Mode: $MODE"
echo "[prune] Target: ${TARGET_DIR#$ROOT_DIR/}"
echo "[prune] Keep newest: $KEEP"
echo "[prune] Found: $total"
echo ""

echo "[prune] Will delete:"
printf "%s\n" "${to_delete[@]}" | sed "s#^$ROOT_DIR/##" | sed -n '1,200p'

if [[ "$MODE" == "dry-run" ]]; then
  echo ""
  echo "[prune] Dry-run only. Re-run with --apply to delete."
  exit 0
fi

echo ""
echo "[prune] Deleting..."
for p in "${to_delete[@]}"; do
  rm -rf "$p" 2>/dev/null || true
done
echo "[prune] Done."
