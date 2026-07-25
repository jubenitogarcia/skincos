import { createHmac } from 'node:crypto'
import { createPgPool, withPgTransaction } from '../harmonia/store/pg.js'
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
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now()
        );`,
        `create table if not exists crm_atendimento.procedure_price_codes (
            id uuid primary key default gen_random_uuid(),
            procedure_id uuid not null references crm_atendimento.procedures(id) on delete cascade,
            code text not null,
            allowed boolean not null default true,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(procedure_id, code)
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
    if ((path === '/references' || path.startsWith('/management/catalog')) && allowed.includes('procedimentos')) return true
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
    const cutLineFormula = `${stats.formulas?.cutLine || 'linha_corte = (media_periodo * 0.30) + (mediana_periodo * 0.20) + (meta_diaria * 0.50)'}; valores = (${Number(stats.average || 0).toFixed(2)} * 0.30) + (${Number(stats.median || 0).toFixed(2)} * 0.20) + (${Number(stats.dailyGoal || 0).toFixed(2)} * 0.50)`
    const intervalFormula = `${stats.formulas?.interval || 'intervalo = desvio_padrao(realizado_doutores) * multiplicador_intervalo'}; valores = ${Number(stats.standardDeviation || 0).toFixed(2)} * ${Number(stats.intervalMultiplier || 0).toFixed(2)}`
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
        average: moneyMetric(stats.average, unitName, 'Média'),
        median: moneyMetric(stats.median, unitName, 'Mediana'),
        standardDeviation: moneyMetric(stats.standardDeviation, unitName, 'Desvio Padrão'),
        upperRatio: moneyMetric(stats.ratios.upperRatio, unitName, 'Razão Superior'),
        lowerRatio: moneyMetric(stats.ratios.lowerRatio, unitName, 'Razão Inferior'),
        innerRatio: moneyMetric(stats.ratios.innerRatio, unitName, 'Razão Interior'),
        outerRatio: moneyMetric(stats.ratios.outerRatio, unitName, 'Razão Exterior'),
        lowerSide: moneyMetric(balancedReasons.lowerSide, unitName, 'Lado Inferior'),
        upperSide: moneyMetric(balancedReasons.upperSide, unitName, 'Lado Superior'),
        centerShare: moneyMetric(balancedReasons.center, unitName, 'Faixas Centrais'),
        extremesShare: moneyMetric(balancedReasons.extremes, unitName, 'Faixas Extremas'),
        ratioDivisor: moneyMetric(stats.ratioDivisor, unitName, 'Divisor Razões', { formula: divisorFormula, levelCounts }),
        cutLine: moneyMetric(stats.cutLine, unitName, 'Linha Corte', { formula: cutLineFormula }),
        interval: moneyMetric(stats.interval, unitName, 'Intervalo', { formula: intervalFormula }),
        intervalMultiplier: moneyMetric(stats.intervalMultiplier, unitName, 'Multiplicador Otimizado'),
        homogeneityScore: moneyMetric(stats.homogeneityScore, unitName, 'Homogeneidade', { formula: homogeneityFormula }),
        lowerLimit: moneyMetric(stats.lowerLimit, unitName, 'Limite Inferior'),
        upperLimit: moneyMetric(stats.upperLimit, unitName, 'Limite Superior'),
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
                    coalesce(inj_canonical.name, inj.name) as doctor_name, coalesce(sum(a.value), 0)::numeric as total
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
        `select u.slug as unit_slug, s.service_date, s.doctor_name
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
        unitMap.set(row.doctor_id, Number(row.total || 0))
        unitMap.set(normalizeText(row.doctor_name), Number(row.total || 0))
        doctorTotalByUnit.set(row.unit_slug, unitMap)
    }

    const scheduleByUnit = new Map()
    for (const row of scheduleRows.rows) {
        const unitMap = scheduleByUnit.get(row.unit_slug) || new Map()
        unitMap.set(isoDateFromDb(row.service_date), row.doctor_name)
        scheduleByUnit.set(row.unit_slug, unitMap)
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
        const doctors = (professionalsByUnit.get(unit.slug) || [])
            .map((doctor) => ({
                id: doctor.id,
                name: doctor.name,
                unitSlug: unit.slug,
                unitName: unit.name,
                realized: Number(totals.get(doctor.id) ?? totals.get(normalizeText(doctor.name)) ?? 0),
            }))
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
                realized: Number(doctor.weekValue || 0),
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
        const aggregateDoctors = aggregateStats.ranking.map((doctor) => ({
            id: doctor.id,
            name: doctor.name,
            unitName: 'Todas unidades',
            unitSlug: 'all',
            weekValue: moneyMetric(doctor.weekValue).weekValue,
            totalValue: moneyMetric(doctor.totalValue).totalValue,
            score: doctor.score,
            level: doctor.level,
            classification: doctor.classification,
            modifiedZ: doctor.modifiedZ,
            distanceToCutOff: doctor.distanceToCutOff,
            distanceToLowerLimit: doctor.distanceToLowerLimit,
            distanceToUpperLimit: doctor.distanceToUpperLimit,
            rank: doctor.rank,
            position: '',
        }))
        // The aggregate has summed capacity, never a fictional shared calendar.
        // Its doctor list is also the canonical, cross-unit consolidation used
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
        status: row.status,
        owner: row.owner || '',
        dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
        notes: row.notes || '',
        outcomeNotes: row.outcome_notes || '',
        createdBy: row.created_by || '',
        completedAt: row.completed_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }
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
    const result = await pgPool.query(
        `select active_contact_cooldown_days, return_risk_thresholds, updated_by, updated_at
         from crm_atendimento.commercial_policy_config where singleton = true`,
    )
    const row = result.rows[0] || {}
    return {
        activeContactCooldownDays: Number(row.active_contact_cooldown_days || 30),
        returnRiskThresholds: Array.isArray(row.return_risk_thresholds) ? row.return_risk_thresholds.map(Number) : [90, 180, 365],
        updatedBy: row.updated_by || '',
        updatedAt: row.updated_at || null,
    }
}

async function queryCommercialProfiles(pgPool, { asOf, unitSlug, thresholds }) {
    const result = await pgPool.query(
        `with identities as (
            select gi.id as identity_id, gi.canonical_name, gi.source_types
            from crm_atendimento.global_client_identities gi
            where exists (select 1 from crm_atendimento.global_client_identity_members gm where gm.identity_id = gi.id)
         ), attendance_members as (
            select distinct gm.identity_id, coalesce(cc.merged_into_id, cc.id) as client_id
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
            where a.deleted_at is null and a.service_date <= $1::date and ($2 = '' or u.slug = $2)
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
            where a.deleted_at is null and a.service_date > $1::date and ($2 = '' or u.slug = $2)
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
            where s.occurred_on <= $1::date and ($2 = '' or u.slug = $2)
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
            select identity_id, count(*)::int as active_action_count, max(created_at) as last_action_at
            from crm_atendimento.commercial_actions
            where status = any($3::text[]) group by identity_id
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
         order by i.canonical_name`,
        [asOf, unitSlug, COMMERCIAL_ACTIVE_ACTION_STATUSES],
    )
    return segmentCommercialProfiles(result.rows.map((row) => ({
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
    })), { asOf, thresholds }).map((profile) => ({
        ...profile,
        activeActionCount: Number(result.rows.find((row) => row.identity_id === profile.identityId)?.active_action_count || 0),
        lastActionAt: result.rows.find((row) => row.identity_id === profile.identityId)?.last_action_at || null,
    }))
}

function filterCommercialProfiles(profiles, query) {
    const segment = String(query?.segment || '').trim()
    const priority = String(query?.priority || '').trim()
    const search = normalizeText(query?.q || query?.search || '')
    return profiles.filter((profile) => {
        if (segment && !profile.segments.some((item) => item.key === segment)) return false
        if (priority && profile.priority !== priority) return false
        if (search && !normalizeText(`${profile.name} ${profile.phone} ${profile.email}`).includes(search)) return false
        return true
    })
}

async function queryCommercialActionMetrics(pgPool) {
    const metrics = await pgPool.query(
        `with actions as (
            select id, identity_id, created_at::date as action_date
            from crm_atendimento.commercial_actions
         ), action_sales as (
            select distinct action.id, action.identity_id
            from actions action
            join crm_atendimento.global_client_identity_members gm on gm.identity_id = action.identity_id and gm.source_type = 'caixa_customer'
            join crm_caixa.sales sale on sale.customer_id = gm.source_id::uuid and sale.occurred_on >= action.action_date
         ), action_returns as (
            select distinct action.id, action.identity_id
            from actions action
            join crm_atendimento.global_client_identity_members gm on gm.identity_id = action.identity_id and gm.source_type = 'attendance_client'
            join crm_atendimento.attendance_client_links acl on acl.client_id = gm.source_id::uuid
            join crm_atendimento.attendances attendance on attendance.id = acl.attendance_id
            where attendance.deleted_at is null and attendance.service_date >= action.action_date
         )
         select (select count(*)::int from actions) as actions,
                (select count(distinct identity_id)::int from action_sales) as recovered_sales_clients,
                (select count(distinct identity_id)::int from action_returns) as clinical_return_clients`,
    )
    const row = metrics.rows[0] || {}
    return {
        actions: Number(row.actions || 0),
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

async function queryIdentityReviewQueue(pgPool, query = {}) {
    const type = String(query.type || '').trim()
    const search = normalizeText(query.q || query.search || '')
    const limit = sanitizeLimit(query.limit, 100, 250)
    const offset = sanitizeOffset(query.offset, 0)
    const result = await pgPool.query(
        `with review_items as (
            select 'attendance_name_merge'::text as type, m.id::text as id, m.status, m.similarity::numeric as confidence,
                left_client.canonical_name as primary_name, right_client.canonical_name as secondary_name,
                m.evidence, jsonb_build_object('leftAttendanceCount', left_client.attendance_count, 'rightAttendanceCount', right_client.attendance_count,
                    'leftAliases', coalesce((select jsonb_agg(alias_name order by usage_count desc) from crm_atendimento.client_aliases where client_id=left_client.id), '[]'::jsonb),
                    'rightAliases', coalesce((select jsonb_agg(alias_name order by usage_count desc) from crm_atendimento.client_aliases where client_id=right_client.id), '[]'::jsonb)) as context
            from crm_atendimento.client_merge_suggestions m
            join crm_atendimento.canonical_clients left_client on left_client.id=m.left_client_id
            join crm_atendimento.canonical_clients right_client on right_client.id=m.right_client_id
            where m.status='pending'
            union all
            select 'attendance_caixa'::text, link.id::text, link.status, link.confidence::numeric, client.canonical_name, customer.name, link.evidence,
                jsonb_build_object('attendanceCount', client.attendance_count, 'aliases', coalesce((select jsonb_agg(alias_name order by usage_count desc) from crm_atendimento.client_aliases where client_id=client.id), '[]'::jsonb),
                    'phoneKey', customer.phone_key, 'sales', coalesce((select count(*) from crm_caixa.sales where customer_id=customer.id),0),
                    'salesTotal', coalesce((select sum(total) from crm_caixa.sales where customer_id=customer.id),0))
            from crm_atendimento.client_caixa_links link join crm_atendimento.canonical_clients client on client.id=link.client_id join crm_caixa.customers customer on customer.id=link.caixa_customer_id
            where link.status in ('suggested','ambiguous')
            union all
            select 'app_attendance'::text, app_link.app_registration_id||':'||app_link.client_id::text, app_link.status, app_link.confidence::numeric, app.canonical_name, client.canonical_name, app_link.evidence,
                jsonb_build_object('appPhones',app.phone_keys,'appEmails',app.email_keys,'appUnits',app.unit_slugs,'attendanceCount',client.attendance_count,
                    'aliases',coalesce((select jsonb_agg(alias_name order by usage_count desc) from crm_atendimento.client_aliases where client_id=client.id),'[]'::jsonb))
            from crm_atendimento.app_registration_attendance_links app_link join crm_atendimento.app_client_registrations app on app.source_client_id=app_link.app_registration_id join crm_atendimento.canonical_clients client on client.id=app_link.client_id
            where app_link.status in ('suggested','ambiguous')
            union all
            select 'app_caixa'::text, app_link.app_registration_id||':'||app_link.caixa_customer_id::text, app_link.status, app_link.confidence::numeric, app.canonical_name, customer.name, app_link.evidence,
                jsonb_build_object('appPhones',app.phone_keys,'appEmails',app.email_keys,'appUnits',app.unit_slugs,'phoneKey',customer.phone_key,
                    'sales',coalesce((select count(*) from crm_caixa.sales where customer_id=customer.id),0),'salesTotal',coalesce((select sum(total) from crm_caixa.sales where customer_id=customer.id),0))
            from crm_atendimento.app_registration_caixa_links app_link join crm_atendimento.app_client_registrations app on app.source_client_id=app_link.app_registration_id join crm_caixa.customers customer on customer.id=app_link.caixa_customer_id
            where app_link.status in ('suggested','ambiguous')
            union all
            select 'lead_app'::text, link.source_profile_id||':'||link.app_registration_id, link.status, link.confidence::numeric, lead.canonical_name, app.canonical_name, link.evidence,
                jsonb_build_object('leadPhones',lead.phone_keys,'leadEmails',lead.email_keys,'leadUnits',lead.unit_slugs,'leadBirthdays',lead.birthdays,
                    'appPhones',app.phone_keys,'appEmails',app.email_keys,'appUnits',app.unit_slugs)
            from crm_atendimento.supplemental_lead_profile_app_links link join crm_atendimento.supplemental_lead_profiles lead on lead.source_profile_id=link.source_profile_id join crm_atendimento.app_client_registrations app on app.source_client_id=link.app_registration_id
            where link.status in ('suggested','ambiguous')
            union all
            select 'lead_caixa'::text, link.source_profile_id||':'||link.caixa_customer_id::text, link.status, link.confidence::numeric, lead.canonical_name, customer.name, link.evidence,
                jsonb_build_object('leadPhones',lead.phone_keys,'leadEmails',lead.email_keys,'leadUnits',lead.unit_slugs,'leadBirthdays',lead.birthdays,
                    'phoneKey',customer.phone_key,'sales',coalesce((select count(*) from crm_caixa.sales where customer_id=customer.id),0),'salesTotal',coalesce((select sum(total) from crm_caixa.sales where customer_id=customer.id),0))
            from crm_atendimento.supplemental_lead_profile_caixa_links link join crm_atendimento.supplemental_lead_profiles lead on lead.source_profile_id=link.source_profile_id join crm_caixa.customers customer on customer.id=link.caixa_customer_id
            where link.status in ('suggested','ambiguous')
        ), filtered as (
            select *, count(*) over()::int as total from review_items
            where ($1='' or type=$1) and ($2='' or lower(primary_name||' '||secondary_name||' '||coalesce(evidence::text,'')||' '||coalesce(context::text,'')) like '%'||$2||'%')
        ) select * from filtered order by case status when 'ambiguous' then 0 else 1 end, confidence desc nulls last, primary_name, secondary_name limit $3 offset $4`,
        [type, search, limit, offset],
    )
    return { total: Number(result.rows[0]?.total || 0), limit, offset, items: result.rows.map((row) => ({
        id: row.id, type: row.type, status: row.status, confidence: Number(row.confidence || 0), primaryName: row.primary_name,
        secondaryName: row.secondary_name, evidence: row.evidence || {}, context: row.context || {},
    })) }
}

export function createAtendimentoStore(options = {}) {
    const pgPool = options.pool || createAtendimentoPool(options.databaseUrl)
    let readinessPromise = null

    async function ensureReady() {
        requirePool(pgPool)
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
                `select p.id, p.name, coalesce(json_agg(c.code order by c.code) filter (where c.code is not null), '[]'::json) as codes
                 from crm_atendimento.procedures p
                 left join crm_atendimento.procedure_price_codes c on c.procedure_id = p.id and c.allowed = true
                 group by p.id, p.name
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
                    codes: Array.isArray(row.codes) ? row.codes : [],
                })),
            }
        },

        async commercialOverview(query, actor) {
            await ensureReady()
            assertManager(actor)
            await assertCommercialIdentitySource(pgPool)
            const asOf = commercialAsOf(query?.asOf)
            const policy = await readCommercialPolicy(pgPool)
            const profiles = await queryCommercialProfiles(pgPool, {
                asOf,
                unitSlug: commercialUnit(query?.unit),
                thresholds: policy.returnRiskThresholds,
            })
            const filtered = filterCommercialProfiles(profiles, query)
            const limit = sanitizeLimit(query?.limit, 100, 250)
            const offset = sanitizeOffset(query?.offset, 0)
            const [quality, mappedItems, allItems, actions] = await Promise.all([
                pgPool.query(`select count(*)::int as future_attendances from crm_atendimento.attendances where deleted_at is null and service_date > $1::date`, [asOf]),
                pgPool.query(`select count(*)::int as count from crm_caixa.sale_items where mapping_status = 'mapped'`),
                pgPool.query(`select count(*)::int as count from crm_caixa.sale_items`),
                queryCommercialActionMetrics(pgPool),
            ])
            return {
                asOf,
                policy,
                summary: summarizeCommercialProfiles(profiles),
                actions,
                coverage: {
                    confirmedIdentities: profiles.length,
                    classifiedSaleItems: Number(mappedItems.rows[0]?.count || 0),
                    saleItems: Number(allItems.rows[0]?.count || 0),
                },
                dataQuality: {
                    futureAttendancesExcluded: Number(quality.rows[0]?.future_attendances || 0),
                    recencySource: 'completed_attendance_only',
                    saleItemsWithoutClassification: Math.max(0, Number(allItems.rows[0]?.count || 0) - Number(mappedItems.rows[0]?.count || 0)),
                },
                total: filtered.length,
                limit,
                offset,
                profiles: filtered.slice(offset, offset + limit),
            }
        },

        async identityReviewQueue(query, actor) {
            await ensureReady()
            assertManager(actor)
            await assertIdentityReviewSource(pgPool)
            return queryIdentityReviewQueue(pgPool, query)
        },

        async commercialProfile(identityId, query, actor) {
            await ensureReady()
            assertManager(actor)
            await assertCommercialIdentitySource(pgPool)
            const id = String(identityId || '').trim()
            if (!id) {
                const error = new Error('COMMERCIAL_IDENTITY_REQUIRED')
                error.statusCode = 400
                throw error
            }
            const asOf = commercialAsOf(query?.asOf)
            const policy = await readCommercialPolicy(pgPool)
            const profiles = await queryCommercialProfiles(pgPool, {
                asOf,
                unitSlug: commercialUnit(query?.unit),
                thresholds: policy.returnRiskThresholds,
            })
            const profile = profiles.find((item) => item.identityId === id)
            if (!profile) {
                const error = new Error('COMMERCIAL_IDENTITY_NOT_FOUND')
                error.statusCode = 404
                throw error
            }
            const [actions, cadences] = await Promise.all([
                pgPool.query(
                    `select action.*, unit.slug as unit_slug, unit.name as unit_name
                     from crm_atendimento.commercial_actions action
                     left join crm_atendimento.units unit on unit.id = action.unit_id
                     where action.identity_id = $1 order by action.created_at desc limit 100`,
                    [id],
                ),
                pgPool.query(
                    `select procedure.id, procedure.name, cadence.cadence_days, cadence.status, cadence.notes,
                            unit.slug as unit_slug, unit.name as unit_name, cadence.approved_at, cadence.approved_by
                     from crm_atendimento.procedures procedure
                     left join crm_atendimento.commercial_procedure_cadences cadence
                        on cadence.procedure_id = procedure.id and cadence.status = 'approved'
                     left join crm_atendimento.units unit on unit.id = cadence.unit_id
                     where procedure.name = any($1::text[])
                     order by procedure.name`,
                    [profile.completedProcedures],
                ),
            ])
            return {
                asOf,
                policy,
                profile,
                actions: actions.rows.map(mapCommercialAction),
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

        async commercialPolicy(actor) {
            await ensureReady()
            assertManager(actor)
            return { policy: await readCommercialPolicy(pgPool) }
        },

        async updateCommercialPolicy(payload, actor) {
            await ensureReady()
            assertManager(actor)
            const cooldown = Number(payload?.activeContactCooldownDays)
            if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 180) {
                const error = new Error('INVALID_ACTIVE_CONTACT_COOLDOWN')
                error.statusCode = 400
                throw error
            }
            const thresholds = commercialThresholds(payload?.returnRiskThresholds)
            const result = await pgPool.query(
                `update crm_atendimento.commercial_policy_config
                 set active_contact_cooldown_days = $1, return_risk_thresholds = $2::int[], updated_by = $3, updated_at = now()
                 where singleton = true
                 returning active_contact_cooldown_days, return_risk_thresholds, updated_by, updated_at`,
                [cooldown, thresholds, actorLabel(actor)],
            )
            await audit(pgPool, 'commercial.policy.updated', actor, null, { cooldown, thresholds })
            const row = result.rows[0] || {}
            return { policy: {
                activeContactCooldownDays: Number(row.active_contact_cooldown_days || cooldown),
                returnRiskThresholds: row.return_risk_thresholds || thresholds,
                updatedBy: row.updated_by || actorLabel(actor),
                updatedAt: row.updated_at || null,
            } }
        },

        async commercialCadences(actor) {
            await ensureReady()
            assertManager(actor)
            const result = await pgPool.query(
                `select cadence.id, cadence.procedure_id, procedure.name as procedure_name, cadence.cadence_days, cadence.status,
                        cadence.notes, cadence.approved_by, cadence.approved_at, cadence.updated_by, cadence.updated_at,
                        unit.slug as unit_slug, unit.name as unit_name
                 from crm_atendimento.commercial_procedure_cadences cadence
                 join crm_atendimento.procedures procedure on procedure.id = cadence.procedure_id
                 left join crm_atendimento.units unit on unit.id = cadence.unit_id
                 order by procedure.name, unit.name nulls first`,
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
            assertManager(actor)
            const procedureId = String(payload?.procedureId || '').trim()
            const status = String(payload?.status || 'draft').trim()
            const cadenceDays = Number(payload?.cadenceDays)
            if (!procedureId || !['draft', 'approved', 'disabled'].includes(status) || !Number.isInteger(cadenceDays) || cadenceDays < 1 || cadenceDays > 1095) {
                const error = new Error('INVALID_CLINICAL_CADENCE')
                error.statusCode = 400
                throw error
            }
            const unitSlug = commercialUnit(payload?.unit)
            const unit = unitSlug ? await pgPool.query(`select id from crm_atendimento.units where slug = $1`, [unitSlug]) : { rows: [] }
            if (unitSlug && !unit.rows[0]?.id) {
                const error = new Error('COMMERCIAL_UNIT_NOT_FOUND')
                error.statusCode = 404
                throw error
            }
            const result = await pgPool.query(
                `insert into crm_atendimento.commercial_procedure_cadences(
                    procedure_id, unit_id, cadence_days, status, notes, approved_by, approved_at, updated_by)
                 values ($1, $2, $3, $4, $5, $6, case when $4 = 'approved' then now() else null end, $6)
                 on conflict(procedure_id, unit_id) do update set cadence_days = excluded.cadence_days, status = excluded.status,
                    notes = excluded.notes, approved_by = case when excluded.status = 'approved' then excluded.approved_by else null end,
                    approved_at = case when excluded.status = 'approved' then now() else null end,
                    updated_by = excluded.updated_by, updated_at = now()
                 returning id`,
                [procedureId, unit.rows[0]?.id || null, cadenceDays, status, String(payload?.notes || '').trim() || null, actorLabel(actor)],
            )
            await audit(pgPool, 'commercial.cadence.upserted', actor, null, { cadenceId: result.rows[0]?.id, procedureId, unitSlug, status, cadenceDays })
            return { id: result.rows[0]?.id }
        },

        async createCommercialAction(payload, actor) {
            await ensureReady()
            assertManager(actor)
            await assertCommercialIdentitySource(pgPool)
            const identityId = String(payload?.identityId || '').trim()
            const segmentKey = String(payload?.segmentKey || '').trim()
            const actionType = String(payload?.actionType || 'contact').trim()
            const owner = String(payload?.owner || '').trim()
            const dueDate = String(payload?.dueDate || '').trim() || null
            if (!identityId || !segmentKey || !COMMERCIAL_ACTION_TYPES.has(actionType) || (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
                const error = new Error('INVALID_COMMERCIAL_ACTION')
                error.statusCode = 400
                throw error
            }
            const unitSlug = commercialUnit(payload?.unit)
            return withPgTransaction(pgPool, async (client) => {
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
                const cooldown = Number(policy.rows[0]?.active_contact_cooldown_days || 30)
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
                        identity_id, unit_id, segment_key, action_type, owner, due_date, notes, created_by, updated_by)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,$8)
                     returning id`,
                    [identityId, unit.rows[0]?.id || null, segmentKey, actionType, owner || null, dueDate, String(payload?.notes || '').trim() || null, actorLabel(actor)],
                )
                await audit(client, 'commercial.action.created', actor, null, { actionId: created.rows[0]?.id, identityId, segmentKey, actionType, unitSlug })
                return { id: created.rows[0]?.id }
            })
        },

        async updateCommercialAction(actionId, payload, actor) {
            await ensureReady()
            assertManager(actor)
            const id = String(actionId || '').trim()
            const status = String(payload?.status || '').trim()
            if (!id || !COMMERCIAL_ACTION_STATUSES.has(status)) {
                const error = new Error('INVALID_COMMERCIAL_ACTION_STATUS')
                error.statusCode = 400
                throw error
            }
            const result = await pgPool.query(
                `update crm_atendimento.commercial_actions
                 set status = $2, owner = coalesce(nullif($3, ''), owner), outcome_notes = coalesce(nullif($4, ''), outcome_notes),
                     completed_at = case when $2 in ('won_sale','returned','closed','cancelled') then now() else completed_at end,
                     updated_by = $5, updated_at = now()
                 where id = $1
                 returning id`,
                [id, status, String(payload?.owner || '').trim(), String(payload?.outcomeNotes || '').trim(), actorLabel(actor)],
            )
            if (!result.rows[0]?.id) {
                const error = new Error('COMMERCIAL_ACTION_NOT_FOUND')
                error.statusCode = 404
                throw error
            }
            await audit(pgPool, 'commercial.action.updated', actor, null, { actionId: id, status })
            return { id, status }
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

        async importRecords({ records, cache, actor, dryRun = false }) {
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
                await audit(client, 'import.google-sheet', actor, null, { inserted, updated, skipped, records: records.length })
                return { dryRun: false, records: records.length, inserted, updated, skipped }
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
