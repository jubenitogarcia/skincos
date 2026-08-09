#!/usr/bin/env node
/**
 * Controlled schema release for the dedicated production Clientes database.
 *
 * Production reuses the reviewed migration plan, but only a fixed set of
 * source-mirror-dependent migrations may be deferred. The dedicated database
 * deliberately has no Caixa/Harmonia mirror, so those features remain
 * unavailable until a separately governed mirror is provisioned. Any active
 * marker, identity mismatch, lock, privilege, SQL, or unexpected migration
 * error is terminal and leaves the runtime in maintenance.
 */
import { randomUUID } from 'node:crypto'
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    acquireAtendimentoStagingMutationLock,
    assertAtendimentoStagingMigratorConnectionLimit,
    ATENDIMENTO_STAGING_MIGRATION_POOL_MAX,
    releaseAtendimentoStagingMutationLock,
} from './atendimento-staging-maintenance-lock.mjs'
import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'
import {
    ATENDIMENTO_STAGING_MIGRATIONS,
} from './migrate-atendimento-staging.mjs'
import {
    atendimentoCoreSchemaMigrationPlan,
    inspectAtendimentoCoreSchema,
} from '../server/atendimento/coreSchemaMigration.js'

export const ATENDIMENTO_PRODUCTION_MIGRATION_TARGET = ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION
export const ATENDIMENTO_PRODUCTION_MIGRATIONS = ATENDIMENTO_STAGING_MIGRATIONS
export const ATENDIMENTO_PRODUCTION_DEFERRAL_RELATION = 'crm_atendimento.production_migration_deferrals'

const PRODUCTION_SOURCE_MIRROR_REASON = 'PRODUCTION_SOURCE_MIRROR_NOT_PROVISIONED'

