#!/usr/bin/env bash
set -euo pipefail

# Production launcher: it never installs packages, runs Prisma generation, or
# builds TypeScript. The release-preparation step must create all artifacts on
# the Linux filesystem before systemd is allowed to start this process.
RELEASE_ROOT="${MESSAGING_RELEASE_ROOT:-/opt/skincos/current/messaging-whatsapp}"
ENV_FILE="${EVOLUTION_API_ENV_FILE:-/etc/skincos/messaging-whatsapp.env}"
NODE_BIN="${NODE_BIN:-/usr/bin/node}"

[[ -x "$NODE_BIN" ]] || { echo "Node runtime is unavailable: $NODE_BIN" >&2; exit 1; }
[[ -d "$RELEASE_ROOT/node_modules" ]] || { echo "Native dependencies are unavailable: $RELEASE_ROOT/node_modules" >&2; exit 1; }
[[ -f "$RELEASE_ROOT/dist/main.js" ]] || { echo "Release artifact is unavailable: $RELEASE_ROOT/dist/main.js" >&2; exit 1; }
[[ -r "$ENV_FILE" ]] || { echo "Private WhatsApp environment is unavailable: $ENV_FILE" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export LOG_LEVEL="${LOG_LEVEL:-ERROR,WARN}"
export LOG_COLOR="${LOG_COLOR:-false}"
cd "$RELEASE_ROOT"
exec "$NODE_BIN" dist/main.js
