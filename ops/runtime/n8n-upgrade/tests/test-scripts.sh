#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
export N8N_UPGRADE_ENV=staging
export N8N_EXPECTED_ENV=staging
export N8N_STAGING_MARKER=orb-n8n-staging
export N8N_DRY_RUN=1

for script in preflight checkpoint backup verify-backup upgrade migrate configure-community-packages activate-versioned-runtime status smoke validate-oauth validate-mcp rollback evidence-collection; do
  bash -n "$ROOT/$script.sh"
  output=$(bash "$ROOT/$script.sh" --dry-run)
  printf '%s\n' "$output" | grep -q 'DRY-RUN\|INFO:'
done

guard_log=$(mktemp)
if N8N_DRY_RUN=0 bash "$ROOT/upgrade.sh" >"$guard_log" 2>&1; then
  echo 'upgrade guard failed: apply unexpectedly allowed' >&2
  exit 1
fi
grep -q 'N8N_UPGRADE_APPLY=YES' "$guard_log"
rm -f "$guard_log"

node --input-type=module - "$ROOT/VERSION_MANIFEST.json" <<'NODE'
import fs from 'node:fs';
const m=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if (m.environment_policy.target_version !== '2.32.5') throw new Error('target drift');
if (!/^sha512-/.test(m.artifact.integrity)) throw new Error('integrity missing');
if (m.additional_packages.length !== 10) throw new Error('package inventory drift');
const packages = new Map(m.additional_packages.map((item) => [item.name, item]));
if (packages.has('n8n-nodes-evolution-api')) throw new Error('redundant Evolution package present');
if (packages.get('n8n-nodes-evolution-api-en')?.version !== '1.0.2') throw new Error('referenced Evolution package drift');
if (packages.get('n8n-nodes-mcp')?.version !== '0.1.37') throw new Error('MCP package drift');
for (const item of packages.values()) if (!/^sha512-/.test(item.integrity || '')) throw new Error('community package integrity missing');
const secretKey = (key) => /password|secret|cookie|bearer/i.test(key);
const walk = (value) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (secretKey(key)) throw new Error(`secret-like manifest key: ${key}`);
    walk(child);
  }
};
walk(m);
console.log('manifest_validation=pass');
NODE
printf 'script_dry_runs=pass\n'
