import assert from "node:assert/strict";
import test from "node:test";
import {
  acquireLease,
  authorizeMutation,
  buildLeaseRequest,
  emptyState,
  evaluateLeaseAdmission,
} from "../codex-global-coordinator.mjs";

const sha = (character) => character.repeat(40);
const digest = (character) => character.repeat(64);
const owner = (threadId) => ({
  provider: "codex",
  missionId: "mission-global-chaos",
  threadId,
  actor: "admin",
});

function promotionRequest({ threadId, source, closure, key }) {
  return buildLeaseRequest({
    operation: "promotion",
    resource: "deploy:crm-pages:staging",
    owner: owner(threadId),
    idempotencyKey: key,
    ttlMs: 60_000,
    intent: {
      dependencyClosurePatterns: ["crm/console/**", ".github/workflows/deploy-crm-pages.yml"],
      dependencyClosurePaths: ["crm/console/App.tsx", ".github/workflows/deploy-crm-pages.yml"],
      releaseIdentity: {
        module: "crm-pages",
        sourceCommit: sha(source),
        sourceTree: sha(source === "a" ? "b" : "d"),
        dependencyClosureDigest: digest(closure),
        artifacts: [{ name: "crm-pages", id: `pages-${source}`, digest: digest("e") }],
      },
    },
  });
}

function proofFrom(lease) {
  return {
    resource: lease.resource,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken,
    intentDigest: lease.intentDigest,
    owner: lease.owner,
  };
}

test("two incompatible releases cannot acquire or mutate the same Cloudflare surface concurrently", async () => {
  let state = emptyState();
  const acquireSerially = async (request, leaseId, now) => {
    await Promise.resolve();
    const result = acquireLease(state, request, { now, leaseId });
    state = result.state;
    return result;
  };
  const [first, second] = await Promise.all([
    acquireSerially(promotionRequest({ threadId: "release-a", source: "a", closure: "c", key: "release-a" }), "lease-0000000000000101", 1_000),
    acquireSerially(promotionRequest({ threadId: "release-b", source: "f", closure: "d", key: "release-b" }), "lease-0000000000000102", 1_001),
  ]);

  assert.equal([first, second].filter((result) => result.accepted).length, 1);
  const winner = first.accepted ? first : second;
  const loser = first.accepted ? second : first;
  assert.equal(loser.reason, "resource-lease-held");

  const mutationLog = [];
  const authorized = authorizeMutation(state, proofFrom(winner.lease), {
    now: 2_000,
    expectedResource: "deploy:crm-pages:staging",
    observedDependencyClosureDigest: winner.lease.intent.releaseIdentity.dependencyClosureDigest,
    expectedArtifacts: winner.lease.intent.releaseIdentity.artifacts,
  });
  if (authorized.valid) mutationLog.push(winner.lease.intent.releaseIdentity.sourceCommit);
  assert.deepEqual(mutationLog, [winner.lease.intent.releaseIdentity.sourceCommit]);
  assert.equal(loser.lease, undefined);
});

test("incident chaos sequence tolerates unrelated main integration and fences closure drift before the next mutation", () => {
  let state = emptyState();
  const release = buildLeaseRequest({
    operation: "promotion",
    resource: "release:ponto",
    owner: owner("ponto-release"),
    idempotencyKey: "ponto-release-chaos",
    ttlMs: 60_000,
    intent: {
      dependencyClosurePatterns: ["api/**", "crm/console/**", ".github/workflows/ponto-*.yml"],
      dependencyClosurePaths: ["api/src/router.js", "crm/console/PontoModule.tsx"],
      releaseIdentity: {
        module: "ponto",
        sourceCommit: sha("a"),
        sourceTree: sha("b"),
        dependencyClosureDigest: digest("c"),
        artifacts: [{ name: "ponto-core", id: "version-a", digest: digest("d") }],
      },
    },
  });
  const held = acquireLease(state, release, { now: 1_000, leaseId: "lease-0000000000000111" });
  state = held.state;
  assert.equal(held.accepted, true);

  const unrelatedMerge = buildLeaseRequest({
    operation: "mutation",
    resource: "merge:main",
    owner: owner("unrelated-merge"),
    idempotencyKey: "unrelated-main-merge",
    ttlMs: 60_000,
    intent: {
      module: "merge",
      dependencyClosureDigest: digest("e"),
      inputs: { changedPaths: ["docs/independent-module.md"] },
    },
  });
  const unrelatedAdmission = evaluateLeaseAdmission(state, unrelatedMerge, { now: 2_000 });
  assert.equal(unrelatedAdmission.allowed, true);
  const unrelatedLease = acquireLease(state, unrelatedMerge, { now: 2_000, leaseId: "lease-0000000000000112" });
  state = unrelatedLease.state;
  assert.equal(unrelatedLease.accepted, true);

  const relevantMerge = buildLeaseRequest({
    ...unrelatedMerge,
    idempotencyKey: "relevant-main-merge",
    intent: {
      module: "merge",
      dependencyClosureDigest: digest("f"),
      inputs: { changedPaths: ["api/src/router.js"] },
    },
  });
  const relevantAdmission = evaluateLeaseAdmission(state, relevantMerge, { now: 2_001 });
  assert.equal(relevantAdmission.allowed, false);
  assert.equal(relevantAdmission.reason, "incompatible-release-lease");

  const beforeDrift = authorizeMutation(state, proofFrom(held.lease), {
    now: 2_002,
    expectedResource: "release:ponto",
    observedDependencyClosureDigest: digest("c"),
    expectedArtifacts: held.lease.intent.releaseIdentity.artifacts,
  });
  assert.equal(beforeDrift.valid, true);
  const afterDrift = authorizeMutation(state, proofFrom(held.lease), {
    now: 2_003,
    expectedResource: "release:ponto",
    observedDependencyClosureDigest: digest("e"),
    expectedArtifacts: held.lease.intent.releaseIdentity.artifacts,
  });
  assert.equal(afterDrift.valid, false);
  assert.equal(afterDrift.reason, "dependency-closure-changed");
});
