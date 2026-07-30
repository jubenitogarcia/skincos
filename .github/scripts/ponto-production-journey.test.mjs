import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = path.resolve(".github/scripts/ponto-production-journey.mjs");
const sha = "a".repeat(40);
const uuid = "11111111-1111-4111-8111-111111111111";

const runMockJourney = (mode) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-production-journey-"));
  const preload = path.join(directory, "fetch-mock.mjs");
  const report = path.join(directory, "report.json");
  const events = path.join(directory, "events.jsonl");
  fs.writeFileSync(preload, String.raw`
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
    if (mode !== "success") return response(500, { ok: false, error: "AUTH_CHECK_FAILED" });
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
    return response(200, { ok: true, linked: true }, releaseHeaders);
  }
  return response(404, { ok: false, error: "NOT_FOUND" });
};
`, { mode: 0o600 });
  const result = spawnSync(process.execPath, ["--import", preload, script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PONTO_JOURNEY_MOCK_MODE: mode,
      PONTO_JOURNEY_MOCK_EVENTS: events,
      PONTO_SLO_TEST_MODE: "true",
      PONTO_SLO_TEST_WINDOW_SECONDS: "0",
      PONTO_SLO_TEST_CADENCE_SECONDS: "0",
      PONTO_SLO_TEST_MINIMUM_SAMPLES: "1",
      PONTO_RELEASE_SHA: sha,
      PONTO_RELEASE_STAGE: "production",
      PONTO_RELEASE_SLO_REPORT: report,
      PONTO_RELEASE_CRM_URL: "https://crm.test",
      PONTO_RELEASE_IDENTITY_URL: "https://identity.test",
      PONTO_EXPECTED_CORE_VERSION_ID: uuid,
      PONTO_EXPECTED_TIMEKEEPING_VERSION_ID: uuid,
      PONTO_EXPECTED_IDENTITY_VERSION_ID: uuid,
      PONTO_EXPECTED_PAGES_DEPLOYMENT_ID: uuid,
      PONTO_PILOT_LOGIN: "pilot@example.test",
      PONTO_PILOT_PASSWORD: "not-a-real-password",
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
  ]) assert.ok(source.includes(required), `missing governed assertion: ${required}`);
  assert.ok(!source.includes("Cloudflare-Workers-Version-Overrides"), "public Identity version override must never be sent");
  assert.ok(!source.includes("cloudflare-workers-version-overrides"), "public Identity version override must never be sent");
});
