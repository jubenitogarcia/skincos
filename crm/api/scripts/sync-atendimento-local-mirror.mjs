#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'

import { createPgPool } from '../server/harmonia/store/pg.js'
import { readAtendimentoSheet, readGerenciaSheet } from '../server/atendimento/importer.js'
import {
    acquireAtendimentoMirrorSyncLock,
    backupAtendimentoMirror,
    DEFAULT_CRM_RUNTIME_HOME,
    ensureAtendimentoMirrorMetadata,
    getAtendimentoMirrorStatus,
    isLocalMirrorDestination,
    isStrictLocalMirrorDestination,
    MIRROR_TABLES,
    preflightAtendimentoMirror,
    restoreAtendimentoMirror,
    releaseAtendimentoMirrorSyncLock,
    syncAtendimentoMirror,
} from '../server/atendimento/mirror.js'
import { createAtendimentoStore, migrateAtendimento } from '../server/atendimento/store.js'

const args = new Set(process.argv.slice(2))
const sourceUrl = String(process.env.ATENDIMENTO_SOURCE_DATABASE_URL || '').trim()
const destinationUrl = String(process.env.DATABASE_URL || '').trim()
const sourceMode = String(process.env.ATENDIMENTO_SOURCE_MODE || '').trim().toLowerCase()
const atendimentoWorkbook = String(process.env.ATENDIMENTO_GOOGLE_XLSX_FILE || '').trim()
const gerenciaWorkbook = String(process.env.GERENCIA_GOOGLE_XLSX_FILE || '').trim()
const googleServiceAccountFile = String(process.env.ATENDIMENTO_GOOGLE_SA_FILE || '').trim()
const runtimeHome = String(process.env.CRM_RUNTIME_HOME || DEFAULT_CRM_RUNTIME_HOME).trim()

function print(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function fingerprintFiles(paths) {
    const hash = createHash('sha256')
    for (const filePath of paths) {
        const stat = await fs.stat(filePath)
        if (!stat.isFile()) throw new Error(`Arquivo de origem inválido: ${filePath}`)
        hash.update(await fs.readFile(filePath))
    }
    return hash.digest('hex').slice(0, 16)
}

function isoDateRange(records) {
    const dates = records.map((record) => String(record.date || '')).filter(Boolean).sort()
    return {
        minServiceDate: dates[0] || null,
        maxServiceDate: dates.at(-1) || null,
    }
}

async function fingerprintGoogleSource({ atendimentoSheet, gerenciaSheet, useSnapshots }) {
    if (useSnapshots) return fingerprintFiles([atendimentoWorkbook, gerenciaWorkbook])
    const canonicalize = (value) => {
        if (value instanceof Date) return value.toISOString()
        if (Array.isArray(value)) return value.map(canonicalize)
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
                if (key === 'importedAt' || key === 'imported_at') return []
                return [[key, canonicalize(value[key])]]
            }))
        }
        return value
    }
    const sourcePayload = canonicalize({
        atendimento: atendimentoSheet,
        gerencia: gerenciaSheet,
    })
    return createHash('sha256').update(JSON.stringify(sourcePayload)).digest('hex').slice(0, 16)
}

function buildGoogleSourceReport({ atendimentoSheet, gerenciaSheet, sourceFingerprint, preflight = false, dryRun }) {
    const range = isoDateRange(atendimentoSheet.records)
    const rowCounts = {
        attendances: atendimentoSheet.records.length,
        procedures: atendimentoSheet.cache?.procedures?.length || 0,
        professionals: atendimentoSheet.cache?.professionals?.length || 0,
        raw_sheet_rows: gerenciaSheet.rawRows.length,
        management_items: gerenciaSheet.managementItems.length,
        inventory_items: gerenciaSheet.inventory.length,
        monthly_goals: gerenciaSheet.monthlyGoals.length,
        monthly_goal_levels: gerenciaSheet.monthlyGoalLevels.length,
    }
    return {
        preflight,
        dryRun,
        sourceMode,
        sourceFingerprint,
        rowCounts,
        attendances: atendimentoSheet.records.length,
        ...range,
        sourceFreshness: {
            observedAt: new Date().toISOString(),
            latestSourceUpdateAt: null,
            ...range,
        },
    }
}

