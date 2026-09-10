#!/usr/bin/env bash
set -euo pipefail

# Root bootstrap for the dedicated CRM native publisher. This installer is
# intentionally separate from the generic lifecycle installer: it never
# renders crm.service, changes a CRM pointer, or restarts crm.service.

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly LIB_ROOT='/usr/local/lib/skincos-crm-native-publisher'
readonly HELPER='/usr/local/sbin/skincos-publish-crm-native-release'
readonly SUDOERS_FILE='/etc/sudoers.d/skincos-native-custody'
readonly POLICY_DIR='/etc/skincos/crm-native-publisher'
readonly STATE_DIR='/var/lib/skincos-runtime/crm-native-publisher'
readonly RUNNER_UNIT='skincos-native-custody-runner.service'

apply=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-crm-native-publisher-custody.sh [--apply]

Without --apply, validates the non-secret CRM native publisher bootstrap.
With --apply, root installs only the fixed custody helper, its non-secret
libraries, sudoers contract and runner mount-namespace update. It does not
install a policy, read credentials, change crm.service, change either CRM
pointer, or publish a release.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) apply=1 ;;
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
for source in "${sources[@]}"; do
  [[ -f "$source" ]] || { echo "Required source is missing: $source" >&2; exit 78; }
done

for binary in node tar timeout systemctl systemd-analyze visudo curl getcap stat; do
  command -v "$binary" >/dev/null 2>&1 || { echo "Required binary is missing: $binary" >&2; exit 78; }
done
node --check "$ROOT_DIR/scripts/runtime/crm-native-publisher-custody.mjs"
node --check "$ROOT_DIR/scripts/runtime/crm-native-publisher-claims.mjs"
node --check "$ROOT_DIR/scripts/runtime/crm-native-source-bundle.mjs"
node --check "$ROOT_DIR/scripts/runtime/crm-native-release-contract.mjs"
visudo -cf "$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers" >/dev/null

if [[ "$apply" != '1' ]]; then
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

install -d -o root -g root -m 0755 "$LIB_ROOT/scripts/runtime" "$LIB_ROOT/ops/governance"
install -o root -g root -m 0644 "$ROOT_DIR/scripts/runtime/crm-native-publisher-custody.mjs" "$LIB_ROOT/scripts/runtime/crm-native-publisher-custody.mjs"
install -o root -g root -m 0644 "$ROOT_DIR/scripts/runtime/crm-native-publisher-claims.mjs" "$LIB_ROOT/scripts/runtime/crm-native-publisher-claims.mjs"
install -o root -g root -m 0644 "$ROOT_DIR/scripts/runtime/crm-native-source-bundle.mjs" "$LIB_ROOT/scripts/runtime/crm-native-source-bundle.mjs"
install -o root -g root -m 0644 "$ROOT_DIR/scripts/runtime/crm-native-release-contract.mjs" "$LIB_ROOT/scripts/runtime/crm-native-release-contract.mjs"
install -o root -g root -m 0644 "$ROOT_DIR/scripts/codex-global-coordination-client.mjs" "$LIB_ROOT/scripts/codex-global-coordination-client.mjs"
install -o root -g root -m 0644 "$ROOT_DIR/ops/governance/global-coordination-core.mjs" "$LIB_ROOT/ops/governance/global-coordination-core.mjs"

wrapper="$(mktemp /var/tmp/skincos-publish-crm-native-release.XXXXXX)"
cleanup() { rm -f -- "$wrapper"; }
trap cleanup EXIT INT TERM
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
trap - EXIT INT TERM
rm -f -- "$wrapper"

install -d -o root -g root -m 0700 "$POLICY_DIR" "$STATE_DIR"
install -o root -g root -m 0440 "$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers" "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

# A sudo child inherits its runner service mount namespace. Update that unit
# before any publish command so the fixed helper can reach only its explicit
# transaction paths; restart the runner, never crm.service.
install -o root -g root -m 0644 "$ROOT_DIR/ops/runtime/units/$RUNNER_UNIT" "/etc/systemd/system/$RUNNER_UNIT"
systemctl daemon-reload
systemctl restart "$RUNNER_UNIT"
systemctl is-active --quiet "$RUNNER_UNIT" || { echo 'native custody runner is not active after bootstrap' >&2; exit 78; }
printf 'crm_native_publisher_custody=installed policy=absent crm_service=unchanged\n'
