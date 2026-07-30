import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import worker, { __testables } from './worker.js'
import { signHmac } from './security.js'
import { readModuleAvailability } from '../../shared/module-availability/worker.js'

const releaseSha = 'a'.repeat(40)
const cohortRef = (value) => `v1:${value.repeat(43)}`
const timekeepingVersionId = '11111111-1111-4111-8111-111111111111'
const gatewayVersionId = '22222222-2222-4222-8222-222222222222'
const identityVersionId = '33333333-3333-4333-8333-333333333333'
const activeControl = (overrides = {}) => ({
  state: 'active',
  schemaVersion: 2,
  rolloutStage: 'staging',
  syntheticOnly: true,
  releaseSha,
  versions: {
    timekeeping: { candidate: timekeepingVersionId },
    coreApi: { candidate: gatewayVersionId },
    identityWorkforce: { candidate: identityVersionId },
  },
  ...overrides,
})
const openEmergencyLatch = (overrides = {}) => ({
  schemaVersion: 1,
  module: 'timekeeping',
  target: 'staging',
  latched: false,
  changedAt: '2026-07-30T00:00:00.000Z',
  changedBy: 'ponto-emergency-latch-reset',
  ...overrides,
})
const affinityHeaders = {
  'x-skincos-gateway-release-sha': releaseSha,
  'x-skincos-gateway-environment': 'staging',
  'x-skincos-gateway-version-id': gatewayVersionId,
}
const criticalRuntimeBindings = {
  VERSION_METADATA: { id: timekeepingVersionId },
  PONTO_ACTOR_HMAC_KEY: 'synthetic-actor-key',
  PONTO_IDEMPOTENCY_KEY: 'synthetic-idempotency-key',
  PONTO_TEMPLATES_KEY: 'synthetic-template-key',
  PONTO_PROFILE_DATA_KEY: 'synthetic-profile-key',
  PONTO_NETWORK_CONTEXT_KEY: 'synthetic-network-key',
  IDENTITY_WORKFORCE_HMAC_KEY: 'synthetic-identity-key',
}
const criticalDependencyNames = {
  PONTO_ACTOR_HMAC_KEY: 'actor_authentication',
  PONTO_IDEMPOTENCY_KEY: 'idempotency',
  PONTO_TEMPLATES_KEY: 'biometric_encryption',
  PONTO_PROFILE_DATA_KEY: 'profile_encryption',
  PONTO_NETWORK_CONTEXT_KEY: 'network_context',
  IDENTITY_WORKFORCE_HMAC_KEY: 'identity_workforce_authentication',
}
const controlStore = (value, latch = openEmergencyLatch()) => ({
  async get(key) {
    return key === 'module-control:timekeeping:emergency-latch' ? latch : value
  },
})
const readyDb = {
  prepare() {
    return {
      bind() { return this },
      async first() { return { ok: 1 } },
    }
  },
}

