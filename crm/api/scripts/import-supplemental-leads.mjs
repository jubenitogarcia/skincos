import { promises as fs } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { google } from 'googleapis'
import { buildConfirmedGlobalIdentityComponents } from '../server/atendimento/clientRegistrationIdentity.js'
import { buildSupplementalLeadIdentityPlan, buildSupplementalLeadProfiles } from '../server/atendimento/supplementalLeadIdentity.js'

const apply = process.argv.includes('--apply')
const spreadsheetId = String(process.env.SUPPLEMENTAL_LEADS_GOOGLE_SHEET_ID || '').trim()
const outputDirectory = String(process.env.SUPPLEMENTAL_LEADS_OUTPUT || '').trim()
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
const serviceAccountFile = String(process.env.ATENDIMENTO_GOOGLE_SA_FILE || process.env.HARMONIA_GOOGLE_SA_FILE || '').trim()
const checkpointFile = String(process.env.SUPPLEMENTAL_LEADS_CHECKPOINT || '').trim()
if (!spreadsheetId) throw new Error('SUPPLEMENTAL_LEADS_GOOGLE_SHEET_ID_not_configured')
if (!outputDirectory) throw new Error('SUPPLEMENTAL_LEADS_OUTPUT_not_configured')
if (!databaseUrl) throw new Error('DATABASE_URL_not_configured')
if (!serviceAccountFile) throw new Error('ATENDIMENTO_GOOGLE_SA_FILE_not_configured')
if (apply && process.env.SUPPLEMENTAL_LEADS_APPLY_CONFIRM !== 'UNIFICAR') throw new Error('SUPPLEMENTAL_LEADS_APPLY_CONFIRM_UNIFICAR_required')
if (apply && !checkpointFile) throw new Error('SUPPLEMENTAL_LEADS_CHECKPOINT_required_before_apply')

const sourceTabs = ['Lead', 'Novo Hamburgo', 'BarraShoppingSul', 'Não Identificado', 'Codex App', 'Message']
const automatic = new Set(['auto_confirmed', 'auto_confirmed_spelling', 'confirmed'])
const chunks = (values, size = 500) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))

async function insertJsonChunks(client, values, sql) {
    for (const chunk of chunks(values)) if (chunk.length) await client.query(sql, [JSON.stringify(chunk)])
}

function parseJson(value) {
    if (Array.isArray(value)) return value
    try { return JSON.parse(value || '[]') } catch { return [] }
}

async function readSheet() {
    const account = JSON.parse(await fs.readFile(serviceAccountFile, 'utf8'))
    const auth = new google.auth.JWT({ email: account.client_email, key: account.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] })
    const sheets = google.sheets({ version: 'v4', auth })
    const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(title,hidden))' })
    const readable = new Set((metadata.data.sheets || []).filter((sheet) => !sheet.properties?.hidden).map((sheet) => sheet.properties?.title).filter(Boolean))
    const tabs = sourceTabs.filter((tab) => readable.has(tab))
    const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: tabs.map((tab) => `'${tab.replace(/'/g, "''")}'`), valueRenderOption: 'FORMATTED_VALUE' })
    return { tabs: Object.fromEntries((response.data.valueRanges || []).map((range, index) => [tabs[index], range.values || []])), tabNames: tabs }
}

