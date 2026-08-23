import pg from 'pg'
import { buildAnchoredSpellingMergePlan } from '../server/atendimento/clientIdentity.js'
import { IDENTITY_GRAPH_LOCK_KEY } from '../server/atendimento/identityReviewWorkflow.js'

const apply = process.argv.includes('--apply')
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (!databaseUrl) throw new Error('DATABASE_URL_not_configured')

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

const db = await pool.connect()
try {
    let plan = await loadSpellingMergePlan(db)
    let runId = null
    if (apply) {
        await db.query('begin')
        try {
            await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
            await db.query(`select pg_advisory_xact_lock(hashtext('crm_atendimento.client_identity_reconciliation'))`)
            plan = await loadSpellingMergePlan(db)
            await db.query(`alter table crm_atendimento.canonical_clients add column if not exists merged_into_id uuid references crm_atendimento.canonical_clients(id) on delete restrict`)
            await db.query(`create table if not exists crm_atendimento.client_spelling_merges (
                source_client_id uuid primary key references crm_atendimento.canonical_clients(id) on delete restrict,
                target_client_id uuid not null references crm_atendimento.canonical_clients(id) on delete restrict,
                caixa_customer_id uuid not null references crm_caixa.customers(id) on delete restrict,
                method text not null,
                confidence numeric(5,4) not null,
                run_id uuid references crm_atendimento.client_identity_runs(id) on delete set null,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )`)
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
            await db.query(`create or replace view crm_atendimento.resolved_attendance_clients as
                select l.attendance_id,l.client_id as source_client_id,coalesce(c.merged_into_id,c.id) as client_id,
                    l.original_name,l.method,l.confidence
                from crm_atendimento.attendance_client_links l
                join crm_atendimento.canonical_clients c on c.id=l.client_id`)
            await db.query(`create or replace view crm_atendimento.resolved_client_caixa_links as
                select coalesce(c.merged_into_id,c.id) as client_id,l.client_id as source_client_id,
                    l.caixa_customer_id,l.method,l.confidence,l.status,l.evidence
                from crm_atendimento.client_caixa_links l
                join crm_atendimento.canonical_clients c on c.id=l.client_id`)
            await db.query('commit')
        } catch (error) {
            await db.query('rollback')
            throw error
        }
    }
    console.log(JSON.stringify({ ok: true, dryRun: !apply, runId, dateDistanceUsed: false, ...plan.summary }, null, 2))
} finally {
    db.release()
    await pool.end()
}
