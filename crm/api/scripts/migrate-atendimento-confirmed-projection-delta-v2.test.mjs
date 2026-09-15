import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./migrate-atendimento-confirmed-projection-delta-v2.mjs', import.meta.url))

function run(arguments_) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    encoding: 'utf8',
    // Never inherit a real operator DATABASE_URL into a CLI parsing test.
    // The expected failure occurs before a pool is constructed or a network
    // connection can be attempted.
    env: { ...process.env, DATABASE_URL: '' },
  })
}

test('accepts staging as a schema-only target but still requires its strict destination', () => {
  const result = run(['--apply', '--target=staging'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /DATABASE_URL deve apontar exclusivamente para skincos_staging via loopback TLS e login migrator\./)
  assert.doesNotMatch(result.stderr, /não aceita staging/i)
  assert.doesNotMatch(result.stderr, /controlled-production-source/i)
})

test('keeps the production source flag mandatory', () => {
  const result = run(['--apply', '--target=production'])
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Production requer --controlled-production-source/)
})
