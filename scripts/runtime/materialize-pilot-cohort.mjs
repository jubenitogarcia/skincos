import crypto from "node:crypto";

const FULL_SHA = /^[0-9a-f]{40}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_REF = /^v1:[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EGRESS_ADDRESS = /^[0-9A-Fa-f:.]{3,64}$/;
const PILOT_USERNAME = "novohamburgo";
const TRACE_URL = "https://cloudflare.com/cdn-cgi/trace";

const failure = (code) => {
  const error = new Error(code);
  error.code = code;
  return error;
};

const required = (env, name) => {
  const value = String(env?.[name] || "").trim();
  if (!value) throw failure("PILOT_COHORT_CUSTODY_UNAVAILABLE");
  return value;
};

const normalize = (value) => String(value || "").trim();
const normalizedLogin = (value) => normalize(value).toLowerCase();

const parseUnits = (value) => {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((unit) => normalize(unit)).filter(Boolean))];
  } catch {
    return [];
  }
};

const hmac = (key, message) => crypto.createHmac("sha256", key).update(message).digest("base64url");
const opaque = (key, message) => `v1:${hmac(key, message)}`;

function d1Rows(payload) {
  const result = payload?.result;
  const entries = Array.isArray(result) ? result : [result];
  const rows = entries.flatMap((entry) => {
    if (Array.isArray(entry?.results)) return entry.results;
    if (Array.isArray(entry?.result?.results)) return entry.result.results;
    return [];
  });
  return rows.filter((row) => row && typeof row === "object" && !Array.isArray(row));
}

export async function queryD1({ fetchImpl = fetch, accountId, apiToken, databaseId, sql }) {
  const response = await fetchImpl(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql }),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success !== true) throw failure("PILOT_COHORT_D1_QUERY_FAILED");
  return d1Rows(payload);
}

export async function observedEgressAddress({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(TRACE_URL, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: { accept: "text/plain" },
  });
  const text = await response.text();
  const address = text.split(/\r?\n/).find((line) => line.startsWith("ip="))?.slice(3).trim() || "";
  if (!response.ok || !EGRESS_ADDRESS.test(address)) throw failure("PILOT_COHORT_EGRESS_UNAVAILABLE");
  return address;
}

function assertIdentity(row, pilotLogin) {
  const username = normalize(row.username).toLowerCase();
  const login = normalizedLogin(row.identity_login);
  const onboardingId = normalize(row.onboarding_id);
  const workforceEmployeeId = normalize(row.workforce_employee_id);
  const employeeId = normalize(row.employee_id);
  const canonicalEmployeeId = normalize(row.canonical_employee_id);
  const workforceLogin = normalizedLogin(row.workforce_login);
  const unitId = normalize(row.unit_id);
  const metadata = (() => {
    try { return JSON.parse(String(row.metadata_json || "{}")); } catch { return null; }
  })();
  const identityUnits = parseUnits(row.identity_units_json);
  const onboardingUnits = parseUnits(row.onboarding_units_json);
  const currentAccessState = normalize(row.access_state || row.status).toUpperCase();

  if (
    username !== PILOT_USERNAME
    || !EMAIL.test(login)
    || login !== normalizedLogin(pilotLogin)
    || Number(row.identity_active) !== 1
    || !UUID.test(onboardingId)
    || normalize(row.account_status).toUpperCase() !== "ACTIVE"
    || normalize(row.provisioning_state).toUpperCase() !== "COMPLETED"
    || normalize(row.last_error_code)
    || !UUID.test(workforceEmployeeId)
    || workforceEmployeeId !== employeeId
    || canonicalEmployeeId !== `identity:${onboardingId}`
    || workforceLogin !== login
    || normalize(row.status).toUpperCase() !== "ACTIVE"
    || currentAccessState !== "ACTIVE"
    || metadata?.identityOnboardingId !== onboardingId
    || !unitId
    || !identityUnits.includes(unitId)
    || !onboardingUnits.includes(unitId)
  ) throw failure("PILOT_COHORT_IDENTITY_INVALID");

  return { username, login, onboardingId, canonicalEmployeeId, unitId };
}

