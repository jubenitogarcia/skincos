function normalizedSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase()
}
class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = [] }
  bind(...params) { this.params = params; return this }
  async first() { return this.db.first(this.sql, this.params) }
  async all() { return { success: true, results: this.db.all(this.sql, this.params) } }
  async run() { this.db.writeAttempts++; throw new Error('public-read fixture refuses writes') }
}
export class PublicReadTestD1 {
  constructor({ professionals = [], scheduleEntries = [], closedDays = [], holidays = [], available = true } = {}) {
    Object.assign(this, { professionals, scheduleEntries, closedDays, holidays, available })
    this.sessions = []; this.batches = []; this.writeAttempts = 0
  }
  prepare(sql) { return new Statement(this, sql) }
  withSession(constraint) {
    this.sessions.push(constraint)
    if (constraint !== 'first-primary') throw new Error('unexpected consistency constraint')
    return { prepare: (sql) => this.prepare(sql), batch: (statements) => this.batch(statements) }
  }
  async batch(statements) {
    this.batches.push(statements.map(({ sql }) => sql))
    if (statements.some(({ sql }) => !/^\s*select\b/i.test(sql))) { this.writeAttempts++; throw new Error('public-read fixture refuses writes') }
    return Promise.all(statements.map((statement) => statement.all()))
  }
  first(sql, params) {
    const rows = this.all(sql, params)
    return rows[0] || null
  }
  all(sql, params) {
    if (!this.available) throw new Error('database unavailable')
    const query = normalizedSql(sql)
    if (query === 'select 1 as ready') return [{ ready: 1 }]
    if (query.includes('from closed_days')) return this.closedDays.some((entry) => entry.unit === params[0] && entry.date === params[1]) ? [{ found: 1 }] : []
    if (query.includes('from holidays')) return this.holidays.some((entry) => entry.unit === params[0] && entry.date === params[1]) ? [{ found: 1 }] : []
    if (query.includes('from schedule_entries')) {
      if (query.endsWith('limit 0')) return []
      return this.scheduleEntries.filter((entry) => entry.unit === params[0] && entry.date === params[1])
        .sort((left, right) => String(left.professional_name).localeCompare(String(right.professional_name)))
        .slice(0, params[2] ?? Infinity)
        .map((entry) => ({ professional_id: entry.professional_id ?? null, professional_name: entry.professional_name }))
    }
    if (query.includes('from professionals')) return [...this.professionals]
      .sort((left, right) => String(left.id).localeCompare(String(right.id))).slice(0, params[0] ?? Infinity).map((entry) => ({ ...entry }))
    throw new Error('unsupported public-read fixture query')
  }
}
export const PUBLIC_READ_TEST_ACTIVE_ID = '11111111-1111-4111-8111-111111111111'
export const PUBLIC_READ_TEST_INACTIVE_ID = '22222222-2222-4222-8222-222222222222'
export function createPublicReadTestDb() {
  return new PublicReadTestD1({ professionals: [
    { id: PUBLIC_READ_TEST_ACTIVE_ID, name: 'Dra. Ana Teste', status: 'Ativo', role: 'Injetor', nickname: 'Ana', instagram: '@dra.ana.teste',
      phone: 'private-phone-must-not-leak', email: 'private-email-must-not-leak@example.invalid', units_json: JSON.stringify(['Novo Hamburgo']) },
    { id: PUBLIC_READ_TEST_INACTIVE_ID, name: 'Dra. Inativa Teste', status: 'Inativo', role: 'Injetor', nickname: 'Inativa', instagram: '@dra.inativa',
      phone: 'private-phone-must-not-leak', email: 'private-email-must-not-leak@example.invalid', units_json: JSON.stringify(['Novo Hamburgo']) },
  ], scheduleEntries: [{ unit: 'Novo Hamburgo', date: '2026-09-15', professional_name: 'Dra. Ana Teste', professional_id: PUBLIC_READ_TEST_ACTIVE_ID }] })
}
