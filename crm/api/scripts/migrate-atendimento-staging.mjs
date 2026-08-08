#!/usr/bin/env node
/**
 * Controlled schema release for the isolated staging Atendimento database.
 *
 * This runner deliberately accepts one exact loopback TLS URL and the
 * dedicated migrator login. It reuses the same guarded migration modules as
 * the local mirror, but never runs identity materialization or commercial
 * writes; the schema is installed with all feature flags disabled.
 */
import { randomUUID } from 'node:crypto'
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    acquireAtendimentoStagingMutationLock,
    assertAtendimentoStagingMigratorConnectionLimit,
    ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT,
    ATENDIMENTO_STAGING_MIGRATION_POOL_MAX,
    ATENDIMENTO_STAGING_MUTATION_LOCK_KEY,
    releaseAtendimentoStagingMutationLock,
} from './atendimento-staging-maintenance-lock.mjs'
import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'
import {
    applyProfessionalIdentityMigration,
    rollbackProfessionalIdentityMigration,
} from '../server/atendimento/professionalIdentityMigration.js'
import {
    applyAtendimentoWriteSafetyMigration,
    rollbackAtendimentoWriteSafetyMigration,
} from '../server/atendimento/writeSafetyMigration.js'
import {
    applyCommercialContactMigration,
    rollbackCommercialContactMigration,
} from '../server/atendimento/commercialContactMigration.js'
import {
    applyCommercialContactRolloutMigration,
    rollbackCommercialContactRolloutMigration,
} from '../server/atendimento/commercialContactRolloutMigration.js'
import {
    applyCommercialCanaryMigration,
    rollbackCommercialCanaryMigration,
} from '../server/atendimento/commercialCanaryMigration.js'
import {
    applyClientIdentityMaterializationMigration,
    rollbackClientIdentityMaterializationMigration,
} from '../server/atendimento/clientIdentityMaterializationMigration.js'
import {
    applyCommercialActionLedgerMigration,
    rollbackCommercialActionLedgerMigration,
} from '../server/atendimento/commercialActionLedgerMigration.js'
import {
    applyCommercialDataQualityMigration,
    rollbackCommercialDataQualityMigration,
} from '../server/atendimento/commercialDataQualityMigration.js'
import {
    applyClientesSourceOperationsMigration,
    rollbackClientesSourceOperationsMigration,
} from '../server/clientes/sourceOperationsMigration.js'
import {
    applyIdentityReviewWorkflowMigration,
    rollbackIdentityReviewWorkflowMigration,
} from '../server/atendimento/identityReviewMigration.js'
import {
    applyIdentityClusterWorkspaceMigration,
    rollbackIdentityClusterWorkspaceMigration,
} from '../server/atendimento/identityClusterWorkspaceMigration.js'
import {
    applyCommercialOperationsMigration,
    rollbackCommercialOperationsMigration,
} from '../server/atendimento/commercialOperationsMigration.js'
import {
    applyCommercialAnalyticsMigration,
    rollbackCommercialAnalyticsMigration,
} from '../server/atendimento/commercialAnalyticsMigration.js'
import {
    applyCommercialAssistedMigration,
    rollbackCommercialAssistedMigration,
} from '../server/atendimento/commercialAssistedCommunicationMigration.js'
import {
    applyClinicalApprovalMigration,
    rollbackClinicalApprovalMigration,
} from '../server/clinical/clinicalApprovalMigration.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ATENDIMENTO_STAGING_MIGRATION_TARGET = ATENDIMENTO_MIGRATION_TARGETS.STAGING
export const ATENDIMENTO_STAGING_MIGRATION_LOCK_KEY = ATENDIMENTO_STAGING_MUTATION_LOCK_KEY
export { ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT, ATENDIMENTO_STAGING_MIGRATION_POOL_MAX }
export const ATENDIMENTO_STAGING_MIGRATIONS = Object.freeze([
    { id: '20260718_atendimento_professional_identity_v1', apply: applyProfessionalIdentityMigration, rollback: rollbackProfessionalIdentityMigration },
    { id: '20260718_atendimento_write_safety_v1', apply: applyAtendimentoWriteSafetyMigration, rollback: rollbackAtendimentoWriteSafetyMigration },
    { id: '20260804_commercial_contact_controls_v1', apply: applyCommercialContactMigration, rollback: rollbackCommercialContactMigration },
    { id: '20260804_commercial_contact_rollout_v1', apply: applyCommercialContactRolloutMigration, rollback: rollbackCommercialContactRolloutMigration },
    { id: '20260805_client_identity_materialization_schema_v1', apply: applyClientIdentityMaterializationMigration, rollback: rollbackClientIdentityMaterializationMigration },
    { id: '20260805_commercial_action_ledger_v1', apply: applyCommercialActionLedgerMigration, rollback: rollbackCommercialActionLedgerMigration },
    { id: '20260805_commercial_data_quality_queue_v1', apply: applyCommercialDataQualityMigration, rollback: rollbackCommercialDataQualityMigration },
    { id: '20260807_clientes_source_operations_v2', apply: applyClientesSourceOperationsMigration, rollback: rollbackClientesSourceOperationsMigration },
    { id: '20260805_identity_review_workflow_v1', apply: applyIdentityReviewWorkflowMigration, rollback: rollbackIdentityReviewWorkflowMigration },
    { id: '20260807_identity_cluster_workspace_v2', apply: applyIdentityClusterWorkspaceMigration, rollback: rollbackIdentityClusterWorkspaceMigration },
    { id: '20260806_clinical_cadence_approval_v1', apply: applyClinicalApprovalMigration, rollback: rollbackClinicalApprovalMigration },
    { id: '20260807_commercial_operations_v2', apply: applyCommercialOperationsMigration, rollback: rollbackCommercialOperationsMigration },
    { id: '20260807_commercial_analytics_v2', apply: applyCommercialAnalyticsMigration, rollback: rollbackCommercialAnalyticsMigration },
    // The selector references materialized global identities and the current
    // source-quality controls. Keep it last so a clean staging bootstrap
    // cannot create a partially usable canary schema.
    { id: '20260807_commercial_canary_selector_v2', apply: applyCommercialCanaryMigration, rollback: rollbackCommercialCanaryMigration },
    // Assisted communication depends on source freshness, materialized identities and the canary registry. It remains disabled until its own guarded runtime controls exist.
    { id: '20260807_commercial_assisted_whatsapp_v2', apply: applyCommercialAssistedMigration, rollback: rollbackCommercialAssistedMigration },
])

