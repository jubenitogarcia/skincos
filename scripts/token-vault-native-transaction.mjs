import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./codex-autonomy-lib.mjs";

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const VERSION = /^[0-9a-fA-F-]{36}$/;
const TRANSACTION = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;

function digest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function privateDirectory(directory) {
  const parent = path.dirname(directory);
  if (!path.isAbsolute(directory) || directory.includes("/mnt/") || directory.includes("\\")) {
    throw new Error("native transaction storage must be an absolute Ubuntu path outside DrvFS");
  }
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(parent).isSymbolicLink() || (fs.statSync(parent).mode & 0o077) !== 0) {
    throw new Error("native transaction parent must be a private real directory");
  }
  return directory;
}

function durableWrite(file, value, exclusive = false) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (exclusive) {
    try { fs.linkSync(temporary, file); } finally { fs.unlinkSync(temporary); }
  } else {
    fs.renameSync(temporary, file);
  }
  const directoryFd = fs.openSync(path.dirname(file), "r");
  try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
}

export function createTransactionJournal({ directory, transactionId, target, sourceSha, previewEvidenceDigest, readinessEvidenceDigest }) {
  if (!TRANSACTION.test(transactionId) || !["staging", "production"].includes(target)
    || !SHA.test(sourceSha) || !DIGEST.test(previewEvidenceDigest) || !DIGEST.test(readinessEvidenceDigest)) {
    throw new Error("native transaction identity is incomplete");
  }
  const location = privateDirectory(directory);
  // A previous indeterminate transaction remains a release gate until it is
  // reconciled. A new transaction cannot silently supersede its write set.
  for (const entry of fs.readdirSync(path.dirname(location), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(path.dirname(location), entry.name, "journal.json");
    if (!fs.existsSync(file)) throw new Error("unreadable Token Vault transaction directory requires operator reconciliation");
    const earlier = JSON.parse(fs.readFileSync(file, "utf8"));
    if (earlier?.target === target && !["succeeded", "compensated"].includes(earlier.status)) {
      throw new Error("an earlier Token Vault transaction is not terminal; reconcile it before a new release");
    }
  }
  fs.mkdirSync(location, { mode: 0o700 });
  if ((fs.statSync(location).mode & 0o077) !== 0) throw new Error("native transaction directory must be private");
  const file = path.join(location, "journal.json");
  const state = { schemaVersion: 1, kind: "skincos-token-vault-native-transaction", transactionId,
    target, sourceSha, previewEvidenceDigest, readinessEvidenceDigest, status: "in_progress", events: [] };
  durableWrite(file, state, true);
  return {
    directory: location,
    get state() { return structuredClone(state); },
    record(event, fields = {}) {
      if (!/^[a-z][a-z0-9_]{2,63}$/.test(event) || Object.values(fields).some((value) => typeof value === "object")) {
        throw new Error("transaction journal event is invalid");
      }
      state.events.push({ event, at: new Date().toISOString(), ...fields });
      durableWrite(file, state);
    },
    terminal(status) {
      if (!["succeeded", "compensated", "indeterminate"].includes(status)) throw new Error("transaction terminal status is invalid");
      state.status = status;
      durableWrite(file, state);
    },
  };
}

export function buildPromotionEvidence({ target, identity, preview, readiness, transactionId, incumbentVersionId,
  candidateVersionId, healthRevision, stagingEvidenceDigest = "", fixtureExercise = "" }) {
  if (!["staging", "production"].includes(target) || !SHA.test(identity?.sourceSha) || !SHA.test(identity?.sourceTree)
    || !DIGEST.test(identity?.releaseInputDigest) || !DIGEST.test(identity?.dependencyClosureDigest)
    || !DIGEST.test(preview?.evidenceDigest)
    || !DIGEST.test(readiness?.evidenceDigest) || !VERSION.test(incumbentVersionId)
    || !VERSION.test(candidateVersionId) || !DIGEST.test(healthRevision) || !TRANSACTION.test(transactionId)
    || (target === "production" && !DIGEST.test(stagingEvidenceDigest))
    || (target === "staging" && (stagingEvidenceDigest || fixtureExercise !== "reconciled_and_rolled_back"))) {
    throw new Error("native promotion evidence lacks a required verified gate");
  }
  const body = {
    schemaVersion: 1,
    kind: "skincos-token-vault-native-promotion",
    producer: "codex-ubuntu-24.04",
    target,
    sourceSha: identity.sourceSha,
    sourceTree: identity.sourceTree,
    releaseInputDigest: identity.releaseInputDigest,
    dependencyClosureDigest: identity.dependencyClosureDigest,
    previewEvidenceDigest: preview.evidenceDigest,
    readinessEvidenceDigest: readiness.evidenceDigest,
    predecessorEvidenceDigest: target === "staging" ? preview.evidenceDigest : stagingEvidenceDigest,
    transactionId,
    incumbentVersionId: incumbentVersionId.toLowerCase(),
    candidateVersionId: candidateVersionId.toLowerCase(),
    healthRevision,
    fixtureExercise: target === "staging" ? fixtureExercise : "not_applicable",
    createdAt: new Date().toISOString(),
  };
  return { ...body, evidenceDigest: digest(body) };
}

export function verifyPromotionEvidence(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("native promotion evidence is invalid");
  const { evidenceDigest, ...body } = value;
  if (value.schemaVersion !== 1 || value.kind !== "skincos-token-vault-native-promotion"
    || value.producer !== "codex-ubuntu-24.04" || !["staging", "production"].includes(value.target)
    || !DIGEST.test(String(evidenceDigest || "")) || digest(body) !== evidenceDigest
    || !SHA.test(value.sourceSha) || !SHA.test(value.sourceTree) || !DIGEST.test(value.releaseInputDigest)
    || !DIGEST.test(value.dependencyClosureDigest)
    || !DIGEST.test(value.previewEvidenceDigest) || !DIGEST.test(value.readinessEvidenceDigest)
    || !DIGEST.test(value.predecessorEvidenceDigest) || !DIGEST.test(value.healthRevision)
    || !VERSION.test(value.incumbentVersionId) || !VERSION.test(value.candidateVersionId)
    || (value.target === "staging" && (value.predecessorEvidenceDigest !== value.previewEvidenceDigest
      || value.fixtureExercise !== "reconciled_and_rolled_back"))) {
    throw new Error("native promotion evidence does not prove its predecessor and completion gates");
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) throw new Error(`native promotion evidence ${key} differs from the selected release`);
  }
  return value;
}

