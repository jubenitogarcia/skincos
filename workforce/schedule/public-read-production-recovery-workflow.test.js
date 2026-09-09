import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertReleaseWindow, assertDurableDisableProof } from './scripts/public-read-production-release-guard.mjs'
import { verifyCanonicalRun } from './scripts/public-read-production-predecessor.mjs'

const sourceSha = 'a'.repeat(40), configDigest = 'b'.repeat(64), now = 1800000000000
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8')
const workflow = read('../../.github/workflows/deploy-schedule-public-read-adapter.yml')
const core = read('../../.github/workflows/deploy-escala-api.yml')
const production = workflow.split('\n  production:\n')[1]
const coreProduction = core.split('\n  production-public-read:\n')[1]
test('release window rejects near-expiry authorization before bounded publication jobs', () => {
  assertReleaseWindow({ expiresAt: new Date(now + 35 * 60_000).toISOString() }, now)
  for (const remaining of [-1, 1, 20 * 60_000, 35 * 60_000 - 1]) {
    assert.throws(() => assertReleaseWindow({ expiresAt: new Date(now + remaining).toISOString() }, now), /window_too_short/)
  }
})
test('long-lived disabled rollback uses exact active source/lifecycle/DO proof without expiring artifacts', () => {
  const deployment = { annotations: { 'workers/message': `schedule-public-read-adapter:production:${sourceSha}:123` }, versions: [{ version_id: 'v1', percentage: 100 }] }
  const bindings = [
    { name: 'SCHEDULE_PUBLIC_READ_SOURCE_SHA', type: 'plain_text', text: sourceSha },
    { name: 'SCHEDULE_PUBLIC_READ_LIFECYCLE_SHA256', type: 'plain_text', text: configDigest },
    { name: 'SCHEDULE_PUBLIC_READ_ENABLED', type: 'plain_text', text: 'true' },
    { name: 'SCHEDULE_CORE', type: 'service', service: 'skincos-escala-api' },
    { name: 'SCHEDULE_PUBLIC_READ_NONCE_GUARD', type: 'durable_object_namespace', class_name: 'SchedulePublicReadNonceGuard', namespace_id: 'existing-namespace' },
  ]
  const version = { id: 'v1', resources: { bindings } }, expected = { sourceSha, configDigest }
  assert.equal(assertDurableDisableProof(deployment, version, expected).predecessorRunId, '123')
  for (const patch of [{ sourceSha: 'c'.repeat(40) }, { configDigest: 'd'.repeat(64) }]) {
    assert.throws(() => assertDurableDisableProof(deployment, version, { ...expected, ...patch }), /disable_proof_invalid/)
  }
  for (const name of ['SCHEDULE_PUBLIC_READ_SOURCE_SHA', 'SCHEDULE_PUBLIC_READ_LIFECYCLE_SHA256', 'SCHEDULE_CORE', 'SCHEDULE_PUBLIC_READ_NONCE_GUARD']) {
    assert.throws(() => assertDurableDisableProof(deployment, { ...version, resources: { bindings: bindings.filter(item => item.name !== name) } }, expected), /disable_proof_invalid/)
  }
  assert.throws(() => assertDurableDisableProof(deployment, { ...version, id: 'v2' }, expected), /disable_proof_invalid/)
  assert.throws(() => assertDurableDisableProof({ ...deployment, versions: [{version_id: 'v1', percentage: 50}] }, version, expected), /disable_proof_invalid/)
})
test('production cancellation reaches checked disabled fallback and readback while runner survives', () => {
  for (const document of [production, coreProduction]) {
    const blocks = document.split(/(?=^      - name: )/m).filter(block => /id: production-fallback(?:-upload-lease|-version|-deploy-lease)?\n/.test(block))
    assert.equal(blocks.length, 4)
    for (const block of blocks) {
      const condition = block.match(/if: \$\{\{ (.+) \}\}/)?.[1]
      assert.match(condition, /^always\(\) && \(failure\(\) \|\| cancelled\(\)\)/)
      assert.match(condition, /(?:outputs\.mutated == 'true'|outcome == 'success')/)
    }
    assert.match(document, /always\(\) && steps\.production-fallback\.outcome == 'success'/)
  }
})
test('each production Wrangler mutation rechecks manifest in the mutating step after its lease gate', () => {
  for (const document of [production, coreProduction]) {
    const steps = document.split(/(?=^      - name: )/m).slice(1)
    for (let index = 0; index < steps.length; index++) {
      if (!/npx --yes wrangler@/.test(steps[index]) || /--dry-run/.test(steps[index])) continue
      assert.match(steps[index - 1], /uses: \.\/\.github\/actions\/global-coordination-check/)
      assert.ok(steps[index].indexOf('public-read-production-manifest.mjs verify') < steps[index].indexOf('npx --yes wrangler@'))
    }
    assert.match(document, /public-read-production-release-guard\.mjs window/)
  }
})
test('disable and residual reconciliation retain protected main/source/manifest without old CI artifacts', () => {
  assert.match(workflow, /if:.*!\(inputs\.target == 'production' && \(inputs\.operation == 'disable' \|\| inputs\.operation == 'reconcile-probe'\)\)/)
  const recovery = workflow.split('\n  recovery-source:\n')[1].split('\n  reconcile-probe:\n')[0]
  assert.match(recovery, /git merge-base --is-ancestor "\$RELEASE_SHA" origin\/main/)
  assert.match(recovery, /RUN_ATTEMPT.*== '1'/)
  assert.match(production, /if:.*inputs\.operation == 'disable'[\s\S]*public-read-production-release-guard\.mjs disable/)
  const bootstrap = production.split('Verify exact disabled production bootstrap before versions upload')[1].split('      - name:')[0]
  assert.match(bootstrap, /inputs\.operation == 'deploy'/)
  const staging = production.split('Verify adapter staging predecessor is a completed successful canonical dispatch')[1].split('      - name:')[0]
  assert.match(staging, /inputs\.operation != 'disable'/)
  const reconcile = workflow.split('\n  reconcile-probe:\n')[1]
  assert.match(reconcile, /public-read-production-predecessor\.mjs probe-recovery/)
  assert.match(reconcile, /global-coordination-check[\s\S]*public-read-production-resources\.mjs reconcile/)
  assert.doesNotMatch(reconcile, /wrangler@|bootstrap-evidence|promotion-evidence/)
})
test('residual probe recovery admits only completed unsuccessful canonical owners, never successful or active runs', () => {
  const workflowPath = '.github/workflows/deploy-schedule-public-read-adapter.yml'
  const workflow = { id: 1, path: workflowPath, state: 'active' }
  const run = { id: 123, workflow_id: 1, path: workflowPath, status: 'completed', conclusion: 'cancelled', run_attempt: 1,
    event: 'workflow_dispatch', head_branch: 'main', repository: {full_name: 'jubenitogarcia/skincos'}, head_repository: {full_name: 'jubenitogarcia/skincos'} }
  const expected = { workflowPath, runId: '123', allowedConclusions: ['failure', 'cancelled', 'timed_out'] }
  for (const conclusion of expected.allowedConclusions) verifyCanonicalRun(workflow, { ...run, conclusion }, expected)
  for (const patch of [{ status: 'in_progress' }, { conclusion: 'success' }, { run_attempt: 2 }, { head_branch: 'feature' }]) {
    assert.throws(() => verifyCanonicalRun(workflow, { ...run, ...patch }, expected), /predecessor_invalid/)
  }
})
