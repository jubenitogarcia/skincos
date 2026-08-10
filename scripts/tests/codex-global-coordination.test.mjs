import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  acquireLease,
  authorizeMutation,
  buildIntent,
  buildLeaseRequest,
  checkLease,
  compareDependencyClosure,
  consumeNonce,
  dependencyClosureFromTree,
  dependencyClosureForSource,
  emptyState,
  evaluateLeaseAdmission,
  loadGlobalPolicy,
  lockScopeFor,
  normalizeResourceKey,
  releaseLease,
  renewLease,
} from "../codex-global-coordinator.mjs";

const owner = {
  provider: "codex",
  missionId: "mission-global-coordination",
  threadId: "thread-global-coordination",
  actor: "admin",
};
const sha = (character) => character.repeat(40);
const digest = (character) => character.repeat(64);
const identity = () => ({
  module: "website",
  sourceCommit: sha("a"),
  sourceTree: sha("b"),
  dependencyClosureDigest: digest("c"),
  artifacts: [{ name: "pages", id: "deployment-1", digest: digest("d"), versionId: "version-1" }],
});
const releaseRequest = (idempotencyKey = "intent-1") => buildLeaseRequest({
  operation: "promotion",
  resource: "deploy:website:staging",
  owner,
  idempotencyKey,
  ttlMs: 60_000,
  intent: { releaseIdentity: identity(), purpose: "promote-exact-build" },
});

test("resource keys normalize and shared surface scopes collide across deploy and Cloudflare mutations", () => {
  assert.equal(normalizeResourceKey("DEPLOY:Website:Staging"), "deploy:website:staging");
  assert.equal(lockScopeFor("deploy:website:staging"), "surface:website:staging");
  assert.equal(lockScopeFor("cloudflare:website:staging"), "surface:website:staging");
  assert.equal(lockScopeFor("release:website"), "release:website");
  assert.equal(lockScopeFor("merge:main"), "repository:main");
  assert.equal(normalizeResourceKey("MUTATE:Website:Staging"), "mutate:website:staging");
  assert.equal(lockScopeFor("mutate:website:staging"), "surface:website:staging");
  assert.throws(() => normalizeResourceKey("deploy:website:unknown"), /resource environment is invalid/);
  assert.throws(() => normalizeResourceKey("surface:website:staging"), /resource class is unsupported/);
});

test("a lease is idempotent for one owner and fences a concurrent owner", () => {
  const request = releaseRequest();
  const first = acquireLease(emptyState(), request, { now: 1_000, leaseId: "lease-0000000000000001" });
  assert.equal(first.accepted, true);
  assert.equal(first.lease.fencingToken, 1);
  const repeated = acquireLease(first.state, request, { now: 2_000, leaseId: "lease-0000000000000002" });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.lease.leaseId, first.lease.leaseId);
  const other = acquireLease(first.state, { ...releaseRequest("intent-2"), owner: { ...owner, threadId: "other-thread" } }, { now: 2_000, leaseId: "lease-0000000000000003" });
  assert.equal(other.accepted, false);
  assert.equal(other.reason, "resource-lease-held");
});

test("expired leases cannot be reused and stale proofs fail after fencing advances", () => {
  const request = releaseRequest();
  const first = acquireLease(emptyState(), request, { now: 1_000, leaseId: "lease-0000000000000001" });
  const stale = {
    resource: first.lease.resource,
    leaseId: first.lease.leaseId,
    fencingToken: first.lease.fencingToken,
    intentDigest: first.lease.intentDigest,
    owner: first.lease.owner,
  };
  const second = acquireLease(first.state, { ...request, idempotencyKey: "intent-2" }, { now: 61_001, leaseId: "lease-0000000000000002" });
  assert.equal(second.accepted, true);
  assert.equal(second.lease.fencingToken, 2);
  const staleCheck = checkLease(second.state, stale, { now: 61_002 });
  assert.equal(staleCheck.valid, false);
  assert.equal(staleCheck.reason, "lease-fence-mismatch");
});

