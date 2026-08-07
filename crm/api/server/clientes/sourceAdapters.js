import { createHmac } from 'node:crypto'

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const EPOCH_WATERMARK = '1970-01-01T00:00:00.000Z'
// Keep potentially heavy connector dependencies out of the worker process
// until their specific allowlisted source is actually due.
const MIRROR_TABLE_COUNT = 14
const CAIXA_TAB_COUNT = 2

function adapterError(code, retryable = true) {
    const error = new Error(code)
    error.code = code
    error.retryable = retryable
    return error
}

function count(value) {
    return Array.isArray(value) ? value.length : 0
}

function maxTimestamp(values = []) {
    const parsed = values
        .map((value) => Date.parse(String(value || '')))
        .filter(Number.isFinite)
    return parsed.length ? new Date(Math.max(...parsed)).toISOString() : null
}

function canonicalizeFingerprintValue(value) {
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(canonicalizeFingerprintValue)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value)
            .sort()
            .filter((key) => value[key] !== undefined)
            .map((key) => [key, canonicalizeFingerprintValue(value[key])]))
    }
    return value
}

function hmacFingerprint(key, value) {
    const serialized = JSON.stringify(canonicalizeFingerprintValue(value)) || 'null'
    return `sha256:${createHmac('sha256', key).update(serialized).digest('hex')}`
}

function safeFingerprintKey(value) {
    const key = String(value || '')
    return key.length >= 32 ? key : null
}

function unavailable(code) {
    return {
        configured: false,
        status: 'unavailable',
        recordsRead: 0,
        divergences: 0,
        coverage: { sourceKind: 'connector', recordsPresent: 0, recordsExpected: 0, partitionsPresent: 0, partitionsExpected: 0 },
        checkpoint: {},
        errorCode: code,
    }
}

function completeSnapshot({ sourceId, key, records, partitions, expectedPartitions, watermark, snapshot, fingerprintInput = snapshot, coverage = {}, allowEmpty = false }) {
    const recordsRead = Math.max(0, Number(records) || 0)
    const observedPartitions = Math.max(0, Number(partitions) || 0)
    const expected = Math.max(0, Number(expectedPartitions) || 0)
    const validWatermark = maxTimestamp([watermark])
    const complete = Boolean(validWatermark) && observedPartitions === expected && (recordsRead > 0 || allowEmpty)
    // Fingerprints identify the source payload, not the time at which this
    // process happened to read it. A reader-derived `importedAt` must never
    // make an unchanged snapshot look new on every cadence.
    const material = { sourceId, recordsRead, observedPartitions, expected, snapshot: fingerprintInput }
    const observation = {
        status: complete ? 'complete' : 'incomplete',
        watermark: validWatermark || EPOCH_WATERMARK,
        fingerprint: hmacFingerprint(key, material),
        recordsRead,
        divergences: Number(coverage.divergences || 0),
        coverage: {
            recordsPresent: recordsRead,
            recordsExpected: recordsRead,
            partitionsPresent: observedPartitions,
            partitionsExpected: expected,
            divergences: Number(coverage.divergences || 0),
            sourceKind: String(coverage.sourceKind || 'connector'),
        },
        snapshotProof: {
            complete,
            kind: 'partition_count',
            sourceId,
            expectedRecords: recordsRead,
            observedRecords: recordsRead,
            expectedPartitions: expected,
            observedPartitions,
            scopeHash: hmacFingerprint(key, { sourceId, recordsRead, observedPartitions, expected, watermark: validWatermark || EPOCH_WATERMARK }),
        },
        checkpoint: {
            nextWatermark: validWatermark || EPOCH_WATERMARK,
            cursorHash: hmacFingerprint(key, { sourceId, watermark: validWatermark || EPOCH_WATERMARK, recordsRead }),
        },
    }
    // Snapshot payloads can be needed by an in-process, reviewed apply bridge,
    // but must not leak through JSON logs, metrics, operational views, or the
    // persistence adapter if a caller accidentally serializes this observation.
    Object.defineProperty(observation, 'snapshot', {
        value: snapshot,
        enumerable: false,
        configurable: false,
        writable: false,
    })
    return observation
}

