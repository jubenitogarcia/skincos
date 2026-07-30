import assert from "node:assert/strict";
import test from "node:test";
import { rollbackPagesWithReconciliation } from "./ponto-pages-rollback.mjs";

const accountId = "1".repeat(32);
const candidateId = "11111111-1111-4111-8111-111111111111";
const incumbentId = "22222222-2222-4222-8222-222222222222";
const restoredId = "33333333-3333-4333-8333-333333333333";
const candidateCommit = "a".repeat(40);
const incumbentCommit = "b".repeat(40);
const project = "skincos";
const branch = "main";
const alias = "crm.skincos.com.br";

const deployment = (id, commit, createdOn) => ({
  id,
  project_name: project,
  environment: "production",
  created_on: createdOn,
  deployment_trigger: { metadata: { branch, commit_hash: commit } },
  latest_stage: {
    name: "deploy",
    status: "success",
    ended_on: "2026-07-30T00:01:00Z",
  },
  is_skipped: false,
  aliases: [`https://${alias}`],
});

function harness({ firstPostApplies }) {
  const deployments = new Map([
    [candidateId, deployment(candidateId, candidateCommit, "2026-07-30T00:02:00Z")],
    [incumbentId, deployment(incumbentId, incumbentCommit, "2026-07-29T00:02:00Z")],
  ]);
  let latestId = candidateId;
  let postCount = 0;
  const request = async (pathname, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (method === "POST") {
      postCount += 1;
      if (postCount === 1 && !firstPostApplies) {
        throw new Error("transport failed before apply");
      }
      deployments.set(
        restoredId,
        deployment(restoredId, incumbentCommit, "2026-07-30T00:03:00Z"),
      );
      latestId = restoredId;
      if (postCount === 1 && firstPostApplies) {
        throw new Error("transport failed after server apply");
      }
      return { success: true, result: { id: restoredId } };
    }
    if (pathname.includes("?env=production")) {
      return {
        success: true,
        result: [...deployments.values()],
      };
    }
    const id = pathname.split("/").at(-1);
    const result = deployments.get(id);
    if (!result) throw new Error(`unknown deployment ${id}`);
    if (id === latestId) return { success: true, result };
    return { success: true, result };
  };
  return {
    request,
    postCount: () => postCount,
  };
}

const run = (fixture, persisted, attempts = []) => rollbackPagesWithReconciliation({
  request: fixture.request,
  accountId,
  project,
  branch,
  alias,
  candidateDeploymentId: candidateId,
  candidateCommitSha: candidateCommit,
  incumbentDeploymentId: incumbentId,
  persistAttempt: async () => attempts.push("attempted"),
  persistCreatedId: async (id, source) => persisted.push({ id, source }),
  timeoutMs: 20,
  pollMs: 0,
});

test("applied-then-thrown Pages rollback reconciles the exact incumbent without duplicate retry", async () => {
  const fixture = harness({ firstPostApplies: true });
  const persisted = [];
  const attempts = [];
  const result = await run(fixture, persisted, attempts);
  assert.equal(fixture.postCount(), 1);
  assert.deepEqual(attempts, ["attempted"]);
  assert.equal(result.activeDeploymentId, restoredId);
  assert.equal(result.incumbentCommitSha, incumbentCommit);
  assert.equal(result.mutationPerformed, true);
  assert.equal(result.disposition, "restored-after-indeterminate-response");
  assert.deepEqual(persisted, [{
    id: restoredId,
    source: "reconciled-indeterminate-response",
  }]);
});

test("indeterminate transport failure never retries while the exact candidate remains observed", async () => {
  const fixture = harness({ firstPostApplies: false });
  const persisted = [];
  const attempts = [];
  await assert.rejects(
    run(fixture, persisted, attempts),
    /response was indeterminate.*retry is refused/,
  );
  assert.equal(fixture.postCount(), 1);
  assert.deepEqual(attempts, ["attempted"]);
  assert.deepEqual(persisted, []);
});

test("a durable prior attempt reconciles an exact restored clone without another POST", async () => {
  const fixture = harness({ firstPostApplies: true });
  await assert.rejects(
    fixture.request(`/accounts/${accountId}/pages/projects/${project}/deployments/${incumbentId}/rollback`, {
      method: "POST",
      body: "{}",
    }),
    /after server apply/,
  );
  const persisted = [];
  const result = await rollbackPagesWithReconciliation({
    request: fixture.request,
    accountId,
    project,
    branch,
    alias,
    candidateDeploymentId: candidateId,
    candidateCommitSha: candidateCommit,
    incumbentDeploymentId: incumbentId,
    mutationAllowed: false,
    persistCreatedId: async (id, source) => persisted.push({ id, source }),
    timeoutMs: 20,
    pollMs: 0,
  });
  assert.equal(fixture.postCount(), 1);
  assert.equal(result.activeDeploymentId, restoredId);
  assert.equal(result.attempts, 0);
  assert.equal(result.disposition, "durable-intent-reconciled");
  assert.deepEqual(persisted, [{
    id: restoredId,
    source: "reconciled-indeterminate-response",
  }]);
});

test("a durable created ID waits for the strict terminal Pages contract without POST", async () => {
  const incumbent = deployment(incumbentId, incumbentCommit, "2026-07-29T00:02:00Z");
  const restored = deployment(restoredId, incumbentCommit, "2026-07-30T00:03:00Z");
  restored.latest_stage.status = "active";
  restored.latest_stage.ended_on = null;
  let restoredReads = 0;
  let postCount = 0;
  const request = async (pathname, init = {}) => {
    if (String(init.method || "GET").toUpperCase() === "POST") {
      postCount += 1;
      throw new Error("POST is forbidden");
    }
    if (pathname.includes("?env=production")) {
      return { success: true, result: [restored, incumbent] };
    }
    const id = pathname.split("/").at(-1);
    if (id === incumbentId) return { success: true, result: incumbent };
    if (id === restoredId) {
      restoredReads += 1;
      if (restoredReads >= 2) {
        restored.latest_stage.status = "success";
        restored.latest_stage.ended_on = "2026-07-30T00:04:00Z";
      }
      return { success: true, result: restored };
    }
    throw new Error(`unknown deployment ${id}`);
  };
  const result = await rollbackPagesWithReconciliation({
    request,
    accountId,
    project,
    branch,
    alias,
    candidateDeploymentId: candidateId,
    candidateCommitSha: candidateCommit,
    incumbentDeploymentId: incumbentId,
    mutationAllowed: false,
    knownRestoredDeploymentId: restoredId,
    timeoutMs: 100,
    pollMs: 0,
  });
  assert.equal(result.activeDeploymentId, restoredId);
  assert.equal(result.disposition, "durable-intent-restored");
  assert.equal(postCount, 0);
});
