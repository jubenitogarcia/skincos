import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildPromotionEvidence,
  createTransactionJournal,
  runNativeTransaction,
  verifyPromotionEvidence,
} from "../token-vault-native-transaction.mjs";
import { sealedEvidencePath } from "../token-vault-native-evidence-custody.mjs";

const sourceSha = "a".repeat(40);
const sourceTree = "b".repeat(40);
const releaseInputDigest = "c".repeat(64);
const preview = { evidenceDigest: "d".repeat(64) };
const readiness = { evidenceDigest: "e".repeat(64), incumbentVersionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" };
const candidate = { versionId: "ffffffff-1111-2222-3333-444444444444", previewUrl: "https://ffffffff.example.workers.dev", seedFile: "/private/seed" };
const identity = { sourceSha, sourceTree, releaseInputDigest, dependencyClosureDigest: "f".repeat(64) };
const transactionId = "native-release-001";

async function fixture(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-tv-transaction-"));
  fs.chmodSync(base, 0o700);
  try {
    const journal = createTransactionJournal({ directory: path.join(base, "transactions", transactionId),
      transactionId, target: "staging", sourceSha,
      previewEvidenceDigest: preview.evidenceDigest, readinessEvidenceDigest: readiness.evidenceDigest });
    const calls = [];
    const lease = {
      acquire: async () => { calls.push("acquire"); },
      check: async () => { calls.push("check"); },
      release: async () => { calls.push("release"); },
    };
    const operations = {
      migrate: async (authorize) => { await authorize(); calls.push("migrate"); return { applied: [] }; },
      upload: async (authorize) => { await authorize(); calls.push("upload"); return candidate; },
      attest: async () => { calls.push("attest"); return "meta-ads-staging-seed:operation"; },
      reconcileSeed: async (_, authorize) => { await authorize(); calls.push("reconcile"); },
      seed: async (_, authorize, markAttempt) => {
        await authorize(); await markAttempt("meta-ads-staging-seed:operation"); calls.push("seed");
        return { status: "sealed", operationKey: "meta-ads-staging-seed:operation" };
      },
      candidateAuthority: async () => ({ mode: "tracking_ready", revision: "1".repeat(64) }),
      plan: async () => ({ strategy: "not_required", revision: "1".repeat(64), manifestSha256: "" }),
      activate: async (_, __, authorize) => { await authorize(); calls.push("activate"); },
      routeAuthority: async () => ({ mode: "tracking_ready", revision: "1".repeat(64) }),
      bootstrap: async () => ({ status: "not_required" }),
      health: async () => ({ revision: "2".repeat(64) }),
      fixture: async (authorize, markAttempt) => {
        await authorize(); await markAttempt("staging-tracking-fixture:operation"); calls.push("fixture");
        return "reconciled_and_rolled_back";
      },
      rollbackSeed: async () => { calls.push("rollback-seed"); },
      compensate: async () => { calls.push("compensate"); },
      sealEvidence: async () => { calls.push("seal"); return "/var/lib/skincos-runtime/token-vault/promotion-evidence/a/staging-native-release-001.json"; },
    };
    await run({ base, journal, calls, lease, operations });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test("staging release seals predecessor evidence after fixture and lease release", async () => fixture(async ({ base, journal, calls, lease, operations }) => {
  const file = path.join(journal.directory, "staging-promotion.json");
  const evidence = await runNativeTransaction({ target: "staging", identity, preview, readiness,
    transactionId, journal, lease, operations, evidenceFile: file });
  assert.equal(journal.state.status, "succeeded");
  assert.deepEqual(calls.slice(-2), ["release", "seal"]);
  assert.equal(journal.state.events.some((event) => event.event === "lease_released"), true);
  assert.equal(evidence.predecessorEvidenceDigest, preview.evidenceDigest);
  assert.equal(verifyPromotionEvidence(JSON.parse(fs.readFileSync(file, "utf8")), {
    target: "staging", sourceSha, sourceTree, releaseInputDigest,
    dependencyClosureDigest: identity.dependencyClosureDigest,
  }).evidenceDigest, evidence.evidenceDigest);
  assert.equal(fs.existsSync(path.join(base, "transactions", transactionId, "prepared-promotion-evidence.json")), true);
  const altered = { ...evidence, fixtureExercise: "failed" };
  assert.throws(() => verifyPromotionEvidence(altered, {}), /does not prove/);
}));

test("staging failure after activation rolls back seed before incumbent Worker", async () => fixture(async ({ journal, calls, lease, operations }) => {
  operations.health = async () => { throw new Error("health failed"); };
  await assert.rejects(() => runNativeTransaction({ target: "staging", identity, preview, readiness,
    transactionId, journal, lease, operations, evidenceFile: path.join(journal.directory, "promotion.json") }), /health failed/);
  assert.equal(journal.state.status, "compensated");
  assert.deepEqual(calls.slice(-3), ["rollback-seed", "compensate", "release"]);
}));

test("ambiguous bootstrap retains candidate traffic and blocks a new transaction", async () => fixture(async ({ base, journal, calls, lease, operations }) => {
  operations.bootstrap = async (_plan, _authorize, markAttempt) => {
    await markAttempt("meta-ads-bootstrap:operation");
    throw new Error("request timeout");
  };
  await assert.rejects(() => runNativeTransaction({ target: "staging", identity, preview, readiness,
    transactionId, journal, lease, operations, evidenceFile: path.join(journal.directory, "promotion.json") }), /manual reconciliation/);
  assert.equal(journal.state.status, "indeterminate");
  assert.equal(calls.includes("compensate"), false);
  assert.equal(calls.includes("release"), false);
  assert.throws(() => createTransactionJournal({ directory: path.join(base, "transactions", "native-release-002"),
    transactionId: "native-release-002", target: "staging", sourceSha,
    previewEvidenceDigest: preview.evidenceDigest, readinessEvidenceDigest: readiness.evidenceDigest }), /not terminal/);
}));

test("ambiguous D1 mutation reads its journal and remains forward-only pending reconciliation", async () => fixture(async ({ journal, calls, lease, operations }) => {
  operations.migrate = async () => { throw new Error("D1 request timed out"); };
  operations.readMigrationJournal = async () => { calls.push("d1-readback"); return ["0001_initial.sql"]; };
  await assert.rejects(() => runNativeTransaction({ target: "staging", identity, preview, readiness,
    transactionId, journal, lease, operations, evidenceFile: path.join(journal.directory, "promotion.json") }), /manual reconciliation/);
  assert.equal(journal.state.status, "indeterminate");
  assert.equal(calls.includes("d1-readback"), true);
  assert.equal(calls.includes("upload"), false);
  assert.equal(calls.includes("release"), false);
}));

test("production promotion requires exact staging predecessor", () => {
  const staging = buildPromotionEvidence({ target: "staging", identity, preview, readiness, transactionId,
    incumbentVersionId: readiness.incumbentVersionId, candidateVersionId: candidate.versionId,
    healthRevision: "2".repeat(64), fixtureExercise: "reconciled_and_rolled_back" });
  assert.equal(verifyPromotionEvidence(staging, { target: "staging", sourceSha }).sourceSha, sourceSha);
  assert.throws(() => buildPromotionEvidence({ target: "production", identity, preview, readiness, transactionId,
    incumbentVersionId: readiness.incumbentVersionId, candidateVersionId: candidate.versionId,
    healthRevision: "2".repeat(64) }), /required verified gate/);
  assert.equal(sealedEvidencePath(sourceSha, "staging", transactionId),
    `/var/lib/skincos-runtime/token-vault/promotion-evidence/${sourceSha}/staging-${transactionId}.json`);
});

test("production refuses a stale staging predecessor before lease acquisition", async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-tv-production-test-"));
  fs.chmodSync(base, 0o700);
  try {
    const journal = createTransactionJournal({ directory: path.join(base, "transactions", transactionId),
      transactionId, target: "production", sourceSha,
      previewEvidenceDigest: preview.evidenceDigest, readinessEvidenceDigest: readiness.evidenceDigest });
    const stagingEvidence = buildPromotionEvidence({ target: "staging", identity, preview, readiness, transactionId,
      incumbentVersionId: readiness.incumbentVersionId, candidateVersionId: candidate.versionId,
      healthRevision: "2".repeat(64), fixtureExercise: "reconciled_and_rolled_back" });
    let acquired = false;
    await assert.rejects(() => runNativeTransaction({ target: "production", identity, preview, readiness,
      stagingEvidence, transactionId, journal,
      lease: { acquire: async () => { acquired = true; }, check: async () => {}, release: async () => {} },
      operations: { readStagingActive: async () => readiness.incumbentVersionId, sealEvidence: async () => "" },
      evidenceFile: path.join(journal.directory, "promotion.json") }), /staging predecessor is no longer/);
    assert.equal(acquired, false);
    assert.equal(journal.state.status, "compensated");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
