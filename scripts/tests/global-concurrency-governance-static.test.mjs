import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadPolicy, validatePolicy } from "../../.github/scripts/validate-cloudflare-single-writer.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function compositeActionBash(source) {
  const marker = "      run: |\n";
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, "missing composite-action Bash block");
  return source.slice(start + marker.length)
    .split("\n")
    .map((line) => line.startsWith("        ") ? line.slice(8) : line)
    .join("\n");
}

function jobBlock(workflow, jobName) {
  const start = workflow.indexOf(`  ${jobName}:`);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);
  const remainder = workflow.slice(start + 1);
  const next = remainder.search(/\n  [A-Za-z0-9_-]+:/);
  return next === -1 ? remainder : remainder.slice(0, next);
}

test("Cloudflare mutators have one fail-closed writer group and no unclassified workflow", () => {
  const policy = loadPolicy();
  assert.deepEqual(validatePolicy(policy), []);
  assert.equal(policy.authority.coordinationPlane, "global");
  assert.equal(policy.authority.mode, "fail-closed");
  assert.equal(policy.pagesGitIntegration.automaticDeploymentsMustBeDisabled, true);
  const crm = policy.coordinationGroups.find((group) => group.id === "crm-cloudflare-writer");
  assert.equal(crm.resource, "global:crm-cloudflare-writer");
  const pontoWorkers = policy.coordinationGroups.find((group) => group.id === "ponto-workers-writer");
  assert.equal(pontoWorkers.resource, "global:ponto-workers-writer");
  assert.equal(policy.coordinationGroups.some((group) => group.id === "token-vault-staging-writer"), false);
  assert.equal(policy.surfaces.some((surface) => surface.id === "token-vault-staging-shadow"), false);
  assert.match(read(".github/workflows/deploy-crm-pages.yml"), /resource: global:crm-cloudflare-writer/);
  assert.match(read(".github/workflows/cloudflare-pages-sync-ponto.yml"), /global_resource: global:crm-cloudflare-writer/);
  assert.match(read(".github/workflows/cloudflare-workers-sync-ponto-secrets.yml"), /global_resource: global:ponto-workers-writer/);
  const coordinator = read(".github/workflows/deploy-global-coordinator.yml");
  assert.match(coordinator, /global-coordinator-deployment-guard\.mjs/);
  assert.match(coordinator, /global:global-coordinator-writer/);
  assert.match(coordinator, /wrangler@4\.120\.0/);
  assert.match(coordinator, /COORDINATION_SHARED_SECRET/);
  assert.match(coordinator, /COORDINATION_ADMIN_SECRET/);
  assert.match(coordinator, /SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL/);
  assert.match(coordinator, /versions deploy/);
  assert.match(coordinator, /environment: \$\{\{ inputs\.target \}\}/);
  assert.equal((coordinator.match(/^\s+COORDINATION_PREVIOUS_KEY_ID:/gm) || []).length, 1);
  assert.equal((coordinator.match(/^\s+COORDINATION_PREVIOUS_KEY_EXPIRES_AT:/gm) || []).length, 1);
  assert.match(coordinator, /signed coordination gate retry/);
  assert.match(coordinator, /gateAttempts <= 6/);
  const coordinatorSurface = policy.surfaces.find((surface) => surface.id === "global-coordination-plane");
  assert.equal(coordinatorSurface.canonicalDeployWorkflow, ".github/workflows/deploy-global-coordinator.yml");
  assert.equal(coordinatorSurface.coordinationGroup, "global-coordinator-writer");
});

