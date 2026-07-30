import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve(".github/scripts/ponto-production-journey.mjs");
const sha = "a".repeat(40);
const uuid = "11111111-1111-4111-8111-111111111111";
const runnerKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const runnerPrivatePem = runnerKeys.privateKey.export({ type: "pkcs8", format: "pem" });
const runnerPublicFingerprint = crypto.createHash("sha256")
  .update(runnerKeys.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const runnerPolicy = {
  pilotRunner: {
    production: {
      runnerName: "ponto-clinic-test",
      runnerIsolationRef: "ponto-pilot-isolation-test",
      requiredLabels: ["self-hosted", "Linux", "X64", "ponto-pilot"],
      networkContextCustodyRef: "test-network-context-ref",
      encryptionPublicKeySha256: runnerPublicFingerprint,
      runnerId: "987",
    },
  },
};

const runMockJourney = (mode, {
  stage = "production",
  windowSeconds = "0",
  cadenceSeconds = "0",
  minimumSamples = "1",
  runnerName = "ponto-clinic-test",
  runnerIsolationRef = "ponto-pilot-isolation-test",
  networkContextRef = "test-network-context-ref",
  runnerPrivateKeyPem = runnerPrivatePem,
  effectiveRunnerPolicy = runnerPolicy,
} = {}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-production-journey-"));
  const preload = path.join(directory, "fetch-mock.mjs");
  const report = path.join(directory, "report.json");
  const events = path.join(directory, "events.jsonl");
  const capabilityFile = path.join(directory, "release-probe-capability.json");
  if (stage === "pilot" || stage === "canary") {
    const delegatedKey = Buffer.alloc(32, stage === "pilot" ? 7 : 11).toString("base64url");
    const delegatedKeyCommitment = crypto.createHash("sha256").update(delegatedKey).digest("hex");
    const nowSeconds = Math.floor(Date.now() / 1000);
    const encryptedDelegatedKey = crypto.publicEncrypt({
      key: runnerKeys.publicKey,
      oaepHash: "sha256",
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    }, Buffer.from(delegatedKey)).toString("base64");
    fs.writeFileSync(capabilityFile, `${JSON.stringify({
      schemaVersion: 2,
      domain: "ponto-release-probe/v2",
      signatureVersion: "2",
      delegationVersion: "1",
      delegationTimestamp: String(nowSeconds),
      delegationExpiresAt: String(nowSeconds + 7200),
      nonce: "1".repeat(32),
      delegatedKeyCommitment,
      delegationSignature: "s".repeat(43),
      encryptedDelegatedKey,
      delegatedKeyEncryption: "rsa-oaep-sha256",
      runnerEncryptionPublicKeyFingerprint: runnerPublicFingerprint,
      method: "POST",
      pathname: "/api/ponto/_release-contract",
      releaseSha: sha,
      stage,
      coordinatorRunId: "123",
      workflowRunId: "456",
      bodyDigestBoundAtUse: true,
      singleUse: true,
      piiIncluded: false,
      credentialsIncluded: false,
      bodyDigestIncluded: false,
      rootKeyIncluded: false,
      delegatedSigningKeyIncluded: false,
      encryptedDelegatedSigningKeyIncluded: true,
    }, null, 2)}\n`, { mode: 0o600 });
  }
  fs.writeFileSync(preload, String.raw`
import crypto from "node:crypto";
import fs from "node:fs";

const mode = process.env.PONTO_JOURNEY_MOCK_MODE;
const eventsFile = process.env.PONTO_JOURNEY_MOCK_EVENTS;
const releaseSha = process.env.PONTO_RELEASE_SHA;
const coreVersionId = process.env.PONTO_EXPECTED_CORE_VERSION_ID;
const timekeepingVersionId = process.env.PONTO_EXPECTED_TIMEKEEPING_VERSION_ID;
const identityVersionId = process.env.PONTO_EXPECTED_IDENTITY_VERSION_ID;
let loggedOut = false;

const response = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", ...headers },
});
const releaseHeaders = {
  "x-skincos-pages-release-sha": releaseSha,
  "x-skincos-gateway-release-sha": releaseSha,
  "x-skincos-gateway-version-id": coreVersionId,
  "x-skincos-timekeeping-release-sha": releaseSha,
  "x-skincos-timekeeping-version-id": timekeepingVersionId,
};

globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const cookie = request.headers.get("cookie") || "";
  fs.appendFileSync(eventsFile, JSON.stringify({
    pathname: url.pathname,
    method: request.method,
    hasAuthenticatedCookie: cookie.includes("session=pilot-session"),
  }) + "\n");

  if (url.pathname === "/insumos/health") {
    return response(200, {
      ok: true,
      ready: true,
      version: releaseSha,
      workerVersion: { id: identityVersionId },
      environment: "production",
    });
  }
  if (url.pathname === "/api/ponto/_release-contract") {
    const rawBody = await request.text();
    const bodyDigest = crypto.createHash("sha256").update(rawBody).digest("hex");
    const delegatedKey = request.headers.get("x-skincos-release-probe-delegation-key") || "";
    const message = [
      "ponto-release-probe/v2",
      request.headers.get("x-skincos-release-probe-ts"),
      request.headers.get("x-skincos-release-probe-nonce"),
      "POST",
      url.pathname,
      bodyDigest,
      releaseSha,
      process.env.PONTO_RELEASE_STAGE,
      process.env.PONTO_ORCHESTRATOR_RUN_ID,
      process.env.GITHUB_RUN_ID,
    ].join(".");
    const expected = crypto.createHmac("sha256", delegatedKey).update(message).digest("base64url");
    const authorized = request.headers.get("x-skincos-release-probe-signature-version") === "2"
      && request.headers.get("x-skincos-release-probe-sig") === expected
      && request.headers.get("x-skincos-release-probe-delegation-version") === "1"
      && request.headers.get("x-skincos-release-probe-stage") === process.env.PONTO_RELEASE_STAGE
      && request.headers.get("x-skincos-release-probe-coordinator-run-id") === process.env.PONTO_ORCHESTRATOR_RUN_ID
      && request.headers.get("x-skincos-release-probe-workflow-run-id") === process.env.GITHUB_RUN_ID;
    if (!authorized) return response(403, { ok: false, error: "RELEASE_PROBE_NOT_AUTHORIZED" });
    return response(200, {
      ok: true,
      ready: true,
      releaseSha,
      identityVersionId,
      contract: "identity-workforce-hmac-v2",
      roleClass: "CONSULTOR",
      modules: ["atendimento", "ponto"],
      sessionRead: true,
      sessionRevoked: true,
      credentialsIncluded: false,
      piiIncluded: false,
    }, {
      "x-skincos-pages-release-sha": releaseSha,
      "x-skincos-pages-environment": "production",
    });
  }
  if (url.pathname === "/api/auth/login") {
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "session=pilot-session; Path=/; HttpOnly; Secure");
    headers.append("set-cookie", "csrfToken=pilot-csrf; Path=/; Secure");
    const status = mode === "partial-login-failure" ? 401 : 200;
    return new Response(JSON.stringify({ ok: status === 200 }), { status, headers });
  }
  if (url.pathname === "/api/auth/logout") {
    if (mode === "teardown-failure") return response(500, { ok: false, error: "LOGOUT_FAILED" });
    loggedOut = true;
    const headers = new Headers({ "content-type": "application/json" });
    headers.append("set-cookie", "session=; Path=/; Max-Age=0; HttpOnly; Secure");
    headers.append("set-cookie", "csrfToken=deleted; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure");
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }
  if (url.pathname === "/api/auth/me") {
    if (loggedOut) return response(401, { ok: false, error: "UNAUTHORIZED" });
    if (!["success", "bad-first-sample"].includes(mode)) return response(500, { ok: false, error: "AUTH_CHECK_FAILED" });
    return response(200, {
      ok: true,
      user: {
        role: "EMPLOYEE",
        allowedModules: ["ponto", "atendimento"],
      },
    });
  }
  if (url.pathname === "/api/ponto/me/profile") {
    return response(200, { ok: true }, releaseHeaders);
  }
  if (url.pathname === "/api/ponto/me") {
    if (mode === "bad-first-sample") return response(503, { ok: false, linked: false });
    return response(200, { ok: true, linked: true }, releaseHeaders);
  }
  return response(404, { ok: false, error: "NOT_FOUND" });
};
`, { mode: 0o600 });
  const result = spawnSync(process.execPath, ["--import", preload, script], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_ACTIONS: "",
      PONTO_JOURNEY_MOCK_MODE: mode,
      PONTO_JOURNEY_MOCK_EVENTS: events,
      PONTO_SLO_TEST_MODE: "true",
      PONTO_SLO_TEST_WINDOW_SECONDS: windowSeconds,
      PONTO_SLO_TEST_CADENCE_SECONDS: cadenceSeconds,
      PONTO_SLO_TEST_MINIMUM_SAMPLES: minimumSamples,
      PONTO_RELEASE_SHA: sha,
      PONTO_RELEASE_STAGE: stage,
      PONTO_RELEASE_SLO_REPORT: report,
      PONTO_RELEASE_CRM_URL: "https://crm.test",
      PONTO_RELEASE_IDENTITY_URL: "https://identity.test",
      PONTO_EXPECTED_CORE_VERSION_ID: uuid,
      PONTO_EXPECTED_TIMEKEEPING_VERSION_ID: uuid,
      PONTO_EXPECTED_IDENTITY_VERSION_ID: uuid,
      PONTO_EXPECTED_PAGES_DEPLOYMENT_ID: uuid,
      CLOUDFLARE_PAGES_PROJECT: "skincos",
      PONTO_PILOT_LOGIN: "pilot@example.test",
      PONTO_PILOT_PASSWORD: "not-a-real-password",
      PONTO_RELEASE_PROBE_CAPABILITY: capabilityFile,
      PONTO_ORCHESTRATOR_RUN_ID: "123",
      GITHUB_RUN_ID: "456",
      RUNNER_NAME: runnerName,
      PONTO_RUNNER_NAME: runnerName,
      PONTO_PILOT_RUNNER_ISOLATION_REF: runnerIsolationRef,
      PONTO_PILOT_NETWORK_CONTEXT_CUSTODY_REF: networkContextRef,
      PONTO_PILOT_RUNNER_ENCRYPTION_PRIVATE_KEY_PEM: runnerPrivateKeyPem,
      PONTO_SLO_TEST_RUNNER_POLICY_JSON: JSON.stringify(effectiveRunnerPolicy),
    },
  });
  return {
    result,
    report: fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, "utf8")) : null,
    events: fs.existsSync(events)
      ? fs.readFileSync(events, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : [],
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
};