// This map is intentionally closed. It covers only migrations whose reviewed
// contracts depend on source mirrors or identity materialization that cannot
// exist in the dedicated read-only database yet. A migration absent from this
// map is never deferable, even if it happens to throw a prerequisite error.
export const ATENDIMENTO_PRODUCTION_PREREQUISITE_DEFERRED_RULES = Object.freeze({
    '20260805_client_identity_materialization_schema_v1': Object.freeze({
        prerequisiteError: 'CLIENT_IDENTITY_MATERIALIZATION_MIGRATION_PREREQUISITES_MISSING',
        prerequisiteRelations: Object.freeze([
            'crm_caixa.customers',
            'crm_caixa.sales',
            'crm_caixa.sale_items',
        ]),
    }),
    '20260805_commercial_action_ledger_v1': Object.freeze({
        prerequisiteError: 'COMMERCIAL_ACTION_LEDGER_MIGRATION_PREREQUISITES_MISSING',
        prerequisiteRelations: Object.freeze([
            'crm_atendimento.commercial_actions',
            'crm_atendimento.commercial_contact_permission_events',
            'crm_atendimento.global_client_identities',
        ]),
    }),
    '20260805_commercial_data_quality_queue_v1': Object.freeze({
        prerequisiteError: 'COMMERCIAL_DATA_QUALITY_MIGRATION_PREREQUISITES_MISSING',
        prerequisiteRelations: Object.freeze([
            'crm_atendimento.canonical_clients',
            'crm_atendimento.attendance_client_links',
            'crm_atendimento.attendances',
            'crm_atendimento.global_client_identities',
            'crm_atendimento.global_client_identity_members',
            'crm_atendimento.client_merge_suggestions',
            'crm_atendimento.client_caixa_links',
            'crm_atendimento.app_registration_attendance_links',
            'crm_atendimento.app_registration_caixa_links',
            'crm_atendimento.supplemental_lead_profile_app_links',
            'crm_atendimento.supplemental_lead_profile_caixa_links',
            'crm_atendimento.local_mirror_state',
            'crm_atendimento.import_batches',
            'crm_atendimento.commercial_actions',
            'crm_atendimento.commercial_contact_permissions',
            'crm_atendimento.commercial_contact_permission_events',
            'crm_atendimento.commercial_policy_config',
            'crm_caixa.sale_items',
        ]),
    }),
    '20260807_clientes_source_operations_v2': Object.freeze({
        prerequisiteError: 'CLIENTES_SOURCE_OPERATIONS_PREREQUISITES_MISSING',
        prerequisiteRelations: Object.freeze([
            'crm_atendimento.commercial_data_quality_findings',
            'crm_atendimento.commercial_data_quality_finding_events',
        ]),
    }),
    '20260805_identity_review_workflow_v1': Object.freeze({
        prerequisiteError: 'IDENTITY_REVIEW_WORKFLOW_MIGRATION_PREREQUISITES_MISSING',
        prerequisiteRelations: Object.freeze([
            'crm_atendimento.client_merge_suggestions',
            'crm_atendimento.client_caixa_links',
            'crm_atendimento.app_client_registrations',
            'crm_atendimento.app_registration_attendance_links',
            'crm_atendimento.app_registration_caixa_links',
            'crm_atendimento.supplemental_lead_profiles',
            'crm_atendimento.supplemental_lead_profile_app_links',
            'crm_atendimento.supplemental_lead_profile_caixa_links',
            'crm_atendimento.global_client_identities',
            'crm_atendimento.global_client_identity_members',
            'crm_atendimento.commercial_actions',
            'crm_atendimento.commercial_contact_permissions',
            'crm_atendimento.commercial_contact_permission_events',
            'crm_atendimento.commercial_policy_config',
            'crm_atendimento.audit_events',
        ]),
    }),
    '20260807_identity_cluster_workspace_v2': Object.freeze({
        prerequisiteError: 'IDENTITY_CLUSTER_WORKSPACE_MIGRATION_PREREQUISITES_MISSING',
        prerequisiteRelations: Object.freeze([
            'crm_atendimento.global_client_identities',
            'crm_atendimento.global_client_identity_members',
            'crm_atendimento.identity_review_decisions',
            'crm_atendimento.identity_materialization_runs',
            'crm_atendimento.identity_member_history',
            'crm_atendimento.identity_lineage',
            'crm_atendimento.identity_source_link_history',
            'crm_atendimento.commercial_actions',
            'crm_atendimento.commercial_contact_permissions',
            'crm_atendimento.commercial_contact_permission_events',
            'crm_atendimento.audit_events',
        ]),
    }),
    '20260807_commercial_operations_v2': Object.freeze({
        prerequisiteError: 'COMMERCIAL_OPERATIONS_PREREQUISITES_MISSING',
        prerequisiteRelations: Object.freeze([
            'crm_atendimento.units',
            'crm_atendimento.global_client_identities',
            'crm_atendimento.commercial_actions',
            'crm_atendimento.commercial_action_events',
            'crm_atendimento.commercial_offers',
        ]),
    }),
    '20260807_commercial_analytics_v2': Object.freeze({
        prerequisiteError: 'COMMERCIAL_ANALYTICS_MIGRATION_PREREQUISITES_MISSING',
        prerequisiteRelations: Object.freeze([
            'crm_atendimento.schema_migrations',
            'crm_atendimento.units',
            'crm_atendimento.global_client_identities',
            'crm_atendimento.global_client_identity_members',
            'crm_atendimento.attendance_client_links',
            'crm_atendimento.attendances',
            'crm_atendimento.commercial_actions',
            'crm_atendimento.commercial_campaigns',
            'crm_atendimento.commercial_campaign_members',
            'crm_atendimento.commercial_data_quality_findings',
            'crm_atendimento.commercial_data_quality_finding_events',
            'crm_atendimento.commercial_contact_permissions',
            'crm_atendimento.clientes_source_operation_checkpoints',
            'crm_caixa.sales',
            'crm_caixa.sale_items',
        ]),
    }),
    '20260807_commercial_canary_selector_v2': Object.freeze({
        prerequisiteError: 'COMMERCIAL_CANARY_MIGRATION_PREREQUISITES_MISSING',
        prerequisiteRelations: Object.freeze([
            'crm_atendimento.schema_migrations',
            'crm_atendimento.commercial_policy_config',
            'crm_atendimento.global_client_identities',
            'crm_atendimento.global_client_identity_members',
            'crm_atendimento.units',
            'crm_atendimento.commercial_contact_permissions',
        ]),
    }),
    '20260807_commercial_assisted_whatsapp_v2': Object.freeze({
        prerequisiteError: 'COMMERCIAL_ASSISTED_MIGRATION_PREREQUISITES_MISSING',
        prerequisiteRelations: Object.freeze([
            'crm_atendimento.schema_migrations',
            'crm_atendimento.commercial_offers',
            'crm_atendimento.commercial_offer_procedures',
            'crm_atendimento.commercial_actions',
            'crm_atendimento.global_client_identities',
            'crm_atendimento.units',
            'crm_atendimento.commercial_contact_permissions',
            'crm_atendimento.commercial_policy_config',
            'crm_atendimento.commercial_procedure_cadences',
            'crm_atendimento.commercial_campaigns',
            'crm_atendimento.commercial_campaign_members',
            'crm_atendimento.commercial_data_quality_findings',
            'crm_atendimento.commercial_data_quality_finding_events',
            'crm_atendimento.clientes_source_operation_checkpoints',
            'harmonia.contacts',
            'crm_caixa.customers',
            'crm_caixa.sales',
            'crm_caixa.sale_items',
        ]),
    }),
})

