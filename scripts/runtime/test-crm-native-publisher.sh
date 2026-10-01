#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
CONTRACT="$ROOT_DIR/scripts/runtime/crm-native-release-contract.mjs"
PREPARE="$ROOT_DIR/scripts/runtime/prepare-crm-native-release.sh"
ROLLBACK="$ROOT_DIR/scripts/runtime/rollback-crm-native-release.sh"
UNIT="$ROOT_DIR/ops/runtime/units/crm.service"
NATIVE_UNIT="$ROOT_DIR/ops/runtime/units/crm.service.native.template"
LAUNCHER="$ROOT_DIR/scripts/crm/run-api-linux.sh"
LIFECYCLE_INSTALLER="$ROOT_DIR/scripts/runtime/install-lifecycle-units.sh"
NATIVE_MANAGER="$ROOT_DIR/scripts/runtime/manage-native-runtime.sh"
CUSTODY_HELPER="$ROOT_DIR/scripts/runtime/crm-native-publisher-custody.mjs"
CUSTODY_INSTALLER="$ROOT_DIR/scripts/runtime/install-crm-native-publisher-custody.sh"
CUSTODY_RUNNER_UNIT="$ROOT_DIR/ops/runtime/units/skincos-native-custody-runner.service"
CUSTODY_SUDOERS="$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers"
CUSTODY_WORKFLOW="$ROOT_DIR/.github/workflows/publish-crm-native-release.yml"

for file in "$PREPARE" "$ROLLBACK"; do
  bash -n "$file"
done
node --check "$CONTRACT"
node --check "$CUSTODY_HELPER"
bash -n "$LAUNCHER"
bash -n "$LIFECYCLE_INSTALLER"
bash -n "$NATIVE_MANAGER"
bash -n "$CUSTODY_INSTALLER"

grep -Fx 'WorkingDirectory=__REPO_ROOT__' "$UNIT" >/dev/null
grep -Fx 'ExecStart=__REPO_ROOT__/scripts/crm/run-api-linux.sh' "$UNIT" >/dev/null
grep -Fx 'WorkingDirectory=__CRM_NATIVE_RELEASE_ROOT__' "$NATIVE_UNIT" >/dev/null
grep -Fx 'Environment=CRM_NATIVE_DEPLOYMENT_TARGET=__CRM_NATIVE_DEPLOYMENT_TARGET__' "$NATIVE_UNIT" >/dev/null
grep -Fx 'Environment=PONTO_LEGACY_RUNTIME_MODE=disabled' "$NATIVE_UNIT" >/dev/null
grep -Fx 'Environment=CRM_NATIVE_UNSUPPORTED_JOBS=sales-chart-messenger' "$NATIVE_UNIT" >/dev/null
grep -Fx 'Environment=CRM_NATIVE_MEDIA_TOOLS_MODE=__CRM_NATIVE_MEDIA_TOOLS_MODE__' "$NATIVE_UNIT" >/dev/null
grep -Fx 'Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' "$NATIVE_UNIT" >/dev/null
grep -Fx 'ExecStart=__CRM_NATIVE_RELEASE_ROOT__/scripts/crm/run-api-linux.sh' "$NATIVE_UNIT" >/dev/null
! grep -F 'systemctl' "$PREPARE" >/dev/null
! grep -F 'systemctl' "$ROLLBACK" >/dev/null
! grep -F '/opt/skincos/current/source' "$PREPARE" >/dev/null
! grep -F '/opt/skincos/current/source' "$ROLLBACK" >/dev/null
grep -F 'CRM_NATIVE_DEPLOYMENT_TARGET must be staging or production for a native CRM release.' "$LAUNCHER" >/dev/null
grep -F 'CRM_NATIVE_RELEASE_ROOT must resolve to an immutable staging CRM-only release.' "$LAUNCHER" >/dev/null
grep -F 'CRM_NATIVE_RELEASE_ROOT must resolve to an immutable production CRM-only release.' "$LAUNCHER" >/dev/null
grep -F 'CRM launcher does not originate from CRM_NATIVE_RELEASE_ROOT.' "$LAUNCHER" >/dev/null
grep -Fx "  export PONTO_LEGACY_RUNTIME_MODE='disabled'" "$LAUNCHER" >/dev/null
grep -Fx "      export PONTO_LEGACY_RUNTIME_MODE='disabled'" "$ROOT_DIR/crm/api/scripts/run.sh" >/dev/null
grep -F 'assertNoFileCapabilities' "$CUSTODY_HELPER" >/dev/null
grep -F 'restoreDropIns(backup)' "$CUSTODY_HELPER" >/dev/null
grep -F 'current/source' "$CUSTODY_HELPER" >/dev/null
grep -Fx 'ReadWritePaths=/opt/skincos/releases' "$CUSTODY_RUNNER_UNIT" >/dev/null
grep -Fx 'ReadWritePaths=/opt/skincos/current' "$CUSTODY_RUNNER_UNIT" >/dev/null
grep -Fx 'ReadWritePaths=/var/lib/skincos-runtime/crm-native-publisher' "$CUSTODY_RUNNER_UNIT" >/dev/null
grep -Fx 'ReadWritePaths=/etc/systemd/system' "$CUSTODY_RUNNER_UNIT" >/dev/null
grep -F '/usr/local/sbin/skincos-publish-crm-native-release preflight' "$CUSTODY_SUDOERS" >/dev/null
! grep -F '/usr/local/sbin/skincos-publish-crm-native-release rollback-last' "$CUSTODY_SUDOERS" >/dev/null
grep -F 'release:crm-native' "$CUSTODY_WORKFLOW" >/dev/null
sed -n '/^units=(/,/^)/p' "$LIFECYCLE_INSTALLER" | grep -Fx '  crm.service' >/dev/null
! grep -F 'crm.service.native.template' "$LIFECYCLE_INSTALLER" >/dev/null
sed -n '/^units=(/,/^)/p' "$NATIVE_MANAGER" | grep -Fx '  crm.service' >/dev/null
grep -F 'backend/scripts/e2e.sh' "$NATIVE_MANAGER" >/dev/null

