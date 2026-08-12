#!/usr/bin/env node
/**
 * Governed, staging-only PostgreSQL runner for Influencer Intelligence.
 *
 * The runner is deliberately separate from the domain runtime. It accepts no
 * database URL from argv, reads the staging secret only from the fixed native
 * environment file when executed directly, and never exposes the URL in a
 * report. A migration attempt is one transaction under one advisory lock. The
 * migration files contain BEGIN/COMMIT for psql review; those top-level guards
 * are removed before execution so the runner owns the transaction boundary.
 */
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '../..')
const MIGRATIONS_ROOT = path.join(ROOT, 'social/influencer-intelligence/migrations')
// Reuse the canonical staging database migrator custody already provisioned
// for the CRM. Do not duplicate the password into an analytics-specific file;
// the destination and role assertions below still bind this operation to the
// exact staging database contract.
const FIXED_ENV_FILE = '/etc/skincos/crm-atendimento-staging-migrator.env'

export const INFLUENCER_INTELLIGENCE_MIGRATION_RUNNER_VERSION = 'influencer-intelligence/staging-migrations/v1'
export const INFLUENCER_INTELLIGENCE_STAGING_TARGET = Object.freeze({
    environment: 'staging',
    database: 'skincos_staging',
    sessionUser: 'skincos_staging_migrator_login',
    ownerRole: 'skincos_staging_crm_owner',
    runtimeRoles: Object.freeze(['skincos_staging_crm_app', 'skincos_staging_crm_runtime']),
    schema: 'influencer_intelligence',
})
export const INFLUENCER_INTELLIGENCE_MIGRATION_LOCK_KEY = 'skincos:influencer-intelligence:staging-migrations/v1'
export const INFLUENCER_INTELLIGENCE_MIGRATION_TIMEOUTS = Object.freeze({
    lock: '3s',
    statement: '60s',
    idleInTransaction: '90s',
})

const MIGRATION_PLAN = Object.freeze([
    ['20260810_influencer_intelligence_registry_v1', '20260810_influencer_intelligence_registry_v1.up.sql'],
    ['20260811_influencer_intelligence_data_model_v1', '20260811_influencer_intelligence_data_model_v1.up.sql'],
    ['20260811_influencer_intelligence_snapshots_v1', '20260811_influencer_intelligence_snapshots_v1.up.sql'],
    ['20260811_influencer_intelligence_scheduler_v1', '20260811_influencer_intelligence_scheduler_v1.up.sql'],
    ['20260811_influencer_intelligence_scoring_v0', '20260811_influencer_intelligence_scoring_v0.up.sql'],
    ['20260812_influencer_intelligence_snapshot_fencing_v1', '20260812_influencer_intelligence_snapshot_fencing_v1.up.sql'],
    ['20260812_influencer_intelligence_comments_v1', '20260812_influencer_intelligence_comments_v1.up.sql'],
    ['20260812_influencer_intelligence_campaign_fit_v1', '20260812_influencer_intelligence_campaign_fit_v1.up.sql'],
])

export const INFLUENCER_INTELLIGENCE_MIGRATION_IDS = Object.freeze(MIGRATION_PLAN.map(([id]) => id))

const EXPECTED_RELATIONS = Object.freeze([
    'schema_migrations',
    'creator_registry',
    'creator_provider_registry',
    'creator_identity',
    'collector_run',
    'collector_evidence',
    'creator_media',
    'creator_profile_snapshot',
    'creator_media_snapshot',
    'creator_comment_sample',
    'creator_analysis',
    'creator_score',
    'creator_score_component',
    'campaign',
    'campaign_creator_fit',
])

const APP_PRIVILEGE_RELATIONS = Object.freeze([
    'creator_registry',
    'creator_provider_registry',
    'creator_identity',
    'collector_run',
    'collector_evidence',
    'creator_media',
    'creator_profile_snapshot',
    'creator_media_snapshot',
    'creator_comment_sample',
    'creator_analysis',
    'creator_score',
    'creator_score_component',
    'campaign',
    'campaign_creator_fit',
])

const APPEND_ONLY_RELATIONS = Object.freeze([
    'collector_evidence',
    'creator_profile_snapshot',
    'creator_media_snapshot',
    'creator_comment_sample',
    'creator_analysis',
    'creator_score',
    'creator_score_component',
    'campaign_creator_fit',
])

