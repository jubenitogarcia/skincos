#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
HELPER="$ROOT_DIR/scripts/runtime/provision-global-coordination-custody.sh"
META_HELPER="$ROOT_DIR/scripts/runtime/meta-ads-tracking-custody.sh"
META_ATTESTATION="$ROOT_DIR/scripts/runtime/meta-ads-tracking-custody-attestation.mjs"
INSTALLER="$ROOT_DIR/scripts/runtime/install-native-custody-runner.sh"
UNIT="$ROOT_DIR/ops/runtime/units/skincos-native-custody-runner.service"
BOOTSTRAP="$ROOT_DIR/scripts/bootstrap-native-custody-runner.ps1"
SUDOERS="$ROOT_DIR/ops/runtime/github-actions-runner/skincos-native-custody.sudoers"

valid_output="$(printf 'https://coordination.example.workers.dev\n%s\n' "$(printf 's%.0s' {1..40})" | bash "$HELPER" validate)"
[[ "$valid_output" == 'custody_input=valid' ]] || { echo 'valid custody input was rejected' >&2; exit 1; }

if printf 'http://coordination.example.workers.dev\n%s\n' "$(printf 's%.0s' {1..40})" | bash "$HELPER" validate >/dev/null 2>&1; then
  echo 'insecure coordinator URL was accepted' >&2
  exit 1
fi

if printf 'https://coordination.example.workers.dev\nshort\n' | bash "$HELPER" validate >/dev/null 2>&1; then
  echo 'short coordination secret was accepted' >&2
  exit 1
fi

bash -n "$META_HELPER"
node --check "$META_ATTESTATION"
grep -Fq "readonly RELEASE_BASE='/opt/skincos/releases'" "$META_HELPER" || {
  echo 'Meta Ads custody must pin immutable release roots' >&2
  exit 1
}
grep -Fq "readonly COORDINATION_ENV='/etc/skincos/global-coordination/orb-backup.env'" "$META_HELPER" || {
  echo 'Meta Ads custody must use the private native coordination record' >&2
  exit 1
}
grep -Fq '[[ "$(id -u)" == '\''0'\'' ]] || fail '\''root_required'\''' "$META_HELPER" || {
  echo 'Meta Ads custody must require root' >&2
  exit 1
}
for action in attest audit checkpoint discover-current checkpoint-current apply preflight preflight-rollback restore promote-native promote-and-apply rollback-native conversion-readback; do
  grep -Fq "  $action) action_${action//-/_}" "$META_HELPER" || {
    echo "Meta Ads custody action is missing: $action" >&2
    exit 1
  }
  grep -Fq "/usr/local/sbin/skincos-meta-ads-tracking-custody $action" "$SUDOERS" || {
    echo "Meta Ads sudoers action is missing: $action" >&2
    exit 1
  }
