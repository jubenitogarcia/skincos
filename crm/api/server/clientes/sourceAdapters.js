import { createHash } from 'node:crypto'
import path from 'node:path'

import { readAtendimentoSheet, readGerenciaSheet } from '../atendimento/importer.js'
import { GERENCIA_SOURCE_SHEET_ID, SOURCE_SHEET_ID } from '../atendimento/domain.js'
import { createAtendimentoStore, migrateAtendimento } from '../atendimento/store.js'
import { backupAtendimentoMirror, preflightAtendimentoMirror, restoreAtendimentoMirror, syncAtendimentoMirror } from '../atendimento/mirror.js'
import { createCaixaStore } from '../caixa/store.js'
import { CAIXA_SOURCE_SHEET_ID, CAIXA_TABS } from '../caixa/domain.js'
import { buildSupplementalLeadProfiles } from '../atendimento/supplementalLeadIdentity.js'
import { fingerprintSource } from './sourceOperations.js'
import { backupDatabaseTarget, restoreDatabaseTarget } from './sourceBackup.js'

function sourceError(code, retryable = true) {
    const error = new Error(code)
    error.code = code
    error.retryable = retryable
    return error
}

function requireDatabaseUrl(databaseUrl) {
    const value = String(databaseUrl || '').trim()
    if (!value) throw sourceError('SOURCE_DATABASE_URL_MISSING', false)
    return value
}

function sourceConfigFromEnv(prefix) {
    return {
        spreadsheetId: process.env[`${prefix}_GOOGLE_SHEET_ID`] || undefined,
        serviceAccountFile: process.env.ATENDIMENTO_GOOGLE_SA_FILE || process.env.HARMONIA_GOOGLE_SA_FILE || undefined,
        workbookFile: process.env[`${prefix}_GOOGLE_XLSX_FILE`] || undefined,
    }
}

function assertGoogleConfiguration(config, spreadsheetId) {
    if (!spreadsheetId && !config.workbookFile) throw sourceError('SOURCE_GOOGLE_SHEET_NOT_CONFIGURED', false)
    if (!config.workbookFile && !config.serviceAccountFile) throw sourceError('SOURCE_GOOGLE_SERVICE_ACCOUNT_NOT_CONFIGURED', false)
}

function maxDate(records = []) {
    const values = records.map((record) => String(record?.date || record?.occurred_on || '').trim()).filter(Boolean).sort()
    return values.at(-1) || null
}

function rowCount(records) {
    return Array.isArray(records) ? records.length : 0
}

