#!/usr/bin/env bash
set -euo pipefail

# Refuse release cleanup when an immutable source bundle is still referenced by
# a workflow runtime manifest. This is deliberately conservative: historical
# manifests are retained as rollback evidence, so every referenced release is
# protected until the manifest is explicitly retired with the workflow version.

readonly RUNTIME_HOME="${N8N_RUNTIME_HOME:-/var/lib/skincos-runtime/orb}"
readonly RELEASE_BASE="${SKINCOS_RELEASE_BASE:-/opt/skincos/releases}"
readonly MANIFEST_BASE="$RUNTIME_HOME/workflow-runtime-manifests"
candidate_delete=''

usage() {
  cat <<'EOF'
Usage: scripts/runtime/assert-workflow-runtime-retention.sh [--candidate-delete <release-sha>]

Prints every immutable release protected by a workflow runtime manifest and
fails if a manifest is malformed, its release root is absent, or the requested
candidate deletion is protected. Invoke immediately before any release cleanup.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --candidate-delete) candidate_delete="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

[[ -z "$candidate_delete" || "$candidate_delete" =~ ^[0-9a-f]{40}$ ]] || {
  echo '--candidate-delete must be a full 40-character release SHA.' >&2
  exit 2
}

node - "$MANIFEST_BASE" "$RELEASE_BASE" "$candidate_delete" <<'NODE'
const fs = require('fs');
const path = require('path');
const [manifestBase, releaseBase, candidate] = process.argv.slice(2);
const normalizedReleaseBase = path.resolve(releaseBase);
const manifests = [];

function visit(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.isFile() && entry.name.endsWith('.json')) manifests.push(target);
  }
}

visit(manifestBase);
const protectedReleases = new Map();
for (const manifestPath of manifests) {
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (error) { throw new Error(`Invalid workflow runtime manifest ${manifestPath}: ${error.message}`); }
  const releaseRoot = String(manifest.releaseRoot || '');
  const resolvedRoot = path.resolve(releaseRoot);
  const parts = path.relative(normalizedReleaseBase, resolvedRoot).split(path.sep);
  const releaseId = parts[0];
  if (parts.length !== 4 || !/^[0-9a-f]{40}$/.test(releaseId) || parts.slice(1).join('/') !== 'source/orb/engine') {
    throw new Error(`Manifest ${manifestPath} has an invalid immutable release root: ${releaseRoot || 'missing'}.`);
  }
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Manifest ${manifestPath} references a missing release root: ${releaseRoot}.`);
  }
  const rows = protectedReleases.get(releaseId) || [];
  rows.push(path.relative(manifestBase, manifestPath));
  protectedReleases.set(releaseId, rows);
}

if (candidate && protectedReleases.has(candidate)) {
  throw new Error(`Refusing cleanup of ${candidate}: protected by ${protectedReleases.get(candidate).join(', ')}.`);
}
process.stdout.write(JSON.stringify({ ok: true, protectedReleases: [...protectedReleases].map(([releaseId, manifests]) => ({ releaseId, manifests })) }) + '\n');
NODE
