#!/usr/bin/env bash
set -euo pipefail

# The mini-PC uses the same HTTPS coordinator and fencing-proof contract as
# GitHub and Codex. This thin adapter owns only private runtime plumbing; it
# never stores a secret or proof in the source release.
readonly SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly ADAPTER="$SCRIPT_ROOT/scripts/codex-global-coordination-workflow.mjs"
readonly PROOF_ROOT="${SKINCOS_GLOBAL_COORDINATION_PROOF_ROOT:-/var/lib/skincos-runtime/global-coordination}"
readonly COMMAND="${1:-}"
all_args=("$@")

[[ -f "$ADAPTER" ]] || { echo 'Global coordination adapter is unavailable in the immutable source release.' >&2; exit 78; }
[[ -n "${SKINCOS_GLOBAL_COORDINATOR_URL:-}" ]] || { echo 'SKINCOS_GLOBAL_COORDINATOR_URL is required for a mini-PC mutation.' >&2; exit 78; }
[[ -n "${SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET:-}" ]] || { echo 'Global coordination custody is unavailable on the mini-PC.' >&2; exit 78; }
[[ -n "${GLOBAL_COORDINATION_MISSION_ID:-}" ]] || { echo 'GLOBAL_COORDINATION_MISSION_ID is required on the mini-PC.' >&2; exit 78; }
[[ -n "${GLOBAL_COORDINATION_THREAD_ID:-}" ]] || { echo 'GLOBAL_COORDINATION_THREAD_ID is required on the mini-PC.' >&2; exit 78; }
[[ -n "${GLOBAL_COORDINATION_ACTOR:-}" ]] || { echo 'GLOBAL_COORDINATION_ACTOR is required on the mini-PC.' >&2; exit 78; }
[[ "$COMMAND" =~ ^(acquire|check|renew|release|revoke)$ ]] || {
  echo 'Usage: global-coordination-mini-pc.sh acquire|check|renew|release|revoke [adapter arguments]' >&2
  exit 64
}

proof_file=''
closure_file=''
source_sha=''
has_argument() {
  local needle="$1" value
  shift
  for value in "$@"; do
    [[ "$value" == "$needle" ]] && return 0
  done
  return 1
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --proof-file) proof_file="${2:-}"; shift ;;
    --closure-file) closure_file="${2:-}"; shift ;;
    --source) source_sha="${2:-}"; shift ;;
  esac
  shift
done
proof_file="${proof_file:-${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-}}"
closure_file="${closure_file:-${SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE:-}}"
source_sha="${source_sha:-${SKINCOS_GLOBAL_COORDINATION_SOURCE_SHA:-}}"
[[ -n "$proof_file" && "$proof_file" = /* ]] || { echo 'An absolute private proof file is required.' >&2; exit 78; }
case "$proof_file" in
  "$PROOF_ROOT"/*) ;;
  *) echo 'Global coordination proof must remain below the private mini-PC proof root.' >&2; exit 78 ;;
esac
if [[ "$COMMAND" == acquire || "$COMMAND" == check ]]; then
  [[ -n "$closure_file" && -f "$closure_file" ]] || { echo 'An immutable dependency-closure attestation is required.' >&2; exit 78; }
  [[ -n "$source_sha" ]] || { echo 'A full immutable source SHA is required.' >&2; exit 78; }
fi

umask 077
install -d -m 0700 "$PROOF_ROOT"
if [[ -e "$proof_file" ]]; then
  [[ "$(stat -c '%a' "$proof_file")" == '600' ]] || { echo 'Global coordination proof must be mode 0600.' >&2; exit 78; }
fi

args=("${all_args[@]:1}")
if ! has_argument --proof-file "${args[@]}"; then args+=(--proof-file "$proof_file"); fi
if [[ "$COMMAND" == acquire || "$COMMAND" == check ]]; then
  if ! has_argument --closure-file "${args[@]}"; then args+=(--closure-file "$closure_file"); fi
  if ! has_argument --source "${args[@]}"; then args+=(--source "$source_sha"); fi
fi

export GLOBAL_COORDINATION_PROVIDER='mini-pc'
exec /usr/bin/node "$ADAPTER" "$COMMAND" "${args[@]}"
