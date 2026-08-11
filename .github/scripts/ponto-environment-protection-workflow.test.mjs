import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = (name) => fs.readFileSync(
  new URL(`../workflows/${name}`, import.meta.url),
  "utf8",
);

test("coordinator and consumer attest live environment protection before authority", () => {
  const coordinator = workflow("ponto-progressive-release.yml");
  const issuerPreflight = coordinator.indexOf(
    "Attest single-operator Codex governance and protected environment before issuing any capability",
  );
  const issuerCustody = coordinator.indexOf(
    "Verify target-bound asymmetric child capability custody",
  );
  const firstMutationPreflight = coordinator.indexOf(
    "Refuse a latched Ponto emergency stop before issuing capabilities",
  );
  assert.ok(issuerPreflight >= 0);
  assert.ok(issuerPreflight < issuerCustody);
  assert.ok(issuerPreflight < firstMutationPreflight);
  assert.match(
    coordinator.slice(issuerPreflight, issuerCustody),
    /ponto-environment-protection\.mjs/,
  );

  const gate = workflow("ponto-orchestrator-gate.yml");
  const consumerPreflight = gate.indexOf(
    "Revalidate protected target environment before consuming authority",
  );
  const consume = gate.indexOf(
    "Validate, transition, and confirm the exact child-bound coordinator capability",
  );
  assert.ok(consumerPreflight >= 0);
  assert.ok(consumerPreflight < consume);
  const consumerScoped = gate.slice(consumerPreflight, consume);
  assert.match(consumerScoped, /deployment-branch-policies/);
  assert.match(gate, /secrets:\n\s+GH_TOKEN:\n\s+required: false/);
  assert.match(
    consumerScoped,
    /GH_TOKEN: \$\{\{ secrets\.GH_TOKEN != '' && secrets\.GH_TOKEN \|\| github\.token \}\}/,
  );
  assert.match(consumerScoped, /actions\/runs\/\$ORCHESTRATOR_RUN_ID/);
  assert.match(consumerScoped, /GITHUB_ACTOR="\$issuer_actor" node/);
  assert.match(gate, /deployments: read/);
});

test("coordinator initializes runner-only custody paths inside a step", () => {
  const coordinator = workflow("ponto-progressive-release.yml");
  const orchestrateStart = coordinator.indexOf("\n  orchestrate:");
  const stepsStart = coordinator.indexOf("\n    steps:", orchestrateStart);
  const initializationStart = coordinator.indexOf(
    "\n      - name: Initialize private release artifact directory",
    stepsStart,
  );
  const initializationEnd = coordinator.indexOf("\n      - name:", initializationStart + 1);
  const jobEnvironment = coordinator.slice(orchestrateStart, stepsStart);
  const initialization = coordinator.slice(
    initializationStart,
    initializationEnd === -1 ? coordinator.length : initializationEnd,
  );
  assert.doesNotMatch(jobEnvironment, /\$\{\{\s*runner\./);
  assert.match(
    initialization,
    /echo "PONTO_ORCHESTRATOR_COORDINATION_PROOF_FILE=\$RUNNER_TEMP\/ponto-release\/global-coordination-release-ponto\.json" >> "\$GITHUB_ENV"/,
  );
});

test("every governed caller grants read-only deployment metadata to the gate", () => {
  const callers = [
    "cloudflare-pages-sync-ponto.yml",
    "cloudflare-workers-sync-ponto-secrets.yml",
    "deploy-core-workers.yml",
    "deploy-crm-pages.yml",
    "deploy-timekeeping.yml",
    "module-availability.yml",
    "ponto-production-baseline.yml",
    "ponto-production-slo.yml",
    "ponto-staging-rollback-drill.yml",
    "timekeeping-staging-journey.yml",
  ];
  for (const name of callers) {
    const source = workflow(name);
    const gate = source.indexOf(
      "uses: ./.github/workflows/ponto-orchestrator-gate.yml",
    );
    assert.notEqual(gate, -1, name);
    assert.match(source.slice(Math.max(0, gate - 220), gate), /deployments: read/, name);
    assert.match(
      source.slice(gate, gate + 220),
      /secrets:\n\s+GH_TOKEN: \$\{\{ secrets\.GH_TOKEN \}\}/,
      name,
    );
  }
});

test("custody metadata consumers read every GitHub API page", () => {
  for (const name of [
    "cloudflare-pages-sync-ponto.yml",
    "cloudflare-workers-sync-ponto-secrets.yml",
    "deploy-timekeeping.yml",
  ]) {
    const source = workflow(name);
    assert.equal(
      (source.match(/gh api --paginate --slurp [^\n]+\/variables\?per_page=100/g) || []).length,
      2,
      name,
    );
    assert.match(source, /const entries = Array\.isArray\(payload\)/, name);
    assert.match(source, /payload\.flatMap\(page =>/, name);
  }
});

test("ordinary and watchdog rollback revalidate governance and use dedicated intent custody", () => {
  for (const name of [
    "ponto-progressive-release.yml",
    "ponto-release-watchdog.yml",
  ]) {
    const source = workflow(name);
    const rollback = source.lastIndexOf("\n  rollback:") >= 0
      ? source.lastIndexOf("\n  rollback:")
      : source.indexOf("\n  recovery-rollback:");
    const scoped = source.slice(rollback);
    const protection = scoped.indexOf("ponto-environment-protection.mjs");
    const mutation = scoped.indexOf("node .github/scripts/ponto-automatic-rollback.mjs");
    assert.ok(protection >= 0, name);
    assert.ok(protection < mutation, name);
    assert.match(
      scoped.slice(0, mutation),
      /PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY: \$\{\{ secrets\.PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY \}\}/,
      name,
    );
  }
});

test("staging cleanup does not dispatch a transition before release identity exists", () => {
  const source = workflow("ponto-progressive-release.yml");
  const cleanup = source.indexOf(
    "- name: Restore staging Ponto to maintenance after the journey",
  );
  assert.ok(cleanup >= 0);
  const cleanupBlock = source.slice(cleanup, source.indexOf("\n      - name:", cleanup + 1));
  assert.match(
    cleanupBlock,
    /if: \$\{\{ always\(\) && inputs\.stage == 'staging' && steps\.release_identity\.outcome == 'success' \}\}/,
  );
});

test("emergency broker environments allow only the implicit protected-branch rule", () => {
  const source = workflow("ponto-progressive-release.yml");
  const start = source.indexOf(
    "Require the single-operator no-review true-only emergency close path",
  );
  const end = source.indexOf("Preflight production custody", start);
  const scoped = source.slice(start, end);
  assert.match(scoped, /environment\?\.can_admins_bypass !== false/);
  assert.match(scoped, /protectionRules\.length !== 1/);
  assert.match(scoped, /protectionRules\[0\]\?\.type !== "branch_policy"/);
  assert.doesNotMatch(scoped, /protection_rules \|\| \[\]\)\.length !== 0/);
});
