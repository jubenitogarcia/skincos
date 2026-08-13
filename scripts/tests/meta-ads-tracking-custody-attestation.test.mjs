import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  META_ADS_CUSTODY_OIDC_ISSUER,
  META_ADS_CUSTODY_REPOSITORY,
  META_ADS_CUSTODY_REPOSITORY_ID,
  META_ADS_CUSTODY_WORKFLOW_REF,
  approvalRecordPath,
  custodyOidcAudience,
  readRuntimeApproval,
  verifyGithubOidcAttestation,
  writeRuntimeApproval,
} from "../runtime/meta-ads-tracking-custody-attestation.mjs";

const releaseSha = "a".repeat(40);
const sourceSha = "b".repeat(40);
const workflowSha = "c".repeat(40);

const encoded = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

const signedOidcFixture = ({ claims = {}, header = {} } = {}) => {
  const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = { alg: "RS256", typ: "JWT", kid: "meta-ads-test-key", ...header };
  const payload = {
    iss: META_ADS_CUSTODY_OIDC_ISSUER,
    aud: custodyOidcAudience(releaseSha),
    repository: META_ADS_CUSTODY_REPOSITORY,
    repository_id: META_ADS_CUSTODY_REPOSITORY_ID,
    ref: "refs/heads/main",
    ref_type: "branch",
    environment: "production",
    event_name: "workflow_dispatch",
    runner_environment: "self-hosted",
    workflow_ref: META_ADS_CUSTODY_WORKFLOW_REF,
    workflow_sha: workflowSha,
    sha: sourceSha,
    run_id: "123456789",
    run_attempt: "1",
    iat: now - 15,
    nbf: now - 15,
    exp: now + 240,
    ...claims,
  };
  const signingInput = `${encoded(jwtHeader)}.${encoded(payload)}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput, "ascii"), pair.privateKey).toString("base64url");
  const publicJwk = pair.publicKey.export({ format: "jwk" });
  return {
    now: new Date(now * 1000),
    token: `${signingInput}.${signature}`,
    jwks: { keys: [{ kty: "RSA", alg: "RS256", use: "sig", kid: jwtHeader.kid, n: publicJwk.n, e: publicJwk.e }] },
  };
};

const verify = async (fixture, overrides = {}) => verifyGithubOidcAttestation({
  token: fixture.token,
  releaseSha,
  runId: "123456789",
  runAttempt: "1",
  now: fixture.now,
  fetchJwks: async () => fixture.jwks,
  ...overrides,
});

test("GitHub OIDC custody attestation binds the fixed production workflow, exact run, and candidate release", async () => {
  const fixture = signedOidcFixture();
  const approval = await verify(fixture);
  assert.deepEqual(approval, {
    schemaVersion: 2,
    releaseSha,
    runId: "123456789",
    runAttempt: 1,
    repository: META_ADS_CUSTODY_REPOSITORY,
    repositoryId: META_ADS_CUSTODY_REPOSITORY_ID,
    workflowRef: META_ADS_CUSTODY_WORKFLOW_REF,
    workflowSha,
    sourceSha,
    audience: custodyOidcAudience(releaseSha),
    issuedAt: Math.floor(fixture.now.getTime() / 1000) - 15,
    expiresAt: Math.floor(fixture.now.getTime() / 1000) + 240,
  });
});

test("OIDC custody attestation rejects a token bound to another immutable release while allowing a later workflow SHA", async () => {
  const fixture = signedOidcFixture({
    claims: {
      // The dispatch workflow source can be newer than the immutable candidate;
      // the audience, not this claim, authorizes the release transition.
      sha: sourceSha,
      aud: custodyOidcAudience(sourceSha),
    },
  });
  await assert.rejects(verify(fixture), { code: "oidc_release_binding_invalid" });

  const approvedAncestor = signedOidcFixture({ claims: { sha: sourceSha } });
  const approval = await verify(approvedAncestor);
  assert.equal(approval.releaseSha, releaseSha);
  assert.equal(approval.sourceSha, sourceSha);
  assert.equal(approval.audience, custodyOidcAudience(releaseSha));
});

test("OIDC custody attestation rejects a changed workflow, retry, and forged signature", async () => {
  await assert.rejects(
    verify(signedOidcFixture({ claims: { workflow_ref: "jubenitogarcia/skincos/.github/workflows/other.yml@refs/heads/main" } })),
    { code: "oidc_provenance_invalid" },
  );
  const retried = signedOidcFixture({ claims: { run_attempt: "2" } });
  await assert.rejects(
    verify(retried, { runAttempt: "2" }),
    { code: "workflow_rerun_forbidden" },
  );
  const forged = signedOidcFixture();
  const [forgedHeader, forgedPayload, forgedSignature] = forged.token.split(".");
  const replacement = forgedSignature.startsWith("a") ? "b" : "a";
  await assert.rejects(
    verify({ ...forged, token: `${forgedHeader}.${forgedPayload}.${replacement}${forgedSignature.slice(1)}` }),
    { code: "oidc_signature_invalid" },
  );
});

test("root-owned runtime approval cannot be replayed for another release, run, or after expiry", async () => {
  const fixture = signedOidcFixture();
  const approval = await verify(fixture);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "meta-ads-custody-approval-"));
  fs.chmodSync(directory, 0o700);
  const options = { directory, ownerUid: process.getuid(), ownerGid: process.getgid(), now: fixture.now };
  try {
    const record = writeRuntimeApproval(approval, options);
    assert.equal(record, approvalRecordPath(approval, { directory }));
    const metadata = fs.lstatSync(record);
    assert.equal(metadata.mode & 0o777, 0o600);
    assert.equal(metadata.uid, process.getuid());
    assert.equal(metadata.gid, process.getgid());
    assert.equal(readRuntimeApproval({ releaseSha, runId: "123456789", runAttempt: "1", ...options }).releaseSha, releaseSha);
    assert.throws(
      () => readRuntimeApproval({ releaseSha: sourceSha, runId: "123456789", runAttempt: "1", ...options }),
      { code: "approval_unavailable" },
    );
    assert.throws(
      () => readRuntimeApproval({ releaseSha, runId: "123456790", runAttempt: "1", ...options }),
      { code: "approval_unavailable" },
    );
    assert.throws(
      () => readRuntimeApproval({ releaseSha, runId: "123456789", runAttempt: "1", ...options, now: new Date((approval.expiresAt + 1) * 1000) }),
      { code: "approval_expired" },
    );
    fs.chmodSync(directory, 0o750);
    assert.throws(
      () => readRuntimeApproval({ releaseSha, runId: "123456789", runAttempt: "1", ...options }),
      { code: "approval_directory_metadata_invalid" },
    );
  } finally {
    fs.chmodSync(directory, 0o700);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
