import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReleaseIdentity,
  identityDigestFor,
  releaseRefFor,
  releaseTagApiPath,
  releaseTagFor,
  verifyReleaseIdentity,
} from "./ponto-release-identity.mjs";

const sourceCommit = "a".repeat(40);
const sourceTree = "b".repeat(40);
const closure = "c".repeat(64);

test("release identity uses a deterministic immutable tag and digest", () => {
  const identity = buildReleaseIdentity({
    module: "ponto",
    sourceCommit,
    sourceTree,
    dependencyClosureDigest: closure,
    repository: "owner/repo",
    workflow: "Ponto progressive release",
    runId: "123",
    artifactBindings: [{ name: "worker", digest: "d".repeat(64), workerVersionId: "version-1" }],
    rollbackIncumbents: ["incumbent-pages"],
  });
  assert.equal(identity.releaseTag, `skincos/release/ponto/${sourceCommit}`);
  assert.equal(identity.releaseRef, `refs/tags/${identity.releaseTag}`);
  assert.equal(identity.releaseIdentityDigest, identityDigestFor(identity));
  assert.equal(releaseTagFor("PONTO", sourceCommit), identity.releaseTag);
  assert.equal(releaseRefFor("ponto", sourceCommit), identity.releaseRef);
  assert.equal(releaseTagApiPath("owner/repo", identity.releaseTag), `/repos/owner/repo/git/ref/tags/skincos/release/ponto/${sourceCommit}`);
  assert.equal(verifyReleaseIdentity(identity, {
    module: "ponto",
    sourceCommit,
    sourceTree,
    dependencyClosureDigest: closure,
    expectedReleaseTag: identity.releaseTag,
    expectedReleaseRef: identity.releaseRef,
    tagTarget: sourceCommit,
  }).releaseIdentityDigest, identity.releaseIdentityDigest);
});

test("identity tampering and ref retargeting fail closed", () => {
  const identity = buildReleaseIdentity({ module: "ponto", sourceCommit, sourceTree, dependencyClosureDigest: closure });
  assert.throws(
    () => verifyReleaseIdentity({ ...identity, releaseTag: "main" }),
    /release identity (digest differs|releaseTag differs)/,
  );
  assert.throws(
    () => verifyReleaseIdentity(identity, { module: "ponto", sourceCommit, sourceTree, dependencyClosureDigest: closure, tagTarget: "d".repeat(40) }),
    /release tag does not point to the immutable release SHA/,
  );
  assert.throws(
    () => buildReleaseIdentity({ module: "ponto", sourceCommit, sourceTree, dependencyClosureDigest: closure, artifactBindings: [{ name: "worker", digest: "d".repeat(64), secretToken: "x" }] }),
    /field is not allowed/,
  );
});