test("release promotion accepts an unrelated main tip and rejects closure drift before mutation", () => {
  const request = releaseRequest();
  const acquired = acquireLease(emptyState(), request, { now: 1_000, leaseId: "lease-0000000000000001" });
  const proof = {
    resource: acquired.lease.resource,
    leaseId: acquired.lease.leaseId,
    fencingToken: acquired.lease.fencingToken,
    intentDigest: acquired.lease.intentDigest,
    owner: acquired.lease.owner,
  };
  const allowed = authorizeMutation(acquired.state, proof, {
    now: 2_000,
    observedDependencyClosureDigest: digest("c"),
    expectedArtifacts: identity().artifacts,
  });
  assert.equal(allowed.valid, true);
  const unrelatedMainTip = sha("e");
  assert.notEqual(unrelatedMainTip, identity().sourceCommit);
  const invalidated = authorizeMutation(acquired.state, proof, {
    now: 2_000,
    observedDependencyClosureDigest: digest("f"),
    expectedArtifacts: identity().artifacts,
  });
  assert.equal(invalidated.valid, false);
  assert.equal(invalidated.reason, "dependency-closure-changed");
});

test("mutation leases also require the observed closure when a caller supplies it", () => {
  const request = buildLeaseRequest({
    operation: "mutation",
    resource: "deploy:website:staging",
    owner,
    idempotencyKey: "mutation-closure-1",
    ttlMs: 60_000,
    intent: { dependencyClosureDigest: digest("c"), purpose: "surface-mutation" },
  });
  const acquired = acquireLease(emptyState(), request, { now: 1_000, leaseId: "lease-0000000000000004" });
  const proof = {
    resource: acquired.lease.resource,
    leaseId: acquired.lease.leaseId,
    fencingToken: acquired.lease.fencingToken,
    intentDigest: acquired.lease.intentDigest,
    owner: acquired.lease.owner,
  };
  assert.equal(authorizeMutation(acquired.state, proof, {
    now: 2_000,
    expectedResource: "deploy:website:staging",
    observedDependencyClosureDigest: digest("c"),
  }).valid, true);
  const drift = authorizeMutation(acquired.state, proof, {
    now: 2_000,
    expectedResource: "deploy:website:staging",
    observedDependencyClosureDigest: digest("d"),
  });
  assert.equal(drift.valid, false);
  assert.equal(drift.reason, "dependency-closure-changed");
  const missing = authorizeMutation(acquired.state, proof, {
    now: 2_000,
    expectedResource: "deploy:website:staging",
    observedDependencyClosureDigest: "",
  });
  assert.equal(missing.valid, false);
  assert.equal(missing.reason, "dependency-closure-intent-missing");
});

test("missing closure, artifact identity, owner or lease authority fails closed", () => {
  assert.deepEqual(compareDependencyClosure(digest("c"), ""), {
    valid: false,
    failClosed: true,
    reason: "dependency-closure-unavailable",
  });
  assert.throws(() => buildIntent({
    operation: "promotion",
    resource: "promotion:website:staging",
    owner,
    idempotencyKey: "intent-1",
    intent: { purpose: "missing-release-identity" },
  }), /release identity is required/);
  assert.throws(() => buildIntent({
    operation: "mutation",
    resource: "deploy:website:staging",
    owner: { ...owner, provider: "unknown" },
    idempotencyKey: "intent-1",
    intent: { purpose: "invalid-owner" },
  }), /lease owner provider is invalid/);
});

