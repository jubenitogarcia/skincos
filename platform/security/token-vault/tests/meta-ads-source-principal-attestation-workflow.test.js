import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL(
    "../../../../.github/workflows/attest-meta-ads-source-principal.yml",
    import.meta.url,
  ),
  "utf8",
);

test("Meta Ads source-principal attestation is manual, bounded, and non-deploying", () => {
  assert.match(workflow, /^name: Attest Meta Ads Source Principal$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /timeout-minutes: 3/);
  assert.match(workflow, /META_ADS_ACCESS_TOKEN: \$\{\{ secrets\.META_ADS_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /META_ADS_API_VERSION: \$\{\{ vars\.META_ADS_API_VERSION \}\}/);
  assert.match(workflow, /ATTESTATION_CONTEXT: \$\{\{ github\.run_id \}\}:\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /https:\/\/graph\.facebook\.com\/\$\{apiVersion\}\/me\?fields=id/);
  assert.match(workflow, /method: 'GET'/);
  assert.match(workflow, /Authorization: `Bearer \$\{token\}`/);
  assert.match(workflow, /cache: 'no-store'/);
  assert.match(workflow, /redirect: 'error'/);
  assert.match(workflow, /AbortSignal\.timeout\(12_000\)/);
  assert.match(workflow, /skincos-meta-source-principal\/v1:\$\{context\}:\$\{principalId\}/);
  assert.match(workflow, /source_principal_attestation=verified/);
  assert.match(workflow, /source_principal_commitment=\$\{commitment\}/);

  assert.doesNotMatch(workflow, /access_token=/i);
  assert.doesNotMatch(workflow, /debug_token/i);
  assert.doesNotMatch(workflow, /upload-artifact/i);
  assert.doesNotMatch(workflow, /wrangler/i);
  assert.doesNotMatch(workflow, /gh secret/i);
  assert.doesNotMatch(workflow, /secret put/i);
  assert.doesNotMatch(workflow, /GITHUB_OUTPUT/);
  assert.doesNotMatch(workflow, /D1|Cloudflare|Orb|n8n/);
});
