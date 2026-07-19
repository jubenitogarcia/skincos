#!/usr/bin/env node
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { copyFile, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { decryptLegacyBiometricTemplate, validLegacyBiometricTemplate } from '../legacyBiometric.js'

const argv = process.argv.slice(2)
const valueFor = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : '' }
const has = (name) => argv.includes(name)
const source = valueFor('--source')
const dryRun = has('--dry-run')
const apply = has('--apply')
const rollbackRun = valueFor('--rollback-run')
const database = valueFor('--database') || 'skincos-timekeeping'
const databaseId = valueFor('--database-id')
const remote = has('--remote')
const backupPath = valueFor('--backup')
const config = resolve(valueFor('--config') || fileURLToPath(new URL('../wrangler.toml', import.meta.url)))

function fail(message, code = 1) { console.error(message); process.exit(code) }
function sql(value) { return value === null || value === undefined ? 'NULL' : `'${String(value).replaceAll("'", "''")}'` }
function sha(value) { return createHash('sha256').update(value).digest('hex') }
function validDate(value) { return Number.isFinite(Date.parse(String(value || ''))) }
function eventType(value) { return ({ IN: 'WORK_START', OUT: 'WORK_END', WORK_START: 'WORK_START', BREAK_START: 'BREAK_START', BREAK_END: 'BREAK_END', WORK_END: 'WORK_END' })[String(value || '').toUpperCase()] || null }
function sourceType(value) { return ({ FACE: 'FACE', PIN: 'PIN', ADMIN: 'MANUAL', MANUAL: 'MANUAL', IMPORT: 'IMPORT' })[String(value || '').toUpperCase()] || 'IMPORT' }

function wrangler(args, { json = false } = {}) {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(executable, ['--yes', 'wrangler@4.112.0', '--config', config, ...args], { cwd: dirname(config), encoding: 'utf8', stdio: json ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
  if (result.status !== 0) fail(json ? String(result.stderr || result.stdout || 'Wrangler failed') : `Wrangler failed (${result.status})`)
  return json ? String(result.stdout || '') : ''
}

async function findLocalDatabase() {
  const stateDirectory = resolve(dirname(config), '.wrangler/state/v3/d1/miniflare-D1DatabaseObject')
  const files = await readdir(stateDirectory).catch(() => [])
  const sqlite = files.find((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
  return sqlite ? { stateDirectory, files, sqlite, path: resolve(stateDirectory, sqlite) } : null
}

function remoteD1Context() {
  const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim()
  const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || '').trim()
  if (!accountId || !apiToken || !databaseId) fail('Remote operation requires CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and --database-id')
  return { accountId, apiToken, base: `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}` }
}

async function remoteD1Query(query) {
  const { apiToken, base } = remoteD1Context()
  const response = await fetch(`${base}/query`, { method: 'POST', headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ sql: query }) })
  const payload = await response.json().catch(() => null)
  if (!response.ok || payload?.success === false) throw new Error(`D1_QUERY_HTTP_${response.status}`)
  return payload?.result?.[0]?.results || []
}

async function remoteD1Export(targetPath) {
  const { apiToken, base } = remoteD1Context(); const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }
  let bookmark = null
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await fetch(`${base}/export`, { method: 'POST', headers, body: JSON.stringify({ output_format: 'polling', ...(bookmark ? { current_bookmark: bookmark } : {}) }) })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.success === false) throw new Error(`D1_EXPORT_HTTP_${response.status}`)
    const result = payload?.result || {}
    if (result.status === 'error') throw new Error('D1_EXPORT_FAILED')
    if (result.status === 'complete' && result.result?.signed_url) {
      const download = await fetch(result.result.signed_url)
      if (!download.ok) throw new Error('D1_EXPORT_DOWNLOAD_FAILED')
      await writeFile(targetPath, new Uint8Array(await download.arrayBuffer()), { mode: 0o600 })
      return
    }
    bookmark = result.at_bookmark || bookmark
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }
  throw new Error('D1_EXPORT_TIMEOUT')
}