test('health stays HTTP 200 but fails closed when module control is missing', async () => {
  const response = await worker.fetch(new Request('https://timekeeping.local/api/ponto/health', { headers: affinityHeaders }), {
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    DB: readyDb,
    ...criticalRuntimeBindings,
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.ready, false)
  assert.equal(body.service, 'workforce-timekeeping')
  assert.equal(body.availability.state, 'maintenance')
  assert.equal(body.availability.source, 'binding-missing')
  assert.equal(body.dependencies.module_control.required, true)
  assert.equal(body.dependencies.module_control.state, 'unavailable')
  assert.equal(JSON.stringify(body).includes('PONTO_'), false)
})

test('health and readiness fail closed when the independent emergency latch is missing, unreadable, malformed, or active', async (t) => {
  const request = () => new Request('https://timekeeping.local/api/ponto/readiness', { headers: affinityHeaders })
  const baseEnv = {
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    DB: readyDb,
    ...criticalRuntimeBindings,
  }
  const cases = [
    ['missing', null, 'emergency-latch-missing'],
    ['malformed', { latched: false }, 'emergency-latch-malformed'],
    ['active', openEmergencyLatch({ latched: true }), 'emergency-latch-active'],
  ]
  for (const [name, latch, source] of cases) {
    await t.test(name, async () => {
      const env = { ...baseEnv, MODULE_CONTROL: controlStore(activeControl(), latch) }
      const health = await worker.fetch(new Request('https://timekeeping.local/api/ponto/health', { headers: affinityHeaders }), env)
      assert.equal(health.status, 200)
      const healthBody = await health.json()
      assert.equal(healthBody.ready, false)
      assert.equal(healthBody.availability.source, source)
      const readiness = await worker.fetch(request(), env)
      assert.equal(readiness.status, 503)
      assert.equal((await readiness.json()).code, 'MODULE_MAINTENANCE')
    })
  }
  await t.test('unreadable', async () => {
    const env = {
      ...baseEnv,
      MODULE_CONTROL: {
        async get(key) {
          if (key === 'module-control:timekeeping:emergency-latch') throw new Error('unavailable')
          return activeControl()
        },
      },
    }
    const readiness = await worker.fetch(request(), env)
    assert.equal(readiness.status, 503)
    const body = await readiness.json()
    assert.equal(body.code, 'MODULE_MAINTENANCE')
    assert.equal(body.availability.source, 'emergency-latch-unavailable')
  })
})

test('health and readiness reject an emergency overlay target that is missing, malformed, or mismatched', async (t) => {
  const request = () => new Request('https://timekeeping.local/api/ponto/readiness', { headers: affinityHeaders })
  const withoutTarget = openEmergencyLatch()
  delete withoutTarget.target
  const cases = [
    ['missing', withoutTarget, 'emergency-latch-target-malformed'],
    ['malformed', openEmergencyLatch({ target: 'qa' }), 'emergency-latch-target-malformed'],
    ['mismatched', openEmergencyLatch({ target: 'production' }), 'emergency-latch-target-mismatch'],
  ]
  for (const [name, latch, source] of cases) {
    await t.test(name, async () => {
      const env = {
        APP_VERSION: releaseSha,
        ENVIRONMENT: 'staging',
        DB: readyDb,
        MODULE_CONTROL: controlStore(activeControl(), latch),
        ...criticalRuntimeBindings,
      }
      const health = await worker.fetch(new Request('https://timekeeping.local/api/ponto/health', { headers: affinityHeaders }), env)
      assert.equal(health.status, 200)
      const healthBody = await health.json()
      assert.equal(healthBody.ready, false)
      assert.equal(healthBody.availability.source, source)
      const readiness = await worker.fetch(request(), env)
      assert.equal(readiness.status, 503)
      assert.equal((await readiness.json()).code, 'MODULE_MAINTENANCE')
    })
  }
})

test('health is ready only with D1, valid explicit control and exact gateway release affinity', async () => {
  const response = await worker.fetch(new Request('https://timekeeping.local/api/ponto/health', { headers: affinityHeaders }), {
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    DB: readyDb,
    MODULE_CONTROL: controlStore(activeControl()),
    ...criticalRuntimeBindings,
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.ready, true)
  assert.equal(body.versionMetadata.releaseSha, releaseSha)
  assert.equal(body.versionMetadata.workerVersionId, timekeepingVersionId)
  assert.equal(body.versionMetadata.gatewayVersionId, gatewayVersionId)
  assert.equal(response.headers.get('x-skincos-module-state'), 'active')
  assert.equal(response.headers.get('x-skincos-timekeeping-release-sha'), releaseSha)
  assert.equal(response.headers.get('x-skincos-timekeeping-version-id'), timekeepingVersionId)
  assert.equal(response.headers.get('x-skincos-timekeeping-environment'), 'staging')
})

test('private loopback runtime accepts only an explicit local control and matching local release affinity', async () => {
  const localHeaders = {
    'x-skincos-gateway-release-sha': releaseSha,
    'x-skincos-gateway-environment': 'local',
  }
  const localControl = {
    state: 'active',
    schemaVersion: 2,
    rolloutStage: 'local',
    releaseSha,
  }
  const response = await worker.fetch(new Request('http://127.0.0.1:8801/api/ponto/readiness', {
    headers: localHeaders,
  }), {
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'local',
    DB: readyDb,
    MODULE_CONTROL: controlStore(localControl, openEmergencyLatch({ target: 'local' })),
    ...criticalRuntimeBindings,
    VERSION_METADATA: undefined,
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ready, true)

  const hosted = await worker.fetch(new Request('https://timekeeping.local/api/ponto/readiness', {
    headers: {
      'x-skincos-gateway-release-sha': releaseSha,
      'x-skincos-gateway-environment': 'staging',
    },
  }), {
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    DB: readyDb,
    MODULE_CONTROL: controlStore(localControl),
    ...criticalRuntimeBindings,
    VERSION_METADATA: undefined,
  })
  assert.equal(hosted.status, 503)
  assert.equal((await hosted.json()).code, 'ACTIVE_CONTROL_INVALID')
})

test('active control fails closed unless schema and immutable release match the artifact', async () => {
  const request = () => new Request('https://timekeeping.local/api/ponto/readiness', { headers: affinityHeaders })
  const baseEnv = { APP_VERSION: releaseSha, ENVIRONMENT: 'staging', DB: readyDb, ...criticalRuntimeBindings }
  const invalidSchema = await worker.fetch(request(), {
    ...baseEnv,
    MODULE_CONTROL: controlStore(activeControl({ schemaVersion: 1 })),
  })
  assert.equal(invalidSchema.status, 503)
  assert.equal((await invalidSchema.json()).code, 'ACTIVE_CONTROL_INVALID')

  const wrongRelease = await worker.fetch(request(), {
    ...baseEnv,
    MODULE_CONTROL: controlStore(activeControl({ releaseSha: 'b'.repeat(40) })),
  })
  assert.equal(wrongRelease.status, 503)
  assert.equal((await wrongRelease.json()).code, 'RELEASE_AFFINITY_MISMATCH')

  const wrongWorkerVersion = await worker.fetch(request(), {
    ...baseEnv,
    VERSION_METADATA: { id: '33333333-3333-4333-8333-333333333333' },
    MODULE_CONTROL: controlStore(activeControl()),
  })
  assert.equal(wrongWorkerVersion.status, 503)
  assert.equal((await wrongWorkerVersion.json()).code, 'VERSION_AFFINITY_MISMATCH')

  const wrongGatewayVersion = await worker.fetch(new Request('https://timekeeping.local/api/ponto/readiness', {
    headers: { ...affinityHeaders, 'x-skincos-gateway-version-id': '33333333-3333-4333-8333-333333333333' },
  }), {
    ...baseEnv,
    MODULE_CONTROL: controlStore(activeControl()),
  })
  assert.equal(wrongGatewayVersion.status, 503)
  assert.equal((await wrongGatewayVersion.json()).code, 'VERSION_AFFINITY_MISMATCH')

  const missingStage = await worker.fetch(request(), {
    ...baseEnv,
    MODULE_CONTROL: controlStore(activeControl({ rolloutStage: undefined })),
  })
  assert.equal(missingStage.status, 503)
  assert.equal((await missingStage.json()).code, 'ACTIVE_CONTROL_INVALID')

  const wrongEnvironmentStage = await worker.fetch(request(), {
    ...baseEnv,
    MODULE_CONTROL: controlStore(activeControl({ rolloutStage: 'production' })),
  })
  assert.equal(wrongEnvironmentStage.status, 503)
  assert.equal((await wrongEnvironmentStage.json()).code, 'ACTIVE_CONTROL_INVALID')

  const stagingWithoutSyntheticOnly = await worker.fetch(request(), {
    ...baseEnv,
    MODULE_CONTROL: controlStore(activeControl({ syntheticOnly: false })),
  })
  assert.equal(stagingWithoutSyntheticOnly.status, 503)
  assert.equal((await stagingWithoutSyntheticOnly.json()).code, 'ACTIVE_CONTROL_INVALID')

  const productionHeaders = {
    ...affinityHeaders,
    'x-skincos-gateway-environment': 'production',
  }
  const productionSynthetic = await worker.fetch(new Request('https://timekeeping.local/api/ponto/readiness', {
    headers: productionHeaders,
  }), {
    ...baseEnv,
    ENVIRONMENT: 'production',
    MODULE_CONTROL: controlStore(
      activeControl({ rolloutStage: 'production', syntheticOnly: true }),
      openEmergencyLatch({ target: 'production' }),
    ),
  })
  assert.equal(productionSynthetic.status, 503)
  assert.equal((await productionSynthetic.json()).code, 'ACTIVE_CONTROL_INVALID')

  const production = await worker.fetch(new Request('https://timekeeping.local/api/ponto/readiness', {
    headers: productionHeaders,
  }), {
    ...baseEnv,
    ENVIRONMENT: 'production',
    MODULE_CONTROL: controlStore(
      activeControl({ rolloutStage: 'production', syntheticOnly: false }),
      openEmergencyLatch({ target: 'production' }),
    ),
  })
  assert.equal(production.status, 200)
})

test('readiness fails closed when D1 is unavailable', async () => {
  const response = await worker.fetch(new Request('https://timekeeping.local/api/ponto/readiness', { headers: affinityHeaders }), {
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    MODULE_CONTROL: controlStore(activeControl()),
    ...criticalRuntimeBindings,
  })
  assert.equal(response.status, 503)
  assert.equal((await response.json()).code, 'DATABASE_UNAVAILABLE')
})

test('release-probe nonce consumption is atomic across concurrent PoPs and replay stays fail-closed', async () => {
  const stored = new Map()
  const db = {
    prepare(sql) {
      return {
        values: [],
        bind(...values) { this.values = values; return this },
        async run() {
          if (sql.startsWith('INSERT INTO timekeeping_request_nonces')) {
            // Yield so two independently signed requests reach the shared
            // UNIQUE decision concurrently, as separate PoPs would.
            await Promise.resolve()
            if (stored.has(this.values[0])) throw new Error('UNIQUE constraint failed')
            stored.set(this.values[0], {
              expiresAt: this.values[1],
              requestId: this.values[2],
              createdAt: this.values[3],
            })
            return { success: true, meta: { changes: 1 } }
          }
          if (sql.startsWith('DELETE FROM timekeeping_request_nonces')) {
            const cutoff = Date.parse(String(this.values[0] || ''))
            for (const [nonce, row] of stored) {
              if (Date.parse(row.expiresAt) < cutoff) stored.delete(nonce)
            }
            return { success: true, meta: { changes: 0 } }
          }
          throw new Error(`unexpected SQL: ${sql}`)
        },
      }
    },
  }
  const target = 'staging'
  const nonceDigest = 'b'.repeat(64)
  const bodyDigest = 'c'.repeat(64)
  const reservationNonce = `ponto-release-probe:${target}:${releaseSha}:${nonceDigest}`
  const reservationPayload = {
    schemaVersion: 1,
    target,
    releaseSha,
    nonceDigest,
    bodyDigest,
  }
  const actorRaw = Buffer.from(JSON.stringify({
    id: `release-probe:${target}`,
    email: `release-probe@${target}.internal.invalid`,
    role: 'ADMIN',
    allowedUnits: [],
    releaseSha,
  })).toString('base64url')
  const requestFor = async (requestId, payload = reservationPayload, nonce = reservationNonce) => {
    const requestBody = JSON.stringify(payload)
    const requestBodyHash = createHash('sha256').update(requestBody).digest('hex')
    const timestamp = String(Date.now())
    const signature = await signHmac(
      criticalRuntimeBindings.PONTO_ACTOR_HMAC_KEY,
      [
        timestamp,
        actorRaw,
        'POST',
        '/api/ponto/internal/release-probe-nonce',
        nonce,
        requestBodyHash,
      ].join('.'),
    )
    return new Request('https://timekeeping.local/api/ponto/internal/release-probe-nonce', {
      method: 'POST',
      headers: {
        ...affinityHeaders,
        'content-type': 'application/json',
        'x-request-id': requestId,
        'x-request-nonce': nonce,
        'x-skincos-actor': actorRaw,
        'x-skincos-actor-ts': timestamp,
        'x-skincos-actor-sig': signature,
        'x-skincos-signature-version': '2',
      },
      body: requestBody,
    })
  }
  const environment = {
    APP_VERSION: releaseSha,
    ENVIRONMENT: target,
    DB: db,
    MODULE_CONTROL: controlStore(activeControl()),
    ...criticalRuntimeBindings,
  }

  const [left, right] = await Promise.all([
    worker.fetch(await requestFor('probe-pop-a'), { ...environment }),
    worker.fetch(await requestFor('probe-pop-b'), { ...environment }),
  ])
  assert.deepEqual([left.status, right.status].sort(), [201, 409])
  assert.equal(stored.size, 1)
  const [storedNonce, storedRow] = [...stored.entries()][0]
  assert.equal(storedNonce, reservationNonce)
  assert.ok(['probe-pop-a', 'probe-pop-b'].includes(storedRow.requestId))
  assert.ok(storedRow.requestId)
  assert.ok(Date.parse(storedRow.expiresAt) > Date.now())

  const replay = await worker.fetch(await requestFor('probe-pop-replay'), { ...environment })
  assert.equal(replay.status, 409)
  const replayBody = await replay.json()
  assert.deepEqual(
    { ok: replayBody.ok, error: replayBody.error },
    { ok: false, error: 'RELEASE_PROBE_RESERVATION_REJECTED' },
  )
  assert.equal(JSON.stringify(replayBody).includes(nonceDigest), false)
  assert.equal(JSON.stringify(replayBody).includes(reservationNonce), false)

  const independentlySignedMismatches = [
    [requestFor('probe-wrong-target', { ...reservationPayload, target: 'production' }), 'target'],
    [requestFor('probe-wrong-release', { ...reservationPayload, releaseSha: 'd'.repeat(40) }), 'release'],
    [requestFor('probe-wrong-body', { ...reservationPayload, bodyDigest: 'e'.repeat(64) }), 'body digest'],
    [requestFor('probe-extra-field', { ...reservationPayload, unexpected: 'value' }), 'extra field'],
    [requestFor('probe-wrong-nonce', reservationPayload, `${reservationNonce.slice(0, -1)}0`), 'nonce'],
  ]
  for (const [pendingRequest, label] of independentlySignedMismatches) {
    const denied = await worker.fetch(await pendingRequest, { ...environment })
    assert.equal(denied.status, 409, label)
  }
  assert.equal(stored.size, 1)

  const getDenied = await worker.fetch(new Request(
    'https://timekeeping.local/api/ponto/internal/release-probe-nonce',
    { headers: affinityHeaders },
  ), { ...environment })
  assert.equal(getDenied.status, 404)
})

test('readiness requires explicit module control and accepts only a valid unexpired canary for this release', async () => {
  const request = () => new Request('https://timekeeping.local/api/ponto/readiness', { headers: affinityHeaders })
  const baseEnv = { APP_VERSION: releaseSha, ENVIRONMENT: 'staging', DB: readyDb, ...criticalRuntimeBindings }
  const missing = await worker.fetch(request(), baseEnv)
  assert.equal(missing.status, 503)
  assert.equal((await missing.json()).code, 'MODULE_MAINTENANCE')

  const validCanary = {
    state: 'canary',
    schemaVersion: 2,
    rolloutStage: 'pilot',
    pilotEmployeeRefs: [cohortRef('e')],
    pilotIdentityRefs: [cohortRef('i')],
    pilotIdentityLoginRefs: [cohortRef('l')],
    pilotNetworkContexts: [cohortRef('n')],
    pilotUnits: ['UNIT_A'],
    percentage: 100,
    releaseSha,
    versions: {
      timekeeping: { candidate: timekeepingVersionId },
      coreApi: { candidate: gatewayVersionId },
    },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    syntheticOnly: true,
  }
  const ready = await worker.fetch(request(), { ...baseEnv, MODULE_CONTROL: controlStore(validCanary) })
  assert.equal(ready.status, 200)
  const readyBody = await ready.json()
  assert.equal(readyBody.ok, true)
  assert.equal(readyBody.availability.rolloutStage, 'pilot')
  assert.equal(JSON.stringify(readyBody).includes('pilotEmployeeRefs'), false)
  assert.equal(JSON.stringify(readyBody).includes('pilotIdentityRefs'), false)
  assert.equal(JSON.stringify(readyBody).includes(cohortRef('e')), false)

  const wrongRelease = await worker.fetch(request(), {
    ...baseEnv,
    MODULE_CONTROL: controlStore({ ...validCanary, releaseSha: 'b'.repeat(40) }),
  })
  assert.equal(wrongRelease.status, 503)
  assert.equal((await wrongRelease.json()).code, 'RELEASE_AFFINITY_MISMATCH')

  const expired = await worker.fetch(request(), {
    ...baseEnv,
    MODULE_CONTROL: controlStore({ ...validCanary, expiresAt: new Date(Date.now() - 1_000).toISOString() }),
  })
  assert.equal(expired.status, 503)
  assert.equal((await expired.json()).code, 'CANARY_CONTROL_EXPIRED')

  const missingLoginGrant = await worker.fetch(request(), {
    ...baseEnv,
    MODULE_CONTROL: controlStore({ ...validCanary, pilotIdentityLoginRefs: undefined }),
  })
  assert.equal(missingLoginGrant.status, 503)
  assert.equal((await missingLoginGrant.json()).code, 'CANARY_CONTROL_INVALID')

  const mismatchedTupleLengths = await worker.fetch(request(), {
    ...baseEnv,
    MODULE_CONTROL: controlStore({
      ...validCanary,
      rolloutStage: 'canary',
      pilotEmployeeRefs: [cohortRef('e'), cohortRef('f')],
    }),
  })
  assert.equal(mismatchedTupleLengths.status, 503)
  assert.equal((await mismatchedTupleLengths.json()).code, 'CANARY_CONTROL_INVALID')
})

test('health, readiness and Ponto routes fail closed for each critical runtime binding without disclosing values', async (t) => {
  for (const [binding, dependency] of Object.entries(criticalDependencyNames)) {
    await t.test(binding, async () => {
      const env = {
        APP_VERSION: releaseSha,
        ENVIRONMENT: 'staging',
        DB: readyDb,
        MODULE_CONTROL: controlStore(activeControl()),
        ...criticalRuntimeBindings,
        [binding]: '   ',
      }
      const health = await worker.fetch(new Request('https://timekeeping.local/api/ponto/health', { headers: affinityHeaders }), env)
      assert.equal(health.status, 200)
      const healthBody = await health.json()
      assert.equal(healthBody.ok, false)
      assert.equal(healthBody.dependencies[dependency].required, true)
      assert.equal(healthBody.dependencies[dependency].state, 'unavailable')
      assert.equal(JSON.stringify(healthBody).includes(criticalRuntimeBindings[binding]), false)

      const readiness = await worker.fetch(new Request('https://timekeeping.local/api/ponto/readiness', { headers: affinityHeaders }), env)
      assert.equal(readiness.status, 503)
      assert.equal((await readiness.json()).code, 'RUNTIME_BINDINGS_UNAVAILABLE')

      const route = await worker.fetch(new Request('https://timekeeping.local/api/ponto/context', { headers: affinityHeaders }), env)
      assert.equal(route.status, 503)
      assert.equal((await route.json()).code, 'RUNTIME_BINDINGS_UNAVAILABLE')
    })
  }
})

test('Timekeeping canary authorization is conjunctive and keeps employee/network cohort values opaque', async () => {
  const actorKey = 'actor-key-for-canary-test'
  const networkKey = 'network-key-for-canary-test'
  const env = {
    APP_VERSION: releaseSha,
    PONTO_ACTOR_HMAC_KEY: actorKey,
    PONTO_NETWORK_CONTEXT_KEY: networkKey,
  }
  const employee = {
    id: 'employee-row-1',
    canonical_employee_id: 'canonical-employee-1',
    login_email: 'pilot@example.invalid',
    status: 'ACTIVE',
    access_state: 'ACTIVE',
    metadata_json: JSON.stringify({ synthetic: true }),
  }
  const actorPayload = Buffer.from(JSON.stringify({
    id: 'actor-1',
    email: employee.login_email,
    role: 'CONSULTOR',
    allowedUnits: ['UNIT_A'],
    releaseSha,
  })).toString('base64url')
  const actor = {
    id: 'actor-1',
    email: employee.login_email,
    role: 'CONSULTOR',
    allowedUnits: ['UNIT_A'],
    releaseSha,
  }
  const employeeRef = await __testables.employeeCanaryRef(employee, env, releaseSha)
  const identityRef = await __testables.identityCanaryRef(actor, env, releaseSha)
  const identityLoginRef = await __testables.identityLoginCanaryRef(actor, env, releaseSha)
  assert.match(employeeRef, /^v1:[A-Za-z0-9_-]{43}$/)
  assert.match(identityRef, /^v1:[A-Za-z0-9_-]{43}$/)
  assert.match(identityLoginRef, /^v1:[A-Za-z0-9_-]{43}$/)
  assert.equal(employeeRef.includes(employee.canonical_employee_id), false)
  const networkContext = cohortRef('n')
  const timestamp = String(Date.now())
  const bodyHash = createHash('sha256').update('').digest('hex')
  const signature = await signHmac(networkKey, [
    timestamp,
    actorPayload,
    'GET',
    '/api/ponto/context',
    '',
    bodyHash,
    releaseSha,
    networkContext,
  ].join('.'))
  const request = new Request('https://timekeeping.local/api/ponto/context', {
    headers: {
      'x-skincos-actor': actorPayload,
      'x-skincos-network-context': networkContext,
      'x-skincos-network-ts': timestamp,
      'x-skincos-network-sig': signature,
      'x-skincos-network-signature-version': '2',
    },
  })
  const dbFor = (row = employee, units = ['UNIT_A']) => ({
    prepare(sql) {
      return {
        bind() { return this },
        async first() { return sql.includes('workforce_employees') ? row : null },
        async all() { return { results: sql.includes('timekeeping_employee_units') ? units.map((unit_id) => ({ unit_id })) : [] } },
      }
    },
  })
  const availability = {
    state: 'canary',
    pilotEmployeeRefs: [employeeRef],
    pilotIdentityRefs: [identityRef],
    pilotIdentityLoginRefs: [identityLoginRef],
    pilotNetworkContexts: [networkContext],
    pilotUnits: ['UNIT_A'],
    percentage: 100,
    syntheticOnly: true,
  }
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, availability, actor, dbFor(), bodyHash, releaseSha), true)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, availability, { ...actor, role: 'SUPERVISOR' }, dbFor(), bodyHash, releaseSha), false)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, availability, { ...actor, email: '' }, dbFor(), bodyHash, releaseSha), false)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, availability, { ...actor, releaseSha: 'b'.repeat(40) }, dbFor(), bodyHash, releaseSha), false)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, availability, actor, dbFor({ ...employee, access_state: 'SUSPENDED' }), bodyHash, releaseSha), false)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, availability, actor, dbFor({ ...employee, metadata_json: '{}' }), bodyHash, releaseSha), false)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, availability, actor, dbFor(employee, ['UNIT_B']), bodyHash, releaseSha), false)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, { ...availability, pilotEmployeeRefs: [cohortRef('x')] }, actor, dbFor(), bodyHash, releaseSha), false)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, { ...availability, pilotIdentityRefs: [cohortRef('x')] }, actor, dbFor(), bodyHash, releaseSha), false)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, { ...availability, pilotIdentityLoginRefs: [cohortRef('x')] }, actor, dbFor(), bodyHash, releaseSha), false)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, {
    ...availability,
    pilotEmployeeRefs: [cohortRef('x'), employeeRef],
    pilotIdentityRefs: [identityRef, cohortRef('x')],
    pilotIdentityLoginRefs: [identityLoginRef, cohortRef('x')],
  }, actor, dbFor(), bodyHash, releaseSha), false)
  assert.equal(await __testables.authorizeTimekeepingCanary(request, env, { ...availability, pilotNetworkContexts: [cohortRef('x')] }, actor, dbFor(), bodyHash, releaseSha), false)

  const forgedNetworkRequest = new Request(request, { headers: { ...Object.fromEntries(request.headers), 'x-skincos-network-sig': 'forged' } })
  assert.equal(await __testables.authorizeTimekeepingCanary(forgedNetworkRequest, env, availability, actor, dbFor(), bodyHash, releaseSha), false)
})

