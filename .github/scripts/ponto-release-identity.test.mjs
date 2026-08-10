import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactBindingsFromSurfaces,
  buildReleaseIdentity,
  identityDigestFor,
  rollbackIncumbentsFromSurfaces,
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

test("final artifact identity binds exact surface IDs and its immutable source identity", () => {
  const source = buildReleaseIdentity({
    module: "ponto",
    sourceCommit,
    sourceTree,
    dependencyClosureDigest: closure,
  });
  const surfaces = {
    timekeeping: {
      runId: "100",
      candidateVersionId: "11111111-1111-4111-8111-111111111111",
      incumbentVersionId: "22222222-2222-4222-8222-222222222222",
      deploymentId: "33333333-3333-4333-8333-333333333333",
    },
    crmPages: {
      runId: "101",
      deploymentId: "44444444-4444-4444-8444-444444444444",
      rollbackDeploymentId: "55555555-5555-4555-8555-555555555555",
    },
  };
  const bindings = artifactBindingsFromSurfaces({
    module: "ponto",
    sourceCommit,
    sourceTree,
    surfaces,
  });
  const incumbents = rollbackIncumbentsFromSurfaces({ surfaces });
  const final = buildReleaseIdentity({
    module: "ponto",
    sourceCommit,
    sourceTree,
    dependencyClosureDigest: closure,
    artifactBindings: bindings,
    rollbackIncumbents: incumbents,
    sourceIdentityDigest: source.releaseIdentityDigest,
  });
  assert.equal(final.sourceIdentityDigest, source.releaseIdentityDigest);
  assert.ok(final.artifactBindings.some((binding) => binding.versionId === surfaces.timekeeping.candidateVersionId));
  assert.ok(final.artifactBindings.some((binding) => binding.pagesDeploymentId === surfaces.crmPages.deploymentId));
  assert.ok(final.rollbackIncumbents.includes(surfaces.crmPages.rollbackDeploymentId));
  assert.equal(verifyReleaseIdentity(final).releaseIdentityDigest, final.releaseIdentityDigest);
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
