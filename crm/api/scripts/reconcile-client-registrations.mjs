import { promises as fs } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { buildClientRegistrationIdentityPlan } from '../server/atendimento/clientRegistrationIdentity.js'

const inputFile = String(process.env.CLIENT_REGISTRATION_CSV || '').trim()
const outputDirectory = String(process.env.CLIENT_REGISTRATION_RECONCILIATION_OUTPUT || '').trim()
const databaseUrl = String(process.env.DATABASE_URL || '').trim()

if (!inputFile) throw new Error('CLIENT_REGISTRATION_CSV_not_configured')
if (!outputDirectory) throw new Error('CLIENT_REGISTRATION_RECONCILIATION_OUTPUT_not_configured')
if (!databaseUrl) throw new Error('DATABASE_URL_not_configured')

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
    return records.filter((record) => record.some((value) => value.trim())).map((record) => Object.fromEntries(header.map((key, index) => [key, record[index] || ''])))
}

function toCsv(rows, header) {
    const escape = (value) => `"${(typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).replaceAll('"', '""')}"`
    return [header.map(escape).join(','), ...rows.map((row) => header.map((key) => escape(row[key])).join(','))].join('\n') + '\n'
}

const registrationRows = parseCsv(await fs.readFile(inputFile, 'utf8'))
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, application_name: 'crm-client-registration-reconciliation-preview' })
try {
    const [attendances, customers, sales, saleCount] = await Promise.all([
        pool.query(`select id, client_name as "clientName", unit_id as "unitId", procedure_id as "procedureId"
            from crm_atendimento.attendances where deleted_at is null and nullif(trim(client_name), '') is not null`),
        pool.query(`select id, name, phone_key as "phoneKey" from crm_caixa.customers`),
        pool.query(`select s.customer_id as "customerId", s.unit_id as "unitId", u.slug as "unitSlug",
                coalesce(array_agg(distinct i.procedure_id) filter (where i.procedure_id is not null), '{}') as "procedureIds"
            from crm_caixa.sales s join crm_atendimento.units u on u.id=s.unit_id
            left join crm_caixa.sale_items i on i.sale_id=s.id where s.customer_id is not null
            group by s.customer_id,s.unit_id,u.slug`),
        pool.query(`select count(*)::int as sales from crm_caixa.sales`),
    ])
    const plan = buildClientRegistrationIdentityPlan({ registrationRows, caixaCustomers: customers.rows, caixaSales: sales.rows, attendances: attendances.rows })
    await fs.mkdir(outputDirectory, { recursive: true })
    const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
    const summaryFile = path.join(outputDirectory, `reconciliacao-clientes-resumo-${stamp}.json`)
    const caixaFile = path.join(outputDirectory, `reconciliacao-cadastro-caixa-${stamp}.csv`)
    const attendanceFile = path.join(outputDirectory, `reconciliacao-cadastro-atendimento-${stamp}.csv`)
    await Promise.all([
        fs.writeFile(summaryFile, `${JSON.stringify({ ok: true, dryRun: true, source: { registrationRows: registrationRows.length, attendances: attendances.rows.length, caixaCustomers: customers.rows.length, caixaSales: saleCount.rows[0].sales, caixaCustomerUnitGroups: sales.rows.length }, ...plan.summary }, null, 2)}\n`),
        fs.writeFile(caixaFile, toCsv(plan.registrationCaixaLinks, ['registrationId', 'caixaCustomerId', 'method', 'confidence', 'status', 'evidence'])),
        fs.writeFile(attendanceFile, toCsv(plan.registrationAttendanceLinks, ['registrationId', 'attendanceNameKey', 'method', 'confidence', 'status', 'evidence'])),
    ])
    console.log(JSON.stringify({ ok: true, dryRun: true, ...plan.summary, outputs: { summary: summaryFile, caixaLinks: caixaFile, attendanceLinks: attendanceFile } }, null, 2))
} finally {
    await pool.end()
}