const REQUIRED_COLUMNS = Object.freeze([
    ['creator_registry', 'monitoring_enabled'],
    ['creator_registry', 'monitoring_interval_hours'],
    ['collector_run', 'coverage_available'],
    ['collector_run', 'failure_count'],
    ['collector_run', 'freshness_status'],
    ['collector_run', 'attempt_token'],
    ['creator_profile_snapshot', 'freshness_status'],
    ['creator_media_snapshot', 'freshness_status'],
    ['creator_score', 'weights_version'],
    ['campaign_creator_fit', 'weights_version'],
    ['campaign_creator_fit', 'components'],
])

function migrationError(code, details = {}) {
    const error = new Error(code)
    error.code = code
    error.details = details
    return error
}

function safeIdentifier(value) {
    const text = String(value || '')
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(text)) throw migrationError('II_MIGRATION_IDENTIFIER_INVALID')
    return `"${text.replaceAll('"', '""')}"`
}

function relationIdentifier(relation) {
    if (!EXPECTED_RELATIONS.includes(relation)) throw migrationError('II_MIGRATION_RELATION_NOT_ALLOWLISTED')
    return `${safeIdentifier(INFLUENCER_INTELLIGENCE_STAGING_TARGET.schema)}.${safeIdentifier(relation)}`
}

function migrationSqlWithoutTransactionControl(sql) {
    return String(sql || '')
        .replace(/^\s*BEGIN\s*;\s*$/gim, '')
        .replace(/^\s*COMMIT\s*;\s*$/gim, '')
}

function assertAdditiveMigrationSql(sql, id) {
    const withoutComments = String(sql || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*--.*$/gm, '')
        .replace(/'(?:''|[^'])*'/g, "''")
    if (/\bDROP\b/i.test(withoutComments) || /\bTRUNCATE\b/i.test(withoutComments) || /\bDELETE\s+FROM\b/i.test(withoutComments) || /\bUPDATE\s+[a-z_][a-z0-9_.]*\s+SET\b/i.test(withoutComments)) {
        throw migrationError('II_MIGRATION_NON_ADDITIVE_SQL', { id })
    }
    if (/\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(withoutComments.replace(/^\s*(BEGIN|COMMIT)\s*;\s*$/gim, ''))) {
        throw migrationError('II_MIGRATION_TRANSACTION_CONTROL_INVALID', { id })
    }
}

function sha256(text) {
    return createHash('sha256').update(String(text)).digest('hex')
}

async function loadMigrations({ readFile = (filePath) => fs.readFile(filePath, 'utf8'), migrationsRoot = MIGRATIONS_ROOT } = {}) {
    const migrations = []
    for (const [id, fileName] of MIGRATION_PLAN) {
        const sql = String(await readFile(path.join(migrationsRoot, fileName)))
        assertAdditiveMigrationSql(sql, id)
        migrations.push(Object.freeze({
            id,
            fileName,
            sql: migrationSqlWithoutTransactionControl(sql),
            checksum: sha256(sql),
        }))
    }
    return Object.freeze(migrations)
}

function databaseUrlForStaging(rawUrl) {
    const raw = String(rawUrl || '').trim()
    if (!raw) throw migrationError('II_MIGRATION_DATABASE_URL_MISSING')
    let url
    try {
        url = new URL(raw.replace(/^postgresql:/i, 'postgres:'))
    } catch {
        throw migrationError('II_MIGRATION_DATABASE_URL_INVALID')
    }
    const queryKeys = [...url.searchParams.keys()]
    if (queryKeys.some((key) => !['sslmode', 'uselibpqcompat', 'application_name'].includes(key))) {
        throw migrationError('II_MIGRATION_DATABASE_URL_QUERY_INVALID')
    }
    const host = String(url.hostname || '').toLowerCase()
    const port = url.port || '5432'
    const username = decodeURIComponent(url.username || '')
    const database = decodeURIComponent(String(url.pathname || '').replace(/^\//, ''))
    const applicationName = url.searchParams.get('application_name')
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)
        || port !== '5432'
        || username !== INFLUENCER_INTELLIGENCE_STAGING_TARGET.sessionUser
        || !url.password
        || database !== INFLUENCER_INTELLIGENCE_STAGING_TARGET.database
        || url.searchParams.get('sslmode') !== 'require'
        || url.searchParams.get('uselibpqcompat') !== 'true'
        || (applicationName && !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(applicationName))) {
        throw migrationError('II_MIGRATION_DATABASE_DESTINATION_UNSAFE')
    }
    // The connection may be provisioned from the existing staging migrator
    // file, but the server-side identity must still identify this runner.
    url.searchParams.set('application_name', 'influencer-intelligence-migration')
    url.protocol = 'postgres:'
    return url.toString()
}

