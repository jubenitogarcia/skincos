import {
    assertAtendimentoMigrationDestination,
    isStrictAtendimentoMigrationDestination,
    ATENDIMENTO_MIGRATION_TARGETS,
} from '../atendimento/migrationDestination.js'

export const CLINICAL_APPROVAL_MIGRATION_ID = '20260806_clinical_cadence_approval_v1'
export const CLINICAL_APPROVAL_MIGRATION_ACTIONS = Object.freeze(['--apply', '--rollback'])

const RUNTIME_ROLES = Object.freeze({
    [ATENDIMENTO_MIGRATION_TARGETS.LOCAL]: 'skincos',
    [ATENDIMENTO_MIGRATION_TARGETS.STAGING]: 'skincos_staging_crm_app',
})

const PREREQUISITE_RELATIONS = Object.freeze([
    'crm_atendimento.procedures',
    'crm_atendimento.units',
])

function migrationError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

export function parseClinicalApprovalMigrationAction(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 1 || !CLINICAL_APPROVAL_MIGRATION_ACTIONS.includes(values[0])) {
        const error = migrationError('CLINICAL_APPROVAL_MIGRATION_ACTION_INVALID')
        error.message = 'Use exatamente uma ação: --apply ou --rollback.'
        throw error
    }
    return values[0] === '--apply' ? 'apply' : 'rollback'
}

export function clinicalApprovalRuntimeGrantStatements(target) {
    const role = RUNTIME_ROLES[target]
    if (!role) throw migrationError('CLINICAL_APPROVAL_RUNTIME_ROLE_UNKNOWN')
    return [
        `grant usage on schema clinical_approval to ${role}`,
        `grant select on table clinical_approval.schema_migrations to ${role}`,
        `grant select, insert, update on table clinical_approval.rules to ${role}`,
        `grant select, insert on table clinical_approval.rule_revisions to ${role}`,
        `grant select, insert on table clinical_approval.rule_events to ${role}`,
        `grant select, insert on table clinical_approval.command_dedup to ${role}`,
        `grant usage, select on sequence clinical_approval.rule_events_event_order_seq to ${role}`,
        `grant usage, select on sequence clinical_approval.command_dedup_event_order_seq to ${role}`,
        `grant select on table crm_atendimento.procedures to ${role}`,
        `grant select on table crm_atendimento.units to ${role}`,
    ]
}

