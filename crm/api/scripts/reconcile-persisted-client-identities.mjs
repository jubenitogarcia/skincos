#!/usr/bin/env node

import pg from 'pg'
import {
    assertIdentityProjectionCanBeMaterialized,
    buildPersistedConfirmedIdentityComponents,
    recordIdentityProjectionMaterialization,
} from '../server/atendimento/identityProjection.js'
import { IDENTITY_GRAPH_LOCK_KEY } from '../server/atendimento/identityReviewWorkflow.js'
import {
    asRecoverableIdentityMaterializationError,
    configureIdentityMaterializationTimeouts,
    loadOptionalSupplementalLeadSources,
} from '../server/atendimento/identityMaterializationRuntime.js'
import {
    assertIdentityMaterializationApplyCheckpoint,
    assertIdentityMaterializationDatabase,
    assertIdentityMaterializationDestination,
    assertIdentityMaterializationSchemaReady,
    fingerprintIdentityMaterializationSource,
    identityMaterializationCheckpoint,
    writeIdentityMaterializationCheckpoint,
} from '../server/atendimento/identityMaterializationSafety.js'

const args = process.argv.slice(2)
const apply = args.length === 1 && args[0] === '--apply'
if (args.length > 1 || (args.length === 1 && !apply)) {
    throw new Error('Use sem argumentos para dry-run ou exclusivamente --apply para materializar o grafo persistido.')
}

const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const checkpointFile = String(process.env.CLIENT_IDENTITY_PROJECTION_CHECKPOINT || '').trim()
const checkpointOutput = String(process.env.CLIENT_IDENTITY_PROJECTION_CHECKPOINT_OUTPUT || '').trim()
if (!databaseUrl) throw new Error('DATABASE_URL_not_configured')
assertIdentityMaterializationDestination(databaseUrl)

const OPERATION = 'persisted_client_identity_projection'

async function loadInputs(client) {
    const registrations = await client.query(`select source_client_id as id, canonical_name as name
        from crm_atendimento.app_client_registrations`)
    const canonicalClients = await client.query(`select id::text, merged_into_id::text as "mergedIntoId", canonical_name as name
        from crm_atendimento.canonical_clients`)
    const caixaCustomers = await client.query(`select id::text as id, name from crm_caixa.customers`)
    const registrationCaixaLinks = await client.query(`select app_registration_id as "registrationId",
            caixa_customer_id::text as "caixaCustomerId", status
        from crm_atendimento.app_registration_caixa_links`)
    const registrationAttendanceLinks = await client.query(`select l.app_registration_id as "registrationId",
            l.client_id::text as "attendanceClientId", l.status
        from crm_atendimento.app_registration_attendance_links l
        join crm_atendimento.canonical_clients c on c.id=l.client_id`)
    const attendanceCaixaLinks = await client.query(`select l.client_id::text as "attendanceClientId",
            l.caixa_customer_id::text as "caixaCustomerId", l.status
        from crm_atendimento.client_caixa_links l
        join crm_atendimento.canonical_clients c on c.id=l.client_id`)
    const supplemental = await loadOptionalSupplementalLeadSources(client)
    return {
        registrations: registrations.rows,
        leadProfiles: supplemental.profiles,
        canonicalClients: canonicalClients.rows,
        caixaCustomers: caixaCustomers.rows,
        registrationCaixaLinks: registrationCaixaLinks.rows,
        registrationAttendanceLinks: registrationAttendanceLinks.rows,
        attendanceCaixaLinks: attendanceCaixaLinks.rows,
        leadProfileRegistrationLinks: supplemental.appLinks,
        leadProfileCaixaLinks: supplemental.caixaLinks,
        supplementalLeadSources: supplemental.availability,
    }
}

function buildProjection(inputs) {
    return buildPersistedConfirmedIdentityComponents(inputs)
}

function projectionSummary(inputs, components) {
    return {
        source: {
            registrations: inputs.registrations.length,
            leadProfiles: inputs.leadProfiles.length,
            canonicalClients: inputs.canonicalClients.length,
            caixaCustomers: inputs.caixaCustomers.length,
            registrationCaixaLinks: inputs.registrationCaixaLinks.length,
            registrationAttendanceLinks: inputs.registrationAttendanceLinks.length,
            attendanceCaixaLinks: inputs.attendanceCaixaLinks.length,
            leadProfileRegistrationLinks: inputs.leadProfileRegistrationLinks.length,
            leadProfileCaixaLinks: inputs.leadProfileCaixaLinks.length,
            supplementalLeadSources: inputs.supplementalLeadSources,
        },
        components: components.length,
        members: components.reduce((total, component) => total + component.members.length, 0),
        multiSourceComponents: components.filter((component) => component.sourceTypes.length > 1).length,
    }
}

