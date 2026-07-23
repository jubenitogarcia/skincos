import { createPgPool, withPgTransaction } from '../harmonia/store/pg.js'
import { inferProcedureName, normalizeText } from './domain.js'

let pool = null
const actorLabel = (actor) => String(actor?.id || actor?.username || actor?.email || '').trim() || 'system'
const money = (value) => Math.round(Number(value) * 100) / 100

export function createCaixaStore({ databaseUrl = process.env.DATABASE_URL } = {}) {
    if (!pool) pool = createPgPool(databaseUrl, { domain: 'caixa' })
    let ready = null
    async function ensureReady() {
        if (!pool) { const error = new Error('DATABASE_URL_not_configured'); error.statusCode = 503; throw error }
        if (!ready) ready = Promise.resolve()
        /* Legacy DDL is intentionally retained below only as migration-source
           evidence. Runtime no longer executes it. */
        if (false) await withPgTransaction(pool, async (client) => {
            for (const sql of [
                'create extension if not exists pgcrypto',
                'create schema if not exists crm_caixa',
                `create table if not exists crm_caixa.customers (id uuid primary key default gen_random_uuid(), name text not null, name_key text not null, phone_key text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(name_key, phone_key))`,
                `create table if not exists crm_caixa.import_batches (id uuid primary key default gen_random_uuid(), source_sheet_id text not null, dry_run boolean not null, actor text, summary jsonb not null default '{}'::jsonb, created_at timestamptz not null default now())`,
                `create table if not exists crm_caixa.service_mappings (service_key text primary key, raw_name text not null, procedure_id uuid references crm_atendimento.procedures(id), status text not null check(status in ('mapped','pending')), updated_at timestamptz not null default now())`,
                `create table if not exists crm_caixa.sales (id uuid primary key default gen_random_uuid(), unit_id uuid not null references crm_atendimento.units(id), customer_id uuid references crm_caixa.customers(id), occurred_on date not null, occurred_at time, client_name text not null, phone_raw text, phone_key text, total numeric(12,2) not null, raw_service text not null default '', source_sheet_id text not null, source_tab text not null, source_row int not null, created_by text, updated_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(source_sheet_id, source_tab, source_row))`,
                `create table if not exists crm_caixa.sale_items (id uuid primary key default gen_random_uuid(), sale_id uuid not null references crm_caixa.sales(id) on delete cascade, line_position int not null, raw_name text not null, service_key text not null, procedure_id uuid references crm_atendimento.procedures(id), mapping_status text not null check(mapping_status in ('mapped','pending')), quantity int not null default 1, unique(sale_id, line_position))`,
                'create index if not exists crm_caixa_sales_period_idx on crm_caixa.sales(unit_id, occurred_on desc)',
                'create index if not exists crm_caixa_sale_items_status_idx on crm_caixa.sale_items(mapping_status, procedure_id)',
            ]) await client.query(sql)
        })
        return ready
    }
    async function procedureIndex(client) {
        const result = await client.query('select id, name from crm_atendimento.procedures')
        return new Map(result.rows.map((row) => [normalizeText(row.name), row]))
    }
    async function classify(client, record, procedures) {
        const items = []
        for (const item of record.items) {
            const inferred = item.inferredProcedureName || inferProcedureName(item.rawName)
            const procedure = inferred ? procedures.get(normalizeText(inferred)) : null
            items.push({ ...item, procedureId: procedure?.id || null, status: procedure ? 'mapped' : 'pending' })
        }
        return items
    }
    async function summary(records, classified) {
        const byUnit = {}; let total = 0; let mappedItems = 0; let pendingItems = 0; let phoneMissing = 0
        records.forEach((record, index) => { const key = record.unit.slug; if (!byUnit[key]) byUnit[key] = { name: record.unit.name, sales: 0, total: 0 }; byUnit[key].sales += 1; byUnit[key].total = money(byUnit[key].total + record.total); total += record.total; if (!record.phoneKey) phoneMissing += 1; classified[index].forEach((item) => item.status === 'mapped' ? mappedItems += 1 : pendingItems += 1) })
        const identities = new Set(records.filter((r) => r.phoneKey).map((r) => `${r.clientKey}|${r.phoneKey}`))
        return { sales: records.length, total: money(total), byUnit, items: mappedItems + pendingItems, mappedItems, pendingItems, phoneMissing, canonicalCustomersInSource: identities.size }
    }
    return {
        async health() { await ensureReady(); return { database: 'ok' } },
        async importRecords({ records, actor, dryRun = true, sourceSheetId }) {
            await ensureReady()
            const procedures = await procedureIndex(pool)
            const classified = await Promise.all(records.map((record) => classify(pool, record, procedures)))
            const preview = await summary(records, classified)
            if (dryRun) return { dryRun: true, ...preview }
            return withPgTransaction(pool, async (client) => {
                let inserted = 0; let updated = 0; let customersCreated = 0; let customersReused = 0
                for (let index = 0; index < records.length; index += 1) {
                    const record = records[index]; const unit = await client.query('select id from crm_atendimento.units where slug=$1', [record.unit.slug])
                    if (!unit.rows[0]) throw Object.assign(new Error(`UNKNOWN_UNIT_${record.unit.slug}`), { statusCode: 424 })
                    let customerId = null
                    if (record.phoneKey) {
                        const customer = await client.query(`insert into crm_caixa.customers(name,name_key,phone_key) values($1,$2,$3) on conflict(name_key,phone_key) do update set updated_at=now() returning id, (xmax = 0) as inserted`, [record.clientName, record.clientKey, record.phoneKey])
                        customerId = customer.rows[0].id; customer.rows[0].inserted ? customersCreated += 1 : customersReused += 1
                    }
                    const sale = await client.query(`insert into crm_caixa.sales(unit_id,customer_id,occurred_on,occurred_at,client_name,phone_raw,phone_key,total,raw_service,source_sheet_id,source_tab,source_row,created_by,updated_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) on conflict(source_sheet_id,source_tab,source_row) do update set unit_id=excluded.unit_id,customer_id=excluded.customer_id,occurred_on=excluded.occurred_on,occurred_at=excluded.occurred_at,client_name=excluded.client_name,phone_raw=excluded.phone_raw,phone_key=excluded.phone_key,total=excluded.total,raw_service=excluded.raw_service,updated_by=excluded.updated_by,updated_at=now() returning id,(xmax=0) as inserted`, [unit.rows[0].id, customerId, record.date, record.time || null, record.clientName, record.phoneRaw || null, record.phoneKey || null, record.total, record.rawService, record.sourceSheetId, record.sourceTab, record.sourceRow, actorLabel(actor)])
                    sale.rows[0].inserted ? inserted += 1 : updated += 1
                    await client.query('delete from crm_caixa.sale_items where sale_id=$1', [sale.rows[0].id])
                    for (const item of classified[index]) {
                        await client.query('insert into crm_caixa.service_mappings(service_key,raw_name,procedure_id,status) values($1,$2,$3,$4) on conflict(service_key) do update set raw_name=excluded.raw_name, procedure_id=excluded.procedure_id, status=excluded.status, updated_at=now()', [item.serviceKey, item.rawName, item.procedureId, item.status])
                        await client.query('insert into crm_caixa.sale_items(sale_id,line_position,raw_name,service_key,procedure_id,mapping_status,quantity) values($1,$2,$3,$4,$5,$6,$7)', [sale.rows[0].id, item.position, item.rawName, item.serviceKey, item.procedureId, item.status, item.quantity])
                    }
                }
                const result = { dryRun: false, ...preview, inserted, updated, customersCreated, customersReused }
                await client.query('insert into crm_caixa.import_batches(source_sheet_id,dry_run,actor,summary) values($1,false,$2,$3)', [sourceSheetId, actorLabel(actor), JSON.stringify(result)])
                return result
            })
        },
        async overview(query = {}) {
            await ensureReady(); const params = []; const where = []
            if (query.unit) { params.push(String(query.unit)); where.push(`u.slug=$${params.length}`) }
            if (query.from) { params.push(String(query.from)); where.push(`s.occurred_on >= $${params.length}::date`) }
            if (query.to) { params.push(String(query.to)); where.push(`s.occurred_on <= $${params.length}::date`) }
            if (query.classification === 'pending') where.push("exists (select 1 from crm_caixa.sale_items filter_items where filter_items.sale_id=s.id and filter_items.mapping_status='pending')")
            if (query.classification === 'mapped') where.push("not exists (select 1 from crm_caixa.sale_items filter_items where filter_items.sale_id=s.id and filter_items.mapping_status='pending')")
            const clause = where.length ? `where ${where.join(' and ')}` : ''
            const [summaryResult, salesResult, pendingResult, latestResult] = await Promise.all([
                pool.query(`select count(*)::int as sales, coalesce(sum(s.total),0)::float as total, count(distinct s.customer_id)::int as customers from crm_caixa.sales s join crm_atendimento.units u on u.id=s.unit_id ${clause}`, params),
                pool.query(`select s.id,s.occurred_on::text as date,s.occurred_at::text as time,s.client_name,s.phone_raw,s.total::float as total,s.raw_service,u.slug as unit_slug,u.name as unit_name,count(i.id)::int as item_count,count(i.id) filter(where i.mapping_status='pending')::int as pending_items from crm_caixa.sales s join crm_atendimento.units u on u.id=s.unit_id left join crm_caixa.sale_items i on i.sale_id=s.id ${clause} group by s.id,u.slug,u.name order by s.occurred_on desc,s.occurred_at desc nulls last limit 100`, params),
                pool.query(`select i.raw_name,count(*)::int as count from crm_caixa.sale_items i join crm_caixa.sales s on s.id=i.sale_id join crm_atendimento.units u on u.id=s.unit_id ${clause ? `${clause} and` : 'where'} i.mapping_status='pending' group by i.raw_name order by count desc,i.raw_name limit 100`, params),
                pool.query('select source_sheet_id,summary,created_at from crm_caixa.import_batches order by created_at desc limit 1'),
            ])
            return { summary: summaryResult.rows[0], sales: salesResult.rows, pending: pendingResult.rows, latestImport: latestResult.rows[0] || null }
        },
    }
}
