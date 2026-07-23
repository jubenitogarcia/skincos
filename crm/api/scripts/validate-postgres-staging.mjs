import { createPgPool, getPgDatabaseMetrics, getPgPoolMetrics } from '../server/postgres/pool.js'
import { createAtendimentoStore } from '../server/atendimento/store.js'
import { createCaixaStore } from '../server/caixa/store.js'
import { createHarmoniaStore } from '../server/harmonia/store/store.js'

const pool = createPgPool(process.env.DATABASE_URL, { domain: 'crm' })
if (!pool) throw new Error('DATABASE_URL is required')
const tls = await pool.query('select ssl from pg_stat_ssl where pid=pg_backend_pid()')
if (tls.rows[0]?.ssl !== true) throw new Error('POSTGRES_TLS_NOT_ACTIVE')
const schemas = await pool.query("select nspname from pg_namespace where nspname in ('crm_atendimento','harmonia','crm_caixa') order by nspname")
if (schemas.rows.map((row) => row.nspname).join(',') !== 'crm_atendimento,crm_caixa,harmonia') throw new Error('CRM_STAGING_SCHEMA_MISSING')
const metrics = getPgPoolMetrics(pool)
if (!metrics.configured || metrics.total < 1) throw new Error('CRM_POOL_METRICS_UNAVAILABLE')
const database = await getPgDatabaseMetrics(pool)
if (!database.available) throw new Error('CRM_DATABASE_METRICS_UNAVAILABLE')
const atendimento = await createAtendimentoStore({ databaseUrl: process.env.DATABASE_URL }).health()
const caixa = await createCaixaStore({ databaseUrl: process.env.DATABASE_URL }).health()
const harmonia = await createHarmoniaStore({ databaseUrl: process.env.DATABASE_URL }).health()
if (!atendimento.ok || caixa.database !== 'ok' || !harmonia.ok) throw new Error('CRM_DOMAIN_POOL_HEALTH_FAILED')
console.log(JSON.stringify({ ok: true, tls: true, schemas: schemas.rows.length, pool: metrics, database, domains: { atendimento, caixa, harmonia } }))
await pool.end()