async function remoteD1Import(sqlText) {
  const { apiToken, base } = remoteD1Context()
  const endpoint = `${base}/import`
  const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }
  // lgtm[js/weak-cryptographic-algorithm]: Cloudflare D1 requires this MD5 only
  // as the transport ETag for an import upload; it is never a security control.
  const etag = createHash('md5').update(sqlText).digest('hex')
  const requestJson = async (body) => {
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.success === false) throw new Error(`D1_IMPORT_HTTP_${response.status}`)
    return payload
  }
  const initialized = await requestJson({ action: 'init', etag })
  const uploadUrl = initialized?.result?.upload_url; const filename = initialized?.result?.filename
  if (!uploadUrl || !filename) throw new Error('D1_IMPORT_INIT_INVALID')
  const upload = await fetch(uploadUrl, { method: 'PUT', body: sqlText })
  if (!upload.ok || String(upload.headers.get('etag') || '').replaceAll('"', '') !== etag) throw new Error('D1_IMPORT_UPLOAD_FAILED')
  const ingested = await requestJson({ action: 'ingest', etag, filename })
  let bookmark = ingested?.result?.at_bookmark
  if (!bookmark) throw new Error('D1_IMPORT_INGEST_INVALID')
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const polled = await requestJson({ action: 'poll', current_bookmark: bookmark })
    const result = polled?.result || {}
    if (result.success || result.error === 'Not currently importing anything.') return
    if (result.error) throw new Error('D1_IMPORT_FAILED')
    bookmark = result.at_bookmark || bookmark
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }
  throw new Error('D1_IMPORT_TIMEOUT')
}

function encryptTemplate(template, secret) {
  if (!secret || !validLegacyBiometricTemplate(template)) return null
  const key = createHash('sha256').update(String(secret)).digest()
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(template), 'utf8'), cipher.final(), cipher.getAuthTag()])
  const b64url = (buffer) => buffer.toString('base64url')
  return JSON.stringify({ v: 1, alg: 'A256GCM', iv: b64url(iv), ciphertext: b64url(encrypted) })
}

function validate(parsed) {
  const errors = []
  if (!parsed || typeof parsed !== 'object' || Number(parsed.version) !== 2) errors.push('ROOT_VERSION_INVALID')
  for (const field of ['employees', 'devices', 'records']) if (!Array.isArray(parsed?.[field])) errors.push(`${field.toUpperCase()}_NOT_ARRAY`)
  return errors
}

if (rollbackRun) {
  if (!backupPath) fail('Use --backup <rollback.sql> with --rollback-run')
  if (remote && !has('--confirm-production')) fail('Remote rollback requires --confirm-production')
  if (remote) {
    if (process.env.PONTO_IMPORT_PRODUCTION_CONFIRM !== rollbackRun) fail('Set PONTO_IMPORT_PRODUCTION_CONFIRM to the rollback run id')
    const rollbackSql = (await readFile(resolve(backupPath), 'utf8')).replace(/^BEGIN;$/gm, '').replace(/^COMMIT;$/gm, '')
    await remoteD1Import(rollbackSql)
  } else {
    const local = await findLocalDatabase()
    if (!local) fail('Local D1 SQLite database was not found')
    const databaseHandle = new DatabaseSync(local.path)
    try { databaseHandle.exec(await readFile(resolve(backupPath), 'utf8')) } finally { databaseHandle.close() }
  }
  console.log(JSON.stringify({ ok: true, rollbackRun, database, remote }, null, 2))
  process.exit(0)
}

if (!source) fail('Use --source <ponto_store.v2.json>')
const sourcePath = resolve(source)
const raw = await readFile(sourcePath, 'utf8').catch(() => fail('Source file could not be read'))
let parsed
try { parsed = JSON.parse(raw) } catch { fail('Source JSON is invalid', 2) }
const schemaErrors = validate(parsed)
if (schemaErrors.length) fail(`Source schema rejected: ${schemaErrors.join(', ')}`, 2)

