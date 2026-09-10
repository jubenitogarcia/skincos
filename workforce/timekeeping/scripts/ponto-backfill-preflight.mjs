#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PONTO_BACKFILL_STAGING_DESTINATION = Object.freeze({
  environment: 'staging',
  databaseName: 'skincos-timekeeping-staging',
  databaseId: '0f79d918-c11b-432a-9d0b-70f74f3347c7',
})

const VALUE_ARGUMENTS = new Set(['--snapshot', '--target', '--database-id'])
const MUTATION_ARGUMENTS = new Set([
  '--apply',
  '--remote',
  '--confirm-production',
  '--backup',
  '--rollback-run',
  '--config',
  '--database',
])

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function requiredOption(options, name) {
  const value = String(options[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

/**
 * Parse a deliberately small command surface. This is not an importer and
 * rejects every import, rollback, backup, remote, or config option before the
 * snapshot is opened.
 */
export function parsePontoBackfillPreflightArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = String(argv[index] || '')
    if (MUTATION_ARGUMENTS.has(name)) {
      throw new Error(`mutation argument ${name} is not accepted by the read-only preflight`)
    }
    if (!VALUE_ARGUMENTS.has(name)) {
      throw new Error(`unsupported preflight argument ${name || '<empty>'}`)
    }
    if (Object.hasOwn(options, name)) throw new Error(`${name} may be supplied only once`)
    const value = String(argv[index + 1] || '').trim()
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    options[name] = value
    index += 1
  }

  const snapshot = requiredOption(options, '--snapshot')
  const target = requiredOption(options, '--target').toLowerCase()
  const databaseId = requiredOption(options, '--database-id').toLowerCase()
  if (target !== PONTO_BACKFILL_STAGING_DESTINATION.environment) {
    throw new Error('only the staging target is allowed by this preflight')
  }
  if (databaseId !== PONTO_BACKFILL_STAGING_DESTINATION.databaseId) {
    throw new Error('the selected D1 database is not allowlisted for Ponto staging')
  }

  const snapshotPath = resolve(snapshot)
  if (basename(snapshotPath) !== 'ponto_store.v2.json') {
    throw new Error('the snapshot must be explicitly named ponto_store.v2.json')
  }

  return { snapshotPath, target, databaseId }
}

function parseV2Snapshot(raw) {
  let snapshot
  try {
    snapshot = JSON.parse(raw)
  } catch {
    throw new Error('the Ponto V2 snapshot is not valid JSON')
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Number(snapshot.version) !== 2) {
    throw new Error('the snapshot is not a Ponto V2 store')
  }
  for (const collection of ['employees', 'devices', 'records']) {
    if (!Array.isArray(snapshot[collection])) {
      throw new Error(`the Ponto V2 snapshot is missing the ${collection} collection`)
    }
  }
  return snapshot
}

/**
 * Produces a sanitized, source-only admission report. It deliberately makes no
 * D1 request: the exact destination is checked against the immutable staging
 * allowlist, while live identity/schema validation remains a separate gate.
 */
export async function preflightPontoBackfill({ argv, readFileFn = readFile } = {}) {
  const { snapshotPath, target, databaseId } = parsePontoBackfillPreflightArgs(argv || [])
  let raw
  try {
    raw = await readFileFn(snapshotPath, 'utf8')
  } catch {
    throw new Error('the Ponto V2 snapshot could not be read')
  }

  const snapshot = parseV2Snapshot(raw)
  const records = snapshot.records
  const punches = records.filter((record) => record?.kind === 'PUNCH').length
  const corrections = records.filter((record) => record?.kind === 'CORRECTION').length

  return {
    schemaVersion: 1,
    kind: 'ponto-backfill-preflight',
    result: 'passed-read-only',
    source: {
      requiredFilename: 'ponto_store.v2.json',
      schemaVersion: 2,
      sha256: sha256(raw),
      bytes: Buffer.byteLength(raw, 'utf8'),
      counts: {
        employees: snapshot.employees.length,
        devices: snapshot.devices.length,
        records: records.length,
        punches,
        corrections,
        otherRecords: records.length - punches - corrections,
      },
    },
    destination: {
      target,
      databaseName: PONTO_BACKFILL_STAGING_DESTINATION.databaseName,
      databaseIdSha256: sha256(databaseId),
      staticAllowlistMatched: true,
      liveIdentityChecked: false,
      schemaChecked: false,
    },
    guarantees: {
      sourceReadOnly: true,
      databaseReadOrWritePerformed: false,
      migrationPerformed: false,
      deploymentPerformed: false,
      credentialsRead: false,
      customerDataEmitted: false,
    },
    nextGates: [
      'Keep the V2 snapshot and its separate legacy audit export in private operator storage.',
      'Verify the live staging D1 identity, schema lineage, and backup/restore plan in a separate staging gate.',
      'Use a separately reviewed import operation; this preflight never authorizes or performs an import.',
    ],
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  try {
    const report = await preflightPontoBackfill({ argv: process.argv.slice(2) })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`Ponto backfill preflight refused: ${error.message}\n`)
    process.exitCode = 2
  }
}
