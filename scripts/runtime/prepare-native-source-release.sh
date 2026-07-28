#!/usr/bin/env bash
set -euo pipefail

# Stages a checksum-verified tracked-source archive required by the lifecycle
# units on native Linux. Windows creates and transfers the archive first; this
# script never walks the Windows checkout through /mnt/c.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_BASE="${SKINCOS_RELEASE_BASE:-/opt/skincos/releases}"
CURRENT_LINK="${SKINCOS_SOURCE_CURRENT_LINK:-/opt/skincos/current/source}"
RELEASE_ID="${SKINCOS_RELEASE_ID:-}"
DESTINATION="$RELEASE_BASE/$RELEASE_ID/source"
STAGING="$RELEASE_BASE/.source-staging-$RELEASE_ID-$$"
RELEASE_ARCHIVE=""
RELEASE_ARCHIVE_SHA256=""
RELEASE_LINEAGE=""
RELEASE_LINEAGE_SHA256=""
CRM_NPM_CACHE="${CRM_NPM_CACHE:-/var/lib/skincos-runtime/cache/crm-api}"
APPLY=0
STAGE_ONLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-native-source-release.sh --archive <native-tar> --sha256 <sha256> --lineage <json> --lineage-sha256 <sha256> [--apply --stage-only]

Set SKINCOS_RELEASE_ID to the reviewed main commit SHA. The archive must have
already been created and copied by Windows into a native Linux path (never
/mnt/c). With --apply, validates its SHA-256, stages tracked source in
/opt/skincos/releases/<sha>/source, installs locked CRM production dependencies
on Linux. A production source pointer is promoted only by
promote-native-source-release.sh after the workflow/runtime coherence gate.
It never copies private .env files or worktree metadata.

The lineage JSON is produced by verify-native-source-release-lineage.ps1 from
the reviewed Git repository. It proves the candidate is a descendant of the
currently effective release and is copied immutably into the staged bundle.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --stage-only) STAGE_ONLY=1 ;;
    --archive) RELEASE_ARCHIVE="${2:-}"; shift ;;
    --sha256) RELEASE_ARCHIVE_SHA256="${2:-}"; shift ;;
    --lineage) RELEASE_LINEAGE="${2:-}"; shift ;;
    --lineage-sha256) RELEASE_LINEAGE_SHA256="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

