#!/usr/bin/env bash
set -euo pipefail

# This is deliberately a CRM-only pointer publisher. It never relinks
# /opt/skincos/current/source, reloads a unit, or starts a service. Until an
# external custody verifier is installed, only an isolated /tmp test target can
# execute --apply; staging remains a contract-checked fail-closed path.

SCRIPT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CONTRACT="$SCRIPT_ROOT/scripts/runtime/crm-native-release-contract.mjs"
TARGET=""
RELEASE_SHA=""
CANDIDATE_ROOT=""
APPLY=0
RELEASE_BASE="${CRM_NATIVE_RELEASE_BASE:-}"
CURRENT_LINK="${CRM_NATIVE_CURRENT_LINK:-}"
PREVIOUS_LINK="${CRM_NATIVE_PREVIOUS_LINK:-}"

usage() {
  cat <<'EOF'
Usage: scripts/runtime/prepare-crm-native-release.sh \
  --target <test|staging> --release-sha <full-sha> --candidate-root <native-release-root> [--apply]

The command validates an externally attested CRM source snapshot and prepares
only /<target>/current/crm-service. It never touches current/source, systemd,
routes, database state, or customer data. --apply is executable only for the
isolated test layout while custody bootstrap is intentionally incomplete.
EOF
}

assert_isolated_test_mutation_root() {
  local test_root path resolved
  test_root="${RELEASE_BASE%/releases}"
  [[ "$test_root" != "$RELEASE_BASE" && -d "$test_root" && ! -L "$test_root" ]] || {
    echo 'Test CRM publisher root must be an existing non-symlink directory.' >&2
    exit 78
  }
  resolved="$(readlink -f -- "$test_root")"
  [[ "$resolved" == "$test_root" ]] || {
    echo 'Test CRM publisher root must not resolve outside its isolated directory.' >&2
    exit 78
  }
  for path in "$RELEASE_BASE" "$(dirname -- "$CURRENT_LINK")" "$(dirname -- "$PREVIOUS_LINK")"; do
    if [[ -e "$path" || -L "$path" ]]; then
      [[ -d "$path" && ! -L "$path" ]] || {
        echo 'Test CRM publisher paths must not use symbolic links or non-directory ancestors.' >&2
        exit 78
      }
      resolved="$(readlink -f -- "$path")"
      [[ "$resolved" == "$path" ]] || {
        echo 'Test CRM publisher paths must remain under the isolated test root.' >&2
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
    --release-sha)
      [[ $# -ge 2 ]] || { echo '--release-sha requires a value.' >&2; exit 64; }
      RELEASE_SHA="$2"
      shift
      ;;
    --candidate-root)
      [[ $# -ge 2 ]] || { echo '--candidate-root requires a value.' >&2; exit 64; }
      CANDIDATE_ROOT="$2"
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
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]] || {
  echo '--release-sha must be a full lowercase SHA.' >&2
  exit 64
}
[[ -n "$CANDIDATE_ROOT" && -f "$CONTRACT" ]] || {
  echo 'A candidate root and the CRM-native release contract are required.' >&2
  exit 78
}

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

# A staging path is specified now so a future bootstrap has one immutable
# contract. It is not executable until a root-owned custody verifier binds the
# GitHub artifact, SHA/tree/digest, intended service unit and predecessor.
# Refuse before looking at caller-controlled candidate bytes.
if [[ "$APPLY" == '1' && "$TARGET" == 'staging' ]]; then
  echo 'CRM native staging publication is fail-closed: external authenticated custody bootstrap is not installed.' >&2
  exit 78
fi
if [[ "$APPLY" == '1' && "${CRM_NATIVE_PUBLISHER_TEST_MODE:-}" != '1' ]]; then
  echo 'CRM native --apply is limited to an explicitly enabled isolated test harness.' >&2
  exit 78
fi
if [[ "$APPLY" == '1' && "$TARGET" == 'test' ]]; then
  assert_isolated_test_mutation_root
fi

[[ "$CANDIDATE_ROOT" == /* && "$CANDIDATE_ROOT" != /mnt/* ]] || {
  echo '--candidate-root must be an absolute native Linux path.' >&2
  exit 78
}
ACTIVE_RELEASE_ROOT=''
ACTIVE_RELEASE_SHA=''
if [[ -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]]; then
  ACTIVE_RELEASE_SHA="$(node "$CONTRACT" pointer-release-sha --release-base "$RELEASE_BASE" --link "$CURRENT_LINK")"
  ACTIVE_RELEASE_ROOT="$(readlink -f -- "$CURRENT_LINK")"
  node "$CONTRACT" validate-successor \
    --release-root "$CANDIDATE_ROOT" \
    --release-sha "$RELEASE_SHA" \
    --target "$TARGET" \
    --active-release-root "$ACTIVE_RELEASE_ROOT" \
    --active-release-sha "$ACTIVE_RELEASE_SHA" >/dev/null
else
  node "$CONTRACT" validate-successor \
    --release-root "$CANDIDATE_ROOT" \
    --release-sha "$RELEASE_SHA" \
    --target "$TARGET" >/dev/null
fi

DESTINATION="$RELEASE_BASE/$RELEASE_SHA/crm-service"
STAGING="$RELEASE_BASE/.crm-service-staging-$RELEASE_SHA-$$"
CURRENT_NEXT="$CURRENT_LINK.next-$$"
PREVIOUS_NEXT="$PREVIOUS_LINK.next-$$"
[[ "$DESTINATION" == "$RELEASE_BASE"/[0-9a-f]*'/crm-service' ]] || {
  echo 'CRM release destination is invalid.' >&2
  exit 78
}
[[ "$STAGING" == "$RELEASE_BASE/.crm-service-staging-$RELEASE_SHA-"* ]] || {
  echo 'CRM release staging path is invalid.' >&2
  exit 78
}
if [[ -e "$DESTINATION" || -L "$DESTINATION" ]]; then
  echo "CRM release destination already exists: $DESTINATION" >&2
  exit 78
fi

if [[ "$APPLY" != '1' ]]; then
  printf 'target=%s\nrelease_sha=%s\ncandidate_root=%s\ndestination=%s\ncurrent_pointer=%s\nprevious_pointer=%s\ndry_run=true\nservice_restart=false\n' \
    "$TARGET" "$RELEASE_SHA" "$CANDIDATE_ROOT" "$DESTINATION" "$CURRENT_LINK" "$PREVIOUS_LINK"
  exit 0
fi

for command in cp install ln mkdir mv node rm; do
  command -v "$command" >/dev/null 2>&1 || { echo "Required command is unavailable: $command" >&2; exit 78; }
done

umask 0077
cleanup() {
  rm -f -- "$CURRENT_NEXT" "$PREVIOUS_NEXT"
  if [[ "$STAGING" == "$RELEASE_BASE/.crm-service-staging-$RELEASE_SHA-"* ]]; then
    rm -rf -- "$STAGING"
  fi
}
trap cleanup EXIT INT TERM

mkdir -p -- "$RELEASE_BASE" "$(dirname -- "$CURRENT_LINK")"
install -d -m 0750 -- "$STAGING" "$RELEASE_BASE/$RELEASE_SHA"
cp -a -- "$CANDIDATE_ROOT/." "$STAGING/"
if [[ -n "$ACTIVE_RELEASE_ROOT" ]]; then
  node "$CONTRACT" validate-successor \
    --release-root "$STAGING" \
    --release-sha "$RELEASE_SHA" \
    --target "$TARGET" \
    --active-release-root "$ACTIVE_RELEASE_ROOT" \
    --active-release-sha "$ACTIVE_RELEASE_SHA" >/dev/null
else
  node "$CONTRACT" validate-successor \
    --release-root "$STAGING" \
    --release-sha "$RELEASE_SHA" \
    --target "$TARGET" >/dev/null
fi
if [[ -n "$ACTIVE_RELEASE_ROOT" ]]; then
  node "$CONTRACT" validate-pointer \
    --release-base "$RELEASE_BASE" \
    --link "$CURRENT_LINK" \
    --expected-sha "$ACTIVE_RELEASE_SHA" >/dev/null
  [[ "$(readlink -f -- "$CURRENT_LINK")" == "$ACTIVE_RELEASE_ROOT" ]] || {
    echo 'Active CRM pointer changed while preparing its successor.' >&2
    exit 78
  }
elif [[ -e "$CURRENT_LINK" || -L "$CURRENT_LINK" ]]; then
  echo 'An active CRM pointer appeared while preparing an initial release.' >&2
  exit 78
fi
mv -T -- "$STAGING" "$DESTINATION"

if [[ -n "$ACTIVE_RELEASE_ROOT" ]]; then
  ln -s -- "$ACTIVE_RELEASE_ROOT" "$PREVIOUS_NEXT"
  mv -T -- "$PREVIOUS_NEXT" "$PREVIOUS_LINK"
fi
ln -s -- "$DESTINATION" "$CURRENT_NEXT"
mv -T -- "$CURRENT_NEXT" "$CURRENT_LINK"
node "$CONTRACT" validate-pointer \
  --release-base "$RELEASE_BASE" \
  --link "$CURRENT_LINK" \
  --expected-sha "$RELEASE_SHA" >/dev/null
trap - EXIT INT TERM
printf 'target=%s\nrelease_sha=%s\ndestination=%s\ncurrent_pointer=%s\nprevious_pointer=%s\nstaged=true\nservice_restart=false\n' \
  "$TARGET" "$RELEASE_SHA" "$DESTINATION" "$CURRENT_LINK" "$PREVIOUS_LINK"
