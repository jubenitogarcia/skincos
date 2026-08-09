import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {
  buildAuthenticatedRequest,
  lockScopeForResource,
  newRequestNonce,
  proofForLease,
  verifyCoordinatorResponse,
} from "../codex-global-coordination-client.mjs";
import { canonicalJson, CONTRACT_ID } from "../../ops/governance/global-coordination-core.mjs";

const secret = "test-coordination-secret";
const nonce = "n".repeat(32);

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
      nonce,
      requestedAt: "2026-08-09T18:00:00.000Z",
  });
  assert.equal(request.endpoint.pathname, "/v1/leases");
  assert.equal(request.body.contractId, CONTRACT_ID);
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