async function readGoogleSheetsSource() {
    if (!isLocalMirrorDestination(destinationUrl)) {
        throw new Error('O destino deve ser o banco local skincos_crm_local.')
    }
    const useSnapshots = sourceMode === 'google-sheets-snapshot'
    if (useSnapshots && (!atendimentoWorkbook || !gerenciaWorkbook)) {
        throw new Error('ATENDIMENTO_GOOGLE_XLSX_FILE e GERENCIA_GOOGLE_XLSX_FILE são obrigatórios para o modo google-sheets-snapshot.')
    }
    if (!useSnapshots && !googleServiceAccountFile) {
        throw new Error('ATENDIMENTO_GOOGLE_SA_FILE é obrigatório para o modo google-sheets-live.')
    }

    const [atendimentoSheet, gerenciaSheet] = await Promise.all([
        readAtendimentoSheet({ workbookFile: useSnapshots ? atendimentoWorkbook : '', serviceAccountFile: googleServiceAccountFile }),
        readGerenciaSheet({ workbookFile: useSnapshots ? gerenciaWorkbook : '', serviceAccountFile: googleServiceAccountFile }),
    ])
    const sourceFingerprint = await fingerprintGoogleSource({ atendimentoSheet, gerenciaSheet, useSnapshots })
    if (!atendimentoSheet.records.length) {
        throw new Error('A planilha histórica não contém atendimentos; o clone local não foi alterado.')
    }

    return {
        atendimentoSheet,
        gerenciaSheet,
        sourceFingerprint,
    }
}

async function assertGoogleSheetsDestinationReadOnly({ forMutation = false } = {}) {
    if (!(forMutation ? isStrictLocalMirrorDestination(destinationUrl) : isLocalMirrorDestination(destinationUrl))) {
        throw new Error('O destino deve ser o banco local skincos_crm_local.')
    }
    const pool = createPgPool(destinationUrl)
    if (!pool) throw new Error('DATABASE_URL não está configurada.')
    let client
    try {
        client = await pool.connect()
        await client.query('begin read only')
        const identity = await client.query(`select current_database() as database_name,
            current_setting('transaction_read_only') as transaction_read_only`)
        await client.query('commit')
        const row = identity.rows[0] || {}
        if (row.database_name !== 'skincos_crm_local' || String(row.transaction_read_only).toLowerCase() !== 'on') {
            throw new Error('O destino local não confirmou uma transação somente leitura.')
        }
    } catch (error) {
        try { await client?.query('rollback') } catch { /* ignore */ }
        throw error
    } finally {
        client?.release()
        await pool.end()
    }
}

