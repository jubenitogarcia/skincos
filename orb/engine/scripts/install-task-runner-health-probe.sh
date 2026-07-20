#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo 'install-task-runner-health-probe exige root.' >&2
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SOURCE="$SCRIPT_DIR/internal-task-runner-health-server.js"
INSTALL_DIR=/usr/local/libexec/skincos
TARGET="$INSTALL_DIR/internal-task-runner-health-server.js"
UNIT=/etc/systemd/system/orb-task-runner-health.service
CHECKPOINT_ROOT=${N8N_RUNTIME_HOME:-/var/lib/skincos-runtime/orb}/exports/runtime-checkpoints
STAMP=$(date -u +%Y-%m-%dT%H-%M-%S-%NZ)
CHECKPOINT="$CHECKPOINT_ROOT/task-runner-health-probe-$STAMP"

mkdir -p -m 0750 "$CHECKPOINT"
[[ -f "$TARGET" ]] && cp -a "$TARGET" "$CHECKPOINT/internal-task-runner-health-server.js"
[[ -f "$UNIT" ]] && cp -a "$UNIT" "$CHECKPOINT/orb-task-runner-health.service"

install -d -m 0755 "$INSTALL_DIR"
install -m 0755 "$SOURCE" "$TARGET"

temporary=$(mktemp)
trap 'rm -f "$temporary"' EXIT
cat > "$temporary" <<'UNIT'
[Unit]
Description=Orb internal task runner loopback health probe
After=orb.service
Wants=orb.service

[Service]
Type=simple
User=skincos
Group=skincos
ExecStart=/usr/bin/node /usr/local/libexec/skincos/internal-task-runner-health-server.js
Restart=always
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict

[Install]
WantedBy=multi-user.target
UNIT
install -m 0644 "$temporary" "$UNIT"
systemctl daemon-reload
systemctl enable --now orb-task-runner-health.service >/dev/null

echo "checkpoint_dir=$CHECKPOINT"
echo "service=$(systemctl is-active orb-task-runner-health.service)"
