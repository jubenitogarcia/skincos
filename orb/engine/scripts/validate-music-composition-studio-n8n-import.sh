#!/usr/bin/env bash
set -euo pipefail

ENGINE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE="$ENGINE_ROOT/generated-workflows/music-composition-studio/package.json"
ISOLATED_HOME="$(mktemp -d /tmp/msc-n8n-import.XXXXXX)"

cleanup() {
  case "$ISOLATED_HOME" in
    /tmp/msc-n8n-import.*) rm -rf -- "$ISOLATED_HOME" ;;
    *)
      echo "refusing unsafe cleanup: $ISOLATED_HOME" >&2
      exit 3
      ;;
  esac
}
trap cleanup EXIT

N8N_USER_FOLDER="$ISOLATED_HOME" \
  DB_TYPE=sqlite \
  n8n import:workflow --input="$PACKAGE"

[[ -f "$ISOLATED_HOME/.n8n/database.sqlite" ]]

N8N_USER_FOLDER="$ISOLATED_HOME" \
  DB_TYPE=sqlite \
  n8n export:workflow --all --output="$ISOLATED_HOME/export.json" >/dev/null

node - "$ISOLATED_HOME/export.json" <<'NODE'
const fs = require('fs');
const workflows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (
  workflows.length !== 1
  || workflows[0].name !== 'Music Composition Studio (Unified)'
  || workflows[0].active !== false
) {
  throw new Error('isolated n8n inventory is not exactly one inactive unified workflow');
}
NODE

echo "n8n isolated import validation: OK (version $(n8n --version); 1 inactive unified workflow)"