tmp_root="$(mktemp -d -t skincos-crm-native-test-XXXXXXXX)"
linked_root=''
cleanup() {
  rm -rf -- "$tmp_root"
  [[ -z "$linked_root" ]] || rm -rf -- "$linked_root"
}
trap cleanup EXIT INT TERM

# Render the future dedicated template only through a disposable pointer. The
# generic lifecycle installer must continue to render the incumbent CRM unit
# until the host custody bootstrap can perform the complete transfer.
render_root="$tmp_root/rendered-crm-service"
mkdir -p "$render_root/scripts/crm"
printf '#!/usr/bin/env bash\nexit 0\n' >"$render_root/scripts/crm/run-api-linux.sh"
chmod 0755 "$render_root/scripts/crm/run-api-linux.sh"
sed \
  -e "s|__CRM_NATIVE_RELEASE_ROOT__|$render_root|g" \
  -e 's|__CRM_NATIVE_DEPLOYMENT_TARGET__|staging|g' \
  -e 's|__CRM_NATIVE_MEDIA_TOOLS_MODE__|disabled|g' \
  -e "s|__STATE_ROOT__|$tmp_root/state|g" \
  -e "s|__CONFIG_ROOT__|$tmp_root/config|g" \
  -e "s|__LOG_ROOT__|$tmp_root/log|g" \
  "$NATIVE_UNIT" >"$tmp_root/crm.service"
systemd-analyze verify "$tmp_root/crm.service"

