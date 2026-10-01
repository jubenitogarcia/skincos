#!/usr/bin/env bash
set -euo pipefail

# This companion never invokes systemctl. A source-only change must prove the
# dedicated pointer protocol before a separately custodied host rollout can
# bind it to crm.service and add a service-specific smoke.

SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CONTRACT="$SCRIPT_ROOT/scripts/runtime/crm-native-release-contract.mjs"
TARGET=""
TO_RELEASE_SHA=""
APPLY=0
RELEASE_BASE="${CRM_NATIVE_RELEASE_BASE:-}"
CURRENT_LINK="${CRM_NATIVE_CURRENT_LINK:-}"
PREVIOUS_LINK="${CRM_NATIVE_PREVIOUS_LINK:-}"

usage() {
  cat <<'EOF'
Usage: scripts/runtime/rollback-crm-native-release.sh \
  --target <test|staging> --to-release-sha <full-sha> [--apply]

Restores only the exact immutable predecessor named by
<current>/crm-service.previous. It never touches current/source, systemd,
routes, database state, or customer data.
EOF
}

assert_isolated_test_mutation_root() {
  local test_root path resolved
  test_root="${RELEASE_BASE%/releases}"
  [[ "$test_root" != "$RELEASE_BASE" && -d "$test_root" && ! -L "$test_root" ]] || {
    echo 'Test CRM rollback root must be an existing non-symlink directory.' >&2
    exit 78
  }
  resolved="$(readlink -f -- "$test_root")"
  [[ "$resolved" == "$test_root" ]] || {
    echo 'Test CRM rollback root must not resolve outside its isolated directory.' >&2
    exit 78
  }
  for path in "$RELEASE_BASE" "$(dirname -- "$CURRENT_LINK")" "$(dirname -- "$PREVIOUS_LINK")"; do
    if [[ -e "$path" || -L "$path" ]]; then
      [[ -d "$path" && ! -L "$path" ]] || {
        echo 'Test CRM rollback paths must not use symbolic links or non-directory ancestors.' >&2
        exit 78
      }
      resolved="$(readlink -f -- "$path")"
      [[ "$resolved" == "$path" ]] || {
        echo 'Test CRM rollback paths must remain under the isolated test root.' >&2
        exit 78
      }
    fi
  done
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo '--target requires a value.' >&2; exit 64; }
      TARGET="$2"
      shift
      ;;
    --to-release-sha)
      [[ $# -ge 2 ]] || { echo '--to-release-sha requires a value.' >&2; exit 64; }
      TO_RELEASE_SHA="$2"
      shift
      ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

[[ "$TARGET" == 'test' || "$TARGET" == 'staging' ]] || {
  echo '--target must be test or staging.' >&2
  exit 64
}
[[ "$TO_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo '--to-release-sha must be a full lowercase SHA.' >&2
  exit 64
}
[[ -f "$CONTRACT" ]] || { echo 'CRM-native release contract is unavailable.' >&2; exit 78; }

if [[ "$TARGET" == 'staging' ]]; then
  RELEASE_BASE="${RELEASE_BASE:-/opt/skincos/staging/releases}"
  CURRENT_LINK="${CURRENT_LINK:-/opt/skincos/staging/current/crm-service}"
  PREVIOUS_LINK="${PREVIOUS_LINK:-/opt/skincos/staging/current/crm-service.previous}"
fi
[[ -n "$RELEASE_BASE" && -n "$CURRENT_LINK" && -n "$PREVIOUS_LINK" ]] || {
  echo 'CRM_NATIVE_RELEASE_BASE, CRM_NATIVE_CURRENT_LINK and CRM_NATIVE_PREVIOUS_LINK are required for test.' >&2
  exit 64
}
node "$CONTRACT" validate-layout \
  --target "$TARGET" \
  --release-base "$RELEASE_BASE" \
  --current-link "$CURRENT_LINK" \
  --previous-link "$PREVIOUS_LINK" >/dev/null

# Keep the staging gate before inspecting either pointer. A caller cannot turn
# a source-level script into a host publisher merely by offering a matching
# release directory or a self-consistent previous link.
if [[ "$APPLY" == '1' && "$TARGET" == 'staging' ]]; then
  echo 'CRM native staging rollback is fail-closed: external authenticated custody bootstrap is not installed.' >&2
  exit 78
fi
if [[ "$APPLY" == '1' && "${CRM_NATIVE_PUBLISHER_TEST_MODE:-}" != '1' ]]; then
  echo 'CRM native --apply is limited to an explicitly enabled isolated test harness.' >&2
  exit 78
fi
if [[ "$APPLY" == '1' && "$TARGET" == 'test' ]]; then
  assert_isolated_test_mutation_root
fi

node "$CONTRACT" validate-pointer \
  --release-base "$RELEASE_BASE" \
  --link "$CURRENT_LINK" >/dev/null
node "$CONTRACT" validate-pointer \
  --release-base "$RELEASE_BASE" \
  --link "$PREVIOUS_LINK" \
  --expected-sha "$TO_RELEASE_SHA" >/dev/null
PREDECESSOR_ROOT="$RELEASE_BASE/$TO_RELEASE_SHA/crm-service"
node "$CONTRACT" validate-release \
  --release-root "$PREDECESSOR_ROOT" \
  --release-sha "$TO_RELEASE_SHA" \
  --target "$TARGET" >/dev/null

if [[ "$APPLY" != '1' ]]; then
  printf 'target=%s\nrollback_sha=%s\ncurrent_pointer=%s\nprevious_pointer=%s\ndry_run=true\nservice_restart=false\n' \
    "$TARGET" "$TO_RELEASE_SHA" "$CURRENT_LINK" "$PREVIOUS_LINK"
  exit 0
fi

for command in ln mv node readlink rm; do
  command -v "$command" >/dev/null 2>&1 || { echo "Required command is unavailable: $command" >&2; exit 78; }
done

CURRENT_NEXT="$CURRENT_LINK.next-$$"
PREVIOUS_NEXT="$PREVIOUS_LINK.next-$$"
cleanup() {
  rm -f -- "$CURRENT_NEXT" "$PREVIOUS_NEXT"
}
trap cleanup EXIT INT TERM

current_target="$(readlink -f -- "$CURRENT_LINK")"
ln -s -- "$current_target" "$PREVIOUS_NEXT"
mv -T -- "$PREVIOUS_NEXT" "$PREVIOUS_LINK"
ln -s -- "$PREDECESSOR_ROOT" "$CURRENT_NEXT"
mv -T -- "$CURRENT_NEXT" "$CURRENT_LINK"
node "$CONTRACT" validate-pointer \
  --release-base "$RELEASE_BASE" \
  --link "$CURRENT_LINK" \
  --expected-sha "$TO_RELEASE_SHA" >/dev/null
trap - EXIT INT TERM
printf 'target=%s\nrollback_sha=%s\ncurrent_pointer=%s\nprevious_pointer=%s\nrollback_pointer_switched=true\nservice_restart=false\n' \
  "$TARGET" "$TO_RELEASE_SHA" "$CURRENT_LINK" "$PREVIOUS_LINK"