test('shared module availability preserves the historical active default outside fail-closed Ponto', async () => {
  assert.equal((await readModuleAvailability({}, 'finance')).state, 'active')
  assert.equal((await readModuleAvailability({ MODULE_CONTROL: controlStore({ state: 'invalid' }) }, 'finance')).state, 'active')
})

test('forged candidate and gateway headers never replace a valid actor HMAC envelope', async () => {
  const response = await worker.fetch(new Request('https://timekeeping.local/api/ponto/context', {
    headers: {
      ...affinityHeaders,
      'cloudflare-workers-version-key': 'browser-selected-candidate',
      'x-skincos-candidate-release-sha': releaseSha,
      'x-skincos-actor': Buffer.from(JSON.stringify({
        id: 'forged-actor',
        email: 'forged@example.invalid',
        role: 'CONSULTOR',
        allowedUnits: ['UNIT_A'],
        releaseSha,
      })).toString('base64url'),
      'x-skincos-actor-ts': String(Date.now()),
      'x-skincos-actor-sig': 'forged',
      'x-skincos-signature-version': '2',
    },
  }), {
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    DB: readyDb,
    MODULE_CONTROL: controlStore(activeControl()),
    ...criticalRuntimeBindings,
    PONTO_ACTOR_HMAC_KEY: 'expected-actor-key',
  })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).error, 'UNAUTHORIZED')
})

