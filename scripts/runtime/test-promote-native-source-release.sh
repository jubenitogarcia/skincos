#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/runtime/promote-native-source-release.sh"

bash -n "$SCRIPT"

help_output="$($SCRIPT --help)"
[[ "$help_output" == *'--rollback --rollback-to-release <previous-sha> --expected-current-release <failed-new-sha>'* ]] || {
  echo 'Native source rollback usage is missing the exact prior/current release contract.' >&2
  exit 1
}

prior_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
failed_sha='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
if "$SCRIPT" --rollback --expected-current-release "$failed_sha" >/dev/null 2>&1; then
  echo 'Native source rollback accepted a missing immutable rollback target.' >&2
  exit 1
fi
if "$SCRIPT" --rollback --release-id "$prior_sha" --rollback-to-release "$prior_sha" --expected-current-release "$failed_sha" >/dev/null 2>&1; then
  echo 'Native source rollback accepted an ambiguous release-id and rollback target.' >&2
  exit 1
fi
if "$SCRIPT" --release-id "$failed_sha" --rollback-to-release "$prior_sha" --expected-current-release "$prior_sha" >/dev/null 2>&1; then
  echo 'Native source promotion accepted a rollback-only target option.' >&2
  exit 1
fi

required=(
  "mode='rollback'"
  '--rollback-to-release) rollback_to_release="${2:-}"; shift ;;'
  'Native source transition must be invoked from one of the two verified immutable release roots.'
  'Immutable $role release lineage, closure, or identity is invalid.'
  'current.releaseId === currentRelease && current.parentReleaseId === targetRelease && current.verifiedAncestor === true'
  '--resource release:native-runtime --module native-runtime --source "$release_id" --closure-file "$coordination_closure"'
  '--operation promotion --release-identity-file "$release_identity"'
  'mini-pc:release:native-runtime:$mode:$release_id:from:$expected_current:$$'
  'controlled_native_release_$mode'
  'assert_expected_current_pointer()'
  'switched_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"'
  'Native source $mode did not set the exact immutable target pointer.'
  'Native source release %s safely: target=%s expected_current=%s'
)
for pattern in "${required[@]}"; do
  grep -F -- "$pattern" "$SCRIPT" >/dev/null || {
    echo "Missing governed native source rollback guard: $pattern" >&2
    exit 1
  }
done

pointer_check_count="$(grep -Fc 'assert_expected_current_pointer || exit 1' "$SCRIPT")"
[[ "$pointer_check_count" =~ ^[0-9]+$ ]] && (( pointer_check_count >= 3 )) || {
  echo 'Native source transition must check the expected pointer initially, after its lease, and immediately before the swap.' >&2
  exit 1
}

if grep -F -- '--operation rollback' "$SCRIPT" >/dev/null; then
  echo 'Rollback must reuse the identity-attested promotion lease transition, not an unsupported unauthenticated operation.' >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
RELEASE_BASE="$TMP_DIR/releases"
CURRENT_LINK="$TMP_DIR/current"
MARKER="$TMP_DIR/coordination-reached"
mkdir -p "$RELEASE_BASE/$prior_sha/source/orb/engine" \
  "$RELEASE_BASE/$prior_sha/source/ops/runtime/units" \
  "$RELEASE_BASE/$failed_sha/source/orb/engine" \
  "$RELEASE_BASE/$failed_sha/source/scripts/runtime" \
  "$RELEASE_BASE/$failed_sha/source/scripts"
printf '%s\n' '[Unit]' > "$RELEASE_BASE/$prior_sha/source/ops/runtime/units/orb-restart-fence.service"
cp "$SCRIPT" "$RELEASE_BASE/$failed_sha/source/scripts/runtime/promote-native-source-release.sh"