export function assertInfluencerIntelligenceStagingDestination(rawUrl, target = 'staging') {
    if (String(target || '').trim().toLowerCase() !== 'staging') throw migrationError('II_MIGRATION_TARGET_NOT_SUPPORTED')
    return databaseUrlForStaging(rawUrl)
}

async function defaultCreatePool(databaseUrl, options) {
    // Keep pg in the existing CRM/API dependency boundary; tests inject a
    // fake pool and therefore do not load a second database dependency.
    const { createPgPool } = await import('../../crm/api/server/harmonia/store/pg.js')
    return createPgPool(databaseUrl, options)
}

async function queryValue(client, sql, values = []) {
    const result = await client.query(sql, values)
    return result?.rows?.[0] || {}
}

async function beginGuardedTransaction(client) {
    await client.query('begin')
    await client.query(`set local lock_timeout = '${INFLUENCER_INTELLIGENCE_MIGRATION_TIMEOUTS.lock}'`)
    await client.query(`set local statement_timeout = '${INFLUENCER_INTELLIGENCE_MIGRATION_TIMEOUTS.statement}'`)
    await client.query(`set local idle_in_transaction_session_timeout = '${INFLUENCER_INTELLIGENCE_MIGRATION_TIMEOUTS.idleInTransaction}'`)
    await client.query("set local time zone 'UTC'")
}

async function acquireMigrationLock(client) {
    const row = await queryValue(client, 'select pg_try_advisory_xact_lock(hashtextextended($1, 0)) as acquired', [INFLUENCER_INTELLIGENCE_MIGRATION_LOCK_KEY])
    if (row.acquired !== true && row.acquired !== 't') throw migrationError('II_MIGRATION_LOCK_UNAVAILABLE')
}

async function inspectIdentity(client) {
    return queryValue(client, `select
        current_database() as database_name,
        current_user as effective_role,
        session_user as session_user,
        current_setting('role') as configured_role,
        current_setting('application_name') as application_name,
        current_setting('transaction_read_only') as transaction_read_only,
        current_setting('lock_timeout') as lock_timeout,
        current_setting('statement_timeout') as statement_timeout,
        current_setting('idle_in_transaction_session_timeout') as idle_in_transaction_session_timeout`)
}

function assertInitialIdentity(identity) {
    if (identity.database_name !== INFLUENCER_INTELLIGENCE_STAGING_TARGET.database
        || identity.session_user !== INFLUENCER_INTELLIGENCE_STAGING_TARGET.sessionUser
        || identity.effective_role !== INFLUENCER_INTELLIGENCE_STAGING_TARGET.sessionUser
        || String(identity.transaction_read_only).toLowerCase() === 'on') {
        throw migrationError('II_MIGRATION_DATABASE_IDENTITY_MISMATCH')
    }
}

function timeoutMilliseconds(value) {
    const text = String(value || '').trim().toLowerCase()
    if (!text) return null
    let total = 0
    let matched = false
    let lastEnd = 0
    const pattern = /(\d+(?:\.\d+)?)\s*(ms|s|min|h)/g
    let match
    while ((match = pattern.exec(text))) {
        matched = true
        if (match.index !== lastEnd) return null
        lastEnd = pattern.lastIndex
        const amount = Number(match[1])
        if (!Number.isFinite(amount)) return null
        total += amount * ({ ms: 1, s: 1000, min: 60_000, h: 3_600_000 }[match[2]])
    }
    return matched && lastEnd === text.length ? total : null
}

