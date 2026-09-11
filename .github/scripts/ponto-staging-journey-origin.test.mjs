import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const journeyScript = path.join(repositoryRoot, "crm", "console", "scripts", "ponto-staging-journey.cjs");

function validateOrigin({ origin, pagesSurface } = {}) {
  const env = { ...process.env };
  for (const key of [
    "PONTO_STAGING_CRM_URL",
    "PONTO_STAGING_PAGES_SURFACE",
    "PONTO_STAGING_EXPECTED_RELEASE_SHA",
    "PONTO_STAGING_EXPECTED_TIMEKEEPING_VERSION_ID",
    "PONTO_STAGING_FIXTURES_FILE",
    "PONTO_STAGING_REPORT_FILE",
  ]) delete env[key];
  env.PONTO_STAGING_CRM_URL = origin;
  if (pagesSurface !== undefined) env.PONTO_STAGING_PAGES_SURFACE = pagesSurface;
  return spawnSync(process.execPath, [journeyScript], {
    cwd: repositoryRoot,
    env,
    encoding: "utf8",
  });
}

function assertOriginAccepted(result) {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /PONTO_STAGING_EXPECTED_RELEASE_SHA must be a full lowercase release SHA/);
}

function assertOriginRejected(result, message) {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, message);
}

test("legacy immutable Pages candidates remain accepted by default", () => {
  assertOriginAccepted(validateOrigin({
    origin: "https://candidate.skincos-staging.pages.dev/",
  }));
});

test("the dedicated Ponto Pages origin requires its explicit surface selector", () => {
  assertOriginRejected(
    validateOrigin({ origin: "https://skincos-ponto-staging.pages.dev/" }),
    /PONTO_STAGING_CRM_URL must be an immutable skincos-staging\.pages\.dev HTTPS origin/,
  );
  assertOriginAccepted(validateOrigin({
    origin: "https://skincos-ponto-staging.pages.dev/",
    pagesSurface: "dedicated-ponto-pages",
  }));
});

test("the dedicated selector rejects other or malformed origins", () => {
  for (const origin of [
    "https://candidate.skincos-staging.pages.dev/",
    "https://skincos-ponto-staging.pages.dev.invalid/",
    "https://skincos-ponto-staging.pages.dev/not-an-origin",
    "https://user@skincos-ponto-staging.pages.dev/",
  ]) {
    assertOriginRejected(
      validateOrigin({ origin, pagesSurface: "dedicated-ponto-pages" }),
      /PONTO_STAGING_CRM_URL must be (the exact dedicated Ponto Pages staging origin|an immutable skincos-staging\.pages\.dev HTTPS origin)/,
    );
  }
  assertOriginRejected(
    validateOrigin({
      origin: "https://skincos-ponto-staging.pages.dev/",
      pagesSurface: "any-pages-origin",
    }),
    /PONTO_STAGING_PAGES_SURFACE must be either legacy or dedicated-ponto-pages/,
  );
});
