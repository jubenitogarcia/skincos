import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("./ponto-automatic-rollback.mjs", import.meta.url),
  "utf8",
);

test("live broker fail-close is attested before any rollback mutation and re-read after", () => {
  const preAttestation = source.indexOf(
    "const preMutationFailClose = await readAndAttestBrokerFailClose();",
  );
  const permission = source.indexOf("const rollbackPermitted =");
  const workerMutation = source.indexOf('const rollback = spawnSync("npx"');
  const pagesMutation = source.indexOf(
    "const rolledBack = await rollbackPagesWithReconciliation",
  );
  const postAttestation = source.indexOf(
    "const postMutationFailClose = await readAndAttestBrokerFailClose();",
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

test("broker custody readback uses the account-scoped Cloudflare API", () => {
  assert.match(source, /readCloudflareKvJson/);
  assert.doesNotMatch(source, /const readRemoteModuleKey = \(key\) => spawnSync\("npx"/);
});

test("broker readback diagnostics expose only a bounded mismatch category", () => {
  assert.match(source, /classifyBrokerReadback/);
  assert.match(source, /readbackFailure: readbackFailure \|\| classifyBrokerReadback/);
  assert.doesNotMatch(source, /readbackFailure:\s*moduleControl/);
});

test("zero-surface recovery uses a fresh external maintenance probe instead of faking rollback", () => {
  assert.match(source, /PONTO_MODULE_HEALTH_URL/);
  assert.match(source, /Object\.keys\(plan\)\.length !== 0/);
  assert.match(source, /readbackMode: "external-health-noop"/);
  assert.match(source, /rollbackDisposition/);
  assert.match(source, /no-dispatched-surface-noop/);
});

test("composite rollback attestation waits for public propagation while maintenance remains required", () => {
  const start = source.indexOf("const compositeHealthUrl = staging");
  const end = source.indexOf("// Re-read after every mutation", start);
  assert.ok(start >= 0 && end > start, "composite rollback attestation block is absent");
  const block = source.slice(start, end);
  assert.match(block, /const maxCompositeAttempts = 36/);
  assert.match(block, /for \(let attempt = 1; attempt <= maxCompositeAttempts; attempt \+= 1\)/);
  assert.match(block, /availability\?\.state === "maintenance"/);
  assert.match(block, /x-skincos-gateway-version-id/);
  assert.match(block, /x-skincos-timekeeping-version-id/);
  assert.match(block, /await new Promise\(\(resolve\) => setTimeout\(resolve, 5_000\)\)/);
});

test("Pages recovery skips rollback intent custody when no owned candidate exists", () => {
  assert.match(
    source,
    /const pagesIntentInput = plan\.crmPages && UUID\.test\(plan\.crmPages\.candidateDeploymentId \|\| ""\) \?/,
  );
});

test("recovery accepts only children from the exact immutable Ponto release tag", () => {
  assert.match(source, /import \{ releaseTagFor \} from "\.\/ponto-release-identity\.mjs"/);
  assert.match(source, /const expectedReleaseBranch = releaseTagFor\("ponto", releaseSha\);/);
  assert.match(source, /const isExactImmutableChildRun = \(run, workflow\) => \(/);
  assert.match(source, /run\.headBranch === expectedReleaseBranch/);
  assert.match(source, /String\(run\.headSha \|\| ""\)\.toLowerCase\(\) === releaseSha/);
  assert.doesNotMatch(source, /run\.headBranch !== "main"/);
});

test("a cancelled staging Core child is untouched only with runner and live-incumbent proof", () => {
  assert.match(source, /const preMutationJobNames = Object\.freeze\(\{\s*coreApi: "deploy",/s);
  assert.match(source, /actions\/runs\/\$\{encodeURIComponent\(childRunId\)\}\/jobs\?filter=latest&per_page=100/);
  assert.match(source, /inspectCancelledBeforeRunnerDeployJob/);
  assert.match(source, /resolveStagingCorePrecondition/);
  assert.match(source, /validateAttestedStagingCorePredecessor/);
  assert.match(source, /cancelled-before-runner-no-worker-mutation/);
  assert.match(source, /fs\.existsSync\(surfaceFile\)/);
  assert.match(source, /fs\.existsSync\(journalFile\)/);
});