done
for action in audit checkpoint discover-current checkpoint-current apply preflight preflight-rollback restore promote-native promote-and-apply rollback-native conversion-readback; do
  action_body="$(sed -n "/^action_${action//-/_}()/,/^}/p" "$META_HELPER")"
  if ! grep -Fq 'require_runtime_approval' <<<"$action_body"; then
    echo "Meta Ads custody action is not OIDC-attested: $action" >&2
    exit 1
  fi
done
grep -Fq "readonly ATTESTATION_HELPER='/usr/local/lib/skincos/meta-ads-tracking-custody-attestation.mjs'" "$META_HELPER" || {
  echo 'Meta Ads custody must execute only the installed root-owned OIDC verifier' >&2
  exit 1
}
grep -Fq '/usr/bin/env -i PATH="$SAFE_PATH" HOME=/root' "$META_HELPER" || {
  echo 'Meta Ads custody must run the OIDC verifier with a cleared environment' >&2
  exit 1
}
grep -Fq 'META_ADS_CUSTODY_OIDC_ISSUER = "https://token.actions.githubusercontent.com"' "$META_ATTESTATION" || {
  echo 'Meta Ads OIDC verifier must pin the GitHub issuer' >&2
  exit 1
}
grep -Fq 'META_ADS_CUSTODY_WORKFLOW_REF = "jubenitogarcia/skincos/.github/workflows/deploy-token-vault.yml@refs/heads/main"' "$META_ATTESTATION" || {
  echo 'Meta Ads OIDC verifier must pin the approved production workflow provenance' >&2
  exit 1
}
grep -Fq 'META_ADS_CUSTODY_REPOSITORY_ID = "1060913632"' "$META_ATTESTATION" || {
  echo 'Meta Ads OIDC verifier must pin the immutable repository id' >&2
  exit 1
}
grep -Fq 'META_ADS_CUSTODY_OIDC_AUDIENCE_PREFIX = "skincos-meta-ads-tracking-custody/v1/release"' "$META_ATTESTATION" || {
  echo 'Meta Ads OIDC verifier must require a release-bound audience' >&2
  exit 1
}
grep -Fq 'oidc_release_binding_invalid' "$META_ATTESTATION" || {
  echo 'Meta Ads OIDC verifier must reject a token bound to another release' >&2
  exit 1
}
grep -Fq 'crypto.verify("RSA-SHA256"' "$META_ATTESTATION" || {
  echo 'Meta Ads OIDC verifier must verify the GitHub JWT signature' >&2
  exit 1
}
grep -Fq 'META_ADS_CUSTODY_APPROVAL_ROOT' "$META_ATTESTATION" || {
  echo 'Meta Ads OIDC verifier must write a root-owned approval record' >&2
  exit 1
}
grep -Fq 'prior="$(prior_release "$candidate_root")"' "$META_HELPER" || {
  echo 'Meta Ads native promotion must derive its prior release from immutable lineage' >&2
  exit 1
}
grep -Fq 'local args=(--release-id "$candidate" --expected-current-release "$prior")' "$META_HELPER" || {
  echo 'Meta Ads native promotion must invoke only the fixed candidate promotion path' >&2
  exit 1
}
checkpoint_current_body="$(sed -n '/^action_checkpoint_current()/,/^}/p' "$META_HELPER")"
grep -Fq 'require_runtime_approval "$candidate" "$run_id" "$run_attempt"' <<<"$checkpoint_current_body" || {
  echo 'candidate-scoped current checkpoint must require the candidate approval' >&2
  exit 1
}
grep -Fq 'assert_direct_candidate_parent "$candidate_root" "$candidate" "$current_root" "$current"' <<<"$checkpoint_current_body" || {
  echo 'candidate-scoped current checkpoint must prove direct candidate/current lineage' >&2
  exit 1
}
grep -Fq 'read_live_checkpoint "$current_root"' <<<"$checkpoint_current_body" || {
  echo 'candidate-scoped current checkpoint must export from the incumbent root' >&2
  exit 1
}
grep -Fq 'assert_current_root "$current_root"' <<<"$checkpoint_current_body" || {
  echo 'candidate-scoped current checkpoint must recheck the incumbent pointer after export' >&2
  exit 1
}
rollback_preflight_body="$(sed -n '/^action_preflight_rollback()/,/^}/p' "$META_HELPER")"
grep -Fq 'require_runtime_approval "$candidate" "$run_id" "$run_attempt"' <<<"$rollback_preflight_body" || {
  echo 'rollback preflight must remain candidate-approved' >&2
  exit 1
}
grep -Fq 'assert_direct_candidate_parent "$candidate_root" "$candidate" "$prior_root" "$prior"' <<<"$rollback_preflight_body" || {
  echo 'rollback preflight must be limited to the direct immutable predecessor' >&2
  exit 1
}
grep -Fq 'assert_current_root "$prior_root"' <<<"$rollback_preflight_body" || {
  echo 'rollback preflight must require the prior release to be current' >&2
  exit 1
}
apply_body="$(sed -n '/^action_apply()/,/^}/p' "$META_HELPER")"
for marker in workflow_apply_failed_no_mutation workflow_apply_failed_compensated workflow_apply_failed_state_unknown workflow_apply_failed_compensation_failed; do
  grep -Fq "$marker" <<<"$apply_body" || {
    echo "apply ambiguity guard is missing: $marker" >&2
    exit 1
  }
done
grep -Fq 'rollback-meta-ads-publish-tracking-release.sh' <<<"$apply_body" || {
  echo 'apply ambiguity guard must use the fixed guarded rollback entrypoint' >&2
  exit 1
}
compound_body="$(sed -n '/^action_promote_and_apply()/,/^}/p' "$META_HELPER")"
grep -Fqx 'readonly COMPOUND_TRANSACTION_BUDGET_SECONDS=600' "$META_HELPER" || {
  echo 'compound promote/apply must reserve a fixed margin below the outer cross-surface lease TTL' >&2
  exit 1
}
grep -Fqx 'readonly COMPOUND_PROMOTION_MAX_SECONDS=420' "$META_HELPER" || {
  echo 'compound promote/apply must bound the native pointer transition below the outer lease budget' >&2
  exit 1
}
for marker in \
  'require_runtime_approval "$candidate" "$run_id" "$run_attempt"' \
  'read_live_checkpoint "$prior_root"' \
  'promote-native-source-release.sh' \
  'apply-meta-ads-publish-tracking-release.sh' \
  'compound_outer_lease_budget_exhausted_before_promotion' \
  'compound_outer_lease_budget_exhausted_before_apply' \
  'compound_outer_lease_budget_expired_state_unrecovered' \
  'run_compound_postgres_until "$deadline" "$COMPOUND_COMPENSATION_RESTORE_MAX_SECONDS"' \
  'try_read_live_checkpoint_until "$candidate_root" "$deadline"' \
  '/usr/bin/timeout --foreground --kill-after="$COMPOUND_TIMEOUT_KILL_GRACE_SECONDS"' \
  'rollback_promoted_candidate_transaction' \
  'workflow_apply_failed_no_mutation_source_rollback' \
  'workflow_apply_failed_compensated_source_rollback' \
  'workflow_apply_failed_state_unknown'; do
  grep -Fq "$marker" <<<"$compound_body" || {
    echo "compound promote/apply custody guard is missing: $marker" >&2
    exit 1
  }
done
rollback_transaction_body="$(sed -n '/^rollback_promoted_candidate_transaction()/,/^}/p' "$META_HELPER")"
for marker in \
  'compound_child_timeout "$deadline" "$COMPOUND_COMPENSATION_ROLLBACK_MAX_SECONDS"' \
  '--timeout-seconds "$rollback_timeout"'; do
  grep -Fq -- "$marker" <<<"$rollback_transaction_body" || {
    echo "compound native rollback deadline guard is missing: $marker" >&2
    exit 1
  }
done
expiry_body="$(awk '
  /if \(\( now >= deadline \)\); then/ { capture=1 }
  capture { print }
  capture && /compound_outer_lease_budget_expired_state_unrecovered/ { exit }
' "$META_HELPER")"
if grep -Eq 'rollback-promoted|rollback_promoted_candidate_transaction|rollback-meta-ads-publish-tracking-release|run_compound_postgres_until' <<<"$expiry_body"; then
  echo 'compound promote/apply must not start automatic compensation after its external-lease deadline' >&2
  exit 1
fi
approval_line="$(grep -nF 'require_runtime_approval "$candidate" "$run_id" "$run_attempt"' <<<"$compound_body" | head -n1 | cut -d: -f1)"
promotion_line="$(grep -nF 'promote-native-source-release.sh' <<<"$compound_body" | tail -n1 | cut -d: -f1)"
[[ "$approval_line" =~ ^[0-9]+$ && "$promotion_line" =~ ^[0-9]+$ && "$approval_line" -lt "$promotion_line" ]] || {
  echo 'compound promote/apply must attest before the native source transition' >&2
  exit 1
}
grep -Fq 'action_arguments_forbidden' "$META_HELPER" || {
  echo 'Meta Ads custody must reject command arguments' >&2
  exit 1
}
grep -Fq 'stdin_record_count_invalid' "$META_HELPER" || {
  echo 'Meta Ads custody must reject extra stdin records' >&2
  exit 1
}
grep -Fq 'conversion_readback_contract_invalid' "$META_HELPER" || {
  echo 'Meta Ads custody must fail closed on diagnostic mismatch' >&2
  exit 1
}
for field in required paused_fixture_verified exact_match; do
  grep -Fq "creativeUrlTags.$field !== true" "$META_HELPER" || {
    echo "Meta Ads custody must require the authorized creative URL-tag fixture field: $field" >&2
    exit 1
  }
done
for field in requiredCreativeUrlTagFixtures pausedFixtureVerifiedCreativeUrlTagFixtures exactMatchCreativeUrlTagFixtures; do
  grep -Fq "$field" "$META_HELPER" || {
    echo "Meta Ads custody must emit the sanitized creative URL-tag fixture count: $field" >&2
    exit 1
  }
done
if grep -Eq 'eval |bash -c|/bin/sh -c|source "?\$' "$META_HELPER"; then
  echo 'Meta Ads custody must not evaluate caller-controlled shell content' >&2
  exit 1
fi

grep -Fqx 'NoNewPrivileges=false' "$UNIT" || {
  echo 'native custody runner must permit its fixed sudoers helper to elevate' >&2
  exit 1
}
grep -Fqx 'ReadWritePaths=/etc/skincos/global-coordination' "$UNIT" || {
  echo 'native custody runner must expose only the private custody directory as an additional writable path' >&2
  exit 1
}
grep -Fqx "readonly CUSTODY_DIR='/etc/skincos/global-coordination'" "$INSTALLER" || {
  echo 'native custody installer must own the custody directory bootstrap' >&2
  exit 1
}
grep -Fq 'install -d -o root -g admin -m 0750 "$CUSTODY_DIR"' "$INSTALLER" || {
  echo 'native custody installer must create the empty custody directory before systemd starts' >&2
  exit 1
}
grep -Fq 'systemctl restart "$UNIT_NAME"' "$INSTALLER" || {
  echo 'native custody installer must restart an already active runner after unit changes' >&2
  exit 1
}
grep -Fq 'meta-ads-tracking-custody.sh" "$META_ADS_CUSTODY_HELPER"' "$INSTALLER" || {
  echo 'native custody installer must install the Meta Ads helper root-side' >&2
  exit 1
}
grep -Fq 'meta-ads-tracking-custody-attestation.mjs" "$META_ADS_ATTESTATION_HELPER"' "$INSTALLER" || {
  echo 'native custody installer must install the Meta Ads OIDC verifier root-side' >&2
  exit 1
}
grep -Fq 'install -d -o root -g root -m 0700 "$META_ADS_APPROVAL_DIR"' "$INSTALLER" || {
  echo 'native custody installer must create a root-only OIDC approval directory' >&2
  exit 1
}
for writable_path in \
  '/var/lib/skincos-runtime/orb/exports/workflow-patches' \
  '/var/lib/skincos-runtime/orb/state/livia-maintenance' \
  '/var/lib/skincos-runtime/global-coordination' \
  '/var/lib/skincos-runtime/orb/global-coordination' \
  '/opt/skincos/current'; do
  grep -Fqx "ReadWritePaths=$writable_path" "$UNIT" || {
    echo "native custody unit is missing exact Meta Ads writable path: $writable_path" >&2
    exit 1
  }
done
if grep -Eq '^ReadWritePaths=/(opt|var/lib/skincos-runtime/orb|etc)$' "$UNIT"; then
  echo 'native custody unit must not broaden a protected root as writable' >&2
  exit 1
fi
grep -Fq 'skincos-meta-ads-tracking-custody' "$SUDOERS" || {
  echo 'native custody sudoers must include the bounded Meta Ads helper' >&2
  exit 1
}
grep -Fq '$standardInput = $registrationToken + [char]10' "$BOOTSTRAP" || {
  echo 'native custody bootstrap must terminate the registration token with LF, not Windows CRLF' >&2
  exit 1
}
if grep -Fq '$standardInput = $registrationToken + [Environment]::NewLine' "$BOOTSTRAP"; then
  echo 'native custody bootstrap must not use the Windows platform newline for the Bash token contract' >&2
  exit 1
fi

echo 'native custody contract checks passed'
