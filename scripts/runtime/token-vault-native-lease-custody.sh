#!/usr/bin/bash -p
set -euo pipefail
set +x
umask 077

# This entry point is run by root from a verified, immutable native release.
# It reads the fixed root custody file without copying it to a checkout or
# accepting credentials, a script path, or a coordinator URL from the caller.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH" HOME='/root' LANG='C'
unset BASH_ENV ENV CDPATH GLOBIGNORE TMPDIR TMP TEMP \
  HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy \
  GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES \
  GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_ATTR_NOSYSTEM GIT_EXEC_PATH \
  NODE_OPTIONS NODE_PATH NPM_CONFIG_USERCONFIG NPM_CONFIG_GLOBALCONFIG \
  npm_config_userconfig npm_config_globalconfig \
  SKINCOS_GLOBAL_COORDINATOR_URL SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET \
  SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY SKINCOS_GLOBAL_COORDINATION_KEY_ID \
  SKINCOS_GLOBAL_COORDINATION_PREVIOUS_KEY SKINCOS_GLOBAL_COORDINATION_PREVIOUS_KEY_ID \
  SKINCOS_GLOBAL_COORDINATION_PREVIOUS_KEY_EXPIRES_AT SKINCOS_GLOBAL_COORDINATION_ADMIN_SECRET \
  GLOBAL_COORDINATION_PROVIDER GLOBAL_COORDINATION_MISSION_ID \
  GLOBAL_COORDINATION_THREAD_ID GLOBAL_COORDINATION_ACTOR

readonly CUSTODY_DIR='/etc/skincos/global-coordination'
readonly CUSTODY_FILE="$CUSTODY_DIR/native-runtime.env"
readonly PROOF_ROOT='/var/lib/skincos-runtime/global-coordination'
readonly EVIDENCE_ROOT='/home/admin/.local/state/skincos/token-vault'
readonly SCRIPT_FILE="$(/usr/bin/realpath -e -- "${BASH_SOURCE[0]}")"
readonly SCRIPT_ROOT="$(/usr/bin/dirname -- "$(/usr/bin/dirname -- "$(/usr/bin/dirname -- "$SCRIPT_FILE")")")"

fail() {
  printf 'Token Vault native lease custody: %s\n' "$1" >&2
  exit 78
}

safe_root_owned() {
  local target="$1" mode
  [[ -e "$target" && ! -L "$target" ]] || fail 'immutable release contains a missing or linked path'
  [[ "$(/usr/bin/stat -c '%u' -- "$target")" == 0 ]] || fail 'immutable release path is not root owned'
  mode="$(/usr/bin/stat -c '%a' -- "$target")"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail 'immutable release mode is invalid'
  (( (8#$mode & 8#022) == 0 )) || fail 'immutable release path is writable by a non-root principal'
}

[[ "$(/usr/bin/id -u)" == 0 ]] || fail 'root execution through the native release entry point is required'
[[ "$(/usr/bin/sed -n 's/^ID=//p' /etc/os-release)" == ubuntu \
  && "$(/usr/bin/sed -n 's/^VERSION_ID=//p' /etc/os-release)" == '"24.04"' ]] \
  || fail 'the native Ubuntu-24.04 runtime is required'
/usr/bin/grep -Eiq 'microsoft|wsl' /proc/sys/kernel/osrelease \
  || fail 'the pinned WSL runtime is required'
export WSL_DISTRO_NAME='Ubuntu-24.04'
[[ "$SCRIPT_FILE" =~ ^/opt/skincos/releases/([0-9a-f]{40})/source/scripts/runtime/token-vault-native-lease-custody\.sh$ ]] \
  || fail 'entry point must come from a pinned native source release'
readonly RELEASE_SHA="${BASH_REMATCH[1]}"
[[ "$SCRIPT_ROOT" == "/opt/skincos/releases/$RELEASE_SHA/source" ]] || fail 'release root does not match the entry point'
for component in /opt/skincos /opt/skincos/releases \
  "/opt/skincos/releases/$RELEASE_SHA" "$SCRIPT_ROOT" \
  "$SCRIPT_ROOT/scripts" "$SCRIPT_ROOT/scripts/runtime" \
  "$SCRIPT_ROOT/ops" "$SCRIPT_ROOT/ops/governance" \
  "$SCRIPT_ROOT/ops/governance/global-coordination-core.mjs" \
  "$SCRIPT_FILE" "$SCRIPT_ROOT/scripts/token-vault-native-lease.mjs" \
  "$SCRIPT_ROOT/scripts/runtime/token-vault-native-release-attestation.mjs"; do
  safe_root_owned "$component"
done
readonly IDENTITY_FILE="$SCRIPT_ROOT/.skincos-token-vault-release-identity.json"
readonly CLOSURE_FILE="$SCRIPT_ROOT/.skincos-global-coordination-token-vault.json"
safe_root_owned "$IDENTITY_FILE"
safe_root_owned "$CLOSURE_FILE"

# Both attestations are installed with the verified release archive. Recheck
# their binding on every lease operation; a directory named after a SHA alone
# is never sufficient to gain access to native coordination custody.
/usr/bin/node "$SCRIPT_ROOT/scripts/runtime/token-vault-native-release-attestation.mjs" \
  "$IDENTITY_FILE" "$CLOSURE_FILE" "$RELEASE_SHA" \
  || fail 'Token Vault native release attestation is invalid'

[[ ! -L "$CUSTODY_DIR" && ! -L "$CUSTODY_FILE" && -f "$CUSTODY_FILE" ]] \
  || fail 'fixed native coordination custody is unavailable'
case "$(/usr/bin/stat -c '%U:%G:%a' -- "$CUSTODY_DIR")" in
  root:admin:750|root:root:700) ;;
  *) fail 'native coordination custody directory metadata is invalid' ;;
esac
case "$(/usr/bin/stat -c '%U:%G:%a' -- "$CUSTODY_FILE")" in
  root:admin:640|root:root:600) ;;
  *) fail 'native coordination custody file metadata is invalid' ;;
