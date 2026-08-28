function normalizedSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

class Statement {
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
}

export class PublicReadTestD1 {
  constructor({ professionals = [], scheduleEntries = [], closedDays = [], holidays = [], available = true } = {}) {
    this.professionals = professionals
    this.scheduleEntries = scheduleEntries
    this.closedDays = closedDays
    this.holidays = holidays
    this.available = available
  }

  prepare(sql) {
    return new Statement(this, sql)
  }

  first(sql, params) {
    if (!this.available) throw new Error('database unavailable')
    const query = normalizedSql(sql)
    if (query === 'select 1 as ready') return { ready: 1 }
    if (query.includes('from closed_days')) {
      return this.closedDays.some((entry) => entry.unit === params[0] && entry.date === params[1]) ? { found: 1 } : null
    }
    if (query.includes('from holidays')) {
      return this.holidays.some((entry) => entry.unit === params[0] && entry.date === params[1]) ? { found: 1 } : null
    }
    throw new Error(`unsupported first query: ${sql}`)
  }

  all(sql, params) {
    if (!this.available) throw new Error('database unavailable')
    const query = normalizedSql(sql)
    if (query.includes('from schedule_entries')) {
      return this.scheduleEntries
        .filter((entry) => entry.unit === params[0] && entry.date === params[1])
        .sort((left, right) => String(left.professional_name).localeCompare(String(right.professional_name)))
        .map((entry) => ({ professional: entry.professional_name }))
    }
    if (query.includes('from professionals')) {
      return [...this.professionals]
        .sort((left, right) => String(left.name).localeCompare(String(right.name)))
        .map((entry) => ({ ...entry }))
    }
    throw new Error(`unsupported all query: ${sql}`)
  }
}

export function createPublicReadTestDb() {
  return new PublicReadTestD1({
    professionals: [
      {
        name: 'Dra. Ana Teste',
        status: 'Ativo',
        role: 'Injetora',
        nickname: 'Ana',
        instagram: '@dra.ana.teste',
        phone: 'private-phone-must-not-leak',
        email: 'private-email-must-not-leak@example.invalid',
        units_json: JSON.stringify(['Novo Hamburgo']),
      },
      {
        name: 'Dra. Inativa Teste',
        status: 'Inativo',
        role: 'Injetora',
        nickname: 'Inativa',
        instagram: '@dra.inativa',
        phone: 'private-phone-must-not-leak',
        email: 'private-email-must-not-leak@example.invalid',
        units_json: JSON.stringify(['Novo Hamburgo']),
      },
    ],
    scheduleEntries: [
      { unit: 'Novo Hamburgo', date: '2026-09-15', professional_name: 'Dra. Ana Teste' },
    ],
    closedDays: [],
    holidays: [],
  })
}
