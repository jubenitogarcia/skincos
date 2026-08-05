import pg from 'pg'
import { buildClientIdentityPlan } from '../server/atendimento/clientIdentity.js'
import { IDENTITY_GRAPH_LOCK_KEY } from '../server/atendimento/identityReviewWorkflow.js'
import {
    buildCanonicalClientAliasLinks,
    collectAutomaticIdentityLinkTransitions,
    createCanonicalClientAliasResolver,
    guardAutoConfirmedIdentityLinkProposals,
    recordIdentityProjectionMaterialization,
} from '../server/atendimento/identityProjection.js'
import {
    asRecoverableIdentityMaterializationError,
    configureIdentityMaterializationTimeouts,
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

const apply = process.argv.includes('--apply')
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const checkpointFile = String(process.env.CLIENT_IDENTITY_CHECKPOINT || '').trim()
const checkpointOutput = String(process.env.CLIENT_IDENTITY_CHECKPOINT_OUTPUT || '').trim()
if (!databaseUrl) throw new Error('DATABASE_URL_not_configured')
assertIdentityMaterializationDestination(databaseUrl)

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: 'crm-client-identity-reconciliation' })

function chunks(values, size = 750) {
    const output = []
    for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size))
    return output
}

async function loadInputs(client) {
    const attendances = await client.query(`select id, client_name as "clientName", unit_id as "unitId", procedure_id as "procedureId"
        from crm_atendimento.attendances where deleted_at is null and nullif(trim(client_name), '') is not null order by id`)
    const customers = await client.query(`select id, name from crm_caixa.customers order by id`)
    const sales = await client.query(`select s.customer_id as "customerId", s.unit_id as "unitId",
            coalesce(array_agg(distinct i.procedure_id) filter (where i.procedure_id is not null), '{}') as "procedureIds"
        from crm_caixa.sales s left join crm_caixa.sale_items i on i.sale_id = s.id
        where s.customer_id is not null group by s.customer_id, s.unit_id order by s.customer_id, s.unit_id`)
    return { attendances: attendances.rows, caixaCustomers: customers.rows, caixaSales: sales.rows }
}

async function insertJsonChunks(client, values, sql) {
    for (const batch of chunks(values)) await client.query(sql, [JSON.stringify(batch)])
}

async function upsertJsonChunksReturning(client, values, sql) {
    const rows = []
    for (const batch of chunks(values)) {
        const result = await client.query(sql, [JSON.stringify(batch)])
        rows.push(...(result.rows || []))
    }
    return rows
}

