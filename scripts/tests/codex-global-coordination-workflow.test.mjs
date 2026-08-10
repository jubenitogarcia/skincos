import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertCoordinationPayloadSize } from "../codex-github-integration-candidate.mjs";
import { buildWorkflowLeaseRequest, closureFromFile } from "../codex-global-coordination-workflow.mjs";
import { dependencyClosureForSource } from "../codex-global-coordinator.mjs";

test("workflow adapter binds the lease to source closure, owner, and selected resource", () => {
  const resource = "deploy:timekeeping:staging";
  const { request, closure } = buildWorkflowLeaseRequest({
    resource,
    module: "ponto",
    source: "HEAD",
    inputs: { target: "staging", releaseScope: "ponto" },
  });
  assert.equal(request.resource, resource);
  assert.equal(request.lockScope, "surface:timekeeping:staging");
  assert.equal(request.intent.module, "ponto");
  assert.equal(request.intent.sourceCommit, closure.sourceCommit);
  assert.equal(request.intent.sourceTree, closure.sourceTree);
  assert.equal(request.intent.dependencyClosureDigest, closure.digest);
  assert.ok(request.intent.dependencyClosurePatterns.length > 0);
  assert.equal(request.owner.provider, "github");
  assert.match(request.intentDigest, /^[0-9a-f]{64}$/);
});

test("workflow adapter accepts a detached immutable closure attestation", () => {
  const source = "HEAD";
  const closure = dependencyClosureForSource({ module: "orb", sourceCommit: source });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skincos-global-closure-"));
  const file = path.join(directory, "orb.json");
  fs.writeFileSync(file, `${JSON.stringify(closure)}\n`, { mode: 0o600 });
  try {
    const loaded = closureFromFile(["--closure-file", file], { module: "orb", source });
    assert.equal(loaded.sourceCommit, closure.sourceCommit);
    assert.equal(loaded.sourceTree, closure.sourceTree);
    assert.equal(loaded.digest, closure.digest);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("workflow adapter carries exact release identity for promotion operations", () => {
  const closure = dependencyClosureForSource({ module: "orb", sourceCommit: "HEAD" });
  const releaseIdentity = {
    schemaVersion: 1,
    module: "orb",
    sourceCommit: closure.sourceCommit,
    sourceTree: closure.sourceTree,
    dependencyClosureDigest: closure.digest,
    artifacts: [{ name: "native-source", id: closure.sourceCommit, digest: "d".repeat(64) }],
  };
  const { request } = buildWorkflowLeaseRequest({
    resource: "release:orb",
    module: "orb",
    source: "HEAD",
    operation: "promotion",
    releaseIdentity,
  });
  assert.deepEqual(request.intent.releaseIdentity, releaseIdentity);
  assert.throws(() => buildWorkflowLeaseRequest({
    resource: "release:orb",
    module: "orb",
    source: "HEAD",
    operation: "promotion",
  }), /release identity is required/);
  assert.throws(() => buildWorkflowLeaseRequest({
    resource: "release:orb",
    module: "orb",
    source: "HEAD",
    operation: "promotion",
    releaseIdentity: { ...releaseIdentity, dependencyClosureDigest: "e".repeat(64) },
  }), /release identity does not match/);
});

test("merge admission carries only changed paths, not the full repository closure", () => {
  const { request } = buildWorkflowLeaseRequest({
    resource: "merge:main",
    module: "merge",
    source: "HEAD",
    inputs: { changedPaths: ["docs/readme.md"] },
  });
  assert.equal(request.intent.dependencyClosurePaths, undefined);
  assert.deepEqual(request.intent.dependencyClosurePatterns, ["**"]);
  assert.ok(Buffer.byteLength(JSON.stringify(request), "utf8") < 64 * 1024);
});

test("merge admission rejects a changed-file payload before remote coordination", () => {
  assert.throws(() => assertCoordinationPayloadSize({
    inputs: { changedPaths: Array.from({ length: 2_000 }, (_, index) => `website/${"x".repeat(48)}/${index}.tsx`) },
  }), /payload budget/);
});
