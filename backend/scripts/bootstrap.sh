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
  --core          Instala dependências do core (crm, a0, whatsapp official-module, whatsapp gateway, whatsapp stub, actual-server)
  --all           Instala tudo que é Node no monorepo
  --module NAME   Instala um módulo específico (pode repetir)
  --ci            Usa `npm ci` quando houver package-lock.json
  --force         Reinstala mesmo com `node_modules/` presente (padrão: pula)

Módulos suportados:
  crm | a0 | whatsapp-official | whatsapp-gateway | whatsapp-stub | actual-server | chat-module | instagram-module

Notas:
  - `whatsapp-official` também instala `backend/apps/whatsapp/official` (cópia local do whatsapp-web.js) usada pelo `backend/apps/whatsapp/official-module`.
  - `crm` também instala dependências da API isoladas em `backend/apps/crm-api` (install menor e mais rápido).

Exemplos:
  ./scripts/bootstrap.sh --core
  ./scripts/bootstrap.sh --module crm --module whatsapp-official
EOF
}

MODE="install"
declare -a MODULES=()
FORCE_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --core)
      MODULES+=("crm" "a0" "whatsapp-official" "whatsapp-gateway" "whatsapp-stub" "actual-server" "instagram-module")
      shift
      ;;
    --all)
      MODULES+=("crm" "a0" "whatsapp-official" "whatsapp-gateway" "whatsapp-stub" "actual-server" "chat-module" "instagram-module")
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
    whatsapp-official|whatsapp/official-module|official) echo "whatsapp-official" ;;
    whatsapp-gateway|whatsapp/gateway|gateway) echo "whatsapp-gateway" ;;
    whatsapp-stub|whatsapp/stub|stub|whatsapp/backup|backup) echo "whatsapp-stub" ;;
    actual-server|actual) echo "actual-server" ;;
    chat-module|chat) echo "chat-module" ;;
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
        npm_install "$ROOT_DIR/frontend"
        pnpm_install "$ROOT_DIR/backend/apps/crm-api"
        ;;
      a0) npm_install "$ROOT_DIR/backend/apps/agent-zero" ;;
      whatsapp-official)
        pnpm_install "$ROOT_DIR/backend/apps/whatsapp/official-module"
        # `whatsapp/official` depende de puppeteer (pesado). Por padrão, pulamos o download do Chromium.
        if [[ -d "$ROOT_DIR/backend/apps/whatsapp/official" && -f "$ROOT_DIR/backend/apps/whatsapp/official/package.json" ]]; then
          if [[ $FORCE_INSTALL -eq 0 && -d "$ROOT_DIR/backend/apps/whatsapp/official/node_modules" ]]; then
            echo "[bootstrap] Skip (node_modules already present): backend/apps/whatsapp/official"
          else
            echo "[bootstrap] Node deps: backend/apps/whatsapp/official (pnpm, PUPPETEER_SKIP_DOWNLOAD=1)"
            (
              cd "$ROOT_DIR/backend/apps/whatsapp/official"
              export PUPPETEER_SKIP_DOWNLOAD=1
              if command -v pnpm >/dev/null 2>&1; then
                pnpm install
                exit 0
              fi
              if command -v corepack >/dev/null 2>&1; then
                corepack pnpm install
                exit 0
              fi
              echo "[bootstrap] ERROR: pnpm is required for backend/apps/whatsapp/official. Install pnpm or enable corepack." >&2
              exit 2
            )
          fi
        else
          echo "[bootstrap] Skip (missing backend/apps/whatsapp/official)"
      fi
      ;;
    whatsapp-gateway) pnpm_install "$ROOT_DIR/backend/apps/whatsapp/gateway" ;;
    whatsapp-stub) npm_install "$ROOT_DIR/backend/apps/whatsapp/stub" ;;
    actual-server) npm_install "$ROOT_DIR/backend/apps/actual-server" ;;
    chat-module)
      npm_install "$ROOT_DIR/backend/apps/whatsapp/chat-module/whatsapp-core"
      npm_install "$ROOT_DIR/backend/apps/whatsapp/chat-module/whatsapp-api"
      npm_install "$ROOT_DIR/backend/apps/whatsapp/chat-module/whatsapp-ui"
      ;;
    instagram-module) pnpm_install "$ROOT_DIR/backend/apps/instagram/module" ;;
    *)
      echo "[bootstrap] Unknown module: $m" >&2
      usage
      exit 2
      ;;
  esac
done

echo "[bootstrap] Done."
