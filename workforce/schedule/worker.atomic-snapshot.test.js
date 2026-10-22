import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import test from 'node:test'

import worker from './worker.js'

const actorSecret = 'synthetic-actor-hmac-secret'
const crmApiReadSecret = 'synthetic-crm-api-read-hmac-secret'
const serviceDate = '2026-10-08'
const unit = { slug: 'novo-hamburgo', name: 'Novo Hamburgo' }

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = sql
    this.params = []
  }

  bind(...params) {
    this.params = params
    return this
  }

  async all() {
    return { results: this.db.all(this.sql, this.params) }
  }
}

class AtomicSnapshotFakeD1 {
  constructor({ withIdentityColumns = true, withShiftColumns = true, failBatch = false, batchDelayMs = 0 } = {}) {
    this.failBatch = failBatch
    this.batchDelayMs = batchDelayMs
    this.batchCalls = []
    this.allCalls = []
    this.professionals = [
      { id: 'escala-a', name: 'Alex Silva', status: 'Ativo', role: 'Injetor', shift: 'Manhã', units_json: '["Novo Hamburgo"]', workforce_employee_id: 'employee-a', phone: '+555199900001', email: 'a@example.invalid' },
      { id: 'escala-b', name: 'Alex Silva', status: 'Ativo', role: 'Injetor', shift: 'Tarde', units_json: '["Novo Hamburgo"]', workforce_employee_id: 'employee-b', phone: '+555199900002', email: 'b@example.invalid' },
      { id: 'other-unit', name: 'Pessoa de outra unidade', status: 'Ativo', role: 'Injetor', shift: 'Manhã', units_json: '["BarraShoppingSul"]', workforce_employee_id: 'employee-other' },
    ]
    this.scheduleEntries = [
      { id: 'slot-a', date: serviceDate, unit: 'Novo Hamburgo', professional_id: 'escala-a', professional_name: 'Alex Silva', shift_key: 'morning', shift_label: 'Manhã' },
      { id: 'slot-b', date: serviceDate, unit: 'Novo Hamburgo', professional_id: 'escala-b', professional_name: 'Alex Silva', shift_key: 'afternoon', shift_label: 'Tarde' },
      { id: 'slot-other-unit', date: serviceDate, unit: 'BarraShoppingSul', professional_id: 'other-unit', professional_name: 'Pessoa de outra unidade', shift_key: 'morning', shift_label: 'Manhã' },
    ]
    this.professionalColumns = new Set(['id', 'name', 'status', 'role', 'shift', 'units_json'])
    this.scheduleColumns = new Set(['id', 'date', 'unit', 'professional_name'])
    if (withIdentityColumns) {
      this.professionalColumns.add('workforce_employee_id')
      this.scheduleColumns.add('professional_id')
    }
    if (withShiftColumns) {
      this.scheduleColumns.add('shift_key')
      this.scheduleColumns.add('shift_label')
    }
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  all(sql) {
    this.allCalls.push(sql)
    const query = normalizeSql(sql)
    const match = query.match(/^pragma table_info\(([^)]+)\)$/)
    if (!match) throw new Error(`Data SELECT must run through batch(): ${sql}`)
    const columns = match[1] === 'professionals' ? this.professionalColumns : this.scheduleColumns
    return Array.from(columns, (name, cid) => ({ cid, name }))
  }

