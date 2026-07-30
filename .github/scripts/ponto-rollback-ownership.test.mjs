import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  attestPagesIncumbentState,
  classifyPagesRollbackOwnership,
  classifyWorkerPublisherCompensationOwnership,
  classifyWorkerRollbackOwnership,
} from "./ponto-rollback-ownership.mjs";

const candidate = "11111111-1111-4111-8111-111111111111";
const incumbent = "22222222-2222-4222-8222-222222222222";
const deployment = "33333333-3333-4333-8333-333333333333";
const item = {
  candidateVersionId: candidate,
  incumbentVersionId: incumbent,
  deploymentId: deployment,
};
const worker = (versions, id = deployment) => ({ id, versions });

test("owns exact staging and production candidate-only deployments", () => {
  const current = worker([{ version_id: candidate, percentage: 100 }]);
  assert.equal(classifyWorkerRollbackOwnership(current, item, "staging"), "candidate-owned");
  assert.equal(classifyWorkerRollbackOwnership(current, item, "production"), "candidate-owned");
});

test("owns exact route-isolated pilot/canary deployment including its zero-percent candidate", () => {
  const current = worker([
    { version_id: incumbent, percentage: 100 },
    { version_id: candidate, percentage: 0 },
  ]);
  assert.equal(classifyWorkerRollbackOwnership(current, item, "pilot"), "candidate-owned");
  assert.equal(classifyWorkerRollbackOwnership(current, item, "canary"), "candidate-owned");
});

test("distinguishes an untouched incumbent from conflicting live drift", () => {
  assert.equal(
    classifyWorkerRollbackOwnership(worker([{ version_id: incumbent, percentage: 100 }], ""), item, "production"),
    "already-incumbent",
  );
  assert.equal(
    classifyWorkerRollbackOwnership(
      worker([{ version_id: "44444444-4444-4444-8444-444444444444", percentage: 100 }]),
      item,
      "production",
    ),
    "ownership-conflict",
  );
  assert.equal(
    classifyWorkerRollbackOwnership(worker([{ version_id: candidate, percentage: 100 }], "55555555-5555-4555-8555-555555555555"), item, "production"),
    "ownership-conflict",
  );
});

test("publisher compensation owns only its exact active deployment and version set", () => {
  assert.equal(
    classifyWorkerPublisherCompensationOwnership(
      worker([{ version_id: candidate, percentage: 100 }]),
      item,
      "production",
    ),
    "candidate-owned",
  );
  assert.equal(
    classifyWorkerPublisherCompensationOwnership(
      worker([{ version_id: candidate, percentage: 100 }], "55555555-5555-4555-8555-555555555555"),
      item,
      "production",
    ),
    "ownership-conflict",
  );
  assert.equal(
    classifyWorkerPublisherCompensationOwnership(
      worker([
        { version_id: incumbent, percentage: 100 },
        { version_id: candidate, percentage: 0 },
      ]),
      item,
      "pilot",
    ),
    "candidate-owned",
  );
});

test("publisher compensation is a no-op for an incumbent and refuses ambiguous or rollback ownership", () => {
  assert.equal(
    classifyWorkerPublisherCompensationOwnership(
      worker([{ version_id: incumbent, percentage: 100 }], ""),
      { ...item, deploymentId: "" },
      "production",
    ),
    "already-incumbent",
  );
  assert.equal(
    classifyWorkerPublisherCompensationOwnership(
      worker([{ version_id: candidate, percentage: 100 }]),
      { ...item, deploymentId: "" },
      "production",
    ),
    "ownership-conflict",
  );
  assert.equal(
    classifyWorkerPublisherCompensationOwnership(
      worker([{ version_id: candidate, percentage: 100 }]),
      item,
      "rollback",
    ),
    "ownership-conflict",
  );
});

const pages = id => ({
  success: true,
  result: [{ id, environment: "production", created_on: "2026-07-30T00:00:00Z" }],
});

