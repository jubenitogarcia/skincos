#!/usr/bin/env bash
set -euo pipefail

systemctl disable --now skincos-orb-mcp-readonly.service || true
rm -f /etc/systemd/system/skincos-orb-mcp-readonly.service
rm -f /etc/skincos/orb-mcp-readonly-gateway.env
systemctl daemon-reload
echo 'Gateway unit and private configuration removed. State, snapshots and logs were retained; no Orb/n8n service, workflow, credential or public route was changed. The read-only database role is retained for explicit review.'
