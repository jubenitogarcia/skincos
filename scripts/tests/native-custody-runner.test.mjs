import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = new URL("../..", import.meta.url);
const read = (relativePath) => fs.readFileSync(new URL(relativePath, root), "utf8");

test("native custody uses a trusted dispatch-only runner and a narrow root helper", () => {
  const workflow = read(".github/workflows/provision-native-global-coordination-custody.yml");
  const helper = read("scripts/runtime/provision-global-coordination-custody.sh");
  const metaAdsHelper = read("scripts/runtime/meta-ads-tracking-custody.sh");
  const metaAdsAttestation = read("scripts/runtime/meta-ads-tracking-custody-attestation.mjs");
  const installer = read("scripts/runtime/install-native-custody-runner.sh");
  const sudoers = read("ops/runtime/github-actions-runner/skincos-native-custody.sudoers");
  const unit = read("ops/runtime/units/skincos-native-custody-runner.service");

  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /runs-on: \[self-hosted, Linux, X64, skincos-native-custody\]/);
  assert.match(workflow, /SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.match(workflow, /global:orb-coordination-custody/);
  assert.match(workflow, /provision-global-coordination write/);
  assert.match(workflow, /provision-global-coordination audit/);
  assert.match(workflow, /SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY/);
  assert.match(workflow, /SKINCOS_GLOBAL_COORDINATION_KEY_ID/);
  assert.doesNotMatch(workflow, /echo .*GLOBAL_COORDINATION_SHARED_SECRET/);

  assert.match(helper, /TARGET_FILE="\$TARGET_DIR\/orb-backup\.env"/);
  assert.match(helper, /read_contract/);
  assert.match(helper, /mv -f/);
  assert.match(helper, /mode=640/);
  assert.match(helper, /validate_key_id/);
  assert.match(helper, /SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY/);
  assert.match(helper, /Usage: provision-global-coordination-custody\.sh validate\|write\|audit/);
  assert.doesNotMatch(helper, /printf .*COORDINATION_SECRET/);

  assert.match(metaAdsHelper, /readonly RELEASE_BASE='\/opt\/skincos\/releases'/);
  assert.match(metaAdsHelper, /readonly COORDINATION_ENV='\/etc\/skincos\/global-coordination\/orb-backup\.env'/);
  assert.match(metaAdsHelper, /action_arguments_forbidden/);
  assert.match(metaAdsHelper, /stdin_record_count_invalid/);
  assert.match(metaAdsHelper, /current_release_mismatch/);
  assert.match(metaAdsHelper, /conversion_readback_contract_invalid/);
  assert.match(metaAdsHelper, /creativeUrlTags\.required !== true/);
  assert.match(metaAdsHelper, /creativeUrlTags\.paused_fixture_verified !== true/);
  assert.match(metaAdsHelper, /creativeUrlTags\.exact_match !== true/);
  assert.match(metaAdsHelper, /requiredCreativeUrlTagFixtures/);
  assert.match(metaAdsHelper, /pausedFixtureVerifiedCreativeUrlTagFixtures/);
  assert.match(metaAdsHelper, /exactMatchCreativeUrlTagFixtures/);
  assert.match(metaAdsHelper, /require_runtime_approval/);
  assert.match(metaAdsHelper, /readonly ATTESTATION_HELPER='\/usr\/local\/lib\/skincos\/meta-ads-tracking-custody-attestation\.mjs'/);
  assert.match(metaAdsHelper, /\/usr\/bin\/env -i PATH="\$SAFE_PATH" HOME=\/root/);
  for (const action of ["attest", "audit", "checkpoint", "discover-current", "checkpoint-current", "apply", "preflight", "preflight-rollback", "restore", "promote-native", "promote-and-apply", "rollback-native", "conversion-readback"]) {
    assert.match(metaAdsHelper, new RegExp(`\\b${action}\\) action_${action.replaceAll("-", "_")}`));
    assert.match(sudoers, new RegExp(`/usr/local/sbin/skincos-meta-ads-tracking-custody ${action}(?:,|\\s|$)`));
  }
  for (const action of ["audit", "checkpoint", "discover-current", "checkpoint-current", "apply", "preflight", "preflight-rollback", "restore", "promote-native", "promote-and-apply", "rollback-native", "conversion-readback"]) {
    assert.match(metaAdsHelper, new RegExp(`action_${action.replaceAll("-", "_")}\\(\\) \\{[\\s\\S]*?require_runtime_approval`));
  }
  assert.match(metaAdsHelper, /action_promote_native\(\)[\s\S]*?prior="\$\(prior_release "\$candidate_root"\)"[\s\S]*?--release-id "\$candidate" --expected-current-release "\$prior"/);
  assert.match(metaAdsHelper, /action_checkpoint_current\(\)[\s\S]*?require_runtime_approval "\$candidate" "\$run_id" "\$run_attempt"[\s\S]*?assert_direct_candidate_parent "\$candidate_root" "\$candidate" "\$current_root" "\$current"[\s\S]*?read_live_checkpoint "\$current_root"[\s\S]*?assert_current_root "\$current_root"/);
  assert.match(metaAdsHelper, /action_preflight_rollback\(\)[\s\S]*?require_runtime_approval "\$candidate" "\$run_id" "\$run_attempt"[\s\S]*?assert_direct_candidate_parent "\$candidate_root" "\$candidate" "\$prior_root" "\$prior"[\s\S]*?assert_current_root "\$prior_root"/);
  assert.match(metaAdsHelper, /action_promote_and_apply\(\)[\s\S]*?require_runtime_approval "\$candidate" "\$run_id" "\$run_attempt"[\s\S]*?read_live_checkpoint "\$prior_root"[\s\S]*?promote-native-source-release\.sh[\s\S]*?apply-meta-ads-publish-tracking-release\.sh[\s\S]*?rollback_promoted_candidate_transaction/);
  assert.match(metaAdsHelper, /readonly COMPOUND_TRANSACTION_BUDGET_SECONDS=600/);
  assert.match(metaAdsHelper, /compound_child_timeout "\$deadline" "\$COMPOUND_COMPENSATION_ROLLBACK_MAX_SECONDS"/);
  assert.match(metaAdsHelper, /--timeout-seconds "\$rollback_timeout"/);
  assert.match(metaAdsHelper, /compound_outer_lease_budget_expired_state_unrecovered/);
  assert.match(metaAdsHelper, /workflow_apply_failed_no_mutation_source_rollback/);
  assert.match(metaAdsHelper, /workflow_apply_failed_compensated_source_rollback/);
  assert.match(metaAdsHelper, /workflow_apply_failed_state_unknown/);
  assert.match(metaAdsHelper, /workflow_apply_failed_no_mutation/);
  assert.match(metaAdsHelper, /workflow_apply_failed_compensated/);
  assert.match(metaAdsHelper, /workflow_apply_failed_state_unknown/);
  assert.match(metaAdsHelper, /rollback-meta-ads-publish-tracking-release\.sh/);
  assert.match(metaAdsAttestation, /META_ADS_CUSTODY_OIDC_ISSUER = "https:\/\/token\.actions\.githubusercontent\.com"/);
  assert.match(metaAdsAttestation, /META_ADS_CUSTODY_WORKFLOW_REF = "jubenitogarcia\/skincos\/\.github\/workflows\/deploy-token-vault\.yml@refs\/heads\/main"/);
  assert.match(metaAdsAttestation, /META_ADS_CUSTODY_REPOSITORY_ID = "1060913632"/);
  assert.match(metaAdsAttestation, /META_ADS_CUSTODY_OIDC_AUDIENCE_PREFIX = "skincos-meta-ads-tracking-custody\/v1\/release"/);
  assert.match(metaAdsAttestation, /oidc_release_binding_invalid/);
  assert.match(metaAdsAttestation, /custodyOidcAudience\(releaseSha\)/);
  assert.match(metaAdsAttestation, /payload\.environment !== "production"/);
  assert.match(metaAdsAttestation, /payload\.run_attempt/);
  assert.match(metaAdsAttestation, /crypto\.verify\("RSA-SHA256"/);
  assert.match(metaAdsAttestation, /META_ADS_CUSTODY_APPROVAL_ROOT/);
  assert.doesNotMatch(metaAdsAttestation, /process\.env\.(?:JWKS|OIDC|APPROVAL)/);
  assert.doesNotMatch(metaAdsHelper, /eval |bash -c|\/bin\/sh -c/);

  assert.match(installer, /useradd --system/);
  assert.match(installer, /--shell \/usr\/sbin\/nologin/);
  assert.match(installer, /visudo -cf/);
  assert.match(installer, /--token "\$RUNNER_TOKEN"/);
  assert.match(sudoers, /skincos-actions ALL=\(root\) NOPASSWD/);
  assert.match(sudoers, /skincos-provision-global-coordination/);
  assert.match(sudoers, /skincos-meta-ads-tracking-custody/);
  assert.doesNotMatch(sudoers, /systemctl|bash|sh -c|\/bin\/sudo/);
  assert.match(installer, /meta-ads-tracking-custody\.sh/);
  assert.match(installer, /meta-ads-tracking-custody-attestation\.mjs/);
  assert.match(installer, /META_ADS_APPROVAL_DIR/);
  assert.match(installer, /META_ADS_CHECKPOINT_DIR/);
  assert.match(installer, /orb-restart-fence\.service/);
  for (const writablePath of [
    "/var/lib/skincos-runtime/orb/exports/workflow-patches",
    "/var/lib/skincos-runtime/orb/state/livia-maintenance",
    "/var/lib/skincos-runtime/global-coordination",
    "/var/lib/skincos-runtime/orb/global-coordination",
    "/opt/skincos/current",
  ]) assert.match(unit, new RegExp(`^ReadWritePaths=${writablePath.replaceAll("/", "\\/")}$`, "m"));
  assert.doesNotMatch(unit, /^ReadWritePaths=\/(?:opt|var\/lib\/skincos-runtime\/orb|etc)$/m);
});