test('role matrix keeps consultor self-service and gives supervisor the former RH/auditor duties', () => {
  assert.equal(__testables.roleAllows('CONSULTOR', 'self.punch'), true)
  assert.equal(__testables.roleAllows('CONSULTOR', 'self.profile.read'), true)
  assert.equal(__testables.roleAllows('CONSULTOR', 'profile.manage'), false)
  assert.equal(__testables.roleAllows('CONSULTOR', 'unit.read'), false)
  assert.equal(__testables.roleAllows('MANAGER', 'correction.request'), true)
  assert.equal(__testables.roleAllows('MANAGER', 'correction.approve'), false)
  assert.equal(__testables.roleAllows('SUPERVISOR', 'period.close'), true)
  assert.equal(__testables.roleAllows('SUPERVISOR', 'audit.read'), true)
  assert.equal(__testables.roleAllows('ADMIN', 'device.manage'), true)
  assert.equal(__testables.normalizeWorkforceRole('RH'), 'SUPERVISOR')
  assert.equal(__testables.normalizeWorkforceRole('AUDITOR'), 'SUPERVISOR')
  assert.equal(__testables.normalizeWorkforceRole('EMPLOYEE'), 'CONSULTOR')
})

test('profile payload accepts only known fields and keeps document values out of summaries', () => {
  const patch = __testables.profileInput({ profile: { socialName: 'Pessoa Teste', cpf: '123.456.789-00', mobilePhone: '(11) 99999-0000', ignored: 'do-not-store' } })
  assert.deepEqual(patch.publicPatch, { socialName: 'Pessoa Teste' })
  assert.deepEqual(patch.privatePatch, { cpf: '12345678900', mobilePhone: '(11) 99999-0000' })
  assert.deepEqual(patch.provided, ['socialName', 'cpf', 'mobilePhone'])
  assert.deepEqual(__testables.profileDocumentStatus({ cpf: '12345678900', pis: '', rgNumber: '42', motherName: '' }), { cpf: 'CADASTRADO', pis: 'PENDENTE', rg: 'CADASTRADO', family: 'PENDENTE' })
})

