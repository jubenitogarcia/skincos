import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createPgPool } from '../server/harmonia/store/pg.js'
import { harmoniaMigrationStatements, defaultUnitsSeedRows } from '../server/harmonia/store/migrate.js'

export const HARMONIA_MIGRATION_ID = '20260805_harmonia_worker_foundation_v1'

export const HARMONIA_MIGRATION_TARGETS = Object.freeze({
    production: Object.freeze({ database: 'skincos_crm_local', user: 'skincos', transport: 'unix_socket' }),
    staging: Object.freeze({ database: 'skincos_staging', user: 'skincos_staging_migrator_login', transport: 'loopback_tls' }),
})

function normalizeTarget(value) {
    const target = String(value || '').trim().toLowerCase()
    if (!Object.prototype.hasOwnProperty.call(HARMONIA_MIGRATION_TARGETS, target)) {
        throw new Error('target must be production or staging')
    }
    return target
}

function databaseNameFromUrl(databaseUrl) {
    const raw = String(databaseUrl || '').trim()
    if (!raw) return null
    try {
        const parsed = new URL(raw.replace(/^postgresql:/i, 'postgres:'))
        return decodeURIComponent(String(parsed.pathname || '').replace(/^\//, '')) || null
    } catch {
        const match = raw.match(/\/([^/?]+)(?:\?|$)/)
        return match?.[1] || null
    }
}

export function assertHarmoniaMigrationDestination(databaseUrl, targetValue) {
    const target = normalizeTarget(targetValue)
    const expected = HARMONIA_MIGRATION_TARGETS[target]
    const raw = String(databaseUrl || '').trim()
    if (!raw) throw new Error('DATABASE_URL is required')
    const database = databaseNameFromUrl(raw)
    if (database !== expected.database) {
        throw new Error(`DATABASE_URL must target ${expected.database} for ${target}`)
    }

    if (target === 'production') {
        if (!/^postgres(?:ql)?:\/\/skincos@\/[^?]+\?[^#]*host=\/var\/run\/postgresql(?:&|$)/i.test(raw)) {
            throw new Error('production Harmonia migration requires the dedicated local PostgreSQL socket URL')
        }
        return target
    }

    if (!/^postgres(?:ql)?:\/\/[^@]+@127\.0\.0\.1(?::\d+)?\/[^?]+\?/i.test(raw)) {
        throw new Error('staging Harmonia migration requires a loopback PostgreSQL URL')
    }
    if (!/[?&]sslmode=require(?:&|$)/i.test(raw)) {
        throw new Error('staging Harmonia migration requires sslmode=require')
    }
    if (!/^postgres(?:ql)?:\/\/skincos_staging_migrator_login(?::[^@]*)?@/i.test(raw)) {
        throw new Error('staging Harmonia migration requires the dedicated migrator login')
    }
    return target
}

export function harmoniaMigrationPlan() {
    return {
        id: HARMONIA_MIGRATION_ID,
        additive: true,
        statements: [
            ...harmoniaMigrationStatements(),
            `create table if not exists harmonia.schema_migrations (
                id text primary key,
                applied_at timestamptz not null default now(),
                release_sha text,
                target text not null,
                details jsonb not null default '{}'::jsonb
            );`,
        ],
        seedUnits: defaultUnitsSeedRows().map((unit) => ({ ...unit })),
        rollback: 'Disable/stop the worker and retain the additive schema; no destructive rollback is permitted.',
    }
}

async function queryState(client) {
    const tables = await client.query(`
        select
            to_regnamespace('harmonia') as schema_name,
            to_regclass('harmonia.units') as units,
            to_regclass('harmonia.contacts') as contacts,
            to_regclass('harmonia.conversations') as conversations,
            to_regclass('harmonia.messages') as messages,
            to_regclass('harmonia.tasks') as tasks,
            to_regclass('harmonia.delivery_events') as delivery_events,
            to_regclass('harmonia.schema_migrations') as schema_migrations,
            current_database() as database_name,
            current_user as database_user
    `)
    const row = tables.rows?.[0] || {}
    const counts = {}
    for (const key of ['units', 'contacts', 'conversations', 'messages', 'tasks', 'delivery_events']) {
        if (!row[key]) continue
        const count = await client.query(`select count(*)::int as count from harmonia.${key}`)
        counts[key] = Number(count.rows?.[0]?.count || 0)
    }
    return {
        schemaPresent: Boolean(row.schema_name),
        tables: Object.fromEntries(['units', 'contacts', 'conversations', 'messages', 'tasks', 'delivery_events', 'schema_migrations'].map((key) => [key, Boolean(row[key])])),
        counts,
        database: row.database_name || null,
        user: row.database_user || null,
    }
}

async function hasApplied(client) {
    const relation = await client.query(`select to_regclass('harmonia.schema_migrations') as relation`)
    if (!relation.rows?.[0]?.relation) return false
    const result = await client.query('select 1 from harmonia.schema_migrations where id=$1 limit 1', [HARMONIA_MIGRATION_ID])
    return Boolean(result.rows?.[0])
}

async function writeCheckpoint(checkpointPath, { target, databaseUrl, state, releaseSha }) {
    const rawCheckpointPath = String(checkpointPath || '').trim()
    if (!rawCheckpointPath) throw new Error('checkpoint path is required')
    const destination = path.resolve(rawCheckpointPath)
    if (destination === path.parse(destination).root) throw new Error('checkpoint path must be a file')
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o750 })
    const record = {
        schemaVersion: 1,
        migrationId: HARMONIA_MIGRATION_ID,
        target,
        database: state.database,
        databaseUser: state.user,
        databaseUrlShape: databaseNameFromUrl(databaseUrl),
        releaseSha: String(releaseSha || '').trim() || null,
        capturedAt: new Date().toISOString(),
        before: state,
        rollback: 'stop/disable the worker; retain schema and audit evidence; do not drop tables',
    }
    await fs.writeFile(destination, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o640 })
    return destination
}

