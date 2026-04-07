import assert from 'node:assert/strict'
import test from 'node:test'

import worker from './worker.js'

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

  async first() {
    return this.db.first(this.sql, this.params)
  }

  async all() {
    return { results: this.db.all(this.sql, this.params) }
  }

  async run() {
    this.db.run(this.sql, this.params)
    return { success: true }
  }
}

class FakeD1 {
  constructor() {
    this.professionals = []
    this.scheduleEntries = []
    this.closedDays = []
    this.holidays = []
    this.professionalColumns = new Set([
      'id',
      'name',
      'status',
      'role',
      'shift',
      'nickname',
      'phone',
      'email',
      'instagram',
      'units_json',
      'created_at',
      'updated_at',
      'color',
    ])
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }

  first(sql, params) {
    const query = normalizeSql(sql)

    if (query.startsWith('select name from professionals where name = ?1')) {
      const name = String(params[0] || '')
      const row = this.professionals.find((prof) => prof.name === name)
      return row ? { name: row.name } : null
    }

    throw new Error(`Unsupported first() query: ${sql}`)
  }

  all(sql, params) {
    const query = normalizeSql(sql)

    if (query.startsWith('pragma table_info(professionals)')) {
      return Array.from(this.professionalColumns).map((name, index) => ({ cid: index, name }))
    }

    if (
      query.includes('select name, status, role, shift, nickname, phone, email, instagram, color, units_json from professionals')
      || query.includes('select name, status, role, shift, nickname, phone, email, instagram, null as color, units_json from professionals')
    ) {
      return [...this.professionals]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((prof) => ({ ...prof, color: this.professionalColumns.has('color') ? prof.color ?? null : null }))
    }

    if (query.startsWith('select name from professionals where name in (')) {
      const allowed = new Set(params.map((value) => String(value || '')))
      return this.professionals.filter((prof) => allowed.has(prof.name)).map((prof) => ({ name: prof.name }))
    }

    if (query.includes('select date, unit, professional_name as professional from schedule_entries')) {
      let rows = [...this.scheduleEntries]
      if (query.includes('where unit = ? and date like ?')) {
        rows = rows.filter((row) => row.unit === params[0] && row.date.startsWith(String(params[1]).replace(/%$/, '')))
      } else if (query.includes('where unit = ?')) {
        rows = rows.filter((row) => row.unit === params[0])
      } else if (query.includes('where date like ?')) {
        rows = rows.filter((row) => row.date.startsWith(String(params[0]).replace(/%$/, '')))
      }
      return rows
        .sort((a, b) => `${a.date}:${a.professional_name}`.localeCompare(`${b.date}:${b.professional_name}`))
        .map((row) => ({ date: row.date, unit: row.unit, professional: row.professional_name }))
    }

    if (query.includes('select date, unit, reason from closed_days')) {
      return [...this.closedDays]
    }

    if (query.includes('select date, unit, name from holidays')) {
      return [...this.holidays]
    }

    throw new Error(`Unsupported all() query: ${sql}`)
  }