test("Token Vault has one immutable Worker and D1 publisher with explicit tracking-fixture custody", () => {
  const policy = loadPolicy();
  const group = policy.coordinationGroups.find((entry) => entry.id === "token-vault-writer");
  assert.equal(group?.resource, "release:token-vault");
  const surface = policy.surfaces.find((entry) => entry.id === "token-vault-worker-and-d1");
  assert.equal(surface?.canonicalDeployWorkflow, ".github/workflows/deploy-token-vault.yml");
  assert.equal(surface?.coordinationGroup, "token-vault-writer");
  assert.deepEqual(surface?.mutationWorkflows, [
    ".github/workflows/deploy-token-vault.yml",
    ".github/workflows/influencer-intelligence-staging-shadow.yml",
  ]);

  const catalog = JSON.parse(read("platform/deploy/operational-units.json"));
  const tokenVaultUnit = catalog.units.find((unit) => unit.id === "token-vault");
  assert.ok(tokenVaultUnit);
  assert.ok(!catalog.nonPublishingSurfaces.some((entry) => entry.id === "token-vault"));
  assert.ok(tokenVaultUnit.resources.includes("Governed Meta Ads staging synthetic source attestation, seed, bootstrap derivation, rollback journal and paused creative fixture"));
  assert.ok(tokenVaultUnit.secrets.includes("TOKEN_VAULT_META_ADS_CONFIG_TOKEN"));
  assert.ok(tokenVaultUnit.secrets.includes("TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST"));
  assert.ok(tokenVaultUnit.secrets.includes("META_ADS_ACCESS_TOKEN"));
  assert.ok(tokenVaultUnit.secrets.includes("META_PIXEL_ID"));
  assert.ok(!tokenVaultUnit.secrets.includes("TOKEN_VAULT_BACKUP_PASSPHRASE"));
  assert.equal(tokenVaultUnit.promotion.trackingFixture, "synthetic authorized ad-set profile required before staging");
  assert.equal(tokenVaultUnit.promotion.trackingBootstrap, "empty staging authority uses a candidate-only Graph-read attestation before a restricted one-shot synthetic seed; legacy authority uses restricted config bearer plus hash-bound internal derivation or protected entries override");
  assert.equal(tokenVaultUnit.promotion.d1Recovery, "Time Travel bookmark; manual restore only under release:token-vault");

  const workflow = read(".github/workflows/deploy-token-vault.yml");
  for (const marker of [
    "unit: token-vault",
    "release:token-vault",
    "confirm_staging_tracking_fixture",
    "ENABLE_TOKEN_VAULT_DEPLOY_STAGING",
    "ENABLE_TOKEN_VAULT_PRODUCTION_DEPLOY",
    "TOKEN_VAULT_META_ADS_CONFIG_TOKEN",
    "TOKEN_VAULT_N8N_API_TOKEN",
    "TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST",
    "Capture Token Vault D1 Time Travel recovery bookmark before migrations",
    "d1 time-travel info",
    "d1 time-travel restore",
    "manual_restore_under_release_lease",
    "Apply additive Token Vault migrations atomically",
    "versions upload",
    "--secrets-file",
    "--strict",
    "versions deploy",
    "promotion-evidence-token-vault",
    "/v1/meta-ads-publish/config/bootstrap/derive-plan",
    "/v1/meta-ads-publish/config/bootstrap/derive",
    "/v1/meta-ads-publish/config/bootstrap/rollback",
  ]) assert.match(workflow, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-check/);
  assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-release/);
  assert.doesNotMatch(workflow, /\bsecret\s+put\b/);
  assert.doesNotMatch(workflow, /secrets:\s*inherit/);
  assert.doesNotMatch(workflow, /TOKEN_VAULT_BACKUP_PASSPHRASE/);
  for (const legacySecret of [
    "TOKEN_VAULT_API_TOKEN",
    "TOKEN_VAULT_ENCRYPTION_KEY",
  ]) {
    assert.doesNotMatch(workflow, new RegExp(`secrets\\.${legacySecret}`));
  }
  assert.match(workflow, /inputs\.target == 'staging' && secrets\.TOKEN_VAULT_N8N_API_TOKEN \|\| ''/);
  assert.doesNotMatch(workflow, /TOKEN_VAULT_N8N_API_TOKEN:\s*\$\{\{\s*secrets\.TOKEN_VAULT_N8N_API_TOKEN\s*}}/);
  assert.match(workflow, /versions upload[\s\S]*?--keep-vars[\s\S]*?--strict[\s\S]*?--secrets-file/);
  assert.match(workflow, /legacy alpha backend; Time Travel recovery is unavailable and the release is ineligible/);
  assert.ok(workflow.indexOf("Capture Token Vault D1 Time Travel recovery bookmark before migrations") < workflow.indexOf("Apply additive Token Vault migrations atomically"));
  assert.ok(workflow.indexOf("Check Token Vault release lease before version upload") < workflow.indexOf("Upload immutable Token Vault version"));
  const release = jobBlock(workflow, "release");
  const orbContract = jobBlock(workflow, "orb_contract");
  assert.match(release, /needs: promotion/);
  assert.match(release, /Cross-SHA Token Vault rollback is fail-closed/);
  assert.match(release, /Export immutable Worker and incumbent identities for the activation gate/);
  assert.match(release, /Activate only the selected Token Vault version in staging[\s\S]*?if: inputs\.target == 'staging'/);
  assert.doesNotMatch(release, /for name [^\n]*TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST/);
  assert.match(release, /Object\.keys\(manifest\)\.length !== 1/);
  assert.match(release, /TOKEN_VAULT_N8N_API_TOKEN must be owned by the staging Environment/);
  assert.match(release, /if \[\[ "\$TARGET" == staging \]\]; then[\s\S]*?TOKEN_VAULT_N8N_API_TOKEN/);
  assert.match(release, /if \(process\.env\.TARGET === 'production'\) requiredInherited\.push\('TOKEN_VAULT_N8N_API_TOKEN'\)/);
  assert.match(release, /if \(process\.env\.TARGET === 'staging'\) \{[\s\S]*?secrets\.TOKEN_VAULT_N8N_API_TOKEN/);
  assert.match(release, /META_ADS_CONFIG_VALUE="\$\{TOKEN_VAULT_META_ADS_CONFIG_TOKEN:-\}"/);
  assert.match(release, /if \(configToken\) secrets\.TOKEN_VAULT_META_ADS_CONFIG_TOKEN = configToken/);
  assert.match(release, /Token Vault Meta Ads config bearer must be printable ASCII without BOM or control characters/);
  const printableAsciiBearer = /^[\x21-\x7e]+$/;
  assert.equal(printableAsciiBearer.test('opaque-bearer_123'), true);
  assert.equal(printableAsciiBearer.test('\uFEFFopaque-bearer_123'), false);
  assert.equal(printableAsciiBearer.test('opaque\nbearer'), false);
  assert.match(release, /Version Preview URL:/);
  assert.match(release, /expected_preview_suffix='-skincos-token-vault-staging\.skincos\.workers\.dev'/);
  assert.match(release, /expected_preview_suffix='-skincos-token-vault\.skincos\.workers\.dev'/);
  assert.match(release, /grep -F -x "\$expected_preview_url"/);
  assert.match(release, /Verify immutable Token Vault candidate config bearer before traffic/);
  assert.match(release, /Token Vault immutable candidate config bearer did not authenticate before traffic/);
  assert.match(release, /config_authority_mode=\$\{authority\.mode\}/);
  assert.match(release, /config_authority_revision=\$\{authority\.revision\}/);
  assert.match(release, /Seal a private or internally-derived legacy Token Vault bootstrap plan before traffic/);
  assert.match(release, /CANDIDATE_CONFIG_AUTHORITY_MODE: \$\{\{ steps\.candidate_config_bearer\.outputs\.config_authority_mode \}\}/);
  assert.match(release, /CANDIDATE_CONFIG_AUTHORITY_REVISION: \$\{\{ steps\.candidate_config_bearer\.outputs\.config_authority_revision \}\}/);
  assert.match(release, /outputs\.config_authority_mode == 'legacy_bootstrap' && secrets\.TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST \|\| ''/);
  assert.match(release, /Token Vault tracking-ready candidate must not receive a bootstrap manifest/);
  assert.match(release, /Token Vault bootstrap manifest has an unsafe entry envelope/);
  assert.match(release, /Token Vault bootstrap manifest has an unsafe Website entry/);
  assert.match(release, /forbiddenUrlTagKeyPattern/);
  assert.match(release, /mode === 'tracking_ready'/);
  assert.match(release, /mode === 'legacy_bootstrap'/);
  assert.match(release, /signal: AbortSignal\.timeout\(10_000\)/);
  assert.match(release, /signal: AbortSignal\.timeout\(20_000\)/);
  assert.match(release, /TOKEN_VAULT_CANDIDATE_PREVIEW_URL=\$CANDIDATE_PREVIEW_URL/);
  assert.match(release, /process\.env\.TOKEN_VAULT_CANDIDATE_PREVIEW_URL/);
  assert.match(release, /\/v1\/meta-ads-publish\/config\/bootstrap\/derive-plan/);
  assert.match(release, /bootstrap_strategy=\$\{strategy\}/);
  assert.match(release, /bootstrap_plan_revision=\$\{authorityRevision\}/);
  assert.match(release, /bootstrap_manifest_sha256=\$\{manifestSha256\}/);
  assert.ok(release.indexOf("Verify immutable Token Vault candidate config bearer before traffic") < release.indexOf("Activate only the selected Token Vault version in staging"));
  assert.ok(release.indexOf("Verify immutable Token Vault candidate config bearer before traffic") < release.indexOf("Seal a private or internally-derived legacy Token Vault bootstrap plan before traffic"));
  assert.ok(release.indexOf("Seal a private or internally-derived legacy Token Vault bootstrap plan before traffic") < release.indexOf("Validate sealed Token Vault bootstrap plan before staging traffic"));
  assert.ok(release.indexOf("Validate sealed Token Vault bootstrap plan before staging traffic") < release.indexOf("Activate only the selected Token Vault version in staging"));
  assert.ok(release.indexOf("Validate sealed Token Vault bootstrap plan before staging traffic") < release.indexOf("Check Token Vault release lease before staging version deployment"));
  assert.match(release, /Wait for staging Token Vault route to accept the candidate config bearer/);
  assert.match(release, /Token Vault staging route did not accept the candidate config bearer before bootstrap/);
  assert.ok(release.indexOf("Read back the exact active Token Vault Worker version in staging") < release.indexOf("Wait for staging Token Vault route to accept the candidate config bearer"));
  assert.ok(release.indexOf("Wait for staging Token Vault route to accept the candidate config bearer") < release.indexOf("Bootstrap legacy Token Vault Meta Ads configuration only when staging requires it"));
  assert.match(release, /steps\.staging_route_auth_convergence\.outcome == 'success'/);
  assert.match(orbContract, /Wait for production Token Vault route to accept the candidate config bearer/);
  assert.match(orbContract, /Token Vault production route did not accept the candidate config bearer before bootstrap/);
  assert.ok(orbContract.indexOf("Read back the exact active Token Vault Worker version after the native Orb apply") < orbContract.indexOf("Wait for production Token Vault route to accept the candidate config bearer"));
  assert.ok(orbContract.indexOf("Wait for production Token Vault route to accept the candidate config bearer") < orbContract.indexOf("Bootstrap legacy Token Vault Meta Ads configuration only when production requires it"));
  assert.match(orbContract, /steps\.production_route_auth_convergence\.outcome == 'success'/);
  assert.match(orbContract, /steps\.production_route_auth_convergence\.outcome != 'success'/);
  assert.match(release, /expected_config_authority_revision: expectedRevision/);
  assert.match(release, /entries: manifest\.entries/);
  assert.equal((workflow.match(/import \{ createHash \} from 'node:crypto';/g) || []).length, 3);
  assert.match(release, /expected_manifest_sha256: planDigest/);
  assert.match(release, /\/v1\/meta-ads-publish\/config\/bootstrap\/derive/);
  assert.match(release, /BOOTSTRAP_STRATEGY: \$\{\{ steps\.candidate_bootstrap_plan\.outputs\.bootstrap_strategy \}\}/);
  assert.match(release, /BOOTSTRAP_PLAN_REVISION: \$\{\{ steps\.candidate_bootstrap_plan\.outputs\.bootstrap_plan_revision \}\}/);
  assert.match(release, /BOOTSTRAP_MANIFEST_SHA256: \$\{\{ steps\.candidate_bootstrap_plan\.outputs\.bootstrap_manifest_sha256 \}\}/);
  assert.match(release, /bootstrap_operation_key="meta-ads-bootstrap:\$\{RELEASE_SHA:0:12\}:\$\{GITHUB_RUN_ID\}:\$\{GITHUB_RUN_ATTEMPT\}"/);
  assert.match(release, /did_bootstrap=true/);
  assert.match(release, /bootstrap_operation_key=\$bootstrap_recorded_operation_key/);
  assert.match(release, /bootstrap_revision=\$bootstrap_revision/);
  assert.match(release, /mode === 'tracking_ready'/);
  assert.match(release, /mode === 'legacy_bootstrap'/);
  assert.match(release, /\/v1\/meta-ads-publish\/config\/bootstrap/);
  assert.match(release, /\/v1\/meta-ads-publish\/config\/bootstrap\/rollback/);
  assert.match(release, /payload\?\.rolled_back !== true/);
  assert.match(release, /payload\?\.operation_status !== 'rolled_back'/);
  assert.equal((workflow.match(/const postBootstrap = await request\('\/v1\/meta-ads-publish\/config'\);/g) || []).length, 2);
  assert.equal((workflow.match(/process\.stdout\.write\(`applied\\t\$\{operationKey\}\\t\$\{bootstrapRevision\}\\n`\);/g) || []).length, 2);
  assert.equal((workflow.match(/id: tracking_bootstrap_rollback/g) || []).length, 2);
  assert.equal((workflow.match(/\/v1\/meta-ads-publish\/config\/bootstrap\/rollback/g) || []).length, 2);
  assert.doesNotMatch(release, /process\.stdout\.write\([^\n]*manifest/i);
  assert.doesNotMatch(release, /GITHUB_OUTPUT[^\n]*(?:entries|summary|TOKEN_VAULT_META_ADS_BOOTSTRAP_MANIFEST)/i);
  assert.ok(release.indexOf("Upload immutable Token Vault version") < release.indexOf("Activate only the selected Token Vault version in staging"));
  assert.ok(release.indexOf("Read back the exact active Token Vault Worker version in staging") < release.indexOf("Bootstrap legacy Token Vault Meta Ads configuration only when staging requires it"));
  assert.ok(release.indexOf("Bootstrap legacy Token Vault Meta Ads configuration only when staging requires it") < release.indexOf("Read back staging Token Vault deployment and authenticated health"));
  assert.ok(release.indexOf("Roll back an applied Token Vault legacy bootstrap before staging Worker compensation") < release.indexOf("Compensate the staging Worker only when this release still owns traffic"));
  assert.match(orbContract, /needs: \[promotion, release\]/);
  assert.match(orbContract, /RELEASE_SHA: \$\{\{ needs\.promotion\.outputs\.source_sha \}\}/);
  assert.match(orbContract, /BOOTSTRAP_STRATEGY: \$\{\{ needs\.release\.outputs\.bootstrap_strategy \}\}/);
  assert.match(orbContract, /BOOTSTRAP_PLAN_REVISION: \$\{\{ needs\.release\.outputs\.bootstrap_plan_revision \}\}/);
  assert.match(orbContract, /BOOTSTRAP_MANIFEST_SHA256: \$\{\{ needs\.release\.outputs\.bootstrap_manifest_sha256 \}\}/);
  assert.match(orbContract, /Validate sealed Token Vault bootstrap plan before native mutation/);
  assert.ok(orbContract.indexOf("Validate sealed Token Vault bootstrap plan before native mutation") < orbContract.indexOf("Attest the already staged immutable candidate through GitHub OIDC"));
  assert.match(orbContract, /id-token: write/);
  assert.match(orbContract, /Attest the already staged immutable candidate through GitHub OIDC/);
  assert.match(orbContract, /Capture the complete incumbent inactive Orb checkpoint before compound transition/);
  assert.match(orbContract, /skincos-meta-ads-tracking-custody checkpoint-current/);
  assert.match(orbContract, /skincos-meta-ads-tracking-custody promote-and-apply/);
  assert.match(orbContract, /skincos-meta-ads-tracking-custody restore/);
  assert.match(orbContract, /skincos-meta-ads-tracking-custody rollback-native/);
  assert.match(orbContract, /skincos-meta-ads-tracking-custody preflight-rollback/);
  assert.match(orbContract, /skincos-meta-ads-tracking-custody conversion-readback/);
  assert.match(orbContract, /Refresh candidate OIDC custody approval before pre-Worker native readback/);
  assert.match(orbContract, /Refresh candidate OIDC custody approval before Graph conversion readback/);
  assert.match(orbContract, /Refresh candidate OIDC custody approval before restoring the owned Orb snapshot/);
  assert.match(orbContract, /Refresh candidate OIDC custody approval before restoring the native source/);
  assert.match(orbContract, /Refresh candidate OIDC custody approval before predecessor preflight/);
  assert.doesNotMatch(orbContract, /sudo -n -u postgres/);
  assert.doesNotMatch(orbContract, /\$SOURCE_ROOT\/scripts\//);
  assert.ok(orbContract.indexOf("Promote and apply the version-checked inactive Meta Ads tracking workflow atomically") < orbContract.indexOf("Read back the promoted native Orb source and live workflow before Worker activation"));
  assert.ok(orbContract.indexOf("Refresh candidate OIDC custody approval before pre-Worker native readback") < orbContract.indexOf("Read back the promoted native Orb source and live workflow before Worker activation"));
  assert.ok(orbContract.indexOf("Read back the promoted native Orb source and live workflow before Worker activation") < orbContract.indexOf("Activate the exact immutable Token Vault Worker after native Orb readback"));
  assert.ok(orbContract.indexOf("Read back the exact active Token Vault Worker version after the native Orb apply") < orbContract.indexOf("Bootstrap legacy Token Vault Meta Ads configuration only when production requires it"));
  assert.ok(orbContract.indexOf("Bootstrap legacy Token Vault Meta Ads configuration only when production requires it") < orbContract.indexOf("Read back production Token Vault authenticated health after activation"));
  assert.ok(orbContract.indexOf("Roll back an applied Token Vault legacy bootstrap before cross-surface compensation") < orbContract.indexOf("Refresh candidate OIDC custody approval before cross-surface compensation"));
  assert.ok(orbContract.indexOf("Roll back an applied Token Vault legacy bootstrap before cross-surface compensation") < orbContract.indexOf("Compensate the production Worker first only when this release still owns traffic"));
  assert.ok(orbContract.indexOf("Activate the exact immutable Token Vault Worker after native Orb readback") < orbContract.indexOf("Revalidate final native Orb source and live workflow after Worker activation"));
  assert.ok(orbContract.indexOf("Revalidate final native Orb source and live workflow after Worker activation") < orbContract.indexOf("Refresh candidate OIDC custody approval before Graph conversion readback"));
  assert.ok(orbContract.indexOf("Refresh candidate OIDC custody approval before Graph conversion readback") < orbContract.indexOf("Read back required Website conversion and offline-dataset contracts from Graph"));
  assert.ok(orbContract.indexOf("Compensate the production Worker first only when this release still owns traffic") < orbContract.indexOf("Read back the incumbent Token Vault version and public auth boundary before restoring the Orb snapshot"));
  assert.ok(orbContract.indexOf("Read back the incumbent Token Vault version and public auth boundary before restoring the Orb snapshot") < orbContract.indexOf("Revalidate the shared lease before restoring the owned Orb snapshot"));
  assert.ok(orbContract.indexOf("Revalidate the shared lease before restoring the owned Orb snapshot") < orbContract.indexOf("Refresh candidate OIDC custody approval before restoring the owned Orb snapshot"));
  assert.ok(orbContract.indexOf("Refresh candidate OIDC custody approval before restoring the owned Orb snapshot") < orbContract.indexOf("Restore the pre-apply Orb snapshot only after the Worker incumbent readback"));
  assert.ok(orbContract.indexOf("Restore the pre-apply Orb snapshot only after the Worker incumbent readback") < orbContract.indexOf("Restore the prior immutable native source after the Worker and Orb rollback"));
  assert.ok(orbContract.indexOf("Restore the pre-apply Orb snapshot only after the Worker incumbent readback") < orbContract.indexOf("Revalidate the shared lease before restoring the native source"));
  assert.ok(orbContract.indexOf("Revalidate the shared lease before restoring the native source") < orbContract.indexOf("Refresh candidate OIDC custody approval before restoring the native source"));
  assert.ok(orbContract.indexOf("Refresh candidate OIDC custody approval before restoring the native source") < orbContract.indexOf("Restore the prior immutable native source after the Worker and Orb rollback"));
  assert.ok(orbContract.indexOf("Restore the prior immutable native source after the Worker and Orb rollback") < orbContract.indexOf("Refresh candidate OIDC custody approval before predecessor preflight"));
  assert.ok(orbContract.indexOf("Refresh candidate OIDC custody approval before predecessor preflight") < orbContract.indexOf("Revalidate the restored predecessor source after Worker and Orb rollback"));
  assert.doesNotMatch(orbContract, /source-only compensation/);
  assert.doesNotMatch(workflow, /\n  orb_readback:/);

  const globalPolicy = JSON.parse(read("ops/governance/global-concurrency-policy.json"));
  assert.ok(globalPolicy.releaseClosures["token-vault"].patterns.includes("platform/security/token-vault/**"));
  assert.ok(globalPolicy.releaseClosures["token-vault"].patterns.includes("scripts/runtime/apply-meta-ads-publish-tracking-release.sh"));
  assert.ok(globalPolicy.releaseClosures["token-vault"].patterns.includes("scripts/runtime/rollback-meta-ads-publish-tracking-release.sh"));
  assert.ok(globalPolicy.releaseClosures["token-vault"].patterns.includes("scripts/runtime/meta-ads-tracking-custody.sh"));
  assert.ok(globalPolicy.releaseClosures["token-vault"].patterns.includes("scripts/runtime/install-native-custody-runner.sh"));
  assert.ok(globalPolicy.releaseClosures["token-vault"].patterns.includes("scripts/runtime/test-native-custody-contract.sh"));
  assert.ok(globalPolicy.releaseClosures["token-vault"].patterns.includes("scripts/runtime/promote-native-source-release.sh"));
  assert.ok(globalPolicy.releaseClosures["token-vault"].patterns.includes("scripts/runtime/test-promote-native-source-release.sh"));
  assert.ok(globalPolicy.releaseClosures["token-vault"].patterns.includes(".github/workflows/influencer-intelligence-staging-shadow.yml"));
  const shadow = read(".github/workflows/influencer-intelligence-staging-shadow.yml");
  assert.match(shadow, /group: deploy-token-vault-staging/);
  assert.match(shadow, /resource: release:token-vault/);
  assert.doesNotMatch(shadow, /global:token-vault-staging/);
  assert.match(workflow, /Revalidate final native Orb source and live workflow after Worker activation/);
  assert.match(workflow, /Read back required Website conversion and offline-dataset contracts from Graph/);
  assert.match(workflow, /requiredCreativeUrlTagFixtures/);
  assert.match(workflow, /pausedFixtureVerifiedCreativeUrlTagFixtures/);
  assert.match(workflow, /exactMatchCreativeUrlTagFixtures/);
  assert.match(workflow, /production Token Vault tracking configuration readback is incomplete/);
  assert.match(workflow, /\/v1\/meta-ads-publish\/config\/bootstrap/);
  assert.match(workflow, /config_authority_mode/);
  assert.match(workflow, /legacy_bootstrap/);
  assert.match(workflow, /tracking_ready/);
  assert.equal((workflow.match(/steps\.tracking_bootstrap\.outcome != 'success'/g) || []).length, 2);
  assert.match(workflow, /Exercise reversible Meta tracking reconciliation against the isolated staging fixture/);
  assert.match(workflow, /\/v1\/meta-ads-publish\/config\/staging-exercise/);
  assert.match(workflow, /reconciled_and_rolled_back/);
  assert.match(workflow, /fixture_count !== 1/);
  assert.match(workflow, /operation_key: `staging-tracking-fixture:\$\{nonce\}`/);
  assert.doesNotMatch(workflow, /\/v1\/meta-ads-publish\/runs/);
  assert.match(workflow, /Revalidate the release lease before staging Worker compensation/);
  assert.match(workflow, /Validate immutable Token Vault preview source/);
  assert.match(workflow, /if: \$\{\{ inputs\.target != 'preview' \}\}/);
});

test("direct Ponto recovery jobs use remote custody at every governed boundary", () => {
  const workflow = read(".github/workflows/ponto-progressive-release.yml");
  for (const jobName of ["recovery-latch", "recovery-reconcile", "recovery-close", "recovery-rollback"]) {
    const block = jobBlock(workflow, jobName);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-check/);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-release/);
    assert.match(block, /resource: release:ponto/);
    assert.match(block, /proof_file: \$\{\{ runner\.temp \}\}\/ponto-ordinary-recovery\/global-coordination-lease\.json/);
    assert.match(block, /SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL/);
  }
});

