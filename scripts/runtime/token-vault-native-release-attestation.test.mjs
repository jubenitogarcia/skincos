import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalJson } from "../../ops/governance/global-coordination-core.mjs";
import { verifyTokenVaultReleaseAttestation } from "./token-vault-native-release-attestation.mjs";

const SOURCE_SHA = "a".repeat(40);
const SOURCE_TREE = "b".repeat(40);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "token-vault-native-attestation-"));
  const material = { schemaVersion: 1, module: "token-vault", inputs: [] };
  const dependencyClosureDigest = crypto.createHash("sha256").update(canonicalJson(material)).digest("hex");
  const identity = {
    schemaVersion: 1,
    sourceSha: SOURCE_SHA,
    sourceTree: SOURCE_TREE,
    releaseInputDigest: "c".repeat(64),
    dependencyClosureDigest,
    sourceArchiveSha256: "d".repeat(64),
  };
  const closure = {
    schemaVersion: 1,
    module: "token-vault",
    sourceCommit: SOURCE_SHA,
    sourceTree: SOURCE_TREE,
    digest: dependencyClosureDigest,
    material,
  };
  const identityFile = path.join(root, ".skincos-token-vault-release-identity.json");
  const closureFile = path.join(root, ".skincos-global-coordination-token-vault.json");
  const save = () => {
    fs.writeFileSync(identityFile, JSON.stringify(identity));
    fs.writeFileSync(closureFile, JSON.stringify(closure));
  };
  save();
  return { root, identity, closure, identityFile, closureFile, save };
}

test("accepts a release identity bound to the closure material", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  assert.deepEqual(verifyTokenVaultReleaseAttestation({
    identityFile: current.identityFile,
    closureFile: current.closureFile,
    expectedSha: SOURCE_SHA,
  }), {
    sourceSha: SOURCE_SHA,
    sourceTree: SOURCE_TREE,
    releaseInputDigest: current.identity.releaseInputDigest,
    dependencyClosureDigest: current.identity.dependencyClosureDigest,
    sourceArchiveSha256: current.identity.sourceArchiveSha256,
  });
});

test("rejects a missing, renamed or forged release attestation", (t) => {
  const current = fixture();
  t.after(() => fs.rmSync(current.root, { recursive: true, force: true }));
  const input = { identityFile: current.identityFile, closureFile: current.closureFile, expectedSha: SOURCE_SHA };
  fs.unlinkSync(current.identityFile);
  assert.throws(() => verifyTokenVaultReleaseAttestation(input));
  current.save();
  assert.throws(() => verifyTokenVaultReleaseAttestation({ ...input, expectedSha: "e".repeat(40) }));
  current.identity.dependencyClosureDigest = "e".repeat(64);
  current.save();
  assert.throws(() => verifyTokenVaultReleaseAttestation(input));
  current.identity.dependencyClosureDigest = current.closure.digest;
  current.closure.material.inputs.push({ path: "other", blob: "f".repeat(40) });
  current.save();
  assert.throws(() => verifyTokenVaultReleaseAttestation(input));
});
