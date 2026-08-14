#!/usr/bin/env bash
set -euo pipefail

# Installs the dedicated native GitHub Actions runner and its narrow custody
# helper. Registration is a one-time bootstrap; routine custody writes happen
# only through the dispatch-only workflow on main.

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly RUNNER_ROOT='/var/lib/skincos-runtime/github-actions-runner'
readonly RUNNER_USER='skincos-actions'
readonly UNIT_NAME='skincos-native-custody-runner.service'
readonly CUSTODY_HELPER='/usr/local/sbin/skincos-provision-global-coordination'
readonly META_ADS_CUSTODY_HELPER='/usr/local/sbin/skincos-meta-ads-tracking-custody'
readonly META_ADS_HELPER_LIB='/usr/local/lib/skincos'
readonly META_ADS_ATTESTATION_HELPER="$META_ADS_HELPER_LIB/meta-ads-tracking-custody-attestation.mjs"
readonly SUDOERS_FILE='/etc/sudoers.d/skincos-native-custody'
readonly CUSTODY_DIR='/etc/skincos/global-coordination'
readonly META_ADS_CHECKPOINT_DIR='/var/lib/skincos-runtime/orb/exports/workflow-patches'
readonly META_ADS_MAINTENANCE_DIR='/var/lib/skincos-runtime/orb/state/livia-maintenance'
readonly META_ADS_COORDINATION_PROOF_DIR='/var/lib/skincos-runtime/global-coordination'
readonly META_ADS_FALLBACK_PROOF_DIR='/var/lib/skincos-runtime/orb/global-coordination'
readonly META_ADS_APPROVAL_DIR="$META_ADS_COORDINATION_PROOF_DIR/meta-ads-tracking-approvals"
readonly META_ADS_FENCE_UNIT='orb-restart-fence.service'

REPOSITORY=''
RUNNER_VERSION=''
RUNNER_SHA256=''
RUNNER_TOKEN=''
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-native-custody-runner.sh \
  --repository <owner/name> --runner-version <version> --runner-sha256 <sha256> \
  [--apply]

Reads one GitHub Actions runner registration token from stdin. The token is
used only during the one-time upstream config.sh registration. It is not
written to a file or printed; config.sh necessarily receives it as a
short-lived local process argument. Without --apply, validates the runner
package contract and the local custody helper.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repository) REPOSITORY="${2:-}"; shift ;;
    --runner-version) RUNNER_VERSION="${2:-}"; shift ;;
    --runner-sha256) RUNNER_SHA256="${2:-}"; shift ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'repository must be owner/name' >&2; exit 78; }
