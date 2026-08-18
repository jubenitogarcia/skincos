import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL(
    "../../../../.github/workflows/attest-meta-ads-source-access.yml",
    import.meta.url,
  ),
  "utf8",
);
const embeddedProgram = workflow.match(
  /node --input-type=module <<'NODE'\n([\s\S]*?)\n\s+NODE/m,
)?.[1];
assert.ok(
  embeddedProgram,
  "the source-access workflow must embed its Node verifier",
);

const syntheticToken = "synthetic-source-bearer-not-a-secret";
const syntheticPixelId = "1234567890";
const syntheticAccountId = "9876543210";

function runVerifier(responses) {
  const harness = `
    const scenario = ${JSON.stringify(responses)};
    let cursor = 0;
    globalThis.fetch = async (value, options = {}) => {
      const expected = scenario[cursor++];
      if (!expected) throw new Error('unexpected Graph request');
      const url = new URL(String(value));
      if (url.origin !== 'https://graph.facebook.com' || url.pathname !== expected.pathname) throw new Error('unexpected Graph request');
      if (String(options.method || '') !== 'GET' || String(options.cache || '') !== 'no-store' || String(options.redirect || '') !== 'error') throw new Error('unexpected Graph request');
      if (String(options.headers?.Authorization || '') !== 'Bearer ${syntheticToken}') throw new Error('unexpected Graph request');
      for (const [key, expectedValue] of Object.entries(expected.query || {})) {
        if (url.searchParams.get(key) !== expectedValue) throw new Error('unexpected Graph request');
      }
      return new Response(JSON.stringify(expected.payload), { status: expected.status ?? 200 });
    };
    ${embeddedProgram}
    if (cursor !== scenario.length) throw new Error('missing Graph request');
  `;
  return spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", harness],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        META_ADS_ACCESS_TOKEN: syntheticToken,
        META_PIXEL_ID: syntheticPixelId,
        META_ADS_ACCOUNT_ID: syntheticAccountId,
        META_ADS_API_VERSION: "v25.0",
      },
    },
  );
}

const happyResponses = [
  {
    pathname: `/v25.0/${syntheticPixelId}`,
    query: { fields: "id,owner_ad_account{id}" },
    payload: {
      id: syntheticPixelId,
      owner_ad_account: { id: syntheticAccountId },
    },
  },
  {
    pathname: "/v25.0/me/accounts",
    query: { fields: "id,tasks,instagram_business_account{id}", limit: "100" },
    payload: {
      data: [
        {
          id: "1122334455",
          tasks: ["ADVERTISE"],
          instagram_business_account: { id: "5544332211" },
        },
      ],
    },
  },
  {
    pathname: "/v25.0/1122334455",
    query: { fields: "id,instagram_business_account{id},website,picture{url}" },
    payload: {
      id: "1122334455",
      instagram_business_account: { id: "5544332211" },
      website: "https://staging.example.test",
      picture: { data: { url: "https://cdn.example.test/picture.jpg" } },
    },
  },
  {
    pathname: `/v25.0/act_${syntheticAccountId}/offline_conversion_data_sets`,
    query: { fields: "id", limit: "2" },
    payload: { data: [{ id: "9988776655" }] },
  },
];

