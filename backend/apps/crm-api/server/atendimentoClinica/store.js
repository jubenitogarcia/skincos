import { createHmac } from 'node:crypto'
import { createPgPool, withPgTransaction } from '../harmonia/store/pg.js'
import {
    buildConversionReportFromRawRows,
    buildScheduleDropdowns,
    calculateAttendanceValue,
    calculateConversionGoalPlan,
    calculateDoctorConversionRanking,
    convertColorCodesToScores,
    GERENCIA_APPS_SCRIPT_CONFIG,
    getDoctorConversionIntervalMultiplier,
    getFilteredBackgroundColorsFromMatrix,
    getReportPeriod,
    normalizeCode,
    normalizeText,
    normalizeUnit,
    resolveConversionMetricBounds,
    sanitizeLimit,
    sanitizeOffset,
    splitIsoDateRangeByMonth,
    splitList,
} from './domain.js'

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
            injector_id uuid references crm_atendimento.professionals(id),
            consultant_id uuid references crm_atendimento.professionals(id),
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
            source_year int,
            created_at timestamptz not null default now(),
            updated_at timestamptz not null default now(),
            unique(unit_id, service_date)
        );`,
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
    ]
}

export async function migrateAtendimento(client) {
    for (const sql of atendimentoMigrationStatements()) {
        await client.query(sql)
    }
    await upsertUnit(client, normalizeUnit('Novo Hamburgo'))
    await upsertUnit(client, normalizeUnit('BarraShoppingSul'))
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

function roleCanManage(actor) {
    const role = String(actor?.role || '').trim().toUpperCase()
    return role === 'GESTOR' || role === 'GERENTE'
}

function normalizeAllowedUnitKeys(actor) {
    const raw = Array.isArray(actor?.allowedUnits) ? actor.allowedUnits : []
    return new Set(raw.map((unit) => normalizeUnit(unit).slug).filter(Boolean))
}

function professionalMatchesAllowedUnits(row, allowed) {
    if (!allowed?.size) return true
    const units = Array.isArray(row?.units) ? row.units : []
    if (!units.length) return true
    return units.some((unit) => allowed.has(normalizeUnit(unit).slug))
}

export function canAccessAtendimento(actor, requestPath = '', requestMethod = 'GET') {
    if (roleCanManage(actor)) return true
    const allowed = Array.isArray(actor?.allowedModules) ? actor.allowedModules.map(String) : []
    if (!allowed.length) return true
    if (allowed.includes('atendimento-clinica')) return true
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
    const allowed = normalizeAllowedUnitKeys(actor)
    if (!allowed.size) return
    params.push(Array.from(allowed))
    where.push(`u.slug = any($${params.length})`)
}

function applyManagementItemUnitFilter(where, params, actor, column = 'unit_slug') {
    const allowed = normalizeAllowedUnitKeys(actor)
    if (!allowed.size) return
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
        id: String(actor?.id || actor?.email || 'crm-api-atendimento-clinica'),
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

async function readEscalaScheduleCoverage(selectedUnits, start, end, actor) {
    const { target, actorKey } = getEscalaApiConfig()
    if (!target || !actorKey || !selectedUnits.length) return { source: 'legacy-import', byUnit: new Map(), available: false }
    const serviceActor = buildEscalaServiceActor(actor)
    const months = monthKeysBetween(start, end)
    const byUnit = new Map(selectedUnits.map((unit) => [unit.slug, {
        unit,
        scheduledDates: new Set(),
        closedDates: new Set(),
        holidayDates: new Set(),
        coveredMonths: new Set(),
    }]))
    try {
        for (const unit of selectedUnits) {
            const coverage = byUnit.get(unit.slug)
            for (const month of months) {
                const json = await fetchEscalaJson(target, actorKey, serviceActor, '/schedule', { unit: unit.name, month })
                const scheduleRows = Array.isArray(json.schedule) ? json.schedule : []
                const closedRows = Array.isArray(json.closedDays) ? json.closedDays : []
                const holidayRows = Array.isArray(json.holidays) ? json.holidays : []
                if (scheduleRows.length || closedRows.length) coverage.coveredMonths.add(month)
                scheduleRows.forEach((row) => {
                    const date = isoDateFromDb(row.date)
                    if (date) coverage.scheduledDates.add(date)
                })
                closedRows.forEach((row) => {
                    const date = isoDateFromDb(row.date)
                    if (date) {
                        coverage.closedDates.add(date)
                        coverage.coveredMonths.add(date.slice(0, 7))
                    }
                })
                holidayRows.forEach((row) => {
                    const date = isoDateFromDb(row.date)
                    if (date) coverage.holidayDates.add(date)
                })
            }
        }
        return { source: 'escala-crm', byUnit, available: true }
    } catch (error) {
        console.warn('atendimento-clinica escala coverage fallback', error?.message || error)
        return { source: 'legacy-import', byUnit: new Map(), available: false, error: String(error?.message || error || '') }
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
        if (legacySchedule?.size) {
            if (isOperationalScheduleValue(legacySchedule.get(date))) total += 1
        } else if (defaultOperationalDay(unitSlug, date)) {
            total += 1
        }
    }
    return total
}

function professionalIsActiveInjectorForUnit(row, unitSlug) {
    if (normalizeText(row?.status || 'Ativo') !== 'ativo') return false
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

function buildConversionMetricPayload(stats, unitName) {
    const levelCounts = stats.levelCounts || { level0: 0, level1: 0, level2: 0, level3: 0 }
    const cutLineFormula = `${stats.formulas?.cutLine || 'linha_corte = (media * 0.30) + (mediana * 0.20) + (meta_diaria * 0.50)'}; valores = (${Number(stats.average || 0).toFixed(2)} * 0.30) + (${Number(stats.median || 0).toFixed(2)} * 0.20) + (${Number(stats.dailyGoal || 0).toFixed(2)} * 0.50)`
    const intervalFormula = `${stats.formulas?.interval || 'intervalo = desvio_padrao(realizado_doutores) * multiplicador_intervalo'}; valores = ${Number(stats.standardDeviation || 0).toFixed(2)} * ${Number(stats.intervalMultiplier || 0).toFixed(2)}`
    const divisorFormula = `${stats.formulas?.ratioDivisor || 'divisor = (level0 * 0) + (level1 * 1) + (level2 * 2) + (level3 * 3)'}; valores = (${levelCounts.level0 || 0} * 0) + (${levelCounts.level1 || 0} * 1) + (${levelCounts.level2 || 0} * 2) + (${levelCounts.level3 || 0} * 3)`
    return {
        total: moneyMetric(stats.total, unitName, 'TOTAL'),
        rankedDoctorTotal: moneyMetric(stats.rankedDoctorTotal ?? stats.total, unitName, 'TOTAL RANQUEÁVEL'),
        periodAttendanceTotal: moneyMetric(stats.periodAttendanceTotal ?? stats.total, unitName, 'TOTAL GERAL'),
        eligibleDoctorCount: moneyMetric(stats.eligibleDoctorCount, unitName, 'Doutores elegíveis'),
        monthlyGoal: moneyMetric(stats.monthlyGoal, unitName, 'Meta Mensal', { formula: 'meta_mensal = 1ª meta mensal da unidade/mês no CRM' }),
        weeklyGoal: moneyMetric(stats.weeklyGoal, unitName, 'Meta Semanal', { formula: 'meta_semanal = meta_diaria * dias_trabalhados_periodo' }),
        dailyGoal: moneyMetric(stats.dailyGoal, unitName, 'Meta Diária', { formula: 'meta_diaria = meta_mensal / dias_trabalhados_mes' }),
        monthOperationalDays: moneyMetric(stats.monthOperationalDays, unitName, 'Dias mês', { formula: 'dias_trabalhados_mes = dias operacionais do mês pela Escala CRM ou fallback' }),
        periodOperationalDays: moneyMetric(stats.periodOperationalDays, unitName, 'Dias período', { formula: 'dias_trabalhados_periodo = dias operacionais dentro do período selecionado' }),
        average: moneyMetric(stats.average, unitName, 'Média'),
        median: moneyMetric(stats.median, unitName, 'Mediana'),
        standardDeviation: moneyMetric(stats.standardDeviation, unitName, 'Desvio padrão'),
        upperRatio: moneyMetric(stats.ratios.upperRatio, unitName, 'Razão Superior'),
        lowerRatio: moneyMetric(stats.ratios.lowerRatio, unitName, 'Razão Inferior'),
        innerRatio: moneyMetric(stats.ratios.innerRatio, unitName, 'Razão Interior'),
        outerRatio: moneyMetric(stats.ratios.outerRatio, unitName, 'Razão Exterior'),
        ratioDivisor: moneyMetric(stats.ratioDivisor, unitName, 'Divisor Razões', { formula: divisorFormula, levelCounts }),
        cutLine: moneyMetric(stats.cutLine, unitName, 'Linha Corte', { formula: cutLineFormula }),
        interval: moneyMetric(stats.interval, unitName, 'Intervalo', { formula: intervalFormula }),
        intervalMultiplier: moneyMetric(stats.intervalMultiplier, unitName, 'Multiplicador'),
        lowerLimit: moneyMetric(stats.lowerLimit, unitName, 'Limite Inferior'),
        upperLimit: moneyMetric(stats.upperLimit, unitName, 'Limite Superior'),
        level0: moneyMetric(levelCounts.level0 || 0, unitName, 'Nível 0', { formula: 'nivel_0 = realizado < limite_inferior' }),
        level1: moneyMetric(levelCounts.level1 || 0, unitName, 'Nível 1', { formula: 'nivel_1 = limite_inferior <= realizado < linha_corte' }),
        level2: moneyMetric(levelCounts.level2 || 0, unitName, 'Nível 2', { formula: 'nivel_2 = linha_corte <= realizado < limite_superior' }),
        level3: moneyMetric(levelCounts.level3 || 0, unitName, 'Nível 3', { formula: 'nivel_3 = realizado >= limite_superior' }),
    }
}

async function buildInternalConversionMetrics(pgPool, period, query, actor) {
    const reportBounds = monthBoundsFromReportPeriod(period)
    const bounds = resolveConversionMetricBounds(reportBounds, query)
    const intervalMultiplier = getDoctorConversionIntervalMultiplier(GERENCIA_APPS_SCRIPT_CONFIG)
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

    const monthSegments = splitIsoDateRangeByMonth(bounds.metricStart || bounds.weekStart, bounds.metricEnd || bounds.weekEnd)
    const goalMonthKeys = monthSegments.map((segment) => segment.monthKey)
    const scheduleStart = monthSegments[0]?.monthStart || bounds.monthStart
    const scheduleEnd = monthSegments[monthSegments.length - 1]?.monthEnd || bounds.monthEnd
    const [professionals, weeklyTotals, doctorTotals, scheduleRows, goals, goalLevels] = await Promise.all([
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
            `select u.slug as unit_slug, inj.id as doctor_id, inj.name as doctor_name, coalesce(sum(a.value), 0)::numeric as total
             from crm_atendimento.attendances a
             join crm_atendimento.units u on u.id = a.unit_id
             join crm_atendimento.professionals inj on inj.id = a.injector_id
             where a.deleted_at is null
               and a.service_date >= $1::date
               and a.service_date <= $2::date
               and u.slug = any($3)
             group by u.slug, inj.id, inj.name`,
            [bounds.metricStart, bounds.metricEnd, unitSlugs],
        ),
        pgPool.query(
            `select u.slug as unit_slug, s.service_date, s.doctor_name
             from crm_atendimento.schedule_days s
             join crm_atendimento.units u on u.id = s.unit_id
             where s.service_date >= $1::date
               and s.service_date <= $2::date
               and u.slug = any($3)`,
            [scheduleStart, scheduleEnd, unitSlugs],
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
    const escalaCoverage = await readEscalaScheduleCoverage(selectedUnits, scheduleStart, scheduleEnd, actor)

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
    const allDoctorInputs = []
    const allDailyGoals = []
    const allWeeklyGoals = []
    let allMonthlyGoal = 0
    let allMonthOperationalDays = 0
    let allPeriodOperationalDays = 0

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
        const stats = calculateDoctorConversionRanking({
            doctors,
            monthlyGoal: goalPlan.monthlyGoal,
            periodAttendanceTotal,
            monthOperationalDays: goalPlan.monthOperationalDays,
            weekOperationalDays: goalPlan.periodOperationalDays,
            dailyGoal: goalPlan.dailyGoal,
            weeklyGoal: goalPlan.weeklyGoal,
            intervalMultiplier,
        })
        byUnit.set(unit.slug, buildConversionMetricPayload(stats, unit.name))
        sections.push({
            unitName: unit.name,
            unitSlug: unit.slug,
            metrics: byUnit.get(unit.slug),
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
                rank: doctor.rank,
                position: '',
            })),
            isAggregate: false,
            period: bounds,
        })
        allDoctorInputs.push(...doctors)
        allDailyGoals.push(stats.dailyGoal)
        allWeeklyGoals.push(stats.weeklyGoal)
        allMonthlyGoal += goalPlan.monthlyGoal
        allMonthOperationalDays += goalPlan.monthOperationalDays
        allPeriodOperationalDays += goalPlan.periodOperationalDays
    }

    const allStats = calculateDoctorConversionRanking({
        doctors: allDoctorInputs,
        monthlyGoal: allMonthlyGoal,
        monthOperationalDays: allMonthOperationalDays,
        weekOperationalDays: allPeriodOperationalDays,
        dailyGoal: allDailyGoals.reduce((sum, value) => sum + value, 0),
        weeklyGoal: allWeeklyGoals.reduce((sum, value) => sum + value, 0),
        periodAttendanceTotal: Array.from(weeklyTotalByUnit.values()).reduce((sum, value) => sum + value, 0),
        intervalMultiplier,
    })
    const allMetrics = buildConversionMetricPayload(allStats, 'Todas unidades')
    byUnit.set('all', allMetrics)
    const allDoctors = sections
        .flatMap((section) => section.doctors)
        .sort((left, right) => Number(right.weekValue || 0) - Number(left.weekValue || 0)
            || Number(right.score || 0) - Number(left.score || 0)
            || left.name.localeCompare(right.name, 'pt-BR'))
        .map((doctor, index) => ({ ...doctor, rank: index + 1 }))
    if (!requestedUnit || requestedUnit === 'all') {
        sections.unshift({
            unitName: 'Todas unidades',
            unitSlug: 'all',
            metrics: allMetrics,
            doctors: allDoctors,
            isAggregate: false,
            period: bounds,
        })
    }
    const scheduleCoverageRows = escalaCoverage.byUnit ? Array.from(escalaCoverage.byUnit.values()) : []
    return {
        byUnit,
        sections,
        topDoctors: allDoctors.slice(0, 8),
        period: bounds,
        intervalMultiplier,
        scheduleSource: escalaCoverage.source || 'legacy-import',
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
    }
    report.summary = {
        ...(report.summary || {}),
        doctorRankingSource: 'crm',
        scheduleSource: internalMetrics.scheduleSource || 'legacy-import',
        scheduleCoverageMonths: internalMetrics.scheduleCoverageMonths || [],
    }
    return report
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

export async function upsertProfessional(client, input) {
    const name = String(input?.name || '').trim()
    if (!name || ['Injetor', 'Consultor', 'Selecione'].includes(name)) return null
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
    return row.rows[0]
}

async function upsertScheduleDay(client, input) {
    if (!input?.date || !input?.unitSlug) return null
    const unit = await upsertUnit(client, { slug: input.unitSlug, name: input.unitName || input.unitSlug })
    const row = await client.query(
        `insert into crm_atendimento.schedule_days(unit_id, service_date, doctor_name, source_year)
         values ($1, $2::date, $3, $4)
         on conflict(unit_id, service_date) do update set
            doctor_name = excluded.doctor_name,
            source_year = excluded.source_year,
            updated_at = now()
         returning id, service_date, doctor_name, source_year`,
        [unit.id, input.date, String(input.doctorName || '').trim() || null, Number(input.year) || null],
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
        injectorName: row.injector_name || '',
        consultantName: row.consultant_name || '',
        observation: row.observation || '',
        sourceTab: row.source_tab || null,
        sourceRow: row.source_row || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }
}

function assertManager(actor) {
    if (roleCanManage(actor)) return
    const err = new Error('FORBIDDEN')
    err.statusCode = 403
    throw err
}

function mapProfessional(row, includeSensitive = false) {
    const base = {
        id: row.id,
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
    const allowed = normalizeAllowedUnitKeys(actor)
    const units = await pgPool.query(`select slug, name from crm_atendimento.units order by name`)
    return {
        goals: goals.rows.map(mapMonthlyGoal),
        goalLevels: goalLevels.rows.map(mapMonthlyGoalLevel),
        units: units.rows
            .filter((row) => !allowed.size || allowed.has(row.slug))
            .map((row) => ({ slug: row.slug, name: row.name })),
    }
}

const ATTENDANCE_SELECT = `
    select a.*, u.slug as unit_slug, u.name as unit_name, p.name as procedure_name,
           inj.name as injector_name, con.name as consultant_name
    from crm_atendimento.attendances a
    join crm_atendimento.units u on u.id = a.unit_id
    join crm_atendimento.procedures p on p.id = a.procedure_id
    left join crm_atendimento.professionals inj on inj.id = a.injector_id
    left join crm_atendimento.professionals con on con.id = a.consultant_id