const PRODUCTION_DEFERRAL_DDL = `create table if not exists ${ATENDIMENTO_PRODUCTION_DEFERRAL_RELATION} (
    event_id uuid primary key,
    migration_id text not null,
    event_state text not null check (event_state in ('deferred', 'applied', 'rolled_back')),
    reason_code text not null,
    missing_prerequisites jsonb not null check (jsonb_typeof(missing_prerequisites) = 'array'),
    schema_migration_recorded boolean not null,
    release_sha text not null check (release_sha ~ '^[0-9a-f]{40}$'),
    run_id text not null,
    recorded_at timestamptz not null default now(),
    check ((event_state = 'deferred' and schema_migration_recorded = false)
        or (event_state = 'applied' and schema_migration_recorded = true)
        or (event_state = 'rolled_back' and schema_migration_recorded = false))
)`

function productionPrerequisiteRule(migration) {
    return ATENDIMENTO_PRODUCTION_PREREQUISITE_DEFERRED_RULES[migration?.id] || null
}

function missingProductionPrerequisites(row, relations) {
    return relations.filter((relation, index) => !Boolean(row?.[`relation_${index}`]))
}

function productionDeferralReport({ migration, rule, missingPrerequisites, releaseSha, runId }) {
    return {
        id: migration.id,
        status: 'deferred',
        applied: false,
        deferred: true,
        schemaMigrationRecorded: false,
        reason: PRODUCTION_SOURCE_MIRROR_REASON,
        prerequisiteError: rule.prerequisiteError,
        missingPrerequisites,
        evidence: { persisted: true, state: 'deferred', releaseSha, runId },
        commercialWritesEnabled: false,
    }
}

function productionDeferredRollbackReport({ migration, evidence }) {
    return {
        id: migration.id,
        status: 'not_applied',
        applied: false,
        deferred: true,
        rollbackSkipped: true,
        schemaMigrationRecorded: false,
        reason: 'PRODUCTION_MIGRATION_DEFERRED_NOT_APPLIED',
        missingPrerequisites: evidence.missing_prerequisites,
        evidence: { persisted: true, state: evidence.event_state, releaseSha: evidence.release_sha, runId: evidence.run_id },
        commercialWritesEnabled: false,
    }
}

async function latestProductionDeferral({ pool, migrationId }) {
    const client = await pool.connect()
    try {
        const relation = await client.query('select to_regclass($1) as relation', [ATENDIMENTO_PRODUCTION_DEFERRAL_RELATION])
        if (!relation.rows[0]?.relation) return null
        const result = await client.query(`select event_state, missing_prerequisites, schema_migration_recorded, release_sha, run_id
            from ${ATENDIMENTO_PRODUCTION_DEFERRAL_RELATION}
            where migration_id=$1
            order by recorded_at desc, event_id desc
            limit 1`, [migrationId])
        return result.rows[0] || null
    } finally {
        client.release()
    }
}

