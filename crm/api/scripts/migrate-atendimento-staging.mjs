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
    applyAtendimentoCoreSchemaMigration,
    rollbackAtendimentoCoreSchemaMigration,
    ATENDIMENTO_CORE_SCHEMA_MIGRATION_ID,
    atendimentoCoreSchemaMigrationPlan,
    inspectAtendimentoCoreSchema,
} from '../server/atendimento/coreSchemaMigration.js'
import {
    COMMERCIAL_OPERATIONS_MIGRATION_ID,
    COMMERCIAL_OPERATIONS_PREREQUISITE_RELATIONS,
    applyCommercialOperationsMigration,
    rollbackCommercialOperationsMigration,
} from '../server/atendimento/commercialOperationsMigration.js'
import {
    COMMERCIAL_ANALYTICS_PREREQUISITE_RELATIONS,
    applyCommercialAnalyticsMigration,
    rollbackCommercialAnalyticsMigration,
} from '../server/atendimento/commercialAnalyticsMigration.js'
import {
    COMMERCIAL_ASSISTED_MIGRATION_ID,
    COMMERCIAL_ASSISTED_PREREQUISITE_RELATIONS,
    applyCommercialAssistedMigration,
    rollbackCommercialAssistedMigration,
} from '../server/atendimento/commercialAssistedCommunicationMigration.js'
import { COMMERCIAL_ANALYTICS_MIGRATION_ID } from '../server/atendimento/commercialAnalytics.js'
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
    { id: ATENDIMENTO_CORE_SCHEMA_MIGRATION_ID, apply: applyAtendimentoCoreSchemaMigration, rollback: rollbackAtendimentoCoreSchemaMigration },
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

const STAGING_MIGRATION_EVIDENCE_RELATION = 'crm_atendimento.staging_migration_evidence'
const STAGING_MIGRATION_EVIDENCE_STATES = Object.freeze({
    DEFERRED: 'deferred',
    APPLIED: 'applied',
    ROLLED_BACK: 'rolled_back',
})

// This is deliberately a closed staging-only policy.  The canary migration is
// not listed because it has only CRM foundations and enforces the disabled
// commercial-write boundary; an absent canary prerequisite must still abort.
export const ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES = Object.freeze({
    [COMMERCIAL_OPERATIONS_MIGRATION_ID]: Object.freeze({
        prerequisiteError: 'COMMERCIAL_OPERATIONS_PREREQUISITES_MISSING',
        prerequisiteRelations: COMMERCIAL_OPERATIONS_PREREQUISITE_RELATIONS,
    }),
    [COMMERCIAL_ANALYTICS_MIGRATION_ID]: Object.freeze({
        prerequisiteError: 'COMMERCIAL_ANALYTICS_MIGRATION_PREREQUISITES_MISSING',
        prerequisiteRelations: COMMERCIAL_ANALYTICS_PREREQUISITE_RELATIONS,
    }),
    [COMMERCIAL_ASSISTED_MIGRATION_ID]: Object.freeze({
        prerequisiteError: 'COMMERCIAL_ASSISTED_MIGRATION_PREREQUISITES_MISSING',
        prerequisiteRelations: COMMERCIAL_ASSISTED_PREREQUISITE_RELATIONS,
    }),
})

const STAGING_MIGRATION_EVIDENCE_DDL = `create table if not exists ${STAGING_MIGRATION_EVIDENCE_RELATION} (
    event_id text primary key check (event_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    migration_id text not null check (migration_id in (${Object.keys(ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES).map((id) => `'${id}'`).join(', ')})),
    event_state text not null check (event_state in ('deferred', 'applied', 'rolled_back')),
    reason_code text not null,
    missing_prerequisites jsonb not null check (jsonb_typeof(missing_prerequisites) = 'array'),
    schema_migration_recorded boolean not null,
    release_sha text not null check (release_sha ~ '^[0-9a-f]{40}$'),
    run_id text not null,
    recorded_at timestamptz not null default now(),
    check (
        (event_state = 'deferred' and schema_migration_recorded = false)
        or (event_state = 'applied' and schema_migration_recorded = true)
        or (event_state = 'rolled_back' and schema_migration_recorded = false)
    )
)`

