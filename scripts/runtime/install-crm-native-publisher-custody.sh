#!/usr/bin/env bash
set -euo pipefail

# Root bootstrap for the dedicated CRM native publisher. This installer is
# intentionally separate from the generic lifecycle installer: it never
# renders crm.service, changes a CRM pointer, or restarts crm.service.

unset BASH_ENV ENV CDPATH
export PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly INSTALLER_SOURCE="$ROOT_DIR/scripts/runtime/install-crm-native-publisher-custody.sh"
readonly INVOKED_INSTALLER="${BASH_SOURCE[0]}"
readonly LIB_ROOT='/usr/local/lib/skincos-crm-native-publisher'
readonly HELPER='/usr/local/sbin/skincos-publish-crm-native-release'
readonly SUDOERS_FILE='/etc/sudoers.d/skincos-native-custody'
readonly POLICY_DIR='/etc/skincos/crm-native-publisher'
readonly STATE_DIR='/var/lib/skincos-runtime/crm-native-publisher'
readonly RUNNER_UNIT='skincos-native-custody-runner.service'
readonly FINDMNT='/usr/bin/findmnt'

apply=0
verify_apply_source=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-crm-native-publisher-custody.sh [--apply|--verify-apply-source]

Without --apply, validates the non-secret CRM native publisher bootstrap.
With --apply, root installs only the fixed custody helper, its non-secret
libraries, sudoers contract and runner mount-namespace update. It does not
install a policy, read credentials, change crm.service, change either CRM
pointer, or publish a release.

--verify-apply-source performs only the immutable-source preflight used by
--apply. It never changes the host.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) apply=1 ;;
    --verify-apply-source) verify_apply_source=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

sources=(
  "$ROOT_DIR/scripts/runtime/crm-native-publisher-custody.mjs"
  "$ROOT_DIR/scripts/runtime/crm-native-publisher-claims.mjs"
  "$ROOT_DIR/scripts/runtime/crm-native-source-bundle.mjs"
  "$ROOT_DIR/scripts/runtime/crm-native-release-contract.mjs"
  "$ROOT_DIR/scripts/codex-global-coordination-client.mjs"
  "$ROOT_DIR/ops/governance/global-coordination-core.mjs"
  "$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers"
  "$ROOT_DIR/ops/runtime/units/$RUNNER_UNIT"
)

source_failure() {
  printf 'CRM native publisher installer source is unsafe: %s\n' "$1" >&2
  exit 78
}

SOURCE_MOUNT_TARGET=''

source_stat() {
  /usr/bin/stat -c "$1" -- "$2"
}

source_mount_value() {
  local column="$1"
  local target="$2"
  local value
  [[ -x "$FINDMNT" ]] || source_failure 'findmnt is required for source mount provenance'
  value="$($FINDMNT --noheadings --raw --first-only --target "$target" --output "$column" 2>/dev/null)" \
    || source_failure "cannot resolve the source mount for $target"
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] \
    || source_failure "source mount $column is invalid for $target"
  printf '%s' "$value"
}

