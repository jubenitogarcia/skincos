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
const syntheticSystemUserId = "6677889900";
const syntheticPageId = "1122334455";
const syntheticInstagramId = "5544332211";
const syntheticDatasetId = "9988776655";

function runVerifier(responses, expectedRequests = responses.length) {
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
    const verifierExit = Symbol('verifier-exit');
    let verifierExitCode = null;
    const originalExit = process.exit;
    process.exit = (code = 0) => {
      verifierExitCode = Number(code);
      throw verifierExit;
    };
    try {
      await (async () => {
        ${embeddedProgram}
      })();
    } catch (error) {
      if (error !== verifierExit) throw error;
    } finally {
      process.exit = originalExit;
    }
    if (cursor !== ${expectedRequests}) throw new Error('unexpected Graph request count');
    process.stdout.write(\`__synthetic_request_count=\${cursor}\\n\`);
    if (verifierExitCode !== null) process.exitCode = verifierExitCode;
  `;
  const result = spawnSync(
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
  const stdout = String(result.stdout || "");
  const requestCount = /^__synthetic_request_count=(\d+)$/m.exec(stdout);
  return {
    ...result,
    stdout: stdout.replace(/^__synthetic_request_count=\d+\r?\n?/m, ""),
    requestCount: requestCount ? Number(requestCount[1]) : null,
  };
}

const happyResponses = [
  {
    pathname: `/v25.0/${syntheticPixelId}`,
    query: { fields: "id" },
    payload: {
      id: syntheticPixelId,
    },
  },
  {
    pathname: `/v25.0/act_${syntheticAccountId}/adspixels`,
    query: { fields: "id", limit: "5" },
    payload: {
      data: [{ id: syntheticPixelId }],
    },
  },
  {
    pathname: "/v25.0/me/accounts",
    query: { fields: "id,tasks,instagram_business_account{id}", limit: "100" },
    payload: {
      data: [
        {
          id: syntheticPageId,
          tasks: ["ADVERTISE"],
          instagram_business_account: { id: syntheticInstagramId },
        },
      ],
    },
  },
  {
    pathname: `/v25.0/${syntheticPageId}`,
    query: { fields: "id,instagram_business_account{id},website,picture{url}" },
    payload: {
      id: syntheticPageId,
      instagram_business_account: { id: syntheticInstagramId },
      website: "https://staging.example.test",
      picture: { data: { url: "https://cdn.example.test/picture.jpg" } },
    },
  },
  {
    pathname: `/v25.0/act_${syntheticAccountId}/offline_conversion_data_sets`,
    query: { fields: "id", limit: "2" },
    payload: { data: [{ id: syntheticDatasetId }] },
  },
];

function systemUserAssignedPageResponses(assignedPages = structuredClone(happyResponses[2].payload.data)) {
  const responses = structuredClone(happyResponses);
  responses[2].payload.data = [];
  responses.splice(
    3,
    0,
    {
      pathname: "/v25.0/me",
      query: { fields: "id" },
      payload: { id: syntheticSystemUserId },
    },
    {
      pathname: `/v25.0/${syntheticSystemUserId}/assigned_pages`,
      query: { fields: "id,tasks,instagram_business_account{id}", limit: "100" },
      payload: { data: assignedPages },
    },
  );
  return responses;
}

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
  assert.match(workflow, /\$\{pixelId\}\?fields=id/);
  assert.match(workflow, /act_\$\{accountId\}\/adspixels\?fields=id&limit=5/);
  assert.match(workflow, /source_pixel_account_relation/);
  assert.match(workflow, /targetMemberships === 1/);
  assert.match(workflow, /source_pixel_account_relation_ambiguous/);
  assert.doesNotMatch(workflow, /owner_ad_account/);
  assert.match(
    workflow,
    /me\/accounts\?fields=id,tasks,instagram_business_account\{id\}&limit=100/,
  );
  assert.match(workflow, /me\?fields=id/);
  assert.match(
    workflow,
    /assigned_pages\?fields=id,tasks,instagram_business_account\{id\}&limit=100/,
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
  assert.match(workflow, /tasks\.has\('PROFILE_PLUS_ADVERTISE'\)/);
  assert.doesNotMatch(workflow, /PROFILE_PLUS_FULL_CONTROL/);
  assert.match(workflow, /selectEligiblePage\(pages\.data, 'source_pages'\)/);
  assert.match(workflow, /selectEligiblePage\(assignedPages\.data, 'source_system_user_pages'\)/);
  assert.match(workflow, /source_system_user_malformed/);
  assert.match(workflow, /source_system_user_pages_paging_ambiguous/);
  assert.match(workflow, /eligiblePages\.length === 0/);
  assert.match(workflow, /eligiblePages\.length > 1/);
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
  assert.match(workflow, /source_access_pixel_account_relation=allowed/);
  assert.match(workflow, /source_access_page_discovery=\$\{pageDiscovery\}/);
  assert.match(workflow, /source_access_page=eligible/);
  assert.match(workflow, /source_access_dataset=eligible/);
  assert.match(workflow, /source_access_landing_media=eligible/);
  assert.ok(
    workflow.indexOf("source_pixel_account_relation_mismatch") <
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
    /source_access_(?:pixel_id|page_id|dataset_id|landing_url|picture_url|system_user_id)/i,
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
      "source_access_pixel_account_relation=allowed",
      "source_access_page_discovery=me_accounts",
      "source_access_page=eligible",
      "source_access_dataset=eligible",
      "source_access_landing_media=eligible",
      "",
    ].join("\n"),
  );
  assert.equal(result.requestCount, 5);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier accepts an exact membership on a bounded account Pixel page", () => {
  const responses = structuredClone(happyResponses);
  responses[1].payload.paging = { next: "https://graph.example.invalid/opaque" };
  const result = runVerifier(responses);
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(result.requestCount, 5);
  assert.match(result.stdout, /source_access_raw=verified/);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier accepts the explicit Profile Plus advertising task", () => {
  const responses = structuredClone(happyResponses);
  responses[2].payload.data[0].tasks = ["PROFILE_PLUS_ADVERTISE"];
  const result = runVerifier(responses);
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(result.requestCount, 5);
  assert.match(result.stdout, /source_access_raw=verified/);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier does not treat other Profile Plus tasks as advertising", () => {
  const responses = structuredClone(happyResponses);
  responses[2].payload.data[0].tasks = ["PROFILE_PLUS_ANALYZE"];
  const result = runVerifier(responses, 3);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pages_advertise_task_missing/);
  assert.equal(result.requestCount, 3);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier fails closed when target membership is beyond the bounded page", () => {
  const responses = structuredClone(happyResponses);
  responses[1].payload = {
    data: [],
    paging: { next: "https://graph.example.invalid/opaque" },
  };
  const result = runVerifier(responses, 2);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pixel_account_relation_ambiguous/);
  assert.equal(result.requestCount, 2);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier classifies malformed bounded account Pixel entries before membership", () => {
  const responses = structuredClone(happyResponses);
  responses[1].payload = { data: [{ id: false }] };
  const result = runVerifier(responses, 2);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pixel_account_relation_malformed/);
  assert.equal(result.requestCount, 2);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier distinguishes multiple eligible Pages", () => {
  const responses = structuredClone(happyResponses);
  responses[2].payload.data.unshift({
    id: "6655443322",
    tasks: ["ADVERTISE"],
    instagram_business_account: { id: "2233445566" },
  });
  const result = runVerifier(responses, 3);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pages_multiple_eligible/);
  assert.equal(result.requestCount, 3);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier distinguishes a paged Page listing", () => {
  const responses = structuredClone(happyResponses);
  responses[2].payload.paging = { next: false };
  const result = runVerifier(responses, 3);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pages_paging_ambiguous/);
  assert.equal(result.requestCount, 3);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier falls back to the bounded System User Page relation after an empty direct list", () => {
  const result = runVerifier(systemUserAssignedPageResponses());
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(result.requestCount, 7);
  assert.match(result.stdout, /source_access_page_discovery=system_user_assigned/);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}|${syntheticSystemUserId}|${syntheticPageId}|${syntheticInstagramId}|${syntheticDatasetId}`),
  );
});

test("Meta Ads source-access verifier keeps an empty System User Page relation fail-closed", () => {
  const result = runVerifier(systemUserAssignedPageResponses([]), 5);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_system_user_pages_none_visible/);
  assert.equal(result.requestCount, 5);
  assert.doesNotMatch(combined, /source_access_raw=verified/);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}|${syntheticSystemUserId}`),
  );
});

