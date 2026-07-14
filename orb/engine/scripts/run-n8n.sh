#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LABEL="com.jubenito.n8n-evolution"
USER_ID="$(id -u)"

# Prefer launchd restart to avoid duplicate instances and port conflicts.
if launchctl print "gui/$USER_ID/$LABEL" >/dev/null 2>&1; then
  echo "Restarting launchd job: $LABEL"
  launchctl kickstart -k "gui/$USER_ID/$LABEL"
  exit 0
fi

echo "Launchd job not found. Restarting via start-n8n.sh."
if [ ! -x "$ROOT_DIR/start-n8n.sh" ]; then
  echo "Error: start-n8n.sh not found or not executable."
  exit 1
fi

./start-n8n.sh restart
