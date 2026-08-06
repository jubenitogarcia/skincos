import { createHmac, randomUUID } from 'node:crypto'
import { createPgPool, withPgTransaction } from '../harmonia/store/pg.js'
import { lockContactPhone } from '../contactPhoneLock.js'
import {
    buildConversionReportFromRawRows,
    buildScheduleDropdowns,
    ATTENDANCE_REMUNERATION_POLICY,
    ATTENDANCE_VALUE_FORMULA_VERSION,
    calculateAttendanceRemuneration,
    calculateAttendanceValue,
    calculateWeekOfMonth,
    calculateConversionGoalPlan,
    calculateDoctorConversionRanking,
    convertColorCodesToScores,
    GERENCIA_APPS_SCRIPT_CONFIG,
    getDoctorConversionOptimizationConfig,
    getCanonicalProfessionalName,
    getFilteredBackgroundColorsFromMatrix,
    getReportPeriod,
    isConversionProfessionalEligible,
    isMeaningfulProfessionalName,
    normalizeCode,
    parseBoolean,
    parseCurrency,
    parseDecimal,
    normalizeText,
    normalizeUnit,
    resolveConversionMetricBounds,
    sanitizeLimit,
    sanitizeOffset,
    splitIsoDateRangeByMonth,
    splitList,
    stableConfigHash,
} from './domain.js'
import { segmentCommercialProfiles, summarizeCommercialProfiles } from './clientCommercial.js'
import {
    resolveCommercialContactEligibility,
    transitionCommercialAction,
    validateCommercialPermission,
} from './clientCommercialContact.js'
import {
    PROFESSIONAL_IDENTITY_VERSION,
    isValidProfessionalIdentityName,
    normalizeProfessionalAliasKey,
    resolveProfessionalIdentity,
    professionalIdentityFromRow,
    buildProfessionalIdentityDiagnosis,
} from './professionalIdentity.js'
import {
    actorConsultantReferenceByUnit,
    CONSULTANT_ASSIGNMENT_ORIGIN,
    consultantPatchMatchesAttendance,
    hasConsultantPatch,
    isConsultantActor,
    resolveActorConsultant,
} from './consultantAssignment.js'
import {
    hasInjectorPatch,
    INJECTOR_ASSIGNMENT_ORIGIN,
    injectorPatchMatchesAttendance,
    resolveScheduledInjector,
} from './injectorAssignment.js'
import {
    collectAutomaticIdentityLinkTransitions,
} from './identityProjection.js'
import {
    chooseIdentitySurvivor,
    IDENTITY_GRAPH_LOCK_KEY,
    identityMaterializationFingerprint,
    identityReviewError,
    normalizeIdentityReviewDecision,
    normalizeIdentityReviewUndo,
    reviewComponentKey,
} from './identityReviewWorkflow.js'
import {
    IDENTITY_REVIEW_SOURCE_LINK_LEDGER_MIGRATION_ID,
    IDENTITY_REVIEW_WORKFLOW_MIGRATION_IDS,
    IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID,
} from './identityReviewMigration.js'
import {
    IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID,
} from './identityClusterWorkspaceMigration.js'
import {
    buildIdentityReviewClusterPresentation,
    buildIdentityClusterBulkPreview,
    stripIdentityClusterInternals,
    assertExplicitIdentityClusterPayload,
    explicitRevealFields,
    digestClusterValue,
} from './identityClusterWorkspace.js'

let pool = null

export function createAtendimentoPool(databaseUrl = process.env.DATABASE_URL) {
    if (!pool) pool = createPgPool(databaseUrl)
    return pool
}

export function atendimentoMigrationStatements() {
    return [
        `create extension if not exists pgcrypto;`,
        `create schema if not exists crm_atendimento;`,
        `create table if not exists crm_atendimento.units (
            id uuid primary key default gen_random_uuid(),
            slug text unique not null,
            name text not null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        );`,
        `create table if not exists crm_atendimento.professionals (
            id uuid primary key default gen_random_uuid(),
            name text unique not null,
            role text,
            status text not null default 'Ativo',
            units text[] not null default '{}'::text[],
            shift text,
            roles text[] not null default '{}'::text[],
            turnos text[] not null default '{}'::text[],
            background_color text,
            font_color text,
            font_family text,
            font_size int,
            font_weight text,
            font_style text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        );`,
        `alter table crm_atendimento.professionals add column if not exists roles text[] not null default '{}'::text[];`,
        `alter table crm_atendimento.professionals add column if not exists turnos text[] not null default '{}'::text[];`,
        `alter table crm_atendimento.professionals add column if not exists background_color text;`,
        `alter table crm_atendimento.professionals add column if not exists font_color text;`,
        `alter table crm_atendimento.professionals add column if not exists font_family text;`,
        `alter table crm_atendimento.professionals add column if not exists font_size int;`,
        `alter table crm_atendimento.professionals add column if not exists font_weight text;`,
        `alter table crm_atendimento.professionals add column if not exists font_style text;`,
        `alter table crm_atendimento.professionals add column if not exists alias text;`,
        `alter table crm_atendimento.professionals add column if not exists phone text;`,
        `alter table crm_atendimento.professionals add column if not exists email text;`,
        `alter table crm_atendimento.professionals add column if not exists instagram text;`,
        `alter table crm_atendimento.professionals add column if not exists canonical_id uuid;`,
        `alter table crm_atendimento.professionals add column if not exists identity_version text not null default 'professional-identity/v1';`,
        `create table if not exists crm_atendimento.professional_aliases (
            id uuid primary key default gen_random_uuid(),
            professional_id uuid not null references crm_atendimento.professionals(id) on delete restrict,
            alias text not null,
            alias_key text not null,
            source text not null default 'roster',
            confidence text not null default 'confirmed',
            active boolean not null default true,
            created_by text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(professional_id, alias_key)
        );`,
        `create index if not exists crm_atendimento_professional_aliases_key_idx
            on crm_atendimento.professional_aliases(alias_key) where active;`,
        `create table if not exists crm_atendimento.professional_identity_audit_events (
            id uuid primary key default gen_random_uuid(),
            event_type text not null,
            actor jsonb,
            source_professional_id uuid references crm_atendimento.professionals(id) on delete restrict,
            canonical_professional_id uuid references crm_atendimento.professionals(id) on delete restrict,
            payload jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now()
        );`,
        `create table if not exists crm_atendimento.procedures (
            id uuid primary key default gen_random_uuid(),
            name text unique not null,
            aliases text[] not null default '{}'::text[],
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        );`,
        `alter table crm_atendimento.procedures add column if not exists aliases text[] not null default '{}'::text[];`,
        `create table if not exists crm_atendimento.procedure_price_codes (
            id uuid primary key default gen_random_uuid(),
            procedure_id uuid not null references crm_atendimento.procedures(id) on delete cascade,
            code text not null,
            allowed boolean not null default true,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(procedure_id, code)
        );`,
        `create table if not exists crm_atendimento.commercial_offers (
            id uuid primary key default gen_random_uuid(),
            unit_id uuid not null references crm_atendimento.units(id) on delete restrict,
            offer_key text not null,
            title text not null,
            description text not null default '',
            status text not null default 'draft' check (status in ('draft','approved','active','expired','archived')),
            price_cents integer,
            currency text not null default 'BRL',
            price_qualifier text not null default 'exact' check (price_qualifier in ('exact','from','on_request')),
            installment_count integer,
            installment_value_cents integer,
            discount_percent numeric(7,3),
            conditions text not null default '',
            validity_start date,
            validity_end date,
            revision integer not null default 1,
            approved_by text,
            approved_at timestamptz,
            created_by text,
            updated_by text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(unit_id, offer_key)
        );`,
        `create index if not exists crm_atendimento_commercial_offers_lookup_idx
            on crm_atendimento.commercial_offers(unit_id, status, validity_start, validity_end, updated_at desc);`,
        `create table if not exists crm_atendimento.commercial_offer_procedures (
            offer_id uuid not null references crm_atendimento.commercial_offers(id) on delete cascade,
            procedure_id uuid not null references crm_atendimento.procedures(id) on delete restrict,
            quantity numeric(12,3) not null default 1 check (quantity > 0),
            quantity_unit text not null default 'unidade',
            display_order integer not null default 0,
            primary key (offer_id, procedure_id)
        );`,
        `create table if not exists crm_atendimento.attendances (
            id uuid primary key default gen_random_uuid(),
            unit_id uuid not null references crm_atendimento.units(id),
            service_date date not null,
            client_name text not null,
            procedure_id uuid not null references crm_atendimento.procedures(id),
            code text not null,
            quantity numeric(12,2) not null default 1,
            discount boolean not null default false,
            other_value numeric(12,2) not null default 0,
            round_value boolean not null default false,
            value numeric(12,2) not null default 0,
            value_formula_version text not null default 'attendance-value/v1',
            revision integer not null default 1,
            idempotency_key text,
            injector_id uuid references crm_atendimento.professionals(id),
            consultant_id uuid references crm_atendimento.professionals(id),
            injector_source_name text,
            consultant_source_name text,
            observation text,
            source_sheet_id text,
            source_tab text,
            source_row int,
            created_by text,
            updated_by text,
            deleted_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        );`,
        `alter table crm_atendimento.attendances add column if not exists revision integer;`,
        `alter table crm_atendimento.attendances add column if not exists value_formula_version text;`,
        `alter table crm_atendimento.attendances add column if not exists idempotency_key text;`,
        `alter table crm_atendimento.attendances add column if not exists injector_source_name text;`,
        `alter table crm_atendimento.attendances add column if not exists consultant_source_name text;`,
        `alter table crm_atendimento.attendances alter column revision set default 1;`,
        `alter table crm_atendimento.attendances alter column value_formula_version set default 'attendance-value/v1';`,
        `create table if not exists crm_atendimento.clients (
            id uuid primary key default gen_random_uuid(),
            unit_id uuid not null references crm_atendimento.units(id) on delete cascade,
            name text not null,
            name_key text not null,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(unit_id, name_key)
        );`,
        `create index if not exists crm_atendimento_clients_unit_search_idx
            on crm_atendimento.clients(unit_id, name_key, name);`,
        `create unique index if not exists crm_atendimento_attendances_source_idx
            on crm_atendimento.attendances(source_sheet_id, source_tab, source_row)
            where source_sheet_id is not null and source_tab is not null and source_row is not null;`,
        `create index if not exists crm_atendimento_attendances_unit_date_idx
            on crm_atendimento.attendances(unit_id, service_date desc)
            where deleted_at is null;`,
        `create index if not exists crm_atendimento_attendances_procedure_idx
            on crm_atendimento.attendances(procedure_id)
            where deleted_at is null;`,
        `create table if not exists crm_atendimento.schedule_days (
            id uuid primary key default gen_random_uuid(),
            unit_id uuid not null references crm_atendimento.units(id),
            service_date date not null,
            doctor_name text,
            professional_id uuid references crm_atendimento.professionals(id),
            source_year int,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(unit_id, service_date)
        );`,
        `alter table crm_atendimento.schedule_days add column if not exists professional_id uuid;`,
        `create index if not exists crm_atendimento_schedule_days_date_idx
            on crm_atendimento.schedule_days(service_date, unit_id);`,
        `create table if not exists crm_atendimento.audit_events (
            id uuid primary key default gen_random_uuid(),
            event_type text not null,
            actor jsonb,
            attendance_id uuid,
            payload jsonb,
            created_at timestamptz not null default now()
        );`,
        `create table if not exists crm_atendimento.import_batches (
            id uuid primary key default gen_random_uuid(),
            source_sheet_id text not null,
            source_name text not null,
            dry_run boolean not null default false,
            actor jsonb,
            summary jsonb not null default '{}'::jsonb,
            created_at timestamptz not null default now()
        );`,
        `create index if not exists crm_atendimento_import_batches_source_idx
            on crm_atendimento.import_batches(source_sheet_id, created_at desc);`,
        `create table if not exists crm_atendimento.raw_sheet_rows (
            id uuid primary key default gen_random_uuid(),
            source_sheet_id text not null,
            source_tab text not null,
            source_row int not null,
            category text not null,
            sensitive boolean not null default false,
            cells jsonb not null,
            imported_at timestamptz not null default now(),
            unique(source_sheet_id, source_tab, source_row)
        );`,
        `create index if not exists crm_atendimento_raw_sheet_rows_tab_idx
            on crm_atendimento.raw_sheet_rows(source_sheet_id, source_tab, source_row);`,
        `create table if not exists crm_atendimento.management_items (
            id uuid primary key default gen_random_uuid(),
            source_sheet_id text not null,
            source_tab text not null,
            source_row int not null,
            category text not null,
            label text not null,
            active boolean not null default true,
            sensitive boolean not null default false,
            unit_slug text,
            record_date date,
            payload jsonb not null default '{}'::jsonb,
            imported_at timestamptz not null default now(),
            unique(source_sheet_id, source_tab, source_row, category, label)
        );`,
        `create index if not exists crm_atendimento_management_items_category_idx
            on crm_atendimento.management_items(category, source_tab);`,
        `create table if not exists crm_atendimento.inventory_items (
            id uuid primary key default gen_random_uuid(),
            source_sheet_id text not null,
            source_row int not null,
            product text not null,
            barra_shopping_sul numeric(12,2) not null default 0,
            novo_hamburgo numeric(12,2) not null default 0,
            imported_at timestamptz not null default now(),
            unique(source_sheet_id, source_row)
        );`,
        `create table if not exists crm_atendimento.monthly_unit_goals (
            id uuid primary key default gen_random_uuid(),
            unit_id uuid not null references crm_atendimento.units(id),
            goal_month date not null,
            value numeric(14,2) not null default 0,
            created_by text,
            updated_by text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(unit_id, goal_month)
        );`,
        `alter table crm_atendimento.monthly_unit_goals add column if not exists source_sheet_id text;`,
        `alter table crm_atendimento.monthly_unit_goals add column if not exists source_tab text;`,
        `alter table crm_atendimento.monthly_unit_goals add column if not exists source_row int;`,
        `alter table crm_atendimento.monthly_unit_goals add column if not exists source_col int;`,
        `alter table crm_atendimento.monthly_unit_goals add column if not exists source_payload jsonb not null default '{}'::jsonb;`,
        `create index if not exists crm_atendimento_monthly_unit_goals_month_idx
            on crm_atendimento.monthly_unit_goals(goal_month, unit_id);`,
        `create table if not exists crm_atendimento.monthly_unit_goal_levels (
            id uuid primary key default gen_random_uuid(),
            unit_id uuid not null references crm_atendimento.units(id),
            goal_month date not null,
            level_key text not null,
            level_label text not null,
            value numeric(14,2) not null default 0,
            source_sheet_id text,
            source_tab text,
            source_row int,
            source_col int,
            source_payload jsonb not null default '{}'::jsonb,
            created_by text,
            updated_by text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(unit_id, goal_month, level_key)
        );`,
        `create index if not exists crm_atendimento_monthly_unit_goal_levels_month_idx
            on crm_atendimento.monthly_unit_goal_levels(goal_month, unit_id);`,
        `create table if not exists crm_atendimento.goal_table_rows (
            id uuid primary key default gen_random_uuid(),
            source_sheet_id text not null,
            source_tab text not null,
            source_row int not null,
            year int not null,
            unit_slug text not null,
            unit_name text not null,
            label text not null,
            values jsonb not null default '[]'::jsonb,
            formulas jsonb not null default '[]'::jsonb,
            imported_at timestamptz not null default now(),
            unique(source_sheet_id, source_tab, source_row, unit_slug)
        );`,
        `create index if not exists crm_atendimento_goal_table_rows_tab_idx
            on crm_atendimento.goal_table_rows(source_sheet_id, source_tab, unit_slug, source_row);`,
        `create table if not exists crm_atendimento.local_mirror_state (
            singleton boolean primary key default true check (singleton),
            mode text not null default 'local-sandbox',
            source_fingerprint text,
            synced_at timestamptz,
            row_counts jsonb not null default '{}'::jsonb,
            min_service_date date,
            max_service_date date,
            backup_path text,
            updated_at timestamptz not null default now()
        );`,
        `create table if not exists crm_atendimento.doctor_conversion_config (
            singleton boolean primary key default true check (singleton),
            default_interval_multiplier numeric(8,6),
            interval_multiplier_min numeric(8,6) not null default 0,
            interval_multiplier_max numeric(8,6) not null default 2,
            objective_name text not null default 'sse_uniform',
            require_all_bands_if_possible boolean not null default true,
            require_extremes_if_possible boolean not null default true,
            stability_tie_break boolean not null default true,
            tie_break_policy text not null default 'previous_then_widest_plateau_center',
            unstable_jump_threshold numeric(8,6) not null default 0.5,
            config_hash text not null,
            updated_by text,
            updated_at timestamptz not null default now(),
            check (default_interval_multiplier between interval_multiplier_min and interval_multiplier_max),
            check (interval_multiplier_min >= 0),
            check (interval_multiplier_max <= 2),
            check (interval_multiplier_min <= interval_multiplier_max)
        );`,
        `create table if not exists crm_atendimento.doctor_conversion_results (
            id uuid primary key default gen_random_uuid(),
            unit_id uuid not null references crm_atendimento.units(id) on delete cascade,
            period_start date not null,
            period_end date not null,
            report_date date,
            week_of_month int,
            selected_multiplier numeric(12,9),
            previous_interval_multiplier numeric(12,9),
            selection_reason text,
            optimal_plateau jsonb,
            homogeneity_score numeric(12,9) not null,
            homogeneity_loss numeric(12,9) not null,
            status_code text not null,
            optimization_status_code text not null,
            counts jsonb not null default '{}'::jsonb,
            proportions jsonb not null default '{}'::jsonb,
            config_hash text not null,
            calendar_hash text not null,
            payload jsonb not null default '{}'::jsonb,
            computed_by text,
            computed_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(unit_id, period_start, period_end, config_hash, calendar_hash)
        );`,
        `create index if not exists crm_atendimento_doctor_conversion_results_history_idx
            on crm_atendimento.doctor_conversion_results(unit_id, period_end desc, computed_at desc);`,
        `alter table crm_atendimento.doctor_conversion_config
            alter column default_interval_multiplier drop not null;`,
        `alter table crm_atendimento.doctor_conversion_config
            alter column default_interval_multiplier drop default;`,
        `alter table crm_atendimento.doctor_conversion_config
            add column if not exists tie_break_policy text not null default 'previous_then_widest_plateau_center';`,
        `update crm_atendimento.doctor_conversion_config
            set default_interval_multiplier = null
            where default_interval_multiplier is not null;`,
        `alter table crm_atendimento.doctor_conversion_results
            alter column selected_multiplier drop not null;`,
        `alter table crm_atendimento.doctor_conversion_results
            add column if not exists selection_reason text;`,
        `alter table crm_atendimento.doctor_conversion_results
            add column if not exists optimal_plateau jsonb;`,
        `create table if not exists crm_atendimento.commercial_policy_config (
            singleton boolean primary key default true check (singleton),
            active_contact_cooldown_days int not null default 30 check(active_contact_cooldown_days between 1 and 180),
            return_risk_thresholds int[] not null default array[90,180,365] check(array_length(return_risk_thresholds, 1) = 3),
            updated_by text,
            updated_at timestamptz not null default now()
        );`,
        `create table if not exists crm_atendimento.commercial_procedure_cadences (
            id uuid primary key default gen_random_uuid(),
            procedure_id uuid not null references crm_atendimento.procedures(id) on delete cascade,
            unit_id uuid references crm_atendimento.units(id) on delete cascade,
            cadence_days int not null check(cadence_days between 1 and 1095),
            status text not null default 'draft' check(status in ('draft','approved','disabled')),
            notes text,
            approved_by text,
            approved_at timestamptz,
            updated_by text,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique nulls not distinct(procedure_id, unit_id)
        );`,
        `create table if not exists crm_atendimento.commercial_actions (
            id uuid primary key default gen_random_uuid(),
            identity_id uuid not null,
            unit_id uuid references crm_atendimento.units(id) on delete set null,
            segment_key text not null,
            action_type text not null check(action_type in ('contact','follow_up','appointment','relationship')),
            status text not null default 'open' check(status in ('open','contacted','responded','scheduled','won_sale','returned','closed','cancelled')),
            owner text,
            due_date date,
            notes text,
            outcome_notes text,
            created_by text not null,
            updated_by text,
            completed_at timestamptz,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        );`,
        `create index if not exists crm_atendimento_commercial_actions_identity_idx
            on crm_atendimento.commercial_actions(identity_id, created_at desc);`,
        `create index if not exists crm_atendimento_commercial_actions_active_idx
            on crm_atendimento.commercial_actions(status, created_at desc)
            where status in ('open','contacted','responded','scheduled');`,
    ]
}

export async function migrateAtendimento(client) {
    for (const sql of atendimentoMigrationStatements()) {
        await client.query(sql)
    }
    await upsertUnit(client, normalizeUnit('Novo Hamburgo'))
    await upsertUnit(client, normalizeUnit('BarraShoppingSul'))
    const defaultOptimizationConfig = getDoctorConversionOptimizationConfig(GERENCIA_APPS_SCRIPT_CONFIG)
    const defaultConfigHash = stableConfigHash({
        formula: { averageWeight: 0.3, medianWeight: 0.2, dailyGoalWeight: 0.5 },
        intervalMultiplierMin: defaultOptimizationConfig.intervalMultiplierMin,
        intervalMultiplierMax: defaultOptimizationConfig.intervalMultiplierMax,
        objectiveName: defaultOptimizationConfig.objectiveName,
        requireAllBandsIfPossible: defaultOptimizationConfig.requireAllBandsIfPossible,
        requireExtremesIfPossible: defaultOptimizationConfig.requireExtremesIfPossible,
        stabilityTieBreak: defaultOptimizationConfig.stabilityTieBreak,
        tieBreakPolicy: defaultOptimizationConfig.tieBreakPolicy,
        unstableJumpThreshold: defaultOptimizationConfig.unstableJumpThreshold,
    })
    await client.query(
        `insert into crm_atendimento.doctor_conversion_config(
            singleton, default_interval_multiplier, interval_multiplier_min, interval_multiplier_max,
            objective_name, require_all_bands_if_possible, require_extremes_if_possible,
            stability_tie_break, tie_break_policy, unstable_jump_threshold, config_hash, updated_by
         ) values (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'migration')
         on conflict(singleton) do nothing`,
        [
            defaultOptimizationConfig.defaultIntervalMultiplier,
            defaultOptimizationConfig.intervalMultiplierMin,
            defaultOptimizationConfig.intervalMultiplierMax,
            defaultOptimizationConfig.objectiveName,
            defaultOptimizationConfig.requireAllBandsIfPossible,
            defaultOptimizationConfig.requireExtremesIfPossible,
            defaultOptimizationConfig.stabilityTieBreak,
            defaultOptimizationConfig.tieBreakPolicy,
            defaultOptimizationConfig.unstableJumpThreshold,
            defaultConfigHash,
        ],
    )
    await client.query(
        `insert into crm_atendimento.commercial_policy_config(
            singleton, active_contact_cooldown_days, return_risk_thresholds, updated_by)
         values (true, 30, array[90,180,365], 'migration')
         on conflict(singleton) do nothing`,
    )
}

function requirePool(pool) {
    if (!pool) {
        const err = new Error('DATABASE_URL_not_configured')
        err.statusCode = 503
        throw err
    }
}

function actorLabel(actor) {
    return String(actor?.username || actor?.email || actor?.id || actor?.role || 'system').trim() || 'system'
}

// Mutation idempotency and audit attribution must never fall back to a role.
// Two distinct operators with the same role would otherwise share an
// idempotency namespace and could receive each other's persisted response.
export function actorIdentityForMutation(actor) {
    const identity = String(actor?.id || actor?.username || actor?.email || '').trim()
    if (!identity) throw mutationError('ACTOR_IDENTITY_REQUIRED', 401)
    return identity
}

function roleCanManage(actor) {
    const role = String(actor?.role || '').trim().toUpperCase()
    // Most requests are normalized by the Pages auth adapter, but retaining
    // ADMIN here keeps direct/local API consumers aligned with that contract.
    return role === 'GESTOR' || role === 'GERENTE' || role === 'ADMIN'
}

// Clientes is intentionally a GESTOR-only module in the CRM shell. Preserve
// the legacy ADMIN alias for direct/local API consumers, but never widen the
// commercial boundary to GERENTE merely because that role manages other
// Atendimento surfaces.
function roleCanManageCommercial(actor) {
    const role = String(actor?.role || '').trim().toUpperCase()
    return role === 'GESTOR' || role === 'ADMIN'
}

function normalizeAllowedUnitKeys(actor) {
    const raw = Array.isArray(actor?.allowedUnits) ? actor.allowedUnits : []
    return new Set(raw.map((unit) => normalizeUnit(unit).slug).filter(Boolean))
}

function actorHasExplicitUnitScope(actor) {
    return !roleCanManage(actor) && Array.isArray(actor?.allowedUnits)
}

function actorCanReadUnit(actor, unit) {
    if (!actorHasExplicitUnitScope(actor)) return true
    return normalizeAllowedUnitKeys(actor).has(normalizeUnit(unit?.slug || unit?.name || unit).slug)
}

function professionalMatchesAllowedUnits(row, actor) {
    if (!actorHasExplicitUnitScope(actor)) return true
    const allowed = normalizeAllowedUnitKeys(actor)
    if (!allowed.size) return false
    const units = Array.isArray(row?.units) ? row.units : []
    if (!units.length) return false
    return units.some((unit) => allowed.has(normalizeUnit(unit).slug))
}

export function canAccessAtendimento(actor, requestPath = '', requestMethod = 'GET') {
    if (roleCanManage(actor)) return true
    // Legacy consultant accounts may have no module list. Their effective
    // capability is Atendimento only; this router is that capability.
    if (isConsultantActor(actor)) return true
    const allowed = Array.isArray(actor?.allowedModules) ? actor.allowedModules.map(String) : []
    if (!allowed.length) return true
    if (allowed.includes('atendimento')) return true
    const path = String(requestPath || '')
    const method = String(requestMethod || 'GET').toUpperCase()
    if (method !== 'GET') return false
    if ((path === '/references' || path.startsWith('/management/catalog') || path.startsWith('/offers')) && allowed.includes('procedimentos')) return true
    if ((path.startsWith('/management/commercial') || path.startsWith('/management/finance')) && allowed.includes('faturamento')) return true
    if (path.startsWith('/management/feeds/insumos') && allowed.includes('insumos')) return true
    if (path.startsWith('/management/feeds/escala') && allowed.includes('escala-profissionais')) return true
    return false
}

function applyActorUnitFilter(where, params, actor) {
    if (!actorHasExplicitUnitScope(actor)) return
    const allowed = normalizeAllowedUnitKeys(actor)
    if (!allowed.size) {
        where.push('1 = 0')
        return
    }
    params.push(Array.from(allowed))
    where.push(`u.slug = any($${params.length})`)
}

function applyManagementItemUnitFilter(where, params, actor, column = 'unit_slug') {
    if (!actorHasExplicitUnitScope(actor)) return
    const allowed = normalizeAllowedUnitKeys(actor)
    if (!allowed.size) {
        where.push('1 = 0')
        return
    }
    params.push(Array.from(allowed))
    where.push(`(${column} is null or ${column} = any($${params.length}))`)
}

function buildAttendanceWhere(query, actor) {
    const where = ['a.deleted_at is null']
    const params = []
    applyActorUnitFilter(where, params, actor)
    const unit = String(query?.unit || '').trim()
    if (unit && unit !== 'all') {
        params.push(normalizeUnit(unit).slug)
        where.push(`u.slug = $${params.length}`)
    }
    const from = String(query?.from || '').trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        params.push(from)
        where.push(`a.service_date >= $${params.length}::date`)
    }
    const to = String(query?.to || '').trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        params.push(to)
        where.push(`a.service_date <= $${params.length}::date`)
    }
    const procedure = String(query?.procedure || '').trim()
    if (procedure && procedure !== 'all') {
        params.push(procedure)
        where.push(`p.name = $${params.length}`)
    }
    const code = normalizeCode(query?.code)
    if (code) {
        params.push(code)
        where.push(`a.code = $${params.length}`)
    }
    const injector = String(query?.injector || '').trim()
    if (injector && injector !== 'all') {
        params.push(injector)
        where.push(`inj.name = $${params.length}`)
    }
    const consultant = String(query?.consultant || '').trim()
    if (consultant && consultant !== 'all') {
        params.push(consultant)
        where.push(`con.name = $${params.length}`)
    }
    const search = String(query?.search || '').trim()
    if (search) {
        params.push(`%${String(search).toLowerCase()}%`)
        where.push(`lower(a.client_name) like $${params.length}`)
    }
    return { where, params }
}

function monthBoundsFromReportPeriod(period) {
    const year = Number(period?.targetYear || new Date().getFullYear())
    const month = Number(period?.targetMonth || new Date().getMonth() + 1)
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    const weekNumber = Math.max(1, Math.min(6, Number(period?.weekNumber || 1)))
    const firstWeekday = new Date(year, month - 1, 1).getDay() || 7
    const weekStartDay = Math.max(1, Math.min(lastDay, (7 * (weekNumber - 1)) - firstWeekday + 2))
    const weekEndDay = Math.max(weekStartDay, Math.min(lastDay, (7 * weekNumber) - firstWeekday + 1))
    return {
        monthStart,
        monthEnd,
        weekStart: `${year}-${String(month).padStart(2, '0')}-${String(weekStartDay).padStart(2, '0')}`,
        weekEnd: `${year}-${String(month).padStart(2, '0')}-${String(weekEndDay).padStart(2, '0')}`,
    }
}

function isoDateFromDb(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
    return String(value || '').slice(0, 10)
}

function dateRangeEach(start, end) {
    const out = []
    const current = new Date(`${start}T00:00:00Z`)
    const last = new Date(`${end}T00:00:00Z`)
    while (current <= last) {
        out.push(current.toISOString().slice(0, 10))
        current.setUTCDate(current.getUTCDate() + 1)
    }
    return out
}

function defaultOperationalDay(unitSlug, dateIso) {
    if (!dateIso) return false
    const day = new Date(`${dateIso}T00:00:00Z`).getUTCDay()
    if (unitSlug === 'novo-hamburgo') return day !== 0
    if (unitSlug === 'barra-shopping-sul') return true
    return day !== 0
}

function isOperationalScheduleValue(value) {
    const normalized = normalizeText(value)
    return !!normalized && normalized !== normalizeText(GERENCIA_APPS_SCRIPT_CONFIG.noServiceLabel)
}

function countOperationalDays(unitSlug, scheduleByUnit, start, end) {
    const dates = dateRangeEach(start, end)
    const schedule = scheduleByUnit.get(unitSlug) || new Map()
    if (!schedule.size) return dates.filter((date) => defaultOperationalDay(unitSlug, date)).length
    return dates.filter((date) => isOperationalScheduleValue(schedule.get(date))).length
}

function b64UrlEncodeJson(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function signEscalaActor(secret, ts, actorPayload) {
    return createHmac('sha256', secret).update(`${ts}.${actorPayload}`).digest('base64url')
}

function getEscalaApiConfig() {
    const target = String(process.env.ESCALA_API_TARGET || process.env.CRM_ESCALA_API_TARGET || '').trim()
    const actorKey = String(process.env.ESCALA_ACTOR_HMAC_KEY || process.env.CRM_ESCALA_ACTOR_HMAC_KEY || '').trim()
    return { target, actorKey }
}

function buildEscalaApiUrl(target, restPath, params = {}) {
    const url = new URL(target)
    const basePath = url.pathname.replace(/\/$/, '')
    url.pathname = `${basePath}/api/escala${restPath.startsWith('/') ? restPath : `/${restPath}`}`
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim()) url.searchParams.set(key, String(value))
    })
    return url.toString()
}

function buildEscalaServiceActor(actor) {
    return {
        id: String(actor?.id || actor?.email || 'crm-api-atendimento'),
        email: String(actor?.email || 'crm-api@local'),
        name: String(actor?.name || actor?.displayName || 'CRM API'),
        role: 'GESTOR',
        allowedUnits: Array.isArray(actor?.allowedUnits) ? actor.allowedUnits : [],
    }
}

function monthKeysBetween(start, end) {
    const out = []
    const cursor = new Date(`${String(start).slice(0, 7)}-01T00:00:00Z`)
    const last = new Date(`${String(end).slice(0, 7)}-01T00:00:00Z`)
    while (cursor <= last) {
        out.push(cursor.toISOString().slice(0, 7))
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
    return out
}

async function fetchEscalaJson(target, actorKey, actor, restPath, params) {
    const actorPayload = b64UrlEncodeJson(actor)
    const ts = String(Date.now())
    const response = await fetch(buildEscalaApiUrl(target, restPath, params), {
        headers: {
            accept: 'application/json',
            'x-request-id': `crm-atendimento-${ts}`,
            'x-crm-user': actorPayload,
            'x-crm-ts': ts,
            'x-crm-signature': signEscalaActor(actorKey, ts, actorPayload),
        },
    })
    if (!response.ok) throw new Error(`Escala API HTTP ${response.status}`)
    const json = await response.json()
    if (json?.ok === false) throw new Error(json.error || 'Escala API error')
    return json
}

function normalizeEscalaScheduleDoctorName(row) {
    const value = row?.professional ?? row?.doctor_name ?? row?.doctorName ?? row?.name
    return String(value || '').trim()
}

async function readEscalaScheduleCoverage(pgPool, selectedUnits, start, end, actor, { persistMissing = false } = {}) {
    const { target, actorKey } = getEscalaApiConfig()
    const months = monthKeysBetween(start, end)
    const byUnit = new Map(selectedUnits.map((unit) => [unit.slug, {
        unit,
        scheduledDates: new Set(),
        closedDates: new Set(),
        holidayDates: new Set(),
        coveredMonths: new Set(),
    }]))
    if (!target || !actorKey || !selectedUnits.length) return { source: 'crm', byUnit, available: false }
    const serviceActor = buildEscalaServiceActor(actor)
    const unitSlugs = selectedUnits.map((unit) => unit.slug)
    const existingRows = await pgPool.query(
        `select u.slug as unit_slug, s.service_date::text as service_date
         from crm_atendimento.schedule_days s
         join crm_atendimento.units u on u.id = s.unit_id
         where u.slug = any($1)
           and s.service_date >= $2::date
           and s.service_date <= $3::date`,
        [unitSlugs, start, end],
    )
    const existingByUnit = new Map()
    for (const row of existingRows.rows) {
        const dates = existingByUnit.get(row.unit_slug) || new Set()
        dates.add(isoDateFromDb(row.service_date))
        existingByUnit.set(row.unit_slug, dates)
    }
    try {
        for (const unit of selectedUnits) {
            const coverage = byUnit.get(unit.slug)
            const existingDates = existingByUnit.get(unit.slug) || new Set()
            for (const month of months) {
                const json = await fetchEscalaJson(target, actorKey, serviceActor, '/schedule', { unit: unit.name, month })
                const scheduleRows = Array.isArray(json.schedule) ? json.schedule : []
                const closedRows = Array.isArray(json.closedDays) ? json.closedDays : []
                const holidayRows = Array.isArray(json.holidays) ? json.holidays : []
                if (scheduleRows.length || closedRows.length || holidayRows.length) coverage.coveredMonths.add(month)
                const desiredByDate = new Map()
                scheduleRows.forEach((row) => {
                    const date = isoDateFromDb(row.date)
                    const doctorName = normalizeEscalaScheduleDoctorName(row)
                    if (!date || !doctorName) return
                    coverage.scheduledDates.add(date)
                    const entry = desiredByDate.get(date) || { doctors: new Set(), closed: false }
                    entry.doctors.add(doctorName)
                    desiredByDate.set(date, entry)
                })
                closedRows.forEach((row) => {
                    const date = isoDateFromDb(row.date)
                    if (date) {
                        coverage.closedDates.add(date)
                        coverage.coveredMonths.add(date.slice(0, 7))
                        desiredByDate.set(date, { doctors: new Set(), closed: true })
                    }
                })
                holidayRows.forEach((row) => {
                    const date = isoDateFromDb(row.date)
                    if (date) {
                        coverage.holidayDates.add(date)
                        coverage.coveredMonths.add(date.slice(0, 7))
                        desiredByDate.set(date, { doctors: new Set(), closed: true })
                    }
                })
                for (const [date, desired] of desiredByDate.entries()) {
                    if (existingDates.has(date)) continue
                    const doctorName = desired.closed
                        ? GERENCIA_APPS_SCRIPT_CONFIG.noServiceLabel
                        : Array.from(desired.doctors).join(', ')
                    if (!doctorName) continue
                    if (persistMissing) {
                        await upsertScheduleDay(pgPool, {
                            unitSlug: unit.slug,
                            unitName: unit.name,
                            date,
                            doctorName,
                            year: Number(date.slice(0, 4)) || null,
                        })
                    }
                    existingDates.add(date)
                }
            }
        }
        return { source: 'crm', byUnit, available: true }
    } catch (error) {
        console.warn('atendimento escala coverage sync', error?.message || error)
        return { source: 'crm', byUnit, available: false, error: String(error?.message || error || '') }
    }
}

function countOperationalDaysWithEscala(unitSlug, scheduleByUnit, escalaCoverage, start, end) {
    const coverage = escalaCoverage?.byUnit?.get(unitSlug)
    if (!coverage || !coverage.coveredMonths?.size) return countOperationalDays(unitSlug, scheduleByUnit, start, end)
    let total = 0
    for (const date of dateRangeEach(start, end)) {
        const month = date.slice(0, 7)
        if (coverage.closedDates.has(date) || coverage.holidayDates.has(date)) continue
        if (coverage.coveredMonths.has(month)) {
            if (coverage.scheduledDates.has(date)) total += 1
            continue
        }
        const legacySchedule = scheduleByUnit.get(unitSlug)
        if (legacySchedule?.size && isOperationalScheduleValue(legacySchedule.get(date))) total += 1
    }
    return total
}

function professionalIsActiveInjectorForUnit(row, unitSlug) {
    if (normalizeText(row?.status || 'Ativo') !== 'ativo') return false
    if (!isConversionProfessionalEligible(row?.name)) return false
    const roleTokens = [
        row?.role || '',
        ...(Array.isArray(row?.roles) ? row.roles : []),
    ].map(normalizeText)
    if (!roleTokens.some((role) => role.includes('injetor'))) return false
    const units = Array.isArray(row?.units) ? row.units.map((unit) => normalizeUnit(unit).slug).filter(Boolean) : []
    return units.includes(unitSlug)
}

function moneyMetric(value, position = '', label = '', extra = {}) {
    const numeric = Number(value || 0)
    const rounded = Math.round((Number.isFinite(numeric) ? numeric : 0) * 100) / 100
    return {
        label,
        weekValue: rounded,
        totalValue: rounded,
        position,
        ...extra,
    }
}

function formatCurrencyDiagnostic(value) {
    return Number(value || 0).toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })
}

function buildConversionMetricPayload(stats, unitName) {
    const levelCounts = stats.levelCounts || { level0: 0, level1: 0, level2: 0, level3: 0 }
    const proportions = stats.proportions || { p0: 0, p1: 0, p2: 0, p3: 0 }
    const balancedReasons = stats.balancedReasons || { lowerSide: 0, upperSide: 0, center: 0, extremes: 0 }
    const cutLineFormula = `${stats.formulas?.cutLine || 'linha_corte_diaria = (media_diaria_doutores * 0.30) + (mediana_diaria_doutores * 0.20) + (meta_diaria * 0.50)'}; valores = (${Number(stats.average || 0).toFixed(2)} * 0.30) + (${Number(stats.median || 0).toFixed(2)} * 0.20) + (${Number(stats.dailyGoal || 0).toFixed(2)} * 0.50)`
    const intervalFormula = `${stats.formulas?.interval || 'intervalo_diario = desvio_padrao(realizado_diario_doutores) * multiplicador_intervalo'}; valores = ${Number(stats.standardDeviation || 0).toFixed(2)} * ${Number(stats.intervalMultiplier || 0).toFixed(2)}`
    const divisorFormula = `${stats.formulas?.ratioDivisor || 'divisor = (level0 * 0) + (level1 * 1) + (level2 * 2) + (level3 * 3)'}; valores = (${levelCounts.level0 || 0} * 0) + (${levelCounts.level1 || 0} * 1) + (${levelCounts.level2 || 0} * 2) + (${levelCounts.level3 || 0} * 3)`
    const homogeneityFormula = `${stats.formulas?.homogeneity || 'homogeneidade = 1 - (4 / 3) * soma((proporcao_nivel - 0.25) ^ 2)'}; proporcoes = ${Number(proportions.p0 || 0).toFixed(4)}, ${Number(proportions.p1 || 0).toFixed(4)}, ${Number(proportions.p2 || 0).toFixed(4)}, ${Number(proportions.p3 || 0).toFixed(4)}`
    return {
        total: moneyMetric(stats.total, unitName, 'TOTAL'),
        rankedDoctorTotal: moneyMetric(stats.rankedDoctorTotal ?? stats.total, unitName, 'TOTAL RANQUEÁVEL'),
        periodAttendanceTotal: moneyMetric(stats.periodAttendanceTotal ?? stats.total, unitName, 'Total'),
        eligibleDoctorCount: moneyMetric(stats.eligibleDoctorCount, unitName, 'Doutores elegíveis'),
        periodGoal: moneyMetric(stats.periodGoal ?? stats.weeklyGoal, unitName, 'Meta do período', { formula: 'meta_periodo = soma(meta_diaria_mes * dias_trabalhados_periodo_no_mes)' }),
        dailyGoal: moneyMetric(stats.dailyGoal, unitName, 'Meta Diária', { formula: 'meta_diaria_media_periodo = meta_periodo / dias_trabalhados_periodo' }),
        monthOperationalDays: moneyMetric(stats.monthOperationalDays, unitName, 'Dias mês', { formula: 'dias_trabalhados_mes = dias operacionais do mês pela Escala CRM ou fallback' }),
        periodOperationalDays: moneyMetric(stats.periodOperationalDays, unitName, 'Dias período', { formula: 'dias_trabalhados_periodo = dias operacionais dentro do período selecionado' }),
        average: moneyMetric(stats.average, unitName, 'Média diária'),
        median: moneyMetric(stats.median, unitName, 'Mediana diária'),
        standardDeviation: moneyMetric(stats.standardDeviation, unitName, 'Desvio Padrão diário'),
        upperRatio: moneyMetric(stats.ratios.upperRatio, unitName, 'Razão Superior'),
        lowerRatio: moneyMetric(stats.ratios.lowerRatio, unitName, 'Razão Inferior'),
        innerRatio: moneyMetric(stats.ratios.innerRatio, unitName, 'Razão Interior'),
        outerRatio: moneyMetric(stats.ratios.outerRatio, unitName, 'Razão Exterior'),
        lowerSide: moneyMetric(balancedReasons.lowerSide, unitName, 'Lado Inferior'),
        upperSide: moneyMetric(balancedReasons.upperSide, unitName, 'Lado Superior'),
        centerShare: moneyMetric(balancedReasons.center, unitName, 'Faixas Centrais'),
        extremesShare: moneyMetric(balancedReasons.extremes, unitName, 'Faixas Extremas'),
        ratioDivisor: moneyMetric(stats.ratioDivisor, unitName, 'Divisor Razões', { formula: divisorFormula, levelCounts }),
        cutLine: moneyMetric(stats.cutLine, unitName, 'Linha Corte diária', { formula: cutLineFormula }),
        interval: moneyMetric(stats.interval, unitName, 'Intervalo diário', { formula: intervalFormula }),
        intervalMultiplier: moneyMetric(stats.intervalMultiplier, unitName, 'Multiplicador Otimizado'),
        homogeneityScore: moneyMetric(stats.homogeneityScore, unitName, 'Homogeneidade', { formula: homogeneityFormula }),
        lowerLimit: moneyMetric(stats.lowerLimit, unitName, 'Limite Inferior diário'),
        upperLimit: moneyMetric(stats.upperLimit, unitName, 'Limite Superior diário'),
        level0: moneyMetric(levelCounts.level0 || 0, unitName, 'Nível 0', { formula: 'nivel_0 = realizado < limite_inferior', proportion: proportions.p0 }),
        level1: moneyMetric(levelCounts.level1 || 0, unitName, 'Nível 1', { formula: 'nivel_1 = limite_inferior <= realizado < linha_corte', proportion: proportions.p1 }),
        level2: moneyMetric(levelCounts.level2 || 0, unitName, 'Nível 2', { formula: 'nivel_2 = linha_corte <= realizado <= limite_superior', proportion: proportions.p2 }),
        level3: moneyMetric(levelCounts.level3 || 0, unitName, 'Nível 3', { formula: 'nivel_3 = realizado > limite_superior', proportion: proportions.p3 }),
    }
}

function buildConversionOptimizationPayload(stats) {
    return {
        selectedMultiplier: stats.selectedMultiplier == null ? null : Number(stats.selectedMultiplier),
        defaultIntervalMultiplier: stats.defaultIntervalMultiplier == null ? null : Number(stats.defaultIntervalMultiplier),
        previousIntervalMultiplier: stats.previousIntervalMultiplier == null ? null : Number(stats.previousIntervalMultiplier),
        intervalMultiplierMin: Number(stats.intervalMultiplierMin || 0),
        intervalMultiplierMax: Number(stats.intervalMultiplierMax || 0),
        objectiveName: stats.objectiveName || 'sse_uniform',
        tieBreakPolicy: stats.tieBreakPolicy || 'previous_then_widest_plateau_center',
        selectionReason: stats.selectionReason || 'not_applicable',
        optimalPlateau: stats.optimalPlateau || null,
        optimalPlateaus: Array.isArray(stats.optimalPlateaus) ? stats.optimalPlateaus : [],
        homogeneityCurve: Array.isArray(stats.homogeneityCurve) ? stats.homogeneityCurve : [],
        statusCode: stats.statusCode || 'BEST_EFFORT',
        optimizationStatusCode: stats.optimizationStatusCode || stats.statusCode || 'BEST_EFFORT',
        counts: {
            N0: Number(stats.levelCounts?.level0 || 0),
            N1: Number(stats.levelCounts?.level1 || 0),
            N2: Number(stats.levelCounts?.level2 || 0),
            N3: Number(stats.levelCounts?.level3 || 0),
        },
        proportions: stats.proportions || { p0: 0, p1: 0, p2: 0, p3: 0 },
        legacyReasons: stats.ratios || { upperRatio: 0, lowerRatio: 0, innerRatio: 0, outerRatio: 0 },
        balancedReasons: stats.balancedReasons || { lowerSide: 0, upperSide: 0, center: 0, extremes: 0 },
        homogeneityScore: Number(stats.homogeneityScore || 0),
        homogeneityLoss: Number(stats.homogeneityLoss || 0),
        diagnostics: stats.diagnostics || {},
        configHash: stats.configHash || '',
    }
}

function normalizeAggregateCountValue(value) {
    return Math.round(Number(value || 0) * 100) / 100
}

function conversionOptimizationWarning(statusCode) {
    const messages = {
        OPTIMAL_EXTREMES_ONLY: 'A distribuição não permite preencher as quatro faixas; o melhor equilíbrio possível preserva os extremos.',
        BEST_EFFORT: 'A distribuição não permite preencher as quatro faixas nem preservar os dois extremos com a linha de corte atual.',
        NO_DATA: 'Não há doutores elegíveis para calcular as faixas.',
        NO_VARIANCE: 'Todos os realizados são iguais; alterar o multiplicador não muda as faixas.',
        INSUFFICIENT_DOCTORS: 'Há menos de quatro doutores elegíveis; quatro faixas preenchidas são matematicamente inviáveis.',
        CUT_OFF_BELOW_MIN: 'A linha de corte está abaixo de todos os realizados; as faixas inferiores são inviáveis.',
        CUT_OFF_ABOVE_MAX: 'A linha de corte está acima de todos os realizados; as faixas superiores são inviáveis.',
        OUTLIER_HEAVY: 'A distribuição contém vários valores extremos e a régua estatística pode ficar menos estável.',
        UNSTABLE_JUMP: 'O multiplicador otimizado mudou de forma relevante em relação ao período anterior.',
    }
    return messages[statusCode] || ''
}

const DOCTOR_CONVERSION_FORMULA_CONFIG = Object.freeze({
    averageWeight: 0.3,
    medianWeight: 0.2,
    dailyGoalWeight: 0.5,
})

function normalizeDoctorConversionConfig(input = {}) {
    const config = getDoctorConversionOptimizationConfig(GERENCIA_APPS_SCRIPT_CONFIG, {
        defaultIntervalMultiplier: input.defaultIntervalMultiplier ?? input.default_interval_multiplier,
        intervalMultiplierMin: input.intervalMultiplierMin ?? input.interval_multiplier_min,
        intervalMultiplierMax: input.intervalMultiplierMax ?? input.interval_multiplier_max,
        objectiveName: input.objectiveName ?? input.objective_name,
        requireAllBandsIfPossible: input.requireAllBandsIfPossible ?? input.require_all_bands_if_possible,
        requireExtremesIfPossible: input.requireExtremesIfPossible ?? input.require_extremes_if_possible,
        stabilityTieBreak: input.stabilityTieBreak ?? input.stability_tie_break,
        tieBreakPolicy: input.tieBreakPolicy ?? input.tie_break_policy,
        unstableJumpThreshold: input.unstableJumpThreshold ?? input.unstable_jump_threshold,
    })
    const normalized = {
        defaultIntervalMultiplier: null,
        intervalMultiplierMin: config.intervalMultiplierMin,
        intervalMultiplierMax: config.intervalMultiplierMax,
        objectiveName: config.objectiveName,
        requireAllBandsIfPossible: config.requireAllBandsIfPossible,
        requireExtremesIfPossible: config.requireExtremesIfPossible,
        stabilityTieBreak: config.stabilityTieBreak,
        tieBreakPolicy: config.tieBreakPolicy,
        unstableJumpThreshold: config.unstableJumpThreshold,
    }
    return {
        ...normalized,
        configHash: stableConfigHash({
            formula: DOCTOR_CONVERSION_FORMULA_CONFIG,
            intervalMultiplierMin: normalized.intervalMultiplierMin,
            intervalMultiplierMax: normalized.intervalMultiplierMax,
            objectiveName: normalized.objectiveName,
            requireAllBandsIfPossible: normalized.requireAllBandsIfPossible,
            requireExtremesIfPossible: normalized.requireExtremesIfPossible,
            stabilityTieBreak: normalized.stabilityTieBreak,
            tieBreakPolicy: normalized.tieBreakPolicy,
            unstableJumpThreshold: normalized.unstableJumpThreshold,
        }),
        updatedAt: input.updated_at || input.updatedAt || null,
        updatedBy: input.updated_by || input.updatedBy || null,
    }
}

function validateDoctorConversionConfigPayload(payload = {}) {
    const numericFields = [
        ['intervalMultiplierMin', payload.intervalMultiplierMin],
        ['intervalMultiplierMax', payload.intervalMultiplierMax],
        ['unstableJumpThreshold', payload.unstableJumpThreshold],
    ]
    for (const [field, value] of numericFields) {
        if (value != null && !Number.isFinite(Number(value))) {
            const error = new Error(`INVALID_CONVERSION_CONFIG:${field}`)
            error.statusCode = 400
            throw error
        }
    }
    const min = payload.intervalMultiplierMin == null ? 0 : Number(payload.intervalMultiplierMin)
    const max = payload.intervalMultiplierMax == null ? 2 : Number(payload.intervalMultiplierMax)
    if (min < 0 || max > 2 || min > max) {
        const error = new Error('INVALID_CONVERSION_CONFIG:multiplier_bounds')
        error.statusCode = 400
        throw error
    }
    if (payload.objectiveName != null && String(payload.objectiveName) !== 'sse_uniform') {
        const error = new Error('UNSUPPORTED_CONVERSION_OBJECTIVE')
        error.statusCode = 400
        throw error
    }
    if (payload.tieBreakPolicy != null && String(payload.tieBreakPolicy) !== 'previous_then_widest_plateau_center') {
        const error = new Error('UNSUPPORTED_CONVERSION_TIE_BREAK_POLICY')
        error.statusCode = 400
        throw error
    }
}

async function readDoctorConversionConfig(pgPool) {
    const result = await pgPool.query(
        `select * from crm_atendimento.doctor_conversion_config where singleton = true limit 1`,
    )
    const row = result.rows[0] || {}
    // Reading the conversion report must never repair or rewrite configuration.
    // The next explicit manager update persists the normalized hash instead.
    return normalizeDoctorConversionConfig(row)
}

async function writeDoctorConversionConfig(pgPool, payload, actor) {
    const current = await readDoctorConversionConfig(pgPool)
    const merged = { ...current, ...payload }
    validateDoctorConversionConfigPayload(merged)
    const next = normalizeDoctorConversionConfig(merged)
    const result = await pgPool.query(
        `insert into crm_atendimento.doctor_conversion_config(
            singleton, default_interval_multiplier, interval_multiplier_min, interval_multiplier_max,
            objective_name, require_all_bands_if_possible, require_extremes_if_possible,
            stability_tie_break, tie_break_policy, unstable_jump_threshold, config_hash, updated_by, updated_at
         ) values (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         on conflict(singleton) do update set
            default_interval_multiplier = excluded.default_interval_multiplier,
            interval_multiplier_min = excluded.interval_multiplier_min,
            interval_multiplier_max = excluded.interval_multiplier_max,
            objective_name = excluded.objective_name,
            require_all_bands_if_possible = excluded.require_all_bands_if_possible,
            require_extremes_if_possible = excluded.require_extremes_if_possible,
            stability_tie_break = excluded.stability_tie_break,
            tie_break_policy = excluded.tie_break_policy,
            unstable_jump_threshold = excluded.unstable_jump_threshold,
            config_hash = excluded.config_hash,
            updated_by = excluded.updated_by,
            updated_at = now()
         returning *`,
        [
            next.defaultIntervalMultiplier,
            next.intervalMultiplierMin,
            next.intervalMultiplierMax,
            next.objectiveName,
            next.requireAllBandsIfPossible,
            next.requireExtremesIfPossible,
            next.stabilityTieBreak,
            next.tieBreakPolicy,
            next.unstableJumpThreshold,
            next.configHash,
            actorLabel(actor),
        ],
    )
    return normalizeDoctorConversionConfig(result.rows[0] || next)
}

function buildDoctorConversionCalendarHash(unit, bounds, goalPlan, scheduleByUnit, scheduleSource) {
    const schedule = [...(scheduleByUnit.get(unit.slug) || new Map()).entries()]
        .filter(([date]) => date >= bounds.metricStart && date <= bounds.metricEnd)
        .sort(([left], [right]) => left.localeCompare(right))
    return stableConfigHash({
        unitSlug: unit.slug,
        periodStart: bounds.metricStart,
        periodEnd: bounds.metricEnd,
        scheduleSource: scheduleSource || 'crm',
        schedule,
        goalSegments: goalPlan.segments || [],
    }).replace(/^fnv1a-/, 'calendar-fnv1a-')
}

function mapDoctorConversionHistoryRow(row = {}) {
    return {
        id: row.id || null,
        unitSlug: row.unit_slug || '',
        unitName: row.unit_name || '',
        periodStart: isoDateFromDb(row.period_start),
        periodEnd: isoDateFromDb(row.period_end),
        reportDate: isoDateFromDb(row.report_date),
        weekOfMonth: row.week_of_month == null ? null : Number(row.week_of_month),
        selectedMultiplier: row.selected_multiplier == null ? null : Number(row.selected_multiplier),
        previousIntervalMultiplier: row.previous_interval_multiplier == null ? null : Number(row.previous_interval_multiplier),
        selectionReason: row.selection_reason || null,
        optimalPlateau: row.optimal_plateau || null,
        homogeneityScore: Number(row.homogeneity_score || 0),
        homogeneityLoss: Number(row.homogeneity_loss || 0),
        statusCode: row.status_code || 'BEST_EFFORT',
        optimizationStatusCode: row.optimization_status_code || row.status_code || 'BEST_EFFORT',
        counts: row.counts || {},
        proportions: row.proportions || {},
        configHash: row.config_hash || '',
        calendarHash: row.calendar_hash || '',
        computedAt: row.computed_at || null,
    }
}

async function readPreviousDoctorConversionResults(pgPool, unitIds, periodStart) {
    if (!unitIds.length) return new Map()
    const result = await pgPool.query(
        `select distinct on (r.unit_id)
            r.unit_id, r.selected_multiplier, r.period_start, r.period_end, r.computed_at
         from crm_atendimento.doctor_conversion_results r
         where r.unit_id = any($1::uuid[])
           and r.period_end < $2::date
           and r.selected_multiplier is not null
         order by r.unit_id, r.period_end desc, r.computed_at desc`,
        [unitIds, periodStart],
    )
    return new Map(result.rows.map((row) => [row.unit_id, Number(row.selected_multiplier)]))
}

async function persistDoctorConversionResult(pgPool, { unit, bounds, reportDate, section, actor, calendarHash }) {
    const optimization = section.optimization || {}
    await pgPool.query(
        `insert into crm_atendimento.doctor_conversion_results(
            unit_id, period_start, period_end, report_date, week_of_month,
            selected_multiplier, previous_interval_multiplier, selection_reason, optimal_plateau,
            homogeneity_score, homogeneity_loss,
            status_code, optimization_status_code, counts, proportions,
            config_hash, calendar_hash, payload, computed_by, computed_at, updated_at
         ) values ($1, $2::date, $3::date, $4::date, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17, $18::jsonb, $19, now(), now())
         on conflict(unit_id, period_start, period_end, config_hash, calendar_hash) do update set
            report_date = excluded.report_date,
            week_of_month = excluded.week_of_month,
            selected_multiplier = excluded.selected_multiplier,
            previous_interval_multiplier = excluded.previous_interval_multiplier,
            selection_reason = excluded.selection_reason,
            optimal_plateau = excluded.optimal_plateau,
            homogeneity_score = excluded.homogeneity_score,
            homogeneity_loss = excluded.homogeneity_loss,
            status_code = excluded.status_code,
            optimization_status_code = excluded.optimization_status_code,
            counts = excluded.counts,
            proportions = excluded.proportions,
            payload = excluded.payload,
            computed_by = excluded.computed_by,
            computed_at = now(),
            updated_at = now()`,
        [
            unit.id,
            bounds.metricStart,
            bounds.metricEnd,
            reportDate || bounds.metricEnd,
            bounds.weekNumber || null,
            optimization.selectedMultiplier == null ? null : Number(optimization.selectedMultiplier),
            optimization.previousIntervalMultiplier,
            optimization.selectionReason || 'not_applicable',
            optimization.optimalPlateau ? JSON.stringify(optimization.optimalPlateau) : null,
            optimization.homogeneityScore || 0,
            optimization.homogeneityLoss || 0,
            optimization.statusCode || 'BEST_EFFORT',
            optimization.optimizationStatusCode || optimization.statusCode || 'BEST_EFFORT',
            JSON.stringify(optimization.counts || {}),
            JSON.stringify(optimization.proportions || {}),
            optimization.configHash || '',
            calendarHash,
            JSON.stringify(section),
            actorLabel(actor),
        ],
    )
}

async function queryDoctorConversionHistory(pgPool, query, actor) {
    const where = ['1=1']
    const params = []
    applyActorUnitFilter(where, params, actor)
    const unit = String(query?.unit || '').trim()
    if (unit && unit !== 'all') {
        params.push(normalizeUnit(unit).slug)
        where.push(`u.slug = $${params.length}`)
    }
    const before = String(query?.before || '').trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(before)) {
        params.push(before)
        where.push(`r.period_end <= $${params.length}::date`)
    }
    const limit = sanitizeLimit(query?.limit, 12, 104)
    params.push(limit)
    const result = await pgPool.query(
        `select latest.*
         from (
            select distinct on (r.unit_id, r.period_start, r.period_end)
                r.*, u.slug as unit_slug, u.name as unit_name
            from crm_atendimento.doctor_conversion_results r
            join crm_atendimento.units u on u.id = r.unit_id
            where ${where.join(' and ')}
            order by r.unit_id, r.period_start, r.period_end, r.computed_at desc
         ) latest
         order by latest.period_end desc, latest.computed_at desc
         limit $${params.length}`,
        params,
    )
    return result.rows.map(mapDoctorConversionHistoryRow)
}

function resolveDoctorConversionOperationQuery(payload = {}) {
    const query = {
        unit: String(payload.unit || payload.unitSlug || '').trim(),
        date: String(payload.date || '').trim(),
        from: String(payload.from || '').trim(),
        to: String(payload.to || '').trim(),
        previousIntervalMultiplier: payload.previousIntervalMultiplier,
    }
    if (query.from && query.to) {
        if (!query.date) query.date = query.to
        return query
    }
    const year = Number(payload.year || 0)
    const month = Number(payload.month || 0)
    const weekOfMonth = Number(payload.weekOfMonth || payload.week || 0)
    if (Number.isInteger(year) && year >= 2000 && Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(weekOfMonth) && weekOfMonth >= 1 && weekOfMonth <= 6) {
        const days = []
        const daysInMonth = new Date(year, month, 0).getDate()
        for (let day = 1; day <= daysInMonth; day += 1) {
            const date = new Date(year, month - 1, day, 12, 0, 0)
            if (calculateWeekOfMonth(date) === weekOfMonth) days.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
        }
        if (days.length) {
            query.from = days[0]
            query.to = days[days.length - 1]
            query.date = query.to
        }
    }
    return query
}

async function buildInternalConversionMetrics(pgPool, period, query, actor, { persist = false, syncSchedule = false } = {}) {
    const reportBounds = monthBoundsFromReportPeriod(period)
    const bounds = resolveConversionMetricBounds(reportBounds, query)
    const optimizationConfig = await readDoctorConversionConfig(pgPool)
    const unitWhere = ['1=1']
    const unitParams = []
    applyActorUnitFilter(unitWhere, unitParams, actor)
    const requestedUnit = String(query?.unit || '').trim()
    if (requestedUnit && requestedUnit !== 'all') {
        unitParams.push(normalizeUnit(requestedUnit).slug)
        unitWhere.push(`u.slug = $${unitParams.length}`)
    }
    const units = await pgPool.query(
        `select u.id, u.slug, u.name
         from crm_atendimento.units u
         where ${unitWhere.join(' and ')}
         order by u.name`,
        unitParams,
    )
    const selectedUnits = units.rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name }))
    const unitSlugs = selectedUnits.map((unit) => unit.slug)
    if (!unitSlugs.length) return { byUnit: new Map(), sections: [], topDoctors: [] }
    const previousMultiplierByUnit = await readPreviousDoctorConversionResults(
        pgPool,
        selectedUnits.map((unit) => unit.id),
        bounds.metricStart,
    )

    const monthSegments = splitIsoDateRangeByMonth(bounds.metricStart || bounds.weekStart, bounds.metricEnd || bounds.weekEnd)
    const goalMonthKeys = monthSegments.map((segment) => segment.monthKey)
    const scheduleStart = monthSegments[0]?.monthStart || bounds.monthStart
    const scheduleEnd = monthSegments[monthSegments.length - 1]?.monthEnd || bounds.monthEnd
    const [professionals, weeklyTotals, doctorTotals, goals, goalLevels] = await Promise.all([
        pgPool.query(
            `select id, name, role, status, units, roles
             from crm_atendimento.professionals
             order by name`,
        ),
        pgPool.query(
            `select u.slug as unit_slug, coalesce(sum(a.value), 0)::numeric as total
             from crm_atendimento.attendances a
             join crm_atendimento.units u on u.id = a.unit_id
             where a.deleted_at is null
               and a.service_date >= $1::date
               and a.service_date <= $2::date
               and u.slug = any($3)
             group by u.slug`,
            [bounds.metricStart, bounds.metricEnd, unitSlugs],
        ),
        pgPool.query(
            `select u.slug as unit_slug, coalesce(inj.canonical_id, inj.id) as doctor_id,
                    coalesce(inj_canonical.name, inj.name) as doctor_name, coalesce(sum(a.value), 0)::numeric as total,
                    count(distinct a.service_date)::int as attended_days
             from crm_atendimento.attendances a
             join crm_atendimento.units u on u.id = a.unit_id
             join crm_atendimento.professionals inj on inj.id = a.injector_id
             left join crm_atendimento.professionals inj_canonical on inj_canonical.id = coalesce(inj.canonical_id, inj.id)
             where a.deleted_at is null
               and a.service_date >= $1::date
               and a.service_date <= $2::date
               and u.slug = any($3)
             group by u.slug, coalesce(inj.canonical_id, inj.id), coalesce(inj_canonical.name, inj.name)`,
            [bounds.metricStart, bounds.metricEnd, unitSlugs],
        ),
        pgPool.query(
            `select u.slug as unit_slug, g.goal_month, g.value
             from crm_atendimento.monthly_unit_goals g
             join crm_atendimento.units u on u.id = g.unit_id
             where g.goal_month = any($1::date[])
               and u.slug = any($2)`,
            [goalMonthKeys, unitSlugs],
        ),
        pgPool.query(
            `select u.slug as unit_slug, gl.goal_month, gl.level_key, gl.value
             from crm_atendimento.monthly_unit_goal_levels gl
             join crm_atendimento.units u on u.id = gl.unit_id
             where gl.goal_month = any($1::date[])
               and u.slug = any($2)`,
            [goalMonthKeys, unitSlugs],
        ),
    ])
    const escalaCoverage = await readEscalaScheduleCoverage(pgPool, selectedUnits, scheduleStart, scheduleEnd, actor, { persistMissing: syncSchedule })
    const scheduleRows = await pgPool.query(
        `select u.slug as unit_slug, s.service_date, s.doctor_name, s.professional_id
         from crm_atendimento.schedule_days s
         join crm_atendimento.units u on u.id = s.unit_id
         where s.service_date >= $1::date
           and s.service_date <= $2::date
           and u.slug = any($3)`,
        [scheduleStart, scheduleEnd, unitSlugs],
    )

    const weeklyTotalByUnit = new Map(weeklyTotals.rows.map((row) => [row.unit_slug, Number(row.total || 0)]))
    const doctorTotalByUnit = new Map()
    for (const row of doctorTotals.rows) {
        const unitMap = doctorTotalByUnit.get(row.unit_slug) || new Map()
        const total = Number(row.total || 0)
        const attendedDays = Math.max(0, Number(row.attended_days || 0))
        const entry = { total, attendedDays }
        unitMap.set(row.doctor_id, entry)
        unitMap.set(normalizeText(row.doctor_name), entry)
        doctorTotalByUnit.set(row.unit_slug, unitMap)
    }

    const scheduleByUnit = new Map()
    const doctorWorkingDaysByUnit = new Map()
    for (const row of scheduleRows.rows) {
        const unitMap = scheduleByUnit.get(row.unit_slug) || new Map()
        const serviceDate = isoDateFromDb(row.service_date)
        unitMap.set(serviceDate, row.doctor_name)
        scheduleByUnit.set(row.unit_slug, unitMap)
        if (serviceDate < bounds.metricStart || serviceDate > bounds.metricEnd) continue
        const doctorDays = doctorWorkingDaysByUnit.get(row.unit_slug) || new Map()
        const keys = [row.professional_id, normalizeText(row.doctor_name)].filter(Boolean)
        for (const key of keys) doctorDays.set(key, Number(doctorDays.get(key) || 0) + 1)
        doctorWorkingDaysByUnit.set(row.unit_slug, doctorDays)
    }
    const baseGoalByUnitMonth = new Map()
    for (const row of goals.rows) {
        const monthKey = isoDateFromDb(row.goal_month || row.month || row.goalMonth)
        const unitMap = baseGoalByUnitMonth.get(row.unit_slug) || new Map()
        unitMap.set(monthKey, Number(row.value || 0))
        baseGoalByUnitMonth.set(row.unit_slug, unitMap)
    }
    const firstGoalByUnitMonth = new Map()
    for (const row of goalLevels.rows) {
        if (row.level_key !== 'first') continue
        const monthKey = isoDateFromDb(row.goal_month || row.month || row.goalMonth)
        const unitMap = firstGoalByUnitMonth.get(row.unit_slug) || new Map()
        unitMap.set(monthKey, Number(row.value || 0))
        firstGoalByUnitMonth.set(row.unit_slug, unitMap)
    }

    const professionalsByUnit = new Map()
    for (const unit of selectedUnits) {
        professionalsByUnit.set(unit.slug, professionals.rows.filter((row) => professionalIsActiveInjectorForUnit(row, unit.slug)))
    }

    const byUnit = new Map()
    const sections = []

    for (const unit of selectedUnits) {
        const totals = doctorTotalByUnit.get(unit.slug) || new Map()
        const workingDays = doctorWorkingDaysByUnit.get(unit.slug) || new Map()
        const doctors = (professionalsByUnit.get(unit.slug) || [])
            .map((doctor) => {
                const total = totals.get(doctor.id) ?? totals.get(normalizeText(doctor.name)) ?? { total: 0, attendedDays: 0 }
                const scheduledDays = Number(workingDays.get(doctor.id) ?? workingDays.get(normalizeText(doctor.name)) ?? 0)
                // Escala is authoritative for a doctor's workday. Imported
                // historical rows may lack it, so distinct service dates are a
                // conservative fallback instead of silently dividing by zero.
                const doctorWorkingDays = scheduledDays > 0 ? scheduledDays : Number(total.attendedDays || 0)
                return {
                    id: doctor.id,
                    name: doctor.name,
                    unitSlug: unit.slug,
                    unitName: unit.name,
                    realized: Number(total.total || 0),
                    workingDays: doctorWorkingDays,
                }
            })
        const firstGoalMap = firstGoalByUnitMonth.get(unit.slug) || new Map()
        const baseGoalMap = baseGoalByUnitMonth.get(unit.slug) || new Map()
        const goalPlan = calculateConversionGoalPlan(monthSegments.map((segment) => ({
            ...segment,
            monthlyGoal: firstGoalMap.get(segment.monthKey) ?? baseGoalMap.get(segment.monthKey) ?? 0,
            monthOperationalDays: countOperationalDaysWithEscala(unit.slug, scheduleByUnit, escalaCoverage, segment.monthStart, segment.monthEnd),
            periodOperationalDays: countOperationalDaysWithEscala(unit.slug, scheduleByUnit, escalaCoverage, segment.segmentStart, segment.segmentEnd),
        })))
        const periodAttendanceTotal = Number(weeklyTotalByUnit.get(unit.slug) || 0)
        const previousIntervalMultiplier = query?.previousIntervalMultiplier != null
            ? Number(query.previousIntervalMultiplier)
            : previousMultiplierByUnit.get(unit.id) ?? null
        const stats = calculateDoctorConversionRanking({
            doctors,
            monthlyGoal: goalPlan.monthlyGoal,
            periodAttendanceTotal,
            monthOperationalDays: goalPlan.monthOperationalDays,
            weekOperationalDays: goalPlan.periodOperationalDays,
            dailyGoal: goalPlan.dailyGoal,
            periodGoal: goalPlan.periodGoal,
            weeklyGoal: goalPlan.weeklyGoal,
            intervalMultiplier: optimizationConfig.defaultIntervalMultiplier,
            intervalMultiplierMin: optimizationConfig.intervalMultiplierMin,
            intervalMultiplierMax: optimizationConfig.intervalMultiplierMax,
            previousIntervalMultiplier,
            objectiveName: optimizationConfig.objectiveName,
            requireAllBandsIfPossible: optimizationConfig.requireAllBandsIfPossible,
            requireExtremesIfPossible: optimizationConfig.requireExtremesIfPossible,
            stabilityTieBreak: optimizationConfig.stabilityTieBreak,
            tieBreakPolicy: optimizationConfig.tieBreakPolicy,
            unstableJumpThreshold: optimizationConfig.unstableJumpThreshold,
        })
        byUnit.set(unit.slug, buildConversionMetricPayload(stats, unit.name))
        const calendarHash = buildDoctorConversionCalendarHash(unit, bounds, goalPlan, scheduleByUnit, escalaCoverage.source)
        const section = {
            unitName: unit.name,
            unitSlug: unit.slug,
            metrics: byUnit.get(unit.slug),
            optimization: {
                ...buildConversionOptimizationPayload(stats),
                calendarHash,
            },
            goalPlan: {
                periodOperationalDays: Number(goalPlan.periodOperationalDays || 0),
                periodGoal: Number(goalPlan.periodGoal || 0),
                dailyGoal: Number(goalPlan.dailyGoal || 0),
                segments: (Array.isArray(goalPlan.segments) ? goalPlan.segments : []).map((segment) => ({
                    monthKey: segment.monthKey,
                    monthlyGoal: Number(segment.monthlyGoal || 0),
                    monthOperationalDays: Number(segment.monthOperationalDays || 0),
                    periodOperationalDays: Number(segment.periodOperationalDays || 0),
                    dailyGoal: Number(segment.dailyGoal || 0),
                    periodGoal: Number(segment.periodGoal || 0),
                })),
            },
            doctors: stats.ranking.map((doctor) => ({
                id: doctor.id,
                name: doctor.name,
                unitName: unit.name,
                unitSlug: unit.slug,
                weekValue: moneyMetric(doctor.weekValue).weekValue,
                totalValue: moneyMetric(doctor.totalValue).totalValue,
                workingDays: Number(doctor.workingDays || 0),
                score: doctor.score,
                level: doctor.level,
                classification: doctor.classification,
                modifiedZ: doctor.modifiedZ,
                distanceToCutOff: doctor.distanceToCutOff,
                distanceToLowerLimit: doctor.distanceToLowerLimit,
                distanceToUpperLimit: doctor.distanceToUpperLimit,
                rank: doctor.rank,
                position: '',
            })),
            isAggregate: false,
            calendarMode: 'unit-calendar',
            calendarCompatible: true,
            period: bounds,
        }
        if (persist) {
            await persistDoctorConversionResult(pgPool, {
                unit,
                bounds,
                reportDate: query?.date,
                section,
                actor,
                calendarHash,
            })
        }
        sections.push(section)
    }

    const warnings = []
    const allDoctors = sections
        .flatMap((section) => section.doctors)
        .sort((left, right) => Number(right.weekValue || 0) - Number(left.weekValue || 0)
            || Number(right.score || 0) - Number(left.score || 0)
            || left.name.localeCompare(right.name, 'pt-BR'))
        .map((doctor, index) => ({ ...doctor, rank: index + 1 }))
    let topDoctors = allDoctors.slice(0, 8)
    if (!requestedUnit || requestedUnit === 'all') {
        // The aggregate is a new calculation, not an average of the unit-level
        // metrics. Goals and operational capacity are summed by unit/month and
        // the same professional is consolidated before ranking.
        const aggregateGoalPlan = calculateConversionGoalPlan(monthSegments.map((segment) => {
            const capacity = selectedUnits.reduce((total, unit) => {
                const firstGoalMap = firstGoalByUnitMonth.get(unit.slug) || new Map()
                const baseGoalMap = baseGoalByUnitMonth.get(unit.slug) || new Map()
                total.monthlyGoal += firstGoalMap.get(segment.monthKey) ?? baseGoalMap.get(segment.monthKey) ?? 0
                total.monthOperationalDays += countOperationalDaysWithEscala(unit.slug, scheduleByUnit, escalaCoverage, segment.monthStart, segment.monthEnd)
                total.periodOperationalDays += countOperationalDaysWithEscala(unit.slug, scheduleByUnit, escalaCoverage, segment.segmentStart, segment.segmentEnd)
                return total
            }, { monthlyGoal: 0, monthOperationalDays: 0, periodOperationalDays: 0 })
            return { ...segment, ...capacity }
        }))
        const aggregateStats = calculateDoctorConversionRanking({
            doctors: allDoctors.map((doctor) => ({
                id: doctor.id,
                name: doctor.name,
                realized: Number(doctor.totalValue || 0),
                workingDays: Number(doctor.workingDays || 0),
            })),
            monthlyGoal: aggregateGoalPlan.monthlyGoal,
            periodAttendanceTotal: selectedUnits.reduce((total, unit) => total + Number(weeklyTotalByUnit.get(unit.slug) || 0), 0),
            monthOperationalDays: aggregateGoalPlan.monthOperationalDays,
            weekOperationalDays: aggregateGoalPlan.periodOperationalDays,
            dailyGoal: aggregateGoalPlan.dailyGoal,
            periodGoal: aggregateGoalPlan.periodGoal,
            weeklyGoal: aggregateGoalPlan.weeklyGoal,
            intervalMultiplier: optimizationConfig.defaultIntervalMultiplier,
            intervalMultiplierMin: optimizationConfig.intervalMultiplierMin,
            intervalMultiplierMax: optimizationConfig.intervalMultiplierMax,
            objectiveName: optimizationConfig.objectiveName,
            requireAllBandsIfPossible: optimizationConfig.requireAllBandsIfPossible,
            requireExtremesIfPossible: optimizationConfig.requireExtremesIfPossible,
            stabilityTieBreak: optimizationConfig.stabilityTieBreak,
            tieBreakPolicy: optimizationConfig.tieBreakPolicy,
            unstableJumpThreshold: optimizationConfig.unstableJumpThreshold,
        })
        const aggregateCalendarHash = stableConfigHash({
            unitSlugs: selectedUnits.map((unit) => unit.slug).sort(),
            periodStart: bounds.metricStart,
            periodEnd: bounds.metricEnd,
            scheduleSource: escalaCoverage.source || 'crm',
            goalSegments: aggregateGoalPlan.segments || [],
        }).replace(/^fnv1a-/, 'calendar-fnv1a-')
        const aggregateDoctorsByIdentity = new Map()
        for (const doctor of allDoctors) {
            const identity = String(doctor.id || normalizeText(doctor.name) || '').trim()
            if (!identity) continue
            const existing = aggregateDoctorsByIdentity.get(identity)
            if (existing) {
                existing.weekValue += Number(doctor.weekValue || 0)
                existing.totalValue += Number(doctor.totalValue || 0)
                existing.score += Number(doctor.score || 0)
                if (!existing.sourceUnits.includes(doctor.unitName)) existing.sourceUnits.push(doctor.unitName)
                continue
            }
            aggregateDoctorsByIdentity.set(identity, {
                ...doctor,
                weekValue: Number(doctor.weekValue || 0),
                totalValue: Number(doctor.totalValue || 0),
                score: Number(doctor.score || 0),
                sourceUnits: [doctor.unitName],
            })
        }
        const aggregateDoctors = [...aggregateDoctorsByIdentity.values()]
            // Each unit awards points against its own goal and distribution. The
            // cross-unit view must compare those normalized points, never the
            // raw procedure totals from different units.
            .sort((left, right) => Number(right.score || 0) - Number(left.score || 0)
                || Number(right.weekValue || 0) - Number(left.weekValue || 0)
                || left.name.localeCompare(right.name, 'pt-BR'))
            .map((doctor, index) => ({
                ...doctor,
                unitName: 'Todas unidades',
                unitSlug: 'all',
                rank: index + 1,
                position: '',
            }))
        // The aggregate has summed capacity, never a fictional shared calendar.
        // Its doctor list is also the canonical, cross-unit point ranking used
        // by the global top-doctor summary.
        topDoctors = aggregateDoctors.slice(0, 8)
        sections.unshift({
            unitName: 'Todas unidades',
            unitSlug: 'all',
            metrics: buildConversionMetricPayload(aggregateStats, 'Todas unidades'),
            optimization: {
                ...buildConversionOptimizationPayload(aggregateStats),
                calendarHash: aggregateCalendarHash,
            },
            goalPlan: {
                periodOperationalDays: Number(aggregateGoalPlan.periodOperationalDays || 0),
                periodGoal: Number(aggregateGoalPlan.periodGoal || 0),
                dailyGoal: Number(aggregateGoalPlan.dailyGoal || 0),
                segments: aggregateGoalPlan.segments || [],
            },
            doctors: aggregateDoctors,
            isAggregate: true,
            comparisonMetric: 'unit-score',
            calendarMode: 'per-unit-capacity-sum',
            calendarCompatible: false,
            period: bounds,
        })
    }
    for (const section of sections) {
        if (section.isAggregate) continue
        const periodTotal = Number(section.metrics?.periodAttendanceTotal?.weekValue || 0)
        const rankedTotal = Number(section.metrics?.rankedDoctorTotal?.weekValue || 0)
        if (Math.abs(periodTotal - rankedTotal) > 0.009) {
            warnings.push(`Conversão ${section.unitName}: total do período ${formatCurrencyDiagnostic(periodTotal)} difere do total ranqueável ${formatCurrencyDiagnostic(rankedTotal)}.`)
        }
        const optimizationWarning = conversionOptimizationWarning(section.optimization?.statusCode)
        if (optimizationWarning) warnings.push(`Conversão ${section.unitName}: ${optimizationWarning}`)
    }
    const scheduleCoverageRows = escalaCoverage.byUnit ? Array.from(escalaCoverage.byUnit.values()) : []
    return {
        byUnit,
        sections,
        topDoctors,
        period: bounds,
        intervalMultiplier: optimizationConfig.defaultIntervalMultiplier,
        objectiveName: optimizationConfig.objectiveName,
        warnings,
        scheduleSource: escalaCoverage.source || 'crm',
        scheduleCoverageMonths: scheduleCoverageRows
            .flatMap((coverage) => Array.from(coverage.coveredMonths || []).map((month) => ({ unitSlug: coverage.unit.slug, unitName: coverage.unit.name, month }))),
    }
}

function applyInternalConversionMetrics(report, internalMetrics) {
    if (!report || !internalMetrics) return report
    report.doctorRanking = {
        sections: internalMetrics.sections || [],
        topDoctors: internalMetrics.topDoctors || [],
        period: internalMetrics.period || null,
        intervalMultiplier: internalMetrics.intervalMultiplier,
        objectiveName: internalMetrics.objectiveName || 'sse_uniform',
    }
    report.summary = {
        ...(report.summary || {}),
        doctorRankingSource: 'crm',
        scheduleSource: internalMetrics.scheduleSource || 'crm',
        scheduleCoverageMonths: internalMetrics.scheduleCoverageMonths || [],
    }
    report.warnings = [
        ...((report.warnings || []).filter(Boolean)),
        ...((internalMetrics.warnings || []).filter(Boolean)),
    ]
    return report
}

export function filterConversionReportToActorScope(report, query, actor) {
    if (!report || typeof report !== 'object') return report
    const requestedUnitRaw = String(query?.unit || query?.unitSlug || '').trim()
    const requestedUnit = requestedUnitRaw ? normalizeUnit(requestedUnitRaw).slug : ''
    const sections = (Array.isArray(report.sections) ? report.sections : []).filter((section) => {
        const sectionUnit = normalizeUnit(section?.unitSlug || section?.unitName || '').slug
        if (requestedUnit && requestedUnit !== 'all' && sectionUnit !== requestedUnit) return false
        return actorCanReadUnit(actor, sectionUnit)
    })
    return {
        ...report,
        sections,
        summary: {
            ...(report.summary || {}),
            sections: sections.length,
            rows: sections.reduce((total, section) => total + (Array.isArray(section?.rows) ? section.rows.length : 0), 0),
        },
    }
}

export async function upsertUnit(client, unit) {
    const row = await client.query(
        `insert into crm_atendimento.units(slug, name)
         values ($1, $2)
         on conflict(slug) do update set name = excluded.name, updated_at = now()
         returning id, slug, name`,
        [unit.slug, unit.name],
    )
    return row.rows[0]
}

export async function upsertProcedure(client, name) {
    const safeName = String(name || '').trim()
    if (!safeName) return null
    const row = await client.query(
        `insert into crm_atendimento.procedures(name)
         values ($1)
         on conflict(name) do update set updated_at = now()
         returning id, name`,
        [safeName],
    )
    return row.rows[0]
}

async function resolveAttendanceUnit(client, unit) {
    const result = await client.query(
        `select id, slug, name from crm_atendimento.units where slug = $1 limit 1`,
        [unit.slug],
    )
    if (!result.rows[0]) throw mutationError('UNKNOWN_UNIT')
    return result.rows[0]
}

async function resolveAttendanceProcedure(client, name) {
    const result = await client.query(
        `select id, name from crm_atendimento.procedures
         where lower(trim(name)) = lower(trim($1))
         order by created_at asc
         limit 2`,
        [name],
    )
    if (result.rows.length !== 1) {
        throw mutationError(result.rows.length > 1 ? 'AMBIGUOUS_PROCEDURE' : 'UNKNOWN_PROCEDURE')
    }
    return result.rows[0]
}

export async function upsertProfessional(client, input) {
    const name = getCanonicalProfessionalName(input?.name)
    if (!isMeaningfulProfessionalName(name)) return null
    const roles = Array.isArray(input?.roles) && input.roles.length ? input.roles.map(String).filter(Boolean) : splitList(input?.role)
    const turnos = Array.isArray(input?.turnos) && input.turnos.length ? input.turnos.map(String).filter(Boolean) : splitList(input?.shift)
    const row = await client.query(
        `insert into crm_atendimento.professionals(name, role, status, units, shift, roles, turnos, background_color, font_color, font_family, font_size, font_weight, font_style, alias, phone, email, instagram)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         on conflict(name) do update set
            role = coalesce(excluded.role, crm_atendimento.professionals.role),
            status = coalesce(excluded.status, crm_atendimento.professionals.status),
            units = case when array_length(excluded.units, 1) is null then crm_atendimento.professionals.units else excluded.units end,
            shift = coalesce(excluded.shift, crm_atendimento.professionals.shift),
            roles = case when array_length(excluded.roles, 1) is null then crm_atendimento.professionals.roles else excluded.roles end,
            turnos = case when array_length(excluded.turnos, 1) is null then crm_atendimento.professionals.turnos else excluded.turnos end,
            background_color = coalesce(excluded.background_color, crm_atendimento.professionals.background_color),
            font_color = coalesce(excluded.font_color, crm_atendimento.professionals.font_color),
            font_family = coalesce(excluded.font_family, crm_atendimento.professionals.font_family),
            font_size = coalesce(excluded.font_size, crm_atendimento.professionals.font_size),
            font_weight = coalesce(excluded.font_weight, crm_atendimento.professionals.font_weight),
            font_style = coalesce(excluded.font_style, crm_atendimento.professionals.font_style),
            alias = coalesce(excluded.alias, crm_atendimento.professionals.alias),
            phone = coalesce(excluded.phone, crm_atendimento.professionals.phone),
            email = coalesce(excluded.email, crm_atendimento.professionals.email),
            instagram = coalesce(excluded.instagram, crm_atendimento.professionals.instagram),
            updated_at = now()
         returning id, name, role, status, units, shift, roles, turnos, background_color, font_color, font_family, font_size, font_weight, font_style, alias, phone, email, instagram`,
        [
            name,
            roles.join(', ') || String(input?.role || '').trim() || null,
            String(input?.status || '').trim() || 'Ativo',
            Array.isArray(input?.units) ? input.units.map(String).filter(Boolean) : [],
            turnos.join(', ') || String(input?.shift || '').trim() || null,
            roles,
            turnos,
            String(input?.backgroundColor || input?.background_color || '').trim() || null,
            String(input?.fontColor || input?.font_color || '').trim() || null,
            String(input?.fontFamily || input?.font_family || '').trim() || null,
            Number.isFinite(Number(input?.fontSize ?? input?.font_size)) ? Number(input?.fontSize ?? input?.font_size) : null,
            String(input?.fontWeight || input?.font_weight || '').trim() || null,
            String(input?.fontStyle || input?.font_style || '').trim() || null,
            String(input?.alias || '').trim() || null,
            String(input?.phone || '').trim() || null,
            String(input?.email || '').trim() || null,
            String(input?.instagram || '').trim() || null,
        ],
    )
    const professional = row.rows[0]
    if (!professional?.id) return professional
    await client.query(
        `update crm_atendimento.professionals
         set canonical_id = coalesce(canonical_id, id),
             identity_version = coalesce(nullif(identity_version, ''), $2)
         where id = $1`,
        [professional.id, PROFESSIONAL_IDENTITY_VERSION],
    )
    const aliases = [input?.name, input?.alias, professional.name]
        .map((value) => String(value || '').trim())
        .filter(isValidProfessionalIdentityName)
    for (const alias of new Set(aliases)) {
        await client.query(
            `insert into crm_atendimento.professional_aliases(professional_id, alias, alias_key, source, confidence)
             values ($1, $2, $3, 'roster-import', 'confirmed')
             on conflict(professional_id, alias_key) do update set alias = excluded.alias, updated_at = now()`,
            [professional.id, alias, normalizeProfessionalAliasKey(alias)],
        )
    }
    return { ...professional, canonical_id: professional.canonical_id || professional.id, identity_version: PROFESSIONAL_IDENTITY_VERSION }
}

async function readProfessionalIdentityRows(client) {
    const result = await client.query(
        `select p.id, p.canonical_id, p.name, p.role, p.status, p.units, p.roles, p.identity_version, p.email, p.alias,
                canonical.name as canonical_name,
                coalesce(array_agg(distinct pa.alias) filter (where pa.active), '{}') as aliases
         from crm_atendimento.professionals p
         left join crm_atendimento.professionals canonical on canonical.id = coalesce(p.canonical_id, p.id)
         left join crm_atendimento.professional_aliases pa on pa.professional_id = coalesce(p.canonical_id, p.id)
         group by p.id, canonical.id
         order by p.created_at asc`,
    )
    return result.rows
}

async function resolveAttendanceProfessional(client, input, unit, expectedRole, { allowTextResolution = false, allowInactive = false } = {}) {
    const professionalId = String(input?.id || input?.professionalId || '').trim()
    const professionalName = String(input?.name || input?.professionalName || '').trim()
    if (!professionalId && !professionalName) return null
    if (professionalName && !isValidProfessionalIdentityName(professionalName)) throw mutationError('INVALID_PROFESSIONAL')
    const rows = await readProfessionalIdentityRows(client)
    try {
        return resolveProfessionalIdentity({
            professionalId,
            professionalName,
            unit,
            expectedRole,
            allowTextResolution,
            allowInactive,
        }, rows)
    } catch (error) {
        throw mutationError(error?.code || error?.message || 'UNKNOWN_PROFESSIONAL', error?.statusCode || 400)
    }
}

async function resolveHistoricalProfessional(client, name, unit, expectedRole) {
    const rawName = String(name || '').trim()
    if (!rawName || !isValidProfessionalIdentityName(rawName)) return null
    try {
        return await resolveAttendanceProfessional(client, { name: rawName }, unit, expectedRole, {
            allowTextResolution: true,
            allowInactive: true,
        })
    } catch (error) {
        // Historical imports retain the source label even when a name is not a
        // safe identity match.  They never create a professional implicitly.
        if (['UNKNOWN_PROFESSIONAL', 'AMBIGUOUS_PROFESSIONAL', 'PROFESSIONAL_ROLE_MISMATCH', 'PROFESSIONAL_NOT_AVAILABLE_FOR_UNIT'].includes(error?.message)) return null
        throw error
    }
}

function normalizeClientName(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
}

async function upsertClient(client, unitId, input) {
    const name = normalizeClientName(input)
    const nameKey = normalizeText(name)
    if (!name || !nameKey) {
        const err = new Error('CLIENT_REQUIRED')
        err.statusCode = 400
        throw err
    }
    const row = await client.query(
        `insert into crm_atendimento.clients(unit_id, name, name_key)
         values ($1, $2, $3)
         on conflict(unit_id, name_key) do update set updated_at = now()
         returning id, name, name_key`,
        [unitId, name, nameKey],
    )
    return row.rows[0] || { name, nameKey }
}

async function upsertScheduleDay(client, input) {
    if (!input?.date || !input?.unitSlug) return null
    const unit = await upsertUnit(client, { slug: input.unitSlug, name: input.unitName || input.unitSlug })
    const professional = await resolveHistoricalProfessional(client, input.doctorName, unit, 'Injetor')
    const row = await client.query(
        `insert into crm_atendimento.schedule_days(unit_id, service_date, doctor_name, professional_id, source_year)
         values ($1, $2::date, $3, $4, $5)
         on conflict(unit_id, service_date) do update set
            doctor_name = excluded.doctor_name,
            professional_id = excluded.professional_id,
            source_year = excluded.source_year,
            updated_at = now()
         returning id, service_date, doctor_name, professional_id, source_year`,
        [unit.id, input.date, String(input.doctorName || '').trim() || null, professional?.canonicalId || null, Number(input.year) || null],
    )
    return row.rows[0]
}

async function upsertProcedureCode(client, procedureId, code) {
    const safeCode = normalizeCode(code)
    if (!procedureId || !safeCode) return null
    const row = await client.query(
        `insert into crm_atendimento.procedure_price_codes(procedure_id, code, allowed)
         values ($1, $2, true)
         on conflict(procedure_id, code) do update set allowed = true, updated_at = now()
         returning id, procedure_id, code, allowed`,
        [procedureId, safeCode],
    )
    return row.rows[0]
}

async function validateProcedureCode(client, procedureId, code) {
    const safeCode = normalizeCode(code)
    const found = await client.query(
        `select id from crm_atendimento.procedure_price_codes
         where procedure_id = $1 and code = $2 and allowed = true
         limit 1`,
        [procedureId, safeCode],
    )
    return !!found.rows[0]
}

async function audit(client, eventType, actor, attendanceId, payload) {
    await client.query(
        `insert into crm_atendimento.audit_events(event_type, actor, attendance_id, payload)
         values ($1, $2::jsonb, $3, $4::jsonb)`,
        [eventType, JSON.stringify(actor || {}), attendanceId || null, JSON.stringify(payload || {})],
    )
}

async function recordCommercialActionEvent(client, {
    actionId,
    identityId,
    eventType,
    previousStatus = null,
    status,
    traceId,
    recordedBy,
    contactEligibility,
    details = {},
}) {
    await client.query(
        `insert into crm_atendimento.commercial_action_events(
            action_id, identity_id, event_type, previous_status, status, trace_id, recorded_by,
            contact_eligibility_status, contact_eligibility_reason, details)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [
            actionId,
            identityId,
            eventType,
            previousStatus,
            status,
            traceId,
            recordedBy,
            contactEligibility?.status || null,
            contactEligibility?.reason || null,
            JSON.stringify(details || {}),
        ],
    )
}

function mapAttendance(row) {
    if (!row) return null
    return {
        id: row.id,
        unitSlug: row.unit_slug,
        unitName: row.unit_name,
        date: row.service_date instanceof Date ? row.service_date.toISOString().slice(0, 10) : String(row.service_date || '').slice(0, 10),
        clientName: row.client_name,
        procedureName: row.procedure_name,
        code: row.code,
        quantity: Number(row.quantity || 0),
        discount: !!row.discount,
        otherValue: Number(row.other_value || 0),
        roundValue: !!row.round_value,
        value: Number(row.value || 0),
        valueFormulaVersion: row.value_formula_version || ATTENDANCE_VALUE_FORMULA_VERSION,
        revision: Number(row.revision || 1),
        injectorId: row.injector_canonical_id || row.injector_id || null,
        consultantId: row.consultant_canonical_id || row.consultant_id || null,
        injectorName: getCanonicalProfessionalName(row.injector_name || row.injector_source_name || ''),
        consultantName: getCanonicalProfessionalName(row.consultant_name || row.consultant_source_name || ''),
        observation: row.observation || '',
        sourceTab: row.source_tab || null,
        sourceRow: row.source_row || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }
}

function mutationError(message, statusCode = 400) {
    const err = new Error(message)
    err.statusCode = statusCode
    return err
}

function isValidIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false
    const [year, month, day] = String(value).split('-').map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

export function normalizeAttendanceMutation(payload = {}) {
    const unit = normalizeUnit(payload.unitSlug || payload.unitName)
    const date = String(payload.date || '').trim()
    const clientName = normalizeClientName(payload.clientName)
    const procedureName = String(payload.procedureName || '').trim()
    const code = normalizeCode(payload.code)
    const quantity = parseDecimal(payload.quantity, Number.NaN)
    const otherValue = parseCurrency(payload.otherValue, Number.NaN)
    if (!unit.slug) throw mutationError('UNIT_REQUIRED')
    if (!isValidIsoDate(date)) throw mutationError('INVALID_SERVICE_DATE')
    if (!clientName) throw mutationError('CLIENT_REQUIRED')
    if (!procedureName) throw mutationError('PROCEDURE_REQUIRED')
    if (!code) throw mutationError('CODE_REQUIRED')
    if (!Number.isFinite(quantity) || quantity <= 0) throw mutationError('INVALID_QUANTITY')
    if (!Number.isFinite(otherValue) || otherValue < 0) throw mutationError('INVALID_OTHER_VALUE')
    const discount = parseBoolean(payload.discount)
    const roundValue = parseBoolean(payload.roundValue)
    const value = calculateAttendanceValue({ code, quantity, otherValue, discount, roundValue })
    if (!Number.isFinite(value) || value == null) throw mutationError('INVALID_CALCULATED_VALUE')
    if (value < 0) throw mutationError('NEGATIVE_CALCULATED_VALUE')
    return {
        unit,
        date,
        clientName,
        procedureName,
        code,
        quantity,
        discount,
        otherValue,
        roundValue,
        value,
        injectorId: String(payload.injectorId || '').trim() || null,
        consultantId: String(payload.consultantId || '').trim() || null,
        injectorName: String(payload.injectorName || '').trim(),
        consultantName: String(payload.consultantName || '').trim(),
        observation: String(payload.observation || '').trim() || null,
    }
}

export function assertActorCanMutateUnit(actor, unit) {
    if (roleCanManage(actor)) return
    const allowed = normalizeAllowedUnitKeys(actor)
    if (allowed.has(normalizeUnit(unit?.slug || unit?.name || unit).slug)) return
    throw mutationError('UNIT_FORBIDDEN', 403)
}

function expectedRevision(payload) {
    const revision = Number(payload?.revision)
    if (!Number.isInteger(revision) || revision < 1) throw mutationError('REVISION_REQUIRED', 428)
    return revision
}

function normalizeIdempotencyKey(value) {
    const key = String(value || '').trim()
    if (!key) return null
    if (key.length > 128) throw mutationError('INVALID_IDEMPOTENCY_KEY')
    return key
}

function assertManager(actor) {
    if (roleCanManage(actor)) return
    const err = new Error('FORBIDDEN')
    err.statusCode = 403
    throw err
}

function assertCommercialManager(actor) {
    if (roleCanManageCommercial(actor)) return
    const err = new Error('FORBIDDEN')
    err.statusCode = 403
    throw err
}

async function resolveConsultantForCreate(client, input, actor, unit) {
    if (roleCanManage(actor)) {
        return {
            professional: await resolveAttendanceProfessional(client, { id: input.consultantId, name: input.consultantName }, unit, 'Consultor'),
            origin: CONSULTANT_ASSIGNMENT_ORIGIN.MANAGER,
            reason: null,
        }
    }
    if (!isConsultantActor(actor)) {
        return {
            professional: null,
            origin: CONSULTANT_ASSIGNMENT_ORIGIN.UNRESOLVED,
            reason: 'ACTOR_NOT_CONSULTANT',
        }
    }
    const resolved = resolveActorConsultant(actor, unit, await readProfessionalIdentityRows(client))
    return {
        professional: resolved.professional,
        origin: resolved.origin,
        reason: resolved.reason || null,
        match: resolved.match || null,
    }
}

async function resolveScheduledInjectorForUnit(client, unit, date) {
    const scheduled = await client.query(
        `select s.professional_id, s.doctor_name
         from crm_atendimento.schedule_days s
         where s.unit_id = $1 and s.service_date = $2::date
         limit 1`,
        [unit.id, date],
    )
    const schedule = scheduled.rows[0]
    return resolveScheduledInjector({
        professionalId: schedule?.professional_id,
        doctorName: schedule?.doctor_name,
    }, unit, await readProfessionalIdentityRows(client), GERENCIA_APPS_SCRIPT_CONFIG.noServiceLabel)
}

async function resolveInjectorForCreate(client, input, actor, unit) {
    // A consultant cannot choose the professional responsible for the
    // procedure. The persisted Escala assignment is the authoritative source.
    if (isConsultantActor(actor)) return resolveScheduledInjectorForUnit(client, unit, input.date)
    // Other profiles receive the Escala professional as the safe default when
    // the client did not choose one. Managers may still make an explicit,
    // auditable manual correction for an exceptional procedure.
    if (!input.injectorId && !input.injectorName) {
        const scheduled = await resolveScheduledInjectorForUnit(client, unit, input.date)
        if (scheduled.professional) return scheduled
    }
    return {
        professional: await resolveAttendanceProfessional(client, { id: input.injectorId, name: input.injectorName }, unit, 'Injetor'),
        origin: INJECTOR_ASSIGNMENT_ORIGIN.MANAGER,
        reason: null,
    }
}

function effectiveInjectorAuditInput(input, injector) {
    return {
        ...input,
        injectorId: injector?.canonicalId || null,
        injectorName: injector?.canonicalName || '',
    }
}

function effectiveConsultantAuditInput(input, consultant) {
    return {
        ...input,
        consultantId: consultant?.canonicalId || null,
        consultantName: consultant?.canonicalName || '',
    }
}

function mapProfessional(row, includeSensitive = false) {
    const base = {
        id: row.id,
        canonicalId: row.canonical_id || row.id,
        name: row.name,
        role: row.role,
        status: row.status,
        units: row.units,
        shift: row.shift,
        roles: row.roles || [],
        turnos: row.turnos || [],
        backgroundColor: row.background_color || '',
        fontColor: row.font_color || '',
        fontFamily: row.font_family || '',
        fontSize: row.font_size == null ? null : Number(row.font_size),
        fontWeight: row.font_weight || '',
        fontStyle: row.font_style || '',
        alias: row.alias || '',
    }
    if (!includeSensitive) return base
    return {
        ...base,
        phone: row.phone || '',
        email: row.email || '',
        instagram: row.instagram || '',
    }
}

function mergeDistinctText(...lists) {
    return Array.from(new Set(lists.flatMap((list) => Array.isArray(list) ? list : []).map((item) => String(item || '').trim()).filter(Boolean)))
}

function consolidateProfessionalReferences(rows, includeSensitive = false) {
    const byIdentity = new Map()
    for (const raw of rows || []) {
        const name = getCanonicalProfessionalName(raw?.name)
        if (!name) continue
        const key = normalizeText(name)
        const mapped = { ...mapProfessional(raw, includeSensitive), name }
        const current = byIdentity.get(key)
        if (!current) {
            byIdentity.set(key, mapped)
            continue
        }
        // Prefer the complete canonical registration, but retain all assigned roles,
        // units and shifts so an alias never makes a professional disappear from a form.
        const preferred = normalizeText(raw?.name) === key ? mapped : current
        byIdentity.set(key, {
            ...current,
            ...preferred,
            name,
            units: mergeDistinctText(current.units, mapped.units),
            roles: mergeDistinctText(current.roles, mapped.roles),
            turnos: mergeDistinctText(current.turnos, mapped.turnos),
        })
    }
    return Array.from(byIdentity.values()).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
}

function mapManagementItem(row) {
    return {
        id: row.id,
        sourceTab: row.source_tab,
        sourceRow: Number(row.source_row || 0),
        category: row.category,
        label: row.label,
        active: !!row.active,
        sensitive: !!row.sensitive,
        unitSlug: row.unit_slug || '',
        recordDate: row.record_date ? String(row.record_date).slice(0, 10) : '',
        payload: row.payload || {},
        importedAt: row.imported_at,
    }
}

const COMMERCIAL_OFFER_STATUSES = new Set(['draft', 'approved', 'active', 'expired', 'archived'])
const COMMERCIAL_PRICE_QUALIFIERS = new Set(['exact', 'from', 'on_request'])

function commercialOfferError(code, statusCode = 400) {
    const error = new Error(code)
    error.statusCode = statusCode
    return error
}

function normalizeCommercialOfferKey(value) {
    const key = normalizeText(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!key || key.length > 96) throw commercialOfferError('INVALID_OFFER_KEY')
    return key
}

function normalizeCommercialOfferPayload(payload = {}, { requireProcedures = true } = {}) {
    const title = String(payload.title || '').trim()
    if (!title || title.length > 180) throw commercialOfferError('INVALID_OFFER_TITLE')
    const status = String(payload.status || 'draft').trim().toLowerCase()
    if (!COMMERCIAL_OFFER_STATUSES.has(status)) throw commercialOfferError('INVALID_OFFER_STATUS')
    const priceQualifier = String(payload.priceQualifier || 'exact').trim().toLowerCase()
    if (!COMMERCIAL_PRICE_QUALIFIERS.has(priceQualifier)) throw commercialOfferError('INVALID_PRICE_QUALIFIER')
    const priceCents = payload.priceCents == null || payload.priceCents === '' ? null : Number(payload.priceCents)
    if (priceCents != null && (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100000000)) {
        throw commercialOfferError('INVALID_PRICE_CENTS')
    }
    if (priceQualifier !== 'on_request' && priceCents == null) throw commercialOfferError('PRICE_REQUIRED')
    const installments = payload.installmentCount == null || payload.installmentCount === '' ? null : Number(payload.installmentCount)
    const installmentValueCents = payload.installmentValueCents == null || payload.installmentValueCents === '' ? null : Number(payload.installmentValueCents)
    if ((installments == null) !== (installmentValueCents == null)
        || (installments != null && (!Number.isInteger(installments) || installments < 1 || installments > 60
            || !Number.isInteger(installmentValueCents) || installmentValueCents < 0))) {
        throw commercialOfferError('INVALID_INSTALLMENTS')
    }
    const discountPercent = payload.discountPercent == null || payload.discountPercent === '' ? null : Number(payload.discountPercent)
    if (discountPercent != null && (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100)) {
        throw commercialOfferError('INVALID_DISCOUNT_PERCENT')
    }
    const date = (value, code) => {
        if (value == null || value === '') return null
        const string = String(value).slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(string) || Number.isNaN(Date.parse(`${string}T12:00:00Z`))) throw commercialOfferError(code)
        return string
    }
    const validityStart = date(payload.validityStart, 'INVALID_VALIDITY_START')
    const validityEnd = date(payload.validityEnd, 'INVALID_VALIDITY_END')
    if (validityStart && validityEnd && validityStart > validityEnd) throw commercialOfferError('INVALID_VALIDITY_RANGE')
    const procedureIds = Array.isArray(payload.procedures) ? payload.procedures.map((item, index) => {
        const procedureId = String(item?.procedureId || '').trim()
        const quantity = Number(item?.quantity ?? 1)
        const quantityUnit = String(item?.quantityUnit || 'unidade').trim()
        if (!procedureId || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100000 || !quantityUnit || quantityUnit.length > 48) {
            throw commercialOfferError('INVALID_OFFER_PROCEDURE')
        }
        return { procedureId, quantity, quantityUnit, displayOrder: index }
    }) : []
    if (requireProcedures && !procedureIds.length) throw commercialOfferError('OFFER_PROCEDURE_REQUIRED')
    if (new Set(procedureIds.map((item) => item.procedureId)).size !== procedureIds.length) throw commercialOfferError('DUPLICATE_OFFER_PROCEDURE')
    return {
        offerKey: normalizeCommercialOfferKey(payload.offerKey || title),
        title,
        description: String(payload.description || '').trim().slice(0, 2000),
        status,
        priceCents,
        currency: 'BRL',
        priceQualifier,
        installmentCount: installments,
        installmentValueCents,
        discountPercent,
        conditions: String(payload.conditions || '').trim().slice(0, 2000),
        validityStart,
        validityEnd,
        procedures: procedureIds,
    }
}

function mapCommercialOffer(row) {
    const procedures = Array.isArray(row.procedures) ? row.procedures : []
    const context = {
        schemaVersion: 'crm-commercial-offer/v1',
        offerId: row.id,
        offerKey: row.offer_key,
        revision: Number(row.revision || 1),
        unitSlug: row.unit_slug,
        title: row.title,
        description: row.description || '',
        priceCents: row.price_cents == null ? null : Number(row.price_cents),
        currency: row.currency || 'BRL',
        priceQualifier: row.price_qualifier,
        installmentCount: row.installment_count == null ? null : Number(row.installment_count),
        installmentValueCents: row.installment_value_cents == null ? null : Number(row.installment_value_cents),
        discountPercent: row.discount_percent == null ? null : Number(row.discount_percent),
        conditions: row.conditions || '',
        validityStart: row.validity_start ? String(row.validity_start).slice(0, 10) : null,
        validityEnd: row.validity_end ? String(row.validity_end).slice(0, 10) : null,
        procedures: procedures.map((item) => ({
            id: item.id,
            name: item.name,
            aliases: Array.isArray(item.aliases) ? item.aliases : [],
            quantity: Number(item.quantity || 1),
            quantityUnit: item.quantity_unit || 'unidade',
        })),
    }
    return {
        ...context,
        status: row.status,
        approvedBy: row.approved_by || null,
        approvedAt: row.approved_at || null,
        updatedAt: row.updated_at || null,
        contextHash: stableConfigHash(context),
    }
}

function commercialOfferSelect(whereSql = '') {
    return `select o.*, u.slug as unit_slug,
        coalesce(json_agg(json_build_object(
            'id', p.id, 'name', p.name, 'aliases', p.aliases,
            'quantity', op.quantity, 'quantity_unit', op.quantity_unit
        ) order by op.display_order, p.name) filter (where p.id is not null), '[]'::json) as procedures
        from crm_atendimento.commercial_offers o
        join crm_atendimento.units u on u.id = o.unit_id
        left join crm_atendimento.commercial_offer_procedures op on op.offer_id = o.id
        left join crm_atendimento.procedures p on p.id = op.procedure_id
        ${whereSql}
        group by o.id, u.slug
        order by o.updated_at desc`
}

function normalizeGoalMonth(value) {
    const raw = String(value || '').trim()
    if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw.slice(0, 7)}-01`
    const err = new Error('INVALID_GOAL_MONTH')
    err.statusCode = 400
    throw err
}

function mapMonthlyGoal(row) {
    const goalMonth = row.goal_month instanceof Date ? row.goal_month.toISOString().slice(0, 7) : String(row.goal_month || '').slice(0, 7)
    return {
        id: row.id,
        unitSlug: row.unit_slug,
        unitName: row.unit_name,
        month: goalMonth,
        value: Number(row.value || 0),
        updatedAt: row.updated_at,
        updatedBy: row.updated_by || '',
        sourceTab: row.source_tab || '',
        sourceRow: row.source_row == null ? null : Number(row.source_row),
        sourceCol: row.source_col == null ? null : Number(row.source_col),
    }
}

function mapMonthlyGoalLevel(row) {
    const goalMonth = row.goal_month instanceof Date ? row.goal_month.toISOString().slice(0, 7) : String(row.goal_month || '').slice(0, 7)
    return {
        id: row.id,
        unitSlug: row.unit_slug,
        unitName: row.unit_name,
        month: goalMonth,
        levelKey: row.level_key,
        levelLabel: row.level_label,
        value: Number(row.value || 0),
        updatedAt: row.updated_at,
        updatedBy: row.updated_by || '',
        sourceTab: row.source_tab || '',
        sourceRow: row.source_row == null ? null : Number(row.source_row),
        sourceCol: row.source_col == null ? null : Number(row.source_col),
    }
}

const MONTHLY_GOAL_LEVELS = [
    { key: 'first', label: '1ª META' },
    { key: 'second', label: '2ª META' },
    { key: 'third', label: '3ª META' },
    { key: 'super', label: 'SUPER META' },
]

function normalizeGoalLevelValue(value, label) {
    const numeric = Number(value || 0)
    if (!Number.isFinite(numeric) || numeric < 0) {
        const err = new Error(`INVALID_GOAL_VALUE:${label}`)
        err.statusCode = 400
        throw err
    }
    return Math.round(numeric * 100) / 100
}

function mapGoalTableRow(row) {
    return {
        id: row.id,
        sourceTab: row.source_tab,
        sourceRow: Number(row.source_row || 0),
        year: Number(row.year || 0),
        unitSlug: row.unit_slug,
        unitName: row.unit_name,
        label: row.label,
        values: Array.isArray(row.values) ? row.values : [],
        formulas: Array.isArray(row.formulas) ? row.formulas : [],
        importedAt: row.imported_at,
    }
}

async function listGoalTables(pgPool, query, actor) {
    const where = ['1=1']
    const params = []
    applyManagementItemUnitFilter(where, params, actor, 'unit_slug')
    const year = Number(query?.year || 0)
    if (Number.isInteger(year) && year > 0) {
        params.push(year)
        where.push(`year = $${params.length}`)
    }
    const tab = String(query?.tab || '').trim()
    if (tab) {
        params.push(tab)
        where.push(`source_tab = $${params.length}`)
    }
    const rows = await pgPool.query(
        `select *
         from crm_atendimento.goal_table_rows
         where ${where.join(' and ')}
         order by year desc, source_tab, unit_name, source_row`,
        params,
    )
    const groups = new Map()
    for (const row of rows.rows.map(mapGoalTableRow)) {
        const key = `${row.sourceTab}:${row.unitSlug}`
        const table = groups.get(key) || {
            sourceTab: row.sourceTab,
            year: row.year,
            unitSlug: row.unitSlug,
            unitName: row.unitName,
            title: `${row.sourceTab} · ${row.unitName}`,
            columns: [],
            rows: [],
        }
        if (!table.columns.length && normalizeText(row.label) === 'periodo') {
            table.columns = row.values.map((value) => String(getEffectiveGoalTableValue(value) ?? '').replace(/\s+/g, ' ').trim())
        }
        table.rows.push(row)
        groups.set(key, table)
    }
    return { tables: Array.from(groups.values()) }
}

function getEffectiveGoalTableValue(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (Object.prototype.hasOwnProperty.call(value, 'result')) return value.result
        if (Object.prototype.hasOwnProperty.call(value, 'formattedValue')) return value.formattedValue
        if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value
    }
    return value
}

async function listMonthlyGoals(pgPool, query, actor) {
    const where = ['1=1']
    const params = []
    const month = String(query?.month || '').trim()
    if (month) {
        params.push(normalizeGoalMonth(month))
        where.push(`g.goal_month = $${params.length}::date`)
    }
    applyActorUnitFilter(where, params, actor)
    const unit = String(query?.unit || '').trim()
    if (unit && unit !== 'all') {
        params.push(normalizeUnit(unit).slug)
        where.push(`u.slug = $${params.length}`)
    }
    const goals = await pgPool.query(
        `select g.*, u.slug as unit_slug, u.name as unit_name
         from crm_atendimento.monthly_unit_goals g
         join crm_atendimento.units u on u.id = g.unit_id
         where ${where.join(' and ')}
         order by g.goal_month desc, u.name`,
        params,
    )
    const goalLevels = await pgPool.query(
        `select gl.*, u.slug as unit_slug, u.name as unit_name
         from crm_atendimento.monthly_unit_goal_levels gl
         join crm_atendimento.units u on u.id = gl.unit_id
         where ${where.join(' and ').replaceAll('g.', 'gl.')}
         order by gl.goal_month desc, u.name,
            case gl.level_key
                when 'first' then 1
                when 'second' then 2
                when 'third' then 3
                when 'super' then 4
                else 9
            end`,
        params,
    )
    const units = await pgPool.query(`select slug, name from crm_atendimento.units order by name`)
    return {
        goals: goals.rows.map(mapMonthlyGoal),
        goalLevels: goalLevels.rows.map(mapMonthlyGoalLevel),
        units: units.rows
            .filter((row) => actorCanReadUnit(actor, row.slug))
            .map((row) => ({ slug: row.slug, name: row.name })),
    }
}

const ATTENDANCE_SELECT = `
    select a.*, u.slug as unit_slug, u.name as unit_name, p.name as procedure_name,
           coalesce(inj_canonical.id, inj.id) as injector_canonical_id,
           coalesce(con_canonical.id, con.id) as consultant_canonical_id,
           coalesce(inj_canonical.name, inj.name) as injector_name,
           coalesce(con_canonical.name, con.name) as consultant_name
    from crm_atendimento.attendances a
    join crm_atendimento.units u on u.id = a.unit_id
    join crm_atendimento.procedures p on p.id = a.procedure_id
    left join crm_atendimento.professionals inj on inj.id = a.injector_id
    left join crm_atendimento.professionals con on con.id = a.consultant_id
    left join crm_atendimento.professionals inj_canonical on inj_canonical.id = coalesce(inj.canonical_id, inj.id)
    left join crm_atendimento.professionals con_canonical on con_canonical.id = coalesce(con.canonical_id, con.id)
`

const COMMERCIAL_ACTION_STATUSES = new Set(['open', 'contacted', 'responded', 'scheduled', 'won_sale', 'returned', 'closed', 'cancelled'])
const COMMERCIAL_ACTION_TYPES = new Set(['contact', 'follow_up', 'appointment', 'relationship'])
const COMMERCIAL_ACTIVE_ACTION_STATUSES = ['open', 'contacted', 'responded', 'scheduled']
const COMMERCIAL_CONTACT_CHANNEL = 'whatsapp'
const COMMERCIAL_CADENCE_STATUSES = new Set(['draft', 'approved', 'disabled'])
const COMMERCIAL_POLICY_VERSION_SQL = `md5(concat_ws('|',
    active_contact_cooldown_days::text,
    return_risk_thresholds::text,
    commercial_contact_writes_enabled::text,
    commercial_contact_canary_identity_ids::text,
    extract(epoch from updated_at)::text
))`
const LEGACY_COMMERCIAL_POLICY_VERSION_SQL = `md5(concat_ws('|',
    active_contact_cooldown_days::text,
    return_risk_thresholds::text,
    'false',
    '{}',
    extract(epoch from updated_at)::text
))`

function commercialAsOf(value) {
    const raw = String(value || '').trim()
    if (!raw) return new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const error = new Error('INVALID_COMMERCIAL_AS_OF')
        error.statusCode = 400
        throw error
    }
    return raw
}

function commercialUnit(value) {
    const raw = String(value || '').trim()
    return !raw || raw === 'all' ? '' : normalizeUnit(raw).slug
}

function commercialUnitScope(actor) {
    const role = String(actor?.role || '').trim().toUpperCase()
    // ADMIN is the established cross-unit break-glass role. Pages retains that
    // provenance as isGlobalAdmin after normalizing its public role to GESTOR.
    // Clientes otherwise honours a declared scope even for GESTOR; omitting
    // allowedUnits retains legacy global-manager compatibility, while an
    // explicit empty or malformed declared value intentionally denies every
    // unit. `allowedUnitsDeclared` distinguishes old actors without a claim
    // from a token that expressly supplied an invalid claim; direct store
    // callers with an `allowedUnits` property receive the same fail-closed
    // behavior even when they did not populate that parser marker.
    if (actor?.isGlobalAdmin === true || role === 'ADMIN') return null
    if (!Array.isArray(actor?.allowedUnits)) {
        // The signed-actor parser always carries an `allowedUnits` property so
        // its shape is stable, but marks whether the claim was present on the
        // token separately.  Treat that explicit false marker as an omitted
        // claim; only malformed direct callers without the marker retain the
        // fail-closed empty-scope behavior.
        const scopeWasDeclared = actor?.allowedUnitsDeclared === true ||
            (actor?.allowedUnitsDeclared === undefined &&
                Object.prototype.hasOwnProperty.call(actor || {}, 'allowedUnits'))
        return scopeWasDeclared ? [] : null
    }
    return [...normalizeAllowedUnitKeys(actor)].sort()
}

function commercialScopeError(code = 'COMMERCIAL_UNIT_FORBIDDEN') {
    const error = new Error(code)
    error.statusCode = 403
    return error
}

function clinicalCadenceApprovalRequired() {
    const error = new Error('CLINICAL_CADENCE_APPROVAL_REQUIRED')
    error.statusCode = 403
    return error
}

function commercialUnitSlugsForQuery(actor, requestedUnit) {
    const requested = commercialUnit(requestedUnit)
    const allowed = commercialUnitScope(actor)
    if (allowed === null) return requested ? [requested] : null
    if (!allowed.length) throw commercialScopeError()
    if (requested) {
        if (!allowed.includes(requested)) throw commercialScopeError()
        return [requested]
    }
    return allowed
}

function assertCommercialUnitInScope(actor, unitSlug) {
    const allowed = commercialUnitScope(actor)
    if (allowed === null) return
    const normalized = commercialUnit(unitSlug)
    if (!normalized || !allowed.includes(normalized)) throw commercialScopeError()
}

function assertCommercialGlobalScope(actor) {
    if (commercialUnitScope(actor) !== null) throw commercialScopeError('COMMERCIAL_GLOBAL_SCOPE_REQUIRED')
}

function commercialUnitRowsForActor(rows, actor) {
    const allowed = commercialUnitScope(actor)
    if (allowed === null) return rows || []
    if (!allowed.length) throw commercialScopeError()
    return (rows || []).filter((row) => allowed.includes(commercialUnit(row?.slug || row?.name || row)))
}

function professionalMatchesCommercialUnitScope(row, actor) {
    const allowed = commercialUnitScope(actor)
    if (allowed === null) return true
    if (!allowed.length) return false
    const units = Array.isArray(row?.units) ? row.units : []
    return units.some((unit) => allowed.includes(commercialUnit(unit)))
}

function commercialThresholds(value) {
    const thresholds = Array.isArray(value) ? value.map(Number) : []
    if (thresholds.length !== 3 || thresholds.some((item) => !Number.isInteger(item) || item < 30 || item > 730)
        || thresholds.some((item, index) => index > 0 && item <= thresholds[index - 1])) {
        const error = new Error('INVALID_RETURN_RISK_THRESHOLDS')
        error.statusCode = 400
        throw error
    }
    return thresholds
}

function mapCommercialAction(row) {
    return {
        id: row.id,
        identityId: row.identity_id,
        unitSlug: row.unit_slug || '',
        unitName: row.unit_name || '',
        segmentKey: row.segment_key,
        actionType: row.action_type,
        contactChannel: row.contact_channel || COMMERCIAL_CONTACT_CHANNEL,
        status: row.status,
        owner: row.owner || '',
        dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
        notes: row.notes || '',
        outcomeNotes: row.outcome_notes || '',
        createdBy: row.created_by || '',
        completedAt: row.completed_at || null,
        contactedAt: row.contacted_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }
}

function mapCommercialTimelineEntry(row) {
    return {
        id: row.event_id,
        type: row.event_type,
        occurredOn: row.occurred_on ? String(row.occurred_on).slice(0, 10) : null,
        title: row.title || '',
        detail: row.detail || '',
        unitName: row.unit_name || '',
        source: row.source_label || '',
        amount: row.amount == null ? null : Number(row.amount),
        status: row.event_status || 'confirmed',
    }
}

async function queryCommercialTimeline(pgPool, { identityId, asOf, unitSlugs, limit }) {
    const result = await pgPool.query(
        `with attendance_members as (
             select distinct gm.source_id::uuid as client_id
             from crm_atendimento.global_client_identity_members gm
             where gm.identity_id = $1 and gm.source_type = 'attendance_client'
         ), attendance_events as (
             select distinct concat('attendance:', a.id::text) as event_id,
                    'attendance'::text as event_type,
                    a.service_date::text as occurred_on,
                    p.name::text as title,
                    ''::text as detail,
                    u.name::text as unit_name,
                    'Atendimento'::text as source_label,
                    null::numeric as amount,
                    'confirmed'::text as event_status
             from attendance_members am
             join crm_atendimento.attendance_client_links acl on acl.client_id = am.client_id
             join crm_atendimento.attendances a on a.id = acl.attendance_id
             join crm_atendimento.procedures p on p.id = a.procedure_id
             join crm_atendimento.units u on u.id = a.unit_id
             where a.deleted_at is null
               and a.service_date <= $2::date
               and ($3::text[] is null or u.slug = any($3::text[]))
         ), sale_members as (
             select distinct gm.source_id::uuid as customer_id
             from crm_atendimento.global_client_identity_members gm
             where gm.identity_id = $1 and gm.source_type = 'caixa_customer'
         ), sale_events as (
             select distinct concat('sale:', s.id::text) as event_id,
                    'sale'::text as event_type,
                    s.occurred_on::text as occurred_on,
                    'Compra registrada'::text as title,
                    coalesce(nullif(trim(s.raw_service), ''), 'Item não classificado')::text as detail,
                    u.name::text as unit_name,
                    'Caixa'::text as source_label,
                    s.total::numeric as amount,
                    'confirmed'::text as event_status
             from sale_members sm
             join crm_caixa.sales s on s.customer_id = sm.customer_id
             join crm_atendimento.units u on u.id = s.unit_id
             where s.occurred_on <= $2::date
               and ($3::text[] is null or u.slug = any($3::text[]))
         )
         select * from attendance_events
         union all
         select * from sale_events
         order by occurred_on desc, event_id desc
         limit $4`,
        [identityId, asOf, unitSlugs, limit],
    )
    return result.rows.map(mapCommercialTimelineEntry)
}

async function assertCommercialIdentitySource(pgPool) {
    const tables = await pgPool.query(
        `select to_regclass('crm_atendimento.global_client_identities') as identities,
                to_regclass('crm_atendimento.global_client_identity_members') as members,
                to_regclass('crm_atendimento.attendance_client_links') as attendance_links,
                to_regclass('crm_caixa.sales') as sales`,
    )
    const row = tables.rows[0] || {}
    if (!row.identities || !row.members || !row.attendance_links || !row.sales) {
        const error = new Error('CLIENT_COMMERCIAL_SOURCE_NOT_READY')
        error.statusCode = 409
        throw error
    }
}

async function readCommercialPolicy(pgPool) {
    let result
    let contactWriteControlsReady = true
    try {
        result = await pgPool.query(
            `select active_contact_cooldown_days, return_risk_thresholds,
                    commercial_contact_writes_enabled, commercial_contact_canary_identity_ids,
                    updated_by, updated_at,
                    ${COMMERCIAL_POLICY_VERSION_SQL} as policy_version
             from crm_atendimento.commercial_policy_config where singleton = true`,
        )
    } catch (error) {
        // A backend may be deployed before the explicit, guarded rollout
        // migration. Reads remain available, but every contact write stays
        // fail-closed until the two rollout columns are present.
        if (String(error?.code || '') !== '42703') throw error
        contactWriteControlsReady = false
        result = await pgPool.query(
            `select active_contact_cooldown_days, return_risk_thresholds,
                    false as commercial_contact_writes_enabled,
                    '{}'::uuid[] as commercial_contact_canary_identity_ids,
                    updated_by, updated_at,
                    ${LEGACY_COMMERCIAL_POLICY_VERSION_SQL} as policy_version
             from crm_atendimento.commercial_policy_config where singleton = true`,
        )
    }
    const row = result.rows[0] || {}
    return {
        activeContactCooldownDays: Number(row.active_contact_cooldown_days || 30),
        returnRiskThresholds: Array.isArray(row.return_risk_thresholds) ? row.return_risk_thresholds.map(Number) : [90, 180, 365],
        commercialContactWritesEnabled: row.commercial_contact_writes_enabled === true,
        commercialContactCanaryIdentityIds: Array.isArray(row.commercial_contact_canary_identity_ids)
            ? row.commercial_contact_canary_identity_ids.map(String).filter(Boolean)
            : [],
        commercialContactWriteControlsReady: contactWriteControlsReady,
        policyVersion: row.policy_version || '',
        updatedBy: row.updated_by || '',
        updatedAt: row.updated_at || null,
    }
}

function commercialContactError(code, statusCode = 409) {
    const error = new Error(code)
    error.statusCode = statusCode
    return error
}

function emptyCommercialContactEligibility(reason, {
    controlsReady = false,
    contactWriteControlsReady = false,
    harmoniaChecked = false,
    hasPhone = false,
} = {}) {
    return {
        channel: COMMERCIAL_CONTACT_CHANNEL,
        status: 'review_required',
        contactAllowed: false,
        reason,
        controlsReady,
        contactWriteControlsReady,
        harmoniaChecked,
        hasPhone,
        optOutRecorded: false,
        permissionStatus: 'unknown',
        evidenceSource: '',
        evidenceReference: '',
        expiresAt: null,
        permissionRevision: 0,
        recordedBy: '',
        updatedAt: null,
    }
}

function permissionFromCommercialContactRow(row) {
    if (!row) return null
    return {
        status: row.status,
        source: row.evidence_source,
        evidenceReference: row.evidence_reference,
        expiresAt: row.expires_at || null,
    }
}

function commercialContactPermissionFields(row) {
    return {
        permissionStatus: row?.status || 'unknown',
        evidenceSource: row?.evidence_source || '',
        evidenceReference: row?.evidence_reference || '',
        expiresAt: row?.expires_at || null,
        permissionRevision: Number.isInteger(Number(row?.revision)) && Number(row.revision) >= 0
            ? Number(row.revision)
            : 0,
        recordedBy: row?.recorded_by || '',
        updatedAt: row?.updated_at || null,
    }
}

async function readCommercialContactAvailability(pgPool) {
    const result = await pgPool.query(
        `select to_regclass('crm_atendimento.commercial_contact_permissions') as permissions,
                to_regclass('crm_atendimento.commercial_contact_permission_events') as permission_events,
                to_regclass('crm_atendimento.commercial_action_events') as action_events,
                to_regclass('harmonia.contacts') as harmonia_contacts,
                to_regclass('crm_caixa.customers') as caixa_customers,
                to_regclass('crm_atendimento.app_client_registrations') as app_registrations,
                to_regclass('crm_atendimento.supplemental_lead_profiles') as lead_profiles,
                exists(select 1 from information_schema.columns
                    where table_schema = 'crm_atendimento' and table_name = 'commercial_contact_permission_events'
                      and column_name = 'trace_id') as permission_event_trace_id,
                exists(select 1 from pg_trigger
                    where tgrelid = to_regclass('crm_atendimento.commercial_contact_permission_events')
                      and tgname = 'commercial_contact_permission_events_immutable'
                      and tgenabled = 'O'
                      and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_ledger_mutation()')
                      and (tgtype::integer & 8) <> 0 and (tgtype::integer & 16) <> 0) as permission_events_immutable,
                exists(select 1 from pg_trigger
                    where tgrelid = to_regclass('crm_atendimento.commercial_contact_permission_events')
                      and tgname = 'commercial_contact_permission_events_no_truncate'
                      and tgenabled = 'O'
                      and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_ledger_mutation()')
                      and (tgtype::integer & 32) <> 0) as permission_events_no_truncate,
                exists(select 1 from pg_trigger
                    where tgrelid = to_regclass('crm_atendimento.commercial_action_events')
                      and tgname = 'commercial_action_events_immutable'
                      and tgenabled = 'O'
                      and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_ledger_mutation()')
                      and (tgtype::integer & 8) <> 0 and (tgtype::integer & 16) <> 0) as action_events_immutable,
                exists(select 1 from pg_trigger
                    where tgrelid = to_regclass('crm_atendimento.commercial_action_events')
                      and tgname = 'commercial_action_events_no_truncate'
                      and tgenabled = 'O'
                      and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_ledger_mutation()')
                      and (tgtype::integer & 32) <> 0) as action_events_no_truncate,
                exists(select 1 from information_schema.columns
                    where table_schema = 'crm_atendimento' and table_name = 'commercial_actions'
                      and column_name = 'contact_channel') as action_channel,
                exists(select 1 from information_schema.columns
                    where table_schema = 'crm_atendimento' and table_name = 'commercial_actions'
                      and column_name = 'contacted_at') as action_contacted_at,
                exists(select 1 from information_schema.columns
                    where table_schema = 'crm_atendimento' and table_name = 'commercial_policy_config'
                      and column_name = 'commercial_contact_writes_enabled') as rollout_enabled,
                exists(select 1 from information_schema.columns
                    where table_schema = 'crm_atendimento' and table_name = 'commercial_policy_config'
                      and column_name = 'commercial_contact_canary_identity_ids') as rollout_canary`,
    )
    const row = result.rows[0] || {}
    const commercialLedgerReady = !!row.permission_events && !!row.action_events && !!row.permission_event_trace_id &&
        !!row.permission_events_immutable && !!row.permission_events_no_truncate &&
        !!row.action_events_immutable && !!row.action_events_no_truncate
    return {
        permissions: !!row.permissions,
        permissionEvents: !!row.permission_events,
        actionEvents: !!row.action_events,
        harmoniaContacts: !!row.harmonia_contacts,
        caixaCustomers: !!row.caixa_customers,
        appRegistrations: !!row.app_registrations,
        leadProfiles: !!row.lead_profiles,
        permissionEventTraceId: !!row.permission_event_trace_id,
        permissionEventsImmutable: !!row.permission_events_immutable,
        permissionEventsNoTruncate: !!row.permission_events_no_truncate,
        actionEventsImmutable: !!row.action_events_immutable,
        actionEventsNoTruncate: !!row.action_events_no_truncate,
        commercialLedgerReady,
        actionChannel: !!row.action_channel,
        actionContactedAt: !!row.action_contacted_at,
        rolloutConfig: !!row.rollout_enabled && !!row.rollout_canary,
        controlsReady: !!row.permissions && !!row.permission_events && !!row.action_channel && commercialLedgerReady,
        contactWriteControlsReady: !!row.permissions && !!row.permission_events && !!row.action_channel && commercialLedgerReady &&
            !!row.action_contacted_at && !!row.rollout_enabled && !!row.rollout_canary,
    }
}

async function queryCommercialIdentityPhoneKeys(pgPool, identityIds, availability, unitSlugs = null) {
    const phonesByIdentity = new Map(identityIds.map((id) => [id, new Set()]))
    if (!identityIds.length) return phonesByIdentity
    const addRows = (rows) => {
        for (const row of rows) {
            const identityId = String(row.identity_id || '').trim()
            const phoneKey = String(row.phone_key || '').replace(/\D/g, '')
            if (phonesByIdentity.has(identityId) && phoneKey) phonesByIdentity.get(identityId).add(phoneKey)
        }
    }
    if (availability.caixaCustomers) {
        const result = await pgPool.query(
            `select member.identity_id::text as identity_id, customer.phone_key
             from crm_atendimento.global_client_identity_members member
             join crm_caixa.customers customer on customer.id = member.source_id::uuid
             where member.identity_id = any($1::uuid[]) and member.source_type = 'caixa_customer'
               and ($2::text[] is null or exists (
                    select 1 from crm_caixa.sales sale
                    join crm_atendimento.units unit on unit.id = sale.unit_id
                    where sale.customer_id = customer.id and unit.slug = any($2::text[])
               ))`,
            [identityIds, unitSlugs],
        )
        addRows(result.rows)
    }
    if (availability.appRegistrations) {
        const result = await pgPool.query(
            `select member.identity_id::text as identity_id, phone.phone_key
             from crm_atendimento.global_client_identity_members member
             join crm_atendimento.app_client_registrations app on app.source_client_id = member.source_id
             cross join lateral jsonb_array_elements_text(coalesce(app.phone_keys, '[]'::jsonb)) as phone(phone_key)
             where member.identity_id = any($1::uuid[]) and member.source_type = 'app_registration'
               and ($2::text[] is null or exists (
                    select 1 from jsonb_array_elements_text(coalesce(app.unit_slugs, '[]'::jsonb)) as scope(slug)
                    where scope.slug = any($2::text[])
               ))`,
            [identityIds, unitSlugs],
        )
        addRows(result.rows)
    }
    if (availability.leadProfiles) {
        const result = await pgPool.query(
            `select member.identity_id::text as identity_id, phone.phone_key
             from crm_atendimento.global_client_identity_members member
             join crm_atendimento.supplemental_lead_profiles lead on lead.source_profile_id = member.source_id
             cross join lateral jsonb_array_elements_text(coalesce(lead.phone_keys, '[]'::jsonb)) as phone(phone_key)
             where member.identity_id = any($1::uuid[]) and member.source_type = 'lead_profile'
               and ($2::text[] is null or exists (
                    select 1 from jsonb_array_elements_text(coalesce(lead.unit_slugs, '[]'::jsonb)) as scope(slug)
                    where scope.slug = any($2::text[])
               ))`,
            [identityIds, unitSlugs],
        )
        addRows(result.rows)
    }
    return phonesByIdentity
}

async function queryCommercialContactEligibility(pgPool, identityIds, { lockHarmonia = false, unitSlugs = null } = {}) {
    const ids = [...new Set((identityIds || []).map((value) => String(value || '').trim()).filter(Boolean))]
    const availability = await readCommercialContactAvailability(pgPool)
    const contactWriteControlsReady = availability.contactWriteControlsReady
    const result = new Map()
    if (!ids.length) return result
    if (!availability.controlsReady) {
        for (const id of ids) result.set(id, emptyCommercialContactEligibility('commercial_contact_controls_not_ready', {
            contactWriteControlsReady,
        }))
        return result
    }
    const [permissions, phonesByIdentity] = await Promise.all([
        pgPool.query(
            `select identity_id::text as identity_id, channel, status, evidence_source, evidence_reference,
                    expires_at, revision, recorded_by, updated_at
             from crm_atendimento.commercial_contact_permissions
             where channel = $1 and identity_id = any($2::uuid[])`,
            [COMMERCIAL_CONTACT_CHANNEL, ids],
        ),
        queryCommercialIdentityPhoneKeys(pgPool, ids, availability, unitSlugs),
    ])
    const permissionByIdentity = new Map(permissions.rows.map((row) => [String(row.identity_id), row]))
    const allPhones = [...new Set([...phonesByIdentity.values()].flatMap((phones) => [...phones]))]
    const optOutPhoneKeys = new Set()
    if (availability.harmoniaContacts && allPhones.length) {
        if (lockHarmonia) {
            // Harmonia acquires this same namespace before it creates or marks
            // an opt-out. Lock every number in deterministic order so a first
            // STOP serializes with, and is visible to, the eligibility recheck
            // before `contacted` is recorded.
            for (const phoneKey of [...allPhones].sort()) await lockContactPhone(pgPool, phoneKey)
        }
        const contacts = await pgPool.query(
            `select phone_raw, opted_out_at from harmonia.contacts
             where phone_raw = any($1::text[])${lockHarmonia ? ' for update' : ''}`,
            [allPhones],
        )
        contacts.rows
            .filter((row) => row.opted_out_at != null)
            .forEach((row) => optOutPhoneKeys.add(String(row.phone_raw || '').replace(/\D/g, '')))
    }
    for (const id of ids) {
        const phoneKeys = phonesByIdentity.get(id) || new Set()
        const permissionRow = permissionByIdentity.get(id) || null
        if (!phoneKeys.size) {
            result.set(id, { ...emptyCommercialContactEligibility('identity_phone_not_confirmed', {
                controlsReady: true,
                contactWriteControlsReady,
                harmoniaChecked: availability.harmoniaContacts,
                hasPhone: false,
            }), ...commercialContactPermissionFields(permissionRow) })
            continue
        }
        if (!availability.harmoniaContacts) {
            result.set(id, { ...emptyCommercialContactEligibility('harmonia_contact_source_unavailable', {
                controlsReady: true,
                contactWriteControlsReady,
                harmoniaChecked: false,
                hasPhone: true,
            }), ...commercialContactPermissionFields(permissionRow) })
            continue
        }
        const harmoniaOptOut = [...phoneKeys].some((phoneKey) => optOutPhoneKeys.has(phoneKey))
        const eligibility = resolveCommercialContactEligibility({
            commercialPermission: permissionFromCommercialContactRow(permissionRow),
            harmoniaContact: harmoniaOptOut ? { opted_out_at: 'recorded' } : null,
        })
        result.set(id, {
            channel: COMMERCIAL_CONTACT_CHANNEL,
            status: eligibility.status,
            contactAllowed: eligibility.contactAllowed,
            reason: eligibility.reason,
            controlsReady: true,
            contactWriteControlsReady,
            harmoniaChecked: true,
            hasPhone: true,
            optOutRecorded: harmoniaOptOut,
            ...commercialContactPermissionFields(permissionRow),
        })
    }
    return result
}

async function readCommercialContactEligibility(pgPool, identityId, options = {}) {
    const id = String(identityId || '').trim()
    const values = await queryCommercialContactEligibility(pgPool, id ? [id] : [], options)
    return values.get(id) || emptyCommercialContactEligibility('commercial_identity_required')
}

async function acquireCommercialContactIdentityLock(client, identityId) {
    await client.query(
        `select pg_advisory_xact_lock(hashtext($1))`,
        [`crm_atendimento.commercial-contact:${String(identityId || '').trim()}`],
    )
}

async function withCommercialContactTransaction(pgPool, operation) {
    // The identity and shared-phone advisory locks serialize the contact gate.
    // Read committed is deliberate: when this transaction waits on a lock, the
    // eligibility queries that run after it must see a STOP or revocation that
    // committed while it waited, rather than retain an earlier SSI snapshot.
    return withPgTransaction(pgPool, async (client) => {
        await client.query('set transaction isolation level read committed')
        // Source reconciliation and identity review hold this lock before
        // changing membership.  Commercial writes join it before taking a
        // per-identity lock, so consent or an action cannot race a rebind.
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
        return operation(client)
    })
}

async function assertCommercialContactControls(pgPool) {
    const availability = await readCommercialContactAvailability(pgPool)
    if (!availability.controlsReady) throw commercialContactError('COMMERCIAL_CONTACT_CONTROLS_NOT_READY')
    return availability
}

async function assertCommercialContactCooldownControls(pgPool) {
    const availability = await assertCommercialContactControls(pgPool)
    if (!availability.actionContactedAt || !availability.rolloutConfig) {
        throw commercialContactError('COMMERCIAL_CONTACT_COOLDOWN_CONTROLS_NOT_READY')
    }
    return availability
}

async function assertCommercialContactWriteRollout(client, identityId) {
    const result = await client.query(
        `select commercial_contact_writes_enabled, commercial_contact_canary_identity_ids
         from crm_atendimento.commercial_policy_config where singleton = true for share`,
    )
    const row = result.rows[0] || {}
    if (row.commercial_contact_writes_enabled !== true) {
        throw commercialContactError('COMMERCIAL_CONTACT_ROLLOUT_DISABLED')
    }
    const identities = Array.isArray(row.commercial_contact_canary_identity_ids)
        ? row.commercial_contact_canary_identity_ids.map(String)
        : []
    if (!identities.includes(String(identityId || '').trim())) {
        throw commercialContactError('COMMERCIAL_CONTACT_CANARY_REQUIRED')
    }
}

async function assertCommercialContactCooldown(client, { identityId, actionId, cooldownDays }) {
    const result = await client.query(
        `select id, contacted_at
         from crm_atendimento.commercial_actions
         where identity_id = $1 and ($2::uuid is null or id <> $2::uuid)
           and contacted_at >= now() - ($3::int * interval '1 day')
         order by contacted_at desc
         limit 1`,
        [identityId, actionId, cooldownDays],
    )
    if (result.rows[0]?.id) throw commercialContactError('COMMERCIAL_CONTACT_COOLDOWN_ACTIVE')
}

async function assertCommercialIdentityUnitMembership(client, { identityId, unitSlug, availability }) {
    const normalizedUnit = commercialUnit(unitSlug)
    if (!normalizedUnit) return
    const membershipChecks = [
        client.query(
            `select exists(
                select 1
                  from crm_atendimento.global_client_identity_members member
                  join crm_atendimento.attendance_client_links attendance_link on attendance_link.client_id = member.source_id::uuid
                  join crm_atendimento.attendances attendance on attendance.id = attendance_link.attendance_id
                  join crm_atendimento.units unit on unit.id = attendance.unit_id
                 where member.identity_id = $1::uuid and member.source_type = 'attendance_client'
                   and attendance.deleted_at is null and unit.slug = $2
            ) as matched`,
            [identityId, normalizedUnit],
        ),
        client.query(
            `select exists(
                select 1
                  from crm_atendimento.global_client_identity_members member
                  join crm_caixa.sales sale on sale.customer_id = member.source_id::uuid
                  join crm_atendimento.units unit on unit.id = sale.unit_id
                 where member.identity_id = $1::uuid and member.source_type = 'caixa_customer'
                   and unit.slug = $2
            ) as matched`,
            [identityId, normalizedUnit],
        ),
    ]
    if (availability?.appRegistrations) {
        membershipChecks.push(client.query(
            `select exists(
                select 1
                  from crm_atendimento.global_client_identity_members member
                  join crm_atendimento.app_client_registrations registration on registration.source_client_id = member.source_id
                  join lateral jsonb_array_elements_text(coalesce(registration.unit_slugs, '[]'::jsonb)) scope(slug) on true
                 where member.identity_id = $1::uuid and member.source_type = 'app_registration'
                   and scope.slug = $2
            ) as matched`,
            [identityId, normalizedUnit],
        ))
    }
    if (availability?.leadProfiles) {
        membershipChecks.push(client.query(
            `select exists(
                select 1
                  from crm_atendimento.global_client_identity_members member
                  join crm_atendimento.supplemental_lead_profiles lead on lead.source_profile_id = member.source_id
                  join lateral jsonb_array_elements_text(coalesce(lead.unit_slugs, '[]'::jsonb)) scope(slug) on true
                 where member.identity_id = $1::uuid and member.source_type = 'lead_profile'
                   and scope.slug = $2
            ) as matched`,
            [identityId, normalizedUnit],
        ))
    }
    const matches = await Promise.all(membershipChecks)
    if (!matches.some((result) => result.rows[0]?.matched === true)) {
        throw commercialScopeError('COMMERCIAL_IDENTITY_UNIT_FORBIDDEN')
    }
}

async function resolveCommercialActionOwner(client, value, unit) {
    const raw = String(value || '').trim()
    if (!raw) return null
    if (raw.length > 180 || !isValidProfessionalIdentityName(raw)) {
        throw commercialContactError('INVALID_COMMERCIAL_ACTION_OWNER', 400)
    }
    const professional = await resolveAttendanceProfessional(client, { name: raw }, unit, null, {
        allowTextResolution: true,
        allowInactive: false,
    })
    return professional?.canonicalName || professional?.name || null
}

function commercialCanaryIdentityIds(value) {
    if (value === undefined) return undefined
    if (!Array.isArray(value)) throw commercialContactError('INVALID_COMMERCIAL_CONTACT_CANARY', 400)
    const ids = [...new Set(value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))]
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (ids.length > 100 || ids.some((id) => !uuid.test(id))) {
        throw commercialContactError('INVALID_COMMERCIAL_CONTACT_CANARY', 400)
    }
    return ids
}

async function assertCommercialCanaryIdentities(client, identityIds) {
    const ids = [...new Set((Array.isArray(identityIds) ? identityIds : []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))]
    if (!ids.length) return
    const result = await client.query(
        `select gi.id::text as identity_id
         from crm_atendimento.global_client_identities gi
         where gi.id = any($1::uuid[])
           and exists (
               select 1
                 from crm_atendimento.global_client_identity_members member
                where member.identity_id = gi.id
           )`,
        [ids],
    )
    const found = new Set(result.rows.map((row) => String(row.identity_id || '').trim().toLowerCase()).filter(Boolean))
    if (found.size !== ids.length || ids.some((id) => !found.has(id))) {
        throw commercialContactError('INVALID_COMMERCIAL_CONTACT_CANARY', 400)
    }
}

function commercialContactWritesEnabled(value) {
    if (value === undefined) return undefined
    if (typeof value !== 'boolean') throw commercialContactError('INVALID_COMMERCIAL_CONTACT_ROLLOUT', 400)
    return value
}

function commercialExpectedPolicyVersion(value) {
    if (value === undefined || value === null || String(value).trim() === '') return ''
    const version = String(value).trim().toLowerCase()
    if (!/^[a-f0-9]{32}$/.test(version)) throw commercialContactError('INVALID_COMMERCIAL_POLICY_VERSION', 400)
    return version
}

function commercialExpectedPermissionRevision(value) {
    if (value === undefined || value === null || String(value).trim() === '') return null
    const revision = Number(value)
    if (!Number.isInteger(revision) || revision < 0 || revision > 2_147_483_647) {
        throw commercialContactError('INVALID_COMMERCIAL_CONTACT_PERMISSION_REVISION', 400)
    }
    return revision
}

function commercialTimelineLimit(value) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 1) return 50
    return Math.min(parsed, 100)
}

async function queryCommercialProfiles(pgPool, { asOf, unitSlugs, thresholds, identityId = null }) {
    // Customer 360 is an identity-detail read.  Keep the legacy all-profile
    // query available for compatibility, but constrain every source CTE when
    // a detail identity is requested.  Without this bound the route computes
    // every customer and hydrates every contact-control row before selecting
    // one profile, which can block the isolated read-only runtime.
    const targetIdentityId = String(identityId || '').trim()
    const result = await pgPool.query(
        `with identities as (
            select gi.id as identity_id, gi.canonical_name, gi.source_types
            from crm_atendimento.global_client_identities gi
            where ($4::text = '' or gi.id::text = $4)
              and exists (select 1 from crm_atendimento.global_client_identity_members gm where gm.identity_id = gi.id)
         ), attendance_members as (
            -- Keep the physical canonical member here.  A retired S and its
            -- survivor T are intentionally one identity component, but ACL
            -- rows remain stored against S so coalescing to T would erase S's
            -- attendance history from commercial coverage and segments.
            select distinct gm.identity_id, gm.source_id::uuid as client_id
            from crm_atendimento.global_client_identity_members gm
            join crm_atendimento.canonical_clients cc on cc.id = gm.source_id::uuid
            where gm.source_type = 'attendance_client'
              and ($4::text = '' or gm.identity_id::text = $4)
         ), attendance_core as (
            select am.identity_id, a.id, a.service_date, p.name as procedure_name, u.name as unit_name
            from attendance_members am
            join crm_atendimento.attendance_client_links acl on acl.client_id = am.client_id
            join crm_atendimento.attendances a on a.id = acl.attendance_id
            join crm_atendimento.procedures p on p.id = a.procedure_id
            join crm_atendimento.units u on u.id = a.unit_id
            where a.deleted_at is null and a.service_date <= $1::date
              and ($2::text[] is null or u.slug = any($2::text[]))
         ), attendance_aggregate as (
            select identity_id, max(service_date)::text as last_attendance,
                count(distinct service_date)::int as visit_count, count(*)::int as procedure_count,
                array_agg(distinct procedure_name order by procedure_name) as completed_procedures,
                array_agg(distinct unit_name order by unit_name) as attendance_units
            from attendance_core group by identity_id
         ), future_attendance as (
            select am.identity_id, count(*)::int as future_attendance_count
            from attendance_members am
            join crm_atendimento.attendance_client_links acl on acl.client_id = am.client_id
            join crm_atendimento.attendances a on a.id = acl.attendance_id
            join crm_atendimento.units u on u.id = a.unit_id
            where a.deleted_at is null and a.service_date > $1::date
              and ($2::text[] is null or u.slug = any($2::text[]))
            group by am.identity_id
         ), sale_members as (
            select distinct gm.identity_id, gm.source_id::uuid as customer_id
            from crm_atendimento.global_client_identity_members gm
            where gm.source_type = 'caixa_customer'
              and ($4::text = '' or gm.identity_id::text = $4)
         ), sale_core as (
            select sm.identity_id, s.id, s.occurred_on, s.total, s.phone_raw, u.name as unit_name
            from sale_members sm
            join crm_caixa.sales s on s.customer_id = sm.customer_id
            join crm_atendimento.units u on u.id = s.unit_id
            where s.occurred_on <= $1::date
              and ($2::text[] is null or u.slug = any($2::text[]))
         ), sales_aggregate as (
            select identity_id, count(*)::int as sale_count, coalesce(sum(total), 0) as lifetime_sales,
                coalesce(sum(total) filter (where occurred_on >= ($1::date - interval '12 months')), 0) as sales_12m,
                array_agg(distinct unit_name order by unit_name) as sales_units,
                (array_agg(phone_raw order by occurred_on desc) filter (where nullif(trim(phone_raw), '') is not null))[1] as phone
            from sale_core group by identity_id
         ), purchased_procedures as (
            select sc.identity_id, array_agg(distinct p.name order by p.name) as purchased_procedures
            from sale_core sc
            join crm_caixa.sale_items si on si.sale_id = sc.id and si.mapping_status = 'mapped' and si.procedure_id is not null
            join crm_atendimento.procedures p on p.id = si.procedure_id
            group by sc.identity_id
         ), pending_items as (
            select sc.identity_id, count(*)::int as pending_sale_items
            from sale_core sc
            join crm_caixa.sale_items si on si.sale_id = sc.id and si.mapping_status = 'pending'
            group by sc.identity_id
         ), active_actions as (
            select action.identity_id, count(*)::int as active_action_count, max(action.created_at) as last_action_at
            from crm_atendimento.commercial_actions action
            left join crm_atendimento.units action_unit on action_unit.id = action.unit_id
            where action.status = any($3::text[])
              and ($4::text = '' or action.identity_id::text = $4)
              and ($2::text[] is null or action_unit.slug = any($2::text[]))
            group by action.identity_id
         )
         select i.identity_id, i.canonical_name, i.source_types,
             a.last_attendance, a.visit_count, a.procedure_count, a.completed_procedures, a.attendance_units,
             f.future_attendance_count, s.sale_count, s.lifetime_sales, s.sales_12m, s.sales_units, s.phone,
             p.purchased_procedures, pending.pending_sale_items, actions.active_action_count, actions.last_action_at
         from identities i
         left join attendance_aggregate a on a.identity_id = i.identity_id
         left join future_attendance f on f.identity_id = i.identity_id
         left join sales_aggregate s on s.identity_id = i.identity_id
         left join purchased_procedures p on p.identity_id = i.identity_id
         left join pending_items pending on pending.identity_id = i.identity_id
         left join active_actions actions on actions.identity_id = i.identity_id
         where $2::text[] is null or a.identity_id is not null or s.identity_id is not null
         order by i.canonical_name`,
        [asOf, unitSlugs, COMMERCIAL_ACTIVE_ACTION_STATUSES, targetIdentityId],
    )
    const rowsByIdentity = new Map(result.rows.map((row) => [String(row.identity_id), row]))
    const profiles = segmentCommercialProfiles(result.rows.map(commercialProfileRowInput), { asOf, thresholds }).map((profile) => {
        const row = rowsByIdentity.get(profile.identityId)
        return {
            ...profile,
            activeActionCount: Number(row?.active_action_count || 0),
            lastActionAt: row?.last_action_at || null,
        }
    })
    const eligibilityByIdentity = await queryCommercialContactEligibility(pgPool, profiles.map((profile) => profile.identityId), { unitSlugs })
    return profiles.map((profile) => ({
        ...profile,
        contactEligibility: eligibilityByIdentity.get(profile.identityId)
            || emptyCommercialContactEligibility('commercial_contact_controls_not_ready'),
    }))
}

function commercialProfileRowInput(row) {
    return {
        ...row,
        identityId: row.identity_id,
        name: row.canonical_name,
        sourceTypes: row.source_types,
        lastAttendance: row.last_attendance,
        visitCount: row.visit_count,
        procedureCount: row.procedure_count,
        completedProcedures: row.completed_procedures,
        futureAttendanceCount: row.future_attendance_count,
        saleCount: row.sale_count,
        lifetimeSales: row.lifetime_sales,
        sales12m: row.sales_12m,
        units: [...(row.attendance_units || []), ...(row.sales_units || [])],
        purchasedProcedures: row.purchased_procedures,
        pendingSaleItems: row.pending_sale_items,
    }
}

function filterCommercialProfiles(profiles, query) {
    const segment = String(query?.segment || '').trim()
    const priority = String(query?.priority || '').trim()
    const search = normalizeText(query?.q || query?.search || '')
    return profiles.filter((profile) => {
        if (segment && !profile.segments.some((item) => item.key === segment)) return false
        if (priority && profile.priority !== priority) return false
        // A list/search endpoint must not become an oracle for raw contact
        // details.  Profiles are found by their commercial identity only.
        if (search && !normalizeText(profile.name).includes(search)) return false
        return true
    })
}

const COMMERCIAL_PROFILE_SORT_COLUMNS = Object.freeze({
    priority: 'priority_rank',
    recency: 'recency_days',
    lifetime_sales: 'lifetime_sales',
    visits: 'visit_count',
    sales: 'sale_count',
    last_attendance: 'last_attendance',
    name: 'canonical_name',
})

function commercialProfileSort(query) {
    const requested = String(query?.sort || 'priority').trim().toLowerCase()
    const key = Object.hasOwn(COMMERCIAL_PROFILE_SORT_COLUMNS, requested) ? requested : 'priority'
    const direction = String(query?.direction || 'desc').trim().toLowerCase() === 'asc' ? 'asc' : 'desc'
    const column = COMMERCIAL_PROFILE_SORT_COLUMNS[key]
    return { key, direction, orderBy: `${column} ${direction} nulls ${direction === 'asc' ? 'first' : 'last'}, identity_id asc` }
}

/**
 * The legacy commercial read deliberately remains available for compatibility
 * with callers that do not opt into pagination. The Clientes console opts into
 * this bounded path: aggregation, percentile benchmarks, filtering, ordering,
 * total count and page slicing all happen in PostgreSQL before identity
 * contact eligibility is hydrated for the visible page.
 */
async function queryCommercialProfilesServerPage(pgPool, { asOf, unitSlugs, thresholds, query }) {
    const [returnRisk, longAbsence, veryLongAbsence] = [...thresholds].map(Number).sort((left, right) => left - right)
    const limit = sanitizeLimit(query?.limit, 50, 100)
    const offset = sanitizeOffset(query?.offset, 0)
    const search = normalizeText(query?.q || query?.search || '')
    const segment = String(query?.segment || '').trim()
    const priority = String(query?.priority || '').trim()
    const { key: sort, direction, orderBy } = commercialProfileSort(query)
    const result = await pgPool.query(
        `with identities as (
            select gi.id as identity_id, gi.canonical_name, gi.source_types
            from crm_atendimento.global_client_identities gi
            where exists (select 1 from crm_atendimento.global_client_identity_members gm where gm.identity_id = gi.id)
         ), attendance_members as (
            select distinct gm.identity_id, gm.source_id::uuid as client_id
            from crm_atendimento.global_client_identity_members gm
            join crm_atendimento.canonical_clients cc on cc.id = gm.source_id::uuid
            where gm.source_type = 'attendance_client'
         ), attendance_core as (
            select am.identity_id, a.id, a.service_date, p.name as procedure_name, u.name as unit_name
            from attendance_members am
            join crm_atendimento.attendance_client_links acl on acl.client_id = am.client_id
            join crm_atendimento.attendances a on a.id = acl.attendance_id
            join crm_atendimento.procedures p on p.id = a.procedure_id
            join crm_atendimento.units u on u.id = a.unit_id
            where a.deleted_at is null and a.service_date <= $1::date
              and ($2::text[] is null or u.slug = any($2::text[]))
         ), attendance_aggregate as (
            select identity_id, max(service_date)::text as last_attendance,
                count(distinct service_date)::int as visit_count, count(*)::int as procedure_count,
                array_agg(distinct procedure_name order by procedure_name) as completed_procedures,
                array_agg(distinct unit_name order by unit_name) as attendance_units
            from attendance_core group by identity_id
         ), future_attendance as (
            select am.identity_id, count(*)::int as future_attendance_count
            from attendance_members am
            join crm_atendimento.attendance_client_links acl on acl.client_id = am.client_id
            join crm_atendimento.attendances a on a.id = acl.attendance_id
            join crm_atendimento.units u on u.id = a.unit_id
            where a.deleted_at is null and a.service_date > $1::date
              and ($2::text[] is null or u.slug = any($2::text[]))
            group by am.identity_id
         ), sale_members as (
            select distinct gm.identity_id, gm.source_id::uuid as customer_id
            from crm_atendimento.global_client_identity_members gm
            where gm.source_type = 'caixa_customer'
         ), sale_core as (
            select sm.identity_id, s.id, s.occurred_on, s.total, s.phone_raw, u.name as unit_name
            from sale_members sm
            join crm_caixa.sales s on s.customer_id = sm.customer_id
            join crm_atendimento.units u on u.id = s.unit_id
            where s.occurred_on <= $1::date
              and ($2::text[] is null or u.slug = any($2::text[]))
         ), sales_aggregate as (
            select identity_id, count(*)::int as sale_count, coalesce(sum(total), 0) as lifetime_sales,
                coalesce(sum(total) filter (where occurred_on >= ($1::date - interval '12 months')), 0) as sales_12m,
                array_agg(distinct unit_name order by unit_name) as sales_units,
                (array_agg(phone_raw order by occurred_on desc) filter (where nullif(trim(phone_raw), '') is not null))[1] as phone
            from sale_core group by identity_id
         ), purchased_procedures as (
            select sc.identity_id, array_agg(distinct p.name order by p.name) as purchased_procedures
            from sale_core sc
            join crm_caixa.sale_items si on si.sale_id = sc.id and si.mapping_status = 'mapped' and si.procedure_id is not null
            join crm_atendimento.procedures p on p.id = si.procedure_id
            group by sc.identity_id
         ), pending_items as (
            select sc.identity_id, count(*)::int as pending_sale_items
            from sale_core sc
            join crm_caixa.sale_items si on si.sale_id = sc.id and si.mapping_status = 'pending'
            group by sc.identity_id
         ), active_actions as (
            select action.identity_id, count(*)::int as active_action_count, max(action.created_at) as last_action_at
            from crm_atendimento.commercial_actions action
            left join crm_atendimento.units action_unit on action_unit.id = action.unit_id
            where action.status = any($3::text[])
              and ($2::text[] is null or action_unit.slug = any($2::text[]))
            group by action.identity_id
         ), raw_profiles as (
            select i.identity_id, i.canonical_name, i.source_types,
                a.last_attendance, coalesce(a.visit_count, 0)::int as visit_count,
                coalesce(a.procedure_count, 0)::int as procedure_count, a.completed_procedures, a.attendance_units,
                coalesce(f.future_attendance_count, 0)::int as future_attendance_count,
                coalesce(s.sale_count, 0)::int as sale_count, coalesce(s.lifetime_sales, 0)::numeric as lifetime_sales,
                coalesce(s.sales_12m, 0)::numeric as sales_12m, s.sales_units, s.phone,
                p.purchased_procedures, coalesce(pending.pending_sale_items, 0)::int as pending_sale_items,
                coalesce(actions.active_action_count, 0)::int as active_action_count, actions.last_action_at
            from identities i
            left join attendance_aggregate a on a.identity_id = i.identity_id
            left join future_attendance f on f.identity_id = i.identity_id
            left join sales_aggregate s on s.identity_id = i.identity_id
            left join purchased_procedures p on p.identity_id = i.identity_id
            left join pending_items pending on pending.identity_id = i.identity_id
            left join active_actions actions on actions.identity_id = i.identity_id
            where $2::text[] is null or a.identity_id is not null or s.identity_id is not null
         ), benchmarks as (
            select coalesce(percentile_disc(0.75) within group (order by lifetime_sales) filter (where lifetime_sales > 0), 0)::numeric as sales_p75,
                   coalesce(percentile_disc(0.75) within group (order by visit_count) filter (where visit_count > 0), 0)::numeric as visits_p75
            from raw_profiles
         ), scored as (
            select raw.*, benchmarks.sales_p75, benchmarks.visits_p75,
                case when raw.last_attendance is null then null else ($1::date - raw.last_attendance::date) end::int as recency_days
            from raw_profiles raw cross join benchmarks
         ), classified as (
            select scored.*,
                (recency_days is not null and recency_days >= $9) as return_at_risk,
                (last_attendance is null and sale_count > 0) as no_recorded_attendance,
                (recency_days is not null and recency_days >= $9 and sales_p75 > 0 and lifetime_sales >= sales_p75) as high_value_inactive,
                (visits_p75 > 0 and visit_count >= visits_p75 and (recency_days is null or recency_days < $10)) as frequent,
                (sales_p75 > 0 and visits_p75 > 0 and lifetime_sales >= sales_p75 and visit_count >= visits_p75 and (recency_days is null or recency_days < $10)) as balanced_vip,
                (recency_days is not null and recency_days >= $9 and sale_count <= 1 and visit_count <= 1 and last_attendance is not null) as first_return,
                (recency_days is not null and recency_days >= $9 and lifetime_sales > 0 and visit_count > 0) as reactivation_potential
            from scored
         ), ranked as (
            select classified.*,
                case when (recency_days is not null and recency_days >= $11)
                          or high_value_inactive
                          or (reactivation_potential and sales_p75 > 0 and lifetime_sales >= sales_p75) then 3
                     when (recency_days is not null and recency_days >= $10) or reactivation_potential then 2
                     else 1 end as priority_rank,
                array_remove(array[
                    case when return_at_risk then 'return_at_risk' end,
                    case when no_recorded_attendance then 'no_recorded_attendance' end,
                    case when high_value_inactive then 'high_value_inactive' end,
                    case when frequent then 'frequent' end,
                    case when balanced_vip then 'balanced_vip' end,
                    case when first_return then 'first_return' end,
                    case when reactivation_potential then 'reactivation_potential' end
                ], null) as segment_keys
            from classified
         ), filtered as (
            select ranked.*
            from ranked
            where ($4::text = '' or position($4::text in lower(ranked.canonical_name)) > 0
                   or position($4::text in translate(lower(ranked.canonical_name),
                       'áàâãäåéèêëíìîïóòôõöúùûüçñ',
                       'aaaaaaeeeeiiiiooooouuuucn')) > 0)
              and ($5::text = '' or $5::text = any(ranked.segment_keys))
              and ($6::text = '' or ranked.priority_rank = case $6::text when 'high' then 3 when 'medium' then 2 when 'normal' then 1 else 0 end)
         ), stats as (
            select count(*)::int as filtered_total,
                count(*) filter (where return_at_risk)::int as return_at_risk_total,
                count(*) filter (where high_value_inactive)::int as high_value_inactive_total,
                count(*) filter (where frequent)::int as frequent_total,
                count(*) filter (where balanced_vip)::int as balanced_vip_total,
                count(*) filter (where reactivation_potential)::int as reactivation_potential_total,
                count(*) filter (where jsonb_array_length(coalesce(source_types, '[]'::jsonb)) >= 2)::int as confirmed_multi_source_total,
                count(*) filter (where jsonb_array_length(coalesce(source_types, '[]'::jsonb)) < 2)::int as unresolved_single_source_total,
                coalesce(sum(lifetime_sales), 0)::numeric as lifetime_sales_total,
                coalesce(sum(sale_count), 0)::int as sale_count_total
            from filtered
         ), page as (
            select filtered.*
            from filtered
            order by ${orderBy}
            limit $7 offset $8
         )
         select page.*, stats.*
         from stats
         left join page on true`,
        [asOf, unitSlugs, COMMERCIAL_ACTIVE_ACTION_STATUSES, search, segment, priority, limit, offset, returnRisk, longAbsence, veryLongAbsence],
    )
    const rows = result.rows || []
    const first = rows[0] || {}
    const profileRows = rows.filter((row) => row.identity_id)
    const benchmarks = {
        salesP75: Number(first.sales_p75 || 0),
        visitsP75: Number(first.visits_p75 || 0),
    }
    const byIdentity = new Map(profileRows.map((row) => [String(row.identity_id), row]))
    const profiles = segmentCommercialProfiles(profileRows.map(commercialProfileRowInput), { asOf, thresholds, benchmarks }).map((profile) => ({
        ...profile,
        activeActionCount: Number(byIdentity.get(profile.identityId)?.active_action_count || 0),
        lastActionAt: byIdentity.get(profile.identityId)?.last_action_at || null,
    }))
    const eligibilityByIdentity = await queryCommercialContactEligibility(pgPool, profiles.map((profile) => profile.identityId), { unitSlugs })
    const hydratedProfiles = profiles.map((profile) => ({
        ...profile,
        contactEligibility: eligibilityByIdentity.get(profile.identityId)
            || emptyCommercialContactEligibility('commercial_contact_controls_not_ready'),
    }))
    const contactEligibility = hydratedProfiles.reduce((summary, profile) => {
        const status = profile.contactEligibility?.status || 'review_required'
        if (status === 'eligible') summary.eligible += 1
        else if (status === 'blocked') summary.blocked += 1
        else summary.reviewRequired += 1
        summary.controlsReady = summary.controlsReady && !!profile.contactEligibility?.controlsReady
        summary.contactWriteControlsReady = summary.contactWriteControlsReady && !!profile.contactEligibility?.contactWriteControlsReady
        return summary
    }, {
        eligible: 0,
        blocked: 0,
        reviewRequired: 0,
        controlsReady: profiles.length > 0,
        contactWriteControlsReady: profiles.length > 0,
        scope: 'page',
    })
    const total = Number(first.filtered_total || 0)
    const saleCountTotal = Number(first.sale_count_total || 0)
    const lifetimeSalesTotal = Number(first.lifetime_sales_total || 0)
    return {
        profiles: hydratedProfiles,
        total,
        limit,
        offset,
        summary: {
            profiles: total,
            returnAtRisk: Number(first.return_at_risk_total || 0),
            highValueInactive: Number(first.high_value_inactive_total || 0),
            frequent: Number(first.frequent_total || 0),
            balancedVip: Number(first.balanced_vip_total || 0),
            reactivationPotential: Number(first.reactivation_potential_total || 0),
            averageTicket: saleCountTotal ? Math.round((lifetimeSalesTotal / saleCountTotal) * 100) / 100 : 0,
        },
        coverage: {
            identitiesVisible: total,
            confirmedMultiSourceIdentities: Number(first.confirmed_multi_source_total || 0),
            unresolvedSingleSourceIdentities: Number(first.unresolved_single_source_total || 0),
        },
        contactEligibility,
        pagination: {
            mode: 'sql',
            sort,
            direction,
            hasPrevious: offset > 0,
            hasNext: offset + profiles.length < total,
        },
    }
}

function minimizeCommercialProfile(profile) {
    const { phone, email, ...safeProfile } = profile || {}
    return safeProfile
}

function commercialPolicyForActor(policy, actor) {
    if (commercialUnitScope(actor) === null) return policy
    // The canary is identity-scoped and globally configured.  It is not a
    // unit-level grant, so do not disclose its identity set to a scoped user.
    return {
        ...policy,
        commercialContactWritesEnabled: false,
        commercialContactCanaryIdentityIds: [],
    }
}

const COMMERCIAL_REVIEW_PII_KEY = /(?:phone|telefone|email|e-mail|birth|nascimento|dob|cpf|document)/i

function minimizeCommercialReviewValue(value) {
    if (Array.isArray(value)) return value.map(minimizeCommercialReviewValue)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !COMMERCIAL_REVIEW_PII_KEY.test(key))
        .map(([key, nested]) => [key, minimizeCommercialReviewValue(nested)]))
}

async function queryCommercialActionMetrics(pgPool, availability, unitSlugs) {
    if (!availability?.actionContactedAt) {
        const legacy = await pgPool.query(
            `select count(*)::int as actions
             from crm_atendimento.commercial_actions action
             left join crm_atendimento.units unit on unit.id = action.unit_id
             where $1::text[] is null or unit.slug = any($1::text[])`,
            [unitSlugs],
        )
        return {
            actions: Number(legacy.rows[0]?.actions || 0),
            contactedActions: 0,
            recoveredSalesClients: 0,
            clinicalReturnClients: 0,
        }
    }
    const metrics = await pgPool.query(
        `with scoped_actions as (
            select action.id, action.identity_id, action.contacted_at::date as action_date
            from crm_atendimento.commercial_actions action
            left join crm_atendimento.units unit on unit.id = action.unit_id
            where $1::text[] is null or unit.slug = any($1::text[])
         ), actions as (
            select * from scoped_actions where action_date is not null
         ), action_sales as (
            select distinct action.id, action.identity_id
            from actions action
            join crm_atendimento.global_client_identity_members gm on gm.identity_id = action.identity_id and gm.source_type = 'caixa_customer'
            join crm_caixa.sales sale on sale.customer_id = gm.source_id::uuid and sale.occurred_on >= action.action_date
            join crm_atendimento.units unit on unit.id = sale.unit_id
            where $1::text[] is null or unit.slug = any($1::text[])
         ), action_returns as (
            select distinct action.id, action.identity_id
            from actions action
            join crm_atendimento.global_client_identity_members gm on gm.identity_id = action.identity_id and gm.source_type = 'attendance_client'
            join crm_atendimento.attendance_client_links acl on acl.client_id = gm.source_id::uuid
            join crm_atendimento.attendances attendance on attendance.id = acl.attendance_id
            join crm_atendimento.units unit on unit.id = attendance.unit_id
            where attendance.deleted_at is null and attendance.service_date >= action.action_date
              and ($1::text[] is null or unit.slug = any($1::text[]))
         )
         select (select count(*)::int from scoped_actions) as actions,
                (select count(*)::int from actions) as contacted_actions,
                (select count(distinct identity_id)::int from action_sales) as recovered_sales_clients,
                (select count(distinct identity_id)::int from action_returns) as clinical_return_clients`,
        [unitSlugs],
    )
    const row = metrics.rows[0] || {}
    return {
        actions: Number(row.actions || 0),
        contactedActions: Number(row.contacted_actions || 0),
        recoveredSalesClients: Number(row.recovered_sales_clients || 0),
        clinicalReturnClients: Number(row.clinical_return_clients || 0),
    }
}

async function assertIdentityReviewSource(pgPool) {
    const result = await pgPool.query(`select to_regclass('crm_atendimento.client_merge_suggestions') as merges,
        to_regclass('crm_atendimento.client_caixa_links') as attendance_caixa,
        to_regclass('crm_atendimento.app_client_registrations') as app,
        to_regclass('crm_atendimento.supplemental_lead_profiles') as leads`)
    if (!Object.values(result.rows[0] || {}).every(Boolean)) {
        const error = new Error('CLIENT_IDENTITY_REVIEW_SOURCE_NOT_READY')
        error.statusCode = 409
        throw error
    }
}

async function identityReviewWorkflowStatus(pgPool) {
    const availability = await pgPool.query(`select
        to_regclass('crm_atendimento.schema_migrations') as registry,
        to_regclass('crm_atendimento.identity_review_decisions') as decisions,
        to_regclass('crm_atendimento.identity_materialization_runs') as runs,
        to_regclass('crm_atendimento.identity_member_history') as member_history,
        to_regclass('crm_atendimento.identity_lineage') as lineage,
        to_regclass('crm_atendimento.identity_source_link_history') as source_link_history,
        exists(select 1 from information_schema.columns where table_schema='crm_atendimento'
            and table_name='identity_materialization_runs' and column_name='event_order') as run_event_order,
        exists(select 1 from information_schema.columns where table_schema='crm_atendimento'
            and table_name='identity_member_history' and column_name='event_order') as member_history_event_order,
        exists(select 1 from information_schema.columns where table_schema='crm_atendimento'
            and table_name='identity_review_decisions' and column_name='resulting_status') as decision_resulting_status,
        exists(select 1 from information_schema.columns where table_schema='crm_atendimento'
            and table_name='identity_review_decisions' and column_name='event_order') as decision_event_order,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.identity_review_decisions')
            and tgname='identity_review_decisions_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_identity_review_ledger_mutation()')
            and (tgtype::integer & 8) <> 0 and (tgtype::integer & 16) <> 0) as decision_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.identity_member_history')
            and tgname='identity_member_history_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_identity_review_ledger_mutation()')
            and (tgtype::integer & 8) <> 0 and (tgtype::integer & 16) <> 0) as member_history_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.identity_lineage')
            and tgname='identity_lineage_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_identity_review_ledger_mutation()')
            and (tgtype::integer & 8) <> 0 and (tgtype::integer & 16) <> 0) as lineage_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.identity_source_link_history')
            and tgname='identity_source_link_history_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_identity_review_ledger_mutation()')
            and (tgtype::integer & 8) <> 0 and (tgtype::integer & 16) <> 0) as source_link_history_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.identity_review_decisions')
            and tgname='identity_review_decisions_no_truncate' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_identity_review_ledger_mutation()')
            and (tgtype::integer & 32) <> 0) as decision_no_truncate,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.identity_member_history')
            and tgname='identity_member_history_no_truncate' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_identity_review_ledger_mutation()')
            and (tgtype::integer & 32) <> 0) as member_history_no_truncate,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.identity_lineage')
            and tgname='identity_lineage_no_truncate' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_identity_review_ledger_mutation()')
            and (tgtype::integer & 32) <> 0) as lineage_no_truncate,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.identity_source_link_history')
            and tgname='identity_source_link_history_no_truncate' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_identity_review_ledger_mutation()')
            and (tgtype::integer & 32) <> 0) as source_link_history_no_truncate`)
    const row = availability.rows[0] || {}
    if (!row.registry || !row.decisions || !row.runs || !row.member_history || !row.lineage || !row.source_link_history
        || !row.run_event_order
        || !row.member_history_event_order || !row.decision_resulting_status || !row.decision_event_order
        || !row.decision_immutable || !row.member_history_immutable || !row.lineage_immutable || !row.source_link_history_immutable
        || !row.decision_no_truncate || !row.member_history_no_truncate || !row.lineage_no_truncate || !row.source_link_history_no_truncate) return { ready: false }
    const migration = await pgPool.query(`select id from crm_atendimento.schema_migrations
        where id = any($1::text[]) and rolled_back_at is null`, [IDENTITY_REVIEW_WORKFLOW_MIGRATION_IDS])
    return { ready: migration.rows.length === IDENTITY_REVIEW_WORKFLOW_MIGRATION_IDS.length }
}

async function assertIdentityReviewWorkflowReady(pgPool) {
    const status = await identityReviewWorkflowStatus(pgPool)
    if (status.ready) return status
    const error = new Error('IDENTITY_REVIEW_WORKFLOW_NOT_READY')
    error.statusCode = 409
    throw error
}

function reviewAttendanceUnitSource(clientReference) {
    return `select unit.slug as unit_slug
        from crm_atendimento.attendance_client_links attendance_link
        join crm_atendimento.attendances attendance on attendance.id = attendance_link.attendance_id
        join crm_atendimento.units unit on unit.id = attendance.unit_id
        where attendance_link.client_id = ${clientReference}::uuid and attendance.deleted_at is null`
}

function reviewCaixaUnitSource(customerReference) {
    return `select unit.slug as unit_slug
        from crm_caixa.sales sale
        join crm_atendimento.units unit on unit.id = sale.unit_id
        where sale.customer_id = ${customerReference}::uuid`
}

function reviewStoredUnitSource(jsonColumn) {
    // Imported profile sources persist canonical unit slugs.  Unknown strings
    // deliberately do not resolve to a unit, keeping scoped review fail-closed.
    return `select unit.slug as unit_slug
        from crm_atendimento.units unit
        join lateral jsonb_array_elements_text(coalesce(${jsonColumn}, '[]'::jsonb)) source(slug)
          on unit.slug = source.slug`
}

function reviewUnitSlugs(...sources) {
    return `coalesce(array(
        select distinct scoped_units.unit_slug
        from (${sources.join(' union ')}) scoped_units
        where nullif(trim(scoped_units.unit_slug), '') is not null
        order by scoped_units.unit_slug
    ), '{}'::text[])`
}

function normalizeReviewUnitSlugs(value) {
    return [...new Set((Array.isArray(value) ? value : [])
        .map((unit) => commercialUnit(unit))
        .filter(Boolean))].sort()
}

async function queryCommercialReviewComponentUnitEvidence(client, candidate) {
    const result = await client.query(
        `with affected_components as (
            select distinct member.identity_id
              from crm_atendimento.global_client_identity_members member
             where (member.source_type = $1 and member.source_id = $2)
                or (member.source_type = $3 and member.source_id = $4)
         ), component_members as (
            select member.identity_id, member.source_type, member.source_id
              from crm_atendimento.global_client_identity_members member
              join affected_components component on component.identity_id = member.identity_id
         ), member_unit_evidence as (
            select member.source_type, member.source_id, unit.slug as unit_slug
              from component_members member
              join crm_atendimento.attendance_client_links attendance_link on attendance_link.client_id = member.source_id::uuid
              join crm_atendimento.attendances attendance on attendance.id = attendance_link.attendance_id
              join crm_atendimento.units unit on unit.id = attendance.unit_id
             where member.source_type = 'attendance_client' and attendance.deleted_at is null
            union all
            select member.source_type, member.source_id, unit.slug as unit_slug
              from component_members member
              join crm_caixa.sales sale on sale.customer_id = member.source_id::uuid
              join crm_atendimento.units unit on unit.id = sale.unit_id
             where member.source_type = 'caixa_customer'
            union all
            select member.source_type, member.source_id, unit.slug as unit_slug
              from component_members member
              join crm_atendimento.app_client_registrations registration on registration.source_client_id = member.source_id
              join lateral jsonb_array_elements_text(coalesce(registration.unit_slugs, '[]'::jsonb)) scope(slug) on true
              join crm_atendimento.units unit on unit.slug = scope.slug
             where member.source_type = 'app_registration'
            union all
            select member.source_type, member.source_id, unit.slug as unit_slug
              from component_members member
              join crm_atendimento.supplemental_lead_profiles lead on lead.source_profile_id = member.source_id
              join lateral jsonb_array_elements_text(coalesce(lead.unit_slugs, '[]'::jsonb)) scope(slug) on true
              join crm_atendimento.units unit on unit.slug = scope.slug
             where member.source_type = 'lead_profile'
         )
         select member.source_type, member.source_id,
                coalesce(array_agg(distinct evidence.unit_slug order by evidence.unit_slug)
                    filter (where evidence.unit_slug is not null), '{}'::text[]) as unit_slugs
           from component_members member
           left join member_unit_evidence evidence
             on evidence.source_type = member.source_type and evidence.source_id = member.source_id
          group by member.source_type, member.source_id
          order by member.source_type, member.source_id`,
        [candidate.sourceType, candidate.sourceId, candidate.targetType, candidate.targetId],
    )
    return result.rows || []
}

async function assertCommercialReviewCandidateScope(client, actor, candidate) {
    const allowed = commercialUnitScope(actor)
    if (allowed === null) return
    const candidateUnits = normalizeReviewUnitSlugs(candidate?.unitSlugs)
    if (!candidateUnits.length || candidateUnits.some((unit) => !allowed.includes(unit))) {
        throw commercialScopeError()
    }
    // A confirmed review can move the complete existing components, not only
    // the two displayed endpoints. Resolve every current member before the
    // source status is changed; unknown provenance is deliberately not enough
    // authority for a unit-scoped manager to alter the graph.
    const directMembers = new Set([
        `${String(candidate?.sourceType || '')}:${String(candidate?.sourceId || '')}`,
        `${String(candidate?.targetType || '')}:${String(candidate?.targetId || '')}`,
    ])
    const members = await queryCommercialReviewComponentUnitEvidence(client, candidate)
    for (const member of members) {
        const memberUnits = normalizeReviewUnitSlugs(member?.unit_slugs)
        const memberKey = `${String(member?.source_type || '')}:${String(member?.source_id || '')}`
        if (!memberUnits.length && !directMembers.has(memberKey)) throw commercialScopeError()
        if (memberUnits.some((unit) => !allowed.includes(unit))) throw commercialScopeError()
    }
}

async function queryIdentityReviewQueue(pgPool, query = {}, { workflowReady = false, unitSlugs = null } = {}) {
    const type = String(query.type || '').trim()
    const search = normalizeText(query.q || query.search || '')
    const limit = sanitizeLimit(query.limit, 100, 250)
    const offset = sanitizeOffset(query.offset, 0)
    const includeResolved = String(query.includeResolved || '').trim().toLowerCase() === 'true'
    const nameMergeStatuses = workflowReady ? "('pending','confirmed','rejected')" : "('pending')"
    const linkStatuses = workflowReady ? "('suggested','ambiguous','confirmed','rejected')" : "('suggested','ambiguous')"
    const decisionCte = workflowReady
        ? `latest_decisions as (
            select distinct on (review_type, source_id, target_id)
                review_type, source_id, target_id, decision, resulting_status, source_version, created_at
            from crm_atendimento.identity_review_decisions
            order by review_type, source_id, target_id, event_order desc
        )`
        : `latest_decisions as (
            select null::text as review_type, null::text as source_id, null::text as target_id,
                null::text as decision, null::text as resulting_status, null::text as source_version,
                null::timestamptz as created_at
            where false
        )`
    const result = await pgPool.query(
        `with review_items as (
            select 'attendance_name_merge'::text as type, m.id::text as id, m.left_client_id::text as source_id,
                m.right_client_id::text as target_id, m.status, m.similarity::numeric as confidence,
                left_client.canonical_name as primary_name, right_client.canonical_name as secondary_name,
                m.evidence, jsonb_build_object('leftAttendanceCount', left_client.attendance_count, 'rightAttendanceCount', right_client.attendance_count,
                    'leftAliases', coalesce((select jsonb_agg(alias_name order by usage_count desc) from crm_atendimento.client_aliases where client_id=left_client.id), '[]'::jsonb),
                    'rightAliases', coalesce((select jsonb_agg(alias_name order by usage_count desc) from crm_atendimento.client_aliases where client_id=right_client.id), '[]'::jsonb)) as context,
                md5(jsonb_build_object('type','attendance_name_merge','sourceId',m.left_client_id::text,
                    'targetId',m.right_client_id::text,'status',m.status,'confidence',m.similarity,'evidence',m.evidence)::text) as review_version,
                ${reviewUnitSlugs(reviewAttendanceUnitSource('m.left_client_id'), reviewAttendanceUnitSource('m.right_client_id'))} as unit_slugs
            from crm_atendimento.client_merge_suggestions m
            join crm_atendimento.canonical_clients left_client on left_client.id=m.left_client_id
            join crm_atendimento.canonical_clients right_client on right_client.id=m.right_client_id
            where m.status in ${nameMergeStatuses}
            union all
            select 'attendance_caixa'::text, link.id::text, link.client_id::text, link.caixa_customer_id::text,
                link.status, link.confidence::numeric, client.canonical_name, customer.name, link.evidence,
                jsonb_build_object('attendanceCount', client.attendance_count, 'aliases', coalesce((select jsonb_agg(alias_name order by usage_count desc) from crm_atendimento.client_aliases where client_id=client.id), '[]'::jsonb),
                    'phoneKey', customer.phone_key, 'sales', coalesce((select count(*) from crm_caixa.sales where customer_id=customer.id),0),
                    'salesTotal', coalesce((select sum(total) from crm_caixa.sales where customer_id=customer.id),0)),
                md5(jsonb_build_object('type','attendance_caixa','sourceId',link.client_id::text,
                    'targetId',link.caixa_customer_id::text,'status',link.status,'method',link.method,'confidence',link.confidence,'evidence',link.evidence)::text),
                ${reviewUnitSlugs(reviewAttendanceUnitSource('link.client_id'), reviewCaixaUnitSource('link.caixa_customer_id'))} as unit_slugs
            from crm_atendimento.client_caixa_links link join crm_atendimento.canonical_clients client on client.id=link.client_id join crm_caixa.customers customer on customer.id=link.caixa_customer_id
            where link.status in ${linkStatuses}
            union all
            select 'app_attendance'::text, app_link.app_registration_id||':'||app_link.client_id::text, app_link.app_registration_id,
                app_link.client_id::text, app_link.status, app_link.confidence::numeric, app.canonical_name, client.canonical_name, app_link.evidence,
                jsonb_build_object('appPhones',app.phone_keys,'appEmails',app.email_keys,'appUnits',app.unit_slugs,'attendanceCount',client.attendance_count,
                    'aliases',coalesce((select jsonb_agg(alias_name order by usage_count desc) from crm_atendimento.client_aliases where client_id=client.id),'[]'::jsonb)),
                md5(jsonb_build_object('type','app_attendance','sourceId',app_link.app_registration_id,
                    'targetId',app_link.client_id::text,'status',app_link.status,'method',app_link.method,'confidence',app_link.confidence,'evidence',app_link.evidence)::text),
                ${reviewUnitSlugs(reviewStoredUnitSource('app.unit_slugs'), reviewAttendanceUnitSource('app_link.client_id'))} as unit_slugs
            from crm_atendimento.app_registration_attendance_links app_link join crm_atendimento.app_client_registrations app on app.source_client_id=app_link.app_registration_id join crm_atendimento.canonical_clients client on client.id=app_link.client_id
            where app_link.status in ${linkStatuses}
            union all
            select 'app_caixa'::text, app_link.app_registration_id||':'||app_link.caixa_customer_id::text, app_link.app_registration_id,
                app_link.caixa_customer_id::text, app_link.status, app_link.confidence::numeric, app.canonical_name, customer.name, app_link.evidence,
                jsonb_build_object('appPhones',app.phone_keys,'appEmails',app.email_keys,'appUnits',app.unit_slugs,'phoneKey',customer.phone_key,
                    'sales',coalesce((select count(*) from crm_caixa.sales where customer_id=customer.id),0),'salesTotal',coalesce((select sum(total) from crm_caixa.sales where customer_id=customer.id),0)),
                md5(jsonb_build_object('type','app_caixa','sourceId',app_link.app_registration_id,
                    'targetId',app_link.caixa_customer_id::text,'status',app_link.status,'method',app_link.method,'confidence',app_link.confidence,'evidence',app_link.evidence)::text),
                ${reviewUnitSlugs(reviewStoredUnitSource('app.unit_slugs'), reviewCaixaUnitSource('app_link.caixa_customer_id'))} as unit_slugs
            from crm_atendimento.app_registration_caixa_links app_link join crm_atendimento.app_client_registrations app on app.source_client_id=app_link.app_registration_id join crm_caixa.customers customer on customer.id=app_link.caixa_customer_id
            where app_link.status in ${linkStatuses}
            union all
            select 'lead_app'::text, link.source_profile_id||':'||link.app_registration_id, link.source_profile_id, link.app_registration_id,
                link.status, link.confidence::numeric, lead.canonical_name, app.canonical_name, link.evidence,
                jsonb_build_object('leadPhones',lead.phone_keys,'leadEmails',lead.email_keys,'leadUnits',lead.unit_slugs,'leadBirthdays',lead.birthdays,
                    'appPhones',app.phone_keys,'appEmails',app.email_keys,'appUnits',app.unit_slugs),
                md5(jsonb_build_object('type','lead_app','sourceId',link.source_profile_id,
                    'targetId',link.app_registration_id,'status',link.status,'method',link.method,'confidence',link.confidence,'evidence',link.evidence)::text),
                ${reviewUnitSlugs(reviewStoredUnitSource('lead.unit_slugs'), reviewStoredUnitSource('app.unit_slugs'))} as unit_slugs
            from crm_atendimento.supplemental_lead_profile_app_links link join crm_atendimento.supplemental_lead_profiles lead on lead.source_profile_id=link.source_profile_id join crm_atendimento.app_client_registrations app on app.source_client_id=link.app_registration_id
            where link.status in ${linkStatuses}
            union all
            select 'lead_caixa'::text, link.source_profile_id||':'||link.caixa_customer_id::text, link.source_profile_id,
                link.caixa_customer_id::text, link.status, link.confidence::numeric, lead.canonical_name, customer.name, link.evidence,
                jsonb_build_object('leadPhones',lead.phone_keys,'leadEmails',lead.email_keys,'leadUnits',lead.unit_slugs,'leadBirthdays',lead.birthdays,
                    'phoneKey',customer.phone_key,'sales',coalesce((select count(*) from crm_caixa.sales where customer_id=customer.id),0),'salesTotal',coalesce((select sum(total) from crm_caixa.sales where customer_id=customer.id),0)),
                md5(jsonb_build_object('type','lead_caixa','sourceId',link.source_profile_id,
                    'targetId',link.caixa_customer_id::text,'status',link.status,'method',link.method,'confidence',link.confidence,'evidence',link.evidence)::text),
                ${reviewUnitSlugs(reviewStoredUnitSource('lead.unit_slugs'), reviewCaixaUnitSource('link.caixa_customer_id'))} as unit_slugs
            from crm_atendimento.supplemental_lead_profile_caixa_links link join crm_atendimento.supplemental_lead_profiles lead on lead.source_profile_id=link.source_profile_id join crm_caixa.customers customer on customer.id=link.caixa_customer_id
            where link.status in ${linkStatuses}
        ), ${decisionCte}, resolved as (
            select item.*, decision.decision as decision, decision.source_version as decision_source_version,
                case when decision.decision in ('confirmed','rejected') and decision.source_version = item.review_version
                          and decision.resulting_status = item.status then 'resolved'
                    when decision.decision in ('confirmed','rejected') then 'stale'
                    else null end as decision_state
            from review_items item
            left join latest_decisions decision on decision.review_type=item.type and decision.source_id=item.source_id and decision.target_id=item.target_id
        ), filtered as (
            select *, count(*) over()::int as total from resolved
            where (${includeResolved ? 'true' : "decision_state is distinct from 'resolved' and (status in ('pending','suggested','ambiguous') or decision_state='stale')"})
              and (status not in ('confirmed','rejected') or decision is not null)
              and ($1='' or type=$1)
              and ($2='' or lower(primary_name||' '||secondary_name) like '%'||$2||'%')
              and ($5::text[] is null or (cardinality(unit_slugs) > 0 and unit_slugs <@ $5::text[]))
        ) select * from filtered order by case decision_state when 'stale' then 0 else 1 end,
            case status when 'ambiguous' then 0 else 1 end, confidence desc nulls last, primary_name, secondary_name limit $3 offset $4`,
        [type, search, limit, offset, unitSlugs],
    )
    return { total: Number(result.rows[0]?.total || 0), limit, offset, items: result.rows.map((row) => ({
        id: row.id, type: row.type, sourceId: row.source_id, targetId: row.target_id, status: row.status,
        version: row.review_version, decisionState: row.decision_state || null, confidence: Number(row.confidence || 0),
        primaryName: row.primary_name, secondaryName: row.secondary_name,
        evidence: minimizeCommercialReviewValue(row.evidence || {}), context: minimizeCommercialReviewValue(row.context || {}),
    })) }
}

const IDENTITY_REVIEW_DEFINITIONS = {
    attendance_name_merge: { sourceType: 'attendance_client', targetType: 'attendance_client', statuses: new Set(['pending']) },
    attendance_caixa: { sourceType: 'attendance_client', targetType: 'caixa_customer', statuses: new Set(['suggested', 'ambiguous']) },
    app_attendance: { sourceType: 'app_registration', targetType: 'attendance_client', statuses: new Set(['suggested', 'ambiguous']) },
    app_caixa: { sourceType: 'app_registration', targetType: 'caixa_customer', statuses: new Set(['suggested', 'ambiguous']) },
    lead_app: { sourceType: 'lead_profile', targetType: 'app_registration', statuses: new Set(['suggested', 'ambiguous']) },
    lead_caixa: { sourceType: 'lead_profile', targetType: 'caixa_customer', statuses: new Set(['suggested', 'ambiguous']) },
}

// Name-merge reviews operate directly on canonical identities.  The remaining
// review types are persisted source-link edges and therefore share the same
// automatic-topology ledger used by their importers.  Keeping this mapping
// explicit prevents a new review type from silently acquiring link semantics.
const IDENTITY_REVIEW_SOURCE_LINK_TYPES = Object.freeze({
    attendance_caixa: 'attendance_caixa',
    app_attendance: 'app_attendance',
    app_caixa: 'app_caixa',
    lead_app: 'lead_app',
    lead_caixa: 'lead_caixa',
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function assertIdentityReviewReferenceShape({ reviewType, sourceId, targetId }) {
    const requiresSourceUuid = reviewType === 'attendance_name_merge' || reviewType === 'attendance_caixa'
    const requiresTargetUuid = reviewType !== 'lead_app'
    if ((requiresSourceUuid && !UUID_RE.test(sourceId)) || (requiresTargetUuid && !UUID_RE.test(targetId))) {
        throw identityReviewError('INVALID_IDENTITY_REVIEW_REFERENCE')
    }
}

function identityReviewLockKey(reviewType, sourceId, targetId) {
    return `crm_atendimento.identity-review:${reviewType}:${sourceId}:${targetId}`
}

async function acquireIdentityReviewLocks(client, candidate) {
    // Migration apply/rollback takes this same transaction lock.  Holding it
    // before the graph lock prevents a decision from crossing a rollback that
    // disables its schema and source-of-truth contract.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_REVIEW_WORKFLOW_MIGRATION_ID])
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_REVIEW_SOURCE_LINK_LEDGER_MIGRATION_ID])
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [identityReviewLockKey(candidate.reviewType, candidate.sourceId, candidate.targetId)])
    // Existing source reconcilers use this lock. Joining it keeps a reviewed
    // decision from interleaving with an import that would replace evidence.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, ['crm_atendimento.client_identity_reconciliation'])
    const memberLocks = [
        `${candidate.sourceType}:${candidate.sourceId}`,
        `${candidate.targetType}:${candidate.targetId}`,
    ].sort()
    for (const member of memberLocks) {
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`crm_atendimento.identity-member:${member}`])
    }
}

async function readIdentityReviewCandidate(client, normalized) {
    assertIdentityReviewReferenceShape(normalized)
    const definition = IDENTITY_REVIEW_DEFINITIONS[normalized.reviewType]
    let result
    switch (normalized.reviewType) {
    case 'attendance_name_merge':
        result = await client.query(`select m.id::text as row_id, m.status, m.evidence,
                md5(jsonb_build_object('type','attendance_name_merge','sourceId',m.left_client_id::text,
                    'targetId',m.right_client_id::text,'status',m.status,'confidence',m.similarity,'evidence',m.evidence)::text) as review_version,
                left_client.canonical_name as source_name, right_client.canonical_name as target_name,
                ${reviewUnitSlugs(reviewAttendanceUnitSource('m.left_client_id'), reviewAttendanceUnitSource('m.right_client_id'))} as unit_slugs,
                jsonb_build_object('leftAttendanceCount', left_client.attendance_count, 'rightAttendanceCount', right_client.attendance_count) as context
            from crm_atendimento.client_merge_suggestions m
            join crm_atendimento.canonical_clients left_client on left_client.id=m.left_client_id
            join crm_atendimento.canonical_clients right_client on right_client.id=m.right_client_id
            where m.left_client_id=$1::uuid and m.right_client_id=$2::uuid for update of m`, [normalized.sourceId, normalized.targetId])
        break
    case 'attendance_caixa':
        result = await client.query(`select link.id::text as row_id, link.status, link.evidence,
                md5(jsonb_build_object('type','attendance_caixa','sourceId',link.client_id::text,
                    'targetId',link.caixa_customer_id::text,'status',link.status,'method',link.method,'confidence',link.confidence,'evidence',link.evidence)::text) as review_version,
                attendance.canonical_name as source_name, customer.name as target_name,
                ${reviewUnitSlugs(reviewAttendanceUnitSource('link.client_id'), reviewCaixaUnitSource('link.caixa_customer_id'))} as unit_slugs,
                jsonb_build_object('attendanceCount', attendance.attendance_count, 'phoneKey', customer.phone_key) as context
            from crm_atendimento.client_caixa_links link
            join crm_atendimento.canonical_clients attendance on attendance.id=link.client_id
            join crm_caixa.customers customer on customer.id=link.caixa_customer_id
            where link.client_id=$1::uuid and link.caixa_customer_id=$2::uuid for update of link`, [normalized.sourceId, normalized.targetId])
        break
    case 'app_attendance':
        result = await client.query(`select link.status, link.evidence,
                md5(jsonb_build_object('type','app_attendance','sourceId',link.app_registration_id,
                    'targetId',link.client_id::text,'status',link.status,'method',link.method,'confidence',link.confidence,'evidence',link.evidence)::text) as review_version,
                app.canonical_name as source_name, attendance.canonical_name as target_name,
                ${reviewUnitSlugs(reviewStoredUnitSource('app.unit_slugs'), reviewAttendanceUnitSource('link.client_id'))} as unit_slugs,
                jsonb_build_object('appPhones',app.phone_keys,'appEmails',app.email_keys,'appUnits',app.unit_slugs) as context
            from crm_atendimento.app_registration_attendance_links link
            join crm_atendimento.app_client_registrations app on app.source_client_id=link.app_registration_id
            join crm_atendimento.canonical_clients attendance on attendance.id=link.client_id
            where link.app_registration_id=$1 and link.client_id=$2::uuid for update of link`, [normalized.sourceId, normalized.targetId])
        break
    case 'app_caixa':
        result = await client.query(`select link.status, link.evidence,
                md5(jsonb_build_object('type','app_caixa','sourceId',link.app_registration_id,
                    'targetId',link.caixa_customer_id::text,'status',link.status,'method',link.method,'confidence',link.confidence,'evidence',link.evidence)::text) as review_version,
                app.canonical_name as source_name, customer.name as target_name,
                ${reviewUnitSlugs(reviewStoredUnitSource('app.unit_slugs'), reviewCaixaUnitSource('link.caixa_customer_id'))} as unit_slugs,
                jsonb_build_object('appPhones',app.phone_keys,'appEmails',app.email_keys,'appUnits',app.unit_slugs,'phoneKey',customer.phone_key) as context
            from crm_atendimento.app_registration_caixa_links link
            join crm_atendimento.app_client_registrations app on app.source_client_id=link.app_registration_id
            join crm_caixa.customers customer on customer.id=link.caixa_customer_id
            where link.app_registration_id=$1 and link.caixa_customer_id=$2::uuid for update of link`, [normalized.sourceId, normalized.targetId])
        break
    case 'lead_app':
        result = await client.query(`select link.status, link.evidence,
                md5(jsonb_build_object('type','lead_app','sourceId',link.source_profile_id,
                    'targetId',link.app_registration_id,'status',link.status,'method',link.method,'confidence',link.confidence,'evidence',link.evidence)::text) as review_version,
                lead.canonical_name as source_name, app.canonical_name as target_name,
                ${reviewUnitSlugs(reviewStoredUnitSource('lead.unit_slugs'), reviewStoredUnitSource('app.unit_slugs'))} as unit_slugs,
                jsonb_build_object('leadPhones',lead.phone_keys,'leadEmails',lead.email_keys,'leadUnits',lead.unit_slugs,
                    'appPhones',app.phone_keys,'appEmails',app.email_keys,'appUnits',app.unit_slugs) as context
            from crm_atendimento.supplemental_lead_profile_app_links link
            join crm_atendimento.supplemental_lead_profiles lead on lead.source_profile_id=link.source_profile_id
            join crm_atendimento.app_client_registrations app on app.source_client_id=link.app_registration_id
            where link.source_profile_id=$1 and link.app_registration_id=$2 for update of link`, [normalized.sourceId, normalized.targetId])
        break
    case 'lead_caixa':
        result = await client.query(`select link.status, link.evidence,
                md5(jsonb_build_object('type','lead_caixa','sourceId',link.source_profile_id,
                    'targetId',link.caixa_customer_id::text,'status',link.status,'method',link.method,'confidence',link.confidence,'evidence',link.evidence)::text) as review_version,
                lead.canonical_name as source_name, customer.name as target_name,
                ${reviewUnitSlugs(reviewStoredUnitSource('lead.unit_slugs'), reviewCaixaUnitSource('link.caixa_customer_id'))} as unit_slugs,
                jsonb_build_object('leadPhones',lead.phone_keys,'leadEmails',lead.email_keys,'leadUnits',lead.unit_slugs,'phoneKey',customer.phone_key) as context
            from crm_atendimento.supplemental_lead_profile_caixa_links link
            join crm_atendimento.supplemental_lead_profiles lead on lead.source_profile_id=link.source_profile_id
            join crm_caixa.customers customer on customer.id=link.caixa_customer_id
            where link.source_profile_id=$1 and link.caixa_customer_id=$2::uuid for update of link`, [normalized.sourceId, normalized.targetId])
        break
    default:
        throw identityReviewError('INVALID_IDENTITY_REVIEW_TYPE')
    }
    const row = result.rows[0]
    if (!row) throw identityReviewError('IDENTITY_REVIEW_NOT_FOUND', 404)
    const canonicalReferences = [
        definition.sourceType === 'attendance_client' ? normalized.sourceId : null,
        definition.targetType === 'attendance_client' ? normalized.targetId : null,
    ].filter(Boolean)
    if (canonicalReferences.length) {
        const retired = await client.query(`select id::text from crm_atendimento.canonical_clients
            where id=any($1::uuid[]) and merged_into_id is not null limit 1 for update`, [canonicalReferences])
        if (retired.rows[0]?.id) throw identityReviewError('IDENTITY_REVIEW_CANONICAL_REFERENCE_RETIRED', 409)
    }
    return {
        reviewType: normalized.reviewType,
        sourceId: normalized.sourceId,
        targetId: normalized.targetId,
        sourceType: definition.sourceType,
        targetType: definition.targetType,
        rawStatus: row.status,
        version: row.review_version,
        sourceName: row.source_name || '',
        targetName: row.target_name || '',
        evidence: row.evidence || {},
        context: row.context || {},
        unitSlugs: normalizeReviewUnitSlugs(row.unit_slugs),
        survivorClientId: normalized.survivorClientId || null,
    }
}

function assertIdentityReviewCandidateVersion(candidate, expectedVersion) {
    const definition = IDENTITY_REVIEW_DEFINITIONS[candidate.reviewType]
    if (!definition?.statuses?.has(candidate.rawStatus)) throw identityReviewError('IDENTITY_REVIEW_NOT_ACTIONABLE', 409)
    if (candidate.version !== expectedVersion) throw identityReviewError('IDENTITY_REVIEW_CONFLICT', 409)
}

function assertIdentityReviewUndoCandidateVersion(candidate, expectedVersion, latestDecision) {
    if (candidate.version !== expectedVersion) throw identityReviewError('IDENTITY_REVIEW_CONFLICT', 409)
    const expectedStatus = latestDecision?.decision === 'confirmed' ? 'confirmed' : 'rejected'
    if (!expectedStatus || candidate.rawStatus !== expectedStatus) {
        throw identityReviewError('IDENTITY_REVIEW_CONFLICT', 409)
    }
}

async function writeIdentityReviewSourceStatus(client, candidate, nextStatus, actor) {
    const reviewedBy = actorIdentityForMutation(actor)
    let result
    switch (candidate.reviewType) {
    case 'attendance_name_merge':
        result = await client.query(`update crm_atendimento.client_merge_suggestions
            set status=$3,reviewed_by=$4,reviewed_at=now(),updated_at=now()
            where left_client_id=$1::uuid and right_client_id=$2::uuid and status=$5
            returning status,md5(jsonb_build_object('type','attendance_name_merge','sourceId',left_client_id::text,
                'targetId',right_client_id::text,'status',status,'confidence',similarity,'evidence',evidence)::text) as review_version`,
        [candidate.sourceId, candidate.targetId, nextStatus, reviewedBy, candidate.rawStatus])
        break
    case 'attendance_caixa':
        result = await client.query(`update crm_atendimento.client_caixa_links
            set status=$3,reviewed_by=$4,reviewed_at=now(),updated_at=now()
            where client_id=$1::uuid and caixa_customer_id=$2::uuid and status=$5
            returning status,md5(jsonb_build_object('type','attendance_caixa','sourceId',client_id::text,
                'targetId',caixa_customer_id::text,'status',status,'method',method,'confidence',confidence,'evidence',evidence)::text) as review_version`,
        [candidate.sourceId, candidate.targetId, nextStatus, reviewedBy, candidate.rawStatus])
        break
    case 'app_attendance':
        result = await client.query(`update crm_atendimento.app_registration_attendance_links
            set status=$3,updated_at=now()
            where app_registration_id=$1 and client_id=$2::uuid and status=$4
            returning status,md5(jsonb_build_object('type','app_attendance','sourceId',app_registration_id,
                'targetId',client_id::text,'status',status,'method',method,'confidence',confidence,'evidence',evidence)::text) as review_version`,
        [candidate.sourceId, candidate.targetId, nextStatus, candidate.rawStatus])
        break
    case 'app_caixa':
        result = await client.query(`update crm_atendimento.app_registration_caixa_links
            set status=$3,updated_at=now()
            where app_registration_id=$1 and caixa_customer_id=$2::uuid and status=$4
            returning status,md5(jsonb_build_object('type','app_caixa','sourceId',app_registration_id,
                'targetId',caixa_customer_id::text,'status',status,'method',method,'confidence',confidence,'evidence',evidence)::text) as review_version`,
        [candidate.sourceId, candidate.targetId, nextStatus, candidate.rawStatus])
        break
    case 'lead_app':
        result = await client.query(`update crm_atendimento.supplemental_lead_profile_app_links
            set status=$3,updated_at=now()
            where source_profile_id=$1 and app_registration_id=$2 and status=$4
            returning status,md5(jsonb_build_object('type','lead_app','sourceId',source_profile_id,
                'targetId',app_registration_id,'status',status,'method',method,'confidence',confidence,'evidence',evidence)::text) as review_version`,
        [candidate.sourceId, candidate.targetId, nextStatus, candidate.rawStatus])
        break
    case 'lead_caixa':
        result = await client.query(`update crm_atendimento.supplemental_lead_profile_caixa_links
            set status=$3,updated_at=now()
            where source_profile_id=$1 and caixa_customer_id=$2::uuid and status=$4
            returning status,md5(jsonb_build_object('type','lead_caixa','sourceId',source_profile_id,
                'targetId',caixa_customer_id::text,'status',status,'method',method,'confidence',confidence,'evidence',evidence)::text) as review_version`,
        [candidate.sourceId, candidate.targetId, nextStatus, candidate.rawStatus])
        break
    default:
        throw identityReviewError('INVALID_IDENTITY_REVIEW_TYPE')
    }
    const row = result.rows[0]
    if (!row) throw identityReviewError('IDENTITY_REVIEW_CONFLICT', 409)
    return { rawStatus: row.status, version: row.review_version }
}

async function readLatestIdentityReviewDecision(client, candidate) {
    const result = await client.query(`select id::text, event_order, decision, source_status, resulting_status, source_version,
            materialization_run_id::text, source_snapshot, created_at
        from crm_atendimento.identity_review_decisions
        where review_type=$1 and source_id=$2 and target_id=$3
        order by event_order desc limit 1 for update`, [candidate.reviewType, candidate.sourceId, candidate.targetId])
    return result.rows[0] || null
}

async function assertIdentityReviewUndoLedgerCutover(client, materializationEventOrder) {
    const result = await client.query(`select details from crm_atendimento.schema_migrations
        where id=$1 and rolled_back_at is null`, [IDENTITY_REVIEW_SOURCE_LINK_LEDGER_MIGRATION_ID])
    const details = result.rows[0]?.details || {}
    const cutover = Number(details?.sourceLinkLedgerCutoverRunEventOrder)
    if (!Number.isSafeInteger(cutover) || cutover < 0 || materializationEventOrder <= cutover) {
        throw identityReviewError('IDENTITY_REVIEW_UNDO_LEGACY_LEDGER_UNSAFE', 409)
    }
}

async function assertNoDependentIdentityReviewDecision(client, decision, candidate) {
    if (!decision?.materialization_run_id || decision.decision !== 'confirmed') return
    const originalRun = await client.query(`select summary,event_order from crm_atendimento.identity_materialization_runs
        where id=$1::uuid for share`, [decision.materialization_run_id])
    const original = originalRun.rows[0]
    const summary = original?.summary || {}
    const materializationEventOrder = Number(original?.event_order)
    const identityIds = [...new Set([
        summary.sourceIdentityId,
        summary.targetIdentityId,
        summary.survivorIdentityId,
        summary.retiredIdentityId,
        ...(Array.isArray(summary.createdIdentityIds) ? summary.createdIdentityIds : []),
    ].map((value) => String(value || '').trim()).filter(Boolean))]
    if (!Number.isSafeInteger(materializationEventOrder) || materializationEventOrder <= 0) {
        throw identityReviewError('IDENTITY_REVIEW_UNDO_DEPENDENCY_UNAVAILABLE', 409)
    }
    await assertIdentityReviewUndoLedgerCutover(client, materializationEventOrder)
    // All graph materializations use IDENTITY_GRAPH_LOCK_KEY.  Thus a later
    // applied ledger run touching a member or identity from this confirmation
    // is a serial dependency, whether it came from another manager decision or
    // from an automatic source reconciler.  Run event_order is assigned only
    // after the graph lock is acquired, unlike a transaction-start timestamp.
    // First retain the decision event guard for later human confirmations that
    // could be source-state changes without a physical member move.
    const dependentDecision = await client.query(`with latest_decisions as (
            select distinct on (review_type,source_id,target_id)
                review_type,source_id,target_id,decision,event_order,materialization_run_id
            from crm_atendimento.identity_review_decisions
            order by review_type,source_id,target_id,event_order desc
        )
        select later.review_type,later.source_id,later.target_id
        from latest_decisions later
        join crm_atendimento.identity_materialization_runs run on run.id=later.materialization_run_id
        where later.decision='confirmed' and later.event_order>$1::bigint
          and (
            coalesce(run.summary->>'sourceIdentityId','')=any($2::text[])
            or coalesce(run.summary->>'targetIdentityId','')=any($2::text[])
            or coalesce(run.summary->>'survivorIdentityId','')=any($2::text[])
            or coalesce(run.summary->>'retiredIdentityId','')=any($2::text[])
            or exists(select 1 from jsonb_array_elements_text(coalesce(run.summary->'createdIdentityIds','[]'::jsonb)) as created(id)
                where created.id=any($2::text[]))
          )
        limit 1`, [decision.event_order, identityIds])
    if (dependentDecision.rows[0]) throw identityReviewError('IDENTITY_REVIEW_UNDO_DEPENDENT_DECISION', 409)

    const dependentMaterialization = await client.query(`with original_members as (
            select source_type,source_id,event_order
            from crm_atendimento.identity_member_history
            where materialization_run_id=$1::uuid
        ), later_history as (
            select run.id::text as materialization_run_id,history.source_type,history.source_id,
                history.previous_identity_id::text as previous_identity_id,
                history.next_identity_id::text as next_identity_id
            from crm_atendimento.identity_materialization_runs run
            join crm_atendimento.identity_member_history history on history.materialization_run_id=run.id
            where run.id<>$1::uuid and run.status='applied'
              and run.event_order>$2::bigint
        )
        select later.materialization_run_id,later.source_type,later.source_id
        from later_history later
        where exists(select 1 from original_members original
                where original.source_type=later.source_type and original.source_id=later.source_id)
           or later.previous_identity_id=any($3::text[])
           or later.next_identity_id=any($3::text[])
        limit 1`, [decision.materialization_run_id, materializationEventOrder, identityIds])
    if (dependentMaterialization.rows[0]) throw identityReviewError('IDENTITY_REVIEW_UNDO_DEPENDENT_DECISION', 409)

    const dependentAutomaticLink = await client.query(`with original_members as (
            select source_type,source_id
            from crm_atendimento.identity_member_history
            where materialization_run_id=$1::uuid
        ), latest_source_links as (
            select distinct on (links.link_type,links.source_type,links.source_id,links.target_type,links.target_id)
                links.link_type,links.source_type,links.source_id,links.target_type,links.target_id,
                links.transition,run.event_order
            from crm_atendimento.identity_source_link_history links
            join crm_atendimento.identity_materialization_runs run on run.id=links.materialization_run_id
            where run.status in ('applied','not_applicable')
            order by links.link_type,links.source_type,links.source_id,links.target_type,links.target_id,run.event_order desc
        )
        select links.link_type,links.source_type,links.source_id,links.target_type,links.target_id
        from latest_source_links links
        where links.transition='automatic_activated' and links.event_order>$2::bigint
          and (
            exists(select 1 from original_members original
                where (original.source_type=links.source_type and original.source_id=links.source_id)
                   or (original.source_type=links.target_type and original.source_id=links.target_id))
            or (links.source_type=$3 and links.source_id=$4)
            or (links.target_type=$3 and links.target_id=$4)
            or (links.source_type=$5 and links.source_id=$6)
            or (links.target_type=$5 and links.target_id=$6)
          )
        limit 1`, [
        decision.materialization_run_id,
        materializationEventOrder,
        candidate.sourceType,
        candidate.sourceId,
        candidate.targetType,
        candidate.targetId,
    ])
    if (dependentAutomaticLink.rows[0]) throw identityReviewError('IDENTITY_REVIEW_UNDO_DEPENDENT_DECISION', 409)
}

function assertNoCurrentIdentityReviewDecision(latest, candidate) {
    if (latest && latest.decision !== 'reversed' && latest.source_version === candidate.version) {
        throw identityReviewError('IDENTITY_REVIEW_ALREADY_DECIDED', 409)
    }
}

async function createIdentityReviewDecision(client, {
    candidate, decision, reason, actor, sourceSnapshot = {}, materializationRunId = null,
    resultingStatus = candidate.rawStatus, sourceVersion = candidate.version,
}) {
    const actorIdentity = actorIdentityForMutation(actor)
    const result = await client.query(`insert into crm_atendimento.identity_review_decisions(
            materialization_run_id,review_type,source_id,target_id,decision,source_status,resulting_status,source_version,reason,actor,source_snapshot)
        values($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb) returning id::text,created_at`, [
        materializationRunId, candidate.reviewType, candidate.sourceId, candidate.targetId, decision, candidate.rawStatus,
        resultingStatus, sourceVersion, reason, JSON.stringify({ id: actorIdentity, role: actor?.role || '' }), JSON.stringify({
            sourceName: candidate.sourceName,
            targetName: candidate.targetName,
            evidence: candidate.evidence,
            context: candidate.context,
            ...sourceSnapshot,
        }),
    ])
    return result.rows[0]
}

async function createIdentityMaterializationRun(client, { mode, status, inputFingerprint, previousFingerprint = null, summary = {}, actor }) {
    const actorIdentity = actorIdentityForMutation(actor)
    const result = await client.query(`insert into crm_atendimento.identity_materialization_runs(
            mode,status,input_fingerprint,previous_fingerprint,summary,actor)
        values($1,$2,$3,$4,$5::jsonb,$6::jsonb) returning id::text,created_at`, [
        mode, status, inputFingerprint, previousFingerprint, JSON.stringify(summary),
        JSON.stringify({ id: actorIdentity, role: actor?.role || '' }),
    ])
    return result.rows[0]
}

export function collectIdentityReviewSourceLinkTransitions({
    candidate,
    previousStatus,
    resultingStatus,
} = {}) {
    const linkType = IDENTITY_REVIEW_SOURCE_LINK_TYPES[candidate?.reviewType]
    if (!linkType) return []
    return collectAutomaticIdentityLinkTransitions({
        effectiveLinks: [{
            sourceId: candidate.sourceId,
            targetId: candidate.targetId,
            status: resultingStatus,
        }],
        persistedLinks: [{
            sourceId: candidate.sourceId,
            targetId: candidate.targetId,
            status: previousStatus,
        }],
        linkType,
        sourceType: candidate.sourceType,
        targetType: candidate.targetType,
        getSourceId: (link) => link.sourceId,
        getTargetId: (link) => link.targetId,
    })
}

async function recordIdentityReviewSourceLinkTransition(client, {
    materializationRunId,
    candidate,
    previousStatus,
    resultingStatus,
    origin,
}) {
    const transitions = collectIdentityReviewSourceLinkTransitions({ candidate, previousStatus, resultingStatus })
    if (!transitions.length) return []
    await client.query(`insert into crm_atendimento.identity_source_link_history(
            materialization_run_id,link_type,source_type,source_id,target_type,target_id,transition,resulting_status,origin)
        select $1::uuid,x.link_type,x.source_type,x.source_id,x.target_type,x.target_id,x.transition,x.resulting_status,$3
        from jsonb_to_recordset($2::jsonb) as x(
            link_type text,source_type text,source_id text,target_type text,target_id text,transition text,resulting_status text)`, [
        materializationRunId,
        JSON.stringify(transitions.map((transition) => ({
            link_type: transition.linkType,
            source_type: transition.sourceType,
            source_id: transition.sourceId,
            target_type: transition.targetType,
            target_id: transition.targetId,
            transition: transition.transition,
            resulting_status: transition.resultingStatus,
        }))),
        String(origin || 'manager_identity_review'),
    ])
    return transitions
}

async function updateIdentityMaterializationRun(client, runId, summary) {
    await client.query(`update crm_atendimento.identity_materialization_runs set summary=$2::jsonb where id=$1::uuid`, [runId, JSON.stringify(summary)])
}

async function acquireCommercialIdentityLocks(client, identityIds) {
    for (const identityId of [...new Set(identityIds.filter(Boolean).map(String))].sort()) {
        // Keep the exact same lock namespace used by consent and commercial
        // action writes, so a profile cannot change identity while a contact
        // eligibility decision is being recorded.
        await acquireCommercialContactIdentityLock(client, identityId)
    }
}

async function assertNoCommercialIdentityHistory(client, identityIds) {
    const ids = [...new Set(identityIds.filter(Boolean).map(String))]
    if (!ids.length) return
    const result = await client.query(`select
            (select count(*)::int from crm_atendimento.commercial_actions where identity_id=any($1::uuid[])) as actions,
            (select count(*)::int from crm_atendimento.commercial_contact_permissions where identity_id=any($1::uuid[])) as permissions,
            (select count(*)::int from crm_atendimento.commercial_contact_permission_events where identity_id=any($1::uuid[])) as permission_events,
            (select count(*)::int from crm_atendimento.commercial_policy_config
                where commercial_contact_canary_identity_ids && $1::uuid[]) as canary_entries,
            (select count(*)::int from crm_atendimento.audit_events
                where coalesce(payload->>'identityId','')=any($1::text[])) as audit_identity_events`, [ids])
    const row = result.rows[0] || {}
    if (Number(row.actions || 0) || Number(row.permissions || 0) || Number(row.permission_events || 0)
        || Number(row.canary_entries || 0) || Number(row.audit_identity_events || 0)) {
        throw identityReviewError('IDENTITY_REVIEW_COMMERCIAL_HISTORY_PRESENT', 409)
    }
}

async function readIdentityMembers(client, identityId, { lock = false } = {}) {
    const result = await client.query(`select source_type,source_id from crm_atendimento.global_client_identity_members
        where identity_id=$1::uuid order by source_type,source_id${lock ? ' for update' : ''}`, [identityId])
    return result.rows.map((row) => ({ sourceType: row.source_type, sourceId: row.source_id }))
}

async function ensureIdentityForMember(client, { sourceType, sourceId, canonicalName, runId }) {
    const existing = await client.query(`select identity.id::text as id, identity.canonical_name, identity.created_at
        from crm_atendimento.global_client_identity_members member
        join crm_atendimento.global_client_identities identity on identity.id=member.identity_id
        where member.source_type=$1 and member.source_id=$2 for update of member, identity`, [sourceType, sourceId])
    if (existing.rows[0]) {
        const row = existing.rows[0]
        return { id: row.id, canonicalName: row.canonical_name, createdAt: row.created_at, members: await readIdentityMembers(client, row.id, { lock: true }), created: false }
    }
    const componentKey = reviewComponentKey([{ sourceType, sourceId }])
    // An inactive historical projection must never be silently rebound to a
    // new source member. Retire its mutable component key and create a fresh
    // UUID so old contact/consent evidence remains unambiguous.
    const retired = await client.query(`select id::text from crm_atendimento.global_client_identities
        where component_key=$1 for update`, [componentKey])
    if (retired.rows[0]?.id) {
        await client.query(`update crm_atendimento.global_client_identities
            set component_key='retired:'||id::text,source_types='[]'::jsonb,updated_at=now() where id=$1::uuid`, [retired.rows[0].id])
    }
    const created = await client.query(`insert into crm_atendimento.global_client_identities(component_key,canonical_name,source_types)
        values($1,$2,$3::jsonb) returning id::text,canonical_name,created_at`, [componentKey, canonicalName || 'Cliente sem nome', JSON.stringify([sourceType])])
    const row = created.rows[0]
    await client.query(`insert into crm_atendimento.global_client_identity_members(identity_id,source_type,source_id)
        values($1::uuid,$2,$3)`, [row.id, sourceType, sourceId])
    await client.query(`insert into crm_atendimento.identity_member_history(
            materialization_run_id,source_type,source_id,previous_identity_id,next_identity_id,change_kind)
        values($1::uuid,$2,$3,null,$4::uuid,'created')`, [runId, sourceType, sourceId, row.id])
    return { id: row.id, canonicalName: row.canonical_name, createdAt: row.created_at, members: [{ sourceType, sourceId }], created: true }
}

async function refreshIdentityProjection(client, identityId, preferredName = '') {
    const members = await readIdentityMembers(client, identityId, { lock: true })
    if (!members.length) {
        await client.query(`update crm_atendimento.global_client_identities
            set component_key='retired:'||id::text,source_types='[]'::jsonb,updated_at=now() where id=$1::uuid`, [identityId])
        return { members, componentKey: `retired:${identityId}` }
    }
    const componentKey = reviewComponentKey(members)
    const collision = await client.query(`select id::text from crm_atendimento.global_client_identities
        where component_key=$1 and id<>$2::uuid for update`, [componentKey, identityId])
    if (collision.rows[0]?.id) throw identityReviewError('IDENTITY_REVIEW_COMPONENT_COLLISION', 409)
    const sourceTypes = [...new Set(members.map((member) => member.sourceType))].sort()
    await client.query(`update crm_atendimento.global_client_identities set component_key=$2,
        canonical_name=case when $3<>'' then $3 else canonical_name end,source_types=$4::jsonb,updated_at=now()
        where id=$1::uuid`, [identityId, componentKey, preferredName || '', JSON.stringify(sourceTypes)])
    return { members, componentKey }
}

async function applyManualCanonicalMerge(client, candidate) {
    if (candidate.reviewType !== 'attendance_name_merge') return null
    const survivorClientId = candidate.survivorClientId
    const sourceClientId = survivorClientId === candidate.sourceId ? candidate.targetId : candidate.sourceId
    const result = await client.query(`select id::text,canonical_name,merged_into_id::text from crm_atendimento.canonical_clients
        where id=any($1::uuid[]) for update`, [[sourceClientId, survivorClientId]])
    const source = result.rows.find((row) => row.id === sourceClientId)
    const target = result.rows.find((row) => row.id === survivorClientId)
    if (!source || !target || source.merged_into_id || target.merged_into_id) {
        throw identityReviewError('IDENTITY_REVIEW_CANONICAL_MERGE_NOT_ACTIONABLE', 409)
    }
    const dependent = await client.query(`select id from crm_atendimento.canonical_clients where merged_into_id=$1::uuid limit 1 for update`, [sourceClientId])
    if (dependent.rows[0]?.id) throw identityReviewError('IDENTITY_REVIEW_CANONICAL_MERGE_DEPENDENT', 409)
    await client.query(`update crm_atendimento.canonical_clients set merged_into_id=$2::uuid,updated_at=now() where id=$1::uuid`, [sourceClientId, survivorClientId])
    return { sourceClientId, survivorClientId, survivorName: target.canonical_name || '' }
}

async function reverseManualCanonicalMerge(client, merge) {
    if (!merge?.sourceClientId || !merge?.survivorClientId) return
    const result = await client.query(`select id::text,merged_into_id::text from crm_atendimento.canonical_clients
        where id=any($1::uuid[]) for update`, [[merge.sourceClientId, merge.survivorClientId]])
    const source = result.rows.find((row) => row.id === merge.sourceClientId)
    if (!source || source.merged_into_id !== merge.survivorClientId) {
        throw identityReviewError('IDENTITY_REVIEW_UNDO_DEPENDENCY_CHANGED', 409)
    }
    const dependent = await client.query(`select id from crm_atendimento.canonical_clients
        where merged_into_id=$1::uuid limit 1 for update`, [merge.sourceClientId])
    if (dependent.rows[0]?.id) throw identityReviewError('IDENTITY_REVIEW_UNDO_DEPENDENT_CANONICAL_MERGE', 409)
    await client.query(`update crm_atendimento.canonical_clients set merged_into_id=null,updated_at=now() where id=$1::uuid`, [merge.sourceClientId])
}

function preferredGlobalIdentity(identities, candidate) {
    if (candidate.survivorClientId) {
        const explicit = identities.find((identity) => identity.members.some((member) =>
            member.sourceType === 'attendance_client' && member.sourceId === candidate.survivorClientId))
        if (explicit) return explicit
    }
    return chooseIdentitySurvivor(identities)
}

async function insertIdentityMemberHistory(client, { runId, member, previousIdentityId, nextIdentityId, changeKind }) {
    await client.query(`insert into crm_atendimento.identity_member_history(
            materialization_run_id,source_type,source_id,previous_identity_id,next_identity_id,change_kind)
        values($1::uuid,$2,$3,$4::uuid,$5::uuid,$6)`, [runId, member.sourceType, member.sourceId,
        previousIdentityId || null, nextIdentityId || null, changeKind])
}

async function materializeIdentityReviewConfirmation(client, { candidate, actor }) {
    const inputFingerprint = identityMaterializationFingerprint({
        reviewType: candidate.reviewType, sourceId: candidate.sourceId, targetId: candidate.targetId,
        sourceVersion: candidate.version, survivorClientId: candidate.survivorClientId,
    })
    const run = await createIdentityMaterializationRun(client, {
        mode: 'confirm', status: 'applied', inputFingerprint, actor,
    })
    const sourceIdentity = await ensureIdentityForMember(client, {
        sourceType: candidate.sourceType, sourceId: candidate.sourceId, canonicalName: candidate.sourceName, runId: run.id,
    })
    const targetIdentity = await ensureIdentityForMember(client, {
        sourceType: candidate.targetType, sourceId: candidate.targetId, canonicalName: candidate.targetName, runId: run.id,
    })
    const before = identityMaterializationFingerprint({ source: sourceIdentity, target: targetIdentity })
    const identities = sourceIdentity.id === targetIdentity.id ? [sourceIdentity] : [sourceIdentity, targetIdentity]
    let manualCanonicalMerge = null
    let survivor = preferredGlobalIdentity(identities, candidate)
    let loser = null
    const movedMembers = []
    if (sourceIdentity.id !== targetIdentity.id) {
        await acquireCommercialIdentityLocks(client, [sourceIdentity.id, targetIdentity.id])
        await assertNoCommercialIdentityHistory(client, [sourceIdentity.id, targetIdentity.id])
        manualCanonicalMerge = candidate.reviewType === 'attendance_name_merge'
            ? await applyManualCanonicalMerge(client, candidate)
            : null
        loser = identities.find((identity) => identity.id !== survivor.id)
        for (const member of loser.members) {
            await client.query(`update crm_atendimento.global_client_identity_members set identity_id=$3::uuid,updated_at=now()
                where source_type=$1 and source_id=$2 and identity_id=$4::uuid`, [member.sourceType, member.sourceId, survivor.id, loser.id])
            await insertIdentityMemberHistory(client, {
                runId: run.id, member, previousIdentityId: loser.id, nextIdentityId: survivor.id, changeKind: 'moved',
            })
            movedMembers.push(member)
        }
        await client.query(`insert into crm_atendimento.identity_lineage(
                materialization_run_id,predecessor_identity_id,successor_identity_id,relation)
            values($1::uuid,$2::uuid,$3::uuid,'merged_into'),($1::uuid,$3::uuid,$3::uuid,'retained')`, [run.id, loser.id, survivor.id])
    }
    if (sourceIdentity.id === targetIdentity.id && candidate.reviewType === 'attendance_name_merge') {
        await acquireCommercialIdentityLocks(client, [sourceIdentity.id])
        await assertNoCommercialIdentityHistory(client, [sourceIdentity.id])
        manualCanonicalMerge = await applyManualCanonicalMerge(client, candidate)
    }
    const preferredName = manualCanonicalMerge?.survivorName || survivor.canonicalName || candidate.sourceName || candidate.targetName
    const survivorProjection = await refreshIdentityProjection(client, survivor.id, preferredName)
    const loserProjection = loser ? await refreshIdentityProjection(client, loser.id) : null
    const summary = {
        sourceIdentityId: sourceIdentity.id,
        targetIdentityId: targetIdentity.id,
        survivorIdentityId: survivor.id,
        retiredIdentityId: loser?.id || null,
        createdIdentityIds: identities.filter((identity) => identity.created).map((identity) => identity.id),
        membersMoved: movedMembers.length,
        survivorComponentKey: survivorProjection.componentKey,
        retiredComponentKey: loserProjection?.componentKey || null,
        manualCanonicalMerge,
    }
    await client.query(`update crm_atendimento.identity_materialization_runs set previous_fingerprint=$2,summary=$3::jsonb where id=$1::uuid`,
        [run.id, before, JSON.stringify(summary)])
    return { ...run, summary }
}

async function materializeIdentityReviewReversal(client, { candidate, reversesDecision, actor }) {
    const originalRunId = String(reversesDecision.materialization_run_id || '').trim()
    if (!originalRunId) throw identityReviewError('IDENTITY_REVIEW_UNDO_NOT_MATERIALIZED', 409)
    const originalRun = await client.query(`select id::text,status,summary from crm_atendimento.identity_materialization_runs
        where id=$1::uuid for update`, [originalRunId])
    if (originalRun.rows[0]?.status !== 'applied') throw identityReviewError('IDENTITY_REVIEW_UNDO_NOT_MATERIALIZED', 409)
    const history = await client.query(`select event_order,source_type,source_id,previous_identity_id::text,next_identity_id::text,change_kind
        from crm_atendimento.identity_member_history where materialization_run_id=$1::uuid
        order by event_order desc for update`, [originalRunId])
    const originalSummary = originalRun.rows[0]?.summary || {}
    const identityIds = [...new Set([
        ...history.rows.flatMap((row) => [row.previous_identity_id, row.next_identity_id]),
        originalSummary.sourceIdentityId,
        originalSummary.targetIdentityId,
        originalSummary.survivorIdentityId,
        originalSummary.retiredIdentityId,
    ].filter(Boolean))]
    await acquireCommercialIdentityLocks(client, identityIds)
    await assertNoCommercialIdentityHistory(client, identityIds)
    const inputFingerprint = identityMaterializationFingerprint({ reverse: originalRunId, sourceVersion: candidate.version })
    const run = await createIdentityMaterializationRun(client, {
        mode: 'reverse', status: 'applied', inputFingerprint,
        previousFingerprint: originalRunId, actor,
    })
    for (const row of history.rows) {
        if (row.change_kind === 'moved') {
            const restored = await client.query(`update crm_atendimento.global_client_identity_members set identity_id=$3::uuid,updated_at=now()
                where source_type=$1 and source_id=$2 and identity_id=$4::uuid`, [row.source_type, row.source_id, row.previous_identity_id, row.next_identity_id])
            if (restored.rowCount !== 1) throw identityReviewError('IDENTITY_REVIEW_UNDO_DEPENDENCY_CHANGED', 409)
            await insertIdentityMemberHistory(client, {
                runId: run.id, member: { sourceType: row.source_type, sourceId: row.source_id },
                previousIdentityId: row.next_identity_id, nextIdentityId: row.previous_identity_id, changeKind: 'restored',
            })
            await client.query(`insert into crm_atendimento.identity_lineage(
                materialization_run_id,predecessor_identity_id,successor_identity_id,relation)
                values($1::uuid,$2::uuid,$3::uuid,'split_from')`, [run.id, row.next_identity_id, row.previous_identity_id])
        } else if (row.change_kind === 'created') {
            const removed = await client.query(`delete from crm_atendimento.global_client_identity_members
                where source_type=$1 and source_id=$2 and identity_id=$3::uuid`, [row.source_type, row.source_id, row.next_identity_id])
            if (removed.rowCount !== 1) throw identityReviewError('IDENTITY_REVIEW_UNDO_DEPENDENCY_CHANGED', 409)
            await insertIdentityMemberHistory(client, {
                runId: run.id, member: { sourceType: row.source_type, sourceId: row.source_id },
                previousIdentityId: row.next_identity_id, nextIdentityId: null, changeKind: 'restored',
            })
        }
    }
    await reverseManualCanonicalMerge(client, originalSummary.manualCanonicalMerge)
    for (const identityId of identityIds) await refreshIdentityProjection(client, identityId)
    const summary = { reversesRunId: originalRunId, restoredMembers: history.rows.length, manualCanonicalMergeReversed: !!originalSummary.manualCanonicalMerge }
    await updateIdentityMaterializationRun(client, run.id, summary)
    return { ...run, summary }
}

function identityClusterSourceFreshness(updatedAt, now = new Date()) {
    if (!updatedAt) return 'unknown'
    const timestamp = new Date(updatedAt).getTime()
    if (!Number.isFinite(timestamp)) return 'unknown'
    return (now.getTime() - timestamp) > (48 * 60 * 60 * 1000) ? 'stale' : 'current'
}

async function identityClusterWorkspaceStatus(pgPool) {
    const availability = await pgPool.query(`select
        to_regclass('crm_atendimento.schema_migrations') as registry,
        to_regclass('crm_atendimento.identity_review_cluster_operations') as operations,
        to_regclass('crm_atendimento.identity_review_cluster_reveals') as reveals,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.identity_review_cluster_operations')
            and tgname='identity_review_cluster_operations_immutable' and tgenabled='O') as operations_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.identity_review_cluster_reveals')
            and tgname='identity_review_cluster_reveals_immutable' and tgenabled='O') as reveals_immutable`)
    const row = availability.rows[0] || {}
    if (!row.registry || !row.operations || !row.reveals || !row.operations_immutable || !row.reveals_immutable) {
        return { ready: false, migrationId: IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID }
    }
    const migration = await pgPool.query(`select id from crm_atendimento.schema_migrations where id=$1 and rolled_back_at is null`, [IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID])
    return { ready: !!migration.rows[0]?.id, migrationId: IDENTITY_CLUSTER_WORKSPACE_MIGRATION_ID }
}

function clusterEdgeSql() {
    return [
        `select 'attendance_name_merge'::text as review_type, m.left_client_id::text as source_id, m.right_client_id::text as target_id,
                'attendance_client'::text as source_type, 'attendance_client'::text as target_type, m.status,
                m.similarity::numeric as confidence, 'name'::text as method, m.evidence,
                md5(jsonb_build_object('type','attendance_name_merge','sourceId',m.left_client_id::text,
                    'targetId',m.right_client_id::text,'status',m.status,'confidence',m.similarity,'evidence',m.evidence)::text) as source_version,
                case when m.status='ambiguous' then 2 else 1 end as candidate_count,
                false as validated_match, m.updated_at
         from crm_atendimento.client_merge_suggestions m
         where m.status in ('pending','confirmed','rejected')`,
        `select 'attendance_caixa'::text, link.client_id::text, link.caixa_customer_id::text,
                'attendance_client'::text, 'caixa_customer'::text, link.status, link.confidence::numeric,
                link.method, link.evidence,
                md5(jsonb_build_object('type','attendance_caixa','sourceId',link.client_id::text,
                    'targetId',link.caixa_customer_id::text,'status',link.status,'method',link.method,
                    'confidence',link.confidence,'evidence',link.evidence)::text),
                case when link.status='ambiguous' then 2 else 1 end,
                link.method ~ '(phone|email)', link.updated_at
         from crm_atendimento.client_caixa_links link
         where link.status in ('suggested','ambiguous','confirmed','rejected','auto_confirmed')`,
        `select 'app_attendance'::text, link.app_registration_id, link.client_id::text,
                'app_registration'::text, 'attendance_client'::text, link.status, link.confidence::numeric,
                link.method, link.evidence,
                md5(jsonb_build_object('type','app_attendance','sourceId',link.app_registration_id,
                    'targetId',link.client_id::text,'status',link.status,'method',link.method,
                    'confidence',link.confidence,'evidence',link.evidence)::text),
                case when link.status='ambiguous' then 2 else 1 end,
                link.method ~ '(phone|email)', link.updated_at
         from crm_atendimento.app_registration_attendance_links link
         where link.status in ('suggested','ambiguous','confirmed','rejected','auto_confirmed')`,
        `select 'app_caixa'::text, link.app_registration_id, link.caixa_customer_id::text,
                'app_registration'::text, 'caixa_customer'::text, link.status, link.confidence::numeric,
                link.method, link.evidence,
                md5(jsonb_build_object('type','app_caixa','sourceId',link.app_registration_id,
                    'targetId',link.caixa_customer_id::text,'status',link.status,'method',link.method,
                    'confidence',link.confidence,'evidence',link.evidence)::text),
                case when link.status='ambiguous' then 2 else 1 end,
                link.method ~ '(phone|email)', link.updated_at
         from crm_atendimento.app_registration_caixa_links link
         where link.status in ('suggested','ambiguous','confirmed','rejected','auto_confirmed')`,
        `select 'lead_app'::text, link.source_profile_id, link.app_registration_id,
                'lead_profile'::text, 'app_registration'::text, link.status, link.confidence::numeric,
                link.method, link.evidence,
                md5(jsonb_build_object('type','lead_app','sourceId',link.source_profile_id,
                    'targetId',link.app_registration_id,'status',link.status,'method',link.method,
                    'confidence',link.confidence,'evidence',link.evidence)::text),
                case when link.status='ambiguous' then 2 else 1 end,
                link.method ~ '(phone|email)', link.updated_at
         from crm_atendimento.supplemental_lead_profile_app_links link
         where link.status in ('suggested','ambiguous','confirmed','rejected','auto_confirmed')`,
        `select 'lead_caixa'::text, link.source_profile_id, link.caixa_customer_id::text,
                'lead_profile'::text, 'caixa_customer'::text, link.status, link.confidence::numeric,
                link.method, link.evidence,
                md5(jsonb_build_object('type','lead_caixa','sourceId',link.source_profile_id,
                    'targetId',link.caixa_customer_id::text,'status',link.status,'method',link.method,
                    'confidence',link.confidence,'evidence',link.evidence)::text),
                case when link.status='ambiguous' then 2 else 1 end,
                link.method ~ '(phone|email)', link.updated_at
         from crm_atendimento.supplemental_lead_profile_caixa_links link
         where link.status in ('suggested','ambiguous','confirmed','rejected','auto_confirmed')`,
    ].join(' union all ')
}

async function queryIdentityClusterGraph(pgPool, actor, query = {}) {
    const unitSlugs = commercialUnitSlugsForQuery(actor, query.unit)
    const now = new Date()
    const [identityMembers, attendance, caixa, app, leads, edgeResult, decisions, lineage, sourceLinkHistory, history] = await Promise.all([
        pgPool.query(`select member.identity_id::text as identity_id, identity.canonical_name as identity_name,
                identity.created_at as identity_created_at, member.source_type, member.source_id, member.updated_at
             from crm_atendimento.global_client_identity_members member
             join crm_atendimento.global_client_identities identity on identity.id=member.identity_id`),
        pgPool.query(`select 'attendance_client'::text as source_type, client.id::text as source_id,
                client.canonical_name as name,
                coalesce(array_agg(distinct alias.alias_name order by alias.alias_name) filter (where alias.alias_name is not null), '{}'::text[]) as aliases,
                coalesce(array_agg(distinct unit.slug order by unit.slug) filter (where unit.slug is not null), '{}'::text[]) as unit_slugs,
                '{}'::jsonb as phone_keys, '{}'::jsonb as email_keys, '{}'::jsonb as cpf_keys, client.updated_at,
                md5(concat_ws('|',client.id::text,client.canonical_name,client.updated_at::text)) as source_fingerprint
             from crm_atendimento.canonical_clients client
             left join crm_atendimento.client_aliases alias on alias.client_id=client.id
             left join crm_atendimento.attendance_client_links link on link.client_id=client.id
             left join crm_atendimento.attendances attendance on attendance.id=link.attendance_id and attendance.deleted_at is null
             left join crm_atendimento.units unit on unit.id=attendance.unit_id
             group by client.id, client.canonical_name, client.updated_at`),
        pgPool.query(`select 'caixa_customer'::text as source_type, customer.id::text as source_id,
                customer.name, '{}'::text[] as aliases,
                coalesce(array_agg(distinct unit.slug order by unit.slug) filter (where unit.slug is not null), '{}'::text[]) as unit_slugs,
                case when nullif(customer.phone_key,'') is null then '[]'::jsonb else jsonb_build_array(customer.phone_key) end as phone_keys,
                '[]'::jsonb as email_keys, '[]'::jsonb as cpf_keys, customer.updated_at,
                md5(concat_ws('|',customer.id::text,customer.name,customer.phone_key,customer.updated_at::text)) as source_fingerprint
             from crm_caixa.customers customer
             left join crm_caixa.sales sale on sale.customer_id=customer.id
             left join crm_atendimento.units unit on unit.id=sale.unit_id
             group by customer.id, customer.name, customer.phone_key, customer.updated_at`),
        pgPool.query(`select 'app_registration'::text as source_type, source_client_id as source_id,
                canonical_name as name, name_variants as aliases, unit_slugs, phone_keys, email_keys, cpf_keys, updated_at,
                md5(jsonb_build_object('id',source_client_id,'name',canonical_name,'phones',phone_keys,'emails',email_keys,
                    'units',unit_slugs,'updatedAt',updated_at)::text) as source_fingerprint
             from crm_atendimento.app_client_registrations`),
        pgPool.query(`select 'lead_profile'::text as source_type, source_profile_id as source_id,
                canonical_name as name, name_variants as aliases, unit_slugs, phone_keys, email_keys, '{}'::jsonb as cpf_keys, updated_at,
                md5(jsonb_build_object('id',source_profile_id,'name',canonical_name,'phones',phone_keys,'emails',email_keys,
                    'units',unit_slugs,'updatedAt',updated_at)::text) as source_fingerprint
             from crm_atendimento.supplemental_lead_profiles`),
        pgPool.query(`select * from (${clusterEdgeSql()}) edges`),
        pgPool.query(`select decision.event_order, decision.review_type, decision.source_id, decision.target_id, decision.decision,
                decision.resulting_status, decision.source_version, decision.created_at,
                decision.materialization_run_id::text as materialization_run_id,
                run.mode as run_mode, run.status as run_status, run.created_at as run_created_at,
                coalesce(case when run.summary->>'membersMoved' ~ '^[0-9]+$'
                    then (run.summary->>'membersMoved')::int else 0 end, 0) as run_members_moved
             from crm_atendimento.identity_review_decisions decision
             left join crm_atendimento.identity_materialization_runs run on run.id=decision.materialization_run_id
             order by decision.created_at desc`),
        pgPool.query(`select predecessor_identity_id::text as predecessor_identity_id, successor_identity_id::text as successor_identity_id,
                relation, created_at from crm_atendimento.identity_lineage order by created_at desc`),
        pgPool.query(`select link_type as review_type, source_type, source_id, target_type, target_id,
                transition, resulting_status, origin, created_at
             from crm_atendimento.identity_source_link_history order by created_at desc`),
        pgPool.query(`select identity_id::text as identity_id,
                count(*) filter (where source='commercial_action')::int as actions,
                count(*) filter (where source='commercial_permission')::int as permissions,
                count(*) filter (where source='commercial_permission_event')::int as permission_events,
                count(*) filter (where source='identity_audit')::int as audit_identity_events
             from (
                select action.identity_id, 'commercial_action'::text as source from crm_atendimento.commercial_actions action
                union all select permission.identity_id, 'commercial_permission'::text from crm_atendimento.commercial_contact_permissions permission
                union all select event.identity_id, 'commercial_permission_event'::text from crm_atendimento.commercial_contact_permission_events event
                union all select case when payload->>'identityId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (payload->>'identityId')::uuid else null end, 'identity_audit'::text from crm_atendimento.audit_events
                 where nullif(payload->>'identityId','') is not null
             ) events group by identity_id`),
    ])
    const sourceMap = new Map()
    for (const row of [...attendance.rows, ...caixa.rows, ...app.rows, ...leads.rows]) {
        sourceMap.set(`${row.source_type}:${row.source_id}`, {
            sourceType: row.source_type,
            sourceId: row.source_id,
            name: row.name,
            canonicalName: row.name,
            aliases: row.aliases,
            unitSlugs: row.unit_slugs,
            phoneKeys: row.phone_keys,
            emailKeys: row.email_keys,
            cpfKeys: row.cpf_keys,
            updatedAt: row.updated_at,
            sourceFingerprint: row.source_fingerprint,
            sourceFreshness: identityClusterSourceFreshness(row.updated_at, now),
        })
    }
    const members = identityMembers.rows.map((row) => ({
        ...(sourceMap.get(`${row.source_type}:${row.source_id}`) || {}),
        sourceType: row.source_type,
        sourceId: row.source_id,
        identityId: row.identity_id,
        identityName: row.identity_name,
        identityCreatedAt: row.identity_created_at,
        updatedAt: sourceMap.get(`${row.source_type}:${row.source_id}`)?.updatedAt || row.updated_at,
    }))
    const materializedMemberKeys = new Set(members.map((member) => `${member.sourceType}:${member.sourceId}`))
    for (const source of sourceMap.values()) {
        const key = `${source.sourceType}:${source.sourceId}`
        if (materializedMemberKeys.has(key)) continue
        members.push({ ...source, identityId: null, identityName: source.name, identityCreatedAt: null })
    }
    const edges = edgeResult.rows.map((row) => ({
        reviewType: row.review_type,
        sourceType: row.source_type,
        sourceId: row.source_id,
        targetType: row.target_type,
        targetId: row.target_id,
        status: row.status,
        confidence: Number(row.confidence || 0),
        method: row.method,
        evidence: row.evidence || {},
        matchedFields: row.evidence?.matchedFields || row.evidence?.sharedFields || [],
        sharedUnits: row.evidence?.sharedUnits || [],
        sourceVersion: row.source_version,
        candidateCount: Number(row.candidate_count || 1),
        validatedMatch: row.validated_match === true,
        changedAfterDecision: false,
    }))
    const automaticLinkHistory = sourceLinkHistory.rows.map((row) => ({
            reviewType: row.review_type,
            sourceType: row.source_type,
            sourceId: row.source_id,
            targetType: row.target_type,
            targetId: row.target_id,
            transition: row.transition,
            resultingStatus: row.resulting_status,
            origin: row.origin,
            createdAt: row.created_at,
        }))
    const historyByIdentity = Object.fromEntries(history.rows.map((row) => [row.identity_id, row]))
    const clusters = buildIdentityReviewClusterPresentation({
        members,
        edges,
        decisions: decisions.rows,
        lineage: lineage.rows,
        automaticLinkHistory,
        historyByIdentity,
        unitScope: unitSlugs,
        now,
        includeInternals: true,
    })
    const search = normalizeText(query.q || query.search || '')
    const includeResolved = String(query.includeResolved || '').toLowerCase() === 'true'
    const staleOnly = String(query.stale || '').toLowerCase() === 'true'
    const status = String(query.status || '').trim()
    const filtered = clusters.filter((cluster) => {
        if (!includeResolved && ['confirmed', 'rejected'].includes(cluster.decision.state)) return false
        if (staleOnly && cluster.staleState !== 'stale') return false
        if (status && cluster.decision.state !== status) return false
        if (!search) return true
        const haystack = cluster._members.flatMap((member) => [member.name, ...member.aliases, ...member.units]).join(' ').toLowerCase()
        return haystack.includes(search)
    })
    return { clusters: filtered, unitSlugs, graph: { members: members.length, edges: edges.length }, workflow: await identityReviewWorkflowStatus(pgPool), workspace: await identityClusterWorkspaceStatus(pgPool) }
}

function findIdentityCluster(clusters, clusterKey) {
    const key = String(clusterKey || '').trim()
    return clusters.find((cluster) => cluster.clusterKey === key) || null
}

async function assertIdentityClusterWorkspaceReady(pgPool) {
    const status = await identityClusterWorkspaceStatus(pgPool)
    if (status.ready) return status
    const error = new Error('IDENTITY_CLUSTER_WORKSPACE_NOT_READY')
    error.statusCode = 409
    throw error
}

function identityClusterExpectedVersions(payload = {}) {
    const map = payload.expectedVersions && typeof payload.expectedVersions === 'object' ? payload.expectedVersions : {}
    return map
}

async function applyIdentityClusterBulkTransaction(client, payload, actor) {
    const requestedKeys = [...new Set((Array.isArray(payload.clusterKeys) ? payload.clusterKeys : []).map(String).map((value) => value.trim()).filter(Boolean))]
    if (!requestedKeys.length || requestedKeys.length > 50) throw identityReviewError('IDENTITY_CLUSTER_BULK_SELECTION_REQUIRED', 400)
    const expectedVersions = identityClusterExpectedVersions(payload)
    const reason = String(payload.reason || '').trim()
    const idempotencyKey = normalizeIdempotencyKey(payload.idempotencyKey)
    if (!idempotencyKey) throw identityReviewError('IDENTITY_CLUSTER_IDEMPOTENCY_KEY_REQUIRED', 400)
    if (reason.length < 3 || reason.length > 1000) throw identityReviewError('IDENTITY_CLUSTER_REASON_REQUIRED', 400)
    const graph = await queryIdentityClusterGraph(client, actor, { unit: payload.unit, includeResolved: true })
    const results = []
    let membersMoved = 0
    for (const clusterKey of requestedKeys) {
        const cluster = findIdentityCluster(graph.clusters, clusterKey)
        if (!cluster) throw identityReviewError('IDENTITY_CLUSTER_NOT_FOUND', 404)
        const expectedVersion = String(expectedVersions[clusterKey] || '').trim()
        if (!expectedVersion || expectedVersion !== cluster.version) throw identityReviewError('IDENTITY_CLUSTER_CONFLICT', 409)
        if (!cluster.bulkReview.eligible) throw identityReviewError('IDENTITY_CLUSTER_BULK_NOT_ELIGIBLE', 409)
        const operationKey = `${idempotencyKey}:${clusterKey}`
        const requestFingerprint = digestClusterValue(JSON.stringify({ clusterKey, expectedVersion, reason }))
        const existing = await client.query(`select status,result,request_fingerprint from crm_atendimento.identity_review_cluster_operations where operation_key=$1 for update`, [operationKey])
        if (existing.rows[0]) {
            if (existing.rows[0].request_fingerprint !== requestFingerprint) throw identityReviewError('IDENTITY_CLUSTER_IDEMPOTENCY_CONFLICT', 409)
            results.push({ clusterKey, status: existing.rows[0].status, result: existing.rows[0].result || {} })
            continue
        }
        let clusterMoved = 0
        for (const edge of cluster._edges) {
            const normalized = { reviewType: edge.reviewType, sourceId: edge.sourceId, targetId: edge.targetId, survivorClientId: null }
            await acquireIdentityReviewLocks(client, { ...normalized, ...IDENTITY_REVIEW_DEFINITIONS[edge.reviewType] })
            const candidate = await readIdentityReviewCandidate(client, normalized)
            await assertCommercialReviewCandidateScope(client, actor, candidate)
            assertIdentityReviewCandidateVersion(candidate, edge.sourceVersion)
            const latest = await readLatestIdentityReviewDecision(client, candidate)
            assertNoCurrentIdentityReviewDecision(latest, candidate)
            const sourceState = await writeIdentityReviewSourceStatus(client, candidate, 'confirmed', actor)
            const materialization = await materializeIdentityReviewConfirmation(client, { candidate, actor })
            const sourceLinkTransitions = await recordIdentityReviewSourceLinkTransition(client, {
                materializationRunId: materialization.id,
                candidate,
                previousStatus: candidate.rawStatus,
                resultingStatus: sourceState.rawStatus,
                origin: 'manager_identity_cluster_bulk_review',
            })
            const decision = await createIdentityReviewDecision(client, {
                candidate, decision: 'confirmed', reason, actor,
                materializationRunId: materialization.id,
                resultingStatus: sourceState.rawStatus,
                sourceVersion: sourceState.version,
                sourceSnapshot: { clusterKey, previousSourceVersion: candidate.version },
            })
            clusterMoved += Number(materialization.summary?.membersMoved || 0)
            await audit(client, 'client-identity.cluster.bulk-confirmed', actor, null, {
                clusterKey, decisionId: decision.id, materializationRunId: materialization.id,
                membersMoved: Number(materialization.summary?.membersMoved || 0), sourceLinkTransitions: sourceLinkTransitions.length,
            })
        }
        const result = { clusterKey, membersMoved: clusterMoved, decisionState: 'confirmed' }
        await client.query(`insert into crm_atendimento.identity_review_cluster_operations(
                operation_key,cluster_key,operation,request_fingerprint,status,actor,result)
            values($1,$2,'bulk_confirm',$3,'applied',$4::jsonb,$5::jsonb)`, [
            operationKey, clusterKey, requestFingerprint,
            JSON.stringify({ id: actorIdentityForMutation(actor), role: actor?.role || '' }), JSON.stringify(result),
        ])
        results.push(result)
        membersMoved += clusterMoved
    }
    return { schemaVersion: 'crm-identity-cluster/v1', idempotent: results.some((result) => result.status), appliedClusters: results.length, membersMoved, results }
}

async function revealIdentityCluster(client, payload, actor) {
    const normalized = assertExplicitIdentityClusterPayload(payload)
    const fields = explicitRevealFields(payload)
    const graph = await queryIdentityClusterGraph(client, actor, { unit: payload.unit, includeResolved: true })
    const cluster = findIdentityCluster(graph.clusters, payload.clusterKey)
    if (!cluster) throw identityReviewError('IDENTITY_CLUSTER_NOT_FOUND', 404)
    if (cluster.version !== normalized.expectedVersion) throw identityReviewError('IDENTITY_CLUSTER_CONFLICT', 409)
    const actorIdentity = actorIdentityForMutation(actor)
    const reasonDigest = digestClusterValue(normalized.reason)
    const inserted = await client.query(`insert into crm_atendimento.identity_review_cluster_reveals(
            cluster_key,cluster_version,fields,reason_digest,actor,unit_scope)
        values($1,$2,$3::jsonb,$4,$5::jsonb,$6::jsonb) returning id::text,created_at`, [
        cluster.clusterKey, cluster.version, JSON.stringify(fields), reasonDigest,
        JSON.stringify({ id: actorIdentity, role: actor?.role || '' }), JSON.stringify(graph.unitSlugs || []),
    ])
    await audit(client, 'client-identity.cluster.contact-revealed', actor, null, {
        clusterKey: cluster.clusterKey, clusterVersion: cluster.version, fields, reasonDigest,
    })
    const contacts = cluster._members.map((member) => ({
        sourceLabel: sourceLabelForClusterMember(member.sourceType),
        name: member.name,
        phone: fields.includes('phone') ? [...new Set(member.phoneKeys)].filter(Boolean) : [],
        email: fields.includes('email') ? [...new Set(member.emailKeys)].filter(Boolean) : [],
    })).filter((entry) => entry.phone.length || entry.email.length)
    return {
        clusterKey: cluster.clusterKey,
        version: cluster.version,
        auditId: inserted.rows[0]?.id || null,
        revealedAt: inserted.rows[0]?.created_at || null,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        contacts,
        privacy: { explicitAction: true, reasonRecorded: true, metricsAndLogsRedacted: true },
    }
}

function sourceLabelForClusterMember(sourceType) {
    return ({ attendance_client: 'Atendimento', caixa_customer: 'Caixa', app_registration: 'Cadastro do app', lead_profile: 'Leads e planilhas' })[sourceType] || 'Fonte'
}

export function createAtendimentoStore(options = {}) {
    const pgPool = options.pool || createAtendimentoPool(options.databaseUrl)
    const schemaManaged = options.schemaManaged === true || String(process.env.CRM_ATENDIMENTO_SCHEMA_MANAGED || '').trim().toLowerCase() === 'true'
    let readinessPromise = null

    async function ensureReady() {
        requirePool(pgPool)
        if (schemaManaged) return
        if (!readinessPromise) {
            readinessPromise = withPgTransaction(pgPool, migrateAtendimento)
                .catch((error) => {
                    // Do not cache a failed initialization: an operator may repair the
                    // database state and the next request must be allowed to retry.
                    readinessPromise = null
                    throw error
                })
        }
        await readinessPromise
    }

    return {
        async health() {
            return {
                ok: !!pgPool,
                databaseConfigured: !!pgPool,
            }
        },

        async migrate() {
            await ensureReady()
            return { ok: true }
        },

        async localMirrorStatus() {
            await ensureReady()
            const [state, counts, range] = await Promise.all([
                pgPool.query(`select mode, synced_at, row_counts, min_service_date::text, max_service_date::text, updated_at from crm_atendimento.local_mirror_state where singleton = true`),
                pgPool.query(`select count(*)::int as attendances from crm_atendimento.attendances where deleted_at is null`),
                pgPool.query(`select min(service_date)::text as min_service_date, max(service_date)::text as max_service_date from crm_atendimento.attendances where deleted_at is null`),
            ])
            const mirror = state.rows[0] || {}
            const dateRange = range.rows[0] || {}
            return {
                mode: mirror.mode || 'local-sandbox',
                syncedAt: mirror.synced_at || null,
                updatedAt: mirror.updated_at || null,
                rowCounts: mirror.row_counts || {},
                attendances: Number(counts.rows[0]?.attendances || 0),
                minServiceDate: mirror.min_service_date || dateRange.min_service_date || null,
                maxServiceDate: mirror.max_service_date || dateRange.max_service_date || null,
            }
        },

        async doctorConversionConfig() {
            await ensureReady()
            return { config: await readDoctorConversionConfig(pgPool) }
        },

        async updateDoctorConversionConfig(payload, actor) {
            await ensureReady()
            if (!roleCanManage(actor)) {
                const error = new Error('FORBIDDEN')
                error.statusCode = 403
                throw error
            }
            const config = await writeDoctorConversionConfig(pgPool, payload || {}, actor)
            await audit(pgPool, 'doctor-conversion.config.updated', actor, null, {
                configHash: config.configHash,
            })
            return { config }
        },

        async doctorConversionHistory(query, actor) {
            await ensureReady()
            return { history: await queryDoctorConversionHistory(pgPool, query || {}, actor) }
        },

        async doctorConversionResult(query, actor) {
            await ensureReady()
            const history = await queryDoctorConversionHistory(pgPool, { ...(query || {}), limit: 1 }, actor)
            if (!history.length) return { result: null }
            const payload = await pgPool.query(
                `select payload from crm_atendimento.doctor_conversion_results where id = $1 limit 1`,
                [history[0].id],
            )
            return {
                result: {
                    ...history[0],
                    payload: payload.rows[0]?.payload || null,
                },
            }
        },

        async optimizeDoctorConversion(payload, actor) {
            if (!roleCanManage(actor)) {
                const error = new Error('FORBIDDEN')
                error.statusCode = 403
                throw error
            }
            const query = resolveDoctorConversionOperationQuery(payload || {})
            const report = await this.managementConversionReport(query, actor, { persist: true, syncSchedule: true })
            const requestedUnit = normalizeUnit(query.unit || '').slug
            const sections = report.doctorRanking?.sections || []
            const section = sections.find((item) => item.unitSlug === requestedUnit && !item.isAggregate)
                || sections.find((item) => !item.isAggregate)
                || null
            return {
                result: section,
                config: await readDoctorConversionConfig(pgPool),
            }
        },

        async recomputeDoctorConversions(payload, actor) {
            await ensureReady()
            if (!roleCanManage(actor)) {
                const error = new Error('FORBIDDEN')
                error.statusCode = 403
                throw error
            }
            const periods = Array.isArray(payload?.periods) && payload.periods.length
                ? payload.periods
                : [payload || {}]
            if (periods.length > 104) {
                const error = new Error('TOO_MANY_CONVERSION_PERIODS')
                error.statusCode = 400
                throw error
            }
            const results = []
            for (const periodPayload of periods) {
                const query = resolveDoctorConversionOperationQuery({ ...payload, ...periodPayload })
                if (!query.from || !query.to) {
                    const error = new Error('CONVERSION_PERIOD_REQUIRED')
                    error.statusCode = 400
                    throw error
                }
                const report = await this.managementConversionReport(query, actor, { persist: true, syncSchedule: true })
                results.push(...(report.doctorRanking?.sections || [])
                    .filter((section) => !section.isAggregate)
                    .map((section) => ({
                        unitSlug: section.unitSlug,
                        period: section.period,
                        optimization: section.optimization,
                    })))
            }
            return { recomputed: results.length, results }
        },

        async references(actor) {
            await ensureReady()
            const units = await pgPool.query(`select slug, name from crm_atendimento.units order by name`)
            const professionals = { rows: await readProfessionalIdentityRows(pgPool) }
            const procedures = await pgPool.query(
                `select p.id, p.name, p.aliases, coalesce(json_agg(c.code order by c.code) filter (where c.code is not null), '[]'::json) as codes
                 from crm_atendimento.procedures p
                 left join crm_atendimento.procedure_price_codes c on c.procedure_id = p.id and c.allowed = true
                 group by p.id, p.name, p.aliases
                 order by p.name`,
            )
            const visibleUnits = units.rows
                    .filter((row) => actorCanReadUnit(actor, row.slug))
                    .map((row) => ({ slug: row.slug, name: row.name }))
            return {
                units: visibleUnits,
                professionals: consolidateProfessionalReferences(
                    professionals.rows.filter((row) => professionalMatchesAllowedUnits(row, actor)),
                    false,
                ),
                actorConsultantByUnit: actorConsultantReferenceByUnit(actor, visibleUnits, professionals.rows),
                procedures: procedures.rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    aliases: Array.isArray(row.aliases) ? row.aliases : [],
                    codes: Array.isArray(row.codes) ? row.codes : [],
                })),
            }
        },

        async commercialReferences(actor) {
            await ensureReady()
            assertCommercialManager(actor)
            const [units, professionals, procedures] = await Promise.all([
                pgPool.query(`select slug, name from crm_atendimento.units order by name`),
                readProfessionalIdentityRows(pgPool),
                pgPool.query(
                    `select p.id, p.name, p.aliases, coalesce(json_agg(c.code order by c.code) filter (where c.code is not null), '[]'::json) as codes
                     from crm_atendimento.procedures p
                     left join crm_atendimento.procedure_price_codes c on c.procedure_id = p.id and c.allowed = true
                     group by p.id, p.name, p.aliases
                     order by p.name`,
                ),
            ])
            const visibleUnits = commercialUnitRowsForActor(units.rows, actor)
                .map((row) => ({ slug: row.slug, name: row.name }))
            const visibleProfessionals = professionals.filter((row) => professionalMatchesCommercialUnitScope(row, actor))
            return {
                units: visibleUnits,
                professionals: consolidateProfessionalReferences(visibleProfessionals, false),
                actorConsultantByUnit: actorConsultantReferenceByUnit(actor, visibleUnits, professionals),
                procedures: procedures.rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    aliases: Array.isArray(row.aliases) ? row.aliases : [],
                    codes: Array.isArray(row.codes) ? row.codes : [],
                })),
            }
        },

        async commercialOffers(query, actor) {
            await ensureReady()
            const where = []
            const params = []
            const unitSlugs = commercialUnitSlugsForQuery(actor, query?.unit)
            if (unitSlugs !== null) {
                params.push(unitSlugs)
                where.push(`u.slug = any($${params.length}::text[])`)
            }
            const status = String(query?.status || '').trim().toLowerCase()
            if (status && status !== 'all') {
                if (!COMMERCIAL_OFFER_STATUSES.has(status)) throw commercialOfferError('INVALID_OFFER_STATUS')
                params.push(status)
                where.push(`o.status = $${params.length}`)
            }
            const sql = commercialOfferSelect(where.length ? `where ${where.join(' and ')}` : '')
            const result = await pgPool.query(sql, params)
            return { offers: result.rows.map(mapCommercialOffer) }
        },

        async upsertCommercialOffer(payload, actor) {
            await ensureReady()
            if (!roleCanManage(actor)) throw commercialOfferError('FORBIDDEN', 403)
            const normalized = normalizeCommercialOfferPayload(payload)
            const unitSlug = normalizeUnit(payload?.unitSlug || '').slug
            if (!unitSlug) throw commercialOfferError('UNIT_REQUIRED')
            assertCommercialUnitInScope(actor, unitSlug)
            return withPgTransaction(pgPool, async (client) => {
                const unit = await client.query(
                    `select id, slug from crm_atendimento.units where slug = $1 limit 1`,
                    [unitSlug],
                )
                if (!unit.rows[0]) throw commercialOfferError('UNIT_NOT_FOUND', 404)
                const approved = normalized.status === 'approved' || normalized.status === 'active'
                const offer = await client.query(
                    `insert into crm_atendimento.commercial_offers(
                        unit_id, offer_key, title, description, status, price_cents, currency, price_qualifier,
                        installment_count, installment_value_cents, discount_percent, conditions, validity_start, validity_end,
                        approved_by, approved_at, created_by, updated_by
                     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                        case when $15 then $16 else null end, case when $15 then now() else null end, $16, $16)
                     on conflict(unit_id, offer_key) do update set
                        title = excluded.title, description = excluded.description, status = excluded.status,
                        price_cents = excluded.price_cents, currency = excluded.currency, price_qualifier = excluded.price_qualifier,
                        installment_count = excluded.installment_count, installment_value_cents = excluded.installment_value_cents,
                        discount_percent = excluded.discount_percent, conditions = excluded.conditions,
                        validity_start = excluded.validity_start, validity_end = excluded.validity_end,
                        revision = crm_atendimento.commercial_offers.revision + 1,
                        approved_by = case when $15 then $16 else crm_atendimento.commercial_offers.approved_by end,
                        approved_at = case when $15 then now() else crm_atendimento.commercial_offers.approved_at end,
                        updated_by = $16, updated_at = now()
                     returning id`,
                    [
                        unit.rows[0].id, normalized.offerKey, normalized.title, normalized.description, normalized.status,
                        normalized.priceCents, normalized.currency, normalized.priceQualifier, normalized.installmentCount,
                        normalized.installmentValueCents, normalized.discountPercent, normalized.conditions,
                        normalized.validityStart, normalized.validityEnd, approved, actorLabel(actor),
                    ],
                )
                const offerId = offer.rows[0].id
                await client.query(`delete from crm_atendimento.commercial_offer_procedures where offer_id = $1`, [offerId])
                for (const procedure of normalized.procedures) {
                    const found = await client.query(`select id from crm_atendimento.procedures where id = $1 limit 1`, [procedure.procedureId])
                    if (!found.rows[0]) throw commercialOfferError('OFFER_PROCEDURE_NOT_FOUND', 404)
                    await client.query(
                        `insert into crm_atendimento.commercial_offer_procedures(offer_id, procedure_id, quantity, quantity_unit, display_order)
                         values ($1,$2,$3,$4,$5)`,
                        [offerId, procedure.procedureId, procedure.quantity, procedure.quantityUnit, procedure.displayOrder],
                    )
                }
                const result = await client.query(commercialOfferSelect('where o.id = $1'), [offerId])
                const mapped = mapCommercialOffer(result.rows[0])
                await audit(client, 'commercial-offer.upserted', actor, null, {
                    offerId: mapped.offerId,
                    offerKey: mapped.offerKey,
                    unitSlug: mapped.unitSlug,
                    status: mapped.status,
                    revision: mapped.revision,
                    contextHash: mapped.contextHash,
                })
                return { offer: mapped }
            })
        },

        async metaAdsOfferContext(query) {
            await ensureReady()
            const unitSlug = normalizeUnit(query?.unit || '').slug
            if (!unitSlug) throw commercialOfferError('UNIT_REQUIRED')
            const offerKey = String(query?.offerKey || '').trim()
            const params = [unitSlug]
            const where = [
                'u.slug = $1',
                `o.status = 'active'`,
                '(o.validity_start is null or o.validity_start <= current_date)',
                '(o.validity_end is null or o.validity_end >= current_date)',
            ]
            if (offerKey) {
                params.push(normalizeCommercialOfferKey(offerKey))
                where.push(`o.offer_key = $${params.length}`)
            }
            const rows = await pgPool.query(commercialOfferSelect(`where ${where.join(' and ')}`), params)
            return {
                unitSlug,
                asOf: new Date().toISOString().slice(0, 10),
                offers: rows.rows.map(mapCommercialOffer),
            }
        },

        async commercialOverview(query, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            await assertCommercialIdentitySource(pgPool)
            const asOf = commercialAsOf(query?.asOf)
            const unitSlugs = commercialUnitSlugsForQuery(actor, query?.unit)
            const [policy, commercialContactAvailability] = await Promise.all([
                readCommercialPolicy(pgPool),
                readCommercialContactAvailability(pgPool),
            ])
            const serverPage = String(query?.server || '').trim() === '1'
                ? await queryCommercialProfilesServerPage(pgPool, {
                    asOf,
                    unitSlugs,
                    thresholds: policy.returnRiskThresholds,
                    query,
                })
                : null
            const profiles = serverPage?.profiles || await queryCommercialProfiles(pgPool, {
                asOf,
                unitSlugs,
                thresholds: policy.returnRiskThresholds,
            })
            const filtered = serverPage ? profiles : filterCommercialProfiles(profiles, query)
            const limit = serverPage?.limit || sanitizeLimit(query?.limit, 100, 250)
            const offset = serverPage?.offset || sanitizeOffset(query?.offset, 0)
            const [quality, mappedItems, allItems, actions, unlinkedAttendance, identityFreshness] = await Promise.all([
                pgPool.query(
                    `select count(*)::int as future_attendances
                     from crm_atendimento.attendances attendance
                     join crm_atendimento.units unit on unit.id = attendance.unit_id
                     where attendance.deleted_at is null and attendance.service_date > $1::date
                       and ($2::text[] is null or unit.slug = any($2::text[]))`,
                    [asOf, unitSlugs],
                ),
                pgPool.query(
                    `select count(*)::int as count
                     from crm_caixa.sale_items item
                     join crm_caixa.sales sale on sale.id = item.sale_id
                     join crm_atendimento.units unit on unit.id = sale.unit_id
                     where item.mapping_status = 'mapped'
                       and ($1::text[] is null or unit.slug = any($1::text[]))`,
                    [unitSlugs],
                ),
                pgPool.query(
                    `select count(*)::int as count
                     from crm_caixa.sale_items item
                     join crm_caixa.sales sale on sale.id = item.sale_id
                     join crm_atendimento.units unit on unit.id = sale.unit_id
                     where $1::text[] is null or unit.slug = any($1::text[])`,
                    [unitSlugs],
                ),
                queryCommercialActionMetrics(pgPool, commercialContactAvailability, unitSlugs),
                pgPool.query(
                    `select count(distinct canonical.id)::int as count
                     from crm_atendimento.canonical_clients canonical
                     where canonical.merged_into_id is null
                       and exists (
                           select 1 from crm_atendimento.attendance_client_links link
                           join crm_atendimento.attendances attendance on attendance.id = link.attendance_id
                           join crm_atendimento.units unit on unit.id = attendance.unit_id
                           where link.client_id = canonical.id and attendance.deleted_at is null
                             and ($1::text[] is null or unit.slug = any($1::text[]))
                       )
                       and not exists (
                           select 1 from crm_atendimento.global_client_identity_members member
                           where member.source_type = 'attendance_client' and member.source_id = canonical.id::text
                       )`, [unitSlugs],
                ),
                serverPage
                    ? pgPool.query('select max(updated_at) as updated_at from crm_atendimento.global_client_identities')
                    : profiles.length
                        ? pgPool.query(`select max(updated_at) as updated_at from crm_atendimento.global_client_identities where id = any($1::uuid[])`, [profiles.map((profile) => profile.identityId)])
                        : Promise.resolve({ rows: [] }),
            ])
            const contactEligibility = profiles.reduce((summary, profile) => {
                const status = profile.contactEligibility?.status || 'review_required'
                if (status === 'eligible') summary.eligible += 1
                else if (status === 'blocked') summary.blocked += 1
                else summary.reviewRequired += 1
                summary.controlsReady = summary.controlsReady && !!profile.contactEligibility?.controlsReady
                summary.contactWriteControlsReady = summary.contactWriteControlsReady && !!profile.contactEligibility?.contactWriteControlsReady
                return summary
            }, {
                eligible: 0,
                blocked: 0,
                reviewRequired: 0,
                controlsReady: profiles.length > 0,
                contactWriteControlsReady: profiles.length > 0 && commercialContactAvailability.contactWriteControlsReady,
            })
            return {
                asOf,
                policy: commercialPolicyForActor(policy, actor),
                summary: serverPage?.summary || summarizeCommercialProfiles(profiles),
                actions,
                coverage: {
                    identitiesVisible: serverPage?.coverage.identitiesVisible ?? profiles.length,
                    confirmedMultiSourceIdentities: serverPage?.coverage.confirmedMultiSourceIdentities ?? profiles.filter((profile) => profile.identityQuality === 'confirmed_multi_source').length,
                    unresolvedSingleSourceIdentities: serverPage?.coverage.unresolvedSingleSourceIdentities ?? profiles.filter((profile) => profile.identityQuality === 'unresolved_single_source').length,
                    classifiedSaleItems: Number(mappedItems.rows[0]?.count || 0),
                    saleItems: Number(allItems.rows[0]?.count || 0),
                },
                dataQuality: {
                    futureAttendancesExcluded: Number(quality.rows[0]?.future_attendances || 0),
                    recencySource: 'completed_attendance_only',
                    saleItemsWithoutClassification: Math.max(0, Number(allItems.rows[0]?.count || 0) - Number(mappedItems.rows[0]?.count || 0)),
                    activeAttendanceClientsWithoutIdentity: Number(unlinkedAttendance.rows[0]?.count || 0),
                    identityDataUpdatedAt: identityFreshness.rows[0]?.updated_at || null,
                    contactEligibility: serverPage?.contactEligibility || contactEligibility,
                },
                total: serverPage?.total ?? filtered.length,
                limit,
                offset,
                pagination: serverPage?.pagination || {
                    mode: 'legacy',
                    sort: 'priority',
                    direction: 'desc',
                    hasPrevious: offset > 0,
                    hasNext: offset + limit < filtered.length,
                },
                profiles: (serverPage ? filtered : filtered.slice(offset, offset + limit)).map(minimizeCommercialProfile),
            }
        },

        async identityReviewQueue(query, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            await assertIdentityReviewSource(pgPool)
            const workflow = await identityReviewWorkflowStatus(pgPool)
            const unitSlugs = commercialUnitSlugsForQuery(actor)
            return {
                ...(await queryIdentityReviewQueue(pgPool, query, { workflowReady: workflow.ready, unitSlugs })),
                workflow: { writesReady: workflow.ready },
            }
        },

        async identityClusterWorkspace(query, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            await assertIdentityReviewSource(pgPool)
            const graph = await queryIdentityClusterGraph(pgPool, actor, query || {})
            const limit = sanitizeLimit(query?.limit, 50, 100)
            const offset = sanitizeOffset(query?.offset, 0)
            const page = graph.clusters.slice(offset, offset + limit)
            return {
                schemaVersion: 'crm-identity-cluster/v1',
                total: graph.clusters.length,
                limit,
                offset,
                clusters: page.map(stripIdentityClusterInternals),
                workflow: { writesReady: graph.workflow.ready },
                workspace: graph.workspace,
                graph: graph.graph,
                pagination: { hasPrevious: offset > 0, hasNext: offset + page.length < graph.clusters.length },
            }
        },

        async identityClusterDetail(clusterKey, query, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            await assertIdentityReviewSource(pgPool)
            const graph = await queryIdentityClusterGraph(pgPool, actor, { ...(query || {}), includeResolved: true })
            const cluster = findIdentityCluster(graph.clusters, clusterKey)
            if (!cluster) throw identityReviewError('IDENTITY_CLUSTER_NOT_FOUND', 404)
            return {
                schemaVersion: 'crm-identity-cluster/v1',
                cluster: stripIdentityClusterInternals(cluster),
                workflow: { writesReady: graph.workflow.ready },
                workspace: graph.workspace,
            }
        },

        async previewIdentityClusterBulk(payload, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            await assertIdentityReviewSource(pgPool)
            const graph = await queryIdentityClusterGraph(pgPool, actor, { unit: payload?.unit, includeResolved: true })
            const selected = Array.isArray(payload?.clusterKeys) && payload.clusterKeys.length
                ? graph.clusters.filter((cluster) => payload.clusterKeys.map(String).includes(cluster.clusterKey))
                : graph.clusters
            return {
                ...buildIdentityClusterBulkPreview(selected),
                workspace: graph.workspace,
                workflow: { writesReady: graph.workflow.ready },
            }
        },

        async applyIdentityClusterBulk(payload, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            await assertIdentityReviewSource(pgPool)
            await assertIdentityReviewWorkflowReady(pgPool)
            await assertIdentityClusterWorkspaceReady(pgPool)
            if (payload?.confirmation !== 'REVIEW_CLUSTER') throw identityReviewError('IDENTITY_CLUSTER_CONFIRMATION_REQUIRED', 400)
            if (String(payload?.reason || '').trim().length < 3) throw identityReviewError('IDENTITY_CLUSTER_REASON_REQUIRED', 400)
            return withPgTransaction(pgPool, async (client) => {
                await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
                return applyIdentityClusterBulkTransaction(client, payload || {}, actor)
            })
        },

        async revealIdentityCluster(payload, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            await assertIdentityReviewSource(pgPool)
            await assertIdentityClusterWorkspaceReady(pgPool)
            return withPgTransaction(pgPool, async (client) => {
                await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [IDENTITY_GRAPH_LOCK_KEY])
                return revealIdentityCluster(client, payload || {}, actor)
            })
        },

        async decideIdentityReview(payload, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            await assertIdentityReviewSource(pgPool)
            await assertIdentityReviewWorkflowReady(pgPool)
            const normalized = normalizeIdentityReviewDecision(payload || {})
            return withPgTransaction(pgPool, async (client) => {
                await acquireIdentityReviewLocks(client, {
                    ...normalized,
                    ...IDENTITY_REVIEW_DEFINITIONS[normalized.reviewType],
                })
                await assertIdentityReviewWorkflowReady(client)
                const candidate = await readIdentityReviewCandidate(client, normalized)
                await assertCommercialReviewCandidateScope(client, actor, candidate)
                assertIdentityReviewCandidateVersion(candidate, normalized.expectedVersion)
                const latest = await readLatestIdentityReviewDecision(client, candidate)
                assertNoCurrentIdentityReviewDecision(latest, candidate)
                const sourceState = await writeIdentityReviewSourceStatus(client, candidate, normalized.decision, actor)
                let materialization
                if (normalized.decision === 'confirmed') {
                    materialization = await materializeIdentityReviewConfirmation(client, {
                        candidate, actor,
                    })
                    const sourceLinkTransitions = await recordIdentityReviewSourceLinkTransition(client, {
                        materializationRunId: materialization.id,
                        candidate,
                        previousStatus: candidate.rawStatus,
                        resultingStatus: sourceState.rawStatus,
                        origin: 'manager_identity_review',
                    })
                    const decision = await createIdentityReviewDecision(client, {
                        candidate, decision: normalized.decision, reason: normalized.reason, actor,
                        materializationRunId: materialization.id, resultingStatus: sourceState.rawStatus,
                        sourceVersion: sourceState.version,
                        sourceSnapshot: {
                            survivorClientId: normalized.survivorClientId,
                            previousSourceVersion: candidate.version,
                        },
                    })
                    await audit(client, 'client-identity.review.confirmed', actor, null, {
                        reviewType: candidate.reviewType,
                        sourceId: candidate.sourceId,
                        targetId: candidate.targetId,
                        decisionId: decision.id,
                        materializationRunId: materialization.id,
                        membersMoved: materialization.summary.membersMoved,
                        sourceLinkTransitions: sourceLinkTransitions.length,
                    })
                    return { decision: { id: decision.id, state: 'confirmed', sourceVersion: sourceState.version }, materialization }
                }
                materialization = await createIdentityMaterializationRun(client, {
                    mode: 'reject', status: 'not_applicable',
                    inputFingerprint: identityMaterializationFingerprint({
                        reviewType: candidate.reviewType, sourceId: candidate.sourceId, targetId: candidate.targetId,
                        sourceVersion: candidate.version, decision: normalized.decision,
                    }),
                    summary: { reason: 'rejected_without_graph_mutation' }, actor,
                })
                const sourceLinkTransitions = await recordIdentityReviewSourceLinkTransition(client, {
                    materializationRunId: materialization.id,
                    candidate,
                    previousStatus: candidate.rawStatus,
                    resultingStatus: sourceState.rawStatus,
                    origin: 'manager_identity_review',
                })
                const decision = await createIdentityReviewDecision(client, {
                    candidate, decision: normalized.decision, reason: normalized.reason, actor,
                    materializationRunId: materialization.id, resultingStatus: sourceState.rawStatus,
                    sourceVersion: sourceState.version,
                    sourceSnapshot: { previousSourceVersion: candidate.version },
                })
                await audit(client, 'client-identity.review.rejected', actor, null, {
                    reviewType: candidate.reviewType,
                    sourceId: candidate.sourceId,
                    targetId: candidate.targetId,
                    decisionId: decision.id,
                    materializationRunId: materialization.id,
                    sourceLinkTransitions: sourceLinkTransitions.length,
                })
                return { decision: { id: decision.id, state: 'rejected', sourceVersion: sourceState.version }, materialization }
            })
        },

        async undoIdentityReviewDecision(payload, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            await assertIdentityReviewSource(pgPool)
            await assertIdentityReviewWorkflowReady(pgPool)
            const normalized = normalizeIdentityReviewUndo(payload || {})
            return withPgTransaction(pgPool, async (client) => {
                await acquireIdentityReviewLocks(client, {
                    ...normalized,
                    ...IDENTITY_REVIEW_DEFINITIONS[normalized.reviewType],
                })
                await assertIdentityReviewWorkflowReady(client)
                const candidate = await readIdentityReviewCandidate(client, normalized)
                await assertCommercialReviewCandidateScope(client, actor, candidate)
                const latest = await readLatestIdentityReviewDecision(client, candidate)
                if (!latest || latest.decision === 'reversed') throw identityReviewError('IDENTITY_REVIEW_NOT_DECIDED', 409)
                assertIdentityReviewUndoCandidateVersion(candidate, normalized.expectedVersion, latest)
                await assertNoDependentIdentityReviewDecision(client, latest, candidate)
                // A source refresh may update evidence while retaining the human
                // terminal status.  It cannot silently re-materialize the graph,
                // but a manager may explicitly undo that stale decision before
                // making a fresh one with the new evidence.
                const sourceState = await writeIdentityReviewSourceStatus(client, candidate, latest.source_status, actor)
                let materialization
                if (latest.decision === 'confirmed') {
                    materialization = await materializeIdentityReviewReversal(client, {
                        candidate, reversesDecision: latest, actor,
                    })
                } else {
                    materialization = await createIdentityMaterializationRun(client, {
                        mode: 'reverse', status: 'not_applicable',
                        inputFingerprint: identityMaterializationFingerprint({ reversesDecisionId: latest.id, sourceVersion: candidate.version }),
                        summary: { reversesDecisionId: latest.id, reason: 'rejected_without_graph_mutation' }, actor,
                    })
                }
                const sourceLinkTransitions = await recordIdentityReviewSourceLinkTransition(client, {
                    materializationRunId: materialization.id,
                    candidate,
                    previousStatus: candidate.rawStatus,
                    resultingStatus: sourceState.rawStatus,
                    origin: 'manager_identity_review_undo',
                })
                const reversal = await createIdentityReviewDecision(client, {
                    candidate, decision: 'reversed', reason: normalized.reason, actor,
                    materializationRunId: materialization.id, resultingStatus: sourceState.rawStatus,
                    sourceVersion: sourceState.version,
                    sourceSnapshot: { reversesDecisionId: latest.id, previousSourceVersion: candidate.version },
                })
                await audit(client, 'client-identity.review.reversed', actor, null, {
                    reviewType: candidate.reviewType,
                    sourceId: candidate.sourceId,
                    targetId: candidate.targetId,
                    decisionId: reversal.id,
                    reversesDecisionId: latest.id,
                    materializationRunId: materialization.id,
                    sourceLinkTransitions: sourceLinkTransitions.length,
                })
                return { decision: { id: reversal.id, state: 'reversed', sourceVersion: sourceState.version, reversesDecisionId: latest.id }, materialization }
            })
        },

        async commercialProfile(identityId, query, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            await assertCommercialIdentitySource(pgPool)
            const id = String(identityId || '').trim()
            if (!id) {
                const error = new Error('COMMERCIAL_IDENTITY_REQUIRED')
                error.statusCode = 400
                throw error
            }
            const asOf = commercialAsOf(query?.asOf)
            const unitSlugs = commercialUnitSlugsForQuery(actor, query?.unit)
            const policy = await readCommercialPolicy(pgPool)
            const profiles = await queryCommercialProfiles(pgPool, {
                asOf,
                unitSlugs,
                thresholds: policy.returnRiskThresholds,
                identityId: id,
            })
            const profile = profiles.find((item) => item.identityId === id)
            if (!profile) {
                const error = new Error('COMMERCIAL_IDENTITY_NOT_FOUND')
                error.statusCode = 404
                throw error
            }
            const [actions, cadences, timeline] = await Promise.all([
                pgPool.query(
                    `select action.*, unit.slug as unit_slug, unit.name as unit_name
                     from crm_atendimento.commercial_actions action
                     left join crm_atendimento.units unit on unit.id = action.unit_id
                     where action.identity_id = $1
                       and ($2::text[] is null or unit.slug = any($2::text[]))
                     order by action.created_at desc limit 100`,
                    [id, unitSlugs],
                ),
                pgPool.query(
                    `select procedure.id, procedure.name, cadence.cadence_days, cadence.status, cadence.notes,
                            unit.slug as unit_slug, unit.name as unit_name, cadence.approved_at, cadence.approved_by
                     from crm_atendimento.procedures procedure
                     left join crm_atendimento.commercial_procedure_cadences cadence
                        on cadence.procedure_id = procedure.id and cadence.status = 'approved'
                     left join crm_atendimento.units unit on unit.id = cadence.unit_id
                     where procedure.name = any($1::text[])
                       and ($2::text[] is null or unit.slug is null or unit.slug = any($2::text[]))
                     order by procedure.name`,
                    [profile.completedProcedures, unitSlugs],
                ),
                queryCommercialTimeline(pgPool, {
                    identityId: id,
                    asOf,
                    unitSlugs,
                    limit: commercialTimelineLimit(query?.timelineLimit),
                }),
            ])
            return {
                asOf,
                policy: commercialPolicyForActor(policy, actor),
                profile: minimizeCommercialProfile(profile),
                actions: actions.rows.map(mapCommercialAction),
                timeline,
                clinicalCadences: cadences.rows.map((row) => ({
                    procedureId: row.id,
                    procedureName: row.name,
                    cadenceDays: row.cadence_days == null ? null : Number(row.cadence_days),
                    status: row.status || 'not_configured',
                    notes: row.notes || '',
                    unitSlug: row.unit_slug || '',
                    unitName: row.unit_name || '',
                    approvedAt: row.approved_at || null,
                    approvedBy: row.approved_by || '',
                })),
            }
        },

        async recordCommercialContactPermission(payload, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            // Consent is identity-wide, not unit-bound.  A scoped manager
            // must not change a customer's permission for another unit.
            assertCommercialGlobalScope(actor)
            await assertCommercialIdentitySource(pgPool)
            await assertCommercialContactControls(pgPool)
            const actorIdentity = actorIdentityForMutation(actor)
            const identityId = String(payload?.identityId || '').trim()
            const channel = String(payload?.channel || COMMERCIAL_CONTACT_CHANNEL).trim()
            const validation = validateCommercialPermission({
                status: payload?.status,
                source: payload?.source,
                evidenceReference: payload?.evidenceReference,
                expiresAt: payload?.expiresAt,
            })
            if (!identityId || channel !== COMMERCIAL_CONTACT_CHANNEL || !validation.valid) {
                throw commercialContactError('INVALID_COMMERCIAL_CONTACT_PERMISSION', 400)
            }
            const permission = validation.permission
            const expectedRevision = commercialExpectedPermissionRevision(payload?.expectedRevision)
            // A stale affirmative consent must never reopen a contact channel
            // after a newer denial. Denials may still be recorded without a
            // version as a fail-closed stop action, but the UI always sends the
            // revision it rendered for both directions.
            if (permission.status === 'granted' && expectedRevision === null) {
                throw commercialContactError('COMMERCIAL_CONTACT_PERMISSION_VERSION_REQUIRED', 409)
            }
            if (permission.status === 'granted') await assertCommercialContactCooldownControls(pgPool)
            return withCommercialContactTransaction(pgPool, async (client) => {
                // The same transaction-scoped lock is acquired when an action is
                // marked as contacted. A revocation therefore cannot interleave
                // between the eligibility read and that status transition.
                await acquireCommercialContactIdentityLock(client, identityId)
                const identity = await client.query(
                    `select id from crm_atendimento.global_client_identities where id = $1`,
                    [identityId],
                )
                if (!identity.rows[0]?.id) throw commercialContactError('COMMERCIAL_IDENTITY_NOT_FOUND', 404)
                // A denial is always a safe control action. An affirmative
                // permission can enable outbound contact, so it stays behind
                // the disabled-by-default, identity-scoped rollout gate.
                if (permission.status === 'granted') {
                    await assertCommercialContactWriteRollout(client, identityId)
                }
                const previous = await client.query(
                    `select status, revision from crm_atendimento.commercial_contact_permissions
                     where identity_id = $1 and channel = $2 for update`,
                    [identityId, channel],
                )
                const previousStatus = previous.rows[0]?.status || null
                const previousRevision = Number(previous.rows[0]?.revision || 0)
                if (expectedRevision !== null && previousRevision !== expectedRevision) {
                    throw commercialContactError('COMMERCIAL_CONTACT_PERMISSION_CONFLICT')
                }
                const traceId = randomUUID()
                const persisted = await client.query(
                    `insert into crm_atendimento.commercial_contact_permissions(
                        identity_id, channel, status, evidence_source, evidence_reference, expires_at, recorded_by)
                     values ($1,$2,$3,$4,$5,$6,$7)
                     on conflict(identity_id, channel) do update set
                        status = excluded.status, evidence_source = excluded.evidence_source,
                        evidence_reference = excluded.evidence_reference, expires_at = excluded.expires_at,
                        recorded_by = excluded.recorded_by,
                        revision = crm_atendimento.commercial_contact_permissions.revision + 1,
                        updated_at = now()
                     returning revision`,
                    [identityId, channel, permission.status, permission.source, permission.evidenceReference, permission.expiresAt, actorIdentity],
                )
                const nextRevision = Number(persisted.rows[0]?.revision || (previousRevision + 1))
                await client.query(
                    `insert into crm_atendimento.commercial_contact_permission_events(
                        identity_id, channel, previous_status, status, evidence_source, evidence_reference, expires_at, recorded_by, trace_id)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                    [identityId, channel, previousStatus, permission.status, permission.source, permission.evidenceReference, permission.expiresAt, actorIdentity, traceId],
                )
                const contactEligibility = await readCommercialContactEligibility(client, identityId)
                await audit(client, 'commercial.contact_permission.recorded', actor, null, {
                    traceId,
                    identityId,
                    channel,
                    status: permission.status,
                    previousStatus,
                    previousRevision,
                    nextRevision,
                    evidenceSource: permission.source,
                    evidenceReferenceRecorded: true,
                    expiresAt: permission.expiresAt,
                    recordedBy: actorIdentity,
                    eligibilityStatus: contactEligibility.status,
                    eligibilityReason: contactEligibility.reason,
                })
                return { contactEligibility }
            })
        },

        async commercialPolicy(actor) {
            await ensureReady()
            assertCommercialManager(actor)
            assertCommercialGlobalScope(actor)
            return { policy: await readCommercialPolicy(pgPool) }
        },

        async updateCommercialPolicy(payload, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            assertCommercialGlobalScope(actor)
            const cooldown = Number(payload?.activeContactCooldownDays)
            if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 180) {
                const error = new Error('INVALID_ACTIVE_CONTACT_COOLDOWN')
                error.statusCode = 400
                throw error
            }
            const thresholds = commercialThresholds(payload?.returnRiskThresholds)
            const requestedWritesEnabled = commercialContactWritesEnabled(payload?.commercialContactWritesEnabled)
            const requestedCanaryIdentityIds = commercialCanaryIdentityIds(payload?.commercialContactCanaryIdentityIds)
            const expectedPolicyVersion = commercialExpectedPolicyVersion(payload?.expectedPolicyVersion)
            // Policy changes control an outbound-contact rollout. Every write
            // is compare-and-swap, including legacy-only cooldown changes, so
            // a stale manager form cannot silently replace a newer decision.
            if (!expectedPolicyVersion) throw commercialContactError('COMMERCIAL_POLICY_VERSION_REQUIRED', 409)
            const changesRollout = requestedWritesEnabled !== undefined || requestedCanaryIdentityIds !== undefined
            const availability = await readCommercialContactAvailability(pgPool)
            if (changesRollout && !availability.contactWriteControlsReady) {
                throw commercialContactError('COMMERCIAL_CONTACT_COOLDOWN_CONTROLS_NOT_READY')
            }
            return withCommercialContactTransaction(pgPool, async (client) => {
                if (!availability.contactWriteControlsReady) {
                    const current = await client.query(
                        `select ${LEGACY_COMMERCIAL_POLICY_VERSION_SQL} as policy_version
                         from crm_atendimento.commercial_policy_config where singleton = true for update`,
                    )
                    if (current.rows[0]?.policy_version !== expectedPolicyVersion) {
                        throw commercialContactError('COMMERCIAL_POLICY_CONFLICT')
                    }
                    const legacy = await client.query(
                        `update crm_atendimento.commercial_policy_config
                         set active_contact_cooldown_days = $1, return_risk_thresholds = $2::int[],
                             updated_by = $3, updated_at = now()
                         where singleton = true
                         returning active_contact_cooldown_days, return_risk_thresholds, updated_by, updated_at,
                             ${LEGACY_COMMERCIAL_POLICY_VERSION_SQL} as policy_version`,
                        [cooldown, thresholds, actorLabel(actor)],
                    )
                    const row = legacy.rows[0] || {}
                    await audit(client, 'commercial.policy.updated', actor, null, {
                        cooldown,
                        thresholds,
                        commercialContactWritesEnabled: false,
                        commercialContactCanaryCount: 0,
                        contactWriteControlsReady: false,
                    })
                    return { policy: {
                        activeContactCooldownDays: Number(row.active_contact_cooldown_days || cooldown),
                        returnRiskThresholds: row.return_risk_thresholds || thresholds,
                        commercialContactWritesEnabled: false,
                        commercialContactCanaryIdentityIds: [],
                        commercialContactWriteControlsReady: false,
                        policyVersion: row.policy_version || '',
                        updatedBy: row.updated_by || actorLabel(actor),
                        updatedAt: row.updated_at || null,
                    } }
                }
                const current = await client.query(
                    `select commercial_contact_writes_enabled, commercial_contact_canary_identity_ids,
                            ${COMMERCIAL_POLICY_VERSION_SQL} as policy_version
                     from crm_atendimento.commercial_policy_config where singleton = true for update`,
                )
                const currentRow = current.rows[0] || {}
                if (currentRow.policy_version !== expectedPolicyVersion) {
                    throw commercialContactError('COMMERCIAL_POLICY_CONFLICT')
                }
                const writesEnabled = requestedWritesEnabled === undefined
                    ? currentRow.commercial_contact_writes_enabled === true
                    : requestedWritesEnabled
                const canaryIdentityIds = requestedCanaryIdentityIds === undefined
                    ? (Array.isArray(currentRow.commercial_contact_canary_identity_ids)
                        ? currentRow.commercial_contact_canary_identity_ids.map(String).filter(Boolean)
                        : [])
                    : requestedCanaryIdentityIds
                await assertCommercialCanaryIdentities(client, canaryIdentityIds)
                if (writesEnabled && !canaryIdentityIds.length) {
                    throw commercialContactError('COMMERCIAL_CONTACT_CANARY_REQUIRED', 400)
                }
                const result = await client.query(
                    `update crm_atendimento.commercial_policy_config
                     set active_contact_cooldown_days = $1, return_risk_thresholds = $2::int[],
                         commercial_contact_writes_enabled = $3,
                         commercial_contact_canary_identity_ids = $4::uuid[],
                         updated_by = $5, updated_at = now()
                     where singleton = true
                     returning active_contact_cooldown_days, return_risk_thresholds,
                          commercial_contact_writes_enabled, commercial_contact_canary_identity_ids,
                          updated_by, updated_at,
                          ${COMMERCIAL_POLICY_VERSION_SQL} as policy_version`,
                    [cooldown, thresholds, writesEnabled, canaryIdentityIds, actorLabel(actor)],
                )
                await audit(client, 'commercial.policy.updated', actor, null, {
                    cooldown,
                    thresholds,
                    commercialContactWritesEnabled: writesEnabled,
                    commercialContactCanaryCount: canaryIdentityIds.length,
                })
                const row = result.rows[0] || {}
                return { policy: {
                    activeContactCooldownDays: Number(row.active_contact_cooldown_days || cooldown),
                    returnRiskThresholds: row.return_risk_thresholds || thresholds,
                    commercialContactWritesEnabled: row.commercial_contact_writes_enabled === true,
                    commercialContactCanaryIdentityIds: Array.isArray(row.commercial_contact_canary_identity_ids)
                        ? row.commercial_contact_canary_identity_ids.map(String).filter(Boolean)
                        : canaryIdentityIds,
                    commercialContactWriteControlsReady: true,
                    policyVersion: row.policy_version || '',
                    updatedBy: row.updated_by || actorLabel(actor),
                    updatedAt: row.updated_at || null,
                } }
            })
        },

        async commercialCadences(actor) {
            await ensureReady()
            assertCommercialManager(actor)
            const unitSlugs = commercialUnitSlugsForQuery(actor)
            const result = await pgPool.query(
                `select cadence.id, cadence.procedure_id, procedure.name as procedure_name, cadence.cadence_days, cadence.status,
                        cadence.notes, cadence.approved_by, cadence.approved_at, cadence.updated_by, cadence.updated_at,
                        unit.slug as unit_slug, unit.name as unit_name
                 from crm_atendimento.commercial_procedure_cadences cadence
                 join crm_atendimento.procedures procedure on procedure.id = cadence.procedure_id
                 left join crm_atendimento.units unit on unit.id = cadence.unit_id
                 where $1::text[] is null or unit.slug = any($1::text[])
                 order by procedure.name, unit.name nulls first`,
                [unitSlugs],
            )
            return { cadences: result.rows.map((row) => ({
                id: row.id, procedureId: row.procedure_id, procedureName: row.procedure_name,
                cadenceDays: Number(row.cadence_days), status: row.status, notes: row.notes || '',
                approvedBy: row.approved_by || '', approvedAt: row.approved_at || null,
                updatedBy: row.updated_by || '', updatedAt: row.updated_at || null,
                unitSlug: row.unit_slug || '', unitName: row.unit_name || '',
            })) }
        },

        async upsertCommercialCadence(payload, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            const procedureId = String(payload?.procedureId || '').trim()
            const status = String(payload?.status || 'draft').trim()
            const cadenceDays = Number(payload?.cadenceDays)
            if (!procedureId || !COMMERCIAL_CADENCE_STATUSES.has(status) || !Number.isInteger(cadenceDays) || cadenceDays < 1 || cadenceDays > 1095) {
                const error = new Error('INVALID_CLINICAL_CADENCE')
                error.statusCode = 400
                throw error
            }
            // Clientes has no verified clinical approver or attestation contract.
            // A commercial manager may maintain drafts, but never create or
            // re-approve a cadence that the UI could present as clinical advice.
            if (status === 'approved') throw clinicalCadenceApprovalRequired()
            const unitSlug = commercialUnit(payload?.unit)
            if (commercialUnitScope(actor) !== null) assertCommercialUnitInScope(actor, unitSlug)
            const unit = unitSlug ? await pgPool.query(`select id from crm_atendimento.units where slug = $1`, [unitSlug]) : { rows: [] }
            if (unitSlug && !unit.rows[0]?.id) {
                const error = new Error('COMMERCIAL_UNIT_NOT_FOUND')
                error.statusCode = 404
                throw error
            }
            // Preserve legacy approved records as read-only. `is not distinct
            // from` also covers the global (null unit) legacy records.
            const existing = await pgPool.query(
                `select id, status from crm_atendimento.commercial_procedure_cadences
                 where procedure_id = $1 and unit_id is not distinct from $2`,
                [procedureId, unit.rows[0]?.id || null],
            )
            if (existing.rows.some((row) => row.status === 'approved')) throw clinicalCadenceApprovalRequired()
            const result = await pgPool.query(
                `insert into crm_atendimento.commercial_procedure_cadences(
                    procedure_id, unit_id, cadence_days, status, notes, approved_by, approved_at, updated_by)
                 values ($1, $2, $3, $4, $5, null, null, $6)
                 on conflict(procedure_id, unit_id) do update set cadence_days = excluded.cadence_days, status = excluded.status,
                    notes = excluded.notes, approved_by = null, approved_at = null,
                    updated_by = excluded.updated_by, updated_at = now()
                 where crm_atendimento.commercial_procedure_cadences.status <> 'approved'
                 returning id`,
                [procedureId, unit.rows[0]?.id || null, cadenceDays, status, String(payload?.notes || '').trim() || null, actorLabel(actor)],
            )
            const cadenceId = result.rows[0]?.id
            // The conditional update is an atomic backstop if a clinical flow
            // ever approves the same scoped row after the read above.
            if (!cadenceId) throw clinicalCadenceApprovalRequired()
            await audit(pgPool, 'commercial.cadence.upserted', actor, null, { cadenceId, procedureId, unitSlug, status, cadenceDays })
            return { id: cadenceId }
        },

        async createCommercialAction(payload, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            const identityId = String(payload?.identityId || '').trim()
            const segmentKey = String(payload?.segmentKey || '').trim()
            const actionType = String(payload?.actionType || 'contact').trim()
            const contactChannel = String(payload?.contactChannel || COMMERCIAL_CONTACT_CHANNEL).trim()
            const owner = String(payload?.owner || '').trim()
            const dueDate = String(payload?.dueDate || '').trim() || null
            if (!identityId || !segmentKey || !COMMERCIAL_ACTION_TYPES.has(actionType)
                || contactChannel !== COMMERCIAL_CONTACT_CHANNEL || (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
                const error = new Error('INVALID_COMMERCIAL_ACTION')
                error.statusCode = 400
                throw error
            }
            const unitSlug = commercialUnit(payload?.unit)
            if (commercialUnitScope(actor) !== null) assertCommercialUnitInScope(actor, unitSlug)
            await assertCommercialIdentitySource(pgPool)
            const contactAvailability = await assertCommercialContactCooldownControls(pgPool)
            return withCommercialContactTransaction(pgPool, async (client) => {
                // Creation joins the same per-identity lock as `contacted`.
                // This prevents two queue writes from both observing an empty
                // cadence window and creates a stable ordering with the first
                // recorded outbound contact.
                await acquireCommercialContactIdentityLock(client, identityId)
                const [identity, policy, unit] = await Promise.all([
                    client.query(`select id from crm_atendimento.global_client_identities where id = $1`, [identityId]),
                    client.query(`select active_contact_cooldown_days from crm_atendimento.commercial_policy_config where singleton = true`),
                    unitSlug ? client.query(`select id from crm_atendimento.units where slug = $1`, [unitSlug]) : Promise.resolve({ rows: [] }),
                ])
                if (!identity.rows[0]?.id) {
                    const error = new Error('COMMERCIAL_IDENTITY_NOT_FOUND')
                    error.statusCode = 404
                    throw error
                }
                if (unitSlug && !unit.rows[0]?.id) {
                    const error = new Error('COMMERCIAL_UNIT_NOT_FOUND')
                    error.statusCode = 404
                    throw error
                }
                // An action cannot manufacture its own unit authorization. A
                // scoped manager may only route an identity to a unit that is
                // supported by current attendance, sales, app, or lead evidence.
                await assertCommercialIdentityUnitMembership(client, {
                    identityId,
                    unitSlug,
                    availability: contactAvailability,
                })
                const canonicalOwner = await resolveCommercialActionOwner(client, owner, { slug: unitSlug })
                const contactEligibility = await readCommercialContactEligibility(client, identityId)
                const cooldown = Number(policy.rows[0]?.active_contact_cooldown_days || 30)
                await assertCommercialContactCooldown(client, { identityId, actionId: null, cooldownDays: cooldown })
                const active = await client.query(
                    `select id from crm_atendimento.commercial_actions
                     where identity_id = $1 and status = any($2::text[]) and created_at >= now() - ($3::int * interval '1 day')
                     limit 1`,
                    [identityId, COMMERCIAL_ACTIVE_ACTION_STATUSES, cooldown],
                )
                if (active.rows[0]?.id) {
                    const error = new Error('COMMERCIAL_CONTACT_COOLDOWN_ACTIVE')
                    error.statusCode = 409
                    throw error
                }
                const created = await client.query(
                    `insert into crm_atendimento.commercial_actions(
                        identity_id, unit_id, segment_key, action_type, contact_channel, owner, due_date, notes, created_by, updated_by)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
                     returning id, status`,
                    [identityId, unit.rows[0]?.id || null, segmentKey, actionType, contactChannel, canonicalOwner, dueDate, String(payload?.notes || '').trim() || null, actorLabel(actor)],
                )
                const traceId = randomUUID()
                const actionId = created.rows[0]?.id
                const actionStatus = created.rows[0]?.status || 'open'
                await recordCommercialActionEvent(client, {
                    actionId,
                    identityId,
                    eventType: 'created',
                    status: actionStatus,
                    traceId,
                    recordedBy: actorLabel(actor),
                    contactEligibility,
                    details: { segmentKey, actionType, contactChannel, unitSlug },
                })
                await audit(client, 'commercial.action.created', actor, null, {
                    traceId,
                    actionId,
                    identityId,
                    segmentKey,
                    actionType,
                    contactChannel,
                    unitSlug,
                    eligibilityStatus: contactEligibility.status,
                    eligibilityReason: contactEligibility.reason,
                })
                return { id: actionId, contactEligibility }
            })
        },

        async updateCommercialAction(actionId, payload, actor) {
            await ensureReady()
            assertCommercialManager(actor)
            const actorIdentity = actorIdentityForMutation(actor)
            const id = String(actionId || '').trim()
            const status = String(payload?.status || '').trim()
            if (!id || !COMMERCIAL_ACTION_STATUSES.has(status)) {
                const error = new Error('INVALID_COMMERCIAL_ACTION_STATUS')
                error.statusCode = 400
                throw error
            }
            const availability = await readCommercialContactAvailability(pgPool)
            if (!availability.commercialLedgerReady) {
                throw commercialContactError('COMMERCIAL_ACTION_LEDGER_NOT_READY')
            }
            if (status === 'contacted' && !availability.contactWriteControlsReady) {
                throw commercialContactError('COMMERCIAL_CONTACT_COOLDOWN_CONTROLS_NOT_READY')
            }
            const actorUnitScope = commercialUnitScope(actor)
            return withCommercialContactTransaction(pgPool, async (client) => {
                const contactedAtSelection = availability.actionContactedAt
                    ? ', action.contacted_at'
                    : ', null::timestamptz as contacted_at'
                const action = await client.query(
                    `select action.id, action.identity_id, action.status${contactedAtSelection}, unit.slug as unit_slug
                     from crm_atendimento.commercial_actions action
                     left join crm_atendimento.units unit on unit.id = action.unit_id
                     where action.id = $1 for update of action`,
                    [id],
                )
                const current = action.rows[0]
                if (!current?.id) throw commercialContactError('COMMERCIAL_ACTION_NOT_FOUND', 404)
                if (actorUnitScope !== null) {
                    // The action row is locked above, so the unit used for the
                    // authorization decision cannot change before this write.
                    assertCommercialUnitInScope(actor, current.unit_slug)
                }
                const requestedOwner = String(payload?.owner || '').trim()
                const canonicalOwner = requestedOwner
                    ? await resolveCommercialActionOwner(client, requestedOwner, { slug: current.unit_slug })
                    : ''
                const recordingContact = status === 'contacted' && !current.contacted_at
                // An action records at most one outbound contact. Reopening it
                // may track follow-up work, but a later contact must be a new
                // action so the immutable timestamp and cadence audit remain
                // truthful.
                if (status === 'contacted' && current.status !== 'contacted' && current.contacted_at) {
                    throw commercialContactError('COMMERCIAL_CONTACT_ALREADY_RECORDED', 409)
                }
                if (recordingContact) await assertCommercialContactCooldownControls(client)
                if (status === 'contacted') {
                    await acquireCommercialContactIdentityLock(client, current.identity_id)
                }
                // Lock every existing Harmonia contact row for this identity
                // before the outbound-contact state is recorded. Combined with
                // the identity advisory lock, this serializes local revocations
                // and existing opt-out updates with the eligibility decision.
                const contactEligibility = await readCommercialContactEligibility(client, current.identity_id, {
                    lockHarmonia: status === 'contacted',
                })
                const transition = transitionCommercialAction({
                    currentStatus: current.status,
                    nextStatus: status,
                    eligibility: contactEligibility,
                })
                if (!transition.allowed) {
                    const code = transition.reason === 'contact_eligibility_blocked'
                        ? 'COMMERCIAL_CONTACT_BLOCKED'
                        : transition.reason === 'contact_eligibility_review_required' || transition.reason === 'contact_eligibility_required'
                            ? 'COMMERCIAL_CONTACT_REVIEW_REQUIRED'
                            : 'INVALID_COMMERCIAL_ACTION_TRANSITION'
                    throw commercialContactError(code)
                }
                if (recordingContact) {
                    await assertCommercialContactWriteRollout(client, current.identity_id)
                    const policy = await client.query(
                        `select active_contact_cooldown_days from crm_atendimento.commercial_policy_config where singleton = true`,
                    )
                    const cooldown = Number(policy.rows[0]?.active_contact_cooldown_days || 30)
                    await assertCommercialContactCooldown(client, {
                        identityId: current.identity_id,
                        actionId: id,
                        cooldownDays: cooldown,
                    })
                }
                const contactedAtUpdate = availability.actionContactedAt
                    ? `contacted_at = case when $2 = 'contacted' and contacted_at is null then now() else contacted_at end,`
                    : ''
                const traceId = randomUUID()
                await client.query(
                    `update crm_atendimento.commercial_actions
                     set status = $2, owner = coalesce(nullif($3, ''), owner), outcome_notes = coalesce(nullif($4, ''), outcome_notes),
                          completed_at = case when $2 in ('won_sale','returned','closed','cancelled') then now() else completed_at end,
                          ${contactedAtUpdate}
                          updated_by = $5, updated_at = now()
                     where id = $1`,
                    [id, status, canonicalOwner, String(payload?.outcomeNotes || '').trim(), actorIdentity],
                )
                await recordCommercialActionEvent(client, {
                    actionId: id,
                    identityId: current.identity_id,
                    eventType: 'updated',
                    previousStatus: current.status,
                    status,
                    traceId,
                    recordedBy: actorIdentity,
                    contactEligibility,
                    details: {
                        statusChanged: current.status !== status,
                        contactedAtRecorded: recordingContact,
                        ownerChanged: !!canonicalOwner,
                    },
                })
                await audit(client, 'commercial.action.updated', actor, null, {
                    traceId,
                    actionId: id,
                    status,
                    contactedAtRecorded: recordingContact,
                    eligibilityStatus: contactEligibility.status,
                    eligibilityReason: contactEligibility.reason,
                })
                return { id, status, contactEligibility }
            })
        },

        async clients(query, actor) {
            await ensureReady()
            const unit = normalizeUnit(query?.unit)
            const search = normalizeText(query?.q || '')
            if (!unit.slug || unit.slug === 'unknown' || search.length < 2) return { clients: [] }
            if (!actorCanReadUnit(actor, unit)) {
                const err = new Error('FORBIDDEN')
                err.statusCode = 403
                throw err
            }
            const limit = Math.min(Math.max(Number(query?.limit) || 8, 1), 20)
            const result = await pgPool.query(
                `with candidates as (
                    select c.name, c.name_key, 0::int as usage_count
                    from crm_atendimento.clients c
                    join crm_atendimento.units u on u.id = c.unit_id
                    where u.slug = $1
                    union all
                    select a.client_name as name,
                           lower(regexp_replace(trim(a.client_name), '\\s+', ' ', 'g')) as name_key,
                           count(*)::int as usage_count
                    from crm_atendimento.attendances a
                    join crm_atendimento.units u on u.id = a.unit_id
                    where a.deleted_at is null and u.slug = $1 and nullif(trim(a.client_name), '') is not null
                    group by a.client_name
                ), ranked as (
                    select distinct on (name_key) name, usage_count
                    from candidates
                    where name_key like $2
                    order by name_key, usage_count desc, name
                )
                select name, usage_count
                from ranked
                order by usage_count desc, name
                limit $3`,
                [unit.slug, `%${search}%`, limit],
            )
            return {
                clients: result.rows.map((row) => ({
                    name: normalizeClientName(row.name),
                    usageCount: Number(row.usage_count || 0),
                })).filter((row) => row.name),
            }
        },

        async overview(query, actor) {
            await ensureReady()
            const { where, params } = buildAttendanceWhere(query, actor)
            const whereSql = where.length ? `where ${where.join(' and ')}` : ''
            const [summary, monthly, procedures, injectors, consultants] = await Promise.all([
                pgPool.query(
                    `select
                        count(*)::int as total_attendances,
                        coalesce(sum(a.quantity), 0)::numeric as quantity_total,
                        coalesce(sum(a.value), 0)::numeric as total_value,
                        count(distinct nullif(lower(trim(a.client_name)), ''))::int as distinct_clients
                     from crm_atendimento.attendances a
                     join crm_atendimento.units u on u.id = a.unit_id
                     join crm_atendimento.procedures p on p.id = a.procedure_id
                     left join crm_atendimento.professionals inj on inj.id = a.injector_id
                     left join crm_atendimento.professionals con on con.id = a.consultant_id
                     ${whereSql}`,
                    params,
                ),
                pgPool.query(
                    `select
                        to_char(a.service_date, 'YYYY-MM') as month,
                        count(*)::int as count,
                        coalesce(sum(a.quantity), 0)::numeric as quantity_total,
                        coalesce(sum(a.value), 0)::numeric as value
                     from crm_atendimento.attendances a
                     join crm_atendimento.units u on u.id = a.unit_id
                     join crm_atendimento.procedures p on p.id = a.procedure_id
                     left join crm_atendimento.professionals inj on inj.id = a.injector_id
                     left join crm_atendimento.professionals con on con.id = a.consultant_id
                     ${whereSql}
                     group by 1
                     order by 1`,
                    params,
                ),
                pgPool.query(
                    `select
                        p.name as label,
                        count(*)::int as count,
                        coalesce(sum(a.quantity), 0)::numeric as quantity_total,
                        coalesce(sum(a.value), 0)::numeric as value
                     from crm_atendimento.attendances a
                     join crm_atendimento.units u on u.id = a.unit_id
                     join crm_atendimento.procedures p on p.id = a.procedure_id
                     left join crm_atendimento.professionals inj on inj.id = a.injector_id
                     left join crm_atendimento.professionals con on con.id = a.consultant_id
                     ${whereSql}
                     group by 1
                     order by value desc, label
                     limit 12`,
                    params,
                ),
                pgPool.query(
                    `select
                        coalesce(nullif(inj.name, ''), 'Sem injetor') as label,
                        count(*)::int as count,
                        coalesce(sum(a.quantity), 0)::numeric as quantity_total,
                        coalesce(sum(a.value), 0)::numeric as value
                     from crm_atendimento.attendances a
                     join crm_atendimento.units u on u.id = a.unit_id
                     join crm_atendimento.procedures p on p.id = a.procedure_id
                     left join crm_atendimento.professionals inj on inj.id = a.injector_id
                     left join crm_atendimento.professionals con on con.id = a.consultant_id
                     ${whereSql}
                     group by 1
                     order by value desc, label
                     limit 12`,
                    params,
                ),
                pgPool.query(
                    `select
                        coalesce(nullif(con.name, ''), 'Sem consultor') as label,
                        count(*)::int as count,
                        coalesce(sum(a.quantity), 0)::numeric as quantity_total,
                        coalesce(sum(a.value), 0)::numeric as value
                     from crm_atendimento.attendances a
                     join crm_atendimento.units u on u.id = a.unit_id
                     join crm_atendimento.procedures p on p.id = a.procedure_id
                     left join crm_atendimento.professionals inj on inj.id = a.injector_id
                     left join crm_atendimento.professionals con on con.id = a.consultant_id
                     ${whereSql}
                     group by 1
                     order by value desc, label
                     limit 12`,
                    params,
                ),
            ])
            const summaryRow = summary.rows[0] || {}
            const totalAttendances = Number(summaryRow.total_attendances || 0)
            const totalValue = normalizeAggregateCountValue(summaryRow.total_value)
            return {
                summary: {
                    totalAttendances,
                    quantityTotal: normalizeAggregateCountValue(summaryRow.quantity_total),
                    countMode: 'row',
                    totalValue,
                    averageTicket: totalAttendances ? Math.round((totalValue / totalAttendances) * 100) / 100 : 0,
                    distinctClients: Number(summaryRow.distinct_clients || 0),
                },
                monthly: monthly.rows.map((item) => ({
                    month: item.month,
                    count: Number(item.count || 0),
                    quantityTotal: normalizeAggregateCountValue(item.quantity_total),
                    value: normalizeAggregateCountValue(item.value),
                })),
                rankings: {
                    procedures: procedures.rows.map((item) => ({
                        label: item.label,
                        count: Number(item.count || 0),
                        quantityTotal: normalizeAggregateCountValue(item.quantity_total),
                        value: normalizeAggregateCountValue(item.value),
                    })),
                    injectors: injectors.rows.map((item) => ({
                        label: item.label,
                        count: Number(item.count || 0),
                        quantityTotal: normalizeAggregateCountValue(item.quantity_total),
                        value: normalizeAggregateCountValue(item.value),
                    })),
                    consultants: consultants.rows.map((item) => ({
                        label: item.label,
                        count: Number(item.count || 0),
                        quantityTotal: normalizeAggregateCountValue(item.quantity_total),
                        value: normalizeAggregateCountValue(item.value),
                    })),
                },
            }
        },

        async listAttendances(query, actor) {
            await ensureReady()
            const { where, params } = buildAttendanceWhere(query, actor)
            const limit = sanitizeLimit(query?.limit, 100, 500)
            const offset = sanitizeOffset(query?.offset, 0)
            params.push(limit, offset)
            const out = await pgPool.query(
                `${ATTENDANCE_SELECT}
                 where ${where.join(' and ')}
                 order by a.service_date desc, a.created_at desc
                 limit $${params.length - 1} offset $${params.length}`,
                params,
            )
            const count = await pgPool.query(
                `select count(*)::int as total
                 from crm_atendimento.attendances a
                 join crm_atendimento.units u on u.id = a.unit_id
                 join crm_atendimento.procedures p on p.id = a.procedure_id
                 left join crm_atendimento.professionals inj on inj.id = a.injector_id
                 left join crm_atendimento.professionals con on con.id = a.consultant_id
                 where ${where.join(' and ')}`,
                params.slice(0, -2),
            )
            return {
                data: out.rows.map(mapAttendance),
                total: Number(count.rows[0]?.total || 0),
                limit,
                offset,
            }
        },

        async doctorSuggestion(query, actor) {
            await ensureReady()
            const unit = normalizeUnit(query?.unit || query?.unitSlug)
            const date = String(query?.date || '').trim()
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                const err = new Error('DATE_REQUIRED')
                err.statusCode = 400
                throw err
            }
            if (!actorCanReadUnit(actor, unit)) {
                const err = new Error('FORBIDDEN_UNIT')
                err.statusCode = 403
                throw err
            }
            const unitRow = await pgPool.query(
                `select id, slug, name from crm_atendimento.units where slug = $1 limit 1`,
                [unit.slug],
            )
            const persistedUnit = unitRow.rows[0]
            const assignment = persistedUnit
                ? await resolveScheduledInjectorForUnit(pgPool, persistedUnit, date)
                : { professional: null, origin: INJECTOR_ASSIGNMENT_ORIGIN.UNRESOLVED, reason: 'NO_SCHEDULED_INJECTOR' }
            return {
                unitSlug: unit.slug,
                unitName: persistedUnit?.name || unit.name,
                date,
                doctorId: assignment.professional?.canonicalId || null,
                doctorName: assignment.professional?.canonicalName || '',
                assignmentOrigin: assignment.origin,
                reason: assignment.reason || null,
            }
        },

        async reportPreview(query, actor) {
            await ensureReady()
            const unit = String(query?.unit || '').trim()
            const date = String(query?.date || '').trim()
            const from = String(query?.from || date || '').trim()
            const to = String(query?.to || date || '').trim()
            if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
                const err = new Error('PERIOD_REQUIRED')
                err.statusCode = 400
                throw err
            }
            const { where, params } = buildAttendanceWhere({ ...query, unit, from, to }, actor)
            where.push(`a.value > 0`)
            where.push(`coalesce(inj.name, '') <> ''`)
            const result = await pgPool.query(
                `${ATTENDANCE_SELECT}
                 where ${where.join(' and ')}
                 order by inj.name, a.service_date asc, a.created_at asc`,
                params,
            )
            const byDoctor = new Map()
            for (const row of result.rows.map(mapAttendance)) {
                const doctor = row.injectorName || 'Sem injetor'
                const item = byDoctor.get(doctor) || { doctorName: doctor, count: 0, quantityTotal: 0, totalValue: 0, remuneration: 0, rows: [] }
                item.count += 1
                item.quantityTotal += row.quantity
                item.totalValue += row.value
                item.rows.push({
                    date: row.date,
                    clientName: row.clientName,
                    procedureName: row.procedureName,
                    quantity: row.quantity,
                    value: row.value,
                    consultantName: row.consultantName,
                })
                byDoctor.set(doctor, item)
            }
            const doctors = Array.from(byDoctor.values()).map((item) => {
                const totalValue = Math.round(item.totalValue * 100) / 100
                const remuneration = calculateAttendanceRemuneration(totalValue)
                return {
                    ...item,
                    quantityTotal: normalizeAggregateCountValue(item.quantityTotal),
                    totalValue,
                    remuneration: remuneration.amount,
                    remunerationFormulaVersion: remuneration.formulaVersion,
                }
            }).sort((a, b) => a.doctorName.localeCompare(b.doctorName, 'pt-BR'))
            return {
                unit: unit || 'all',
                from,
                to,
                doctors,
                summary: {
                    doctors: doctors.length,
                    attendances: doctors.reduce((acc, item) => acc + item.count, 0),
                    quantityTotal: normalizeAggregateCountValue(doctors.reduce((acc, item) => acc + Number(item.quantityTotal || 0), 0)),
                    totalValue: Math.round(doctors.reduce((acc, item) => acc + item.totalValue, 0) * 100) / 100,
                    remuneration: Math.round(doctors.reduce((acc, item) => acc + item.remuneration, 0) * 100) / 100,
                },
                remunerationPolicy: ATTENDANCE_REMUNERATION_POLICY,
            }
        },

        async createAttendance(payload, actor) {
            await ensureReady()
            return withPgTransaction(pgPool, async (client) => {
                const input = normalizeAttendanceMutation(payload)
                assertActorCanMutateUnit(actor, input.unit)
                const idempotencyKey = normalizeIdempotencyKey(payload?.idempotencyKey)
                const actorName = actorIdentityForMutation(actor)
                if (idempotencyKey) {
                    const existing = await client.query(
                        `${ATTENDANCE_SELECT} where a.created_by = $1 and a.idempotency_key = $2 and a.deleted_at is null`,
                        [actorName, idempotencyKey],
                    )
                    if (existing.rows[0]) {
                        const persisted = mapAttendance(existing.rows[0])
                        assertActorCanMutateUnit(actor, { slug: persisted.unitSlug, name: persisted.unitName })
                        return persisted
                    }
                }
                const unit = await resolveAttendanceUnit(client, input.unit)
                const procedure = await resolveAttendanceProcedure(client, input.procedureName)
                const codeOk = await validateProcedureCode(client, procedure.id, input.code)
                if (!codeOk) throw mutationError('PROCEDURE_CODE_NOT_ALLOWED')
                const injectorAssignment = await resolveInjectorForCreate(client, input, actor, unit)
                const injector = injectorAssignment.professional
                const consultantAssignment = await resolveConsultantForCreate(client, input, actor, unit)
                const consultant = consultantAssignment.professional
                const attendanceClient = await upsertClient(client, unit.id, input.clientName)
                const inserted = await client.query(
                    `insert into crm_atendimento.attendances(
                        unit_id, service_date, client_name, procedure_id, code, quantity,
                        discount, other_value, round_value, value, injector_id, consultant_id,
                        observation, created_by, updated_by, idempotency_key, value_formula_version
                    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16)
                    on conflict(created_by, idempotency_key) where idempotency_key is not null do nothing
                    returning id`,
                    [
                        unit.id,
                        input.date,
                        attendanceClient.name,
                        procedure.id,
                        input.code,
                        input.quantity,
                        input.discount,
                        input.otherValue,
                        input.roundValue,
                        input.value,
                        injector?.canonicalId || null,
                        consultant?.canonicalId || null,
                        input.observation,
                        actorName,
                        idempotencyKey,
                        ATTENDANCE_VALUE_FORMULA_VERSION,
                    ],
                )
                const attendanceId = inserted.rows[0]?.id
                if (!attendanceId && idempotencyKey) {
                    const existing = await client.query(
                        `${ATTENDANCE_SELECT} where a.created_by = $1 and a.idempotency_key = $2 and a.deleted_at is null`,
                        [actorName, idempotencyKey],
                    )
                    if (existing.rows[0]) {
                        const persisted = mapAttendance(existing.rows[0])
                        assertActorCanMutateUnit(actor, { slug: persisted.unitSlug, name: persisted.unitName })
                        return persisted
                    }
                }
                if (!attendanceId) throw mutationError('ATTENDANCE_CREATE_FAILED', 409)
                await audit(client, 'attendance.create', actor, attendanceId, {
                    after: effectiveConsultantAuditInput(effectiveInjectorAuditInput(input, injector), consultant),
                    formulaVersion: ATTENDANCE_VALUE_FORMULA_VERSION,
                    clientValueIgnored: payload?.value !== undefined,
                    idempotencyKey,
                    consultantAssignment: {
                        origin: consultantAssignment.origin,
                        reason: consultantAssignment.reason || undefined,
                        match: consultantAssignment.match || undefined,
                        clientValueIgnored: !roleCanManage(actor) && hasConsultantPatch(payload),
                    },
                    injectorAssignment: {
                        origin: injectorAssignment.origin,
                        reason: injectorAssignment.reason || undefined,
                        clientValueIgnored: isConsultantActor(actor) && hasInjectorPatch(payload),
                    },
                })
                const row = await client.query(`${ATTENDANCE_SELECT} where a.id = $1`, [attendanceId])
                return mapAttendance(row.rows[0])
            })
        },

        async updateAttendance(id, payload, actor) {
            await ensureReady()
            return withPgTransaction(pgPool, async (client) => {
                const current = await client.query(`${ATTENDANCE_SELECT} where a.id = $1 and a.deleted_at is null`, [id])
                if (!current.rows[0]) {
                    const err = new Error('NOT_FOUND')
                    err.statusCode = 404
                    throw err
                }
                const before = mapAttendance(current.rows[0])
                assertActorCanMutateUnit(actor, { slug: before.unitSlug, name: before.unitName })
                const revision = expectedRevision(payload)
                if (revision !== before.revision) throw mutationError('REVISION_CONFLICT', 409)
                const canManageConsultant = roleCanManage(actor)
                const injectorLockedToSchedule = isConsultantActor(actor)
                if (injectorLockedToSchedule && hasInjectorPatch(payload) && !injectorPatchMatchesAttendance(payload, before)) {
                    throw mutationError('INJECTOR_ASSIGNMENT_FORBIDDEN', 403)
                }
                if (!canManageConsultant && hasConsultantPatch(payload) && !consultantPatchMatchesAttendance(payload, before)) {
                    throw mutationError('CONSULTANT_ASSIGNMENT_FORBIDDEN', 403)
                }
                const input = normalizeAttendanceMutation(canManageConsultant
                    ? { ...before, ...payload, ...(injectorLockedToSchedule ? { injectorId: before.injectorId, injectorName: before.injectorName } : {}) }
                    : {
                        ...before,
                        ...payload,
                        consultantId: before.consultantId,
                        consultantName: before.consultantName,
                        ...(injectorLockedToSchedule ? { injectorId: before.injectorId, injectorName: before.injectorName } : {}),
                    })
                assertActorCanMutateUnit(actor, input.unit)
                const unit = await resolveAttendanceUnit(client, input.unit)
                const procedure = await resolveAttendanceProcedure(client, input.procedureName)
                const codeOk = await validateProcedureCode(client, procedure.id, input.code)
                if (!codeOk) throw mutationError('PROCEDURE_CODE_NOT_ALLOWED')
                const injector = await resolveAttendanceProfessional(client, { id: input.injectorId, name: input.injectorName }, unit, 'Injetor')
                const consultant = canManageConsultant
                    ? await resolveAttendanceProfessional(client, { id: input.consultantId, name: input.consultantName }, unit, 'Consultor')
                    : (before.consultantId ? { canonicalId: before.consultantId, canonicalName: before.consultantName } : null)
                const attendanceClient = await upsertClient(client, unit.id, input.clientName)
                const updated = await client.query(
                    `update crm_atendimento.attendances set
                        unit_id=$2, service_date=$3, client_name=$4, procedure_id=$5, code=$6,
                        quantity=$7, discount=$8, other_value=$9, round_value=$10, value=$11,
                        injector_id=$12, consultant_id=$13, observation=$14, updated_by=$15,
                        value_formula_version=$16, revision = revision + 1, updated_at=now()
                     where id=$1 and revision=$17
                     returning id`,
                    [
                        id,
                        unit.id,
                        input.date,
                        attendanceClient.name,
                        procedure.id,
                        input.code,
                        input.quantity,
                        input.discount,
                        input.otherValue,
                        input.roundValue,
                        input.value,
                        injector?.canonicalId || null,
                        consultant?.canonicalId || null,
                        input.observation,
                        actorIdentityForMutation(actor),
                        ATTENDANCE_VALUE_FORMULA_VERSION,
                        revision,
                    ],
                )
                if (!updated.rows[0]) throw mutationError('REVISION_CONFLICT', 409)
                await audit(client, 'attendance.update', actor, id, {
                    before,
                    after: effectiveConsultantAuditInput(effectiveInjectorAuditInput(input, injector), consultant),
                    formulaVersion: ATTENDANCE_VALUE_FORMULA_VERSION,
                    clientValueIgnored: payload?.value !== undefined,
                    consultantAssignment: {
                        origin: canManageConsultant ? CONSULTANT_ASSIGNMENT_ORIGIN.MANAGER : CONSULTANT_ASSIGNMENT_ORIGIN.PRESERVED,
                        clientValueIgnored: !canManageConsultant && hasConsultantPatch(payload),
                    },
                    injectorAssignment: {
                        origin: injectorLockedToSchedule ? INJECTOR_ASSIGNMENT_ORIGIN.PRESERVED : INJECTOR_ASSIGNMENT_ORIGIN.MANAGER,
                        clientValueIgnored: injectorLockedToSchedule && hasInjectorPatch(payload),
                    },
                })
                const row = await client.query(`${ATTENDANCE_SELECT} where a.id = $1`, [id])
                return mapAttendance(row.rows[0])
            })
        },

        async deleteAttendance(id, payload, actor) {
            await ensureReady()
            return withPgTransaction(pgPool, async (client) => {
                const current = await client.query(`${ATTENDANCE_SELECT} where a.id = $1 and a.deleted_at is null`, [id])
                if (!current.rows[0]) {
                    const err = new Error('NOT_FOUND')
                    err.statusCode = 404
                    throw err
                }
                const before = mapAttendance(current.rows[0])
                assertActorCanMutateUnit(actor, { slug: before.unitSlug, name: before.unitName })
                const revision = expectedRevision(payload)
                if (revision !== before.revision) throw mutationError('REVISION_CONFLICT', 409)
                const deleted = await client.query(
                    `update crm_atendimento.attendances
                     set deleted_at = now(), updated_by = $2, revision = revision + 1, updated_at = now()
                     where id = $1 and revision = $3 and deleted_at is null
                     returning id`,
                    [id, actorIdentityForMutation(actor), revision],
                )
                if (!deleted.rows[0]) throw mutationError('REVISION_CONFLICT', 409)
                await audit(client, 'attendance.delete', actor, id, { before })
                return { ok: true }
            })
        },

        async importRecords({ records, cache, actor, dryRun = false, source = null }) {
            await ensureReady()
            if (dryRun) {
                return {
                    dryRun: true,
                    records: records.length,
                    procedures: cache?.procedures?.length || 0,
                    professionals: cache?.professionals?.length || 0,
                }
            }
            return withPgTransaction(pgPool, async (client) => {
                for (const unitName of ['Novo Hamburgo', 'BarraShoppingSul']) {
                    await upsertUnit(client, normalizeUnit(unitName))
                }
                for (const prof of cache?.professionals || []) {
                    await upsertProfessional(client, prof)
                }
                for (const name of cache?.procedures || []) {
                    await upsertProcedure(client, name)
                }
                for (const allowed of cache?.procedureCodes || []) {
                    const procedure = await upsertProcedure(client, allowed.procedureName)
                    await upsertProcedureCode(client, procedure?.id, allowed.code)
                }
                for (const schedule of cache?.schedules || []) {
                    await upsertScheduleDay(client, schedule)
                }
                let inserted = 0
                let updated = 0
                let skipped = 0
                for (const record of records) {
                    const unit = await upsertUnit(client, { slug: record.unitSlug, name: record.unitName })
                    const procedure = await upsertProcedure(client, record.procedureName)
                    await upsertProcedureCode(client, procedure.id, record.code)
                    const injector = await resolveHistoricalProfessional(client, record.injectorName, unit, 'Injetor')
                    const consultant = await resolveHistoricalProfessional(client, record.consultantName, unit, 'Consultor')
                    const attendanceClient = await upsertClient(client, unit.id, record.clientName)
                    const out = await client.query(
                        `insert into crm_atendimento.attendances(
                            unit_id, service_date, client_name, procedure_id, code, quantity,
                            discount, other_value, round_value, value, injector_id, consultant_id, injector_source_name, consultant_source_name,
                            observation, source_sheet_id, source_tab, source_row, created_by, updated_by
                        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)
                        on conflict(source_sheet_id, source_tab, source_row) where source_sheet_id is not null and source_tab is not null and source_row is not null
                        do update set
                            unit_id = excluded.unit_id,
                            service_date = excluded.service_date,
                            client_name = excluded.client_name,
                            procedure_id = excluded.procedure_id,
                            code = excluded.code,
                            quantity = excluded.quantity,
                            discount = excluded.discount,
                            other_value = excluded.other_value,
                            round_value = excluded.round_value,
                            value = excluded.value,
                            injector_id = excluded.injector_id,
                            consultant_id = excluded.consultant_id,
                            injector_source_name = excluded.injector_source_name,
                            consultant_source_name = excluded.consultant_source_name,
                            observation = excluded.observation,
                            updated_by = excluded.updated_by,
                            updated_at = now()
                        where crm_atendimento.attendances.deleted_at is not null
                           or (
                                crm_atendimento.attendances.unit_id,
                                crm_atendimento.attendances.service_date,
                                crm_atendimento.attendances.client_name,
                                crm_atendimento.attendances.procedure_id,
                                crm_atendimento.attendances.code,
                                crm_atendimento.attendances.quantity,
                                crm_atendimento.attendances.discount,
                                crm_atendimento.attendances.other_value,
                                crm_atendimento.attendances.round_value,
                                crm_atendimento.attendances.value,
                                crm_atendimento.attendances.injector_id,
                                crm_atendimento.attendances.consultant_id,
                                crm_atendimento.attendances.injector_source_name,
                                crm_atendimento.attendances.consultant_source_name,
                                crm_atendimento.attendances.observation
                            ) is distinct from (
                                excluded.unit_id,
                                excluded.service_date,
                                excluded.client_name,
                                excluded.procedure_id,
                                excluded.code,
                                excluded.quantity,
                                excluded.discount,
                                excluded.other_value,
                                excluded.round_value,
                                excluded.value,
                                excluded.injector_id,
                                excluded.consultant_id,
                                excluded.injector_source_name,
                                excluded.consultant_source_name,
                                excluded.observation
                            )
                        returning id, (xmax = 0) as inserted`,
                        [
                            unit.id,
                            record.date,
                            attendanceClient.name,
                            procedure.id,
                            record.code,
                            record.quantity,
                            record.discount,
                            record.otherValue,
                            record.roundValue,
                            record.value,
                            injector?.canonicalId || null,
                            consultant?.canonicalId || null,
                            String(record.injectorName || '').trim() || null,
                            String(record.consultantName || '').trim() || null,
                            record.observation || null,
                            record.sourceSheetId,
                            record.sourceTab,
                            record.sourceRow,
                            actorLabel(actor),
                        ],
                    )
                    if (out.rows[0]?.inserted) inserted += 1
                    else if (out.rows[0]) updated += 1
                    else skipped += 1
                }
                let importBatchId = null
                const sourceSheetId = String(source?.sourceSheetId || '').trim()
                if (sourceSheetId) {
                    const sourceName = String(source?.sourceName || 'Atendimento').trim().slice(0, 160) || 'Atendimento'
                    const tabs = Array.isArray(source?.tabs)
                        ? source.tabs.map((tab) => String(tab || '').trim()).filter(Boolean).slice(0, 32)
                        : []
                    const batch = await client.query(
                        `insert into crm_atendimento.import_batches(
                            source_sheet_id, source_name, dry_run, actor, summary)
                         values ($1, $2, false, $3::jsonb, $4::jsonb)
                         returning id`,
                        [
                            sourceSheetId,
                            sourceName,
                            JSON.stringify(actor || {}),
                            JSON.stringify({
                                records: records.length,
                                inserted,
                                updated,
                                skipped,
                                tabs,
                                snapshotComplete: source?.snapshotComplete === true,
                            }),
                        ],
                    )
                    importBatchId = batch.rows[0]?.id || null
                }
                await audit(client, 'import.google-sheet', actor, null, { inserted, updated, skipped, records: records.length })
                return { dryRun: false, records: records.length, inserted, updated, skipped, importBatchId }
            })
        },

        async managementCatalog(actor) {
            await ensureReady()
            const scheduleWhere = []
            const scheduleParams = []
            applyActorUnitFilter(scheduleWhere, scheduleParams, actor)
            const scheduleWhereSql = scheduleWhere.length ? `where ${scheduleWhere.join(' and ')}` : ''
            const [refs, latestImport, rawTabs, scheduleSummary] = await Promise.all([
                this.references(actor),
                pgPool.query(
                    `select id, source_sheet_id, source_name, dry_run, summary, created_at
                     from crm_atendimento.import_batches
                     where source_name = 'Gerência'
                     order by created_at desc
                     limit 1`,
                ),
                pgPool.query(
                    `select source_tab, category, bool_or(sensitive) as sensitive, count(*)::int as rows
                     from crm_atendimento.raw_sheet_rows
                     group by source_tab, category
                     order by source_tab`,
                ),
                pgPool.query(
                    `select u.slug as unit_slug, u.name as unit_name, count(*)::int as days,
                            min(s.service_date)::text as first_date,
                            max(s.service_date)::text as last_date
                     from crm_atendimento.schedule_days s
                     join crm_atendimento.units u on u.id = s.unit_id
                     ${scheduleWhereSql}
                     group by u.slug, u.name
                     order by u.name`,
                    scheduleParams,
                ),
            ])
            const latest = latestImport.rows[0] || null
            const latestTabs = Array.isArray(latest?.summary?.tabSummaries)
                ? latest.summary.tabSummaries.map((tab) => ({
                    name: tab.tabName,
                    category: tab.category,
                    sensitive: !!tab.sensitive,
                    rows: Number(tab.nonEmptyRows || tab.rowCount || 0),
                }))
                : null
            return {
                ...refs,
                appsScript: {
                    noServiceLabel: GERENCIA_APPS_SCRIPT_CONFIG.noServiceLabel,
                    sheets: GERENCIA_APPS_SCRIPT_CONFIG.sheets,
                    noServiceStyle: GERENCIA_APPS_SCRIPT_CONFIG.noServiceStyle,
                    schedulePattern: GERENCIA_APPS_SCRIPT_CONFIG.schedulePattern,
                    onEditMaxCells: GERENCIA_APPS_SCRIPT_CONFIG.onEditMaxCells,
                    backgroundCacheRange: GERENCIA_APPS_SCRIPT_CONFIG.backgroundCacheRange,
                    cache: GERENCIA_APPS_SCRIPT_CONFIG.cache,
                    features: GERENCIA_APPS_SCRIPT_CONFIG.features,
                    conversion: GERENCIA_APPS_SCRIPT_CONFIG.conversion,
                    reportPeriod: getReportPeriod(new Date()),
                    reports: GERENCIA_APPS_SCRIPT_CONFIG.reports,
                },
                scheduleDropdowns: buildScheduleDropdowns(refs.professionals || []),
                latestImport: latest,
                scheduleSummary: scheduleSummary.rows.map((row) => ({
                    unitSlug: row.unit_slug,
                    unitName: row.unit_name,
                    days: Number(row.days || 0),
                    firstDate: String(row.first_date || '').slice(0, 10),
                    lastDate: String(row.last_date || '').slice(0, 10),
                })),
                tabs: latestTabs || rawTabs.rows.map((row) => ({
                    name: row.source_tab,
                    category: row.category,
                    sensitive: !!row.sensitive,
                    rows: Number(row.rows || 0),
                })),
            }
        },

        async managementConversionReport(query, actor, options = {}) {
            await ensureReady()
            const date = String(query?.date || '').trim()
            const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : new Date()
            const rows = await pgPool.query(
                `select source_tab, source_row, cells
                 from crm_atendimento.raw_sheet_rows
                 where source_tab = 'Conversão'
                 order by source_row`,
            )
            const rawReport = buildConversionReportFromRawRows(rows.rows.map((row) => ({
                sourceTab: row.source_tab,
                sourceRow: Number(row.source_row || 0),
                cells: row.cells || [],
            })), reportDate)
            const report = filterConversionReportToActorScope(rawReport, query || {}, actor)
            const internalMetrics = await buildInternalConversionMetrics(pgPool, report.period, query || {}, actor, options)
            applyInternalConversionMetrics(report, internalMetrics)
            return report
        },

        async managementColorScores(payload, actor) {
            await ensureReady()
            return {
                scores: convertColorCodesToScores(payload?.colors || []),
                filteredBackgroundColors: payload?.cellRefs
                    ? getFilteredBackgroundColorsFromMatrix(payload.cellRefs, payload?.backgroundColors || payload?.colors || [], payload?.baseCell || 'C3')
                    : undefined,
                map: {
                    '#6d9eeb': 3,
                    '#93c47d': 2,
                    '#ffd966': 1,
                    '#e06666': 0,
                    '#ffffff': 0,
                },
            }
        },

        async managementCommercial(query, actor) {
            await ensureReady()
            const overviewData = await this.overview(query || {}, actor)
            const where = [`category = 'commercial'`, `sensitive = false`]
            const params = []
            applyManagementItemUnitFilter(where, params, actor)
            const items = await pgPool.query(
                `select *
                 from crm_atendimento.management_items
                 where ${where.join(' and ')}
                 order by source_tab, source_row
                 limit 500`,
                params,
            )
            const byTab = new Map()
            for (const item of items.rows.map(mapManagementItem)) {
                const entry = byTab.get(item.sourceTab) || { sourceTab: item.sourceTab, rows: 0, activeRows: 0 }
                entry.rows += 1
                if (item.active) entry.activeRows += 1
                byTab.set(item.sourceTab, entry)
            }
            return {
                summary: overviewData.summary,
                monthly: overviewData.monthly,
                rankings: overviewData.rankings,
                sourceTabs: Array.from(byTab.values()),
                items: items.rows.map(mapManagementItem).slice(0, 120),
            }
        },

        async managementFinance(actor) {
            await ensureReady()
            const where = [`category = 'finance'`, `sensitive = false`]
            const managementParams = []
            applyManagementItemUnitFilter(where, managementParams, actor)
            const rows = await pgPool.query(
                `select *
                 from crm_atendimento.management_items
                 where ${where.join(' and ')}
                 order by source_tab, source_row
                 limit 600`,
                managementParams,
            )
            const sourceTabs = new Map()
            for (const item of rows.rows.map(mapManagementItem)) {
                const entry = sourceTabs.get(item.sourceTab) || { sourceTab: item.sourceTab, rows: 0 }
                entry.rows += 1
                sourceTabs.set(item.sourceTab, entry)
            }
            const attendanceWhere = ['a.deleted_at is null']
            const params = []
            applyActorUnitFilter(attendanceWhere, params, actor)
            const totals = await pgPool.query(
                `select
                    u.slug as unit_slug,
                    u.name as unit_name,
                    count(*)::int as count,
                    coalesce(sum(a.quantity), 0)::numeric as quantity_total,
                    coalesce(sum(a.value), 0)::numeric as value
                 from crm_atendimento.attendances a
                 join crm_atendimento.units u on u.id = a.unit_id
                 join crm_atendimento.procedures p on p.id = a.procedure_id
                 left join crm_atendimento.professionals inj on inj.id = a.injector_id
                 left join crm_atendimento.professionals con on con.id = a.consultant_id
                 where ${attendanceWhere.join(' and ')}
                 group by u.slug, u.name
                 order by u.name`,
                params,
            )
            const monthlyGoalResult = await listMonthlyGoals(pgPool, {}, actor)
            return {
                sourceTabs: Array.from(sourceTabs.values()),
                items: rows.rows.map(mapManagementItem),
                monthlyGoals: monthlyGoalResult.goals,
                monthlyGoalLevels: monthlyGoalResult.goalLevels,
                goalTables: (await listGoalTables(pgPool, {}, actor)).tables,
                attendanceTotals: {
                    units: totals.rows
                        .filter((row) => actorCanReadUnit(actor, row.unit_slug))
                        .map((item) => ({
                            unitSlug: item.unit_slug,
                            unitName: item.unit_name,
                            count: Number(item.count || 0),
                            quantityTotal: normalizeAggregateCountValue(item.quantity_total),
                            value: normalizeAggregateCountValue(item.value),
                        })),
                },
            }
        },

        async managementMonthlyGoals(query, actor) {
            await ensureReady()
            return listMonthlyGoals(pgPool, query || {}, actor)
        },

        async managementGoalTables(query, actor) {
            await ensureReady()
            return listGoalTables(pgPool, query || {}, actor)
        },

        async upsertMonthlyGoal(payload, actor) {
            await ensureReady()
            assertManager(actor)
            const unit = normalizeUnit(payload?.unitSlug || payload?.unitName)
            if (!unit.slug) {
                const err = new Error('INVALID_UNIT')
                err.statusCode = 400
                throw err
            }
            const month = normalizeGoalMonth(payload?.month)
            const incomingLevels = payload?.levels && typeof payload.levels === 'object' ? payload.levels : { first: payload?.value }
            const normalizedLevels = MONTHLY_GOAL_LEVELS
                .filter((level) => incomingLevels[level.key] !== undefined)
                .map((level) => ({
                    ...level,
                    value: normalizeGoalLevelValue(incomingLevels[level.key], level.label),
                }))
            if (!normalizedLevels.length) {
                const err = new Error('INVALID_GOAL_LEVELS')
                err.statusCode = 400
                throw err
            }
            const firstGoal = normalizedLevels.find((level) => level.key === 'first') || normalizedLevels[0]
            return withPgTransaction(pgPool, async (client) => {
                const savedUnit = await upsertUnit(client, unit)
                const row = await client.query(
                    `insert into crm_atendimento.monthly_unit_goals(unit_id, goal_month, value, created_by, updated_by, source_sheet_id, source_tab, source_row, source_col, source_payload)
                     values ($1, $2::date, $3, $4, $4, null, null, null, null, '{}'::jsonb)
                     on conflict(unit_id, goal_month) do update set
                        value = excluded.value,
                        updated_by = excluded.updated_by,
                        source_sheet_id = null,
                        source_tab = null,
                        source_row = null,
                        source_col = null,
                        source_payload = '{}'::jsonb,
                        updated_at = now()
                     returning id, unit_id, goal_month, value, updated_by, updated_at, source_tab, source_row, source_col`,
                    [savedUnit.id, month, firstGoal.value, actorLabel(actor)],
                )
                const savedLevels = []
                for (const level of normalizedLevels) {
                    const levelRow = await client.query(
                        `insert into crm_atendimento.monthly_unit_goal_levels(unit_id, goal_month, level_key, level_label, value, created_by, updated_by, source_sheet_id, source_tab, source_row, source_col, source_payload)
                         values ($1, $2::date, $3, $4, $5, $6, $6, null, null, null, null, '{}'::jsonb)
                         on conflict(unit_id, goal_month, level_key) do update set
                            level_label = excluded.level_label,
                            value = excluded.value,
                            updated_by = excluded.updated_by,
                            source_sheet_id = null,
                            source_tab = null,
                            source_row = null,
                            source_col = null,
                            source_payload = '{}'::jsonb,
                            updated_at = now()
                         returning id, unit_id, goal_month, level_key, level_label, value, updated_by, updated_at, source_tab, source_row, source_col`,
                        [savedUnit.id, month, level.key, level.label, level.value, actorLabel(actor)],
                    )
                    savedLevels.push(mapMonthlyGoalLevel({ ...levelRow.rows[0], unit_slug: savedUnit.slug, unit_name: savedUnit.name }))
                }
                await audit(client, 'monthly_goal.upsert', actor, null, {
                    unitSlug: savedUnit.slug,
                    unitName: savedUnit.name,
                    month: month.slice(0, 7),
                    value: firstGoal.value,
                    levels: Object.fromEntries(normalizedLevels.map((level) => [level.key, level.value])),
                })
                return {
                    goal: mapMonthlyGoal({ ...row.rows[0], unit_slug: savedUnit.slug, unit_name: savedUnit.name }),
                    goalLevels: savedLevels,
                }
            })
        },

        async managementInventory(actor) {
            await ensureReady()
            const rows = await pgPool.query(
                `select *
                 from crm_atendimento.inventory_items
                 order by product`,
            )
            return {
                data: rows.rows.map((row) => ({
                    id: row.id,
                    product: row.product,
                    barraShoppingSul: actorCanReadUnit(actor, 'barra-shopping-sul') ? Number(row.barra_shopping_sul || 0) : null,
                    novoHamburgo: actorCanReadUnit(actor, 'novo-hamburgo') ? Number(row.novo_hamburgo || 0) : null,
                    sourceRow: Number(row.source_row || 0),
                    importedAt: row.imported_at,
                })),
            }
        },

        async managementPeople(actor) {
            await ensureReady()
            assertManager(actor)
            const professionals = await pgPool.query(
                `select id, name, role, status, units, shift, roles, turnos, background_color, font_color, font_family, font_size, font_weight, font_style, alias, phone, email, instagram
                 from crm_atendimento.professionals
                 order by name`,
            )
            const items = await pgPool.query(
                `select *
                 from crm_atendimento.management_items
                 where category = 'people'
                 order by source_tab, source_row
                 limit 500`,
            )
            return {
                professionals: professionals.rows.map((row) => mapProfessional(row, true)),
                items: items.rows.map(mapManagementItem),
            }
        },

        async managementInsumosFeed(actor) {
            await ensureReady()
            const inventory = await this.managementInventory(actor)
            const data = (inventory.data || []).map((item) => ({
                source: 'gerencia-inventario',
                sourceRow: item.sourceRow,
                codigoBarras: `BRINDE-GERENCIA-${String(item.sourceRow || item.product).replace(/\D+/g, '').padStart(4, '0')}`,
                produto: item.product,
                categoria: 'Brindes',
                marca: '',
                tipoUnidade: 'un',
                fonte: 'Gerência',
                estoqueMinimo: 0,
                estoques: {
                    ...(item.barraShoppingSul === null ? {} : { BarraShoppingSul: item.barraShoppingSul }),
                    ...(item.novoHamburgo === null ? {} : { 'Novo Hamburgo': item.novoHamburgo }),
                },
                importedAt: item.importedAt,
            }))
            return {
                destination: 'insumos',
                category: 'Brindes',
                items: data,
                summary: {
                    items: data.length,
                    units: Array.from(new Set(data.flatMap((item) => Object.keys(item.estoques || {})))).sort(),
                },
            }
        },

        async managementEscalaFeed(actor) {
            await ensureReady()
            assertManager(actor)
            const professionals = await pgPool.query(
                `select id, name, role, status, units, shift, roles, turnos, background_color, font_color, font_family, font_size, font_weight, font_style, alias, phone, email, instagram
                 from crm_atendimento.professionals
                 order by name`,
            )
            const scheduleWhere = []
            const scheduleParams = []
            applyActorUnitFilter(scheduleWhere, scheduleParams, actor)
            const schedule = await pgPool.query(
                `select s.service_date, s.doctor_name, u.slug as unit_slug, u.name as unit_name
                 from crm_atendimento.schedule_days s
                 join crm_atendimento.units u on u.id = s.unit_id
                 ${scheduleWhere.length ? `where ${scheduleWhere.join(' and ')}` : ''}
                 order by s.service_date, u.name`,
                scheduleParams,
            )
            const noService = normalizeText(GERENCIA_APPS_SCRIPT_CONFIG.noServiceLabel)
            const scheduleEntries = []
            const closedDays = []
            for (const row of schedule.rows) {
                const date = String(row.service_date || '').slice(0, 10)
                const unit = row.unit_name || row.unit_slug
                const doctor = String(row.doctor_name || '').trim()
                if (!date || !unit) continue
                if (!doctor || normalizeText(doctor) === noService) {
                    closedDays.push({ date, unit, reason: GERENCIA_APPS_SCRIPT_CONFIG.noServiceLabel })
                    continue
                }
                scheduleEntries.push({ date, unit, professional: doctor })
            }
            const mappedProfessionals = professionals.rows
                .filter((row) => professionalMatchesAllowedUnits(row, actor))
                .map((row) => {
                    const person = mapProfessional(row, true)
                    return {
                        name: person.name,
                        status: person.status || 'Ativo',
                        units: person.units || [],
                        role: person.role || (person.roles || [])[0] || '',
                        shift: person.shift || (person.turnos || [])[0] || '',
                        nickname: person.alias || '',
                        phone: person.phone || '',
                        email: person.email || '',
                        instagram: person.instagram || '',
                        color: person.backgroundColor || '',
                        source: 'gerencia-equipe',
                    }
                })
            return {
                destination: 'escala-profissionais',
                professionals: mappedProfessionals,
                schedule: scheduleEntries,
                closedDays,
                summary: {
                    professionals: mappedProfessionals.length,
                    scheduleEntries: scheduleEntries.length,
                    closedDays: closedDays.length,
                },
            }
        },

        async managementRawTabs(query, actor) {
            await ensureReady()
            assertManager(actor)
            const tab = String(query?.tab || '').trim()
            const limit = sanitizeLimit(query?.limit, 100, 1000)
            const offset = sanitizeOffset(query?.offset, 0)
            if (!tab) {
                const [tabs, latestImport] = await Promise.all([pgPool.query(
                    `select source_tab, category, bool_or(sensitive) as sensitive, count(*)::int as rows,
                            max(imported_at) as imported_at
                     from crm_atendimento.raw_sheet_rows
                     group by source_tab, category
                     order by source_tab`,
                ), pgPool.query(
                    `select summary
                     from crm_atendimento.import_batches
                     where source_name = 'Gerência'
                     order by created_at desc
                     limit 1`,
                )])
                const latestTabs = Array.isArray(latestImport.rows[0]?.summary?.tabSummaries)
                    ? latestImport.rows[0].summary.tabSummaries.map((row) => ({
                        name: row.tabName,
                        category: row.category,
                        sensitive: !!row.sensitive,
                        rows: Number(row.nonEmptyRows || row.rowCount || 0),
                        importedAt: null,
                    }))
                    : null
                return {
                    tabs: latestTabs || tabs.rows.map((row) => ({
                        name: row.source_tab,
                        category: row.category,
                        sensitive: !!row.sensitive,
                        rows: Number(row.rows || 0),
                        importedAt: row.imported_at,
                    })),
                    rows: [],
                    total: 0,
                    limit,
                    offset,
                }
            }
            const rows = await pgPool.query(
                `select *
                 from crm_atendimento.raw_sheet_rows
                 where source_tab = $1
                 order by source_row
                 limit $2 offset $3`,
                [tab, limit, offset],
            )
            const total = await pgPool.query(
                `select count(*)::int as total
                 from crm_atendimento.raw_sheet_rows
                 where source_tab = $1`,
                [tab],
            )
            return {
                tabs: [],
                rows: rows.rows.map((row) => ({
                    sourceTab: row.source_tab,
                    sourceRow: Number(row.source_row || 0),
                    category: row.category,
                    sensitive: !!row.sensitive,
                    cells: row.cells || [],
                    importedAt: row.imported_at,
                })),
                total: Number(total.rows[0]?.total || 0),
                limit,
                offset,
            }
        },

        async importGerenciaWorkbook({ workbook, actor, dryRun = false }) {
            const summary = {
                tabs: workbook.tabs.length,
                rawRows: workbook.rawRows.length,
                procedures: workbook.procedures.length,
                procedureCodes: workbook.procedureCodes.length,
                professionals: workbook.professionals.length,
                schedules: workbook.schedules.length,
                inventory: workbook.inventory.length,
                managementItems: workbook.managementItems.length,
                goalTableRows: (workbook.goalTableRows || []).length,
                monthlyGoals: (workbook.monthlyGoals || []).length,
                monthlyGoalLevels: (workbook.monthlyGoalLevels || []).length,
                tabSummaries: workbook.tabs,
            }
            if (dryRun) {
                return { dryRun: true, ...summary }
            }
            await ensureReady()
            return withPgTransaction(pgPool, async (client) => {
                const batch = await client.query(
                    `insert into crm_atendimento.import_batches(source_sheet_id, source_name, dry_run, actor, summary)
                     values ($1, 'Gerência', false, $2::jsonb, $3::jsonb)
                     returning id, created_at`,
                    [workbook.spreadsheetId, JSON.stringify(actor || {}), JSON.stringify(summary)],
                )

                await client.query(`delete from crm_atendimento.raw_sheet_rows where source_sheet_id = $1`, [workbook.spreadsheetId])
                await client.query(`delete from crm_atendimento.management_items where source_sheet_id = $1`, [workbook.spreadsheetId])
                await client.query(`delete from crm_atendimento.inventory_items where source_sheet_id = $1`, [workbook.spreadsheetId])
                await client.query(`delete from crm_atendimento.goal_table_rows where source_sheet_id = $1`, [workbook.spreadsheetId])
                await client.query(`delete from crm_atendimento.monthly_unit_goals where source_sheet_id = $1`, [workbook.spreadsheetId])
                await client.query(`delete from crm_atendimento.monthly_unit_goal_levels where source_sheet_id = $1`, [workbook.spreadsheetId])

                const procedureCache = new Map()
                const procedureCodeCache = new Set()
                const ensureProcedure = async (name) => {
                    const safeName = String(name || '').trim()
                    if (!safeName) return null
                    if (procedureCache.has(safeName)) return procedureCache.get(safeName)
                    const procedure = await upsertProcedure(client, safeName)
                    procedureCache.set(safeName, procedure)
                    return procedure
                }
                const ensureProcedureCode = async (allowed) => {
                    const procedure = await ensureProcedure(allowed?.procedureName)
                    const code = normalizeCode(allowed?.code)
                    if (!procedure?.id || !code) return null
                    const key = `${procedure.id}|${code}`
                    if (procedureCodeCache.has(key)) return null
                    procedureCodeCache.add(key)
                    return upsertProcedureCode(client, procedure.id, code)
                }

                for (const unitName of ['Novo Hamburgo', 'BarraShoppingSul']) {
                    await upsertUnit(client, normalizeUnit(unitName))
                }
                for (const name of workbook.procedures || []) {
                    await ensureProcedure(name)
                }
                for (const allowed of workbook.procedureCodes || []) {
                    await ensureProcedureCode(allowed)
                }
                for (const prof of workbook.professionals || []) {
                    await upsertProfessional(client, prof)
                }
                for (const schedule of workbook.schedules || []) {
                    await upsertScheduleDay(client, schedule)
                }
                for (const row of workbook.rawRows || []) {
                    await client.query(
                        `insert into crm_atendimento.raw_sheet_rows(source_sheet_id, source_tab, source_row, category, sensitive, cells)
                         values ($1,$2,$3,$4,$5,$6::jsonb)
                         on conflict(source_sheet_id, source_tab, source_row)
                         do update set category = excluded.category, sensitive = excluded.sensitive, cells = excluded.cells, imported_at = now()`,
                        [workbook.spreadsheetId, row.tabName, row.rowNumber, row.category, !!row.sensitive, JSON.stringify(row.cells || [])],
                    )
                }
                for (const item of workbook.managementItems || []) {
                    await client.query(
                        `insert into crm_atendimento.management_items(
                            source_sheet_id, source_tab, source_row, category, label, active, sensitive, unit_slug, record_date, payload
                         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
                         on conflict(source_sheet_id, source_tab, source_row, category, label)
                         do update set active = excluded.active, sensitive = excluded.sensitive, unit_slug = excluded.unit_slug,
                            record_date = excluded.record_date, payload = excluded.payload, imported_at = now()`,
                        [
                            workbook.spreadsheetId,
                            item.sourceTab,
                            item.sourceRow,
                            item.category,
                            item.label,
                            !!item.active,
                            !!item.sensitive,
                            item.unitSlug || null,
                            item.recordDate || null,
                            JSON.stringify(item.payload || {}),
                        ],
                    )
                }
                for (const item of workbook.inventory || []) {
                    await client.query(
                        `insert into crm_atendimento.inventory_items(source_sheet_id, source_row, product, barra_shopping_sul, novo_hamburgo)
                         values ($1,$2,$3,$4,$5)
                         on conflict(source_sheet_id, source_row)
                         do update set product = excluded.product, barra_shopping_sul = excluded.barra_shopping_sul,
                            novo_hamburgo = excluded.novo_hamburgo, imported_at = now()`,
                        [workbook.spreadsheetId, item.sourceRow, item.product, item.barraShoppingSul, item.novoHamburgo],
                    )
                }
                for (const row of workbook.goalTableRows || []) {
                    await client.query(
                        `insert into crm_atendimento.goal_table_rows(source_sheet_id, source_tab, source_row, year, unit_slug, unit_name, label, values, formulas)
                         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
                         on conflict(source_sheet_id, source_tab, source_row, unit_slug)
                         do update set year = excluded.year, unit_name = excluded.unit_name, label = excluded.label,
                            values = excluded.values, formulas = excluded.formulas, imported_at = now()`,
                        [
                            workbook.spreadsheetId,
                            row.sourceTab,
                            row.sourceRow,
                            row.year,
                            row.unitSlug,
                            row.unitName,
                            row.label,
                            JSON.stringify(row.values || []),
                            JSON.stringify(row.formulas || []),
                        ],
                    )
                }
                const unitCache = new Map()
                const ensureUnit = async (unitLike) => {
                    const unit = normalizeUnit(unitLike?.unitSlug || unitLike?.unitName)
                    if (unitCache.has(unit.slug)) return unitCache.get(unit.slug)
                    const saved = await upsertUnit(client, unit)
                    unitCache.set(unit.slug, saved)
                    return saved
                }
                for (const goal of workbook.monthlyGoals || []) {
                    const savedUnit = await ensureUnit(goal)
                    await client.query(
                        `insert into crm_atendimento.monthly_unit_goals(unit_id, goal_month, value, created_by, updated_by, source_sheet_id, source_tab, source_row, source_col, source_payload)
                         values ($1, $2::date, $3, $4, $4, $5, $6, $7, $8, $9::jsonb)
                         on conflict(unit_id, goal_month) do update set
                            value = excluded.value,
                            updated_by = excluded.updated_by,
                            source_sheet_id = excluded.source_sheet_id,
                            source_tab = excluded.source_tab,
                            source_row = excluded.source_row,
                            source_col = excluded.source_col,
                            source_payload = excluded.source_payload,
                            updated_at = now()`,
                        [
                            savedUnit.id,
                            goal.month,
                            goal.value,
                            'gerencia-import',
                            workbook.spreadsheetId,
                            goal.sourceTab,
                            goal.sourceRow,
                            goal.sourceCol || null,
                            JSON.stringify(goal.sourcePayload || {}),
                        ],
                    )
                }
                for (const goal of workbook.monthlyGoalLevels || []) {
                    const savedUnit = await ensureUnit(goal)
                    await client.query(
                        `insert into crm_atendimento.monthly_unit_goal_levels(unit_id, goal_month, level_key, level_label, value, created_by, updated_by, source_sheet_id, source_tab, source_row, source_col, source_payload)
                         values ($1, $2::date, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11::jsonb)
                         on conflict(unit_id, goal_month, level_key) do update set
                            level_label = excluded.level_label,
                            value = excluded.value,
                            updated_by = excluded.updated_by,
                            source_sheet_id = excluded.source_sheet_id,
                            source_tab = excluded.source_tab,
                            source_row = excluded.source_row,
                            source_col = excluded.source_col,
                            source_payload = excluded.source_payload,
                            updated_at = now()`,
                        [
                            savedUnit.id,
                            goal.month,
                            goal.levelKey || 'first',
                            goal.levelLabel || '1ª META',
                            goal.value,
                            'gerencia-import',
                            workbook.spreadsheetId,
                            goal.sourceTab,
                            goal.sourceRow,
                            goal.sourceCol || null,
                            JSON.stringify(goal.sourcePayload || {}),
                        ],
                    )
                }

                await audit(client, 'import.google-sheet.gerencia', actor, null, {
                    batchId: batch.rows[0]?.id,
                    ...summary,
                })
                return {
                    dryRun: false,
                    batchId: batch.rows[0]?.id,
                    importedAt: batch.rows[0]?.created_at,
                    ...summary,
                }
            })
        },

        roleCanManage,
    }
}
