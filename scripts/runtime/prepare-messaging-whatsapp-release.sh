#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_DIR="$ROOT_DIR/messaging/channels/whatsapp/engine"
RELEASE_BASE="${MESSAGING_RELEASE_BASE:-/opt/skincos/releases}"
CURRENT_LINK="${MESSAGING_CURRENT_LINK:-/opt/skincos/current/messaging-whatsapp}"
RELEASE_ID="${MESSAGING_RELEASE_ID:-}"
DESTINATION="$RELEASE_BASE/$RELEASE_ID/messaging-whatsapp"
STAGING="$RELEASE_BASE/.staging-$RELEASE_ID-$$"
NPM_CACHE="${MESSAGING_NPM_CACHE:-/var/lib/skincos-runtime/cache/npm}"
COORDINATION_CLOSURE="${SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE:-}"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-messaging-whatsapp-release.sh [--coordination-closure <json>] [--apply]

Stages the WhatsApp engine as a native Linux release. With --apply it copies
only tracked source and lockfiles, installs dependencies, generates Prisma,
builds dist/main.js, and atomically updates the current symlink. It never reads
or copies .env files; systemd loads the private environment separately.

Set MESSAGING_RELEASE_ID to the reviewed main commit SHA before invoking this
script. It is explicit because WSL cannot reliably resolve Windows worktree
gitdir indirections during a production cutover.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --coordination-closure) shift; COORDINATION_CLOSURE="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
  shift
done

[[ -f "$SOURCE_DIR/package-lock.json" ]] || { echo "Missing lockfile: $SOURCE_DIR/package-lock.json" >&2; exit 1; }
[[ -f "$SOURCE_DIR/src/main.ts" ]] || { echo "Missing source entrypoint: $SOURCE_DIR/src/main.ts" >&2; exit 1; }
[[ "$RELEASE_ID" =~ ^[0-9a-f]{40}$ ]] || { echo 'MESSAGING_RELEASE_ID must be a full reviewed commit SHA.' >&2; exit 1; }
[[ ! -e "$DESTINATION" ]] || { echo "Release destination already exists: $DESTINATION" >&2; exit 1; }

echo "Release ID: $RELEASE_ID"
echo "Source: $SOURCE_DIR"
echo "Destination: $DESTINATION"
if [[ "$APPLY" != "1" ]]; then
  echo "Dry run complete. Use --apply after backup, CI and cutover gates pass."
  exit 0
fi

[[ -n "$COORDINATION_CLOSURE" && -f "$COORDINATION_CLOSURE" ]] || {
  echo 'An immutable messaging dependency-closure attestation is required for WhatsApp artifact promotion.' >&2
  exit 78
}
coordination_proof="${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-/var/lib/skincos-runtime/global-coordination/release-messaging-whatsapp-$RELEASE_ID-$$.json}"
artifact_identity_file="$(mktemp /tmp/skincos-whatsapp-release-identity.XXXXXX)"
coordination_acquired=0
coordination_run() {
  "$ROOT_DIR/scripts/runtime/global-coordination-mini-pc.sh" "$@" --proof-file "$coordination_proof"
}
cleanup_staging() {
  sudo -n rm -rf "$STAGING"
}
cleanup_coordination() {
  if (( coordination_acquired == 1 )); then
    coordination_run release >/dev/null 2>&1 || echo 'Unable to release the mini-PC messaging lease; it will expire fail-closed.' >&2
  fi
  cleanup_staging
  rm -f -- "$artifact_identity_file"
}
trap cleanup_coordination EXIT INT TERM
coordination_run acquire \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" --closure-file "$COORDINATION_CLOSURE" \
  --operation mutation --idempotency-key "mini-pc:release:messaging-whatsapp:build:$RELEASE_ID:$$" >/dev/null
coordination_acquired=1
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" --closure-file "$COORDINATION_CLOSURE" >/dev/null

