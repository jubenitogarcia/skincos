#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
ROLLBACK="$ROOT_DIR/scripts/runtime/rollback-messaging-whatsapp-release.sh"

bash -n "$ROLLBACK"

required=(
  '--predecessor-release'
  '--predecessor-candidate'
  'verify-rollback-pair'
  'release-source-<SHA>'
  'snapshot-candidate'
  'materialize-candidate'
  'SNAPSHOT_CANDIDATE'
  'assert_confined_immutable_engine'
  'IMMUTABLE_ENGINE'
  'external authenticated release custody'
  'source archive digest'
  '--release-identity-file "$PREDECESSOR_ROOT/.skincos-release-identity-messaging-whatsapp.json"'
  '--operation promotion'
  'systemctl restart messaging-whatsapp.service'
  'systemctl --quiet is-active messaging-whatsapp.service'
  'http://127.0.0.1:8080/health'
  'restore_current_release'
  'the prior release was restored and revalidated.'
)

for pattern in "${required[@]}"; do
  grep -F -- "$pattern" "$ROLLBACK" >/dev/null || {
    echo "Missing immutable messaging rollback guard: $pattern" >&2
    exit 1
  }
done

if grep -F -- 'tar -tzf' "$ROLLBACK" >/dev/null \
  || grep -F -- 'tar -xzf' "$ROLLBACK" >/dev/null; then
  echo 'Messaging rollback must materialize the private candidate through the contract, not tar.' >&2
  exit 1
fi

if grep -F -- 'node "$IMMUTABLE_CONTRACT"' "$ROLLBACK" >/dev/null \
  || grep -F -- '"$IMMUTABLE_COORDINATION"' "$ROLLBACK" >/dev/null; then
  echo 'Messaging rollback must not execute release-source scripts before external custody is verified.' >&2
  exit 1
fi

apply_guard_line="$(grep -n -m1 -F 'if [[ "$APPLY" == 1 ]]' "$ROLLBACK" | cut -d: -f1)"
snapshot_line="$(grep -n -m1 -F 'snapshot-candidate' "$ROLLBACK" | cut -d: -f1)"
[[ -n "$apply_guard_line" && -n "$snapshot_line" && "$apply_guard_line" -lt "$snapshot_line" ]] || {
  echo 'Messaging rollback --apply custody gate must deny before opening a predecessor candidate.' >&2
  exit 1
}

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
test_sha='0123456789abcdef0123456789abcdef01234567'
if apply_output="$(bash "$ROLLBACK" --predecessor-release "$test_sha" --predecessor-candidate "$tmp_dir/must-not-be-opened" --apply 2>&1)"; then
  echo 'Messaging rollback --apply unexpectedly bypassed the external custody gate.' >&2
  exit 1
fi
grep -F -- 'external authenticated release custody' <<<"$apply_output" >/dev/null || {
  echo 'Messaging rollback --apply opened an untrusted predecessor before the custody gate.' >&2
  exit 1
}

restore_current_release_body="$(sed -n '/^restore_current_release()/,/^}/p' "$ROLLBACK")"
for pattern in \
  'systemctl --quiet is-active messaging-whatsapp.service' \
  'http://127.0.0.1:8080/health' \
  'could not confirm the prior release health'; do
  grep -F -- "$pattern" <<<"$restore_current_release_body" >/dev/null || {
    echo "Rollback compensation must revalidate the restored prior release: $pattern" >&2
    exit 1
  }
done

echo 'Messaging WhatsApp immutable rollback checks passed'
