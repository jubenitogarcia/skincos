#!/usr/bin/env bash
set -euo pipefail

# A WhatsApp promotion may build only from a native copy of the GitHub
# release-source-<SHA> artifact. In particular, never use the checkout or a
# worktree as engine input: their contents can drift after the candidate was
# attested.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CALLER_CONTRACT="$ROOT_DIR/scripts/runtime/messaging-whatsapp-release-contract.mjs"
CALLER_COORDINATION="$ROOT_DIR/scripts/runtime/global-coordination-mini-pc.sh"
CALLER_RUNNER="$ROOT_DIR/scripts/runtime/run-messaging-whatsapp-release.sh"
RELEASE_BASE="${MESSAGING_RELEASE_BASE:-/opt/skincos/releases}"
CURRENT_LINK="${MESSAGING_CURRENT_LINK:-/opt/skincos/current/messaging-whatsapp}"
RELEASE_ID="${MESSAGING_RELEASE_ID:-}"
NPM_CACHE="${MESSAGING_NPM_CACHE:-/var/lib/skincos-runtime/cache/npm}"
RELEASE_CANDIDATE=""
PREDECESSOR_RELEASE=""
APPLY=0
SNAPSHOT_STAGE=""
SNAPSHOT_CANDIDATE=""
SOURCE_STAGE=""
IMMUTABLE_ROOT=""
IMMUTABLE_ENGINE=""
STAGING=""
DESTINATION=""
COORDINATION_PROOF=""
ARTIFACT_IDENTITY_FILE=""
coordination_acquired=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-messaging-whatsapp-release.sh --release-candidate <native/release-source-SHA> [--predecessor-release <sha>] [--apply]

Validates and builds the WhatsApp engine exclusively from a Linux-native
release-source-<SHA> artifact. The candidate must contain source.tar.gz,
source.sha256, release.json, release-manifest.json and the
messaging-whatsapp closure attestation. It is first copied into a private
native snapshot, and every validation, extraction and identity read uses only
that snapshot. --apply is fail-closed until external authenticated custody
binds the GitHub workflow run, artifact identity and source archive digest.

No checkout, worktree, /mnt path, .env file or generated source tree is used as
the engine input. Systemd loads its private environment separately.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --release-candidate)
      [[ "$#" -ge 2 ]] || { echo '--release-candidate requires a value.' >&2; exit 64; }
      RELEASE_CANDIDATE="$2"
      shift
      ;;
    --predecessor-release)
      [[ "$#" -ge 2 ]] || { echo '--predecessor-release requires a value.' >&2; exit 64; }
      PREDECESSOR_RELEASE="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

