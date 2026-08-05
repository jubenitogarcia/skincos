#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { createCommercialDataQualityStore } from '../server/atendimento/commercialDataQualityStore.js'
import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'

const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (process.argv.slice(2).length !== 1 || process.argv[2] !== '--apply') throw new Error('Use exclusivamente --apply.')
if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, ATENDIMENTO_MIGRATION_TARGETS.STAGING)) {
    throw new Error('DATABASE_URL deve apontar exclusivamente para o staging TLS via loopback.')
}

const pool = createPgPool(databaseUrl)
try {
    const client = await pool.connect()
    try {
        await assertAtendimentoMigrationDestination(client, databaseUrl, ATENDIMENTO_MIGRATION_TARGETS.STAGING)
    } finally {
        client.release()
    }
    const result = await createCommercialDataQualityStore({ pool, databaseUrl }).refresh({
        id: 'clientes-staging-data-quality-refresh',
        role: 'ADMIN',
        isGlobalAdmin: true,
    })
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
