#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CALLER_CONTRACT="$ROOT_DIR/scripts/runtime/messaging-whatsapp-release-contract.mjs"
CALLER_COORDINATION="$ROOT_DIR/scripts/runtime/global-coordination-mini-pc.sh"
RELEASE_BASE="${MESSAGING_RELEASE_BASE:-/opt/skincos/releases}"
CURRENT_LINK="${MESSAGING_CURRENT_LINK:-/opt/skincos/current/messaging-whatsapp}"
PREDECESSOR_RELEASE=""
PREDECESSOR_CANDIDATE=""
APPLY=0
SNAPSHOT_STAGE=""
SNAPSHOT_CANDIDATE=""
SOURCE_STAGE=""
IMMUTABLE_ROOT=""
IMMUTABLE_ENGINE=""
COORDINATION_PROOF=""
coordination_acquired=0
link_switched=0
CURRENT_TARGET=""

usage() {
  cat <<'EOF'
Usage: scripts/runtime/rollback-messaging-whatsapp-release.sh --predecessor-release <sha> --predecessor-candidate <native/release-source-SHA> [--apply]

Rolls the active WhatsApp engine back only to the exact predecessor recorded by
the active release identity. The predecessor must also match a native
release-source-<SHA> candidate and its closure. --apply restarts the service and
requires both systemd active state and the loopback /health smoke to succeed.
The candidate is first captured into a private native snapshot; external
authenticated release custody is required before any --apply activation.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --predecessor-release)
      [[ "$#" -ge 2 ]] || { echo '--predecessor-release requires a value.' >&2; exit 64; }
      PREDECESSOR_RELEASE="$2"
      shift
      ;;
    --predecessor-candidate)
      [[ "$#" -ge 2 ]] || { echo '--predecessor-candidate requires a value.' >&2; exit 64; }
      PREDECESSOR_CANDIDATE="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

[[ "$PREDECESSOR_RELEASE" =~ ^[0-9a-f]{40}$ ]] || {
  echo '--predecessor-release must be a full lowercase SHA.' >&2
  exit 78
}
[[ -n "$PREDECESSOR_CANDIDATE" && -f "$CALLER_CONTRACT" && -f "$CALLER_COORDINATION" ]] || {
  echo '--predecessor-candidate and trusted messaging release helpers are required.' >&2
  exit 78
}
[[ "$RELEASE_BASE" == /* && "$RELEASE_BASE" != /mnt/* ]] || { echo 'Messaging release base must be a native Linux path.' >&2; exit 78; }
[[ "$CURRENT_LINK" == /* && "$CURRENT_LINK" != /mnt/* ]] || { echo 'Messaging current link must be a native Linux path.' >&2; exit 78; }

# External authenticated custody is unavailable for this native path. Reject
# activation before any candidate archive is opened, rather than treating its
# self-consistent metadata as a GitHub release proof.
if [[ "$APPLY" == 1 ]]; then
  echo 'Native WhatsApp rollback is fail-closed: --apply requires external authenticated release custody bound to the GitHub workflow run, artifact identity and source archive digest.' >&2
  exit 78
fi

SOURCE_STAGE="$(mktemp -d "/var/tmp/skincos-messaging-rollback-source-$PREDECESSOR_RELEASE.XXXXXX")"
SNAPSHOT_STAGE="$(mktemp -d "/var/tmp/skincos-messaging-rollback-candidate-$PREDECESSOR_RELEASE.XXXXXX")"
SNAPSHOT_CANDIDATE="$SNAPSHOT_STAGE/release-source-$PREDECESSOR_RELEASE"
cleanup() {
  if (( coordination_acquired == 1 )); then
    coordination_run release >/dev/null 2>&1 || echo 'Unable to release the messaging rollback lease; it will expire fail-closed.' >&2
    coordination_acquired=0
  fi
  if [[ "$SNAPSHOT_STAGE" =~ ^/var/tmp/skincos-messaging-rollback-candidate-[0-9a-f]{40}\.[A-Za-z0-9]+$ ]]; then
    rm -rf -- "$SNAPSHOT_STAGE"
  fi
  if [[ "$SOURCE_STAGE" =~ ^/var/tmp/skincos-messaging-rollback-source-[0-9a-f]{40}\.[A-Za-z0-9]+$ ]]; then
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

# Capture all five artifacts once, privately, before the contract examines the
# predecessor. A later replacement of the delivered directory cannot influence
# either extraction, rollback-pair proof, or service identity.
node "$CALLER_CONTRACT" snapshot-candidate \
  --candidate "$PREDECESSOR_CANDIDATE" --release-sha "$PREDECESSOR_RELEASE" \
  --snapshot "$SNAPSHOT_CANDIDATE" >/dev/null
CANDIDATE_ROOT="$SNAPSHOT_CANDIDATE"
CANDIDATE_CLOSURE="$CANDIDATE_ROOT/messaging-whatsapp-closure.json"
node "$CALLER_CONTRACT" materialize-candidate \
  --candidate "$CANDIDATE_ROOT" --release-sha "$PREDECESSOR_RELEASE" --stage "$SOURCE_STAGE" >/dev/null
IMMUTABLE_ROOT="$SOURCE_STAGE/skincos-$PREDECESSOR_RELEASE"
if ! assert_confined_immutable_engine; then
  echo 'Predecessor candidate lacks the immutable WhatsApp engine.' >&2
  exit 78
fi
node "$CALLER_CONTRACT" verify-candidate \
  --candidate "$CANDIDATE_ROOT" --release-sha "$PREDECESSOR_RELEASE" >/dev/null

PREDECESSOR_ROOT="$RELEASE_BASE/$PREDECESSOR_RELEASE/messaging-whatsapp"
CURRENT_TARGET="$(readlink -f -- "$CURRENT_LINK")"
[[ "$CURRENT_TARGET" == "$RELEASE_BASE/"*/messaging-whatsapp ]] || {
  echo 'Current WhatsApp link does not resolve to an immutable messaging release.' >&2
  exit 78
}
CURRENT_RELEASE="$(basename "$(dirname "$CURRENT_TARGET")")"
[[ "$CURRENT_RELEASE" =~ ^[0-9a-f]{40}$ && "$CURRENT_RELEASE" != "$PREDECESSOR_RELEASE" ]] || {
  echo 'Current WhatsApp release is not a distinct immutable candidate.' >&2
  exit 78
}
node "$CALLER_CONTRACT" verify-rollback-pair \
  --current-release-root "$CURRENT_TARGET" \
  --predecessor-release-root "$PREDECESSOR_ROOT" \
  --predecessor-candidate "$CANDIDATE_ROOT" \
  --predecessor-release-sha "$PREDECESSOR_RELEASE" >/dev/null