release_a='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
release_b='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
release_c='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
node - "$tmp_root" "$release_a" "$release_b" "$release_c" <<'NODE'
const fs = require('fs');
const path = require('path');
const [root, firstSha, secondSha, invalidSha] = process.argv.slice(2);
const makeRelease = (releaseSha, sourceTree, predecessor) => {
  const releaseRoot = path.join(root, `candidate-${releaseSha}`);
  fs.mkdirSync(path.join(releaseRoot, 'scripts', 'crm'), { recursive: true });
  fs.mkdirSync(path.join(releaseRoot, 'crm', 'api'), { recursive: true });
  fs.mkdirSync(path.join(releaseRoot, 'crm', 'console'), { recursive: true });
  fs.mkdirSync(path.join(releaseRoot, 'backend', 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(releaseRoot, 'crm', 'api', 'node_modules', 'express'), { recursive: true });
  fs.mkdirSync(path.join(releaseRoot, 'shared', 'crm-auth'), { recursive: true });
  fs.writeFileSync(path.join(releaseRoot, 'scripts', 'crm', 'run-api-linux.sh'), '#!/usr/bin/env bash\nexit 0\n');
  fs.writeFileSync(path.join(releaseRoot, 'crm', 'api', 'package-lock.json'), '{"lockfileVersion":3}\n');
  fs.writeFileSync(path.join(releaseRoot, 'backend', 'scripts', 'env.sh'), '#!/usr/bin/env bash\n');
  fs.writeFileSync(path.join(releaseRoot, 'backend', 'capabilities.json'), '{}\n');
  fs.writeFileSync(path.join(releaseRoot, 'shared', 'crm-auth', '.keep'), 'fixture\n');
  fs.writeFileSync(path.join(releaseRoot, 'crm', 'console', '.keep'), 'fixture\n');
  const sourceArchiveSha256 = releaseSha === firstSha ? '1'.repeat(64) : '2'.repeat(64);
  fs.writeFileSync(path.join(releaseRoot, '.skincos-crm-native-release.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'skincos-crm-native-release',
    releaseSha,
    sourceTree,
    sourceArchiveSha256,
    sourceArchiveBytes: 1048576,
    target: 'test',
    custody: {
      schemaVersion: 1,
      issuer: 'github-actions',
      repository: 'jubenitogarcia/skincos',
      workflow: 'prepare-release-candidate.yml',
      runId: releaseSha === firstSha ? '101' : '102',
      artifactName: `release-source-${releaseSha}`,
      sourceSha: releaseSha,
      sourceArchiveSha256,
      sourceArchiveBytes: 1048576,
    },
    runtimeCustody: {
      schemaVersion: 1,
      dependencyArchiveSha256: '3'.repeat(64),
      dependencyArchiveBytes: 1048576,
      policySha256: '4'.repeat(64),
      stagingProofSha256: '5'.repeat(64),
      runtimeAttestationSha256: '7'.repeat(64),
      authorizationId: 'b1f3c5d7-1111-4111-8111-123456789abc',
      unitTemplateSha256: '6'.repeat(64),
      coordinationProofSha256: '8'.repeat(64),
      coordinationLeaseId: 'c1f3c5d7-1111-4111-8111-123456789abc',
      coordinationFencingToken: 1,
      coordinationIntentDigest: '9'.repeat(64),
    },
    artifacts: {
      apiEntrypoint: 'scripts/crm/run-api-linux.sh',
      apiPackageLock: 'crm/api/package-lock.json',
      backendEnvironment: 'backend/scripts/env.sh',
      capabilitiesCatalog: 'backend/capabilities.json',
      consoleRoot: 'crm/console',
      productionDependencies: 'crm/api/node_modules',
      sharedAuthRoot: 'shared/crm-auth',
    },
    predecessor,
  }, null, 2)}\n`);
  return releaseRoot;
};
makeRelease(firstSha, 'c'.repeat(40), null);
makeRelease(secondSha, 'd'.repeat(40), { releaseSha: firstSha, sourceTree: 'c'.repeat(40) });
makeRelease(invalidSha, 'e'.repeat(40), null);
NODE

export CRM_NATIVE_RELEASE_BASE="$tmp_root/releases"
export CRM_NATIVE_CURRENT_LINK="$tmp_root/current/crm-service"
export CRM_NATIVE_PREVIOUS_LINK="$tmp_root/current/crm-service.previous"

dry_output="$(bash "$PREPARE" --target test --release-sha "$release_a" --candidate-root "$tmp_root/candidate-$release_a")"
grep -Fx 'dry_run=true' <<<"$dry_output" >/dev/null
grep -Fx 'service_restart=false' <<<"$dry_output" >/dev/null
[[ ! -e "$CRM_NATIVE_CURRENT_LINK" && ! -L "$CRM_NATIVE_CURRENT_LINK" ]]

if staging_apply_output="$(env -u CRM_NATIVE_RELEASE_BASE -u CRM_NATIVE_CURRENT_LINK -u CRM_NATIVE_PREVIOUS_LINK \
  bash "$PREPARE" --target staging --release-sha "$release_a" --candidate-root "$tmp_root/not-opened" --apply 2>&1)"; then
  echo 'Staging apply unexpectedly bypassed the custody gate.' >&2
  exit 1
fi
grep -F 'external authenticated custody bootstrap is not installed' <<<"$staging_apply_output" >/dev/null

if test_apply_output="$(bash "$PREPARE" --target test --release-sha "$release_a" --candidate-root "$tmp_root/not-opened" --apply 2>&1)"; then
  echo 'Test apply unexpectedly bypassed the explicit test harness guard.' >&2
  exit 1
fi
grep -F 'explicitly enabled isolated test harness' <<<"$test_apply_output" >/dev/null

linked_root="$(mktemp -d -t skincos-crm-native-test-XXXXXXXX)"
mkdir -p "$linked_root/redirected-release-base"
ln -s -- "$linked_root/redirected-release-base" "$linked_root/releases"
if linked_apply_output="$(CRM_NATIVE_RELEASE_BASE="$linked_root/releases" \
  CRM_NATIVE_CURRENT_LINK="$linked_root/current/crm-service" \
  CRM_NATIVE_PREVIOUS_LINK="$linked_root/current/crm-service.previous" \
  CRM_NATIVE_PUBLISHER_TEST_MODE=1 \
  bash "$PREPARE" --target test --release-sha "$release_a" --candidate-root "$tmp_root/candidate-$release_a" --apply 2>&1)"; then
  echo 'Test apply unexpectedly accepted a symbolic-link release base.' >&2
  exit 1
fi
grep -F 'must not use symbolic links' <<<"$linked_apply_output" >/dev/null
rm -rf -- "$linked_root"
linked_root=''

CRM_NATIVE_PUBLISHER_TEST_MODE=1 bash "$PREPARE" \
  --target test --release-sha "$release_a" --candidate-root "$tmp_root/candidate-$release_a" --apply >/dev/null
[[ "$(node "$CONTRACT" pointer-release-sha --release-base "$CRM_NATIVE_RELEASE_BASE" --link "$CRM_NATIVE_CURRENT_LINK")" == "$release_a" ]]
[[ ! -e "$CRM_NATIVE_PREVIOUS_LINK" && ! -L "$CRM_NATIVE_PREVIOUS_LINK" ]]

if invalid_successor_output="$(CRM_NATIVE_PUBLISHER_TEST_MODE=1 bash "$PREPARE" \
  --target test --release-sha "$release_c" --candidate-root "$tmp_root/candidate-$release_c" --apply 2>&1)"; then
  echo 'A CRM candidate with no bound predecessor unexpectedly passed.' >&2
  exit 1
fi
grep -F 'predecessor does not bind the active immutable release' <<<"$invalid_successor_output" >/dev/null
[[ ! -e "$CRM_NATIVE_RELEASE_BASE/$release_c/crm-service" && ! -L "$CRM_NATIVE_RELEASE_BASE/$release_c/crm-service" ]]

CRM_NATIVE_PUBLISHER_TEST_MODE=1 bash "$PREPARE" \
  --target test --release-sha "$release_b" --candidate-root "$tmp_root/candidate-$release_b" --apply >/dev/null
[[ "$(node "$CONTRACT" pointer-release-sha --release-base "$CRM_NATIVE_RELEASE_BASE" --link "$CRM_NATIVE_CURRENT_LINK")" == "$release_b" ]]
[[ "$(node "$CONTRACT" pointer-release-sha --release-base "$CRM_NATIVE_RELEASE_BASE" --link "$CRM_NATIVE_PREVIOUS_LINK")" == "$release_a" ]]

rollback_dry_output="$(bash "$ROLLBACK" --target test --to-release-sha "$release_a")"
grep -Fx 'dry_run=true' <<<"$rollback_dry_output" >/dev/null
grep -Fx 'service_restart=false' <<<"$rollback_dry_output" >/dev/null
CRM_NATIVE_PUBLISHER_TEST_MODE=1 bash "$ROLLBACK" \
  --target test --to-release-sha "$release_a" --apply >/dev/null
[[ "$(node "$CONTRACT" pointer-release-sha --release-base "$CRM_NATIVE_RELEASE_BASE" --link "$CRM_NATIVE_CURRENT_LINK")" == "$release_a" ]]
[[ "$(node "$CONTRACT" pointer-release-sha --release-base "$CRM_NATIVE_RELEASE_BASE" --link "$CRM_NATIVE_PREVIOUS_LINK")" == "$release_b" ]]

malicious="$tmp_root/candidate-malicious"
cp -a -- "$tmp_root/candidate-$release_a" "$malicious"
ln -s -- /etc/passwd "$malicious/untrusted-link"
if node "$CONTRACT" validate-release --release-root "$malicious" --release-sha "$release_a" --target test >/dev/null 2>&1; then
  echo 'A candidate with a symbolic link unexpectedly passed validation.' >&2
  exit 1
fi

node "$CONTRACT" validate-layout \
  --target production \
  --release-base /opt/skincos/releases \
  --current-link /opt/skincos/current/crm-service \
  --previous-link /opt/skincos/current/crm-service.previous >/dev/null

if node "$CONTRACT" validate-layout \
  --target production \
  --release-base /opt/skincos/releases \
  --current-link /opt/skincos/current/source \
  --previous-link /opt/skincos/current/crm-service.previous >/dev/null 2>&1; then
  echo 'Production layout unexpectedly accepted the shared source pointer.' >&2
  exit 1
fi

echo 'CRM native publisher source contract checks passed'