test("GitHub Actions cannot shorten the governed SLO window", () => {
  const report = path.join(process.env.RUNNER_TEMP || process.env.TEMP || ".", `ponto-slo-guard-${process.pid}.json`);
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_ACTIONS: "true",
      PONTO_SLO_TEST_MODE: "true",
      PONTO_SLO_TEST_WINDOW_SECONDS: "1",
      PONTO_RELEASE_SHA: sha,
      PONTO_RELEASE_STAGE: "rollback",
      PONTO_RELEASE_SLO_REPORT: report,
      PONTO_EXPECTED_CORE_VERSION_ID: uuid,
      PONTO_EXPECTED_TIMEKEEPING_VERSION_ID: uuid,
      PONTO_EXPECTED_IDENTITY_VERSION_ID: uuid,
      PONTO_EXPECTED_PAGES_DEPLOYMENT_ID: uuid,
      CLOUDFLARE_PAGES_PROJECT: "skincos",
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /SLO test overrides are forbidden/);
  fs.rmSync(report, { force: true });
});

test("successful journey deletes auth cookies and proves the old session is revoked", () => {
  const execution = runMockJourney("success");
  try {
    assert.equal(execution.result.status, 0, `${execution.result.stderr}${execution.result.stdout}`);
    assert.equal(execution.report?.passed, true);
    assert.deepEqual(execution.report?.teardown, {
      logoutAttempted: true,
      logoutStatus: 200,
      logoutSucceeded: true,
      cookieJarDeletionMatched: true,
      sessionRevocationCheckAttempted: true,
      sessionRevocationStatus: 401,
      sessionRevoked: true,
    });
    const logout = execution.events.find((event) => event.pathname === "/api/auth/logout");
    const authChecks = execution.events.filter((event) => event.pathname === "/api/auth/me");
    assert.equal(logout?.hasAuthenticatedCookie, true, "logout must use the authenticated cookie");
    assert.equal(authChecks.at(-1)?.hasAuthenticatedCookie, true, "revocation probe must preserve and replay the pre-logout cookie");
  } finally {
    execution.cleanup();
  }
});