const checksum = sha(raw); const runId = `ponto-json:${checksum.slice(0, 24)}`; const now = new Date().toISOString()
const employees = parsed.employees.filter(Boolean); const devices = parsed.devices.filter(Boolean); const punches = parsed.records.filter((row) => row?.kind === 'PUNCH'); const corrections = parsed.records.filter((row) => row?.kind === 'CORRECTION')
const invalid = []; const duplicates = []; const seen = new Set(); const seenEmployees = new Set(); const employeeIds = new Set(employees.map((row) => String(row.id || '')))
const emailGroups = new Map()
for (const employee of employees) {
  const email = String(employee.loginEmail || '').trim().toLowerCase()
  if (email) emailGroups.set(email, [...(emailGroups.get(email) || []), String(employee.id || '')])
}
const identityConflicts = [...emailGroups.entries()].filter(([, ids]) => ids.length > 1)
for (const employee of employees) {
  if (!employee.id || !String(employee.name || '').trim()) invalid.push({ entity: 'employee', id: employee.id || '<missing>', reason: 'ID_OR_NAME_MISSING' })
  const employeeId = String(employee.id || '')
  if (employeeId && seenEmployees.has(employeeId)) duplicates.push({ entity: 'employee', id: employeeId })
  seenEmployees.add(employeeId)
  for (const [index, payload] of (Array.isArray(employee.faceTemplates) ? employee.faceTemplates : []).entries()) {
    if (!decryptLegacyBiometricTemplate(payload, process.env.PONTO_LEGACY_TEMPLATES_KEY)) invalid.push({ entity: 'biometric_template', id: `${employeeId}:${index}`, reason: 'INVALID_OR_UNDECRYPTABLE_TEMPLATE' })
  }
}
for (const record of punches) {
  const key = String(record.id || '')
  if (!record.id || !employeeIds.has(String(record.employeeId || '')) || !validDate(record.at) || !eventType(record.type)) invalid.push({ entity: 'punch', id: record.id || '<missing>', reason: 'INVALID_REFERENCE_DATE_OR_TYPE' })
  if (seen.has(key)) duplicates.push({ entity: 'punch', id: key })
  seen.add(key)
}
for (const correction of corrections) if (!correction.id || !seen.has(String(correction.targetRecordId || '')) || !validDate(correction.newAt || correction.createdAt)) invalid.push({ entity: 'correction', id: correction.id || '<missing>', reason: 'INVALID_TARGET_OR_DATE' })

const report = {
  ok: invalid.length === 0 && duplicates.length === 0,
  dryRun,
  source: sourcePath,
  checksum,
  counts: { employees: employees.length, devices: devices.length, punches: punches.length, corrections: corrections.length },
  invalid: invalid.length,
  duplicates: duplicates.length,
  pinsRequiringReset: employees.filter((employee) => employee.pinHash).length,
  biometricTemplates: employees.reduce((sum, employee) => sum + (Array.isArray(employee.faceTemplates) ? employee.faceTemplates.length : 0), 0),
  identityConflicts: identityConflicts.length,
}
console.log(JSON.stringify(report, null, 2))
if (!report.ok) process.exit(2)
if (dryRun) process.exit(0)
if (!apply) fail('Write mode requires explicit --apply')
if (!backupPath) fail('Write mode requires --backup <private-backup.sql>')
if (remote && !has('--confirm-production')) fail('Remote import requires --confirm-production')
if (remote && process.env.PONTO_IMPORT_PRODUCTION_CONFIRM !== checksum) fail('Set PONTO_IMPORT_PRODUCTION_CONFIRM to the printed source checksum for remote import')

const previous = remote
  ? JSON.stringify(await remoteD1Query(`SELECT status FROM timekeeping_migration_runs WHERE id=${sql(runId)} LIMIT 1`))
  : wrangler(['d1', 'execute', database, '--local', '--command', `SELECT status FROM timekeeping_migration_runs WHERE id=${sql(runId)} LIMIT 1`, '--json'], { json: true })
if (previous.includes('APPLIED')) fail('This exact source checksum was already applied; no write performed', 3)

