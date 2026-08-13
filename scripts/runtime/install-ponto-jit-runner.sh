#!/usr/bin/env bash
set -euo pipefail

# Installs a persistent, single-purpose runner. Credentials, not the runner
# registration, are one-shot: the pre/post hooks enforce an encrypted bundle
# per governed Ponto journey and erase it through a fixed root helper.

readonly ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
readonly RUNNER_ROOT='/var/lib/skincos/ponto-jit-runner'
readonly CREDENTIAL_DIR='/var/lib/skincos/ponto-jit'
readonly RUNTIME_DIR='/etc/skincos/ponto-jit'
readonly RUNNER_USER='skincos-ponto-jit'
readonly UNIT_NAME='skincos-ponto-jit-runner.service'
readonly CLEANUP_SERVICE='skincos-ponto-jit-credential-cleanup.service'
readonly CLEANUP_TIMER='skincos-ponto-jit-credential-cleanup.timer'
readonly HELPER='/usr/local/sbin/skincos-provision-ponto-jit'
readonly HELPER_LIB='/usr/local/lib/skincos'
readonly SUDOERS_FILE='/etc/sudoers.d/skincos-native-custody'

REPOSITORY=''
RUNNER_VERSION=''
RUNNER_SHA256=''
RUNNER_NAME=''
RUNNER_LABEL=''
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/runtime/install-ponto-jit-runner.sh \
  --repository <owner/name> --runner-version <version> --runner-sha256 <sha256> \
  --runner-name <ponto-jit-name> --runner-label <matching-label> [--apply]

Reads a single GitHub registration token from stdin only when --apply creates a
new runner configuration. The token is passed directly to the upstream
config.sh process and is neither stored nor printed. This installer configures
the service but intentionally does not start it; the root custody bootstrap
arms its private manifest before the service can accept a job.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repository) REPOSITORY="${2:-}"; shift ;;
    --runner-version) RUNNER_VERSION="${2:-}"; shift ;;
    --runner-sha256) RUNNER_SHA256="${2:-}"; shift ;;
    --runner-name) RUNNER_NAME="${2:-}"; shift ;;
    --runner-label) RUNNER_LABEL="${2:-}"; shift ;;
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
  esac
  shift
done