function assertTimeoutContract(identity) {
    const observed = {
        lock: timeoutMilliseconds(identity.lock_timeout),
        statement: timeoutMilliseconds(identity.statement_timeout),
        idleInTransaction: timeoutMilliseconds(identity.idle_in_transaction_session_timeout),
    }
    const expected = {
        lock: timeoutMilliseconds(INFLUENCER_INTELLIGENCE_MIGRATION_TIMEOUTS.lock),
        statement: timeoutMilliseconds(INFLUENCER_INTELLIGENCE_MIGRATION_TIMEOUTS.statement),
        idleInTransaction: timeoutMilliseconds(INFLUENCER_INTELLIGENCE_MIGRATION_TIMEOUTS.idleInTransaction),
    }
    if (observed.lock !== expected.lock || observed.statement !== expected.statement || observed.idleInTransaction !== expected.idleInTransaction) {
        throw migrationError('II_MIGRATION_TIMEOUT_CONTRACT_UNPROVEN')
    }
    return { observed: identity, expected: INFLUENCER_INTELLIGENCE_MIGRATION_TIMEOUTS }
}

async function inspectRoleProof(client) {
    const row = await queryValue(client, `select
        pg_has_role(current_user, $1::name, 'member') as can_set_owner,
        has_database_privilege(current_user, current_database(), 'CONNECT') as migrator_connect,
        has_database_privilege($1::name, current_database(), 'CONNECT') as owner_connect,
        has_database_privilege($1::name, current_database(), 'CREATE') as owner_create,
        coalesce((select not rolcanlogin and not rolinherit from pg_roles where rolname = $1::name), false) as owner_role_shape`, [INFLUENCER_INTELLIGENCE_STAGING_TARGET.ownerRole])
    if (![row.can_set_owner, row.migrator_connect, row.owner_connect, row.owner_create, row.owner_role_shape].every((value) => value === true || value === 't')) {
        throw migrationError('II_MIGRATION_MINIMUM_GRANTS_UNPROVEN')
    }
    return row
}

async function promoteToOwnerRole(client) {
    await client.query(`set local role ${safeIdentifier(INFLUENCER_INTELLIGENCE_STAGING_TARGET.ownerRole)}`)
    const identity = await inspectIdentity(client)
    if (identity.effective_role !== INFLUENCER_INTELLIGENCE_STAGING_TARGET.ownerRole
        || identity.session_user !== INFLUENCER_INTELLIGENCE_STAGING_TARGET.sessionUser
        || String(identity.application_name) !== 'influencer-intelligence-migration') {
        throw migrationError('II_MIGRATION_EFFECTIVE_ROLE_MISMATCH')
    }
    return identity
}

async function relationExists(client, relation) {
    const row = await queryValue(client, 'select to_regclass($1) as relation', [`${INFLUENCER_INTELLIGENCE_STAGING_TARGET.schema}.${relation}`])
    return Boolean(row.relation)
}

async function collectSchemaState(client) {
    const schema = await queryValue(client, `select
        n.nspname as schema_name,
        pg_get_userbyid(n.nspowner) as schema_owner
      from pg_namespace n
      where n.nspname = $1`, [INFLUENCER_INTELLIGENCE_STAGING_TARGET.schema])
    const schemaPresent = Boolean(schema.schema_name)
    const relations = schemaPresent
        ? (await client.query(`select c.relname, c.relkind
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = $1 and c.relname = any($2::text[])
            order by c.relname`, [INFLUENCER_INTELLIGENCE_STAGING_TARGET.schema, [...EXPECTED_RELATIONS]])).rows
        : []
    const relationNames = relations.map((row) => row.relname)
    const ledger = schemaPresent && relationNames.includes('schema_migrations')
        ? (await client.query(`select id, applied_at, rolled_back_at, details
            from ${relationIdentifier('schema_migrations')}
            order by id`)).rows
        : []
    const columns = schemaPresent
        ? (await client.query(`select table_name, column_name
            from information_schema.columns
            where table_schema = $1 and (table_name, column_name) in (
              ('creator_registry', 'monitoring_enabled'),
              ('creator_registry', 'monitoring_interval_hours'),
              ('collector_run', 'coverage_available'),
              ('collector_run', 'failure_count'),
              ('collector_run', 'freshness_status'),
              ('collector_run', 'attempt_token'),
              ('creator_profile_snapshot', 'freshness_status'),
              ('creator_media_snapshot', 'freshness_status'),
              ('creator_score', 'weights_version'),
              ('campaign_creator_fit', 'weights_version'),
              ('campaign_creator_fit', 'components')
            )`, [INFLUENCER_INTELLIGENCE_STAGING_TARGET.schema])).rows
        : []
    const triggerRows = schemaPresent
        ? (await client.query(`select c.relname, t.tgname
            from pg_trigger t
            join pg_class c on c.oid = t.tgrelid
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = $1 and not t.tgisinternal
              and c.relname = any($2::text[])
              and t.tgname = c.relname || '_append_only'`, [INFLUENCER_INTELLIGENCE_STAGING_TARGET.schema, [...APPEND_ONLY_RELATIONS]])).rows
        : []
    const counts = {}
    for (const relation of EXPECTED_RELATIONS.filter((name) => name !== 'schema_migrations')) {
        if (!relationNames.includes(relation)) continue
        const row = await queryValue(client, `select count(*)::int as count from ${relationIdentifier(relation)}`)
        counts[relation] = Number(row.count || 0)
    }
    return {
        schemaPresent,
        schemaOwner: schema.schema_owner || null,
        relationNames,
        relations,
        ledger,
        columns,
        appendOnlyTriggers: triggerRows.map((row) => `${row.relname}:${row.tgname}`),
        counts,
    }
}

