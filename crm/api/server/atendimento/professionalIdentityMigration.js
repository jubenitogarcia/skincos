import { isLocalMirrorDestination } from './mirror.js'
import {
    CONFIRMED_PROFESSIONAL_ALIAS_RULES,
    PROFESSIONAL_IDENTITY_VERSION,
    normalizeProfessionalAliasKey,
} from './professionalIdentity.js'

export const PROFESSIONAL_IDENTITY_MIGRATION_ID = '20260718_atendimento_professional_identity_v1'

const INDEXES = [
    `create index concurrently if not exists crm_atendimento_professionals_canonical_idx
     on crm_atendimento.professionals(canonical_id)`,
    `create index concurrently if not exists crm_atendimento_professional_aliases_key_idx
     on crm_atendimento.professional_aliases(alias_key) where active`,
    `create index concurrently if not exists crm_atendimento_schedule_professional_period_idx
     on crm_atendimento.schedule_days(unit_id, professional_id, service_date desc)
     where professional_id is not null`,
]

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

async function query(client, sql, params = []) {
    return client.query(sql, params)
}

async function assertLocalDestination(client, databaseUrl) {
    if (!isLocalMirrorDestination(databaseUrl)) throw migrationError('ATENDIMENTO_MIGRATION_DESTINATION_UNSAFE')
    const result = await query(client, `select current_database() as database_name, current_setting('transaction_read_only') as read_only`)
    const row = result.rows[0] || {}
    if (row.database_name !== 'skincos_crm_local' || String(row.read_only).toLowerCase() === 'on') throw migrationError('ATENDIMENTO_MIGRATION_DESTINATION_UNSAFE')
}

async function ensureSchema(client) {
    await query(client, `create schema if not exists crm_atendimento`)
    await query(client, `create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz, details jsonb not null default '{}'::jsonb
    )`)
    await query(client, `alter table crm_atendimento.professionals add column if not exists canonical_id uuid`)
    await query(client, `alter table crm_atendimento.professionals add column if not exists identity_version text not null default '${PROFESSIONAL_IDENTITY_VERSION}'`)
    await query(client, `alter table crm_atendimento.attendances add column if not exists injector_source_name text`)
    await query(client, `alter table crm_atendimento.attendances add column if not exists consultant_source_name text`)
    await query(client, `alter table crm_atendimento.schedule_days add column if not exists professional_id uuid`)
    await query(client, `create table if not exists crm_atendimento.professional_aliases (
        id uuid primary key default gen_random_uuid(),
        professional_id uuid not null references crm_atendimento.professionals(id) on delete restrict,
        alias text not null, alias_key text not null, source text not null default 'roster',
        confidence text not null default 'confirmed', active boolean not null default true,
        created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
        unique(professional_id, alias_key)
    )`)
    await query(client, `create table if not exists crm_atendimento.professional_identity_audit_events (
        id uuid primary key default gen_random_uuid(), event_type text not null, actor jsonb,
        source_professional_id uuid references crm_atendimento.professionals(id) on delete restrict,
        canonical_professional_id uuid references crm_atendimento.professionals(id) on delete restrict,
        payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
    )`)
    const canonicalConstraint = await query(client, `select 1 from pg_constraint where conname = 'crm_atendimento_professionals_canonical_fk'`)
    if (!canonicalConstraint.rows[0]) {
        await query(client, `alter table crm_atendimento.professionals
            add constraint crm_atendimento_professionals_canonical_fk
            foreign key (canonical_id) references crm_atendimento.professionals(id) on delete restrict not valid`)
    }
}

async function upsertAlias(client, professionalId, alias, source, confidence = 'confirmed') {
    const clean = String(alias || '').trim()
    const key = normalizeProfessionalAliasKey(clean)
    if (!clean || !key) return false
    const result = await query(client, `insert into crm_atendimento.professional_aliases(professional_id, alias, alias_key, source, confidence)
        values ($1, $2, $3, $4, $5)
        on conflict(professional_id, alias_key) do nothing`, [professionalId, clean, key, source, confidence])
    return Number(result.rowCount || 0) > 0
}

export function professionalIdentityMigrationPlan() {
    return {
        id: PROFESSIONAL_IDENTITY_MIGRATION_ID,
        identityVersion: PROFESSIONAL_IDENTITY_VERSION,
        confirmedAliasRules: CONFIRMED_PROFESSIONAL_ALIAS_RULES.map((rule) => ({ ...rule, aliases: [...rule.aliases] })),
        indexes: [...INDEXES],
        rollback: 'Drops only indexes and the FK constraint; canonical links, aliases and historical source labels are retained for auditability.',
    }
}

