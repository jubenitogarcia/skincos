import { promises as fs } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import {
    buildClientRegistrationIdentityPlan,
    buildConfirmedGlobalIdentityComponents,
} from '../server/atendimento/clientRegistrationIdentity.js'

const apply = process.argv.includes('--apply')
const inputFile = String(process.env.CLIENT_REGISTRATION_CSV || '').trim()
const outputDirectory = String(process.env.CLIENT_REGISTRATION_RECONCILIATION_OUTPUT || '').trim()
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (!inputFile) throw new Error('CLIENT_REGISTRATION_CSV_not_configured')
if (!outputDirectory) throw new Error('CLIENT_REGISTRATION_RECONCILIATION_OUTPUT_not_configured')
if (!databaseUrl) throw new Error('DATABASE_URL_not_configured')
if (apply && process.env.CLIENT_REGISTRATION_APPLY_CONFIRM !== 'UNIFICAR') throw new Error('CLIENT_REGISTRATION_APPLY_CONFIRM_UNIFICAR_required')

function parseCsv(text) {
    const rows = []; let row = []; let value = ''; let quoted = false
    for (let index = 0; index < text.length; index += 1) {
        const current = text[index]
        if (quoted) {
            if (current === '"' && text[index + 1] === '"') { value += '"'; index += 1 } else if (current === '"') quoted = false; else value += current
        } else if (current === '"') quoted = true
        else if (current === ',') { row.push(value); value = '' }
        else if (current === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = '' }
        else value += current
    }
    if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row) }
    const [header = [], ...records] = rows
    return records.filter((record) => record.some((item) => item.trim())).map((record) => Object.fromEntries(header.map((key, index) => [key, record[index] || ''])))
}

function toCsv(rows, header) {
    const escape = (value) => `"${(typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).replaceAll('"', '""')}"`
    return [header.map(escape).join(','), ...rows.map((row) => header.map((key) => escape(row[key])).join(','))].join('\n') + '\n'
}

function chunks(values, size = 500) {
    return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))
}

async function insertJsonChunks(client, values, sql) {
    for (const chunk of chunks(values)) if (chunk.length) await client.query(sql, [JSON.stringify(chunk)])
}

const schemaStatements = [
    `create table if not exists crm_atendimento.app_registration_import_runs (
        id uuid primary key default gen_random_uuid(), source_file text not null, summary jsonb not null,
        created_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.app_client_registrations (
        source_client_id text primary key, source_rows int not null, canonical_name text not null, name_key text not null,
        name_variants jsonb not null default '[]'::jsonb, phone_keys jsonb not null default '[]'::jsonb,
        email_keys jsonb not null default '[]'::jsonb, cpf_keys jsonb not null default '[]'::jsonb,
        unit_slugs jsonb not null default '[]'::jsonb, last_run_id uuid references crm_atendimento.app_registration_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.app_registration_caixa_links (
        app_registration_id text not null references crm_atendimento.app_client_registrations(source_client_id) on delete cascade,
        caixa_customer_id uuid not null references crm_caixa.customers(id) on delete restrict,
        method text not null, confidence numeric(5,4) not null, status text not null, evidence jsonb not null default '{}'::jsonb,
        run_id uuid references crm_atendimento.app_registration_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        primary key(app_registration_id, caixa_customer_id)
    )`,
    `create table if not exists crm_atendimento.app_registration_attendance_links (
        app_registration_id text not null references crm_atendimento.app_client_registrations(source_client_id) on delete cascade,
        client_id uuid not null references crm_atendimento.canonical_clients(id) on delete restrict,
        method text not null, confidence numeric(5,4) not null, status text not null, evidence jsonb not null default '{}'::jsonb,
        run_id uuid references crm_atendimento.app_registration_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        primary key(app_registration_id, client_id)
    )`,
    `create table if not exists crm_atendimento.global_client_identities (
        id uuid primary key default gen_random_uuid(), component_key text not null unique, canonical_name text not null,
        source_types jsonb not null, last_run_id uuid references crm_atendimento.app_registration_import_runs(id) on delete set null,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.global_client_identity_members (
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete cascade,
        source_type text not null check(source_type in ('app_registration','caixa_customer','attendance_client')),
        source_id text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        primary key(source_type, source_id)
    )`,
    `create index if not exists crm_atendimento_app_registration_caixa_status_idx on crm_atendimento.app_registration_caixa_links(status, confidence desc)`,
    `create index if not exists crm_atendimento_app_registration_attendance_status_idx on crm_atendimento.app_registration_attendance_links(status, confidence desc)`,
]