async function collectRuntimePrivilegeState(client) {
    const rows = []
    for (const role of INFLUENCER_INTELLIGENCE_STAGING_TARGET.runtimeRoles) {
        const row = await queryValue(client, `select
            $1::name as role_name,
            exists(select 1 from pg_roles where rolname = $1::name) as role_present,
            case when exists(select 1 from pg_roles where rolname = $1::name)
              then has_schema_privilege($1::name, $2::name, 'USAGE') else false end as schema_usage,
            case when exists(select 1 from pg_roles where rolname = $1::name)
              then has_schema_privilege($1::name, $2::name, 'CREATE') else false end as schema_create,
            case when exists(select 1 from pg_roles where rolname = $1::name)
              then exists(
                select 1 from unnest($3::text[]) as relation_name
                where to_regclass(format('%I.%I', $2, relation_name)) is not null
                  and has_table_privilege($1, format('%I.%I', $2, relation_name), 'INSERT,UPDATE,DELETE,TRUNCATE')
              ) else false end as dml_privilege`, [role, INFLUENCER_INTELLIGENCE_STAGING_TARGET.schema, [...APP_PRIVILEGE_RELATIONS]])
        rows.push(row)
    }
    return rows
}

function assertRuntimeIsolation(runtimePrivileges) {
    if (runtimePrivileges.some((row) => [row.schema_usage, row.schema_create, row.dml_privilege].some((value) => value === true || value === 't'))) {
        throw migrationError('II_MIGRATION_RUNTIME_GRANT_PRESENT')
    }
}

function ledgerById(state) {
    return new Map(state.ledger.map((row) => [row.id, row]))
}

function assertPostApplyState(state, runtimePrivileges) {
    if (!state.schemaPresent || state.schemaOwner !== INFLUENCER_INTELLIGENCE_STAGING_TARGET.ownerRole) throw migrationError('II_MIGRATION_POST_SCHEMA_INVALID')
    const missingRelations = EXPECTED_RELATIONS.filter((relation) => !state.relationNames.includes(relation))
    if (missingRelations.length) throw migrationError('II_MIGRATION_POST_RELATIONS_MISSING', { missingRelations })
    const ledger = ledgerById(state)
    const missingMigrations = INFLUENCER_INTELLIGENCE_MIGRATION_IDS.filter((id) => !ledger.has(id) || ledger.get(id).rolled_back_at)
    if (missingMigrations.length) throw migrationError('II_MIGRATION_POST_LEDGER_INVALID', { missingMigrations })
    const missingColumns = REQUIRED_COLUMNS.filter(([tableName, columnName]) => !state.columns.some((row) => row.table_name === tableName && row.column_name === columnName))
    if (missingColumns.length) throw migrationError('II_MIGRATION_POST_COLUMNS_MISSING', { missingColumns })
    const missingTriggers = APPEND_ONLY_RELATIONS.filter((relation) => !state.appendOnlyTriggers.includes(`${relation}:${relation}_append_only`))
    if (missingTriggers.length) throw migrationError('II_MIGRATION_POST_APPEND_ONLY_INVALID', { missingTriggers })
    assertRuntimeIsolation(runtimePrivileges)
    return {
        schema: state.schemaPresent,
        owner: state.schemaOwner,
        relations: state.relationNames.length,
        migrations: ledger.size,
        appendOnlyRelations: APPEND_ONLY_RELATIONS.length,
        runtimePrivileges: runtimePrivileges.map((row) => ({
            role: row.role_name,
            present: row.role_present === true || row.role_present === 't',
            schemaUsage: row.schema_usage === true || row.schema_usage === 't',
            schemaCreate: row.schema_create === true || row.schema_create === 't',
            dml: row.dml_privilege === true || row.dml_privilege === 't',
        })),
        seededRows: Object.values(state.counts).reduce((total, value) => total + Number(value || 0), 0),
    }
}