[[ "$RELEASE_ID" =~ ^[0-9a-f]{40}$ ]] || { echo 'SKINCOS_RELEASE_ID must be a full 40-character reviewed commit SHA.' >&2; exit 1; }
[[ -n "$RELEASE_ARCHIVE" && -f "$RELEASE_ARCHIVE" ]] || { echo '--archive must name an existing native source archive.' >&2; exit 1; }
[[ "$RELEASE_ARCHIVE" != /mnt/* ]] || { echo '--archive must already be on native Linux storage, not /mnt/c.' >&2; exit 1; }
[[ "$RELEASE_ARCHIVE_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]] || { echo '--sha256 must be a SHA-256 hexadecimal digest.' >&2; exit 1; }
[[ -n "$RELEASE_LINEAGE" && -f "$RELEASE_LINEAGE" ]] || { echo '--lineage must name an existing native lineage JSON.' >&2; exit 1; }
[[ "$RELEASE_LINEAGE" != /mnt/* ]] || { echo '--lineage must already be on native Linux storage, not /mnt/c.' >&2; exit 1; }
[[ "$RELEASE_LINEAGE_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]] || { echo '--lineage-sha256 must be a SHA-256 hexadecimal digest.' >&2; exit 1; }
[[ ! -e "$DESTINATION" ]] || { echo "Source release destination already exists: $DESTINATION" >&2; exit 1; }
[[ "$STAGE_ONLY" != "1" || "$APPLY" = "1" ]] || { echo '--stage-only requires --apply.' >&2; exit 1; }

echo "Source release ID: $RELEASE_ID"
echo "Native source archive: $RELEASE_ARCHIVE"
echo "Destination: $DESTINATION"
if [[ "$APPLY" != "1" ]]; then
  echo 'Dry run complete. Use --apply --stage-only only after CI, backup and cutover gates pass.'
  exit 0
fi
[[ "$STAGE_ONLY" = "1" ]] || {
  echo 'Direct source-pointer changes are disabled. Stage first, then use promote-native-source-release.sh.' >&2
  exit 1
}

command -v npm >/dev/null 2>&1 || { echo 'Missing required command: npm' >&2; exit 1; }
command -v sudo >/dev/null 2>&1 || { echo 'Missing required command: sudo' >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo 'Missing required command: sha256sum' >&2; exit 1; }
command -v setfacl >/dev/null 2>&1 || { echo 'Missing required command: setfacl (install the acl package).' >&2; exit 1; }
sudo -n true
actual_archive_sha256="$(sha256sum "$RELEASE_ARCHIVE" | awk '{print $1}')"
[[ "${actual_archive_sha256,,}" == "${RELEASE_ARCHIVE_SHA256,,}" ]] || { echo 'Source archive checksum mismatch.' >&2; exit 1; }
actual_lineage_sha256="$(sha256sum "$RELEASE_LINEAGE" | awk '{print $1}')"
[[ "${actual_lineage_sha256,,}" == "${RELEASE_LINEAGE_SHA256,,}" ]] || { echo 'Source lineage checksum mismatch.' >&2; exit 1; }
lineage_parent="$(node - "$RELEASE_LINEAGE" "$RELEASE_ID" <<'NODE'
const fs = require('fs');
const [file, expectedRelease] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
if (value.releaseId !== expectedRelease) throw new Error('Lineage releaseId does not match SKINCOS_RELEASE_ID.');
if (!/^[0-9a-f]{7,64}$/.test(String(value.parentReleaseId || ''))) throw new Error('Lineage parentReleaseId is invalid.');
if (value.verifiedAncestor !== true) throw new Error('Lineage does not contain verifiedAncestor=true.');
process.stdout.write(value.parentReleaseId);
NODE
)" || { echo 'Source lineage JSON is invalid.' >&2; exit 1; }
echo "Verified release lineage parent: $lineage_parent"

cleanup_staging() {
  sudo -n rm -rf "$STAGING"
}
trap cleanup_staging EXIT INT TERM

sudo -n install -d -o root -g skincos -m 0750 "$STAGING" "$CRM_NPM_CACHE"
sudo -n tar -xf "$RELEASE_ARCHIVE" -C "$STAGING"
sudo -n install -m 0640 "$RELEASE_LINEAGE" "$STAGING/.skincos-release-lineage.json"
sudo -n chown -R root:skincos "$STAGING"
sudo -n find "$STAGING" -type d -exec chmod 0750 {} +
sudo -n find "$STAGING" -type f -exec chmod 0640 {} +
sudo -n find "$STAGING" -type f \( -path '*/scripts/*.sh' -o -path '*/scripts/*/*.sh' \) -exec chmod 0750 {} +
# These two operator-only scripts must execute as postgres for local peer
# authentication to the n8n database. They contain no credentials; keep the
# rest of the staged source restricted to root:skincos.
sudo -n chmod 0644 \
  "$STAGING/orb/engine/scripts/workflow-runtime-manifest.js" \
  "$STAGING/orb/engine/scripts/apply-livia-runtime-isolation.js"
sudo -n chown -R skincos:skincos "$CRM_NPM_CACHE"

sudo -n test -f "$STAGING/crm/api/package-lock.json" || { echo 'CRM lockfile is missing from source release.' >&2; exit 1; }
# npm must write node_modules during staging, but the promoted source returns
# to root ownership before any service is allowed to execute it.
sudo -n chown -R skincos:skincos "$STAGING/crm/api"
sudo -n -u skincos env npm_config_cache="$CRM_NPM_CACHE" \
  npm --prefix "$STAGING/crm/api" ci --omit=dev --ignore-scripts
sudo -n test -d "$STAGING/crm/api/node_modules/express" || { echo 'CRM production dependencies were not installed.' >&2; exit 1; }
sudo -n chown -R root:skincos "$STAGING/crm/api"
sudo -n test -f "$STAGING/orb/engine/orb-proxy/server.js" || { echo 'Orb proxy source is missing from source release.' >&2; exit 1; }
sudo -n test -f "$STAGING/integration/ef/requirements.lock" || { echo 'Booking requirements are missing from source release.' >&2; exit 1; }
sudo -n test -f "$STAGING/orb/engine/compose2-current.js" || { echo 'Livia job-graph source is missing from source release.' >&2; exit 1; }
sudo -n test -f "$STAGING/orb/engine/scripts/livia/build-platform-job-graph.js" || { echo 'Livia job-graph runtime adapter is missing from source release.' >&2; exit 1; }
# The BQ node externalizes a legacy n8n Code node. Validate the adapter against
# image, video and mixed-carousel item fixtures before changing the live link.
sudo -n -u skincos env \
  LIVIA_BUILD_JOB_GRAPH_SOURCE="$STAGING/orb/engine/compose2-current.js" \
  N8N_RUNTIME_HOME="${N8N_RUNTIME_HOME:-/var/lib/skincos-runtime/orb}" \
  node "$STAGING/orb/engine/scripts/livia/build-platform-job-graph.js" --assert-runtime-compatibility >/dev/null
sudo -n -u skincos env \
  LIVIA_BUILD_JOB_GRAPH_SOURCE="$STAGING/orb/engine/compose2-current.js" \
  N8N_RUNTIME_HOME="${N8N_RUNTIME_HOME:-/var/lib/skincos-runtime/orb}" \
  node "$STAGING/orb/engine/scripts/livia/build-platform-job-graph.js" --assert-output-contract >/dev/null
sudo -n -u skincos env \
  LIVIA_BUILD_JOB_GRAPH_SOURCE="$STAGING/orb/engine/compose2-current.js" \
  N8N_RUNTIME_HOME="${N8N_RUNTIME_HOME:-/var/lib/skincos-runtime/orb}" \
  node "$STAGING/orb/engine/scripts/livia/build-platform-job-graph.js" --assert-job-graph-contracts >/dev/null

sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$DESTINATION")"
sudo -n mv "$STAGING" "$DESTINATION"
trap - EXIT INT TERM
sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$CURRENT_LINK")"
# The versioned n8n writer authenticates locally as postgres. Permit only
# traversal to its immutable scripts and only manifest-directory writes; no
# workflow sidecar or source tree becomes generally readable or writable.
for acl_dir in "$RELEASE_BASE/$RELEASE_ID" "$DESTINATION" "$DESTINATION/orb" "$DESTINATION/orb/engine" "$DESTINATION/orb/engine/scripts"; do
  sudo -n setfacl -m u:postgres:--x "$acl_dir"
done
sudo -n setfacl -m u:postgres:r-- \
  "$DESTINATION/orb/engine/scripts/workflow-runtime-manifest.js" \
  "$DESTINATION/orb/engine/scripts/apply-livia-runtime-isolation.js"
MANIFEST_DIR="${N8N_RUNTIME_HOME:-/var/lib/skincos-runtime/orb}/workflow-runtime-manifests/WGXr4vYkv9UoJ8zc"
sudo -n install -d -o root -g root -m 0750 "$MANIFEST_DIR"
sudo -n setfacl -m u:postgres:--x "$(dirname "$(dirname "$MANIFEST_DIR")")" "$(dirname "$MANIFEST_DIR")"
sudo -n setfacl -m u:postgres:rwx "$MANIFEST_DIR"
echo "Native source release staged: $DESTINATION"
