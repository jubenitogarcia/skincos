import { createPgPool, withPgTransaction } from '../harmonia/store/pg.js'
import { normalizeUnit } from './domain.js'
import {
    buildCommercialFunnel,
    buildExperimentAssignments,
    buildExperimentResult,
    buildQualityTimeSeries,
    buildSegmentDrift,
    COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW_VERSION,
    COMMERCIAL_ANALYTICS_DEFAULT_WINDOWS,
    COMMERCIAL_ANALYTICS_EVENT_TYPES,
    isWithinAttributionWindow,
    normalizeAnalyticsFilters,
    normalizeAttributionWindows,
    sanitizeAnalyticsPayload,
} from './commercialAnalytics.js'
import { COMMERCIAL_ANALYTICS_MIGRATION_ID } from './commercialAnalyticsMigration.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SEGMENT_KEY_RE = /^[a-z][a-z0-9_.-]{2,100}$/

function analyticsError(code, statusCode = 409) {
    const error = new Error(code)
    error.code = code
    error.statusCode = statusCode
    return error
}

function requirePool(pool) {
    if (!pool) throw analyticsError('DATABASE_URL_not_configured', 503)
}

function actorIdentity(actor) {
    const value = String(actor?.id || actor?.username || actor?.email || '').trim()
    if (!value) throw analyticsError('ACTOR_IDENTITY_REQUIRED', 401)
    return value.slice(0, 160)
}

function assertAnalyticsManager(actor) {
    const role = String(actor?.role || '').trim().toUpperCase()
    if (role === 'ADMIN' || role === 'GESTOR' || actor?.isGlobalAdmin === true) return
    throw analyticsError('FORBIDDEN', 403)
}

function unitSlug(value) {
    const raw = String(value || '').trim()
    if (!raw || raw === 'all') return ''
    return normalizeUnit(raw).slug
}

function scopeForActor(actor, requestedUnit) {
    const requested = unitSlug(requestedUnit)
    const role = String(actor?.role || '').trim().toUpperCase()
    if (role === 'ADMIN' || actor?.isGlobalAdmin === true) return requested ? [requested] : null
    const declared = Array.isArray(actor?.allowedUnits)
        ? [...new Set(actor.allowedUnits.map(unitSlug).filter(Boolean))]
        : actor?.allowedUnitsDeclared === true || Object.prototype.hasOwnProperty.call(actor || {}, 'allowedUnits')
            ? []
            : null
    if (declared === null) return requested ? [requested] : null
    if (!declared.length) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    if (requested && !declared.includes(requested)) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    return requested ? [requested] : declared.sort()
}

function scopeLabel(scope) {
    return scope === null ? { kind: 'global', units: null } : { kind: 'unit', units: scope }
}