test("Pages rollback mutates only its exact current candidate", () => {
  const restored = "55555555-5555-4555-8555-555555555555";
  const pagesItem = {
    candidateDeploymentId: candidate,
    incumbentDeploymentId: incumbent,
    restoredDeploymentId: restored,
  };
  assert.equal(classifyPagesRollbackOwnership(pages(candidate), pagesItem), "candidate-owned");
  assert.equal(classifyPagesRollbackOwnership(pages(incumbent), pagesItem), "already-incumbent");
  assert.equal(classifyPagesRollbackOwnership(pages(restored), pagesItem), "already-restored");
  assert.equal(
    classifyPagesRollbackOwnership(pages("44444444-4444-4444-8444-444444444444"), pagesItem),
    "ownership-conflict",
  );
});

test("Pages already-restored clone must attest the exact incumbent commit and public alias", () => {
  const restored = "55555555-5555-4555-8555-555555555555";
  const commit = "a".repeat(40);
  const deployment = (id, commitHash) => ({
    id,
    project_name: "skincos-staging",
    environment: "production",
    deployment_trigger: { metadata: { branch: "staging", commit_hash: commitHash } },
    latest_stage: { status: "success" },
    aliases: ["https://crm-staging.skincos.com.br"],
  });
  const args = {
    incumbentDeploymentId: incumbent,
    activeDeploymentId: restored,
    project: "skincos-staging",
    branch: "staging",
    alias: "crm-staging.skincos.com.br",
  };
  assert.deepEqual(
    attestPagesIncumbentState(deployment(incumbent, commit), deployment(restored, commit), args),
    { passed: true, sourceCommitSha: commit },
  );
  assert.equal(
    attestPagesIncumbentState(deployment(incumbent, commit), deployment(restored, "b".repeat(40)), args).passed,
    false,
  );
  assert.equal(
    attestPagesIncumbentState(
      deployment(incumbent, commit),
      { ...deployment(restored, commit), aliases: [] },
      args,
    ).passed,
    false,
  );
});

test("automatic rollback refuses every mutation until child reconciliation passed", () => {
  const source = fs.readFileSync(
    new URL("./ponto-automatic-rollback.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const rollbackPermitted = childReconciliationPassed && drillOwnershipResolved;[\s\S]*if \(!rollbackPermitted\) \{[\s\S]*rollback-blocked-by-custody-reconciliation/,
  );
  assert.match(
    source,
    /if \(plan\.crmPages\) \{[\s\S]*if \(!rollbackPermitted\) \{[\s\S]*rollback-blocked-by-custody-reconciliation/,
  );
});

test("all Worker publisher failure handlers require a mutation sentinel and exact ownership classification", () => {
  const timekeeping = fs.readFileSync(
    new URL("../workflows/deploy-timekeeping.yml", import.meta.url),
    "utf8",
  );
  const core = fs.readFileSync(
    new URL("../workflows/deploy-core-workers.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    timekeeping,
    /Roll back this publisher after a failed mutation[\s\S]*timekeeping-mutation-started[\s\S]*classify-worker-compensation[\s\S]*ownership-conflict/,
  );
  assert.match(
    core,
    /Roll back Core after a failed mutation[\s\S]*core-mutation-started[\s\S]*classify-worker-compensation[\s\S]*ownership-conflict/,
  );
  assert.match(
    core,
    /Roll back Identity after a failed mutation[\s\S]*identity-mutation-started[\s\S]*classify-worker-compensation[\s\S]*ownership-conflict/,
  );
  assert.match(
    core,
    /Restore staging Identity incumbent after failure or cancellation[\s\S]*identity-mutation-started[\s\S]*classify-worker-compensation[\s\S]*ownership-conflict/,
  );
  assert.match(
    core,
    /Restore Ponto Core staging incumbent after failure or cancellation[\s\S]*core-staging-mutation-started[\s\S]*classify-worker-compensation[\s\S]*ownership-conflict/,
  );
});