async function materialize(client, inputs, components) {
    await configureIdentityMaterializationTimeouts(client)
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
    const projection = await assertIdentityProjectionCanBeMaterialized(client, components)
    const resultingIdentityIds = new Map()
    for (const component of components) {
        const identity = await client.query(`insert into crm_atendimento.global_client_identities(
                component_key,canonical_name,source_types)
            values($1,$2,$3::jsonb)
            on conflict(component_key) do update set
                canonical_name=excluded.canonical_name,
                source_types=excluded.source_types,
                updated_at=now()
            returning id`, [
            component.componentKey,
            component.preferredName,
            JSON.stringify(component.sourceTypes),
        ])
        const identityId = String(identity.rows[0]?.id || '').trim()
        if (!identityId) throw new Error('IDENTITY_PROJECTION_IDENTITY_ID_MISSING')
        resultingIdentityIds.set(component.componentKey, identityId)
        if (!component.members.length) continue
        await client.query(`insert into crm_atendimento.global_client_identity_members(
                identity_id,source_type,source_id)
            select x.identity_id::uuid,x.source_type,x.source_id
            from jsonb_to_recordset($1::jsonb) as x(identity_id text,source_type text,source_id text)
            on conflict(source_type,source_id) do update set
                identity_id=excluded.identity_id,updated_at=now()`, [
            JSON.stringify(component.members.map((member) => ({
                identity_id: identityId,
                source_type: member.sourceType,
                source_id: member.sourceId,
            }))),
        ])
    }
    const ledger = await recordIdentityProjectionMaterialization(client, {
        origin: OPERATION,
        components,
        resultingIdentityIds,
        previousIdentityByMember: projection.previousIdentityByMember,
    })
    return {
        ...projectionSummary(inputs, components),
        impactedIdentityIds: projection.impactedIdentityIds.length,
        identityProjectionLedger: ledger,
    }
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: 'crm-persisted-client-identity-projection' })
try {
    const verificationClient = await pool.connect()
    try {
        await assertIdentityMaterializationDatabase(verificationClient, databaseUrl)
        await assertIdentityMaterializationSchemaReady(verificationClient)
    } finally {
        verificationClient.release()
    }

    const input = await loadInputs(pool)
    const sourceFingerprint = fingerprintIdentityMaterializationSource(input)
    const checkpoint = identityMaterializationCheckpoint({ operation: OPERATION, sourceFingerprint })
    const components = buildProjection(input)
    const summary = projectionSummary(input, components)
    if (!apply) {
        const writtenCheckpoint = await writeIdentityMaterializationCheckpoint({ outputFile: checkpointOutput, checkpoint })
        console.log(JSON.stringify({
            ok: true,
            dryRun: true,
            checkpoint,
            checkpointOutput: writtenCheckpoint,
            ...summary,
        }, null, 2))
        process.exitCode = 0
    } else {
        if (!checkpointFile) throw new Error('IDENTITY_MATERIALIZATION_CHECKPOINT_REQUIRED')
        const client = await pool.connect()
        let transactionOpen = false
        try {
            await client.query('begin')
            transactionOpen = true
            await configureIdentityMaterializationTimeouts(client)
            await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
            const currentInput = await loadInputs(client)
            const currentFingerprint = fingerprintIdentityMaterializationSource(currentInput)
            const currentComponents = buildProjection(currentInput)
            await assertIdentityMaterializationApplyCheckpoint({
                operation: OPERATION,
                confirmation: process.env.CLIENT_IDENTITY_PROJECTION_APPLY_CONFIRM,
                targetConfirmation: process.env.CLIENT_IDENTITY_PROJECTION_APPLY_TARGET,
                checkpointFile,
                sourceFingerprint: currentFingerprint,
            })
            const result = await materialize(client, currentInput, currentComponents)
            await client.query('commit')
            transactionOpen = false
            console.log(JSON.stringify({
                ok: true,
                dryRun: false,
                checkpoint: identityMaterializationCheckpoint({ operation: OPERATION, sourceFingerprint: currentFingerprint }),
                ...result,
            }, null, 2))
        } catch (error) {
            if (transactionOpen) {
                try { await client.query('rollback') } catch { /* preserve original failure */ }
            }
            throw asRecoverableIdentityMaterializationError(error)
        } finally {
            client.release()
        }
    }
} finally {
    await pool.end()
}
