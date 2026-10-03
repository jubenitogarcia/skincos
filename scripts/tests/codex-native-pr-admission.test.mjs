import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAdmission, pollAdmission, coordinationCustody, prepareMainMirror } from "../codex-native-pr-admission.mjs";
import { latestContexts, statusNeeded, workflowEvents } from "../codex-native-pr-admission-contract.mjs";

const mainSha = "1".repeat(40), headSha = "2".repeat(40), programSha = "3".repeat(40);
const pull = () => ({ number: 42, state: "open", draft: false, base: { ref: "main", sha: mainSha }, head: { sha: headSha, repo: { full_name: "jubenitogarcia/skincos" } } });
const evaluation = (overrides = {}) => ({ pullNumber: 42, mainSha, headSha, token: "synthetic-only", candidateImpl: async () => ({}), evaluateImpl: async () => ({ passed: true }), readIdentity: async () => pull(), readMain: async () => ({ sha: mainSha }), ...overrides });

test("exact identity receives success only after coordinator admission", async () => {
  const result = await evaluateAdmission(evaluation());
  assert.equal(result.publish, true); assert.equal(result.desired.state, "success");
  const denied = await evaluateAdmission(evaluation({ evaluateImpl: async () => ({ passed: false, reason: "resource-lease-held" }) }));
  assert.equal(denied.desired.state, "pending");
  const failed = await evaluateAdmission(evaluation({ candidateImpl: async () => { throw new Error("synthetic failure"); } }));
  assert.equal(failed.desired.state, "failure");
  assert.doesNotMatch(JSON.stringify(failed), /synthetic failure/);
});

test("head/base/main race and forks never receive a false success", async () => {
  for (const mutate of [(row) => { row.head.sha = "4".repeat(40); }, (row) => { row.state = "closed"; },
    (row) => { row.draft = true; }, (row) => { row.head.repo.full_name = "fork/skincos"; }]) {
    const row = pull(); mutate(row);
    assert.equal((await evaluateAdmission(evaluation({ readIdentity: async () => row }))).publish, false);
  }
  assert.equal((await evaluateAdmission(evaluation({ readMain: async () => ({ sha: "4".repeat(40) }) }))).publish, false);
  const stale = pull(); stale.base.sha = "4".repeat(40);
  const result = await evaluateAdmission(evaluation({ readIdentity: async () => stale }));
  assert.equal(result.publish, true); assert.equal(result.desired.state, "failure");
});

test("poller publishes only the two fixed statuses and never merges", async () => {
  const writes = [];
  const api = async (suffix, options) => {
    if (options?.method === "POST") { writes.push({ suffix, body: JSON.parse(options.body) }); return {}; }
    if (suffix.startsWith("/pulls?")) return [pull(), { ...pull(), draft: true }];
    if (suffix === "/pulls/42") return pull();
    if (suffix === "/commits/main") return { sha: mainSha };
    if (suffix.endsWith("statuses?per_page=100")) return [];
    throw new Error(`Unexpected synthetic route ${suffix}`);
  };
  const summary = await pollAdmission({ mainSha, programSha, token: "synthetic-only", api, appBotLogin: "native[bot]", write: true,
    candidateImpl: async () => ({}), evaluateImpl: async () => ({ passed: true }) });
  assert.equal(summary.inspected, 1); assert.equal(summary.skipped, 1); assert.equal(summary.published, 2);
  assert.deepEqual(writes.map((row) => row.body.context), ["global-merge-authority", "skincos-integration-gate"]);
  assert.deepEqual(writes.map((row) => row.body.state), ["failure", "success"]);
  assert.ok(writes.every((row) => row.suffix === `/statuses/${headSha}`));
  writes.length = 0;
  await pollAdmission({ mainSha, programSha, token: "synthetic-only", api, write: false, candidateImpl: async () => ({}), evaluateImpl: async () => ({ passed: true }) });
  assert.equal(writes.length, 0);
});

test("only the same native bot's short lived legitimate merge success is preserved", () => {
  const now = Date.now();
  const desired = { context: "global-merge-authority", state: "failure", description: "blocked", target_url: `https://github.com/jubenitogarcia/skincos/blob/${programSha}/docs/runbooks/native-pr-admission.md` };
  const current = { context: desired.context, state: "success", creator: { login: "native[bot]" }, updated_at: new Date(now - 60_000).toISOString(),
    target_url: `https://github.com/jubenitogarcia/skincos/blob/${programSha}/docs/runbooks/native-merge-authority.md` };
  assert.equal(statusNeeded(current, desired, { appBotLogin: "native[bot]", now }), false);
  for (const override of [{ creator: { login: "forged[bot]" } }, { updated_at: new Date(now - 180_000).toISOString() },
    { updated_at: new Date(now + 10_000).toISOString() }, { target_url: "https://example.com/native-merge/" }])
    assert.equal(statusNeeded({ ...current, ...override }, desired, { appBotLogin: "native[bot]", now }), true);
});

test("current statuses are deduplicated by timestamp and trusted writer", () => {
  const desired = { context: "skincos-integration-gate", state: "success", description: "ready", target_url: `https://github.com/jubenitogarcia/skincos/blob/${programSha}/docs/runbooks/native-pr-admission.md` };
  const current = { ...desired, creator: { login: "native[bot]" }, updated_at: "2026-09-30T12:00:00Z" };
  const statuses = latestContexts([{ ...current, state: "failure", updated_at: "2026-09-30T11:00:00Z" }, current]);
  assert.equal(statuses.get(desired.context).state, "success");
  assert.equal(statusNeeded(current, desired, { appBotLogin: "native[bot]" }), false);
  assert.equal(statusNeeded({ ...current, creator: { login: "forged" } }, desired, { appBotLogin: "native[bot]" }), true);
});

test("coordination custody parsing does not execute shell text or accept ambiguity", () => {
  assert.deepEqual(coordinationCustody(`SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET=${"a".repeat(32)}\n`), { secret: "a".repeat(32), keyId: "" });
  assert.equal(coordinationCustody(`SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY='${"b".repeat(32)}'\nSKINCOS_GLOBAL_COORDINATION_KEY_ID=v2\n`).keyId, "v2");
  assert.throws(() => coordinationCustody("export KEY=bad"), /syntax/);
  assert.throws(() => coordinationCustody("SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY=missing-id"), /incomplete/);
  assert.throws(() => coordinationCustody("KEY=a\nKEY=b"), /repeats/);
});

test("unsupported trigger syntax and nonnative state roots fail closed", () => {
  assert.deepEqual(workflowEvents("name: test\non:\n  workflow_dispatch:\npermissions: {}\n"), ["workflow_dispatch"]);
  assert.throws(() => workflowEvents("on: [push]\n"), /block-style/);
  assert.throws(() => prepareMainMirror(""), /private state/);
  assert.throws(() => prepareMainMirror("/mnt/c/unsafe"), /private state/);
});