  async batch(statements) {
    this.batchCalls.push(statements.map((statement) => ({ sql: statement.sql, params: statement.params })))
    if (this.batchDelayMs) await new Promise((resolve) => setTimeout(resolve, this.batchDelayMs))
    if (this.failBatch) throw new Error('synthetic SQL secret must not escape')
    const results = statements.map((statement) => {
      const query = normalizeSql(statement.sql)
      if (query.startsWith('select id, name, status, role, shift, units_json, workforce_employee_id from professionals')) {
        return { success: true, results: this.professionals.map((row) => ({ ...row })) }
      }
      if (query.startsWith('select se.id as id, se.date as date, se.unit as unit')) {
        return {
          success: true,
          results: this.scheduleEntries
            .filter((row) => row.date === statement.params[0])
            .map((row) => ({
              id: row.id,
              date: row.date,
              unit: row.unit,
              professionalId: row.professional_id,
              professionalName: row.professional_name,
              shiftKey: row.shift_key || '',
              shiftName: row.shift_label || '',
            })),
        }
      }
      throw new Error(`Unexpected batch query: ${statement.sql}`)
    })
    this.lastBatchCompletedAt = Date.now()
    return results
  }
}

async function signedRequest({ unitLabel = 'Novo Hamburgo', date = serviceDate, role = 'GESTOR', allowedUnits = ['Novo Hamburgo'], method = 'GET', secret = actorSecret, path = '/api/escala/schedule/snapshot' } = {}) {
  const payload = Buffer.from(JSON.stringify({ id: 'synthetic-manager', role, allowedUnits })).toString('base64url')
  const timestamp = String(Date.now())
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('base64url')
  return new Request(`https://escala.example.invalid${path}?unit=${encodeURIComponent(unitLabel)}&date=${encodeURIComponent(date)}`, {
    method,
    headers: {
      'x-crm-user': payload,
      'x-crm-ts': timestamp,
      'x-crm-signature': signature,
      'x-request-id': 'synthetic-snapshot-request',
    },
  })
}

async function fetchSnapshot(db, options = {}) {
  const response = await worker.fetch(await signedRequest(options), {
    DB: db,
    ESCALA_ACTOR_HMAC_KEY: actorSecret,
  })
  return { response, body: await response.json() }
}

function assertNoStore(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store')
}

test('returns one authorized, atomic ID-based snapshot with a reproducible content digest', async () => {
  const db = new AtomicSnapshotFakeD1()
  const { response, body } = await fetchSnapshot(db)

  assert.equal(response.status, 200)
  assertNoStore(response)
  assert.equal(body.contract, 'crm/atendimento/atomic-schedule/v1')
  assert.equal(body.unitSlug, unit.slug)
  assert.equal(body.serviceDate, serviceDate)
  assert.equal(body.timeZone, 'America/Sao_Paulo')
  assert.equal(body.atomicReceipt.atomicAcrossEndpoints, true)
  assert.equal(body.atomicReceipt.atomicityMechanism, 'd1-batch-transaction')
  assert.equal(body.atomicReceipt.asOf, body.observedAt)
  assert.equal(body.coverage.complete, true)
  assert.equal(body.coverage.scheduleIdentityCoverageComplete, true)
  assert.equal(body.coverage.shiftContextComplete, true)
  assert.equal(db.batchCalls.length, 1)
  assert.equal(db.batchCalls[0].length, 2)
  assert.ok(db.batchCalls[0].every(({ sql }) => normalizeSql(sql).startsWith('select ')))
  assert.equal(db.allCalls.filter((sql) => !normalizeSql(sql).startsWith('pragma table_info(')).length, 0)
  assert.deepEqual(body.schedule.map((row) => row.professionalId).sort(), ['escala-a', 'escala-b'])
  assert.deepEqual(body.professionals.map((row) => [row.professionalId, row.workforceEmployeeId]), [
    ['escala-a', 'employee-a'],
    ['escala-b', 'employee-b'],
  ])
  assert.ok(body.professionals.every((row) => row.validFrom === '' && row.validUntil === ''),
    'Escala snapshot does not publish a professional validity interval')
  assert.equal(JSON.stringify(body).includes('phone'), false)
  assert.equal(JSON.stringify(body).includes('email'), false)
  assert.equal(JSON.stringify(body).includes('employee-other'), false)
  assert.match(body.contentDigest, /^[a-f0-9]{64}$/)
  const expectedDigest = createHash('sha256').update(JSON.stringify({
    contract: 'crm/atendimento/atomic-schedule/v1',
    scope: { unitSlug: unit.slug, serviceDate, timeZone: 'America/Sao_Paulo' },
    schedule: body.schedule,
    professionals: body.professionals,
  })).digest('hex')
  assert.equal(body.contentDigest, expectedDigest)
  assert.equal(body.sourceVersion, `escala-d1-sha256:${expectedDigest}`)
})

