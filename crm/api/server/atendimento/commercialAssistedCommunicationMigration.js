import { assertAtendimentoMigrationDestination, isStrictAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS } from './migrationDestination.js'

export const COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ID = '20260806_commercial_assisted_communication_v1'
export const COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ACTIONS = Object.freeze(['--apply', '--rollback'])

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const PREREQUISITE_RELATIONS = [
    'crm_atendimento.units',
    'crm_atendimento.commercial_offers',
    'crm_atendimento.commercial_actions',
    'crm_atendimento.commercial_contact_permissions',
    'crm_atendimento.commercial_policy_config',
]

const STATEMENTS = [
    `create extension if not exists pgcrypto`,
    `alter table crm_atendimento.commercial_actions
        add column if not exists offer_id uuid references crm_atendimento.commercial_offers(id) on delete restrict,
        add column if not exists offer_revision integer,
        add column if not exists offer_context_hash text,
        add column if not exists offer_context jsonb,
        add column if not exists offer_unit_slug text,
        add column if not exists offer_validity_end date,
        add column if not exists campaign_key text`,
    `create table if not exists crm_atendimento.commercial_offer_revisions (
        offer_id uuid not null references crm_atendimento.commercial_offers(id) on delete restrict,
        revision integer not null check (revision > 0),
        context jsonb not null,
        context_hash text not null,
        captured_by text not null,
        captured_at timestamptz not null default now(),
        primary key (offer_id, revision)
    )`,
    `create table if not exists crm_atendimento.commercial_whatsapp_templates (
        id uuid primary key default gen_random_uuid(),
        template_key text not null,
        revision integer not null check (revision > 0),
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        status text not null check (status in ('draft','approved','disabled')),
        body_template text not null check (length(body_template) between 1 and 4096),
        offer_required boolean not null default true,
        valid_from timestamptz,
        valid_until timestamptz,
        approved_by text,
        approved_at timestamptz,
        created_by text not null,
        reason text not null,
        created_at timestamptz not null default now(),
        unique(template_key, revision),
        check (valid_until is null or valid_from is null or valid_until > valid_from),
        check (status <> 'approved' or (approved_by is not null and approved_at is not null))
    )`,
    `create table if not exists crm_atendimento.commercial_whatsapp_attempts (
        id uuid primary key default gen_random_uuid(),
        idempotency_key text not null unique check (length(idempotency_key) between 8 and 180),
        identity_id uuid not null,
        action_id uuid not null references crm_atendimento.commercial_actions(id) on delete restrict,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        offer_id uuid not null references crm_atendimento.commercial_offers(id) on delete restrict,
        offer_revision integer not null check (offer_revision > 0),
        offer_context_hash text not null,
        template_key text not null,
        template_revision integer not null check (template_revision > 0),
        recipient_phone_hash text not null,
        recipient_masked text not null,
        status text not null check (status in ('confirmed','opened','sent','delivered','read','replied','failed','opted_out','blocked')),
        campaign_key text,
        created_by text not null,
        created_at timestamptz not null default now(),
        payload jsonb not null default '{}'::jsonb
    )`,
    `create table if not exists crm_atendimento.commercial_whatsapp_events (
        id uuid primary key default gen_random_uuid(),
        attempt_id uuid not null references crm_atendimento.commercial_whatsapp_attempts(id) on delete restrict,
        provider_event_key text not null unique,
        event_type text not null check (event_type in ('confirmed','opened','sent','delivered','read','replied','failed','stop')),
        occurred_at timestamptz not null,
        recorded_by text not null,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
    )`,
    `alter table crm_atendimento.commercial_whatsapp_events
        drop constraint if exists commercial_whatsapp_events_event_type_check,
        add constraint commercial_whatsapp_events_event_type_check
            check (event_type in ('confirmed','opened','sent','delivered','read','replied','failed','stop'))`,
    `create table if not exists crm_atendimento.commercial_contact_emergency_controls (
        scope_key text primary key,
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        emergency_off boolean not null default false,
        reason text not null default '',
        updated_by text not null,
        updated_at timestamptz not null default now(),
        check ((scope_key = 'global' and unit_id is null) or (scope_key like 'unit:%' and unit_id is not null))
    )`,
    `insert into crm_atendimento.commercial_contact_emergency_controls(scope_key, unit_id, emergency_off, reason, updated_by)
        values ('global', null, false, 'default fail-closed control; emergency off inactive', 'migration')
        on conflict(scope_key) do nothing`,
    `create index if not exists commercial_offer_revisions_lookup_idx
        on crm_atendimento.commercial_offer_revisions(offer_id, revision desc)`,
    `create index if not exists commercial_whatsapp_attempts_identity_idx
        on crm_atendimento.commercial_whatsapp_attempts(identity_id, created_at desc)`,
    `create index if not exists commercial_whatsapp_events_attempt_idx
        on crm_atendimento.commercial_whatsapp_events(attempt_id, occurred_at desc)`,
    `create index if not exists commercial_whatsapp_templates_scope_idx
        on crm_atendimento.commercial_whatsapp_templates(unit_id, status, template_key, revision desc)`,
    `create or replace function crm_atendimento.prevent_commercial_assisted_append_only()
        returns trigger language plpgsql as $$
        begin
            raise exception 'commercial assisted communication evidence is append-only';
        end $$`,
]