function normalizedTab(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

const GERENCIA_REQUIRED_TABS = ['equipe', 'horario', 'procedimento']
const LEADS_REQUIRED_TABS = ['lead']

function aggregateFingerprint(sourceId, aggregate) {
    return fingerprintSource({ sourceId, aggregate })
}

function databaseBackup({ databaseUrl, target, sourceId }) {
    return backupDatabaseTarget({ databaseUrl, target, sourceId })
}

function assertLocalMirrorBackupReference(backupRef) {
    const root = path.resolve(path.join(process.env.CRM_RUNTIME_HOME || '/var/lib/skincos-runtime/crm', 'backups', 'atendimento'))
    const candidate = path.resolve(String(backupRef || ''))
    if (!candidate.toLowerCase().endsWith('.dump') || (candidate !== root && !candidate.startsWith(`${root}${path.sep}`))) throw sourceError('SOURCE_ROLLBACK_PATH_UNSAFE', false)
    return candidate
}

export function createClientesSourceAdapters({ pool, databaseUrl, target = 'local', config = {}, readers = {} } = {}) {
    const destinationUrl = requireDatabaseUrl(databaseUrl)
    const atendimentoStore = createAtendimentoStore({ pool, databaseUrl: destinationUrl, schemaManaged: true })
    const caixaStore = createCaixaStore({ pool, databaseUrl: destinationUrl })
    const readAtendimento = readers.readAtendimento || ((options) => readAtendimentoSheet(options))
    const readGerencia = readers.readGerencia || ((options) => readGerenciaSheet(options))
    // Keep Google APIs lazy: the source process can run on a database-only
    // installation and unit tests must not initialize provider clients.
    const readCaixa = readers.readCaixa || (async (options) => {
        const { readCaixaGoogleSheet } = await import('../caixa/importer.js')
        return readCaixaGoogleSheet(options)
    })
    const readLeads = readers.readLeads || null

    const atendimentoConfig = {
        ...sourceConfigFromEnv('ATENDIMENTO'),
        spreadsheetId: process.env.ATENDIMENTO_GOOGLE_SHEET_ID || SOURCE_SHEET_ID,
        ...(config.atendimento || {}),
    }
    const gerenciaConfig = {
        ...sourceConfigFromEnv('GERENCIA'),
        spreadsheetId: process.env.GERENCIA_GOOGLE_SHEET_ID || GERENCIA_SOURCE_SHEET_ID,
        ...(config.gerencia || {}),
    }
    const caixaConfig = {
        ...sourceConfigFromEnv('CAIXA'),
        spreadsheetId: process.env.CAIXA_GOOGLE_SHEET_ID || CAIXA_SOURCE_SHEET_ID,
        ...(config.caixa || {}),
    }
    const leadsConfig = {
        spreadsheetId: process.env.SUPPLEMENTAL_LEADS_GOOGLE_SHEET_ID || undefined,
        serviceAccountFile: process.env.ATENDIMENTO_GOOGLE_SA_FILE || process.env.HARMONIA_GOOGLE_SA_FILE || undefined,
        ...(config.leads || {}),
    }

    const backup = ({ source }) => databaseBackup({ databaseUrl: destinationUrl, target, sourceId: source.id })
    const restore = ({ backupRef }) => restoreDatabaseTarget({ databaseUrl: destinationUrl, target, backupRef })

    return {
        'atendimento.local_mirror': {
            async read() {
                const sourceUrl = String(process.env.ATENDIMENTO_SOURCE_DATABASE_URL || config.sourceUrl || '').trim()
                if (!sourceUrl) throw sourceError('SOURCE_MIRROR_URL_NOT_CONFIGURED', false)
                const report = await preflightAtendimentoMirror({ sourceUrl, destinationUrl })
                return {
                    snapshotComplete: report.snapshotComplete === true,
                    watermark: report.sourceFreshness?.latestSourceUpdateAt || report.sourceFreshness?.maxServiceDate || new Date().toISOString(),
                    fingerprint: fingerprintSource({ sourceFingerprint: report.sourceFingerprint, rowCounts: report.rowCounts, range: { min: report.minServiceDate, max: report.maxServiceDate } }),
                    recordsRead: report.attendances,
                    coverage: { tables: report.rowCounts, proof: report.snapshotProof },
                    snapshot: report,
                }
            },
            async backup() {
                if (target === 'local') return backupAtendimentoMirror(destinationUrl)
                return backup({ source: { id: 'atendimento.local_mirror' } })
            },
            async apply({ observation }) {
                const sourceUrl = String(process.env.ATENDIMENTO_SOURCE_DATABASE_URL || config.sourceUrl || '').trim()
                const report = await syncAtendimentoMirror({
                    sourceUrl,
                    destinationUrl,
                    dryRun: false,
                    migrateDestination: (client) => migrateAtendimento(client),
                    backupDestination: async () => observation.backupRef,
                })
                return { recordsApplied: Object.values(report.rowCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0) }
            },
            async rollback({ backupRef }) {
                if (target === 'local') return restoreAtendimentoMirror(destinationUrl, assertLocalMirrorBackupReference(backupRef))
                return restore({ backupRef })
            },
        },
        'atendimento.google_sheet': {
            async read() {
                assertGoogleConfiguration(atendimentoConfig, atendimentoConfig.spreadsheetId)
                const sheet = await readAtendimento({ ...atendimentoConfig })
                const complete = sheet.tabs?.length === 2 && rowCount(sheet.records) > 0
                return {
                    snapshotComplete: complete,
                    watermark: maxDate(sheet.records) || new Date().toISOString(),
                    fingerprint: fingerprintSource({ spreadsheetId: sheet.spreadsheetId, tabs: sheet.tabs, records: sheet.records, cache: sheet.cache }),
                    recordsRead: rowCount(sheet.records),
                    coverage: { tabs: sheet.tabs || [], records: rowCount(sheet.records), procedures: rowCount(sheet.cache?.procedures), professionals: rowCount(sheet.cache?.professionals), proof: { kind: 'operational_tabs_and_records', requiredTabs: ['Novo Hamburgo', 'BarraShoppingSul'], tabsPresent: sheet.tabs || [], recordsPresent: rowCount(sheet.records) > 0 } },
                    snapshot: sheet,
                }
            },
            backup,
            async apply({ observation }) {
                const result = await atendimentoStore.importRecords({
                    records: observation.snapshot.records,
                    cache: observation.snapshot.cache,
                    actor: { id: 'clientes-source-operations', role: 'ADMIN', allowedModules: ['atendimento'] },
                    dryRun: false,
                    source: { sourceSheetId: observation.snapshot.spreadsheetId, sourceName: 'Atendimento', tabs: observation.snapshot.tabs, snapshotComplete: true },
                })
                return { recordsApplied: Number(result.inserted || 0) + Number(result.updated || 0) }
            },
            rollback: restore,
        },
        'cadastro.gerencia_google_sheet': {
            async read() {
                assertGoogleConfiguration(gerenciaConfig, gerenciaConfig.spreadsheetId)
                const workbook = await readGerencia({ ...gerenciaConfig })
                const tabNames = (workbook.tabs || []).map((tab) => normalizedTab(tab.tabName))
                const missingTabs = GERENCIA_REQUIRED_TABS.filter((tab) => !tabNames.includes(tab))
                const complete = missingTabs.length === 0 && rowCount(workbook.rawRows) > 0
                return {
                    snapshotComplete: complete,
                    watermark: new Date().toISOString(),
                    fingerprint: fingerprintSource(workbook),
                    recordsRead: rowCount(workbook.rawRows) + rowCount(workbook.managementItems),
                    coverage: { tabs: workbook.tabs.map((tab) => tab.tabName), rawRows: rowCount(workbook.rawRows), managementItems: rowCount(workbook.managementItems), inventory: rowCount(workbook.inventory), proof: { kind: 'required_gerencia_tabs_and_rows', requiredTabs: GERENCIA_REQUIRED_TABS, missingTabs, rowsPresent: rowCount(workbook.rawRows) > 0 } },
                    snapshot: workbook,
                }
            },
            backup,
            async apply({ observation }) {
                const result = await atendimentoStore.importGerenciaWorkbook({
                    workbook: observation.snapshot,
                    actor: { id: 'clientes-source-operations', role: 'ADMIN', allowedModules: ['atendimento'] },
                    dryRun: false,
                })
                return { recordsApplied: Number(result.inserted || 0) + Number(result.updated || 0) }
            },
            rollback: restore,
        },
        'vendas.caixa_google_sheet': {
            async read() {
                assertGoogleConfiguration(caixaConfig, caixaConfig.spreadsheetId)
                const sheet = await readCaixa({ spreadsheetId: caixaConfig.spreadsheetId, ...caixaConfig })
                const tabsComplete = CAIXA_TABS.every((tab) => sheet.tabs.includes(tab))
                const complete = tabsComplete && rowCount(sheet.records) > 0
                return {
                    snapshotComplete: complete,
                    watermark: maxDate(sheet.records) || new Date().toISOString(),
                    fingerprint: fingerprintSource(sheet),
                    recordsRead: rowCount(sheet.records),
                    coverage: { tabs: sheet.tabs || [], records: rowCount(sheet.records), tabsComplete, proof: { kind: 'all_caixa_operational_tabs', requiredTabs: CAIXA_TABS, tabsPresent: sheet.tabs || [], rowsPresent: rowCount(sheet.records) > 0 } },
                    snapshot: sheet,
                }
            },
            backup,
            async apply({ observation }) {
                const result = await caixaStore.importRecords({
                    records: observation.snapshot.records,
                    sourceSheetId: observation.snapshot.spreadsheetId,
                    actor: { id: 'clientes-source-operations', role: 'ADMIN', allowedModules: ['caixa'] },
                    dryRun: false,
                })
                return { recordsApplied: Number(result.inserted || 0) + Number(result.updated || 0) }
            },
            rollback: restore,
        },
        'cadastro.app_registrations': {
            async read() {
                const result = await pool.query(`select count(*)::int as records, max(updated_at) as last_updated from crm_atendimento.app_client_registrations`)
                const row = result.rows[0] || {}
                const parsed = row.last_updated ? new Date(row.last_updated) : null
                const aggregate = { records: Number(row.records || 0), lastUpdated: parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null }
                return { snapshotComplete: true, watermark: aggregate.lastUpdated || new Date().toISOString(), fingerprint: aggregateFingerprint('cadastro.app_registrations', aggregate), recordsRead: aggregate.records, coverage: { ...aggregate, proof: { kind: 'single_table_aggregate', table: 'crm_atendimento.app_client_registrations' } }, snapshot: aggregate }
            },
        },
        'leads.supplemental_google_sheet': {
            async read() {
                assertGoogleConfiguration(leadsConfig, leadsConfig.spreadsheetId)
                if (readLeads) {
                    const supplied = await readLeads({ ...leadsConfig })
                    const tabs = supplied.tabs || {}
                    const profiles = supplied.profiles || buildSupplementalLeadProfiles({ spreadsheetId: supplied.spreadsheetId || leadsConfig.spreadsheetId, tabs })
                    const tabNames = Array.isArray(supplied.tabNames) ? supplied.tabNames : Object.keys(tabs)
                    const missingTabs = LEADS_REQUIRED_TABS.filter((required) => !tabNames.some((tab) => normalizedTab(tab) === required))
                    return {
                        snapshotComplete: missingTabs.length === 0 && profiles.length > 0,
                        watermark: supplied.watermark || new Date().toISOString(),
                        fingerprint: supplied.fingerprint || fingerprintSource({ spreadsheetId: supplied.spreadsheetId || leadsConfig.spreadsheetId, tabs }),
                        recordsRead: profiles.length,
                        coverage: { tabs: tabNames, profiles: profiles.length, proof: { kind: 'visible_lead_tabs_and_profiles', requiredTabs: LEADS_REQUIRED_TABS, missingTabs, profilesPresent: profiles.length > 0 } },
                        snapshot: { spreadsheetId: supplied.spreadsheetId || leadsConfig.spreadsheetId, tabs, profiles },
                    }
                }
                const { google } = await import('googleapis')
                const account = JSON.parse(await (await import('node:fs/promises')).readFile(leadsConfig.serviceAccountFile, 'utf8'))
                const auth = new google.auth.JWT({ email: account.client_email, key: account.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
                await auth.authorize()
                const sheets = google.sheets({ version: 'v4', auth })
                const metadata = await sheets.spreadsheets.get({ spreadsheetId: leadsConfig.spreadsheetId, fields: 'sheets(properties(title,hidden))' })
                const tabs = (metadata.data.sheets || []).filter((sheet) => !sheet.properties?.hidden).map((sheet) => sheet.properties?.title).filter(Boolean)
                const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: leadsConfig.spreadsheetId, ranges: tabs.map((tab) => `'${tab.replace(/'/g, "''")}'`), valueRenderOption: 'FORMATTED_VALUE' })
                const values = Object.fromEntries((response.data.valueRanges || []).map((range, index) => [tabs[index], range.values || []]))
                const profiles = buildSupplementalLeadProfiles({ spreadsheetId: leadsConfig.spreadsheetId, tabs: values })
                    const missingTabs = LEADS_REQUIRED_TABS.filter((required) => !tabs.some((tab) => normalizedTab(tab) === required))
                    const complete = missingTabs.length === 0 && profiles.length > 0
                return {
                    snapshotComplete: complete,
                    watermark: new Date().toISOString(),
                    fingerprint: fingerprintSource({ spreadsheetId: leadsConfig.spreadsheetId, tabs: values }),
                    recordsRead: profiles.length,
                        coverage: { tabs, rows: Object.fromEntries(Object.entries(values).map(([tab, rows]) => [tab, Math.max(0, rows.length - 1)])), profiles: profiles.length, proof: { kind: 'visible_lead_tabs_and_profiles', requiredTabs: LEADS_REQUIRED_TABS, missingTabs, profilesPresent: profiles.length > 0 } },
                    snapshot: { spreadsheetId: leadsConfig.spreadsheetId, tabs: values, profiles },
                }
            },
            backup,
            async apply({ observation }) {
                const client = await pool.connect()
                try {
                    await client.query('begin')
                    const run = await client.query(`insert into crm_atendimento.supplemental_lead_import_runs(source_sheet_id,summary) values($1,$2::jsonb) returning id`, [observation.snapshot.spreadsheetId, JSON.stringify({ profiles: observation.snapshot.profiles.length, sourceOperations: true })])
                    for (const profile of observation.snapshot.profiles) {
                        await client.query(`insert into crm_atendimento.supplemental_lead_profiles(source_profile_id,source_sheet_id,source_rows,canonical_name,name_key,name_variants,phone_keys,email_keys,unit_slugs,birthdays,last_run_id)
                            values($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11)
                            on conflict(source_profile_id) do update set source_rows=excluded.source_rows,canonical_name=excluded.canonical_name,name_key=excluded.name_key,name_variants=excluded.name_variants,phone_keys=excluded.phone_keys,email_keys=excluded.email_keys,unit_slugs=excluded.unit_slugs,birthdays=excluded.birthdays,last_run_id=excluded.last_run_id,updated_at=now()`, [profile.id, observation.snapshot.spreadsheetId, JSON.stringify(profile.sourceRows || []), profile.name, profile.nameKey, JSON.stringify(profile.names || []), JSON.stringify(profile.phones || []), JSON.stringify(profile.emails || []), JSON.stringify(profile.units || []), JSON.stringify(profile.birthdays || []), run.rows[0].id])
                    }
                    await client.query('commit')
                    return { recordsApplied: observation.snapshot.profiles.length }
                } catch (error) {
                    try { await client.query('rollback') } catch { /* preserve original error */ }
                    throw error
                } finally { client.release() }
            },
            rollback: restore,
        },
        'consent.harmonia_opt_outs': createAggregateAdapter(pool, `select count(*)::int as records, count(*) filter(where opted_out_at is not null)::int as opted_out, max(updated_at) as last_updated from harmonia.contacts`, 'consent.harmonia_opt_outs'),
        'blocks.commercial_permissions': createAggregateAdapter(pool, `select count(*)::int as records, count(*) filter(where status='blocked')::int as blocked, max(updated_at) as last_updated from crm_atendimento.commercial_contact_permissions`, 'blocks.commercial_permissions'),
        'identity.global_graph': createAggregateAdapter(pool, `select (select count(*)::int from crm_atendimento.global_client_identities) as identities, (select count(*)::int from crm_atendimento.global_client_identity_members) as members, (select max(updated_at) from crm_atendimento.global_client_identities) as last_updated`, 'identity.global_graph'),
    }
}

function createAggregateAdapter(pool, sql, sourceId) {
    return {
        async read() {
            const result = await pool.query(sql)
            const aggregate = result.rows[0] || {}
            const parsedLastUpdated = aggregate.last_updated ? new Date(aggregate.last_updated) : null
            const lastUpdated = parsedLastUpdated && Number.isFinite(parsedLastUpdated.getTime()) ? parsedLastUpdated.toISOString() : new Date().toISOString()
            const records = Number(aggregate.records || aggregate.identities || 0)
            return {
                snapshotComplete: true,
                watermark: lastUpdated,
                fingerprint: aggregateFingerprint(sourceId, aggregate),
                recordsRead: records,
                coverage: { ...Object.fromEntries(Object.entries(aggregate).map(([key, value]) => [key, key === 'last_updated' ? value : Number(value || 0)])), proof: { kind: 'single_transaction_aggregate', fields: Object.keys(aggregate).sort() } },
                snapshot: aggregate,
            }
        },
    }
}