test("an immediate post-login failure still logs out and proves session revocation", () => {
  const execution = runMockJourney("immediate-primary-failure");
  try {
    const output = `${execution.result.stderr}${execution.result.stdout}`;
    assert.notEqual(execution.result.status, 0);
    assert.match(output, /authenticated identity check failed/);
    assert.equal(execution.report?.passed, false);
    assert.equal(execution.report?.teardown?.logoutAttempted, true);
    assert.equal(execution.report?.teardown?.logoutSucceeded, true);
    assert.equal(execution.report?.teardown?.cookieJarDeletionMatched, true);
    assert.equal(execution.report?.teardown?.sessionRevoked, true);
    assert.ok(execution.events.some((event) => event.pathname === "/api/auth/logout"), "logout was not attempted");
  } finally {
    execution.cleanup();
  }
});

test("a non-200 login that issues a partial session is also torn down and revoked", () => {
  const execution = runMockJourney("partial-login-failure");
  try {
    const output = `${execution.result.stderr}${execution.result.stdout}`;
    assert.notEqual(execution.result.status, 0);
    assert.match(output, /pilot login failed with HTTP 401/);
    assert.equal(execution.report?.passed, false);
    assert.equal(execution.report?.teardown?.logoutAttempted, true);
    assert.equal(execution.report?.teardown?.logoutSucceeded, true);
    assert.equal(execution.report?.teardown?.sessionRevoked, true);
    const logout = execution.events.find((event) => event.pathname === "/api/auth/logout");
    assert.equal(logout?.hasAuthenticatedCookie, true);
  } finally {
    execution.cleanup();
  }
});