const APPEND_ONLY_TABLES = [
    'commercial_offer_revisions',
    'commercial_whatsapp_events',
]

for (const table of APPEND_ONLY_TABLES) {
    STATEMENTS.push(`drop trigger if exists ${table}_immutable on crm_atendimento.${table}`)
    STATEMENTS.push(`create trigger ${table}_immutable before update or delete on crm_atendimento.${table}
        for each row execute function crm_atendimento.prevent_commercial_assisted_append_only()`)
    STATEMENTS.push(`drop trigger if exists ${table}_no_truncate on crm_atendimento.${table}`)
    STATEMENTS.push(`create trigger ${table}_no_truncate before truncate on crm_atendimento.${table}
        for each statement execute function crm_atendimento.prevent_commercial_assisted_append_only()`)
}

STATEMENTS.push(`create or replace function crm_atendimento.prevent_commercial_assisted_attempt_mutation()
        returns trigger language plpgsql as $$
        begin
            if tg_op = 'UPDATE' and (
                new.id is distinct from old.id or
                new.idempotency_key is distinct from old.idempotency_key or
                new.identity_id is distinct from old.identity_id or
                new.action_id is distinct from old.action_id or
                new.unit_id is distinct from old.unit_id or
                new.offer_id is distinct from old.offer_id or
                new.offer_revision is distinct from old.offer_revision or
                new.offer_context_hash is distinct from old.offer_context_hash or
                new.template_key is distinct from old.template_key or
                new.template_revision is distinct from old.template_revision or
                new.recipient_phone_hash is distinct from old.recipient_phone_hash or
                new.recipient_masked is distinct from old.recipient_masked or
                new.campaign_key is distinct from old.campaign_key or
                new.created_by is distinct from old.created_by or
                new.created_at is distinct from old.created_at or
                new.payload is distinct from old.payload
            ) then
                raise exception 'commercial whatsapp attempt evidence is immutable';
            end if;
            if tg_op = 'DELETE' then
                raise exception 'commercial whatsapp attempt evidence is append-only';
            end if;
            return new;
        end $$`)
STATEMENTS.push(`drop trigger if exists commercial_whatsapp_attempts_immutable on crm_atendimento.commercial_whatsapp_attempts`)
STATEMENTS.push(`create trigger commercial_whatsapp_attempts_immutable before update or delete on crm_atendimento.commercial_whatsapp_attempts
        for each row execute function crm_atendimento.prevent_commercial_assisted_attempt_mutation()`)
