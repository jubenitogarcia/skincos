import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertAtendimentoCrmCoreProjectionBackfillBinding,
  assertAtendimentoCrmCoreProjectionBackfillBindingFiles,
} from "./atendimento-crm-core-projection-backfill-binding.mjs";

function authorization() {
  return {
    authorizationId: "11111111-1111-4111-8111-111111111111",
    workflowRunId: "34519867372",
    runAttempt: 1,
    sourceSha: "a".repeat(40),
    admissionPlanSha256: "b".repeat(64),
    coreRepository: "jubenitogarcia/skincos-crm-core",
    coreRepositoryId: "1353934107",
    coreReleaseSha: "c".repeat(40),
    coreArtifactDigest: `sha256:${"d".repeat(64)}`,
    coreArtifactRunId: "34519867370",
    coreReadbackDigest: `sha256:${"e".repeat(64)}`,
    coreReadbackRunId: "34519867371",
  };
}

function receipt() {
  const expected = authorization();
  return {
    receiptId: expected.authorizationId,
    authorizationId: expected.authorizationId,
    workflowRunId: expected.workflowRunId,
    runAttempt: expected.runAttempt,
    sourceSha: expected.sourceSha,
    admissionPlanSha256: expected.admissionPlanSha256,
    target: {
      repository: expected.coreRepository,
      repositoryId: expected.coreRepositoryId,
      release: expected.coreReleaseSha,
      artifactDigest: expected.coreArtifactDigest,
      artifactRunId: expected.coreArtifactRunId,
      readbackDigest: expected.coreReadbackDigest,
      readbackRunId: expected.coreReadbackRunId,
    },
  };
}

test("accepts a receipt bound to every one-use custody authorization field", () => {
  assert.equal(assertAtendimentoCrmCoreProjectionBackfillBinding({ authorization: authorization(), receipt: receipt() }), true);
});

test("rejects every source, Core, workflow, and authorization substitution", () => {
  const mutations = [
    (value) => { value.receiptId = "22222222-2222-4222-8222-222222222222"; },
    (value) => { value.workflowRunId = "999"; },
    (value) => { value.runAttempt = 2; },
    (value) => { value.sourceSha = "f".repeat(40); },
    (value) => { value.admissionPlanSha256 = "1".repeat(64); },
    (value) => { value.target.repository = "attacker/core"; },
    (value) => { value.target.repositoryId = "999"; },
    (value) => { value.target.release = "2".repeat(40); },
    (value) => { value.target.artifactDigest = `sha256:${"3".repeat(64)}`; },
    (value) => { value.target.artifactRunId = "999"; },
    (value) => { value.target.readbackDigest = `sha256:${"4".repeat(64)}`; },
    (value) => { value.target.readbackRunId = "998"; },
  ];
  for (const mutate of mutations) {
    const actual = receipt();
    mutate(actual);
    assert.throws(
      () => assertAtendimentoCrmCoreProjectionBackfillBinding({ authorization: authorization(), receipt: actual }),
      /ATENDIMENTO_CRM_CORE_BACKFILL_BINDING_RECEIPT_AUTHORIZATION_MISMATCH/,
    );
  }
});

test("file adapter reads only local JSON and does not accept malformed input", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "atendimento-crm-core-binding-"));
  const authorizationFile = path.join(directory, "authorization.json");
  const receiptFile = path.join(directory, "receipt.json");
  try {
    fs.writeFileSync(authorizationFile, JSON.stringify(authorization()));
    fs.writeFileSync(receiptFile, JSON.stringify(receipt()));
    assert.equal(assertAtendimentoCrmCoreProjectionBackfillBindingFiles(authorizationFile, receiptFile), true);
    fs.writeFileSync(receiptFile, "not-json");
    assert.throws(
      () => assertAtendimentoCrmCoreProjectionBackfillBindingFiles(authorizationFile, receiptFile),
      /ATENDIMENTO_CRM_CORE_BACKFILL_BINDING_RECEIPT_JSON_INVALID/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
