import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { createPromotionEvidenceV4, verifyPromotionEvidenceV4 } from "../../packages/skincos-delivery-contract/src/index.js";

const root = path.resolve(import.meta.dirname, "../..");
const sha256 = (character) => character.repeat(64);

function cleanEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  delete env.GITHUB_OUTPUT;
  return env;
}

function runPromotion(args, env) {
  return execFileSync(process.execPath, [".github/scripts/promotion-evidence.mjs", ...args], {
    cwd: root,
    env: cleanEnv(env),
    encoding: "utf8",
  });
}

function v4Environment({ sourceSha, sourceTree, ...overrides }) {
  return {
    PROMOTION_EVIDENCE_SCHEMA_VERSION: "4",
    PROMOTION_UNIT: "synthetic-unit",
    PROMOTION_TARGET: "preview",
    PROMOTION_SOURCE_REPOSITORY: "jubenitogarcia/skincos-meta-ads-reporting",
    PROMOTION_SOURCE_COMMIT: sourceSha,
    PROMOTION_SOURCE_TREE: sourceTree,
    PROMOTION_SOURCE_REF: "refs/heads/main",
    PROMOTION_DELIVERY_CONTRACT_VERSION: "1.0.0",
    PROMOTION_CONTRACT_MANIFEST_DIGEST: sha256("c"),
    PROMOTION_RELEASE_INPUT_DIGEST: sha256("d"),
    PROMOTION_DEPENDENCY_CLOSURE_DIGEST: sha256("d"),
    PROMOTION_CONTRACT_VERSIONS_JSON: JSON.stringify([
      { name: "@jubenitogarcia/skincos-contracts", version: "1.0.0", integrity: sha256("e") },
    ]),
    PROMOTION_ARTIFACT_IDENTITIES_JSON: JSON.stringify([
      { id: "worker.tgz", digest: sha256("f"), fileDigest: sha256("1") },
    ]),
    GITHUB_REPOSITORY: "jubenitogarcia/skincos-release-evidence",
    GITHUB_RUN_ID: "33179818924",
    PROMOTION_EVIDENCE_REPOSITORY: "jubenitogarcia/skincos-release-evidence",
    PROMOTION_EVIDENCE_ARTIFACT: "promotion-evidence-synthetic-unit",
    ...overrides,
  };
}