test('face punches stay disabled unless the operational flag explicitly enables them', async () => {
  assert.equal(__testables.isFacePunchEnabled({}), false)
  assert.equal(__testables.isFacePunchEnabled({ PONTO_FACE_PUNCH_ENABLED: 'true' }), true)
  const result = await __testables.verifyPunchCredential({}, {}, {}, { id: 'employee-1' }, { descriptor: [0.1, 0.2] })
  assert.deepEqual(result, { error: 'FACE_DISABLED' })
})

test('terminal network parsing only accepts valid IPv4 CIDRs and matches without trusting a browser header', () => {
  assert.deepEqual(__testables.normalizeNetworks(['203.0.113.10/32', 'bad', '198.51.100.0/24', '203.0.113.10/32']), ['203.0.113.10/32', '198.51.100.0/24'])
  assert.equal(__testables.ipInNetwork('203.0.113.10', '203.0.113.10/32'), true)
  assert.equal(__testables.ipInNetwork('203.0.113.11', '203.0.113.10/32'), false)
  assert.equal(__testables.ipInNetwork('198.51.100.42', '198.51.100.0/24'), true)
})

test('external location stores a derived result rather than coordinates and rejects stale or malformed evidence', () => {
  const policy = { geofence_latitude: -23.5505, geofence_longitude: -46.6333, geofence_radius_meters: 150 }
  const result = __testables.locationEvidence({ latitude: -23.5505, longitude: -46.6333, accuracyMeters: 12, capturedAt: new Date().toISOString() }, policy)
  assert.equal(result.status, 'WITHIN_GEOFENCE')
  assert.equal(Object.hasOwn(result.payload, 'latitude'), false)
  assert.equal(__testables.locationEvidence({ latitude: 0, longitude: 0, accuracyMeters: 5, capturedAt: '2000-01-01T00:00:00.000Z' }, policy).error, 'LOCATION_INVALID')
})

