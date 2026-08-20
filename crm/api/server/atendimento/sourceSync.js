import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

import { readAtendimentoSheet } from './importer.js'
import { createAtendimentoStore } from './store.js'
import { sourceRefreshActor } from './sourceRefresh.js'

export const ATENDIMENTO_SOURCE_SYNC_TARGETS = Object.freeze({
    PRODUCTION: 'production',
    STAGING: 'staging',
})

export const ATENDIMENTO_SOURCE_SYNC_DATABASES = Object.freeze({
    production: Object.freeze({
        database: 'skincos_clientes_production',
        user: 'skincos_clientes_migrator_login',
        backupRoot: '/var/backups/skincos/clientes/production-source-sync',
    }),
    staging: Object.freeze({
        database: 'skincos_staging',
        user: 'skincos_staging_migrator_login',
        backupRoot: '/var/backups/skincos/clientes/staging-source-sync',
    }),
})

export const ATENDIMENTO_SOURCE_SYNC_LOCK_KEY = 'skincos:atendimento:source-sync:v1'
export const ATENDIMENTO_SOURCE_SYNC_REQUIRED_RELATIONS = Object.freeze([
    'crm_atendimento.units',
    'crm_atendimento.professionals',
    'crm_atendimento.procedures',
    'crm_atendimento.procedure_price_codes',
    'crm_atendimento.clients',
    'crm_atendimento.attendances',
    'crm_atendimento.schedule_days',
    'crm_atendimento.audit_events',
    'crm_atendimento.import_batches',
])

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const PRIVATE_SOURCE_ROOT = '/etc/skincos/'

function syncError(code, statusCode = 409) {
    const error = new Error(code)
    error.code = code
    error.statusCode = statusCode
    return error
}

function isTruthy(value) {
    return TRUE_VALUES.has(String(value || '').trim().toLowerCase())
}

function normalizedTarget(value) {
    const target = String(value || '').trim().toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(ATENDIMENTO_SOURCE_SYNC_DATABASES, target)) {
        throw syncError('ATENDIMENTO_SOURCE_SYNC_TARGET_INVALID', 400)
    }
    return target
}

export function normalizeAtendimentoSourceSyncTarget(value) {
    return normalizedTarget(value)
}

export function normalizeAtendimentoSourceSyncAction(value) {
    const action = String(value || 'dry-run').trim().toLowerCase()
    if (!['dry-run', 'apply'].includes(action)) throw syncError('ATENDIMENTO_SOURCE_SYNC_ACTION_INVALID', 400)
    return action
}

export function assertAtendimentoSourceSyncDatabaseUrl(databaseUrl, targetValue) {
    const target = normalizedTarget(targetValue)
    const expected = ATENDIMENTO_SOURCE_SYNC_DATABASES[target]
    const raw = String(databaseUrl || '').trim()
    let parsed
    try {
        parsed = new URL(raw.replace(/^postgresql:/i, 'postgres:'))
    } catch {
        throw syncError('ATENDIMENTO_SOURCE_SYNC_DATABASE_URL_INVALID', 400)
    }
    const query = new URLSearchParams(parsed.search)
    const allowedQueryKeys = new Set(['sslmode', 'uselibpqcompat', 'application_name'])
    for (const key of query.keys()) {
        if (!allowedQueryKeys.has(key)) throw syncError('ATENDIMENTO_SOURCE_SYNC_DATABASE_URL_UNSAFE', 400)
    }
    const valid = parsed.protocol === 'postgres:' &&
        ['127.0.0.1', 'localhost', '::1'].includes(String(parsed.hostname || '').toLowerCase()) &&
        (parsed.port || '5432') === '5432' &&
        decodeURIComponent(parsed.username || '') === expected.user &&
        Boolean(parsed.password) &&
        decodeURIComponent(parsed.pathname || '').replace(/^\//, '') === expected.database &&
        query.get('sslmode') === 'require' &&
        (!query.has('uselibpqcompat') || query.get('uselibpqcompat') === 'true')
    if (!valid) throw syncError('ATENDIMENTO_SOURCE_SYNC_DATABASE_URL_UNSAFE', 400)
    return { target, database: expected.database, user: expected.user }
}

export function assertAtendimentoSourceSyncDatabaseIdentity(identity = {}, targetValue) {
    const target = normalizedTarget(targetValue)
    const expected = ATENDIMENTO_SOURCE_SYNC_DATABASES[target]
    const database = String(identity.database_name || identity.databaseName || '').trim()
    const user = String(identity.current_user || identity.currentUser || '').trim()
    const sessionUser = String(identity.session_user || identity.sessionUser || user).trim()
    const readOnly = String(identity.transaction_read_only || identity.readOnly || '').trim().toLowerCase()
    if (database !== expected.database || user !== expected.user || sessionUser !== expected.user) {
        throw syncError('ATENDIMENTO_SOURCE_SYNC_DATABASE_IDENTITY_UNSAFE', 403)
    }
    if (readOnly === 'on') throw syncError('ATENDIMENTO_SOURCE_SYNC_DATABASE_READ_ONLY', 403)
    return { target, database, user, sessionUser }
}

export function assertPrivateSourceCredentialPath(value) {
    const filePath = String(value || '').trim()
    if (!filePath || !filePath.startsWith(PRIVATE_SOURCE_ROOT) || filePath.includes('..') || !filePath.endsWith('.json')) {
        throw syncError('ATENDIMENTO_SOURCE_SYNC_SOURCE_CREDENTIAL_UNSAFE', 400)
    }
    return filePath
}

function canonicalize(value) {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    }
    return value
}