function checkpointPathOutsideRepository(checkpointPath) {
    const raw = String(checkpointPath || '').trim()
    if (!raw || !path.isAbsolute(raw)) throw migrationError('II_MIGRATION_CHECKPOINT_PATH_INVALID')
    const resolved = path.resolve(raw)
    const relative = path.relative(ROOT, resolved)
    if (relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
        throw migrationError('II_MIGRATION_CHECKPOINT_MUST_BE_PRIVATE')
    }
    return resolved
}

async function writeCheckpoint(checkpointPath, payload) {
    const destination = checkpointPathOutsideRepository(checkpointPath)
    try {
        await fs.lstat(destination)
        throw migrationError('II_MIGRATION_CHECKPOINT_ALREADY_EXISTS')
    } catch (error) {
        if (error?.code === 'II_MIGRATION_CHECKPOINT_ALREADY_EXISTS') throw error
        if (error?.code !== 'ENOENT') throw migrationError('II_MIGRATION_CHECKPOINT_PATH_INVALID')
    }
    const parent = path.dirname(destination)
    await fs.mkdir(parent, { recursive: true, mode: 0o700 })
    const record = {
        schemaVersion: 1,
        kind: 'influencer-intelligence/staging-migration-checkpoint/v1',
        runnerVersion: INFLUENCER_INTELLIGENCE_MIGRATION_RUNNER_VERSION,
        environment: 'staging',
        database: INFLUENCER_INTELLIGENCE_STAGING_TARGET.database,
        sessionUser: payload.identity.session_user,
        effectiveRole: payload.identity.effective_role,
        releaseSha: payload.releaseSha,
        capturedAt: payload.capturedAt,
        timeoutContract: INFLUENCER_INTELLIGENCE_MIGRATION_TIMEOUTS,
        lockKey: INFLUENCER_INTELLIGENCE_MIGRATION_LOCK_KEY,
        before: payload.before,
        rollback: {
            failedTransaction: 'database transaction is rolled back by the runner; no partial migration is accepted',
            committedSchema: 'disable runtime and retain append-only evidence; use the separately verified database restore path if a committed schema must be reverted',
            destructiveDownMigrations: false,
        },
    }
    const serialized = `${JSON.stringify(record, null, 2)}\n`
    await fs.writeFile(destination, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return { path: destination, sha256: sha256(serialized), bytes: Buffer.byteLength(serialized) }
}

function sanitizedError(error) {
    const code = /^[A-Z][A-Z0-9_]{2,80}$/.test(String(error?.code || ''))
        ? String(error.code)
        : 'II_MIGRATION_DATABASE_OPERATION_FAILED'
    return { code }
}

export function parseInfluencerIntelligenceMigrationArgs(argv = []) {
    const values = { action: null, target: null, releaseSha: null, checkpointPath: null }
    const args = Array.isArray(argv) ? argv.map(String) : []
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index]
        if (['--dry-run', '--apply', '--verify'].includes(arg)) {
            if (values.action) throw migrationError('II_MIGRATION_ACTION_INVALID')
            values.action = arg.slice(2)
        } else if (arg === '--target') values.target = args[++index]
        else if (arg === '--release-sha') values.releaseSha = args[++index]
        else if (arg === '--checkpoint') values.checkpointPath = args[++index]
        else throw migrationError('II_MIGRATION_ARGUMENT_INVALID')
    }
    if (!values.action || values.target !== 'staging') throw migrationError('II_MIGRATION_ARGUMENT_INVALID')
    if (values.action === 'apply' && (!/^[0-9a-f]{40}$/.test(String(values.releaseSha || '')) || !values.checkpointPath)) throw migrationError('II_MIGRATION_APPLY_ARGUMENTS_INVALID')
    if (values.action !== 'apply' && (values.releaseSha || values.checkpointPath)) throw migrationError('II_MIGRATION_READONLY_ARGUMENTS_INVALID')
    return values
}

