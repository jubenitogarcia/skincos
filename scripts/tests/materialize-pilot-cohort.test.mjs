import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { derivePilotCohort, materializePilotCohort } from "../runtime/materialize-pilot-cohort.mjs";

const releaseSha = "a".repeat(40);
const canonicalOnboardingId = "2".repeat(64);
const legacyOnboardingId = "22222222-2222-4222-8222-222222222222";
const environment = {
  PONTO_RELEASE_SHA: releaseSha,
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_API_TOKEN: "synthetic-cloudflare-token",
  PONTO_IDENTITY_D1_PRODUCTION_ID: "44444444-4444-4444-8444-444444444444",
  PONTO_TIMEKEEPING_D1_PRODUCTION_ID: "11111111-1111-4111-8111-111111111111",
  PONTO_PILOT_LOGIN: "novohamburgo@example.test",
  PONTO_IDEMPOTENCY_KEY: "synthetic-idempotency-root",
};

const identityRow = (overrides = {}) => ({
  username: "novohamburgo",
  identity_login: "novohamburgo@example.test",
  identity_role: "CONSULTOR",
  identity_active: 1,
  identity_units_json: JSON.stringify(["novo-hamburgo"]),
  onboarding_id: canonicalOnboardingId,
  account_status: "ACTIVE",
  provisioning_state: "COMPLETED",
  last_error_code: null,
  workforce_employee_id: "33333333-3333-4333-8333-333333333333",
  onboarding_units_json: JSON.stringify(["novo-hamburgo"]),
  link_username: "novohamburgo",
  link_onboarding_id: canonicalOnboardingId,
  link_workforce_employee_id: "33333333-3333-4333-8333-333333333333",
  link_review_status: "CONFIRMED",
  ...overrides,
});

const workforceRow = (overrides = {}) => ({
  employee_id: "33333333-3333-4333-8333-333333333333",
  canonical_employee_id: `identity:${canonicalOnboardingId}`,
  workforce_login: "novohamburgo@example.test",
  status: "ACTIVE",
  access_state: "ACTIVE",
  metadata_json: JSON.stringify({ identityOnboardingId: canonicalOnboardingId }),
  unit_id: "novo-hamburgo",
  ...overrides,
});

const response = (payload, status = 200) => new Response(JSON.stringify(payload), { status });

function fetchFor({ identityRows = [identityRow()], workforceRows = [workforceRow()] } = {}) {
  const fetchImpl = async (url, init = {}) => {
    const endpoint = String(url);
    if (endpoint.includes(`/d1/database/${environment.PONTO_IDENTITY_D1_PRODUCTION_ID}/query`)) {
      fetchImpl.d1DatabaseIds.push(environment.PONTO_IDENTITY_D1_PRODUCTION_ID);
      const sql = JSON.parse(String(init.body || "{}")).sql || "";
      assert.match(sql, /FROM crm_users u/);
      assert.match(sql, /crm_employee_account_links l/);
      assert.match(sql, /upper\(l\.review_status\) = 'CONFIRMED'/);
      return response({ success: true, result: [{ results: identityRows }] });
    }
    if (endpoint.includes(`/d1/database/${environment.PONTO_TIMEKEEPING_D1_PRODUCTION_ID}/query`)) {
      fetchImpl.d1DatabaseIds.push(environment.PONTO_TIMEKEEPING_D1_PRODUCTION_ID);
      const sql = JSON.parse(String(init.body || "{}")).sql || "";
      assert.match(sql, /FROM workforce_employees e/);
      assert.doesNotMatch(sql, /crm_users|crm_employee_onboarding|crm_employee_account_links/);
      return response({ success: true, result: [{ results: workforceRows }] });
    }
    assert.equal(endpoint, "https://cloudflare.com/cdn-cgi/trace");
    return new Response("fl=1\nip=198.51.100.10\n", { status: 200 });
  };
  fetchImpl.d1DatabaseIds = [];
  return fetchImpl;
}

test("materializes one opaque cohort from the exact active identity across both authoritative D1 databases", async () => {
  const fetchImpl = fetchFor();
  const cohort = await materializePilotCohort({ env: environment, fetchImpl });
  assert.deepEqual(fetchImpl.d1DatabaseIds, [
    environment.PONTO_IDENTITY_D1_PRODUCTION_ID,
    environment.PONTO_TIMEKEEPING_D1_PRODUCTION_ID,
  ]);
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
  const legacyRoleCohort = await materializePilotCohort({
    env: environment,
    fetchImpl: fetchFor({ identityRows: [identityRow({ identity_role: "EMPLOYEE" })] }),
  });
  assert.deepEqual(legacyRoleCohort, cohort);
});

