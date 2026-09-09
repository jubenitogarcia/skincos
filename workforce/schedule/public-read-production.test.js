import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { createSchedulePublicReadHeaders, verifySchedulePublicReadRequest } from './public-read-contract.js'
import { handleProductionProbe, PROBE_SERVICE } from './public-read-production-probe.js'
import { productionConfigDigest, PRODUCTION_RESOURCES, validateProductionManifest, assertProbeOwnership, assertProductionReadback } from './scripts/public-read-production-manifest.mjs'
import { verifyCanonicalRun, verifyAdapterStagingEvidence } from './scripts/public-read-production-predecessor.mjs'
import { createSchedulePublicReadCoreOptInEvidence, verifySchedulePublicReadCoreOptInEvidence } from './scripts/public-read-core-opt-in-evidence.mjs'
import { createSchedulePublicReadAdapterBootstrapEvidence, verifySchedulePublicReadAdapterBootstrapEvidence } from './scripts/public-read-bootstrap-evidence.mjs'

const sourceSha = 'a'.repeat(40)
const own = 'probe-synthetic-key-'.repeat(3)
const edge = 'edge-synthetic-key-'.repeat(3)
async function probeRequest(path = '/verify/ready', secret = own) {
  const url = `https://probe.example${path}`
  return new Request(url, { headers: await createSchedulePublicReadHeaders({ secret, url, service: PROBE_SERVICE }) })
}
function environment({ disabled = false } = {}) {
  const seen = new Set()
  const calls = []
  return {
    calls, PROBE_SOURCE_SHA: sourceSha, PROBE_EXPIRES_AT_MS: String(Date.now() + 1800_000),
    SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY: own, SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: edge,
    SCHEDULE_PUBLIC_READ: { async fetch(request) {
      const path = new URL(request.url).pathname
      calls.push(path)
      assert.ok(['/health', '/schedule-public-read/v1/readiness'].includes(path))
      if (disabled) return Response.json({ ok: false, error: 'SCHEDULE_PUBLIC_READ_UNAVAILABLE' }, { status: 503 })
      const auth = await verifySchedulePublicReadRequest(request, edge)
      if (!auth.ok) return Response.json({ error: 'SCHEDULE_PUBLIC_READ_UNAUTHORIZED' }, { status: 401 })
      const nonce = request.headers.get('x-skincos-schedule-read-nonce')
      if (seen.has(nonce)) return Response.json({ error: 'SCHEDULE_PUBLIC_READ_REPLAYED' }, { status: 409 })
      seen.add(nonce)
      return Response.json({ ok: true, ready: true, contract: 'schedule-public-read/v1', sensitiveExtra: 'synthetic-do-not-relay' })
    } },
  }
}
test('production verifier authenticates and returns only exact boolean checks without upstream payload', async () => {
  const env = environment()
  const response = await handleProductionProbe(await probeRequest(), env)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, contract: 'schedule-public-read-production-probe/v1', sourceSha, mode: 'ready',
    checks: { readiness: true, replayRejected: true, unsignedRejected: true, invalidHmacRejected: true } })
  assert.equal(env.calls.length, 4)
})
test('production verifier proves both disabled health and readiness', async () => {
  const env = environment({ disabled: true })
  const response = await handleProductionProbe(await probeRequest('/verify/disabled'), env)
  assert.equal(response.status, 200)
  assert.deepEqual((await response.json()).checks, { disabled: true })
  assert.equal(env.calls.length, 2)
})
test('production verifier rejects caller paths, queries, payloads, method and wrong authentication before binding calls', async () => {
  for (const request of [await probeRequest('/verify/ready?url=https://other.invalid'), await probeRequest('/schedule-public-read/v1/slots'),
    await probeRequest('/verify/ready', 'wrong-synthetic-key'), new Request('https://probe.example/verify/ready'),
    new Request('https://probe.example/verify/ready', { method: 'POST', body: '{}' })]) {
    const env = environment()
    assert.notEqual((await handleProductionProbe(request, env)).status, 200)
    assert.equal(env.calls.length, 0)
  }
})
test('production verifier fails closed on expiration, missing binding, weak or shared key, and invalid source', async () => {
  for (const patch of [{ PROBE_EXPIRES_AT_MS: '0' }, { PROBE_EXPIRES_AT_MS: String(Date.now() + 2 * 3600_000) },
    { SCHEDULE_PUBLIC_READ: null }, { SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY: edge }, { SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY: '' },
    { SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY: '' }, { PROBE_SOURCE_SHA: 'main' }]) {
    const env = { ...environment(), ...patch }
    assert.equal((await handleProductionProbe(await probeRequest(), env)).status, 503)
    assert.equal(env.calls.length, 0)
  }
})
test('production verifier bounds stalled fetch and response streams, oversized or non-JSON response', async () => {
  const streams = [
    () => new Promise(() => {}),
    async () => new Response(new ReadableStream({ start() {} })),
    async () => new Response('x'.repeat(4097)),
    async () => new Response('invalid'),
  ]
  for (const fetch of streams) {
    const env = { ...environment(), SCHEDULE_PUBLIC_READ: { fetch } }
    const response = await handleProductionProbe(await probeRequest(), env, { timeoutMs: 10 })
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { ok: false, error: 'PROBE_FAILED' })
  }
})

