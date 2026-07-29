#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT

if N8N_UPGRADE_ENV=production N8N_EXPECTED_ENV=production N8N_STAGING_MARKER=orb-n8n-staging N8N_AUDIT_APPLY=YES N8N_AUDIT_ROOT="$tmp" "$ROOT/audit-release-baseline.sh" 2.32.5; then
  echo 'expected production environment refusal' >&2; exit 1
fi
if N8N_UPGRADE_ENV=staging N8N_EXPECTED_ENV=staging N8N_STAGING_MARKER=wrong N8N_AUDIT_APPLY=YES N8N_AUDIT_ROOT="$tmp" "$ROOT/audit-release-baseline.sh" 2.32.5; then
  echo 'expected marker refusal' >&2; exit 1
fi
if N8N_UPGRADE_ENV=staging N8N_EXPECTED_ENV=staging N8N_STAGING_MARKER=orb-n8n-staging N8N_AUDIT_APPLY=YES N8N_AUDIT_ROOT=/var/lib/skincos "$ROOT/audit-release-baseline.sh" 2.32.5; then
  echo 'expected production path refusal' >&2; exit 1
fi
node --input-type=module - "$ROOT/community-packages.json" <<'NODE'
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (manifest.packages.some(({ name }) => name === 'n8n-nodes-evolution-api')) throw new Error('legacy Evolution package must remain excluded');
if (!manifest.packages.some(({ name }) => name === 'n8n-nodes-evolution-api-en')) throw new Error('managed Evolution English package missing');
NODE
echo 'release baseline guard tests passed'