test("Ponto release custody pins the active coordination key at every release boundary", () => {
  const directCustodyWorkflows = [
    ".github/workflows/ponto-emergency-close.yml",
    ".github/workflows/ponto-emergency-latch-reset.yml",
    ".github/workflows/ponto-progressive-release.yml",
    ".github/workflows/ponto-release-watchdog.yml",
    ".github/workflows/ponto-staging-recovery-rollback.yml",
    ".github/workflows/ponto-staging-core-provenance-recovery.yml",
    ".github/workflows/cloudflare-pages-sync-ponto.yml",
    ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml",
    ".github/workflows/deploy-core-workers.yml",
    ".github/workflows/deploy-crm-pages.yml",
    ".github/workflows/deploy-timekeeping.yml",
    ".github/workflows/module-availability.yml",
    ".github/workflows/ponto-production-baseline.yml",
    ".github/workflows/ponto-production-slo.yml",
    ".github/workflows/ponto-staging-rollback-drill.yml",
    ".github/workflows/ponto-waf-security.yml",
    ".github/workflows/timekeeping-staging-journey.yml",
    ".github/workflows/deploy-website-cloudflare.yml",
  ];
  const activeSecret = /^\s{10}shared_secret: \$\{\{ secrets\.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY \}\}$/gm;
  const activeKeyId = /^\s{10}key_id: \$\{\{ vars\.SKINCOS_GLOBAL_COORDINATION_KEY_ID \}\}$/gm;
  for (const workflow of directCustodyWorkflows) {
    const source = read(workflow);
    assert.ok([...source.matchAll(activeSecret)].length > 0, workflow);
    assert.equal([...source.matchAll(activeSecret)].length, [...source.matchAll(activeKeyId)].length, workflow);
    assert.doesNotMatch(source, /secrets\.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET/, workflow);
  }
  const gate = read(".github/workflows/ponto-orchestrator-gate.yml");
  assert.match(gate, /GLOBAL_KEY_ID: \$\{\{ vars\.SKINCOS_GLOBAL_COORDINATION_KEY_ID \}\}/);
  assert.match(gate, /SKINCOS_GLOBAL_COORDINATION_KEY_ID="\$GLOBAL_KEY_ID"/);
  const release = read(".github/workflows/global-coordination-release.yml");
  assert.match(release, /key_id:[\s\S]*?required: false/);
  assert.match(release, /SKINCOS_GLOBAL_COORDINATION_KEY_ID: \$\{\{ inputs\.key_id \}\}/);
});