async function loadInputs(pool) {
    const [attendances, customers, sales, saleCount, canonicalClients] = await Promise.all([
        pool.query(`select id, client_name as "clientName", unit_id as "unitId", procedure_id as "procedureId"
            from crm_atendimento.attendances where deleted_at is null and nullif(trim(client_name), '') is not null`),
        pool.query(`select id, name, phone_key as "phoneKey" from crm_caixa.customers`),
        pool.query(`select s.customer_id as "customerId", s.unit_id as "unitId", u.slug as "unitSlug",
                coalesce(array_agg(distinct i.procedure_id) filter (where i.procedure_id is not null), '{}') as "procedureIds"
            from crm_caixa.sales s join crm_atendimento.units u on u.id=s.unit_id
            left join crm_caixa.sale_items i on i.sale_id=s.id where s.customer_id is not null
            group by s.customer_id,s.unit_id,u.slug`),
        pool.query(`select count(*)::int as sales from crm_caixa.sales`),
        pool.query(`select id::text, coalesce(merged_into_id,id)::text as "resolvedId", canonical_name as name, name_key as "nameKey"
            from crm_atendimento.canonical_clients`),
    ])
    return { attendances: attendances.rows, customers: customers.rows, sales: sales.rows, saleCount: saleCount.rows[0].sales, canonicalClients: canonicalClients.rows }
}

function enrichAttendanceLinks(plan, canonicalClients) {
    const clientIdByNameKey = new Map(canonicalClients.map((item) => [item.nameKey, item.resolvedId]))
    return plan.registrationAttendanceLinks.map((item) => ({ ...item, attendanceClientId: clientIdByNameKey.get(item.attendanceNameKey) }))
        .filter((item) => item.attendanceClientId)
}

async function persistPlan(client, { plan, attendanceLinks, canonicalClients, customers, sourceFile }) {
    await client.query(`select pg_advisory_xact_lock(hashtext('crm_atendimento.app_client_registration_reconciliation'))`)
    for (const statement of schemaStatements) await client.query(statement)
    const run = await client.query(`insert into crm_atendimento.app_registration_import_runs(source_file, summary) values($1,$2::jsonb) returning id`, [sourceFile, JSON.stringify(plan.summary)])
    const runId = run.rows[0].id
    await insertJsonChunks(client, plan.registrations.map((item) => ({
        source_client_id: item.id, source_rows: item.sourceRows, canonical_name: item.name, name_key: item.nameKey,
        name_variants: item.names, phone_keys: item.phones, email_keys: item.emails, cpf_keys: item.cpfs, unit_slugs: item.units, run_id: runId,
    })), `insert into crm_atendimento.app_client_registrations(
            source_client_id,source_rows,canonical_name,name_key,name_variants,phone_keys,email_keys,cpf_keys,unit_slugs,last_run_id)
        select x.source_client_id,x.source_rows,x.canonical_name,x.name_key,x.name_variants,x.phone_keys,x.email_keys,x.cpf_keys,x.unit_slugs,x.run_id::uuid
        from jsonb_to_recordset($1::jsonb) as x(source_client_id text,source_rows int,canonical_name text,name_key text,name_variants jsonb,phone_keys jsonb,email_keys jsonb,cpf_keys jsonb,unit_slugs jsonb,run_id text)
        on conflict(source_client_id) do update set source_rows=excluded.source_rows,canonical_name=excluded.canonical_name,
            name_key=excluded.name_key,name_variants=excluded.name_variants,phone_keys=excluded.phone_keys,email_keys=excluded.email_keys,
            cpf_keys=excluded.cpf_keys,unit_slugs=excluded.unit_slugs,last_run_id=excluded.last_run_id,updated_at=now()`)
    await insertJsonChunks(client, plan.registrationCaixaLinks.map((item) => ({
        app_registration_id: item.registrationId, caixa_customer_id: item.caixaCustomerId, method: item.method,
        confidence: item.confidence, status: item.status, evidence: item.evidence, run_id: runId,
    })), `insert into crm_atendimento.app_registration_caixa_links(
            app_registration_id,caixa_customer_id,method,confidence,status,evidence,run_id)
        select x.app_registration_id,x.caixa_customer_id::uuid,x.method,x.confidence,x.status,x.evidence,x.run_id::uuid
        from jsonb_to_recordset($1::jsonb) as x(app_registration_id text,caixa_customer_id text,method text,confidence numeric,status text,evidence jsonb,run_id text)
        on conflict(app_registration_id,caixa_customer_id) do update set method=excluded.method,confidence=excluded.confidence,
            status=case when crm_atendimento.app_registration_caixa_links.status in ('confirmed','rejected') then crm_atendimento.app_registration_caixa_links.status else excluded.status end,
            evidence=excluded.evidence,run_id=excluded.run_id,updated_at=now()`)
    await insertJsonChunks(client, attendanceLinks.map((item) => ({
        app_registration_id: item.registrationId, client_id: item.attendanceClientId, method: item.method,
        confidence: item.confidence, status: item.status, evidence: item.evidence, run_id: runId,
    })), `insert into crm_atendimento.app_registration_attendance_links(
            app_registration_id,client_id,method,confidence,status,evidence,run_id)
        select x.app_registration_id,x.client_id::uuid,x.method,x.confidence,x.status,x.evidence,x.run_id::uuid
        from jsonb_to_recordset($1::jsonb) as x(app_registration_id text,client_id text,method text,confidence numeric,status text,evidence jsonb,run_id text)
        on conflict(app_registration_id,client_id) do update set method=excluded.method,confidence=excluded.confidence,
            status=case when crm_atendimento.app_registration_attendance_links.status in ('confirmed','rejected') then crm_atendimento.app_registration_attendance_links.status else excluded.status end,
            evidence=excluded.evidence,run_id=excluded.run_id,updated_at=now()`)

    const existingAttendanceCaixa = await client.query(`select coalesce(c.merged_into_id,l.client_id)::text as "attendanceClientId",
            l.caixa_customer_id::text as "caixaCustomerId",l.status from crm_atendimento.client_caixa_links l
        join crm_atendimento.canonical_clients c on c.id=l.client_id`)
    const components = buildConfirmedGlobalIdentityComponents({
        registrations: plan.registrations,
        canonicalClients: canonicalClients.map((item) => ({ id: item.resolvedId, name: item.name })),
        caixaCustomers: customers,
        registrationCaixaLinks: plan.registrationCaixaLinks,
        registrationAttendanceLinks: attendanceLinks,
        attendanceCaixaLinks: existingAttendanceCaixa.rows,
    })
    for (const component of components) {
        const identity = await client.query(`insert into crm_atendimento.global_client_identities(component_key,canonical_name,source_types,last_run_id)
            values($1,$2,$3::jsonb,$4) on conflict(component_key) do update set canonical_name=excluded.canonical_name,
                source_types=excluded.source_types,last_run_id=excluded.last_run_id,updated_at=now() returning id`,
        [component.componentKey, component.preferredName, JSON.stringify(component.sourceTypes), runId])
        await insertJsonChunks(client, component.members.map((member) => ({ identity_id: identity.rows[0].id, source_type: member.sourceType, source_id: member.sourceId })),
            `insert into crm_atendimento.global_client_identity_members(identity_id,source_type,source_id)
                select x.identity_id::uuid,x.source_type,x.source_id from jsonb_to_recordset($1::jsonb) as x(identity_id text,source_type text,source_id text)
                on conflict(source_type,source_id) do update set identity_id=excluded.identity_id,updated_at=now()`)
    }
    return { runId, components: components.length, members: components.reduce((sum, item) => sum + item.members.length, 0) }
}