test('manager and supervisor scopes are horizontal while admin remains organization-wide', () => {
  assert.equal(__testables.requireUnit({ role: 'MANAGER', allowedUnits: ['UNIT_A'] }, 'UNIT_A'), true)
  assert.equal(__testables.requireUnit({ role: 'MANAGER', allowedUnits: ['UNIT_A'] }, 'UNIT_B'), false)
  assert.equal(__testables.requireUnit({ role: 'SUPERVISOR', allowedUnits: ['UNIT_A'] }, 'UNIT_A'), true)
  assert.equal(__testables.requireUnit({ role: 'SUPERVISOR', allowedUnits: ['UNIT_A'] }, 'UNIT_B'), false)
  assert.equal(__testables.requireUnit({ role: 'ADMIN', allowedUnits: [] }, 'UNIT_B'), true)
})

test('Identity onboarding service binding requires a fresh HMAC and cannot be forged by a browser', async () => {
  const secret = 'identity-workforce-test-secret'
  const timestamp = String(Date.now())
  const bodyHash = 'body-hash'
  const method = 'GET'
  const path = '/api/ponto/internal/onboarding'
  const signatureFor = (nonce, overrides = {}) => signHmac(secret, `v2.${overrides.timestamp || timestamp}.${nonce}.${overrides.method || method}.${overrides.path || path}.${overrides.bodyHash || bodyHash}.${overrides.releaseSha || releaseSha}.${overrides.versionId || identityVersionId}`)
  const signature = await signatureFor('nonce-1')
  const seen = new Set()
  const db = { prepare(sql) { return { bind(...values) { this.values = values; return this }, async run() { if (sql.includes('INSERT INTO')) { if (seen.has(this.values[0])) throw new Error('UNIQUE') ; seen.add(this.values[0]) } return { meta: { changes: 1 } } } } } }
  const headers = { 'x-skincos-service': 'identity', 'x-skincos-workforce-signature-version': '2', 'x-skincos-workforce-ts': timestamp, 'x-skincos-workforce-sig': signature, 'x-skincos-workforce-nonce': 'nonce-1', 'x-skincos-identity-release-sha': releaseSha, 'x-skincos-identity-version-id': identityVersionId, 'x-request-id': 'req-1' }
  const signed = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers })
  assert.deepEqual(await __testables.identityServiceAuthorized(signed, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: true })
  const replay = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers })
  assert.deepEqual(await __testables.identityServiceAuthorized(replay, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_REPLAY' })
  const unsigned = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers: { ...headers, 'x-skincos-workforce-sig': 'forged', 'x-skincos-workforce-nonce': 'nonce-2' } })
  assert.deepEqual(await __testables.identityServiceAuthorized(unsigned, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  const missingNonce = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers: { ...headers, 'x-skincos-workforce-nonce': '' } })
  assert.deepEqual(await __testables.identityServiceAuthorized(missingNonce, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  const changedNonce = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers: { ...headers, 'x-skincos-workforce-nonce': 'nonce-3' } })
  assert.deepEqual(await __testables.identityServiceAuthorized(changedNonce, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  const changedPath = new Request('https://timekeeping.local/api/ponto/internal/onboarding/status', { headers })
  assert.deepEqual(await __testables.identityServiceAuthorized(changedPath, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  const changedMethod = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { method: 'POST', headers })
  assert.deepEqual(await __testables.identityServiceAuthorized(changedMethod, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  const changedIdentityVersion = new Request('https://timekeeping.local/api/ponto/internal/onboarding', {
    headers: { ...headers, 'x-skincos-identity-version-id': '44444444-4444-4444-8444-444444444444' },
  })
  assert.deepEqual(await __testables.identityServiceAuthorized(changedIdentityVersion, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  const alteredBody = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers: { ...headers, 'x-skincos-workforce-nonce': 'nonce-3', 'x-skincos-workforce-sig': await signatureFor('nonce-3') } })
  assert.deepEqual(await __testables.identityServiceAuthorized(alteredBody, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, 'altered-body', db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  const expiredTimestamp = String(Date.now() - 301000)
  const expiredSig = await signatureFor('nonce-4', { timestamp: expiredTimestamp })
  const expired = new Request('https://timekeeping.local/api/ponto/internal/onboarding', { headers: { ...headers, 'x-skincos-workforce-ts': expiredTimestamp, 'x-skincos-workforce-sig': expiredSig, 'x-skincos-workforce-nonce': 'nonce-4' } })
  assert.deepEqual(await __testables.identityServiceAuthorized(expired, { IDENTITY_WORKFORCE_HMAC_KEY: secret }, bodyHash, db), { ok: false, error: 'SERVICE_UNAUTHORIZED' })
  assert.equal(__testables.normalizedDepartmentKey('  Atendimento Técnico  '), 'atendimento tecnico')
})

test('read-only Identity contract probe proves HMAC v2 and exact candidate affinity during canary without writing PII', async () => {
  const path = '/api/ponto/internal/onboarding/contract-probe'
  const bodyHash = createHash('sha256').update('').digest('hex')
  const identityKey = criticalRuntimeBindings.IDENTITY_WORKFORCE_HMAC_KEY
  const signedProbe = async ({ versionId = identityVersionId, signatureOverride = '' } = {}) => {
    const timestamp = String(Date.now())
    const nonce = crypto.randomUUID()
    const signature = signatureOverride || await signHmac(identityKey, `v2.${timestamp}.${nonce}.GET.${path}.${bodyHash}.${releaseSha}.${versionId}`)
    return new Request(`https://timekeeping.local${path}`, {
      headers: {
        'x-skincos-service': 'identity',
        'x-skincos-workforce-signature-version': '2',
        'x-skincos-workforce-ts': timestamp,
        'x-skincos-workforce-sig': signature,
        'x-skincos-workforce-nonce': nonce,
        'x-skincos-identity-release-sha': releaseSha,
        'x-skincos-identity-version-id': versionId,
      },
    })
  }
  const canaryControl = {
    state: 'canary',
    schemaVersion: 2,
    rolloutStage: 'pilot',
    pilotEmployeeRefs: [cohortRef('e')],
    pilotIdentityRefs: [cohortRef('i')],
    pilotIdentityLoginRefs: [cohortRef('l')],
    pilotNetworkContexts: [cohortRef('n')],
    pilotUnits: ['UNIT_A'],
    percentage: 100,
    releaseSha,
    versions: {
      timekeeping: { candidate: timekeepingVersionId },
      coreApi: { candidate: gatewayVersionId },
      identityWorkforce: { candidate: identityVersionId },
    },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    syntheticOnly: true,
  }
  const env = {
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    DB: readyDb,
    MODULE_CONTROL: controlStore(canaryControl),
    ...criticalRuntimeBindings,
  }

  const valid = await worker.fetch(await signedProbe(), env)
  assert.equal(valid.status, 200)
  const body = await valid.json()
  assert.equal(body.ok, true)
  assert.deepEqual(body.data, {
    contract: 'identity-workforce-hmac-v2',
    matched: true,
    releaseSha,
    environment: 'staging',
    timekeepingVersionId,
    identityReleaseSha: releaseSha,
    identityVersionId,
  })

  const forged = await worker.fetch(await signedProbe({ signatureOverride: 'forged' }), env)
  assert.equal(forged.status, 401)
  assert.equal((await forged.json()).error, 'SERVICE_UNAUTHORIZED')

  const wrongIdentityVersion = await worker.fetch(await signedProbe({
    versionId: '44444444-4444-4444-8444-444444444444',
  }), env)
  assert.equal(wrongIdentityVersion.status, 503)
  assert.equal((await wrongIdentityVersion.json()).code, 'VERSION_AFFINITY_MISMATCH')
})

test('active permits direct Identity onboarding only with its HMAC, while canary denies it', async () => {
  const bodyText = JSON.stringify({
    onboardingId: 'onboarding-1',
    employeeId: 'employee-1',
    accountStatus: 'ACTIVE',
  })
  const bodyHash = createHash('sha256').update(bodyText).digest('hex')
  const identityKey = criticalRuntimeBindings.IDENTITY_WORKFORCE_HMAC_KEY
  const signedRequest = async (nonce, signatureOverride = '') => {
    const timestamp = String(Date.now())
    const signature = signatureOverride || await signHmac(identityKey, `v2.${timestamp}.${nonce}.POST./api/ponto/internal/onboarding/status.${bodyHash}.${releaseSha}.${identityVersionId}`)
    return new Request('https://timekeeping.local/api/ponto/internal/onboarding/status', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-skincos-service': 'identity',
        'x-skincos-workforce-signature-version': '2',
        'x-skincos-workforce-ts': timestamp,
        'x-skincos-workforce-sig': signature,
        'x-skincos-workforce-nonce': nonce,
        'x-skincos-identity-release-sha': releaseSha,
        'x-skincos-identity-version-id': identityVersionId,
      },
      body: bodyText,
    })
  }
  const onboardingDb = () => ({
    prepare(sql) {
      return {
        bind() { return this },
        async run() { return { meta: { changes: 1 } } },
        async first() {
          return sql.includes('SELECT * FROM workforce_employees')
            ? {
                id: 'employee-1',
                status: 'ACTIVE',
                access_state: 'ACTIVE',
                metadata_json: JSON.stringify({ identityOnboardingId: 'onboarding-1' }),
              }
            : null
        },
      }
    },
  })
  const baseEnv = {
    APP_VERSION: releaseSha,
    ENVIRONMENT: 'staging',
    ...criticalRuntimeBindings,
  }

  const active = await worker.fetch(await signedRequest('active-valid'), {
    ...baseEnv,
    DB: onboardingDb(),
    MODULE_CONTROL: controlStore(activeControl()),
  })
  assert.equal(active.status, 200)
  assert.equal((await active.json()).data.idempotent, true)

  const forged = await worker.fetch(await signedRequest('active-forged', 'forged'), {
    ...baseEnv,
    DB: onboardingDb(),
    MODULE_CONTROL: controlStore(activeControl()),
  })
  assert.equal(forged.status, 401)
  assert.equal((await forged.json()).error, 'SERVICE_UNAUTHORIZED')

  const canary = await worker.fetch(await signedRequest('canary-valid'), {
    ...baseEnv,
    DB: onboardingDb(),
    MODULE_CONTROL: controlStore({
      state: 'canary',
      schemaVersion: 2,
      rolloutStage: 'pilot',
      pilotEmployeeRefs: [cohortRef('e')],
      pilotIdentityRefs: [cohortRef('i')],
      pilotIdentityLoginRefs: [cohortRef('l')],
      pilotNetworkContexts: [cohortRef('n')],
      pilotUnits: ['UNIT_A'],
      percentage: 100,
      releaseSha,
      versions: {
        timekeeping: { candidate: timekeepingVersionId },
        coreApi: { candidate: gatewayVersionId },
      },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      syntheticOnly: true,
    }),
  })
  assert.equal(canary.status, 403)
  assert.equal((await canary.json()).code, 'TIMEKEEPING_CANARY_NOT_GRANTED')
})

test('Workforce never presents pending or invited onboarding as operational', () => {
  const pending = __testables.publicEmployee({ id: 'e1', canonical_employee_id: 'identity:o1', display_name: 'Synthetic', login_email: 'synthetic@example.invalid', status: 'LEAVE', access_state: 'PENDING_ACCESS' })
  const invited = __testables.publicEmployee({ id: 'e2', canonical_employee_id: 'identity:o2', display_name: 'Synthetic', login_email: 'synthetic2@example.invalid', status: 'LEAVE', access_state: 'INVITED' })
  assert.equal(pending.accessState, 'PENDING_ACCESS')
  assert.equal(invited.accessState, 'INVITED')
  assert.equal(pending.status, 'LEAVE')
  assert.equal(invited.status, 'LEAVE')
})

test('onboarding access state remains authoritative for operational timekeeping', () => {
  assert.equal(__testables.isOperationalEmployee({ status: 'ACTIVE', access_state: 'PENDING_ACCESS' }), false)
  assert.equal(__testables.isOperationalEmployee({ status: 'ACTIVE', access_state: 'INVITED' }), false)
  assert.equal(__testables.isOperationalEmployee({ status: 'ACTIVE', access_state: 'SUSPENDED' }), false)
  assert.equal(__testables.isOperationalEmployee({ status: 'ACTIVE', access_state: 'ACTIVE' }), true)
  assert.equal(__testables.isOperationalEmployee({ status: 'ACTIVE' }), true)
  assert.equal(__testables.identityOnboardingId({ metadata_json: JSON.stringify({ identityOnboardingId: 'onb-1' }) }), 'onb-1')
  assert.equal(__testables.identityOnboardingId({ metadata_json: '{invalid' }), '')
})

test('onboarding manager routing leaves missing or ambiguous superiors empty for manual review', () => {
  assert.deepEqual(__testables.resolveOnboardingManager([]), { managerId: null, reason: 'MISSING' })
  assert.deepEqual(__testables.resolveOnboardingManager([{ manager_employee_id: 'manager-1', status: 'ACTIVE', access_state: 'ACTIVE' }]), { managerId: 'manager-1', reason: 'RESOLVED' })
  assert.deepEqual(__testables.resolveOnboardingManager([{ manager_employee_id: 'manager-1', status: 'ACTIVE', access_state: 'ACTIVE' }, { manager_employee_id: 'manager-2', status: 'ACTIVE', access_state: 'ACTIVE' }]), { managerId: null, reason: 'AMBIGUOUS' })
  assert.deepEqual(__testables.resolveOnboardingManager([{ manager_employee_id: 'manager-1', status: 'LEAVE', access_state: 'SUSPENDED' }]), { managerId: null, reason: 'MISSING' })
})

test('CSV cells neutralize formulas and follow CSV quote escaping', () => {
  assert.equal(__testables.csvCell('=HYPERLINK("https://invalid.example")'), '"\'=HYPERLINK(""https://invalid.example"")"')
  assert.equal(__testables.csvCell('Pessoa "Teste"'), '"Pessoa ""Teste"""')
})

test('daily event partition keeps consecutive shifts separate and overnight completion together', () => {
  const events = [
    { id: 'a', eventType: 'WORK_START', occurredAt: '2026-07-18T11:00:00.000Z' },
    { id: 'b', eventType: 'WORK_END', occurredAt: '2026-07-18T20:00:00.000Z' },
    { id: 'c', eventType: 'WORK_START', occurredAt: '2026-07-19T11:00:00.000Z' },
    { id: 'd', eventType: 'WORK_END', occurredAt: '2026-07-19T20:00:00.000Z' },
  ]
  assert.deepEqual(__testables.eventsForWorkDate(events, '2026-07-18', 'America/Sao_Paulo').map((event) => event.id), ['a', 'b'])
  const overnight = [
    { id: 'n1', eventType: 'WORK_START', occurredAt: '2026-07-19T01:00:00.000Z' },
    { id: 'n2', eventType: 'WORK_END', occurredAt: '2026-07-19T09:00:00.000Z' },
    { id: 'next', eventType: 'WORK_START', occurredAt: '2026-07-19T12:00:00.000Z' },
  ]
  assert.deepEqual(__testables.eventsForWorkDate(overnight, '2026-07-18', 'America/Sao_Paulo').map((event) => event.id), ['n1', 'n2'])
})