STATEMENTS.push(`drop trigger if exists commercial_whatsapp_attempts_no_truncate on crm_atendimento.commercial_whatsapp_attempts`)
STATEMENTS.push(`create trigger commercial_whatsapp_attempts_no_truncate before truncate on crm_atendimento.commercial_whatsapp_attempts
        for each statement execute function crm_atendimento.prevent_commercial_assisted_append_only()`)

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('COMMERCIAL_ASSISTED_COMMUNICATION_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select on table crm_atendimento.commercial_offer_revisions to ${role}`,
        `grant select on table crm_atendimento.commercial_whatsapp_templates to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_whatsapp_attempts to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_whatsapp_events to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_contact_emergency_controls to ${role}`,
        `grant select on table crm_atendimento.commercial_actions to ${role}`,
    ]
}

export function parseCommercialAssistedCommunicationMigrationAction(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 1 || !COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ACTIONS.includes(values[0])) {
        throw migrationError('COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ACTION_INVALID')
    }
    return values[0] === '--apply' ? 'apply' : 'rollback'
}

async function assertPrerequisites(client) {
    const columns = PREREQUISITE_RELATIONS.map((relation, index) => `to_regclass('${relation}') as relation_${index}`).join(', ')
    const result = await client.query(`select ${columns}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_PREREQUISITES_MISSING')
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

export function commercialAssistedCommunicationMigrationPlan() {
    return {
        id: COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ID,
        tables: ['commercial_offer_revisions', 'commercial_whatsapp_templates', 'commercial_whatsapp_attempts', 'commercial_whatsapp_events', 'commercial_contact_emergency_controls'],
        actionColumns: ['offer_id', 'offer_revision', 'offer_context_hash', 'offer_context', 'offer_unit_slug', 'offer_validity_end', 'campaign_key'],
        runtimeAccess: 'Approved-template reads, offer-context reads and append-only click-to-send evidence. Emergency controls are explicit and auditable. No provider send permission is granted.',
        privacy: 'No raw phone, message secret or provider token is persisted. Attempts retain only a phone hash and masked operational context.',
        rollback: 'Non-destructive: preserves offer and communication evidence, marks migration rolled back and leaves commercial writes disabled.',
    }
}

export async function applyCommercialAssistedCommunicationMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    try {
        await client.query(`set lock_timeout = '3s'`)
        await client.query(`set statement_timeout = '60s'`)
        await client.query(`select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ID])
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
        await assertPrerequisites(client)
        await ensureRegistry(client)
        for (const sql of STATEMENTS) await client.query(sql)
        const grants = runtimeGrantStatements(target)
        for (const sql of grants) await client.query(sql)
        const report = { id: COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ID, applied: true, tables: commercialAssistedCommunicationMigrationPlan().tables, actionColumns: commercialAssistedCommunicationMigrationPlan().actionColumns, appendOnlyTables: APPEND_ONLY_TABLES, runtimeRole: RUNTIME_ROLES[target], runtimeGrants: grants }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`, [COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ID, JSON.stringify(report)])
        return report
    } finally {
        try { await client.query(`select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ID]) } catch { /* connection cleanup releases lock */ }
        client.release()
    }
}

export async function rollbackCommercialAssistedCommunicationMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    try {
        await client.query(`set lock_timeout = '3s'`)
        await client.query(`select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ID])
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true,"providerSend":false}'::jsonb)
            on conflict(id) do update set rolled_back_at=now(), details=excluded.details`, [COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ID])
        return { id: COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ID, rolledBack: true, destructive: false, evidenceRetained: true, providerSend: false }
    } finally {
        try { await client.query(`select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_ASSISTED_COMMUNICATION_MIGRATION_ID]) } catch { /* preserve result */ }
        client.release()
    }
}

export const __testables = { runtimeGrantStatements, assertPrerequisites, APPEND_ONLY_TABLES }