export function atendimentoSourceFingerprint(snapshot = {}) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize({
        spreadsheetId: snapshot.spreadsheetId || '',
        records: snapshot.records || [],
        cache: snapshot.cache || {},
        tabs: snapshot.tabs || [],
    }))).digest('hex')}`
}

export async function assertAtendimentoSourceSyncSchema(client) {
    const result = await client.query(
        `select relation, to_regclass(relation) as resolved
         from unnest($1::text[]) as required(relation)`,
        [ATENDIMENTO_SOURCE_SYNC_REQUIRED_RELATIONS],
    )
    const missing = result.rows
        .filter((row) => !row?.resolved)
        .map((row) => String(row?.relation || ''))
        .filter(Boolean)
    if (missing.length) throw syncError('ATENDIMENTO_SOURCE_SYNC_SCHEMA_NOT_READY', 503)
    return { ok: true, relations: ATENDIMENTO_SOURCE_SYNC_REQUIRED_RELATIONS }
}

async function readExistingCheckpoint(pool, fingerprint) {
    const latest = await pool.query(`select summary
        from crm_atendimento.import_batches
        where source_name = 'Atendimento'
        order by created_at desc
        limit 1`)
    const summary = latest.rows[0]?.summary || {}
    if (summary.sourceFingerprint !== fingerprint) return false
    const count = await pool.query(`select count(*)::int as total
        from crm_atendimento.attendances
        where deleted_at is null`)
    return Number(count.rows[0]?.total || 0) > 0
}

function safeReferencePart(value) {
    return String(value || '').replace(/[^A-Za-z0-9._:-]/g, '-')
}

async function runProcess(command, args, envOverrides = {}) {
    const childEnvironment = { ...process.env, ...envOverrides }
    for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR', 'PGPASSFILE']) delete childEnvironment[key]
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            env: childEnvironment,
            stdio: ['ignore', 'ignore', 'pipe'],
        })
        let stderr = ''
        child.stderr.on('data', (chunk) => { stderr += String(chunk) })
        child.on('error', () => reject(syncError('ATENDIMENTO_SOURCE_SYNC_BACKUP_TOOL_UNAVAILABLE', 503)))
        child.on('close', (code) => {
            if (code === 0) return resolve()
            const error = syncError('ATENDIMENTO_SOURCE_SYNC_BACKUP_FAILED', 503)
            error.detail = stderr.slice(0, 120)
            reject(error)
        })
    })
}

export function buildAtendimentoSourceSyncPgDumpEnvironment({
    baseEnv = process.env,
    host = '127.0.0.1',
    port = '5432',
    database,
    user,
    password,
} = {}) {
    const childEnvironment = {
        ...baseEnv,
        PGHOST: String(host || '127.0.0.1'),
        PGHOSTADDR: String(host || '127.0.0.1'),
        PGPORT: String(port || '5432'),
        PGDATABASE: database,
        PGUSER: user,
        PGPASSWORD: password,
        PGSSLMODE: 'require',
        PGAPPNAME: 'crm-atendimento-source-sync',
        PGCONNECT_TIMEOUT: '10',
        PGOPTIONS: '',
    }
    for (const key of ['PGSERVICE', 'PGSERVICEFILE', 'PGSYSCONFDIR', 'PGPASSFILE']) delete childEnvironment[key]
    return childEnvironment
}

async function sha256File(filePath) {
    const digest = createHash('sha256')
    digest.update(await fs.readFile(filePath))
    return digest.digest('hex')
}

export async function createAtendimentoSourceSyncBackup({
    databaseUrl,
    target: targetValue,
    backupRoot,
    now = () => new Date(),
    idFactory = randomUUID,
    processRunner = runProcess,
} = {}) {
    const target = normalizedTarget(targetValue)
    const expectedRoot = ATENDIMENTO_SOURCE_SYNC_DATABASES[target].backupRoot
    const identity = assertAtendimentoSourceSyncDatabaseUrl(databaseUrl, target)
    const parsed = new URL(String(databaseUrl).replace(/^postgresql:/i, 'postgres:'))
    if (String(backupRoot || expectedRoot) !== expectedRoot) throw syncError('ATENDIMENTO_SOURCE_SYNC_BACKUP_ROOT_UNSAFE', 400)
    const stamp = now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const reference = safeReferencePart(`atendimento-source-${target}-${stamp}-${idFactory()}`)
    const partialPath = path.join(expectedRoot, `${reference}.dump.partial`)
    const outputPath = path.join(expectedRoot, `${reference}.dump`)
    try {
        await fs.mkdir(expectedRoot, { recursive: true, mode: 0o750 })
        await processRunner('/usr/bin/pg_dump', [
            '--format=custom',
            '--no-owner',
            '--no-privileges',
            '--schema=crm_atendimento',
            `--file=${partialPath}`,
            `--dbname=${identity.database}`,
        ], buildAtendimentoSourceSyncPgDumpEnvironment({
            host: parsed.hostname,
            port: parsed.port,
            database: identity.database,
            user: identity.user,
            password: decodeURIComponent(parsed.password || ''),
        }))
        const stat = await fs.stat(partialPath)
        if (!stat.isFile() || stat.size <= 0) throw syncError('ATENDIMENTO_SOURCE_SYNC_BACKUP_EMPTY', 503)
        await fs.rename(partialPath, outputPath)
        return {
            reference,
            manifestHash: `sha256:${await sha256File(outputPath)}`,
            private: true,
            restorable: true,
        }
    } catch (error) {
        await Promise.allSettled([fs.rm(partialPath, { force: true }), fs.rm(outputPath, { force: true })])
        throw error
    }
}

function sourceSummary({ target, action, identity, snapshot, result, skipped = false, backup = null }) {
    return {
        ok: true,
        target,
        action,
        database: identity.database,
        databaseUser: identity.user,
        skipped,
        dryRun: action === 'dry-run',
        records: Number(result?.records ?? snapshot.records.length ?? 0),
        inserted: Number(result?.inserted || 0),
        updated: Number(result?.updated || 0),
        skippedRecords: Number(result?.skipped || 0),
        importBatchId: result?.importBatchId || null,
        tabs: Array.isArray(snapshot.tabs) ? snapshot.tabs : [],
        spreadsheetId: snapshot.spreadsheetId || null,
        sourceFingerprint: atendimentoSourceFingerprint(snapshot),
        backupReference: backup?.reference || null,
        backupManifestHash: backup?.manifestHash || null,
    }
}

export async function runAtendimentoSourceSync({
    pool,
    databaseUrl,
    target: targetValue,
    action: actionValue = 'dry-run',
    applyConfirmed = false,
    spreadsheetId = '',
    serviceAccountFile = '',
    sourceReader = readAtendimentoSheet,
    storeFactory = createAtendimentoStore,
    backupFactory = createAtendimentoSourceSyncBackup,
    checkpointReader = readExistingCheckpoint,
    schemaReader = assertAtendimentoSourceSyncSchema,
} = {}) {
    const target = normalizedTarget(targetValue)
    const action = normalizeAtendimentoSourceSyncAction(actionValue)
    const identityFromUrl = assertAtendimentoSourceSyncDatabaseUrl(databaseUrl, target)
    if (action === 'apply' && !isTruthy(applyConfirmed)) throw syncError('ATENDIMENTO_SOURCE_SYNC_APPLY_DISABLED', 403)
    if (!pool || typeof pool.connect !== 'function') throw syncError('ATENDIMENTO_SOURCE_SYNC_DATABASE_UNAVAILABLE', 503)

    const lockClient = await pool.connect()
    let locked = false
    try {
        const identityResult = await lockClient.query(`select current_database() as database_name,
            current_user, session_user, current_setting('transaction_read_only') as transaction_read_only`)
        const identity = assertAtendimentoSourceSyncDatabaseIdentity({
            ...identityResult.rows[0],
            database_name: identityResult.rows[0]?.database_name || identityFromUrl.database,
        }, target)
        const lock = await lockClient.query('select pg_try_advisory_lock(hashtext($1)) as acquired', [ATENDIMENTO_SOURCE_SYNC_LOCK_KEY])
        if (lock.rows[0]?.acquired !== true) throw syncError('ATENDIMENTO_SOURCE_SYNC_IN_PROGRESS', 409)
        locked = true
        await schemaReader(lockClient)

        if (!serviceAccountFile) throw syncError('ATENDIMENTO_SOURCE_SYNC_SOURCE_CREDENTIAL_MISSING', 424)
        const credentialPath = assertPrivateSourceCredentialPath(serviceAccountFile)
        const snapshot = await sourceReader({ spreadsheetId: String(spreadsheetId || '').trim() || undefined, serviceAccountFile: credentialPath || undefined })
        const records = Array.isArray(snapshot?.records) ? snapshot.records : []
        if (!records.length) throw syncError('ATENDIMENTO_SOURCE_SYNC_SOURCE_EMPTY', 424)
        const sourceSheetId = String(snapshot?.spreadsheetId || spreadsheetId || '').trim()
        if (!sourceSheetId) throw syncError('ATENDIMENTO_SOURCE_SYNC_SOURCE_ID_MISSING', 424)
        const sourceFingerprint = atendimentoSourceFingerprint(snapshot)
        const store = storeFactory({ pool, databaseUrl, schemaManaged: true, expectedDatabase: identity.database })
        const actor = sourceRefreshActor(target)
        const source = {
            sourceSheetId,
            sourceName: 'Atendimento',
            tabs: snapshot.tabs,
            snapshotComplete: true,
            sourceFingerprint,
        }
        const validation = await store.importRecords({ records, cache: snapshot.cache, actor, dryRun: true, source })
        if (await checkpointReader(pool, sourceFingerprint)) {
            return sourceSummary({ target, action, identity, snapshot, result: validation, skipped: true })
        }
        if (action === 'dry-run') return sourceSummary({ target, action, identity, snapshot, result: validation })

        const backup = await backupFactory({ databaseUrl, target })
        const applied = await store.importRecords({ records, cache: snapshot.cache, actor, dryRun: false, source })
        return sourceSummary({ target, action, identity, snapshot, result: applied, backup })
    } finally {
        if (locked) {
            try { await lockClient.query('select pg_advisory_unlock(hashtext($1))', [ATENDIMENTO_SOURCE_SYNC_LOCK_KEY]) } catch { /* connection cleanup releases it */ }
        }
        lockClient.release()
    }
}

export const __testables = {
    canonicalize,
    isTruthy,
    normalizedTarget,
    safeReferencePart,
    syncError,
}