test("primary and teardown failures are both surfaced without replacing the primary error", () => {
  const execution = runMockJourney("teardown-failure");
  try {
    const output = `${execution.result.stderr}${execution.result.stdout}`;
    assert.notEqual(execution.result.status, 0);
    assert.match(output, /authenticated identity check failed/);
    assert.match(output, /teardown failed/);
    assert.match(output, /logout returned HTTP 500/);
    assert.match(output, /old authenticated cookie remained usable/);
    assert.equal(execution.report?.teardown?.logoutAttempted, true);
    assert.equal(execution.report?.teardown?.sessionRevoked, false);
  } finally {
    execution.cleanup();
  }
});

for (const stage of ["pilot", "canary"]) {
  test(`${stage} uses a runner-encrypted one-time delegated probe and completes the authenticated journey`, () => {
    const execution = runMockJourney("success", { stage });
    try {
      assert.equal(execution.result.status, 0, `${execution.result.stderr}${execution.result.stdout}`);
      assert.equal(execution.report?.passed, true);
      assert.equal(execution.report?.identityContractMode, "protected-pages-service-binding");
      assert.equal(execution.report?.releaseProbeCapabilityMatched, true);
      assert.match(execution.report?.releaseProbeCapabilityDigest, /^[0-9a-f]{64}$/);
      const probe = execution.events.find((event) => event.pathname === "/api/ponto/_release-contract");
      assert.equal(probe?.method, "POST");
    } finally {
      execution.cleanup();
    }
  });
}

test("pilot refuses a copied runner identity and a swapped RSA decrypt key", () => {
  const otherKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const cases = [
    { runnerName: "copied-label-runner" },
    { runnerPrivateKeyPem: otherKeys.privateKey.export({ type: "pkcs8", format: "pem" }) },
  ];
  for (const overrides of cases) {
    const execution = runMockJourney("success", { stage: "pilot", ...overrides });
    try {
      assert.notEqual(execution.result.status, 0);
      assert.match(
        `${execution.result.stderr}${execution.result.stdout}`,
        /one-time release-probe capability claims differ|decrypt|proof-of-possession/,
      );
      assert.equal(execution.events.some((event) => event.pathname === "/api/auth/login"), false);
    } finally {
      execution.cleanup();
    }
  }
});

