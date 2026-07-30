import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { consumeJitCredentials } from "./ponto-jit-credential-attestation.mjs";
import { isTerminalPagesDeployment } from "./ponto-rollback-ownership.mjs";

let pilotLogin = "";
let pilotPassword = "";
const reportFile = String(process.env.PONTO_RELEASE_SLO_REPORT || "");
const expectedSha = String(process.env.PONTO_RELEASE_SHA || "").trim().toLowerCase();
const expectedStage = String(process.env.PONTO_RELEASE_STAGE || "").trim().toLowerCase();
const expectedCoreVersionId = String(process.env.PONTO_EXPECTED_CORE_VERSION_ID || "").trim().toLowerCase();
const expectedTimekeepingVersionId = String(process.env.PONTO_EXPECTED_TIMEKEEPING_VERSION_ID || "").trim().toLowerCase();
const expectedIdentityVersionId = String(process.env.PONTO_EXPECTED_IDENTITY_VERSION_ID || "").trim().toLowerCase();
const expectedPagesDeploymentId = String(process.env.PONTO_EXPECTED_PAGES_DEPLOYMENT_ID || "").trim().toLowerCase();
const cloudflareAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim().toLowerCase();
const cloudflareApiToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const pagesProject = String(process.env.CLOUDFLARE_PAGES_PROJECT || "").trim();
const controlPlaneAttestationFile = String(process.env.PONTO_SLO_CONTROL_PLANE_ATTESTATION || "").trim();
const releaseProbeCapabilityFile = String(process.env.PONTO_RELEASE_PROBE_CAPABILITY || "").trim();
const orchestratorRunId = String(process.env.PONTO_ORCHESTRATOR_RUN_ID || "").trim();
const workflowRunId = String(process.env.GITHUB_RUN_ID || "").trim();
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
if (pagesProject !== "skincos") throw new Error("Ponto production Pages project custody is invalid");
if (![expectedCoreVersionId, expectedTimekeepingVersionId, expectedIdentityVersionId, expectedPagesDeploymentId].every((value) => UUID.test(value))) {
  throw new Error("expected immutable surface version IDs are required");
}

const testOverridesRequested = Boolean(
  process.env.PONTO_SLO_TEST_WINDOW_SECONDS
  || process.env.PONTO_SLO_TEST_CADENCE_SECONDS
  || process.env.PONTO_SLO_TEST_MINIMUM_SAMPLES,
);
const testModeAllowed = process.env.PONTO_SLO_TEST_MODE === "true" && process.env.GITHUB_ACTIONS !== "true";
if (testOverridesRequested && !testModeAllowed) throw new Error("SLO test overrides are forbidden in GitHub Actions and production mode");
const runnerPolicyDocument = testModeAllowed && process.env.PONTO_SLO_TEST_RUNNER_POLICY_JSON
  ? JSON.parse(process.env.PONTO_SLO_TEST_RUNNER_POLICY_JSON)
  : JSON.parse(fs.readFileSync(path.resolve(".github/governance/progressive-release-policy.json"), "utf8"));
