import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assertProbeRecovery, PRODUCTION_RESOURCES } from './scripts/public-read-production-manifest.mjs'

const sourceSha = 'a'.repeat(40)
const versionId = '01234567-89ab-4cde-8fab-0123456789ab'
const now = 1_900_000_000_000
const options = { sourceSha, runId: '5678', recoveryRunId: '1234', now }
function fixture() {
  return {
    deployment: { annotations: { 'workers/message': `schedule-public-read-probe:${sourceSha}:1234` },
      versions: [{ version_id: versionId, percentage: 100 }] },
    version: { id: versionId, resources: { bindings: [
      { name: 'SCHEDULE_PUBLIC_READ', type: 'service', service: PRODUCTION_RESOURCES.adapterWorker },
      { name: 'PROBE_SOURCE_SHA', type: 'plain_text', text: sourceSha },
      { name: 'PROBE_EXPIRES_AT_MS', type: 'plain_text', text: String(now - 1) },
      { name: 'SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY', type: 'secret_text' },
      { name: 'SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY', type: 'secret_text' },
    ] } },
  }
}
const validate = ({ deployment, version } = fixture(), overrides = {}) => assertProbeRecovery(deployment, version, { ...options, ...overrides })
const rejects = (mutate) => { const value = fixture(); mutate(value); assert.throws(() => validate(value), /^Error: probe_recovery_not_verified$/) }

test('expired fixed probe can be reconciled only under a different explicit recovery run', () => {
  assert.deepEqual(validate(), { sourceSha, runId: options.runId, recoveryRunId: options.recoveryRunId,
    worker: PRODUCTION_RESOURCES.probeWorker, versionId, expiresAtMs: now - 1 })
})

test('recovery identity rejects current run, absent/noncanonical run IDs, invalid source and invalid clock', () => {
  for (const patch of [{ recoveryRunId: options.runId }, { recoveryRunId: '' }, { recoveryRunId: '01234' }, { recoveryRunId: '1234/other' },
    { recoveryRunId: 1234 }, { runId: '' }, { runId: 5678 }, { sourceSha: 'main' }, { sourceSha: 'a'.repeat(39) }, { now: NaN }, { now: -1 }]) {
    assert.throws(() => validate(fixture(), patch), /probe_recovery_not_verified/)
  }
})

test('recovery binds the prior run annotation and cannot substitute core, adapter or a new deployment annotation', () => {
  for (const message of [`schedule-public-read-probe:${sourceSha}:5678`, `schedule-public-read-probe:${'b'.repeat(40)}:1234`,
    `schedule-public-read-adapter:production:${sourceSha}:1234`, '', null]) rejects(value => { value.deployment.annotations['workers/message'] = message })
  rejects(value => { value.version.annotations = { 'workers/message': `schedule-public-read-probe:${sourceSha}:9999` } })
  const value = fixture(); value.version.annotations = value.deployment.annotations; delete value.deployment.annotations
  assert.equal(validate(value).versionId, versionId)
  rejects(value => { delete value.deployment.annotations })
})

test('recovery requires exact version ID and sole 100-percent deployed version, not any uploaded candidate', () => {
  rejects(value => { value.deployment.versions[0].percentage = 50 })
  rejects(value => { value.deployment.versions[0].percentage = '100' })
  rejects(value => { value.deployment.versions.push({ version_id: versionId, percentage: 0 }) })
  rejects(value => { value.deployment.versions[0].version_id = 'fedcba98-7654-4321-8abc-0123456789ab' })
  rejects(value => { value.version.id = '------------------------------------'; value.deployment.versions[0].version_id = value.version.id })
  rejects(value => { value.version = null })
  rejects(value => { value.deployment.versions = [] })
})

test('recovery requires exactly the production adapter binding and no alternate service/data bindings', () => {
  for (const patch of [{ service: PRODUCTION_RESOURCES.coreWorker }, { service: `${PRODUCTION_RESOURCES.adapterWorker}-staging` },
    { environment: 'staging' }, { entrypoint: 'AdministrativeRpc' }, { type: 'd1' }, { name: 'OTHER' }]) {
    rejects(value => { Object.assign(value.version.resources.bindings[0], patch) })
  }
  const value = fixture(); value.version.resources.bindings[0].environment = 'production'
  assert.equal(validate(value).worker, PRODUCTION_RESOURCES.probeWorker)
  for (const type of ['d1', 'r2_bucket', 'kv_namespace', 'durable_object_namespace', 'service', 'json']) {
    rejects(value => { value.version.resources.bindings.push({ name: 'EXTRA', type, service: PRODUCTION_RESOURCES.adapterWorker }) })
  }
  rejects(value => { value.version.resources.bindings.push(value.version.resources.bindings[0]) })
  rejects(value => { value.version.resources.bindings.push({ name: 'EXTRA' }) })
  rejects(value => { value.version.resources.bindings.push({}) })
  rejects(value => { value.version.resources.bindings = [] })
  rejects(value => { value.version.resources.bindings = {} })
})

test('source binding and TTL must be canonical plaintext with expiration reached, not aliases or coercion', () => {
  for (const patch of [{ text: 'b'.repeat(40) }, { text: sourceSha.toUpperCase() }, { type: 'json' }]) {
    rejects(value => { Object.assign(value.version.resources.bindings[1], patch) })
  }
  for (const text of [String(now + 1), '0', '1.9e12', ` ${now}`, now - 1, null, '', '99999999999999999999']) {
    rejects(value => { value.version.resources.bindings[2].text = text })
  }
  rejects(value => { value.version.resources.bindings[2].type = 'secret_text' })
  rejects(value => { value.version.resources.bindings.splice(2, 1) })
  const value = fixture(); value.version.resources.bindings[2].text = String(now)
  assert.equal(validate(value).expiresAtMs, now)
  assert.ok(Object.isFrozen(validate(value)))
})

test('resource CLI scopes reconcile to fixed probe, validates before DELETE and proves absence afterward', () => {
  // Read source only: importing the mutating resource runner is deliberately not
  // needed for these tests, and no authenticated API or environment is used.
  const source = readFileSync(new URL('./scripts/public-read-production-resources.mjs', import.meta.url), 'utf8')
  const reconcile = source.slice(source.indexOf("if (operation === 'reconcile')"), source.indexOf("if (operation === 'predecessor')"))
  assert.match(source, /resourceOperations = new Set\(\['checkpoint', 'readback', 'predecessor'\]\)/)
  assert.match(source, /: PRODUCTION_RESOURCES\.probeWorker/)
  assert.match(reconcile, /PROBE_RECOVERY_RUN_ID/)
  assert.match(reconcile, /recoveryRunId === runId \|\| surface \|\| mode/)
  assert.ok(reconcile.indexOf('assertProbeRecovery(') < reconcile.indexOf("await api('', 'DELETE')"))
  assert.ok(reconcile.indexOf("await api('', 'DELETE')") < reconcile.indexOf("await api('/settings', 'GET', true)"))
  assert.match(reconcile, /removed: state !== null, absent: true, cleanupReadback: true/)
  assert.match(reconcile, /mode: 0o600, flag: 'wx'/)
  assert.match(reconcile, /schedule-production-probe-recovery\.json/)
  assert.doesNotMatch(reconcile, /console\.(?:log|error)\((?:proof|state|version|process\.env)/)
})
