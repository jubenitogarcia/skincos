#!/usr/bin/bash -p
set -euo pipefail

# Root-owned, fixed-purpose bridge for the dispatch-only native custody
# runner.  It accepts no caller-selected path, shell fragment or command: the
# action selects one bounded immutable-release operation and all operands are
# read as a strict LF-delimited stdin record.  The installed copy lives outside
# a checkout at /usr/local/sbin/skincos-meta-ads-tracking-custody.
readonly SAFE_PATH='/usr/sbin:/usr/bin:/sbin:/bin'
export PATH="$SAFE_PATH"
unset BASH_ENV CDPATH ENV GIT_DIR GIT_WORK_TREE NODE_OPTIONS npm_config_prefix PGPASSWORD \
  http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy NO_PROXY no_proxy

readonly RELEASE_BASE='/opt/skincos/releases'
readonly CURRENT_LINK='/opt/skincos/current/source'
readonly RUNTIME_HOME='/var/lib/skincos-runtime/orb'
readonly CHECKPOINT_ROOT="$RUNTIME_HOME/exports/workflow-patches"
readonly CHECKPOINT_PREFIX="$CHECKPOINT_ROOT/meta-ads-build-payload-"
readonly PROOF_ROOT='/var/lib/skincos-runtime/global-coordination'
readonly FALLBACK_PROOF_ROOT="$RUNTIME_HOME/global-coordination"
readonly COORDINATION_ENV='/etc/skincos/global-coordination/orb-backup.env'
readonly FENCE_UNIT='/etc/systemd/system/orb-restart-fence.service'
readonly ATTESTATION_HELPER='/usr/local/lib/skincos/meta-ads-tracking-custody-attestation.mjs'
# The GitHub cross-surface release lease lives for 900 seconds.  The compound
# native transition intentionally leaves a large fail-closed margin so it can
# never begin the Orb write after that outer lease plausibly expired.  These
# are fixed helper limits, never runner input.
readonly COMPOUND_TRANSACTION_BUDGET_SECONDS=600
readonly COMPOUND_PROMOTION_MAX_SECONDS=420
readonly COMPOUND_APPLY_MAX_SECONDS=120
readonly COMPOUND_POSTSTATE_RESERVE_SECONDS=45
readonly COMPOUND_TIMEOUT_KILL_GRACE_SECONDS=15
readonly COMPOUND_MIN_CHILD_SECONDS=30
readonly COMPOUND_COMPENSATION_ROLLBACK_MAX_SECONDS=180
readonly COMPOUND_COMPENSATION_RESTORE_MAX_SECONDS=120
readonly COMPOUND_COMPENSATION_PREFLIGHT_MAX_SECONDS=60
readonly COMPOUND_POSTSTATE_READBACK_MAX_SECONDS=60
readonly ACTION="${1:-}"

fail() {
  local code="${1:-native_custody_failed}"
  printf '{"ok":false,"action":"%s","error":"%s"}\n' "${ACTION:-unknown}" "$code" >&2
  exit 78
}

[[ "$(id -u)" == '0' ]] || fail 'root_required'
[[ "$#" == 1 ]] || fail 'action_arguments_forbidden'

read_line() {
  local value=''
  IFS= read -r value || fail 'stdin_record_missing'
  [[ "$value" != *$'\r'* ]] || fail 'stdin_record_must_use_lf'
  printf '%s' "$value"
}

assert_end_of_input() {
  local extra=''
  if IFS= read -r extra || [[ -n "$extra" ]]; then fail 'stdin_record_count_invalid'; fi
}

require_sha() {
  local value="$1"
  [[ "$value" =~ ^[0-9a-f]{40}$ ]] || fail 'release_sha_invalid'
}

require_version() {
  local value="$1"
  [[ "$value" =~ ^[0-9a-fA-F-]{36}$ ]] || fail 'workflow_version_invalid'
}

require_run_number() {
  local value="$1"
  [[ "$value" =~ ^[1-9][0-9]{0,19}$ ]] || fail 'run_identity_invalid'
}

require_run_attempt() {
  local value="$1"
  require_run_number "$value"
  [[ "$value" == '1' ]] || fail 'workflow_rerun_forbidden'
}

require_oidc_token() {
  local value="$1"
  [[ ${#value} -ge 32 && ${#value} -le 24576 && "$value" =~ ^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] || fail 'oidc_token_invalid'
}

assert_attestation_helper() {
  local resolved metadata
  resolved="$(readlink -f -- "$ATTESTATION_HELPER" 2>/dev/null || true)"
  metadata="$(stat -c '%u:%g:%a' "$ATTESTATION_HELPER" 2>/dev/null || true)"
  [[ "$resolved" == "$ATTESTATION_HELPER" && -f "$ATTESTATION_HELPER" && ! -L "$ATTESTATION_HELPER" && "$metadata" == '0:0:755' ]] || fail 'attestation_helper_unavailable'
}

run_attestation_verifier() {
  /usr/bin/env -i PATH="$SAFE_PATH" HOME=/root \
    /usr/bin/node "$ATTESTATION_HELPER" "$@"
}

validate_attestation_result() {
  local payload="$1" release="$2" run_id="$3" run_attempt="$4"
  if ! printf '%s' "$payload" | /usr/bin/node -e '
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(0, "utf8"));
const [release, runId, runAttempt] = process.argv.slice(1);
const keys = ["action", "approval", "approvalExpiresAt", "ok", "releaseSha", "runAttempt", "runId"];
if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.sort()) || value.ok !== true || !["attest", "verify"].includes(value.action) || value.approval !== "valid" || value.releaseSha !== release || value.runId !== runId || value.runAttempt !== Number(runAttempt) || !Number.isSafeInteger(value.approvalExpiresAt) || value.approvalExpiresAt <= Math.floor(Date.now() / 1000)) process.exit(1);
' "$release" "$run_id" "$run_attempt" >/dev/null 2>&1; then
    fail 'workflow_attestation_invalid'
  fi
}

require_runtime_approval() {
  local release="$1" run_id="$2" run_attempt="$3" result=''
  require_sha "$release"; require_run_number "$run_id"; require_run_attempt "$run_attempt"
  assert_attestation_helper
  if ! result="$(run_attestation_verifier verify "$release" "$run_id" "$run_attempt" </dev/null 2>/dev/null)"; then
    fail 'workflow_attestation_invalid'
  fi
  validate_attestation_result "$result" "$release" "$run_id" "$run_attempt"
}

