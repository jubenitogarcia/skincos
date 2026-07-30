import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createRootCustody,
  rootCustodyPayloadDigest,
  validateRootCustody,
} from "./ponto-root-custody.mjs";

const releaseSha = "a".repeat(40);
const root = (character) => character.repeat(48);
const attestationKey = root("k");
const custodyRef = (character) => `vault:v1:${character.repeat(43)}`;
const stagingCustody = {
  profileCustodyRef: custodyRef("p"),
  idempotencyCustodyRef: custodyRef("i"),
  attestationKeyId: custodyRef("k"),
};
const productionCustody = {
  profileCustodyRef: custodyRef("q"),
  idempotencyCustodyRef: custodyRef("j"),
  attestationKeyId: custodyRef("k"),
};

test("staging attestation proves within-environment separation without values", () => {
  const attestation = createRootCustody({
    target: "staging",
    releaseSha,
    profileRoot: root("p"),
    idempotencyRoot: root("i"),
    attestationKey,
    ...stagingCustody,
  });
  assert.equal(attestation.distinctWithinTarget, true);
  assert.equal(attestation.distinctFromStaging, null);
  assert.equal(attestation.profileDigest.length, 64);
  assert.equal(attestation.idempotencyDigest.length, 64);
  assert.equal(attestation.attestationKeyCommitment.length, 64);
  assert.equal(JSON.stringify(attestation).includes(root("p")), false);
  assert.equal(JSON.stringify(attestation).includes(root("i")), false);
});

test("equal profile and idempotency roots are rejected in constant-time path", () => {
  assert.throws(() => createRootCustody({
    target: "staging",
    releaseSha,
    profileRoot: root("x"),
    idempotencyRoot: root("x"),
    attestationKey,
    ...stagingCustody,
  }), /distinct and non-reused/);
});

test("production requires a valid staging attestation", () => {
  assert.throws(() => createRootCustody({
    target: "production",
    releaseSha,
    profileRoot: root("p"),
    idempotencyRoot: root("i"),
    attestationKey,
    ...productionCustody,
  }), /root custody attestation/);
});

test("production rejects same-purpose and cross-purpose staging root reuse", () => {
  const staging = createRootCustody({
    target: "staging",
    releaseSha,
    profileRoot: root("p"),
    idempotencyRoot: root("i"),
    attestationKey,
    ...stagingCustody,
  });
  assert.throws(() => createRootCustody({
    target: "production",
    releaseSha,
    profileRoot: root("p"),
    idempotencyRoot: root("z"),
    attestationKey,
    ...productionCustody,
    stagingAttestation: staging,
  }), /distinct and non-reused/);
  assert.throws(() => createRootCustody({
    target: "production",
    releaseSha,
    profileRoot: root("z"),
    idempotencyRoot: root("p"),
    attestationKey,
    ...productionCustody,
    stagingAttestation: staging,
  }), /distinct and non-reused/);
});

test("distinct production roots validate against the exact staging release", () => {
  const staging = createRootCustody({
    target: "staging",
    releaseSha,
    profileRoot: root("p"),
    idempotencyRoot: root("i"),
    attestationKey,
    ...stagingCustody,
  });
  const production = createRootCustody({
    target: "production",
    releaseSha,
    profileRoot: root("q"),
    idempotencyRoot: root("j"),
    attestationKey,
    ...productionCustody,
    stagingAttestation: staging,
  });
  assert.equal(production.distinctFromStaging, true);
  assert.equal(validateRootCustody(production, {
    target: "production",
    releaseSha,
  }), production);
});

test("production rejects a rotated shared attestation key even when metadata is unchanged", () => {
  const staging = createRootCustody({
    target: "staging",
    releaseSha,
    profileRoot: root("p"),
    idempotencyRoot: root("i"),
    attestationKey,
    ...stagingCustody,
  });
  assert.throws(() => createRootCustody({
    target: "production",
    releaseSha,
    profileRoot: root("q"),
    idempotencyRoot: root("j"),
    attestationKey: root("r"),
    ...productionCustody,
    stagingAttestation: staging,
  }), /exact same shared attestation key version/);
});