const registrationRows = parseCsv(await fs.readFile(inputFile, 'utf8'))
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: 'crm-client-registration-reconciliation' })
try {
    const input = await loadInputs(pool)
    const plan = buildClientRegistrationIdentityPlan({ registrationRows, caixaCustomers: input.customers, caixaSales: input.sales, attendances: input.attendances })
    const attendanceLinks = enrichAttendanceLinks(plan, input.canonicalClients)
    let persisted = null
    if (apply) {
        const client = await pool.connect()
        try {
            await client.query('begin')
            persisted = await persistPlan(client, { plan, attendanceLinks, canonicalClients: input.canonicalClients, customers: input.customers, sourceFile: inputFile })
            await client.query('commit')
        } catch (error) {
            await client.query('rollback')
            throw error
        } finally {
            client.release()
        }
    }
    await fs.mkdir(outputDirectory, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
    const summaryFile = path.join(outputDirectory, `reconciliacao-clientes-resumo-${stamp}.json`)
    const caixaFile = path.join(outputDirectory, `reconciliacao-cadastro-caixa-${stamp}.csv`)
    const attendanceFile = path.join(outputDirectory, `reconciliacao-cadastro-atendimento-${stamp}.csv`)
    const output = {
        ok: true, dryRun: !apply, persisted,
        source: { registrationRows: registrationRows.length, attendances: input.attendances.length, caixaCustomers: input.customers.length, caixaSales: input.saleCount, caixaCustomerUnitGroups: input.sales.length },
        ...plan.summary,
    }
    await Promise.all([
        fs.writeFile(summaryFile, `${JSON.stringify(output, null, 2)}\n`),
        fs.writeFile(caixaFile, toCsv(plan.registrationCaixaLinks, ['registrationId', 'caixaCustomerId', 'method', 'confidence', 'status', 'evidence'])),
        fs.writeFile(attendanceFile, toCsv(attendanceLinks, ['registrationId', 'attendanceClientId', 'attendanceNameKey', 'method', 'confidence', 'status', 'evidence'])),
    ])
    console.log(JSON.stringify({ ...output, outputs: { summary: summaryFile, caixaLinks: caixaFile, attendanceLinks: attendanceFile } }, null, 2))
} finally {
    await pool.end()
}