release_root() {
  local release="$1" root resolved
  require_sha "$release"
  root="$RELEASE_BASE/$release/source"
  resolved="$(readlink -f -- "$root" 2>/dev/null || true)"
  [[ "$resolved" == "$root" && -d "$root" && -f "$root/.skincos-release-lineage.json" ]] || fail 'immutable_release_unavailable'
  if ! /usr/bin/node - "$root/.skincos-release-lineage.json" "$release" <<'NODE' >/dev/null 2>&1; then
const fs = require('fs');
const [file, release] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
if (String(value.releaseId || '').toLowerCase() !== release || value.verifiedAncestor !== true) process.exit(1);
NODE
    fail 'immutable_release_identity_invalid'
  fi
  printf '%s' "$root"
}

# A staged release is not trusted merely because a caller supplied a SHA.  The
# identity/closure files are part of the immutable native release envelope and
# are verified locally before an OIDC-approved candidate can observe or change
# the incumbent runtime.
verified_release_root() {
  local release="$1" root
  root="$(release_root "$release")"
  if ! /usr/bin/node - "$root" "$release" <<'NODE' >/dev/null 2>&1; then
const crypto = require('crypto');
const fs = require('fs');
const [root, release] = process.argv.slice(2);
const fullSha = /^[0-9a-f]{40}$/;
const digest = /^[0-9a-f]{64}$/;
const canonicalJson = (value) => Array.isArray(value)
  ? `[${value.map(canonicalJson).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const lower = (value) => String(value || '').trim().toLowerCase();
const readArtifact = (name) => {
  const file = `${root}/${name}`;
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o022) !== 0) process.exit(1);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const lineage = readArtifact('.skincos-release-lineage.json');
const closure = readArtifact('.skincos-global-coordination-native-runtime.json');
const identity = readArtifact('.skincos-release-identity-native-runtime.json');
if (
  lower(lineage.releaseId) !== release
  || !fullSha.test(lower(lineage.parentReleaseId))
  || lineage.verifiedAncestor !== true
  || lower(closure.module) !== 'native-runtime'
  || lower(closure.sourceCommit) !== release
  || !fullSha.test(lower(closure.sourceTree))
  || !digest.test(lower(closure.digest))
  || !closure.material
  || closure.material.schemaVersion !== 1
  || lower(closure.material.module) !== 'native-runtime'
  || !Array.isArray(closure.material.inputs)
  || closure.material.inputs.length === 0
  || crypto.createHash('sha256').update(canonicalJson(closure.material)).digest('hex') !== lower(closure.digest)
  || identity.schemaVersion !== 1
  || lower(identity.module) !== 'native-runtime'
  || lower(identity.sourceCommit) !== release
  || lower(identity.sourceTree) !== lower(closure.sourceTree)
  || lower(identity.dependencyClosureDigest) !== lower(closure.digest)
  || !Array.isArray(identity.artifacts)
) process.exit(1);
for (const entry of closure.material.inputs) {
  if (!entry || typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.split('/').includes('..') || !fullSha.test(lower(entry.blob))) process.exit(1);
}
const archive = identity.artifacts.find((artifact) => artifact && artifact.name === 'native-source-archive');
if (!archive || archive.id !== `native-source:${release}` || !digest.test(lower(archive.digest))) process.exit(1);
NODE
    fail 'immutable_release_attestation_invalid'
  fi
  printf '%s' "$root"
}

prior_release() {
  local root="$1"
  local parent=''
  parent="$(/usr/bin/node - "$root/.skincos-release-lineage.json" <<'NODE' 2>/dev/null || true
const fs = require('fs');
const value = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const parent = String(value.parentReleaseId || '').trim().toLowerCase();
if (!/^[0-9a-f]{40}$/.test(parent)) process.exit(1);
process.stdout.write(parent);
NODE
)"
  [[ "$parent" =~ ^[0-9a-f]{40}$ ]] || fail 'prior_release_identity_invalid'
  printf '%s' "$parent"
}

assert_current_root() {
  local root="$1" current
  current="$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)"
  [[ "$current" == "$root" ]] || fail 'current_release_mismatch'
}

current_release() {
  local current release root
  current="$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)"
  [[ "$current" =~ ^/opt/skincos/releases/[0-9a-f]{40}/source$ ]] || fail 'current_release_identity_invalid'
  release="${current#"$RELEASE_BASE/"}"
  release="${release%/source}"
  root="$(verified_release_root "$release")"
  [[ "$current" == "$root" ]] || fail 'current_release_identity_invalid'
  printf '%s' "$release"
}

assert_direct_candidate_parent() {
  local candidate_root="$1" candidate="$2" parent_root="$3" parent="$4"
  if ! /usr/bin/node - "$candidate_root/.skincos-release-lineage.json" "$parent_root/.skincos-release-lineage.json" "$candidate" "$parent" <<'NODE' >/dev/null 2>&1; then
const fs = require('fs');
const [candidateFile, parentFile, candidate, parent] = process.argv.slice(2);
const lower = (value) => String(value || '').trim().toLowerCase();
const candidateLineage = JSON.parse(fs.readFileSync(candidateFile, 'utf8'));
const parentLineage = JSON.parse(fs.readFileSync(parentFile, 'utf8'));
if (
  lower(candidateLineage.releaseId) !== candidate
  || lower(candidateLineage.parentReleaseId) !== parent
  || candidateLineage.verifiedAncestor !== true
  || lower(parentLineage.releaseId) !== parent
  || parentLineage.verifiedAncestor !== true
) process.exit(1);
NODE
    fail 'candidate_current_lineage_mismatch'
  fi
}

run_as_postgres() {
  runuser -u postgres -- env N8N_RUNTIME_HOME="$RUNTIME_HOME" "$@"
}

# The root helper is the only component that knows the compound operation's
# absolute deadline.  Every internal compensation child receives a timeout
# which includes a fixed SIGTERM/SIGKILL grace *before* that deadline, so a
# timed-out child cannot keep mutating after the outer release lease elapsed.
compound_child_timeout() {
  local deadline="$1" maximum="$2" now remaining timeout
  [[ "$deadline" =~ ^[1-9][0-9]{0,12}$ && "$maximum" =~ ^[1-9][0-9]{0,3}$ ]] || return 64
  now="$(/bin/date +%s)"
  remaining=$(( deadline - now ))
  timeout=$(( remaining - COMPOUND_TIMEOUT_KILL_GRACE_SECONDS ))
  (( timeout >= COMPOUND_MIN_CHILD_SECONDS )) || return 124
  (( timeout > maximum )) && timeout="$maximum"
  printf '%s' "$timeout"
}

run_compound_postgres_until() {
  local deadline="$1" maximum="$2" timeout
  shift 2
  timeout="$(compound_child_timeout "$deadline" "$maximum")" || return $?
  /usr/bin/timeout --foreground --kill-after="$COMPOUND_TIMEOUT_KILL_GRACE_SECONDS" "${timeout}s" \
    /usr/sbin/runuser -u postgres -- env N8N_RUNTIME_HOME="$RUNTIME_HOME" "$@"
}

try_read_live_checkpoint_until() {
  local root="$1" deadline="$2" timeout
  [[ -r "$root/orb/engine/scripts/export-meta-ads-publish-live.js" ]] || return 69
  timeout="$(compound_child_timeout "$deadline" "$COMPOUND_POSTSTATE_READBACK_MAX_SECONDS")" || return $?
  /usr/bin/timeout --foreground --kill-after="$COMPOUND_TIMEOUT_KILL_GRACE_SECONDS" "${timeout}s" \
    /usr/sbin/runuser -u postgres -- env N8N_RUNTIME_HOME="$RUNTIME_HOME" \
    /usr/bin/node "$root/orb/engine/scripts/export-meta-ads-publish-live.js" 2>/dev/null
}

validate_checkpoint() {
  local checkpoint="$1" resolved directory
  [[ "$checkpoint" =~ ^/var/lib/skincos-runtime/orb/exports/workflow-patches/meta-ads-build-payload-[0-9TZ-]{20,64}/workflow\.live\.json$ ]] || fail 'checkpoint_path_invalid'
  directory="${checkpoint%/workflow.live.json}"
  resolved="$(readlink -f -- "$checkpoint" 2>/dev/null || true)"
  [[ "$resolved" == "$checkpoint" && -d "$directory" && ! -L "$directory" && -f "$checkpoint" && ! -L "$checkpoint" ]] || fail 'checkpoint_unavailable'
}

try_read_live_checkpoint() {
  local root="$1"
  [[ -r "$root/orb/engine/scripts/export-meta-ads-publish-live.js" ]] || return 69
  run_as_postgres /usr/bin/node "$root/orb/engine/scripts/export-meta-ads-publish-live.js" 2>/dev/null
}

read_live_checkpoint() {
  local root="$1" output=''
  if ! output="$(try_read_live_checkpoint "$root")"; then
    fail 'checkpoint_export_failed'
  fi
  printf '%s' "$output"
}

checkpoint_summary() {
  local payload="$1" summary=''
  if ! summary="$(printf '%s' "$payload" | /usr/bin/node -e '
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(0, "utf8"));
const version = String(value.versionId || "");
const directory = String(value.checkpointDir || "");
if (value.active === true || !/^[0-9a-fA-F-]{36}$/.test(version) || !/^\/var\/lib\/skincos-runtime\/orb\/exports\/workflow-patches\/meta-ads-build-payload-[0-9TZ-]{20,64}$/.test(directory)) process.exit(1);
process.stdout.write(JSON.stringify({ versionId: version, checkpoint: `${directory}/workflow.live.json` }));
' 2>/dev/null)"; then
    fail 'checkpoint_summary_invalid'
  fi
  printf '%s' "$summary"
}

json_field() {
  local payload="$1" field="$2" value=''
  if ! value="$(printf '%s' "$payload" | /usr/bin/node -e '
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(0, "utf8"));
const field = process.argv[1];
const output = String(value[field] || "");
if (!output) process.exit(1);
process.stdout.write(output);
' "$field" 2>/dev/null)"; then
    fail 'helper_result_invalid'
  fi
  printf '%s' "$value"
}

load_coordination_custody() {
  [[ -f "$COORDINATION_ENV" && ! -L "$COORDINATION_ENV" ]] || fail 'coordination_custody_unavailable'
  local mode owner group records line key value
  mode="$(stat -c '%a' "$COORDINATION_ENV" 2>/dev/null || true)"
  owner="$(stat -c '%U' "$COORDINATION_ENV" 2>/dev/null || true)"
  group="$(stat -c '%G' "$COORDINATION_ENV" 2>/dev/null || true)"
  [[ "$mode" == '640' && "$owner" == 'root' && "$group" == 'admin' ]] || fail 'coordination_custody_metadata_invalid'
  local coordinator='' active_key='' shared_secret='' key_id=''
  records=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" != *$'\r'* && -n "$line" ]] || fail 'coordination_custody_record_invalid'
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" != "$line" && -n "$value" ]] || fail 'coordination_custody_record_invalid'
    case "$key" in
      SKINCOS_GLOBAL_COORDINATOR_URL) [[ -z "$coordinator" ]] || fail 'coordination_custody_duplicate'; coordinator="$value" ;;
      SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY) [[ -z "$active_key" ]] || fail 'coordination_custody_duplicate'; active_key="$value" ;;
      SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET) [[ -z "$shared_secret" ]] || fail 'coordination_custody_duplicate'; shared_secret="$value" ;;
      SKINCOS_GLOBAL_COORDINATION_KEY_ID) [[ -z "$key_id" ]] || fail 'coordination_custody_duplicate'; key_id="$value" ;;
      *) fail 'coordination_custody_record_invalid' ;;
    esac
    records=$((records + 1))
  done < "$COORDINATION_ENV"
  [[ "$coordinator" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?(/v1/leases)?$ ]] || fail 'coordination_custody_url_invalid'
  if [[ -n "$active_key" ]]; then
    [[ -z "$shared_secret" && "$key_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$ && "$key_id" != 'legacy-v1' && "$records" == 3 ]] || fail 'coordination_custody_key_invalid'
    export SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY="$active_key"
    export SKINCOS_GLOBAL_COORDINATION_KEY_ID="$key_id"
  else
    [[ -n "$shared_secret" && -z "$key_id" && "$records" == 2 ]] || fail 'coordination_custody_key_invalid'
    export SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET="$shared_secret"
  fi
  export SKINCOS_GLOBAL_COORDINATOR_URL="$coordinator"
}

emit() {
  local action="$1" release="$2" extra="${3:-}"
  if [[ -n "$extra" ]]; then
    printf '{"ok":true,"action":"%s","releaseSha":"%s",%s}\n' "$action" "$release" "$extra"
  else
    printf '{"ok":true,"action":"%s","releaseSha":"%s"}\n' "$action" "$release"
  fi
}

action_audit() {
  local release run_id run_attempt root
  release="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; assert_end_of_input
  require_runtime_approval "$release" "$run_id" "$run_attempt"
  [[ -x /usr/local/sbin/skincos-meta-ads-tracking-custody ]] || fail 'installed_helper_missing'
  [[ -f "$FENCE_UNIT" && ! -L "$FENCE_UNIT" ]] || fail 'restart_fence_unavailable'
  [[ -d "$CHECKPOINT_ROOT" && ! -L "$CHECKPOINT_ROOT" ]] || fail 'checkpoint_root_unavailable'
  [[ -d "$RUNTIME_HOME/state/livia-maintenance" && ! -L "$RUNTIME_HOME/state/livia-maintenance" ]] || fail 'maintenance_root_unavailable'
  [[ -d "$PROOF_ROOT" && ! -L "$PROOF_ROOT" && -d "$FALLBACK_PROOF_ROOT" && ! -L "$FALLBACK_PROOF_ROOT" ]] || fail 'coordination_proof_root_unavailable'
  load_coordination_custody
  root="$(verified_release_root "$release")"; assert_current_root "$root"
  emit 'audit' "$release" '"nativeCustody":"ready"'
}

action_checkpoint() {
  local release run_id run_attempt root prior raw summary checkpoint version
  release="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; assert_end_of_input
  require_runtime_approval "$release" "$run_id" "$run_attempt"
  root="$(verified_release_root "$release")"; assert_current_root "$root"; prior="$(prior_release "$root")"
  raw="$(read_live_checkpoint "$root")"; summary="$(checkpoint_summary "$raw")"
  checkpoint="$(json_field "$summary" checkpoint)"; version="$(json_field "$summary" versionId)"
  validate_checkpoint "$checkpoint"; require_version "$version"
  emit 'checkpoint' "$release" "\"versionId\":\"$version\",\"checkpoint\":\"$checkpoint\",\"priorReleaseSha\":\"$prior\""
}

# These pre-promotion actions are deliberately candidate-scoped.  A trusted
# production dispatch can learn or checkpoint only the exact incumbent proven
# as the direct parent of its attested, staged candidate; it cannot use this
# helper as a general native-release inventory or export oracle.
action_discover_current() {
  local candidate run_id run_attempt candidate_root current current_root
  candidate="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; assert_end_of_input
  require_runtime_approval "$candidate" "$run_id" "$run_attempt"
  candidate_root="$(verified_release_root "$candidate")"
  current="$(current_release)"; current_root="$(verified_release_root "$current")"
  assert_direct_candidate_parent "$candidate_root" "$candidate" "$current_root" "$current"
  emit 'discover-current' "$candidate" "\"currentReleaseSha\":\"$current\""
}

action_checkpoint_current() {
  local candidate run_id run_attempt candidate_root current current_root raw summary checkpoint version
  candidate="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; assert_end_of_input
  require_runtime_approval "$candidate" "$run_id" "$run_attempt"
  candidate_root="$(verified_release_root "$candidate")"
  current="$(current_release)"; current_root="$(verified_release_root "$current")"
  assert_direct_candidate_parent "$candidate_root" "$candidate" "$current_root" "$current"
  raw="$(read_live_checkpoint "$current_root")"; summary="$(checkpoint_summary "$raw")"
  checkpoint="$(json_field "$summary" checkpoint)"; version="$(json_field "$summary" versionId)"
  validate_checkpoint "$checkpoint"; require_version "$version"
  # Do not hand a workflow a checkpoint labelled as current if another native
  # transition changed the pointer while the PostgreSQL export was running.
  assert_current_root "$current_root"
  emit 'checkpoint-current' "$candidate" "\"currentReleaseSha\":\"$current\",\"versionId\":\"$version\",\"checkpoint\":\"$checkpoint\""
}

action_apply() {
  local release run_id run_attempt expected root pre_raw pre_summary pre_checkpoint pre_version post_raw post_summary post_version restored_raw restored_summary restored_version apply_succeeded=0
  release="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; expected="$(read_line)"; assert_end_of_input
  require_runtime_approval "$release" "$run_id" "$run_attempt"
  root="$(verified_release_root "$release")"; assert_current_root "$root"; require_version "$expected"
  [[ -r "$root/scripts/runtime/apply-meta-ads-publish-tracking-release.sh" ]] || fail 'apply_entrypoint_unavailable'
  [[ -r "$root/scripts/runtime/rollback-meta-ads-publish-tracking-release.sh" ]] || fail 'restore_entrypoint_unavailable'

  # Capture a private, exact pre-write snapshot in this helper rather than
  # trusting an earlier runner-visible checkpoint.  It gives a failed apply a
  # local compensation path even if the inner script exits after its database
  # transaction committed but before its final strict source/live preflight.
  pre_raw="$(read_live_checkpoint "$root")"; pre_summary="$(checkpoint_summary "$pre_raw")"
  pre_checkpoint="$(json_field "$pre_summary" checkpoint)"; pre_version="$(json_field "$pre_summary" versionId)"
  validate_checkpoint "$pre_checkpoint"; require_version "$pre_version"
  [[ "$pre_version" == "$expected" ]] || fail 'workflow_apply_preversion_mismatch'

  if run_as_postgres /usr/bin/bash "$root/scripts/runtime/apply-meta-ads-publish-tracking-release.sh" --source-root "$root" --expected-version "$expected" --apply >/dev/null 2>&1; then
    apply_succeeded=1
  fi

  # An inner failure is not evidence that PostgreSQL rolled back: the apply
  # entrypoint validates after its version-changing transaction.  Always
  # export the inactive live state before deciding whether to report success,
  # a known no-write failure, or a guarded restore.
  if ! post_raw="$(try_read_live_checkpoint "$root")"; then
    if [[ "$apply_succeeded" == '1' ]]; then
      fail 'workflow_apply_poststate_unknown'
    fi
    fail 'workflow_apply_failed_state_unknown'
  fi
  post_summary="$(checkpoint_summary "$post_raw")"; post_version="$(json_field "$post_summary" versionId)"
  require_version "$post_version"

  if [[ "$apply_succeeded" == '1' ]]; then
    [[ "$post_version" != "$expected" ]] || fail 'workflow_apply_version_unchanged'
    emit 'apply' "$release" "\"appliedVersion\":\"$post_version\""
    return
  fi

  # The failed command left the expected version intact, so the version-locked
  # database write did not take effect.  Do not restore unnecessarily.
  [[ "$post_version" != "$expected" ]] || fail 'workflow_apply_failed_no_mutation'

  # The exact version changed despite the apply failure. Restore the local
  # checkpoint only while the guarded rollback still sees that same post-apply
  # version. This prevents overwriting a concurrent/replaced workflow and
  # makes the failure terminally visible as compensated rather than ambiguous.
  if ! run_as_postgres /usr/bin/bash "$root/scripts/runtime/rollback-meta-ads-publish-tracking-release.sh" --source-root "$root" --expected-version "$post_version" --rollback-version "$expected" --rollback-snapshot "$pre_checkpoint" --apply >/dev/null 2>&1; then
    fail 'workflow_apply_failed_compensation_failed'
  fi
  if ! restored_raw="$(try_read_live_checkpoint "$root")"; then
    fail 'workflow_apply_failed_compensation_unverified'
  fi
  restored_summary="$(checkpoint_summary "$restored_raw")"; restored_version="$(json_field "$restored_summary" versionId)"
  require_version "$restored_version"
  [[ "$restored_version" != "$post_version" ]] || fail 'workflow_apply_failed_compensation_unverified'
  fail 'workflow_apply_failed_compensated'
}

action_preflight() {
  local release run_id run_attempt root
  release="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; assert_end_of_input
  require_runtime_approval "$release" "$run_id" "$run_attempt"
  root="$(verified_release_root "$release")"; assert_current_root "$root"
  [[ -r "$root/orb/engine/scripts/validate-meta-ads-publish-preflight.js" ]] || fail 'preflight_entrypoint_unavailable'
  if ! run_as_postgres /usr/bin/node "$root/orb/engine/scripts/validate-meta-ads-publish-preflight.js" >/dev/null 2>&1; then
    fail 'workflow_preflight_failed'
  fi
  emit 'preflight' "$release"
}

# A source/live preflight after a controlled compensation must run from the
# restored predecessor, but must not mint a second approval for it.  Keep the
# exception narrow: the candidate's root-owned approval can authorize only its
# direct immutable parent after that parent has become the current pointer.
action_preflight_rollback() {
  local candidate prior run_id run_attempt candidate_root prior_root
  candidate="$(read_line)"; prior="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; assert_end_of_input
  require_runtime_approval "$candidate" "$run_id" "$run_attempt"
  candidate_root="$(verified_release_root "$candidate")"
  prior_root="$(verified_release_root "$prior")"
  assert_direct_candidate_parent "$candidate_root" "$candidate" "$prior_root" "$prior"
  assert_current_root "$prior_root"
  [[ -r "$prior_root/orb/engine/scripts/validate-meta-ads-publish-preflight.js" ]] || fail 'preflight_entrypoint_unavailable'
  if ! run_as_postgres /usr/bin/node "$prior_root/orb/engine/scripts/validate-meta-ads-publish-preflight.js" >/dev/null 2>&1; then
    fail 'workflow_rollback_preflight_failed'
  fi
  emit 'preflight-rollback' "$candidate" "\"priorReleaseSha\":\"$prior\""
}

action_restore() {
  local release run_id run_attempt applied rollback checkpoint root raw summary restored
  release="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; applied="$(read_line)"; rollback="$(read_line)"; checkpoint="$(read_line)"; assert_end_of_input
  require_runtime_approval "$release" "$run_id" "$run_attempt"
  root="$(verified_release_root "$release")"; assert_current_root "$root"; require_version "$applied"; require_version "$rollback"; [[ "$applied" != "$rollback" ]] || fail 'restore_versions_equal'
  validate_checkpoint "$checkpoint"
  [[ -r "$root/scripts/runtime/rollback-meta-ads-publish-tracking-release.sh" ]] || fail 'restore_entrypoint_unavailable'
  if ! run_as_postgres /usr/bin/bash "$root/scripts/runtime/rollback-meta-ads-publish-tracking-release.sh" --source-root "$root" --expected-version "$applied" --rollback-version "$rollback" --rollback-snapshot "$checkpoint" --apply >/dev/null 2>&1; then
    fail 'workflow_restore_failed'
  fi
  raw="$(read_live_checkpoint "$root")"; summary="$(checkpoint_summary "$raw")"; restored="$(json_field "$summary" versionId)"
  require_version "$restored"; [[ "$restored" != "$applied" ]] || fail 'workflow_restore_version_unchanged'
  emit 'restore' "$release" "\"restoredVersion\":\"$restored\""
}

action_attest() {
  local release run_id run_attempt token result
  release="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; token="$(read_line)"; assert_end_of_input
  require_sha "$release"; require_run_number "$run_id"; require_run_attempt "$run_attempt"; require_oidc_token "$token"
  verified_release_root "$release" >/dev/null
  assert_attestation_helper
  if ! result="$(printf '%s\n' "$token" | run_attestation_verifier attest "$release" "$run_id" "$run_attempt" 2>/dev/null)"; then
    unset token
    fail 'workflow_attestation_failed'
  fi
  unset token
  validate_attestation_result "$result" "$release" "$run_id" "$run_attempt"
  printf '%s\n' "$result"
}

# `promote-and-apply` is the only compound native transition.  Its caller can
# authorize the immutable candidate once at the transaction boundary, then the
# root helper holds the bounded pointer transition and inactive Orb write
# together.  In particular, an OIDC approval must never expire between a
# successful pointer promotion and the version-locked apply.  This helper never
# hands the runner an arbitrary source root, script, checkpoint, or rollback
# target.
rollback_promoted_candidate_transaction() {
  local candidate_root="$1" candidate="$2" prior="$3" run_id="$4" run_attempt="$5" deadline="$6" proof rollback_timeout
  local -a args
  # The caller already loaded and validated the root-owned coordination record
  # before the pointer transition. Reuse only that private custody material for
  # the immediate inverse direct-lineage transition.
  [[ "$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)" == "$RELEASE_BASE/$candidate/source" ]] || return 1
  proof="$PROOF_ROOT/meta-ads-tracking-$candidate-$run_id-$run_attempt.json"
  export GLOBAL_COORDINATION_MISSION_ID="github:token-vault:$run_id:$run_attempt"
  export GLOBAL_COORDINATION_THREAD_ID="github-run:$run_id"
  export GLOBAL_COORDINATION_ACTOR='github-actions:skincos-native-custody'
  export SKINCOS_GLOBAL_COORDINATION_PROOF_ROOT="$PROOF_ROOT"
  export SKINCOS_GLOBAL_COORDINATION_PROOF_FILE="$proof"
  rollback_timeout="$(compound_child_timeout "$deadline" "$COMPOUND_COMPENSATION_ROLLBACK_MAX_SECONDS")" || return $?
  args=(--rollback --rollback-to-release "$prior" --expected-current-release "$candidate" --timeout-seconds "$rollback_timeout" --recover-runtime-split)
  /usr/bin/timeout --foreground --kill-after="$COMPOUND_TIMEOUT_KILL_GRACE_SECONDS" "${rollback_timeout}s" \
    "$candidate_root/scripts/runtime/promote-native-source-release.sh" "${args[@]}" >/dev/null 2>&1 || return 1
  [[ "$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)" == "$RELEASE_BASE/$prior/source" ]]
}

preflight_transaction_predecessor() {
  local prior_root="$1" deadline="$2"
  [[ -r "$prior_root/orb/engine/scripts/validate-meta-ads-publish-preflight.js" ]] || return 1
  run_compound_postgres_until "$deadline" "$COMPOUND_COMPENSATION_PREFLIGHT_MAX_SECONDS" \
    /usr/bin/node "$prior_root/orb/engine/scripts/validate-meta-ads-publish-preflight.js" >/dev/null 2>&1
}

action_promote_and_apply() {
  local candidate run_id run_attempt expected recover candidate_root prior prior_root proof current
  local pre_raw pre_summary pre_checkpoint pre_version post_raw post_summary post_version
  local restored_raw restored_summary restored_version apply_succeeded=0
  local started_at deadline now remaining promotion_timeout apply_timeout
  local -a promotion_args
  candidate="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; expected="$(read_line)"; recover="$(read_line)"; assert_end_of_input
  require_sha "$candidate"; require_run_number "$run_id"; require_run_attempt "$run_attempt"; require_version "$expected"
  [[ "$recover" == true || "$recover" == false ]] || fail 'recover_runtime_split_invalid'
  # This is intentionally the sole approval check for the compound operation.
  # Any later terminal result is therefore either a verified success, an
  # internally compensated safe failure, or an explicit unknown-state failure.
  require_runtime_approval "$candidate" "$run_id" "$run_attempt"
  started_at="$(/bin/date +%s)"
  deadline=$(( started_at + COMPOUND_TRANSACTION_BUDGET_SECONDS ))
  candidate_root="$(verified_release_root "$candidate")"
  prior="$(prior_release "$candidate_root")"
  prior_root="$(verified_release_root "$prior")"
  assert_current_root "$prior_root"

  # Validate every fixed dependency before the pointer can move.  A missing
  # entrypoint or custody directory therefore cannot create a source/live split.
  [[ -x /usr/local/sbin/skincos-meta-ads-tracking-custody ]] || fail 'installed_helper_missing'
  [[ -f "$FENCE_UNIT" && ! -L "$FENCE_UNIT" ]] || fail 'restart_fence_unavailable'
  [[ -d "$CHECKPOINT_ROOT" && ! -L "$CHECKPOINT_ROOT" ]] || fail 'checkpoint_root_unavailable'
  [[ -d "$RUNTIME_HOME/state/livia-maintenance" && ! -L "$RUNTIME_HOME/state/livia-maintenance" ]] || fail 'maintenance_root_unavailable'
  [[ -d "$PROOF_ROOT" && ! -L "$PROOF_ROOT" && -d "$FALLBACK_PROOF_ROOT" && ! -L "$FALLBACK_PROOF_ROOT" ]] || fail 'coordination_proof_root_unavailable'
  for file in \
    "$candidate_root/scripts/runtime/promote-native-source-release.sh" \
    "$candidate_root/scripts/runtime/apply-meta-ads-publish-tracking-release.sh" \
    "$candidate_root/scripts/runtime/rollback-meta-ads-publish-tracking-release.sh" \
    "$candidate_root/orb/engine/scripts/validate-meta-ads-publish-preflight.js" \
    "$prior_root/orb/engine/scripts/export-meta-ads-publish-live.js" \
    "$prior_root/orb/engine/scripts/validate-meta-ads-publish-preflight.js"; do
    [[ -r "$file" ]] || fail 'compound_transition_entrypoint_unavailable'
  done
  [[ -x "$candidate_root/scripts/runtime/promote-native-source-release.sh" ]] || fail 'native_source_promotion_entrypoint_unavailable'

  # Capture a private pre-write checkpoint through the current predecessor's
  # fixed exporter. The not-yet-promoted candidate is never executed as the
  # PostgreSQL peer merely to read its predecessor's workflow. This snapshot is
  # never returned to the runner and lets the helper compensate a database write
  # that failed after committing.
  pre_raw="$(read_live_checkpoint "$prior_root")"; pre_summary="$(checkpoint_summary "$pre_raw")"
  pre_checkpoint="$(json_field "$pre_summary" checkpoint)"; pre_version="$(json_field "$pre_summary" versionId)"
  validate_checkpoint "$pre_checkpoint"; require_version "$pre_version"
  [[ "$pre_version" == "$expected" ]] || fail 'workflow_apply_preversion_mismatch'
  now="$(/bin/date +%s)"
  remaining=$(( deadline - now ))
  promotion_timeout=$(( remaining - COMPOUND_APPLY_MAX_SECONDS - COMPOUND_POSTSTATE_RESERVE_SECONDS - COMPOUND_TIMEOUT_KILL_GRACE_SECONDS ))
  (( promotion_timeout > 0 )) || fail 'compound_outer_lease_budget_exhausted_before_promotion'
  (( promotion_timeout > COMPOUND_PROMOTION_MAX_SECONDS )) && promotion_timeout="$COMPOUND_PROMOTION_MAX_SECONDS"
  (( promotion_timeout >= 30 )) || fail 'compound_outer_lease_budget_exhausted_before_promotion'

  # Validate and load private coordination before the first source mutation so
  # the controlled inverse pointer transition can reuse exactly this custody.
  load_coordination_custody
  export GLOBAL_COORDINATION_MISSION_ID="github:token-vault:$run_id:$run_attempt"
  export GLOBAL_COORDINATION_THREAD_ID="github-run:$run_id"
  export GLOBAL_COORDINATION_ACTOR='github-actions:skincos-native-custody'
  proof="$PROOF_ROOT/meta-ads-tracking-promote-$candidate-$run_id-$run_attempt.json"
  export SKINCOS_GLOBAL_COORDINATION_PROOF_ROOT="$PROOF_ROOT"
  export SKINCOS_GLOBAL_COORDINATION_PROOF_FILE="$proof"
  promotion_args=(--release-id "$candidate" --expected-current-release "$prior" --timeout-seconds "$promotion_timeout")
  [[ "$recover" == true ]] && promotion_args+=(--recover-runtime-split)
  if ! /usr/bin/timeout --foreground --kill-after="$COMPOUND_TIMEOUT_KILL_GRACE_SECONDS" "$(( promotion_timeout + COMPOUND_TIMEOUT_KILL_GRACE_SECONDS ))s" "$candidate_root/scripts/runtime/promote-native-source-release.sh" "${promotion_args[@]}" >/dev/null 2>&1; then
    current="$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)"
    if [[ "$current" == "$RELEASE_BASE/$prior/source" ]]; then
      fail 'native_source_promotion_failed'
    fi
    if [[ "$current" == "$RELEASE_BASE/$candidate/source" ]]; then
      rollback_promoted_candidate_transaction "$candidate_root" "$candidate" "$prior" "$run_id" "$run_attempt" "$deadline" || fail 'native_source_promotion_failed_rollback_failed'
      preflight_transaction_predecessor "$prior_root" "$deadline" || fail 'native_source_promotion_failed_rollback_preflight_failed'
      fail 'native_source_promotion_failed_source_rollback'
    fi
    fail 'native_source_promotion_state_unknown'
  fi
  assert_current_root "$candidate_root"

  now="$(/bin/date +%s)"
  remaining=$(( deadline - now ))
  apply_timeout=$(( remaining - COMPOUND_POSTSTATE_RESERVE_SECONDS - COMPOUND_TIMEOUT_KILL_GRACE_SECONDS ))
  (( apply_timeout > 0 )) || {
    rollback_promoted_candidate_transaction "$candidate_root" "$candidate" "$prior" "$run_id" "$run_attempt" "$deadline" || fail 'compound_outer_lease_budget_exhausted_before_apply_source_rollback_failed'
    preflight_transaction_predecessor "$prior_root" "$deadline" || fail 'compound_outer_lease_budget_exhausted_before_apply_preflight_failed'
    fail 'compound_outer_lease_budget_exhausted_before_apply'
  }
  (( apply_timeout > COMPOUND_APPLY_MAX_SECONDS )) && apply_timeout="$COMPOUND_APPLY_MAX_SECONDS"
  (( apply_timeout >= 30 )) || {
    rollback_promoted_candidate_transaction "$candidate_root" "$candidate" "$prior" "$run_id" "$run_attempt" "$deadline" || fail 'compound_outer_lease_budget_exhausted_before_apply_source_rollback_failed'
    preflight_transaction_predecessor "$prior_root" "$deadline" || fail 'compound_outer_lease_budget_exhausted_before_apply_preflight_failed'
    fail 'compound_outer_lease_budget_exhausted_before_apply'
  }
  if /usr/bin/timeout --foreground --kill-after="$COMPOUND_TIMEOUT_KILL_GRACE_SECONDS" "${apply_timeout}s" /usr/sbin/runuser -u postgres -- env N8N_RUNTIME_HOME="$RUNTIME_HOME" /usr/bin/bash "$candidate_root/scripts/runtime/apply-meta-ads-publish-tracking-release.sh" --source-root "$candidate_root" --expected-version "$expected" --apply >/dev/null 2>&1; then
    apply_succeeded=1
  fi

  # The inner apply runs a strict final preflight, but it can still exit after a
  # PostgreSQL write. Always export the exact inactive state before deciding
  # whether the source can be restored automatically.
  if ! post_raw="$(try_read_live_checkpoint_until "$candidate_root" "$deadline")"; then
    if [[ "$apply_succeeded" == '1' ]]; then
      fail 'workflow_apply_poststate_unknown'
    fi
    fail 'workflow_apply_failed_state_unknown'
  fi
  post_summary="$(checkpoint_summary "$post_raw")"; post_version="$(json_field "$post_summary" versionId)"
  require_version "$post_version"

  # A late readback never lets the compound operation report a success after
  # its fixed cross-surface lease budget.  Do not start a restore or pointer
  # rollback here: their authority was derived from that same external lease,
  # and a late compensation could clobber a successor release. Leave the
  # runtime fail-closed for a fresh, separately leased recovery instead.
  now="$(/bin/date +%s)"
  if (( now >= deadline )); then
    fail 'compound_outer_lease_budget_expired_state_unrecovered'
  fi

  if [[ "$apply_succeeded" == '1' ]]; then
    [[ "$post_version" != "$expected" ]] || fail 'workflow_apply_version_unchanged'
    assert_current_root "$candidate_root"
    emit 'promote-and-apply' "$candidate" "\"priorReleaseSha\":\"$prior\",\"currentReleaseSha\":\"$candidate\",\"appliedVersion\":\"$post_version\""
    return
  fi

  if [[ "$post_version" == "$expected" ]]; then
    rollback_promoted_candidate_transaction "$candidate_root" "$candidate" "$prior" "$run_id" "$run_attempt" "$deadline" || fail 'workflow_apply_failed_no_mutation_source_rollback_failed'
    preflight_transaction_predecessor "$prior_root" "$deadline" || fail 'workflow_apply_failed_no_mutation_source_rollback_preflight_failed'
    fail 'workflow_apply_failed_no_mutation_source_rollback'
  fi

  # The inactive version changed despite an apply error. Restore only while the
  # guarded rollback sees that exact post-apply version, then restore the native
  # pointer and run the predecessor's strict source/live preflight.
  if ! run_compound_postgres_until "$deadline" "$COMPOUND_COMPENSATION_RESTORE_MAX_SECONDS" \
    /usr/bin/bash "$candidate_root/scripts/runtime/rollback-meta-ads-publish-tracking-release.sh" \
    --source-root "$candidate_root" --expected-version "$post_version" --rollback-version "$expected" --rollback-snapshot "$pre_checkpoint" --apply >/dev/null 2>&1; then
    fail 'workflow_apply_failed_compensation_failed'
  fi
  if ! restored_raw="$(try_read_live_checkpoint_until "$candidate_root" "$deadline")"; then
    fail 'workflow_apply_failed_compensation_unverified'
  fi
  restored_summary="$(checkpoint_summary "$restored_raw")"; restored_version="$(json_field "$restored_summary" versionId)"
  require_version "$restored_version"
  [[ "$restored_version" == "$expected" ]] || fail 'workflow_apply_failed_compensation_unverified'
  rollback_promoted_candidate_transaction "$candidate_root" "$candidate" "$prior" "$run_id" "$run_attempt" "$deadline" || fail 'workflow_apply_failed_compensated_source_rollback_failed'
  preflight_transaction_predecessor "$prior_root" "$deadline" || fail 'workflow_apply_failed_compensated_source_rollback_preflight_failed'
  fail 'workflow_apply_failed_compensated_source_rollback'
}

action_promote_native() {
  local candidate run_id run_attempt recover candidate_root prior prior_root proof
  candidate="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; recover="$(read_line)"; assert_end_of_input
  require_sha "$candidate"; require_run_number "$run_id"; require_run_attempt "$run_attempt"; [[ "$recover" == true || "$recover" == false ]] || fail 'recover_runtime_split_invalid'
  require_runtime_approval "$candidate" "$run_id" "$run_attempt"
  candidate_root="$(verified_release_root "$candidate")"; prior="$(prior_release "$candidate_root")"; prior_root="$(verified_release_root "$prior")"; assert_current_root "$prior_root"
  load_coordination_custody
  export GLOBAL_COORDINATION_MISSION_ID="github:token-vault:$run_id:$run_attempt"
  export GLOBAL_COORDINATION_THREAD_ID="github-run:$run_id"
  export GLOBAL_COORDINATION_ACTOR='github-actions:skincos-native-custody'
  proof="$PROOF_ROOT/meta-ads-tracking-promote-$candidate-$run_id-$run_attempt.json"
  export SKINCOS_GLOBAL_COORDINATION_PROOF_ROOT="$PROOF_ROOT"
  export SKINCOS_GLOBAL_COORDINATION_PROOF_FILE="$proof"
  local args=(--release-id "$candidate" --expected-current-release "$prior")
  [[ "$recover" == true ]] && args+=(--recover-runtime-split)
  if ! "$candidate_root/scripts/runtime/promote-native-source-release.sh" "${args[@]}" >/dev/null 2>&1; then
    fail 'native_source_promotion_failed'
  fi
  [[ "$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)" == "$RELEASE_BASE/$candidate/source" ]] || fail 'native_source_promotion_readback_failed'
  emit 'promote-native' "$candidate" "\"priorReleaseSha\":\"$prior\""
}

action_rollback_native() {
  local current prior run_id run_attempt recover current_root proof
  current="$(read_line)"; prior="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; recover="$(read_line)"; assert_end_of_input
  require_sha "$current"; require_sha "$prior"; require_run_number "$run_id"; require_run_attempt "$run_attempt"; [[ "$recover" == true || "$recover" == false ]] || fail 'recover_runtime_split_invalid'
  require_runtime_approval "$current" "$run_id" "$run_attempt"
  current_root="$(verified_release_root "$current")"; verified_release_root "$prior" >/dev/null; assert_current_root "$current_root"
  load_coordination_custody
  export GLOBAL_COORDINATION_MISSION_ID="github:token-vault:$run_id:$run_attempt"
  export GLOBAL_COORDINATION_THREAD_ID="github-run:$run_id"
  export GLOBAL_COORDINATION_ACTOR='github-actions:skincos-native-custody'
  proof="$PROOF_ROOT/meta-ads-tracking-$current-$run_id-$run_attempt.json"
  export SKINCOS_GLOBAL_COORDINATION_PROOF_ROOT="$PROOF_ROOT"
  export SKINCOS_GLOBAL_COORDINATION_PROOF_FILE="$proof"
  local args=(--rollback --rollback-to-release "$prior" --expected-current-release "$current")
  [[ "$recover" == true ]] && args+=(--recover-runtime-split)
  if ! "$current_root/scripts/runtime/promote-native-source-release.sh" "${args[@]}" >/dev/null 2>&1; then
    fail 'native_source_rollback_failed'
  fi
  [[ "$(readlink -f -- "$CURRENT_LINK" 2>/dev/null || true)" == "$RELEASE_BASE/$prior/source" ]] || fail 'native_source_rollback_readback_failed'
  emit 'rollback-native' "$current" "\"priorReleaseSha\":\"$prior\""
}

action_conversion_readback() {
  local release run_id run_attempt root result summary
  release="$(read_line)"; run_id="$(read_line)"; run_attempt="$(read_line)"; assert_end_of_input
  require_runtime_approval "$release" "$run_id" "$run_attempt"
  root="$(verified_release_root "$release")"; assert_current_root "$root"
  [[ -x "$root/orb/engine/scripts/run-meta-ads-conversion-contract-readback.sh" ]] || fail 'conversion_readback_entrypoint_unavailable'
  if ! result="$(/usr/bin/bash "$root/orb/engine/scripts/run-meta-ads-conversion-contract-readback.sh" 2>/dev/null)"; then
    fail 'conversion_readback_failed'
  fi
  if ! summary="$(printf '%s' "$result" | /usr/bin/node -e '
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(0, "utf8"));
if (value.ok !== true || value.diagnostic?.no_graph_mutations !== true || !Array.isArray(value.diagnostic?.graph_methods) || value.diagnostic.graph_methods.length !== 1 || value.diagnostic.graph_methods[0] !== "GET" || !Array.isArray(value.adsets) || value.errors?.length) process.exit(1);
let websiteProfiles = 0;
let requiredWebsiteEvents = 0;
let configuredWebsiteEvents = 0;
let requiredOfflineDatasets = 0;
let configuredOfflineDatasets = 0;
let requiredCreativeUrlTagFixtures = 0;
let pausedFixtureVerifiedCreativeUrlTagFixtures = 0;
let exactMatchCreativeUrlTagFixtures = 0;
for (const adset of value.adsets) {
  if (!adset || typeof adset !== "object") process.exit(1);
  const kind = String(adset.destination_kind || "");
  const website = adset.website_event || {};
  const offline = adset.offline_event_dataset || {};
  const creativeUrlTags = adset.creative_url_tags;
  if (kind === "website") {
    websiteProfiles += 1;
    if (!creativeUrlTags || typeof creativeUrlTags !== "object" || Array.isArray(creativeUrlTags) || creativeUrlTags.required !== true || creativeUrlTags.paused_fixture_verified !== true || creativeUrlTags.exact_match !== true) process.exit(1);
    requiredCreativeUrlTagFixtures += 1;
    pausedFixtureVerifiedCreativeUrlTagFixtures += 1;
    exactMatchCreativeUrlTagFixtures += 1;
  }
  if (website.required === true) { requiredWebsiteEvents += 1; if (website.configured === true) configuredWebsiteEvents += 1; else process.exit(1); }
  if (offline.required === true) { requiredOfflineDatasets += 1; if (offline.configured === true) configuredOfflineDatasets += 1; else process.exit(1); }
  if (kind === "whatsapp" && (website.required === true || offline.required === true)) process.exit(1);
}
process.stdout.write(JSON.stringify({ websiteProfiles, requiredWebsiteEvents, configuredWebsiteEvents, requiredOfflineDatasets, configuredOfflineDatasets, requiredCreativeUrlTagFixtures, pausedFixtureVerifiedCreativeUrlTagFixtures, exactMatchCreativeUrlTagFixtures }));
' 2>/dev/null)"; then
    fail 'conversion_readback_contract_invalid'
  fi
  emit 'conversion-readback' "$release" "\"summary\":$summary"
}

case "$ACTION" in
  attest) action_attest ;;
  audit) action_audit ;;
  checkpoint) action_checkpoint ;;
  discover-current) action_discover_current ;;
  checkpoint-current) action_checkpoint_current ;;
  apply) action_apply ;;
  preflight) action_preflight ;;
  preflight-rollback) action_preflight_rollback ;;
  restore) action_restore ;;
  promote-native) action_promote_native ;;
  promote-and-apply) action_promote_and_apply ;;
  rollback-native) action_rollback_native ;;
  conversion-readback) action_conversion_readback ;;
  *) fail 'action_invalid' ;;
esac
