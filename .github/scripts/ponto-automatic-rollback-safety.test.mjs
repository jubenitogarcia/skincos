import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("./ponto-automatic-rollback.mjs", import.meta.url),
  "utf8",
);

test("live broker fail-close is attested before any rollback mutation and re-read after", () => {
  const preAttestation = source.indexOf(
    "const preMutationFailClose = readAndAttestBrokerFailClose();",
  );
  const permission = source.indexOf("const rollbackPermitted =");
  const workerMutation = source.indexOf('const rollback = spawnSync("npx"');
  const pagesMutation = source.indexOf(
    "const rolledBack = await rollbackPagesWithReconciliation",
  );
  const postAttestation = source.indexOf(
    "const postMutationFailClose = readAndAttestBrokerFailClose();",
  );
  for (const position of [
    preAttestation,
    permission,
    workerMutation,
    pagesMutation,
    postAttestation,
  ]) {
    assert.notEqual(position, -1);
  }
  assert.ok(preAttestation < permission);
  assert.ok(permission < workerMutation);
  assert.ok(permission < pagesMutation);
  assert.ok(workerMutation < postAttestation);
  assert.ok(pagesMutation < postAttestation);
  assert.match(
    source.slice(permission, workerMutation),
    /&& preMutationFailClose\.attestation\.passed/,
  );
});

test("Pages rollback intent has dedicated environment-only custody", () => {
  assert.match(source, /PONTO_PAGES_ROLLBACK_INTENT_HMAC_KEY/);
  assert.doesNotMatch(source, /PONTO_ORCHESTRATOR_LEASE_HMAC_KEY/);
});
