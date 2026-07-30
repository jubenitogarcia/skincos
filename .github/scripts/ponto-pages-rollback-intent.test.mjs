import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  completePagesRollbackIntent,
  createPagesRollbackIntent,
  readPagesRollbackIntent,
  recordCreatedPagesRollbackIntent,
} from "./ponto-pages-rollback-intent.mjs";

const repository = "owner/repo";
const sourceSha = "a".repeat(40);
const restoredId = "33333333-3333-4333-8333-333333333333";
const secret = "pages-rollback-intent-hmac-root-".repeat(2);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
  );
};
const signClaims = (claims) =>
  crypto.createHmac("sha256", secret)
    .update(JSON.stringify(canonicalize(claims)))
    .digest("hex");

function harness({ throwAfterCreate = false, competeAfterPatch = false } = {}) {
  let check = null;
  let nextId = 100;
  let createThrown = false;
  const request = async (pathname, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    if (pathname.includes("/commits/") && pathname.includes("/check-runs?")) {
      return { check_runs: check ? [check] : [] };
    }
    if (pathname === `/repos/${repository}/check-runs` && method === "POST") {
      const body = JSON.parse(init.body);
      check = {
        id: nextId += 1,
        ...body,
        conclusion: null,
        app: { slug: "github-actions", id: 7 },
      };
      if (throwAfterCreate && !createThrown) {
        createThrown = true;
        throw new Error("simulated transport loss after Check Run persistence");
      }
      return structuredClone(check);
    }
    if (pathname === `/repos/${repository}/check-runs/${check?.id}` && method === "PATCH") {
      const body = JSON.parse(init.body);
      check = { ...check, ...body };
      if (competeAfterPatch) {
        const document = JSON.parse(check.output.summary);
        document.claims.state = "restored";
        document.claims.restoredAt = "2026-07-30T00:04:00.000Z";
        document.signatureHmacSha256 = signClaims(document.claims);
        check = {
          ...check,
          status: "completed",
          conclusion: "success",
          output: { ...check.output, summary: JSON.stringify(document) },
        };
      }
      return structuredClone(check);
    }
    if (pathname === `/repos/${repository}/check-runs/${check?.id}`) {
      return structuredClone(check);
    }
    throw new Error(`unexpected GitHub request ${method} ${pathname}`);
  };
  return {
    request,
    check: () => check,
    tamper: (mutate) => mutate(check),
  };
}

const input = (request) => ({
  request,
  secret,
  repositoryId: "42",
  repository,
  coordinatorRunId: "99",
  sourceSha,
  stage: "production",
  project: "skincos",
  branch: "main",
  alias: "crm.skincos.com.br",
  candidateDeploymentId: "11111111-1111-4111-8111-111111111111",
  incumbentDeploymentId: "22222222-2222-4222-8222-222222222222",
});

test("durable one-shot intent survives created and restored transitions", async () => {
  const fixture = harness();
  let intent = await createPagesRollbackIntent({
    ...input(fixture.request),
    recoveryRunId: "700",
    now: new Date("2026-07-30T00:00:00Z"),
  });
  assert.equal(intent.created, true);
  assert.equal(intent.claims.state, "attempted");
  const loaded = await readPagesRollbackIntent(input(fixture.request));
  assert.equal(loaded.checkId, intent.checkId);
  assert.equal(loaded.claims.state, "attempted");

  intent = await recordCreatedPagesRollbackIntent({
    request: fixture.request,
    secret,
    intent,
    restoredDeploymentId: restoredId,
  });
  assert.equal(intent.claims.state, "created");
  assert.equal(intent.claims.restoredDeploymentId, restoredId);
  assert.equal(fixture.check().status, "in_progress");

  intent = await completePagesRollbackIntent({
    request: fixture.request,
    secret,
    intent,
    restoredDeploymentId: restoredId,
    now: new Date("2026-07-30T00:02:00Z"),
  });
  assert.equal(intent.claims.state, "restored");
  assert.equal(fixture.check().status, "completed");
  assert.equal(fixture.check().conclusion, "success");
});

test("existing attempted intent is loaded rather than recreated and HMAC tampering fails closed", async () => {
  const fixture = harness();
  const created = await createPagesRollbackIntent({
    ...input(fixture.request),
    recoveryRunId: "700",
  });
  const repeated = await createPagesRollbackIntent({
    ...input(fixture.request),
    recoveryRunId: "701",
  });
  assert.equal(repeated.created, false);
  assert.equal(repeated.checkId, created.checkId);
  fixture.tamper((check) => {
    const document = JSON.parse(check.output.summary);
    document.claims.candidateDeploymentId =
      "44444444-4444-4444-8444-444444444444";
    check.output.summary = JSON.stringify(document);
  });
  await assert.rejects(
    readPagesRollbackIntent(input(fixture.request)),
    /claims or HMAC differ/,
  );
});

test("indeterminate Check Run creation reconciles the exact same recovery intent", async () => {
  const fixture = harness({ throwAfterCreate: true });
  const intent = await createPagesRollbackIntent({
    ...input(fixture.request),
    recoveryRunId: "700",
    now: new Date("2026-07-30T00:00:00Z"),
  });
  assert.equal(intent.created, true);
  assert.equal(intent.reconciledAfterIndeterminateCreate, true);
  assert.equal(intent.claims.state, "attempted");
  assert.equal(intent.claims.recoveryRunId, "700");
});

test("transition readback rejects a valid competing state", async () => {
  const fixture = harness({ competeAfterPatch: true });
  const intent = await createPagesRollbackIntent({
    ...input(fixture.request),
    recoveryRunId: "700",
  });
  await assert.rejects(
    recordCreatedPagesRollbackIntent({
      request: fixture.request,
      secret,
      intent,
      restoredDeploymentId: restoredId,
    }),
    /competing transition detected/,
  );
});