test("durable provenance binds the raw attestation digest and rejects tampering", () => {
  const attestation = createRootCustody({
    target: "staging",
    releaseSha,
    profileRoot: root("p"),
    idempotencyRoot: root("i"),
    attestationKey,
    ...stagingCustody,
  });
  const durable = {
    ...attestation,
    provenance: {
      workflowRunId: "201",
      coordinatorRunId: "200",
      workflowPath: ".github/workflows/cloudflare-workers-sync-ponto-secrets.yml",
      artifactId: "202",
      artifactDigest: "9".repeat(64),
      attestationSha256: rootCustodyPayloadDigest(attestation),
      artifactName: `ponto-root-custody-staging-${releaseSha}`,
      repository: "skincos/skincos",
    },
  };
  assert.equal(validateRootCustody(durable, {
    target: "staging",
    releaseSha,
    requireProvenance: true,
    repository: "skincos/skincos",
  }), durable);
  assert.throws(() => validateRootCustody({
    ...durable,
    profileDigest: "f".repeat(64),
  }, {
    target: "staging",
    releaseSha,
    requireProvenance: true,
    repository: "skincos/skincos",
  }), /durable provenance is invalid/);
});

test("weak roots, wrong release and forged comparison claims are rejected", () => {
  assert.throws(() => createRootCustody({
    target: "staging",
    releaseSha,
    profileRoot: "short",
    idempotencyRoot: root("i"),
    attestationKey,
    ...stagingCustody,
  }), /at least 32/);
  const staging = createRootCustody({
    target: "staging",
    releaseSha,
    profileRoot: root("p"),
    idempotencyRoot: root("i"),
    attestationKey,
    ...stagingCustody,
  });
  assert.throws(() => validateRootCustody({
    ...staging,
    distinctFromStaging: true,
  }, { target: "staging", releaseSha }), /cannot claim/);
  assert.throws(() => validateRootCustody(staging, {
    target: "staging",
    releaseSha: "b".repeat(40),
  }), /release SHA differs/);
  assert.throws(() => validateRootCustody({
    ...staging,
    unexpected: "must-not-enter-evidence",
  }, { target: "staging", releaseSha }), /unknown or missing fields/);
});

test("real CLI writes a sanitized owner-only file and fails closed without custody inputs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ponto-root-custody-"));
  const output = path.join(directory, "custody.json");
  const script = fileURLToPath(new URL("./ponto-root-custody.mjs", import.meta.url));
  const cliEnv = {
    ...process.env,
    PONTO_PROFILE_DATA_KEY: root("p"),
    PONTO_IDEMPOTENCY_KEY: root("i"),
    PONTO_ROOT_ATTESTATION_KEY_SHARED: attestationKey,
    PONTO_PROFILE_DATA_KEY_CUSTODY_REF: stagingCustody.profileCustodyRef,
    PONTO_IDEMPOTENCY_KEY_CUSTODY_REF: stagingCustody.idempotencyCustodyRef,
    PONTO_ROOT_ATTESTATION_KEY_ID: stagingCustody.attestationKeyId,
  };
  try {
    const success = spawnSync(process.execPath, [
      script, "write", "staging", releaseSha, output,
    ], { env: cliEnv, encoding: "utf8" });
    assert.equal(success.status, 0, success.stderr);
    assert.match(success.stdout, /values were not printed/);
    const stat = fs.statSync(output);
    assert.equal(stat.mode & 0o077, 0);
    const contents = fs.readFileSync(output, "utf8");
    assert.equal(contents.includes(root("p")), false);
    assert.equal(contents.includes(root("i")), false);
    assert.equal(contents.includes(attestationKey), false);

    const missingKey = spawnSync(process.execPath, [
      script, "write", "staging", releaseSha, path.join(directory, "missing-key.json"),
    ], {
      env: { ...cliEnv, PONTO_ROOT_ATTESTATION_KEY_SHARED: "" },
      encoding: "utf8",
    });
    assert.notEqual(missingKey.status, 0);
    assert.match(missingKey.stderr, /PONTO_ROOT_ATTESTATION_KEY_SHARED/);

    const missingRef = spawnSync(process.execPath, [
      script, "write", "staging", releaseSha, path.join(directory, "missing-ref.json"),
    ], {
      env: { ...cliEnv, PONTO_PROFILE_DATA_KEY_CUSTODY_REF: "" },
      encoding: "utf8",
    });
    assert.notEqual(missingRef.status, 0);
    assert.match(missingRef.stderr, /profileCustodyRef/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