  run(sql, params) {
    const query = normalizeSql(sql)

    if (query.startsWith('insert into professionals')) {
      const hasColor = query.includes('(id, name, status, role, shift, nickname, phone, email, instagram, color, units_json, created_at, updated_at)')
      this.professionals.push({
        id: params[0],
        name: params[1],
        status: params[2],
        role: params[3],
        shift: params[4],
        nickname: params[5],
        phone: params[6],
        email: params[7],
        instagram: params[8],
        color: hasColor ? params[9] : null,
        units_json: hasColor ? params[10] : params[9],
        created_at: hasColor ? params[11] : params[10],
        updated_at: hasColor ? params[12] : params[11],
      })
      return
    }

    if (query.startsWith('update professionals set name = ?1')) {
      const hasColor = query.includes('color = ?9')
      const index = this.professionals.findIndex((prof) => prof.name === params[hasColor ? 11 : 10])
      if (index >= 0) {
        this.professionals[index] = {
          ...this.professionals[index],
          name: params[0],
          status: params[1],
          role: params[2],
          shift: params[3],
          nickname: params[4],
          phone: params[5],
          email: params[6],
          instagram: params[7],
          color: hasColor ? params[8] : this.professionals[index].color ?? null,
          units_json: hasColor ? params[9] : params[8],
          updated_at: hasColor ? params[10] : params[9],
        }
      }
      return
    }

    if (query.startsWith('update schedule_entries set professional_name = ?1')) {
      this.scheduleEntries = this.scheduleEntries.map((entry) => (
        entry.professional_name === params[3]
          ? { ...entry, professional_name: params[0], updated_at: params[1], updated_by: params[2] }
          : entry
      ))
      return
    }

    if (query.startsWith('insert or ignore into schedule_entries')) {
      const [id, date, unit, professionalName, createdAt, updatedAt, createdBy, updatedBy] = params
      const exists = this.scheduleEntries.some(
        (entry) => entry.date === date && entry.unit === unit && entry.professional_name === professionalName,
      )
      if (!exists) {
        this.scheduleEntries.push({
          id,
          date,
          unit,
          professional_name: professionalName,
          created_at: createdAt,
          updated_at: updatedAt,
          created_by: createdBy,
          updated_by: updatedBy,
        })
      }
      return
    }

    throw new Error(`Unsupported run() query: ${sql}`)
  }
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sign(secret, ts, payload) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${ts}.${payload}`))
  return Buffer.from(signature).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function signedRequest(url, { method = 'GET', body, actor, secret }) {
  const ts = String(Date.now())
  const payload = base64UrlEncode(JSON.stringify(actor))
  const signature = await sign(secret, ts, payload)
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-crm-user': payload,
      'x-crm-ts': ts,
      'x-crm-signature': signature,
      'x-request-id': 'test-request-id',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

test('Escala professionals POST and PUT persist and sync schedule entries', async () => {
  const db = new FakeD1()
  const env = {
    DB: db,
    APP_ORIGIN: 'https://crm.local',
    ESCALA_ACTOR_HMAC_KEY: 'test-secret',
  }
  const actor = {
    id: 'gestor-1',
    email: 'gestor@local.test',
    role: 'GESTOR',
    allowedUnits: ['Novo Hamburgo'],
  }

  const createResponse = await worker.fetch(
    await signedRequest('https://escala.local/api/escala/professionals', {
      method: 'POST',
      secret: env.ESCALA_ACTOR_HMAC_KEY,
      actor,
      body: {
        name: 'Dra. Ana',
        status: 'Ativo',
        units: ['Novo Hamburgo'],
        role: 'Injetor',
        phone: '5551999999999',
        email: 'ana@local.test',
        instagram: 'draana',
        color: '#22c55e',
      },
    }),
    env,
  )
  assert.equal(createResponse.status, 200)
  assert.equal(db.professionals.length, 1)
  assert.equal(db.professionals[0].name, 'Dra. Ana')
  assert.equal(JSON.parse(db.professionals[0].units_json)[0], 'Novo Hamburgo')
  assert.equal(db.professionals[0].color, '#22c55e')

  const scheduleResponse = await worker.fetch(
    await signedRequest('https://escala.local/api/escala/schedule', {
      method: 'POST',
      secret: env.ESCALA_ACTOR_HMAC_KEY,
      actor,
      body: {
        date: '2026-03-20',
        unit: 'Novo Hamburgo',
        professional: 'Dra. Ana',
      },
    }),
    env,
  )
  assert.equal(scheduleResponse.status, 200)
  assert.equal(db.scheduleEntries.length, 1)
  assert.equal(db.scheduleEntries[0].professional_name, 'Dra. Ana')

  const updateResponse = await worker.fetch(
    await signedRequest('https://escala.local/api/escala/professionals', {
      method: 'PUT',
      secret: env.ESCALA_ACTOR_HMAC_KEY,
      actor,
      body: {
        currentName: 'Dra. Ana',
        name: 'Dra. Anita',
        status: 'Ativo',
        units: ['Novo Hamburgo'],
        role: 'Injetor, Consultor',
        phone: '+55 (51) 88888-8888',
        email: 'anita@local.test',
        instagram: 'draanita',
        color: '#0ea5e9',
      },
    }),
    env,
  )
  assert.equal(updateResponse.status, 200)
  assert.equal(db.professionals[0].name, 'Dra. Anita')
  assert.equal(db.scheduleEntries[0].professional_name, 'Dra. Anita')

  const professionalsResponse = await worker.fetch(
    await signedRequest('https://escala.local/api/escala/professionals?unit=Novo%20Hamburgo', {
      secret: env.ESCALA_ACTOR_HMAC_KEY,
      actor,
    }),
    env,
  )
  assert.equal(professionalsResponse.status, 200)
  const professionalsJson = await professionalsResponse.json()
  assert.equal(professionalsJson.data.length, 1)
  assert.equal(professionalsJson.data[0].name, 'Dra. Anita')
  assert.equal(professionalsJson.data[0].status, 'Ativo')
  assert.equal(professionalsJson.data[0].role, 'Injetor, Consultor')
  assert.equal(professionalsJson.data[0].phone, '+55 (51) 88888-8888')
  assert.equal(professionalsJson.data[0].email, 'anita@local.test')
  assert.equal(professionalsJson.data[0].instagram, 'draanita')
  assert.equal(professionalsJson.data[0].color, '#0ea5e9')
  assert.deepEqual(professionalsJson.data[0].units, ['Novo Hamburgo'])

  const updatedScheduleResponse = await worker.fetch(
    await signedRequest('https://escala.local/api/escala/schedule?unit=Novo%20Hamburgo&month=2026-03', {
      secret: env.ESCALA_ACTOR_HMAC_KEY,
      actor,
    }),
    env,
  )
  assert.equal(updatedScheduleResponse.status, 200)
  const scheduleJson = await updatedScheduleResponse.json()
  assert.deepEqual(scheduleJson.schedule, [
    {
      date: '2026-03-20',
      unit: 'Novo Hamburgo',
      professional: 'Dra. Anita',
    },
  ])
})

test('Escala professionals GET/POST/PUT tolerate legacy schema without color column', async () => {
  const db = new FakeD1()
  db.professionalColumns.delete('color')
  const env = {
    DB: db,
    APP_ORIGIN: 'https://crm.local',
    ESCALA_ACTOR_HMAC_KEY: 'test-secret',
  }
  const actor = {
    id: 'gestor-1',
    email: 'gestor@local.test',
    role: 'GESTOR',
    allowedUnits: [],
  }

  const createResponse = await worker.fetch(
    await signedRequest('https://escala.local/api/escala/professionals', {
      method: 'POST',
      secret: env.ESCALA_ACTOR_HMAC_KEY,
      actor,
      body: {
        name: 'Dra. Marina',
        status: 'Ativo',
        units: ['BarraShoppingSul'],
        role: 'Injetor',
        color: '#22c55e',
      },
    }),
    env,
  )
  assert.equal(createResponse.status, 200)
  assert.equal(db.professionals.length, 1)
  assert.equal(db.professionals[0].name, 'Dra. Marina')
  assert.equal(db.professionals[0].color, null)

  const updateResponse = await worker.fetch(
    await signedRequest('https://escala.local/api/escala/professionals', {
      method: 'PUT',
      secret: env.ESCALA_ACTOR_HMAC_KEY,
      actor,
      body: {
        currentName: 'Dra. Marina',
        name: 'Dra. Marina Lima',
        status: 'Ativo',
        units: ['BarraShoppingSul'],
        role: 'Injetor',
        color: '#0ea5e9',
      },
    }),
    env,
  )
  assert.equal(updateResponse.status, 200)

  const professionalsResponse = await worker.fetch(
    await signedRequest('https://escala.local/api/escala/professionals?unit=BarraShoppingSul', {
      secret: env.ESCALA_ACTOR_HMAC_KEY,
      actor,
    }),
    env,
  )
  assert.equal(professionalsResponse.status, 200)
  const professionalsJson = await professionalsResponse.json()
  assert.equal(professionalsJson.data.length, 1)
  assert.equal(professionalsJson.data[0].name, 'Dra. Marina Lima')
  assert.equal(professionalsJson.data[0].color, null)
  assert.deepEqual(professionalsJson.data[0].units, ['BarraShoppingSul'])
})

test('Escala rejects actors without management role', async () => {
  const db = new FakeD1()
  db.professionals.push({
    id: 'prof-1',
    name: 'Dra. Ana',
    status: 'Ativo',
    role: 'Injetor',
    shift: '',
    nickname: '',
    phone: '',
    email: '',
    instagram: '',
    color: '#22c55e',
    units_json: JSON.stringify(['Novo Hamburgo']),
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  })
  const env = {
    DB: db,
    APP_ORIGIN: 'https://crm.local',
    ESCALA_ACTOR_HMAC_KEY: 'test-secret',
  }

  const response = await worker.fetch(
    await signedRequest('https://escala.local/api/escala/professionals?unit=Novo%20Hamburgo', {
      secret: env.ESCALA_ACTOR_HMAC_KEY,
      actor: {
        id: 'injetor-1',
        email: 'injetor@local.test',
        role: 'INJETOR',
        allowedUnits: ['Novo Hamburgo'],
      },
    }),
    env,
  )

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { ok: false, error: 'FORBIDDEN' })
})

test('Escala enforces allowed unit scope on read operations', async () => {
  const db = new FakeD1()
  db.professionals.push({
    id: 'prof-1',
    name: 'Dra. Marina',
    status: 'Ativo',
    role: 'Injetor',
    shift: '',
    nickname: '',
    phone: '',
    email: '',
    instagram: '',
    color: '#0ea5e9',
    units_json: JSON.stringify(['BarraShoppingSul']),
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  })
  const env = {
    DB: db,
    APP_ORIGIN: 'https://crm.local',
    ESCALA_ACTOR_HMAC_KEY: 'test-secret',
  }

  const response = await worker.fetch(
    await signedRequest('https://escala.local/api/escala/professionals?unit=BarraShoppingSul', {
      secret: env.ESCALA_ACTOR_HMAC_KEY,
      actor: {
        id: 'gestor-1',
        email: 'gestor@local.test',
        role: 'GESTOR',
        allowedUnits: ['Novo Hamburgo'],
      },
    }),
    env,
  )

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { ok: false, error: 'FORBIDDEN_UNIT' })
})
