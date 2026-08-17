import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL(
    "../../../../.github/workflows/attest-meta-ads-source-access.yml",
    import.meta.url,
  ),
  "utf8",
);

test("Meta Ads source-access attestation is manual, bounded, and non-deploying", () => {
  assert.match(workflow, /^name: Attest Meta Ads Staging Source Access$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /timeout-minutes: 3/);
  assert.match(workflow, /META_ADS_ACCESS_TOKEN: \$\{\{ secrets\.META_ADS_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /META_ADS_ACCOUNT_ID: \$\{\{ vars\.META_ADS_ACCOUNT_ID \}\}/);
  assert.match(workflow, /META_ADS_API_VERSION: \$\{\{ vars\.META_ADS_API_VERSION \}\}/);
  assert.match(workflow, /graphGet\('me\/permissions'\)/);
  assert.match(workflow, /graphGet\(`act_\$\{accountId\}\?fields=id`\)/);
  assert.match(workflow, /method: 'GET'/);
  assert.match(workflow, /Authorization: `Bearer \$\{token\}`/);
  assert.match(workflow, /cache: 'no-store'/);
  assert.match(workflow, /redirect: 'error'/);
  assert.match(workflow, /AbortSignal\.timeout\(12_000\)/);
  assert.match(workflow, /source_access_attestation=verified/);
  assert.match(workflow, /source_access_ads_read=/);
  assert.match(workflow, /source_access_ads_management=/);
  assert.match(workflow, /source_access_business_management=/);
  assert.match(workflow, /source_access_pages_show_list=/);
  assert.match(workflow, /source_access_pages_read_engagement=/);
  assert.match(workflow, /source_access_pages_manage_ads=/);
  assert.match(workflow, /source_access_instagram_basic=/);
  assert.match(workflow, /source_access_ad_account=/);

  assert.doesNotMatch(workflow, /access_token=/i);
  assert.doesNotMatch(workflow, /debug_token/i);
  assert.doesNotMatch(workflow, /method: 'POST'/);
  assert.doesNotMatch(workflow, /upload-artifact/i);
  assert.doesNotMatch(workflow, /wrangler/i);
  assert.doesNotMatch(workflow, /gh secret/i);
  assert.doesNotMatch(workflow, /secret put/i);
  assert.doesNotMatch(workflow, /GITHUB_OUTPUT/);
  assert.doesNotMatch(workflow, /META_PIXEL_ID/);
  assert.doesNotMatch(workflow, /D1|Cloudflare|Orb|n8n/);
});
