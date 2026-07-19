#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const state = resolve(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
const sqliteName = (await readdir(state)).find((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
assert.ok(sqliteName, 'local D1 sqlite not found; apply migrations first')
const db = new DatabaseSync(resolve(state, sqliteName))
const fixture = resolve(root, 'fixtures/ponto_store.synthetic.json')
const temporary = await mkdtemp(resolve(tmpdir(), 'timekeeping-migration-test-'))

function run(args, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts/import-ponto-json.mjs'), ...args], {
    cwd: resolve(root, '../..'), encoding: 'utf8', env: { ...process.env, PONTO_TEMPLATES_KEY: 'migration-test-template-key' },
  })
  assert.equal(result.status, expectedStatus, `${result.stdout}\n${result.stderr}`)
  return result
}

try {
  const at = '2026-01-01T10:00:00.000Z'
  db.exec('BEGIN IMMEDIATE')
  db.prepare(`INSERT INTO workforce_employees (id, canonical_employee_id, display_name, status, created_at, updated_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?)`).run('synthetic-employee-001', 'canonical-preexisting', 'Preexisting employee', at, at)
  db.prepare(`INSERT INTO timekeeping_events (id, employee_id, unit_id, event_type, source, occurred_at_utc, work_date, idempotency_scope, idempotency_key, request_fingerprint, created_by, created_at) VALUES (?, ?, ?, 'WORK_START', 'IMPORT', ?, '2026-01-02', ?, ?, ?, 'preexisting', ?)`).run('synthetic-punch-001', 'synthetic-employee-001', 'SYNTHETIC_UNIT', '2026-01-02T11:00:00.000Z', 'preexisting:employee', 'preexisting:1', 'preexisting-fingerprint-1', at)
  db.prepare(`INSERT INTO timekeeping_events (id, employee_id, unit_id, event_type, source, occurred_at_utc, work_date, idempotency_scope, idempotency_key, request_fingerprint, created_by, created_at) VALUES (?, ?, ?, 'WORK_END', 'IMPORT', ?, '2026-01-02', ?, ?, ?, 'preexisting', ?)`).run('synthetic-punch-002', 'synthetic-employee-001', 'SYNTHETIC_UNIT', '2026-01-02T19:00:00.000Z', 'preexisting:employee', 'preexisting:2', 'preexisting-fingerprint-2', at)
  db.exec('COMMIT')

  const backup = resolve(temporary, 'checkpoint.json')
  const applied = run(['--source', fixture, '--apply', '--database', 'skincos-timekeeping', '--backup', backup])
  const output = JSON.parse(applied.stdout.slice(applied.stdout.lastIndexOf('\n{') + 1))
  assert.ok(output.rollback)
  run(['--rollback-run', output.runId, '--backup', output.rollback, '--database', 'skincos-timekeeping'])
  assert.equal(db.prepare('SELECT display_name FROM workforce_employees WHERE id=?').get('synthetic-employee-001').display_name, 'Preexisting employee')
  assert.equal(db.prepare(`SELECT count(*) AS total FROM timekeeping_events WHERE id IN ('synthetic-punch-001','synthetic-punch-002')`).get().total, 2)

  const duplicate = JSON.parse(await readFile(fixture, 'utf8'))
  duplicate.employees.push({ ...duplicate.employees[0], unit: 'OTHER_UNIT' })
  const duplicatePath = resolve(temporary, 'duplicate.json')
  await writeFile(duplicatePath, JSON.stringify(duplicate))
  run(['--source', duplicatePath, '--dry-run'], 2)
} finally {
  try { db.exec('ROLLBACK') } catch { /* no active transaction */ }
  db.prepare(`DELETE FROM timekeeping_events WHERE created_by='preexisting'`).run()
  db.prepare(`DELETE FROM workforce_employees WHERE id='synthetic-employee-001'`).run()
  db.prepare(`DELETE FROM timekeeping_migration_items WHERE migration_run_id LIKE 'ponto-json:%'`).run()
  db.prepare(`DELETE FROM timekeeping_migration_runs WHERE id LIKE 'ponto-json:%'`).run()
  db.close()
  await rm(temporary, { recursive: true, force: true })
}

console.log(JSON.stringify({ ok: true, rollbackPreservedPreexistingRows: true, duplicateEmployeesRejected: true }))