export async function runInfluencerIntelligenceMigration({
    databaseUrl,
    target = 'staging',
    action = 'dry-run',
    releaseSha = null,
    checkpointPath = null,
    createPool = defaultCreatePool,
    migrations = null,
    createRunId = randomUUID,
    now = () => new Date().toISOString(),
} = {}) {
    const normalizedUrl = assertInfluencerIntelligenceStagingDestination(databaseUrl, target)
    if (!['dry-run', 'apply', 'verify'].includes(action)) throw migrationError('II_MIGRATION_ACTION_INVALID')
    if (action === 'apply' && (!/^[0-9a-f]{40}$/.test(String(releaseSha || '')) || !checkpointPath)) throw migrationError('II_MIGRATION_APPLY_ARGUMENTS_INVALID')
    const migrationPlan = migrations || await loadMigrations()
    if (!Array.isArray(migrationPlan) || migrationPlan.length !== MIGRATION_PLAN.length || migrationPlan.some((migration) => !INFLUENCER_INTELLIGENCE_MIGRATION_IDS.includes(migration?.id))) throw migrationError('II_MIGRATION_PLAN_INVALID')
    const runId = createRunId()
    const startedAt = now()
    const pool = await createPool(normalizedUrl, { max: 1 })
    if (!pool) throw migrationError('II_MIGRATION_POOL_UNAVAILABLE')
    let client = null
    let transactionOpen = false
    let phase = 'connect'
    try {
        client = await pool.connect()
        phase = 'preflight'
        await beginGuardedTransaction(client)
        transactionOpen = true
        await acquireMigrationLock(client)
        const initialIdentity = await inspectIdentity(client)
        assertInitialIdentity(initialIdentity)
        const timeoutProofBeforeRole = assertTimeoutContract(initialIdentity)
        const roleProof = await inspectRoleProof(client)
        const identity = await promoteToOwnerRole(client)
        const timeoutProof = assertTimeoutContract(identity)
        const before = await collectSchemaState(client)
        const runtimePrivilegesBefore = await collectRuntimePrivilegeState(client)
        assertRuntimeIsolation(runtimePrivilegesBefore)
        const baseReport = {
            runId,
            runnerVersion: INFLUENCER_INTELLIGENCE_MIGRATION_RUNNER_VERSION,
            environment: 'staging',
            target: INFLUENCER_INTELLIGENCE_STAGING_TARGET.database,
            action,
            startedAt,
            identity: {
                database: identity.database_name,
                sessionUser: identity.session_user,
                effectiveRole: identity.effective_role,
                applicationName: identity.application_name,
                transactionReadOnly: identity.transaction_read_only,
            },
            roleProof: {
                sessionCanSetOwner: roleProof.can_set_owner === true || roleProof.can_set_owner === 't',
                migratorConnect: roleProof.migrator_connect === true || roleProof.migrator_connect === 't',
                ownerConnect: roleProof.owner_connect === true || roleProof.owner_connect === 't',
                ownerCreate: roleProof.owner_create === true || roleProof.owner_create === 't',
                ownerRoleShape: roleProof.owner_role_shape === true || roleProof.owner_role_shape === 't',
            },
            timeoutContract: INFLUENCER_INTELLIGENCE_MIGRATION_TIMEOUTS,
            observedTimeouts: timeoutProof.observed,
            timeoutProof: {
                beforeRole: timeoutProofBeforeRole.observed,
                afterRole: timeoutProof.observed,
            },
            lock: { key: INFLUENCER_INTELLIGENCE_MIGRATION_LOCK_KEY, acquired: true },
            featureFlag: { name: 'INFLUENCER_INTELLIGENCE_ENABLED', default: false, runtimeRegistered: false },
            before: { schemaPresent: before.schemaPresent, relations: before.relationNames, ledger: before.ledger.map(({ id, applied_at, rolled_back_at }) => ({ id, appliedAt: applied_at, rolledBackAt: rolled_back_at })), counts: before.counts },
        }
        if (action === 'dry-run') {
            await client.query('rollback')
            transactionOpen = false
            return { ...baseReport, status: 'planned', migrations: migrationPlan.map(({ id, fileName, checksum }) => ({ id, fileName, checksum })), runtimePrivileges: runtimePrivilegesBefore, finishedAt: now() }
        }
        if (action === 'verify') {
            const postValidation = assertPostApplyState(before, runtimePrivilegesBefore)
            await client.query('rollback')
            transactionOpen = false
            return { ...baseReport, status: 'verified', postValidation, finishedAt: now() }
        }
        phase = 'checkpoint'
        const checkpoint = await writeCheckpoint(checkpointPath, { identity, before, releaseSha, capturedAt: now() })
        const applied = ledgerById(before)
        const migrationReports = []
        phase = 'migration'
        for (const migration of migrationPlan) {
            const existing = applied.get(migration.id)
            if (existing) {
                if (existing.rolled_back_at) throw migrationError('II_MIGRATION_LEDGER_ROLLED_BACK', { id: migration.id })
                let details = existing.details
                if (typeof details === 'string') {
                    try { details = JSON.parse(details) } catch { details = null }
                }
                if (!details || details.checksum !== migration.checksum) throw migrationError('II_MIGRATION_LEDGER_CHECKSUM_DRIFT', { id: migration.id })
                migrationReports.push({ id: migration.id, status: 'skipped', checksum: migration.checksum })
                continue
            }
            await client.query(migration.sql)
            await client.query(`insert into ${relationIdentifier('schema_migrations')} (id, details) values ($1, $2::jsonb)`, [migration.id, JSON.stringify({ runnerVersion: INFLUENCER_INTELLIGENCE_MIGRATION_RUNNER_VERSION, environment: 'staging', checksum: migration.checksum, releaseSha, runId, additive: true })])
            migrationReports.push({ id: migration.id, status: 'applied', checksum: migration.checksum })
        }
        phase = 'post-validation'
        const after = await collectSchemaState(client)
        const runtimePrivilegesAfter = await collectRuntimePrivilegeState(client)
        const postValidation = assertPostApplyState(after, runtimePrivilegesAfter)
        await client.query('commit')
        transactionOpen = false
        return { ...baseReport, status: 'applied', releaseSha, checkpoint, migrations: migrationReports, postValidation, finishedAt: now() }
    } catch (error) {
        if (transactionOpen && client) {
            try { await client.query('rollback') } catch { /* preserve the guarded failure */ }
        }
        const sanitized = sanitizedError(error)
        sanitized.phase = phase
        sanitized.runId = runId
        throw Object.assign(migrationError(sanitized.code, sanitized), { cause: error })
    } finally {
        if (client) client.release()
        await pool.end()
    }
}