test("the first bad sample exhausts a zero-error budget immediately and still proves teardown", () => {
  const startedAt = Date.now();
  const execution = runMockJourney("bad-first-sample", {
    stage: "production",
    windowSeconds: "60",
    cadenceSeconds: "30",
    minimumSamples: "10",
  });
  try {
    const elapsedMs = Date.now() - startedAt;
    const output = `${execution.result.stderr}${execution.result.stdout}`;
    assert.notEqual(execution.result.status, 0);
    assert.match(output, /error budget was irrevocably exhausted after 1 sample/);
    assert.ok(elapsedMs < 5_000, `first bad sample waited ${elapsedMs}ms instead of aborting`);
    assert.equal(execution.report?.samples, 1);
    assert.equal(execution.report?.errors, 1);
    assert.equal(execution.report?.errorBudgetExhausted, true);
    assert.equal(execution.report?.teardownPassed, true);
  } finally {
    execution.cleanup();
  }
});

test("journey source requires exact surface headers, navigation, Identity contract, and maintenance-only rollback", () => {
  const source = fs.readFileSync(script, "utf8");
  for (const required of [
    "x-skincos-pages-release-sha",
    "x-skincos-gateway-version-id",
    "x-skincos-timekeeping-version-id",
    "/api/ponto/_release-contract",
    "protected-pages-service-binding",
    "identity-workforce-hmac-v2",
    "[\"atendimento\", \"ponto\"]",
    "MODULE_MAINTENANCE",
    "identityHealthMatched",
    "PONTO_ROLLBACK_CONTROL_PLANE_ATTESTATION",
    "cookieJarDeletionMatched",
    "sessionRevoked",
    "x-skincos-release-probe-delegation-sig",
    "consumeJitCredentials",
    "runnerEncryptionPrivateKeyPem",
  ]) assert.ok(source.includes(required), `missing governed assertion: ${required}`);
  assert.ok(!source.includes("PONTO_IDEMPOTENCY_KEY"), "the clinic journey must never hydrate the root");
  assert.ok(!source.includes("Cloudflare-Workers-Version-Overrides"), "public Identity version override must never be sent");
  assert.ok(!source.includes("cloudflare-workers-version-overrides"), "public Identity version override must never be sent");
});

test("clinic workflow receives only encrypted delegation and non-secret bindings from GitHub", () => {
  const workflow = fs.readFileSync(
    path.resolve(".github/workflows/ponto-production-slo.yml"),
    "utf8",
  );
  const clinicStart = workflow.indexOf("  consultor-journey:");
  const rollbackStart = workflow.indexOf("  rollback-observation:");
  assert.ok(clinicStart >= 0 && rollbackStart > clinicStart);
  const clinic = workflow.slice(clinicStart, rollbackStart);
  for (const forbidden of [
    "secrets.PONTO_PILOT_LOGIN",
    "secrets.PONTO_PILOT_PASSWORD",
    "secrets.CF_ACCESS_CLIENT_ID",
    "secrets.CF_ACCESS_CLIENT_SECRET",
    "secrets.PONTO_PILOT_RUNNER_ENCRYPTION_PRIVATE_KEY_PEM",
    "secrets.PONTO_IDEMPOTENCY_KEY",
    "secrets.PONTO_ROOT_ATTESTATION_KEY_SHARED",
    "PONTO_PILOT_RUNNER_ENCRYPTION_PRIVATE_KEY_PEM:",
  ]) assert.equal(clinic.includes(forbidden), false, `clinic job hydrates forbidden custody: ${forbidden}`);
  for (const required of [
    "PONTO_SLO_PREFLIGHT_ARTIFACT_ID:",
    "PONTO_SLO_PREFLIGHT_ARTIFACT_DIGEST:",
    "persist-credentials: false",
    "merge-multiple: true",
    "ponto-jit-credential-attestation.mjs cleanup",
    "if: ${{ always() }}",
  ]) assert.equal(clinic.includes(required), true, `clinic job misses JIT guard: ${required}`);
  assert.equal(
    clinic.includes("runs-on: ${{ fromJSON(needs.control-plane-preflight.outputs.runner_labels_json"),
    true,
    "clinic job must use the exact selector emitted by the protected inventory attestation",
  );
});
