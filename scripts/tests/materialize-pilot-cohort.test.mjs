import assert from "node:assert/strict";
import test from "node:test";
import { derivePilotCohort, materializePilotCohort } from "../runtime/materialize-pilot-cohort.mjs";

const releaseSha = "a".repeat(40);
const environment = {
  PONTO_RELEASE_SHA: releaseSha,
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_API_TOKEN: "synthetic-cloudflare-token",
  PONTO_TIMEKEEPING_D1_PRODUCTION_ID: "11111111-1111-4111-8111-111111111111",
  PONTO_PILOT_LOGIN: "novohamburgo@example.test",
  PONTO_IDEMPOTENCY_KEY: "synthetic-idempotency-root",
};

const row = (overrides = {}) => ({
  username: "novohamburgo",
  identity_login: "novohamburgo@example.test",
  identity_active: 1,
  identity_units_json: JSON.stringify(["novo-hamburgo"]),
  onboarding_id: "22222222-2222-4222-8222-222222222222",
  account_status: "ACTIVE",
  provisioning_state: "COMPLETED",
  last_error_code: null,
  workforce_employee_id: "33333333-3333-4333-8333-333333333333",
  onboarding_units_json: JSON.stringify(["novo-hamburgo"]),
  employee_id: "33333333-3333-4333-8333-333333333333",
  canonical_employee_id: "identity:22222222-2222-4222-8222-222222222222",
  workforce_login: "novohamburgo@example.test",
  status: "ACTIVE",
  access_state: "ACTIVE",
  metadata_json: JSON.stringify({ identityOnboardingId: "22222222-2222-4222-8222-222222222222" }),
  unit_id: "novo-hamburgo",
  ...overrides,
});

const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status });

function fetchFor(rows = [row()]) {
  let calls = 0;
  return async (url) => {
    calls += 1;
    if (String(url).includes("/d1/database/")) {
      return response({ success: true, result: [{ results: rows }] });
    }
    assert.equal(String(url), "https://cloudflare.com/cdn-cgi/trace");
    return new Response("fl=1\nip=198.51.100.10\n", { status: 200 });
  };
}

test("materializes one opaque cohort from the exact active identity", async () => {
  const cohort = await materializePilotCohort({ env: environment, fetchImpl: fetchFor() });
  assert.deepEqual(Object.keys(cohort).sort(), [
    "pilotEmployeeRefs",
    "pilotIdentityLoginRefs",
    "pilotIdentityRefs",
    "pilotNetworkContexts",
    "pilotUnits",
  ].sort());
  assert.equal(cohort.pilotUnits[0], "novo-hamburgo");
  for (const key of ["pilotEmployeeRefs", "pilotIdentityLoginRefs", "pilotIdentityRefs", "pilotNetworkContexts"]) {
    assert.equal(cohort[key].length, 1);
    assert.match(cohort[key][0], /^v1:[A-Za-z0-9_-]{43}$/);
  }
});

test("refuses a mismatched account, error state, or duplicate unit row", async () => {
  for (const rows of [
    [row({ provisioning_state: "FAILED" })],
    [row({ last_error_code: "WORKFORCE_SYNC_FAILED" })],
    [row(), row()],
  ]) {
    await assert.rejects(
      () => materializePilotCohort({ env: environment, fetchImpl: fetchFor(rows) }),
      /PILOT_COHORT_IDENTITY_INVALID/,
    );
  }
});

test("derivation is bound to the immutable release source and canonical identity", () => {
  const cohort = derivePilotCohort({
    releaseSha,
    idempotencyKey: environment.PONTO_IDEMPOTENCY_KEY,
    identity: {
      username: "novohamburgo",
      login: environment.PONTO_PILOT_LOGIN,
      canonicalEmployeeId: "identity:22222222-2222-4222-8222-222222222222",
      unitId: "novo-hamburgo",
    },
    egressAddress: "198.51.100.10",
  });
  assert.equal(JSON.stringify(cohort).includes(environment.PONTO_IDEMPOTENCY_KEY), false);
  assert.equal(JSON.stringify(cohort).includes("198.51.100.10"), false);
});
