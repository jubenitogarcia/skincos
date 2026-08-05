#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { isStrictLocalMirrorDestination } from '../server/atendimento/mirror.js'
import { createCommercialDataQualityStore } from '../server/atendimento/commercialDataQualityStore.js'

const args = new Set(process.argv.slice(2))
const databaseUrl = String(process.env.DATABASE_URL || '').trim()

if (!args.has('--apply') || args.size !== 1) {
    throw new Error('Use exclusivamente --apply para materializar a fila de qualidade comercial.')
}
if (!databaseUrl || !isStrictLocalMirrorDestination(databaseUrl)) {
    throw new Error('DATABASE_URL deve apontar exclusivamente para o socket local admin de skincos_crm_local.')
}

const pool = createPgPool(databaseUrl)
try {
    const result = await createCommercialDataQualityStore({ pool }).refresh({
        id: 'clientes-data-quality-refresh',
        role: 'ADMIN',
        isGlobalAdmin: true,
    })
    // The store maps only allowlisted aggregate fields.  Keep the command's
    // stdout equally safe for an operator log or CI artifact.
    console.log(JSON.stringify({
        refreshed: result.refreshed,
        sourceFreshness: result.sourceFreshness,
        findings: result.findings.map(({ findingKey, severity, status, observedCount, metrics, revision }) => ({
            findingKey,
            severity,
            status,
            observedCount,
            metrics,
            revision,
        })),
    }, null, 2))
} finally {
    await pool.end()
}
