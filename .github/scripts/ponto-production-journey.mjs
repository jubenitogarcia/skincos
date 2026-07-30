import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const pilotLogin = String(process.env.PONTO_PILOT_LOGIN || "");
const pilotPassword = String(process.env.PONTO_PILOT_PASSWORD || "");
const reportFile = String(process.env.PONTO_RELEASE_SLO_REPORT || "");
const expectedSha = String(process.env.PONTO_RELEASE_SHA || "").trim().toLowerCase();
const expectedStage = String(process.env.PONTO_RELEASE_STAGE || "").trim().toLowerCase();
const expectedCoreVersionId = String(process.env.PONTO_EXPECTED_CORE_VERSION_ID || "").trim().toLowerCase();
const expectedTimekeepingVersionId = String(process.env.PONTO_EXPECTED_TIMEKEEPING_VERSION_ID || "").trim().toLowerCase();
const expectedIdentityVersionId = String(process.env.PONTO_EXPECTED_IDENTITY_VERSION_ID || "").trim().toLowerCase();
const expectedPagesDeploymentId = String(process.env.PONTO_EXPECTED_PAGES_DEPLOYMENT_ID || "").trim().toLowerCase();
const cloudflareAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim().toLowerCase();
const cloudflareApiToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const pagesProject = String(process.env.CLOUDFLARE_PAGES_PROJECT || "skincos").trim();
const base = new URL(String(process.env.PONTO_RELEASE_CRM_URL || "https://crm.skincos.com.br"));
const identityBase = new URL(String(process.env.PONTO_RELEASE_IDENTITY_URL || "https://api.skincos.com.br"));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const policy = {
  pilot: { windowSeconds: 300, cadenceSeconds: 30, minimumSamples: 10, maximumErrors: 0, maximumP95Ms: 1500 },
  canary: { windowSeconds: 900, cadenceSeconds: 30, minimumSamples: 30, maximumErrors: 0, maximumP95Ms: 1500 },
  production: { windowSeconds: 900, cadenceSeconds: 30, minimumSamples: 30, maximumErrors: 0, maximumP95Ms: 1500 },
  rollback: { windowSeconds: 300, cadenceSeconds: 30, minimumSamples: 10, maximumErrors: 0, maximumP95Ms: 1500 },
};
if ([base, identityBase].some((url) => url.protocol !== "https:" || url.username || url.password || url.search || url.hash)) throw new Error("invalid release origin");
if (!/^[0-9a-f]{40}$/.test(expectedSha) || !policy[expectedStage]) throw new Error("invalid release identity");
if (!reportFile) throw new Error("PONTO_RELEASE_SLO_REPORT is required");
if (![expectedCoreVersionId, expectedTimekeepingVersionId, expectedIdentityVersionId, expectedPagesDeploymentId].every((value) => UUID.test(value))) {
  throw new Error("expected immutable surface version IDs are required");
}
if (expectedStage !== "rollback" && (!pilotLogin.includes("@") || pilotPassword.length < 12)) {
  throw new Error("pilot credential secrets are invalid");
}

