import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL(
    "../../../../.github/workflows/deploy-token-vault.yml",
    import.meta.url,
  ),
  "utf8",
);

function section(start, end) {
  const from = workflow.indexOf(start);
  assert.notEqual(from, -1, `missing workflow section: ${start}`);
  const to = end ? workflow.indexOf(end, from + start.length) : workflow.length;
  assert.notEqual(to, -1, `missing workflow boundary: ${end}`);
  return workflow.slice(from, to);
}

test("staging synthetic seed is candidate-scoped, ordered before derivation, and fails closed", () => {
  const upload = section(
    "      - name: Upload immutable Token Vault version",
    "      - name: Export immutable Worker and incumbent identities for the activation gate",
  );
  const attestation = section(
    "      - name: Attest the isolated staging Meta Ads synthetic source on the immutable candidate",
    "      - name: Seal the isolated staging Meta Ads synthetic seed on the immutable candidate",
  );
  const seed = section(
    "      - name: Seal the isolated staging Meta Ads synthetic seed on the immutable candidate",
    "      - name: Verify immutable Token Vault candidate config bearer before traffic",
  );
  const pretrafficRollback = section(
    "      - name: Roll back the isolated staging synthetic seed before traffic when candidate planning fails",
    "      - name: Check Token Vault release lease before staging version deployment",
  );
  const activationLeaseRollback = section(
    "      - name: Roll back the isolated staging synthetic seed when the activation lease rejects it",
    "      - name: Activate only the selected Token Vault version in staging",
  );
  const routeConvergence = section(
    "      - name: Wait for staging Token Vault route to accept the candidate config bearer",
    "      - name: Bootstrap legacy Token Vault Meta Ads configuration only when staging requires it",
  );
  const candidatePlan = section(
    "      - name: Seal a private or internally-derived legacy Token Vault bootstrap plan before traffic",
    "      - name: Validate sealed Token Vault bootstrap plan before staging traffic",
  );
  const bootstrap = section(
    "      - name: Bootstrap legacy Token Vault Meta Ads configuration only when staging requires it",
    "      - name: Read back staging Token Vault deployment and authenticated health",
  );
  const compensationRollback = section(
    "      - name: Roll back the isolated staging synthetic seed before Worker compensation",
    "      - name: Compensate the staging Worker only when this release still owns traffic",
  );
  const cleanup = section(
    "      - name: Remove the ephemeral staging synthetic-seed bearer",
    "      - name: Release Token Vault release lease",
  );
  const authorization = section(
    "      - name: Attest Token Vault deployment authorization and remote resources before mutation",
    "      - name: Validate Token Vault and Meta Ads Publish source",
  );

  assert.match(upload, /randomBytes\(48\)\.toString\('base64url'\)/);
  assert.match(
    upload,
    /\$RUNNER_TEMP\/token-vault-staging-synthetic-seed-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/,
  );
  assert.match(upload, /chmod 600 "\$seed_secret_file"/);
  assert.match(upload, /TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN = seedToken/);
  assert.doesNotMatch(
    upload,
    /META_ADS_ACCESS_TOKEN|META_PIXEL_ID|META_ADS_NOVOHAMBURGO_PAGE_ID|META_ADS_BARRASHOPPPINGSUL_PAGE_ID|META_ADS_ACCOUNT_ID|META_ADS_API_VERSION/,
  );
  assert.doesNotMatch(workflow, /\bwrangler\s+secret\s+put\b/i);

  assert.match(
    authorization,
    /META_ADS_NOVOHAMBURGO_PAGE_ID: \$\{\{ inputs\.target == 'staging' && secrets\.novohamburgo_page_id \|\| '' \}\}/,
  );
  assert.match(
    authorization,
    /META_ADS_BARRASHOPPPINGSUL_PAGE_ID: \$\{\{ inputs\.target == 'staging' && secrets\.barrashopppingsul_page_id \|\| '' \}\}/,
  );
  assert.match(
    authorization,
    /Novo Hamburgo Page selector must be a numeric staging Environment secret for the governed staging seed/,
  );
  assert.match(
    authorization,
    /Barra Shopping Sul Page selector must be a numeric staging Environment secret for the governed staging seed/,
  );
  assert.match(
    authorization,
    /META_ADS_NOVOHAMBURGO_PAGE_ID" != "\$META_ADS_BARRASHOPPPINGSUL_PAGE_ID/,
  );
  assert.match(
    authorization,
    /META_ADS_API_VERSION: \$\{\{ inputs\.target == 'staging' && vars\.META_ADS_API_VERSION \|\| '' \}\}/,
  );
  assert.match(
    authorization,
    /META_ADS_API_VERSION must be v25\.0 or a newer supported Graph API version for the governed staging seed/,
  );
  assert.match(authorization, /\^v\(2\[5-9\]\|\[3-9\]\[0-9\]\)\\\.0\$/);

  assert.match(
    attestation,
    /id: candidate_staging_synthetic_seed_attestation/,
  );
  assert.match(
    attestation,
    /if: inputs\.operation == 'deploy' && inputs\.target == 'staging'/,
  );
  for (const sourceName of [
    "META_ADS_ACCESS_TOKEN",
    "META_PIXEL_ID",
    "META_ADS_NOVOHAMBURGO_PAGE_ID",
    "META_ADS_BARRASHOPPPINGSUL_PAGE_ID",
    "META_ADS_ACCOUNT_ID",
    "META_ADS_API_VERSION",
  ]) {
    assert.match(attestation, new RegExp(`${sourceName}: \\$\\{\\{ inputs\\.target == 'staging'`));
  }
  assert.match(
    attestation,
    /const preview = String\(process\.env\.TOKEN_VAULT_CANDIDATE_PREVIEW_URL/,
  );
  assert.doesNotMatch(attestation, /TOKEN_VAULT_STAGING_BASE_URL/);
  assert.match(
    attestation,
    /fetch\(`\$\{preview\}\/internal\/token-vault\/v1\/meta-ads-publish\/config\/staging-synthetic-seed\/attest`/,
  );
  assert.match(
    attestation,
    /operation_key: operationKey,[\s\S]*access_token: accessToken,[\s\S]*account_id: accountId,[\s\S]*pixel_id: pixelId,[\s\S]*destination_page_ids: destinationPageIds,[\s\S]*api_version: apiVersion/,
  );
  assert.match(
    attestation,
    /destinationPageIds\.novo_hamburgo === destinationPageIds\.barra_shopping_sul/,
  );
  assert.match(attestation, /attestation \|\| ''\) === 'match'/);
  assert.match(attestation, /meta-ads-tracking-v20\/staging-synthetic-seed\/v2/);
  assert.match(attestation, /AbortSignal\.timeout\(30_000\)/);
  assert.doesNotMatch(attestation, /GITHUB_OUTPUT|console\.log|process\.stdout\.write/);

  assert.match(
    seed,
    /if: inputs\.operation == 'deploy' && inputs\.target == 'staging' && steps\.candidate_staging_synthetic_seed_attestation\.outcome == 'success'/,
  );
  assert.match(
    seed,
    /META_ADS_ACCESS_TOKEN: \$\{\{ inputs\.target == 'staging'/,
  );
  assert.match(seed, /META_PIXEL_ID: \$\{\{ inputs\.target == 'staging'/);
  assert.match(seed, /META_ADS_NOVOHAMBURGO_PAGE_ID: \$\{\{ inputs\.target == 'staging'/);
  assert.match(seed, /META_ADS_BARRASHOPPPINGSUL_PAGE_ID: \$\{\{ inputs\.target == 'staging'/);
  assert.match(seed, /META_ADS_ACCOUNT_ID: \$\{\{ inputs\.target == 'staging'/);
  assert.match(
    seed,
    /META_ADS_API_VERSION: \$\{\{ inputs\.target == 'staging'/,
  );
  assert.match(seed, /staging-synthetic-seed`, \{/);
  assert.match(
    seed,
    /const preview = String\(process\.env\.TOKEN_VAULT_CANDIDATE_PREVIEW_URL/,
  );
  assert.doesNotMatch(seed, /TOKEN_VAULT_STAGING_BASE_URL/);
  assert.match(
    seed,
    /operation_key: operationKey,[\s\S]*access_token: accessToken,[\s\S]*account_id: accountId,[\s\S]*pixel_id: pixelId,[\s\S]*destination_page_ids: destinationPageIds,[\s\S]*api_version: apiVersion/,
  );
  assert.match(
    seed,
    /destinationPageIds\.novo_hamburgo === destinationPageIds\.barra_shopping_sul/,
  );
  assert.match(seed, /meta-ads-tracking-v20\/staging-synthetic-seed\/v2/);
  assert.match(seed, /\^v\(\?:2\[5-9\]\|\[3-9\]\[0-9\]\)\\\.0\$/);
  assert.match(
    seed,
    /seed_attempted=true\\nseed_operation_key=\$\{operationKey\}/,
  );
  assert.match(
    seed,
    /appendFileSync\(process\.env\.GITHUB_OUTPUT, `seed_attempted=true\\nseed_operation_key=\$\{operationKey\}\\n`\);/,
  );
  assert.match(
    seed,
    /appendFileSync\(process\.env\.GITHUB_OUTPUT, seed === 'sealed'[\s\S]*`did_seed=true\\nseed_status=\$\{seed\}\\n`[\s\S]*`did_seed=false\\nseed_status=\$\{seed\}\\n`\);/,
  );
  assert.equal(
    [...seed.matchAll(/process\.env\.GITHUB_OUTPUT/g)].length,
    2,
    "only opaque seed state may reach workflow outputs",
  );
  assert.doesNotMatch(seed, /console\.log|process\.stdout\.write/);

  assert.match(
    routeConvergence,
    /const base = String\(process\.env\.TOKEN_VAULT_STAGING_BASE_URL/,
  );
  assert.doesNotMatch(routeConvergence, /TOKEN_VAULT_CANDIDATE_PREVIEW_URL/);
  assert.match(
    candidatePlan,
    /const preview = String\(process\.env\.TOKEN_VAULT_CANDIDATE_PREVIEW_URL/,
  );
  assert.match(
    candidatePlan,
    /fetch\(`\$\{preview\}\/internal\/token-vault\/v1\/meta-ads-publish\/config\/bootstrap\/derive-plan`/,
  );
  assert.doesNotMatch(candidatePlan, /TOKEN_VAULT_STAGING_BASE_URL/);
  assert.match(
    bootstrap,
    /const base = String\(process\.env\.TOKEN_VAULT_STAGING_BASE_URL/,
  );
  assert.doesNotMatch(bootstrap, /TOKEN_VAULT_CANDIDATE_PREVIEW_URL/);

  const uploadAt = workflow.indexOf(
    "      - name: Upload immutable Token Vault version",
  );
  const attestationAt = workflow.indexOf(
    "      - name: Attest the isolated staging Meta Ads synthetic source on the immutable candidate",
  );
  const seedAt = workflow.indexOf(
    "      - name: Seal the isolated staging Meta Ads synthetic seed on the immutable candidate",
  );
  const configAt = workflow.indexOf(
    "      - name: Verify immutable Token Vault candidate config bearer before traffic",
  );
  const planAt = workflow.indexOf(
    "      - name: Seal a private or internally-derived legacy Token Vault bootstrap plan before traffic",
  );
  const trafficAt = workflow.indexOf(
    "      - name: Activate only the selected Token Vault version in staging",
  );
  assert.ok(
    uploadAt < attestationAt &&
      attestationAt < seedAt &&
      seedAt < configAt &&
      configAt < planAt &&
      planAt < trafficAt,
  );

  assert.match(
    activationLeaseRollback,
    /steps\.staging_worker_activation_lease\.outcome != 'success'/,
  );
  for (const rollback of [
    pretrafficRollback,
    activationLeaseRollback,
    compensationRollback,
  ]) {
    assert.match(
      rollback,
      /const preview = String\(process\.env\.TOKEN_VAULT_CANDIDATE_PREVIEW_URL/,
    );
    assert.match(
      rollback,
      /fetch\(`\$\{preview\}\/internal\/token-vault\/v1\/meta-ads-publish\/config\/staging-synthetic-seed\/rollback`/,
    );
    assert.doesNotMatch(rollback, /TOKEN_VAULT_STAGING_BASE_URL/);
    assert.doesNotMatch(
      rollback,
      /META_ADS_NOVOHAMBURGO_PAGE_ID|META_ADS_BARRASHOPPPINGSUL_PAGE_ID|destination_page_ids|page_id/,
    );
    assert.match(rollback, /staging-synthetic-seed\/rollback/);
    assert.match(
      rollback,
      /operation_key: operationKey,[\s\S]*access_token: accessToken,[\s\S]*account_id: accountId,[\s\S]*api_version: apiVersion/,
    );
    assert.match(rollback, /payload\?\.rolled_back !== true/);
    assert.match(rollback, /meta-ads-tracking-v20\/staging-synthetic-seed\/v2/);
    assert.match(rollback, /\^v\(\?:2\[5-9\]\|\[3-9\]\[0-9\]\)\\\.0\$/);
  }
  for (const rollback of [pretrafficRollback, activationLeaseRollback]) {
    assert.match(rollback, /meta_ads_publish_staging_seed_operation_not_found/);
  }
  assert.match(compensationRollback, /TOKEN_VAULT_CANDIDATE_PREVIEW_URL/);
  assert.doesNotMatch(compensationRollback, /TOKEN_VAULT_STAGING_BASE_URL/);
  const sourceScopes = [
    attestation,
    seed,
    pretrafficRollback,
    activationLeaseRollback,
    compensationRollback,
  ];
  for (const sourceName of [
    "META_ADS_ACCESS_TOKEN",
    "META_PIXEL_ID",
    "META_ADS_NOVOHAMBURGO_PAGE_ID",
    "META_ADS_BARRASHOPPPINGSUL_PAGE_ID",
    "META_ADS_ACCOUNT_ID",
    "META_ADS_API_VERSION",
  ]) {
    const total = [...workflow.matchAll(new RegExp(sourceName, "g"))].length;
    const allowedScopes =
      sourceName === "META_ADS_API_VERSION" ||
      sourceName === "META_ADS_NOVOHAMBURGO_PAGE_ID" ||
      sourceName === "META_ADS_BARRASHOPPPINGSUL_PAGE_ID"
        ? [...sourceScopes, authorization]
        : sourceScopes;
    const scoped = allowedScopes.reduce(
      (count, scope) =>
        count + [...scope.matchAll(new RegExp(sourceName, "g"))].length,
      0,
    );
    assert.equal(
      total,
      scoped,
      `${sourceName} must only reach bounded staging seed calls`,
    );
  }
  assert.match(
    cleanup,
    /\$RUNNER_TEMP"\/token-vault-staging-synthetic-seed-\*/,
  );
  assert.match(cleanup, /rm -f -- "\$seed_file"/);
  assert.doesNotMatch(workflow, /META_ADS_PAGE_ID|page_id: pageId/);
});