test("legacy recovery and WAF mutators are fail-closed through the same authority", () => {
  const waf = jobBlock(read(".github/workflows/ponto-waf-security.yml"), "apply");
  assert.match(waf, /resource: cloudflare:ponto-waf:production/);
  assert.match(waf, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
  assert.match(waf, /uses: \.\/\.github\/actions\/global-coordination-check/);
  assert.match(waf, /uses: \.\/\.github\/actions\/global-coordination-release/);
  assert.ok(waf.indexOf("Check global WAF mutation lease immediately before WAF mutation") < waf.indexOf("node .github/scripts/ponto-waf-security.mjs"));

  const watchdog = read(".github/workflows/ponto-release-watchdog.yml");
  for (const jobName of ["fail-close", "rollback"]) {
    const block = jobBlock(watchdog, jobName);
    assert.match(block, /resource: release:ponto/);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-check/);
    assert.match(block, /uses: \.\/\.github\/actions\/global-coordination-release/);
  }
  const watchdogRollback = jobBlock(watchdog, "rollback");
  assert.ok(watchdogRollback.indexOf("Check global Ponto recovery lease before broker-close materialization") < watchdogRollback.indexOf("node .github/scripts/ponto-module-control-materialize.mjs"));
  assert.ok(watchdogRollback.indexOf("Check global Ponto recovery lease immediately before watchdog rollback") < watchdogRollback.indexOf("node .github/scripts/ponto-automatic-rollback.mjs"));

  const coreRecovery = jobBlock(read(".github/workflows/ponto-staging-core-provenance-recovery.yml"), "rollback");
  assert.match(coreRecovery, /resource: global:ponto-workers-writer/);
  assert.match(coreRecovery, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
  assert.match(coreRecovery, /uses: \.\/\.github\/actions\/global-coordination-check/);
  assert.match(coreRecovery, /uses: \.\/\.github\/actions\/global-coordination-release/);
  assert.ok(coreRecovery.indexOf("Check global Core staging recovery lease immediately before materialization") < coreRecovery.indexOf("node .github/scripts/ponto-module-control-materialize.mjs"));
  assert.ok(coreRecovery.indexOf("Check global Core staging recovery lease immediately before Core rollback") < coreRecovery.indexOf("node .github/scripts/ponto-automatic-rollback.mjs"));

  const stagingRecovery = jobBlock(read(".github/workflows/ponto-staging-recovery-rollback.yml"), "rollback");
  assert.match(stagingRecovery, /resource: release:ponto/);
  assert.match(stagingRecovery, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
  assert.match(stagingRecovery, /uses: \.\/\.github\/actions\/global-coordination-check/);
  assert.match(stagingRecovery, /uses: \.\/\.github\/actions\/global-coordination-release/);
  assert.ok(stagingRecovery.indexOf("Check global Ponto recovery lease immediately before staging materialization") < stagingRecovery.indexOf("node .github/scripts/ponto-module-control-materialize.mjs"));
  assert.ok(stagingRecovery.indexOf("Check global Ponto recovery lease immediately before staging rollback") < stagingRecovery.indexOf("node .github/scripts/ponto-automatic-rollback.mjs"));
});

test("Ponto watchdog recovery leases use the trusted watchdog source, not the failed candidate", () => {
  const watchdog = read(".github/workflows/ponto-release-watchdog.yml");
  for (const jobName of ["fail-close", "rollback"]) {
    const block = jobBlock(watchdog, jobName);
    assert.match(block, /source_sha: \$\{\{ github\.sha \}\}/);
    assert.doesNotMatch(block, /source_sha: \$\{\{ needs\.context\.outputs\.release_sha \}\}/);
    assert.doesNotMatch(block, /observed_source_sha:/);
  }
});

test("the reusable check action accepts either an external proof file or an encoded proof", () => {
  const action = read(".github/actions/global-coordination-check/action.yml");
  assert.match(action, /proof_b64:[\s\S]*?required: false/);
  assert.match(action, /proof_file:[\s\S]*?required: false/);
  assert.match(action, /key_id:[\s\S]*?supplied by the caller/);
  assert.match(action, /observed_source_sha:[\s\S]*?required: false/);
  assert.match(action, /git fetch --no-tags --force origin main:refs\/remotes\/origin\/main/);
  assert.match(action, /git fetch --no-tags origin "\$GLOBAL_SOURCE_SHA"/);
  assert.match(action, /--source "\$GLOBAL_OBSERVED_SOURCE_SHA"/);
  assert.match(action, /--candidate-source "\$GLOBAL_SOURCE_SHA"/);
  assert.match(action, /inputs\.required == 'true' \|\| github\.event\.inputs\.target == 'production'/);
  assert.match(read(".github/actions/global-coordination-acquire/action.yml"), /github\.event\.inputs\.target == 'production'/);
  assert.match(read(".github/actions/global-coordination-release/action.yml"), /github\.event\.inputs\.target == 'production'/);
  assert.match(action, /GLOBAL_PROOF_FILE_INPUT/);
  assert.match(action, /base64 -d/);
  assert.match(action, /GLOBAL_CHECK_RESULT/);
  assert.match(action, /--result-file "\$GLOBAL_CHECK_RESULT"/);
  assert.match(action, /expiresAt - Date\.now\(\) > 5 \* 60 \* 1000/);
  assert.match(action, /if \[\[ "\$renew_required" == false \]\]; then/);
  assert.match(action, /if \[\[ "\$renew_required" == true \]\] &&/);
  assert.match(action, /\n {8}NODE\n {12}\)" \|\| renew_required="invalid"/);
  const syntax = spawnSync("bash", ["-n"], {
    input: compositeActionBash(action),
    encoding: "utf8",
  });
  assert.equal(syntax.status, 0, syntax.stderr || "global coordination check Bash syntax failed");
  assert.match(action, /coordination_max_attempts=3/);
  assert.match(action, /Global coordination revalidation failed after/);
  for (const file of [
    ".github/actions/global-coordination-acquire/action.yml",
    ".github/actions/global-coordination-check/action.yml",
    ".github/actions/global-coordination-release/action.yml",
  ]) {
    const reusableAction = read(file);
    assert.match(reusableAction, /SKINCOS_GLOBAL_COORDINATION_KEY_ID:\s+\$\{\{\s*inputs\.key_id\s*\}\}/);
    assert.doesNotMatch(reusableAction, /\bvars\./);
  }
});

test("the staging RBAC journey recovers synthetic teardown under a fresh lease", () => {
  const workflow = read(".github/workflows/insumos-staging-rbac-smoke.yml");
  const release = workflow.indexOf("Release staging D1 coordination lease");
  const recoveryAcquire = workflow.indexOf("Reacquire cleanup lease for an orphaned synthetic teardown");
  const recoveryCheck = workflow.indexOf("Revalidate cleanup lease before orphaned teardown");
  const recoveryTeardown = workflow.indexOf("Tear down orphaned synthetic staging identities under recovery lease");
  assert.ok(release >= 0 && recoveryAcquire > release && recoveryCheck > recoveryAcquire && recoveryTeardown > recoveryCheck);
  assert.match(workflow, /steps\.fixture\.outcome == 'success' && steps\.teardown\.outcome != 'success'/);
  assert.match(workflow, /steps\.recovery_check\.outcome == 'success'/);
  assert.match(workflow, /skincos-global-coordination-staging-d1-insumos-cleanup\.json/);
  assert.match(workflow, /refusing a non-staging D1 target/);
  assert.equal(
    (workflow.match(/key_id: \$\{\{ vars\.SKINCOS_GLOBAL_COORDINATION_KEY_ID \}\}/g) || []).length,
    8,
    "every staging RBAC lease action must pin the active coordination key id",
  );
  assert.equal(
    (workflow.match(/shared_secret: \$\{\{ secrets\.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY \}\}/g) || []).length,
    8,
    "every staging RBAC lease action must sign with the active coordination key",
  );
  assert.equal(
    (workflow.match(/shared_secret: \$\{\{ secrets\.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET \}\}/g) || []).length,
    0,
    "staging RBAC must not pair the rotated key id with the legacy shared secret",
  );
});

test("production Users smoke identity uses production custody and the active coordination key", () => {
  const workflow = read(".github/workflows/insumos-production-smoke-identity.yml");
  assert.equal(
    (workflow.match(/coordinator_url: \$\{\{ vars\.SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL \}\}/g) || []).length,
    4,
  );
  assert.equal(
    (workflow.match(/key_id: \$\{\{ vars\.SKINCOS_GLOBAL_COORDINATION_KEY_ID \}\}/g) || []).length,
    4,
  );
  assert.equal(
    (workflow.match(/shared_secret: \$\{\{ secrets\.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY \}\}/g) || []).length,
    4,
  );
  assert.doesNotMatch(workflow, /SKINCOS_GLOBAL_COORDINATOR_URL \}\}/);
  assert.doesNotMatch(workflow, /SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET/);
});