const testOverridesRequested = Boolean(
  process.env.PONTO_SLO_TEST_WINDOW_SECONDS
  || process.env.PONTO_SLO_TEST_CADENCE_SECONDS
  || process.env.PONTO_SLO_TEST_MINIMUM_SAMPLES,
);
const testModeAllowed = process.env.PONTO_SLO_TEST_MODE === "true" && process.env.GITHUB_ACTIONS !== "true";
if (testOverridesRequested && !testModeAllowed) throw new Error("SLO test overrides are forbidden in GitHub Actions and production mode");
const selectedPolicy = {
  ...policy[expectedStage],
  ...(testModeAllowed && testOverridesRequested ? {
    windowSeconds: Number(process.env.PONTO_SLO_TEST_WINDOW_SECONDS),
    cadenceSeconds: Number(process.env.PONTO_SLO_TEST_CADENCE_SECONDS || 1),
    minimumSamples: Number(process.env.PONTO_SLO_TEST_MINIMUM_SAMPLES || 1),
  } : {}),
};
let pagesControlPlaneMatched = false;
let pagesControlPlaneCommitSha = "";
if (testModeAllowed) {
  pagesControlPlaneMatched = true;
  pagesControlPlaneCommitSha = expectedSha;
} else {
  if (!/^[0-9a-f]{32}$/.test(cloudflareAccountId) || !cloudflareApiToken || pagesProject !== "skincos") {
    throw new Error("production Pages control-plane custody is unavailable");
  }
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/pages/projects/${encodeURIComponent(pagesProject)}/deployments/${expectedPagesDeploymentId}`,
    {
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${cloudflareApiToken}`,
      },
    },
  );
  const payload = await response.json().catch(() => null);
  const deployment = payload?.result;
  const metadata = deployment?.deployment_trigger?.metadata || {};
  const status = String(deployment?.latest_stage?.status || deployment?.stage?.status || "").toLowerCase();
  const aliasHosts = new Set((deployment?.aliases || []).map((alias) => {
    try { return new URL(alias).hostname; } catch { return String(alias).replace(/^https?:\/\//, "").replace(/\/.*$/, ""); }
  }));
  pagesControlPlaneCommitSha = String(metadata.commit_hash || "").toLowerCase();
  pagesControlPlaneMatched = response.status === 200
    && payload?.success === true
    && String(deployment?.id || "").toLowerCase() === expectedPagesDeploymentId
    && deployment?.project_name === "skincos"
    && deployment?.environment === "production"
    && metadata.branch === "main"
    && ["success", "idle"].includes(status)
    && aliasHosts.has("crm.skincos.com.br")
    && (expectedStage === "rollback" || pagesControlPlaneCommitSha === expectedSha);
  if (!pagesControlPlaneMatched) throw new Error("public CRM domain is not linked to the expected Pages deployment");
}
const accessHeaders = {};
if (process.env.CF_ACCESS_CLIENT_ID || process.env.CF_ACCESS_CLIENT_SECRET) {
  if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) throw new Error("partial Cloudflare Access credential");
  accessHeaders["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  accessHeaders["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}
let cookie = "";
let csrf = "";
const request = async (pathname, init = {}) => {
  const response = await fetch(new URL(pathname, base), {
    redirect: "manual",
    ...init,
    headers: {
      accept: "application/json",
      ...accessHeaders,
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { response, json };
};
const parseCookieHeader = (value) => new Map(
  String(value || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(/=(.*)/s).slice(0, 2)),
);
const getSetCookieValues = (headers) => {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  return combined ? combined.split(/,(?=\s*[^;,\s]+=)/) : [];
};
const updateCookies = (response) => {
  const jar = parseCookieHeader(cookie);
  for (const rawValue of getSetCookieValues(response.headers)) {
    const parts = String(rawValue).split(";").map((part) => part.trim());
    const [name, value = ""] = String(parts.shift() || "").split(/=(.*)/s).slice(0, 2);
    if (!name) continue;
    const attributes = new Map(parts.map((part) => {
      const [attribute, attributeValue = ""] = part.split(/=(.*)/s).slice(0, 2);
      return [String(attribute || "").toLowerCase(), attributeValue];
    }));
    const maxAge = attributes.has("max-age") ? Number(attributes.get("max-age")) : null;
    const expiresAt = attributes.has("expires") ? Date.parse(attributes.get("expires")) : Number.NaN;
    const deleted = !value
      || value.toLowerCase() === "deleted"
      || (Number.isFinite(maxAge) && maxAge <= 0)
      || (Number.isFinite(expiresAt) && expiresAt <= Date.now());
    if (deleted) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
  cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  csrf = jar.get("csrfToken") || "";
};
const attestedRelease = (response, { requireSha = true } = {}) => {
  const pagesSha = String(response.headers.get("x-skincos-pages-release-sha") || "").trim().toLowerCase();
  const coreSha = String(response.headers.get("x-skincos-gateway-release-sha") || "").trim().toLowerCase();
  const coreVersionId = String(response.headers.get("x-skincos-gateway-version-id") || "").trim().toLowerCase();
  const timekeepingSha = String(response.headers.get("x-skincos-timekeeping-release-sha") || "").trim().toLowerCase();
  const timekeepingVersionId = String(response.headers.get("x-skincos-timekeeping-version-id") || "").trim().toLowerCase();
  return {
    pagesSha,
    coreSha,
    coreVersionId,
    timekeepingSha,
    timekeepingVersionId,
    matched: (!requireSha || (pagesSha === expectedSha && coreSha === expectedSha && timekeepingSha === expectedSha))
      && coreVersionId === expectedCoreVersionId
      && timekeepingVersionId === expectedTimekeepingVersionId,
  };
};

if (expectedStage === "rollback") {
  const controlPlaneFile = String(process.env.PONTO_ROLLBACK_CONTROL_PLANE_ATTESTATION || "");
  if (!controlPlaneFile) throw new Error("rollback control-plane attestation is required");
  const controlPlane = JSON.parse(fs.readFileSync(controlPlaneFile, "utf8"));
  const controlPlaneAttested = controlPlane?.passed === true
    && String(controlPlane?.coreVersionId || "").toLowerCase() === expectedCoreVersionId
    && String(controlPlane?.timekeepingVersionId || "").toLowerCase() === expectedTimekeepingVersionId
    && String(controlPlane?.identityVersionId || "").toLowerCase() === expectedIdentityVersionId
    && String(controlPlane?.pagesDeploymentId || "").toLowerCase() === expectedPagesDeploymentId;
  if (!controlPlaneAttested) throw new Error("rollback control-plane version/deployment IDs differ");
  const identityHealthResponse = await fetch(new URL("/insumos/health", identityBase), {
    redirect: "manual",
    headers: { accept: "application/json", ...accessHeaders },
  });
  const identityHealth = await identityHealthResponse.json().catch(() => null);
  const identityHealthy = identityHealthResponse.status === 200
    && (!identityHealth?.environment || identityHealth.environment === "production");
  const startedAt = Date.now();
  const stopAt = startedAt + selectedPolicy.windowSeconds * 1000;
  const samples = [];
  while (Date.now() < stopAt || samples.length < selectedPolicy.minimumSamples) {
    const started = performance.now();
    let status = 0;
    let maintenance = false;
    let versionAttested = false;
    try {
      const health = await request("/api/ponto/health");
      status = health.response.status;
      const dependencies = health.json?.dependencies && typeof health.json.dependencies === "object"
        ? Object.entries(health.json.dependencies)
        : [];
      const maintenanceOnly = health.json?.ok === false
        && health.json?.ready === false
        && health.json?.availability?.state === "maintenance"
        && health.json?.dependencies?.module_control?.state === "unavailable"
        && health.json?.dependencies?.module_control?.reason === "MODULE_MAINTENANCE"
        && dependencies.every(([name, dependency]) => name === "module_control" || dependency?.required !== true || dependency?.state === "healthy");
      maintenance = maintenanceOnly;
      versionAttested = controlPlaneAttested;
    } catch {
      status = 0;
    }
    samples.push({
      status,
      healthy: status === 200 && maintenance && versionAttested,
      latencyMs: Math.round(performance.now() - started),
    });
    const remaining = stopAt - Date.now();
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(selectedPolicy.cadenceSeconds * 1000, remaining)));
    }
  }
  const latencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
  const errors = samples.filter((sample) => !sample.healthy).length;
  const p95Ms = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] || 0;
  const observedWindowSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const passed = samples.length >= selectedPolicy.minimumSamples
    && errors <= selectedPolicy.maximumErrors
    && p95Ms <= selectedPolicy.maximumP95Ms
    && observedWindowSeconds >= selectedPolicy.windowSeconds
    && identityHealthy;
  const summary = {
    schemaVersion: 1,
    stage: expectedStage,
    sourceSha: expectedSha,
    passed,
    samples: samples.length,
    errors,
    p95Ms,
    windowSeconds: observedWindowSeconds,
    thresholds: {
      minimumSamples: selectedPolicy.minimumSamples,
      maximumErrors: selectedPolicy.maximumErrors,
      maximumP95Ms: selectedPolicy.maximumP95Ms,
      requiredWindowSeconds: selectedPolicy.windowSeconds,
    },
    observationClass: "external-health-fail-closed",
    coreVersionId: expectedCoreVersionId,
    timekeepingVersionId: expectedTimekeepingVersionId,
    identityVersionId: expectedIdentityVersionId,
    identityHealthMatched: identityHealthy,
    pagesDeploymentId: expectedPagesDeploymentId,
    pagesControlPlaneMatched,
    pagesControlPlaneCommitSha,
    controlPlaneAttested,
    maintenanceSamples: samples.filter((sample) => sample.healthy).length,
    teardownPassed: true,
    piiIncluded: false,
    credentialsIncluded: false,
  };
  const digest = crypto.createHash("sha256").update(JSON.stringify(summary)).digest("hex");
  const report = { ...summary, digest };
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  if (!passed) throw new Error("Ponto rollback health/fail-closed/Identity SLO thresholds were not met");
  process.stdout.write(`Ponto rollback health/fail-closed observation passed with ${report.samples} samples over ${report.windowSeconds}s.\n`);
  process.exit(0);
}

let identityContractMode = "";
let identityContractMatched = false;
let identityCandidateAuthMatched = false;
let identityCandidateSessionRead = false;
let identityCandidateSessionTeardown = false;
if (expectedStage === "pilot" || expectedStage === "canary") {
  const identityProbe = await request("/api/ponto/_release-contract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: pilotLogin, password: pilotPassword }),
  });
  const pagesSha = String(identityProbe.response.headers.get("x-skincos-pages-release-sha") || "").trim().toLowerCase();
  const pagesEnvironment = String(identityProbe.response.headers.get("x-skincos-pages-environment") || "").trim().toLowerCase();
  identityContractMatched = identityProbe.response.status === 200
    && pagesSha === expectedSha
    && pagesEnvironment === "production"
    && identityProbe.json?.ok === true
    && identityProbe.json?.ready === true
    && String(identityProbe.json?.releaseSha || "").toLowerCase() === expectedSha
    && String(identityProbe.json?.identityVersionId || "").toLowerCase() === expectedIdentityVersionId
    && identityProbe.json?.contract === "identity-workforce-hmac-v2"
    && identityProbe.json?.roleClass === "CONSULTOR"
    && JSON.stringify(identityProbe.json?.modules) === JSON.stringify(["atendimento", "ponto"])
    && identityProbe.json?.sessionRead === true
    && identityProbe.json?.sessionRevoked === true
    && identityProbe.json?.credentialsIncluded === false
    && identityProbe.json?.piiIncluded === false;
  if (!identityContractMatched) throw new Error("protected Pages Identity release contract did not attest the exact candidate");
  identityContractMode = "protected-pages-service-binding";
  identityCandidateAuthMatched = true;
  identityCandidateSessionRead = true;
  identityCandidateSessionTeardown = true;
} else {
  const identityHealthResponse = await fetch(new URL("/insumos/health", identityBase), {
    redirect: "manual",
    headers: { accept: "application/json", ...accessHeaders },
  });
  const identityHealth = await identityHealthResponse.json().catch(() => null);
  identityContractMatched = identityHealthResponse.status === 200
    && identityHealth?.ok === true
    && identityHealth?.ready === true
    && String(identityHealth?.version || "").toLowerCase() === expectedSha
    && String(identityHealth?.workerVersion?.id || "").toLowerCase() === expectedIdentityVersionId
    && identityHealth?.environment === "production";
  if (!identityContractMatched) throw new Error("active production Identity health did not attest the exact release");
  identityContractMode = "active-identity-health";
}

