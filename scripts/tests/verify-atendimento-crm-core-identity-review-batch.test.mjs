import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fixturePath = path.join(root, 'docs/extraction/atendimento-crm-core-identity-review-batch.synthetic.json')
const scriptPath = path.join(root, 'scripts/verify-atendimento-crm-core-identity-review-batch.mjs')

test('reader accepts the synthetic fixture and prints only a sanitized summary', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--batch', fixturePath], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  const summary = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(summary).sort(), ['contract', 'digest', 'linkCount'])
  assert.equal(summary.contract, 'atendimento/crm-core/identity-review-batch/v1')
  assert.equal(summary.linkCount, 2)
  assert.match(summary.digest, /^sha256:[a-f0-9]{64}$/)

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
  assert.doesNotMatch(result.stdout, new RegExp(fixture.batchId))
  assert.doesNotMatch(result.stdout, new RegExp(fixture.runId))
  assert.doesNotMatch(result.stdout, new RegExp(fixture.links[0].attendanceId))
})

test('reader offers no apply, database, or delivery operation', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--apply'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /OPERATION_NOT_SUPPORTED/)
})