async function loadInputs(pool) {
    const [apps, customers, sales, canonicalClients, appCaixa, appAttendance, attendanceCaixa] = await Promise.all([
        pool.query(`select source_client_id as id, canonical_name as name, name_key as "nameKey", phone_keys as phones, email_keys as emails, unit_slugs as units from crm_atendimento.app_client_registrations`),
        pool.query(`select id::text as id, name, phone_key as phone from crm_caixa.customers`),
        pool.query(`select s.customer_id::text as "customerId", u.slug as "unitSlug" from crm_caixa.sales s join crm_atendimento.units u on u.id=s.unit_id where s.customer_id is not null group by s.customer_id,u.slug`),
        pool.query(`select id::text, coalesce(merged_into_id,id)::text as "resolvedId", canonical_name as name from crm_atendimento.canonical_clients`),
        pool.query(`select app_registration_id as "registrationId", caixa_customer_id::text as "caixaCustomerId", status from crm_atendimento.app_registration_caixa_links`),
        pool.query(`select app_registration_id as "registrationId", client_id::text as "attendanceClientId", status from crm_atendimento.app_registration_attendance_links`),
        pool.query(`select coalesce(c.merged_into_id,l.client_id)::text as "attendanceClientId", l.caixa_customer_id::text as "caixaCustomerId", l.status from crm_atendimento.client_caixa_links l join crm_atendimento.canonical_clients c on c.id=l.client_id`),
    ])
    const unitsByCustomer = new Map()
    sales.rows.forEach((sale) => { if (!unitsByCustomer.has(sale.customerId)) unitsByCustomer.set(sale.customerId, []); unitsByCustomer.get(sale.customerId).push(sale.unitSlug) })
    return {
        apps: apps.rows.map((row) => ({ ...row, phones: parseJson(row.phones), emails: parseJson(row.emails), units: parseJson(row.units) })),
        customers: customers.rows.map((row) => ({ id: row.id, name: row.name, nameKey: String(row.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), phones: row.phone ? [row.phone] : [], emails: [], units: unitsByCustomer.get(row.id) || [] })),
        canonicalClients: canonicalClients.rows.map((row) => ({ id: row.resolvedId, name: row.name })),
        appCaixa: appCaixa.rows, appAttendance: appAttendance.rows, attendanceCaixa: attendanceCaixa.rows,
    }
}