test("renewal and nonce replay are explicit state transitions", () => {
  const request = releaseRequest();
  const acquired = acquireLease(emptyState(), request, { now: 1_000, leaseId: "lease-0000000000000001" });
  const proof = {
    resource: acquired.lease.resource,
    leaseId: acquired.lease.leaseId,
    fencingToken: acquired.lease.fencingToken,
    intentDigest: acquired.lease.intentDigest,
    owner: acquired.lease.owner,
  };
  const renewed = renewLease(acquired.state, proof, { now: 20_000, ttlMs: 60_000 });
  assert.equal(renewed.valid, true);
  assert.equal(renewed.lease.expiresAt, 80_000);
  const firstNonce = consumeNonce(renewed.state, { nonce: "nonce-0000000000000001", digest: digest("a"), now: 20_000, ttlMs: 60_000 });
  assert.equal(firstNonce.accepted, true);
  const replay = consumeNonce(firstNonce.state, { nonce: "nonce-0000000000000001", digest: digest("a"), now: 20_001, ttlMs: 60_000 });
  assert.equal(replay.accepted, false);
  assert.equal(replay.reason, "request-nonce-replayed");
  assert.equal(renewed.lease.updatedAt, 20_000);
  assert.equal(renewed.lease.heartbeatAt, 20_000);
  assert.equal(fs.existsSync(new URL("../../ops/governance/global-concurrency-policy.json", import.meta.url)), true);
});

test("global admission allows an unrelated merge while fencing a closure-overlapping merge", () => {
  const releaseRequest = buildLeaseRequest({
    operation: "mutation",
    resource: "release:website",
    owner,
    idempotencyKey: "release-website-1",
    ttlMs: 60_000,
    intent: {
      module: "website",
      dependencyClosureDigest: digest("c"),
      dependencyClosurePatterns: ["website/**", "package.json"],
      dependencyClosurePaths: ["website/src/index.ts", "package.json"],
    },
  });
  const held = acquireLease(emptyState(), releaseRequest, { now: 1_000, leaseId: "lease-0000000000000011" });
  assert.equal(held.accepted, true);

  const unrelated = buildLeaseRequest({
    operation: "mutation",
    resource: "merge:main",
    owner: { ...owner, threadId: "merge-thread" },
    idempotencyKey: "merge-unrelated-1",
    ttlMs: 60_000,
    intent: { module: "merge", dependencyClosureDigest: digest("d"), inputs: { changedPaths: ["docs/readme.md"] } },
  });
  const allowed = evaluateLeaseAdmission(held.state, unrelated, { now: 2_000 });
  assert.equal(allowed.allowed, true);
  const acquired = acquireLease(held.state, unrelated, { now: 2_000, leaseId: "lease-0000000000000012" });
  assert.equal(acquired.accepted, true);

  const relevant = buildLeaseRequest({
    ...unrelated,
    idempotencyKey: "merge-relevant-1",
    intent: { module: "merge", dependencyClosureDigest: digest("d"), inputs: { changedPaths: ["website/src/index.ts"] } },
  });
  const blocked = evaluateLeaseAdmission(held.state, relevant, { now: 2_000 });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "incompatible-release-lease");
});

test("ambiguous cross-scope admission fails closed and release retries are idempotent", () => {
  const held = acquireLease(emptyState(), buildLeaseRequest({
    operation: "mutation",
    resource: "release:website",
    owner,
    idempotencyKey: "release-retry",
    ttlMs: 60_000,
    intent: { module: "website", dependencyClosureDigest: digest("c") },
  }), { now: 1_000, leaseId: "lease-0000000000000013" });
  const merge = buildLeaseRequest({
    operation: "mutation",
    resource: "merge:main",
    owner: { ...owner, threadId: "merge-ambiguous" },
    idempotencyKey: "merge-ambiguous-1",
    ttlMs: 60_000,
    intent: { module: "merge", dependencyClosureDigest: digest("d") },
  });
  const ambiguous = evaluateLeaseAdmission(held.state, merge, { now: 2_000 });
  assert.equal(ambiguous.allowed, false);
  assert.equal(ambiguous.failClosed, true);
  assert.equal(ambiguous.reason, "coordination-dependency-closure-ambiguous");

  const proof = {
    resource: held.lease.resource,
    leaseId: held.lease.leaseId,
    fencingToken: held.lease.fencingToken,
    intentDigest: held.lease.intentDigest,
    owner: held.lease.owner,
  };
  const first = releaseLease(held.state, proof, { now: 3_000 });
  const retry = releaseLease(first.state, proof, { now: 3_001 });
  assert.equal(first.released, true);
  assert.equal(retry.released, true);
  assert.equal(retry.idempotent, true);
});

