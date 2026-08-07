import { IDENTITY_GRAPH_LOCK_KEY } from './identityReviewWorkflow.js'
import { assertAtendimentoMigrationDestination, isStrictAtendimentoMigrationDestination, ATENDIMENTO_MIGRATION_TARGETS } from './migrationDestination.js'

export const COMMERCIAL_CANARY_MIGRATION_ID = '20260807_commercial_canary_selector_v2'
export const COMMERCIAL_CANARY_MIGRATION_ACTIONS = Object.freeze(['--apply', '--rollback'])
// Shared by the runtime mutations and this migration. A rollback must not be
// able to cross a transaction that already observed the selector as ready.
export const COMMERCIAL_CANARY_LOCK_KEY = 'crm_atendimento.commercial-canary:global'

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const PREREQUISITES = [
    'crm_atendimento.schema_migrations',
    'crm_atendimento.commercial_policy_config',
    'crm_atendimento.global_client_identities',
    'crm_atendimento.global_client_identity_members',
    'crm_atendimento.units',
    'crm_atendimento.commercial_contact_permissions',
]

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

async function query(client, sql, params = []) {
    return client.query(sql, params)
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw migrationError('COMMERCIAL_CANARY_MIGRATION_DESTINATION_UNSAFE')
    }
    try {
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('COMMERCIAL_CANARY_MIGRATION_DESTINATION_UNSAFE')
    }
}

async function assertPrerequisites(client) {
    const fields = PREREQUISITES.map((relation, index) => `to_regclass('${relation}') as relation_${index}`).join(', ')
    const result = await query(client, `select ${fields}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        throw migrationError('COMMERCIAL_CANARY_MIGRATION_PREREQUISITES_MISSING')
    }
}

const COMMERCIAL_CANARY_MUTATION_LOCKS = Object.freeze([
    IDENTITY_GRAPH_LOCK_KEY,
    COMMERCIAL_CANARY_LOCK_KEY,
])

async function lockCommercialCanaryMutationBoundary(client) {
    for (const key of COMMERCIAL_CANARY_MUTATION_LOCKS) {
        await query(client, `select pg_advisory_lock(hashtext($1))`, [key])
    }
}

async function unlockCommercialCanaryMutationBoundary(client) {
    for (const key of [...COMMERCIAL_CANARY_MUTATION_LOCKS].reverse()) {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [key]) } catch { /* preserve original failure */ }
    }
}

function runtimeGrants(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('COMMERCIAL_CANARY_MIGRATION_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema crm_atendimento to ${role}`,
        `grant select on table crm_atendimento.schema_migrations to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_canary_cohorts to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_canary_cohort_members to ${role}`,
        `grant select, insert, update on table crm_atendimento.commercial_canary_identity_validations to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_canary_events to ${role}`,
    ]
}