const runnerPolicy = runnerPolicyDocument?.pilotRunner?.production;
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
let pagesControlPlaneDigest = "";
if (testModeAllowed) {
  pagesControlPlaneMatched = true;
  pagesControlPlaneCommitSha = expectedSha;
  pagesControlPlaneDigest = crypto.createHash("sha256").update(`test:${expectedSha}`).digest("hex");
} else if (expectedStage === "rollback") {
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
    && isTerminalPagesDeployment(deployment)
    && aliasHosts.has("crm.skincos.com.br")
    && (expectedStage === "rollback" || pagesControlPlaneCommitSha === expectedSha);
  if (!pagesControlPlaneMatched) throw new Error("public CRM domain is not linked to the expected Pages deployment");
  pagesControlPlaneDigest = crypto.createHash("sha256").update(JSON.stringify({
    expectedPagesDeploymentId,
    pagesControlPlaneCommitSha,
    expectedStage,
  })).digest("hex");
} else {
  if (
    !controlPlaneAttestationFile
    || !/^[1-9][0-9]{0,19}$/.test(orchestratorRunId)
    || !/^[1-9][0-9]{0,19}$/.test(workflowRunId)
  ) throw new Error("protected production SLO control-plane attestation is unavailable");
  const controlPlane = JSON.parse(fs.readFileSync(controlPlaneAttestationFile, "utf8"));
  const { digest, ...summary } = controlPlane || {};
  const recomputedDigest = crypto.createHash("sha256").update(JSON.stringify(summary)).digest("hex");
  pagesControlPlaneMatched = controlPlane?.schemaVersion === 1
    && controlPlane?.domain === "skincos/ponto/production-slo-control-plane/v1"
    && controlPlane?.passed === true
    && controlPlane?.target === "production"
    && controlPlane?.stage === expectedStage
    && String(controlPlane?.sourceSha || "").toLowerCase() === expectedSha
    && String(controlPlane?.coordinatorRunId || "") === orchestratorRunId
    && String(controlPlane?.workflowRunId || "") === workflowRunId
    && String(controlPlane?.coreVersionId || "").toLowerCase() === expectedCoreVersionId
    && String(controlPlane?.timekeepingVersionId || "").toLowerCase() === expectedTimekeepingVersionId
    && String(controlPlane?.identityVersionId || "").toLowerCase() === expectedIdentityVersionId
    && String(controlPlane?.pagesDeploymentId || "").toLowerCase() === expectedPagesDeploymentId
    && controlPlane?.pagesProject === "skincos"
    && controlPlane?.pagesEnvironment === "production"
    && controlPlane?.pagesBranch === "main"
    && String(controlPlane?.pagesCommitSha || "").toLowerCase() === expectedSha
    && controlPlane?.pagesTerminal === true
    && controlPlane?.crmAliasMatched === true
    && (
      !["pilot", "canary"].includes(expectedStage)
      || (
        String(controlPlane?.pilotRunnerId || "") === String(runnerPolicy?.runnerId || "")
        && controlPlane?.pilotRunnerName === runnerPolicy?.runnerName
        && controlPlane?.pilotRunnerIsolationRef === runnerPolicy?.runnerIsolationRef
        && JSON.stringify(controlPlane?.pilotRunnerRequiredLabels) === JSON.stringify(runnerPolicy?.requiredLabels)
        && controlPlane?.pilotRunnerNetworkContextCustodyRef === runnerPolicy?.networkContextCustodyRef
        && controlPlane?.pilotRunnerEncryptionPublicKeySha256 === runnerPolicy?.encryptionPublicKeySha256
      )
    )
    && controlPlane?.credentialsIncluded === false
    && controlPlane?.piiIncluded === false
    && /^[0-9a-f]{64}$/.test(String(digest || ""))
    && crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(recomputedDigest, "hex"));
  if (!pagesControlPlaneMatched) throw new Error("protected production SLO control-plane attestation differs");
  pagesControlPlaneCommitSha = String(controlPlane.pagesCommitSha).toLowerCase();
  pagesControlPlaneDigest = String(digest);
}
const accessHeaders = {};
let jitCredentialAttestationDigest = "";
let jitCredentialBundleDigest = "";
let jitDecryptKeyDigest = "";
let clinicRunnerAttestationDigest = "";
let jitCredentialFilesDeleted = expectedStage === "rollback";
let runnerEncryptionPrivateKeyPem = "";
if (expectedStage === "rollback") {
  if (process.env.CF_ACCESS_CLIENT_ID || process.env.CF_ACCESS_CLIENT_SECRET) {
    if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) throw new Error("partial Cloudflare Access credential");
    accessHeaders["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
    accessHeaders["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
} else if (testModeAllowed) {
  pilotLogin = String(process.env.PONTO_PILOT_LOGIN || "");
  pilotPassword = String(process.env.PONTO_PILOT_PASSWORD || "");
  runnerEncryptionPrivateKeyPem = String(process.env.PONTO_PILOT_RUNNER_ENCRYPTION_PRIVATE_KEY_PEM || "");
  if (process.env.CF_ACCESS_CLIENT_ID || process.env.CF_ACCESS_CLIENT_SECRET) {
    if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) throw new Error("partial Cloudflare Access credential");
    accessHeaders["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
    accessHeaders["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
  jitCredentialFilesDeleted = true;
} else {
  const jitCredentials = consumeJitCredentials();
  pilotLogin = jitCredentials.pilotLogin;
  pilotPassword = jitCredentials.pilotPassword;
  jitCredentialAttestationDigest = jitCredentials.attestationDigest;
  jitCredentialBundleDigest = jitCredentials.credentialBundleDigest;
  jitDecryptKeyDigest = jitCredentials.decryptKeyDigest;
  clinicRunnerAttestationDigest = jitCredentials.clinicRunnerAttestationDigest;
  jitCredentialFilesDeleted = jitCredentials.filesDeleted;
  runnerEncryptionPrivateKeyPem = jitCredentials.runnerEncryptionPrivateKeyPem;
  if (jitCredentials.cfAccessClientId || jitCredentials.cfAccessClientSecret) {
    if (!jitCredentials.cfAccessClientId || !jitCredentials.cfAccessClientSecret) throw new Error("partial JIT Cloudflare Access credential");
    accessHeaders["CF-Access-Client-Id"] = jitCredentials.cfAccessClientId;
    accessHeaders["CF-Access-Client-Secret"] = jitCredentials.cfAccessClientSecret;
  }
}
if (expectedStage !== "rollback" && (!pilotLogin.includes("@") || pilotPassword.length < 12)) {
  throw new Error("JIT pilot credentials are invalid");
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
    if (samples.filter((sample) => !sample.healthy).length > selectedPolicy.maximumErrors) break;
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
let releaseProbeCapabilityMatched = false;
let releaseProbeCapabilityDigest = "";
if (expectedStage === "pilot" || expectedStage === "canary") {
  if (!releaseProbeCapabilityFile) throw new Error("one-time release-probe capability is unavailable");
  const capability = JSON.parse(fs.readFileSync(releaseProbeCapabilityFile, "utf8"));
  const nowSeconds = Math.floor(Date.now() / 1000);
  const runnerName = String(process.env.RUNNER_NAME || process.env.PONTO_RUNNER_NAME || "").trim();
  const runnerIsolationRef = String(runnerPolicy?.runnerIsolationRef || "");
  const runnerNetworkContextRef = String(runnerPolicy?.networkContextCustodyRef || "");
  let runnerPrivateKey = null;
  let runnerPublicKeyFingerprint = "";
  try {
    runnerPrivateKey = crypto.createPrivateKey(runnerEncryptionPrivateKeyPem);
    const runnerPublicDer = crypto.createPublicKey(runnerPrivateKey).export({ type: "spki", format: "der" });
    runnerPublicKeyFingerprint = crypto.createHash("sha256").update(runnerPublicDer).digest("hex");
  } catch {
    throw new Error("clinic runner proof-of-possession key is unavailable");
  }
  releaseProbeCapabilityMatched = capability?.schemaVersion === 2
    && capability?.domain === "ponto-release-probe/v2"
    && capability?.signatureVersion === "2"
    && capability?.delegationVersion === "1"
    && /^[1-9][0-9]{0,19}$/.test(String(capability?.delegationTimestamp || ""))
    && /^[1-9][0-9]{0,19}$/.test(String(capability?.delegationExpiresAt || ""))
    && Number(capability.delegationTimestamp) <= nowSeconds
    && Number(capability.delegationExpiresAt) > nowSeconds
    && Number(capability.delegationExpiresAt) - Number(capability.delegationTimestamp) <= 2 * 60 * 60
    && /^[0-9a-f]{32}$/.test(String(capability?.nonce || ""))
    && /^[0-9a-f]{64}$/.test(String(capability?.delegatedKeyCommitment || ""))
    && /^[A-Za-z0-9_-]{43}$/.test(String(capability?.delegationSignature || ""))
    && capability?.delegatedKeyEncryption === "rsa-oaep-sha256"
    && typeof capability?.encryptedDelegatedKey === "string"
    && capability.encryptedDelegatedKey.length >= 300
    && capability?.runnerEncryptionPublicKeyFingerprint === runnerPublicKeyFingerprint
    && runnerPublicKeyFingerprint === String(runnerPolicy?.encryptionPublicKeySha256 || "").toLowerCase()
    && runnerName === runnerPolicy?.runnerName
    && runnerIsolationRef === runnerPolicy?.runnerIsolationRef
    && runnerNetworkContextRef === runnerPolicy?.networkContextCustodyRef
    && capability?.method === "POST"
    && capability?.pathname === "/api/ponto/_release-contract"
    && capability?.releaseSha === expectedSha
    && capability?.stage === expectedStage
    && capability?.coordinatorRunId === orchestratorRunId
    && capability?.workflowRunId === workflowRunId
    && capability?.bodyDigestBoundAtUse === true
    && capability?.singleUse === true
    && capability?.piiIncluded === false
    && capability?.credentialsIncluded === false
    && capability?.bodyDigestIncluded === false
    && capability?.rootKeyIncluded === false
    && capability?.delegatedSigningKeyIncluded === false
    && capability?.encryptedDelegatedSigningKeyIncluded === true
    && !Object.hasOwn(capability, "bodyDigest")
    && !Object.hasOwn(capability, "delegatedKey")
    && !Object.hasOwn(capability, "rootKey");
  if (!releaseProbeCapabilityMatched) throw new Error("one-time release-probe capability claims differ");
  const delegatedKey = crypto.privateDecrypt({
    key: runnerPrivateKey,
    oaepHash: "sha256",
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
  }, Buffer.from(capability.encryptedDelegatedKey, "base64")).toString("utf8");
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(delegatedKey)
    || crypto.createHash("sha256").update(delegatedKey).digest("hex") !== capability.delegatedKeyCommitment
  ) throw new Error("clinic runner decrypted a mismatched delegated release-probe key");
  releaseProbeCapabilityDigest = crypto.createHash("sha256").update(JSON.stringify(capability)).digest("hex");
  const releaseContractBody = JSON.stringify({ email: pilotLogin, password: pilotPassword });
  const requestTimestamp = String(Date.now());
  const requestBodyDigest = crypto.createHash("sha256").update(releaseContractBody).digest("hex");
  const requestMessage = [
    "ponto-release-probe/v2",
    requestTimestamp,
    capability.nonce,
    "POST",
    "/api/ponto/_release-contract",
    requestBodyDigest,
    expectedSha,
    expectedStage,
    orchestratorRunId,
    workflowRunId,
  ].join(".");
  const requestSignature = crypto
    .createHmac("sha256", delegatedKey)
    .update(requestMessage)
    .digest("base64url");
  let identityProbe;
  try {
    identityProbe = await request("/api/ponto/_release-contract", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-skincos-release-probe-ts": requestTimestamp,
        "x-skincos-release-probe-nonce": capability.nonce,
        "x-skincos-release-probe-signature-version": capability.signatureVersion,
        "x-skincos-release-probe-sig": requestSignature,
        "x-skincos-release-probe-stage": capability.stage,
        "x-skincos-release-probe-coordinator-run-id": capability.coordinatorRunId,
        "x-skincos-release-probe-workflow-run-id": capability.workflowRunId,
        "x-skincos-release-probe-delegation-version": capability.delegationVersion,
        "x-skincos-release-probe-delegation-key": delegatedKey,
        "x-skincos-release-probe-delegation-key-commitment": capability.delegatedKeyCommitment,
        "x-skincos-release-probe-delegation-ts": capability.delegationTimestamp,
        "x-skincos-release-probe-delegation-exp": capability.delegationExpiresAt,
        "x-skincos-release-probe-delegation-sig": capability.delegationSignature,
      },
      body: releaseContractBody,
    });
  } finally {
    fs.rmSync(releaseProbeCapabilityFile, { force: true });
  }
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
    const observedErrors = samples.filter((sample) => sample.status !== 200 || !sample.linked || !sample.releaseMatched).length;
    if (observedErrors > selectedPolicy.maximumErrors) {
      throw new Error(`Ponto ${expectedStage} error budget was irrevocably exhausted after ${samples.length} sample(s)`);
    }
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
  pagesControlPlaneDigest,
  pagesReleaseSha: expectedSha,
  identityContract: "identity-workforce-hmac-v2",
  identityContractMode,
  identityContractMatched,
  identityCandidateAuthMatched,
  identityCandidateSessionRead,
  identityCandidateSessionTeardown,
  releaseProbeCapabilityMatched,
  releaseProbeCapabilityDigest,
  errorBudgetExhausted: errors > selectedPolicy.maximumErrors,
  jitCredentialAttestationDigest,
  jitCredentialBundleDigest,
  jitDecryptKeyDigest,
  clinicRunnerAttestationDigest,
  jitCredentialFilesDeleted,
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
pilotLogin = "";
pilotPassword = "";
runnerEncryptionPrivateKeyPem = "";
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