node - "$RELEASE_BASE" "$prior_sha" "$failed_sha" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [releaseBase, prior, failed] = process.argv.slice(2);
const canonicalJson = (value) => Array.isArray(value)
  ? `[${value.map(canonicalJson).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const writeRelease = (release, parent) => {
  const root = path.join(releaseBase, release, 'source');
  const material = {
    schemaVersion: 1,
    module: 'native-runtime',
    inputs: [{ path: 'scripts/runtime/promote-native-source-release.sh', blob: 'c'.repeat(40) }],
  };
  const digest = crypto.createHash('sha256').update(canonicalJson(material)).digest('hex');
  fs.writeFileSync(path.join(root, '.skincos-release-lineage.json'), `${JSON.stringify({ releaseId: release, parentReleaseId: parent, verifiedAncestor: true })}\n`);
  fs.writeFileSync(path.join(root, '.skincos-global-coordination-native-runtime.json'), `${JSON.stringify({ module: 'native-runtime', sourceCommit: release, sourceTree: 'd'.repeat(40), digest, material })}\n`);
  fs.writeFileSync(path.join(root, '.skincos-release-identity-native-runtime.json'), `${JSON.stringify({ schemaVersion: 1, module: 'native-runtime', sourceCommit: release, sourceTree: 'd'.repeat(40), dependencyClosureDigest: digest, artifacts: [{ name: 'native-source-archive', id: `native-source:${release}`, digest: 'e'.repeat(64) }] })}\n`);
};
writeRelease(prior, 'f'.repeat(40));
writeRelease(failed, prior);
NODE
printf '%s\n' '#!/usr/bin/env bash' 'touch "$NATIVE_POINTER_TEST_MARKER"' 'exit 79' > "$RELEASE_BASE/$failed_sha/source/scripts/runtime/global-coordination-mini-pc.sh"
printf '%s\n' 'export {};' > "$RELEASE_BASE/$failed_sha/source/scripts/codex-global-coordination-workflow.mjs"
mkdir -p "$TMP_DIR/bin"
printf '%s\n' '#!/usr/bin/env bash' 'if [[ "${1:-}" == show ]]; then printf 999999; exit 0; fi' 'exit 79' > "$TMP_DIR/bin/systemctl"
chmod 0755 "$RELEASE_BASE/$failed_sha/source/scripts/runtime/global-coordination-mini-pc.sh" "$TMP_DIR/bin/systemctl"
ln -s "$RELEASE_BASE/$failed_sha/source" "$CURRENT_LINK"

if PATH="$TMP_DIR/bin:$PATH" SKINCOS_RELEASE_BASE="$RELEASE_BASE" SKINCOS_SOURCE_CURRENT_LINK="$CURRENT_LINK" NATIVE_POINTER_TEST_MARKER="$MARKER" \
  "$RELEASE_BASE/$failed_sha/source/scripts/runtime/promote-native-source-release.sh" \
    --rollback --rollback-to-release "$prior_sha" --expected-current-release "$failed_sha" --recover-runtime-split >"$TMP_DIR/valid.log" 2>&1; then
  echo 'Fixture rollback unexpectedly completed after the coordination stub refused mutation.' >&2
  exit 1
fi
[[ -f "$MARKER" ]] || { echo 'A valid inverse lineage did not reach the native coordination gate.' >&2; exit 1; }

RACE_SYSTEMCTL_MARKER="$TMP_DIR/systemctl-after-lease"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'case "${1:-}" in' \
  '  acquire) ln -sfn "$NATIVE_POINTER_TEST_RACE_TARGET" "$NATIVE_POINTER_TEST_CURRENT_LINK" ;;' \
  '  release) ;;' \
  '  *) ;;' \
  'esac' \
  'exit 0' > "$RELEASE_BASE/$failed_sha/source/scripts/runtime/global-coordination-mini-pc.sh"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ "${1:-}" == show ]]; then printf 999999; exit 0; fi' \
  'touch "$NATIVE_POINTER_TEST_SYSTEMCTL_MARKER"' \
  'exit 79' > "$TMP_DIR/bin/systemctl"
chmod 0755 "$RELEASE_BASE/$failed_sha/source/scripts/runtime/global-coordination-mini-pc.sh" "$TMP_DIR/bin/systemctl"
rm -f "$RACE_SYSTEMCTL_MARKER"
ln -sfn "$RELEASE_BASE/$failed_sha/source" "$CURRENT_LINK"
if PATH="$TMP_DIR/bin:$PATH" SKINCOS_RELEASE_BASE="$RELEASE_BASE" SKINCOS_SOURCE_CURRENT_LINK="$CURRENT_LINK" \
  NATIVE_POINTER_TEST_CURRENT_LINK="$CURRENT_LINK" NATIVE_POINTER_TEST_RACE_TARGET="$RELEASE_BASE/$prior_sha/source" \
  NATIVE_POINTER_TEST_SYSTEMCTL_MARKER="$RACE_SYSTEMCTL_MARKER" \
  "$RELEASE_BASE/$failed_sha/source/scripts/runtime/promote-native-source-release.sh" \
    --rollback --rollback-to-release "$prior_sha" --expected-current-release "$failed_sha" --recover-runtime-split >"$TMP_DIR/post-lease-race.log" 2>&1; then
  echo 'Native source rollback accepted a pointer changed while it waited for the native lease.' >&2
  exit 1
fi
[[ "$(readlink -f "$CURRENT_LINK")" == "$RELEASE_BASE/$prior_sha/source" ]] || {
  echo 'Post-lease pointer revalidation overwrote the competing source transition.' >&2
  exit 1
}
[[ ! -e "$RACE_SYSTEMCTL_MARKER" ]] || {
  echo 'Native source transition entered the maintenance path after detecting a post-lease pointer race.' >&2
  exit 1
}
grep -F 'Current pointer changed:' "$TMP_DIR/post-lease-race.log" >/dev/null || {
  echo 'Post-lease pointer race did not fail at the exact expected-pointer guard.' >&2
  exit 1
}

ln -sfn "$RELEASE_BASE/$failed_sha/source" "$CURRENT_LINK"
rm -f "$MARKER"
node - "$RELEASE_BASE/$failed_sha/source/.skincos-release-lineage.json" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
value.parentReleaseId = 'f'.repeat(40);
fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
NODE
if PATH="$TMP_DIR/bin:$PATH" SKINCOS_RELEASE_BASE="$RELEASE_BASE" SKINCOS_SOURCE_CURRENT_LINK="$CURRENT_LINK" NATIVE_POINTER_TEST_MARKER="$MARKER" \
  "$RELEASE_BASE/$failed_sha/source/scripts/runtime/promote-native-source-release.sh" \
    --rollback --rollback-to-release "$prior_sha" --expected-current-release "$failed_sha" --recover-runtime-split >"$TMP_DIR/invalid.log" 2>&1; then
  echo 'Fixture rollback accepted a non-parent rollback target.' >&2
  exit 1
fi
[[ ! -e "$MARKER" ]] || { echo 'Invalid inverse lineage reached the native coordination gate.' >&2; exit 1; }
grep -F 'immutable release lineage does not prove this exact pointer transition' "$TMP_DIR/invalid.log" >/dev/null || {
  echo 'Invalid inverse lineage did not fail at the exact lineage gate.' >&2
  exit 1
}

echo 'PASS: native source pointer rollback is exact, identity-attested, and fail-closed.'
