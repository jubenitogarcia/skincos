import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  execute,
  loadConfiguration,
} from "./ponto-production-slo-preflight.mjs";

const sha = "a".repeat(40);
const uuid = "11111111-1111-4111-8111-111111111111";
const root = "production-idempotency-root-".repeat(2);
const runnerKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const runnerPublicPem = runnerKeys.publicKey.export({ type: "spki", format: "pem" });
const runnerPublicFingerprint = crypto.createHash("sha256")
  .update(runnerKeys.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const policy = {
  pilotRunner: {
    production: {
      runnerId: "789",
      runnerName: "ponto-clinic-1",
      runnerIsolationRef: "ponto-pilot-isolation",
      requiredLabels: ["self-hosted", "Linux", "X64", "ponto-pilot"],
      networkContextCustodyRef: "approved-network-context-ref",
      encryptionPublicKeySha256: runnerPublicFingerprint,
    },
  },
};

const environment = (directory, stage = "pilot") => ({
  PONTO_RELEASE_SHA: sha,
  PONTO_RELEASE_STAGE: stage,
  PONTO_ORCHESTRATOR_STAGE: stage,
  PONTO_ORCHESTRATOR_RUN_ID: "123",
  GITHUB_RUN_ID: "456",
  CLOUDFLARE_ACCOUNT_ID: "c".repeat(32),
  CLOUDFLARE_API_TOKEN: "broad-token-confined-to-protected-hosted-job",
  CLOUDFLARE_PAGES_PROJECT: "skincos",
  PONTO_SLO_PREFLIGHT_DIR: directory,
  PONTO_EXPECTED_CORE_VERSION_ID: uuid,
  PONTO_EXPECTED_TIMEKEEPING_VERSION_ID: uuid,
  PONTO_EXPECTED_IDENTITY_VERSION_ID: uuid,
  PONTO_EXPECTED_PAGES_DEPLOYMENT_ID: uuid,
  PONTO_IDEMPOTENCY_KEY: root,
  PONTO_PILOT_RUNNER_ENCRYPTION_PUBLIC_KEY_PEM: runnerPublicPem,
});

const pagesResponse = () => new Response(JSON.stringify({
  success: true,
  result: {
    id: uuid,
    project_name: "skincos",
    environment: "production",
    aliases: ["https://crm.skincos.com.br"],
    latest_stage: { name: "deploy", status: "success", ended_on: "2026-07-30T00:00:00.000Z" },
    is_skipped: false,
    deployment_trigger: {
      metadata: {
        branch: "main",
        commit_hash: sha,
      },
    },
  },
}), { status: 200, headers: { "content-type": "application/json" } });

for (const stage of ["pilot", "canary"]) {
  test(`${stage} preflight emits a body/SHA/stage/coordinator-bound one-time capability without roots`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-slo-preflight-"));
    try {
      const result = await execute({
        env: environment(directory, stage),
        fetchImpl: async (_url, init) => {
          assert.equal(init.headers.authorization, "Bearer broad-token-confined-to-protected-hosted-job");
          return pagesResponse();
        },
        now: new Date("2026-07-30T12:00:00.000Z"),
        randomBytes: (size) => Buffer.alloc(size, 0x11),
        policy,
      });
      assert.equal(result.controlPlane.passed, true);
      assert.equal(result.controlPlane.sourceSha, sha);
      assert.equal(result.controlPlane.pilotRunnerId, "789");
      assert.equal(result.probeCapability.stage, stage);
      assert.equal(result.probeCapability.bodyDigestBoundAtUse, true);
      assert.equal(result.probeCapability.bodyDigestIncluded, false);
      assert.equal(result.probeCapability.rootKeyIncluded, false);
      assert.equal(result.probeCapability.delegatedSigningKeyIncluded, false);
      assert.equal(result.probeCapability.encryptedDelegatedSigningKeyIncluded, true);
      const capabilityText = fs.readFileSync(result.probeCapabilityFile, "utf8");
      assert.equal(capabilityText.includes(root), false);
      assert.equal(capabilityText.includes("broad-token"), false);
      assert.equal(Object.hasOwn(result.probeCapability, "delegatedKey"), false);
      const decryptedDelegatedKey = crypto.privateDecrypt({
        key: runnerKeys.privateKey,
        oaepHash: "sha256",
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      }, Buffer.from(result.probeCapability.encryptedDelegatedKey, "base64")).toString("utf8");
      assert.equal(
        crypto.createHash("sha256").update(decryptedDelegatedKey).digest("hex"),
        result.probeCapability.delegatedKeyCommitment,
      );
      const releaseProbeKey = crypto
        .createHmac("sha256", root)
        .update("skincos/ponto/release-probe/v1")
        .digest("base64url");
      const expectedMessage = [
        "ponto-release-probe-delegation/v1",
        result.probeCapability.delegationTimestamp,
        result.probeCapability.delegationExpiresAt,
        result.probeCapability.nonce,
        "POST",
        "/api/ponto/_release-contract",
        sha,
        stage,
        "123",
        "456",
        result.probeCapability.delegatedKeyCommitment,
      ].join(".");
      assert.equal(
        result.probeCapability.delegationSignature,
        crypto.createHmac("sha256", releaseProbeKey).update(expectedMessage).digest("base64url"),
      );
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("production control-plane preflight neither requires nor emits release-probe signing custody", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-slo-preflight-production-"));
  try {
    const env = environment(directory, "production");
    delete env.PONTO_IDEMPOTENCY_KEY;
    const result = await execute({ env, fetchImpl: async () => pagesResponse(), policy });
    assert.equal(result.probeCapability, null);
    assert.equal(result.probeCapabilityFile, "");
    assert.equal(fs.existsSync(path.join(directory, "release-probe-capability.json")), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("preflight refuses a mismatched stage, project, signing root, or non-terminal Pages deployment", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-slo-preflight-refuse-"));
  try {
    assert.throws(
      () => loadConfiguration({ ...environment(directory), PONTO_ORCHESTRATOR_STAGE: "canary" }, policy),
      /identity is invalid/,
    );
    assert.throws(
      () => loadConfiguration({ ...environment(directory), CLOUDFLARE_PAGES_PROJECT: "other" }, policy),
      /identity is invalid/,
    );
    assert.throws(
      () => loadConfiguration({ ...environment(directory), PONTO_IDEMPOTENCY_KEY: "too-short" }, policy),
      /signing custody is invalid/,
    );
    await assert.rejects(
      () => execute({
        env: environment(directory),
        policy,
        fetchImpl: async () => new Response(JSON.stringify({
          success: true,
          result: {
            id: uuid,
            project_name: "skincos",
            environment: "production",
            aliases: ["https://crm.skincos.com.br"],
            latest_stage: { status: "active" },
            deployment_trigger: { metadata: { branch: "main", commit_hash: sha } },
          },
        }), { status: 200 }),
      }),
      /exact terminal Pages candidate/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
