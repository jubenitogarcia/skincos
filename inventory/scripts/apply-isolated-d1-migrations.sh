#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$ROOT_DIR/scripts/d1/apply-isolated-domain-migrations.sh" inventory "$@"
