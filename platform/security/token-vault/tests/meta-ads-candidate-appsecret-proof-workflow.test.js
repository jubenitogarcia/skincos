import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL(
    "../../../../.github/workflows/attest-meta-ads-candidate-appsecret.yml",
    import.meta.url,
  ),
  "utf8",
);

test("candidate appsecret-proof attestation is manual, main-pinned, and serialized with Token Vault releases", () => {
  assert.match(workflow, /^name: Attest Meta Ads Candidate Appsecret Proof$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /group: deploy-token-vault-staging/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /timeout-minutes: 8/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(
    workflow,
    /git fetch --no-tags origin main:refs\/remotes\/origin\/main/,
  );
  assert.match(
    workflow,
    /main advanced before the candidate upload; redispatch the current source/,
  );

  assert.equal(
    (workflow.match(/global-coordination-acquire/g) || []).length,
    1,
  );
  assert.equal((workflow.match(/global-coordination-check/g) || []).length, 1);
  assert.equal(
    (workflow.match(/global-coordination-release/g) || []).length,
    1,
  );
  assert.equal(
    (workflow.match(/resource: release:token-vault/g) || []).length,
    2,
  );
  assert.match(workflow, /module: token-vault/);
  assert.match(workflow, /token-vault-candidate-appsecret-proof-lease\.json/);
});

test("candidate appsecret-proof workflow uploads exactly one non-promoted candidate with a private ephemeral bearer", () => {
  assert.match(workflow, /randomBytes\(48\)\.toString\('base64url'\)/);
  assert.match(workflow, /umask 077/);
  assert.match(workflow, /chmod 600 "\$seed_file"/);
  assert.match(workflow, /chmod 600 "\$secrets_file"/);
  assert.match(workflow, /TOKEN_VAULT_META_ADS_STAGING_SEED_TOKEN: seedToken/);
  const privateSecretsFileWriter = workflow.slice(
    workflow.indexOf('SEED_FILE="$seed_file" SECRETS_FILE="$secrets_file"'),
    workflow.indexOf('chmod 600 "$secrets_file"'),
  );
  assert.doesNotMatch(
    privateSecretsFileWriter,
    /META_ADS_NOVOHAMBURGO_PAGE_ID|META_ADS_BARRASHOPPPINGSUL_PAGE_ID|destinationPageIds|pageId/,
  );
  assert.match(
    workflow,
    /upload_output="\$\(npx --yes wrangler@4\.120\.0 versions upload/,
  );
  assert.match(workflow, /--env staging/);
  assert.match(workflow, /--keep-vars/);
  assert.match(workflow, /--strict/);
  assert.match(workflow, /--secrets-file "\$secrets_file"/);
  assert.match(
    workflow,
    /token-vault:candidate-appsecret-proof:\$\{SOURCE_SHA\}/,
  );
  assert.match(
    workflow,
    /expected_preview="https:\/\/\$\{version_id%%-\*\}-skincos-token-vault-staging\.skincos\.workers\.dev"/,
  );
  assert.match(workflow, /grep -F -x "\$expected_preview"/);
  assert.match(workflow, /attest-appsecret-proof/);
  assert.match(workflow, /cache: 'no-store'/);
  assert.match(workflow, /redirect: 'error'/);
  assert.match(workflow, /AbortSignal\.timeout\(30_000\)/);
  assert.match(workflow, /candidate_appsecret_proof=verified/);
  assert.match(workflow, /Remove candidate-only proof files/);
  assert.match(workflow, /rm -f -- "\$proof_root\/seed-bearer"/);

  assert.doesNotMatch(workflow, /META_APP_SECRET/);
  assert.doesNotMatch(workflow, /versions deploy/);
  assert.doesNotMatch(workflow, /wrangler deploy/);
  assert.doesNotMatch(workflow, /\bd1\b/i);
  assert.doesNotMatch(workflow, /migration/i);
  assert.doesNotMatch(workflow, /bootstrap/i);
  assert.doesNotMatch(workflow, /fixture/i);
  assert.doesNotMatch(workflow, /\borb\b/i);
  assert.doesNotMatch(workflow, /upload-artifact/i);
  assert.doesNotMatch(workflow, /GITHUB_OUTPUT/);
  assert.doesNotMatch(workflow, /secret put/i);
  assert.doesNotMatch(workflow, /gh secret/i);
});

test("candidate appsecret-proof request keeps source inputs and bearer private while validating a closed response shape", () => {
  assert.match(workflow, /Authorization: `Bearer \$\{seedToken\}`/);
  assert.match(workflow, /access_token: sourceToken/);
  assert.match(workflow, /account_id: accountId/);
  assert.match(workflow, /pixel_id: pixelId/);
  assert.match(
    workflow,
    /META_ADS_NOVOHAMBURGO_PAGE_ID: \$\{\{ secrets\.novohamburgo_page_id \}\}/,
  );
  assert.match(
    workflow,
    /META_ADS_BARRASHOPPPINGSUL_PAGE_ID: \$\{\{ secrets\.barrashopppingsul_page_id \}\}/,
  );
  assert.match(
    workflow,
    /const destinationPageIds = \{[\s\S]*novo_hamburgo: String\(process\.env\.META_ADS_NOVOHAMBURGO_PAGE_ID \|\| ''\)\.trim\(\),[\s\S]*barra_shopping_sul: String\(process\.env\.META_ADS_BARRASHOPPPINGSUL_PAGE_ID \|\| ''\)\.trim\(\),/,
  );
  assert.match(
    workflow,
    /destinationPageIds\.novo_hamburgo === destinationPageIds\.barra_shopping_sul/,
  );
  assert.match(workflow, /destination_page_ids: destinationPageIds/);
  assert.match(workflow, /api_version: apiVersion/);
  assert.match(
    workflow,
    /const allowedKeys = new Set\(\['ok', 'attestation', 'contract_version', 'requestId'\]\)/,
  );
  assert.match(
    workflow,
    /payload\?\.attestation === 'appsecret_proof_verified'/,
  );
  assert.match(
    workflow,
    /payload\?\.contract_version === 'meta-ads-tracking-v20\/staging-synthetic-seed\/v2'/,
  );
  assert.match(
    workflow,
    /candidate appsecret-proof attestation failed: \$\{response\.status\} \$\{error\}/,
  );
  assert.doesNotMatch(
    workflow,
    /process\.stdout\.write\([^\n]*(?:seedToken|sourceToken|pixelId|destinationPageIds|pageId|accountId|preview)/,
  );
  assert.doesNotMatch(workflow, /META_ADS_PAGE_ID|page_id:/);
  assert.doesNotMatch(workflow, /operation_key=.*GITHUB_OUTPUT/);
});
