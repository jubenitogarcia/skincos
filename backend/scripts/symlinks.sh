#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

usage() {
  cat <<'EOF'
Usage:
  ./backend/scripts/symlinks.sh check
  ./backend/scripts/symlinks.sh apply

Purpose:
  - Mantém symlinks "canônicos" apontando para `backend/config/templates/*` e `backend/var/*`.
  - Reporta symlinks quebrados no repo.

Notas:
  - Por padrão, `check` só imprime avisos (exit 0).
EOF
}

cmd="${1:-check}"
shift || true

declare -a EXPECTED=(
  "backend/apps/automations/scraper/config.example.json|../../../config/templates/modules/scraper/config.example.json"
  "backend/apps/automations/scraper/config.local.json|../../../var/scraper/config.local.json"
  "backend/apps/automations/sprinta/legacy/participants.example.csv|../../../../config/templates/examples/sprinta/participants.example.csv"
  "backend/apps/automations/sprinta/legacy/.env.example|../../../../config/templates/modules/sprinta/.env.example"
  "backend/apps/agent-zero/.env.example|../../config/templates/modules/a0/.env.example"
  "backend/apps/instagram/module/config/config.example.json|../../../../config/templates/modules/instagram-module/config.example.json"
  "modules/whatsapp/whatsapp/official/.env.example|../../../backend/config/templates/modules/whatsapp-official/.env.example"
  "modules/whatsapp/whatsapp/gateway/.env.chat-module.example|../../../backend/config/templates/modules/whatsapp-gateway/.env.chat-module.example"
)

apply_one() {
  local rel_path="$1"
  local target="$2"
  local p="$ROOT_DIR/$rel_path"
  mkdir -p "$(dirname "$p")"
  if [[ -e "$p" && ! -L "$p" ]]; then
    echo "[symlinks] WARN: not a symlink, skipping: ${rel_path}" >&2
    return 0
  fi
  ln -sfn "$target" "$p"
}

check_one() {
  local rel_path="$1"
  local target="$2"
  local p="$ROOT_DIR/$rel_path"
  if [[ ! -L "$p" ]]; then
    echo "[symlinks] MISSING: ${rel_path} -> ${target}"
    return 0
  fi
  local cur
  cur="$(readlink "$p" || true)"
  if [[ "$cur" != "$target" ]]; then
    echo "[symlinks] MISMATCH: ${rel_path} -> ${cur} (expected ${target})"
  fi
}

report_broken_symlinks() {
  local broken=0
  while IFS= read -r -d '' link; do
    if [[ ! -e "$link" ]]; then
      echo "[symlinks] BROKEN: ${link#$ROOT_DIR/} -> $(readlink "$link" 2>/dev/null || echo '?')"
      broken=$((broken+1))
    fi
  done < <(find "$ROOT_DIR" -type l -print0 2>/dev/null || true)
  if [[ $broken -gt 0 ]]; then
    echo "[symlinks] Broken symlinks total: $broken"
  fi
}

case "$cmd" in
  apply)
    for item in "${EXPECTED[@]}"; do
      rel="${item%%|*}"
      tgt="${item#*|}"
      apply_one "$rel" "$tgt"
    done
    report_broken_symlinks
    ;;
  check)
    for item in "${EXPECTED[@]}"; do
      rel="${item%%|*}"
      tgt="${item#*|}"
      check_one "$rel" "$tgt"
    done
    report_broken_symlinks
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "[symlinks] Unknown command: $cmd" >&2
    usage
    exit 2
    ;;
esac