test("the Ponto composite lease protects only non-preview stages while preview keeps separate writer custody", () => {
  const workflow = read(".github/workflows/ponto-progressive-release.yml");
  const acquire = workflow.indexOf("Acquire the composite Ponto release lease before gate settlement");
  const requiredChecks = workflow.indexOf("Attest canonical merged PR and required checks for the immutable SHA");
  const firstDispatch = workflow.indexOf("node .github/scripts/ponto-dispatch-workflow.mjs");
  const release = workflow.indexOf("Release the composite Ponto release lease");
  assert.ok(acquire >= 0 && requiredChecks > acquire && firstDispatch > acquire && release > firstDispatch);
  const acquireEnd = workflow.indexOf("\n      - name:", acquire + 1);
  const releaseEnd = workflow.indexOf("\n\n  recovery-latch:", release);
  assert.match(workflow.slice(acquire, acquireEnd), /if: \$\{\{ inputs\.stage != 'preview' \}\}/);
  assert.match(workflow.slice(release, releaseEnd), /if: \$\{\{ always\(\) && inputs\.stage != 'preview' \}\}/);
  assert.match(
    workflow,
    /if \[\[ "\$STAGE" != "preview" \]\]; then\s+echo "PONTO_ORCHESTRATOR_COORDINATION_PROOF_FILE=/,
  );
  assert.match(workflow, /SKINCOS_GLOBAL_COORDINATOR_URL: \$\{\{ contains\(fromJSON\('\["preview","staging"\]'\)/);
  assert.match(workflow, /coordinator_url: \$\{\{ env\.SKINCOS_GLOBAL_COORDINATOR_URL \}\}/);
  assert.match(read(".github/scripts/ponto-dispatch-workflow.mjs"), /revalidatePontoCompositeLease/);
  assert.match(read(".github/scripts/ponto-dispatch-workflow.mjs"), /cancelActiveChildBestEffort/);
  assert.match(read(".github/scripts/ponto-source-closure.mjs"), /assertPontoSourceClosureUnchanged/);
  assert.match(read(".github/scripts/ponto-source-closure.mjs"), /assertDependencyClosureUnchanged/);
  for (const workflowName of [
    ".github/workflows/module-availability.yml",
    ".github/workflows/ponto-production-baseline.yml",
    ".github/workflows/ponto-production-slo.yml",
    ".github/workflows/ponto-staging-rollback-drill.yml",
    ".github/workflows/timekeeping-staging-journey.yml",
  ]) {
    assert.match(read(workflowName), /release:ponto-child/);
  }
});

test("Ponto child dispatch is pinned to the immutable release identity", () => {
  const workflow = read(".github/workflows/ponto-progressive-release.yml");
  const dispatcher = read(".github/scripts/ponto-dispatch-workflow.mjs");
  const identity = read(".github/scripts/ponto-release-identity.mjs");
  const acquire = workflow.indexOf("Acquire the composite Ponto release lease before gate settlement");
  const establish = workflow.indexOf("Establish immutable Ponto release identity");
  const dispatch = workflow.indexOf("node .github/scripts/ponto-dispatch-workflow.mjs");
  assert.ok(acquire >= 0 && establish > acquire && dispatch > establish);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /ponto-release-identity\.mjs create/);
  assert.match(workflow, /ponto-release-identity\.mjs finalize/);
  assert.match(workflow, /release-identity\.json/);
  assert.match(workflow, /release-identity-final\.json/);
  assert.match(workflow, /PONTO_RELEASE_IDENTITY_SOURCE_JSON/);
  assert.match(dispatcher, /PONTO_RELEASE_IDENTITY_FILE/);
  assert.match(dispatcher, /verifyRemotePontoReleaseRef/);
  assert.match(dispatcher, /ref: releaseIdentity\.releaseTag/);
  assert.match(dispatcher, /expectedHeadBranch: releaseIdentity\.releaseTag/);
  assert.match(dispatcher, /headShaMatches: \(headSha\) => String\(headSha/);
  assert.match(dispatcher, /run\.head_branch !== releaseIdentity\.releaseTag/);
  assert.match(dispatcher, /run\.head_sha \|\| \"\"\)\.trim\(\)\.toLowerCase\(\) !== orchestratorHeadSha/);
  assert.doesNotMatch(dispatcher, /ref: \"main\"/);
  assert.doesNotMatch(dispatcher, /runs\?event=workflow_dispatch&branch=main/);
  assert.match(identity, /releaseRefFor/);
  assert.match(identity, /RELEASE_TAG_PREFIX = "skincos\/release"/);
  assert.match(identity, /releaseIdentityDigest/);
  assert.match(identity, /sourceIdentityDigest/);
  assert.match(identity, /artifactBindingsFromSurfaces/);
  assert.match(identity, /finalizeReleaseIdentity/);
  assert.match(identity, /git\/refs/);
});

test("merge:main is a fail-closed GitHub mutation authority", () => {
  const script = read("scripts/codex-global-merge-authority.mjs");
  const workflow = read(".github/workflows/global-merge-authority.yml");
  const scheduler = read(".github/workflows/codex-keep-prs-mergeable.yml");
  const policy = JSON.parse(read("ops/governance/global-concurrency-policy.json"));
  assert.match(script, /const resource = "merge:main"/);
  assert.match(script, /expectedHeadSha/);
  assert.match(script, /checkGlobalLease/);
  assert.match(script, /finalLease = await checkGlobalLease/);
  assert.match(script, /expectedMainSha: baseSha/);
  assert.match(script, /assertMergeReadback/);
  assert.match(script, /post-mutation base readback failed/);
  assert.match(script, /\/commits\/\$\{mergeCommitSha\}/);
  assert.match(script, /merge:main mutation occurred but post-mutation readback failed/);
  assert.match(read("ops/governance/global-coordination-core.mjs"), /merge-base-intent-mismatch/);
  assert.match(script, /acquireMergeLease/);
  assert.match(script, /incompatible-release-lease/);
  assert.match(script, /merge:main lease remained unavailable/);
  assert.match(script, /global-merge-authority/);
  assert.match(script, /setMergeAuthorityStatus/);
  assert.match(script, /loadMergeCandidate/);
  assert.match(read("scripts/codex-github-integration-candidate.mjs"), /changedPaths/);
  assert.match(read("scripts/codex-github-integration-candidate.mjs"), /previous_filename/);
  assert.match(read("scripts/codex-global-integration-gate.mjs"), /skincos-integration-gate/);
  assert.match(read("scripts/codex-global-integration-gate.mjs"), /loadMergeCandidateIdentity/);
  assert.match(read("scripts/codex-global-integration-gate.mjs"), /pathToFileURL/);
  const integrationGate = read(".github/workflows/skincos-integration-gate.yml");
  assert.match(integrationGate, /pull_request_target/);
  assert.match(integrationGate, /ref: main/);
  assert.match(integrationGate, /SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY/);
  assert.match(integrationGate, /SKINCOS_GLOBAL_COORDINATION_KEY_ID/);
  assert.match(integrationGate, /Fetch the exact PR base tree used for closure admission/);
  assert.doesNotMatch(integrationGate, /ref: \$\{\{ github\.event\.pull_request\./);
  const integrationRecheck = read(".github/workflows/skincos-integration-gate-recheck.yml");
  assert.match(integrationRecheck, /schedule:/);
  assert.match(integrationRecheck, /--max-wait-ms 15000/);
  assert.match(integrationRecheck, /gh api --paginate/);
  assert.match(integrationRecheck, /gate_state/);
  assert.match(integrationRecheck, /--jq '\[\.\[\] \| select\(\.context == "skincos-integration-gate"\)\]\[0\]\.state \/\/ ""'/);
  assert.doesNotMatch(integrationRecheck, /--jq '[^\n]*\/\/ ""\)"/);
  assert.match(read("ops/cloudflare/global-coordinator/index.js"), /buildLegacyIntentV1/);
  assert.match(read("ops/cloudflare/global-coordinator/index.js"), /keyCandidatesForRequest/);
  assert.match(read("ops/cloudflare/global-coordinator/key-ring.mjs"), /PREVIOUS_KEY_EXPIRES_AT/);
  assert.match(read("ops/cloudflare/global-coordinator/key-ring.mjs"), /allowUnpinnedKeyDuringGrace/);
  const coordinatorDeploy = read(".github/workflows/deploy-global-coordinator.yml");
  assert.match(coordinatorDeploy, /explicit active key cannot retain the legacy key id/);
  assert.match(coordinatorDeploy, /COORDINATION_ACTIVE_KEY \|\| process\.env\.COORDINATION_SHARED_SECRET/);
  assert.match(coordinatorDeploy, /--secrets-file \"\$SECRETS_FILE\"/);
  assert.match(coordinatorDeploy, /mode: 0o600/);
  assert.doesNotMatch(coordinatorDeploy, /wrangler@4\.120\.0 secret put/);
  assert.match(read("scripts/codex-global-coordination-workflow.mjs"), /admission paths are not bound/);
  assert.match(script, /\/pulls\/\$\{pullNumber\}\/merge/);
  assert.match(workflow, /pull_request_target/);
  assert.match(workflow, /ref: \$\{\{ github\.ref \}\}/);
  assert.match(workflow, /state=failure/);
  assert.match(workflow, /run-name: Merge PR #\$\{\{ inputs\.pull_number \}\} through merge:main/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /SKINCOS_STATUS_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(script, /SKINCOS_STATUS_TOKEN/);
  assert.doesNotMatch(script, /SKINCOS_POST_MERGE_TOKEN|skincos-main-integrated/);
  assert.doesNotMatch(scheduler, /enablePullRequestAutoMerge/);
  assert.match(scheduler, /disablePullRequestAutoMerge/);
  assert.match(scheduler, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
  assert.match(scheduler, /uses: \.\/\.github\/actions\/global-coordination-check/);
  assert.match(scheduler, /uses: \.\/\.github\/actions\/global-coordination-release/);
  assert.equal(
    (scheduler.match(/key_id: \$\{\{ vars\.SKINCOS_GLOBAL_COORDINATION_KEY_ID \}\}/g) || []).length,
    3,
    "branch maintenance must pin the rotated coordination key for acquire, check, and release",
  );
  assert.equal(
    (scheduler.match(/shared_secret: \$\{\{ secrets\.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY \}\}/g) || []).length,
    3,
    "branch maintenance must use the pinned active coordination key for acquire, check, and release",
  );
  assert.match(scheduler, /resource: merge:main/);
  assert.match(scheduler, /Detect whether branch maintenance needs merge:main/);
  assert.match(scheduler, /steps\.maintenance_scan\.outputs\.needs_maintenance == 'true'/);
  assert.match(scheduler, /steps\.acquire_branch_maintenance\.outcome == 'success'/);
  assert.match(scheduler, /ALLOW_BRANCH_UPDATES/);
  assert.match(scheduler, /always\(\)/);
  assert.match(scheduler, /allowBranchUpdates/);
  assert.match(scheduler, /getCombinedStatusForRef/);
  assert.match(scheduler, /checks\.listForRef/);
  assert.match(scheduler, /authoritySignalIsOnlyBlock/);
  assert.match(scheduler, /mergeableState === "blocked"/);
  assert.match(read(".github/actions/global-coordination-release/action.yml"), /max_attempts=5/);
  assert.match(read(".codex/hooks/skincos-supervisor-gate.py"), /resource_declaration/);
  assert.match(read("skills/skincos-project-orchestrator/references/supervisor-cycle.md"), /technical wait\/blocker/);
  assert.deepEqual(policy.releaseClosures.merge.patterns, ["**"]);
  assert.match(policy.resourceClasses.mutate, /^\^mutate:/);
  assert.equal(policy.admission.coordinationPlane, "global");
  const ruleset = JSON.parse(read(".github/governance/rulesets/main-enterprise-baseline.json"));
  assert.ok(ruleset.rules.some((rule) => rule.type === "update"));
  assert.deepEqual(ruleset.bypass_actors, [{ actor_id: 15368, actor_type: "Integration", bypass_mode: "always" }]);
  assert.deepEqual(ruleset.rules.find((rule) => rule.type === "pull_request").parameters.allowed_merge_methods, ["squash"]);
  const requiredContexts = ruleset.rules.find((rule) => rule.type === "required_status_checks").parameters.required_status_checks.map((entry) => entry.context);
  assert.deepEqual(requiredContexts, ["codex-autonomy-gate", "global-merge-authority", "skincos-integration-gate"]);
  assert.ok(ruleset.rules.find((rule) => rule.type === "required_status_checks").parameters.required_status_checks.every((entry) => entry.integration_id === 15368));
});

test("native mini-PC mutations use the common coordinator and detached closure proof", () => {
  const adapter = read("scripts/runtime/global-coordination-mini-pc.sh");
  const nativeHelper = read("scripts/runtime/global-coordination-native.sh");
  assert.match(adapter, /GLOBAL_COORDINATION_PROVIDER='mini-pc'/);
  assert.match(adapter, /SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET/);
  assert.match(adapter, /proof must remain below the private mini-PC proof root/);
  assert.match(adapter, /An immutable dependency-closure attestation is required/);
  assert.match(nativeHelper, /native_coordination_init/);
  assert.match(nativeHelper, /native_coordination_check/);
  assert.match(nativeHelper, /native_coordination_renew_if_due/);
  assert.match(nativeHelper, /global-coordination-mini-pc\.sh/);
  assert.match(nativeHelper, /immutable_root=.*\/opt\/skincos\/releases/);

  const prepare = read("scripts/runtime/prepare-native-source-release.sh");
  assert.match(prepare, /--coordination-closure/);
  assert.match(prepare, /coordination closure identity or digest is invalid/);
  assert.match(prepare, /\.skincos-global-coordination-\$\{closure_module\}\.json/);
  assert.match(prepare, /coordination_native_runtime_closure/);
  assert.match(prepare, /native-runtime dependency-closure attestation is required/);
  assert.match(prepare, /export-meta-ads-publish-live\.js/);
  assert.match(prepare, /apply-meta-ads-publish-workflow-snapshot\.js/);
  assert.match(prepare, /patch-meta-ads-advantage-plus-drift-readback\.js/);
  assert.match(prepare, /lib\/runtime-paths\.js/);

  const atendimentoPrepare = read("scripts/runtime/prepare-atendimento-staging-release.sh");
  assert.match(atendimentoPrepare, /--coordination-closure/);
  assert.match(atendimentoPrepare, /native_coordination_init release:atendimento/);
  assert.match(atendimentoPrepare, /\.skincos-global-coordination-atendimento\.json/);
  assert.match(read("scripts/runtime/prepare-atendimento-production-release.sh"), /native_coordination_init release:atendimento/);
  assert.match(read("scripts/runtime/rollback-atendimento-staging.sh"), /native_coordination_init deploy:atendimento:staging/);

  const lifecycle = read("scripts/runtime/install-lifecycle-units.sh");
  assert.match(lifecycle, /native_coordination_init global:native-runtime/);
  assert.match(lifecycle, /native-runtime\.json/);
  assert.match(read("scripts/runtime/manage-native-runtime.sh"), /native_coordination_init global:native-runtime/);
  assert.match(read("scripts/runtime/prepare-lifecycle-layout.sh"), /--coordination-closure/);
  assert.match(read("scripts/runtime/retire-clientes-source-refresh-service.sh"), /native_coordination_init global:native-runtime/);

  const mirror = read("scripts/sync-atendimento-local-mirror.sh");
  assert.match(mirror, /native_coordination_init deploy:atendimento:local/);
  assert.match(mirror, /SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE/);

  const mcp = read("scripts/runtime/mcp-gateway-release.sh");
  assert.match(mcp, /promotion:orb-mcp:local/);
  assert.match(mcp, /\.skincos-global-coordination-orb\.json/);
  assert.match(mcp, /\.skincos-release-identity-orb\.json/);
  assert.match(mcp, /native_coordination_check/);
  const backup = read("scripts/runtime/run-orb-backup-with-coordination.sh");
  assert.match(backup, /global:orb-backup/);
  assert.match(backup, /orb-backup\.service/);
  assert.match(backup, /SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY/);
  assert.match(read("scripts/runtime/publish-orb-backup.ps1"), /run-orb-backup-with-coordination\.sh/);
  const influencerMigration = read("scripts/runtime/run-influencer-intelligence-staging-migration.sh");
  assert.match(influencerMigration, /load_private_coordination_environment/);
  assert.match(influencerMigration, /native-staging-migration-runner/);
  const harmonia = read("scripts/runtime/run-harmonia-migration-native.sh");
  assert.match(harmonia, /deploy:atendimento:staging/);
  assert.match(harmonia, /deploy:atendimento:production/);
  assert.match(harmonia, /native_coordination_check/);
  const migration = read("scripts/run-atendimento-staging-migration.sh");
  assert.match(migration, /if \[\[ "\$ACTION" != '--dry-run' \]\]; then\s+native_coordination_check/);
  const tunnel = read("scripts/runtime/install-atendimento-production-tunnel.sh");
  assert.match(tunnel, /systemctl daemon-reload[\s\S]*coordination_run check[\s\S]*systemctl enable --now/);

  for (const [file, resource] of [
    ["scripts/provision-atendimento-staging.sh", "deploy:atendimento:staging"],
    ["scripts/set-atendimento-staging-control.sh", "deploy:atendimento:staging"],
    ["scripts/run-atendimento-staging-migration.sh", "deploy:atendimento:staging"],
    ["scripts/refresh-atendimento-staging-quality.sh", "deploy:atendimento:staging"],
    ["scripts/provision-atendimento-production-readonly.sh", "deploy:atendimento:production"],
    ["scripts/set-atendimento-production-readonly-control.sh", "deploy:atendimento:production"],
  ]) {
    const script = read(file);
    assert.match(script, new RegExp(`native_coordination_init ${resource.replaceAll(":", "\\:")}`));
    assert.match(script, /COORDINATION_CLOSURE|SKINCOS_GLOBAL_COORDINATION_CLOSURE_FILE/);
    assert.match(script, /native_coordination_check/);
  }

  const orb = read("scripts/runtime/promote-native-source-release.sh");
  assert.match(orb, /--resource release:native-runtime/);
  assert.match(orb, /\.skincos-global-coordination-native-runtime\.json/);
  assert.match(orb, /\.skincos-release-identity-native-runtime\.json/);
  assert.match(orb, /--release-identity-file/);
  assert.match(orb, /coordination_renew_if_due/);
  assert.ok(orb.includes("coordination_check >/dev/null"));
  assert.match(orb, /--rollback-to-release/);
  assert.match(orb, /mode='rollback'/);
  assert.match(orb, /current\.parentReleaseId === targetRelease/);
  assert.match(orb, /Native source transition must be invoked from one of the two verified immutable release roots/);
  assert.match(orb, /mini-pc:release:native-runtime:\$mode:\$release_id:from:\$expected_current/);
  assert.doesNotMatch(orb, /--operation rollback/);
  const nativeRollbackTest = read("scripts/runtime/test-promote-native-source-release.sh");
  assert.match(nativeRollbackTest, /native source pointer rollback is exact, identity-attested, and fail-closed/);

  const whatsapp = read("scripts/runtime/prepare-messaging-whatsapp-release.sh");
  assert.match(whatsapp, /--resource release:orb/);
  assert.match(whatsapp, /--coordination-closure/);

  const dns = read("scripts/runtime/route-atendimento-production-dns.sh");
  assert.match(dns, /--resource cloudflare:atendimento:production/);
  assert.match(dns, /--source-sha/);

  const rollback = read("scripts/runtime/rollback-atendimento-production.sh");
  assert.match(rollback, /--resource deploy:atendimento:production/);
  assert.match(rollback, /coordination_acquired/);
  assert.match(rollback, /--coordination-proof-file "\$coordination_proof" --coordination-reuse/);
  assert.match(read("scripts/runtime/global-coordination-native.sh"), /NATIVE_COORDINATION_OWNED/);
  assert.match(read("scripts/runtime/install-atendimento-production-service.sh"), /--coordination-reuse/);
  assert.match(read("scripts/set-atendimento-production-readonly-control.sh"), /--coordination-reuse/);
  assert.match(read("scripts/run-atendimento-staging-migration.sh"), /run_sudo_clean \/usr\/bin\/bash -p "\$RUNTIME_GRANT_LOCKDOWN" --apply/);
  assert.match(read("scripts/runtime/prepare-atendimento-staging-release.sh"), /native_coordination_cleanup\ncoordination_acquired=0\ntrap - EXIT/);
});

test("the scheduled native backup bridge carries private custody and a stable owner identity", () => {
  const publisher = read("scripts/runtime/publish-orb-backup.ps1");
  const runner = read("scripts/runtime/run-orb-backup-with-coordination.sh");
  assert.match(publisher, /SKINCOS_GLOBAL_COORDINATION_ENV_FILE=/);
  assert.match(publisher, /GLOBAL_COORDINATION_MISSION_ID=windows:skincos-orb-backup/);
  assert.match(publisher, /GLOBAL_COORDINATION_THREAD_ID=scheduled:SkincosOrbBackup/);
  assert.match(publisher, /GLOBAL_COORDINATION_ACTOR=windows-scheduled-task/);
  assert.match(runner, /COORDINATION_ENV_FILE=.*orb-backup\.env/);
  assert.match(runner, /unsupported key/);
  assert.match(runner, /mode 0600 or 0640/);
});

test("shared staging D1 custody serializes synthetic mutators before every write path", () => {
  const financeCanary = read(".github/workflows/finance-staging-canary.yml");
  const financeIdentity = read(".github/workflows/finance-staging-smoke-identity.yml");
  const timekeepingJourney = jobBlock(read(".github/workflows/timekeeping-staging-journey.yml"), "journey");

  for (const workflow of [financeCanary, financeIdentity, timekeepingJourney]) {
    assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-acquire/);
    assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-check/);
    assert.match(workflow, /uses: \.\/\.github\/actions\/global-coordination-release/);
    assert.match(workflow, /resource: global:staging-d1/);
    assert.match(workflow, /proof_file: \$\{\{ runner\.temp \}\}\/skincos-global-coordination-[^\n]*staging-d1\.json/);
  }

  assert.ok(financeCanary.indexOf("Check shared staging D1 lease before opening synthetic canary") < financeCanary.indexOf("Open deterministic synthetic canary"));
  assert.ok(financeCanary.indexOf("Check shared staging D1 lease before baseline restore") < financeCanary.indexOf("Restore non-enabled staging baseline and synthetic grant"));
  assert.ok(financeIdentity.indexOf("Check shared staging D1 lease before identity lifecycle SQL") < financeIdentity.indexOf("Apply audited staging identity lifecycle SQL"));
  assert.ok(timekeepingJourney.indexOf("Check shared staging D1 lease before synthetic staging provisioning") < timekeepingJourney.indexOf("Provision only run-scoped synthetic staging records"));
  assert.ok(timekeepingJourney.indexOf("Check shared staging D1 lease before authenticated Ponto journey") < timekeepingJourney.indexOf("Execute authenticated Ponto journey"));
  assert.match(timekeepingJourney, /id: check_staging_d1_teardown/);
  assert.match(timekeepingJourney, /steps\.check_staging_d1_teardown\.outcome == 'success'/);
});

test("general CRM Pages checks out trusted local coordination actions before using them", () => {
  const workflow = read(".github/workflows/deploy-crm-pages.yml");
  const checkout = workflow.indexOf("Checkout trusted general coordination actions");
  const authorization = workflow.indexOf("uses: ./.github/actions/global-coordination-check", checkout);

  assert.ok(checkout >= 0, "general Pages deploy must prepare the local coordination action");
  assert.ok(authorization > checkout, "the coordination action must be available before authorization");
  assert.match(workflow.slice(checkout, authorization), /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow.slice(checkout, authorization), /inputs\.release_scope == 'general'/);
});

test("the reusable orchestrator gate exposes global lease outputs to callers", () => {
  const workflow = read(".github/workflows/ponto-orchestrator-gate.yml");

  assert.match(workflow, /GLOBAL_RESOURCE.*\^global:\[a-z0-9\]/s);
  assert.match(workflow, /steps\.global_enabled\.outputs\.proof_b64/);
  assert.match(workflow, /steps\.global_enabled\.outputs\.url/);
  assert.match(workflow, /id: global_enabled/);
  assert.match(workflow, /id: global_disabled/);
  assert.doesNotMatch(workflow, /steps\.global-(?:enabled|disabled)\.outputs/);
});

test("CRM Pages deploy declares coordination as a direct dependency for lease outputs", () => {
  const workflow = read(".github/workflows/deploy-crm-pages.yml");

  assert.match(workflow, /\n  deploy:\n    # The deploy job reads lease outputs from the reusable coordination job\.[\s\S]*?\n    needs: \[coordination, promotion\]/);
});

test("Core Worker jobs declare coordination before consuming its lease outputs", () => {
  const workflow = read(".github/workflows/deploy-core-workers.yml");

  for (const jobName of [
    "ponto-identity-staging",
    "ponto-progressive-release",
    "ponto-identity-progressive-release",
  ]) {
    const block = jobBlock(workflow, jobName);
    assert.match(block, /needs: \[(?:coordination, (?:promotion|progressive))\]/);
    assert.match(block, /needs\.coordination\.outputs\.(?:global_coordinator_url|global_proof_b64)/);
  }
});
