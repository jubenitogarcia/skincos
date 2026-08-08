#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { createCommercialDataQualityStore } from '../server/atendimento/commercialDataQualityStore.js'
import {
    acquireAtendimentoStagingMutationLock,
    assertAtendimentoStagingMigratorConnectionLimit,
    ATENDIMENTO_STAGING_QUALITY_REFRESH_POOL_MAX,
    releaseAtendimentoStagingMutationLock,
} from './atendimento-staging-maintenance-lock.mjs'
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

// Reserve one session for the shared staging mutation gate and at most one for
// the serial quality transaction. The role keeps one additional session only
// for a competing fixed entrypoint to fail on the shared mutation lock.
const pool = createPgPool(databaseUrl, { max: ATENDIMENTO_STAGING_QUALITY_REFRESH_POOL_MAX })
let lockClient = null
let lockAcquired = false
try {
    lockClient = await pool.connect()
    await acquireAtendimentoStagingMutationLock(lockClient, 'ATENDIMENTO_STAGING_QUALITY_LOCK_UNAVAILABLE')
    lockAcquired = true
    await assertAtendimentoStagingMigratorConnectionLimit(lockClient)
    await assertAtendimentoMigrationDestination(lockClient, databaseUrl, ATENDIMENTO_MIGRATION_TARGETS.STAGING)
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
    if (lockClient) {
        if (lockAcquired) {
            try { await releaseAtendimentoStagingMutationLock(lockClient) } catch { /* connection cleanup releases the lock too */ }
        }
        lockClient.release()
    }
    await pool.end()
}
