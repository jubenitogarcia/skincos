import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = name => fs.readFileSync(
  new URL(`../workflows/${name}`, import.meta.url),
  "utf8",
);

test("coordinator refuses repository fallback for both environment-owned roots before mutation", () => {
  const source = workflow("ponto-progressive-release.yml");
  const preflight = source.slice(
    source.indexOf("Preflight selected environment secret-root custody"),
    source.indexOf("Preflight production custody"),
  );
  assert.match(preflight, /PONTO_PROFILE_DATA_KEY/);
  assert.match(preflight, /PONTO_IDEMPOTENCY_KEY/);
  assert.match(preflight, /repository fallback is refused/);
  assert.ok(
    source.indexOf("Preflight selected environment secret-root custody")
      < source.indexOf("Put Ponto in maintenance before staging or live mutation"),
  );
});

test("Pages derivation and Timekeeping upload independently attest environment custody", () => {
  const pages = workflow("cloudflare-pages-sync-ponto.yml");
  const workers = workflow("cloudflare-workers-sync-ponto-secrets.yml");
  const timekeeping = workflow("deploy-timekeeping.yml");
  assert.match(
    pages,
    /Attest environment-owned derivation root[\s\S]*PONTO_IDEMPOTENCY_KEY[\s\S]*repository fallback is refused[\s\S]*Derive and provision environment-scoped Ponto Pages keys/,
  );
  assert.match(
    workers,
    /Verify selected environment root custody scopes[\s\S]*PONTO_PROFILE_DATA_KEY[\s\S]*PONTO_IDEMPOTENCY_KEY[\s\S]*repository fallback is refused[\s\S]*Attest environment-owned Timekeeping roots/,
  );
  const workerRootStep = workers.slice(
    workers.indexOf("Attest environment-owned Timekeeping roots"),
    workers.indexOf("Attest remote secret names"),
  );
  assert.match(workerRootStep, /PONTO_ROOT_ATTESTATION_KEY_SHARED/);
  assert.doesNotMatch(workerRootStep, /\b(?:gh|curl|npx)\s/);
  assert.match(
    timekeeping,
    /PONTO_PROFILE_DATA_KEY[\s\S]*PONTO_IDEMPOTENCY_KEY[\s\S]*repository fallback is refused/,
  );
  const timekeepingRootStep = timekeeping.slice(
    timekeeping.indexOf("Compare live root custody immediately before mutation"),
    timekeeping.indexOf("Apply additive Timekeeping migrations"),
  );
  assert.match(timekeepingRootStep, /PONTO_ROOT_ATTESTATION_KEY_SHARED/);
  assert.doesNotMatch(timekeepingRootStep, /\b(?:gh|curl|npx|unzip)\s/);
});
