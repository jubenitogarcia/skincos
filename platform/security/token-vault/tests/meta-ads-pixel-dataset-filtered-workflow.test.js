import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL(
    "../../../../.github/workflows/diagnose-meta-ads-pixel-dataset-filtered.yml",
    import.meta.url,
  ),
  "utf8",
);
const embeddedProgram = workflow.match(
  /node --input-type=module <<'NODE'\n([\s\S]*?)\n\s+NODE/m,
  )?.[1];
assert.ok(embeddedProgram, "the filtered AdsDataset workflow must embed its Node verifier");

const syntheticToken = "synthetic-filtered-dataset-bearer-not-a-secret";
const syntheticPixelId = "1234567890";
const syntheticAccountId = "9876543210";
const syntheticBusinessId = "7788990011";
const syntheticDatasetId = "1234567890";
const syntheticOtherDatasetId = "8899001122";
const syntheticGraphMessage = "synthetic Graph body must never be emitted";

function runVerifier(responses, expectedRequests = responses.length) {
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
      if (
        String(options.method || '') !== 'GET' ||
        String(options.cache || '') !== 'no-store' ||
        String(options.redirect || '') !== 'error'
      ) {
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
    await (async () => {
      ${embeddedProgram}
    })();
    if (cursor !== ${expectedRequests}) throw new Error('unexpected Graph request count');
    process.stdout.write('__synthetic_request_count=' + cursor + '\\n');
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", harness], {
    encoding: "utf8",
    env: {
      ...process.env,
      META_ADS_ACCESS_TOKEN: syntheticToken,
      META_PIXEL_ID: syntheticPixelId,
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

function baseResponses() {
  return [
    {
      pathname: `/v25.0/act_${syntheticAccountId}`,
      query: { fields: "id,business{id}" },
      payload: { id: syntheticAccountId, business: { id: syntheticBusinessId } },
    },
    {
      pathname: `/v25.0/${syntheticBusinessId}/ads_dataset`,
      query: { fields: "id,dataset_id", id_filter: syntheticPixelId },
      payload: { data: [{ id: syntheticDatasetId, dataset_id: syntheticDatasetId }] },
    },
  ];
}

const sensitiveValues = [
  syntheticToken,
  syntheticPixelId,
  syntheticAccountId,
  syntheticBusinessId,
  syntheticDatasetId,
  syntheticOtherDatasetId,
  syntheticGraphMessage,
];

function assertNoSensitiveValues(output) {
  for (const value of sensitiveValues) assert.doesNotMatch(output, new RegExp(value));
  assert.doesNotMatch(output, /graph\.facebook\.com/);
}

test("filtered AdsDataset diagnostic is manual, staging-read-only, and no-mutation", () => {
  assert.match(workflow, /^name: Diagnose Filtered Meta Ads Pixel Dataset$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /timeout-minutes: 3/);
  assert.match(workflow, /META_ADS_ACCESS_TOKEN: \$\{\{ secrets\.META_ADS_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /META_PIXEL_ID: \$\{\{ secrets\.META_PIXEL_ID \}\}/);
  assert.match(workflow, /META_ADS_ACCOUNT_ID: \$\{\{ vars\.META_ADS_ACCOUNT_ID \}\}/);
  assert.match(workflow, /META_ADS_API_VERSION: \$\{\{ vars\.META_ADS_API_VERSION \}\}/);
  assert.match(workflow, /ads_dataset/);
  assert.match(workflow, /fields: 'id,dataset_id'/);
  assert.match(workflow, /id_filter: pixelId/);
  assert.match(workflow, /method: 'GET'/);
  assert.match(workflow, /pixel_dataset_match/);
  assert.match(workflow, /pixel_dataset_absent/);
  assert.match(workflow, /pixel_dataset_ambiguous/);
  assert.match(workflow, /pixel_dataset_denied/);
  assert.match(workflow, /pixel_dataset_contract/);
  assert.doesNotMatch(workflow, /offline_conversion_data_sets/);
  assert.doesNotMatch(workflow, /fields=id&limit=/);
  assert.doesNotMatch(workflow, /wrangler|deploy-token-vault|upload-artifact|GITHUB_OUTPUT/i);
  assert.doesNotMatch(workflow, /D1|d1|method: 'POST'|appsecret_proof|META_APP_SECRET/);
  assert.doesNotMatch(workflow, /console\.log/);
  assert.doesNotMatch(workflow, /pixel_dataset_(?:id|dataset_id|business_id)/);
});

test("filtered AdsDataset diagnostic proves one Pixel-matching result without disclosure", () => {
  const result = runVerifier(baseResponses());
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(result.requestCount, 2);
  assert.equal(result.stdout, "pixel_dataset_match\n");
  assertNoSensitiveValues(combined);
});

test("filtered AdsDataset diagnostic classifies zero, multiple, and paged results", () => {
  const absentResponses = baseResponses();
  absentResponses[1].payload = { data: [] };
  const absent = runVerifier(absentResponses);
  assert.notEqual(absent.status, 0);
  assert.equal(absent.requestCount, 2);
  assert.match(`${absent.stdout}${absent.stderr}`, /pixel_dataset_absent/);
  assertNoSensitiveValues(`${absent.stdout}${absent.stderr}`);

  const ambiguousResponses = baseResponses();
  ambiguousResponses[1].payload = {
    data: [
      { id: syntheticDatasetId, dataset_id: syntheticDatasetId },
      { id: syntheticOtherDatasetId, dataset_id: syntheticOtherDatasetId },
    ],
  };
  const ambiguous = runVerifier(ambiguousResponses);
  assert.notEqual(ambiguous.status, 0);
  assert.equal(ambiguous.requestCount, 2);
  assert.match(`${ambiguous.stdout}${ambiguous.stderr}`, /pixel_dataset_ambiguous/);
  assertNoSensitiveValues(`${ambiguous.stdout}${ambiguous.stderr}`);

  const pagedResponses = baseResponses();
  pagedResponses[1].payload.paging = { next: "https://graph.example.invalid/opaque" };
  const paged = runVerifier(pagedResponses);
  assert.notEqual(paged.status, 0);
  assert.equal(paged.requestCount, 2);
  assert.match(`${paged.stdout}${paged.stderr}`, /pixel_dataset_ambiguous/);
  assertNoSensitiveValues(`${paged.stdout}${paged.stderr}`);
});

test("filtered AdsDataset diagnostic distinguishes denial from contract and shape drift", () => {
  const deniedResponses = baseResponses();
  deniedResponses[1] = {
    ...deniedResponses[1],
    status: 403,
    payload: { error: { code: 10, message: syntheticGraphMessage } },
  };
  const denied = runVerifier(deniedResponses);
  assert.notEqual(denied.status, 0);
  assert.equal(denied.requestCount, 2);
  assert.match(`${denied.stdout}${denied.stderr}`, /pixel_dataset_denied/);
  assertNoSensitiveValues(`${denied.stdout}${denied.stderr}`);

  for (const payload of [
    { error: { code: 100, message: syntheticGraphMessage } },
    { data: [{ id: "not-an-id", dataset_id: syntheticOtherDatasetId }] },
    { data: [{ id: syntheticOtherDatasetId, dataset_id: syntheticOtherDatasetId }] },
  ]) {
    const contractResponses = baseResponses();
    contractResponses[1] = { ...contractResponses[1], status: payload.error ? 400 : 200, payload };
    const contract = runVerifier(contractResponses);
    assert.notEqual(contract.status, 0);
    assert.equal(contract.requestCount, 2);
    assert.match(`${contract.stdout}${contract.stderr}`, /pixel_dataset_contract/);
    assertNoSensitiveValues(`${contract.stdout}${contract.stderr}`);
  }
});

test("filtered AdsDataset diagnostic classifies account-side denial and does not broaden reads", () => {
  const deniedResponses = baseResponses();
  deniedResponses[0] = {
    ...deniedResponses[0],
    status: 403,
    payload: { error: { code: 200, message: syntheticGraphMessage } },
  };
  const denied = runVerifier(deniedResponses, 1);
  assert.notEqual(denied.status, 0);
  assert.equal(denied.requestCount, 1);
  assert.match(`${denied.stdout}${denied.stderr}`, /pixel_dataset_denied/);
  assertNoSensitiveValues(`${denied.stdout}${denied.stderr}`);
});