function configuredValue(env, name) {
    return String(env?.[name] || '').trim()
}

function sourceApplyBridge(bridges, sourceId) {
    const bridge = bridges?.[sourceId]
    if (!bridge || typeof bridge !== 'object') return null
    if (typeof bridge.backup !== 'function' || typeof bridge.apply !== 'function' || typeof bridge.rollback !== 'function') return null
    return {
        backup: (context) => bridge.backup(context),
        apply: (context) => bridge.apply(context),
        rollback: (context) => bridge.rollback(context),
    }
}

function sourceAdapter({ sourceId, read, bridge }) {
    return {
        read,
        ...(bridge || {}),
    }
}

function aggregateAdapter({ sourceId, key, pool, query, select }) {
    return sourceAdapter({
        sourceId,
        async read() {
            if (!pool || typeof pool.query !== 'function') return unavailable('SOURCE_DATABASE_UNAVAILABLE')
            const result = await pool.query(query)
            const aggregate = select(result.rows[0] || {})
            const records = Math.max(0, Number(aggregate.records || 0))
            const watermark = aggregate.updatedAt || EPOCH_WATERMARK
            return completeSnapshot({
                sourceId,
                key,
                records,
                partitions: 1,
                expectedPartitions: 1,
                watermark,
                coverage: { sourceKind: 'postgresql_aggregate', divergences: Number(aggregate.divergences || 0) },
                snapshot: aggregate,
                // A zero-row aggregate is a valid, complete observation (for
                // example no opt-outs yet), unlike an empty external export.
                allowEmpty: true,
            })
        },
    })
}

function hasFingerprintConfiguration(key) {
    return key || null
}

function readerFor(readers, sourceId, fallback) {
    return typeof readers?.[sourceId] === 'function' ? readers[sourceId] : fallback
}

/**
 * Allowlisted source readers for the continuous Clientes runner. External
 * payloads are returned only as a non-enumerable in-process snapshot by the
 * operations layer; this module emits aggregate proof and HMAC fingerprints.
 *
 * Mutable adapters require an injected, reviewed bridge. There is deliberately
 * no environment-supplied command, backup path, shell, or restore program.
 */