export function derivePilotCohort({ releaseSha, idempotencyKey, identity, egressAddress }) {
  const source = normalize(releaseSha).toLowerCase();
  const root = normalize(idempotencyKey);
  if (!FULL_SHA.test(source) || !root || !EGRESS_ADDRESS.test(normalize(egressAddress))) {
    throw failure("PILOT_COHORT_DERIVATION_INVALID");
  }
  const actorKey = hmac(root, "skincos/ponto/actor/v1");
  const networkKey = hmac(root, "skincos/ponto/network-context/v1");
  const cohort = {
    pilotEmployeeRefs: [opaque(actorKey, `ponto-canary-employee/v1.${source}.${identity.canonicalEmployeeId}`)],
    pilotIdentityLoginRefs: [opaque(actorKey, `ponto-canary-login/v1.${source}.${identity.login}`)],
    pilotIdentityRefs: [opaque(actorKey, `ponto-canary-identity/v1.${source}.${identity.username}`)],
    pilotNetworkContexts: [opaque(networkKey, `ponto-network/v1.${source}.${egressAddress}`)],
    pilotUnits: [identity.unitId],
  };
  if (
    Object.values(cohort).some((entries) => !Array.isArray(entries) || entries.length !== 1)
    || [
      ...cohort.pilotEmployeeRefs,
      ...cohort.pilotIdentityLoginRefs,
      ...cohort.pilotIdentityRefs,
      ...cohort.pilotNetworkContexts,
    ].some((value) => !OPAQUE_REF.test(value))
  ) throw failure("PILOT_COHORT_DERIVATION_INVALID");
  return cohort;
}

export async function materializePilotCohort({ env = process.env, fetchImpl = fetch } = {}) {
  const releaseSha = required(env, "PONTO_RELEASE_SHA").toLowerCase();
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID").toLowerCase();
  const apiToken = required(env, "CLOUDFLARE_API_TOKEN");
  const databaseId = required(env, "PONTO_TIMEKEEPING_D1_PRODUCTION_ID").toLowerCase();
  const pilotLogin = required(env, "PONTO_PILOT_LOGIN");
  const idempotencyKey = required(env, "PONTO_IDEMPOTENCY_KEY");
  if (!FULL_SHA.test(releaseSha)) throw failure("PILOT_COHORT_RELEASE_INVALID");
  if (!/^[0-9a-f]{32}$/.test(accountId)) throw failure("PILOT_COHORT_ACCOUNT_INVALID");
  if (!UUID.test(databaseId)) throw failure("PILOT_COHORT_DATABASE_INVALID");
  if (!EMAIL.test(pilotLogin)) throw failure("PILOT_COHORT_LOGIN_INVALID");

  const rows = await queryD1({
    fetchImpl,
    accountId,
    apiToken,
    databaseId,
    sql: `SELECT
      u.username AS username,
      lower(trim(u.email)) AS identity_login,
      u.ativo AS identity_active,
      u.allowed_units_json AS identity_units_json,
      o.id AS onboarding_id,
      o.account_status AS account_status,
      o.provisioning_state AS provisioning_state,
      o.last_error_code AS last_error_code,
      o.workforce_employee_id AS workforce_employee_id,
      o.units_json AS onboarding_units_json,
      e.id AS employee_id,
      e.canonical_employee_id AS canonical_employee_id,
      lower(trim(e.login_email)) AS workforce_login,
      e.status AS status,
      e.access_state AS access_state,
      e.metadata_json AS metadata_json,
      tu.unit_id AS unit_id
    FROM insumos_users u
    JOIN crm_employee_onboarding o ON lower(o.requested_username) = lower(u.username)
    JOIN workforce_employees e ON e.id = o.workforce_employee_id
    JOIN timekeeping_employee_units tu ON tu.employee_id = e.id
      AND tu.effective_from <= date('now')
      AND (tu.effective_to IS NULL OR tu.effective_to >= date('now'))
    WHERE lower(u.username) = '${PILOT_USERNAME}'
    ORDER BY tu.effective_from DESC, tu.unit_id ASC`,
  });
  if (rows.length !== 1) throw failure("PILOT_COHORT_IDENTITY_INVALID");
  const identity = assertIdentity(rows[0], pilotLogin);
  const egressAddress = await observedEgressAddress({ fetchImpl });
  return derivePilotCohort({ releaseSha, idempotencyKey, identity, egressAddress });
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href;
if (invokedDirectly) {
  materializePilotCohort().then((cohort) => {
    process.stdout.write(JSON.stringify(cohort));
  }).catch((error) => {
    process.stderr.write(`${String(error?.code || "PILOT_COHORT_MATERIALIZATION_FAILED")}\n`);
    process.exitCode = 78;
  });
}