async function persistPlan(client, plan) {
    await configureIdentityMaterializationTimeouts(client)
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
    await client.query(`select pg_advisory_xact_lock(hashtext('crm_atendimento.client_identity_reconciliation'))`)
    const run = await client.query(`insert into crm_atendimento.client_identity_runs(mode, summary) values('apply', $1::jsonb) returning id`, [JSON.stringify(plan.summary)])
    const runId = run.rows[0].id

    await insertJsonChunks(client, plan.clients.map((item) => ({
        name_key: item.nameKey,
        canonical_name: item.canonicalName,
        attendance_count: item.attendanceCount,
    })), `insert into crm_atendimento.canonical_clients(name_key, canonical_name, attendance_count)
        select x.name_key, x.canonical_name, x.attendance_count
        from jsonb_to_recordset($1::jsonb) as x(name_key text, canonical_name text, attendance_count int)
        on conflict(name_key) do update set canonical_name=excluded.canonical_name,
            attendance_count=excluded.attendance_count, updated_at=now()`)

    const persistedClients = await client.query(`select id, name_key as "nameKey",merged_into_id as "mergedIntoId"
        from crm_atendimento.canonical_clients`)
    const idsByKey = new Map(persistedClients.rows.map((row) => [row.nameKey, row.id]))

    const aliases = plan.clients.flatMap((item) => item.aliases.map((alias) => ({
        client_id: idsByKey.get(item.nameKey),
        alias_name: alias.rawName,
        alias_key: item.nameKey,
        usage_count: alias.count,
    })))
    await insertJsonChunks(client, aliases, `insert into crm_atendimento.client_aliases(client_id, alias_name, alias_key, usage_count)
        select x.client_id::uuid, x.alias_name, x.alias_key, x.usage_count
        from jsonb_to_recordset($1::jsonb) as x(client_id text, alias_name text, alias_key text, usage_count int)
        on conflict(client_id, alias_name) do update set alias_key=excluded.alias_key,
            usage_count=excluded.usage_count, updated_at=now()`)

    const attendanceLinks = plan.assignments.map((item) => ({
        attendance_id: item.attendanceId,
        client_id: idsByKey.get(item.nameKey),
        original_name: item.originalName,
        run_id: runId,
    }))
    await insertJsonChunks(client, attendanceLinks, `insert into crm_atendimento.attendance_client_links(
            attendance_id, client_id, original_name, method, confidence, run_id)
        select x.attendance_id::uuid, x.client_id::uuid, x.original_name, 'exact_normalized', 1, x.run_id::uuid
        from jsonb_to_recordset($1::jsonb) as x(attendance_id text, client_id text, original_name text, run_id text)
        on conflict(attendance_id) do update set client_id=excluded.client_id,
            original_name=excluded.original_name, method=excluded.method, confidence=excluded.confidence,
            run_id=excluded.run_id, updated_at=now()`)

    const mergeSuggestions = plan.mergeSuggestions.map((item) => ({
        left_client_id: idsByKey.get(item.leftNameKey),
        right_client_id: idsByKey.get(item.rightNameKey),
        similarity: item.similarity,
        evidence: item.evidence,
        run_id: runId,
    }))
    await insertJsonChunks(client, mergeSuggestions, `insert into crm_atendimento.client_merge_suggestions(
            left_client_id, right_client_id, similarity, evidence, status, run_id)
        select x.left_client_id::uuid, x.right_client_id::uuid, x.similarity, x.evidence, 'pending', x.run_id::uuid
        from jsonb_to_recordset($1::jsonb) as x(left_client_id text, right_client_id text, similarity numeric, evidence jsonb, run_id text)
        on conflict(left_client_id, right_client_id) do update set similarity=excluded.similarity,
            evidence=excluded.evidence, run_id=excluded.run_id, updated_at=now()`)

    const caixaLinks = plan.caixaLinks.map((item) => ({
        client_id: idsByKey.get(item.attendanceNameKey),
        caixa_customer_id: item.caixaCustomerId,
        method: item.method,
        confidence: item.confidence,
        evidence: item.evidence,
        status: item.status,
        run_id: runId,
    }))
    const persistedCaixaLinks = await client.query(`select client_id::text as "clientId",
        caixa_customer_id::text as "caixaCustomerId",status from crm_atendimento.client_caixa_links`)
    const canonicalAliases = buildCanonicalClientAliasLinks({ canonicalClients: persistedClients.rows })
    const resolveCanonicalClient = createCanonicalClientAliasResolver({ canonicalAliases })
    const guardedCaixaLinks = guardAutoConfirmedIdentityLinkProposals({
        proposals: caixaLinks,
        persistedLinks: persistedCaixaLinks.rows,
        getSourceId: (link) => link.clientId ?? link.client_id,
        getTargetId: (link) => link.caixaCustomerId ?? link.caixa_customer_id,
        normalizeSourceId: resolveCanonicalClient,
    })
    const automaticLinkGuards = {
        attendanceCaixaDemoted: guardedCaixaLinks.filter((link) => link?.evidence?.identityLinkGuard).length,
    }
    const effectiveCaixaLinks = await upsertJsonChunksReturning(client, guardedCaixaLinks, `insert into crm_atendimento.client_caixa_links(
            client_id, caixa_customer_id, method, confidence, evidence, status, run_id)
        select x.client_id::uuid, x.caixa_customer_id::uuid, x.method, x.confidence, x.evidence, x.status, x.run_id::uuid
        from jsonb_to_recordset($1::jsonb) as x(client_id text, caixa_customer_id text, method text, confidence numeric, evidence jsonb, status text, run_id text)
        on conflict(client_id, caixa_customer_id) do update set method=excluded.method,
            confidence=excluded.confidence, evidence=excluded.evidence,
            status=case when crm_atendimento.client_caixa_links.status in ('confirmed','rejected','auto_confirmed_spelling')
                then crm_atendimento.client_caixa_links.status else excluded.status end,
            run_id=excluded.run_id, updated_at=now()
        returning client_id::text as "clientId",caixa_customer_id::text as "caixaCustomerId",status`)
    const sourceLinkTransitions = collectAutomaticIdentityLinkTransitions({
        effectiveLinks: effectiveCaixaLinks,
        persistedLinks: persistedCaixaLinks.rows,
        linkType: 'attendance_caixa',
        sourceType: 'attendance_client',
        targetType: 'caixa_customer',
        getSourceId: (link) => link.clientId ?? link.client_id,
        getTargetId: (link) => link.caixaCustomerId ?? link.caixa_customer_id,
    })
    const identityProjectionLedger = await recordIdentityProjectionMaterialization(client, {
        origin: 'client_identity_reconciliation',
        sourceLinkTransitions,
    })
    await client.query(`update crm_atendimento.client_identity_runs set summary=$2::jsonb where id=$1::uuid`, [
        runId,
        JSON.stringify({ ...plan.summary, automaticLinkGuards, identityProjectionLedger }),
    ])
    return { runId, identityProjectionLedger }
}

const connection = await pool.connect()
try {
    await assertIdentityMaterializationDatabase(connection, databaseUrl)
    await assertIdentityMaterializationSchemaReady(connection)
    const input = await loadInputs(connection)
    const plan = buildClientIdentityPlan(input)
    const sourceFingerprint = fingerprintIdentityMaterializationSource(input)
    const checkpoint = identityMaterializationCheckpoint({ operation: 'client_identity_reconciliation', sourceFingerprint })
    const writtenCheckpoint = !apply
        ? await writeIdentityMaterializationCheckpoint({ outputFile: checkpointOutput, checkpoint })
        : null
    let persisted = null
    if (apply) {
        await assertIdentityMaterializationApplyCheckpoint({
            operation: 'client_identity_reconciliation',
            confirmation: process.env.CLIENT_IDENTITY_APPLY_CONFIRM,
            targetConfirmation: process.env.CLIENT_IDENTITY_APPLY_TARGET,
            checkpointFile,
            sourceFingerprint,
        })
        await connection.query('begin')
        try {
            persisted = await persistPlan(connection, plan)
            await connection.query('commit')
        } catch (error) {
            await connection.query('rollback')
            throw asRecoverableIdentityMaterializationError(error)
        }
    }
    console.log(JSON.stringify({
        ok: true,
        dryRun: !apply,
        runId: persisted?.runId || null,
        identityProjectionLedger: persisted?.identityProjectionLedger || null,
        checkpoint,
        checkpointOutput: writtenCheckpoint,
        dateDistanceUsed: false,
        policy: {
            automaticAttendanceUnification: 'exact normalized name only',
            spellingErrors: 'review suggestions only',
            caixaAutoConfirmation: 'unique exact name with shared unit and official procedure',
        },
        ...plan.summary,
    }, null, 2))
} finally {
    connection.release()
    await pool.end()
}