async function syncGoogleSheets({ dryRun }) {
    const { atendimentoSheet, gerenciaSheet, sourceFingerprint } = await readGoogleSheetsSource()
    const report = buildGoogleSourceReport({ atendimentoSheet, gerenciaSheet, sourceFingerprint, dryRun })
    if (dryRun) {
        await assertGoogleSheetsDestinationReadOnly()
        return report
    }

    await assertGoogleSheetsDestinationReadOnly({ forMutation: true })
    const pool = createPgPool(destinationUrl)
    if (!pool) throw new Error('DATABASE_URL não está configurada.')
    const store = createAtendimentoStore({ pool })
    const actor = {
        id: 'local-mirror-sync',
        username: 'local-mirror-sync',
        role: 'GESTOR',
        allowedModules: ['atendimento'],
    }

    let lockClient
    let lockAcquired = false
    let backupPath
    try {
        // Hold one session-level lock from the checkpoint through the restore
        // path. Import helpers can use the pool normally while another mirror
        // process receives a deterministic MIRROR_SYNC_IN_PROGRESS response.
        lockClient = await pool.connect()
        await acquireAtendimentoMirrorSyncLock(lockClient)
        lockAcquired = true
        backupPath = await backupAtendimentoMirror(destinationUrl, runtimeHome)
        // Validate both imports only after the checkpoint exists. The store bootstrap can
        // perform legacy local schema setup, so it must never be reached by --dry-run.
        await store.importRecords({ records: atendimentoSheet.records, cache: atendimentoSheet.cache, actor, dryRun: true })
        await store.importGerenciaWorkbook({ workbook: gerenciaSheet, actor, dryRun: true })
        const mirrorTables = MIRROR_TABLES.map((table) => `crm_atendimento."${table}"`).join(', ')
        await pool.query(`truncate table ${mirrorTables} restart identity cascade`)
        const attendanceResult = await store.importRecords({
            records: atendimentoSheet.records,
            cache: atendimentoSheet.cache,
            actor,
            dryRun: false,
        })
        await store.importGerenciaWorkbook({ workbook: gerenciaSheet, actor, dryRun: false })
        const client = await pool.connect()
        try {
            await client.query('begin')
            await ensureAtendimentoMirrorMetadata(client)
            await client.query(`insert into crm_atendimento.local_mirror_state (
                singleton, mode, source_fingerprint, synced_at, row_counts,
                min_service_date, max_service_date, backup_path, updated_at
            ) values (true, $6, $1, now(), $2::jsonb, $3::date, $4::date, $5, now())
            on conflict (singleton) do update set
                mode = excluded.mode,
                source_fingerprint = excluded.source_fingerprint,
                synced_at = excluded.synced_at,
                row_counts = excluded.row_counts,
                min_service_date = excluded.min_service_date,
                max_service_date = excluded.max_service_date,
                backup_path = excluded.backup_path,
                updated_at = excluded.updated_at`, [
                sourceFingerprint,
                JSON.stringify(report.rowCounts),
                report.minServiceDate,
                report.maxServiceDate,
                backupPath,
                sourceMode,
            ])
            await client.query('commit')
        } catch (error) {
            try { await client.query('rollback') } catch { /* ignore */ }
            throw error
        } finally {
            client.release()
        }
        return { ...report, backupPath, attendanceResult }
    } catch (error) {
        if (backupPath) {
            await restoreAtendimentoMirror(destinationUrl, backupPath)
            error.message = `${error.message} O clone anterior foi restaurado.`
        }
        throw error
    } finally {
        if (lockAcquired) await releaseAtendimentoMirrorSyncLock(lockClient)
        lockClient?.release()
        await pool.end()
    }
}

async function preflightGoogleSheets() {
    const { atendimentoSheet, gerenciaSheet, sourceFingerprint } = await readGoogleSheetsSource()
    await assertGoogleSheetsDestinationReadOnly()
    return buildGoogleSourceReport({
        atendimentoSheet,
        gerenciaSheet,
        sourceFingerprint,
        preflight: true,
        dryRun: true,
    })
}

async function main() {
    const selectedModes = ['--status', '--preflight', '--dry-run', '--apply'].filter((flag) => args.has(flag))
    if (selectedModes.length > 1) throw new Error('Use apenas um modo: --status, --preflight, --dry-run ou --apply.')
    const mode = selectedModes[0] || '--dry-run'

    if (mode === '--status') {
        const pool = createPgPool(destinationUrl)
        if (!pool) throw new Error('DATABASE_URL não está configurada.')
        try {
            print({ ok: true, ...(await getAtendimentoMirrorStatus(pool)) })
        } finally {
            await pool.end()
        }
        return
    }

    const useGoogleSheets = ['google-sheets-live', 'google-sheets-snapshot'].includes(sourceMode) || (!!atendimentoWorkbook && !!gerenciaWorkbook)
    if (mode === '--preflight') {
        const result = useGoogleSheets
            ? await preflightGoogleSheets()
            : await preflightAtendimentoMirror({ sourceUrl, destinationUrl })
        print({ ok: true, ...result })
        return
    }
    const result = useGoogleSheets
        ? await syncGoogleSheets({ dryRun: mode !== '--apply' })
        : await syncAtendimentoMirror({
            sourceUrl,
            destinationUrl,
            dryRun: mode !== '--apply',
            migrateDestination: migrateAtendimento,
        })
    print({ ok: true, ...result })
}

main().catch((error) => {
    const code = String(error?.code || error?.message || 'MIRROR_FAILED')
    process.stderr.write(JSON.stringify({ ok: false, error: code, message: String(error?.message || code) }) + '\n')
    process.exitCode = 1
})