export function writePromotionEvidence(file, evidence) {
  if (!path.isAbsolute(file)) throw new Error("native promotion evidence needs an absolute private path");
  const directory = path.dirname(file);
  if (fs.lstatSync(directory).isSymbolicLink() || (fs.statSync(directory).mode & 0o077) !== 0) {
    throw new Error("native promotion evidence directory must be private");
  }
  verifyPromotionEvidence(evidence, { target: evidence.target });
  durableWrite(file, evidence, true);
}

export async function runNativeTransaction({ target, identity, preview, readiness, stagingEvidence, transactionId,
  journal, lease, operations, evidenceFile }) {
  if (!journal || !lease || !operations || typeof operations.sealEvidence !== "function"
    || !identity || !preview || !readiness) {
    throw new Error("native transaction requires journal, lease, and complete evidence");
  }
  const sourceSha = identity.sourceSha;
  const incumbentVersionId = readiness.incumbentVersionId;
  let leaseHeld = false;
  let leaseAcquisitionAttempted = false;
  let leaseAcquisitionConfirmed = false;
  let candidate = null;
  let seedAttempted = false;
  let seedOperationKey = "";
  let seedStatus = "";
  let activationAttempted = false;
  let bootstrapAttempted = false;
  let bootstrap = null;
  let fixtureAttempted = false;
  let fixtureSucceeded = false;
  let releaseAttempted = false;
  let d1MigrationAttempted = false;
  let d1MigrationReadback = false;
  let uploadAttempted = false;
  try {
    if (target === "production") {
      verifyPromotionEvidence(stagingEvidence, { target: "staging", sourceSha,
        sourceTree: identity.sourceTree, releaseInputDigest: identity.releaseInputDigest,
        dependencyClosureDigest: identity.dependencyClosureDigest,
        previewEvidenceDigest: preview.evidenceDigest });
      if (await operations.readStagingActive() !== stagingEvidence.candidateVersionId) {
        throw new Error("staging predecessor is no longer the active Worker version");
      }
    }
    leaseAcquisitionAttempted = true;
    journal.record("lease_acquire_attempted");
    await lease.acquire();
    leaseAcquisitionConfirmed = true;
    leaseHeld = true;
    journal.record("lease_acquired");
    const authorize = () => lease.check();
    d1MigrationAttempted = true;
    journal.record("d1_migration_attempted");
    const migrations = await operations.migrate(authorize);
    d1MigrationReadback = true;
    journal.record("d1_migration_readback", { applied: migrations.applied.length });
    if (migrations.applied.length) journal.record("d1_schema_forward_only", { applied: migrations.applied.length });
    journal.record("worker_upload_prepared");
    candidate = await operations.upload(authorize, async () => {
      uploadAttempted = true;
      journal.record("worker_upload_attempted");
    });
    journal.record("worker_candidate_selected", { candidateVersionId: candidate.versionId });
    if (target === "staging") {
      seedOperationKey = await operations.attest(candidate);
      journal.record("seed_source_attested");
      await operations.reconcileSeed(candidate, authorize);
      journal.record("seed_lineage_reconciled");
      const seed = await operations.seed(candidate, authorize, async (key) => {
        seedAttempted = true;
        seedOperationKey = key;
        journal.record("seed_mutation_attempted", { operationKey: key });
      });
      seedStatus = seed.status;
      journal.record("seed_mutation_readback", { status: seedStatus });
    }
    const authority = await operations.candidateAuthority(candidate);
    journal.record("candidate_authority_authenticated", { mode: authority.mode, revision: authority.revision });
    const plan = await operations.plan(candidate, authority);
    journal.record("bootstrap_plan_sealed", { strategy: plan.strategy, revision: plan.revision, manifestSha256: plan.manifestSha256 });
    await authorize();
    activationAttempted = true;
    journal.record("worker_activation_attempted", { candidateVersionId: candidate.versionId });
    await operations.activate(candidate, incumbentVersionId, authorize);
    journal.record("worker_activation_readback", { candidateVersionId: candidate.versionId });
    const route = await operations.routeAuthority();
    if (route.mode !== authority.mode || route.revision !== authority.revision) {
      throw new Error("canonical Token Vault route authority differs from candidate plan");
    }
    journal.record("canonical_route_converged");
    bootstrap = await operations.bootstrap(plan, authorize, async (key) => {
      bootstrapAttempted = true;
      journal.record("bootstrap_mutation_attempted", { operationKey: key });
    });
    journal.record("bootstrap_readback", { status: bootstrap.status, revision: bootstrap.revision || "" });
    const health = await operations.health();
    journal.record("authenticated_health_readback", { revision: health.revision });
    const fixtureExercise = target === "staging"
      ? await operations.fixture(authorize, async (key) => {
        fixtureAttempted = true;
        journal.record("fixture_mutation_attempted", { operationKey: key });
      })
      : "";
    if (target === "staging") {
      fixtureSucceeded = true;
      journal.record("staging_fixture_rolled_back");
    }
    const evidence = buildPromotionEvidence({ target, identity, preview, readiness, transactionId,
      incumbentVersionId, candidateVersionId: candidate.versionId, healthRevision: health.revision,
      stagingEvidenceDigest: stagingEvidence?.evidenceDigest || "", fixtureExercise });
    writePromotionEvidence(path.join(journal.directory, "prepared-promotion-evidence.json"), evidence);
    journal.record("promotion_evidence_prepared", { evidenceDigest: evidence.evidenceDigest });
    releaseAttempted = true;
    await lease.release();
    leaseHeld = false;
    journal.record("lease_released");
    writePromotionEvidence(evidenceFile, evidence);
    journal.record("promotion_evidence_written", { evidenceDigest: evidence.evidenceDigest });
    const sealedPath = await operations.sealEvidence(evidenceFile, evidence);
    if (typeof sealedPath !== "string" || !sealedPath.startsWith("/var/lib/skincos-runtime/token-vault/promotion-evidence/")) {
      throw new Error("native promotion evidence was not sealed by root custody");
    }
    journal.record("promotion_evidence_sealed", { sealedPath });
    journal.terminal("succeeded");
    return evidence;
  } catch (error) {
    journal.record("transaction_failed", { stage: journal.state.events.at(-1)?.event || "preflight" });
    let safeToCompensate = true;
    try {
      if (d1MigrationAttempted && !d1MigrationReadback) {
        try {
          const names = await operations.readMigrationJournal();
          journal.record("d1_journal_after_ambiguous_migration", { applied: names.length });
        } catch {
          journal.record("d1_journal_readback_failed");
        }
        safeToCompensate = false;
      }
      if ((leaseAcquisitionAttempted && !leaseAcquisitionConfirmed)
        || (uploadAttempted && !candidate) || releaseAttempted || (fixtureAttempted && !fixtureSucceeded)
        || (bootstrapAttempted && bootstrap?.status !== "applied")) {
        // An accepted request with lost response may have modified D1. Keep
        // the candidate and require operation-key reconciliation.
        safeToCompensate = false;
      }
      if (safeToCompensate && target === "staging" && bootstrap?.status === "applied") {
        await operations.rollbackBootstrap(bootstrap, () => lease.check());
        journal.record("bootstrap_rolled_back");
      }
      if (safeToCompensate && target === "staging" && seedAttempted && seedStatus !== "not_required") {
        await operations.rollbackSeed(candidate, seedOperationKey, () => lease.check(), true);
        journal.record("seed_rolled_back");
      }
      if (safeToCompensate && activationAttempted && candidate) {
        await operations.compensate(candidate, incumbentVersionId, () => lease.check());
        journal.record("worker_compensated", { incumbentVersionId });
      }
      if (!safeToCompensate) throw new Error("post-mutation outcome is indeterminate; retaining candidate traffic");
      if (leaseHeld) {
        await lease.release();
        leaseHeld = false;
      }
      journal.terminal("compensated");
    } catch (compensationError) {
      journal.record("compensation_failed", { stage: journal.state.events.at(-1)?.event || "unknown" });
      journal.terminal("indeterminate");
      const leaseState = releaseAttempted ? "release outcome is unknown"
        : !leaseAcquisitionConfirmed ? "acquisition outcome is unknown"
          : "was retained until expiry";
      throw new AggregateError([error, compensationError],
        `Token Vault transaction requires manual reconciliation; lease ${leaseState}`);
    }
    throw error;
  }
}
