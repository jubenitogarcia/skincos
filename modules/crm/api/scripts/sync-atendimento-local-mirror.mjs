#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'

import { createPgPool } from '../server/harmonia/store/pg.js'
import { readAtendimentoSheet, readGerenciaSheet } from '../server/atendimento/importer.js'
import {
    backupAtendimentoMirror,
    ensureAtendimentoMirrorMetadata,
    getAtendimentoMirrorStatus,
    isLocalMirrorDestination,
    MIRROR_TABLES,
    restoreAtendimentoMirror,
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
const runtimeHome = String(process.env.CRM_RUNTIME_HOME || '/mnt/c/CodexRuntime/crm-api').trim()

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
    const serviceAccount = JSON.parse(await fs.readFile(googleServiceAccountFile, 'utf8'))
    const identity = [
        String(serviceAccount.client_email || ''),
        atendimentoSheet.spreadsheetId,
        gerenciaSheet.spreadsheetId,
    ].join('|')
    return createHash('sha256').update(identity).digest('hex').slice(0, 16)
}

async function syncGoogleSheets({ dryRun }) {
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

    const pool = createPgPool(destinationUrl)
    if (!pool) throw new Error('DATABASE_URL não está configurada.')
    let poolClosed = false
    const store = createAtendimentoStore({ pool })
    const actor = {
        id: 'local-mirror-sync',
        username: 'local-mirror-sync',
        role: 'GESTOR',
        allowedModules: ['atendimento'],
    }
    const range = isoDateRange(atendimentoSheet.records)
    const report = {
        dryRun,
        sourceMode,
        sourceFingerprint,
        rowCounts: {
            attendances: atendimentoSheet.records.length,
            procedures: atendimentoSheet.cache?.procedures?.length || 0,
            professionals: atendimentoSheet.cache?.professionals?.length || 0,
            raw_sheet_rows: gerenciaSheet.rawRows.length,
            management_items: gerenciaSheet.managementItems.length,
            inventory_items: gerenciaSheet.inventory.length,
            monthly_goals: gerenciaSheet.monthlyGoals.length,
            monthly_goal_levels: gerenciaSheet.monthlyGoalLevels.length,
        },
        attendances: atendimentoSheet.records.length,
        ...range,
    }

    try {
        await store.importRecords({ records: atendimentoSheet.records, cache: atendimentoSheet.cache, actor, dryRun: true })
        await store.importGerenciaWorkbook({ workbook: gerenciaSheet, actor, dryRun: true })
        if (dryRun) return report

        const backupPath = await backupAtendimentoMirror(destinationUrl, runtimeHome)
        try {
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
            await pool.end()
            poolClosed = true
            await restoreAtendimentoMirror(destinationUrl, backupPath)
            error.message = `${error.message} O clone anterior foi restaurado.`
            throw error
        }
    } finally {
        if (!poolClosed) await pool.end()
    }
}

async function main() {
    if (args.has('--status')) {
        const pool = createPgPool(destinationUrl)
        if (!pool) throw new Error('DATABASE_URL não está configurada.')
        try {
            const client = await pool.connect()
            try {
                await client.query('begin')
                await migrateAtendimento(client)
                await client.query('commit')
            } catch (error) {
                try { await client.query('rollback') } catch { /* ignore */ }
                throw error
            } finally {
                client.release()
            }
            print({ ok: true, ...(await getAtendimentoMirrorStatus(pool)) })
        } finally {
            await pool.end()
        }
        return
    }

    const useGoogleSheets = ['google-sheets-live', 'google-sheets-snapshot'].includes(sourceMode) || (!!atendimentoWorkbook && !!gerenciaWorkbook)
    const result = useGoogleSheets
        ? await syncGoogleSheets({ dryRun: !args.has('--apply') })
        : await syncAtendimentoMirror({
            sourceUrl,
            destinationUrl,
            dryRun: !args.has('--apply'),
            migrateDestination: migrateAtendimento,
        })
    print({ ok: true, ...result })
}

main().catch((error) => {
    const code = String(error?.code || error?.message || 'MIRROR_FAILED')
    process.stderr.write(JSON.stringify({ ok: false, error: code, message: String(error?.message || code) }) + '\n')
    process.exitCode = 1
})
