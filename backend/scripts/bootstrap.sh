#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
. "$ROOT_DIR/backend/scripts/env.sh"
. "$ROOT_DIR/backend/scripts/node_pkg.sh"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/bootstrap.sh [--core|--all|--module NAME...] [--ci] [--force]

Instala dependências (principalmente Node) para permitir `./scripts/dev.sh restart`.

Flags:
  --core          Instala dependências do core (crm, a0, messaging-whatsapp, actual-server)
  --all           Instala tudo que é Node no monorepo
  --module NAME   Instala um módulo específico (pode repetir)
  --ci            Usa `npm ci` quando houver package-lock.json
  --force         Reinstala mesmo com `node_modules/` presente (padrão: pula)

Módulos suportados:
  crm | a0 | messaging-whatsapp | actual-server | instagram-module

Notas:
  - `messaging-whatsapp` instala o engine único usado pelo runtime nativo.
  - `crm` também instala dependências da API isoladas em `crm/api` (install menor e mais rápido).

Exemplos:
  ./scripts/bootstrap.sh --core
  ./scripts/bootstrap.sh --module crm --module messaging-whatsapp
EOF
}

MODE="install"
declare -a MODULES=()
FORCE_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --core)
      MODULES+=("crm" "a0" "messaging-whatsapp" "actual-server" "instagram-module")
      shift
      ;;
    --all)
      MODULES+=("crm" "a0" "messaging-whatsapp" "actual-server" "instagram-module")
      shift
      ;;
    --module)
      shift
      MODULES+=("${1:-}")
      shift
      ;;
    --ci)
      MODE="ci"
      shift
      ;;
    --force)
      FORCE_INSTALL=1
      shift
      ;;
    -h|--help|help|"")
      usage
      exit 0
      ;;
    *)
      echo "[bootstrap] Unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [[ ${#MODULES[@]} -eq 0 ]]; then
  echo "[bootstrap] No modules selected." >&2
  usage
  exit 2
fi

normalize() {
  local s="$1"
  case "$s" in
    messaging-whatsapp|whatsapp|engine) echo "messaging-whatsapp" ;;
    actual-server|actual) echo "actual-server" ;;
    instagram-module|instagram) echo "instagram-module" ;;
    crm) echo "crm" ;;
    a0|agent-zero) echo "a0" ;;
    *) echo "$s" ;;
  esac
}

unique_modules=()
seen="|"
for m in "${MODULES[@]}"; do
  m="$(normalize "$m")"
  [[ -n "$m" ]] || continue
  if [[ "$seen" != *"|$m|"* ]]; then
    unique_modules+=("$m")
    seen="${seen}${m}|"
  fi
done

npm_install() {
  local dir="$1"
  [[ -d "$dir" ]] || { echo "[bootstrap] Skip (missing dir): ${dir#$ROOT_DIR/}"; return 0; }
  [[ -f "$dir/package.json" ]] || { echo "[bootstrap] Skip (no package.json): ${dir#$ROOT_DIR/}"; return 0; }
  if [[ $FORCE_INSTALL -eq 0 && -d "$dir/node_modules" ]]; then
    echo "[bootstrap] Skip (node_modules already present): ${dir#$ROOT_DIR/}"
    return 0
  fi
  echo "[bootstrap] Node deps: ${dir#$ROOT_DIR/} (auto: $MODE)"
  install_node_deps "$dir" "$MODE"
}

pnpm_install() {
  local dir="$1"
  npm_install "$dir"
}

  for m in "${unique_modules[@]}"; do
    case "$m" in
      crm)
        npm_install "$ROOT_DIR/crm/console"
        pnpm_install "$ROOT_DIR/crm/api"
        ;;
      a0) npm_install "$ROOT_DIR/backend/apps/agent-zero" ;;
    messaging-whatsapp) npm_install "$ROOT_DIR/messaging/channels/whatsapp/engine" ;;
    actual-server) npm_install "$ROOT_DIR/backend/apps/actual-server" ;;
    instagram-module) pnpm_install "$ROOT_DIR/social/instagram/module" ;;
    *)
      echo "[bootstrap] Unknown module: $m" >&2
      usage
      exit 2
      ;;
  esac
done

echo "[bootstrap] Done."