export async function runHarmoniaMigration({ databaseUrl, target: targetValue, action = 'dry-run', checkpointPath, releaseSha } = {}) {
    const target = assertHarmoniaMigrationDestination(databaseUrl, targetValue)
    if (!['dry-run', 'apply'].includes(action)) throw new Error('action must be dry-run or apply')
    const pool = createPgPool(databaseUrl)
    if (!pool) throw new Error('DATABASE_URL is required')

    try {
        const client = await pool.connect()
        try {
            await client.query('begin')
            await client.query("select pg_advisory_xact_lock(hashtextextended('skincos:harmonia-schema-migration', 0))")
            const before = await queryState(client)
            const applied = await hasApplied(client)
            const checkpoint = action === 'apply'
                ? await writeCheckpoint(checkpointPath, { target, databaseUrl, state: before, releaseSha })
                : null

            if (action === 'dry-run' || applied) {
                await client.query('rollback')
                return { migrationId: HARMONIA_MIGRATION_ID, target, action, alreadyApplied: applied, checkpoint, before }
            }

            const requiredTables = ['units', 'contacts', 'conversations', 'messages', 'tasks', 'delivery_events']
            const presentTables = requiredTables.filter((key) => before.tables[key])
            if (presentTables.length > 0 && presentTables.length < requiredTables.length) {
                throw new Error('existing Harmonia schema is partial; run an owner-controlled repair before this migration')
            }
            // Staging may already have the original Harmonia schema owned by
            // the application owner. In that case the dedicated migrator
            // must not replay CREATE/ALTER statements it cannot own; it only
            // adds the migration registry and verifies the existing tables.
            if (presentTables.length === 0) {
                for (const statement of harmoniaMigrationStatements()) await client.query(statement)
            }
            await client.query(harmoniaMigrationPlan().statements.at(-1))
            for (const unit of defaultUnitsSeedRows()) {
                await client.query(
                    `insert into harmonia.units (slug, name, timezone, working_hours)
                     values ($1, $2, $3, $4::jsonb)
                     on conflict (slug) do nothing`,
                    [unit.slug, unit.name, unit.timezone, JSON.stringify(unit.working_hours)],
                )
            }
            await client.query(
                `insert into harmonia.schema_migrations (id, release_sha, target, details)
                 values ($1, $2, $3, $4::jsonb)`,
                [HARMONIA_MIGRATION_ID, String(releaseSha || '').trim() || null, target, JSON.stringify({ additive: true, outboundMode: 'blocked' })],
            )
            const after = await queryState(client)
            await client.query('commit')
            return { migrationId: HARMONIA_MIGRATION_ID, target, action, alreadyApplied: false, checkpoint, before, after }
        } catch (error) {
            try { await client.query('rollback') } catch { /* preserve original error */ }
            throw error
        } finally {
            client.release()
        }
    } finally {
        await pool.end()
    }
}

function parseArgs(argv) {
    const values = { action: null, target: null, checkpoint: null, releaseSha: process.env.SKINCOS_RELEASE_ID || null }
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]
        if (arg === '--dry-run') values.action = 'dry-run'
        else if (arg === '--apply') values.action = 'apply'
        else if (arg === '--target') values.target = argv[++index]
        else if (arg === '--checkpoint') values.checkpoint = argv[++index]
        else if (arg === '--release-sha') values.releaseSha = argv[++index]
        else throw new Error(`unknown argument: ${arg}`)
    }
    if (!values.action || !values.target || (values.action === 'apply' && !values.checkpoint)) {
        throw new Error('use exactly one of --dry-run/--apply, with --target and --checkpoint for --apply')
    }
    return values
}

export async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv)
    const result = await runHarmoniaMigration({
        databaseUrl: process.env.DATABASE_URL,
        target: args.target,
        action: args.action,
        checkpointPath: args.checkpoint,
        releaseSha: args.releaseSha,
    })
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectExecution) {
    main().catch((error) => {
        process.stderr.write(`harmonia migration failed: ${error?.message || 'unknown error'}\n`)
        process.exitCode = 1
    })
}
