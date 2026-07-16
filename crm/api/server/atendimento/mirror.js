import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createPgPool } from '../harmonia/store/pg.js'

export const MIRROR_TABLES = [
    'units',
    'professionals',
    'procedures',
    'procedure_price_codes',
    'attendances',
    'schedule_days',
    'import_batches',
    'raw_sheet_rows',
    'management_items',
    'inventory_items',
    'monthly_unit_goals',
    'monthly_unit_goal_levels',
    'goal_table_rows',
]

export const DEFAULT_CRM_RUNTIME_HOME = '/var/lib/skincos-runtime/crm'

const LOCAL_DATABASE_NAME = 'skincos_crm_local'
const IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/
const INSERT_BATCH_SIZE = 250

function mirrorError(code, message) {
    const error = new Error(message || code)
    error.code = code
    error.statusCode = 400
    return error
}

function quoteIdentifier(value) {
    if (!IDENTIFIER_RE.test(String(value || ''))) {
        throw mirrorError('MIRROR_INVALID_IDENTIFIER', 'Identificador de espelho inválido.')
    }
    return `"${value}"`
}

function qualifiedTable(table) {
    return `crm_atendimento.${quoteIdentifier(table)}`
}

export function parsePostgresConnection(value) {
    const raw = String(value || '').trim()
    if (!raw) return null
    try {
        const url = new URL(raw)
        const socketHost = url.searchParams.get('host') || ''
        return {
            database: url.pathname.replace(/^\//, ''),
            host: socketHost || url.hostname || '',
            port: url.port || '',
            user: decodeURIComponent(url.username || ''),
        }
    } catch {
        const socketUrl = raw.match(/^postgres(?:ql)?:\/\/(?:([^:@/?]+)(?::[^@/?]*)?@)?\/([^?]+)(?:\?(.*))?$/i)
        if (!socketUrl) return null
        const params = new URLSearchParams(socketUrl[3] || '')
        return {
            database: socketUrl[2],
            host: params.get('host') || '',
            port: params.get('port') || '',
            user: decodeURIComponent(socketUrl[1] || ''),
        }
    }
}

export function isLocalMirrorDestination(destinationUrl) {
    const parsed = parsePostgresConnection(destinationUrl)
    if (!parsed || parsed.database !== LOCAL_DATABASE_NAME) return false
    const host = String(parsed.host || '').trim().toLowerCase()
    return !host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('/var/run/postgresql')
}

export async function ensureAtendimentoMirrorMetadata(client) {
    await client.query(`create table if not exists crm_atendimento.local_mirror_state (
        singleton boolean primary key default true check (singleton),
        mode text not null default 'local-sandbox',
        source_fingerprint text,
        synced_at timestamptz,
        row_counts jsonb not null default '{}'::jsonb,
        min_service_date date,
        max_service_date date,
        backup_path text,
        updated_at timestamptz not null default now()
    )`)
}

async function getDatabaseIdentity(client) {
    const result = await client.query(`select
        current_database() as database_name,
        current_user as database_user,
        coalesce(inet_server_addr()::text, '') as server_address,
        current_setting('transaction_read_only') as transaction_read_only`)
    return result.rows[0] || {}
}

async function assertSourceReadOnly(client) {
    const identity = await getDatabaseIdentity(client)
    if (String(identity.transaction_read_only || '').toLowerCase() !== 'on') {
        throw mirrorError('MIRROR_SOURCE_NOT_READ_ONLY', 'A origem não está em transação somente leitura.')
    }

    for (const table of MIRROR_TABLES) {
        const target = `crm_atendimento.${table}`
        const result = await client.query(`select
            has_table_privilege(current_user, $1, 'SELECT') as can_select,
            has_table_privilege(current_user, $1, 'INSERT') as can_insert,
            has_table_privilege(current_user, $1, 'UPDATE') as can_update,
            has_table_privilege(current_user, $1, 'DELETE') as can_delete`, [target])
        const permissions = result.rows[0] || {}
        if (!permissions.can_select || permissions.can_insert || permissions.can_update || permissions.can_delete) {
            throw mirrorError('MIRROR_SOURCE_PRIVILEGES_INVALID', `A origem não possui permissões somente leitura para ${target}.`)
        }
    }
    return identity
}

function buildFingerprint(identity) {
    const raw = `${identity.server_address || 'socket'}|${identity.database_name || ''}|${identity.database_user || ''}`
    return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}

function connectionFingerprint(url) {
    const parsed = parsePostgresConnection(url)
    if (!parsed) return ''
    return `${parsed.host}|${parsed.port}|${parsed.database}|${parsed.user}`
}

async function readSourceSnapshot(client) {
    const tables = {}
    for (const table of MIRROR_TABLES) {
        const result = await client.query(`select * from ${qualifiedTable(table)}`)
        const columns = result.fields.map((field) => field.name)
        if (!columns.length && result.rows.length) {
            throw mirrorError('MIRROR_SOURCE_COLUMNS_UNAVAILABLE', `Não foi possível identificar colunas de ${table}.`)
        }
        tables[table] = { columns, rows: result.rows }
    }

    const attendanceRows = tables.attendances?.rows || []
    if (!attendanceRows.length) {
        throw mirrorError('MIRROR_SOURCE_EMPTY', 'A origem não possui atendimentos ativos; o clone local não foi alterado.')
    }

    const range = await client.query(`select
        min(service_date)::text as min_service_date,
        max(service_date)::text as max_service_date
        from crm_atendimento.attendances
        where deleted_at is null`)
    return { tables, range: range.rows[0] || {} }
}

async function insertRows(client, table, columns, rows) {
    if (!rows.length) return
    const target = qualifiedTable(table)
    const destinationColumns = await client.query(
        `select column_name from information_schema.columns where table_schema = 'crm_atendimento' and table_name = $1`,
        [table],
    )
    const allowedColumns = new Set(destinationColumns.rows.map((row) => row.column_name))
    if (!columns.every((column) => allowedColumns.has(column))) {
        throw mirrorError('MIRROR_SCHEMA_MISMATCH', `O schema local não aceita todas as colunas de ${table}.`)
    }
    const quotedColumns = columns.map(quoteIdentifier).join(', ')
    for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
        const batch = rows.slice(offset, offset + INSERT_BATCH_SIZE)
        const params = []
        const values = batch.map((row, rowIndex) => {
            const placeholders = columns.map((_column, columnIndex) => {
                params.push(row[columns[columnIndex]])
                return `$${rowIndex * columns.length + columnIndex + 1}`
            })
            return `(${placeholders.join(', ')})`
        })
        await client.query(`insert into ${target} (${quotedColumns}) values ${values.join(', ')}`, params)
    }
}

