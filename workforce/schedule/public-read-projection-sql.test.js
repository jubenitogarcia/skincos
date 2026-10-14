import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { SCHEDULE_PUBLIC_READ_PROFILE_SQL, SCHEDULE_PUBLIC_READ_REFERENCES_SQL, createSchedulePublicReadCatalogue } from './public-read-projection.js'

const id = '11111111-1111-4111-8111-111111111111'
function sourceDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('create table professionals (id text primary key, name text unique not null, status text, role text, units_json text); create table schedule_entries (professional_id text, professional_name text, unit text, date text)')
  db.prepare('insert into professionals values (?, ?, ?, ?, ?)').run(id, 'Dra. Ana Sintética', 'Ativo', 'Injetor', '["Novo Hamburgo"]')
  db.prepare('insert into schedule_entries values (?, ?, ?, ?)').run(id, 'Dra. Ana Sintética', 'Novo Hamburgo', '2026-10-14')
  return db
}
test('exact core SELECTs return bounded fields and preserve nullable references in real SQLite', () => {
  const db = sourceDb()
  try {
    const rows = db.prepare(SCHEDULE_PUBLIC_READ_PROFILE_SQL).all(513)
    assert.deepEqual(Object.keys(rows[0]).sort(), ['id', 'name', 'projection_oversized', 'role', 'status', 'units_json'].sort())
    assert.equal(rows[0].projection_oversized, 0)
    const catalogue = createSchedulePublicReadCatalogue(rows)
    assert.deepEqual(catalogue.roster('novo-hamburgo'), [{ id, name: 'Dra. Ana Sintética' }])
    db.exec('update schedule_entries set professional_id = null')
    const refs = db.prepare(SCHEDULE_PUBLIC_READ_REFERENCES_SQL).all('Novo Hamburgo', '2026-10-14', 513)
    assert.equal(refs[0].professional_id, null)
    assert.equal(refs[0].projection_oversized, 0)
    assert.deepEqual(catalogue.availability(refs, 'novo-hamburgo'), catalogue.roster('novo-hamburgo'))
    assert.deepEqual(db.prepare(SCHEDULE_PUBLIC_READ_REFERENCES_SQL).all('Novo Hamburgo', '2000-01-01', 513), [])
    db.exec('update professionals set status = null, role = null')
    const nullable = db.prepare(SCHEDULE_PUBLIC_READ_PROFILE_SQL).all(513)
    assert.equal(nullable[0].projection_oversized, 0)
    assert.equal(nullable[0].status, null); assert.equal(nullable[0].role, null)
    assert.deepEqual(createSchedulePublicReadCatalogue(nullable).roster('novo-hamburgo'), [])
  } finally { db.close() }
})
test('oversized source fields remain represented by an overflow flag and fail closed without transmitting the value', () => {
  for (const [field, cap] of Object.entries({ id: 128, name: 256, status: 128, role: 4096, units_json: 4096 })) {
    const db = sourceDb()
    try {
      const value = field === 'name' ? 'é'.repeat(cap / 2 + 1) : 'x'.repeat(cap + 1)
      db.prepare('update professionals set ' + field + ' = ?').run(value)
      const rows = db.prepare(SCHEDULE_PUBLIC_READ_PROFILE_SQL).all(513)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].projection_oversized, 1)
      assert.equal(rows[0][field], null)
      assert.equal(JSON.stringify(rows).includes(value), false)
      assert.throws(() => createSchedulePublicReadCatalogue(rows))
    } finally { db.close() }
  }
  const db = sourceDb()
  try {
    const catalogue = createSchedulePublicReadCatalogue(db.prepare(SCHEDULE_PUBLIC_READ_PROFILE_SQL).all(513))
    for (const [field, cap] of Object.entries({ professional_id: 128, professional_name: 256 })) {
      db.prepare('update schedule_entries set professional_id = ?, professional_name = ?').run(id, 'Dra. Ana Sintética')
      db.prepare('update schedule_entries set ' + field + ' = ?').run('x'.repeat(cap + 1))
      const refs = db.prepare(SCHEDULE_PUBLIC_READ_REFERENCES_SQL).all('Novo Hamburgo', '2026-10-14', 513)
      assert.equal(refs.length, 1); assert.equal(refs[0].projection_oversized, 1); assert.equal(refs[0][field], null)
      assert.throws(() => catalogue.availability(refs, 'novo-hamburgo'))
    }
  } finally { db.close() }
})
test('the real query returns a sentinel extra row so the 512-row cap never silently truncates', () => {
  const db = sourceDb()
  try {
    const insert = db.prepare('insert into professionals values (?, ?, ?, ?, ?)')
    for (let index = 1; index <= 513; index++) insert.run('id-' + index, 'Synthetic ' + index, 'Inativo', 'Consultor', '[]')
    const rows = db.prepare(SCHEDULE_PUBLIC_READ_PROFILE_SQL).all(513)
    assert.equal(rows.length, 513)
    assert.throws(() => createSchedulePublicReadCatalogue(rows))
  } finally { db.close() }
})