[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'repository must be owner/name' >&2; exit 78; }
[[ "$RUNNER_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'runner version must be semantic' >&2; exit 78; }
[[ "$RUNNER_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]] || { echo 'runner SHA-256 is invalid' >&2; exit 78; }
[[ "$RUNNER_NAME" =~ ^ponto-jit-[a-z0-9][a-z0-9-]{15,63}$ ]] || { echo 'runner name is invalid' >&2; exit 78; }
[[ "$RUNNER_LABEL" == "$RUNNER_NAME" ]] || { echo 'runner label must exactly match runner name' >&2; exit 78; }
for source in \
  "$ROOT_DIR/scripts/runtime/ponto-jit-claims.mjs" \
  "$ROOT_DIR/scripts/runtime/ponto-jit-custody.mjs" \
  "$ROOT_DIR/scripts/runtime/provision-ponto-jit-custody.sh" \
  "$ROOT_DIR/ops/runtime/github-actions-runner/ponto-jit-before-job.sh" \
  "$ROOT_DIR/ops/runtime/github-actions-runner/ponto-jit-after-job.sh" \
  "$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers" \
  "$ROOT_DIR/ops/runtime/units/$UNIT_NAME" \
  "$ROOT_DIR/ops/runtime/units/$CLEANUP_SERVICE" \
  "$ROOT_DIR/ops/runtime/units/$CLEANUP_TIMER"; do
  [[ -f "$source" ]] || { echo "required runner source is missing: $source" >&2; exit 78; }
done
node --check "$ROOT_DIR/scripts/runtime/ponto-jit-claims.mjs"
node --check "$ROOT_DIR/scripts/runtime/ponto-jit-custody.mjs"
bash -n "$ROOT_DIR/scripts/runtime/provision-ponto-jit-custody.sh"
bash -n "$ROOT_DIR/ops/runtime/github-actions-runner/ponto-jit-before-job.sh"
bash -n "$ROOT_DIR/ops/runtime/github-actions-runner/ponto-jit-after-job.sh"

if [[ "$APPLY" != '1' ]]; then
  printf 'ponto_jit_runner_contract=valid repository=%s version=%s runner=%s\n' "$REPOSITORY" "$RUNNER_VERSION" "$RUNNER_NAME"
  exit 0
fi

[[ "$(id -u)" == '0' ]] || { echo '--apply requires root' >&2; exit 78; }
for command in curl tar sha256sum systemctl visudo node runuser; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required" >&2; exit 78; }
done

if ! id "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --system --user-group --home-dir "$RUNNER_ROOT" --create-home --shell /usr/sbin/nologin "$RUNNER_USER"
fi
usermod --shell /usr/sbin/nologin "$RUNNER_USER"
install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0750 "$RUNNER_ROOT"
install -d -o root -g root -m 0711 "$CREDENTIAL_DIR"
install -d -o root -g root -m 0700 "$RUNTIME_DIR"
install -d -o root -g root -m 0755 "$HELPER_LIB"

install -o root -g root -m 0644 "$ROOT_DIR/scripts/runtime/ponto-jit-claims.mjs" "$HELPER_LIB/ponto-jit-claims.mjs"
install -o root -g root -m 0755 "$ROOT_DIR/scripts/runtime/ponto-jit-custody.mjs" "$HELPER_LIB/ponto-jit-custody.mjs"
install -o root -g root -m 0755 "$ROOT_DIR/scripts/runtime/provision-ponto-jit-custody.sh" "$HELPER"
install -o root -g root -m 0755 "$ROOT_DIR/ops/runtime/github-actions-runner/ponto-jit-before-job.sh" "$HELPER_LIB/ponto-jit-before-job.sh"
install -o root -g root -m 0755 "$ROOT_DIR/ops/runtime/github-actions-runner/ponto-jit-after-job.sh" "$HELPER_LIB/ponto-jit-after-job.sh"
install -o root -g root -m 0440 "$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers" "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

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
  config_log="$(mktemp /var/tmp/skincos-ponto-jit-config.XXXXXX)"
  chmod 0600 "$config_log"
  if ! runuser -u "$RUNNER_USER" -- env HOME="$RUNNER_ROOT" RUNNER_ALLOW_RUNASROOT=0 \
      "$RUNNER_ROOT/config.sh" --unattended --replace --url "https://github.com/$REPOSITORY" \
      --token "$RUNNER_TOKEN" --name "$RUNNER_NAME" --labels "$RUNNER_LABEL" --work '_work' >"$config_log" 2>&1; then
    rm -f -- "$config_log"
    echo 'Ponto runner registration failed; no token output was retained.' >&2
    exit 78
  fi
  rm -f -- "$config_log"
else
  unset RUNNER_TOKEN
fi
unset RUNNER_TOKEN
chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_ROOT"
install -o root -g root -m 0644 /dev/stdin "$RUNNER_ROOT/.env" <<'EOF'
ACTIONS_RUNNER_HOOK_JOB_STARTED=/usr/local/lib/skincos/ponto-jit-before-job.sh
ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/usr/local/lib/skincos/ponto-jit-after-job.sh
EOF
install -o root -g root -m 0644 "$ROOT_DIR/ops/runtime/units/$UNIT_NAME" "/etc/systemd/system/$UNIT_NAME"
install -o root -g root -m 0644 "$ROOT_DIR/ops/runtime/units/$CLEANUP_SERVICE" "/etc/systemd/system/$CLEANUP_SERVICE"
install -o root -g root -m 0644 "$ROOT_DIR/ops/runtime/units/$CLEANUP_TIMER" "/etc/systemd/system/$CLEANUP_TIMER"
systemctl daemon-reload
systemctl enable --now "$CLEANUP_TIMER" >/dev/null
systemctl is-active --quiet "$CLEANUP_TIMER" || { echo 'Ponto JIT credential cleanup timer did not start' >&2; exit 78; }
systemctl enable "$UNIT_NAME" >/dev/null
systemctl is-active --quiet "$UNIT_NAME" && { echo 'Ponto JIT service must remain stopped until private custody is armed' >&2; exit 78; }
printf 'ponto_jit_runner=configured runner=%s user=%s service_started=false\n' "$RUNNER_NAME" "$RUNNER_USER"