async function runProcess(command, args) {
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
        let stderr = ''
        child.stderr.on('data', (chunk) => { stderr += String(chunk) })
        child.on('error', reject)
        child.on('close', (code) => {
            if (code === 0) return resolve()
            reject(mirrorError('MIRROR_BACKUP_FAILED', `Backup local falhou (${code}): ${stderr.trim().slice(0, 300)}`))
        })
    })
}

export async function backupAtendimentoMirror(destinationUrl, runtimeHome = process.env.CRM_RUNTIME_HOME || DEFAULT_CRM_RUNTIME_HOME) {
    const backupDir = path.join(runtimeHome, 'backups', 'atendimento')
    await fs.mkdir(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(backupDir, `atendimento-mirror-${stamp}.dump`)
    await runProcess('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=crm_atendimento', `--file=${backupPath}`, `--dbname=${destinationUrl}`])
    const entries = (await fs.readdir(backupDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.dump'))
        .sort((left, right) => right.name.localeCompare(left.name))
    await Promise.all(entries.slice(10).map((entry) => fs.unlink(path.join(backupDir, entry.name))))
    return backupPath
}

export async function restoreAtendimentoMirror(destinationUrl, backupPath) {
    if (!isLocalMirrorDestination(destinationUrl)) {
        throw mirrorError('MIRROR_DESTINATION_UNSAFE', `O destino deve ser o banco local ${LOCAL_DATABASE_NAME}.`)
    }
    if (!backupPath) {
        throw mirrorError('MIRROR_BACKUP_MISSING', 'O backup anterior do clone não foi informado.')
    }
    await runProcess('psql', [
        `--dbname=${destinationUrl}`,
        '--set=ON_ERROR_STOP=1',
        '--command=drop schema if exists crm_atendimento cascade',
    ])
    await runProcess('pg_restore', [
        `--dbname=${destinationUrl}`,
        '--no-owner',
        '--no-privileges',
        backupPath,
    ])
}

export async function getAtendimentoMirrorStatus(pool) {
    const [stateResult, countsResult, rangeResult] = await Promise.all([
        pool.query(`select mode, synced_at, row_counts, min_service_date::text, max_service_date::text, updated_at from crm_atendimento.local_mirror_state where singleton = true`),
        pool.query(`select count(*)::int as attendances from crm_atendimento.attendances where deleted_at is null`),
        pool.query(`select min(service_date)::text as min_service_date, max(service_date)::text as max_service_date from crm_atendimento.attendances where deleted_at is null`),
    ])
    const state = stateResult.rows[0] || {}
    const range = rangeResult.rows[0] || {}
    return {
        mode: state.mode || 'local-sandbox',
        syncedAt: state.synced_at || null,
        updatedAt: state.updated_at || null,
        rowCounts: state.row_counts || {},
        attendances: Number(countsResult.rows[0]?.attendances || 0),
        minServiceDate: state.min_service_date || range.min_service_date || null,
        maxServiceDate: state.max_service_date || range.max_service_date || null,
    }
}

export async function syncAtendimentoMirror({
    sourceUrl,
    destinationUrl,
    dryRun = true,
    createPool = createPgPool,
    migrateDestination,
    backupDestination = backupAtendimentoMirror,
}) {
    if (!sourceUrl) throw mirrorError('MIRROR_SOURCE_NOT_CONFIGURED', 'ATENDIMENTO_SOURCE_DATABASE_URL não está configurada.')
    if (!destinationUrl) throw mirrorError('MIRROR_DESTINATION_NOT_CONFIGURED', 'DATABASE_URL local não está configurada.')
    if (!isLocalMirrorDestination(destinationUrl)) {
        throw mirrorError('MIRROR_DESTINATION_UNSAFE', `O destino deve ser o banco local ${LOCAL_DATABASE_NAME}.`)
    }
    if (connectionFingerprint(sourceUrl) === connectionFingerprint(destinationUrl)) {
        throw mirrorError('MIRROR_SOURCE_EQUALS_DESTINATION', 'A origem e o destino do clone não podem ser iguais.')
    }

    const sourcePool = createPool(sourceUrl)
    const destinationPool = createPool(destinationUrl)
    if (!sourcePool || !destinationPool) throw mirrorError('MIRROR_POOL_UNAVAILABLE', 'Não foi possível abrir as conexões do espelho.')

    let sourceClient
    let destinationClient
    try {
        destinationClient = await destinationPool.connect()
        const destinationIdentity = await getDatabaseIdentity(destinationClient)
        if (destinationIdentity.database_name !== LOCAL_DATABASE_NAME) {
            throw mirrorError('MIRROR_DESTINATION_UNSAFE', `O destino deve ser ${LOCAL_DATABASE_NAME}.`)
        }

        sourceClient = await sourcePool.connect()
        await sourceClient.query('begin transaction isolation level repeatable read read only')
        const sourceIdentity = await assertSourceReadOnly(sourceClient)
        if (sourceIdentity.database_name === destinationIdentity.database_name && sourceIdentity.server_address === destinationIdentity.server_address) {
            throw mirrorError('MIRROR_SOURCE_EQUALS_DESTINATION', 'A origem resolve para o mesmo banco do clone local.')
        }
        const snapshot = await readSourceSnapshot(sourceClient)
        await sourceClient.query('commit')

        const rowCounts = Object.fromEntries(MIRROR_TABLES.map((table) => [table, snapshot.tables[table].rows.length]))
        const report = {
            dryRun,
            sourceFingerprint: buildFingerprint(sourceIdentity),
            rowCounts,
            attendances: rowCounts.attendances,
            minServiceDate: snapshot.range.min_service_date || null,
            maxServiceDate: snapshot.range.max_service_date || null,
        }
        if (dryRun) return report

        if (typeof migrateDestination !== 'function') {
            throw mirrorError('MIRROR_DESTINATION_MIGRATION_MISSING', 'Migração do destino local não foi configurada.')
        }
        const backupPath = await backupDestination(destinationUrl)
        await destinationClient.query('begin')
        try {
            await migrateDestination(destinationClient)
            await ensureAtendimentoMirrorMetadata(destinationClient)
            await destinationClient.query(`truncate table ${MIRROR_TABLES.map(qualifiedTable).join(', ')} restart identity cascade`)
            for (const table of MIRROR_TABLES) {
                const snapshotTable = snapshot.tables[table]
                await insertRows(destinationClient, table, snapshotTable.columns, snapshotTable.rows)
            }
            await destinationClient.query(`insert into crm_atendimento.local_mirror_state (
                singleton, mode, source_fingerprint, synced_at, row_counts, min_service_date, max_service_date, backup_path, updated_at
            ) values (true, 'local-sandbox', $1, now(), $2::jsonb, $3::date, $4::date, $5, now())
            on conflict (singleton) do update set
                mode = excluded.mode,
                source_fingerprint = excluded.source_fingerprint,
                synced_at = excluded.synced_at,
                row_counts = excluded.row_counts,
                min_service_date = excluded.min_service_date,
                max_service_date = excluded.max_service_date,
                backup_path = excluded.backup_path,
                updated_at = excluded.updated_at`, [report.sourceFingerprint, JSON.stringify(rowCounts), report.minServiceDate, report.maxServiceDate, backupPath])
            await destinationClient.query('commit')
        } catch (error) {
            try { await destinationClient.query('rollback') } catch { /* ignore */ }
            throw error
        }
        return { ...report, backupPath }
    } catch (error) {
        if (sourceClient) {
            try { await sourceClient.query('rollback') } catch { /* ignore */ }
        }
        throw error
    } finally {
        sourceClient?.release()
        destinationClient?.release()
        await Promise.allSettled([sourcePool.end(), destinationPool.end()])
    }
}

export const __testables = {
    DEFAULT_CRM_RUNTIME_HOME,
    connectionFingerprint,
    isLocalMirrorDestination,
    parsePostgresConnection,
}