const STATEMENTS = [
    `create extension if not exists pgcrypto`,
    `create table if not exists crm_atendimento.commercial_canary_cohorts (
        id uuid primary key default gen_random_uuid(),
        unit_slug text not null references crm_atendimento.units(slug) on delete restrict,
        version integer not null check (version >= 1),
        status text not null check (status in ('active', 'removed', 'emergency_off')),
        policy_version text not null check (policy_version ~ '^[a-f0-9]{32}$'),
        cohort_hash text not null check (cohort_hash ~ '^[a-f0-9]{64}$'),
        member_count integer not null check (member_count >= 0 and member_count <= 100),
        eligible_count integer not null check (eligible_count >= 0 and eligible_count <= member_count),
        blocked_count integer not null check (blocked_count >= 0 and blocked_count <= member_count),
        review_count integer not null check (review_count >= 0 and review_count <= member_count),
        justification text not null check (char_length(justification) between 10 and 500)
            check (justification !~* '\\m[[:alnum:]._%+-]+@[[:alnum:].-]+\\.[[:alpha:]]{2,}\\M')
            check (justification !~* '[0-9][0-9 ()+.-]{6,}[0-9]'),
        created_by text not null,
        created_at timestamptz not null default now(),
        removed_by text,
        removed_at timestamptz,
        removal_reason text,
        unique (unit_slug, version)
    )`,
    `create unique index if not exists commercial_canary_one_active_unit_idx
        on crm_atendimento.commercial_canary_cohorts(unit_slug) where status = 'active'`,
    `create table if not exists crm_atendimento.commercial_canary_cohort_members (
        cohort_id uuid not null references crm_atendimento.commercial_canary_cohorts(id) on delete restrict,
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_slug text not null references crm_atendimento.units(slug) on delete restrict,
        inclusion_reason text not null check (inclusion_reason in ('validated_synthetic', 'validated_explicit_approved')),
        validation_type text not null check (validation_type in ('synthetic', 'explicit_approved')),
        validation_revision integer not null check (validation_revision >= 1),
        source_freshness text not null check (source_freshness = 'healthy'),
        eligibility_status text not null check (eligibility_status = 'eligible'),
        identity_ref_hash text not null check (identity_ref_hash ~ '^[a-f0-9]{64}$'),
        created_at timestamptz not null default now(),
        primary key (cohort_id, identity_id),
        unique (cohort_id, identity_ref_hash)
    )`,
    `create table if not exists crm_atendimento.commercial_canary_identity_validations (
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        unit_slug text not null references crm_atendimento.units(slug) on delete restrict,
        validation_type text not null check (validation_type in ('synthetic', 'explicit_approved')),
        approval_reference_hash text not null check (approval_reference_hash ~ '^[a-f0-9]{64}$'),
        justification text not null check (char_length(justification) between 10 and 500)
            check (justification !~* '\\m[[:alnum:]._%+-]+@[[:alnum:].-]+\\.[[:alpha:]]{2,}\\M')
            check (justification !~* '[0-9][0-9 ()+.-]{6,}[0-9]'),
        revision integer not null default 1 check (revision >= 1),
        validated_by text not null,
        validated_at timestamptz not null default now(),
        expires_at timestamptz,
        primary key (identity_id, unit_slug)
    )`,
    `create table if not exists crm_atendimento.commercial_canary_events (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        idempotency_key text not null unique check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
        request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
        event_type text not null check (event_type in ('identity_validated', 'cohort_saved', 'cohort_removed', 'emergency_off')),
        cohort_id uuid references crm_atendimento.commercial_canary_cohorts(id) on delete restrict,
        unit_slug text references crm_atendimento.units(slug) on delete restrict,
        policy_version text not null check (policy_version ~ '^[a-f0-9]{32}$'),
        actor text not null,
        justification text not null check (char_length(justification) between 10 and 500)
            check (justification !~* '\\m[[:alnum:]._%+-]+@[[:alnum:].-]+\\.[[:alpha:]]{2,}\\M')
            check (justification !~* '[0-9][0-9 ()+.-]{6,}[0-9]'),
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        check (not (payload ?| array['name','phone','email','telefone','e-mail','cpf','identityId','identity_id','candidateRef','candidate_ref','approvalReference','approval_reference']))
    )`,
    `create index if not exists commercial_canary_events_unit_order_idx
        on crm_atendimento.commercial_canary_events(unit_slug, event_order desc)`,
    // Do not replace an existing database object from an additive migration.
    // A future corrective migration must be explicit and versioned instead.
    `do $canary_function$
        begin
            if to_regprocedure('crm_atendimento.prevent_commercial_canary_event_mutation()') is null then
                execute $create_function$
                    create function crm_atendimento.prevent_commercial_canary_event_mutation()
                    returns trigger language plpgsql as $body$
                    begin
                        raise exception 'commercial canary evidence is append-only';
                    end
                    $body$
                $create_function$;
            end if;
        end
    $canary_function$`,
    `do $$
        begin
            if not exists (select 1 from pg_trigger where tgrelid = 'crm_atendimento.commercial_canary_events'::regclass and tgname = 'commercial_canary_events_immutable') then
                create trigger commercial_canary_events_immutable
                before update or delete on crm_atendimento.commercial_canary_events
                for each row execute function crm_atendimento.prevent_commercial_canary_event_mutation();
            end if;
            if not exists (select 1 from pg_trigger where tgrelid = 'crm_atendimento.commercial_canary_events'::regclass and tgname = 'commercial_canary_events_no_truncate') then
                create trigger commercial_canary_events_no_truncate
                before truncate on crm_atendimento.commercial_canary_events
                for each statement execute function crm_atendimento.prevent_commercial_canary_event_mutation();
            end if;
        end $$`,
    // Never let migration application make contact possible. The legacy UUID
    // array is cleared as a one-way safety boundary; v2 cohorts do not enable
    // contact writes, nor do they cause messages to be sent.
    `update crm_atendimento.commercial_policy_config
        set commercial_contact_writes_enabled = false,
            commercial_contact_canary_identity_ids = '{}'::uuid[],
            updated_by = 'commercial-canary-selector-v2-migration',
            updated_at = now()
        where singleton = true`,
]

