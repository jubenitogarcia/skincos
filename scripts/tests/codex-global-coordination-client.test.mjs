import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  buildAuthenticatedRequest,
  buildLegacyLeaseRequest,
  buildRecoveryFenceRequest,
  buildLeaseRequest,
  coordinationActiveSecret,
  lockScopeForResource,
  newRequestNonce,
  probeCoordinatorProtocol,
  proofForLease,
  verifyCoordinatorResponse,
} from "../codex-global-coordination-client.mjs";
import { canonicalJson, CONTRACT_ID } from "../../ops/governance/global-coordination-core.mjs";

const secret = "test-coordination-secret";
const nonce = "n".repeat(32);

test("the active coordination custody is selected only when its key id is also pinned", () => {
  const saved = {
    active: process.env.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY,
    keyId: process.env.SKINCOS_GLOBAL_COORDINATION_KEY_ID,
    shared: process.env.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET,
  };
  try {
    process.env.SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY = "active-secret";
    process.env.SKINCOS_GLOBAL_COORDINATION_KEY_ID = "active-v2";
    process.env.SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET = "shared-secret";
    assert.equal(coordinationActiveSecret(), "active-secret");
    delete process.env.SKINCOS_GLOBAL_COORDINATION_KEY_ID;
    assert.equal(coordinationActiveSecret(), "shared-secret");
  } finally {
    for (const [name, value] of [
      ["SKINCOS_GLOBAL_COORDINATION_ACTIVE_KEY", saved.active],
      ["SKINCOS_GLOBAL_COORDINATION_KEY_ID", saved.keyId],
      ["SKINCOS_GLOBAL_COORDINATION_SHARED_SECRET", saved.shared],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("legacy lease adapter is explicit and preserves the same resource identity", () => {
  const args = {
    operation: "mutation",
    resource: "merge:main",
    owner: { provider: "github", missionId: "mission-1", threadId: "thread-1", actor: "actions" },
    intent: { module: "merge", dependencyClosureDigest: "a".repeat(64), inputs: { changedPaths: ["docs/readme.md"] } },
    idempotencyKey: "legacy-lease-compatibility",
    ttlMs: 60_000,
  };
  const modern = buildLeaseRequest(args);
  const legacy = buildLegacyLeaseRequest(args);
  assert.equal(legacy.resource, modern.resource);
  assert.equal(legacy.lockScope, modern.lockScope);
  assert.equal(legacy.owner.sessionId, undefined);
  assert.notEqual(legacy.intentDigest, modern.intentDigest);
});

test("readiness probe selects only the explicit legacy 404 path and fails closed otherwise", async () => {
  const legacy = await probeCoordinatorProtocol({
    url: "https://coordination.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
  });
  assert.deepEqual(legacy, { protocol: "legacy-v1", readiness: "not-supported", httpStatus: 404 });
  const modern = await probeCoordinatorProtocol({
    url: "https://coordination.example.test",
    fetchImpl: async () => new Response(JSON.stringify({
      contractId: CONTRACT_ID,
      protocol: "epoch-fence-v1",
      ready: true,
      coordinationPlane: "global",
      authorityEpoch: 3,
    }), { status: 200 }),
  });
  assert.equal(modern.protocol, "epoch-fence-v1");
  assert.equal(modern.authorityEpoch, 3);
  await assert.rejects(() => probeCoordinatorProtocol({
    url: "https://coordination.example.test",
    fetchImpl: async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
  }), /failed closed/);
});

test("GitHub and mini-PC clients produce the same signed envelope contract", () => {
  const request = buildAuthenticatedRequest({
      url: "https://coordination.example.test",
      secret,
      action: "check",
      proof: {
        resource: "deploy:website:staging",
        leaseId: "lease-0000000000000001",
        fencingToken: 4,
        intentDigest: "a".repeat(64),
        owner: { provider: "github", missionId: "mission-1", threadId: "thread-1", actor: "actions" },
      },
      authorization: {
        expectedResource: "deploy:website:staging",
        expectedIntentDigest: "a".repeat(64),
        observedDependencyClosureDigest: "c".repeat(64),
      },
      nonce,
      requestedAt: "2026-08-09T18:00:00.000Z",
  });
  assert.equal(request.endpoint.pathname, "/v1/leases");
  assert.equal(request.body.contractId, CONTRACT_ID);
  assert.equal(request.body.authorization.observedDependencyClosureDigest, "c".repeat(64));
  assert.equal(request.headers["x-skincos-coordination-request-digest"], request.requestDigest);
  const expectedSignature = crypto.createHmac("sha256", secret)
    .update(canonicalJson({
      contractId: CONTRACT_ID,
      method: "POST",
      nonce,
      path: "/v1/leases",
      requestDigest: request.requestDigest,
      requestedAt: "2026-08-09T18:00:00.000Z",
      schemaVersion: 1,
    }))
    .digest("base64url");
  assert.equal(request.headers["x-skincos-coordination-request-signature"], expectedSignature);
  assert.equal(request.headers.authorization, undefined);
  assert.throws(() => buildAuthenticatedRequest({
    url: "https://coordination.example.test",
    secret,
    action: "revoke",
    proof: request.body.proof,
    reason: "test-revoke",
    nonce,
    requestedAt: "2026-08-09T18:00:00.000Z",
  }), /administrative custody is unavailable/);
  assert.equal(buildAuthenticatedRequest({
    url: "https://coordination.example.test",
    secret,
    adminSecret: "admin-secret",
    action: "revoke",
    proof: request.body.proof,
    reason: "test-revoke",
    nonce: "r".repeat(32),
    requestedAt: "2026-08-09T18:00:00.000Z",
  }).headers.authorization, "Bearer admin-secret");
});

test("response signatures cover the authority envelope and tampering fails closed", () => {
  const unsigned = { schemaVersion: 1, contractId: CONTRACT_ID, passed: true, accepted: true, reason: "lease-acquired" };
  const responseDigest = crypto.createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
  const authority = { contractId: CONTRACT_ID, provider: "cloudflare", responseDigest };
  const responseSignature = crypto.createHmac("sha256", secret)
    .update(canonicalJson({ ...unsigned, authority }))
    .digest("base64url");
  assert.deepEqual(verifyCoordinatorResponse({ ...unsigned, authority, responseSignature }, secret), unsigned);
  assert.throws(() => verifyCoordinatorResponse({ ...unsigned, accepted: false, authority, responseSignature }, secret), /digest mismatch/);
});

test("key identifiers bind requests and response verification honors the previous-key grace window", () => {
  const keyRequest = buildAuthenticatedRequest({
    url: "https://coordination.example.test",
    secret,
    keyId: "active-v2",
    action: "gate",
    request: { operation: "mutation" },
    nonce: "k".repeat(32),
    requestedAt: "2026-08-09T18:00:00.000Z",
  });
  assert.equal(keyRequest.headers["x-skincos-coordination-key-id"], "active-v2");
  assert.match(keyRequest.headers["x-skincos-coordination-request-signature"], /^[A-Za-z0-9_-]+$/);

  const unsigned = { schemaVersion: 1, contractId: CONTRACT_ID, passed: true, authorityEpoch: 3 };
  const responseDigest = crypto.createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
  const authority = { contractId: CONTRACT_ID, provider: "cloudflare", protocol: "epoch-fence-v1", keyId: "previous-v1", authorityEpoch: 3, responseDigest };
  const responseSignature = crypto.createHmac("sha256", secret).update(canonicalJson({ ...unsigned, authority })).digest("base64url");
  assert.deepEqual(verifyCoordinatorResponse({ ...unsigned, authority, responseSignature }, {
    secret: "new-secret",
    keyId: "active-v2",
    previousKeyId: "previous-v1",
    previousSecret: secret,
    previousKeyExpiresAt: "2099-01-01T00:00:00.000Z",
  }), unsigned);
  assert.throws(() => verifyCoordinatorResponse({ ...unsigned, authority, responseSignature }, {
    secret: "new-secret",
    keyId: "active-v2",
    previousKeyId: "previous-v1",
    previousSecret: secret,
    previousKeyExpiresAt: "2020-01-01T00:00:00.000Z",
  }), /grace period expired/);
  assert.throws(() => verifyCoordinatorResponse({
    ...unsigned,
    authority: { ...authority, authorityEpoch: 0 },
    responseSignature,
  }, { secret, keyId: "previous-v1" }), /epoch contract is invalid/);
  assert.throws(() => verifyCoordinatorResponse({ ...unsigned, authority, responseSignature }, { secret }), /key id is not pinned/);
});

test("break-glass fence requests use a separate endpoint, key header, and bounded intent", () => {
  const request = buildRecoveryFenceRequest({
    url: "https://coordination.example.test",
    recoverySecret: "recovery-secret",
    recoveryKeyId: "recovery-v1",
    recoveryId: "github:repo:run-1",
    expectedAuthorityEpoch: 7,
    nonce: "r".repeat(32),
    requestedAt: "2026-08-09T18:00:00.000Z",
  });
  assert.equal(request.endpoint.pathname, "/v1/recovery");
  assert.equal(request.body.action, "fence");
  assert.equal(request.body.request.expectedAuthorityEpoch, 7);
  assert.equal(request.headers["x-skincos-coordination-recovery-key-id"], "recovery-v1");
  assert.throws(() => buildRecoveryFenceRequest({ url: "https://coordination.example.test", recoveryId: "x" }), /recovery custody/);
  assert.throws(() => buildRecoveryFenceRequest({
    url: "https://coordination.example.test",
    recoverySecret: "recovery-secret",
    recoveryId: "github:repo:run-1",
    expectedAuthorityEpoch: 0,
  }), /authority epoch is invalid/);
});

test("lease proofs and conflict scopes remain normalized across adapters", () => {
  assert.match(newRequestNonce(), /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(lockScopeForResource("CLOUDFLARE:Website:Staging"), "surface:website:staging");
  assert.deepEqual(proofForLease({
    resource: "DEPLOY:Website:Staging",
    leaseId: "lease-0000000000000001",
    fencingToken: 2,
    intentDigest: "b".repeat(64),
    owner: { provider: "github", missionId: "mission-1", threadId: "thread-1", actor: "actions" },
  }), {
    resource: "deploy:website:staging",
    leaseId: "lease-0000000000000001",
    fencingToken: 2,
    intentDigest: "b".repeat(64),
    owner: { provider: "github", missionId: "mission-1", threadId: "thread-1", actor: "actions" },
  });
});