const login = await request("/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: pilotLogin, password: pilotPassword }),
});
updateCookies(login.response);
if (!cookie) throw new Error("pilot login failed without issuing an authenticated cookie");
const authenticatedCookie = cookie;
const authenticatedCookieNames = new Set(parseCookieHeader(authenticatedCookie).keys());
let role = "";
let modules = [];
let startedAt = Date.now();
const samples = [];
let primaryError = null;
let teardownError = null;
const teardown = {
  logoutAttempted: false,
  logoutStatus: 0,
  logoutSucceeded: false,
  cookieJarDeletionMatched: false,
  sessionRevocationCheckAttempted: false,
  sessionRevocationStatus: 0,
  sessionRevoked: false,
};
try {
  if (login.response.status !== 200) throw new Error(`pilot login failed with HTTP ${login.response.status}`);
  const auth = await request("/api/auth/me");
  if (auth.response.status !== 200) throw new Error("authenticated identity check failed");
  role = String(auth.json?.user?.role || "").toUpperCase();
  if (!["CONSULTOR", "EMPLOYEE"].includes(role)) throw new Error("pilot identity is not CONSULTOR/EMPLOYEE");
  modules = [...new Set((auth.json?.user?.allowedModules || []).map((value) => String(value).toLowerCase()))].sort();
  if (JSON.stringify(modules) !== JSON.stringify(["atendimento", "ponto"])) throw new Error("pilot navigation grants are not exactly Atendimento and Ponto");
  const profile = await request("/api/ponto/me/profile");
  if (profile.response.status !== 200 || profile.json?.ok !== true || !attestedRelease(profile.response).matched) {
    throw new Error("authorized Ponto profile read did not attest the exact release");
  }

  startedAt = Date.now();
  const stopAt = startedAt + selectedPolicy.windowSeconds * 1000;
  while (Date.now() < stopAt || samples.length < selectedPolicy.minimumSamples) {
    const started = performance.now();
    let status = 0;
    let linked = false;
    let releaseMatched = false;
    try {
      const me = await request("/api/ponto/me");
      status = me.response.status;
      linked = me.json?.linked === true;
      releaseMatched = attestedRelease(me.response).matched;
    } catch {
      status = 0;
    }
    samples.push({ status, linked, releaseMatched, latencyMs: Math.round(performance.now() - started) });
    const remaining = stopAt - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(selectedPolicy.cadenceSeconds * 1000, remaining)));
  }
} catch (error) {
  primaryError = error instanceof Error ? error : new Error(String(error));
} finally {
  const teardownFailures = [];
  teardown.logoutAttempted = true;
  try {
    const logout = await request("/api/auth/logout", {
      method: "POST",
      headers: { cookie: authenticatedCookie },
    });
    teardown.logoutStatus = logout.response.status;
    updateCookies(logout.response);
    teardown.logoutSucceeded = logout.response.status >= 200 && logout.response.status < 300;
    const postLogoutCookieNames = new Set(parseCookieHeader(cookie).keys());
    teardown.cookieJarDeletionMatched = [...authenticatedCookieNames].every((name) => !postLogoutCookieNames.has(name));
    if (!teardown.logoutSucceeded) teardownFailures.push(`logout returned HTTP ${logout.response.status}`);
    if (!teardown.cookieJarDeletionMatched) teardownFailures.push("logout did not delete every authenticated cookie");
  } catch (error) {
    teardownFailures.push(`logout request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  teardown.sessionRevocationCheckAttempted = true;
  try {
    const revoked = await request("/api/auth/me", {
      headers: { cookie: authenticatedCookie },
    });
    teardown.sessionRevocationStatus = revoked.response.status;
    const unauthenticatedCode = String(revoked.json?.error || revoked.json?.code || "").trim().toUpperCase();
    teardown.sessionRevoked = revoked.response.status === 401
      && revoked.json?.ok === false
      && unauthenticatedCode === "UNAUTHORIZED";
    if (!teardown.sessionRevoked) {
      teardownFailures.push(`old authenticated cookie remained usable or returned a non-canonical response (HTTP ${revoked.response.status})`);
    }
  } catch (error) {
    teardownFailures.push(`session revocation check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (teardownFailures.length) teardownError = new Error(teardownFailures.join("; "));
}
const latencies = samples.map((sample) => sample.latencyMs).sort((a, b) => a - b);
const errors = samples.filter((sample) => sample.status !== 200 || !sample.linked || !sample.releaseMatched).length;
const p95Ms = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] || 0;
const observedWindowSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
const journeyThresholdsPassed = samples.length >= selectedPolicy.minimumSamples
  && errors <= selectedPolicy.maximumErrors
  && p95Ms <= selectedPolicy.maximumP95Ms
  && observedWindowSeconds >= selectedPolicy.windowSeconds;
const teardownPassed = teardown.logoutAttempted
  && teardown.logoutSucceeded
  && teardown.cookieJarDeletionMatched
  && teardown.sessionRevocationCheckAttempted
  && teardown.sessionRevoked;
const passed = primaryError === null && journeyThresholdsPassed && teardownPassed;
const summary = {
  schemaVersion: 1,
  stage: expectedStage,
  sourceSha: expectedSha,
  passed,
  samples: samples.length,
  errors,
  p95Ms,
  windowSeconds: observedWindowSeconds,
  thresholds: {
    minimumSamples: selectedPolicy.minimumSamples,
    maximumErrors: selectedPolicy.maximumErrors,
    maximumP95Ms: selectedPolicy.maximumP95Ms,
    requiredWindowSeconds: selectedPolicy.windowSeconds,
  },
  roleClass: role === "EMPLOYEE" ? "CONSULTOR" : role,
  linkedSamples: samples.filter((sample) => sample.linked).length,
  releaseMatchedSamples: samples.filter((sample) => sample.releaseMatched).length,
  coreVersionId: expectedCoreVersionId,
  timekeepingVersionId: expectedTimekeepingVersionId,
  identityVersionId: expectedIdentityVersionId,
  pagesDeploymentId: expectedPagesDeploymentId,
  pagesControlPlaneMatched,
  pagesControlPlaneCommitSha,
  pagesReleaseSha: expectedSha,
  identityContract: "identity-workforce-hmac-v2",
  identityContractMode,
  identityContractMatched,
  identityCandidateAuthMatched,
  identityCandidateSessionRead,
  identityCandidateSessionTeardown,
  navigationGrantCount: modules.length,
  teardown,
  teardownPassed,
  piiIncluded: false,
  credentialsIncluded: false,
};
const digest = crypto.createHash("sha256").update(JSON.stringify(summary)).digest("hex");
const report = { ...summary, digest };
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
const journeyError = primaryError || (!journeyThresholdsPassed ? new Error(`Ponto ${expectedStage} SLO thresholds were not met`) : null);
if (journeyError && teardownError) {
  throw new AggregateError(
    [journeyError, teardownError],
    `${journeyError.message}; teardown failed: ${teardownError.message}`,
    { cause: journeyError },
  );
}
if (journeyError) throw journeyError;
if (teardownError) throw teardownError;
process.stdout.write(`Ponto ${expectedStage} read-only CONSULTOR journey passed with ${report.samples} samples over ${report.windowSeconds}s.\n`);
