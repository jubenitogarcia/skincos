#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
workflow="$ROOT/.github/workflows/orb-n8n-stable-release-watch.yml"

[[ -f "$workflow" ]] || { echo 'release-watch workflow is missing' >&2; exit 1; }

require_line() { grep -Fqx -- "$1" "$workflow" || { echo "missing required workflow line: $1" >&2; exit 1; }; }
require_text() { grep -Fq -- "$1" "$workflow" || { echo "missing required workflow text: $1" >&2; exit 1; }; }

require_line 'on:'
require_line '  schedule:'
require_line '  workflow_dispatch:'
require_line '  contents: read'
require_line '  group: orb-n8n-stable-release-watch'
require_line '  cancel-in-progress: false'
require_line '    runs-on: ubuntu-latest'
require_line '    timeout-minutes: 45'
require_line '      N8N_UPGRADE_ENV: staging'
require_line '      N8N_EXPECTED_ENV: staging'
require_line '      N8N_STAGING_MARKER: orb-n8n-staging'
require_line "      N8N_RELEASE_WATCH_APPLY: 'YES'"
require_line '      N8N_AUDIT_ROOT: /tmp/skincos-n8n-release-watch'
require_text 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6'
require_text 'persist-credentials: false'
require_text 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6'
require_text "node-version: '22.23.1'"
require_text 'npm@10.9.8'
require_text 'https://registry.npmjs.org/'
require_text 'bash ops/runtime/n8n-security/watch-stable-release.sh'
require_text 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4'

if grep -Eq '(pull-requests|contents|deployments):[[:space:]]*write|(upgrade|migrate|rollback)\.sh' "$workflow"; then
  echo 'workflow contains a forbidden production write capability or command' >&2
  exit 1
fi

echo 'release watch workflow tests passed'
