import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("release pilot runner preflight keeps its callback inside the YAML run block", () => {
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
  assert.match(
    step,
    /const matching = runners\.filter\(\(runner\) => \{\r?\n            const labels = \(runner\.labels \|\| \[\]\)\.map\(item => String\(item\?\.name \|\| ""\)\);\r?\n            const normalizedLabels = new Set\(labels\.map\(label => label\.toLowerCase\(\)\)\);\r?\n            return labels\.length === requiredLabels\.length\r?\n              && requiredLabels\.every\(label => normalizedLabels\.has\(label\.toLowerCase\(\)\)\);\r?\n          \}\);/,
  );
});

test("release pilot runner preflight is syntactically valid Bash", () => {
  const source = workflow("ponto-progressive-release.yml");
  const start = source.indexOf(
    "- name: Preflight production custody, approved cohort, and online pilot runner",
  );
  const end = source.indexOf(
    "- name: Attest unconditional edge blocks before any candidate mutation",
    start,
  );
  const step = source.slice(start, end);
  const run = step.match(/        run: \|\r?\n([\s\S]*)$/)?.[1];
  assert.ok(run, "pilot preflight run block must exist");
  const shell = run.split(/\r?\n/).map(line => line.slice(10)).join("\n");
  const result = spawnSync("bash", ["-n"], { encoding: "utf8", input: shell });
  assert.equal(result.status, 0, result.stderr);
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

test("Pages root derivation passes private paths through explicit environment variables", () => {
  const source = workflow("cloudflare-pages-sync-ponto.yml");
  const start = source.indexOf("- name: Derive and provision environment-scoped Ponto Pages keys");
  const end = source.indexOf("- name: Upload sanitised Pages secret attestation", start);
  const step = source.slice(start, end);
  const rootStart = source.indexOf("node --input-type=module - <<'NODE'", start);
  const rootEnd = source.indexOf("NODE\n          unset PONTO_ROOT_CUSTODY_FILE", rootStart);
  const rootStep = source.slice(rootStart, rootEnd);
  assert.ok(start >= 0 && end > start);
  assert.ok(rootStart >= start && rootEnd > rootStart);
  assert.match(step, /export PONTO_ROOT_CUSTODY_FILE=/);
  assert.match(step, /export PONTO_STAGING_EVIDENCE_FILE=/);
  assert.match(step, /export PONTO_DERIVED_SECRET_FILE=/);
  assert.match(rootStep, /fs\.readFileSync\(process\.env\.PONTO_ROOT_CUSTODY_FILE/);
  assert.match(rootStep, /fs\.readFileSync\(process\.env\.PONTO_STAGING_EVIDENCE_FILE/);
  assert.match(rootStep, /fs\.writeFileSync\(\s*process\.env\.PONTO_DERIVED_SECRET_FILE/);
  assert.doesNotMatch(rootStep, /process\.argv\[(?:2|3|4)\]/);
  assert.match(step, /unset PONTO_ROOT_CUSTODY_FILE PONTO_STAGING_EVIDENCE_FILE PONTO_DERIVED_SECRET_FILE/);
  assert.match(step, /unset PONTO_ROOT_ATTESTATION_KEY_SHARED PONTO_IDEMPOTENCY_KEY/);
});

test("Ponto REST run provenance accepts canonical parent or immutable release path representations", () => {
  for (const name of [
    "cloudflare-pages-sync-ponto.yml",
    "deploy-timekeeping.yml",
    "ponto-production-baseline.yml",
  ]) {
    const source = workflow(name);
    const acceptsMainPath = /\[workflow\.path, `\$\{workflow\.path\}@refs\/heads\/main`\]\.includes\(run\.path\)/.test(source)
      || /\[expectedPath, `\$\{expectedPath\}@refs\/heads\/main`\]\.includes\(run\.path\)/.test(source);
    const acceptsReleasePath = source.includes("refs/tags/skincos/release/ponto/")
      && source.includes("run.head_branch")
      && source.includes("run.head_sha");
    assert.ok(acceptsMainPath || acceptsReleasePath, `${name} must accept a canonical or immutable release REST path`);
  }
  assert.match(workflow("ponto-progressive-release.yml"), /\[workflow\.path, `\$\{workflow\.path\}@refs\/heads\/main`\]\.includes\(run\.path\)/);
});
