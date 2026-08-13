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
COORDINATION_CLOSURES=()
CRM_NPM_CACHE="${CRM_NPM_CACHE:-/var/lib/skincos-runtime/cache/crm-api}"
COORDINATION_PROOF_FILE="${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-}"
coordination_acquired=0
release_identity_file=''
native_runtime_identity_file=''
APPLY=0
STAGE_ONLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-native-source-release.sh --archive <native-tar> --sha256 <sha256> --lineage <json> --lineage-sha256 <sha256> [--coordination-closure <json>]... [--apply --stage-only]

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

Each applied release must also carry one or more dependency-closure attestations
generated from the same reviewed commit. They are installed below the immutable
source tree for the mini-PC coordination adapter.
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
    --coordination-closure) COORDINATION_CLOSURES+=("${2:-}"); shift ;;
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
if [[ "$APPLY" = "1" && "${#COORDINATION_CLOSURES[@]}" -eq 0 ]]; then
  echo 'At least one --coordination-closure attestation is required for an applied native release.' >&2
  exit 1
fi
coordination_orb_closure=''
coordination_native_runtime_closure=''
for closure_file in "${COORDINATION_CLOSURES[@]}"; do
  [[ -n "$closure_file" && -f "$closure_file" ]] || { echo "Coordination closure is unavailable: $closure_file" >&2; exit 1; }
  [[ "$closure_file" != /mnt/* ]] || { echo 'Coordination closure must already be on native Linux storage.' >&2; exit 1; }
  closure_module="$(node - "$closure_file" "$RELEASE_ID" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const [file, expectedSource] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
const canonicalJson = (input) => Array.isArray(input)
  ? `[${input.map(canonicalJson).join(',')}]`
  : input && typeof input === 'object'
    ? `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(input[key])}`).join(',')}}`
    : JSON.stringify(input);
if (!/^[0-9a-f]{40}$/.test(String(value.sourceCommit || '').toLowerCase())
  || String(value.sourceCommit).toLowerCase() !== expectedSource.toLowerCase()
  || !/^[0-9a-f]{40}$/.test(String(value.sourceTree || '').toLowerCase())
  || !/^[0-9a-f]{64}$/.test(String(value.digest || '').toLowerCase())
  || !/^[a-z0-9][a-z0-9._/-]{0,127}$/.test(String(value.module || '').toLowerCase())
  || !value.material || value.material.schemaVersion !== 1
  || value.material.module !== String(value.module).toLowerCase()
  || !Array.isArray(value.material.inputs) || value.material.inputs.length === 0
  || crypto.createHash('sha256').update(canonicalJson(value.material)).digest('hex') !== String(value.digest).toLowerCase()) {
  throw new Error('coordination closure identity or digest is invalid');
}
for (const entry of value.material.inputs) {
  if (!entry || typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.split('/').includes('..') || !/^[0-9a-f]{40}$/.test(String(entry.blob || '').toLowerCase())) {
    throw new Error('coordination closure input is invalid');
  }
}
process.stdout.write(String(value.module).toLowerCase());
NODE
)"
  printf 'coordination_module=%s\n' "$closure_module"
  if [[ "$closure_module" == 'orb' ]]; then
    coordination_orb_closure="$closure_file"
  fi
  if [[ "$closure_module" == 'native-runtime' ]]; then
    coordination_native_runtime_closure="$closure_file"
  fi
done
if [[ "$APPLY" = "1" && -z "$coordination_orb_closure" ]]; then
  echo 'An Orb dependency-closure attestation is required for an applied native source release.' >&2
  exit 1
fi
if [[ "$APPLY" = "1" && -z "$coordination_native_runtime_closure" ]]; then
  echo 'A native-runtime dependency-closure attestation is required for an applied native source release.' >&2
  exit 1
fi
readonly ARCHIVE_PREFIX="skincos-$RELEASE_ID/"

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
command -v tar >/dev/null 2>&1 || { echo 'Missing required command: tar' >&2; exit 1; }
command -v awk >/dev/null 2>&1 || { echo 'Missing required command: awk' >&2; exit 1; }
command -v setfacl >/dev/null 2>&1 || { echo 'Missing required command: setfacl (install the acl package).' >&2; exit 1; }
sudo -n true
actual_archive_sha256="$(sha256sum "$RELEASE_ARCHIVE" | awk '{print $1}')"
[[ "${actual_archive_sha256,,}" == "${RELEASE_ARCHIVE_SHA256,,}" ]] || { echo 'Source archive checksum mismatch.' >&2; exit 1; }
actual_lineage_sha256="$(sha256sum "$RELEASE_LINEAGE" | awk '{print $1}')"
[[ "${actual_lineage_sha256,,}" == "${RELEASE_LINEAGE_SHA256,,}" ]] || { echo 'Source lineage checksum mismatch.' >&2; exit 1; }
release_identity_file="$(mktemp /tmp/skincos-native-release-identity.XXXXXX)"
native_runtime_identity_file="$(mktemp /tmp/skincos-native-runtime-release-identity.XXXXXX)"
cleanup_identity() { rm -f -- "$release_identity_file" "$native_runtime_identity_file"; }
trap cleanup_identity EXIT INT TERM
node - "$coordination_orb_closure" "$RELEASE_ID" "${RELEASE_ARCHIVE_SHA256,,}" > "$release_identity_file" <<'NODE'
const fs = require('fs');
const [closureFile, releaseId, archiveDigest] = process.argv.slice(2);
const closure = JSON.parse(fs.readFileSync(closureFile, 'utf8'));
const identity = {
  schemaVersion: 1,
  module: 'orb',
  sourceCommit: String(closure.sourceCommit).toLowerCase(),
  sourceTree: String(closure.sourceTree).toLowerCase(),
  dependencyClosureDigest: String(closure.digest).toLowerCase(),
  artifacts: [{ name: 'native-source-archive', id: `native-source:${releaseId}`, digest: archiveDigest }],
};
process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
NODE
node - "$coordination_native_runtime_closure" "$RELEASE_ID" "${RELEASE_ARCHIVE_SHA256,,}" > "$native_runtime_identity_file" <<'NODE'
const fs = require('fs');
const [closureFile, releaseId, archiveDigest] = process.argv.slice(2);
const closure = JSON.parse(fs.readFileSync(closureFile, 'utf8'));
const identity = {
  schemaVersion: 1,
  module: 'native-runtime',
  sourceCommit: String(closure.sourceCommit).toLowerCase(),
  sourceTree: String(closure.sourceTree).toLowerCase(),
  dependencyClosureDigest: String(closure.digest).toLowerCase(),
  artifacts: [{ name: 'native-source-archive', id: `native-source:${releaseId}`, digest: archiveDigest }],
};
process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
NODE
if ! tar -tzf "$RELEASE_ARCHIVE" | awk -v prefix="$ARCHIVE_PREFIX" '
  BEGIN { found = 0; invalid = 0 }
  NF {
    found = 1
    if (index($0, prefix) != 1 || $0 ~ /(^|\/)\.\.(\/|$)/) invalid = 1
  }
  END { exit !(found && !invalid) }
'; then
  echo "Source archive must contain only the expected top-level prefix: $ARCHIVE_PREFIX" >&2
  exit 1
fi
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

coordination_run() {
  "$ROOT_DIR/scripts/runtime/global-coordination-mini-pc.sh" "$@" --proof-file "$COORDINATION_PROOF_FILE"
}
coordination_check() {
  coordination_run check \
    --resource release:orb --module orb --source "$RELEASE_ID" \
    --closure-file "$coordination_orb_closure" >/dev/null
}
cleanup_all() {
  if (( coordination_acquired == 1 )); then
    if [[ -d "$STAGING" ]]; then
      if coordination_check; then
        sudo -n rm -rf "$STAGING"
      else
        echo 'Global coordination proof was unavailable while cleaning native staging; staging was left untouched.' >&2
      fi
    fi
    coordination_run release >/dev/null 2>&1 || echo 'Unable to release the mini-PC Orb staging lease; it will expire fail-closed.' >&2
    coordination_acquired=0
  fi
  if [[ -n "$release_identity_file" || -n "$native_runtime_identity_file" ]]; then
    rm -f -- "$release_identity_file" "$native_runtime_identity_file"
  fi
}
trap cleanup_all EXIT INT TERM

COORDINATION_PROOF_FILE="${COORDINATION_PROOF_FILE:-/var/lib/skincos-runtime/global-coordination/release-orb-stage-$RELEASE_ID-$$.json}"
coordination_run acquire \
  --resource release:orb --module orb --source "$RELEASE_ID" \
  --closure-file "$coordination_orb_closure" --operation mutation \
  --idempotency-key "mini-pc:release:orb:stage:$RELEASE_ID:$$" >/dev/null
coordination_acquired=1
coordination_check

sudo -n install -d -o root -g skincos -m 0750 "$STAGING" "$CRM_NPM_CACHE"
coordination_check
sudo -n tar -xzf "$RELEASE_ARCHIVE" --strip-components=1 -C "$STAGING"
coordination_check
sudo -n install -m 0640 "$RELEASE_LINEAGE" "$STAGING/.skincos-release-lineage.json"
coordination_check
for closure_file in "${COORDINATION_CLOSURES[@]}"; do
  closure_module="$(node - "$closure_file" <<'NODE'
const fs = require('fs');
const [file] = process.argv.slice(2);
process.stdout.write(String(JSON.parse(fs.readFileSync(file, 'utf8')).module).toLowerCase());
NODE
)"
  sudo -n install -m 0640 "$closure_file" "$STAGING/.skincos-global-coordination-${closure_module}.json"
done
coordination_check
sudo -n install -m 0640 "$release_identity_file" "$STAGING/.skincos-release-identity-orb.json"
coordination_check
sudo -n install -m 0640 "$native_runtime_identity_file" "$STAGING/.skincos-release-identity-native-runtime.json"
coordination_check
sudo -n chown -R root:skincos "$STAGING"
coordination_check
sudo -n find "$STAGING" -type d -exec chmod 0750 {} +
coordination_check
sudo -n find "$STAGING" -type f -exec chmod 0640 {} +
coordination_check
sudo -n find "$STAGING" -type f \( -path '*/scripts/*.sh' -o -path '*/scripts/*/*.sh' \) -exec chmod 0750 {} +
# These two operator-only scripts must execute as postgres for local peer
# authentication to the n8n database. They contain no credentials; keep the
# rest of the staged source restricted to root:skincos.
coordination_check
sudo -n chmod 0644 \
  "$STAGING/orb/engine/scripts/workflow-runtime-manifest.js" \
  "$STAGING/orb/engine/scripts/apply-livia-runtime-isolation.js"
coordination_check
sudo -n chown -R skincos:skincos "$CRM_NPM_CACHE"

sudo -n test -f "$STAGING/crm/api/package-lock.json" || { echo 'CRM lockfile is missing from source release.' >&2; exit 1; }
# npm must write node_modules during staging, but the promoted source returns
# to root ownership before any service is allowed to execute it.
coordination_check
sudo -n chown -R skincos:skincos "$STAGING/crm/api"
sudo -n -u skincos env npm_config_cache="$CRM_NPM_CACHE" \
  npm --prefix "$STAGING/crm/api" ci --omit=dev --ignore-scripts
sudo -n test -d "$STAGING/crm/api/node_modules/express" || { echo 'CRM production dependencies were not installed.' >&2; exit 1; }
coordination_check
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

coordination_check
sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$DESTINATION")"
coordination_check
sudo -n mv "$STAGING" "$DESTINATION"
coordination_check
sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$CURRENT_LINK")"
# The versioned n8n writer authenticates locally as postgres. Permit only
# traversal to its immutable scripts and only manifest-directory writes; no
# workflow sidecar or source tree becomes generally readable or writable.
coordination_check
for acl_dir in "$RELEASE_BASE" "$RELEASE_BASE/$RELEASE_ID" "$DESTINATION" "$DESTINATION/scripts" "$DESTINATION/scripts/runtime" "$DESTINATION/orb" "$DESTINATION/orb/engine" "$DESTINATION/orb/engine/scripts" "$DESTINATION/orb/engine/scripts/livia" "$DESTINATION/orb/engine/scripts/lib" "$DESTINATION/orb/engine/workflow-src" "$DESTINATION/orb/engine/workflow-src/meta-ads-publish" "$DESTINATION/orb/engine/workflows" "$DESTINATION/ops" "$DESTINATION/ops/governance" "$CURRENT_LINK"; do
  coordination_check
  sudo -n setfacl -m u:postgres:--x "$acl_dir"
done
coordination_check
sudo -n setfacl -m u:postgres:r-- \
  "$DESTINATION/orb/engine/scripts/workflow-runtime-manifest.js" \
  "$DESTINATION/orb/engine/scripts/apply-livia-runtime-isolation.js"
# The Livia candidate builder and structural validator are deliberately run as
# postgres by the promotion runbook, so peer-authenticated workflow writes can
# consume the exact same immutable source tree.  Their patch modules contain
# no credentials, but must be readable rather than relying on a privileged
# operator-side workaround during a promotion.
coordination_check
sudo -n setfacl -m u:postgres:r-- \
  "$DESTINATION/orb/engine/scripts/prepare-livia-production-candidate.js" \
  "$DESTINATION/orb/engine/scripts/validate-livia-workflow.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-drive-publication-marks.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-commercial-catalog.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-token-vault-preflight.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-accessibility-contract.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-facebook-carousel-contract.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-schedule-cadence.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-today-first-selection.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-job-graph-payload-file.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-notification-contract.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-ai-reel-covers.js" \
  "$DESTINATION/orb/engine/scripts/patch-livia-runtime-isolation.js" \
  "$DESTINATION/orb/engine/scripts/lib/crm-commercial-catalog-contract.js" \
  "$DESTINATION/orb/engine/scripts/livia/rollout-policy.js" \
  "$DESTINATION/orb/engine/scripts/livia/set-rollout-mode.js" \
  "$DESTINATION/ops/governance/livia-rollout-policy.json"
# The workflow-version writer runs as postgres.  It hashes the exact Livia
# sidecar entrypoints before committing a workflow version, so it needs read
# access to those files only (directory traversal is granted above).  Without
# these ACLs a promotion aborts before the transaction can create its manifest.
coordination_check
sudo -n setfacl -m u:postgres:r-- \
  "$DESTINATION/orb/engine/compose2-current.js" \
  "$DESTINATION/orb/engine/scripts/livia/process-media-asset.js" \
  "$DESTINATION/orb/engine/scripts/livia/build-platform-job-graph.js" \
  "$DESTINATION/orb/engine/scripts/livia/verify-published-artifacts.js" \
  "$DESTINATION/orb/engine/scripts/livia/publish-progress-ledger.js" \
  "$DESTINATION/orb/engine/scripts/livia/validate-publish-token-health.js"
# The Meta Ads Publish preflight also runs as postgres for peer authentication.
# Its source comparison reads the immutable workflow export and all Code-node
# sources. The versioned checkpoint/apply pair uses the same peer-authenticated
# connection, so grant only the exact immutable entrypoints and helpers it
# needs. This surface contains no runtime credentials and remains non-writable
# to postgres.
coordination_check
sudo -n setfacl -m u:postgres:r-- \
  "$DESTINATION/scripts/runtime/apply-meta-ads-publish-tracking-release.sh" \
  "$DESTINATION/scripts/runtime/rollback-meta-ads-publish-tracking-release.sh" \
  "$DESTINATION/orb/engine/scripts/export-meta-ads-publish-live.js" \
  "$DESTINATION/orb/engine/scripts/apply-meta-ads-publish-workflow-snapshot.js" \
  "$DESTINATION/orb/engine/scripts/restore-meta-ads-publish-workflow-snapshot.js" \
  "$DESTINATION/orb/engine/scripts/inspect-meta-ads-publish-version-alignment.js" \
  "$DESTINATION/orb/engine/scripts/validate-meta-ads-publish-preflight.js" \
  "$DESTINATION/orb/engine/scripts/patch-meta-ads-video-transfer-replay.js" \
  "$DESTINATION/orb/engine/scripts/patch-meta-ads-crm-context-prefetch.js" \
  "$DESTINATION/orb/engine/scripts/patch-meta-ads-advantage-plus-drift-readback.js" \
  "$DESTINATION/orb/engine/scripts/patch-meta-ads-tracking-reconciliation.js" \
  "$DESTINATION/orb/engine/scripts/lib/runtime-paths.js" \
  "$DESTINATION/orb/engine/scripts/lib/meta-ads-publish-execution-semantics.js" \
  "$DESTINATION/orb/engine/scripts/lib/meta-ads-publish-code-sources.js" \
  "$DESTINATION/orb/engine/workflows/meta-ads-publish.current.json"
coordination_check
sudo -n setfacl -Rm u:postgres:rX "$DESTINATION/orb/engine/workflow-src/meta-ads-publish"
MANIFEST_DIR="${N8N_RUNTIME_HOME:-/var/lib/skincos-runtime/orb}/workflow-runtime-manifests/WGXr4vYkv9UoJ8zc"
coordination_check
sudo -n install -d -o root -g root -m 0750 "$MANIFEST_DIR"
coordination_check
sudo -n setfacl -m u:postgres:--x "$(dirname "$(dirname "$MANIFEST_DIR")")" "$(dirname "$MANIFEST_DIR")"
coordination_check
sudo -n setfacl -m u:postgres:rwx "$MANIFEST_DIR"
echo "Native source release staged: $DESTINATION"
