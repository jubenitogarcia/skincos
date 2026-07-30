import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { attestClinicRunner } from "./ponto-clinic-runner-attestation.mjs";

const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" });
const fingerprint = crypto.createHash("sha256")
  .update(keys.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const runner = {
  runnerId: "123",
  runnerName: "clinic-runner-1",
  runnerIsolationRef: "isolated-clinic-network-v1",
  requiredLabels: ["self-hosted", "Linux", "X64", "ponto-pilot"],
  networkContextCustodyRef: "network-context-custody-v1",
  encryptionPublicKeySha256: fingerprint,
};
const policy = { pilotRunner: { staging: runner, production: runner } };
const env = {
  PONTO_RESOURCE_TARGET: "production",
  RUNNER_NAME: runner.runnerName,
  RUNNER_OS: "Linux",
  RUNNER_ARCH: "X64",
};

test("attests exact runner name, isolation, network custody, and RSA proof of possession", () => {
  const report = attestClinicRunner({
    env,
    policy,
    privateKeyPem,
    now: new Date("2026-07-30T12:00:00.000Z"),
  });
  assert.equal(report.passed, true);
  assert.equal(report.runnerId, "123");
  assert.equal(report.encryptionPublicKeySha256, fingerprint);
  assert.equal(JSON.stringify(report).includes(privateKeyPem), false);
});

test("fails closed on policy nulls, copied labels metadata, custody drift, or a swapped private key", () => {
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const cases = [
    [{ ...env, RUNNER_NAME: "copied-runner" }, policy, privateKeyPem],
    [{ ...env, RUNNER_OS: "Windows" }, policy, privateKeyPem],
    [{ ...env, RUNNER_ARCH: "ARM64" }, policy, privateKeyPem],
    [env, policy, other.privateKey.export({ type: "pkcs8", format: "pem" })],
    [env, { pilotRunner: { production: {
      runnerId: null,
      runnerName: null,
      runnerIsolationRef: null,
      requiredLabels: null,
      networkContextCustodyRef: null,
      encryptionPublicKeySha256: null,
    } } }, privateKeyPem],
  ];
  for (const [candidateEnv, candidatePolicy, candidateKey] of cases) {
    assert.throws(
      () => attestClinicRunner({
        env: candidateEnv,
        policy: candidatePolicy,
        privateKeyPem: candidateKey,
      }),
      /identity or policy-pinned custody differs/,
    );
  }
});

test("refuses a decrypt key supplied through runner environment", () => {
  assert.throws(
    () => attestClinicRunner({
      env: { ...env, PONTO_PILOT_RUNNER_ENCRYPTION_PRIVATE_KEY_PEM: privateKeyPem },
      policy,
      privateKeyPem,
    }),
    /private key in process environment is forbidden/,
  );
});