export async function applyProfessionalIdentityMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('ATENDIMENTO_MIGRATION_POOL_REQUIRED')
    const client = await pool.connect()
    const report = { id: PROFESSIONAL_IDENTITY_MIGRATION_ID, canonicalizedRows: 0, aliases: 0, scheduleLinks: 0, confirmedLinks: [], indexes: [] }
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `set statement_timeout = '60s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [PROFESSIONAL_IDENTITY_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await ensureSchema(client)
        const backfill = await query(client, `update crm_atendimento.professionals
            set canonical_id = id, identity_version = coalesce(nullif(identity_version, ''), $1)
            where canonical_id is null`, [PROFESSIONAL_IDENTITY_VERSION])
        report.canonicalizedRows = Number(backfill.rowCount || 0)
        const roster = (await query(client, `select id, canonical_id, name, alias from crm_atendimento.professionals order by created_at asc`)).rows
        for (const rule of CONFIRMED_PROFESSIONAL_ALIAS_RULES) {
            const target = roster.filter((row) => normalizeProfessionalAliasKey(row.name) === normalizeProfessionalAliasKey(rule.canonicalName))
            if (target.length !== 1) continue
            for (const alias of rule.aliases) {
                const sources = roster.filter((row) => normalizeProfessionalAliasKey(row.name) === normalizeProfessionalAliasKey(alias))
                if (sources.length !== 1) continue
                const source = sources[0]
                if (source.id !== target[0].id && source.canonical_id !== target[0].id) {
                    await query(client, `update crm_atendimento.professionals set canonical_id = $2, identity_version = $3 where id = $1`, [source.id, target[0].id, PROFESSIONAL_IDENTITY_VERSION])
                    report.confirmedLinks.push({ sourceId: source.id, sourceName: source.name, canonicalId: target[0].id, canonicalName: target[0].name })
                }
                if (source.id !== target[0].id) {
                    await query(client, `insert into crm_atendimento.professional_identity_audit_events(
                        event_type, source_professional_id, canonical_professional_id, payload
                    ) select 'professional.canonical-link.confirmed', $1, $2, $3::jsonb
                    where not exists (
                        select 1 from crm_atendimento.professional_identity_audit_events
                        where event_type = 'professional.canonical-link.confirmed'
                          and source_professional_id = $1 and canonical_professional_id = $2
                    )`, [
                        source.id,
                        target[0].id,
                        JSON.stringify({ sourceName: source.name, canonicalName: target[0].name, ruleSource: rule.source }),
                    ])
                }
                if (await upsertAlias(client, target[0].id, alias, rule.source)) report.aliases += 1
            }
        }
        const refreshed = (await query(client, `select id, canonical_id, name, alias from crm_atendimento.professionals`)).rows
        for (const row of refreshed) {
            const canonicalId = row.canonical_id || row.id
            if (await upsertAlias(client, canonicalId, row.name, 'legacy-name')) report.aliases += 1
            if (await upsertAlias(client, canonicalId, row.alias, 'legacy-alias')) report.aliases += 1
        }
        const aliases = (await query(client, `select professional_id, alias_key from crm_atendimento.professional_aliases where active`)).rows
        const aliasesByKey = new Map()
        for (const alias of aliases) {
            const key = normalizeProfessionalAliasKey(alias.alias_key)
            const values = aliasesByKey.get(key) || new Set()
            values.add(alias.professional_id)
            aliasesByKey.set(key, values)
        }
        const schedules = (await query(client, `select id, doctor_name from crm_atendimento.schedule_days where professional_id is null`)).rows
        for (const schedule of schedules) {
            const candidates = aliasesByKey.get(normalizeProfessionalAliasKey(schedule.doctor_name)) || new Set()
            if (candidates.size !== 1) continue
            const [professionalId] = candidates
            const linked = await query(client, `update crm_atendimento.schedule_days set professional_id = $2 where id = $1 and professional_id is null`, [schedule.id, professionalId])
            report.scheduleLinks += Number(linked.rowCount || 0)
        }
        await query(client, `alter table crm_atendimento.professionals validate constraint crm_atendimento_professionals_canonical_fk`)
        for (const sql of INDEXES) {
            await query(client, sql)
            report.indexes.push(sql.match(/exists\s+([^\s]+)/i)?.[1] || sql)
        }
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`,
        [PROFESSIONAL_IDENTITY_MIGRATION_ID, JSON.stringify(report)])
        return report
    } finally {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [PROFESSIONAL_IDENTITY_MIGRATION_ID]) } catch { /* best effort */ }
        client.release()
    }
}

export async function rollbackProfessionalIdentityMigration({ pool, databaseUrl }) {
    if (!pool) throw migrationError('ATENDIMENTO_MIGRATION_POOL_REQUIRED')
    const client = await pool.connect()
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [PROFESSIONAL_IDENTITY_MIGRATION_ID])
        await assertLocalDestination(client, databaseUrl)
        await query(client, `drop index concurrently if exists crm_atendimento.crm_atendimento_schedule_professional_period_idx`)
        await query(client, `drop index concurrently if exists crm_atendimento.crm_atendimento_professional_aliases_key_idx`)
        await query(client, `drop index concurrently if exists crm_atendimento.crm_atendimento_professionals_canonical_idx`)
        await query(client, `alter table crm_atendimento.professionals drop constraint if exists crm_atendimento_professionals_canonical_fk`)
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive"}'::jsonb)
            on conflict(id) do update set rolled_back_at = now()`, [PROFESSIONAL_IDENTITY_MIGRATION_ID])
        return { id: PROFESSIONAL_IDENTITY_MIGRATION_ID, rolledBack: true, destructive: false }
    } finally {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [PROFESSIONAL_IDENTITY_MIGRATION_ID]) } catch { /* best effort */ }
        client.release()
    }
}