assert_trusted_source_mount() {
  local mount_target mount_type mount_root mount_source mount_options
  mount_target="$(source_mount_value TARGET "$ROOT_DIR")"
  mount_type="$(source_mount_value FSTYPE "$ROOT_DIR")"
  mount_root="$(source_mount_value FSROOT "$ROOT_DIR")"
  mount_source="$(source_mount_value SOURCE "$ROOT_DIR")"
  mount_options="$(source_mount_value OPTIONS "$ROOT_DIR")"
  [[ "$mount_target" == /* && "$mount_target" != '/mnt' && "$mount_target" != /mnt/* \
    && ( "$ROOT_DIR" == "$mount_target" || "$ROOT_DIR" == "$mount_target/"* ) ]] \
    || source_failure 'source mount target is not a native trusted path'
  case "$mount_type" in
    ext4|xfs|btrfs|zfs|f2fs) ;;
    *) source_failure "source mount filesystem is not trusted: $mount_type" ;;
  esac
  [[ "$mount_root" == '/' ]] || source_failure 'source mount has a non-root filesystem root or bind redirect'
  [[ ",$mount_options," != *',bind,'* && -n "$mount_source" && "$mount_source" != 'none' ]] \
    || source_failure 'source mount is a bind redirect or lacks a backing source'
  SOURCE_MOUNT_TARGET="$mount_target"
}

assert_path_uses_source_mount() {
  local path="$1"
  local label="$2"
  [[ "$(source_mount_value TARGET "$path")" == "$SOURCE_MOUNT_TARGET" ]] \
    || source_failure "$label crosses a source mount boundary: $path"
}

assert_trusted_source_directory() {
  local directory="$1"
  local label="$2"
  local uid gid mode

  [[ -d "$directory" && ! -L "$directory" ]] || source_failure "$label is not a real directory: $directory"
  uid="$(source_stat '%u' "$directory")"
  gid="$(source_stat '%g' "$directory")"
  mode="$(source_stat '%a' "$directory")"
  [[ "$uid" == '0' && "$gid" == '0' ]] || source_failure "$label is not root:root-owned: $directory"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || source_failure "$label mode is invalid: $directory"
  (( (8#$mode & 18) == 0 )) || source_failure "$label is group/world writable: $directory"
  assert_path_uses_source_mount "$directory" "$label"
}

assert_trusted_source_file() {
  local file="$1"
  local label="$2"
  local uid gid mode links

  [[ -f "$file" && ! -L "$file" ]] || source_failure "$label is not a regular non-symlink file: $file"
  uid="$(source_stat '%u' "$file")"
  gid="$(source_stat '%g' "$file")"
  mode="$(source_stat '%a' "$file")"
  links="$(source_stat '%h' "$file")"
  [[ "$uid" == '0' && "$gid" == '0' ]] || source_failure "$label is not root:root-owned: $file"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || source_failure "$label mode is invalid: $file"
  (( (8#$mode & 18) == 0 )) || source_failure "$label is group/world writable: $file"
  [[ "$links" == '1' ]] || source_failure "$label is hard-linked: $file"
  assert_path_uses_source_mount "$file" "$label"
}

assert_trusted_apply_sources() {
  local source parent

  [[ "$ROOT_DIR" != '/' ]] || source_failure 'source tree must not be the filesystem root'
  [[ ! -L "$INVOKED_INSTALLER" && "$INSTALLER_SOURCE" -ef "$INVOKED_INSTALLER" ]] \
    || source_failure 'installer entrypoint is not the canonical non-symlink source file'

  assert_trusted_source_mount
  # Check the checkout/release root first, then every physical ancestor down
  # to the approved mountpoint. A root-owned leaf below a caller-writable
  # parent can still be replaced after validation; an independent approved
  # mountpoint is the one safe boundary where parent-device equality stops.
  assert_trusted_source_directory "$ROOT_DIR" 'source tree'
  parent="$(dirname -- "$ROOT_DIR")"
  while :; do
    assert_trusted_source_directory "$parent" 'source tree ancestor'
    [[ "$parent" == "$SOURCE_MOUNT_TARGET" ]] && break
    parent="$(dirname -- "$parent")"
  done

  for source in "$INSTALLER_SOURCE" "${sources[@]}"; do
    [[ "$source" == "$ROOT_DIR/"* ]] || source_failure "source escapes the source tree: $source"
    parent="$(dirname -- "$source")"
    while [[ "$parent" != "$ROOT_DIR" ]]; do
      assert_trusted_source_directory "$parent" 'source directory'
      parent="$(dirname -- "$parent")"
    done
    assert_trusted_source_file "$source" 'source file'
  done
}

assert_private_install_directory() {
  local directory="$1"
  local label="$2"
  local uid gid mode
  if [[ -e "$directory" || -L "$directory" ]]; then
    [[ -d "$directory" && ! -L "$directory" ]] || { echo "$label is not a real directory: $directory" >&2; exit 78; }
  else
    /usr/bin/install -d -o root -g root -m 0755 "$directory"
  fi
  uid="$(/usr/bin/stat -c '%u' -- "$directory")"
  gid="$(/usr/bin/stat -c '%g' -- "$directory")"
  mode="$(/usr/bin/stat -c '%a' -- "$directory")"
  [[ "$uid" == '0' && "$gid" == '0' && "$mode" =~ ^[0-7]{3,4}$ && $((8#$mode & 18)) == 0 ]] \
    || { echo "$label is not root-owned and non-writable: $directory" >&2; exit 78; }
}

stage_apply_sources() {
  local stage="$1"
  node - "$ROOT_DIR" "$stage" "$INSTALLER_SOURCE" "${sources[@]}" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [rootArgument, stageArgument, ...sourceFiles] = process.argv.slice(2);
const root = path.resolve(rootArgument);
const stage = path.resolve(stageArgument);
const fail = (message) => { throw new Error(`installer source staging: ${message}`); };
const relativeToRoot = (file) => {
  const relative = path.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('source escapes source tree');
  return relative.split(path.sep).join('/');
};
const safeSourceStat = (stat, label) => {
  if (!stat.isFile() || stat.uid !== 0 || stat.gid !== 0 || (stat.mode & 0o022) !== 0 || stat.nlink !== 1) {
    fail(`${label} metadata is unsafe`);
  }
};
const stageStat = fs.lstatSync(stage);
if (!stageStat.isDirectory() || stageStat.isSymbolicLink() || stageStat.uid !== 0 || stageStat.gid !== 0 || (stageStat.mode & 0o777) !== 0o700) {
  fail('staging directory is unsafe');
}
const copied = [];
for (const source of sourceFiles) {
  const relative = relativeToRoot(source);
  const destination = path.join(stage, relative);
  if (path.relative(stage, destination).startsWith(`..${path.sep}`) || path.isAbsolute(path.relative(stage, destination))) fail('staging destination escapes root');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const input = fs.openSync(source, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let output = null;
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(128 * 1024);
  try {
    const before = fs.fstatSync(input);
    safeSourceStat(before, 'source file');
    output = fs.openSync(destination, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    let bytes = 0;
    for (;;) {
      const read = fs.readSync(input, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      let offset = 0;
      while (offset < read) offset += fs.writeSync(output, buffer, offset, read - offset);
      bytes += read;
    }
    const after = fs.fstatSync(input);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.uid !== before.uid || after.gid !== before.gid
      || after.mode !== before.mode || after.nlink !== before.nlink || bytes !== before.size) {
      fail('source file changed during no-follow copy');
    }
    fs.fsyncSync(output);
    fs.fchownSync(output, 0, 0);
    fs.fchmodSync(output, 0o600);
    copied.push({ path: relative, sha256: hash.digest('hex'), bytes });
  } finally {
    buffer.fill(0);
    if (output !== null) fs.closeSync(output);
    fs.closeSync(input);
  }
}
copied.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
const manifest = { schemaVersion: 1, files: copied };
const manifestFile = path.join(stage, '.crm-native-installer-source-manifest.json');
const descriptor = fs.openSync(manifestFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
try {
  fs.writeFileSync(descriptor, `${JSON.stringify(manifest)}\n`);
  fs.fsyncSync(descriptor);
  fs.fchownSync(descriptor, 0, 0);
  fs.fchmodSync(descriptor, 0o600);
} finally {
  fs.closeSync(descriptor);
}
NODE
}

assert_staged_apply_sources() {
  local stage="$1"
  node - "$stage" <<'NODE'
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const stage = path.resolve(process.argv[2]);
const fail = (message) => { throw new Error(`installer staged source: ${message}`); };
const manifestFile = path.join(stage, '.crm-native-installer-source-manifest.json');
const manifestStat = fs.lstatSync(manifestFile);
if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.uid !== 0 || manifestStat.gid !== 0 || (manifestStat.mode & 0o777) !== 0o600 || manifestStat.nlink !== 1) {
  fail('manifest is unsafe');
}
let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); }
catch { fail('manifest is invalid'); }
if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length < 1) fail('manifest shape is invalid');
let previous = null;
for (const entry of manifest.files) {
  if (!entry || typeof entry.path !== 'string' || !entry.path || entry.path.includes('\\') || entry.path.split('/').some((part) => !part || part === '.' || part === '..')
    || !/^[0-9a-f]{64}$/.test(String(entry.sha256 || '')) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) {
    fail('manifest entry is invalid');
  }
  if (previous !== null && Buffer.compare(Buffer.from(previous), Buffer.from(entry.path)) >= 0) fail('manifest entries are not ordered');
  previous = entry.path;
  const file = path.resolve(stage, entry.path);
  if (!file.startsWith(`${stage}${path.sep}`)) fail('manifest entry escapes staging root');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  const buffer = Buffer.allocUnsafe(128 * 1024);
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.uid !== 0 || before.gid !== 0 || (before.mode & 0o777) !== 0o600 || before.nlink !== 1) fail('staged source file is unsafe');
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    for (;;) {
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      bytes += read;
    }
    const after = fs.fstatSync(descriptor);
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.nlink !== before.nlink
      || bytes !== entry.bytes || hash.digest('hex') !== entry.sha256) fail('staged source digest differs');
  } finally {
    buffer.fill(0);
    fs.closeSync(descriptor);
  }
}
NODE
}

staged_source_path() {
  local stage="$1"
  local source="$2"
  local relative="${source#"$ROOT_DIR"/}"
  [[ "$relative" != "$source" ]] || { echo "Staged source escapes source tree: $source" >&2; exit 78; }
  printf '%s/%s' "$stage" "$relative"
}

[[ "$apply" != '1' || "$verify_apply_source" != '1' ]] || {
  echo '--apply and --verify-apply-source cannot be combined' >&2
  exit 64
}

for source in "${sources[@]}"; do
  [[ -f "$source" ]] || { echo "Required source is missing: $source" >&2; exit 78; }
done

if [[ "$apply" == '1' || "$verify_apply_source" == '1' ]]; then
  assert_trusted_apply_sources
  if [[ "$verify_apply_source" == '1' ]]; then
    printf 'crm_native_publisher_custody_apply_source=valid\n'
    exit 0
  fi
fi

for binary in node tar timeout systemctl systemd-analyze visudo curl getcap stat findmnt install mktemp; do
  command -v "$binary" >/dev/null 2>&1 || { echo "Required binary is missing: $binary" >&2; exit 78; }
done

if [[ "$apply" != '1' ]]; then
  node --check "$ROOT_DIR/scripts/runtime/crm-native-publisher-custody.mjs"
  node --check "$ROOT_DIR/scripts/runtime/crm-native-publisher-claims.mjs"
  node --check "$ROOT_DIR/scripts/runtime/crm-native-source-bundle.mjs"
  node --check "$ROOT_DIR/scripts/runtime/crm-native-release-contract.mjs"
  visudo -cf "$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers" >/dev/null
  printf 'crm_native_publisher_custody_contract=valid\n'
  exit 0
fi

[[ "$(id -u)" == '0' ]] || { echo '--apply requires root' >&2; exit 78; }
systemctl cat "$RUNNER_UNIT" >/dev/null 2>&1 || { echo "${RUNNER_UNIT} must be installed before CRM custody bootstrap" >&2; exit 78; }
[[ -x /usr/sbin/getcap ]] || { echo '/usr/sbin/getcap is required by the CRM custody helper' >&2; exit 78; }
for system_directory in /opt/skincos/releases /opt/skincos/current /etc/systemd/system; do
  [[ -d "$system_directory" && ! -L "$system_directory" ]] || { echo "Required CRM custody directory is unavailable: $system_directory" >&2; exit 78; }
  [[ "$(stat -c '%u' "$system_directory")" == '0' ]] || { echo "Required CRM custody directory is not root-owned: $system_directory" >&2; exit 78; }
  mode="$(stat -c '%a' "$system_directory")"
  (( (8#$mode & 18) == 0 )) || { echo "Required CRM custody directory is group/world writable: $system_directory" >&2; exit 78; }
done

assert_private_install_directory "$LIB_ROOT" 'CRM native publisher library root'
stage_dir="$(mktemp -d "$LIB_ROOT/.installer-source.XXXXXXXX")"
[[ "$stage_dir" == "$LIB_ROOT"/.installer-source.* ]] || { echo 'CRM native publisher source staging path is invalid' >&2; exit 78; }
chown root:root "$stage_dir"
chmod 0700 "$stage_dir"
cleanup_source_stage() { rm -rf -- "$stage_dir"; }
trap cleanup_source_stage EXIT INT TERM
stage_apply_sources "$stage_dir"
node --check "$(staged_source_path "$stage_dir" "$ROOT_DIR/scripts/runtime/crm-native-publisher-custody.mjs")"
node --check "$(staged_source_path "$stage_dir" "$ROOT_DIR/scripts/runtime/crm-native-publisher-claims.mjs")"
node --check "$(staged_source_path "$stage_dir" "$ROOT_DIR/scripts/runtime/crm-native-source-bundle.mjs")"
node --check "$(staged_source_path "$stage_dir" "$ROOT_DIR/scripts/runtime/crm-native-release-contract.mjs")"
visudo -cf "$(staged_source_path "$stage_dir" "$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers")" >/dev/null
assert_staged_apply_sources "$stage_dir"

assert_private_install_directory "$LIB_ROOT/scripts" 'CRM native publisher script library'
assert_private_install_directory "$LIB_ROOT/scripts/runtime" 'CRM native publisher runtime library'
assert_private_install_directory "$LIB_ROOT/ops" 'CRM native publisher operations library'
assert_private_install_directory "$LIB_ROOT/ops/governance" 'CRM native publisher governance library'
install -o root -g root -m 0644 "$(staged_source_path "$stage_dir" "$ROOT_DIR/scripts/runtime/crm-native-publisher-custody.mjs")" "$LIB_ROOT/scripts/runtime/crm-native-publisher-custody.mjs"
install -o root -g root -m 0644 "$(staged_source_path "$stage_dir" "$ROOT_DIR/scripts/runtime/crm-native-publisher-claims.mjs")" "$LIB_ROOT/scripts/runtime/crm-native-publisher-claims.mjs"
install -o root -g root -m 0644 "$(staged_source_path "$stage_dir" "$ROOT_DIR/scripts/runtime/crm-native-source-bundle.mjs")" "$LIB_ROOT/scripts/runtime/crm-native-source-bundle.mjs"
install -o root -g root -m 0644 "$(staged_source_path "$stage_dir" "$ROOT_DIR/scripts/runtime/crm-native-release-contract.mjs")" "$LIB_ROOT/scripts/runtime/crm-native-release-contract.mjs"
install -o root -g root -m 0644 "$(staged_source_path "$stage_dir" "$ROOT_DIR/scripts/codex-global-coordination-client.mjs")" "$LIB_ROOT/scripts/codex-global-coordination-client.mjs"
install -o root -g root -m 0644 "$(staged_source_path "$stage_dir" "$ROOT_DIR/ops/governance/global-coordination-core.mjs")" "$LIB_ROOT/ops/governance/global-coordination-core.mjs"

wrapper="$(mktemp /var/tmp/skincos-publish-crm-native-release.XXXXXX)"
cleanup_wrapper_and_stage() { rm -f -- "$wrapper"; cleanup_source_stage; }
trap cleanup_wrapper_and_stage EXIT INT TERM
cat >"$wrapper" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  bootstrap|preflight|publish|rollback-last)
    [[ $# == 1 ]] || { echo 'CRM native publisher accepts exactly one fixed command' >&2; exit 64; }
    ;;
  *)
    echo 'CRM native publisher command is invalid' >&2
    exit 64
    ;;
esac
exec /usr/bin/env -i \
  HOME=/root \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  /usr/bin/timeout --signal=KILL 900s \
  /usr/bin/node /usr/local/lib/skincos-crm-native-publisher/scripts/runtime/crm-native-publisher-custody.mjs "$1"
EOF
chmod 0755 "$wrapper"
install -o root -g root -m 0755 "$wrapper" "$HELPER"
rm -f -- "$wrapper"
trap cleanup_source_stage EXIT INT TERM

install -d -o root -g root -m 0700 "$POLICY_DIR" "$STATE_DIR"
install -o root -g root -m 0440 "$(staged_source_path "$stage_dir" "$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers")" "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

# A sudo child inherits its runner service mount namespace. Update that unit
# before any publish command so the fixed helper can reach only its explicit
# transaction paths; restart the runner, never crm.service.
install -o root -g root -m 0644 "$(staged_source_path "$stage_dir" "$ROOT_DIR/ops/runtime/units/$RUNNER_UNIT")" "/etc/systemd/system/$RUNNER_UNIT"
cleanup_source_stage
trap - EXIT INT TERM
systemctl daemon-reload
systemctl restart "$RUNNER_UNIT"
systemctl is-active --quiet "$RUNNER_UNIT" || { echo 'native custody runner is not active after bootstrap' >&2; exit 78; }
printf 'crm_native_publisher_custody=installed policy=absent crm_service=unchanged\n'
