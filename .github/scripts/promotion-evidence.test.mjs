import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

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
