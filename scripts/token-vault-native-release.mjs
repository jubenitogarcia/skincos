#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyAdditiveMigrations, appliedMigrationNames } from "./token-vault-native-d1.mjs";
import {
  applyBootstrap,
  exerciseStagingFixture,
  planBootstrap,
  readAuthenticatedHealth,
  rollbackBootstrap,
  waitCandidateAuthority,
  waitRouteAuthority,
} from "./token-vault-native-authority.mjs";
import { verifyPreviewEvidence } from "./token-vault-native-preview.mjs";
import { readRemoteFacts, validateEnvironment, verifyIncumbentConfigBearer, verifyPlannedConfigRotation, verifyReadinessEvidence } from "./token-vault-native-readiness.mjs";
import { verifyDetachedRelease } from "./token-vault-native-release-identity.mjs";
import { sealedEvidencePath } from "./token-vault-native-evidence-custody.mjs";
import {
  attestStagingSource,
  reconcileStagingSeed,
  rollbackStagingSeed,
  sealStagingSeed,
} from "./token-vault-native-staging-seed.mjs";
import { createTransactionJournal, runNativeTransaction, verifyPromotionEvidence } from "./token-vault-native-transaction.mjs";
import { activateCandidate, compensateWorker, readActiveVersion, uploadCandidate } from "./token-vault-native-worker.mjs";

const SHA = /^[0-9a-f]{40}$/;
const TRANSACTION = /^[A-Za-z0-9][A-Za-z0-9._-]{7,95}$/;
const STATE_ROOT = path.join(os.homedir(), ".local", "state", "skincos", "token-vault");

function optionsFor(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--target", "--source-sha", "--preview-evidence", "--readiness-evidence", "--staging-evidence",
      "--transaction-id", "--checkout-root"].includes(key) || !value || options[key]) {
      throw new Error("usage: token-vault-native-release.mjs --target staging|production --source-sha <sha> --preview-evidence <file> --readiness-evidence <file> --transaction-id <id> --checkout-root <clean Ubuntu path> [--staging-evidence <file>]");
    }
    options[key] = value;
  }
  if (!["staging", "production"].includes(options["--target"])
    || !SHA.test(String(options["--source-sha"] || ""))
    || !TRANSACTION.test(String(options["--transaction-id"] || ""))
    || !options["--preview-evidence"] || !options["--readiness-evidence"] || !options["--checkout-root"]
    || (options["--target"] === "production" && !options["--staging-evidence"])) {
    throw new Error("native Token Vault release arguments are incomplete");
  }
  return options;
}