echo "current_release=$CURRENT_RELEASE"
echo "predecessor_release=$PREDECESSOR_RELEASE"
echo 'dry_run=true'
echo 'post_rollback_smoke=systemctl-active-and-loopback-health'
echo 'apply_requires=external-authenticated-release-custody-run-artifact-digest'
exit 0

for command in node sudo systemctl curl readlink mktemp; do
  command -v "$command" >/dev/null 2>&1 || { echo "Missing required command: $command" >&2; exit 78; }
done
sudo -n true

COORDINATION_PROOF="${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-/var/lib/skincos-runtime/global-coordination/rollback-messaging-whatsapp-$PREDECESSOR_RELEASE-$$.json}"
coordination_run() {
  "$CALLER_COORDINATION" "$@" --proof-file "$COORDINATION_PROOF"
}

restore_current_release() {
  if (( link_switched != 1 )); then
    echo 'Rollback compensation was not attempted because the current link was never switched.' >&2
    return 1
  fi
  if ! coordination_run check \
    --resource release:messaging-whatsapp --module messaging-whatsapp --source "$PREDECESSOR_RELEASE" \
    --closure-file "$CANDIDATE_CLOSURE" >/dev/null 2>&1; then
    echo 'Rollback compensation could not safely restore the prior link because the lease proof is unavailable.' >&2
    return 1
  fi
  if ! sudo -n ln -sfn -- "$CURRENT_TARGET" "$CURRENT_LINK" \
    || ! sudo -n systemctl restart messaging-whatsapp.service \
    || ! systemctl --quiet is-active messaging-whatsapp.service \
    || ! curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/health >/dev/null; then
    echo 'Rollback compensation could not confirm the prior release health after restoring its link.' >&2
    return 1
  fi
  link_switched=0
  return 0
}

coordination_run acquire \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$PREDECESSOR_RELEASE" \
  --closure-file "$CANDIDATE_CLOSURE" --operation promotion \
  --release-identity-file "$PREDECESSOR_ROOT/.skincos-release-identity-messaging-whatsapp.json" \
  --idempotency-key "mini-pc:release:messaging-whatsapp:rollback:$CURRENT_RELEASE:$PREDECESSOR_RELEASE:$$" >/dev/null
coordination_acquired=1
coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$PREDECESSOR_RELEASE" \
  --closure-file "$CANDIDATE_CLOSURE" >/dev/null
sudo -n ln -sfn -- "$PREDECESSOR_ROOT" "$CURRENT_LINK"
link_switched=1

if ! coordination_run check \
  --resource release:messaging-whatsapp --module messaging-whatsapp --source "$PREDECESSOR_RELEASE" \
  --closure-file "$CANDIDATE_CLOSURE" >/dev/null \
  || ! sudo -n systemctl restart messaging-whatsapp.service \
  || ! systemctl --quiet is-active messaging-whatsapp.service \
  || ! curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8080/health >/dev/null; then
  if restore_current_release; then
    echo 'Messaging rollback health or smoke failed; the prior release was restored and revalidated.' >&2
  else
    echo 'Messaging rollback health or smoke failed and compensation could not be confirmed; operator intervention is required.' >&2
  fi
  exit 78
fi

echo "Messaging WhatsApp rollback completed: $CURRENT_RELEASE -> $PREDECESSOR_RELEASE"
