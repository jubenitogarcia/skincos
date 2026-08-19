import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL(
    "../../../../.github/workflows/diagnose-meta-ads-pixel-filter-edge.yml",
    import.meta.url,
  ),
  "utf8",
);
const embeddedProgram = workflow.match(
  /node --input-type=module <<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE/m,
)?.[1];
assert.ok(embeddedProgram, "the Pixel filter edge workflow must embed its Node verifier");

const syntheticToken = "synthetic-pixel-filter-edge-bearer-not-a-secret";
const syntheticPixelId = "1234567890";
const syntheticAccountId = "9876543210";
const syntheticBusinessId = "7788990011";
const syntheticOtherPixelId = "8899001122";
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
      pathname: `/v25.0/${syntheticBusinessId}/adspixels`,
      query: { fields: "id", id_filter: syntheticPixelId },
      payload: { data: [{ id: syntheticPixelId }] },
    },
  ];
}

const sensitiveValues = [
  syntheticToken,
  syntheticPixelId,
  syntheticAccountId,
  syntheticBusinessId,
  syntheticOtherPixelId,
  syntheticGraphMessage,
];

function assertNoSensitiveValues(output) {
  for (const value of sensitiveValues) assert.doesNotMatch(output, new RegExp(value));
  assert.doesNotMatch(output, /graph\.facebook\.com/);
}

test("Pixel filter edge diagnostic is manual, staging-read-only, and no-mutation", () => {
  assert.match(workflow, /^name: Diagnose Meta Ads Pixel Filter Edge$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /META_ADS_ACCESS_TOKEN: \$\{\{ secrets\.META_ADS_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /META_PIXEL_ID: \$\{\{ secrets\.META_PIXEL_ID \}\}/);
  assert.match(workflow, /META_ADS_ACCOUNT_ID: \$\{\{ vars\.META_ADS_ACCOUNT_ID \}\}/);
  assert.match(workflow, /META_ADS_API_VERSION: \$\{\{ vars\.META_ADS_API_VERSION \}\}/);
  assert.match(workflow, /\$\{businessId\}\/adspixels/);
  assert.match(workflow, /fields: 'id'/);
  assert.match(workflow, /id_filter: pixelId/);
  assert.match(workflow, /pixel_filter_edge_parameter_contract/);
  assert.match(workflow, /pixel_filter_edge_edge_contract/);
  assert.match(workflow, /pixel_filter_edge_match/);
  assert.doesNotMatch(workflow, /ads_dataset\?fields|offline_conversion_data_sets/);
  assert.doesNotMatch(workflow, /wrangler|deploy-token-vault|upload-artifact|GITHUB_OUTPUT/i);
  assert.doesNotMatch(workflow, /D1|d1|method: 'POST'|appsecret_proof|META_APP_SECRET/);
  assert.doesNotMatch(workflow, /console\.log/);
});

test("Pixel filter edge classifies a matching Pixel without disclosing it", () => {
  const result = runVerifier(baseResponses());
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(result.requestCount, 2);
  assert.equal(result.stdout, "pixel_filter_edge_match\n");
  assertNoSensitiveValues(combined);
});

test("Pixel filter edge separates absent, mismatch, ambiguous, and contract failures", () => {
  const absentResponses = baseResponses();
  absentResponses[1].payload = { data: [] };
  const absent = runVerifier(absentResponses);
  assert.notEqual(absent.status, 0);
  assert.equal(absent.requestCount, 2);
  assert.match(`${absent.stdout}${absent.stderr}`, /pixel_filter_edge_absent/);
  assertNoSensitiveValues(`${absent.stdout}${absent.stderr}`);

  const mismatchResponses = baseResponses();
  mismatchResponses[1].payload = { data: [{ id: syntheticOtherPixelId }] };
  const mismatch = runVerifier(mismatchResponses);
  assert.notEqual(mismatch.status, 0);
  assert.equal(mismatch.requestCount, 2);
  assert.match(`${mismatch.stdout}${mismatch.stderr}`, /pixel_filter_edge_mismatch/);
  assertNoSensitiveValues(`${mismatch.stdout}${mismatch.stderr}`);

  const ambiguousResponses = baseResponses();
  ambiguousResponses[1].payload = { data: [{ id: syntheticPixelId }, { id: syntheticOtherPixelId }] };
  const ambiguous = runVerifier(ambiguousResponses);
  assert.notEqual(ambiguous.status, 0);
  assert.equal(ambiguous.requestCount, 2);
  assert.match(`${ambiguous.stdout}${ambiguous.stderr}`, /pixel_filter_edge_ambiguous/);
  assertNoSensitiveValues(`${ambiguous.stdout}${ambiguous.stderr}`);

  const parameterResponses = baseResponses();
  parameterResponses[1] = {
    ...parameterResponses[1],
    status: 400,
    payload: { error: { code: 100, message: syntheticGraphMessage } },
  };
  const parameter = runVerifier(parameterResponses);
  assert.notEqual(parameter.status, 0);
  assert.equal(parameter.requestCount, 2);
  assert.match(`${parameter.stdout}${parameter.stderr}`, /pixel_filter_edge_parameter_contract/);
  assertNoSensitiveValues(`${parameter.stdout}${parameter.stderr}`);
});

test("Pixel filter edge keeps permission distinct from contract and stops at account failure", () => {
  const deniedResponses = baseResponses();
  deniedResponses[1] = {
    ...deniedResponses[1],
    status: 403,
    payload: { error: { code: 10, message: syntheticGraphMessage } },
  };
  const denied = runVerifier(deniedResponses);
  assert.notEqual(denied.status, 0);
  assert.equal(denied.requestCount, 2);
  assert.match(`${denied.stdout}${denied.stderr}`, /pixel_filter_edge_denied/);
  assertNoSensitiveValues(`${denied.stdout}${denied.stderr}`);

  const accountFailureResponses = baseResponses();
  accountFailureResponses[0] = {
    ...accountFailureResponses[0],
    status: 400,
    payload: { error: { code: 100, message: syntheticGraphMessage } },
  };
  const accountFailure = runVerifier(accountFailureResponses, 1);
  assert.notEqual(accountFailure.status, 0);
  assert.equal(accountFailure.requestCount, 1);
  assert.match(`${accountFailure.stdout}${accountFailure.stderr}`, /pixel_filter_edge_account_contract/);
  assertNoSensitiveValues(`${accountFailure.stdout}${accountFailure.stderr}`);
});
