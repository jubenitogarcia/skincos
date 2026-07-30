#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
fake_npm="$tmp/npm"
fake_auditor="$tmp/auditor"
policy="$tmp/policy.json"

printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' '[[ "$1" == --registry && "$2" == https://registry.npmjs.org/ && "$3" == view && "$4" == n8n && "$5" == dist-tags && "$6" == --json ]]' 'printf "%s\n" "${N8N_RELEASE_WATCH_TEST_TAGS:?}"' > "$fake_npm"
printf '%s\n' '#!/usr/bin/env bash' 'set -euo pipefail' 'mkdir -p "$N8N_AUDIT_ROOT/n8n-$1"' 'printf "%s\n" "${N8N_RELEASE_WATCH_TEST_SUMMARY:?}" > "$N8N_AUDIT_ROOT/n8n-$1/summary.json"' > "$fake_auditor"
chmod +x "$fake_npm" "$fake_auditor"
printf '%s\n' '{"schema_version":1,"last_evaluated_stable":"2.32.6"}' > "$policy"

base=(env N8N_UPGRADE_ENV=staging N8N_EXPECTED_ENV=staging N8N_STAGING_MARKER=orb-n8n-staging N8N_RELEASE_WATCH_APPLY=YES N8N_RELEASE_WATCH_TEST_MODE=YES N8N_RELEASE_WATCH_NPM_BIN="$fake_npm" N8N_RELEASE_WATCH_AUDITOR="$fake_auditor" N8N_RELEASE_WATCH_POLICY="$policy")
summary_critical='{"n8n_version":"2.32.7","components":[{"component":"runtime-n8n"}],"high_critical":[{"severity":"critical"},{"severity":"high"}]}'
summary_audit_error='{"n8n_version":"2.32.8","components":[{"component":"runtime-n8n"}],"audit_errors":[{"component":"runtime-n8n","code":"EAUDIT"}],"high_critical":[]}'

if env N8N_UPGRADE_ENV=production N8N_EXPECTED_ENV=production N8N_STAGING_MARKER=orb-n8n-staging N8N_RELEASE_WATCH_APPLY=YES N8N_RELEASE_WATCH_TEST_MODE=YES N8N_RELEASE_WATCH_NPM_BIN="$fake_npm" N8N_RELEASE_WATCH_AUDITOR="$fake_auditor" N8N_RELEASE_WATCH_POLICY="$policy" N8N_AUDIT_ROOT="$tmp/production" "$ROOT/watch-stable-release.sh"; then
  echo 'expected production refusal' >&2; exit 1
fi
if env N8N_UPGRADE_ENV=staging N8N_EXPECTED_ENV=staging N8N_STAGING_MARKER=orb-n8n-staging N8N_RELEASE_WATCH_APPLY=YES N8N_RELEASE_WATCH_POLICY="$policy" N8N_AUDIT_ROOT="$tmp/policy-override" "$ROOT/watch-stable-release.sh"; then
  echo 'expected non-test policy override refusal' >&2; exit 1
fi
if "${base[@]}" N8N_AUDIT_ROOT=/opt N8N_RELEASE_WATCH_TEST_TAGS='{"stable":"2.32.7"}' N8N_RELEASE_WATCH_TEST_SUMMARY="$summary_critical" "$ROOT/watch-stable-release.sh"; then
  echo 'expected exact runtime root refusal' >&2; exit 1
fi
if "${base[@]}" N8N_AUDIT_ROOT=/var/../opt N8N_RELEASE_WATCH_TEST_TAGS='{"stable":"2.32.7"}' N8N_RELEASE_WATCH_TEST_SUMMARY="$summary_critical" "$ROOT/watch-stable-release.sh"; then
  echo 'expected traversal runtime root refusal' >&2; exit 1
fi

same_output=$("${base[@]}" N8N_AUDIT_ROOT="$tmp/same" N8N_RELEASE_WATCH_TEST_TAGS='{"stable":"2.32.6","next":"2.33.0-beta.1"}' N8N_RELEASE_WATCH_TEST_SUMMARY="$summary_critical" "$ROOT/watch-stable-release.sh")
printf '%s\n' "$same_output" | grep -q 'NO_NEW_STABLE_RELEASE'
[[ ! -e "$tmp/same/n8n-2.32.6/summary.json" ]]

if "${base[@]}" N8N_AUDIT_ROOT="$tmp/prerelease" N8N_RELEASE_WATCH_TEST_TAGS='{"stable":"2.33.0-beta.1"}' N8N_RELEASE_WATCH_TEST_SUMMARY="$summary_critical" "$ROOT/watch-stable-release.sh"; then
  echo 'expected prerelease stable tag refusal' >&2; exit 1
fi

new_output=$("${base[@]}" N8N_AUDIT_ROOT="$tmp/new" N8N_RELEASE_WATCH_TEST_TAGS='{"stable":"2.32.7","next":"2.33.0-beta.1"}' N8N_RELEASE_WATCH_TEST_SUMMARY="$summary_critical" "$ROOT/watch-stable-release.sh")
printf '%s\n' "$new_output" | grep -q 'REJECTED_CRITICAL_DEPENDENCY_GATE'
node --input-type=module - "$tmp/new/release-watch-2.32.7.json" <<'NODE'
import fs from 'node:fs';
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (report.candidate_version !== '2.32.7') throw new Error('candidate mismatch');
if (report.selected_tag !== 'stable') throw new Error('stable tag missing');
if (report.critical_findings !== 1 || report.high_findings !== 1) throw new Error('finding counts mismatch');
if (report.result !== 'REJECTED_CRITICAL_DEPENDENCY_GATE') throw new Error('critical gate bypassed');
if (report.ignored_prerelease_tags.next !== '2.33.0-beta.1') throw new Error('beta tag was not recorded as ignored');
NODE

repeat_output=$("${base[@]}" N8N_AUDIT_ROOT="$tmp/new" N8N_RELEASE_WATCH_TEST_TAGS='{"stable":"2.32.7","next":"2.33.0-beta.1"}' N8N_RELEASE_WATCH_TEST_SUMMARY="$summary_critical" "$ROOT/watch-stable-release.sh")
printf '%s\n' "$repeat_output" | grep -q 'ALREADY_EVALUATED'

audit_error_output=$("${base[@]}" N8N_AUDIT_ROOT="$tmp/audit-error" N8N_RELEASE_WATCH_TEST_TAGS='{"stable":"2.32.8"}' N8N_RELEASE_WATCH_TEST_SUMMARY="$summary_audit_error" "$ROOT/watch-stable-release.sh")
printf '%s\n' "$audit_error_output" | grep -q 'REJECTED_AUDIT_ERROR'
node --input-type=module - "$tmp/audit-error/release-watch-2.32.8.json" <<'NODE'
import fs from 'node:fs';
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (report.result !== 'REJECTED_AUDIT_ERROR' || report.audit_errors.length !== 1) throw new Error('audit error was not fail-closed');
NODE

echo 'release_watch_tests=pass'