function privateEvidence(file) {
  if (!path.isAbsolute(file) || !file.startsWith(`${STATE_ROOT}${path.sep}`) || file.startsWith("/mnt/")) {
    throw new Error("native Token Vault evidence must remain under private Ubuntu state");
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0 || fs.lstatSync(file).isSymbolicLink()) {
    throw new Error("native Token Vault evidence file is not private");
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sealedStagingEvidence(file, sourceSha) {
  if (!path.isAbsolute(file) || fs.realpathSync(file) !== file) {
    throw new Error("production predecessor must use root-sealed staging evidence");
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.uid !== 0 || stat.gid !== process.getgid() || (stat.mode & 0o777) !== 0o640) {
    throw new Error("root-sealed staging evidence metadata is unsafe");
  }
  const evidence = JSON.parse(fs.readFileSync(file, "utf8"));
  if (file !== sealedEvidencePath(sourceSha, "staging", evidence.transactionId)) {
    throw new Error("production predecessor path differs from the canonical root evidence store");
  }
  const journalFile = path.join(STATE_ROOT, "transactions", evidence.transactionId, "journal.json");
  const journal = privateEvidence(journalFile);
  if (journal.status !== "succeeded" || journal.target !== "staging" || journal.sourceSha !== sourceSha
    || !journal.events?.some((event) => event.event === "promotion_evidence_sealed"
      && event.sealedPath === file)) {
    throw new Error("production predecessor staging transaction is not terminal and sealed");
  }
  return evidence;
}

function command(executable, args, cwd, environment = process.env) {
  const result = spawnSync(executable, args, { cwd, env: environment, encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`native Token Vault subprocess ${path.basename(executable)} failed (${result.status ?? "start"})`);
  }
  return String(result.stdout || "");
}

function buildLease({ root, sourceSha, target, transactionId, checkoutRoot, previewFile, readinessFile }) {
  const helper = path.join(root, "scripts", "runtime", "token-vault-native-lease-custody.sh");
  const observer = path.join(checkoutRoot, "scripts", "token-vault-native-observe.mjs");
  const proof = `/var/lib/skincos-runtime/global-coordination/token-vault-${transactionId}.json`;
  const cleanRootEnv = { PATH: "/usr/bin:/bin", HOME: "/root", LANG: "C", WSL_DISTRO_NAME: "Ubuntu-24.04" };
  const observation = () => {
    const file = path.join(STATE_ROOT, "observations", `${transactionId}-${randomBytes(12).toString("hex")}.json`);
    command("node", [observer, "--source-sha", sourceSha, "--file", file], checkoutRoot,
      { PATH: "/usr/bin:/bin", HOME: os.homedir(), LANG: "C", WSL_DISTRO_NAME: "Ubuntu-24.04" });
    return file;
  };
  const leaseCall = (mode, args = []) => command("sudo", ["-n", helper, mode, ...args], root, cleanRootEnv);
  const scope = ["--source-sha", sourceSha, "--target", target];
  return {
    acquire: async () => {
      leaseCall("acquire", [...scope, "--preview-evidence", previewFile, "--readiness-evidence", readinessFile,
        "--observation-file", observation(), "--transaction-id", transactionId, "--proof-file", proof]);
    },
    check: async () => {
      leaseCall("check", [...scope, "--observation-file", observation(), "--proof-file", proof]);
    },
    release: async () => { leaseCall("release", ["--proof-file", proof]); },
  };
}

function operationBindings({ target, root, sourceSha, transactionId, transactionDirectory, readiness, baseUrl, evidenceFile }) {
  const env = process.env;
  return {
    readStagingActive: async () => readActiveVersion("staging", root),
    migrate: (authorize) => applyAdditiveMigrations({ target, root, transactionDirectory,
      expectedBookmark: readiness.d1TimeTravelBookmark, authorize }),
    readMigrationJournal: async () => [...appliedMigrationNames(target, root)],
    upload: (authorize, markAttempt) => uploadCandidate({ target, sourceSha, root, transactionDirectory,
      analyticsBindingPresent: readiness.analyticsBindingPresent,
      configBindingPresent: readiness.configBindingPresent,
      nextConfigBindingPresent: readiness.nextConfigBindingPresent,
      configBearerMode: readiness.configBearerMode, authorize, markAttempt, env }),
    attest: (candidate) => attestStagingSource({ previewUrl: candidate.previewUrl, seedFile: candidate.seedFile,
      sourceSha, transactionId, env }),
    reconcileSeed: (candidate, authorize) => reconcileStagingSeed({ previewUrl: candidate.previewUrl,
      seedFile: candidate.seedFile, authorize, env }),
    seed: (candidate, authorize, markAttempt) => sealStagingSeed({ previewUrl: candidate.previewUrl,
      seedFile: candidate.seedFile, sourceSha, transactionId, authorize, markAttempt, env }),
    candidateAuthority: (candidate) => waitCandidateAuthority({ previewUrl: candidate.previewUrl, env }),
    plan: (candidate, authority) => planBootstrap({ target, previewUrl: candidate.previewUrl, authority, env }),
    activate: (candidate, incumbentVersionId, authorize) => activateCandidate({ target,
      candidateVersionId: candidate.versionId, incumbentVersionId, root, authorize }),
    routeAuthority: () => waitRouteAuthority({ baseUrl, env }),
    bootstrap: (plan, authorize, markAttempt) => applyBootstrap({ target, baseUrl, plan, sourceSha,
      transactionId, authorize, markAttempt, env }),
    health: () => readAuthenticatedHealth({ target, baseUrl, env }),
    fixture: (authorize, markAttempt) => exerciseStagingFixture({ baseUrl, sourceSha, transactionId,
      authorize, markAttempt, env }),
    rollbackBootstrap: (bootstrap, authorize) => rollbackBootstrap({ baseUrl,
      operationKey: bootstrap.operationKey, revision: bootstrap.revision, authorize, env }),
    rollbackSeed: (candidate, operationKey, authorize, allowAbsent) => rollbackStagingSeed({
      previewUrl: candidate.previewUrl, seedFile: candidate.seedFile, operationKey, authorize, allowAbsent, env,
    }),
    compensate: (candidate, incumbentVersionId, authorize) => compensateWorker({ target,
      candidateVersionId: candidate.versionId, incumbentVersionId, root, authorize }),
    sealEvidence: async () => {
      const helper = path.join(root, "scripts", "token-vault-native-evidence-custody.mjs");
      const sealed = command("sudo", ["-n", "/usr/bin/node", helper, "seal", "--source-sha", sourceSha,
        "--target", target, "--transaction-id", transactionId, "--evidence-file", evidenceFile], root,
      { PATH: "/usr/bin:/bin", HOME: "/root", LANG: "C", WSL_DISTRO_NAME: "Ubuntu-24.04" }).trim();
      if (sealed !== sealedEvidencePath(sourceSha, target, transactionId)) {
        throw new Error("root-sealed Token Vault evidence path differs from its expected identity");
      }
      return sealed;
    },
  };
}

async function main() {
  if (process.platform !== "linux" || process.env.WSL_DISTRO_NAME !== "Ubuntu-24.04" || process.getuid() === 0) {
    throw new Error("native Token Vault publisher must run as the unprivileged Ubuntu-24.04 operator");
  }
  const options = optionsFor(process.argv.slice(2));
  const target = options["--target"];
  const sourceSha = options["--source-sha"];
  const transactionId = options["--transaction-id"];
  const root = process.cwd();
  const { identity } = verifyDetachedRelease({ root, sourceSha });
  const { base, configBearerMode } = validateEnvironment(target);
  const previewFile = options["--preview-evidence"];
  const readinessFile = options["--readiness-evidence"];
  const preview = verifyPreviewEvidence(privateEvidence(previewFile), {
    sourceSha, sourceTree: identity.sourceTree, releaseInputDigest: identity.releaseInputDigest,
  });
  const readiness = verifyReadinessEvidence(privateEvidence(readinessFile), {
    target, sourceSha, sourceTree: identity.sourceTree,
    releaseInputDigest: identity.releaseInputDigest, previewEvidenceDigest: preview.evidenceDigest,
    configBearerMode,
  });
  const live = readRemoteFacts(target, root);
  if (live.incumbentVersionId !== readiness.incumbentVersionId
    || live.d1TimeTravelBookmark !== readiness.d1TimeTravelBookmark
    || live.analyticsBindingPresent !== readiness.analyticsBindingPresent
    || live.configBindingPresent !== readiness.configBindingPresent
    || live.nextConfigBindingPresent !== readiness.nextConfigBindingPresent) {
    throw new Error("Token Vault remote incumbent, D1 bookmark or bindings changed after readiness");
  }
  if (live.configBindingPresent) {
    const incumbentAuthority = configBearerMode === "overlap"
      ? await verifyPlannedConfigRotation({ target, baseUrl: base,
        bearer: process.env.TOKEN_VAULT_META_ADS_CONFIG_TOKEN, ...live })
      : await verifyIncumbentConfigBearer({ target, baseUrl: base,
        bearer: process.env.TOKEN_VAULT_META_ADS_CONFIG_TOKEN });
    if (incumbentAuthority.mode !== readiness.incumbentConfigAuthorityMode) {
      throw new Error("Token Vault incumbent config authority changed after readiness");
    }
  }
  const stagingEvidence = target === "production" ? verifyPromotionEvidence(sealedStagingEvidence(options["--staging-evidence"], sourceSha), {
    target: "staging", sourceSha, sourceTree: identity.sourceTree,
    releaseInputDigest: identity.releaseInputDigest, previewEvidenceDigest: preview.evidenceDigest,
    dependencyClosureDigest: identity.dependencyClosureDigest,
  }) : null;
  const checkoutRoot = options["--checkout-root"];
  if (!path.isAbsolute(checkoutRoot) || checkoutRoot === root || !fs.existsSync(path.join(checkoutRoot, ".git"))) {
    throw new Error("a separate clean operator Git checkout is required for fresh source observations");
  }
  const directory = path.join(STATE_ROOT, "transactions", transactionId);
  const evidenceFile = path.join(STATE_ROOT, `${sourceSha}-${target}-${transactionId}-promotion.json`);
  const stateStat = fs.lstatSync(STATE_ROOT);
  if (!stateStat.isDirectory() || stateStat.isSymbolicLink() || stateStat.uid !== process.getuid()
    || (stateStat.mode & 0o077) !== 0 || fs.existsSync(evidenceFile)) {
    throw new Error("native promotion evidence store is not private or output identity already exists");
  }
  const journal = createTransactionJournal({ directory, transactionId, target, sourceSha,
    previewEvidenceDigest: preview.evidenceDigest, readinessEvidenceDigest: readiness.evidenceDigest });
  const lease = buildLease({ root, sourceSha, target, transactionId, checkoutRoot, previewFile, readinessFile });
  const operations = operationBindings({ target, root, sourceSha, transactionId,
    transactionDirectory: journal.directory, readiness, baseUrl: base, evidenceFile });
  const evidence = await runNativeTransaction({ target,
    identity: { sourceSha, sourceTree: identity.sourceTree,
      releaseInputDigest: identity.releaseInputDigest, dependencyClosureDigest: identity.dependencyClosureDigest },
    preview, readiness, stagingEvidence, transactionId, journal, lease, operations, evidenceFile });
  process.stdout.write(`Token Vault ${target} native promotion completed: ${evidence.evidenceDigest}\nEvidence: ${sealedEvidencePath(sourceSha, target, transactionId)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