test("maps Atendimento to its isolated runtime release surfaces", () => {
  const env = { ...process.env };
  delete env.PROMOTION_RELEASE_INPUT_DIGEST;
  const digest = execFileSync(process.execPath, [
    ".github/scripts/promotion-evidence.mjs",
    "digest",
  ], {
    cwd: root,
    env: {
      ...env,
      PROMOTION_UNIT: "atendimento",
      PROMOTION_SOURCE_SHA: "HEAD",
    },
    encoding: "utf8",
  }).trim();

  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("maps the Beauty Movement copy update to the website release surface", () => {
  const env = { ...process.env };
  delete env.PROMOTION_RELEASE_INPUT_DIGEST;
  const digest = execFileSync(process.execPath, [
    ".github/scripts/promotion-evidence.mjs",
    "digest",
  ], {
    cwd: root,
    env: {
      ...env,
      PROMOTION_UNIT: "beauty-movement-campaign-copy-update",
      PROMOTION_SOURCE_SHA: "HEAD",
    },
    encoding: "utf8",
  }).trim();

  assert.match(digest, /^[0-9a-f]{64}$/);
});

test("writes and verifies a tamper-evident immutable release identity", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-promotion-evidence-"));
  const evidencePath = path.join(directory, "promotion-evidence.json");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
  const closure = "a".repeat(64);
  const env = {
    ...process.env,
    PROMOTION_UNIT: "synthetic-unit",
    PROMOTION_TARGET: "preview",
    PROMOTION_SOURCE_SHA: sourceSha,
    PROMOTION_SOURCE_TREE: sourceTree,
    PROMOTION_RELEASE_INPUT_DIGEST: closure,
    PROMOTION_DEPENDENCY_CLOSURE_DIGEST: closure,
    GITHUB_RUN_ID: "123",
    GITHUB_REPOSITORY: "jubenitogarcia/skincos",
  };
  execFileSync(process.execPath, [".github/scripts/promotion-evidence.mjs", "write", evidencePath], { cwd: root, env, encoding: "utf8" });
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  assert.equal(evidence.schemaVersion, 3);
  assert.equal(evidence.promotionStrategy, "immutable-source-identity");
  assert.match(evidence.releaseIdentityDigest, /^[0-9a-f]{64}$/);
  execFileSync(process.execPath, [".github/scripts/promotion-evidence.mjs", "verify", evidencePath], {
    cwd: root,
    env: {
      ...env,
      PROMOTION_EXPECTED_TARGET: "preview",
      PROMOTION_EXPECTED_SHA: sourceSha,
      PROMOTION_EXPECTED_RELEASE_INPUT_DIGEST: closure,
      PROMOTION_EXPECTED_RELEASE_IDENTITY_DIGEST: evidence.releaseIdentityDigest,
    },
    encoding: "utf8",
  });
  const tampered = { ...evidence, releaseIdentityDigest: "b".repeat(64) };
  fs.writeFileSync(evidencePath, `${JSON.stringify(tampered)}\n`);
  assert.throws(() => execFileSync(process.execPath, [".github/scripts/promotion-evidence.mjs", "verify", evidencePath], {
    cwd: root,
    env: {
      ...env,
      PROMOTION_EXPECTED_TARGET: "preview",
      PROMOTION_EXPECTED_SHA: sourceSha,
      PROMOTION_EXPECTED_RELEASE_INPUT_DIGEST: closure,
      PROMOTION_EXPECTED_RELEASE_IDENTITY_DIGEST: evidence.releaseIdentityDigest,
    },
    encoding: "utf8",
  }), /release identity digest is invalid/);
});

test("v4 binds repository, contract manifest, package versions, and exact artifact files into the release identity", () => {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
  const base = v4Environment({ sourceSha, sourceTree });
  const identity = JSON.parse(runPromotion(["identity"], base));
  assert.equal(identity.schemaVersion, 2);
  assert.equal(identity.sourceRepository, "jubenitogarcia/skincos-meta-ads-reporting");
  assert.equal(identity.sourceCommit, sourceSha);
  assert.match(identity.releaseIdentityDigest, /^[0-9a-f]{64}$/);

  const repositoryVariant = JSON.parse(runPromotion(["identity"], {
    ...base,
    PROMOTION_SOURCE_REPOSITORY: "jubenitogarcia/skincos-finance",
  }));
  const contractVariant = JSON.parse(runPromotion(["identity"], {
    ...base,
    PROMOTION_DELIVERY_CONTRACT_VERSION: "1.0.1",
  }));
  const artifactVariant = JSON.parse(runPromotion(["identity"], {
    ...base,
    PROMOTION_ARTIFACT_IDENTITIES_JSON: JSON.stringify([
      { id: "worker.tgz", digest: sha256("9"), fileDigest: sha256("1") },
    ]),
  }));
  assert.notEqual(repositoryVariant.releaseIdentityDigest, identity.releaseIdentityDigest);
  assert.notEqual(contractVariant.releaseIdentityDigest, identity.releaseIdentityDigest);
  assert.notEqual(artifactVariant.releaseIdentityDigest, identity.releaseIdentityDigest);
});

test("writes evidence accepted by the portable v4 delivery contract", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-promotion-evidence-v4-"));
  const evidencePath = path.join(directory, "promotion-evidence.json");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
  const env = v4Environment({ sourceSha, sourceTree });
  runPromotion(["write", evidencePath], env);
  const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
  assert.equal(evidence.schemaVersion, 4);
  assert.equal(evidence.sourceRepository, "jubenitogarcia/skincos-meta-ads-reporting");
  assert.equal(evidence.evidenceRepository, "jubenitogarcia/skincos-release-evidence");
  assert.equal(evidence.releaseIdentity.sourceCommit, sourceSha);
  assert.equal(Object.hasOwn(evidence.releaseIdentity, "evidenceArtifact"), false);

  runPromotion(["verify", evidencePath], {
    ...env,
    GITHUB_REPOSITORY: "jubenitogarcia/skincos-release-controller",
    PROMOTION_EXPECTED_TARGET: "preview",
    PROMOTION_EXPECTED_SOURCE_REPOSITORY: evidence.sourceRepository,
    PROMOTION_EXPECTED_SOURCE_COMMIT: sourceSha,
    PROMOTION_EXPECTED_SOURCE_TREE: sourceTree,
    PROMOTION_EXPECTED_SOURCE_REF: "refs/heads/main",
    PROMOTION_EXPECTED_RELEASE_INPUT_DIGEST: sha256("d"),
    PROMOTION_EXPECTED_DELIVERY_CONTRACT_VERSION: "1.0.0",
    PROMOTION_EXPECTED_CONTRACT_MANIFEST_DIGEST: sha256("c"),
    PROMOTION_EXPECTED_CONTRACT_VERSIONS_JSON: env.PROMOTION_CONTRACT_VERSIONS_JSON,
    PROMOTION_EXPECTED_ARTIFACT_IDENTITIES_JSON: env.PROMOTION_ARTIFACT_IDENTITIES_JSON,
    PROMOTION_EXPECTED_EVIDENCE_REPOSITORY: evidence.evidenceRepository,
    PROMOTION_EXPECTED_EVIDENCE_RUN_ID: evidence.evidenceRunId,
    PROMOTION_EXPECTED_EVIDENCE_ARTIFACT: evidence.evidenceArtifact,
    PROMOTION_EXPECTED_RELEASE_IDENTITY_DIGEST: evidence.releaseIdentityDigest,
  });

  const portable = await verifyPromotionEvidenceV4(evidence, {
    target: "preview",
    sourceRepository: evidence.sourceRepository,
    sourceCommit: sourceSha,
    releaseIdentityDigest: evidence.releaseIdentityDigest,
  });
  assert.equal(portable.evidence.releaseIdentityDigest, evidence.releaseIdentityDigest);

  const packageEvidence = await createPromotionEvidenceV4({
    target: "preview",
    createdAt: "2026-08-28T14:23:04.000Z",
    evidenceRepository: evidence.evidenceRepository,
    evidenceRunId: evidence.evidenceRunId,
    evidenceArtifact: evidence.evidenceArtifact,
    releaseIdentity: evidence.releaseIdentity,
  });
  const packageEvidencePath = path.join(directory, "package-promotion-evidence.json");
  fs.writeFileSync(packageEvidencePath, `${JSON.stringify(packageEvidence)}\n`);
  runPromotion(["verify", packageEvidencePath], {
    ...env,
    GITHUB_REPOSITORY: "jubenitogarcia/skincos-release-controller",
    PROMOTION_EXPECTED_TARGET: "preview",
    PROMOTION_EXPECTED_SOURCE_REPOSITORY: packageEvidence.sourceRepository,
    PROMOTION_EXPECTED_SOURCE_COMMIT: sourceSha,
    PROMOTION_EXPECTED_SOURCE_TREE: sourceTree,
    PROMOTION_EXPECTED_SOURCE_REF: "refs/heads/main",
    PROMOTION_EXPECTED_RELEASE_INPUT_DIGEST: sha256("d"),
    PROMOTION_EXPECTED_DELIVERY_CONTRACT_VERSION: "1.0.0",
    PROMOTION_EXPECTED_CONTRACT_MANIFEST_DIGEST: sha256("c"),
    PROMOTION_EXPECTED_CONTRACT_VERSIONS_JSON: env.PROMOTION_CONTRACT_VERSIONS_JSON,
    PROMOTION_EXPECTED_ARTIFACT_IDENTITIES_JSON: env.PROMOTION_ARTIFACT_IDENTITIES_JSON,
    PROMOTION_EXPECTED_EVIDENCE_REPOSITORY: packageEvidence.evidenceRepository,
    PROMOTION_EXPECTED_EVIDENCE_RUN_ID: packageEvidence.evidenceRunId,
    PROMOTION_EXPECTED_EVIDENCE_ARTIFACT: packageEvidence.evidenceArtifact,
    PROMOTION_EXPECTED_RELEASE_IDENTITY_DIGEST: packageEvidence.releaseIdentityDigest,
  });

  const tampered = { ...evidence, sourceRepository: "jubenitogarcia/other-source" };
  fs.writeFileSync(evidencePath, `${JSON.stringify(tampered)}\n`);
  assert.throws(() => runPromotion(["verify", evidencePath], {
    ...env,
    PROMOTION_EXPECTED_TARGET: "preview",
  }), /release identity digest is invalid/);
});

test("legacy evidence is rejected when the requested source is cross-repository", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-promotion-evidence-v3-cross-"));
  const evidencePath = path.join(directory, "promotion-evidence.json");
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
  const closure = "a".repeat(64);
  const env = {
    PROMOTION_UNIT: "synthetic-unit",
    PROMOTION_TARGET: "preview",
    PROMOTION_SOURCE_SHA: sourceSha,
    PROMOTION_SOURCE_TREE: sourceTree,
    PROMOTION_RELEASE_INPUT_DIGEST: closure,
    PROMOTION_DEPENDENCY_CLOSURE_DIGEST: closure,
    GITHUB_RUN_ID: "123",
    GITHUB_REPOSITORY: "jubenitogarcia/skincos",
  };
  runPromotion(["write", evidencePath], env);
  assert.throws(() => runPromotion(["verify", evidencePath], {
    ...env,
    PROMOTION_EXPECTED_TARGET: "preview",
    PROMOTION_EXPECTED_SOURCE_REPOSITORY: "jubenitogarcia/skincos-meta-ads-reporting",
  }), /schema v4 is required/);
});
