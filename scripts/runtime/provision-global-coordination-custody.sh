#!/usr/bin/env bash
set -euo pipefail

# This helper is installed root-owned outside the checkout by
# install-native-custody-runner.sh. It is intentionally tiny: the GitHub
# runner can provide only a bounded stdin contract and cannot select a path,
# invoke a shell, or change any other runtime configuration. The third input
# line is the public key id; an omitted third line remains compatible with the
# original legacy-v1 two-line contract.

readonly TARGET_DIR='/etc/skincos/global-coordination'
readonly TARGET_FILE="$TARGET_DIR/orb-backup.env"
readonly TARGET_GROUP='admin'
readonly COMMAND="${1:-}"
readonly LEGACY_KEY_ID='legacy-v1'

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
  # that could change the bounded custody format.
  [[ "$value" != *$'\r'* && "$value" != *$'\n'* ]] || fail 'coordination secret contains a line-breaking control character'
}

validate_key_id() {
  local value="$1"
  [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$ ]] || fail 'coordination key id is invalid'
}

read_contract() {
  local url='' secret='' key_id='' extra=''
  IFS= read -r url || fail 'coordination URL is missing'
  IFS= read -r secret || fail 'coordination secret is missing'
  if IFS= read -r key_id; then
    :
  else
    key_id="$LEGACY_KEY_ID"
  fi
  if IFS= read -r extra; then
    [[ -z "$extra" ]] || fail 'custody input contains unsupported extra records'
  fi
  [[ -n "$url" && -n "$secret" && -n "$key_id" ]] || fail 'custody input contains an empty value'
  validate_url "$url"
  validate_secret "$secret"
  validate_key_id "$key_id"
  COORDINATOR_URL="$url"
  COORDINATION_SECRET="$secret"
  COORDINATION_KEY_ID="$key_id"
}

audit_target() {
  [[ -f "$TARGET_FILE" ]] || fail 'coordination custody file is absent'
  local mode owner group key_id
  mode="$(stat -c '%a' "$TARGET_FILE")"
  owner="$(stat -c '%U' "$TARGET_FILE")"
  group="$(stat -c '%G' "$TARGET_FILE")"
  [[ "$mode" == '640' && "$owner" == 'root' && "$group" == "$TARGET_GROUP" ]] || fail 'coordination custody file metadata is invalid'
  grep -q '^SKINCOS_GLOBAL_COORDINATOR_URL=.' "$TARGET_FILE" || fail 'coordination URL record is absent'
  local key_mode='legacy' records=''
  if grep -q '^SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY=' "$TARGET_FILE"; then
    grep -q '^SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY=.' "$TARGET_FILE" || fail 'active coordination key record is empty'
    grep -q '^SKINCOS_GLOBAL_COORDINATION_KEY_ID=.' "$TARGET_FILE" || fail 'active coordination key id record is absent'
    grep -q '^SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET=' "$TARGET_FILE" && fail 'active custody must not retain the legacy secret record'
    key_id="$(sed -n 's/^SKINCOS_GLOBAL_COORDINATION_KEY_ID=//p' "$TARGET_FILE")"
    validate_key_id "$key_id"
    [[ "$key_id" != "$LEGACY_KEY_ID" ]] || fail 'active coordination custody cannot use the legacy key id'
    records="$(grep -Ec '^(SKINCOS_GLOBAL_COORDINATOR_URL|SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY|SKINCOS_GLOBAL_COORDINATION_KEY_ID)=' "$TARGET_FILE")"
    [[ "$records" == '3' ]] || fail 'active coordination custody contains unsupported records'
    key_mode='active'
  elif grep -q '^SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET=' "$TARGET_FILE"; then
    grep -q '^SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET=.' "$TARGET_FILE" || fail 'coordination secret record is empty'
    grep -q '^SKINCOS_GLOBAL_COORDINATION_KEY_ID=' "$TARGET_FILE" && fail 'legacy custody must not pin a key id'
    records="$(grep -Ec '^(SKINCOS_GLOBAL_COORDINATOR_URL|SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET)=' "$TARGET_FILE")"
    [[ "$records" == '2' ]] || fail 'legacy coordination custody contains unsupported records'
  else
    fail 'coordination secret record is absent'
  fi
  printf 'custody=present mode=%s owner=%s group=%s records=%s key_mode=%s\n' "$mode" "$owner" "$group" "$records" "$key_mode"
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
    if [[ "$COORDINATION_KEY_ID" == "$LEGACY_KEY_ID" ]]; then
      printf 'SKINCOS_GLOBAL_COORDINATOR_URL=%s\nSKINCOS_GLOBAL_COORDINATION_SHARED_SECRET=%s\n' \
        "$COORDINATOR_URL" "$COORDINATION_SECRET" > "$temporary"
    else
      printf 'SKINCOS_GLOBAL_COORDINATOR_URL=%s\nSKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY=%s\nSKINCOS_GLOBAL_COORDINATION_KEY_ID=%s\n' \
        "$COORDINATOR_URL" "$COORDINATION_SECRET" "$COORDINATION_KEY_ID" > "$temporary"
    fi
    chown root:"$TARGET_GROUP" "$temporary"
    chmod 0640 "$temporary"
    mv -f -- "$temporary" "$TARGET_FILE"
    trap - EXIT INT TERM
    if [[ "$COORDINATION_KEY_ID" == "$LEGACY_KEY_ID" ]]; then
      printf 'custody=written mode=640 owner=root group=%s records=2 key_mode=legacy\n' "$TARGET_GROUP"
    else
      printf 'custody=written mode=640 owner=root group=%s records=3 key_mode=active\n' "$TARGET_GROUP"
    fi
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
