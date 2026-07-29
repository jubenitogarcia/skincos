#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
POLICY=${N8N_RELEASE_WATCH_POLICY:-"$ROOT/release-watch-policy.json"}
AUDITOR=${N8N_RELEASE_WATCH_AUDITOR:-"$ROOT/audit-release-baseline.sh"}
NPM_BIN=${N8N_RELEASE_WATCH_NPM_BIN:-npm}
OFFICIAL_REGISTRY=https://registry.npmjs.org/

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf 'INFO: %s\n' "$*"; }
is_release_version() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }
canonical_audit_root() {
  local candidate=$1 parent name canonical_parent resolved
  [[ -n "$candidate" && "$candidate" = /* ]] || die 'N8N_AUDIT_ROOT must be an absolute private Linux path.'
  parent=$(dirname -- "$candidate")
  name=$(basename -- "$candidate")
  [[ "$name" != . && "$name" != .. ]] || die 'N8N_AUDIT_ROOT must name a private child directory.'
  canonical_parent=$(realpath -e -- "$parent") || die 'audit root parent must already exist.'
  resolved="$canonical_parent/$name"
  [[ ! -e "$resolved" ]] || resolved=$(realpath -e -- "$resolved")
  case "$resolved" in
    /opt|/opt/*|/var/lib|/var/lib/*|/etc|/etc/*) die 'audit root must not be a runtime or production configuration path.' ;;
  esac
  printf '%s\n' "$resolved"
}

[[ "${N8N_UPGRADE_ENV:-}" == staging && "${N8N_EXPECTED_ENV:-}" == staging ]] || die 'release watch is staging-only.'
[[ "${N8N_STAGING_MARKER:-}" == orb-n8n-staging ]] || die 'staging marker is absent or invalid.'
[[ "${N8N_RELEASE_WATCH_APPLY:-}" == YES ]] || die 'refused: set N8N_RELEASE_WATCH_APPLY=YES for an isolated fixture.'
audit_root=$(canonical_audit_root "${N8N_AUDIT_ROOT:-}")
[[ -f "$POLICY" ]] || die 'release watch policy is missing.'
[[ -f "$AUDITOR" ]] || die 'release auditor is missing.'

if [[ "${N8N_RELEASE_WATCH_TEST_MODE:-NO}" != YES ]]; then
  [[ "$NPM_BIN" == npm ]] || die 'npm binary override is test-only.'
  [[ "$AUDITOR" == "$ROOT/audit-release-baseline.sh" ]] || die 'auditor override is test-only.'
fi

last_evaluated=${N8N_RELEASE_WATCH_LAST_EVALUATED:-$(node --input-type=module - "$POLICY" <<'NODE'
import fs from 'node:fs';
const policy = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (typeof policy.last_evaluated_stable !== 'string') process.exit(2);
process.stdout.write(policy.last_evaluated_stable);
NODE
)}
is_release_version "$last_evaluated" || die 'last evaluated stable version is invalid.'

mkdir -p "$audit_root"
tags_file=$(mktemp "$audit_root/.release-watch-tags.XXXXXX")
trap 'rm -f -- "$tags_file"' EXIT
"$NPM_BIN" --registry "$OFFICIAL_REGISTRY" view n8n dist-tags --json > "$tags_file"

stable=$(node --input-type=module - "$tags_file" <<'NODE'
import fs from 'node:fs';
const tags = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (typeof tags.stable !== 'string') process.exit(2);
process.stdout.write(tags.stable);
NODE
) || die 'official registry did not provide a stable tag.'
is_release_version "$stable" || die 'stable tag is not a final x.y.z release.'

if node --input-type=module - "$stable" "$last_evaluated" <<'NODE'
const parse = (value) => value.split('.').map(Number);
const [candidate, baseline] = process.argv.slice(2).map(parse);
for (let index = 0; index < 3; index += 1) {
  if (candidate[index] > baseline[index]) process.exit(10);
  if (candidate[index] < baseline[index]) process.exit(11);
}
process.exit(0);
NODE
then
  comparison_status=0
else
  comparison_status=$?
fi
if [[ "$comparison_status" == 0 || "$comparison_status" == 11 ]]; then
  info "result=NO_NEW_STABLE_RELEASE stable=$stable last_evaluated=$last_evaluated"
  exit 0
fi
[[ "$comparison_status" == 10 ]] || die 'could not compare stable release versions.'

summary="$audit_root/n8n-$stable/summary.json"
report="$audit_root/release-watch-$stable.json"
if [[ -e "$report" ]]; then
  [[ -f "$report" && -f "$summary" ]] || die 'existing release-watch evidence is incomplete.'
  prior_result=$(node --input-type=module - "$report" "$summary" "$stable" <<'NODE'
import crypto from 'node:crypto';
import fs from 'node:fs';
const [reportPath, summaryPath, stable] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const sha = crypto.createHash('sha256').update(fs.readFileSync(summaryPath)).digest('hex');
if (report.selected_tag !== 'stable' || report.candidate_version !== stable || summary.n8n_version !== stable || report.dependency_summary_sha256 !== sha || typeof report.result !== 'string') process.exit(2);
process.stdout.write(report.result);
NODE
  ) || die 'existing release-watch evidence failed integrity validation.'
  info "result=ALREADY_EVALUATED candidate=$stable prior_result=$prior_result report=$report"
  exit 0
fi
[[ ! -e "$summary" ]] || die 'existing audit evidence has no release-watch report.'

N8N_UPGRADE_ENV=staging \
N8N_EXPECTED_ENV=staging \
N8N_STAGING_MARKER=orb-n8n-staging \
N8N_AUDIT_APPLY=YES \
N8N_AUDIT_ROOT="$audit_root" \
N8N_AUDIT_REGISTRY="$OFFICIAL_REGISTRY" \
bash "$AUDITOR" "$stable"

[[ -f "$summary" ]] || die 'auditor did not produce a summary.'
node --input-type=module - "$tags_file" "$summary" "$report" "$last_evaluated" <<'NODE'
import crypto from 'node:crypto';
import fs from 'node:fs';
const [tagsPath, summaryPath, reportPath, lastEvaluated] = process.argv.slice(2);
const tags = JSON.parse(fs.readFileSync(tagsPath, 'utf8'));
const summaryBytes = fs.readFileSync(summaryPath);
const summary = JSON.parse(summaryBytes.toString('utf8'));
const highCritical = summary.high_critical ?? [];
const auditErrors = summary.audit_errors ?? [];
const critical = highCritical.filter(({ severity }) => severity === 'critical').length;
const high = highCritical.filter(({ severity }) => severity === 'high').length;
const result = auditErrors.length > 0 ? 'REJECTED_AUDIT_ERROR' : critical > 0 ? 'REJECTED_CRITICAL_DEPENDENCY_GATE' : 'READY_FOR_FULL_ISOLATED_QUALIFICATION';
const report = {
  schema_version: 1,
  scope: 'Registry discovery and synthetic dependency-only staging audit. No live service, migration, workflow, credential, database, merge or deployment action is performed.',
  selected_tag: 'stable',
  candidate_version: summary.n8n_version,
  last_evaluated_stable: lastEvaluated,
  ignored_prerelease_tags: Object.fromEntries(Object.entries(tags).filter(([tag, version]) => tag !== 'stable' && typeof version === 'string' && version.includes('-'))),
  component_count: summary.components?.length ?? 0,
  critical_findings: critical,
  high_findings: high,
  audit_errors: auditErrors,
  dependency_summary_sha256: crypto.createHash('sha256').update(summaryBytes).digest('hex'),
  result,
  next_action: result === 'REJECTED_AUDIT_ERROR'
    ? 'Do not promote. Resolve the isolated audit transport or registry error, then rerun the watcher with a new clean fixture.'
    : result === 'REJECTED_CRITICAL_DEPENDENCY_GATE'
    ? 'Do not promote. Wait for a newer official stable release, then rerun the isolated watcher.'
    : 'Run the separately approved full isolated qualification; this watcher never promotes or changes production.'
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
NODE
result=$(node --input-type=module - "$report" <<'NODE'
import fs from 'node:fs';
process.stdout.write(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).result);
NODE
)
info "result=$result candidate=$stable report=$report"
