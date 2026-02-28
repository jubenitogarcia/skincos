#!/usr/bin/env bash
set -euo pipefail

PORT="${META_ADS_API_PORT:-4000}"

if command -v curl >/dev/null 2>&1; then
  curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1 && exit 0
fi

exit 1
