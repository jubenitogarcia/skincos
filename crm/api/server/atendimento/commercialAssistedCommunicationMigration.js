import {
    assertAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from './migrationDestination.js'
import { COMMERCIAL_ASSISTED_MIGRATION_ID } from './commercialAssistedCommunication.js'

export { COMMERCIAL_ASSISTED_MIGRATION_ID }

export const COMMERCIAL_ASSISTED_MIGRATION_ACTIONS = Object.freeze(['--apply', '--rollback'])

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const PREREQUISITE_RELATIONS = Object.freeze([
    'crm_atendimento.schema_migrations',
    'crm_atendimento.units',
    'crm_atendimento.global_client_identities',
    'crm_atendimento.global_client_identity_members',
    'crm_atendimento.commercial_actions',
    'crm_atendimento.commercial_offers',
    'crm_atendimento.commercial_offer_procedures',
    'crm_atendimento.commercial_contact_permissions',
    'crm_atendimento.commercial_contact_permission_events',
    'crm_atendimento.commercial_policy_config',
    'crm_atendimento.commercial_canary_cohorts',
    'crm_atendimento.commercial_canary_cohort_members',
    'crm_atendimento.commercial_canary_identity_validations',
    'crm_atendimento.clientes_source_operation_checkpoints',
    'harmonia.contacts',
    'crm_caixa.customers',
    'crm_caixa.sales',
    'crm_caixa.sale_items',
    'crm_atendimento.app_client_registrations',
    'crm_atendimento.supplemental_lead_profiles',
    'crm_atendimento.attendance_client_links',
    'crm_atendimento.attendances',
    'crm_atendimento.procedures',
])

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function createTriggerIfMissing(relation, triggerName, triggerSql) {
    return `do $$ begin
        if not exists (select 1 from pg_trigger where tgrelid='${relation}'::regclass and tgname='${triggerName}') then
            execute $trigger$${triggerSql}$trigger$;
        end if;
    end $$`
}

function runtimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('COMMERCIAL_ASSISTED_RUNTIME_ROLE_UNKNOWN')
    return [
        `revoke create on schema crm_atendimento from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.commercial_assisted_offer_snapshots from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.commercial_assisted_templates from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.commercial_assisted_attempts from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.commercial_assisted_events from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.commercial_assisted_webhook_receipts from ${role}`,
        `revoke update, delete, truncate, references, trigger on table crm_atendimento.commercial_assisted_control_mutations from ${role}`,
        `revoke delete, truncate, references, trigger on table crm_atendimento.commercial_assisted_handoffs from ${role}`,
        `revoke delete, truncate, references, trigger on table crm_atendimento.commercial_assisted_emergency_controls from ${role}`,
        `grant usage on schema crm_atendimento to ${role}`,
        `grant usage on schema crm_caixa to ${role}`,
        `grant usage on schema harmonia to ${role}`,
        `grant select on table crm_atendimento.schema_migrations to ${role}`,
        `grant select on table crm_atendimento.units to ${role}`,
        `grant select on table crm_atendimento.global_client_identity_members to ${role}`,
        `grant select on table crm_atendimento.commercial_actions to ${role}`,
        `grant select on table crm_atendimento.commercial_offers to ${role}`,
        `grant select on table crm_atendimento.commercial_offer_procedures to ${role}`,
        `grant select on table crm_atendimento.procedures to ${role}`,
        `grant select on table crm_atendimento.attendance_client_links to ${role}`,
        `grant select on table crm_atendimento.attendances to ${role}`,
        `grant select on table crm_atendimento.commercial_contact_permissions to ${role}`,
        `grant insert on table crm_atendimento.commercial_contact_permissions to ${role}`,
        `grant update(status, evidence_source, evidence_reference, expires_at, recorded_by, revision, updated_at) on table crm_atendimento.commercial_contact_permissions to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_contact_permission_events to ${role}`,
        `grant select on table crm_atendimento.commercial_policy_config to ${role}`,
        `grant select on table crm_atendimento.commercial_canary_cohorts to ${role}`,
        `grant select on table crm_atendimento.commercial_canary_cohort_members to ${role}`,
        `grant select on table crm_atendimento.commercial_canary_identity_validations to ${role}`,
        `grant select on table crm_atendimento.clientes_source_operation_checkpoints to ${role}`,
        `grant select(phone_keys, unit_slugs, source_client_id) on table crm_atendimento.app_client_registrations to ${role}`,
        `grant select(phone_keys, unit_slugs, source_profile_id) on table crm_atendimento.supplemental_lead_profiles to ${role}`,
        `grant select(id, phone_key) on table crm_caixa.customers to ${role}`,
        `grant select(id, customer_id, unit_id) on table crm_caixa.sales to ${role}`,
        `grant select(sale_id, procedure_id, mapping_status) on table crm_caixa.sale_items to ${role}`,
        `grant select(phone_raw, opted_out_at) on table harmonia.contacts to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_assisted_offer_snapshots to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_assisted_templates to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_assisted_attempts to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_assisted_events to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_assisted_webhook_receipts to ${role}`,
        `grant select, insert on table crm_atendimento.commercial_assisted_control_mutations to ${role}`,
        `grant select, insert, update(state, consumed_at, consumed_by, revoked_at) on table crm_atendimento.commercial_assisted_handoffs to ${role}`,
        `grant select, insert, update(emergency_off, revision, reason_reference, updated_by, updated_at) on table crm_atendimento.commercial_assisted_emergency_controls to ${role}`,
        `grant update(assisted_offer_snapshot_id, assisted_offer_context_hash, assisted_offer_revision, assisted_offer_unit_slug, assisted_offer_validity_end, assisted_campaign_id, assisted_offer_actor_ref, assisted_offer_recorded_at) on table crm_atendimento.commercial_actions to ${role}`,
        `grant usage, select on sequence crm_atendimento.commercial_assisted_events_event_order_seq to ${role}`,
    ]
}

