#!/usr/bin/env bash
set -euo pipefail

if ! command -v systemctl >/dev/null 2>&1; then
  echo 'systemd unavailable (static/CI environment); runtime status unproven.'
  exit 0
fi
systemctl show skincos-orb-mcp-readonly.service \
  -p FragmentPath -p ExecStart -p WorkingDirectory -p User -p Group \
  -p EnvironmentFiles -p ReadWritePaths -p MainPID -p ActiveState -p SubState -p UnitFileState
systemctl is-active skincos-orb-mcp-readonly.service
