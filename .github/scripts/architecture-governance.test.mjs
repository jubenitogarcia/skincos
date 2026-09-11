import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildArchitectureGovernancePlan,
  buildFullArchitectureGovernancePlan,
} from "./architecture-governance.mjs";

const workflow = fs.readFileSync(
  path.resolve(import.meta.dirname, "../workflows/architecture-governance.yml"),
  "utf8",
);

function report(files, risk = "medium", affectedSurfaces = []) {
  return {
    schemaVersion: 1,
    risk,
    affectedSurfaces,
    pathClassifications: files.map((file) => ({ file })),
  };
}

test("isolated CRM changes keep minimum boundaries and skip unrelated domain suites", () => {
  const plan = buildArchitectureGovernancePlan(report(["crm/console/Customers.tsx"], "medium", ["timekeeping"]));

  assert.deepEqual(plan.jobs, ["minimum"]);
  assert.equal(plan.globalClosure, false);
  assert.equal(plan.full, false);
  for (const domain of ["ponto", "influencer", "cloudflare", "staging", "finance"]) {
    assert.equal(plan.jobs.includes(domain), false, `${domain} must remain skipped for isolated CRM`);
  }
});

test("architecture and shared contract changes retain global closure and only relevant domain gates", () => {
  const architecture = buildArchitectureGovernancePlan(report(["docs/architecture/module-dependency-graph.mmd"]));
  assert.equal(architecture.globalClosure, true);
  assert.deepEqual(architecture.jobs, ["minimum", "global"]);

  const financeContract = buildArchitectureGovernancePlan(report(["shared/finance-contracts/index.js"]));
  assert.equal(financeContract.globalClosure, true);
  assert.equal(financeContract.jobs.includes("global"), true);
  assert.equal(financeContract.jobs.includes("finance"), true);
  assert.equal(financeContract.jobs.includes("ponto"), false);
  assert.equal(financeContract.jobs.includes("influencer"), false);
});

test("Finance UI and its remote CRM host select the Finance governance gate", () => {
  for (const file of ["finance/ui/src/entry.tsx", "crm/console/modules/RemoteFinanceModule.tsx"]) {
    const plan = buildArchitectureGovernancePlan(report([file]));
    assert.equal(plan.jobs.includes("finance"), true, `${file} must select the Finance gate`);
  }
});

test("unknown paths fail closed into global closure and every domain gate", () => {
  const plan = buildArchitectureGovernancePlan(report(["new-root-runtime/input.bin"]));

  assert.equal(plan.failClosed, true);
  assert.equal(plan.globalClosure, true);
  assert.equal(plan.full, true);
  assert.ok(plan.unknownFiles.includes("new-root-runtime/input.bin"));
  for (const domain of ["ponto", "influencer", "cloudflare", "staging", "finance"]) {
    assert.equal(plan.jobs.includes(domain), true, `${domain} must be selected fail-closed`);
  }
});

test("high and critical classifier outcomes force the complete matrix", () => {
  for (const risk of ["high", "critical"]) {
    const plan = buildArchitectureGovernancePlan(report(["crm/console/Customers.tsx"], risk));
    assert.equal(plan.full, true);
    assert.deepEqual(plan.jobs, ["minimum", "global", "ponto", "influencer", "cloudflare", "staging", "finance"]);
  }
});

test("manual and scheduled execution use the complete matrix without a change report", () => {
  const plan = buildFullArchitectureGovernancePlan("scheduled execution");
  assert.equal(plan.full, true);
  assert.deepEqual(plan.jobs, ["minimum", "global", "ponto", "influencer", "cloudflare", "staging", "finance"]);
});

test("routine planning resolves an immutable bounded diff without a full-history checkout", () => {
  assert.match(workflow, /fetch-depth:\s+2/);
  assert.match(workflow, /codex-bounded-diff\.mjs/);
  assert.match(workflow, /--base \"\$BASE_SHA\" --head \"\$HEAD_SHA\"/);
  assert.doesNotMatch(workflow, /fetch-depth:\s+0/);
});

test("Cloudflare governance validation is explicitly non-publishing", () => {
  const policy = JSON.parse(fs.readFileSync(
    path.resolve(import.meta.dirname, "../governance/cloudflare-single-writer-policy.json"),
    "utf8",
  ));
  const entry = policy.nonPublishingWorkflows.find(
    (candidate) => candidate.workflow === ".github/workflows/architecture-governance.yml",
  );
  assert.ok(entry);
  assert.deepEqual(entry.requiredMarkers, [
    "validate-cloudflare-single-writer.mjs",
    "validate-cloudflare-single-writer.test.mjs",
  ]);
});