test("Meta Ads source-access attestation is manual, bounded, and non-deploying", () => {
  assert.match(workflow, /^name: Attest Raw Meta Ads Staging Source Access$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /timeout-minutes: 3/);
  assert.match(
    workflow,
    /META_ADS_ACCESS_TOKEN: \$\{\{ secrets\.META_ADS_ACCESS_TOKEN \}\}/,
  );
  assert.match(workflow, /META_PIXEL_ID: \$\{\{ secrets\.META_PIXEL_ID \}\}/);
  assert.match(
    workflow,
    /META_ADS_ACCOUNT_ID: \$\{\{ vars\.META_ADS_ACCOUNT_ID \}\}/,
  );
  assert.match(
    workflow,
    /META_ADS_API_VERSION: \$\{\{ vars\.META_ADS_API_VERSION \}\}/,
  );
  assert.match(workflow, /payload\?\.error\?\.is_transient === true/);
  assert.match(
    workflow,
    /const graphErrorCode = Number\(payload\?\.error\?\.code\)/,
  );
  assert.match(workflow, /response\.status === 401/);
  assert.match(workflow, /response\.status === 403/);
  assert.match(workflow, /graphErrorCode === 10/);
  assert.match(workflow, /graphErrorCode === 102/);
  assert.match(workflow, /graphErrorCode === 190/);
  assert.match(workflow, /graphErrorCode === 200/);
  assert.match(workflow, /authorizationError \? 'denied' : 'malformed'/);
  assert.match(workflow, /\$\{pixelId\}\?fields=id,owner_ad_account\{id\}/);
  assert.match(
    workflow,
    /me\/accounts\?fields=id,tasks,instagram_business_account\{id\}&limit=100/,
  );
  assert.match(
    workflow,
    /\$\{pageId\}\?fields=id,instagram_business_account\{id\},website,picture\{url\}/,
  );
  assert.match(
    workflow,
    /act_\$\{accountId\}\/offline_conversion_data_sets\?fields=id&limit=2/,
  );
  assert.match(workflow, /tasks\.has\('ADVERTISE'\)/);
  assert.match(workflow, /eligiblePages\.length !== 1/);
  assert.match(workflow, /datasets\.data\.length !== 1/);
  assert.match(workflow, /source_landing_or_media_unavailable/);
  assert.match(workflow, /method: 'GET'/);
  assert.match(workflow, /Authorization: `Bearer \$\{token\}`/);
  assert.match(workflow, /cache: 'no-store'/);
  assert.match(workflow, /redirect: 'error'/);
  assert.match(workflow, /AbortSignal\.timeout\(12_000\)/);
  assert.match(workflow, /source_access_raw=verified/);
  assert.match(workflow, /source_access_runtime_proof=unverified/);
  assert.match(workflow, /source_access_pixel=allowed/);
  assert.match(workflow, /source_access_ad_account=allowed/);
  assert.match(workflow, /source_access_page=eligible/);
  assert.match(workflow, /source_access_dataset=eligible/);
  assert.match(workflow, /source_access_landing_media=eligible/);
  assert.ok(
    workflow.indexOf("source_pixel_mismatch") <
      workflow.indexOf("source_access_raw=verified"),
    "raw success output must be unreachable until the exact source reads pass",
  );

  assert.doesNotMatch(workflow, /access_token=/i);
  assert.doesNotMatch(workflow, /debug_token/i);
  assert.doesNotMatch(workflow, /META_APP_SECRET/);
  assert.doesNotMatch(workflow, /appsecret_proof/);
  assert.doesNotMatch(workflow, /method: 'POST'/);
  assert.doesNotMatch(workflow, /upload-artifact/i);
  assert.doesNotMatch(workflow, /wrangler/i);
  assert.doesNotMatch(workflow, /gh secret/i);
  assert.doesNotMatch(workflow, /secret put/i);
  assert.doesNotMatch(workflow, /GITHUB_OUTPUT/);
  assert.doesNotMatch(workflow, /me\/permissions/);
  assert.doesNotMatch(workflow, /pages_manage_ads/);
  assert.doesNotMatch(
    workflow,
    /source_access_(?:pixel_id|page_id|dataset_id|landing_url|picture_url)/i,
  );
  assert.doesNotMatch(workflow, /D1|Cloudflare|Orb|n8n/);
});

test("Meta Ads source-access verifier executes the bounded raw-read contract without revealing inputs", () => {
  const result = runVerifier(happyResponses);
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(
    result.stdout,
    [
      "source_access_raw=verified",
      "source_access_runtime_proof=unverified",
      "source_access_pixel=allowed",
      "source_access_ad_account=allowed",
      "source_access_page=eligible",
      "source_access_dataset=eligible",
      "source_access_landing_media=eligible",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier fails closed for an additional malformed eligible Page", () => {
  const responses = structuredClone(happyResponses);
  responses[1].payload.data.unshift({
    id: false,
    tasks: ["ADVERTISE"],
    instagram_business_account: { id: "6655443322" },
  });
  const result = runVerifier(responses);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pages_ambiguous/);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier fails closed for falsy paging metadata", () => {
  const responses = structuredClone(happyResponses);
  responses[1].payload.paging = { next: false };
  const result = runVerifier(responses);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pages_ambiguous/);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});
