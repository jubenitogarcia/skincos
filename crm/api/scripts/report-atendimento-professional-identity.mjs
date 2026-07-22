#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { isLocalMirrorDestination } from '../server/atendimento/mirror.js'
import { buildProfessionalIdentityDiagnosis } from '../server/atendimento/professionalIdentity.js'

const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (!databaseUrl || !isLocalMirrorDestination(databaseUrl)) throw new Error('DATABASE_URL deve apontar exclusivamente para skincos_crm_local.')

const pool = createPgPool(databaseUrl)
const client = await pool.connect()
try {
    await client.query('begin transaction read only')
    const [professionals, schedule] = await Promise.all([
        client.query(`select p.id, p.canonical_id, p.name, p.status, p.units, p.roles, p.alias, p.identity_version,
            canonical.name as canonical_name,
            coalesce(array_agg(distinct pa.alias) filter (where pa.active), '{}') as aliases
            from crm_atendimento.professionals p
            left join crm_atendimento.professionals canonical on canonical.id = coalesce(p.canonical_id, p.id)
            left join crm_atendimento.professional_aliases pa on pa.professional_id = coalesce(p.canonical_id, p.id)
            group by p.id, canonical.id order by p.name`),
        client.query(`select distinct doctor_name from crm_atendimento.schedule_days
            where nullif(trim(coalesce(doctor_name, '')), '') is not null order by doctor_name`),
    ])
    const diagnosis = buildProfessionalIdentityDiagnosis(professionals.rows, {
        scheduleNames: schedule.rows.map((row) => row.doctor_name),
    })
    console.log(JSON.stringify(diagnosis, null, 2))
    await client.query('rollback')
} finally {
    client.release()
    await pool.end()
}
