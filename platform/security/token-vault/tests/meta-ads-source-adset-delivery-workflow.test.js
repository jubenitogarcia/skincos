import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(
  new URL(
    "../../../../.github/workflows/diagnose-meta-ads-source-adset-delivery.yml",
    import.meta.url,
  ),
  "utf8",
);
const embeddedProgram = workflow.match(
  /node --input-type=module <<'NODE'\n([\s\S]*?)\n\s+NODE/m,
  )?.[1];
assert.ok(embeddedProgram, "the source ad-set delivery workflow must embed its Node verifier");

const syntheticToken = "synthetic-adset-delivery-bearer-not-a-secret";
const syntheticPixelId = "1234567890";
const syntheticAccountId = "9876543210";
const syntheticGraphMessage = "synthetic Graph body must never be emitted";
const syntheticFields = "estimate_ready,targeting_optimization_types";
const syntheticTargeting = JSON.stringify({ geo_locations: { countries: ["BR"] } });
const syntheticPromotedObject = JSON.stringify({ pixel_id: syntheticPixelId, custom_event_type: "LEAD" });

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
      const body = Object.prototype.hasOwnProperty.call(expected, 'raw')
        ? expected.raw
        : JSON.stringify(expected.payload);
      return new Response(body, { status: expected.status ?? 200 });
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

const exactQuery = {
  fields: syntheticFields,
  optimization_goal: "OFFSITE_CONVERSIONS",
  promoted_object: syntheticPromotedObject,
  targeting_spec: syntheticTargeting,
};
const withoutPromotedQuery = {
  fields: syntheticFields,
  optimization_goal: "OFFSITE_CONVERSIONS",
  targeting_spec: syntheticTargeting,
};
const alternateOptimizationQuery = {
  fields: syntheticFields,
  optimization_goal: "LEAD_GENERATION",
  promoted_object: syntheticPromotedObject,
  targeting_spec: syntheticTargeting,
};
const targetingBaselineQuery = {
  fields: syntheticFields,
  optimization_goal: "LINK_CLICKS",
  targeting_spec: syntheticTargeting,
};

const estimatePayload = { data: { estimate_ready: true, targeting_optimization_types: [] } };
const exactResponse = {
  pathname: `/v25.0/act_${syntheticAccountId}/delivery_estimate`,
  query: exactQuery,
  payload: estimatePayload,
};
const sensitiveValues = [syntheticToken, syntheticPixelId, syntheticAccountId, syntheticGraphMessage];

function assertNoSensitiveValues(output) {
  for (const value of sensitiveValues) assert.doesNotMatch(output, new RegExp(value));
  assert.doesNotMatch(output, /graph\.facebook\.com/);
}

test("source ad-set delivery diagnostic is manual, staging-read-only, and no-mutation", () => {
  assert.match(workflow, /^name: Diagnose Meta Ads Source Ad Set Delivery Contract$/m);
  assert.match(workflow, /^\s+workflow_dispatch:\s*$/m);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: staging/);
  assert.match(workflow, /META_ADS_ACCESS_TOKEN: \$\{\{ secrets\.META_ADS_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /META_PIXEL_ID: \$\{\{ secrets\.META_PIXEL_ID \}\}/);
  assert.match(workflow, /META_ADS_ACCOUNT_ID: \$\{\{ vars\.META_ADS_ACCOUNT_ID \}\}/);
  assert.match(workflow, /META_ADS_API_VERSION: \$\{\{ vars\.META_ADS_API_VERSION \}\}/);
  assert.match(workflow, /delivery_estimate/);
  assert.match(workflow, /optimization_goal/);
  assert.match(workflow, /promoted_object/);
  assert.match(workflow, /targeting_spec/);
  assert.match(workflow, /source_adset_delivery_estimate_match/);
  assert.match(workflow, /source_adset_promoted_object_contract/);
  assert.match(workflow, /source_adset_optimization_goal_contract/);
  assert.match(workflow, /source_adset_targeting_contract/);
  assert.doesNotMatch(workflow, /wrangler|deploy-token-vault|upload-artifact|GITHUB_OUTPUT/i);
  assert.doesNotMatch(workflow, /D1|d1|method: 'POST'|appsecret_proof|META_APP_SECRET/);
  assert.doesNotMatch(workflow, /console\.log/);
});

test("exact source ad-set profile is accepted by the account delivery estimate edge", () => {
  const result = runVerifier([exactResponse]);
  const combined = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, combined);
  assert.equal(result.requestCount, 1);
  assert.equal(result.stdout, "source_adset_delivery_estimate_match\n");
  assertNoSensitiveValues(combined);
});