esac

mode="${1:-}"
[[ "$mode" =~ ^(acquire|check|renew|release)$ ]] || fail 'usage: acquire|check|renew|release with bounded lease arguments'
shift

declare -A options=()
while (( $# > 0 )); do
  (( $# >= 2 )) || fail 'lease argument is missing its value'
  [[ "$1" =~ ^--(source-sha|target|preview-evidence|readiness-evidence|observation-file|proof-file|transaction-id)$ ]] \
    || fail 'unsupported lease argument'
  [[ -n "$2" && ! -v "options[$1]" ]] || fail 'empty or repeated lease argument'
  options["$1"]="$2"
  shift 2
done

readonly PROOF_FILE="${options[--proof-file]:-}"
[[ "$PROOF_FILE" =~ ^/var/lib/skincos-runtime/global-coordination/token-vault-([A-Za-z0-9][A-Za-z0-9._-]{7,95})\.json$ ]] \
  || fail 'proof must use the private Token Vault lease path'
readonly PROOF_TRANSACTION="${BASH_REMATCH[1]}"
[[ ! -L "$PROOF_ROOT" && -d "$PROOF_ROOT" \
  && "$(/usr/bin/stat -c '%U:%a' -- "$PROOF_ROOT")" == 'root:700' ]] \
  || fail 'private native proof root is unavailable or unsafe'
if [[ -e "$PROOF_FILE" || -L "$PROOF_FILE" ]]; then
  [[ ! -L "$PROOF_FILE" && -f "$PROOF_FILE" \
    && "$(/usr/bin/stat -c '%U:%a' -- "$PROOF_FILE")" == 'root:600' ]] \
    || fail 'existing Token Vault proof metadata is unsafe'
fi

if [[ "$mode" == release ]]; then
  (( ${#options[@]} == 1 )) || fail 'release accepts only --proof-file'
  [[ -f "$PROOF_FILE" ]] || fail 'release proof is unavailable'
else
  readonly SOURCE_SHA="${options[--source-sha]:-}"
  readonly TARGET="${options[--target]:-}"
  [[ "$SOURCE_SHA" == "$RELEASE_SHA" && "$TARGET" =~ ^(staging|production)$ ]] \
    || fail 'lease source or target differs from the immutable release'
  [[ -f "$PROOF_FILE" || "$mode" == acquire ]] || fail 'existing lease proof is required'
  if [[ "$mode" == acquire ]]; then
    [[ "${options[--transaction-id]:-}" == "$PROOF_TRANSACTION" && ${#options[@]} == 7 ]] \
      || fail 'acquire requires one matching transaction, preview, readiness and observation'
  else
    (( ${#options[@]} == 4 )) || fail 'check and renew require source, target, observation and proof'
  fi
fi

check_evidence_file() {
  local supplied="$1" resolved
  [[ "$supplied" == "$EVIDENCE_ROOT"/* && ! -L "$supplied" && -f "$supplied" ]] \
    || fail 'release evidence must be a regular private operator file'
  resolved="$(/usr/bin/realpath -e -- "$supplied")"
  [[ "$resolved" == "$EVIDENCE_ROOT"/* ]] || fail 'release evidence escapes its private root'
  [[ "$(/usr/bin/stat -c '%U:%a' -- "$resolved")" == 'admin:600' ]] \
    || fail 'release evidence metadata is unsafe'
  (( $(/usr/bin/stat -c '%s' -- "$resolved") <= 1048576 )) || fail 'release evidence is too large'
}

if [[ "$mode" != release ]]; then
  check_evidence_file "${options[--observation-file]:-}"
fi
if [[ "$mode" == acquire ]]; then
  check_evidence_file "${options[--preview-evidence]:-}"
  check_evidence_file "${options[--readiness-evidence]:-}"
fi

url=''
secret=''
key_id=''
legacy=''
declare -A seen=()
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" != *$'\r'* && "$line" =~ ^([A-Z][A-Z0-9_]*)=(.+)$ ]] \
    || fail 'native coordination custody contains an invalid record'
  name="${BASH_REMATCH[1]}"
  value="${BASH_REMATCH[2]}"
  [[ ! -v "seen[$name]" ]] || fail 'native coordination custody contains a repeated record'
  seen["$name"]=1
  case "$name" in
    SKINCOS_GLOBAL_COORDINATOR_URL) url="$value" ;;
    SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY) secret="$value" ;;
    SKINCOS_GLOBAL_COORDINATION_KEY_ID) key_id="$value" ;;
    SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET) legacy="$value" ;;
    *) fail 'native coordination custody contains an unsupported record' ;;
  esac
done < "$CUSTODY_FILE"
[[ "$url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/v1/leases)?$ ]] \
  || fail 'native coordination custody URL is invalid'
if [[ -n "$secret" || -n "$key_id" ]]; then
  (( ${#seen[@]} == 3 )) && [[ -z "$legacy" && ${#secret} -ge 32 \
    && "$key_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$ && "$key_id" != legacy-v1 ]] \
    || fail 'active native coordination custody is incomplete'
  export SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY="$secret"
  export SKINCOS_GLOBAL_COORDINATION_KEY_ID="$key_id"
else
  (( ${#seen[@]} == 2 )) && [[ ${#legacy} -ge 32 ]] \
    || fail 'legacy native coordination custody is incomplete'
  export SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET="$legacy"
fi
export SKINCOS_GLOBAL_COORDINATOR_URL="$url"

# The Node lease client validates the evidence and coordinator's signed
# response, checks fencing before mutations, and writes the proof atomically.
readonly CLIENT="$SCRIPT_ROOT/scripts/token-vault-native-lease.mjs"
cd -- "$SCRIPT_ROOT"
if [[ "$mode" == acquire ]]; then
  exec /usr/bin/node "$CLIENT" acquire \
    --source-sha "$SOURCE_SHA" --target "$TARGET" \
    --preview-evidence "${options[--preview-evidence]}" \
    --readiness-evidence "${options[--readiness-evidence]}" \
    --observation-file "${options[--observation-file]}" \
    --transaction-id "$PROOF_TRANSACTION" --proof-file "$PROOF_FILE"
elif [[ "$mode" == release ]]; then
  exec /usr/bin/node "$CLIENT" release --proof-file "$PROOF_FILE"
else
  exec /usr/bin/node "$CLIENT" "$mode" \
    --source-sha "$SOURCE_SHA" --target "$TARGET" \
    --observation-file "${options[--observation-file]}" --proof-file "$PROOF_FILE"
fi
