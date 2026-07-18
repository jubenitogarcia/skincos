#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const args = new Set(process.argv.slice(2))
const sourceIndex = process.argv.indexOf('--source')
const source = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : ''
const dryRun = args.has('--dry-run')
if (!source) throw new Error('Use --source <ponto_store.v2.json>')
if (!dryRun) throw new Error('Importer write mode is intentionally disabled until a D1 target is provided by CI; run --dry-run to validate safely.')

const path = resolve(source)
const raw = await readFile(path, 'utf8')
const checksum = createHash('sha256').update(raw).digest('hex')
const parsed = JSON.parse(raw)
const employees = Array.isArray(parsed?.employees) ? parsed.employees : []
const records = Array.isArray(parsed?.records) ? parsed.records : []
const invalid = []
const seen = new Set()
for (const record of records) {
  const key = `${record?.id || ''}:${record?.at || ''}`
  if (!record?.employeeId || !record?.at || !record?.id) invalid.push(record?.id || '<unknown>')
  if (seen.has(key)) invalid.push(record?.id || '<duplicate>')
  seen.add(key)
}
const report = { ok: invalid.length === 0, dryRun: true, source: path, checksum, employees: employees.length, records: records.length, invalid: invalid.length, duplicateKeys: records.length - seen.size }
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exitCode = 2