const absoluteBackup = resolve(backupPath); await mkdir(dirname(absoluteBackup), { recursive: true })
if (remote) {
  await remoteD1Export(absoluteBackup)
} else {
  const local = await findLocalDatabase()
  if (!local) fail('Local D1 SQLite checkpoint source was not found')
  const copied = []
  for (const suffix of ['', '-wal', '-shm']) {
    const name = `${local.sqlite}${suffix}`
    if (!local.files.includes(name)) continue
    const target = `${absoluteBackup}.sqlite${suffix}`
    await copyFile(resolve(local.stateDirectory, name), target)
    copied.push(target)
  }
  await writeFile(absoluteBackup, JSON.stringify({ kind: 'local-d1-checkpoint', database, config, copied, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
}

const statements = ['PRAGMA foreign_keys=ON;']
const countsJson = JSON.stringify(report.counts)
statements.push(`INSERT INTO timekeeping_migration_runs (id,source_kind,source_checksum,status,source_counts_json,started_at) VALUES (${sql(runId)},'ponto_store.v2.json',${sql(checksum)},'APPLYING',${sql(countsJson)},${sql(now)}) ON CONFLICT(id) DO UPDATE SET status='APPLYING',source_counts_json=excluded.source_counts_json,result_counts_json=NULL,checkpoint_json=NULL,started_at=excluded.started_at,completed_at=NULL;`)
statements.push(`DELETE FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)};`)
for (const employee of employees) {
  const id = String(employee.id); const canonical = `legacy:ponto:${id}`; const status = employee.deletedAt || employee.active === false ? 'TERMINATED' : 'ACTIVE'; const createdAt = validDate(employee.createdAt) ? new Date(employee.createdAt).toISOString() : now; const updatedAt = validDate(employee.updatedAt) ? new Date(employee.updatedAt).toISOString() : createdAt
  const cpfHash = employee.cpf ? sha(String(employee.cpf).replace(/\D/g, '')) : null; const phoneHash = employee.phone ? sha(String(employee.phone).replace(/\D/g, '')) : null
  const employeeEmail = String(employee.loginEmail || '').trim().toLowerCase(); const safeEmail = employeeEmail && (emailGroups.get(employeeEmail) || []).length === 1 ? employeeEmail : null
  statements.push(`INSERT OR IGNORE INTO workforce_employees (id,canonical_employee_id,login_email,display_name,status,created_at,updated_at,terminated_at,employee_code,cpf_hash,phone_hash,birth_date,job_title,metadata_json) VALUES (${sql(id)},${sql(canonical)},${sql(safeEmail)},${sql(String(employee.name).trim())},${sql(status)},${sql(createdAt)},${sql(updatedAt)},${sql(employee.deletedAt || null)},${sql(employee.code || null)},${sql(cpfHash)},${sql(phoneHash)},${sql(employee.birthDate || null)},${sql(employee.jobTitle || null)},${sql(JSON.stringify({ importedFrom: 'ponto_store.v2.json', pinResetRequired: !!employee.pinHash, pendingLoginEmail: safeEmail ? undefined : employeeEmail || undefined }))});`)
  statements.push(`INSERT OR IGNORE INTO timekeeping_migration_items (migration_run_id,entity_type,source_id,target_id,checksum,created_at) SELECT ${sql(runId)},'employee',${sql(id)},${sql(id)},${sql(sha(JSON.stringify({ id, name: employee.name, status })))},${sql(now)} WHERE changes()=1;`)
  const aliasId = randomUUID()
  statements.push(`INSERT OR IGNORE INTO workforce_employee_aliases (id,employee_id,source,legacy_id,created_at) VALUES (${sql(aliasId)},${sql(id)},'PONTO_V2',${sql(id)},${sql(now)});`)
  statements.push(`INSERT OR IGNORE INTO timekeeping_migration_items (migration_run_id,entity_type,source_id,target_id,checksum,created_at) SELECT ${sql(runId)},'alias',${sql(id)},${sql(aliasId)},${sql(sha(`PONTO_V2:${id}`))},${sql(now)} WHERE changes()=1;`)
  if (employee.unit) {
    const unitAssignmentId = randomUUID()
    statements.push(`INSERT OR IGNORE INTO timekeeping_employee_units (id,employee_id,unit_id,effective_from,created_at) VALUES (${sql(unitAssignmentId)},${sql(id)},${sql(String(employee.unit))},${sql(createdAt.slice(0, 10))},${sql(createdAt)});`)
    statements.push(`INSERT OR IGNORE INTO timekeeping_migration_items (migration_run_id,entity_type,source_id,target_id,checksum,created_at) SELECT ${sql(runId)},'employee_unit',${sql(`${id}:${employee.unit}`)},${sql(unitAssignmentId)},${sql(sha(`${id}:${employee.unit}:${createdAt.slice(0, 10)}`))},${sql(now)} WHERE changes()=1;`)
  }
  let templateIndex = 0
  for (const templatePayload of Array.isArray(employee.faceTemplates) ? employee.faceTemplates : []) {
    const template = decryptLegacyBiometricTemplate(templatePayload, process.env.PONTO_LEGACY_TEMPLATES_KEY)
    const encrypted = template && Array.isArray(template) ? encryptTemplate(template, process.env.PONTO_TEMPLATES_KEY) : null
    if (encrypted) {
      const templateId = randomUUID()
      statements.push(`INSERT OR IGNORE INTO timekeeping_biometric_templates (id,employee_id,encrypted_template,consent_version,consented_at,consented_by,created_at) VALUES (${sql(templateId)},${sql(id)},${sql(encrypted)},${sql(employee.consent?.version || 'legacy-v2')},${sql(employee.consent?.obtainedAt || createdAt)},'legacy-import',${sql(now)});`)
      statements.push(`INSERT OR IGNORE INTO timekeeping_migration_items (migration_run_id,entity_type,source_id,target_id,checksum,created_at) SELECT ${sql(runId)},'biometric_template',${sql(`${id}:${templateIndex}`)},${sql(templateId)},${sql(sha(JSON.stringify(template)))},${sql(now)} WHERE changes()=1;`)
    }
    templateIndex += 1
  }
}
for (const [email, ids] of identityConflicts) {
  const conflictId = randomUUID()
  statements.push(`INSERT OR IGNORE INTO workforce_identity_conflicts (id,source,source_id,candidates_json,reasons_json,created_at) VALUES (${sql(conflictId)},'PONTO_LOGIN_EMAIL',${sql(email)},${sql(JSON.stringify(ids))},${sql(JSON.stringify(['DUPLICATE_LOGIN_EMAIL']))},${sql(now)});`)
  statements.push(`INSERT OR IGNORE INTO timekeeping_migration_items (migration_run_id,entity_type,source_id,target_id,checksum,created_at) SELECT ${sql(runId)},'identity_conflict',${sql(email)},${sql(conflictId)},${sql(sha(JSON.stringify(ids)))},${sql(now)} WHERE changes()=1;`)
}
for (const device of devices) {
  if (!device?.id || !device?.unit) continue
  const tokenHash = sha(`revoked-legacy-device:${device.id}:${checksum}`)
  statements.push(`INSERT OR IGNORE INTO timekeeping_devices (id,unit_id,label,token_hash,active,revoked_at,created_by,created_at,last_seen_at) VALUES (${sql(device.id)},${sql(device.unit)},${sql(device.label || device.id)},${sql(tokenHash)},0,${sql(device.revokedAt || now)},'legacy-import',${sql(device.createdAt || now)},${sql(device.lastSeenAt || null)});`)
  statements.push(`INSERT OR IGNORE INTO timekeeping_migration_items (migration_run_id,entity_type,source_id,target_id,checksum,created_at) SELECT ${sql(runId)},'device',${sql(device.id)},${sql(device.id)},${sql(sha(JSON.stringify({ id: device.id, unit: device.unit })))},${sql(now)} WHERE changes()=1;`)
}
for (const record of punches) {
  const unit = String(record.unit || employees.find((employee) => String(employee.id) === String(record.employeeId))?.unit || 'UNASSIGNED')
  const occurredAt = new Date(record.at).toISOString(); const createdAt = validDate(record.createdAt) ? new Date(record.createdAt).toISOString() : occurredAt
  const workDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(occurredAt))
  statements.push(`INSERT OR IGNORE INTO timekeeping_events (id,employee_id,unit_id,device_id,event_type,source,occurred_at_utc,work_date,idempotency_scope,idempotency_key,request_fingerprint,created_by,created_at) VALUES (${sql(record.id)},${sql(record.employeeId)},${sql(unit)},NULL,${sql(eventType(record.type))},${sql(sourceType(record.method))},${sql(occurredAt)},${sql(workDate)},${sql(`legacy:${record.employeeId}`)},${sql(record.idempotencyKey || record.id)},${sql(sha(JSON.stringify({ id: record.id, at: occurredAt, type: record.type })))},'legacy-import',${sql(createdAt)});`)
  statements.push(`INSERT OR IGNORE INTO timekeeping_migration_items (migration_run_id,entity_type,source_id,target_id,checksum,created_at) SELECT ${sql(runId)},'event',${sql(record.id)},${sql(record.id)},${sql(sha(JSON.stringify({ id: record.id, at: occurredAt, type: record.type })))},${sql(now)} WHERE changes()=1;`)
}
for (const correction of corrections) {
  const proposedAt = new Date(correction.newAt || correction.createdAt).toISOString(); const decidedAt = validDate(correction.createdAt) ? new Date(correction.createdAt).toISOString() : now
  statements.push(`INSERT OR IGNORE INTO timekeeping_corrections (id,event_id,requested_at,requested_by,reason,proposed_at_utc,status,decided_at,decided_by,decision_reason) VALUES (${sql(correction.id)},${sql(correction.targetRecordId)},${sql(decidedAt)},'legacy-import',${sql(correction.reason || 'Correção migrada do legado')},${sql(proposedAt)},'APPROVED',${sql(decidedAt)},'legacy-import','Migração preservou correção já efetivada');`)
  statements.push(`INSERT OR IGNORE INTO timekeeping_migration_items (migration_run_id,entity_type,source_id,target_id,checksum,created_at) SELECT ${sql(runId)},'correction',${sql(correction.id)},${sql(correction.id)},${sql(sha(JSON.stringify({ id: correction.id, target: correction.targetRecordId, proposedAt })))},${sql(now)} WHERE changes()=1;`)
}
const resultCounts = { employees: employees.length, devices: devices.filter((row) => row?.id && row?.unit).length, punches: punches.length, corrections: corrections.length }
statements.push(`UPDATE timekeeping_migration_runs SET status='APPLIED',result_counts_json=json_object('employees',(SELECT count(*) FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='employee'),'devices',(SELECT count(*) FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='device'),'punches',(SELECT count(*) FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='event'),'corrections',(SELECT count(*) FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='correction')),checkpoint_json=${sql(JSON.stringify({ backup: absoluteBackup }))},completed_at=${sql(new Date().toISOString())} WHERE id=${sql(runId)};`)

const rollback = ['PRAGMA foreign_keys=ON;', 'BEGIN;', `DELETE FROM timekeeping_corrections WHERE id IN (SELECT target_id FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='correction');`, `DELETE FROM timekeeping_events WHERE id IN (SELECT target_id FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='event');`, `DELETE FROM timekeeping_biometric_templates WHERE id IN (SELECT target_id FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='biometric_template');`, `DELETE FROM timekeeping_employee_units WHERE id IN (SELECT target_id FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='employee_unit');`, `DELETE FROM workforce_employee_aliases WHERE id IN (SELECT target_id FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='alias');`, `DELETE FROM timekeeping_devices WHERE id IN (SELECT target_id FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='device');`, `DELETE FROM workforce_identity_conflicts WHERE id IN (SELECT target_id FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='identity_conflict');`, `DELETE FROM workforce_employees WHERE id IN (SELECT target_id FROM timekeeping_migration_items WHERE migration_run_id=${sql(runId)} AND entity_type='employee');`, `UPDATE timekeeping_migration_runs SET status='ROLLED_BACK',completed_at=${sql(new Date().toISOString())} WHERE id=${sql(runId)};`, 'COMMIT;'].join('\n')
const rollbackPath = `${absoluteBackup}.rollback-${checksum.slice(0, 12)}.sql`; await writeFile(rollbackPath, rollback, { mode: 0o600 })
const temporary = await mkdtemp(resolve(tmpdir(), 'ponto-import-')); const sqlPath = resolve(temporary, 'import.sql')
try {
  await writeFile(sqlPath, statements.join('\n'), { mode: 0o600 })
  if (remote) {
    await remoteD1Import(statements.join('\n'))
  } else {
    const local = await findLocalDatabase()
    if (!local) fail('Local D1 SQLite database was not found')
    const databaseHandle = new DatabaseSync(local.path)
    try { databaseHandle.exec(`BEGIN IMMEDIATE;\n${statements.join('\n')}\nCOMMIT;`) } catch (error) { try { databaseHandle.exec('ROLLBACK;') } catch { /* already rolled back */ } throw error } finally { databaseHandle.close() }
  }
} finally { await rm(temporary, { recursive: true, force: true }) }
console.log(JSON.stringify({ ok: true, dryRun: false, runId, checksum, database, remote, backup: absoluteBackup, rollback: rollbackPath, resultCounts }, null, 2))