const STATEMENTS = Object.freeze([
    `create extension if not exists pgcrypto`,
    `create schema if not exists clinical_approval`,
    `create table if not exists clinical_approval.schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now(),
        rolled_back_at timestamptz,
        details jsonb not null default '{}'::jsonb
    )`,
    `create table if not exists clinical_approval.rules (
        id uuid primary key default gen_random_uuid(),
        procedure_id uuid not null references crm_atendimento.procedures(id) on delete restrict,
        unit_id uuid references crm_atendimento.units(id) on delete restrict,
        current_revision integer not null default 1 check (current_revision >= 1),
        interval_min_days integer not null check (interval_min_days between 1 and 1095),
        interval_max_days integer not null check (interval_max_days between 1 and 1095),
        justification text not null check (char_length(btrim(justification)) between 10 and 2000),
        evidence_reference text not null check (char_length(btrim(evidence_reference)) between 3 and 1000),
        effective_from date not null,
        expires_at date,
        current_status text not null default 'draft'
            check (current_status in ('draft','submitted','approved','rejected','expired','disabled')),
        author_id text not null check (char_length(btrim(author_id)) between 1 and 200),
        approver_id text,
        approved_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check (interval_max_days >= interval_min_days),
        check (expires_at is null or expires_at > effective_from),
        check ((current_status = 'approved' and approver_id is not null and approved_at is not null)
            or current_status <> 'approved'),
        constraint clinical_approval_rules_approver_not_author
            check (current_status <> 'approved' or approver_id is distinct from author_id),
        unique nulls not distinct(procedure_id, unit_id)
    )`,
    `create table if not exists clinical_approval.rule_revisions (
        id uuid primary key default gen_random_uuid(),
        rule_id uuid not null references clinical_approval.rules(id) on delete restrict,
        revision integer not null check (revision >= 1),
        interval_min_days integer not null check (interval_min_days between 1 and 1095),
        interval_max_days integer not null check (interval_max_days between interval_min_days and 1095),
        justification text not null check (char_length(btrim(justification)) between 10 and 2000),
        evidence_reference text not null check (char_length(btrim(evidence_reference)) between 3 and 1000),
        effective_from date not null,
        expires_at date,
        status text not null check (status in ('draft','submitted','approved','rejected','expired','disabled')),
        author_id text not null,
        approver_id text,
        approved_at timestamptz,
        recorded_by text not null,
        recorded_at timestamptz not null default now(),
        unique(rule_id, revision),
        check (expires_at is null or expires_at > effective_from),
        check ((status = 'approved' and approver_id is not null and approved_at is not null)
            or status <> 'approved'),
        constraint clinical_approval_revisions_approver_not_author
            check (status <> 'approved' or approver_id is distinct from author_id)
    )`,
    `create table if not exists clinical_approval.rule_events (
        id uuid primary key default gen_random_uuid(),
        event_order bigint generated always as identity,
        rule_id uuid not null references clinical_approval.rules(id) on delete restrict,
        revision integer not null check (revision >= 1),
        event_type text not null check (event_type in ('created','revision_created','submitted','approved','rejected','expired','disabled')),
        previous_status text check (previous_status in ('draft','submitted','approved','rejected','expired','disabled')),
        status text not null check (status in ('draft','submitted','approved','rejected','expired','disabled')),
        actor_id text not null,
        actor_role text not null,
        reason text,
        idempotency_key text,
        details jsonb not null default '{}'::jsonb,
        recorded_at timestamptz not null default now()
    )`,
    `create table if not exists clinical_approval.command_dedup (
        event_order bigint generated always as identity,
        actor_id text not null,
        idempotency_key text not null,
        operation text not null,
        request_hash text not null,
        result jsonb not null,
        recorded_at timestamptz not null default now(),
        primary key(actor_id, idempotency_key, operation)
    )`,
    `create index if not exists clinical_approval_rules_status_idx
        on clinical_approval.rules(current_status, expires_at, effective_from)`,
    `create index if not exists clinical_approval_rules_unit_idx
        on clinical_approval.rules(unit_id, procedure_id)`,
    `create index if not exists clinical_approval_rule_events_rule_idx
        on clinical_approval.rule_events(rule_id, event_order desc)`,
    `create index if not exists clinical_approval_rule_events_actor_idx
        on clinical_approval.rule_events(actor_id, recorded_at desc)`,
    `do $$ begin
        if not exists (
            select 1 from pg_constraint
             where conrelid = 'clinical_approval.rules'::regclass
               and conname = 'clinical_approval_rules_approver_not_author'
        ) then
            alter table clinical_approval.rules add constraint clinical_approval_rules_approver_not_author
                check (current_status <> 'approved' or approver_id is distinct from author_id);
        end if;
    end $$`,
    `do $$ begin
        if not exists (
            select 1 from pg_constraint
             where conrelid = 'clinical_approval.rule_revisions'::regclass
               and conname = 'clinical_approval_revisions_approver_not_author'
        ) then
            alter table clinical_approval.rule_revisions add constraint clinical_approval_revisions_approver_not_author
                check (status <> 'approved' or approver_id is distinct from author_id);
        end if;
    end $$`,
    `create or replace function clinical_approval.prevent_append_only_mutation()
        returns trigger language plpgsql as $$
        begin
            raise exception 'clinical approval evidence is append-only';
        end $$`,
    `drop trigger if exists clinical_approval_rule_revisions_immutable on clinical_approval.rule_revisions`,
    `create trigger clinical_approval_rule_revisions_immutable
        before update or delete on clinical_approval.rule_revisions
        for each row execute function clinical_approval.prevent_append_only_mutation()`,
    `drop trigger if exists clinical_approval_rule_revisions_no_truncate on clinical_approval.rule_revisions`,
    `create trigger clinical_approval_rule_revisions_no_truncate
        before truncate on clinical_approval.rule_revisions
        for each statement execute function clinical_approval.prevent_append_only_mutation()`,
    `drop trigger if exists clinical_approval_rule_events_immutable on clinical_approval.rule_events`,
    `create trigger clinical_approval_rule_events_immutable
        before update or delete on clinical_approval.rule_events
        for each row execute function clinical_approval.prevent_append_only_mutation()`,
    `drop trigger if exists clinical_approval_rule_events_no_truncate on clinical_approval.rule_events`,
    `create trigger clinical_approval_rule_events_no_truncate
        before truncate on clinical_approval.rule_events
        for each statement execute function clinical_approval.prevent_append_only_mutation()`,
    `drop trigger if exists clinical_approval_command_dedup_immutable on clinical_approval.command_dedup`,
    `create trigger clinical_approval_command_dedup_immutable
        before update or delete on clinical_approval.command_dedup
        for each row execute function clinical_approval.prevent_append_only_mutation()`,
    `drop trigger if exists clinical_approval_command_dedup_no_truncate on clinical_approval.command_dedup`,
    `create trigger clinical_approval_command_dedup_no_truncate
        before truncate on clinical_approval.command_dedup
        for each statement execute function clinical_approval.prevent_append_only_mutation()`,
    `create or replace function clinical_approval.guard_rule_revision()
        returns trigger language plpgsql as $$
        begin
            if new.current_revision < old.current_revision or new.current_revision > old.current_revision + 1 then
                raise exception 'clinical approval revision must advance exactly one step';
            end if;
            if new.current_revision = old.current_revision and (
                new.procedure_id is distinct from old.procedure_id or
                new.unit_id is distinct from old.unit_id or
                new.interval_min_days is distinct from old.interval_min_days or
                new.interval_max_days is distinct from old.interval_max_days or
                new.justification is distinct from old.justification or
                new.evidence_reference is distinct from old.evidence_reference or
                new.effective_from is distinct from old.effective_from or
                new.expires_at is distinct from old.expires_at or
                new.author_id is distinct from old.author_id
            ) then
                raise exception 'clinical approval content requires a new revision';
            end if;
            return new;
        end $$`,
    `create or replace function clinical_approval.guard_rule_transition()
        returns trigger language plpgsql as $$
        begin
            if old.current_status = new.current_status then
                return new;
            end if;
            if new.current_status = 'approved' and old.current_status <> 'submitted' then
                raise exception 'clinical approval requires submitted revision';
            end if;
            if old.current_status = 'draft' and new.current_status not in ('submitted','disabled') then
                raise exception 'clinical approval draft transition is invalid';
            end if;
            if old.current_status = 'submitted' and new.current_status not in ('approved','rejected','disabled') then
                raise exception 'clinical approval submitted transition is invalid';
            end if;
            if old.current_status = 'approved' and new.current_status not in ('expired','disabled','draft') then
                raise exception 'clinical approval approved transition is invalid';
            end if;
            if old.current_status = 'rejected' and new.current_status not in ('submitted','disabled','draft') then
                raise exception 'clinical approval rejected transition is invalid';
            end if;
            if old.current_status = 'expired' and new.current_status not in ('disabled','draft') then
                raise exception 'clinical approval expired transition is invalid';
            end if;
            if old.current_status = 'disabled' and new.current_status <> 'draft' then
                raise exception 'clinical approval disabled transition is invalid';
            end if;
            if new.current_status = 'draft' and new.current_revision <> old.current_revision + 1 then
                raise exception 'clinical approval reactivation requires a new revision';
            end if;
            return new;
        end $$`,
    `drop trigger if exists clinical_approval_rules_transition_guard on clinical_approval.rules`,
    `create trigger clinical_approval_rules_transition_guard
        before update on clinical_approval.rules
        for each row execute function clinical_approval.guard_rule_transition()`,
    `create or replace function clinical_approval.require_rule_event_evidence()
        returns trigger language plpgsql as $$
        begin
            if not exists (
                select 1 from clinical_approval.rule_revisions revision
                 where revision.rule_id = new.id
                   and revision.revision = new.current_revision
            ) then
                raise exception 'clinical approval state requires append-only revision evidence';
            end if;
            if not exists (
                select 1 from clinical_approval.rule_events event
                 where event.rule_id = new.id
                   and event.revision = new.current_revision
                   and event.status = new.current_status
            ) then
                raise exception 'clinical approval state requires append-only event evidence';
            end if;
            return new;
        end $$`,
    `drop trigger if exists clinical_approval_rules_event_evidence on clinical_approval.rules`,
    `create constraint trigger clinical_approval_rules_event_evidence
        after insert or update on clinical_approval.rules
        deferrable initially deferred
        for each row execute function clinical_approval.require_rule_event_evidence()`,
    `create or replace function clinical_approval.prevent_rule_removal()
        returns trigger language plpgsql as $$
        begin
            raise exception 'clinical approval rules are retained; disable or expire instead';
        end $$`,
    `drop trigger if exists clinical_approval_rules_no_delete on clinical_approval.rules`,
    `create trigger clinical_approval_rules_no_delete
        before delete on clinical_approval.rules
        for each row execute function clinical_approval.prevent_rule_removal()`,
    `drop trigger if exists clinical_approval_rules_no_truncate on clinical_approval.rules`,
    `create trigger clinical_approval_rules_no_truncate
        before truncate on clinical_approval.rules
        for each statement execute function clinical_approval.prevent_rule_removal()`,
    `drop trigger if exists clinical_approval_rules_revision_guard on clinical_approval.rules`,
    `create trigger clinical_approval_rules_revision_guard
        before update on clinical_approval.rules
        for each row execute function clinical_approval.guard_rule_revision()`,
    `create or replace function clinical_approval.block_legacy_approved_cadence()
        returns trigger language plpgsql as $$
        begin
            if new.status = 'approved' then
                raise exception 'CLINICAL_CADENCE_APPROVAL_REQUIRED';
            end if;
            return new;
        end $$`,
    `drop trigger if exists commercial_procedure_cadences_clinical_gate on crm_atendimento.commercial_procedure_cadences`,
    `create trigger commercial_procedure_cadences_clinical_gate
        before insert or update on crm_atendimento.commercial_procedure_cadences
        for each row execute function clinical_approval.block_legacy_approved_cadence()`,
])

