import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../workflows/atendimento-crm-core-projection-backfill.yml", import.meta.url), "utf8");

test("Atendimento CRM Core baseline preparation is dispatch-only, main-bound, and confined to the custody runner", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.match(workflow, /github\.repository == 'jubenitogarcia\/skincos'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /github\.run_attempt == 1/);
  assert.match(workflow, /inputs\.source_sha == github\.sha/);
  assert.match(workflow, /runs-on: \[self-hosted, Linux, X64, skincos-native-custody\]/);
  assert.match(workflow, /environment: crm-atendimento-projection-backfill-staging/);
  assert.match(workflow, /git rev-parse origin\/main/);
  assert.match(workflow, /ATENDIMENTO_CRM_CORE_BACKFILL_MAIN_ADVANCED/);
  assert.match(workflow, /ATENDIMENTO_CRM_CORE_BACKFILL_MAIN_ADVANCED_BEFORE_AUTHORIZATION/);
  assert.match(workflow, /atendimento-crm-core-projection-baseline\/\$\{\{ github\.run_id \}\}/);
});

test("backfill binds a short-lived signed authorization, a finite staging target, and the global fence", () => {
  for (const marker of [
    "skincos/atendimento/crm-core-staging-backfill-custody/v1",
    'operation: "prepare-staging-baseline"',
    'target: "staging"',
    'purpose: "atendimento-crm-core-staging-baseline-preparation"',
    'coreRepository: "jubenitogarcia/skincos-crm-core"',
    'coreRepositoryId: "1353934107"',
    '"coreArtifactRunId":"${{ inputs.core_artifact_run_id }}"',
    '"coreReadbackDigest":"${{ inputs.core_readback_digest }}"',
    '"coreReadbackRunId":"${{ inputs.core_readback_run_id }}"',
    'singleUse: true',
    'workflowPath: ".github/workflows/atendimento-crm-core-projection-backfill.yml"',
    'workflowJob: "backfill"',
    "crypto.sign(null, Buffer.from(canonical), key)",
    "global-coordination-acquire",
    "global-coordination-check",
    "global-coordination-release",
    "resource: release:atendimento",
    "coordinationProofSha256",
    "coordinationFencingToken",
    "coordinationProof,",
    "timeout --foreground --kill-after=15s 240s",
    "sudo -n /usr/local/sbin/skincos-prepare-atendimento-crm-core-baseline prepare-staging-baseline",
    "atendimento-crm-core-projection-backfill-binding.mjs validate",
    "ATENDIMENTO_CRM_BACKFILL_CUSTODY_RECEIPT_SIGNING_PUBLIC_KEY",
  ]) assert.ok(workflow.includes(marker), marker);
  assert.doesNotMatch(workflow, /\bwrangler\b|pages deploy|workers deploy|d1 |secret put|systemctl|DATABASE_URL|ATENDIMENTO_CRM_BACKFILL_HMAC_KEY/i);
});

test("only the validated sanitized receipt can be uploaded", () => {
  const uploadStart = workflow.indexOf("      - name: Upload the sanitized staging baseline preparation receipt only");
  assert.ok(uploadStart >= 0, "sanitized receipt upload is missing");
  const upload = workflow.slice(uploadStart);
  assert.match(workflow, /atendimento-crm-core-projection-backfill-receipt\.mjs validate/);
  assert.match(workflow, /id: prepare/);
  assert.match(workflow, /if: steps\.prepare\.outcome == 'success'/);
  assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/atendimento-crm-core-projection-baseline\/\$\{\{ github\.run_id \}\}\/receipt\.json/);
  assert.doesNotMatch(upload, /authorization|raw|PRIVATE_KEY/i);
});