test("shared exact closure inputs still fence a merge when module patterns do not match", () => {
  const held = acquireLease(emptyState(), buildLeaseRequest({
    operation: "mutation",
    resource: "release:website",
    owner,
    idempotencyKey: "release-shared-input",
    ttlMs: 60_000,
    intent: {
      module: "website",
      dependencyClosureDigest: digest("c"),
      dependencyClosurePatterns: ["website/**"],
      dependencyClosurePaths: ["package.json"],
    },
  }), { now: 1_000, leaseId: "lease-0000000000000014" });
  const merge = buildLeaseRequest({
    operation: "mutation",
    resource: "merge:main",
    owner: { ...owner, threadId: "merge-shared-input" },
    idempotencyKey: "merge-shared-input",
    ttlMs: 60_000,
    intent: { module: "merge", dependencyClosureDigest: digest("d"), inputs: { changedPaths: ["package.json"] } },
  });
  const admission = evaluateLeaseAdmission(held.state, merge, { now: 2_000 });
  assert.equal(admission.allowed, false);
  assert.equal(admission.reason, "incompatible-release-lease");
});

test("the policy and current Ponto source produce a deterministic dependency closure", () => {
  const policy = loadGlobalPolicy();
  assert.equal(policy.contractId, "skincos/global-coordination/v1");
  assert.equal(policy.authority.mode, "fail-closed");
  assert.equal(policy.lease.maximumTtlMs, 900_000);
  const closure = dependencyClosureForSource({ module: "ponto", sourceCommit: "HEAD" });
  assert.match(closure.digest, /^[0-9a-f]{64}$/);
  assert.ok(closure.inputs.some((entry) => entry.path === ".github/workflows/ponto-progressive-release.yml"));
  assert.ok(closure.inputs.some((entry) => entry.path === "package.json"));
});

test("Ponto closure excludes independent CRM API changes while retaining the shared Pages artifact", () => {
  const closure = dependencyClosureFromTree({
    module: "ponto",
    sourceCommit: sha("a"),
    sourceTree: sha("b"),
    entries: [
      { path: "crm/api/server/atendimento/commercialOperationsMigration.js", blob: digest("a").slice(0, 40) },
      { path: "crm/console/PontoModule.tsx", blob: digest("b").slice(0, 40) },
      { path: "package.json", blob: digest("c").slice(0, 40) },
    ],
  });
  assert.equal(closure.inputs.some((entry) => entry.path.startsWith("crm/api/")), false);
  assert.equal(closure.inputs.some((entry) => entry.path === "crm/console/PontoModule.tsx"), true);
  assert.equal(closure.inputs.some((entry) => entry.path === "package.json"), true);
});

test("closure digest ignores source-tree changes outside the selected inputs", () => {
  const entries = [
    { path: "crm/console/PontoModule.tsx", blob: digest("a").slice(0, 40) },
    { path: "package.json", blob: digest("b").slice(0, 40) },
  ];
  const first = dependencyClosureFromTree({ module: "ponto", sourceCommit: sha("a"), sourceTree: sha("b"), entries });
  const second = dependencyClosureFromTree({ module: "ponto", sourceCommit: sha("c"), sourceTree: sha("d"), entries });
  assert.notEqual(first.sourceTree, second.sourceTree);
  assert.equal(first.digest, second.digest);
});
