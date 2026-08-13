#!/usr/bin/env bash
set -euo pipefail

readonly CREDENTIAL_DIR='/var/lib/skincos/ponto-jit'
readonly EXPECTED_JOB='consultor-journey'

fail() {
  echo "Ponto JIT runner pre-job guard: $1" >&2
  exit 78
}

[[ "${GITHUB_JOB:-}" == "$EXPECTED_JOB" ]] || fail 'only the governed CONSULTOR journey may use this runner'
[[ "${GITHUB_WORKFLOW_REF:-}" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/\.github/workflows/ponto-production-slo\.yml@refs/tags/skincos/release/ponto/[0-9a-f]{40}$ ]] || fail 'workflow identity is not an immutable Ponto release ref'
[[ "${RUNNER_NAME:-}" =~ ^ponto-jit-[a-z0-9][a-z0-9-]{15,63}$ ]] || fail 'runner identity is invalid'

directory_metadata="$(stat -c '%u:%a:%F' "$CREDENTIAL_DIR")"
[[ "$directory_metadata" == '0:711:directory' ]] || fail 'credential directory metadata is invalid'
current_uid="$(id -u)"
for name in credentials.enc decrypt.key attestation.json; do
  file="$CREDENTIAL_DIR/$name"
  [[ -f "$file" && ! -L "$file" ]] || fail "credential artifact $name is absent or unsafe"
  metadata="$(stat -c '%u:%a:%F' "$file")"
  [[ "$metadata" == "$current_uid:600:regular file" ]] || fail "credential artifact $name metadata is invalid"
done

printf 'Ponto JIT pre-job custody is present for the governed CONSULTOR journey.\n'
