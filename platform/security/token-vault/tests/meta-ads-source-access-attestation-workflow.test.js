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
const syntheticNovoPageId = "1122334455";
const syntheticNovoInstagramId = "5544332211";
const syntheticBarraPageId = "2233445566";
const syntheticBarraInstagramId = "6655443322";
const syntheticDatasetId = "9988776655";

function runVerifier(
  responses,
  {
    expectedRequests = responses.length,
    novoPageId = syntheticNovoPageId,
    barraPageId = syntheticBarraPageId,
  } = {},
) {
  const harness = `
    const scenario = ${JSON.stringify(responses)};
    let cursor = 0;
    globalThis.fetch = async (value, options = {}) => {
      const expected = scenario[cursor++];
      if (!expected) throw new Error('unexpected Graph request');
      const url = new URL(String(value));
      if (url.origin !== 'https://graph.facebook.com' || url.pathname !== expected.pathname) {
        throw new Error('unexpected Graph request');
      }
      if (String(options.method || '') !== 'GET' || String(options.cache || '') !== 'no-store' || String(options.redirect || '') !== 'error') {
        throw new Error('unexpected Graph request');
      }
      if (String(options.headers?.Authorization || '') !== 'Bearer ${syntheticToken}') {
        throw new Error('unexpected Graph request');
      }
      const actualQuery = [...url.searchParams.entries()].sort();
      const expectedQuery = Object.entries(expected.query || {}).sort();
      if (JSON.stringify(actualQuery) !== JSON.stringify(expectedQuery)) {
        throw new Error('unexpected Graph request');
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
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness], {
    encoding: "utf8",
    env: {
      ...process.env,
      META_ADS_ACCESS_TOKEN: syntheticToken,
      META_PIXEL_ID: syntheticPixelId,
      META_ADS_NOVOHAMBURGO_PAGE_ID: novoPageId,
      META_ADS_BARRASHOPPPINGSUL_PAGE_ID: barraPageId,
      META_ADS_ACCOUNT_ID: syntheticAccountId,
      META_ADS_API_VERSION: "v25.0",
    },
  });
  const stdout = String(result.stdout || "");
  const requestCount = /^__synthetic_request_count=(\d+)$/m.exec(stdout);
  return {
    ...result,
    stdout: stdout.replace(/^__synthetic_request_count=\d+\r?\n?/m, ""),
    requestCount: requestCount ? Number(requestCount[1]) : null,
  };
}

function happyResponses() {
  return [
    {
      pathname: `/v25.0/${syntheticPixelId}`,
      query: { fields: "id" },
      payload: { id: syntheticPixelId },
    },
    {
      pathname: `/v25.0/act_${syntheticAccountId}/adspixels`,
      query: { fields: "id", limit: "5" },
      payload: { data: [{ id: syntheticPixelId }] },
    },
    {
      pathname: "/v25.0/me",
      query: { fields: "id" },
      payload: { id: syntheticSystemUserId },
    },
    {
      pathname: `/v25.0/${syntheticSystemUserId}/assigned_pages`,
      query: {
        fields: "id,tasks,instagram_business_account{id},website,picture{url}",
        limit: "100",
      },
      payload: {
        data: [
          {
            id: syntheticNovoPageId,
            tasks: ["ADVERTISE"],
            instagram_business_account: { id: syntheticNovoInstagramId },
            website: "https://novo.example.test",
            picture: { data: { url: "https://cdn.example.test/novo.jpg" } },
          },
          {
            id: syntheticBarraPageId,
            tasks: ["ADVERTISE"],
            instagram_business_account: { id: syntheticBarraInstagramId },
            website: "https://barra.example.test",
            picture: { data: { url: "https://cdn.example.test/barra.jpg" } },
          },
        ],
      },
    },
    {
      pathname: `/v25.0/act_${syntheticAccountId}/offline_conversion_data_sets`,
      query: { fields: "id", limit: "2" },
      payload: { data: [{ id: syntheticDatasetId }] },
    },
  ];
}

const sensitiveValues = [
  syntheticToken,
  syntheticPixelId,
  syntheticAccountId,
  syntheticSystemUserId,
  syntheticNovoPageId,
  syntheticNovoInstagramId,
  syntheticBarraPageId,
  syntheticBarraInstagramId,
  syntheticDatasetId,
];

function assertNoSyntheticInputs(output) {
  for (const value of sensitiveValues) assert.doesNotMatch(output, new RegExp(value));
}

test("Meta Ads source-access attestation is manual, GET-only, and bound to two staging selectors", () => {
  assert.match(workflow, /^name: Attest Raw Meta Ads Staging Source Access$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /timeout-minutes: 3/);
  assert.match(
    workflow,
    /META_ADS_NOVOHAMBURGO_PAGE_ID: \$\{\{ secrets\.NOVOHAMBURGO_PAGE_ID \}\}/,
  );
  assert.match(
    workflow,
    /META_ADS_BARRASHOPPPINGSUL_PAGE_ID: \$\{\{ secrets\.BARRASHOPPINGSUL_PAGE_ID \}\}/,
  );
  assert.match(workflow, /destinationSelectors = \{[\s\S]*novo_hamburgo:[\s\S]*barra_shopping_sul:/);
  assert.match(workflow, /source_destination_page_selector_invalid/);
  assert.match(workflow, /source_destination_page_selector_duplicate/);
  assert.match(workflow, /source_destination_page_assignment_unassigned/);
  assert.match(workflow, /source_destination_page_selector_ambiguous/);
  assert.match(workflow, /source_destination_page_pair_duplicate/);
  assert.match(
    workflow,
    /assigned_pages\?fields=id,tasks,instagram_business_account\{id\},website,picture\{url\}&limit=100/,
  );
  assert.doesNotMatch(workflow, /\$\{pair\.pageId\}\?fields=/);
  assert.match(workflow, /source_access_novohamburgo_page_instagram=eligible/);
  assert.match(workflow, /source_access_barrashopppingsul_page_instagram=eligible/);

  assert.doesNotMatch(workflow, /META_ADS_PAGE_ID/);
  assert.doesNotMatch(workflow, /me\/accounts/);
  assert.doesNotMatch(workflow, /method: 'POST'/);
  assert.doesNotMatch(workflow, /upload-artifact/i);
  assert.doesNotMatch(workflow, /wrangler/i);
  assert.doesNotMatch(workflow, /GITHUB_OUTPUT/);
  assert.doesNotMatch(workflow, /META_APP_SECRET/);
  assert.doesNotMatch(workflow, /appsecret_proof/);
  assert.doesNotMatch(workflow, /access_token=/i);
  assert.doesNotMatch(workflow, /console\.log/);
  assert.doesNotMatch(
    workflow,
    /source_access_(?:pixel_id|page_id|dataset_id|landing_url|picture_url|system_user_id)/i,
  );
});

test("Meta Ads source-access verifier proves both assigned Page and Instagram pairs without revealing inputs", () => {
  const result = runVerifier(happyResponses());
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(result.requestCount, 5);
  assert.equal(
    result.stdout,
    [
      "source_access_raw=verified",
      "source_access_runtime_proof=unverified",
      "source_access_pixel=allowed",
      "source_access_pixel_account_relation=allowed",
      "source_access_novohamburgo_page_instagram=eligible",
      "source_access_barrashopppingsul_page_instagram=eligible",
      "source_access_dataset=eligible",
      "source_access_landing_media=eligible",
      "",
    ].join("\n"),
  );
  assertNoSyntheticInputs(combined);
});

test("Meta Ads source-access verifier rejects invalid or duplicate destination selectors before Graph reads", () => {
  const invalid = runVerifier([], {
    expectedRequests: 0,
    novoPageId: "not-a-page-id",
  });
  const invalidCombined = `${invalid.stdout}${invalid.stderr}`;
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.requestCount, 0);
  assert.match(invalidCombined, /source_destination_page_selector_invalid/);
  assert.doesNotMatch(invalidCombined, /not-a-page-id|source_access_raw=verified/);

  const duplicate = runVerifier([], {
    expectedRequests: 0,
    barraPageId: syntheticNovoPageId,
  });
  const duplicateCombined = `${duplicate.stdout}${duplicate.stderr}`;
  assert.notEqual(duplicate.status, 0);
  assert.equal(duplicate.requestCount, 0);
  assert.match(duplicateCombined, /source_destination_page_selector_duplicate/);
  assertNoSyntheticInputs(duplicateCombined);
});

test("Meta Ads source-access verifier accepts Profile Plus advertising and exact Pixel membership on a paged bounded relation", () => {
  const responses = happyResponses();
  responses[1].payload.paging = { next: "https://graph.example.invalid/opaque" };
  responses[3].payload.data[1].tasks = ["PROFILE_PLUS_ADVERTISE"];
  const result = runVerifier(responses);
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(result.requestCount, 5);
  assert.match(result.stdout, /source_access_raw=verified/);
  assertNoSyntheticInputs(combined);
});

test("Meta Ads source-access verifier keeps an absent target Pixel fail-closed when its bounded relation is paged", () => {
  const responses = happyResponses();
  responses[1].payload = {
    data: [],
    paging: { next: "https://graph.example.invalid/opaque" },
  };
  const result = runVerifier(responses, { expectedRequests: 2 });
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.equal(result.requestCount, 2);
  assert.match(combined, /source_pixel_account_relation_ambiguous/);
  assertNoSyntheticInputs(combined);
});

test("Meta Ads source-access verifier rejects an unassigned, non-advertising, or Instagram-less destination before direct Page reads", () => {
  const unassignedResponses = happyResponses();
  unassignedResponses[3].payload.data = [];
  const unassigned = runVerifier(unassignedResponses, { expectedRequests: 4 });
  assert.notEqual(unassigned.status, 0);
  assert.equal(unassigned.requestCount, 4);
  assert.match(`${unassigned.stdout}${unassigned.stderr}`, /source_destination_page_assignment_unassigned/);

  const taskResponses = happyResponses();
  taskResponses[3].payload.data[1].tasks = ["PROFILE_PLUS_ANALYZE"];
  const task = runVerifier(taskResponses, { expectedRequests: 4 });
  assert.notEqual(task.status, 0);
  assert.equal(task.requestCount, 4);
  assert.match(`${task.stdout}${task.stderr}`, /source_destination_page_assignment_advertise_task_missing/);

  const instagramResponses = happyResponses();
  delete instagramResponses[3].payload.data[1].instagram_business_account;
  const instagram = runVerifier(instagramResponses, { expectedRequests: 4 });
  assert.notEqual(instagram.status, 0);
  assert.equal(instagram.requestCount, 4);
  assert.match(`${instagram.stdout}${instagram.stderr}`, /source_destination_page_assignment_instagram_link_missing/);

  const malformedResponses = happyResponses();
  malformedResponses[3].payload.data[1].tasks = "ADVERTISE";
  const malformed = runVerifier(malformedResponses, { expectedRequests: 4 });
  assert.notEqual(malformed.status, 0);
  assert.equal(malformed.requestCount, 4);
  assert.match(`${malformed.stdout}${malformed.stderr}`, /source_destination_page_assignment_malformed/);
});

test("Meta Ads source-access verifier rejects duplicate, paged, and swapped destination pairs before unsafe continuation", () => {
  const duplicateResponses = happyResponses();
  duplicateResponses[3].payload.data[1].instagram_business_account.id = syntheticNovoInstagramId;
  const duplicate = runVerifier(duplicateResponses, { expectedRequests: 4 });
  assert.notEqual(duplicate.status, 0);
  assert.equal(duplicate.requestCount, 4);
  assert.match(`${duplicate.stdout}${duplicate.stderr}`, /source_destination_page_pair_duplicate/);

  const ambiguousResponses = happyResponses();
  ambiguousResponses[3].payload.data.push({
    id: syntheticNovoPageId,
    tasks: ["ADVERTISE"],
    instagram_business_account: { id: syntheticNovoInstagramId },
  });
  const ambiguous = runVerifier(ambiguousResponses, { expectedRequests: 4 });
  assert.notEqual(ambiguous.status, 0);
  assert.equal(ambiguous.requestCount, 4);
  assert.match(`${ambiguous.stdout}${ambiguous.stderr}`, /source_destination_page_selector_ambiguous/);

  const pagedResponses = happyResponses();
  pagedResponses[3].payload.paging = { next: false };
  const paged = runVerifier(pagedResponses, { expectedRequests: 4 });
  assert.notEqual(paged.status, 0);
  assert.equal(paged.requestCount, 4);
  assert.match(`${paged.stdout}${paged.stderr}`, /source_system_user_pages_paging_ambiguous/);

});

test("Meta Ads source-access verifier uses assigned_pages Page fields and stops before dataset on field failures", () => {
  const presentationResponses = happyResponses();
  delete presentationResponses[3].payload.data[0].website;
  const presentation = runVerifier(presentationResponses, { expectedRequests: 4 });
  const presentationCombined = `${presentation.stdout}${presentation.stderr}`;
  assert.notEqual(presentation.status, 0);
  assert.equal(presentation.requestCount, 4);
  assert.match(presentationCombined, /source_destination_landing_or_media_unavailable/);
  assert.doesNotMatch(presentationCombined, /source_access_raw=verified/);
  assertNoSyntheticInputs(presentationCombined);

  const assignedFields = happyResponses();
  assignedFields[3] = {
    ...assignedFields[3],
    status: 400,
    payload: { error: { code: 100, message: "synthetic assigned Page field detail" } },
  };
  const malformed = runVerifier(assignedFields, { expectedRequests: 4 });
  const malformedCombined = `${malformed.stdout}${malformed.stderr}`;
  assert.notEqual(malformed.status, 0);
  assert.equal(malformed.requestCount, 4);
  assert.match(malformedCombined, /source_system_user_pages_malformed/);
  assert.doesNotMatch(malformedCombined, /synthetic assigned Page field detail|source_access_raw=verified/);
  assertNoSyntheticInputs(malformedCombined);
});

test("Meta Ads source-access verifier reports only classified Graph failures", () => {
  const result = runVerifier([
    {
      pathname: `/v25.0/${syntheticPixelId}`,
      query: { fields: "id" },
      status: 403,
      payload: { error: { code: 10, message: "synthetic denial detail" } },
    },
  ]);
  const combined = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0);
  assert.equal(result.requestCount, 1);
  assert.match(combined, /source_pixel_denied/);
  assert.doesNotMatch(combined, /synthetic denial detail|source_access_raw=verified/);
  assertNoSyntheticInputs(combined);
});
