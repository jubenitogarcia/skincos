#!/usr/bin/env node
/**
 * Fixed, staging-only entrypoint for the additive CRM Core identity schema.
 *
 * It deliberately has no target, database URL, batch, writer, delivery,
 * rollback, or runtime-control argument. The root custody wrapper is the
 * only supported caller for an applied run.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPgPool } from '../server/harmonia/store/pg.js'
import { readLiteralEnvironment } from '../server/atendimento/runtimeEnv.js'
import {
    applyAtendimentoCrmCoreIdentityMaterializationMigration,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
    preflightAtendimentoCrmCoreIdentityMaterialization,
} from '../server/atendimento/crmCoreIdentityMaterializationMigration.js'
import {
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'
import {
    acquireAtendimentoStagingMutationLock,
    assertAtendimentoStagingMigratorConnectionLimit,
    ATENDIMENTO_STAGING_MIGRATION_POOL_MAX,
    releaseAtendimentoStagingMutationLock,
} from './atendimento-staging-maintenance-lock.mjs'

export const ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_ENV_FILE = '/etc/skincos/crm-atendimento-staging-migrator.env'
export const ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_TARGET = ATENDIMENTO_MIGRATION_TARGETS.STAGING
export const ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_LOCK_UNAVAILABLE = 'ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_LOCK_UNAVAILABLE'

const ACTIONS = new Set(['verify', 'apply'])

function failure(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function normalizeAction(value) {
    const action = String(value || '').trim()
    if (!ACTIONS.has(action)) throw failure('ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_ACTION_INVALID')
    return action
}

export function parseAtendimentoCrmCoreIdentitySchemaStagingInvocation(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 1) throw failure('ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_ACTION_INVALID')
    return Object.freeze({ action: normalizeAction(values[0]) })
}

function summarizedPreflight(value) {
    const preflight = value?.preflight
    const booleans = [
        'prerequisitesReady',
        'currentMigrationRecorded',
        'currentMigrationActive',
        'relationCollision',
        'migrationReceiptCollision',
        'schemaCompatible',
        'schemaContractReady',
        'applyEligible',
        'schemaReady',
        'runtimeReady',
    ]
    if (!preflight || typeof preflight !== 'object'
        || booleans.some((key) => typeof preflight[key] !== 'boolean')
        || !Array.isArray(preflight.targetRelationsPresent)
        || !Array.isArray(preflight.targetRelationsAbsent)) {
        throw failure('ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_PREFLIGHT_INVALID')
    }
    return Object.freeze({
        prerequisitesReady: preflight.prerequisitesReady,
        currentMigrationRecorded: preflight.currentMigrationRecorded,
        currentMigrationActive: preflight.currentMigrationActive,
        relationCollision: preflight.relationCollision,
        migrationReceiptCollision: preflight.migrationReceiptCollision,
        schemaCompatible: preflight.schemaCompatible,
        schemaContractReady: preflight.schemaContractReady,
        applyEligible: preflight.applyEligible,
        schemaReady: preflight.schemaReady,
        runtimeReady: preflight.runtimeReady,
        targetRelationsPresent: preflight.targetRelationsPresent.length,
        targetRelationsAbsent: preflight.targetRelationsAbsent.length,
    })
}

function assertFreshSchemaAdmission(preflight) {
    if (!preflight.applyEligible
        || preflight.currentMigrationRecorded
        || preflight.currentMigrationActive
        || preflight.targetRelationsPresent !== 0
        || preflight.targetRelationsAbsent < 1) {
        throw failure('ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_ADMISSION_DENIED')
    }
}

function assertAppliedSchemaAdmission(preflight) {
    if (!preflight.runtimeReady
        || !preflight.currentMigrationRecorded
        || !preflight.currentMigrationActive
        || preflight.targetRelationsPresent < 1
        || preflight.targetRelationsAbsent !== 0) {
        throw failure('ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_POST_APPLY_INVALID')
    }
}

/**
 * Runs one schema-only observation or one first-time additive migration.
 * Dependency injection keeps the runtime entrypoint directly testable without
 * a database, and the shared mutation lock prevents concurrent older runners.
 */
export async function runAtendimentoCrmCoreIdentitySchemaStaging({
    action,
    readEnvironment = readLiteralEnvironment,
    createPool = createPgPool,
    preflight = preflightAtendimentoCrmCoreIdentityMaterialization,
    applyMigration = applyAtendimentoCrmCoreIdentityMaterializationMigration,
    acquireLock = acquireAtendimentoStagingMutationLock,
    releaseLock = releaseAtendimentoStagingMutationLock,
    assertConnectionLimit = assertAtendimentoStagingMigratorConnectionLimit,
} = {}) {
    const normalizedAction = normalizeAction(action)
    const values = await readEnvironment(ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_ENV_FILE, {
        allowedKeys: ['DATABASE_URL'],
    })
    const databaseUrl = String(values?.DATABASE_URL || '').trim()
    if (!databaseUrl) throw failure('ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_DATABASE_URL_MISSING')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_TARGET)) {
        throw failure('ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_DESTINATION_UNSAFE')
    }

    const pool = createPool(databaseUrl, { max: ATENDIMENTO_STAGING_MIGRATION_POOL_MAX })
    if (!pool) throw failure('ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_POOL_UNAVAILABLE')
    let lockClient = null
    let lockAcquired = false
    try {
        lockClient = await pool.connect()
        await acquireLock(lockClient, ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_LOCK_UNAVAILABLE)
        lockAcquired = true
        await assertConnectionLimit(lockClient)

        const before = summarizedPreflight(await preflight({
            pool,
            databaseUrl,
            target: ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_TARGET,
        }))
        if (normalizedAction === 'verify') {
            return Object.freeze({
                schemaVersion: 1,
                action: normalizedAction,
                target: ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_TARGET,
                migrationId: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
                schemaOnly: true,
                writerInvocation: false,
                backfillInvocation: false,
                deliveryInvocation: false,
                productionMutationAllowed: false,
                statementsApplied: 0,
                before,
                after: before,
            })
        }

        assertFreshSchemaAdmission(before)
        const applied = await applyMigration({
            pool,
            databaseUrl,
            target: ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_TARGET,
        })
        const statementsApplied = Number(applied?.statements)
        if (!Number.isSafeInteger(statementsApplied) || statementsApplied < 1 || applied?.applied !== true) {
            throw failure('ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_APPLY_REPORT_INVALID')
        }
        const after = summarizedPreflight(await preflight({
            pool,
            databaseUrl,
            target: ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_TARGET,
        }))
        assertAppliedSchemaAdmission(after)
        return Object.freeze({
            schemaVersion: 1,
            action: normalizedAction,
            target: ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_TARGET,
            migrationId: ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
            schemaOnly: true,
            writerInvocation: false,
            backfillInvocation: false,
            deliveryInvocation: false,
            productionMutationAllowed: false,
            statementsApplied,
            before,
            after,
        })
    } finally {
        if (lockClient && lockAcquired) {
            try { await releaseLock(lockClient) } catch { /* preserve the guarded operation outcome */ }
        }
        if (lockClient) lockClient.release()
        await pool.end()
    }
}

const thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
    const { action } = parseAtendimentoCrmCoreIdentitySchemaStagingInvocation(process.argv.slice(2))
    try {
        const report = await runAtendimentoCrmCoreIdentitySchemaStaging({ action })
        process.stdout.write(`${JSON.stringify(report)}\n`)
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'ATENDIMENTO_CRM_CORE_IDENTITY_SCHEMA_STAGING_FAILED'}\n`)
        process.exitCode = 1
    }
}
