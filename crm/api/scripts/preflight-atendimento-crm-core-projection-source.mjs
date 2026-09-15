#!/usr/bin/env node

const DATABASE_URL_KEY = 'CRM_CORE_PROJECTION_EXPORTER_DATABASE_URL'

function failure(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function safeCode(error) {
    return /^[A-Z][A-Z0-9_]{1,120}$/.test(String(error?.code || ''))
        ? error.code
        : 'ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_PREFLIGHT_FAILED'
}

let pool = null
let receipt = null
let failureCode = null
try {
    if (process.argv.length !== 2) throw failure('ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_ARGUMENTS_INVALID')
    const databaseUrl = String(process.env[DATABASE_URL_KEY] || '').trim()
    if (!databaseUrl) throw failure('ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_DATABASE_UNAVAILABLE')

    // Keep argument and custody-bound environment validation ahead of loading
    // the PostgreSQL driver. A locked-down host can therefore reject malformed
    // invocation without resolving a runtime dependency or attempting a
    // connection.
    const [{ createPgPool }, { preflightAtendimentoProjectionSourceMetadata }] = await Promise.all([
        import('../server/harmonia/store/pg.js'),
        import('../server/atendimento/projectionSourceMetadataPreflight.js'),
    ])
    pool = createPgPool(databaseUrl, { max: 1 })
    if (!pool) throw failure('ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_DATABASE_UNAVAILABLE')
    receipt = await preflightAtendimentoProjectionSourceMetadata({ pool })
} catch (error) {
    failureCode = safeCode(error)
} finally {
    if (pool) {
        try {
            await pool.end()
        } catch (error) {
            failureCode ||= safeCode(error)
        }
    }
}

if (failureCode) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: failureCode })}\n`)
    process.exitCode = 1
} else {
    process.stdout.write(`${JSON.stringify(receipt)}\n`)
}