const schemaStatements = [
    `create table if not exists crm_atendimento.supplemental_lead_import_runs (id uuid primary key default gen_random_uuid(), source_sheet_id text not null, summary jsonb not null, created_at timestamptz not null default now())`,
    `create table if not exists crm_atendimento.supplemental_lead_profiles (source_profile_id text primary key, source_sheet_id text not null, source_rows jsonb not null, canonical_name text not null, name_key text not null, name_variants jsonb not null default '[]'::jsonb, phone_keys jsonb not null default '[]'::jsonb, email_keys jsonb not null default '[]'::jsonb, unit_slugs jsonb not null default '[]'::jsonb, birthdays jsonb not null default '[]'::jsonb, last_run_id uuid references crm_atendimento.supplemental_lead_import_runs(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
    `create table if not exists crm_atendimento.supplemental_lead_profile_app_links (source_profile_id text not null references crm_atendimento.supplemental_lead_profiles(source_profile_id) on delete cascade, app_registration_id text not null references crm_atendimento.app_client_registrations(source_client_id) on delete restrict, method text not null, confidence numeric(5,4) not null, status text not null, evidence jsonb not null default '{}'::jsonb, run_id uuid references crm_atendimento.supplemental_lead_import_runs(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(source_profile_id, app_registration_id))`,
    `create table if not exists crm_atendimento.supplemental_lead_profile_caixa_links (source_profile_id text not null references crm_atendimento.supplemental_lead_profiles(source_profile_id) on delete cascade, caixa_customer_id uuid not null references crm_caixa.customers(id) on delete restrict, method text not null, confidence numeric(5,4) not null, status text not null, evidence jsonb not null default '{}'::jsonb, run_id uuid references crm_atendimento.supplemental_lead_import_runs(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key(source_profile_id, caixa_customer_id))`,
    `alter table crm_atendimento.global_client_identity_members drop constraint if exists global_client_identity_members_source_type_check`,
    `alter table crm_atendimento.global_client_identity_members add constraint global_client_identity_members_source_type_check check(source_type in ('app_registration','caixa_customer','attendance_client','lead_profile'))`,
    `create index if not exists supplemental_lead_profile_app_status_idx on crm_atendimento.supplemental_lead_profile_app_links(status, confidence desc)`,
    `create index if not exists supplemental_lead_profile_caixa_status_idx on crm_atendimento.supplemental_lead_profile_caixa_links(status, confidence desc)`,
]

async function persist(client, { plan, input }) {
    await client.query(`select pg_advisory_xact_lock(hashtext('crm_atendimento.supplemental_lead_reconciliation'))`)
    for (const statement of schemaStatements) await client.query(statement)
    const run = await client.query(`insert into crm_atendimento.supplemental_lead_import_runs(source_sheet_id,summary) values($1,$2::jsonb) returning id`, [spreadsheetId, JSON.stringify(plan.summary)])
    const runId = run.rows[0].id
    await insertJsonChunks(client, plan.profiles.map((item) => ({ id: item.id, source_sheet_id: spreadsheetId, source_rows: item.sourceRows, name: item.name, name_key: item.nameKey, names: item.names, phones: item.phones, emails: item.emails, units: item.units, birthdays: item.birthdays, run_id: runId })),
        `insert into crm_atendimento.supplemental_lead_profiles(source_profile_id,source_sheet_id,source_rows,canonical_name,name_key,name_variants,phone_keys,email_keys,unit_slugs,birthdays,last_run_id)
         select x.id,x.source_sheet_id,x.source_rows,x.name,x.name_key,x.names,x.phones,x.emails,x.units,x.birthdays,x.run_id::uuid from jsonb_to_recordset($1::jsonb) as x(id text,source_sheet_id text,source_rows jsonb,name text,name_key text,names jsonb,phones jsonb,emails jsonb,units jsonb,birthdays jsonb,run_id text)
         on conflict(source_profile_id) do update set source_rows=excluded.source_rows,canonical_name=excluded.canonical_name,name_key=excluded.name_key,name_variants=excluded.name_variants,phone_keys=excluded.phone_keys,email_keys=excluded.email_keys,unit_slugs=excluded.unit_slugs,birthdays=excluded.birthdays,last_run_id=excluded.last_run_id,updated_at=now()`, spreadsheetId)
    await insertJsonChunks(client, plan.appLinks.map((item) => ({ profile_id: item.profileId, registration_id: item.registrationId, method: item.method, confidence: item.confidence, status: item.status, evidence: item.evidence, run_id: runId })),
        `insert into crm_atendimento.supplemental_lead_profile_app_links(source_profile_id,app_registration_id,method,confidence,status,evidence,run_id)
         select x.profile_id,x.registration_id,x.method,x.confidence,x.status,x.evidence,x.run_id::uuid from jsonb_to_recordset($1::jsonb) as x(profile_id text,registration_id text,method text,confidence numeric,status text,evidence jsonb,run_id text)
         on conflict(source_profile_id,app_registration_id) do update set method=excluded.method,confidence=excluded.confidence,status=case when crm_atendimento.supplemental_lead_profile_app_links.status in ('confirmed','rejected') then crm_atendimento.supplemental_lead_profile_app_links.status else excluded.status end,evidence=excluded.evidence,run_id=excluded.run_id,updated_at=now()`)
    await insertJsonChunks(client, plan.caixaLinks.map((item) => ({ profile_id: item.profileId, caixa_customer_id: item.caixaCustomerId, method: item.method, confidence: item.confidence, status: item.status, evidence: item.evidence, run_id: runId })),
        `insert into crm_atendimento.supplemental_lead_profile_caixa_links(source_profile_id,caixa_customer_id,method,confidence,status,evidence,run_id)
         select x.profile_id,x.caixa_customer_id::uuid,x.method,x.confidence,x.status,x.evidence,x.run_id::uuid from jsonb_to_recordset($1::jsonb) as x(profile_id text,caixa_customer_id text,method text,confidence numeric,status text,evidence jsonb,run_id text)
         on conflict(source_profile_id,caixa_customer_id) do update set method=excluded.method,confidence=excluded.confidence,status=case when crm_atendimento.supplemental_lead_profile_caixa_links.status in ('confirmed','rejected') then crm_atendimento.supplemental_lead_profile_caixa_links.status else excluded.status end,evidence=excluded.evidence,run_id=excluded.run_id,updated_at=now()`)

    const [currentAppLinks, currentCaixaLinks] = await Promise.all([
        client.query(`select source_profile_id as "profileId",app_registration_id as "registrationId",status from crm_atendimento.supplemental_lead_profile_app_links`),
        client.query(`select source_profile_id as "profileId",caixa_customer_id::text as "caixaCustomerId",status from crm_atendimento.supplemental_lead_profile_caixa_links`),
    ])
    const components = buildConfirmedGlobalIdentityComponents({ registrations: input.apps, leadProfiles: plan.profiles, canonicalClients: input.canonicalClients, caixaCustomers: input.customers, registrationCaixaLinks: input.appCaixa, registrationAttendanceLinks: input.appAttendance, attendanceCaixaLinks: input.attendanceCaixa, leadProfileRegistrationLinks: currentAppLinks.rows, leadProfileCaixaLinks: currentCaixaLinks.rows })
    await client.query(`delete from crm_atendimento.global_client_identity_members where source_type='lead_profile'`)
    for (const component of components) {
        // This legacy column references app_registration_import_runs, not the
        // supplemental lead run. Lead provenance remains on its own links.
        const identity = await client.query(`insert into crm_atendimento.global_client_identities(component_key,canonical_name,source_types) values($1,$2,$3::jsonb) on conflict(component_key) do update set canonical_name=excluded.canonical_name,source_types=excluded.source_types,updated_at=now() returning id`, [component.componentKey, component.preferredName, JSON.stringify(component.sourceTypes)])
        await insertJsonChunks(client, component.members.map((member) => ({ identity_id: identity.rows[0].id, source_type: member.sourceType, source_id: member.sourceId })), `insert into crm_atendimento.global_client_identity_members(identity_id,source_type,source_id) select x.identity_id::uuid,x.source_type,x.source_id from jsonb_to_recordset($1::jsonb) as x(identity_id text,source_type text,source_id text) on conflict(source_type,source_id) do update set identity_id=excluded.identity_id,updated_at=now()`)
    }
    await client.query(`delete from crm_atendimento.global_client_identities identity where not exists (select 1 from crm_atendimento.global_client_identity_members member where member.identity_id=identity.id)`)
    return { runId, components: components.length, members: components.reduce((sum, item) => sum + item.members.length, 0) }
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: 'crm-supplemental-lead-import' })
try {
    console.error('Reading supplemental lead workbook and existing identities...')
    const [sheet, input] = await Promise.all([readSheet(), loadInputs(pool)])
    console.error('Building normalized lead profiles and link plan...')
    const profiles = buildSupplementalLeadProfiles({ spreadsheetId, tabs: sheet.tabs })
    const plan = buildSupplementalLeadIdentityPlan({ profiles, appRegistrations: input.apps, caixaCustomers: input.customers })
    let persisted = null
    if (apply) {
        await fs.access(checkpointFile)
        console.error('Persisting supplemental profiles and confirmed identity components...')
        const client = await pool.connect()
        try { await client.query('begin'); persisted = await persist(client, { plan, input }); await client.query('commit') } catch (error) { await client.query('rollback'); throw error } finally { client.release() }
    }
    await fs.mkdir(outputDirectory, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
    const summaryFile = path.join(outputDirectory, `importacao-leads-resumo-${stamp}.json`)
    await fs.writeFile(summaryFile, `${JSON.stringify({ ok: true, dryRun: !apply, persisted, source: { spreadsheetId, tabs: sheet.tabNames, rows: Object.fromEntries(Object.entries(sheet.tabs).map(([tab, rows]) => [tab, Math.max(0, rows.length - 1)])) }, ...plan.summary }, null, 2)}\n`)
    console.error('Supplemental lead import completed.')
    console.log(JSON.stringify({ ok: true, dryRun: !apply, persisted, source: { spreadsheetId, tabs: sheet.tabNames, rows: Object.fromEntries(Object.entries(sheet.tabs).map(([tab, rows]) => [tab, Math.max(0, rows.length - 1)])) }, ...plan.summary, output: summaryFile }, null, 2))
} finally { await pool.end() }
// googleapis can retain an idle transport handle after a completed one-shot import.
process.exit(0)
