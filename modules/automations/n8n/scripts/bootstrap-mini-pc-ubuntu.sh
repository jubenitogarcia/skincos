#!/usr/bin/env bash
set -euo pipefail

N8N_VERSION="${N8N_VERSION:-2.8.3}"
NODE_N8N_VERSION="${NODE_N8N_VERSION:-24.8.0}"
NODE_EVOLUTION_VERSION="${NODE_EVOLUTION_VERSION:-20.19.5}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This bootstrap targets Ubuntu/Debian with apt-get."
  exit 1
fi

sudo apt-get update
sudo apt-get install -y \
  bash \
  build-essential \
  ca-certificates \
  curl \
  git \
  jq \
  lsof \
  netcat-openbsd \
  openssh-client \
  pkg-config \
  python3 \
  rsync \
  sqlite3 \
  tar \
  xz-utils

if [ ! -d "$HOME/.nvm" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi

# shellcheck disable=SC1091
source "$HOME/.nvm/nvm.sh"
nvm install "$NODE_N8N_VERSION"
nvm install "$NODE_EVOLUTION_VERSION"
nvm alias default "$NODE_N8N_VERSION"
nvm use "$NODE_N8N_VERSION" >/dev/null
npm install -g "n8n@$N8N_VERSION"

cd "$ROOT_DIR"
npm ci

if [ -d "$ROOT_DIR/evolution-api" ]; then
  cd "$ROOT_DIR/evolution-api"
  nvm use "$NODE_EVOLUTION_VERSION" >/dev/null
  npm ci
  npm run db:generate || true
  npm run build || npx tsup
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  arch="$(dpkg --print-architecture)"
  tmp_deb="$(mktemp)"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb" -o "$tmp_deb"
  sudo dpkg -i "$tmp_deb"
  rm -f "$tmp_deb"
fi

RUNTIME_HOME="${N8N_RUNTIME_HOME:-/mnt/c/CodexRuntime/n8n}"
mkdir -p \
  "$RUNTIME_HOME/env" \
  "$RUNTIME_HOME/evolution-api/instances" \
  "$RUNTIME_HOME/evolution-api/store" \
  "$RUNTIME_HOME/n8n-home" \
  "$RUNTIME_HOME/cloudflared" \
  "$RUNTIME_HOME/logs" \
  "$RUNTIME_HOME/health" \
  "$RUNTIME_HOME/tmp" \
  "$RUNTIME_HOME/binary-data" \
  "$RUNTIME_HOME/backups"

bash "$ROOT_DIR/scripts/install-mini-pc-systemd.sh"

echo "Bootstrap complete."
echo "Next: restore the migration bundle with scripts/restore-mini-pc-migration-bundle.sh before starting services."