export function parseAtendimentoStagingMigrationAction(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 1 || !['--apply', '--rollback', '--dry-run'].includes(values[0])) {
        throw new Error('Use exatamente uma ação: --dry-run, --apply ou --rollback.')
    }
    return values[0].slice(2)
}

export async function runAtendimentoStagingMigration({
    databaseUrl,
    action,
    createPool = createPgPool,
    createRunId = randomUUID,
    assertDestination = assertAtendimentoMigrationDestination,
} = {}) {
    const target = ATENDIMENTO_STAGING_MIGRATION_TARGET
    const normalizedUrl = String(databaseUrl || '').trim()
    if (!['apply', 'rollback', 'dry-run'].includes(String(action || ''))) {
        throw new Error('ATENDIMENTO_STAGING_MIGRATION_ACTION_INVALID')
    }
    if (!normalizedUrl || !isStrictAtendimentoMigrationDestination(normalizedUrl, target)) {
        throw new Error('DATABASE_URL deve apontar exclusivamente para skincos_staging via loopback TLS e o login migrator.')
    }
    // The session-scoped mutation lock remains checked out for the entire run.
    // Every listed migration uses one additional client in serial order, so the
    // executor pool budget is exactly two; a third role session is reserved
    // only for a competing fixed entrypoint to fail on the shared lock.
    const pool = createPool(normalizedUrl, { max: ATENDIMENTO_STAGING_MIGRATION_POOL_MAX })
    if (!pool) throw new Error('Não foi possível criar o pool staging.')
    const runId = createRunId()
    let lockClient = null
    let lockAcquired = false
    try {
        lockClient = await pool.connect()
        await acquireAtendimentoStagingMutationLock(lockClient, 'ATENDIMENTO_STAGING_MIGRATION_LOCK_UNAVAILABLE')
        lockAcquired = true
        await assertAtendimentoStagingMigratorConnectionLimit(lockClient)

        const client = await pool.connect()
        try {
            // The destination guard intentionally rejects a read-only session for
            // an apply-capable connection. Dry-run performs no writes, but keeps
            // the same identity mode so it proves the exact migrator can apply.
            await client.query('begin')
            const identity = await assertDestination(client, normalizedUrl, target)
            const registryExists = await client.query(`select to_regclass('crm_atendimento.schema_migrations') as registry`)
            const registry = registryExists.rows[0]?.registry
                ? await client.query(`select id, applied_at, rolled_back_at
                    from crm_atendimento.schema_migrations
                    order by id`)
                : { rows: [] }
            await client.query('commit')
            if (action === 'dry-run') {
                return { runId, action, target, identity, registryPresent: Boolean(registryExists.rows[0]?.registry), migrations: registry.rows }
            }
        } catch (error) {
            try { await client.query('rollback') } catch { /* preserve original error */ }
            throw error
        } finally {
            client.release()
        }

        if (action !== 'dry-run') {
            const ordered = action === 'rollback' ? [...ATENDIMENTO_STAGING_MIGRATIONS].reverse() : ATENDIMENTO_STAGING_MIGRATIONS
            const reports = []
            for (const migration of ordered) {
                const report = await migration[action]({ pool, databaseUrl: normalizedUrl, target })
                reports.push({ id: migration.id, report })
            }
            return { runId, action, target, migrations: reports, commercialWritesEnabled: false, contactCanary: [] }
        }
    } finally {
        if (lockClient) {
            if (lockAcquired) {
                try {
                    await releaseAtendimentoStagingMutationLock(lockClient)
                } catch {
                    // The pool close still releases a session-scoped advisory lock.
                }
            }
            lockClient.release()
        }
        await pool.end()
    }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    const action = parseAtendimentoStagingMigrationAction(process.argv.slice(2))
    const report = await runAtendimentoStagingMigration({ databaseUrl: process.env.DATABASE_URL, action })
    console.log(JSON.stringify(report, null, 2))
}