test('does not read unauthorized units or malformed service dates', async () => {
  const unauthorizedDb = new AtomicSnapshotFakeD1()
  const unauthorized = await fetchSnapshot(unauthorizedDb, { allowedUnits: ['BarraShoppingSul'] })
  assert.equal(unauthorized.response.status, 403)
  assertNoStore(unauthorized.response)
  assert.equal(unauthorizedDb.batchCalls.length, 0)

  const invalidDateDb = new AtomicSnapshotFakeD1()
  const invalidDate = await fetchSnapshot(invalidDateDb, { date: '2026-02-30' })
  assert.equal(invalidDate.response.status, 400)
  assertNoStore(invalidDate.response)
  assert.equal(invalidDate.body.error, 'INVALID_SERVICE_DATE')
  assert.equal(invalidDateDb.batchCalls.length, 0)
})

test('fails closed on missing canonical ID columns or an atomic D1 read failure', async () => {
  const oldSchema = await fetchSnapshot(new AtomicSnapshotFakeD1({ withIdentityColumns: false }))
  assert.equal(oldSchema.response.status, 503)
  assertNoStore(oldSchema.response)
  assert.equal(oldSchema.body.error, 'SCHEDULE_ATOMIC_SNAPSHOT_SCHEMA_UNSUPPORTED')

  const failedRead = await fetchSnapshot(new AtomicSnapshotFakeD1({ failBatch: true }))
  assert.equal(failedRead.response.status, 503)
  assertNoStore(failedRead.response)
  assert.equal(failedRead.body.error, 'SCHEDULE_ATOMIC_SNAPSHOT_UNAVAILABLE')
  assert.equal(JSON.stringify(failedRead.body).includes('synthetic SQL secret'), false)
})

test('reports person-level coverage separately when Escala cannot identify a shift key', async () => {
  const db = new AtomicSnapshotFakeD1({ withShiftColumns: false })
  const { response, body } = await fetchSnapshot(db)
  assert.equal(response.status, 200)
  assertNoStore(response)
  assert.equal(body.coverage.complete, true)
  assert.equal(body.coverage.shiftContextComplete, false)
  assert.equal(body.coverage.shiftContextMode, 'professional-profile-label-only')
})

test('emits a fresh snapshot receipt after each batch while content provenance stays stable', async () => {
  const db = new AtomicSnapshotFakeD1({ batchDelayMs: 5 })
  const first = await fetchSnapshot(db)
  const firstBatchCompletedAt = db.lastBatchCompletedAt
  const second = await fetchSnapshot(db)
  const secondBatchCompletedAt = db.lastBatchCompletedAt

  assert.equal(first.response.status, 200)
  assert.equal(second.response.status, 200)
  assertNoStore(first.response)
  assertNoStore(second.response)
  assert.notEqual(first.body.atomicReceipt.snapshotId, second.body.atomicReceipt.snapshotId)
  assert.notEqual(first.body.atomicReceipt.asOf, second.body.atomicReceipt.asOf)
  assert.equal(first.body.atomicReceipt.asOf, first.body.observedAt)
  assert.equal(second.body.atomicReceipt.asOf, second.body.observedAt)
  assert.ok(Date.parse(first.body.atomicReceipt.asOf) >= firstBatchCompletedAt)
  assert.ok(Date.parse(second.body.atomicReceipt.asOf) >= secondBatchCompletedAt)
  assert.equal(first.body.sourceVersion, second.body.sourceVersion)
  assert.equal(first.body.contentDigest, second.body.contentDigest)
})

