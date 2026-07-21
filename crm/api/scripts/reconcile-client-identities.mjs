import pg from 'pg'
import { buildClientIdentityPlan } from '../server/atendimento/clientIdentity.js'

const apply = process.argv.includes('--apply')
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (!databaseUrl) throw new Error('DATABASE_URL_not_configured')

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: 'crm-client-identity-reconciliation' })

const schemaStatements = [
    `create table if not exists crm_atendimento.client_identity_runs (
        id uuid primary key default gen_random_uuid(),
        mode text not null,
        summary jsonb not null,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.canonical_clients (
        id uuid primary key default gen_random_uuid(),
        canonical_name text not null,
        name_key text unique not null,
        attendance_count int not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.client_aliases (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references crm_atendimento.canonical_clients(id) on delete cascade,
        alias_name text not null,
        alias_key text not null,
        usage_count int not null default 0,
        source text not null default 'attendance',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(client_id, alias_name)
    )`,
    `create table if not exists crm_atendimento.attendance_client_links (
        attendance_id uuid primary key references crm_atendimento.attendances(id) on delete cascade,
        client_id uuid not null references crm_atendimento.canonical_clients(id) on delete restrict,
        original_name text not null,
        method text not null,
        confidence numeric(5,4) not null,
        run_id uuid references crm_atendimento.client_identity_runs(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.client_merge_suggestions (
        id uuid primary key default gen_random_uuid(),
        left_client_id uuid not null references crm_atendimento.canonical_clients(id) on delete cascade,
        right_client_id uuid not null references crm_atendimento.canonical_clients(id) on delete cascade,
        similarity numeric(5,4) not null,
        evidence jsonb not null default '{}'::jsonb,
        status text not null default 'pending',
        run_id uuid references crm_atendimento.client_identity_runs(id) on delete set null,
        reviewed_by text,
        reviewed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(left_client_id, right_client_id)
    )`,
    `create table if not exists crm_atendimento.client_caixa_links (
        id uuid primary key default gen_random_uuid(),
        client_id uuid not null references crm_atendimento.canonical_clients(id) on delete cascade,
        caixa_customer_id uuid not null references crm_caixa.customers(id) on delete cascade,
        method text not null,
        confidence numeric(5,4) not null,
        evidence jsonb not null default '{}'::jsonb,
        status text not null,
        run_id uuid references crm_atendimento.client_identity_runs(id) on delete set null,
        reviewed_by text,
        reviewed_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(client_id, caixa_customer_id)
    )`,
    `create index if not exists crm_atendimento_client_aliases_key_idx on crm_atendimento.client_aliases(alias_key)`,
    `create index if not exists crm_atendimento_attendance_client_links_client_idx on crm_atendimento.attendance_client_links(client_id)`,
    `create index if not exists crm_atendimento_client_merge_suggestions_status_idx on crm_atendimento.client_merge_suggestions(status, similarity desc)`,
    `create index if not exists crm_atendimento_client_caixa_links_status_idx on crm_atendimento.client_caixa_links(status, confidence desc)`,
]

function chunks(values, size = 750) {
    const output = []
    for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size))
    return output
}

async function loadInputs(client) {
    const attendances = await client.query(`select id, client_name as "clientName", unit_id as "unitId", procedure_id as "procedureId"
        from crm_atendimento.attendances where deleted_at is null and nullif(trim(client_name), '') is not null`)
    const customers = await client.query(`select id, name from crm_caixa.customers`)
    const sales = await client.query(`select s.customer_id as "customerId", s.unit_id as "unitId",
            coalesce(array_agg(distinct i.procedure_id) filter (where i.procedure_id is not null), '{}') as "procedureIds"
        from crm_caixa.sales s left join crm_caixa.sale_items i on i.sale_id = s.id
        where s.customer_id is not null group by s.customer_id, s.unit_id`)
    return { attendances: attendances.rows, caixaCustomers: customers.rows, caixaSales: sales.rows }
}

async function insertJsonChunks(client, values, sql) {
    for (const batch of chunks(values)) await client.query(sql, [JSON.stringify(batch)])
}

async function persistPlan(client, plan) {
    await client.query(`select pg_advisory_xact_lock(hashtext('crm_atendimento.client_identity_reconciliation'))`)
    for (const statement of schemaStatements) await client.query(statement)
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

    const persistedClients = await client.query(`select id, name_key from crm_atendimento.canonical_clients`)
    const idsByKey = new Map(persistedClients.rows.map((row) => [row.name_key, row.id]))

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
    await insertJsonChunks(client, caixaLinks, `insert into crm_atendimento.client_caixa_links(
            client_id, caixa_customer_id, method, confidence, evidence, status, run_id)
        select x.client_id::uuid, x.caixa_customer_id::uuid, x.method, x.confidence, x.evidence, x.status, x.run_id::uuid
        from jsonb_to_recordset($1::jsonb) as x(client_id text, caixa_customer_id text, method text, confidence numeric, evidence jsonb, status text, run_id text)
        on conflict(client_id, caixa_customer_id) do update set method=excluded.method,
            confidence=excluded.confidence, evidence=excluded.evidence,
            status=case when crm_atendimento.client_caixa_links.status in ('confirmed','rejected')
                then crm_atendimento.client_caixa_links.status else excluded.status end,
            run_id=excluded.run_id, updated_at=now()`)
    return runId
}

const connection = await pool.connect()
try {
    const input = await loadInputs(connection)
    const plan = buildClientIdentityPlan(input)
    let runId = null
    if (apply) {
        await connection.query('begin')
        try {
            runId = await persistPlan(connection, plan)
            await connection.query('commit')
        } catch (error) {
            await connection.query('rollback')
            throw error
        }
    }
    console.log(JSON.stringify({
        ok: true,
        dryRun: !apply,
        runId,
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
