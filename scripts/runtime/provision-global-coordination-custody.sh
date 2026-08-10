#!/usr/bin/env bash
set -euo pipefail

# This helper is installed root-owned outside the checkout by
# install-native-custody-runner.sh. It is intentionally tiny: the GitHub
# runner can provide only two values through stdin and cannot select a path,
# invoke a shell, or change any other runtime configuration.

readonly TARGET_DIR='/etc/skincos/global-coordination'
readonly TARGET_FILE="$TARGET_DIR/orb-backup.env"
readonly TARGET_GROUP='admin'
readonly COMMAND="${1:-}"

fail() {
  echo "native coordination custody: $1" >&2
  exit 78
}

validate_url() {
  local value="$1"
  [[ "$value" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/v1/leases)?$ ]] || fail 'coordinator URL must be a plain HTTPS coordinator endpoint'
}

validate_secret() {
  local value="$1"
  [[ ${#value} -ge 32 ]] || fail 'coordination secret is too short'
  # Bash variables cannot carry NUL bytes; reject the line-breaking controls
  # that could change the two-line custody format.
  [[ "$value" != *$'\r'* && "$value" != *$'\n'* ]] || fail 'coordination secret contains a line-breaking control character'
}

read_contract() {
  local url='' secret='' extra=''
  IFS= read -r url || fail 'coordination URL is missing'
  IFS= read -r secret || fail 'coordination secret is missing'
  if IFS= read -r extra; then
    [[ -z "$extra" ]] || fail 'custody input must contain exactly two non-empty lines'
  fi
  [[ -n "$url" && -n "$secret" ]] || fail 'custody input contains an empty value'
  validate_url "$url"
  validate_secret "$secret"
  COORDINATOR_URL="$url"
  COORDINATION_SECRET="$secret"
}

audit_target() {
  [[ -f "$TARGET_FILE" ]] || fail 'coordination custody file is absent'
  local mode owner group
  mode="$(stat -c '%a' "$TARGET_FILE")"
  owner="$(stat -c '%U' "$TARGET_FILE")"
  group="$(stat -c '%G' "$TARGET_FILE")"
  [[ "$mode" == '640' && "$owner" == 'root' && "$group" == "$TARGET_GROUP" ]] || fail 'coordination custody file metadata is invalid'
  grep -q '^SKINCOS_GLOBAL_COORDINATOR_URL=' "$TARGET_FILE" || fail 'coordination URL record is absent'
  grep -q '^SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET=' "$TARGET_FILE" || fail 'coordination secret record is absent'
  [[ "$(grep -Ec '^(SKINCOS_GLOBAL_COORDINATOR_URL|SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET)=' "$TARGET_FILE")" == '2' ]] || fail 'coordination custody contains unsupported records'
  printf 'custody=present mode=%s owner=%s group=%s records=2\n' "$mode" "$owner" "$group"
}

case "$COMMAND" in
  validate)
    umask 077
    read_contract
    printf 'custody_input=valid\n'
    ;;
  write)
    [[ "$(id -u)" == '0' ]] || fail 'write requires root'
    umask 077
    read_contract
    install -d -o root -g "$TARGET_GROUP" -m 0750 "$TARGET_DIR"
    temporary="$(mktemp "$TARGET_DIR/.orb-backup.env.tmp.XXXXXX")"
    cleanup() { rm -f -- "$temporary"; }
    trap cleanup EXIT INT TERM
    printf 'SKINCOS_GLOBAL_COORDINATOR_URL=%s\nSKINCOS_GLOBAL_COORDINATION_SHARED_SECRET=%s\n' \
      "$COORDINATOR_URL" "$COORDINATION_SECRET" > "$temporary"
    chown root:"$TARGET_GROUP" "$temporary"
    chmod 0640 "$temporary"
    mv -f -- "$temporary" "$TARGET_FILE"
    trap - EXIT INT TERM
    printf 'custody=written mode=640 owner=root group=%s records=2\n' "$TARGET_GROUP"
    ;;
  audit)
    [[ "$(id -u)" == '0' ]] || fail 'audit requires root'
    audit_target
    ;;
  *)
    echo 'Usage: provision-global-coordination-custody.sh validate|write|audit' >&2
    exit 64
    ;;
esac
