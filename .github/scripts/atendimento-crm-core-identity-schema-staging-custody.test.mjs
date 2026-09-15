import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync(new URL('../workflows/atendimento-crm-core-identity-schema-staging.yml', import.meta.url), 'utf8');
const HELPER = '/usr/local/sbin/skincos-run-atendimento-crm-core-identity-schema-staging';

const readLiteralRunBlock = (source, stepName) => {
    const stepMarker = `      - name: ${stepName}\n`;
    const stepStart = source.indexOf(stepMarker);
    assert.ok(stepStart >= 0, `workflow step is missing: ${stepName}`);
    const nextStep = source.indexOf('\n      - name:', stepStart + stepMarker.length);
    const step = source.slice(stepStart, nextStep >= 0 ? nextStep : source.length);
    const run = step.match(/^        run: \|\n((?: {10}.*(?:\n|$))*)/m);
    assert.ok(run, `literal shell block is missing from step: ${stepName}`);
    return run[1].replace(/^ {10}/gm, '');
};

test('identity schema custody is dispatch-only, main-bound, and exclusive to the protected native runner', () => {
    assert.match(workflow, /^on:\n  workflow_dispatch:/m);
    assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule|workflow_call):/m);
    for (const marker of [
        "github.repository == 'jubenitogarcia/skincos'",
        "github.repository_id == '1060913632'",
        "github.repository_owner_id == '199169872'",
        "github.ref == 'refs/heads/main'",
        'github.run_attempt == 1',
        'inputs.source_sha == github.sha',
        'runs-on: [self-hosted, Linux, X64, skincos-native-custody]',
        'environment: crm-atendimento-identity-schema-staging',
        'group: atendimento-crm-core-identity-schema-staging-custody',
        'cancel-in-progress: false',
        'git rev-parse refs/remotes/origin/main',
        'ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_MAIN_ADVANCED',
        'ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_MAIN_ADVANCED_BEFORE_CUSTODY',
        'verify-exact-atendimento-crm-core-identity-schema-staging',
        'apply-exact-atendimento-crm-core-identity-schema-staging',
    ]) assert.ok(workflow.includes(marker), marker);
    assert.match(workflow, /options:\n          - verify\n          - apply/);
});

test('only the two literal root-helper invocations are available to the workflow', () => {
    const invocations = [...workflow.matchAll(/sudo\s+-n\s+([^\r\n]+)/g)].map((match) => match[1].trim());
    assert.deepEqual(invocations, [
        `${HELPER} verify > "$RAW_RECEIPT"`,
        `${HELPER} apply > "$RAW_RECEIPT"`,
    ]);
    assert.doesNotMatch(workflow, /\b(?:wrangler|cloudflare|d1|DATABASE_URL|secrets\.|systemctl|psql|pg_dump)\b/i);
});

test('the workflow accepts and uploads only a bounded sanitized receipt', () => {
    for (const marker of [
        "contract !== 'skincos/atendimento/crm-core-identity-schema-custody/v1'",
        "receipt.releaseSha !== sourceSha",
        "receipt.target !== 'staging'",
        "receipt.schemaOnly !== true",
        'receipt.writerInvocation !== false',
        'receipt.backfillInvocation !== false',
        'receipt.deliveryInvocation !== false',
        'receipt.productionMutationAllowed !== false',
        'receiptDigest',
        "flag: 'wx'",
        'mode: 0o600',
        'path: ${{ env.SAFE_RECEIPT }}',
    ]) assert.ok(workflow.includes(marker), marker);
    const uploadMarker = '      - name: Upload the sanitized custody receipt only\n';
    const uploadStart = workflow.indexOf(uploadMarker);
    assert.ok(uploadStart >= 0, 'sanitized receipt upload is missing');
    const uploadEnd = workflow.indexOf('\n      - name:', uploadStart + uploadMarker.length);
    const upload = workflow.slice(uploadStart, uploadEnd >= 0 ? uploadEnd : workflow.length);
    assert.doesNotMatch(upload, /RAW_RECEIPT|raw\.json/i);
});

test('all custody shell blocks remain Bash-parseable', () => {
    for (const stepName of [
        'Bind the request to the exact current main source',
        'Reconfirm exact main source immediately before custody',
        'Verify only through the fixed root-owned staging helper',
        'Apply only through the fixed root-owned staging helper',
        'Validate and retain only the sanitized custody receipt',
        'Remove temporary custody output',
    ]) {
        const result = spawnSync('bash', ['-n'], { input: readLiteralRunBlock(workflow, stepName), encoding: 'utf8' });
        assert.equal(result.status, 0, `${stepName}: ${result.stderr}`);
    }
});