async function query(client, sql, params = []) {
    return client.query(sql, params)
}

async function assertPrerequisites(client) {
    const projection = PREREQUISITE_RELATIONS.map((relation, index) => `to_regclass('${relation}') as relation_${index}`).join(', ')
    const result = await query(client, `select ${projection}`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) throw migrationError('CLINICAL_APPROVAL_PREREQUISITES_MISSING')
}

async function assertDestination(client, databaseUrl, target) {
    if (!isStrictAtendimentoMigrationDestination(databaseUrl, target)) throw migrationError('CLINICAL_APPROVAL_MIGRATION_DESTINATION_UNSAFE')
    try {
        await assertAtendimentoMigrationDestination(client, databaseUrl, target)
    } catch {
        throw migrationError('CLINICAL_APPROVAL_MIGRATION_DESTINATION_UNSAFE')
    }
}

export function clinicalApprovalMigrationPlan() {
    return {
        id: CLINICAL_APPROVAL_MIGRATION_ID,
        schema: 'clinical_approval',
        tables: ['rules', 'rule_revisions', 'rule_events', 'command_dedup'],
        lifecycle: ['draft', 'submitted', 'approved', 'rejected', 'expired', 'disabled'],
        runtimeRole: 'no DDL; scoped SELECT/INSERT/UPDATE only',
        appendOnly: ['rule_revisions', 'rule_events', 'command_dedup'],
        commercialGate: 'legacy commercial cadence writes cannot create approved rows; approved reads come only from clinical_approval.rules',
        rollback: 'non-destructive registry mark; evidence and schema remain for controlled recovery',
    }
}