async function assertAnalyticsReady(pool) {
    const result = await pool.query(`select
        to_regclass('crm_atendimento.commercial_analytics_events') as events,
        to_regclass('crm_atendimento.commercial_analytics_experiments') as experiments,
        to_regclass('crm_atendimento.commercial_analytics_assignments') as assignments,
        to_regclass('crm_atendimento.commercial_attribution_window_versions') as windows,
        to_regclass('crm_atendimento.commercial_segment_versions') as segments,
        to_regclass('crm_atendimento.commercial_data_quality_metric_snapshots') as metrics`)
    const row = result.rows[0] || {}
    if (!row.events || !row.experiments || !row.assignments || !row.windows || !row.segments || !row.metrics) {
        throw analyticsError('COMMERCIAL_ANALYTICS_NOT_READY')
    }
    const migration = await pool.query(`select id from crm_atendimento.schema_migrations where id = $1 and rolled_back_at is null`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
    if (!migration.rows[0]?.id) throw analyticsError('COMMERCIAL_ANALYTICS_NOT_READY')
}

async function hasColumn(pool, table, column) {
    const result = await pool.query(`select exists(select 1 from information_schema.columns where table_schema = 'crm_atendimento' and table_name = $1 and column_name = $2) as present`, [table, column])
    return result.rows[0]?.present === true
}

function identityUnitsSql() {
    return `with identity_units as (
        select gm.identity_id, gm.source_type, u.slug as unit_slug
          from crm_atendimento.global_client_identity_members gm
          join crm_atendimento.attendance_client_links acl
            on gm.source_type = 'attendance_client' and gm.source_id = acl.client_id::text
          join crm_atendimento.attendances a on a.id = acl.attendance_id and a.deleted_at is null
          join crm_atendimento.units u on u.id = a.unit_id
        union
        select gm.identity_id, gm.source_type, u.slug as unit_slug
          from crm_atendimento.global_client_identity_members gm
          join crm_caixa.sales s
            on gm.source_type = 'caixa_customer' and gm.source_id = s.customer_id::text
          join crm_atendimento.units u on u.id = s.unit_id
        union
        select gm.identity_id, gm.source_type, unit_values.unit_slug
          from crm_atendimento.global_client_identity_members gm
          join crm_atendimento.app_client_registrations app
            on gm.source_type = 'app_registration' and gm.source_id = app.source_client_id
          cross join lateral jsonb_array_elements_text(app.unit_slugs) unit_values(unit_slug)
        union
        select gm.identity_id, gm.source_type, unit_values.unit_slug
          from crm_atendimento.global_client_identity_members gm
          join crm_atendimento.supplemental_lead_profiles lead_profile
            on gm.source_type = 'lead_profile' and gm.source_id = lead_profile.source_profile_id
          cross join lateral jsonb_array_elements_text(lead_profile.unit_slugs) unit_values(unit_slug)
    )`
}

async function queryIdentityFacts(pool, scope) {
    const params = [scope]
    const result = await pool.query(`${identityUnitsSql()}, scoped as (
        select identity_id,
               count(distinct source_type)::int as source_count,
               bool_or(source_type = 'attendance_client') as has_attendance,
               bool_or(source_type = 'caixa_customer') as has_sale_source,
               bool_or(source_type = 'app_registration') as has_app,
               bool_or(source_type = 'lead_profile') as has_lead,
               array_agg(distinct unit_slug order by unit_slug) as units
          from identity_units
         where ($1::text[] is null or unit_slug = any($1::text[]))
         group by identity_id
    )
    select identity_id, source_count, has_attendance, has_sale_source, has_app, has_lead, units,
           (source_count >= 2) as confirmed_multi_source
      from scoped
     order by identity_id`, params)
    return result.rows || []
}

async function queryUnitQualityMetrics(pool, scope) {
    const facts = await queryIdentityFacts(pool, scope)
    const params = [scope]
    const actions = await pool.query(`select
        count(*)::int as actions,
        count(*) filter(where nullif(trim(owner), '') is not null)::int as owned_actions,
        count(*) filter(where due_date < current_date and status in ('open','contacted','responded','scheduled'))::int as overdue_actions
      from crm_atendimento.commercial_actions action
      left join crm_atendimento.units u on u.id = action.unit_id
     where ($1::text[] is null or u.slug = any($1::text[]))`, params)
    const saleItems = await pool.query(`select
        count(item.id)::int as sale_items,
        count(item.id) filter(where item.mapping_status = 'mapped')::int as classified_sale_items
      from crm_caixa.sale_items item
      join crm_caixa.sales sale on sale.id = item.sale_id
      join crm_atendimento.units u on u.id = sale.unit_id
     where ($1::text[] is null or u.slug = any($1::text[]))`, params)
    const freshness = await pool.query(`with mirror as (
        select synced_at from crm_atendimento.local_mirror_state where singleton = true
    ), latest_import as (
        select max(created_at) as created_at from crm_atendimento.import_batches
    ) select
       (select synced_at from mirror) as mirror_synced_at,
       (select created_at from latest_import) as latest_import_created_at,
       case when (select synced_at from mirror) is null then null else greatest(0, floor(extract(epoch from now() - (select synced_at from mirror)) / 3600))::int end as mirror_age_hours,
       case when (select created_at from latest_import) is null then null else greatest(0, floor(extract(epoch from now() - (select created_at from latest_import)) / 3600))::int end as latest_import_age_hours`)
    const permissionsReady = await pool.query(`select to_regclass('crm_atendimento.commercial_contact_permissions') as permissions,
        has_table_privilege(current_user, 'crm_atendimento.commercial_contact_permissions', 'SELECT') as can_read`)
    let consent = null
    if (permissionsReady.rows[0]?.permissions && permissionsReady.rows[0]?.can_read) {
        const permissionResult = await pool.query(`${identityUnitsSql()}
        select count(distinct permission.identity_id)::int as permission_count
          from crm_atendimento.commercial_contact_permissions permission
         where permission.channel = 'whatsapp'
           and permission.status = 'granted'
           and permission.identity_id in (select distinct identity_id from identity_units where ($1::text[] is null or unit_slug = any($1::text[])))`, params)
        consent = Number(permissionResult.rows[0]?.permission_count || 0)
    }
    const identities = facts.length
    const multiSource = facts.filter((row) => row.confirmed_multi_source).length
    const phoneCorrelated = facts.filter((row) => row.has_app).length
    const actionRow = actions.rows[0] || {}
    const saleRow = saleItems.rows[0] || {}
    const freshnessRow = freshness.rows[0] || {}
    return {
        identity: {
            total: identities,
            confirmedMultiSource: multiSource,
            coverage: identities ? multiSource / identities : null,
        },
        salesClassification: {
            total: Number(saleRow.sale_items || 0),
            classified: Number(saleRow.classified_sale_items || 0),
            coverage: Number(saleRow.sale_items || 0) ? Number(saleRow.classified_sale_items || 0) / Number(saleRow.sale_items || 0) : null,
        },
        consent: {
            available: consent !== null,
            granted: consent,
            coverage: consent === null || !identities ? null : consent / identities,
        },
        correlatedPhone: {
            correlated: phoneCorrelated,
            total: identities,
            coverage: identities ? phoneCorrelated / identities : null,
        },
        ownerCoverage: {
            actions: Number(actionRow.actions || 0),
            owned: Number(actionRow.owned_actions || 0),
            coverage: Number(actionRow.actions || 0) ? Number(actionRow.owned_actions || 0) / Number(actionRow.actions || 0) : null,
        },
        overdueSla: Number(actionRow.overdue_actions || 0),
        freshness: {
            thresholdHours: 48,
            mirrorAgeHours: freshnessRow.mirror_age_hours == null ? null : Number(freshnessRow.mirror_age_hours),
            latestImportAgeHours: freshnessRow.latest_import_age_hours == null ? null : Number(freshnessRow.latest_import_age_hours),
        },
        lastValidExecution: {
            mirror: freshnessRow.mirror_synced_at || null,
            import: freshnessRow.latest_import_created_at || null,
        },
    }
}

async function queryGlobalQuality(pool, filters) {
    const findingParams = []
    const where = filters.findingKey ? 'where finding_key = $1' : ''
    if (filters.findingKey) findingParams.push(filters.findingKey)
    const [findings, events, snapshots] = await Promise.all([
        pool.query(`select id, finding_key, severity, status, owner, observed_count, metrics, sla_due_at,
            first_detected_at, last_evaluated_at, acknowledged_at, resolved_at
            from crm_atendimento.commercial_data_quality_findings ${where}`, findingParams),
        pool.query(`select event.id, event.finding_id, finding.finding_key, event.event_type, event.previous_status,
            event.status, event.observed_count, event.created_at
            from crm_atendimento.commercial_data_quality_finding_events event
            join crm_atendimento.commercial_data_quality_findings finding on finding.id = event.finding_id
           ${filters.findingKey ? 'where finding.finding_key = $1' : ''}
           order by event.created_at`, findingParams),
        pool.query(`select bucket_date, unit_id, finding_key, source_key, metrics, recorded_at
            from crm_atendimento.commercial_data_quality_metric_snapshots
           where bucket_date >= current_date - interval '365 days'
           order by bucket_date desc`),
    ])
    const quality = buildQualityTimeSeries({ findings: findings.rows, findingEvents: events.rows, metricSnapshots: snapshots.rows, asOf: new Date(), granularity: filters.granularity })
    return {
        ...quality,
        scope: scopeLabel(null),
        findings: findings.rows.map((row) => ({ findingKey: row.finding_key, severity: row.severity, status: row.status, observedCount: Number(row.observed_count || 0), ownerCovered: Boolean(String(row.owner || '').trim()) })),
        events: events.rows.slice(-500).map((row) => ({ findingKey: row.finding_key, eventType: row.event_type, status: row.status, observedCount: Number(row.observed_count || 0), createdAt: row.created_at })),
        filters,
    }
}

async function queryActionRows(pool, scope) {
    const hasChannel = await hasColumn(pool, 'commercial_actions', 'contact_channel')
    const hasContactedAt = await hasColumn(pool, 'commercial_actions', 'contacted_at')
    const channel = hasChannel ? 'action.contact_channel' : `'whatsapp'::text`
    const contactedAt = hasContactedAt ? 'action.contacted_at' : 'null::timestamptz'
    const result = await pool.query(`select action.id, action.identity_id, action.segment_key, action.status, action.owner,
        ${channel} as contact_channel, ${contactedAt} as contacted_at, action.created_at, action.updated_at, unit.slug as unit_slug
      from crm_atendimento.commercial_actions action
      left join crm_atendimento.units unit on unit.id = action.unit_id
     where ($1::text[] is null or unit.slug = any($1::text[]))`, [scope])
    return result.rows || []
}

async function queryAnalyticsEvents(pool, scope, filters) {
    const params = [scope]
    const where = ['($1::text[] is null or unit.slug = any($1::text[]))']
    const add = (value, expression, operator = '=') => { if (value) { params.push(value); where.push(`${expression} ${operator} $${params.length}`) } }
    add(filters.from, 'event.occurred_at::date', '>=')
    add(filters.to, 'event.occurred_at::date', '<=')
    add(filters.campaign, 'event.campaign_key')
    add(filters.segment, 'event.segment_key')
    add(filters.owner, 'action.owner')
    add(filters.channel, 'event.channel')
    add(filters.offer, 'event.offer_key')
    add(filters.policyVersion, 'event.policy_version')
    const actionJoin = 'left join crm_atendimento.commercial_actions action on action.id = event.action_id'
    const result = await pool.query(`select event.identity_id, event.action_id, event.event_type, event.occurred_at,
        event.unit_id, unit.slug as unit_slug, event.channel, event.offer_key, event.campaign_key,
        event.segment_key, event.policy_version, event.observed, event.attributed, event.incremental, event.revenue
      from crm_atendimento.commercial_analytics_events event
      left join crm_atendimento.units unit on unit.id = event.unit_id
      ${actionJoin}
     where ${where.join(' and ')}
     order by event.occurred_at`, params)
    return result.rows || []
}

async function querySourceOutcomeRows(pool, scope) {
    const attendances = await pool.query(`${identityUnitsSql()}
      select iu.identity_id, a.service_date::timestamptz as occurred_at, u.slug as unit_slug
        from identity_units iu
        join crm_atendimento.attendance_client_links link on iu.source_type = 'attendance_client' and iu.source_id = link.client_id::text
        join crm_atendimento.attendances a on a.id = link.attendance_id and a.deleted_at is null
        join crm_atendimento.units u on u.id = a.unit_id
       where ($1::text[] is null or u.slug = any($1::text[]))`, [scope])
    const sales = await pool.query(`${identityUnitsSql()}
      select iu.identity_id, sale.occurred_on::timestamptz as occurred_at, sale.total::numeric as revenue, u.slug as unit_slug
        from identity_units iu
        join crm_caixa.sales sale on iu.source_type = 'caixa_customer' and iu.source_id = sale.customer_id::text
        join crm_atendimento.units u on u.id = sale.unit_id
       where ($1::text[] is null or u.slug = any($1::text[]))`, [scope])
    return { attendances: attendances.rows || [], sales: sales.rows || [] }
}

async function readAttributionWindow(pool, version = COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW_VERSION) {
    const result = await pool.query(`select version, response_days, appointment_days, attendance_days, sale_days, return_days
        from crm_atendimento.commercial_attribution_window_versions where version = $1`, [version])
    const row = result.rows[0]
    if (!row) throw analyticsError('ATTRIBUTION_WINDOW_VERSION_NOT_FOUND', 400)
    return { version: row.version, ...normalizeAttributionWindows(row) }
}

function applyDateFilter(rows, filters, dateField = 'occurred_at') {
    return rows.filter((row) => {
        const value = String(row?.[dateField] || '').slice(0, 10)
        return (!filters.from || value >= filters.from) && (!filters.to || value <= filters.to)
    })
}

function normalizeCriteria(criteria) {
    const value = criteria && typeof criteria === 'object' && !Array.isArray(criteria) ? criteria : {}
    const forbidden = ['score', 'model', 'embedding', 'ml', 'prediction']
    if (Object.keys(value).some((key) => forbidden.some((token) => key.toLowerCase().includes(token)))) throw analyticsError('OPAQUE_SEGMENT_CRITERIA_FORBIDDEN', 400)
    return sanitizeAnalyticsPayload(value)
}

function evaluateCriteria(identity, criteria) {
    const sourceCount = Number(identity.source_count || 0)
    if (criteria.minSources !== undefined && sourceCount < Number(criteria.minSources)) return { included: false, reason: 'min_sources' }
    if (criteria.requireAttendance === true && identity.has_attendance !== true) return { included: false, reason: 'attendance_required' }
    if (criteria.requireSale === true && identity.has_sale_source !== true) return { included: false, reason: 'sale_required' }
    return { included: true, reason: 'criteria_match' }
}

function validateExperimentInput(payload = {}) {
    const key = String(payload.experimentKey || payload.key || '').trim()
    const version = Number(payload.version)
    const policyVersion = String(payload.policyVersion || '').trim()
    const windowVersion = String(payload.attributionWindowVersion || COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW_VERSION).trim()
    const periodStart = String(payload.periodStart || '').trim()
    const periodEnd = String(payload.periodEnd || '').trim()
    const reason = String(payload.reason || '').trim()
    const controlPercent = Number(payload.controlPercent ?? 10)
    const seed = String(payload.seed || '').trim()
    if (!/^[a-z][a-z0-9_.-]{2,100}$/.test(key) || !Number.isInteger(version) || version < 1) throw analyticsError('INVALID_EXPERIMENT_KEY', 400)
    if (!policyVersion || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodEnd < periodStart) throw analyticsError('INVALID_EXPERIMENT_PERIOD', 400)
    if (!Number.isFinite(controlPercent) || controlPercent <= 0 || controlPercent >= 100) throw analyticsError('INVALID_EXPERIMENT_CONTROL_PERCENT', 400)
    if (seed.length < 8 || seed.length > 160) throw analyticsError('INVALID_EXPERIMENT_SEED', 400)
    if (reason.length < 3 || reason.length > 1000) throw analyticsError('EXPERIMENT_REASON_REQUIRED', 400)
    return { key, version, policyVersion, windowVersion, periodStart, periodEnd, reason, controlPercent, seed }
}

async function currentPolicyVersion(pool) {
    try {
        const result = await pool.query(`select md5(concat_ws('|', active_contact_cooldown_days::text, return_risk_thresholds::text,
            coalesce(commercial_contact_writes_enabled::text, 'false'), coalesce(commercial_contact_canary_identity_ids::text, '{}'),
            extract(epoch from updated_at)::text)) as policy_version from crm_atendimento.commercial_policy_config where singleton = true`)
        return String(result.rows[0]?.policy_version || '')
    } catch (error) {
        if (String(error?.code || '') === '42703') return ''
        throw error
    }
}

async function queryExperimentOutcomes(pool, experimentId, scope) {
    const result = await pool.query(`select event.identity_id, event.event_type, event.revenue, event.occurred_at
      from crm_atendimento.commercial_analytics_events event
      left join crm_atendimento.units unit on unit.id = event.unit_id
     where event.experiment_id = $1 and ($2::text[] is null or unit.slug = any($2::text[]))`, [experimentId, scope])
    return result.rows || []
}

export function createCommercialAnalyticsStore(options = {}) {
    const pgPool = options.pool || createPgPool(options.databaseUrl || process.env.DATABASE_URL)
    return {
        async quality(query = {}, actor) {
            requirePool(pgPool); assertAnalyticsManager(actor); await assertAnalyticsReady(pgPool)
            const filters = normalizeAnalyticsFilters(query)
            const scope = scopeForActor(actor, filters.unit)
            if (scope !== null) {
                const metrics = await queryUnitQualityMetrics(pgPool, scope)
                const snapshots = await pgPool.query(`select bucket_date, unit_id, finding_key, source_key, metrics, recorded_at
                    from crm_atendimento.commercial_data_quality_metric_snapshots
                   where unit_id in (select id from crm_atendimento.units where slug = any($1::text[]))
                   order by bucket_date desc limit 365`, [scope])
                return {
                    scope: scopeLabel(scope), filters, scopeRestricted: true, findings: [], events: [],
                    timeSeries: { granularity: filters.granularity, byFinding: {}, backlogAging: [], timing: { timeToRecognitionHours: null, timeToStartHours: null, timeToResolutionHours: null }, reopenRate: null, ownerCoverage: metrics.ownerCoverage.coverage, activeFindings: null, overdueSla: metrics.overdueSla, metrics: snapshots.rows },
                    metrics,
                }
            }
            const result = await queryGlobalQuality(pgPool, filters)
            const aggregate = await queryUnitQualityMetrics(pgPool, null)
            return { ...result, timeSeries: result, metrics: { ...aggregate, global: true, activeFindings: result.activeFindings, overdueSla: result.overdueSla, ownerCoverage: result.ownerCoverage } }
        },

        async funnel(query = {}, actor) {
            requirePool(pgPool); assertAnalyticsManager(actor); await assertAnalyticsReady(pgPool)
            const filters = normalizeAnalyticsFilters(query)
            const scope = scopeForActor(actor, filters.unit)
            const window = await readAttributionWindow(pgPool, query.attributionWindowVersion || query.windowVersion || COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW_VERSION)
            const [facts, actions, events, sourceRows] = await Promise.all([
                queryIdentityFacts(pgPool, scope), queryActionRows(pgPool, scope), queryAnalyticsEvents(pgPool, scope, filters), querySourceOutcomeRows(pgPool, scope),
            ])
            const filteredActions = applyDateFilter(actions, filters, 'created_at').filter((row) => (!filters.segment || row.segment_key === filters.segment) && (!filters.owner || row.owner === filters.owner) && (!filters.channel || row.contact_channel === filters.channel))
            const result = buildCommercialFunnel({
                actions: filteredActions,
                events,
                attendances: applyDateFilter(sourceRows.attendances, filters),
                sales: applyDateFilter(sourceRows.sales, filters),
                eligibleIdentities: facts,
                windows: window,
                filters,
            })
            return { ...result, scope: scopeLabel(scope), attribution: { version: window.version, windows: window, observed: true, attributed: true, incremental: false } }
        },

        async listExperiments(query = {}, actor) {
            requirePool(pgPool); assertAnalyticsManager(actor); await assertAnalyticsReady(pgPool)
            const scope = scopeForActor(actor, query.unit)
            const result = await pgPool.query(`select experiment.id, experiment.experiment_key, experiment.version, unit.slug as unit_slug,
                experiment.policy_version, experiment.attribution_window_version, experiment.period_start, experiment.period_end,
                experiment.control_percent, experiment.state, experiment.author, experiment.reason, experiment.created_at,
                count(assignment.identity_id)::int as assignments,
                count(assignment.identity_id) filter(where assignment.variant = 'control')::int as control_assignments,
                count(assignment.identity_id) filter(where assignment.variant = 'treatment')::int as treatment_assignments
              from crm_atendimento.commercial_analytics_experiments experiment
              left join crm_atendimento.units unit on unit.id = experiment.unit_id
              left join crm_atendimento.commercial_analytics_assignments assignment on assignment.experiment_id = experiment.id
             where ($1::text[] is null or unit.slug = any($1::text[]))
             group by experiment.id, unit.slug order by experiment.created_at desc limit 100`, [scope])
            return { scope: scopeLabel(scope), experiments: result.rows.map((row) => ({ id: row.id, key: row.experiment_key, version: Number(row.version), unit: row.unit_slug || null, policyVersion: row.policy_version, attributionWindowVersion: row.attribution_window_version, periodStart: row.period_start, periodEnd: row.period_end, controlPercent: Number(row.control_percent), state: row.state, author: row.author, reason: row.reason, createdAt: row.created_at, assignments: Number(row.assignments || 0), controlAssignments: Number(row.control_assignments || 0), treatmentAssignments: Number(row.treatment_assignments || 0) })) }
        },

        async previewExperiment(payload = {}, actor) {
            requirePool(pgPool); assertAnalyticsManager(actor); await assertAnalyticsReady(pgPool)
            const input = validateExperimentInput(payload)
            const scope = scopeForActor(actor, payload.unit)
            await readAttributionWindow(pgPool, input.windowVersion)
            const facts = await queryIdentityFacts(pgPool, scope)
            const assignments = buildExperimentAssignments(facts.map((row) => ({ ...row, eligible: true })), { experimentKey: input.key, seed: input.seed, controlPercent: input.controlPercent, eligibility: payload.criteria || {} })
            const counts = assignments.reduce((summary, item) => { summary[item.variant] = (summary[item.variant] || 0) + 1; return summary }, { control: 0, treatment: 0, excluded: 0 })
            return { scope: scopeLabel(scope), preview: { key: input.key, version: input.version, policyVersion: input.policyVersion, attributionWindowVersion: input.windowVersion, periodStart: input.periodStart, periodEnd: input.periodEnd, controlPercent: input.controlPercent, counts, eligible: assignments.filter((item) => item.eligible).length, population: assignments.length, contactBlockedDuringExperiment: true, reason: input.reason } }
        },

        async createExperiment(payload = {}, actor) {
            requirePool(pgPool); assertAnalyticsManager(actor); const actorId = actorIdentity(actor); await assertAnalyticsReady(pgPool)
            const input = validateExperimentInput(payload)
            const scope = scopeForActor(actor, payload.unit)
            if (scope === null && payload.unit) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
            const policy = await currentPolicyVersion(pgPool)
            if (policy && policy !== input.policyVersion) throw analyticsError('EXPERIMENT_POLICY_VERSION_STALE', 409)
            const window = await readAttributionWindow(pgPool, input.windowVersion)
            const facts = await queryIdentityFacts(pgPool, scope)
            const assignments = buildExperimentAssignments(facts.map((row) => ({ ...row, eligible: true })), { experimentKey: input.key, seed: input.seed, controlPercent: input.controlPercent, eligibility: payload.criteria || {} })
            const unit = unitSlug(payload.unit)
            return withPgTransaction(pgPool, async (client) => {
                await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-analytics-experiment:${input.key}:${input.version}`])
                const unitRow = unit ? await client.query(`select id, slug from crm_atendimento.units where slug = $1`, [unit]) : { rows: [] }
                if (unit && !unitRow.rows[0]) throw analyticsError('UNIT_NOT_FOUND', 400)
                const experiment = await client.query(`insert into crm_atendimento.commercial_analytics_experiments(
                    experiment_key, version, unit_id, policy_version, attribution_window_version,
                    period_start, period_end, control_percent, seed, state, author, reason, eligibility_snapshot)
                    values ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,'draft',$10,$11,$12::jsonb)
                    returning id, experiment_key, version`, [input.key, input.version, unitRow.rows[0]?.id || null, input.policyVersion, window.version, input.periodStart, input.periodEnd, input.controlPercent, input.seed, actorId, input.reason, JSON.stringify({ population: assignments.length, criteria: sanitizeAnalyticsPayload(payload.criteria || {}) })])
                const experimentId = experiment.rows[0].id
                for (const assignment of assignments) {
                    await client.query(`insert into crm_atendimento.commercial_analytics_assignments(
                        experiment_id, identity_id, unit_id, variant, eligible, eligibility_reason, eligibility_snapshot, contact_blocked_until)
                        values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::date + interval '1 day')`, [experimentId, assignment.identityId, unitRow.rows[0]?.id || null, assignment.variant, assignment.eligible, assignment.eligibilityReason, JSON.stringify(sanitizeAnalyticsPayload(assignment.eligibility)), input.periodEnd])
                }
                return { experiment: { id: experimentId, key: input.key, version: input.version, unit: unit || null, assignments: assignments.length, controlAssignments: assignments.filter((item) => item.variant === 'control').length, treatmentAssignments: assignments.filter((item) => item.variant === 'treatment').length, attributionWindow: window, state: 'draft', contactBlockedDuringExperiment: true } }
            })
        },

        async experimentResults(id, actor) {
            requirePool(pgPool); assertAnalyticsManager(actor); await assertAnalyticsReady(pgPool)
            if (!UUID_RE.test(String(id || ''))) throw analyticsError('INVALID_EXPERIMENT_ID', 400)
            const scope = scopeForActor(actor)
            const experiment = await pgPool.query(`select e.id, e.experiment_key, e.version, e.policy_version, e.attribution_window_version, e.period_start, e.period_end, e.state, u.slug as unit_slug
                from crm_atendimento.commercial_analytics_experiments e left join crm_atendimento.units u on u.id = e.unit_id where e.id = $1`, [id])
            const row = experiment.rows[0]
            if (!row) throw analyticsError('EXPERIMENT_NOT_FOUND', 404)
            if (scope !== null && row.unit_slug && !scope.includes(row.unit_slug)) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
            const assignments = await pgPool.query(`select identity_id, variant, eligible, crossover_detected from crm_atendimento.commercial_analytics_assignments where experiment_id = $1`, [id])
            const outcomes = await queryExperimentOutcomes(pgPool, id, scope)
            const result = buildExperimentResult(assignments.rows, outcomes)
            return { experiment: { id: row.id, key: row.experiment_key, version: Number(row.version), policyVersion: row.policy_version, attributionWindowVersion: row.attribution_window_version, periodStart: row.period_start, periodEnd: row.period_end, state: row.state, unit: row.unit_slug || null }, result }
        },

        async listSegments(query = {}, actor) {
            requirePool(pgPool); assertAnalyticsManager(actor); await assertAnalyticsReady(pgPool)
            const scope = scopeForActor(actor, query.unit)
            const versions = await pgPool.query(`select definition.segment_key, definition.name, definition.description, version.id, version.version,
                version.criteria, version.thresholds, version.percentiles, version.effective_from, version.effective_to,
                version.author, version.population, version.distribution, version.post_metrics, version.created_at
              from crm_atendimento.commercial_segment_versions version
              join crm_atendimento.commercial_segment_definitions definition on definition.id = version.definition_id
             order by definition.segment_key, version.version desc limit 200`)
            const snapshots = await pgPool.query(`select snapshot.id, snapshot.segment_version_id, snapshot.snapshot_date, unit.slug as unit_slug,
                snapshot.population, snapshot.included, snapshot.distribution, snapshot.drift, snapshot.created_at
              from crm_atendimento.commercial_segment_membership_snapshots snapshot
              left join crm_atendimento.units unit on unit.id = snapshot.unit_id
             where ($1::text[] is null or unit.slug = any($1::text[]))
             order by snapshot.snapshot_date desc limit 500`, [scope])
            const snapshotsByVersion = new Map()
            for (const row of snapshots.rows) {
                const list = snapshotsByVersion.get(String(row.segment_version_id)) || []
                list.push({ id: row.id, date: row.snapshot_date, unit: row.unit_slug || null, population: Number(row.population || 0), included: Number(row.included || 0), distribution: row.distribution || {}, drift: row.drift || {}, createdAt: row.created_at })
                snapshotsByVersion.set(String(row.segment_version_id), list)
            }
            return {
                scope: scopeLabel(scope),
                segments: versions.rows.map((row) => {
                    const history = snapshotsByVersion.get(String(row.id)) || []
                    return { key: row.segment_key, name: row.name, description: row.description, id: row.id, version: Number(row.version), criteria: row.criteria || {}, thresholds: row.thresholds || {}, percentiles: row.percentiles || {}, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, author: row.author, population: Number(row.population || 0), distribution: row.distribution || {}, postMetrics: row.post_metrics || {}, snapshots: history, drift: buildSegmentDrift(history) }
                }),
            }
        },

        async createSegmentVersion(payload = {}, actor) {
            requirePool(pgPool); assertAnalyticsManager(actor); const actorId = actorIdentity(actor); await assertAnalyticsReady(pgPool)
            const key = String(payload.segmentKey || payload.key || '').trim()
            if (!SEGMENT_KEY_RE.test(key)) throw analyticsError('INVALID_SEGMENT_KEY', 400)
            const criteria = normalizeCriteria(payload.criteria)
            const scope = scopeForActor(actor, payload.unit)
            const snapshotDate = String(payload.snapshotDate || new Date().toISOString().slice(0, 10))
            if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)) throw analyticsError('INVALID_SEGMENT_SNAPSHOT_DATE', 400)
            const facts = await queryIdentityFacts(pgPool, scope)
            const evaluated = facts.map((identity) => ({ identity, ...evaluateCriteria(identity, criteria) }))
            const included = evaluated.filter((item) => item.included)
            const distribution = { included: included.length, excluded: evaluated.length - included.length }
            return withPgTransaction(pgPool, async (client) => {
                await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-analytics-segment:${key}`])
                const definition = await client.query(`insert into crm_atendimento.commercial_segment_definitions(segment_key, name, description, criteria, created_by, updated_by)
                    values ($1,$2,$3,$4::jsonb,$5,$5)
                    on conflict(segment_key) do update set name=excluded.name, description=excluded.description, criteria=excluded.criteria, updated_by=excluded.updated_by, updated_at=now()
                    returning id`, [key, String(payload.name || key), String(payload.description || ''), JSON.stringify(criteria), actorId])
                const versionRow = await client.query(`select coalesce(max(version), 0) + 1 as version from crm_atendimento.commercial_segment_versions where definition_id = $1`, [definition.rows[0].id])
                const version = Number(versionRow.rows[0].version)
                const segment = await client.query(`insert into crm_atendimento.commercial_segment_versions(definition_id, version, criteria, thresholds, percentiles, effective_from, author, population, distribution)
                    values ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::timestamptz,$7,$8,$9::jsonb) returning id, version`, [definition.rows[0].id, version, JSON.stringify(criteria), JSON.stringify(sanitizeAnalyticsPayload(payload.thresholds || {})), JSON.stringify(sanitizeAnalyticsPayload(payload.percentiles || {})), String(payload.effectiveFrom || `${snapshotDate}T00:00:00Z`), actorId, facts.length, JSON.stringify(distribution)])
                const unitRow = unitSlug(payload.unit) ? await client.query(`select id from crm_atendimento.units where slug = $1`, [unitSlug(payload.unit)]) : { rows: [] }
                const snapshot = await client.query(`insert into crm_atendimento.commercial_segment_membership_snapshots(segment_version_id, unit_id, snapshot_date, population, included, distribution, created_by)
                    values ($1,$2,$3::date,$4,$5,$6::jsonb,$7) returning id`, [segment.rows[0].id, unitRow.rows[0]?.id || null, snapshotDate, facts.length, included.length, JSON.stringify(distribution), actorId])
                for (const item of evaluated) {
                    await client.query(`insert into crm_atendimento.commercial_segment_members(snapshot_id, identity_id, included, reason, criteria)
                        values ($1,$2,$3,$4,$5::jsonb)`, [snapshot.rows[0].id, item.identity.identity_id, item.included, item.reason, JSON.stringify(criteria)])
                }
                return { segment: { key, version, id: segment.rows[0].id, criteria, population: facts.length, included: included.length, distribution, snapshotDate, scope: scopeLabel(scope) } }
            })
        },

        async recordEvent(payload = {}, actor) {
            requirePool(pgPool); assertAnalyticsManager(actor); const actorId = actorIdentity(actor); await assertAnalyticsReady(pgPool)
            const eventType = String(payload.eventType || '').trim().toLowerCase()
            const identityId = String(payload.identityId || '').trim()
            const idempotencyKey = String(payload.idempotencyKey || '').trim()
            if (!COMMERCIAL_ANALYTICS_EVENT_TYPES.includes(eventType) || !UUID_RE.test(identityId)) throw analyticsError('INVALID_ANALYTICS_EVENT', 400)
            if (idempotencyKey.length < 8 || idempotencyKey.length > 180) throw analyticsError('INVALID_ANALYTICS_IDEMPOTENCY_KEY', 400)
            const occurredAt = String(payload.occurredAt || '').trim()
            if (!occurredAt || !Number.isFinite(new Date(occurredAt).getTime())) throw analyticsError('INVALID_ANALYTICS_EVENT_TIME', 400)
            const scope = scopeForActor(actor, payload.unit)
            const facts = await queryIdentityFacts(pgPool, scope)
            const fact = facts.find((row) => String(row.identity_id) === identityId)
            if (!fact) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
            const experimentId = payload.experimentId ? String(payload.experimentId) : null
            if (experimentId && !UUID_RE.test(experimentId)) throw analyticsError('INVALID_EXPERIMENT_ID', 400)
            const actionId = payload.actionId ? String(payload.actionId).trim() : null
            if (actionId && !UUID_RE.test(actionId)) throw analyticsError('INVALID_ANALYTICS_ACTION_ID', 400)
            const revenue = payload.revenue == null ? null : Number(payload.revenue)
            if (revenue !== null && (!Number.isFinite(revenue) || revenue < 0)) throw analyticsError('INVALID_ANALYTICS_REVENUE', 400)
            let attributed = false
            let incremental = false
            if (experimentId) {
                const assignmentResult = await pgPool.query(`select assignment.variant, assignment.eligible,
                        assignment.contact_blocked_until, experiment.attribution_window_version
                    from crm_atendimento.commercial_analytics_assignments assignment
                    join crm_atendimento.commercial_analytics_experiments experiment on experiment.id = assignment.experiment_id
                   where assignment.experiment_id = $1 and assignment.identity_id = $2`, [experimentId, identityId])
                const assignment = assignmentResult.rows[0]
                if (!assignment || assignment.eligible !== true) throw analyticsError('EXPERIMENT_ASSIGNMENT_NOT_FOUND', 409)
                // A control member must remain untouched for the entire frozen
                // assignment period. Rejecting the attempted event makes any
                // crossover explicit instead of silently contaminating results.
                if (assignment.variant === 'control' && ['action_created', 'contacted', 'delivered'].includes(eventType)) {
                    throw analyticsError('EXPERIMENT_CONTROL_CROSSOVER', 409)
                }
                const window = await readAttributionWindow(pgPool, assignment.attribution_window_version)
                const anchorResult = await pgPool.query(`select min(occurred_at) as occurred_at
                    from crm_atendimento.commercial_analytics_events
                   where experiment_id = $1 and identity_id = $2
                     and event_type in ('selected', 'action_created', 'contacted')`, [experimentId, identityId])
                const anchor = anchorResult.rows[0]?.occurred_at || (['selected', 'action_created', 'contacted'].includes(eventType) ? occurredAt : null)
                attributed = Boolean(anchor && isWithinAttributionWindow(anchor, occurredAt, eventType, window))
                incremental = assignment.variant === 'treatment' && attributed
            }
            const row = await pgPool.query(`insert into crm_atendimento.commercial_analytics_events(
                idempotency_key, experiment_id, identity_id, unit_id, action_id, event_type, occurred_at, channel,
                offer_key, campaign_key, segment_key, policy_version, observed, attributed, incremental, revenue, source, payload)
                values ($1,$2,$3,(select id from crm_atendimento.units where slug = $4),$5,$6,$7::timestamptz,$8,$9,$10,$11,$12,true,$13,$14,$15,$16,$17::jsonb)
                on conflict(idempotency_key) do nothing returning id, created_at`, [idempotencyKey, experimentId, identityId, unitSlug(payload.unit) || fact.units?.[0] || null, actionId, eventType, occurredAt, String(payload.channel || '').trim() || null, String(payload.offerKey || '').trim() || null, String(payload.campaignKey || '').trim() || null, String(payload.segmentKey || '').trim() || null, String(payload.policyVersion || '').trim() || null, attributed, incremental, revenue, String(payload.source || actorId).slice(0, 120), JSON.stringify(sanitizeAnalyticsPayload(payload.payload || {}))])
            return { recorded: Boolean(row.rows[0]), duplicate: !row.rows[0], id: row.rows[0]?.id || null }
        },
    }
}

export const __testables = {
    scopeForActor,
    scopeLabel,
    normalizeCriteria,
    evaluateCriteria,
    validateExperimentInput,
    identityUnitsSql,
}