async function inspectAndPersistProductionDeferral({ pool, migration, rule, releaseSha, runId, createEvidenceId = randomUUID }) {
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        const projection = rule.prerequisiteRelations
            .map((_, index) => `to_regclass($${index + 1}) is not null as relation_${index}`)
            .join(', ')
        const result = await client.query(`select ${projection}`, rule.prerequisiteRelations)
        const missingPrerequisites = missingProductionPrerequisites(result.rows[0], rule.prerequisiteRelations)
        if (missingPrerequisites.length > 0) {
            await client.query(PRODUCTION_DEFERRAL_DDL)
            await client.query(`revoke all privileges on table ${ATENDIMENTO_PRODUCTION_DEFERRAL_RELATION} from skincos_clientes_ro`)
            await client.query(`insert into ${ATENDIMENTO_PRODUCTION_DEFERRAL_RELATION}(
                event_id, migration_id, event_state, reason_code, missing_prerequisites,
                schema_migration_recorded, release_sha, run_id
            ) values ($1, $2, 'deferred', $3, $4::jsonb, false, $5, $6)`, [
                createEvidenceId(), migration.id, PRODUCTION_SOURCE_MIRROR_REASON,
                JSON.stringify(missingPrerequisites), releaseSha, runId,
            ])
        }
        await client.query('commit')
        transactionOpen = false
        return missingPrerequisites
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve original error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

async function appendProductionMigrationEvidence({ pool, migration, eventState, releaseSha, runId, createEvidenceId = randomUUID }) {
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        const relation = await client.query('select to_regclass($1) as relation', [ATENDIMENTO_PRODUCTION_DEFERRAL_RELATION])
        if (!relation.rows[0]?.relation) {
            await client.query('commit')
            transactionOpen = false
            return false
        }
        await client.query(`revoke all privileges on table ${ATENDIMENTO_PRODUCTION_DEFERRAL_RELATION} from skincos_clientes_ro`)
        await client.query(`insert into ${ATENDIMENTO_PRODUCTION_DEFERRAL_RELATION}(
            event_id, migration_id, event_state, reason_code, missing_prerequisites,
            schema_migration_recorded, release_sha, run_id
        ) values ($1, $2, $3, $4, '[]'::jsonb, $5, $6, $7)`, [
            createEvidenceId(),
            migration.id,
            eventState,
            eventState === 'applied' ? 'SCHEMA_MIGRATION_APPLIED' : 'SCHEMA_MIGRATION_ROLLED_BACK',
            eventState === 'applied',
            releaseSha,
            runId,
        ])
        await client.query('commit')
        transactionOpen = false
        return true
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve original error */ }
        }
        throw error
    } finally {
        client.release()
    }
}

function isReleaseSha(value) {
    return /^[0-9a-f]{40}$/.test(String(value || '').trim())
}

export function parseAtendimentoProductionMigrationInvocation(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 3 || !['apply', 'rollback', 'dry-run'].includes(values[0]) || values[1] !== '--release-sha' || !isReleaseSha(values[2])) {
        throw new Error('Use exatamente apply|rollback|dry-run --release-sha <sha-40-minúsculo>.')
    }
    return { action: values[0], releaseSha: values[2] }
}