function isReleaseSha(value) {
    return /^[0-9a-f]{40}$/.test(String(value || ''))
}

function optionalCommercialMigrationRule(migration) {
    return ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES[migration?.id] || null
}

function declaredPrerequisiteProjection(prerequisiteRelations) {
    return prerequisiteRelations
        .map((relation, index) => `to_regclass('${relation}') is not null as relation_${index}`)
        .join(', ')
}

function missingDeclaredPrerequisites(row, prerequisiteRelations) {
    return prerequisiteRelations.filter((relation, index) => !Boolean(row?.[`relation_${index}`]))
}

function deferredMigrationReport({ migration, rule, missingPrerequisites, releaseSha, runId }) {
    return {
        id: migration.id,
        status: STAGING_MIGRATION_EVIDENCE_STATES.DEFERRED,
        applied: false,
        deferred: true,
        schemaMigrationRecorded: false,
        reason: rule.prerequisiteError,
        missingPrerequisites,
        evidence: {
            persisted: true,
            state: STAGING_MIGRATION_EVIDENCE_STATES.DEFERRED,
            releaseSha,
            runId,
        },
        commercialWritesEnabled: false,
    }
}

function deferredRollbackReport({ migration, evidence }) {
    return {
        id: migration.id,
        status: 'not_applied',
        applied: false,
        deferred: true,
        schemaMigrationRecorded: false,
        rollbackSkipped: true,
        reason: 'STAGING_OPTIONAL_MIGRATION_DEFERRED_NOT_APPLIED',
        missingPrerequisites: evidence.missing_prerequisites,
        evidence: {
            persisted: true,
            state: evidence.event_state,
            releaseSha: evidence.release_sha,
            runId: evidence.run_id,
        },
        commercialWritesEnabled: false,
    }
}

async function inspectAndPersistStagingDeferral({ pool, migration, rule, releaseSha, runId, createEvidenceId }) {
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        const result = await client.query(`select ${declaredPrerequisiteProjection(rule.prerequisiteRelations)}`)
        const missingPrerequisites = missingDeclaredPrerequisites(result.rows[0], rule.prerequisiteRelations)
        if (missingPrerequisites.length > 0) {
            await client.query(STAGING_MIGRATION_EVIDENCE_DDL)
            // Provisioning grants the app role SELECT by default for safe
            // runtime tables. This private migration-evidence journal is not a
            // runtime input and must remain migrator-only.
            await client.query(`revoke all privileges on table ${STAGING_MIGRATION_EVIDENCE_RELATION} from skincos_staging_crm_app`)
            await client.query(`insert into ${STAGING_MIGRATION_EVIDENCE_RELATION}(
                event_id, migration_id, event_state, reason_code, missing_prerequisites,
                schema_migration_recorded, release_sha, run_id
            ) values ($1, $2, $3, $4, $5::jsonb, false, $6, $7)`, [
                createEvidenceId(),
                migration.id,
                STAGING_MIGRATION_EVIDENCE_STATES.DEFERRED,
                rule.prerequisiteError,
                JSON.stringify(missingPrerequisites),
                releaseSha,
                runId,
            ])
        }
        await client.query('commit')
        transactionOpen = false
        return missingPrerequisites
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the guarded failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

async function latestStagingMigrationEvidence({ pool, migrationId }) {
    const client = await pool.connect()
    try {
        const relation = await client.query(`select to_regclass($1) as relation`, [STAGING_MIGRATION_EVIDENCE_RELATION])
        if (!relation.rows[0]?.relation) return null
        const result = await client.query(`select event_state, missing_prerequisites, schema_migration_recorded, release_sha, run_id
            from ${STAGING_MIGRATION_EVIDENCE_RELATION}
            where migration_id=$1
            order by recorded_at desc, event_id desc
            limit 1`, [migrationId])
        return result.rows[0] || null
    } finally {
        client.release()
    }
}

async function appendStagingMigrationEvidenceIfPresent({ pool, migration, eventState, releaseSha, runId, createEvidenceId }) {
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        const relation = await client.query(`select to_regclass($1) as relation`, [STAGING_MIGRATION_EVIDENCE_RELATION])
        if (!relation.rows[0]?.relation) {
            await client.query('commit')
            transactionOpen = false
            return false
        }
        await client.query(`revoke all privileges on table ${STAGING_MIGRATION_EVIDENCE_RELATION} from skincos_staging_crm_app`)
        await client.query(`insert into ${STAGING_MIGRATION_EVIDENCE_RELATION}(
            event_id, migration_id, event_state, reason_code, missing_prerequisites,
            schema_migration_recorded, release_sha, run_id
        ) values ($1, $2, $3, $4, '[]'::jsonb, $5, $6, $7)`, [
            createEvidenceId(),
            migration.id,
            eventState,
            eventState === STAGING_MIGRATION_EVIDENCE_STATES.APPLIED
                ? 'SCHEMA_MIGRATION_APPLIED'
                : 'SCHEMA_MIGRATION_ROLLED_BACK',
            eventState === STAGING_MIGRATION_EVIDENCE_STATES.APPLIED,
            releaseSha,
            runId,
        ])
        await client.query('commit')
        transactionOpen = false
        return true
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the guarded failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export function parseAtendimentoStagingMigrationAction(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 1 || !['--apply', '--rollback', '--dry-run'].includes(values[0])) {
        throw new Error('Use exatamente uma ação: --dry-run, --apply ou --rollback.')
    }
    return values[0].slice(2)
}

export function parseAtendimentoStagingMigrationInvocation(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 3 || values[1] !== '--release-sha' || !isReleaseSha(values[2])) {
        throw new Error('Use exatamente uma ação e --release-sha <sha-40-minúsculo>.')
    }
    return { action: parseAtendimentoStagingMigrationAction([values[0]]), releaseSha: values[2] }
}

