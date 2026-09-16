#!/usr/bin/env node

/**
 * Custody executor for the Atendimento -> CRM Core production identity handoff.
 *
 * This is deliberately independent from GitHub Actions.  It accepts only the
 * UUID-only, owner-reviewed batch contract and a dedicated production database
 * principal.  `plan` and `preflight` are read-only; `apply` is an explicit,
 * opt-in operation that writes an immutable checkpoint before delegating to the
 * transactional writer.  No names, contact fields, source rows or secrets are
 * ever printed or persisted by this program.
 */
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
    assertAtendimentoCrmCoreIdentityReviewBatch,
    digestAtendimentoCrmCoreIdentityReviewBatch,
} from '../../shared/crm-auth/atendimentoCrmCoreIdentityReviewBatch.js'
import {
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT,
    ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS,
} from '../../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'
export const CUSTODY_CONTRACT = 'skincos/crm-production-custody-executor/v1'
export const PRODUCTION_TARGET = 'production'
export const PRODUCTION_DATABASE = 'skincos_clientes_production'
export const PRODUCTION_WRITER_ROLE = ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.databaseRole
export const ALLOWED_UNIT_SCOPES = Object.freeze(['barra-shopping-sul', 'novo-hamburgo'])
export const MAX_EXTERNAL_JSON_BYTES = 1024 * 1024
export const APPLY_CONFIRMATION = 'CRM_PRODUCTION_CUSTODY_APPLY'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const MODES = new Set(['plan', 'preflight', 'apply'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/
const SENSITIVE_KEY_PATTERN = /(?:name|email|phone|telefone|nome|cookie|token|secret|password|credential|payload|jws|pii)/i
let runtimeModulesPromise

async function loadRuntimeModules() {
    runtimeModulesPromise ||= Promise.all([
        import('../../crm/api/server/atendimento/crmCoreIdentityMaterializationMigration.js'),
        import('../../crm/api/server/atendimento/crmCoreIdentityMaterializationWriter.js'),
    ]).then(([migration, writer]) => ({
        inspectAtendimentoCrmCoreIdentityMaterializationPreflight: migration.inspectAtendimentoCrmCoreIdentityMaterializationPreflight,
        materializeAtendimentoCrmCoreIdentityLinks: writer.materializeAtendimentoCrmCoreIdentityLinks,
    }))
    return runtimeModulesPromise
}

function custodyError(code, cause = undefined) {
    const error = new Error(`CRM_PRODUCTION_CUSTODY_${code}`)
    error.code = `CRM_PRODUCTION_CUSTODY_${code}`
    if (cause) error.cause = cause
    return error
}

function text(value) {
    return typeof value === 'string' ? value.trim() : ''
}

function requiredText(value, code) {
    const normalized = text(value)
    if (!normalized) throw custodyError(code)
    return normalized
}

function positiveCount(value, code) {
    if (!Number.isSafeInteger(value) || value < 0) throw custodyError(code)
    return value
}

function isWithin(parent, child) {
    const relative = path.relative(path.resolve(parent), path.resolve(child))
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

/** Rejects custody inputs and receipts inside the source checkout. */
export function assertExternalPath(file, repositoryRoot = process.cwd()) {
    const resolved = path.resolve(requiredText(file, 'EXTERNAL_PATH_REQUIRED'))
    if (isWithin(repositoryRoot, resolved)) throw custodyError('EXTERNAL_PATH_MUST_BE_OUTSIDE_REPOSITORY')
    return resolved
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
    }
    return value
}

function sha256(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`
}

function assertNoSensitiveKeys(value) {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) throw custodyError('SENSITIVE_FIELD_REJECTED')
        assertNoSensitiveKeys(child)
    }
}

async function readExternalJson(file, repositoryRoot) {
    const resolved = assertExternalPath(file, repositoryRoot)
    let stat
    try { stat = await lstat(resolved) } catch (error) { throw custodyError('INPUT_READ_FAILED', error) }
    if (!stat.isFile() || stat.size > MAX_EXTERNAL_JSON_BYTES) throw custodyError('INPUT_FILE_INVALID')
    let raw
    try { raw = await readFile(resolved, 'utf8') } catch (error) { throw custodyError('INPUT_READ_FAILED', error) }
    try {
        const value = JSON.parse(raw)
        assertNoSensitiveKeys(value)
        return value
    } catch (error) {
        if (error?.code?.startsWith('CRM_PRODUCTION_CUSTODY_')) throw error
        throw custodyError('INPUT_JSON_INVALID', error)
    }
}

async function writeExternalJson(file, value, repositoryRoot) {
    const resolved = assertExternalPath(file, repositoryRoot)
    await mkdir(path.dirname(resolved), { recursive: true })
    try {
        await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
        throw custodyError('RECEIPT_WRITE_FAILED', error)
    }
    return resolved
}

function assertUnitScope(value) {
    const normalized = requiredText(value, 'UNIT_REQUIRED').toLowerCase()
    if (!ALLOWED_UNIT_SCOPES.includes(normalized)) throw custodyError('UNIT_INVALID')
    return normalized
}

function validateBatch(value) {
    let batch
    try { batch = assertAtendimentoCrmCoreIdentityReviewBatch(value) } catch (error) { throw custodyError('REVIEW_BATCH_INVALID', error) }
    // The shared contract already rejects unknown fields.  This second walk is
    // intentionally retained at the custody boundary so future contract
    // expansion cannot accidentally admit contact data here.
    try { assertNoSensitiveKeys(value) } catch (error) { throw custodyError('REVIEW_BATCH_PRIVACY_INVALID', error) }
    return batch
}

export function summarizeReviewedBatch(value, unit) {
    const batch = validateBatch(value)
    const revisions = batch.links.map((link) => link.sourceRevision)
    const summary = {
        contract: CUSTODY_CONTRACT,
        target: PRODUCTION_TARGET,
        unit: assertUnitScope(unit),
        batchContract: batch.contract,
        batchId: batch.batchId,
        runId: batch.runId,
        batchDigest: digestAtendimentoCrmCoreIdentityReviewBatch(batch),
        linkCount: batch.links.length,
        canonicalClientCount: new Set(batch.links.map((link) => link.canonicalClientId)).size,
        sourceRevision: { min: Math.min(...revisions), max: Math.max(...revisions) },
        review: { owner: batch.review.owner, decision: batch.review.decision },
        privacy: { piiIncluded: false, rawIdentifiersIncluded: false, secretsIncluded: false },
    }
    return Object.freeze(summary)
}

function strictProductionWriterUrl(databaseUrl) {
    const raw = text(databaseUrl)
    try {
        const url = new URL(raw)
        const query = new URLSearchParams(url.search)
        const allowedQueryKeys = new Set(['sslmode', 'uselibpqcompat', 'application_name'])
        for (const key of query.keys()) if (!allowedQueryKeys.has(key)) return false
        return url.protocol === 'postgresql:'
            && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
            && (url.port || '5432') === '5432'
            && decodeURIComponent(url.username || '') === PRODUCTION_WRITER_ROLE
            && Boolean(url.password)
            && url.pathname === `/${PRODUCTION_DATABASE}`
            && query.get('sslmode') === 'require'
            && query.get('uselibpqcompat') === 'true'
    } catch {
        return false
    }
}

function safeDigest(value) {
    const normalized = text(value).toLowerCase()
    return SHA256_PATTERN.test(normalized) ? normalized : null
}

async function reserveExternalOutput(file, repositoryRoot) {
    const resolved = assertExternalPath(file, repositoryRoot)
    try {
        const stat = await lstat(resolved)
        if (stat) throw custodyError('RECEIPT_FILE_ALREADY_EXISTS')
    } catch (error) {
        if (error?.code === 'CRM_PRODUCTION_CUSTODY_RECEIPT_FILE_ALREADY_EXISTS') throw error
        if (error?.code !== 'ENOENT') throw custodyError('RECEIPT_PATH_UNAVAILABLE', error)
    }
    await mkdir(path.dirname(resolved), { recursive: true })
    return resolved
}

function summarizeRuntimePreflight(report) {
    const preflight = report?.preflight || {}
    const relations = preflight.relations && typeof preflight.relations === 'object'
        ? Object.fromEntries(Object.entries(preflight.relations).map(([key, value]) => [key, value === true]))
        : {}
    return {
        destination: report?.destination?.database === PRODUCTION_DATABASE
            && report?.destination?.target === PRODUCTION_TARGET
            ? { database: PRODUCTION_DATABASE, target: PRODUCTION_TARGET }
            : { database: null, target: null },
        prerequisitesReady: preflight.prerequisitesReady === true,
        schemaContractReady: preflight.schemaContractReady === true,
        currentMigrationActive: preflight.currentMigrationActive === true,
        legacyMigrationActive: preflight.legacyMigrationActive === true,
        relations,
    }
}

async function readWriterPreflight({ pool, databaseUrl, inspectPreflight = undefined }) {
    if (!pool || typeof pool.connect !== 'function') throw custodyError('POOL_REQUIRED')
    if (!strictProductionWriterUrl(databaseUrl)) throw custodyError('WRITER_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin read only')
        transactionOpen = true
        const destinationResult = await client.query(`select current_database() as database_name, current_user as database_user,
            session_user as session_user, current_setting('transaction_read_only') as read_only`)
        const row = destinationResult.rows?.[0] || {}
        if (row.database_name !== PRODUCTION_DATABASE
            || row.database_user !== PRODUCTION_WRITER_ROLE
            || row.session_user !== PRODUCTION_WRITER_ROLE
            || String(row.read_only || '').toLowerCase() !== 'on') {
            throw custodyError('WRITER_IDENTITY_UNSAFE')
        }
        const inspector = inspectPreflight
            || (await loadRuntimeModules()).inspectAtendimentoCrmCoreIdentityMaterializationPreflight
        const preflight = await inspector(client)
        await client.query('commit')
        transactionOpen = false
        return Object.freeze({
            destination: { database: PRODUCTION_DATABASE, user: PRODUCTION_WRITER_ROLE, target: PRODUCTION_TARGET },
            preflight,
        })
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the custody error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

async function readProductionRowCounts(pool) {
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin read only')
        transactionOpen = true
        const counts = {}
        for (const relation of ATENDIMENTO_CRM_CORE_IDENTITY_RELATIONS) {
            const result = await client.query(`select count(*)::bigint as row_count from ${relation}`)
            const value = Number(result.rows?.[0]?.row_count)
            if (!Number.isSafeInteger(value) || value < 0) throw custodyError('ROW_COUNT_INVALID')
            counts[relation] = value
        }
        await client.query('commit')
        transactionOpen = false
        return Object.freeze(counts)
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the custody error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

function checkpointDigest(checkpoint) {
    return sha256({
        contract: checkpoint.contract,
        target: checkpoint.target,
        unit: checkpoint.unit,
        batchDigest: checkpoint.batchDigest,
        counts: checkpoint.counts,
        preflight: checkpoint.preflight,
    })
}

export async function executeCrmProductionCustody({
    mode,
    target = PRODUCTION_TARGET,
    unit,
    batch = undefined,
    batchFile = undefined,
    databaseUrl = undefined,
    pool = undefined,
    repositoryRoot = process.cwd(),
    checkpointFile = undefined,
    receiptFile = undefined,
    applyConfirmation = false,
    now = () => new Date().toISOString(),
    runtime = undefined,
} = {}) {
    if (!MODES.has(mode)) throw custodyError('MODE_INVALID')
    if (target !== PRODUCTION_TARGET) throw custodyError('TARGET_INVALID')
    if (mode === 'apply' && (!checkpointFile || !receiptFile)) throw custodyError('CHECKPOINT_AND_RECEIPT_REQUIRED')
    const root = path.resolve(repositoryRoot)

    if (mode === 'plan') {
        const source = batch ?? await readExternalJson(batchFile, root)
        const summary = summarizeReviewedBatch(source, unit)
        return Object.freeze({
            ...summary,
            operation: 'plan',
            state: 'plan-ready',
            mutationAllowed: false,
            checkpointCreated: false,
            receiptCreated: false,
        })
    }

    const resolvedDatabaseUrl = text(databaseUrl || process.env.DATABASE_URL)
    if (!strictProductionWriterUrl(resolvedDatabaseUrl)) throw custodyError('WRITER_DESTINATION_UNSAFE')
    let ownedPool = pool
    if (!ownedPool) {
        try {
            const { createPgPool } = await import('../../crm/api/server/harmonia/store/pg.js')
            ownedPool = createPgPool(resolvedDatabaseUrl, { max: 1 })
        } catch (error) {
            throw custodyError('PG_RUNTIME_UNAVAILABLE', error)
        }
    }

    try {
        if (mode === 'apply' && applyConfirmation !== true) throw custodyError('APPLY_CONFIRMATION_REQUIRED')
        const runtimePreflight = await readWriterPreflight({
            pool: ownedPool,
            databaseUrl: resolvedDatabaseUrl,
            inspectPreflight: runtime?.inspectAtendimentoCrmCoreIdentityMaterializationPreflight,
        })
        const runtimeSummary = summarizeRuntimePreflight(runtimePreflight)
        const reportBase = {
            contract: CUSTODY_CONTRACT,
            target: PRODUCTION_TARGET,
            operation: mode,
            verifiedAt: now(),
            mutationAllowed: false,
            preflight: runtimeSummary,
            privacy: { piiIncluded: false, rawIdentifiersIncluded: false, secretsIncluded: false },
        }

        if (mode === 'preflight') {
            return Object.freeze({ ...reportBase, state: 'preflight-read-only', checkpointCreated: false, receiptCreated: false })
        }

        const source = batch ?? await readExternalJson(batchFile, root)
        const summary = summarizeReviewedBatch(source, unit)
        if (!runtimeSummary.prerequisitesReady || !runtimeSummary.schemaContractReady || !runtimeSummary.currentMigrationActive) {
            throw custodyError('RUNTIME_PREFLIGHT_BLOCKED')
        }
        const counts = await readProductionRowCounts(ownedPool)
        const checkpoint = Object.freeze({
            ...reportBase,
            ...summary,
            operation: 'checkpoint',
            state: 'before-apply',
            counts,
            preflight: runtimeSummary,
            checkpointDigest: checkpointDigest({
                contract: CUSTODY_CONTRACT,
                target: PRODUCTION_TARGET,
                unit: summary.unit,
                batchDigest: summary.batchDigest,
                counts,
                preflight: runtimeSummary,
            }),
        })
        const savedCheckpoint = checkpointFile
            ? await writeExternalJson(await reserveExternalOutput(checkpointFile, root), checkpoint, root)
            : null
        if (!savedCheckpoint) throw custodyError('CHECKPOINT_FILE_REQUIRED')
        const reservedReceipt = await reserveExternalOutput(receiptFile, root)

        let result
        try {
            const materializer = runtime?.materializeAtendimentoCrmCoreIdentityLinks
                || (await loadRuntimeModules()).materializeAtendimentoCrmCoreIdentityLinks
            result = await materializer({
                pool: ownedPool,
                databaseUrl: resolvedDatabaseUrl,
                target: PRODUCTION_TARGET,
                runId: source.runId,
                links: source.links,
            })
        } catch (error) {
            if (reservedReceipt) {
                const failure = {
                    ...reportBase,
                    ...summary,
                    operation: 'apply',
                    state: 'failed-transaction-rolled-back',
                    checkpointDigest: checkpoint.checkpointDigest,
                    checkpointCreated: true,
                    writerError: /^[A-Za-z0-9_.:-]{1,160}$/.test(text(error?.code)) ? text(error.code) : 'unknown',
                    mutationAllowed: false,
                }
                await writeExternalJson(reservedReceipt, failure, root)
            }
            throw error
        }
        const inputDigest = safeDigest(result?.inputDigest)
        const outputDigest = safeDigest(result?.outputDigest)
        if (!inputDigest || !outputDigest) throw custodyError('WRITER_RECEIPT_INVALID')
        const receipt = Object.freeze({
            ...reportBase,
            ...summary,
            operation: 'apply',
            state: result.idempotent ? 'idempotent' : 'applied',
            mutationAllowed: true,
            checkpointCreated: true,
            checkpointDigest: checkpoint.checkpointDigest,
            writer: {
                inputDigest,
                outputDigest,
                confirmedLinkCount: positiveCount(result.confirmedLinkCount, 'WRITER_LINK_COUNT_INVALID'),
                identityCount: positiveCount(result.identityCount, 'WRITER_IDENTITY_COUNT_INVALID'),
                idempotent: result.idempotent === true,
            },
        })
        await writeExternalJson(reservedReceipt, receipt, root)
        return receipt
    } finally {
        if (!pool && ownedPool?.end) await ownedPool.end()
    }
}

export function parseCrmProductionCustodyArgs(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    const parsed = { mode: null, target: PRODUCTION_TARGET, unit: null, batchFile: null, checkpointFile: null, receiptFile: null }
    const seen = new Set()
    for (let index = 0; index < values.length; index += 1) {
        const key = values[index]
        if (!['--mode', '--target', '--unit', '--batch-file', '--checkpoint-file', '--receipt-file'].includes(key)) {
            throw custodyError('ARGUMENT_INVALID')
        }
        if (seen.has(key)) throw custodyError('ARGUMENT_DUPLICATE')
        seen.add(key)
        const value = values[index + 1]
        if (!value || value.startsWith('--')) throw custodyError('ARGUMENT_VALUE_REQUIRED')
        index += 1
        if (key === '--mode') parsed.mode = value
        if (key === '--target') parsed.target = value
        if (key === '--unit') parsed.unit = value
        if (key === '--batch-file') parsed.batchFile = value
        if (key === '--checkpoint-file') parsed.checkpointFile = value
        if (key === '--receipt-file') parsed.receiptFile = value
    }
    if (!MODES.has(parsed.mode)) throw custodyError('MODE_REQUIRED')
    if (parsed.target !== PRODUCTION_TARGET) throw custodyError('TARGET_INVALID')
    if (parsed.mode !== 'preflight' && (!parsed.unit || !parsed.batchFile)) throw custodyError('BATCH_AND_UNIT_REQUIRED')
    if (parsed.mode !== 'preflight') assertUnitScope(parsed.unit)
    if (parsed.mode === 'apply' && (!parsed.checkpointFile || !parsed.receiptFile)) throw custodyError('CHECKPOINT_AND_RECEIPT_REQUIRED')
    return Object.freeze(parsed)
}

async function main() {
    const args = parseCrmProductionCustodyArgs(process.argv.slice(2))
    const repositoryRoot = path.resolve(process.env.CRM_REPOSITORY_ROOT || process.cwd())
    const report = await executeCrmProductionCustody({
        ...args,
        repositoryRoot,
        applyConfirmation: process.env.CRM_PRODUCTION_CUSTODY_CONFIRM === APPLY_CONFIRMATION,
    })
    process.stdout.write(`${JSON.stringify(report)}\n`)
}

const invokedAsScript = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (invokedAsScript) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : 'CRM_PRODUCTION_CUSTODY_FAILED'}\n`)
        process.exitCode = 1
    })
}