export async function runAtendimentoProductionMigration({
    databaseUrl,
    action,
    createPool = createPgPool,
    createRunId = randomUUID,
    createEvidenceId = randomUUID,
    migrations = ATENDIMENTO_PRODUCTION_MIGRATIONS,
    releaseSha,
    assertDestination = assertAtendimentoMigrationDestination,
} = {}) {
    const target = ATENDIMENTO_PRODUCTION_MIGRATION_TARGET
    const normalizedUrl = String(databaseUrl || '').trim()
    const normalizedReleaseSha = String(releaseSha || '').trim()
    if (!['apply', 'rollback', 'dry-run'].includes(String(action || ''))) {
        throw new Error('ATENDIMENTO_PRODUCTION_MIGRATION_ACTION_INVALID')
    }
    if (!normalizedUrl || !isStrictAtendimentoMigrationDestination(normalizedUrl, target)) {
        throw new Error('DATABASE_URL deve apontar exclusivamente para skincos_clientes_production via loopback TLS e o login migrator.')
    }
    if (!isReleaseSha(normalizedReleaseSha)) {
        throw new Error('ATENDIMENTO_PRODUCTION_MIGRATION_RELEASE_SHA_INVALID')
    }
    if (!Array.isArray(migrations) || migrations.some((migration) => !migration?.id || typeof migration.apply !== 'function' || typeof migration.rollback !== 'function')) {
        throw new Error('ATENDIMENTO_PRODUCTION_MIGRATION_PLAN_INVALID')
    }

    const pool = createPool(normalizedUrl, { max: ATENDIMENTO_STAGING_MIGRATION_POOL_MAX })
    if (!pool) throw new Error('Não foi possível criar o pool production.')
    const runId = createRunId()
    let activeMigrationIds = new Set()
    let lockClient = null
    let lockAcquired = false
    try {
        lockClient = await pool.connect()
        await acquireAtendimentoStagingMutationLock(lockClient, 'ATENDIMENTO_PRODUCTION_MIGRATION_LOCK_UNAVAILABLE')
        lockAcquired = true
        await assertAtendimentoStagingMigratorConnectionLimit(lockClient)

        const client = await pool.connect()
        let identity
        let registry = { rows: [] }
        let coreSchema
        try {
            await client.query('begin')
            identity = await assertDestination(client, normalizedUrl, target)
            const registryExists = await client.query(`select to_regclass('crm_atendimento.schema_migrations') as registry`)
            if (registryExists.rows[0]?.registry) {
                registry = await client.query(`select id, applied_at, rolled_back_at
                    from crm_atendimento.schema_migrations
                    order by id`)
            }
            activeMigrationIds = new Set(registry.rows
                .filter((row) => row?.id && !row.rolled_back_at)
                .map((row) => row.id))
            coreSchema = await inspectAtendimentoCoreSchema(client)
            await client.query('commit')
        } catch (error) {
            try { await client.query('rollback') } catch { /* preserve original error */ }
            throw error
        } finally {
            client.release()
        }

        if (action === 'dry-run') {
            return {
                runId,
                action,
                target,
                identity,
                registryPresent: registry.rows.length > 0,
                coreSchema,
                coreSchemaPlan: atendimentoCoreSchemaMigrationPlan(),
                migrations: registry.rows,
                releaseSha: normalizedReleaseSha,
                productionPrerequisiteDeferralRules: Object.entries(ATENDIMENTO_PRODUCTION_PREREQUISITE_DEFERRED_RULES)
                    .map(([id, rule]) => ({ id, prerequisiteError: rule.prerequisiteError, prerequisiteRelations: rule.prerequisiteRelations })),
                deferred: [],
                commercialWritesEnabled: false,
            }
        }

        const ordered = action === 'rollback' ? [...migrations].reverse() : migrations
        const reports = []
        for (const migration of ordered) {
            const rule = productionPrerequisiteRule(migration)
            if (action === 'rollback' && rule && !activeMigrationIds.has(migration.id)) {
                const evidence = await latestProductionDeferral({ pool, migrationId: migration.id })
                if (evidence?.event_state === 'deferred' && evidence.schema_migration_recorded === false) {
                    reports.push({ id: migration.id, report: productionDeferredRollbackReport({ migration, evidence }) })
                    continue
                }
                if (!evidence) {
                    throw new Error('PRODUCTION_MIGRATION_ROLLBACK_STATE_UNKNOWN')
                }
            }

            if (action === 'apply' && rule && !activeMigrationIds.has(migration.id)) {
                const missingPrerequisites = await inspectAndPersistProductionDeferral({
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
                        report: productionDeferralReport({ migration, rule, missingPrerequisites, releaseSha: normalizedReleaseSha, runId }),
                    })
                    continue
                }
            }

            let report
            try {
                report = await migration[action]({ pool, databaseUrl: normalizedUrl, target })
            } catch (error) {
                if (action === 'apply' && rule && !activeMigrationIds.has(migration.id)
                    && String(error?.code || '') === rule.prerequisiteError) {
                    const missingPrerequisites = await inspectAndPersistProductionDeferral({
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
                            report: productionDeferralReport({ migration, rule, missingPrerequisites, releaseSha: normalizedReleaseSha, runId }),
                        })
                        continue
                    }
                }
                throw error
            }
            if (action === 'apply') activeMigrationIds.add(migration.id)
            if (action === 'rollback') activeMigrationIds.delete(migration.id)
            if (rule) {
                await appendProductionMigrationEvidence({
                    pool,
                    migration,
                    eventState: action === 'apply' ? 'applied' : 'rolled_back',
                    releaseSha: normalizedReleaseSha,
                    runId,
                    createEvidenceId,
                })
            }
            reports.push({ id: migration.id, report })
        }
        const deferred = reports
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
            deferred,
            commercialWritesEnabled: false,
        }
    } finally {
        if (lockClient) {
            if (lockAcquired) {
                try { await releaseAtendimentoStagingMutationLock(lockClient) } catch { /* pool close releases session lock */ }
            }
            lockClient.release()
        }
        await pool.end()
    }
}

const entrypoint = new URL(import.meta.url).pathname
if (process.argv[1] && process.argv[1].replaceAll('\\', '/') === entrypoint) {
    const { action, releaseSha } = parseAtendimentoProductionMigrationInvocation(process.argv.slice(2))
    const report = await runAtendimentoProductionMigration({
        databaseUrl: process.env.DATABASE_URL,
        action,
        releaseSha,
    })
    console.log(JSON.stringify(report, null, 2))
}