command -v rsync >/dev/null 2>&1 || { echo 'Missing required command: rsync' >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo 'Missing required command: npm' >&2; exit 1; }
command -v sha256sum >/dev/null 2>&1 || { echo 'Missing required command: sha256sum' >&2; exit 1; }
command -v awk >/dev/null 2>&1 || { echo 'Missing required command: awk' >&2; exit 1; }
command -v sudo >/dev/null 2>&1 || { echo 'Missing required command: sudo' >&2; exit 1; }
sudo -n true

coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" --closure-file "$COORDINATION_CLOSURE" >/dev/null
sudo -n install -d -o skincos -g skincos -m 0750 "$STAGING" "$NPM_CACHE"
# The cache is durable runtime state. A prior diagnostic run as another user
# must not make a later production release fail before dependencies are built.
sudo -n chown -R skincos:skincos "$NPM_CACHE"
sudo -n rsync -a --delete \
  --exclude '.env' --exclude '.env.*' --exclude 'node_modules' --exclude 'dist' \
  "$SOURCE_DIR/" "$STAGING/"
sudo -n chown -R skincos:skincos "$STAGING"
# tsconfig writes its incremental build info under dist before tsup runs. The
# release copy intentionally excludes generated dist, so create the native
# output directory explicitly instead of depending on an old worktree build.
sudo -n install -d -o skincos -g skincos -m 0750 "$STAGING/dist"

sudo -n -u skincos env npm_config_cache="$NPM_CACHE" \
  npm --prefix "$STAGING" ci --ignore-scripts
sudo -n -u skincos npm --prefix "$STAGING" run db:generate
sudo -n -u skincos npm --prefix "$STAGING" run build
[[ -f "$STAGING/dist/main.js" ]] || { echo "Build did not produce dist/main.js" >&2; exit 1; }

artifact_digest="$(sha256sum "$STAGING/dist/main.js" | awk '{print $1}')"
node - "$COORDINATION_CLOSURE" "$RELEASE_ID" "$artifact_digest" > "$artifact_identity_file" <<'NODE'
const fs = require('fs');
const [closureFile, releaseId, artifactDigest] = process.argv.slice(2);
const closure = JSON.parse(fs.readFileSync(closureFile, 'utf8'));
const identity = {
  schemaVersion: 1,
  module: 'messaging-whatsapp',
  sourceCommit: String(closure.sourceCommit).toLowerCase(),
  sourceTree: String(closure.sourceTree).toLowerCase(),
  dependencyClosureDigest: String(closure.digest).toLowerCase(),
  artifacts: [{ name: 'whatsapp-dist-main', id: `whatsapp-dist:${releaseId}`, digest: artifactDigest }],
};
process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
NODE

coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" --closure-file "$COORDINATION_CLOSURE" >/dev/null
sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$DESTINATION")"
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" --closure-file "$COORDINATION_CLOSURE" >/dev/null
coordination_run release >/dev/null
coordination_acquired=0
coordination_run acquire \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" --closure-file "$COORDINATION_CLOSURE" \
  --operation promotion --release-identity-file "$artifact_identity_file" \
  --idempotency-key "mini-pc:release:messaging-whatsapp:promote:$RELEASE_ID:$$" >/dev/null
coordination_acquired=1
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" --closure-file "$COORDINATION_CLOSURE" >/dev/null
sudo -n install -m 0640 "$artifact_identity_file" "$STAGING/.skincos-release-identity-messaging-whatsapp.json"
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" --closure-file "$COORDINATION_CLOSURE" >/dev/null
sudo -n mv "$STAGING" "$DESTINATION"
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" --closure-file "$COORDINATION_CLOSURE" >/dev/null
sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$CURRENT_LINK")"
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" --closure-file "$COORDINATION_CLOSURE" >/dev/null
sudo -n ln -sfn "$DESTINATION" "$CURRENT_LINK"
echo "Native WhatsApp release prepared: $CURRENT_LINK -> $DESTINATION"