test("Meta Ads source-access verifier rejects pagination on the bounded System User Page relation", () => {
  const responses = systemUserAssignedPageResponses();
  responses[4].payload.paging = { next: false };
  const result = runVerifier(responses, 5);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_system_user_pages_paging_ambiguous/);
  assert.equal(result.requestCount, 5);
  assert.doesNotMatch(combined, /source_access_raw=verified/);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}|${syntheticSystemUserId}`),
  );
});

test("Meta Ads source-access verifier rejects a malformed System User identity before its Page relation", () => {
  const responses = systemUserAssignedPageResponses();
  responses[3].payload = { id: false };
  const result = runVerifier(responses, 4);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_system_user_malformed/);
  assert.equal(result.requestCount, 4);
  assert.doesNotMatch(combined, /source_access_raw=verified/);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}|${syntheticSystemUserId}`),
  );
});

test("Meta Ads source-access verifier distinguishes an absent advertising task from a missing Page", () => {
  const responses = structuredClone(happyResponses);
  responses[2].payload.data[0].tasks = [];
  const result = runVerifier(responses, 3);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pages_advertise_task_missing/);
  assert.equal(result.requestCount, 3);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier distinguishes a missing Instagram link from a missing Page", () => {
  const responses = structuredClone(happyResponses);
  delete responses[2].payload.data[0].instagram_business_account;
  const result = runVerifier(responses, 3);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pages_instagram_link_missing/);
  assert.equal(result.requestCount, 3);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier distinguishes Page task and Instagram facts that do not belong to the same Page", () => {
  const responses = structuredClone(happyResponses);
  responses[2].payload.data = [
    { id: "6655443322", tasks: ["ADVERTISE"] },
    { id: "2233445566", tasks: [], instagram_business_account: { id: "5544332211" } },
  ];
  const result = runVerifier(responses, 3);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pages_task_instagram_unpaired/);
  assert.equal(result.requestCount, 3);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier keeps a unique eligible Page despite unrelated Pages", () => {
  const responses = structuredClone(happyResponses);
  responses[2].payload.data.unshift({
    id: "6655443322",
    tasks: [],
  });
  const result = runVerifier(responses);
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(result.requestCount, 5);
  assert.match(result.stdout, /source_access_raw=verified/);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier classifies a selected malformed Page before Page access", () => {
  const responses = structuredClone(happyResponses);
  responses[2].payload.data[0].id = false;
  const result = runVerifier(responses, 3);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pages_malformed/);
  assert.equal(result.requestCount, 3);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier distinguishes bare Pixel denial before relation access", () => {
  const result = runVerifier([
    {
      pathname: `/v25.0/${syntheticPixelId}`,
      query: { fields: "id" },
      status: 403,
      payload: { error: { code: 10, message: "synthetic denial" } },
    },
  ]);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pixel_denied/);
  assert.doesNotMatch(combined, /source_pixel_account_relation/);
  assert.doesNotMatch(combined, /synthetic denial/);
  assert.equal(result.requestCount, 1);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier distinguishes account-membership denial after Pixel access", () => {
  const result = runVerifier([
    {
      pathname: `/v25.0/${syntheticPixelId}`,
      query: { fields: "id" },
      payload: { id: syntheticPixelId },
    },
    {
      pathname: `/v25.0/act_${syntheticAccountId}/adspixels`,
      query: { fields: "id", limit: "5" },
      status: 403,
      payload: { error: { code: 10, message: "synthetic denial" } },
    },
  ]);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pixel_account_relation_denied/);
  assert.doesNotMatch(combined, /source_access_raw=verified/);
  assert.doesNotMatch(combined, /synthetic denial/);
  assert.equal(result.requestCount, 2);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});

test("Meta Ads source-access verifier classifies an account-membership contract error without leaking Graph details", () => {
  const result = runVerifier([
    {
      pathname: `/v25.0/${syntheticPixelId}`,
      query: { fields: "id" },
      payload: { id: syntheticPixelId },
    },
    {
      pathname: `/v25.0/act_${syntheticAccountId}/adspixels`,
      query: { fields: "id", limit: "5" },
      status: 200,
      payload: { error: { code: 100, message: "synthetic contract error" } },
    },
  ]);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.match(combined, /source_pixel_account_relation_malformed/);
  assert.doesNotMatch(combined, /synthetic contract error/);
  assert.equal(result.requestCount, 2);
  assert.doesNotMatch(
    combined,
    new RegExp(`${syntheticToken}|${syntheticPixelId}|${syntheticAccountId}`),
  );
});