test("accepts the legacy UUID onboarding identity only when every linked predicate remains exact", async () => {
  const cohort = await materializePilotCohort({
    env: environment,
    fetchImpl: fetchFor({
      identityRows: [identityRow({ onboarding_id: legacyOnboardingId, link_onboarding_id: legacyOnboardingId })],
      workforceRows: [workforceRow({
        canonical_employee_id: `identity:${legacyOnboardingId}`,
        metadata_json: JSON.stringify({ identityOnboardingId: legacyOnboardingId }),
      })],
    }),
  });
  assert.equal(cohort.pilotEmployeeRefs.length, 1);
});

test("classifies the exact non-sensitive identity or Workforce predicate that rejects a cohort", async () => {
  for (const [fixture, expectedCode] of [
    [{ identityRows: [] }, "PILOT_COHORT_IDENTITY_INVALID_IDENTITY_ROWS_MISSING"],
    [{ identityRows: [identityRow({ identity_role: "SUPERVISOR" })] }, "PILOT_COHORT_IDENTITY_INVALID_ROLE"],
    [{ identityRows: [identityRow({ onboarding_id: "not-an-onboarding-id", link_onboarding_id: "not-an-onboarding-id" })] }, "PILOT_COHORT_IDENTITY_INVALID_ONBOARDING_ID"],
    [{ identityRows: [identityRow({ link_review_status: "PENDING_REVIEW" })] }, "PILOT_COHORT_IDENTITY_INVALID_LINK_REVIEW_STATUS"],
    [{ identityRows: [identityRow({ provisioning_state: "FAILED" })] }, "PILOT_COHORT_IDENTITY_INVALID_PROVISIONING_STATE"],
    [{ workforceRows: [workforceRow({ access_state: "SUSPENDED" })] }, "PILOT_COHORT_IDENTITY_INVALID_WORKFORCE_ACCESS_STATE"],
    [{ workforceRows: [workforceRow(), workforceRow()] }, "PILOT_COHORT_IDENTITY_INVALID_WORKFORCE_ROWS_AMBIGUOUS"],
  ]) {
    await assert.rejects(
      () => materializePilotCohort({ env: environment, fetchImpl: fetchFor(fixture) }),
      (error) => error?.code === expectedCode
        && error?.message === expectedCode
        && !String(error?.message || "").includes(environment.PONTO_PILOT_LOGIN),
    );
  }
});

test("derivation matches the Ponto runtime HMAC contract and never serializes custody inputs", () => {
  const cohort = derivePilotCohort({
    releaseSha,
    idempotencyKey: environment.PONTO_IDEMPOTENCY_KEY,
    identity: {
      actorId: "novohamburgo",
      username: "novohamburgo",
      login: environment.PONTO_PILOT_LOGIN,
      canonicalEmployeeId: `identity:${canonicalOnboardingId}`,
      unitId: "novo-hamburgo",
    },
    egressAddress: "198.51.100.10",
  });
  const actorKey = createHmac("sha256", environment.PONTO_IDEMPOTENCY_KEY)
    .update("skincos/ponto/actor/v1")
    .digest("base64url");
  const networkKey = createHmac("sha256", environment.PONTO_IDEMPOTENCY_KEY)
    .update("skincos/ponto/network-context/v1")
    .digest("base64url");
  const opaque = (key, message) => `v1:${createHmac("sha256", key).update(message).digest("base64url")}`;
  assert.equal(cohort.pilotEmployeeRefs[0], opaque(actorKey, `ponto-canary-employee/v1.${releaseSha}.identity:${canonicalOnboardingId}`));
  assert.equal(cohort.pilotIdentityRefs[0], opaque(actorKey, `ponto-canary-identity/v1.${releaseSha}.novohamburgo`));
  assert.equal(cohort.pilotIdentityLoginRefs[0], opaque(actorKey, `ponto-canary-login/v1.${releaseSha}.${environment.PONTO_PILOT_LOGIN}`));
  assert.equal(cohort.pilotNetworkContexts[0], opaque(networkKey, `ponto-network/v1.${releaseSha}.198.51.100.10`));
  assert.equal(JSON.stringify(cohort).includes(environment.PONTO_IDEMPOTENCY_KEY), false);
  assert.equal(JSON.stringify(cohort).includes("198.51.100.10"), false);
});
