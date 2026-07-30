import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = name => fs.readFileSync(
  new URL(`../workflows/${name}`, import.meta.url),
  "utf8",
);

test("clinic runner inventory uses protected Administration read custody and never GITHUB_TOKEN", () => {
  const source = workflow("ponto-production-slo.yml");
  const start = source.indexOf(
    "- name: Attest the exact registered clinic runner before hydrating control-plane authority",
  );
  const end = source.indexOf(
    "- name: Attest exact Pages control plane without pilot or root custody",
    start,
  );
  const step = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(step, /GH_TOKEN: \$\{\{ secrets\.GH_TOKEN \}\}/);
  assert.doesNotMatch(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(step, /GH_TOKEN with Administration:read and Variables:read is required/);
  assert.match(step, /repos\/\$GITHUB_REPOSITORY\/actions\/runners\?per_page=100/);
  assert.match(step, /actions\/variables\/PONTO_PILOT_RUNNER_LABELS_JSON/);
  assert.match(step, /actions\/variables\/PONTO_PILOT_RUNNER_ENCRYPTION_PUBLIC_KEY_PEM/);
  assert.match(step, /environments\/production\/variables\?per_page=100/);
  assert.match(step, /Ponto pilot runner repository variables may not be shadowed by the production environment/);
  assert.match(step, /matching\.length !== 1/);
  assert.match(step, /unique online idle selector match/);
  assert.match(step, /runner_labels_json=/);
  assert.match(step, /runner_encryption_public_key_pem_base64=/);
  assert.doesNotMatch(step, /CONFIGURED_RUNNER_LABELS_JSON: \$\{\{ vars\./);
  assert.match(source, /runs-on: \$\{\{ fromJSON\(needs\.control-plane-preflight\.outputs\.runner_labels_json/);
  assert.doesNotMatch(source, /runs-on: \$\{\{ fromJSON\(vars\.PONTO_PILOT_RUNNER_LABELS_JSON/);
});

test("release preflight proves the repository-scoped runner selector used by runs-on", () => {
  const source = workflow("ponto-progressive-release.yml");
  const start = source.indexOf(
    "- name: Preflight production custody, approved cohort, and online pilot runner",
  );
  const end = source.indexOf(
    "- name: Attest unconditional edge blocks before any candidate mutation",
    start,
  );
  const step = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(step, /GH_TOKEN with Environments, Actions, Variables, and Administration read is required/);
  assert.match(step, /actions\/variables\/PONTO_PILOT_RUNNER_LABELS_JSON/);
  assert.match(step, /actions\/variables\/PONTO_PILOT_RUNNER_ENCRYPTION_PUBLIC_KEY_PEM/);
  assert.match(step, /environments\/production\/variables\?per_page=100/);
  assert.match(step, /Ponto pilot runner repository variables may not be shadowed by the production environment/);
  assert.match(step, /production one-shot pilot runner policy remains fail-closed/);
  assert.match(step, /matching\.length !== 1/);
  assert.match(step, /exact policy-pinned one-shot clinic runner is not uniquely online and idle/);
  assert.doesNotMatch(step, /REQUIRED_RUNNER_LABELS_JSON: \$\{\{ vars\./);
  assert.ok(
    source.indexOf("Preflight production custody, approved cohort, and online pilot runner")
      < source.indexOf("Open the approved live cohort or activate production"),
  );
});

test("coordinator refuses repository fallback for both environment-owned roots before mutation", () => {
  const source = workflow("ponto-progressive-release.yml");
  const preflight = source.slice(
    source.indexOf("Preflight selected environment secret-root custody"),
    source.indexOf("Preflight production custody"),
  );
  assert.match(preflight, /PONTO_PROFILE_DATA_KEY/);
  assert.match(preflight, /PONTO_IDEMPOTENCY_KEY/);
  assert.match(
    preflight,
    /for \(const name of \["PONTO_PROFILE_DATA_KEY", "PONTO_IDEMPOTENCY_KEY"\]\)[\s\S]*repositorySecrets\.has\(name\) \|\| !environmentSecrets\.has\(name\)/,
  );
  assert.match(
    preflight,
    /repositorySecrets\.has\("PONTO_ROOT_ATTESTATION_KEY_SHARED"\)[\s\S]*!stagingSecrets\.has\("PONTO_ROOT_ATTESTATION_KEY_SHARED"\)[\s\S]*!productionSecrets\.has\("PONTO_ROOT_ATTESTATION_KEY_SHARED"\)/,
  );
  assert.match(
    preflight,
    /repositorySecrets\.has\("PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY"\)[\s\S]*!stagingSecrets\.has\("PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY"\)[\s\S]*!productionSecrets\.has\("PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY"\)/,
  );
  assert.match(preflight, /repository fallback is refused/);
  assert.ok(
    source.indexOf("Preflight selected environment secret-root custody")
      < source.indexOf("Put Ponto in maintenance before staging or live mutation"),
  );
});

test("rollback observation has the Actions read permission required by the active-coordinator lease", () => {
  const source = workflow("ponto-production-slo.yml");
  const rollback = source.slice(source.indexOf("  rollback-observation:"));
  assert.match(rollback, /permissions:\s*\n\s*actions: read\s*\n\s*contents: read/);
  assert.match(rollback, /ponto-orchestrator-lease\.mjs assert-active/);
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
  for (const source of [pages, workers, timekeeping]) {
    assert.match(
      source,
      /repositorySecrets\.has\("PONTO_ROOT_ATTESTATION_KEY_SHARED"\)[\s\S]*!environmentSecrets\.has\("PONTO_ROOT_ATTESTATION_KEY_SHARED"\)/,
    );
    assert.doesNotMatch(
      source,
      /!repositorySecrets\.has\("PONTO_ROOT_ATTESTATION_KEY_SHARED"\)/,
    );
  }
});