export function createClientesSourceAdapters({
    pool,
    env = process.env,
    fingerprintKey = env.CRM_CLIENTES_SOURCE_FINGERPRINT_KEY,
    readers = {},
    bridges = {},
} = {}) {
    const key = hasFingerprintConfiguration(safeFingerprintKey(fingerprintKey))
    const fingerprintUnavailable = () => unavailable('SOURCE_FINGERPRINT_KEY_UNAVAILABLE')
    const wrapBridge = (sourceId) => sourceApplyBridge(bridges, sourceId)

    const atendimentoSheetReader = readerFor(readers, 'atendimento.google_sheet', async () => {
        const { readAtendimentoSheet } = await import('../atendimento/importer.js')
        return readAtendimentoSheet({
            spreadsheetId: configuredValue(env, 'ATENDIMENTO_GOOGLE_SHEET_ID') || undefined,
            serviceAccountFile: configuredValue(env, 'ATENDIMENTO_GOOGLE_SA_FILE') || undefined,
        })
    })
    const gerenciaReader = readerFor(readers, 'cadastro.gerencia_google_sheet', async () => {
        const { readGerenciaSheet } = await import('../atendimento/importer.js')
        return readGerenciaSheet({
            spreadsheetId: configuredValue(env, 'GERENCIA_GOOGLE_SHEET_ID') || undefined,
            serviceAccountFile: configuredValue(env, 'ATENDIMENTO_GOOGLE_SA_FILE') || undefined,
        })
    })
    const caixaReader = readerFor(readers, 'vendas.caixa_google_sheet', async () => {
        const { readCaixaGoogleSheet } = await import('../caixa/importer.js')
        return readCaixaGoogleSheet({ spreadsheetId: configuredValue(env, 'CAIXA_GOOGLE_SHEET_ID') || undefined })
    })
    const mirrorReader = readerFor(readers, 'atendimento.local_mirror', async () => {
        const sourceUrl = configuredValue(env, 'ATENDIMENTO_SOURCE_DATABASE_URL')
        const destinationUrl = configuredValue(env, 'DATABASE_URL')
        if (!sourceUrl || !destinationUrl) return null
        const { preflightAtendimentoMirror } = await import('../atendimento/mirror.js')
        return preflightAtendimentoMirror({ sourceUrl, destinationUrl })
    })

    return {
        'atendimento.local_mirror': sourceAdapter({
            sourceId: 'atendimento.local_mirror',
            bridge: wrapBridge('atendimento.local_mirror'),
            async read() {
                if (!key) return fingerprintUnavailable()
                const report = await mirrorReader()
                if (!report) return unavailable('SOURCE_MIRROR_NOT_CONFIGURED')
                const rowCounts = report.rowCounts || {}
                const records = Object.values(rowCounts).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0)
                return completeSnapshot({
                    sourceId: 'atendimento.local_mirror',
                    key,
                    records,
                    partitions: Object.keys(rowCounts).length,
                    expectedPartitions: MIRROR_TABLE_COUNT,
                    watermark: report.sourceFreshness?.latestSourceUpdateAt || report.maxServiceDate,
                    coverage: { sourceKind: 'postgresql_snapshot', divergences: 0 },
                    snapshot: report,
                })
            },
        }),
        'atendimento.google_sheet': sourceAdapter({
            sourceId: 'atendimento.google_sheet',
            bridge: wrapBridge('atendimento.google_sheet'),
            async read() {
                if (!key) return fingerprintUnavailable()
                const sheet = await atendimentoSheetReader()
                const records = count(sheet?.records)
                const tabs = Array.isArray(sheet?.tabs) ? sheet.tabs : []
                return completeSnapshot({
                    sourceId: 'atendimento.google_sheet',
                    key,
                    records,
                    partitions: tabs.length,
                    expectedPartitions: 2,
                    watermark: maxTimestamp((sheet?.records || []).map((row) => row?.date)),
                    coverage: { sourceKind: 'google_sheet', divergences: 0 },
                    snapshot: sheet,
                })
            },
        }),
        'cadastro.gerencia_google_sheet': sourceAdapter({
            sourceId: 'cadastro.gerencia_google_sheet',
            bridge: wrapBridge('cadastro.gerencia_google_sheet'),
            async read() {
                if (!key) return fingerprintUnavailable()
                const workbook = await gerenciaReader()
                const tabs = Array.isArray(workbook?.tabs) ? workbook.tabs : []
                const records = count(workbook?.rawRows)
                return completeSnapshot({
                    sourceId: 'cadastro.gerencia_google_sheet',
                    key,
                    records,
                    partitions: tabs.length,
                    expectedPartitions: tabs.length,
                    // `readGerenciaSheet` currently provides an observation
                    // timestamp, not an upstream revision. It is therefore
                    // incomplete until a connector exposes a stable source
                    // watermark rather than allowing a false fresh signal.
                    watermark: workbook?.sourceWatermark || null,
                    coverage: { sourceKind: 'google_sheet', divergences: 0 },
                    fingerprintInput: {
                        tabs: workbook?.tabs,
                        rawRows: workbook?.rawRows,
                        procedures: workbook?.procedures,
                        schedules: workbook?.schedules,
                    },
                    snapshot: workbook,
                })
            },
        }),
        'vendas.caixa_google_sheet': sourceAdapter({
            sourceId: 'vendas.caixa_google_sheet',
            bridge: wrapBridge('vendas.caixa_google_sheet'),
            async read() {
                if (!key) return fingerprintUnavailable()
                const sheet = await caixaReader()
                const records = count(sheet?.records)
                const tabs = Array.isArray(sheet?.tabs) ? sheet.tabs : []
                return completeSnapshot({
                    sourceId: 'vendas.caixa_google_sheet',
                    key,
                    records,
                    partitions: tabs.length,
                    expectedPartitions: CAIXA_TAB_COUNT,
                    watermark: maxTimestamp((sheet?.records || []).map((row) => row?.date || row?.soldAt || row?.createdAt)),
                    coverage: { sourceKind: 'google_sheet', divergences: 0 },
                    snapshot: sheet,
                })
            },
        }),
        // The application registration dataset is currently materialized from
        // a one-off import, not a connector. Treat it as unavailable instead
        // of falsely declaring that materialization a fresh source snapshot.
        'cadastro.app_registrations': sourceAdapter({
            sourceId: 'cadastro.app_registrations',
            async read() { return unavailable('SOURCE_APP_REGISTRATION_CONNECTOR_UNAVAILABLE') },
        }),
        'leads.supplemental_google_sheet': sourceAdapter({
            sourceId: 'leads.supplemental_google_sheet',
            async read() {
                if (!key) return fingerprintUnavailable()
                const read = readers['leads.supplemental_google_sheet']
                if (typeof read !== 'function') return unavailable('SOURCE_SUPPLEMENTAL_LEADS_CONNECTOR_UNAVAILABLE')
                const sheet = await read()
                const records = count(sheet?.records)
                const partitions = Number(sheet?.partitions || 0)
                return completeSnapshot({
                    sourceId: 'leads.supplemental_google_sheet',
                    key,
                    records,
                    partitions,
                    expectedPartitions: Number(sheet?.expectedPartitions || partitions),
                    watermark: sheet?.watermark,
                    coverage: { sourceKind: 'google_sheet', divergences: Number(sheet?.divergences || 0) },
                    snapshot: sheet,
                })
            },
        }),
        'consent.harmonia_opt_outs': key ? aggregateAdapter({
            sourceId: 'consent.harmonia_opt_outs',
            key,
            pool,
            query: `select count(*)::int as records, max(updated_at)::text as updated_at
                from harmonia.contacts where opted_out_at is not null`,
            select: (row) => ({ records: Number(row.records || 0), updatedAt: row.updated_at || EPOCH_WATERMARK }),
        }) : sourceAdapter({ sourceId: 'consent.harmonia_opt_outs', async read() { return fingerprintUnavailable() } }),
        'blocks.commercial_permissions': key ? aggregateAdapter({
            sourceId: 'blocks.commercial_permissions',
            key,
            pool,
            query: `select count(*)::int as records, max(updated_at)::text as updated_at
                from crm_atendimento.commercial_contact_permissions`,
            select: (row) => ({ records: Number(row.records || 0), updatedAt: row.updated_at || EPOCH_WATERMARK }),
        }) : sourceAdapter({ sourceId: 'blocks.commercial_permissions', async read() { return fingerprintUnavailable() } }),
        'identity.global_graph': key ? aggregateAdapter({
            sourceId: 'identity.global_graph',
            key,
            pool,
            query: `select count(*)::int as records, max(updated_at)::text as updated_at
                from crm_atendimento.global_client_identities`,
            select: (row) => ({ records: Number(row.records || 0), updatedAt: row.updated_at || EPOCH_WATERMARK }),
        }) : sourceAdapter({ sourceId: 'identity.global_graph', async read() { return fingerprintUnavailable() } }),
    }
}

export const __testables = {
    completeSnapshot,
    hmacFingerprint,
    canonicalizeFingerprintValue,
    maxTimestamp,
    safeFingerprintKey,
    unavailable,
    adapterError,
    TRUE_VALUES,
}
