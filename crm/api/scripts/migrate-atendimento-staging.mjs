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
    applyIdentityReviewWorkflowMigration,
    rollbackIdentityReviewWorkflowMigration,
} from '../server/atendimento/identityReviewMigration.js'

const target = ATENDIMENTO_MIGRATION_TARGETS.STAGING
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const args = new Set(process.argv.slice(2))
const action = args.has('--apply') ? 'apply' : args.has('--rollback') ? 'rollback' : args.has('--dry-run') ? 'dry-run' : null

if (!action || [...args].some((arg) => !['--apply', '--rollback', '--dry-run'].includes(arg))) {
    throw new Error('Use exatamente uma ação: --dry-run, --apply ou --rollback.')
}
if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
    throw new Error('DATABASE_URL deve apontar exclusivamente para skincos_staging via loopback TLS e o login migrator.')
}

const migrations = [
    { id: '20260718_atendimento_professional_identity_v1', apply: applyProfessionalIdentityMigration, rollback: rollbackProfessionalIdentityMigration },
    { id: '20260718_atendimento_write_safety_v1', apply: applyAtendimentoWriteSafetyMigration, rollback: rollbackAtendimentoWriteSafetyMigration },
    { id: '20260804_commercial_contact_controls_v1', apply: applyCommercialContactMigration, rollback: rollbackCommercialContactMigration },
    { id: '20260804_commercial_contact_rollout_v1', apply: applyCommercialContactRolloutMigration, rollback: rollbackCommercialContactRolloutMigration },
    { id: '20260805_client_identity_materialization_schema_v1', apply: applyClientIdentityMaterializationMigration, rollback: rollbackClientIdentityMaterializationMigration },
    { id: '20260805_commercial_action_ledger_v1', apply: applyCommercialActionLedgerMigration, rollback: rollbackCommercialActionLedgerMigration },
    { id: '20260805_commercial_data_quality_queue_v1', apply: applyCommercialDataQualityMigration, rollback: rollbackCommercialDataQualityMigration },
    { id: '20260805_identity_review_workflow_v1', apply: applyIdentityReviewWorkflowMigration, rollback: rollbackIdentityReviewWorkflowMigration },
]

const pool = createPgPool(databaseUrl)
if (!pool) throw new Error('Não foi possível criar o pool staging.')
const runId = randomUUID()
try {
    const client = await pool.connect()
    try {
        // The destination guard intentionally rejects a read-only session for
        // an apply-capable connection. Dry-run performs no writes, but keeps
        // the same identity mode so it proves the exact migrator can apply.
        await client.query('begin')
        const identity = await assertAtendimentoMigrationDestination(client, databaseUrl, target)
        const registryExists = await client.query(`select to_regclass('crm_atendimento.schema_migrations') as registry`)
        const registry = registryExists.rows[0]?.registry
            ? await client.query(`select id, applied_at, rolled_back_at
                from crm_atendimento.schema_migrations
                order by id`)
            : { rows: [] }
        await client.query('commit')
        if (action === 'dry-run') console.log(JSON.stringify({ runId, action, target, identity, registryPresent: Boolean(registryExists.rows[0]?.registry), migrations: registry.rows }, null, 2))
    } catch (error) {
        try { await client.query('rollback') } catch { /* preserve original error */ }
        throw error
    } finally {
        client.release()
    }

    if (action !== 'dry-run') {
        const ordered = action === 'rollback' ? [...migrations].reverse() : migrations
        const reports = []
        for (const migration of ordered) {
            const report = await migration[action]({ pool, databaseUrl, target })
            reports.push({ id: migration.id, report })
        }
        console.log(JSON.stringify({ runId, action, target, migrations: reports, commercialWritesEnabled: false, contactCanary: [] }, null, 2))
    }
} finally {
    await pool.end()
}
