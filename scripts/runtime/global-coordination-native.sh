#!/usr/bin/env bash

# Shared native-runtime adapter. Callers still decide the resource and the
# exact mutation boundary; this file only makes the lease/check/renew/release
# transition identical across native scripts.

NATIVE_COORDINATION_SCRIPT_ROOT="${NATIVE_COORDINATION_SCRIPT_ROOT:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)}"
NATIVE_COORDINATION_ACQUIRED="${NATIVE_COORDINATION_ACQUIRED:-0}"
NATIVE_COORDINATION_LAST_RENEW="${NATIVE_COORDINATION_LAST_RENEW:-0}"

native_coordination_init() {
  [[ "$#" -ge 4 ]] || {
    echo 'native_coordination_init requires resource, module, source SHA and closure file.' >&2
    return 64
  }
  NATIVE_COORDINATION_RESOURCE="$1"
  NATIVE_COORDINATION_MODULE="$2"
  NATIVE_COORDINATION_SOURCE="$3"
  NATIVE_COORDINATION_CLOSURE="$4"
  NATIVE_COORDINATION_OPERATION="${5:-mutation}"
  NATIVE_COORDINATION_IDENTITY_FILE="${6:-}"

  [[ "$NATIVE_COORDINATION_SOURCE" =~ ^[0-9a-f]{40}$ ]] || {
    echo 'Native coordination source must be a full lowercase SHA.' >&2
    return 78
  }
  [[ -f "$NATIVE_COORDINATION_CLOSURE" ]] || {
    echo "Native coordination closure is unavailable: $NATIVE_COORDINATION_CLOSURE" >&2
    return 78
  }
  if [[ "$NATIVE_COORDINATION_OPERATION" == release || "$NATIVE_COORDINATION_OPERATION" == promotion ]]; then
    [[ -n "$NATIVE_COORDINATION_IDENTITY_FILE" && -f "$NATIVE_COORDINATION_IDENTITY_FILE" ]] || {
      echo 'Native release identity is required for a release or promotion lease.' >&2
      return 78
    }
  fi

  # Operator wrappers may be launched from a checkout, but once the target
  # release exists the authority adapter and its detached attestations must
  # come from that immutable source. This prevents a mutable checkout copy
  # from silently changing the lease/fencing client or closure used for a
  # native mutation. Test harnesses can still inject an adapter root when no
  # immutable target exists.
  local immutable_root="/opt/skincos/releases/$NATIVE_COORDINATION_SOURCE/source"
  if [[ -f "$immutable_root/scripts/runtime/global-coordination-mini-pc.sh" && -f "$immutable_root/scripts/codex-global-coordination-workflow.mjs" ]]; then
    NATIVE_COORDINATION_SCRIPT_ROOT="$immutable_root"
    local immutable_closure="$immutable_root/.skincos-global-coordination-${NATIVE_COORDINATION_MODULE}.json"
    if [[ -f "$immutable_closure" ]]; then
      NATIVE_COORDINATION_CLOSURE="$immutable_closure"
    fi
    if [[ -n "$NATIVE_COORDINATION_IDENTITY_FILE" ]]; then
      local immutable_identity="$immutable_root/.skincos-release-identity-${NATIVE_COORDINATION_MODULE}.json"
      if [[ -f "$immutable_identity" ]]; then
        NATIVE_COORDINATION_IDENTITY_FILE="$immutable_identity"
      fi
    fi
  fi

  local proof_root proof_name
  proof_root="${SKINCOS_GLOBAL_COORDINATION_PROOF_ROOT:-/var/lib/skincos-runtime/global-coordination}"
  proof_name="$(printf '%s' "${NATIVE_COORDINATION_RESOURCE}-${NATIVE_COORDINATION_SOURCE}-$$" | tr -c 'A-Za-z0-9._-' '-')"
  NATIVE_COORDINATION_PROOF_FILE="${SKINCOS_GLOBAL_COORDINATION_PROOF_FILE:-$proof_root/$proof_name.json}"
  export SKINCOS_GLOBAL_COORDINATION_PROOF_FILE="$NATIVE_COORDINATION_PROOF_FILE"
  NATIVE_COORDINATION_ACQUIRED=0
  NATIVE_COORDINATION_LAST_RENEW="$(date +%s)"
}

native_coordination_run() {
  "$NATIVE_COORDINATION_SCRIPT_ROOT/scripts/runtime/global-coordination-mini-pc.sh" \
    "$@" --proof-file "$NATIVE_COORDINATION_PROOF_FILE"
}

native_coordination_acquire() {
  local idempotency_key="${1:-native:${NATIVE_COORDINATION_RESOURCE}:${NATIVE_COORDINATION_SOURCE}:$$}"
  local args=(
    acquire
    --resource "$NATIVE_COORDINATION_RESOURCE"
    --module "$NATIVE_COORDINATION_MODULE"
    --source "$NATIVE_COORDINATION_SOURCE"
    --closure-file "$NATIVE_COORDINATION_CLOSURE"
    --operation "$NATIVE_COORDINATION_OPERATION"
    --idempotency-key "$idempotency_key"
  )
  if [[ "$NATIVE_COORDINATION_OPERATION" == release || "$NATIVE_COORDINATION_OPERATION" == promotion ]]; then
    args+=(--release-identity-file "$NATIVE_COORDINATION_IDENTITY_FILE")
  fi
  native_coordination_run "${args[@]}" >/dev/null
  NATIVE_COORDINATION_ACQUIRED=1
  NATIVE_COORDINATION_LAST_RENEW="$(date +%s)"
}

native_coordination_check() {
  native_coordination_run check \
    --resource "$NATIVE_COORDINATION_RESOURCE" \
    --module "$NATIVE_COORDINATION_MODULE" \
    --source "$NATIVE_COORDINATION_SOURCE" \
    --closure-file "$NATIVE_COORDINATION_CLOSURE" >/dev/null
}

native_coordination_renew_if_due() {
  local now
  now="$(date +%s)"
  if (( now - NATIVE_COORDINATION_LAST_RENEW >= 60 )); then
    native_coordination_run renew >/dev/null
    NATIVE_COORDINATION_LAST_RENEW="$now"
  fi
}

native_coordination_release() {
  if [[ "${NATIVE_COORDINATION_ACQUIRED:-0}" != 1 ]]; then
    return 0
  fi
  native_coordination_run release >/dev/null
  NATIVE_COORDINATION_ACQUIRED=0
}

native_coordination_cleanup() {
  if [[ "${NATIVE_COORDINATION_ACQUIRED:-0}" == 1 ]]; then
    native_coordination_release || {
      echo 'Unable to release the native global coordination lease; it will expire fail-closed.' >&2
      return 1
    }
  fi
}