const now = Date.now()
const manifest = { contract: 'schedule-public-read-production-manifest/v1', sourceSha, accountId: 'b'.repeat(32),
  configDigest: productionConfigDigest(), ...PRODUCTION_RESOURCES, probeLifetimeSeconds: 1800, expiresAt: new Date(now + 3600_000).toISOString() }
function validate(document, overrides = {}) {
  const raw = JSON.stringify(document)
  return validateProductionManifest(raw, { sourceSha, accountId: manifest.accountId, expectedDigest: createHash('sha256').update(raw).digest('hex'), now, ...overrides })
}
test('protected production manifest binds exact source, account, config, fixed resources, TTL and digest', () => {
  assert.deepEqual(validate(manifest), manifest)
  for (const patch of [{ sourceSha: 'c'.repeat(40) }, { accountId: 'd'.repeat(32) }, { configDigest: '0'.repeat(64) },
    { probeWorker: 'other' }, { probeOrigin: 'https://other.invalid' }, { coreWorker: 'skincos-escala-api-staging' },
    { probeLifetimeSeconds: 3600 }, { extra: true }, { expiresAt: new Date(now - 1).toISOString() },
    { expiresAt: new Date(now + 2 * 86400_000).toISOString() }]) assert.throws(() => validate({ ...manifest, ...patch }), /manifest_invalid/)
  assert.throws(() => validate(manifest, { expectedDigest: '0'.repeat(64) }), /manifest_invalid/)
})
test('production core and bootstrap evidence cannot be substituted for staging or another resource/SHA', () => {
  const options = { sourceSha, workflowRunId: '1234', target: 'production' }
  const core = createSchedulePublicReadCoreOptInEvidence(options)
  assert.equal(core.coreWorker, 'skincos-escala-api')
  verifySchedulePublicReadCoreOptInEvidence(core, options)
  assert.throws(() => verifySchedulePublicReadCoreOptInEvidence(core), /target/)
  const bootstrap = createSchedulePublicReadAdapterBootstrapEvidence({ ...options, lifecycleConfigDigest: manifest.configDigest })
  assert.equal(bootstrap.worker, 'skincos-schedule-public-read')
  verifySchedulePublicReadAdapterBootstrapEvidence(bootstrap, { ...options, lifecycleConfigDigest: manifest.configDigest })
  assert.throws(() => verifySchedulePublicReadAdapterBootstrapEvidence(bootstrap), /target/)
  assert.throws(() => verifySchedulePublicReadAdapterBootstrapEvidence(bootstrap, { ...options, sourceSha: 'f'.repeat(40) }), /sourceSha/)
})
test('predecessor rejects forks, reruns, wrong workflow, failed or incomplete canonical dispatches', () => {
  const workflowPath = '.github/workflows/deploy-escala-api.yml'
  const workflow = { id: 12, path: workflowPath, state: 'active' }
  const run = { id: 34, workflow_id: 12, path: workflowPath, status: 'completed', conclusion: 'success', run_attempt: 1,
    event: 'workflow_dispatch', head_branch: 'main', repository: { full_name: 'jubenitogarcia/skincos' }, head_repository: { full_name: 'jubenitogarcia/skincos' } }
  verifyCanonicalRun(workflow, run, { workflowPath, runId: '34' })
  for (const patch of [{ id: 35 }, { workflow_id: 13 }, { path: 'other' }, { status: 'in_progress' }, { conclusion: 'failure' },
    { run_attempt: 2 }, { event: 'push' }, { head_branch: 'feature' }, { head_repository: { full_name: 'fork/skincos' } }]) {
    assert.throws(() => verifyCanonicalRun(workflow, { ...run, ...patch }, { workflowPath, runId: '34' }), /predecessor_invalid/)
  }
})
test('cleanup only admits this run exact probe at 100 percent', () => {
  const owner = { sourceSha, runId: '1234' }
  const deployment = { annotations: { 'workers/message': `schedule-public-read-probe:${sourceSha}:1234` }, versions: [{ percentage: 100 }] }
  assertProbeOwnership(deployment, owner)
  assert.throws(() => assertProbeOwnership(deployment, { ...owner, runId: '1235' }), /ownership/)
  assert.throws(() => assertProbeOwnership({ ...deployment, versions: [{ percentage: 50 }] }, owner), /ownership/)
})
test('adapter staging artifact binds its successful canonical run and cannot substitute another stage or source', () => {
  const document = { schemaVersion: 3, unit: 'schedule-public-read-adapter', target: 'staging', sourceSha,
    runId: '1234', repository: 'jubenitogarcia/skincos' }
  verifyAdapterStagingEvidence(document, { sourceSha, runId: '1234' })
  for (const patch of [{ schemaVersion: 1 }, { target: 'preview' }, { unit: 'escala-api' }, { runId: '1235' },
    { sourceSha: 'b'.repeat(40) }, { repository: 'fork/skincos' }]) {
    assert.throws(() => verifyAdapterStagingEvidence({ ...document, ...patch }, { sourceSha, runId: '1234' }), /predecessor_invalid/)
  }
})
test('production readback verifies active version, flag, source/run and private binding, not a successful upload alone', () => {
  const options = { sourceSha, runId: '1234', surface: 'adapter', mode: 'ready' }
  const deployment = { annotations: { 'workers/message': `schedule-public-read-adapter:production:${sourceSha}:1234` }, versions: [{ version_id: 'v1', percentage: 100 }] }
  const version = { id: 'v1', resources: { bindings: [{ type: 'plain_text', name: 'SCHEDULE_PUBLIC_READ_ENABLED', text: 'true' },
    { type: 'service', name: 'SCHEDULE_CORE', service: 'skincos-escala-api' }] } }
  assertProductionReadback(deployment, version, options)
  assert.throws(() => assertProductionReadback(deployment, version, { ...options, runId: '1235' }), /readback_invalid/)
  assert.throws(() => assertProductionReadback(deployment, { ...version, id: 'v2' }, options), /readback_invalid/)
  assert.throws(() => assertProductionReadback(deployment, { ...version, resources: { bindings: [] } }, options), /readback_invalid/)
  assert.throws(() => assertProductionReadback(deployment, version, { ...options, mode: 'disabled' }), /readback_invalid/)
  const coreDeployment = { ...deployment, annotations: { 'workers/message': `escala-api:production-schedule-public-read:${sourceSha}:1234` } }
  assertProductionReadback(coreDeployment, version, { ...options, surface: 'core' })
  assert.throws(() => assertProductionReadback(coreDeployment, version, { ...options, surface: 'core', runId: '1235' }), /readback_invalid/)
  assert.throws(() => assertProductionReadback(coreDeployment, version, { ...options, surface: 'core', sourceSha: 'f'.repeat(40) }), /readback_invalid/)
})

