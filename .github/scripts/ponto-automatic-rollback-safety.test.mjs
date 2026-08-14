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

test("external composite recovery readback waits for bounded edge propagation before failing", () => {
  assert.match(source, /const EXTERNAL_COMPOSITE_MAX_ATTEMPTS = 36/);
  assert.match(source, /const EXTERNAL_COMPOSITE_RETRY_DELAY_MS = 5_000/);
  assert.match(source, /automatic_rollback_readback/);
  assert.match(source, /cache-control": "no-store"/);
  assert.match(source, /await waitForPropagation\(EXTERNAL_COMPOSITE_RETRY_DELAY_MS\)/);
  assert.match(source, /propagationTimedOut: true/);
  assert.match(source, /external\.composite = await attestExternalComposite\(\)/);
  assert.match(source, /plan\.coreApi\.incumbentVersionId/);
  assert.match(source, /plan\.timekeeping\.incumbentVersionId/);
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

test("Core provenance recovery accepts only its exact immutable child release tag", () => {
  const recovery = fs.readFileSync(
    new URL("../workflows/ponto-staging-core-provenance-recovery.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    recovery,
    /const expectedChildReleaseTag = `skincos\/release\/ponto\/\$\{process\.env\.RELEASE_SHA\}`;/,
  );
  assert.match(recovery, /run\.headBranch !== expectedChildReleaseTag/);
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