export function commercialCanaryMigrationPlan() {
    return {
        id: COMMERCIAL_CANARY_MIGRATION_ID,
        adds: ['commercial_canary_cohorts', 'commercial_canary_cohort_members', 'commercial_canary_identity_validations', 'commercial_canary_events'],
        defaultRollout: 'Commercial writes remain disabled, the legacy UUID allowlist is empty, and a cohort never sends a message.',
        identityPolicy: 'Selection uses encrypted, expiring candidate references; customer identities are retained only as relational foreign keys and HMAC references in event payloads.',
        ledger: 'Canary mutation evidence is append-only and protected against update, delete and truncate.',
        rollback: 'Non-destructive: all evidence remains, active cohorts are disabled, legacy writes are disabled, and the migration registry is marked rolled back.',
    }
}

export function parseCommercialCanaryMigrationAction(args = []) {
    const values = Array.isArray(args) ? args.map((value) => String(value)) : []
    if (values.length !== 1 || !COMMERCIAL_CANARY_MIGRATION_ACTIONS.includes(values[0])) {
        const error = migrationError('COMMERCIAL_CANARY_MIGRATION_ACTION_INVALID')
        error.message = 'Use exatamente uma ação: --apply ou --rollback.'
        throw error
    }
    return values[0] === '--apply' ? 'apply' : 'rollback'
}

export async function applyCommercialCanaryMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_CANARY_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_CANARY_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    const report = {
        id: COMMERCIAL_CANARY_MIGRATION_ID,
        applied: false,
        tables: ['commercial_canary_cohorts', 'commercial_canary_cohort_members', 'commercial_canary_identity_validations', 'commercial_canary_events'],
        commercialWritesEnabled: false,
        messagesSent: 0,
        appendOnlyTables: ['commercial_canary_events'],
    }
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `set statement_timeout = '60s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_CANARY_MIGRATION_ID])
        await lockCommercialCanaryMutationBoundary(client)
        await assertDestination(client, databaseUrl, target)
        await assertPrerequisites(client)
        for (const statement of STATEMENTS) await query(client, statement)
        const grants = runtimeGrants(target)
        for (const statement of grants) await query(client, statement)
        report.runtimeRole = RUNTIME_ROLES[target]
        report.runtimeGrants = grants
        report.applied = true
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`,
        [COMMERCIAL_CANARY_MIGRATION_ID, JSON.stringify(report)])
        return report
    } finally {
        await unlockCommercialCanaryMutationBoundary(client)
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_CANARY_MIGRATION_ID]) } catch { /* preserve original failure */ }
        client.release()
    }
}

export async function rollbackCommercialCanaryMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('COMMERCIAL_CANARY_MIGRATION_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_CANARY_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    try {
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_CANARY_MIGRATION_ID])
        await lockCommercialCanaryMutationBoundary(client)
        await assertDestination(client, databaseUrl, target)
        await assertPrerequisites(client)
        await query(client, `update crm_atendimento.commercial_policy_config
            set commercial_contact_writes_enabled = false,
                commercial_contact_canary_identity_ids = '{}'::uuid[],
                updated_by = 'commercial-canary-selector-v2-rollback',
                updated_at = now()
            where singleton = true`)
        await query(client, `update crm_atendimento.commercial_canary_cohorts
            set status = 'emergency_off', removed_by = 'commercial-canary-selector-v2-rollback',
                removed_at = now(), removal_reason = 'migration_rollback'
            where status = 'active'`)
        await query(client, `insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","writesDisabled":true,"evidenceRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now(), details = excluded.details`, [COMMERCIAL_CANARY_MIGRATION_ID])
        return { id: COMMERCIAL_CANARY_MIGRATION_ID, rolledBack: true, destructive: false, commercialWritesEnabled: false, evidenceRetained: true }
    } finally {
        await unlockCommercialCanaryMutationBoundary(client)
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_CANARY_MIGRATION_ID]) } catch { /* preserve original failure */ }
        client.release()
    }
}