[[ "$RELEASE_ID" =~ ^[0-9a-f]{40}$ ]] || { echo 'MESSAGING_RELEASE_ID must be a full lowercase reviewed commit SHA.' >&2; exit 78; }
[[ -n "$RELEASE_CANDIDATE" ]] || { echo '--release-candidate is required.' >&2; exit 64; }
[[ -f "$CALLER_CONTRACT" ]] || { echo 'Messaging release contract is unavailable.' >&2; exit 78; }
[[ -f "$CALLER_COORDINATION" && -f "$CALLER_RUNNER" ]] || { echo 'Trusted messaging release helpers are unavailable.' >&2; exit 78; }
[[ "$RELEASE_BASE" == /* && "$RELEASE_BASE" != /mnt/* ]] || { echo 'Messaging release base must be an absolute native Linux path.' >&2; exit 78; }
[[ "$CURRENT_LINK" == /* && "$CURRENT_LINK" != /mnt/* ]] || { echo 'Messaging current link must be an absolute native Linux path.' >&2; exit 78; }
[[ "$NPM_CACHE" == /* && "$NPM_CACHE" != /mnt/* ]] || { echo 'Messaging npm cache must be an absolute native Linux path.' >&2; exit 78; }
[[ "$RELEASE_CANDIDATE" != /mnt/* ]] || { echo 'Release candidate must already be on native Linux storage.' >&2; exit 78; }

# A candidate is internally verified only after snapshotting, but that is not
# evidence that GitHub released it. No authenticated custody verifier binding
# the workflow run, artifact identity and archive digest exists in this native
# path yet. Refuse --apply before touching untrusted candidate bytes; never
# accept a self-asserted flag, file or environment variable.
if [[ "$APPLY" == 1 ]]; then
  echo 'Native WhatsApp promotion is fail-closed: --apply requires external authenticated release custody bound to the GitHub workflow run, artifact identity and source archive digest.' >&2
  exit 78
fi

SOURCE_STAGE="$(mktemp -d "/var/tmp/skincos-messaging-source-$RELEASE_ID.XXXXXX")"
SNAPSHOT_STAGE="$(mktemp -d "/var/tmp/skincos-messaging-candidate-$RELEASE_ID.XXXXXX")"
SNAPSHOT_CANDIDATE="$SNAPSHOT_STAGE/release-source-$RELEASE_ID"
cleanup() {
  if (( coordination_acquired == 1 )); then
    if [[ -n "$STAGING" && -d "$STAGING" ]]; then
      if coordination_run check \
        --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" \
        --closure-file "$CANDIDATE_CLOSURE" >/dev/null 2>&1; then
        sudo -n rm -rf -- "$STAGING" || true
      else
        echo 'Messaging staging was left intact because coordination proof could not be revalidated.' >&2
      fi
    fi
    coordination_run release >/dev/null 2>&1 || echo 'Unable to release the messaging lease; it will expire fail-closed.' >&2
    coordination_acquired=0
  fi
  [[ -z "$ARTIFACT_IDENTITY_FILE" ]] || rm -f -- "$ARTIFACT_IDENTITY_FILE"
  if [[ "$SNAPSHOT_STAGE" =~ ^/var/tmp/skincos-messaging-candidate-[0-9a-f]{40}\.[A-Za-z0-9]+$ ]]; then
    rm -rf -- "$SNAPSHOT_STAGE"
  fi
  if [[ "$SOURCE_STAGE" =~ ^/var/tmp/skincos-messaging-source-[0-9a-f]{40}\.[A-Za-z0-9]+$ ]]; then
    rm -rf -- "$SOURCE_STAGE"
  fi
}
trap cleanup EXIT INT TERM

assert_confined_immutable_engine() {
  local current="$IMMUTABLE_ROOT"
  local segment
  for segment in messaging channels whatsapp engine; do
    current="$current/$segment"
    [[ -d "$current" && ! -L "$current" ]] || return 1
  done
  IMMUTABLE_ENGINE="$(readlink -f -- "$current")"
  [[ "$IMMUTABLE_ENGINE" == "$IMMUTABLE_ROOT/"* ]]
}

# The untrusted delivered directory can be swapped at any point. Capture all
# five candidate artifacts inside a fresh 0700 native directory before doing
# any provenance, TAR or build work. The contract's parser never invokes a
# generic extractor and rejects links/special records that could escape stage.
node "$CALLER_CONTRACT" snapshot-candidate \
  --candidate "$RELEASE_CANDIDATE" --release-sha "$RELEASE_ID" \
  --snapshot "$SNAPSHOT_CANDIDATE" >/dev/null
CANDIDATE_ROOT="$SNAPSHOT_CANDIDATE"
CANDIDATE_CLOSURE="$CANDIDATE_ROOT/messaging-whatsapp-closure.json"
node "$CALLER_CONTRACT" materialize-candidate \
  --candidate "$CANDIDATE_ROOT" --release-sha "$RELEASE_ID" --stage "$SOURCE_STAGE" >/dev/null
IMMUTABLE_ROOT="$SOURCE_STAGE/skincos-$RELEASE_ID"
if ! assert_confined_immutable_engine; then
  echo 'Release source candidate lacks the immutable WhatsApp engine.' >&2
  exit 78
fi
node "$CALLER_CONTRACT" verify-candidate \
  --candidate "$CANDIDATE_ROOT" --release-sha "$RELEASE_ID" >/dev/null

DESTINATION="$RELEASE_BASE/$RELEASE_ID/messaging-whatsapp"
STAGING="$RELEASE_BASE/.messaging-whatsapp-staging-$RELEASE_ID-$$"
[[ "$STAGING" == "$RELEASE_BASE/.messaging-whatsapp-staging-$RELEASE_ID-"* ]] || {
  echo 'Messaging staging target is invalid.' >&2
  exit 78
}
[[ ! -e "$DESTINATION" ]] || { echo "Release destination already exists: $DESTINATION" >&2; exit 78; }

node "$CALLER_CONTRACT" verify-candidate \
  --candidate "$CANDIDATE_ROOT" --release-sha "$RELEASE_ID"
echo 'dry_run=true'
echo 'apply_requires=attested-predecessor-release'
echo 'apply_requires=external-authenticated-release-custody-run-artifact-digest'
exit 0

[[ "$PREDECESSOR_RELEASE" =~ ^[0-9a-f]{40}$ && "$PREDECESSOR_RELEASE" != "$RELEASE_ID" ]] || {
  echo '--predecessor-release must name a distinct full lowercase SHA.' >&2
  exit 78
}
PREDECESSOR_ROOT="$RELEASE_BASE/$PREDECESSOR_RELEASE/messaging-whatsapp"
node "$CALLER_CONTRACT" verify-installed \
  --release-root "$PREDECESSOR_ROOT" --expected-release-sha "$PREDECESSOR_RELEASE" >/dev/null

for command in node npm rsync sha256sum awk sudo readlink mktemp; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 78; }
done
sudo -n true

COORDINATION_PROOF="${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-/var/lib/skincos-runtime/global-coordination/release-messaging-whatsapp-$RELEASE_ID-$$.json}"
coordination_run() {
  "$CALLER_COORDINATION" "$@" --proof-file "$COORDINATION_PROOF"
}

coordination_run acquire \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" \
  --closure-file "$CANDIDATE_CLOSURE" --operation mutation \
  --idempotency-key "mini-pc:release:messaging-whatsapp:build:$RELEASE_ID:$$" >/dev/null
coordination_acquired=1
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" \
  --closure-file "$CANDIDATE_CLOSURE" >/dev/null

sudo -n install -d -o root -g skincos -m 0750 "$STAGING" "$NPM_CACHE"
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" \
  --closure-file "$CANDIDATE_CLOSURE" >/dev/null
sudo -n rsync -a --delete \
  --exclude '.env' --exclude '.env.*' --exclude 'node_modules' --exclude 'dist' \
  "$IMMUTABLE_ENGINE/" "$STAGING/"
sudo -n install -o root -g skincos -m 0750 \
  "$CALLER_RUNNER" "$STAGING/.skincos-run-messaging-whatsapp-release.sh"
sudo -n install -o root -g skincos -m 0640 \
  "$CANDIDATE_CLOSURE" "$STAGING/.skincos-global-coordination-messaging-whatsapp.json"
sudo -n chown -R skincos:skincos "$STAGING" "$NPM_CACHE"
sudo -n install -d -o skincos -g skincos -m 0750 "$STAGING/dist"

coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" \
  --closure-file "$CANDIDATE_CLOSURE" >/dev/null
sudo -n -u skincos env npm_config_cache="$NPM_CACHE" npm --prefix "$STAGING" ci --ignore-scripts
sudo -n -u skincos npm --prefix "$STAGING" run db:generate
sudo -n -u skincos npm --prefix "$STAGING" run build
[[ -f "$STAGING/dist/main.js" ]] || { echo 'Build did not produce dist/main.js.' >&2; exit 78; }

ARTIFACT_IDENTITY_FILE="$(mktemp /tmp/skincos-messaging-release-identity.XXXXXX)"
node "$CALLER_CONTRACT" build-identity \
  --candidate "$CANDIDATE_ROOT" --release-sha "$RELEASE_ID" \
  --artifact "$STAGING/dist/main.js" --predecessor-release-root "$PREDECESSOR_ROOT" \
  > "$ARTIFACT_IDENTITY_FILE"
sudo -n install -o root -g skincos -m 0640 \
  "$ARTIFACT_IDENTITY_FILE" "$STAGING/.skincos-release-identity-messaging-whatsapp.json"
node "$CALLER_CONTRACT" verify-installed \
  --release-root "$STAGING" --expected-release-sha "$RELEASE_ID" >/dev/null
sudo -n chown -R root:skincos "$STAGING"
sudo -n find "$STAGING" -type d -exec chmod 0750 {} +
sudo -n find "$STAGING" -type f -exec chmod 0640 {} +
sudo -n chmod 0750 "$STAGING/.skincos-run-messaging-whatsapp-release.sh"

# The build lease owns only staging. Reacquire a promotion lease carrying the
# final artifact identity immediately before the immutable destination and link
# mutation.
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" \
  --closure-file "$CANDIDATE_CLOSURE" >/dev/null
coordination_run release >/dev/null
coordination_acquired=0
coordination_run acquire \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" \
  --closure-file "$CANDIDATE_CLOSURE" --operation promotion \
  --release-identity-file "$ARTIFACT_IDENTITY_FILE" \
  --idempotency-key "mini-pc:release:messaging-whatsapp:promote:$RELEASE_ID:$$" >/dev/null
coordination_acquired=1
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" \
  --closure-file "$CANDIDATE_CLOSURE" >/dev/null
sudo -n install -d -o root -g skincos -m 0750 "$(dirname "$DESTINATION")" "$(dirname "$CURRENT_LINK")"
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" \
  --closure-file "$CANDIDATE_CLOSURE" >/dev/null
sudo -n mv -- "$STAGING" "$DESTINATION"
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$RELEASE_ID" \
  --closure-file "$CANDIDATE_CLOSURE" >/dev/null
sudo -n ln -sfn -- "$DESTINATION" "$CURRENT_LINK"

echo "Native WhatsApp release prepared: $CURRENT_LINK -> $DESTINATION"
