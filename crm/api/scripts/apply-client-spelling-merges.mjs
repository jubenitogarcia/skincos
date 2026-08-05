import pg from 'pg'
import { buildAnchoredSpellingMergePlan } from '../server/atendimento/clientIdentity.js'
import { IDENTITY_GRAPH_LOCK_KEY } from '../server/atendimento/identityReviewWorkflow.js'
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
const checkpointFile = String(process.env.CLIENT_SPELLING_MERGES_CHECKPOINT || '').trim()
const checkpointOutput = String(process.env.CLIENT_SPELLING_MERGES_CHECKPOINT_OUTPUT || '').trim()
if (!databaseUrl) throw new Error('DATABASE_URL_not_configured')
assertIdentityMaterializationDestination(databaseUrl)

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: 'crm-client-spelling-merges' })

async function loadSpellingMergePlan(client) {
    const mergedColumn = await client.query(`select exists(
        select 1 from information_schema.columns
        where table_schema='crm_atendimento' and table_name='canonical_clients' and column_name='merged_into_id'
    ) as present`)
    const activeClientClause = mergedColumn.rows[0]?.present ? 'where merged_into_id is null' : ''
    const [clients, suggestions, links] = await Promise.all([
        client.query(`select id, name_key as "nameKey", attendance_count as "attendanceCount"
            from crm_atendimento.canonical_clients ${activeClientClause}`),
        client.query(`select id, left_client_id as "leftClientId", right_client_id as "rightClientId",
            similarity::float, status from crm_atendimento.client_merge_suggestions where status='pending'`),
        client.query(`select client_id as "clientId", caixa_customer_id as "caixaCustomerId", status
            from crm_atendimento.client_caixa_links where status not in ('rejected')`),
    ])
    return buildAnchoredSpellingMergePlan({ clients: clients.rows, suggestions: suggestions.rows, caixaLinks: links.rows })
}

async function assertSpellingMergesDoNotBypassIdentityReview(client, merges) {
    const clientIds = [...new Set(merges.flatMap((merge) => [merge.sourceClientId, merge.targetClientId]).map(String).filter(Boolean))]
    if (!clientIds.length) return
    const availability = await client.query(`select to_regclass('crm_atendimento.global_client_identity_members') as members`)
    if (!availability.rows[0]?.members) return
    const existing = await client.query(`select 1
        from crm_atendimento.global_client_identity_members
        where source_type='attendance_client' and source_id=any($1::text[])
        limit 1 for update`, [clientIds])
    // A canonical merge changes the meaning of every projected attendance
    // member.  Once an identity graph exists, the only safe path is the
    // reviewed workflow, which records lineage and protects commercial state.
    if (existing.rows[0]) throw new Error('CLIENT_SPELLING_MERGE_IDENTITY_REVIEW_REQUIRED')
}

const db = await pool.connect()
try {
    await assertIdentityMaterializationDatabase(db, databaseUrl)
    await assertIdentityMaterializationSchemaReady(db)
    let plan = await loadSpellingMergePlan(db)
    let sourceFingerprint = fingerprintIdentityMaterializationSource(plan)
    let checkpoint = identityMaterializationCheckpoint({ operation: 'client_spelling_merges', sourceFingerprint })
    let writtenCheckpoint = !apply
        ? await writeIdentityMaterializationCheckpoint({ outputFile: checkpointOutput, checkpoint })
        : null
    let runId = null
    if (apply) {
        await db.query('begin')
        try {
            await configureIdentityMaterializationTimeouts(db)
            await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
            await db.query(`select pg_advisory_xact_lock(hashtext('crm_atendimento.client_identity_reconciliation'))`)
            plan = await loadSpellingMergePlan(db)
            sourceFingerprint = fingerprintIdentityMaterializationSource(plan)
            checkpoint = identityMaterializationCheckpoint({ operation: 'client_spelling_merges', sourceFingerprint })
            await assertIdentityMaterializationApplyCheckpoint({
                operation: 'client_spelling_merges',
                confirmation: process.env.CLIENT_SPELLING_MERGES_APPLY_CONFIRM,
                targetConfirmation: process.env.CLIENT_SPELLING_MERGES_APPLY_TARGET,
                checkpointFile,
                sourceFingerprint,
            })
            await assertSpellingMergesDoNotBypassIdentityReview(db, plan.merges)
            const run = await db.query(`insert into crm_atendimento.client_identity_runs(mode,summary)
                values('apply-spelling-merges',$1::jsonb) returning id`, [JSON.stringify(plan.summary)])
            runId = run.rows[0].id
            if (plan.acceptedSuggestionIds.length) {
                const accepted = await db.query(`update crm_atendimento.client_merge_suggestions
                    set status='auto_merged',run_id=$2,updated_at=now()
                    where id=any($1::uuid[]) and status='pending' returning id`,
                [plan.acceptedSuggestionIds, runId])
                if (accepted.rowCount !== plan.acceptedSuggestionIds.length) {
                    throw new Error('CLIENT_SPELLING_MERGE_PLAN_STALE')
                }
            }
            for (const merge of plan.merges) {
                await db.query(`insert into crm_atendimento.client_spelling_merges(
                        source_client_id,target_client_id,caixa_customer_id,method,confidence,run_id)
                    values($1,$2,$3,$4,$5,$6)
                    on conflict(source_client_id) do update set target_client_id=excluded.target_client_id,
                        caixa_customer_id=excluded.caixa_customer_id,method=excluded.method,
                        confidence=excluded.confidence,run_id=excluded.run_id,updated_at=now()`,
                [merge.sourceClientId, merge.targetClientId, merge.caixaCustomerId, merge.method, merge.confidence, runId])
                await db.query(`update crm_atendimento.canonical_clients set merged_into_id=$2,updated_at=now() where id=$1`,
                    [merge.sourceClientId, merge.targetClientId])
                await db.query(`update crm_atendimento.client_caixa_links
                    set status='auto_confirmed_spelling',updated_at=now()
                    where client_id=$1 and caixa_customer_id=$2 and status not in ('confirmed','rejected','auto_confirmed')`,
                [merge.sourceClientId, merge.caixaCustomerId])
            }
            await db.query('commit')
        } catch (error) {
            await db.query('rollback')
            throw asRecoverableIdentityMaterializationError(error)
        }
    }
    console.log(JSON.stringify({
        ok: true,
        dryRun: !apply,
        runId,
        dateDistanceUsed: false,
        checkpoint,
        checkpointOutput: writtenCheckpoint,
        ...plan.summary,
    }, null, 2))
} finally {
    db.release()
    await pool.end()
}