export async function runAtendimentoStagingMigration({
    databaseUrl,
    action,
    createPool = createPgPool,
    createRunId = randomUUID,
    createEvidenceId = randomUUID,
    migrations = ATENDIMENTO_STAGING_MIGRATIONS,
    releaseSha,
    assertDestination = assertAtendimentoMigrationDestination,
} = {}) {
    const target = ATENDIMENTO_STAGING_MIGRATION_TARGET
    const normalizedUrl = String(databaseUrl || '').trim()
    const normalizedReleaseSha = String(releaseSha || '').trim()
    if (!['apply', 'rollback', 'dry-run'].includes(String(action || ''))) {
        throw new Error('ATENDIMENTO_STAGING_MIGRATION_ACTION_INVALID')
    }
    if (!normalizedUrl || !isStrictAtendimentoMigrationDestination(normalizedUrl, target)) {
        throw new Error('DATABASE_URL deve apontar exclusivamente para skincos_staging via loopback TLS e o login migrator.')
    }
    if ((action !== 'dry-run' || normalizedReleaseSha) && !isReleaseSha(normalizedReleaseSha)) {
        throw new Error('ATENDIMENTO_STAGING_MIGRATION_RELEASE_SHA_INVALID')
    }
    if (!Array.isArray(migrations) || migrations.some((migration) => !migration?.id || typeof migration.apply !== 'function' || typeof migration.rollback !== 'function')) {
        throw new Error('ATENDIMENTO_STAGING_MIGRATION_PLAN_INVALID')
    }
    // The session-scoped mutation lock remains checked out for the entire run.
    // Every listed migration uses one additional client in serial order, so the
    // executor pool budget is exactly two; a third role session is reserved
    // only for a competing fixed entrypoint to fail on the shared lock.
    const pool = createPool(normalizedUrl, { max: ATENDIMENTO_STAGING_MIGRATION_POOL_MAX })
    if (!pool) throw new Error('Não foi possível criar o pool staging.')
    const runId = createRunId()
    let activeMigrationIds = new Set()
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
            const coreSchema = await inspectAtendimentoCoreSchema(client)
            activeMigrationIds = new Set(registry.rows
                .filter((row) => row?.id && !row.rolled_back_at)
                .map((row) => row.id))
            await client.query('commit')
            if (action === 'dry-run') {
                return {
                    runId,
                    action,
                    target,
                    identity,
                    registryPresent: Boolean(registryExists.rows[0]?.registry),
                    coreSchema,
                    coreSchemaPlan: atendimentoCoreSchemaMigrationPlan(),
                    migrations: registry.rows,
                    releaseSha: normalizedReleaseSha || null,
                    optionalCommercialMigrationRules: Object.entries(ATENDIMENTO_STAGING_OPTIONAL_COMMERCIAL_MIGRATION_RULES)
                        .map(([id, rule]) => ({ id, prerequisiteError: rule.prerequisiteError, prerequisiteRelations: rule.prerequisiteRelations })),
                }
            }
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
                const rule = optionalCommercialMigrationRule(migration)
                if (action === 'rollback' && rule && !activeMigrationIds.has(migration.id)) {
                    const evidence = await latestStagingMigrationEvidence({ pool, migrationId: migration.id })
                    if (evidence?.event_state === STAGING_MIGRATION_EVIDENCE_STATES.DEFERRED && evidence.schema_migration_recorded === false) {
                        reports.push({ id: migration.id, report: deferredRollbackReport({ migration, evidence }) })
                        continue
                    }
                    throw new Error('STAGING_OPTIONAL_MIGRATION_ROLLBACK_STATE_UNKNOWN')
                }

                if (action === 'apply' && rule && !activeMigrationIds.has(migration.id)) {
                    const missingPrerequisites = await inspectAndPersistStagingDeferral({
                        pool,
                        migration,
                        rule,
                        releaseSha: normalizedReleaseSha,
                        runId,
                        createEvidenceId,
                    })
                    if (missingPrerequisites.length > 0) {
                        reports.push({
                            id: migration.id,
                            report: deferredMigrationReport({ migration, rule, missingPrerequisites, releaseSha: normalizedReleaseSha, runId }),
                        })
                        continue
                    }
                }

                let report
                try {
                    report = await migration[action]({ pool, databaseUrl: normalizedUrl, target })
                } catch (error) {
                    if (action === 'apply' && rule && !activeMigrationIds.has(migration.id) && String(error?.code || '') === rule.prerequisiteError) {
                        // A relation can disappear after the metadata preflight. Only
                        // the same fixed error plus a fresh missing-relation proof is
                        // deferable; all other failures remain terminal.
                        const missingPrerequisites = await inspectAndPersistStagingDeferral({
                            pool,
                            migration,
                            rule,
                            releaseSha: normalizedReleaseSha,
                            runId,
                            createEvidenceId,
                        })
                        if (missingPrerequisites.length > 0) {
                            reports.push({
                                id: migration.id,
                                report: deferredMigrationReport({ migration, rule, missingPrerequisites, releaseSha: normalizedReleaseSha, runId }),
                            })
                            continue
                        }
                    }
                    throw error
                }

                if (rule) {
                    await appendStagingMigrationEvidenceIfPresent({
                        pool,
                        migration,
                        eventState: action === 'apply'
                            ? STAGING_MIGRATION_EVIDENCE_STATES.APPLIED
                            : STAGING_MIGRATION_EVIDENCE_STATES.ROLLED_BACK,
                        releaseSha: normalizedReleaseSha,
                        runId,
                        createEvidenceId,
                    })
                }
                reports.push({ id: migration.id, report })
            }
            const deferredMigrations = reports
                .filter(({ report }) => report?.deferred === true)
                .map(({ id, report }) => ({
                    id,
                    status: report.status,
                    reason: report.reason,
                    missingPrerequisites: report.missingPrerequisites,
                    schemaMigrationRecorded: report.schemaMigrationRecorded,
                }))
            return {
                runId,
                action,
                target,
                releaseSha: normalizedReleaseSha,
                migrations: reports,
                migrationEvidence: {
                    relation: STAGING_MIGRATION_EVIDENCE_RELATION,
                    deferred: deferredMigrations,
                },
                commercialWritesEnabled: false,
                contactCanary: [],
            }
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
    const { action, releaseSha } = parseAtendimentoStagingMigrationInvocation(process.argv.slice(2))
    const report = await runAtendimentoStagingMigration({
        databaseUrl: process.env.DATABASE_URL,
        action,
        releaseSha,
    })
    console.log(JSON.stringify(report, null, 2))
}
