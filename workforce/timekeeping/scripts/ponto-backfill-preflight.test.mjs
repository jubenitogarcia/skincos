import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  PONTO_BACKFILL_STAGING_DESTINATION,
  preflightPontoBackfill,
} from './ponto-backfill-preflight.mjs'

const root = path.resolve(import.meta.dirname, '..')
const script = path.join(root, 'scripts', 'ponto-backfill-preflight.mjs')
const fixture = path.join(root, 'fixtures', 'ponto_store.synthetic.json')

async function withSnapshot(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ponto-backfill-preflight-'))
  const snapshot = path.join(directory, 'ponto_store.v2.json')
  await copyFile(fixture, snapshot)
  try {
    await callback({ directory, snapshot })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function invoke(args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

test('accepts only an explicit V2 snapshot and the immutable staging D1 allowlist', async () => {
  await withSnapshot(async ({ snapshot }) => {
    const result = invoke([
      '--snapshot', snapshot,
      '--target', 'staging',
      '--database-id', PONTO_BACKFILL_STAGING_DESTINATION.databaseId,
    ])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    const report = JSON.parse(result.stdout)
    const serialized = JSON.stringify(report)
    assert.equal(report.result, 'passed-read-only')
    assert.equal(report.source.schemaVersion, 2)
    assert.deepEqual(report.source.counts, {
      employees: 1,
      devices: 0,
      records: 2,
      punches: 2,
      corrections: 0,
      otherRecords: 0,
    })
    assert.equal(report.destination.target, 'staging')
    assert.equal(report.destination.databaseName, 'skincos-timekeeping-staging')
    assert.equal(report.destination.staticAllowlistMatched, true)
    assert.equal(report.destination.liveIdentityChecked, false)
    assert.equal(report.guarantees.databaseReadOrWritePerformed, false)
    assert.equal(report.guarantees.migrationPerformed, false)
    assert.equal(report.guarantees.deploymentPerformed, false)
    assert.equal(report.guarantees.credentialsRead, false)
    assert.equal(serialized.includes(snapshot), false)
    assert.equal(serialized.includes(PONTO_BACKFILL_STAGING_DESTINATION.databaseId), false)
    assert.equal(serialized.includes('synthetic-employee-001'), false)
  })
})

test('refuses production, a non-allowlisted D1, an implicit snapshot name, and importer mutation flags', async () => {
  await withSnapshot(async ({ directory, snapshot }) => {
    const production = invoke([
      '--snapshot', snapshot,
      '--target', 'production',
      '--database-id', PONTO_BACKFILL_STAGING_DESTINATION.databaseId,
    ])
    assert.equal(production.status, 2)
    assert.match(production.stderr, /only the staging target is allowed/)
    assert.equal(production.stdout, '')

    const wrongDatabase = invoke([
      '--snapshot', snapshot,
      '--target', 'staging',
      '--database-id', '11111111-1111-4111-8111-111111111111',
    ])
    assert.equal(wrongDatabase.status, 2)
    assert.match(wrongDatabase.stderr, /not allowlisted/)
    assert.equal(wrongDatabase.stdout, '')

    const renamedSnapshot = path.join(directory, 'ponto_store.copy.json')
    await copyFile(snapshot, renamedSnapshot)
    const implicitSnapshot = invoke([
      '--snapshot', renamedSnapshot,
      '--target', 'staging',
      '--database-id', PONTO_BACKFILL_STAGING_DESTINATION.databaseId,
    ])
    assert.equal(implicitSnapshot.status, 2)
    assert.match(implicitSnapshot.stderr, /explicitly named ponto_store\.v2\.json/)
    assert.equal(implicitSnapshot.stdout, '')

    const mutation = invoke([
      '--snapshot', snapshot,
      '--target', 'staging',
      '--database-id', PONTO_BACKFILL_STAGING_DESTINATION.databaseId,
      '--apply',
    ])
    assert.equal(mutation.status, 2)
    assert.match(mutation.stderr, /mutation argument --apply is not accepted/)
    assert.equal(mutation.stdout, '')
  })
})

test('refuses a snapshot that is not schema version 2 without exposing its contents', async () => {
  await withSnapshot(async ({ snapshot }) => {
    const invalid = JSON.parse(await readFile(snapshot, 'utf8'))
    invalid.version = 1
    await writeFile(snapshot, JSON.stringify(invalid), 'utf8')
    const result = invoke([
      '--snapshot', snapshot,
      '--target', 'staging',
      '--database-id', PONTO_BACKFILL_STAGING_DESTINATION.databaseId,
    ])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /not a Ponto V2 store/)
    assert.equal(result.stderr.includes('synthetic-employee-001'), false)
    assert.equal(result.stdout, '')
  })
})

test('library report is source-only and the script contains no remote, credential, or filesystem mutation path', async () => {
  await withSnapshot(async ({ snapshot }) => {
    const report = await preflightPontoBackfill({
      argv: [
        '--snapshot', snapshot,
        '--target', 'staging',
        '--database-id', PONTO_BACKFILL_STAGING_DESTINATION.databaseId,
      ],
    })
    assert.equal(report.guarantees.sourceReadOnly, true)
    assert.equal(report.guarantees.customerDataEmitted, false)
  })

  const source = fs.readFileSync(script, 'utf8')
  assert.doesNotMatch(source, /node:child_process|\bfetch\b|\bspawn(?:Sync)?\b|\bexec(?:File)?\b|\bwriteFile\b|\bmkdir\b|\brm\b|process\.env|CLOUDFLARE_API_TOKEN|wrangler/)
  assert.match(source, /readFile/)
})