test("bounded controls separate promoted-object, optimization, and targeting contracts", () => {
  const promoted = runVerifier([
    { ...exactResponse, status: 400, payload: { error: { code: 100, message: syntheticGraphMessage } } },
    { pathname: exactResponse.pathname, query: withoutPromotedQuery, payload: estimatePayload },
  ]);
  assert.notEqual(promoted.status, 0);
  assert.equal(promoted.requestCount, 2);
  assert.match(`${promoted.stdout}${promoted.stderr}`, /source_adset_promoted_object_contract/);
  assertNoSensitiveValues(`${promoted.stdout}${promoted.stderr}`);

  const optimization = runVerifier([
    { ...exactResponse, status: 400, payload: { error: { code: 100, message: syntheticGraphMessage } } },
    { pathname: exactResponse.pathname, query: withoutPromotedQuery, status: 400, payload: { error: { code: 100 } } },
    { pathname: exactResponse.pathname, query: alternateOptimizationQuery, payload: estimatePayload },
  ]);
  assert.notEqual(optimization.status, 0);
  assert.equal(optimization.requestCount, 3);
  assert.match(`${optimization.stdout}${optimization.stderr}`, /source_adset_optimization_goal_contract/);
  assertNoSensitiveValues(`${optimization.stdout}${optimization.stderr}`);

  const targeting = runVerifier([
    { ...exactResponse, status: 400, payload: { error: { code: 100 } } },
    { pathname: exactResponse.pathname, query: withoutPromotedQuery, status: 400, payload: { error: { code: 100 } } },
    { pathname: exactResponse.pathname, query: alternateOptimizationQuery, status: 400, payload: { error: { code: 100 } } },
    { pathname: exactResponse.pathname, query: targetingBaselineQuery, status: 400, payload: { error: { code: 100 } } },
  ]);
  assert.notEqual(targeting.status, 0);
  assert.equal(targeting.requestCount, 4);
  assert.match(`${targeting.stdout}${targeting.stderr}`, /source_adset_targeting_contract/);
  assertNoSensitiveValues(`${targeting.stdout}${targeting.stderr}`);
});

test("permission, transport, malformed, and residual contract states stay distinct", () => {
  const denied = runVerifier([{ ...exactResponse, status: 403, payload: { error: { code: 10, message: syntheticGraphMessage } } }]);
  assert.notEqual(denied.status, 0);
  assert.equal(denied.requestCount, 1);
  assert.match(`${denied.stdout}${denied.stderr}`, /source_adset_delivery_estimate_denied/);
  assertNoSensitiveValues(`${denied.stdout}${denied.stderr}`);

  const unavailable = runVerifier([{ ...exactResponse, status: 429, payload: { error: { code: 17 } } }]);
  assert.notEqual(unavailable.status, 0);
  assert.equal(unavailable.requestCount, 1);
  assert.match(`${unavailable.stdout}${unavailable.stderr}`, /source_adset_delivery_estimate_unavailable/);
  assertNoSensitiveValues(`${unavailable.stdout}${unavailable.stderr}`);

  const malformed = runVerifier([{ ...exactResponse, raw: "not-json" }]);
  assert.notEqual(malformed.status, 0);
  assert.equal(malformed.requestCount, 1);
  assert.match(`${malformed.stdout}${malformed.stderr}`, /source_adset_delivery_estimate_malformed/);
  assertNoSensitiveValues(`${malformed.stdout}${malformed.stderr}`);

  const residual = runVerifier([
    { ...exactResponse, status: 400, payload: { error: { code: 100 } } },
    { pathname: exactResponse.pathname, query: withoutPromotedQuery, status: 400, payload: { error: { code: 100 } } },
    { pathname: exactResponse.pathname, query: alternateOptimizationQuery, status: 400, payload: { error: { code: 100 } } },
    { pathname: exactResponse.pathname, query: targetingBaselineQuery, payload: estimatePayload },
  ]);
  assert.notEqual(residual.status, 0);
  assert.equal(residual.requestCount, 4);
  assert.match(`${residual.stdout}${residual.stderr}`, /source_adset_delivery_estimate_contract/);
  assertNoSensitiveValues(`${residual.stdout}${residual.stderr}`);
});