export async function applyClinicalApprovalMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('CLINICAL_APPROVAL_MIGRATION_POOL_REQUIRED')
    const client = await pool.connect()
    const report = { id: CLINICAL_APPROVAL_MIGRATION_ID, applied: false, schema: 'clinical_approval', tables: clinicalApprovalMigrationPlan().tables, appendOnlyTables: clinicalApprovalMigrationPlan().appendOnly }
    try {
        await query(client, 'begin')
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `set statement_timeout = '60s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [CLINICAL_APPROVAL_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await assertPrerequisites(client)
        for (const sql of STATEMENTS) await query(client, sql)
        const grants = clinicalApprovalRuntimeGrantStatements(target)
        for (const sql of grants) await query(client, sql)
        report.runtimeRole = RUNTIME_ROLES[target]
        report.runtimeGrants = grants
        report.applied = true
        await query(client, `insert into clinical_approval.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), null, $2::jsonb)
            on conflict(id) do update set applied_at = excluded.applied_at, rolled_back_at = null, details = excluded.details`,
        [CLINICAL_APPROVAL_MIGRATION_ID, JSON.stringify(report)])
        await query(client, 'commit')
        return report
    } catch (error) {
        try { await query(client, 'rollback') } catch { /* preserve original migration error */ }
        throw error
    } finally {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [CLINICAL_APPROVAL_MIGRATION_ID]) } catch { /* preserve failure */ }
        client.release()
    }
}

export async function rollbackClinicalApprovalMigration({ pool, databaseUrl, target = ATENDIMENTO_MIGRATION_TARGETS.LOCAL }) {
    if (!pool) throw migrationError('CLINICAL_APPROVAL_MIGRATION_POOL_REQUIRED')
    const client = await pool.connect()
    try {
        await query(client, 'begin')
        await query(client, `set lock_timeout = '3s'`)
        await query(client, `select pg_advisory_lock(hashtext($1))`, [CLINICAL_APPROVAL_MIGRATION_ID])
        await assertDestination(client, databaseUrl, target)
        await query(client, `create schema if not exists clinical_approval`)
        await query(client, `create table if not exists clinical_approval.schema_migrations (
            id text primary key, applied_at timestamptz not null default now(), rolled_back_at timestamptz,
            details jsonb not null default '{}'::jsonb
        )`)
        await query(client, `insert into clinical_approval.schema_migrations(id, applied_at, rolled_back_at, details)
            values ($1, now(), now(), '{"rollback":"non-destructive","evidenceRetained":true}'::jsonb)
            on conflict(id) do update set rolled_back_at = now(), details = excluded.details`, [CLINICAL_APPROVAL_MIGRATION_ID])
        await query(client, 'commit')
        return { id: CLINICAL_APPROVAL_MIGRATION_ID, rolledBack: true, destructive: false, evidenceRetained: true }
    } catch (error) {
        try { await query(client, 'rollback') } catch { /* preserve original rollback error */ }
        throw error
    } finally {
        try { await query(client, `select pg_advisory_unlock(hashtext($1))`, [CLINICAL_APPROVAL_MIGRATION_ID]) } catch { /* ignore */ }
        client.release()
    }
}

export const clinicalApprovalMigrationStatements = STATEMENTS