`

export function createAtendimentoStore(options = {}) {
    const pgPool = options.pool || createAtendimentoPool(options.databaseUrl)

    async function ensureReady() {
        requirePool(pgPool)
        await withPgTransaction(pgPool, migrateAtendimento)
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

        async references(actor) {
            await ensureReady()
            const units = await pgPool.query(`select slug, name from crm_atendimento.units order by name`)
            const professionals = await pgPool.query(
                `select id, name, role, status, units, shift, roles, turnos, background_color, font_color, font_family, font_size, font_weight, font_style, alias
                 from crm_atendimento.professionals
                 order by name`,
            )
            const procedures = await pgPool.query(
                `select p.id, p.name, coalesce(json_agg(c.code order by c.code) filter (where c.code is not null), '[]'::json) as codes
                 from crm_atendimento.procedures p
                 left join crm_atendimento.procedure_price_codes c on c.procedure_id = p.id and c.allowed = true
                 group by p.id, p.name
                 order by p.name`,
            )
            const allowed = normalizeAllowedUnitKeys(actor)
            return {
                units: units.rows
                    .filter((row) => !allowed.size || allowed.has(row.slug))
                    .map((row) => ({ slug: row.slug, name: row.name })),
                professionals: professionals.rows
                    .filter((row) => professionalMatchesAllowedUnits(row, allowed))
                    .map((row) => mapProfessional(row, false)),
                procedures: procedures.rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    codes: Array.isArray(row.codes) ? row.codes : [],
                })),
            }
        },

        async overview(query, actor) {
            await ensureReady()
            const { where, params } = buildAttendanceWhere(query, actor)
            const whereSql = where.length ? `where ${where.join(' and ')}` : ''
            const summary = await pgPool.query(
                `${ATTENDANCE_SELECT}
                 ${whereSql}`,
                params,
            )
            const rows = summary.rows.map(mapAttendance)
            const totalValue = rows.reduce((acc, row) => acc + row.value, 0)
            const byMonth = new Map()
            const byProcedure = new Map()
            const byInjector = new Map()
            const byConsultant = new Map()
            for (const row of rows) {
                const month = row.date.slice(0, 7)
                const monthItem = byMonth.get(month) || { month, count: 0, value: 0 }
                monthItem.count += 1
                monthItem.value += row.value
                byMonth.set(month, monthItem)
                for (const [map, key] of [[byProcedure, row.procedureName], [byInjector, row.injectorName || 'Sem injetor'], [byConsultant, row.consultantName || 'Sem consultor']]) {
                    const item = map.get(key) || { label: key, count: 0, value: 0 }
                    item.count += 1
                    item.value += row.value
                    map.set(key, item)
                }
            }
            const rank = (map) => Array.from(map.values()).sort((a, b) => b.value - a.value).slice(0, 12)
            return {
                summary: {
                    totalAttendances: rows.length,
                    totalValue: Math.round(totalValue * 100) / 100,
                    averageTicket: rows.length ? Math.round((totalValue / rows.length) * 100) / 100 : 0,
                    distinctClients: new Set(rows.map((row) => normalizeText(row.clientName))).size,
                },
                monthly: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)).map((item) => ({
                    ...item,
                    value: Math.round(item.value * 100) / 100,
                })),
                rankings: {
                    procedures: rank(byProcedure),
                    injectors: rank(byInjector),
                    consultants: rank(byConsultant),
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
                `${ATTENDANCE_SELECT}
                 where ${where.join(' and ')}`,
                params.slice(0, -2),
            )
            return {
                data: out.rows.map(mapAttendance),
                total: count.rowCount,
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
            const allowed = normalizeAllowedUnitKeys(actor)
            if (allowed.size && !allowed.has(unit.slug)) {
                const err = new Error('FORBIDDEN_UNIT')
                err.statusCode = 403
                throw err
            }
            const row = await pgPool.query(
                `select s.service_date::text as date, s.doctor_name, u.slug as unit_slug, u.name as unit_name
                 from crm_atendimento.schedule_days s
                 join crm_atendimento.units u on u.id = s.unit_id
                 where u.slug = $1 and s.service_date = $2::date
                 limit 1`,
                [unit.slug, date],
            )
            return {
                unitSlug: unit.slug,
                unitName: row.rows[0]?.unit_name || unit.name,
                date,
                doctorName: row.rows[0]?.doctor_name || '',
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
                const item = byDoctor.get(doctor) || { doctorName: doctor, count: 0, totalValue: 0, remuneration: 0, rows: [] }
                item.count += 1
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
                const remuneration = totalValue > 0 ? Math.max(totalValue * 0.10, 212.50) : 0
                return {
                    ...item,
                    totalValue,
                    remuneration: Math.round(remuneration * 100) / 100,
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
                    totalValue: Math.round(doctors.reduce((acc, item) => acc + item.totalValue, 0) * 100) / 100,
                    remuneration: Math.round(doctors.reduce((acc, item) => acc + item.remuneration, 0) * 100) / 100,
                },
            }
        },

        async createAttendance(payload, actor) {
            await ensureReady()
            return withPgTransaction(pgPool, async (client) => {
                const unit = await upsertUnit(client, normalizeUnit(payload?.unitSlug || payload?.unitName))
                const procedure = await upsertProcedure(client, payload?.procedureName)
                if (!procedure) {
                    const err = new Error('PROCEDURE_REQUIRED')
                    err.statusCode = 400
                    throw err
                }
                const code = normalizeCode(payload?.code)
                const codeOk = await validateProcedureCode(client, procedure.id, code)
                if (!codeOk) {
                    const err = new Error('PROCEDURE_CODE_NOT_ALLOWED')
                    err.statusCode = 400
                    throw err
                }
                const injector = await upsertProfessional(client, { name: payload?.injectorName, roles: ['Injetor'], units: [unit.name] })
                const consultant = await upsertProfessional(client, { name: payload?.consultantName, roles: ['Consultor'], units: [unit.name] })
                const value = payload?.value === undefined || payload?.value === null
                    ? calculateAttendanceValue(payload)
                    : Number(payload.value)
                const inserted = await client.query(
                    `insert into crm_atendimento.attendances(
                        unit_id, service_date, client_name, procedure_id, code, quantity,
                        discount, other_value, round_value, value, injector_id, consultant_id,
                        observation, created_by, updated_by
                    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
                    returning id`,
                    [
                        unit.id,
                        payload?.date,
                        String(payload?.clientName || '').trim(),
                        procedure.id,
                        code,
                        Number(payload?.quantity || 1),
                        !!payload?.discount,
                        Number(payload?.otherValue || 0),
                        !!payload?.roundValue,
                        Number.isFinite(value) ? value : 0,
                        injector?.id || null,
                        consultant?.id || null,
                        String(payload?.observation || '').trim() || null,
                        actorLabel(actor),
                    ],
                )
                await audit(client, 'attendance.create', actor, inserted.rows[0].id, payload)
                const row = await client.query(`${ATTENDANCE_SELECT} where a.id = $1`, [inserted.rows[0].id])
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
                const merged = { ...mapAttendance(current.rows[0]), ...payload }
                const unit = await upsertUnit(client, normalizeUnit(merged.unitSlug || merged.unitName))
                const procedure = await upsertProcedure(client, merged.procedureName)
                const code = normalizeCode(merged.code)
                const codeOk = await validateProcedureCode(client, procedure.id, code)
                if (!codeOk) {
                    const err = new Error('PROCEDURE_CODE_NOT_ALLOWED')
                    err.statusCode = 400
                    throw err
                }
                const injector = await upsertProfessional(client, { name: merged.injectorName, roles: ['Injetor'], units: [unit.name] })
                const consultant = await upsertProfessional(client, { name: merged.consultantName, roles: ['Consultor'], units: [unit.name] })
                const value = payload?.value === undefined || payload?.value === null
                    ? calculateAttendanceValue(merged)
                    : Number(payload.value)
                await client.query(
                    `update crm_atendimento.attendances set
                        unit_id=$2, service_date=$3, client_name=$4, procedure_id=$5, code=$6,
                        quantity=$7, discount=$8, other_value=$9, round_value=$10, value=$11,
                        injector_id=$12, consultant_id=$13, observation=$14, updated_by=$15, updated_at=now()
                     where id=$1`,
                    [
                        id,
                        unit.id,
                        merged.date,
                        String(merged.clientName || '').trim(),
                        procedure.id,
                        code,
                        Number(merged.quantity || 1),
                        !!merged.discount,
                        Number(merged.otherValue || 0),
                        !!merged.roundValue,
                        Number.isFinite(value) ? value : 0,
                        injector?.id || null,
                        consultant?.id || null,
                        String(merged.observation || '').trim() || null,
                        actorLabel(actor),
                    ],
                )
                await audit(client, 'attendance.update', actor, id, { before: mapAttendance(current.rows[0]), after: merged })
                const row = await client.query(`${ATTENDANCE_SELECT} where a.id = $1`, [id])
                return mapAttendance(row.rows[0])
            })
        },

        async deleteAttendance(id, actor) {
            await ensureReady()
            return withPgTransaction(pgPool, async (client) => {
                const current = await client.query(`${ATTENDANCE_SELECT} where a.id = $1 and a.deleted_at is null`, [id])
                if (!current.rows[0]) {
                    const err = new Error('NOT_FOUND')
                    err.statusCode = 404
                    throw err
                }
                await client.query(
                    `update crm_atendimento.attendances set deleted_at = now(), updated_by = $2, updated_at = now() where id = $1`,
                    [id, actorLabel(actor)],
                )
                await audit(client, 'attendance.delete', actor, id, { before: mapAttendance(current.rows[0]) })
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
                    const injector = await upsertProfessional(client, { name: record.injectorName, role: 'Injetor', units: [unit.name] })
                    const consultant = await upsertProfessional(client, { name: record.consultantName, role: 'Consultor', units: [unit.name] })
                    const out = await client.query(
                        `insert into crm_atendimento.attendances(
                            unit_id, service_date, client_name, procedure_id, code, quantity,
                            discount, other_value, round_value, value, injector_id, consultant_id,
                            observation, source_sheet_id, source_tab, source_row, created_by, updated_by
                        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
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
                                excluded.observation
                            )
                        returning id, (xmax = 0) as inserted`,
                        [
                            unit.id,
                            record.date,
                            record.clientName,
                            procedure.id,
                            record.code,
                            record.quantity,
                            record.discount,
                            record.otherValue,
                            record.roundValue,
                            record.value,
                            injector?.id || null,
                            consultant?.id || null,
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

        async managementConversionReport(query, actor) {
            await ensureReady()
            const date = String(query?.date || '').trim()
            const reportDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : new Date()
            const rows = await pgPool.query(
                `select source_tab, source_row, cells
                 from crm_atendimento.raw_sheet_rows
                 where source_tab = 'Conversão'
                 order by source_row`,
            )
            const report = buildConversionReportFromRawRows(rows.rows.map((row) => ({
                sourceTab: row.source_tab,
                sourceRow: Number(row.source_row || 0),
                cells: row.cells || [],
            })), reportDate)
            const internalMetrics = await buildInternalConversionMetrics(pgPool, report.period, query || {}, actor)
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
            const allowed = normalizeAllowedUnitKeys(actor)
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
                `${ATTENDANCE_SELECT}
                 where ${attendanceWhere.join(' and ')}`,
                params,
            )
            const mapped = totals.rows.map(mapAttendance)
            const monthlyGoalResult = await listMonthlyGoals(pgPool, {}, actor)
            return {
                sourceTabs: Array.from(sourceTabs.values()),
                items: rows.rows.map(mapManagementItem),
                monthlyGoals: monthlyGoalResult.goals,
                monthlyGoalLevels: monthlyGoalResult.goalLevels,
                goalTables: (await listGoalTables(pgPool, {}, actor)).tables,
                attendanceTotals: {
                    units: Array.from(mapped.reduce((map, row) => {
                        if (allowed.size && !allowed.has(row.unitSlug)) return map
                        const item = map.get(row.unitSlug) || { unitSlug: row.unitSlug, unitName: row.unitName, count: 0, value: 0 }
                        item.count += 1
                        item.value += row.value
                        map.set(row.unitSlug, item)
                        return map
                    }, new Map()).values()).map((item) => ({ ...item, value: Math.round(item.value * 100) / 100 })),
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
            const allowed = normalizeAllowedUnitKeys(actor)
            const rows = await pgPool.query(
                `select *
                 from crm_atendimento.inventory_items
                 order by product`,
            )
            return {
                data: rows.rows.map((row) => ({
                    id: row.id,
                    product: row.product,
                    barraShoppingSul: allowed.size && !allowed.has('barra-shopping-sul') ? null : Number(row.barra_shopping_sul || 0),
                    novoHamburgo: allowed.size && !allowed.has('novo-hamburgo') ? null : Number(row.novo_hamburgo || 0),
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
            const allowed = normalizeAllowedUnitKeys(actor)
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
                .filter((row) => professionalMatchesAllowedUnits(row, allowed))
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