test('does not cache preflight, authentication, or method refusals for the snapshot route', async () => {
  const env = { DB: new AtomicSnapshotFakeD1(), ESCALA_ACTOR_HMAC_KEY: actorSecret }
  const url = 'https://escala.example.invalid/api/escala/schedule/snapshot?unit=Novo%20Hamburgo&date=2026-10-08'
  const preflight = await worker.fetch(new Request(url, { method: 'OPTIONS' }), env)
  assert.equal(preflight.status, 204)
  assertNoStore(preflight)

  const unauthenticated = await worker.fetch(new Request(url, { method: 'GET' }), env)
  assert.equal(unauthenticated.status, 401)
  assertNoStore(unauthenticated)

  const methodNotAllowed = await worker.fetch(await signedRequest({ method: 'POST' }), env)
  assert.equal(methodNotAllowed.status, 405)
  assertNoStore(methodNotAllowed)
})

test('accepts the dedicated CRM API read key only on read-only schedule GETs', async () => {
  const env = { DB: new AtomicSnapshotFakeD1(), ESCALA_ACTOR_HMAC_KEY: actorSecret, ESCALA_CRM_API_READ_HMAC_KEY: crmApiReadSecret }
  const snapshot = await worker.fetch(await signedRequest({ secret: crmApiReadSecret }), env)
  assert.equal(snapshot.status, 200)
  assertNoStore(snapshot)

  const professionals = await worker.fetch(await signedRequest({ secret: crmApiReadSecret, path: '/api/escala/professionals' }), env)
  assert.equal(professionals.status, 401)
  assert.equal((await professionals.json()).error, 'ACTOR_SIGNATURE_INVALID')

  const overview = await worker.fetch(await signedRequest({ secret: crmApiReadSecret, path: '/api/escala/overview' }), env)
  assert.equal(overview.status, 401)

  const write = await worker.fetch(await signedRequest({ secret: crmApiReadSecret, path: '/api/escala/schedule', method: 'POST' }), env)
  assert.equal(write.status, 401)
  assert.equal(env.DB.batchCalls.length, 1)
})

test('keeps the primary actor key valid everywhere and fails closed without any key', async () => {
  const env = { DB: new AtomicSnapshotFakeD1(), ESCALA_ACTOR_HMAC_KEY: actorSecret, ESCALA_CRM_API_READ_HMAC_KEY: crmApiReadSecret }
  const primary = await worker.fetch(await signedRequest(), env)
  assert.equal(primary.status, 200)

  const wrongKey = await worker.fetch(await signedRequest({ secret: 'not-a-configured-key' }), env)
  assert.equal(wrongKey.status, 401)
  assertNoStore(wrongKey)

  const readOnlyEnv = { DB: new AtomicSnapshotFakeD1(), ESCALA_CRM_API_READ_HMAC_KEY: crmApiReadSecret }
  const readOnlyKey = await worker.fetch(await signedRequest({ secret: crmApiReadSecret }), readOnlyEnv)
  assert.equal(readOnlyKey.status, 200)
  const noPrimaryForOtherRoutes = await worker.fetch(await signedRequest({ secret: crmApiReadSecret, path: '/api/escala/overview' }), readOnlyEnv)
  assert.equal(noPrimaryForOtherRoutes.status, 503)
  assert.equal((await noPrimaryForOtherRoutes.json()).error, 'ACTOR_KEY_MISSING')

  const noKeys = await worker.fetch(await signedRequest(), { DB: new AtomicSnapshotFakeD1() })
  assert.equal(noKeys.status, 503)
})

test('treats an actor without allowedUnits as unrestricted, as the existing routes do', async () => {
  const { response, body } = await fetchSnapshot(new AtomicSnapshotFakeD1(), { allowedUnits: [] })
  assert.equal(response.status, 200)
  assert.equal(body.unitSlug, unit.slug)
})