async function readStagingDatabaseUrl() {
    const { readLiteralEnvironment } = await import('../../crm/api/server/atendimento/runtimeEnv.js')
    const values = await readLiteralEnvironment(FIXED_ENV_FILE, { allowedKeys: ['DATABASE_URL'] })
    if (!values.DATABASE_URL) throw migrationError('II_MIGRATION_STAGING_SECRET_MISSING')
    return values.DATABASE_URL
}

export async function main(argv = process.argv.slice(2)) {
    const args = parseInfluencerIntelligenceMigrationArgs(argv)
    const report = await runInfluencerIntelligenceMigration({
        databaseUrl: await readStagingDatabaseUrl(),
        target: args.target,
        action: args.action,
        releaseSha: args.releaseSha,
        checkpointPath: args.checkpointPath,
    })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectExecution) {
    main().catch((error) => {
        process.stderr.write(`${JSON.stringify({ ok: false, error: sanitizedError(error) })}\n`)
        process.exitCode = 1
    })
}

export const __testables = {
    ROOT,
    MIGRATIONS_ROOT,
    FIXED_ENV_FILE,
    MIGRATION_PLAN,
    EXPECTED_RELATIONS,
    APPEND_ONLY_RELATIONS,
    REQUIRED_COLUMNS,
    migrationSqlWithoutTransactionControl,
    assertAdditiveMigrationSql,
    databaseUrlForStaging,
    loadMigrations,
    collectSchemaState,
    collectRuntimePrivilegeState,
    assertPostApplyState,
    checkpointPathOutsideRepository,
    sanitizedError,
}