[[ "$RUNNER_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'runner version must be a semantic version' >&2; exit 78; }
[[ "$RUNNER_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]] || { echo 'runner SHA-256 is invalid' >&2; exit 78; }
[[ -f "$ROOT_DIR/scripts/runtime/provision-global-coordination-custody.sh" ]] || { echo 'custody helper source is missing' >&2; exit 78; }
[[ -f "$ROOT_DIR/scripts/runtime/meta-ads-tracking-custody.sh" ]] || { echo 'Meta Ads custody helper source is missing' >&2; exit 78; }
[[ -f "$ROOT_DIR/scripts/runtime/meta-ads-tracking-custody-attestation.mjs" ]] || { echo 'Meta Ads OIDC attestation source is missing' >&2; exit 78; }
[[ -f "$ROOT_DIR/ops/runtime/units/$UNIT_NAME" ]] || { echo 'runner systemd unit is missing' >&2; exit 78; }
[[ -f "$ROOT_DIR/ops/runtime/units/$META_ADS_FENCE_UNIT" ]] || { echo 'Meta Ads restart fence unit is missing' >&2; exit 78; }
[[ -f "$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers" ]] || { echo 'runner sudoers contract is missing' >&2; exit 78; }
bash -n "$ROOT_DIR/scripts/runtime/provision-global-coordination-custody.sh"
bash -n "$ROOT_DIR/scripts/runtime/meta-ads-tracking-custody.sh"
node --check "$ROOT_DIR/scripts/runtime/meta-ads-tracking-custody-attestation.mjs"

if [[ "$APPLY" != '1' ]]; then
  printf 'native_custody_runner_contract=valid repository=%s version=%s\n' "$REPOSITORY" "$RUNNER_VERSION"
  exit 0
fi

[[ "$(id -u)" == '0' ]] || { echo '--apply requires root' >&2; exit 78; }

command -v curl >/dev/null 2>&1 || { echo 'curl is required' >&2; exit 78; }
command -v tar >/dev/null 2>&1 || { echo 'tar is required' >&2; exit 78; }
command -v sha256sum >/dev/null 2>&1 || { echo 'sha256sum is required' >&2; exit 78; }
command -v systemctl >/dev/null 2>&1 || { echo 'systemctl is required' >&2; exit 78; }
command -v visudo >/dev/null 2>&1 || { echo 'visudo is required' >&2; exit 78; }
command -v node >/dev/null 2>&1 || { echo 'node is required' >&2; exit 78; }

if ! id "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$RUNNER_ROOT" --create-home --shell /usr/sbin/nologin "$RUNNER_USER"
fi
usermod --shell /usr/sbin/nologin "$RUNNER_USER"
install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0750 "$RUNNER_ROOT"

install -o root -g root -m 0755 \
  "$ROOT_DIR/scripts/runtime/provision-global-coordination-custody.sh" "$CUSTODY_HELPER"
install -o root -g root -m 0755 \
  "$ROOT_DIR/scripts/runtime/meta-ads-tracking-custody.sh" "$META_ADS_CUSTODY_HELPER"
install -d -o root -g root -m 0755 "$META_ADS_HELPER_LIB"
install -o root -g root -m 0755 \
  "$ROOT_DIR/scripts/runtime/meta-ads-tracking-custody-attestation.mjs" "$META_ADS_ATTESTATION_HELPER"
install -o root -g root -m 0440 \
  "$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers" "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null
# ProtectSystem=strict requires every writable path to exist before systemd
# creates its mount namespace. Create only the empty private directory here;
# the custody file and its secret remain workflow-owned and are written later
# by the fixed helper.
install -d -o root -g admin -m 0750 "$CUSTODY_DIR"
# The Meta Ads helper needs exactly these private write locations inside the
# runner's ProtectSystem=strict namespace.  The unprivileged runner account
# still cannot access any of them through their POSIX ownership and mode.
install -d -o postgres -g postgres -m 0750 "$META_ADS_CHECKPOINT_DIR"
install -d -o skincos -g skincos -m 0750 "$META_ADS_MAINTENANCE_DIR"
install -d -o root -g admin -m 0750 "$META_ADS_COORDINATION_PROOF_DIR"
install -d -o root -g admin -m 0750 "$META_ADS_FALLBACK_PROOF_DIR"
# The OIDC approval records are distinct from the lease proofs and writable
# only by root.  They remain under an existing exact systemd mount exception;
# no broad /var/lib or /opt write access is introduced for the runner.
install -d -o root -g root -m 0700 "$META_ADS_APPROVAL_DIR"
[[ -d /opt/skincos/current && ! -L /opt/skincos/current ]] || { echo 'native source pointer directory is unavailable' >&2; exit 78; }
install -o root -g root -m 0644 \
  "$ROOT_DIR/ops/runtime/units/$META_ADS_FENCE_UNIT" "/etc/systemd/system/$META_ADS_FENCE_UNIT"

if [[ ! -f "$RUNNER_ROOT/.runner" ]]; then
  IFS= read -r RUNNER_TOKEN || { echo 'runner registration token is missing' >&2; exit 78; }
  [[ -n "$RUNNER_TOKEN" && "$RUNNER_TOKEN" != *$'\r'* && "$RUNNER_TOKEN" != *$'\n'* ]] || { echo 'runner registration token is invalid' >&2; exit 78; }
  readonly archive="/var/tmp/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  readonly download_url="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "$download_url" -o "$archive"
  actual_sha256="$(sha256sum "$archive" | awk '{print $1}')"
  [[ "${actual_sha256,,}" == "${RUNNER_SHA256,,}" ]] || { rm -f -- "$archive"; echo 'GitHub Actions runner checksum mismatch' >&2; exit 78; }
  tar -xzf "$archive" -C "$RUNNER_ROOT"
  rm -f -- "$archive"
  chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_ROOT"
  config_log="$(mktemp /var/tmp/skincos-native-custody-config.XXXXXX)"
  chmod 0600 "$config_log"
  if ! runuser -u "$RUNNER_USER" -- env HOME="$RUNNER_ROOT" RUNNER_ALLOW_RUNASROOT=0 \
      "$RUNNER_ROOT/config.sh" --unattended --replace --url "https://github.com/$REPOSITORY" \
      --token "$RUNNER_TOKEN" --name 'skincos-native-custody' \
      --labels 'skincos-native-custody,Linux,X64' --work '_work' >"$config_log" 2>&1; then
    rm -f -- "$config_log"
    echo 'GitHub Actions runner registration failed; no token output was retained.' >&2
    exit 78
  fi
  rm -f -- "$config_log"
else
  unset RUNNER_TOKEN
fi
unset RUNNER_TOKEN
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_ROOT"
install -o root -g root -m 0644 \
  "$ROOT_DIR/ops/runtime/units/$UNIT_NAME" "/etc/systemd/system/$UNIT_NAME"
systemctl daemon-reload
systemctl enable "$UNIT_NAME" >/dev/null
# Restart explicitly so an already active runner adopts the new sandbox and
# writable-path contract instead of retaining its previous mount namespace.
systemctl restart "$UNIT_NAME"
systemctl is-active --quiet "$UNIT_NAME" || { echo 'native custody runner service is not active' >&2; exit 78; }
printf 'native_custody_runner=active label=skincos-native-custody user=%s\n' "$RUNNER_USER"