const adapter = readFileSync(new URL('../../.github/workflows/deploy-schedule-public-read-adapter.yml', import.meta.url), 'utf8')
const core = readFileSync(new URL('../../.github/workflows/deploy-escala-api.yml', import.meta.url), 'utf8')
const production = adapter.slice(adapter.indexOf('\n  production:\n'))
const coreProduction = core.slice(core.indexOf('\n  production-public-read:\n'))
test('production adapter remains private and probe has one fixed binding with no data store', () => {
  const config = readFileSync(new URL('./public-read.wrangler.toml', import.meta.url), 'utf8').split('[env.staging]')[0]
  assert.match(config, /workers_dev = false/)
  assert.match(config, /preview_urls = false/)
  assert.doesNotMatch(config, /routes\s*=|d1_databases/)
  const probe = readFileSync(new URL('./public-read-production-probe.wrangler.toml', import.meta.url), 'utf8')
  assert.match(probe, /service = "skincos-schedule-public-read"/)
  assert.equal((probe.match(/\[\[services\]\]/g) || []).length, 1)
  assert.doesNotMatch(probe, /d1_databases|routes\s*=|crons\s*=|durable_objects/)
})
test('production mutations have exact-target mandatory lease checks, rollback and always cleanup', () => {
  for (const document of [production, coreProduction]) {
    const steps = document.split(/(?=^      - name: )/m).slice(1)
    for (let i = 0; i < steps.length; i++) {
      if (/npx --yes wrangler@[^\n]+ (?:deploy|versions upload|versions deploy)/.test(steps[i]) && !/--dry-run/.test(steps[i])
        || /public-read-production-resources\.mjs cleanup/.test(steps[i])) {
        assert.match(steps[i - 1], /uses: \.\/\.github\/actions\/global-coordination-check/)
      }
      if (/uses: \.\/\.github\/actions\/global-coordination-(?:check|acquire|release)/.test(steps[i])) {
        assert.match(steps[i], /required: 'true'/)
        assert.match(steps[i], /coordinator_url: \$\{\{ vars\.SKINCOS_GLOBAL_COORDINATOR_PRODUCTION_URL \}\}/)
        assert.doesNotMatch(steps[i], /coordinator_url:.*\|\|/)
      }
      const block = steps[i].match(/        run: \|\r?\n([\s\S]*)$/)?.[1]
      if (block) {
        const input = block.split(/\r?\n/).map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n')
        const syntax = spawnSync('bash', ['-n'], { input, encoding: 'utf8' })
        assert.equal(syntax.status, 0, syntax.stderr)
      }
    }
    assert.match(document, /always\(\) && steps\.production-fallback\.outcome == 'success'/)
    assert.match(document, /SCHEDULE_PUBLIC_READ_ENABLED:false/)
    assert.match(document, /--secrets-file \/dev\/stdin/)
  }
  assert.match(production, /always\(\) && steps\.probe-cleanup-lease\.outcome == 'success'/)
  assert.match(production, /public-read-production-manifest\.mjs verify/)
  assert.match(production, /public-read-production-predecessor\.mjs adapter-bootstrap/)
  assert.match(production, /public-read-production-predecessor\.mjs adapter-staging/)
  assert.match(production, /public-read-production-predecessor\.mjs core-production/)
  assert.match(production, /public-read-production-resources\.mjs predecessor core before/)
  assert.match(production, /public-read-production-resources\.mjs predecessor core after/)
  assert.ok(production.indexOf('predecessor core before') < production.indexOf('Upload private production adapter candidate'))
  assert.ok(production.indexOf('predecessor core after') > production.indexOf('Prove authenticated production readiness'))
  assert.doesNotMatch(production, /--env staging|SCHEDULE_PUBLIC_READ_SMOKE_BASE_URL:/)
})