const STATEMENTS = Object.freeze([
    `create extension if not exists pgcrypto`,
    `create table if not exists crm_atendimento.commercial_assisted_offer_snapshots (
        id uuid primary key default gen_random_uuid(),
        offer_id uuid not null references crm_atendimento.commercial_offers(id) on delete restrict,
        offer_revision integer not null check (offer_revision >= 1),
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        unit_slug text not null references crm_atendimento.units(slug) on delete restrict,
        validity_start date,
        validity_end date,
        context_hash text not null check (context_hash ~ '^[a-f0-9]{64}$'),
        context jsonb not null,
        captured_by text not null check (captured_by ~ '^actor:[a-f0-9]{64}$'),
        captured_at timestamptz not null default now(),
        unique(offer_id, offer_revision, context_hash),
        check (validity_end is null or validity_start is null or validity_end >= validity_start),
        check (not (context ?| array['phone','email','telefone','e-mail','recipient','recipientPhone','rawPhone']))
    )`,
    `create table if not exists crm_atendimento.commercial_assisted_templates (
        id uuid primary key default gen_random_uuid(),
        template_key text not null check (template_key ~ '^[a-z0-9][a-z0-9._-]{1,95}$'),
        revision integer not null check (revision >= 1),
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        status text not null check (status in ('draft','approved','disabled')),
        body_template text not null check (char_length(body_template) between 1 and 2000),
        valid_from date,
        valid_until date,
        approved_by text check (approved_by is null or approved_by ~ '^actor:[a-f0-9]{64}$'),
        approved_at timestamptz,
        created_by text not null check (created_by ~ '^actor:[a-f0-9]{64}$'),
        reason_reference text not null check (reason_reference ~ '^reason:[a-f0-9]{64}$'),
        idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'),
        request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
        created_at timestamptz not null default now(),
        unique(template_key, unit_id, revision),
        unique(created_by, idempotency_key),
        check (valid_until is null or valid_from is null or valid_until >= valid_from),
        check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
        check (body_template !~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\\.[[:alpha:]]{2,}')
    )`,
    `create table if not exists crm_atendimento.commercial_assisted_attempts (
        id uuid primary key default gen_random_uuid(),
        actor_reference text not null check (actor_reference ~ '^actor:[a-f0-9]{64}$'),
        idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'),
        request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
        identity_id uuid not null references crm_atendimento.global_client_identities(id) on delete restrict,
        action_id uuid not null references crm_atendimento.commercial_actions(id) on delete restrict,
        unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
        offer_snapshot_id uuid not null references crm_atendimento.commercial_assisted_offer_snapshots(id) on delete restrict,
        template_id uuid not null references crm_atendimento.commercial_assisted_templates(id) on delete restrict,
        offer_context_hash text not null check (offer_context_hash ~ '^[a-f0-9]{64}$'),
        template_context_hash text not null check (template_context_hash ~ '^[a-f0-9]{64}$'),
        preview_context_hash text not null check (preview_context_hash ~ '^[a-f0-9]{64}$'),
        recipient_phone_hash text not null check (recipient_phone_hash ~ '^[a-f0-9]{64}$'),
        recipient_masked text not null check (char_length(recipient_masked) between 4 and 80),
        campaign_id uuid,
        status text not null default 'confirmed' check (status = 'confirmed'),
        provider_send boolean not null default false check (provider_send is false),
        external_dispatch boolean not null default false check (external_dispatch is false),
        created_at timestamptz not null default now(),
        unique(actor_reference, idempotency_key),
        check (recipient_masked !~ '(?:[0-9][^0-9]*){8,}')
    )`,
    `create table if not exists crm_atendimento.commercial_assisted_events (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        attempt_id uuid references crm_atendimento.commercial_assisted_attempts(id) on delete restrict,
        event_type text not null check (event_type in ('template_created','template_approved','previewed','confirmed','handoff_issued','destination_revealed','delivered','read','replied','failed','stop','blocked','emergency_off','emergency_rearmed','migration_rollback')),
        actor_reference text not null check (actor_reference ~ '^(actor|service|migration):[A-Za-z0-9._:-]{1,128}$'),
        correlation_hash text not null check (correlation_hash ~ '^[a-f0-9]{64}$'),
        occurred_at timestamptz not null default now(),
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        check (not (payload ?| array['phone','email','telefone','e-mail','name','recipient','rawBody','message','body','secret','token']))
    )`,
    `create table if not exists crm_atendimento.commercial_assisted_webhook_receipts (
        event_hash text primary key check (event_hash ~ '^[a-f0-9]{64}$'),
        attempt_id uuid not null references crm_atendimento.commercial_assisted_attempts(id) on delete restrict,
        event_type text not null check (event_type in ('delivered','read','replied','failed','stop')),
        received_at timestamptz not null default now()
    )`,
    `create table if not exists crm_atendimento.commercial_assisted_handoffs (
        id uuid primary key default gen_random_uuid(),
        attempt_id uuid not null references crm_atendimento.commercial_assisted_attempts(id) on delete restrict,
        actor_reference text not null check (actor_reference ~ '^actor:[a-f0-9]{64}$'),
        issue_idempotency_key text not null check (issue_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'),
        issue_request_hash text not null check (issue_request_hash ~ '^[a-f0-9]{64}$'),
        token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
        state text not null default 'issued' check (state in ('issued','revealed','revoked')),
        expires_at timestamptz not null,
        consumed_at timestamptz,
        consumed_by text check (consumed_by is null or consumed_by ~ '^actor:[a-f0-9]{64}$'),
        revoked_at timestamptz,
        created_at timestamptz not null default now(),
        unique(actor_reference, issue_idempotency_key)
    )`,
    `create table if not exists crm_atendimento.commercial_assisted_emergency_controls (
        scope_key text primary key check (scope_key = 'global' or scope_key ~ '^unit:[a-z0-9][a-z0-9._-]{0,119}$'),
        unit_slug text references crm_atendimento.units(slug) on delete restrict,
        emergency_off boolean not null default false,
        revision integer not null default 1 check (revision >= 1),
        reason_reference text not null check (reason_reference ~ '^reason:[a-f0-9]{64}$'),
        updated_by text not null check (updated_by ~ '^(actor|migration):[A-Za-z0-9._:-]{1,128}$'),
        updated_at timestamptz not null default now(),
        check ((scope_key='global' and unit_slug is null) or (scope_key=('unit:' || unit_slug) and unit_slug is not null))
    )`,
    `create table if not exists crm_atendimento.commercial_assisted_control_mutations (
        id uuid primary key default gen_random_uuid(),
        scope_key text not null references crm_atendimento.commercial_assisted_emergency_controls(scope_key) on delete restrict,
        actor_reference text not null check (actor_reference ~ '^actor:[a-f0-9]{64}$'),
        idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'),
        request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
        resulting_revision integer not null check (resulting_revision >= 1),
        emergency_off boolean not null,
        created_at timestamptz not null default now(),
        unique(actor_reference, idempotency_key)
    )`,
    `insert into crm_atendimento.commercial_assisted_emergency_controls(scope_key, unit_slug, emergency_off, reason_reference, updated_by)
        values ('global', null, false, 'reason:0000000000000000000000000000000000000000000000000000000000000000', 'migration:commercial-assisted-v2')
        on conflict(scope_key) do nothing`,
    `alter table crm_atendimento.commercial_actions add column if not exists assisted_offer_snapshot_id uuid references crm_atendimento.commercial_assisted_offer_snapshots(id) on delete restrict`,
    `alter table crm_atendimento.commercial_actions add column if not exists assisted_offer_context_hash text`,
    `alter table crm_atendimento.commercial_actions add column if not exists assisted_offer_revision integer`,
    `alter table crm_atendimento.commercial_actions add column if not exists assisted_offer_unit_slug text`,
    `alter table crm_atendimento.commercial_actions add column if not exists assisted_offer_validity_end date`,
    `alter table crm_atendimento.commercial_actions add column if not exists assisted_campaign_id uuid`,
    `alter table crm_atendimento.commercial_actions add column if not exists assisted_offer_actor_ref text`,
    `alter table crm_atendimento.commercial_actions add column if not exists assisted_offer_recorded_at timestamptz`,
    `create unique index if not exists commercial_assisted_attempt_action_idx
        on crm_atendimento.commercial_assisted_attempts(action_id)`,
    `create index if not exists commercial_assisted_templates_lookup_idx
        on crm_atendimento.commercial_assisted_templates(unit_id, template_key, revision desc)`,
    `create index if not exists commercial_assisted_events_attempt_idx
        on crm_atendimento.commercial_assisted_events(attempt_id, event_order desc)`,
    `create index if not exists commercial_assisted_control_mutations_scope_idx
        on crm_atendimento.commercial_assisted_control_mutations(scope_key, created_at desc)`,
    `create index if not exists commercial_assisted_handoffs_attempt_idx
        on crm_atendimento.commercial_assisted_handoffs(attempt_id, actor_reference, expires_at desc)`,
    `do $function$
        begin
            if to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()') is null then
                execute $create$
                    create function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()
                    returns trigger language plpgsql as $body$
                    begin
                        raise exception 'commercial assisted evidence is append-only';
                    end
                    $body$
                $create$;
            end if;
        end
    $function$`,
    createTriggerIfMissing('crm_atendimento.commercial_assisted_offer_snapshots', 'commercial_assisted_offer_snapshots_immutable', `create trigger commercial_assisted_offer_snapshots_immutable before update or delete on crm_atendimento.commercial_assisted_offer_snapshots for each row execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_offer_snapshots', 'commercial_assisted_offer_snapshots_no_truncate', `create trigger commercial_assisted_offer_snapshots_no_truncate before truncate on crm_atendimento.commercial_assisted_offer_snapshots for each statement execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_templates', 'commercial_assisted_templates_immutable', `create trigger commercial_assisted_templates_immutable before update or delete on crm_atendimento.commercial_assisted_templates for each row execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_templates', 'commercial_assisted_templates_no_truncate', `create trigger commercial_assisted_templates_no_truncate before truncate on crm_atendimento.commercial_assisted_templates for each statement execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_attempts', 'commercial_assisted_attempts_immutable', `create trigger commercial_assisted_attempts_immutable before update or delete on crm_atendimento.commercial_assisted_attempts for each row execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_attempts', 'commercial_assisted_attempts_no_truncate', `create trigger commercial_assisted_attempts_no_truncate before truncate on crm_atendimento.commercial_assisted_attempts for each statement execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_events', 'commercial_assisted_events_immutable', `create trigger commercial_assisted_events_immutable before update or delete on crm_atendimento.commercial_assisted_events for each row execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_events', 'commercial_assisted_events_no_truncate', `create trigger commercial_assisted_events_no_truncate before truncate on crm_atendimento.commercial_assisted_events for each statement execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_webhook_receipts', 'commercial_assisted_webhook_receipts_immutable', `create trigger commercial_assisted_webhook_receipts_immutable before update or delete on crm_atendimento.commercial_assisted_webhook_receipts for each row execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_webhook_receipts', 'commercial_assisted_webhook_receipts_no_truncate', `create trigger commercial_assisted_webhook_receipts_no_truncate before truncate on crm_atendimento.commercial_assisted_webhook_receipts for each statement execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_control_mutations', 'commercial_assisted_control_mutations_immutable', `create trigger commercial_assisted_control_mutations_immutable before update or delete on crm_atendimento.commercial_assisted_control_mutations for each row execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
    createTriggerIfMissing('crm_atendimento.commercial_assisted_control_mutations', 'commercial_assisted_control_mutations_no_truncate', `create trigger commercial_assisted_control_mutations_no_truncate before truncate on crm_atendimento.commercial_assisted_control_mutations for each statement execute function crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()`),
])

function triggerReadinessStatement() {
    const entries = [
        ['commercial_assisted_offer_snapshots', 'commercial_assisted_offer_snapshots_immutable', 'commercial_assisted_offer_snapshots_no_truncate'],
        ['commercial_assisted_templates', 'commercial_assisted_templates_immutable', 'commercial_assisted_templates_no_truncate'],
        ['commercial_assisted_attempts', 'commercial_assisted_attempts_immutable', 'commercial_assisted_attempts_no_truncate'],
        ['commercial_assisted_events', 'commercial_assisted_events_immutable', 'commercial_assisted_events_no_truncate'],
        ['commercial_assisted_webhook_receipts', 'commercial_assisted_webhook_receipts_immutable', 'commercial_assisted_webhook_receipts_no_truncate'],
        ['commercial_assisted_control_mutations', 'commercial_assisted_control_mutations_immutable', 'commercial_assisted_control_mutations_no_truncate'],
    ]
    const fields = entries.flatMap(([table, immutable, noTruncate], index) => [
        `exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.${table}') and tgname='${immutable}' and tgenabled='O' and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()')) as immutable_${index}`,
        `exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.${table}') and tgname='${noTruncate}' and tgenabled='O' and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_assisted_evidence_mutation_v2()')) as no_truncate_${index}`,
    ])
    return `select ${fields.join(', ')}`
}

async function ensureRegistry(client) {
    await client.query(`create schema if not exists crm_atendimento`)
    await client.query(`create table if not exists crm_atendimento.schema_migrations (
        id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`)
}

async function assertPrerequisites(client) {
    const fields = PREREQUISITE_RELATIONS.map((relation, index) => `to_regclass('${relation}') is not null as relation_${index}`).join(', ')
    const result = await client.query(`select ${fields}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('COMMERCIAL_ASSISTED_MIGRATION_PREREQUISITES_MISSING')
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ASSISTED_MIGRATION_DESTINATION_UNSAFE')
    try {
        return await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('COMMERCIAL_ASSISTED_MIGRATION_DESTINATION_UNSAFE')
    }
}

async function assertAppendOnly(client) {
    const result = await client.query(triggerReadinessStatement())
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('COMMERCIAL_ASSISTED_APPEND_ONLY_GUARD_MISSING')
}

export function parseCommercialAssistedMigrationAction(args = []) {
    const values = Array.isArray(args) ? args.map((value) => String(value)) : []
    if (values.length !== 1 || !COMMERCIAL_ASSISTED_MIGRATION_ACTIONS.includes(values[0])) {
        throw migrationError('COMMERCIAL_ASSISTED_MIGRATION_ACTION_INVALID')
    }
    return values[0] === '--apply' ? 'apply' : 'rollback'
}

export function commercialAssistedMigrationPlan() {
    return {
        id: COMMERCIAL_ASSISTED_MIGRATION_ID,
        adds: [
            'commercial_assisted_offer_snapshots',
            'commercial_assisted_templates',
            'commercial_assisted_attempts',
            'commercial_assisted_events',
            'commercial_assisted_webhook_receipts',
            'commercial_assisted_control_mutations',
            'commercial_assisted_handoffs',
            'commercial_assisted_emergency_controls',
            'commercial_actions.assisted_offer_snapshot_id',
        ],
        appendOnlyTables: [
            'commercial_assisted_offer_snapshots',
            'commercial_assisted_templates',
            'commercial_assisted_attempts',
            'commercial_assisted_events',
            'commercial_assisted_webhook_receipts',
            'commercial_assisted_control_mutations',
        ],
        outbound: { providerSend: false, automationEnabled: false, externalDispatch: false },
        privacy: 'Only hashes, masked destination presentations and opaque actor references are retained. Raw provider payloads, phone numbers and provider secrets are never persisted.',
        rollback: 'Non-destructive: evidence remains, all assisted emergency controls are closed, and the migration registry is marked rolled back.',
    }
}

export async function applyCommercialAssistedMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('COMMERCIAL_ASSISTED_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ASSISTED_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`set local statement_timeout = '60s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_ASSISTED_MIGRATION_ID])
        const destination = await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await assertPrerequisites(client)
        for (const statement of STATEMENTS) await client.query(statement)
        await assertAppendOnly(client)
        const grants = runtimeGrantStatements(target)
        for (const statement of grants) await client.query(statement)
        const report = {
            ...commercialAssistedMigrationPlan(),
            applied: true,
            target,
            database: destination.database,
            runtimeRole: RUNTIME_ROLES[target],
            runtimeGrants: grants,
        }
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at=excluded.applied_at, rolled_back_at=null, details=excluded.details`, [
            COMMERCIAL_ASSISTED_MIGRATION_ID,
            JSON.stringify(report),
        ])
        await client.query('commit')
        transactionOpen = false
        return report
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the original guarded failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export async function rollbackCommercialAssistedMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL } = {}) {
    if (!pool) throw migrationError('COMMERCIAL_ASSISTED_POOL_REQUIRED')
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('COMMERCIAL_ASSISTED_MIGRATION_DESTINATION_UNSAFE')
    const client = await pool.connect()
    let transactionOpen = false
    try {
        await client.query('begin')
        transactionOpen = true
        await client.query(`set local lock_timeout = '3s'`)
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [COMMERCIAL_ASSISTED_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await ensureRegistry(client)
        await client.query(`update crm_atendimento.commercial_assisted_emergency_controls
            set emergency_off=true, revision=revision+1, reason_reference='reason:0000000000000000000000000000000000000000000000000000000000000000',
                updated_by='migration:commercial-assisted-v2', updated_at=now()`)
        await client.query(`insert into crm_atendimento.commercial_assisted_events(attempt_id,event_type,actor_reference,correlation_hash,payload)
            values (null,'migration_rollback','migration:commercial-assisted-v2','0000000000000000000000000000000000000000000000000000000000000000','{"providerSend":false,"externalDispatch":false}'::jsonb)`)
        await client.query(`insert into crm_atendimento.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true,"providerSend":false}'::jsonb)
            on conflict(id) do update set rolled_back_at=now(), details=excluded.details`, [COMMERCIAL_ASSISTED_MIGRATION_ID])
        await client.query('commit')
        transactionOpen = false
        return { id: COMMERCIAL_ASSISTED_MIGRATION_ID, rolledBack: true, destructive: false, evidenceRetained: true, providerSend: false }
    } catch (error) {
        if (transactionOpen) {
            try { await client.query('rollback') } catch { /* preserve the original guarded failure */ }
        }
        throw error
    } finally {
        client.release()
    }
}

export const __testables = { PREREQUISITE_RELATIONS, STATEMENTS, runtimeGrantStatements, triggerReadinessStatement }
