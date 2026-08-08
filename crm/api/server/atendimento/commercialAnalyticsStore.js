import { createHmac, randomUUID } from 'node:crypto'
import { createPgPool, withPgTransaction } from '../harmonia/store/pg.js'
import { actorSubject } from './actorSubject.js'
import { commercialOperationsUnitScope } from './commercialOperationsStore.js'
import {
    COMMERCIAL_ANALYTICS_MIGRATION_ID,
    COMMERCIAL_ANALYTICS_SAFETY_FLAGS,
    COMMERCIAL_EXPERIMENT_STATES,
    calculateExperimentLift,
    commercialAnalyticsError,
    commercialAnalyticsSafety,
    deterministicExperimentVariant,
    normalizeAttributionWindowPayload,
    normalizeAnalyticsMutation,
    normalizeExperimentPayload,
    normalizeSegmentCriteria,
    normalizeSegmentPayload,
    stableAnalyticsFingerprint,
} from './commercialAnalytics.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UNIT_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const OWNER_RE = /^[A-Za-zÀ-ÿ0-9._:+\- ]{1,160}$/
const MAX_SEGMENT_CANDIDATES = 50_000

function text(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

function bool(value) {
    return value === true || value === 't' || value === 1 || value === '1'
}

function number(value, fallback = 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function analyticsError(code, statusCode = 409) {
    return commercialAnalyticsError(code, statusCode)
}

function requirePool(pool) {
    if (!pool || typeof pool.query !== 'function') throw analyticsError('COMMERCIAL_ANALYTICS_POOL_REQUIRED', 503)
    return pool
}

function actorPrincipal(actor) {
    const subject = actorSubject(actor)
    if (!subject) throw analyticsError('ACTOR_IDENTITY_REQUIRED', 401)
    return subject
}

function assertAnalyticsManager(actor) {
    const role = text(actor?.role).toUpperCase()
    if (role === 'GESTOR' || role === 'ADMIN' || actor?.isGlobalAdmin === true) return
    throw analyticsError('FORBIDDEN', 403)
}

function auditSecret() {
    const secret = text(process.env.ATENDIMENTO_ACTOR_HMAC_KEY || process.env.ESCALA_ACTOR_HMAC_KEY || process.env.CRM_ESCALA_HMAC_KEY)
    if (secret.length < 32) throw analyticsError('COMMERCIAL_ANALYTICS_AUDIT_KEY_REQUIRED', 503)
    return secret
}

function digest(purpose, value) {
    return createHmac('sha256', auditSecret()).update(`${purpose}:${stableAnalyticsFingerprint(value)}`).digest('hex')
}

function actorReference(actor) {
    return `actor:${digest('commercial-analytics-actor', { actor: actorPrincipal(actor) })}`
}

function assertUuid(value, code = 'COMMERCIAL_ANALYTICS_ID_INVALID') {
    const id = text(value).toLowerCase()
    if (!UUID_RE.test(id)) throw analyticsError(code, 400)
    return id
}

function normalizeUnit(value, code = 'COMMERCIAL_ANALYTICS_UNIT_INVALID') {
    const unit = text(value).toLowerCase()
    if (!UNIT_RE.test(unit)) throw analyticsError(code, 400)
    return unit
}

function requestedScope(actor, query = {}) {
    const scope = commercialOperationsUnitScope(actor)
    const requested = text(query?.unit).toLowerCase()
    if (scope === null) {
        if (!requested || requested === 'all') return { unit: null, unitSlugs: null, global: true }
        return { unit: normalizeUnit(requested), unitSlugs: null, global: true }
    }
    if (!scope.length) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    if (!requested || requested === 'all') return { unit: null, unitSlugs: scope, global: false }
    const unit = normalizeUnit(requested)
    if (!scope.includes(unit)) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    return { unit, unitSlugs: [unit], global: false }
}

async function resolveUnit(client, actor, unitValue) {
    const unit = normalizeUnit(unitValue)
    const scope = commercialOperationsUnitScope(actor)
    if (scope !== null && (!scope.length || !scope.includes(unit))) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    const result = await client.query(`select id::text,slug from crm_atendimento.units where slug=$1`, [unit])
    if (!result.rows[0]?.id) throw analyticsError('COMMERCIAL_ANALYTICS_UNIT_NOT_FOUND', 404)
    return { id: String(result.rows[0].id), slug: String(result.rows[0].slug) }
}

function scopeClause(scope, params, column = 'unit.slug') {
    if (scope.unit) {
        params.push(scope.unit)
        return `${column}=$${params.length}`
    }
    if (scope.unitSlugs) {
        params.push(scope.unitSlugs)
        return `${column}=any($${params.length}::text[])`
    }
    return 'true'
}

function mapReadiness(row = {}, migrationReady = false) {
    const relations = ['mutations', 'definitions', 'versions', 'memberships', 'windows', 'experiments', 'assignments', 'events', 'migration_registry']
    const triggers = [
        'mutations_immutable', 'mutations_no_truncate', 'memberships_immutable', 'memberships_no_truncate',
        'assignments_immutable', 'assignments_no_truncate', 'events_immutable', 'events_no_truncate',
    ]
    const grants = [
        'migration_read', 'mutations_read', 'mutations_write', 'definitions_read', 'definitions_write',
        'versions_read', 'versions_write', 'memberships_read', 'memberships_write', 'windows_read', 'windows_write',
        'experiments_read', 'experiments_write', 'assignments_read', 'assignments_write',
        'events_write', 'events_sequence_write', 'source_units_read', 'source_identity_members_read',
        'source_attendance_links_read', 'source_attendances_read', 'source_sales_read', 'source_sale_items_read',
        'source_actions_read', 'source_campaigns_read', 'source_campaign_members_read', 'source_permissions_read',
        'source_checkpoints_read', 'source_quality_findings_read', 'source_quality_events_read',
    ]
    const relationsReady = relations.every((key) => bool(row[key]))
    const appendOnlyReady = triggers.every((key) => bool(row[key]))
    const grantsReady = grants.every((key) => bool(row[key]))
    return {
        ready: relationsReady && appendOnlyReady && grantsReady && migrationReady,
        migrationId: COMMERCIAL_ANALYTICS_MIGRATION_ID,
        relationsReady,
        appendOnlyReady,
        grantsReady,
        migrationReady,
        safety: commercialAnalyticsSafety(),
    }
}

export async function commercialAnalyticsReadiness(db) {
    try {
        const availability = await db.query(`select
            to_regclass('crm_atendimento.commercial_analytics_mutations') is not null as mutations,
            to_regclass('crm_atendimento.commercial_segment_definitions') is not null as definitions,
            to_regclass('crm_atendimento.commercial_segment_versions') is not null as versions,
            to_regclass('crm_atendimento.commercial_segment_memberships') is not null as memberships,
            to_regclass('crm_atendimento.commercial_attribution_windows') is not null as windows,
            to_regclass('crm_atendimento.commercial_experiments') is not null as experiments,
            to_regclass('crm_atendimento.commercial_experiment_assignments') is not null as assignments,
            to_regclass('crm_atendimento.commercial_analytics_events') is not null as events,
            to_regclass('crm_atendimento.schema_migrations') is not null as migration_registry,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.schema_migrations'), 'SELECT'), false) as migration_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_analytics_mutations'), 'SELECT'), false) as mutations_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_analytics_mutations'), 'INSERT'), false) as mutations_write,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_segment_definitions'), 'SELECT'), false) as definitions_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_segment_definitions'), 'INSERT, UPDATE'), false) as definitions_write,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_segment_versions'), 'SELECT'), false) as versions_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_segment_versions'), 'INSERT'), false) as versions_write,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_segment_memberships'), 'SELECT'), false) as memberships_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_segment_memberships'), 'INSERT'), false) as memberships_write,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_attribution_windows'), 'SELECT'), false) as windows_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_attribution_windows'), 'INSERT, UPDATE'), false) as windows_write,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_experiment_assignments'), 'SELECT'), false) as assignments_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_experiment_assignments'), 'INSERT'), false) as assignments_write,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_experiments'), 'SELECT'), false) as experiments_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_experiments'), 'INSERT, UPDATE'), false) as experiments_write,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_analytics_events'), 'INSERT'), false) as events_write,
            coalesce(has_sequence_privilege(current_user, to_regclass('crm_atendimento.commercial_analytics_events_event_order_seq'), 'USAGE'), false) as events_sequence_write,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.units'), 'SELECT'), false) as source_units_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.global_client_identity_members'), 'SELECT'), false) as source_identity_members_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.attendance_client_links'), 'SELECT'), false) as source_attendance_links_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.attendances'), 'SELECT'), false) as source_attendances_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_caixa.sales'), 'SELECT'), false) as source_sales_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_caixa.sale_items'), 'SELECT'), false) as source_sale_items_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_actions'), 'SELECT'), false) as source_actions_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_campaigns'), 'SELECT'), false) as source_campaigns_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_campaign_members'), 'SELECT'), false) as source_campaign_members_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_contact_permissions'), 'SELECT'), false) as source_permissions_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.clientes_source_operation_checkpoints'), 'SELECT'), false) as source_checkpoints_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_data_quality_findings'), 'SELECT'), false) as source_quality_findings_read,
            coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_data_quality_finding_events'), 'SELECT'), false) as source_quality_events_read,
            exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_analytics_mutations')
                and tgname='commercial_analytics_mutations_immutable' and tgenabled='O'
                and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_analytics_ledger_mutation()')) as mutations_immutable,
            exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_analytics_mutations')
                and tgname='commercial_analytics_mutations_no_truncate' and tgenabled='O'
                and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_analytics_ledger_mutation()')) as mutations_no_truncate,
            exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_segment_memberships')
                and tgname='commercial_segment_memberships_immutable' and tgenabled='O'
                and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_analytics_ledger_mutation()')) as memberships_immutable,
            exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_segment_memberships')
                and tgname='commercial_segment_memberships_no_truncate' and tgenabled='O'
                and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_analytics_ledger_mutation()')) as memberships_no_truncate,
            exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_experiment_assignments')
                and tgname='commercial_experiment_assignments_immutable' and tgenabled='O'
                and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_analytics_ledger_mutation()')) as assignments_immutable,
            exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_experiment_assignments')
                and tgname='commercial_experiment_assignments_no_truncate' and tgenabled='O'
                and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_analytics_ledger_mutation()')) as assignments_no_truncate,
            exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_analytics_events')
                and tgname='commercial_analytics_events_immutable' and tgenabled='O'
                and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_analytics_ledger_mutation()')) as events_immutable,
            exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_analytics_events')
                and tgname='commercial_analytics_events_no_truncate' and tgenabled='O'
                and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_analytics_ledger_mutation()')) as events_no_truncate`)
        const row = availability.rows[0] || {}
        if (!row.migration_registry || !row.migration_read) return mapReadiness(row, false)
        const migration = await db.query(`select id from crm_atendimento.schema_migrations where id=$1 and rolled_back_at is null`, [COMMERCIAL_ANALYTICS_MIGRATION_ID])
        return mapReadiness(row, !!migration.rows[0]?.id)
    } catch {
        return { ...mapReadiness({}, false), readinessUnavailable: true }
    }
}

async function assertReady(db) {
    const readiness = await commercialAnalyticsReadiness(db)
    if (!readiness.ready) throw analyticsError('COMMERCIAL_ANALYTICS_NOT_READY')
    return readiness
}

function mutationContext(actor, operation, payload, fingerprintPayload, options = {}) {
    const mutation = normalizeAnalyticsMutation(payload, options)
    const actorRef = actorReference(actor)
    const mutationKey = `ca:${digest('commercial-analytics-idempotency', { actorRef, operation, idempotencyKey: mutation.idempotencyKey })}`
    const requestFingerprint = digest('commercial-analytics-request', { actorRef, operation, payload: fingerprintPayload })
    return { mutation, actorRef, mutationKey, requestFingerprint }
}

async function runAnalyticsMutation(client, { actor, operation, payload, fingerprintPayload, options = {}, execute }) {
    const context = mutationContext(actor, operation, payload, fingerprintPayload, options)
    // The advisory lock is deliberately first. No readiness, ledger or mutable
    // row is read until this idempotency namespace is serialized.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [context.mutationKey])
    await assertReady(client)
    const existing = await client.query(`select request_fingerprint,response
        from crm_atendimento.commercial_analytics_mutations
        where mutation_key=$1 and operation=$2 for update`, [context.mutationKey, operation])
    if (existing.rows[0]) {
        if (text(existing.rows[0].request_fingerprint) !== context.requestFingerprint) {
            throw analyticsError('COMMERCIAL_ANALYTICS_IDEMPOTENCY_CONFLICT')
        }
        return { ...(existing.rows[0].response || {}), idempotent: true, safety: commercialAnalyticsSafety() }
    }
    const response = await execute(context)
    await client.query(`insert into crm_atendimento.commercial_analytics_mutations(
            mutation_key,operation,actor_id,request_fingerprint,response)
        values($1,$2,$3,$4,$5::jsonb)`, [
        context.mutationKey, operation, context.actorRef, context.requestFingerprint, JSON.stringify(response || {}),
    ])
    return { ...(response || {}), idempotent: false, safety: commercialAnalyticsSafety() }
}

async function recordAnalyticsEvent(client, { eventType, entityType, entityId, actorRef, countValue = null, fingerprint = null }) {
    await client.query(`insert into crm_atendimento.commercial_analytics_events(
            event_type,entity_type,entity_id,actor_id,trace_id,count_value,fingerprint)
        values($1,$2,$3,$4,$5,$6,$7)`, [
        eventType, entityType, entityId, actorRef, randomUUID(), countValue, fingerprint,
    ])
}

function percentile(values, ratio) {
    const sorted = values.map((value) => number(value)).filter((value) => value >= 0).sort((left, right) => left - right)
    if (!sorted.length) return 0
    return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1))]
}

function candidateIdentityQuality(row) {
    return number(row.source_type_count) >= 2 ? 'confirmed_multi_source' : 'unresolved_single_source'
}

function candidateMatchesCriteria(row, criteria, benchmarks) {
    if (criteria.minimum_lifetime_sales != null && number(row.lifetime_sales) < criteria.minimum_lifetime_sales) return false
    if (criteria.minimum_visits != null && number(row.visit_count) < criteria.minimum_visits) return false
    if (criteria.minimum_recency_days != null && (row.recency_days == null || number(row.recency_days) < criteria.minimum_recency_days)) return false
    if (criteria.maximum_recency_days != null && (row.recency_days == null || number(row.recency_days) > criteria.maximum_recency_days)) return false
    if (criteria.minimum_lifetime_sales_percentile != null && number(row.lifetime_sales) < benchmarks.sales) return false
    if (criteria.minimum_visits_percentile != null && number(row.visit_count) < benchmarks.visits) return false
    if (criteria.requires_permission === true && !bool(row.has_permission)) return false
    if (criteria.requires_phone_correlation === true && !bool(row.phone_correlated)) return false
    if (criteria.requires_fresh_sources === true && bool(row.source_stale)) return false
    if (criteria.source_freshness_max_hours != null && number(row.source_freshness_hours, Number.POSITIVE_INFINITY) > criteria.source_freshness_max_hours) return false
    if (criteria.identity_quality && candidateIdentityQuality(row) !== criteria.identity_quality) return false
    if (criteria.procedure_ids?.length && !criteria.procedure_ids.some((id) => (row.procedure_ids || []).map(String).includes(id))) return false
    if (criteria.sales_classifications?.length) {
        const classifications = []
        if (number(row.sale_count) > 0 && number(row.unmapped_sale_items) === 0) classifications.push('mapped')
        if (number(row.unmapped_sale_items) > 0) classifications.push('unmapped')
        if (!criteria.sales_classifications.some((item) => classifications.includes(item))) return false
    }
    return true
}

async function segmentCandidates(client, unitId) {
    const result = await client.query(`with attendance_members as (
            select distinct member.identity_id,member.source_id::uuid as client_id
            from crm_atendimento.global_client_identity_members member
            where member.source_type='attendance_client' and member.source_id ~ '^[0-9a-fA-F-]{36}$'
        ), attendance_activity as (
            select member.identity_id,attendance.unit_id,count(distinct attendance.service_date)::int as visit_count,
                max(attendance.service_date) as last_attendance,
                coalesce(array_agg(distinct attendance.procedure_id::text) filter(where attendance.procedure_id is not null), '{}'::text[]) as procedure_ids
            from attendance_members member
            join crm_atendimento.attendance_client_links link on link.client_id=member.client_id
            join crm_atendimento.attendances attendance on attendance.id=link.attendance_id
            where attendance.deleted_at is null
            group by member.identity_id,attendance.unit_id
        ), sale_members as (
            select distinct member.identity_id,member.source_id::uuid as customer_id
            from crm_atendimento.global_client_identity_members member
            where member.source_type='caixa_customer' and member.source_id ~ '^[0-9a-fA-F-]{36}$'
        ), sale_activity as (
            select member.identity_id,sale.unit_id,count(distinct sale.id)::int as sale_count,
                coalesce(sum(sale.total),0)::numeric as lifetime_sales,
                count(item.id) filter(where coalesce(item.mapping_status,'pending') <> 'mapped')::int as unmapped_sale_items
            from sale_members member
            join crm_caixa.sales sale on sale.customer_id=member.customer_id
            left join crm_caixa.sale_items item on item.sale_id=sale.id
            group by member.identity_id,sale.unit_id
        ), identity_units as (
            select identity_id,unit_id from attendance_activity
            union
            select identity_id,unit_id from sale_activity
        ), freshness as (
            select coalesce(bool_or(checkpoint.last_status <> 'complete' or checkpoint.validated_snapshot_complete is not true or
                checkpoint.reconciliation_required is true or checkpoint.validated_at is null or checkpoint.validated_at < now() - interval '48 hours'), true) as source_stale,
                coalesce(max(extract(epoch from now()-checkpoint.validated_at)/3600) filter(where checkpoint.validated_at is not null), 1000000)::int as source_freshness_hours
            from crm_atendimento.clientes_source_operation_checkpoints checkpoint
        )
        select unit_identity.identity_id::text,unit_identity.unit_id::text,
            coalesce(attendance.visit_count,0)::int as visit_count,
            attendance.last_attendance,
            case when attendance.last_attendance is null then null else (current_date-attendance.last_attendance)::int end as recency_days,
            coalesce(attendance.procedure_ids,'{}'::text[]) as procedure_ids,
            coalesce(sale.sale_count,0)::int as sale_count,
            coalesce(sale.lifetime_sales,0)::numeric as lifetime_sales,
            coalesce(sale.unmapped_sale_items,0)::int as unmapped_sale_items,
            (select count(distinct source_member.source_type)::int from crm_atendimento.global_client_identity_members source_member where source_member.identity_id=unit_identity.identity_id) as source_type_count,
            exists(select 1 from crm_atendimento.commercial_contact_permissions permission
                where permission.identity_id=unit_identity.identity_id and permission.channel='whatsapp' and permission.status='granted'
                  and (permission.expires_at is null or permission.expires_at > now())) as has_permission,
            exists(select 1 from crm_atendimento.global_client_identity_members source_member where source_member.identity_id=unit_identity.identity_id and source_member.source_type='attendance_client')
              and exists(select 1 from crm_atendimento.global_client_identity_members source_member where source_member.identity_id=unit_identity.identity_id and source_member.source_type='caixa_customer') as phone_correlated,
            freshness.source_stale,freshness.source_freshness_hours
        from identity_units unit_identity
        left join attendance_activity attendance on attendance.identity_id=unit_identity.identity_id and attendance.unit_id=unit_identity.unit_id
        left join sale_activity sale on sale.identity_id=unit_identity.identity_id and sale.unit_id=unit_identity.unit_id
        cross join freshness
        where unit_identity.unit_id=$1::uuid
        order by unit_identity.identity_id
        limit $2`, [unitId, MAX_SEGMENT_CANDIDATES + 1])
    if ((result.rows || []).length > MAX_SEGMENT_CANDIDATES) throw analyticsError('SEGMENT_SNAPSHOT_TOO_LARGE')
    return result.rows || []
}

function mapSegment(row = {}) {
    return {
        id: text(row.id),
        unit: text(row.unit_slug),
        key: text(row.segment_key),
        name: text(row.name),
        criteria: row.criteria && typeof row.criteria === 'object' ? row.criteria : {},
        status: text(row.status),
        revision: number(row.revision),
        currentVersionId: text(row.current_version_id) || null,
        currentVersion: number(row.current_version) || null,
        populationCount: number(row.population_count),
        snapshotAt: row.snapshot_at || null,
        updatedAt: row.updated_at || null,
    }
}

function mapWindow(row = {}) {
    return {
        id: text(row.id), unit: text(row.unit_slug), key: text(row.window_key), revision: number(row.revision), state: text(row.state),
        startsAt: row.starts_at || null, endsAt: row.ends_at || null,
        responseDays: number(row.response_days), scheduledDays: number(row.scheduled_days), attendedDays: number(row.attended_days),
        purchasedDays: number(row.purchased_days), returnedDays: number(row.returned_days), updatedAt: row.updated_at || null,
    }
}

function mapExperiment(row = {}) {
    return {
        id: text(row.id), unit: text(row.unit_slug), name: text(row.name), state: text(row.state), revision: number(row.revision),
        segmentVersionId: text(row.segment_version_id), attributionWindowId: text(row.attribution_window_id),
        controlGroupPercent: number(row.control_group_percent), startsAt: row.starts_at || null, endsAt: row.ends_at || null,
        policyVersion: text(row.policy_version), assignments: number(row.assignment_count), treatmentAssignments: number(row.treatment_assignments),
        controlAssignments: number(row.control_assignments), excludedAssignments: number(row.excluded_assignments), updatedAt: row.updated_at || null,
    }
}

async function createSegmentDefinition(client, payload, actor) {
    const input = normalizeSegmentPayload(payload)
    return runAnalyticsMutation(client, {
        actor,
        operation: 'segment_create',
        payload,
        fingerprintPayload: { segment: { name: input.name, key: input.key, unit: input.unit, criteria: input.criteria, expectedRevision: input.mutation.expectedRevision } },
        options: { allowCreateRevision: true },
        execute: async ({ actorRef, mutation }) => {
            const unit = await resolveUnit(client, actor, input.unit)
            await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-analytics-segment:${unit.id}:${input.key}`])
            const existing = await client.query(`select id::text,revision from crm_atendimento.commercial_segment_definitions
                where unit_id=$1::uuid and segment_key=$2 for update`, [unit.id, input.key])
            let definitionId
            let revision
            if (existing.rows[0]) {
                if (mutation.expectedRevision !== number(existing.rows[0].revision)) throw analyticsError('COMMERCIAL_ANALYTICS_REVISION_CONFLICT')
                revision = number(existing.rows[0].revision) + 1
                definitionId = String(existing.rows[0].id)
                await client.query(`update crm_atendimento.commercial_segment_definitions
                    set name=$2,criteria=$3::jsonb,status='active',revision=$4,updated_by=$5,updated_at=now()
                    where id=$1::uuid`, [definitionId, input.name, JSON.stringify(input.criteria), revision, actorRef])
            } else {
                if (mutation.expectedRevision != null && mutation.expectedRevision !== 0) throw analyticsError('COMMERCIAL_ANALYTICS_REVISION_CONFLICT')
                const created = await client.query(`insert into crm_atendimento.commercial_segment_definitions(
                        unit_id,segment_key,name,criteria,status,revision,created_by,updated_by)
                    values($1::uuid,$2,$3,$4::jsonb,'active',1,$5,$5) returning id::text,revision`,
                [unit.id, input.key, input.name, JSON.stringify(input.criteria), actorRef])
                definitionId = String(created.rows[0]?.id || '')
                revision = number(created.rows[0]?.revision)
                if (!definitionId || !revision) throw analyticsError('COMMERCIAL_ANALYTICS_SEGMENT_CREATE_FAILED', 500)
            }
            const criteriaFingerprint = stableAnalyticsFingerprint(input.criteria)
            const version = await client.query(`insert into crm_atendimento.commercial_segment_versions(
                    definition_id,version,criteria,criteria_fingerprint,effective_from,author)
                values($1::uuid,$2,$3::jsonb,$4,now(),$5) returning id::text`,
            [definitionId, revision, JSON.stringify(input.criteria), criteriaFingerprint, actorRef])
            const versionId = String(version.rows[0]?.id || '')
            if (!versionId) throw analyticsError('COMMERCIAL_ANALYTICS_SEGMENT_VERSION_CREATE_FAILED', 500)
            await recordAnalyticsEvent(client, {
                eventType: 'segment_defined', entityType: 'segment_definition', entityId: definitionId, actorRef, fingerprint: criteriaFingerprint,
            })
            await recordAnalyticsEvent(client, {
                eventType: 'segment_versioned', entityType: 'segment_version', entityId: versionId, actorRef, fingerprint: criteriaFingerprint,
            })
            return { definitionId, versionId, revision, unit: unit.slug, criteriaFingerprint }
        },
    })
}

function normalizeSegmentVersionInput(definitionId, payload = {}) {
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date()
    const effectiveUntil = input.effectiveUntil ? new Date(input.effectiveUntil) : null
    if (Number.isNaN(effectiveFrom.getTime()) || (effectiveUntil && (Number.isNaN(effectiveUntil.getTime()) || effectiveUntil <= effectiveFrom))) {
        throw analyticsError('SEGMENT_VERSION_RANGE_INVALID', 400)
    }
    const mutation = normalizeAnalyticsMutation(input)
    if (mutation.expectedRevision == null) throw analyticsError('COMMERCIAL_ANALYTICS_EXPECTED_REVISION_REQUIRED', 400)
    return {
        definitionId: assertUuid(definitionId, 'SEGMENT_DEFINITION_ID_INVALID'),
        criteria: normalizeSegmentCriteria(input.criteria),
        effectiveFrom: effectiveFrom.toISOString(),
        effectiveUntil: effectiveUntil?.toISOString() || null,
        mutation,
    }
}

async function createSegmentVersion(client, definitionId, payload, actor) {
    const input = normalizeSegmentVersionInput(definitionId, payload)
    return runAnalyticsMutation(client, {
        actor,
        operation: 'segment_version',
        payload,
        fingerprintPayload: { definitionId: input.definitionId, criteria: input.criteria, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil, expectedRevision: input.mutation.expectedRevision },
        execute: async ({ actorRef, mutation }) => {
            const current = await client.query(`select definition.id::text,definition.unit_id::text,definition.revision,definition.segment_key
                from crm_atendimento.commercial_segment_definitions definition where definition.id=$1::uuid for update`, [input.definitionId])
            const definition = current.rows[0]
            if (!definition) throw analyticsError('SEGMENT_DEFINITION_NOT_FOUND', 404)
            const unitScope = commercialOperationsUnitScope(actor)
            if (unitScope !== null) {
                const unit = await client.query(`select slug from crm_atendimento.units where id=$1::uuid`, [definition.unit_id])
                if (!unitScope.includes(text(unit.rows[0]?.slug))) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
            }
            if (mutation.expectedRevision !== number(definition.revision)) throw analyticsError('COMMERCIAL_ANALYTICS_REVISION_CONFLICT')
            const revision = number(definition.revision) + 1
            const criteriaFingerprint = stableAnalyticsFingerprint(input.criteria)
            await client.query(`update crm_atendimento.commercial_segment_definitions
                set criteria=$2::jsonb,revision=$3,updated_by=$4,updated_at=now() where id=$1::uuid`,
            [definition.id, JSON.stringify(input.criteria), revision, actorRef])
            const created = await client.query(`insert into crm_atendimento.commercial_segment_versions(
                    definition_id,version,criteria,criteria_fingerprint,effective_from,effective_until,author)
                values($1::uuid,$2,$3::jsonb,$4,$5,$6,$7) returning id::text`,
            [definition.id, revision, JSON.stringify(input.criteria), criteriaFingerprint, input.effectiveFrom, input.effectiveUntil, actorRef])
            const versionId = String(created.rows[0]?.id || '')
            if (!versionId) throw analyticsError('COMMERCIAL_ANALYTICS_SEGMENT_VERSION_CREATE_FAILED', 500)
            await recordAnalyticsEvent(client, {
                eventType: 'segment_versioned', entityType: 'segment_version', entityId: versionId, actorRef, fingerprint: criteriaFingerprint,
            })
            return { definitionId: String(definition.id), versionId, revision, criteriaFingerprint }
        },
    })
}

function normalizeSnapshotInput(versionId, payload = {}) {
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    const mutation = normalizeAnalyticsMutation(input)
    if (mutation.expectedRevision == null) throw analyticsError('COMMERCIAL_ANALYTICS_EXPECTED_REVISION_REQUIRED', 400)
    return {
        versionId: assertUuid(versionId, 'SEGMENT_VERSION_ID_INVALID'),
        unit: normalizeUnit(input.unit, 'SEGMENT_UNIT_INVALID'),
        mutation,
    }
}

async function materializeSegmentSnapshot(client, versionId, payload, actor) {
    const input = normalizeSnapshotInput(versionId, payload)
    return runAnalyticsMutation(client, {
        actor,
        operation: 'segment_snapshot',
        payload,
        fingerprintPayload: { versionId: input.versionId, unit: input.unit, expectedRevision: input.mutation.expectedRevision },
        execute: async ({ actorRef, mutation }) => {
            const unit = await resolveUnit(client, actor, input.unit)
            const result = await client.query(`select version.id::text,version.version as version_number,version.criteria,version.criteria_fingerprint,version.snapshot_at,
                    version.population_count,definition.id::text as definition_id,definition.revision,definition.unit_id::text
                from crm_atendimento.commercial_segment_versions version
                join crm_atendimento.commercial_segment_definitions definition on definition.id=version.definition_id
                where version.id=$1::uuid and definition.unit_id=$2::uuid for update`, [input.versionId, unit.id])
            const version = result.rows[0]
            if (!version) throw analyticsError('SEGMENT_VERSION_NOT_FOUND', 404)
            if (mutation.expectedRevision !== number(version.revision)) throw analyticsError('COMMERCIAL_ANALYTICS_REVISION_CONFLICT')
            if (number(version.version_number) !== number(version.revision)) throw analyticsError('SEGMENT_VERSION_STALE')
            if (version.snapshot_at) {
                return { versionId: String(version.id), populationCount: number(version.population_count), snapshotAt: version.snapshot_at, deduplicated: true }
            }
            const criteria = normalizeSegmentCriteria(version.criteria)
            const candidates = await segmentCandidates(client, unit.id)
            const benchmarks = {
                sales: criteria.minimum_lifetime_sales_percentile == null ? 0 : percentile(candidates.map((candidate) => candidate.lifetime_sales), criteria.minimum_lifetime_sales_percentile / 100),
                visits: criteria.minimum_visits_percentile == null ? 0 : percentile(candidates.map((candidate) => candidate.visit_count), criteria.minimum_visits_percentile / 100),
            }
            const eligible = candidates.filter((candidate) => candidateMatchesCriteria(candidate, criteria, benchmarks))
            const identityIds = eligible.map((candidate) => assertUuid(candidate.identity_id, 'SEGMENT_CANDIDATE_ID_INVALID'))
            if (identityIds.length) {
                await client.query(`insert into crm_atendimento.commercial_segment_memberships(
                        segment_version_id,identity_id,unit_id,eligible,criteria_fingerprint)
                    select $1::uuid,identity_id,$2::uuid,true,$3
                    from unnest($4::uuid[]) as candidate(identity_id)`,
                [version.id, unit.id, version.criteria_fingerprint, identityIds])
            }
            const distribution = {
                candidateCount: candidates.length,
                eligibleCount: eligible.length,
                sourceStaleCandidates: candidates.filter((candidate) => bool(candidate.source_stale)).length,
                confirmedMultiSourceEligible: eligible.filter((candidate) => candidateIdentityQuality(candidate) === 'confirmed_multi_source').length,
                benchmarks,
            }
            const updated = await client.query(`update crm_atendimento.commercial_segment_versions
                set population_count=$2,distribution=$3::jsonb,snapshot_at=now()
                where id=$1::uuid returning snapshot_at`, [version.id, eligible.length, JSON.stringify(distribution)])
            await recordAnalyticsEvent(client, {
                eventType: 'segment_snapshot', entityType: 'segment_version', entityId: version.id, actorRef,
                countValue: eligible.length, fingerprint: version.criteria_fingerprint,
            })
            return {
                versionId: String(version.id), populationCount: eligible.length,
                snapshotAt: updated.rows[0]?.snapshot_at || null, distribution,
            }
        },
    })
}

async function upsertAttributionWindow(client, payload, actor) {
    const input = normalizeAttributionWindowPayload(payload)
    return runAnalyticsMutation(client, {
        actor,
        operation: 'attribution_window_upsert',
        payload,
        fingerprintPayload: { ...input, mutation: { expectedRevision: input.mutation.expectedRevision } },
        options: { allowCreateRevision: true },
        execute: async ({ actorRef, mutation }) => {
            const unit = await resolveUnit(client, actor, input.unit)
            await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-analytics-window:${unit.id}:${input.key}`])
            const latestResult = await client.query(`select id::text,revision from crm_atendimento.commercial_attribution_windows
                where unit_id=$1::uuid and window_key=$2 order by revision desc limit 1 for update`, [unit.id, input.key])
            const latest = latestResult.rows[0]
            if (latest && mutation.expectedRevision !== number(latest.revision)) throw analyticsError('COMMERCIAL_ANALYTICS_REVISION_CONFLICT')
            if (!latest && mutation.expectedRevision != null && mutation.expectedRevision !== 0) throw analyticsError('COMMERCIAL_ANALYTICS_REVISION_CONFLICT')
            if (latest) await client.query(`update crm_atendimento.commercial_attribution_windows set state='superseded',updated_at=now() where id=$1::uuid`, [latest.id])
            const revision = latest ? number(latest.revision) + 1 : 1
            const created = await client.query(`insert into crm_atendimento.commercial_attribution_windows(
                    unit_id,window_key,revision,state,starts_at,ends_at,response_days,scheduled_days,attended_days,purchased_days,returned_days,created_by)
                values($1::uuid,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,$11) returning id::text`, [
                unit.id, input.key, revision, input.startsAt, input.endsAt, input.responseDays, input.scheduledDays,
                input.attendedDays, input.purchasedDays, input.returnedDays, actorRef,
            ])
            const windowId = String(created.rows[0]?.id || '')
            if (!windowId) throw analyticsError('ATTRIBUTION_WINDOW_CREATE_FAILED', 500)
            const fingerprint = stableAnalyticsFingerprint({ key: input.key, unit: unit.slug, revision, startsAt: input.startsAt, endsAt: input.endsAt,
                responseDays: input.responseDays, scheduledDays: input.scheduledDays, attendedDays: input.attendedDays, purchasedDays: input.purchasedDays, returnedDays: input.returnedDays })
            await recordAnalyticsEvent(client, {
                eventType: 'attribution_window_versioned', entityType: 'attribution_window', entityId: windowId, actorRef, fingerprint,
            })
            return { windowId, revision, unit: unit.slug, fingerprint }
        },
    })
}

function normalizeExperimentStateInput(experimentId, payload = {}) {
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    const state = text(input.state).toLowerCase()
    if (!COMMERCIAL_EXPERIMENT_STATES.includes(state)) throw analyticsError('COMMERCIAL_EXPERIMENT_STATE_INVALID', 400)
    const mutation = normalizeAnalyticsMutation(input)
    if (mutation.expectedRevision == null) throw analyticsError('COMMERCIAL_ANALYTICS_EXPECTED_REVISION_REQUIRED', 400)
    return {
        experimentId: assertUuid(experimentId, 'COMMERCIAL_EXPERIMENT_ID_INVALID'),
        state,
        mutation,
    }
}

async function lockExperimentIdentity(client, unitId, identityId) {
    // This is intentionally byte-for-byte the Operations namespace.  An
    // experiment assignment and campaign/reassign/rebalance therefore cannot
    // make contradictory decisions for one identity concurrently.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
        `commercial-experiment-crossover:${unitId}:${identityId}`,
    ])
}

async function createExperiment(client, payload, actor) {
    const input = normalizeExperimentPayload(payload)
    return runAnalyticsMutation(client, {
        actor,
        operation: 'experiment_create',
        payload,
        fingerprintPayload: {
            name: input.name, unit: input.unit, segmentVersionId: input.segmentVersionId,
            attributionWindowId: input.attributionWindowId, startsAt: input.startsAt,
            endsAt: input.endsAt, controlGroupPercent: input.controlGroupPercent,
            expectedRevision: input.mutation.expectedRevision,
        },
        options: { allowCreateRevision: true },
        execute: async ({ actorRef, mutation }) => {
            if (mutation.expectedRevision != null && mutation.expectedRevision !== 0) {
                throw analyticsError('COMMERCIAL_ANALYTICS_REVISION_CONFLICT')
            }
            const unit = await resolveUnit(client, actor, input.unit)
            const segmentResult = await client.query(`select version.id::text,version.criteria_fingerprint,version.snapshot_at,
                    definition.unit_id::text,definition.revision,version.version as version_number
                from crm_atendimento.commercial_segment_versions version
                join crm_atendimento.commercial_segment_definitions definition on definition.id=version.definition_id
                where version.id=$1::uuid and definition.unit_id=$2::uuid for share`, [input.segmentVersionId, unit.id])
            const segment = segmentResult.rows[0]
            if (!segment) throw analyticsError('COMMERCIAL_EXPERIMENT_SEGMENT_NOT_FOUND', 404)
            if (!segment.snapshot_at || number(segment.version_number) !== number(segment.revision)) {
                throw analyticsError('COMMERCIAL_EXPERIMENT_SEGMENT_SNAPSHOT_REQUIRED')
            }
            const windowResult = await client.query(`select id::text,state from crm_atendimento.commercial_attribution_windows
                where id=$1::uuid and unit_id=$2::uuid for share`, [input.attributionWindowId, unit.id])
            const window = windowResult.rows[0]
            if (!window || text(window.state) !== 'active') throw analyticsError('COMMERCIAL_EXPERIMENT_WINDOW_NOT_ACTIVE')
            const policyVersion = stableAnalyticsFingerprint({
                segmentVersionId: input.segmentVersionId,
                segmentCriteriaFingerprint: text(segment.criteria_fingerprint),
                attributionWindowId: input.attributionWindowId,
                startsAt: input.startsAt,
                endsAt: input.endsAt,
                controlGroupPercent: input.controlGroupPercent,
            })
            const created = await client.query(`insert into crm_atendimento.commercial_experiments(
                    unit_id,name,segment_version_id,attribution_window_id,control_group_percent,state,revision,starts_at,ends_at,policy_version,author)
                values($1::uuid,$2,$3::uuid,$4::uuid,$5,'draft',1,$6,$7,$8,$9) returning id::text`, [
                unit.id, input.name, input.segmentVersionId, input.attributionWindowId, input.controlGroupPercent,
                input.startsAt, input.endsAt, policyVersion, actorRef,
            ])
            const experimentId = String(created.rows[0]?.id || '')
            if (!experimentId) throw analyticsError('COMMERCIAL_EXPERIMENT_CREATE_FAILED', 500)
            const memberships = await client.query(`select identity_id::text,criteria_fingerprint
                from crm_atendimento.commercial_segment_memberships
                where segment_version_id=$1::uuid and unit_id=$2::uuid and eligible is true
                order by identity_id`, [input.segmentVersionId, unit.id])
            if ((memberships.rows || []).length > MAX_SEGMENT_CANDIDATES) throw analyticsError('COMMERCIAL_EXPERIMENT_ASSIGNMENT_TOO_LARGE')
            let treatmentAssignments = 0
            let controlAssignments = 0
            let excludedAssignments = 0
            for (const membership of memberships.rows || []) {
                const identityId = assertUuid(membership.identity_id, 'COMMERCIAL_EXPERIMENT_ASSIGNMENT_INVALID')
                await lockExperimentIdentity(client, unit.id, identityId)
                const overlap = await client.query(`select assignment.variant
                    from crm_atendimento.commercial_experiment_assignments assignment
                    join crm_atendimento.commercial_experiments experiment on experiment.id=assignment.experiment_id
                    where assignment.unit_id=$1::uuid and assignment.identity_id=$2::uuid
                      and assignment.variant in ('control','excluded')
                      and experiment.state in ('draft','active')
                      and experiment.starts_at < $4::timestamptz and experiment.ends_at > $3::timestamptz
                    limit 1`, [unit.id, identityId, input.startsAt, input.endsAt])
                const variant = overlap.rows[0]
                    ? 'excluded'
                    : deterministicExperimentVariant({ experimentId, identityId, controlGroupPercent: input.controlGroupPercent })
                const eligibilityFingerprint = stableAnalyticsFingerprint({
                    identityId, unit: unit.slug, segmentVersionId: input.segmentVersionId,
                    criteriaFingerprint: text(membership.criteria_fingerprint), policyVersion,
                })
                await client.query(`insert into crm_atendimento.commercial_experiment_assignments(
                    experiment_id,identity_id,unit_id,variant,eligibility_fingerprint)
                    values($1::uuid,$2::uuid,$3::uuid,$4,$5)`, [experimentId, identityId, unit.id, variant, eligibilityFingerprint])
                if (variant === 'treatment') treatmentAssignments += 1
                else if (variant === 'control') controlAssignments += 1
                else excludedAssignments += 1
            }
            await recordAnalyticsEvent(client, {
                eventType: 'experiment_created', entityType: 'experiment', entityId: experimentId,
                actorRef, countValue: memberships.rows.length, fingerprint: policyVersion,
            })
            return {
                experimentId, unit: unit.slug, state: 'draft', policyVersion,
                assignments: memberships.rows.length, treatmentAssignments, controlAssignments, excludedAssignments,
            }
        },
    })
}

async function updateExperimentState(client, experimentId, payload, actor) {
    const input = normalizeExperimentStateInput(experimentId, payload)
    return runAnalyticsMutation(client, {
        actor,
        operation: 'experiment_state',
        payload,
        fingerprintPayload: { experimentId: input.experimentId, state: input.state, expectedRevision: input.mutation.expectedRevision },
        execute: async ({ actorRef, mutation }) => {
            const result = await client.query(`select experiment.id::text,experiment.state,experiment.revision,
                    experiment.starts_at,experiment.ends_at,unit.slug as unit_slug
                from crm_atendimento.commercial_experiments experiment
                join crm_atendimento.units unit on unit.id=experiment.unit_id
                where experiment.id=$1::uuid for update`, [input.experimentId])
            const experiment = result.rows[0]
            if (!experiment) throw analyticsError('COMMERCIAL_EXPERIMENT_NOT_FOUND', 404)
            const scope = commercialOperationsUnitScope(actor)
            if (scope !== null && !scope.includes(text(experiment.unit_slug))) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
            if (mutation.expectedRevision !== number(experiment.revision)) throw analyticsError('COMMERCIAL_ANALYTICS_REVISION_CONFLICT')
            const current = text(experiment.state)
            const transitions = {
                draft: new Set(['active', 'disabled']),
                active: new Set(['closed', 'disabled']),
                closed: new Set(),
                disabled: new Set(),
            }
            if (!transitions[current]?.has(input.state)) throw analyticsError('COMMERCIAL_EXPERIMENT_STATE_TRANSITION_INVALID')
            if (input.state === 'active' && (new Date(experiment.starts_at) > new Date() || new Date(experiment.ends_at) <= new Date())) {
                throw analyticsError('COMMERCIAL_EXPERIMENT_WINDOW_NOT_ACTIVE')
            }
            const nextRevision = number(experiment.revision) + 1
            await client.query(`update crm_atendimento.commercial_experiments
                set state=$2,revision=$3,updated_at=now() where id=$1::uuid`, [input.experimentId, input.state, nextRevision])
            await recordAnalyticsEvent(client, {
                eventType: 'experiment_state_changed', entityType: 'experiment', entityId: input.experimentId, actorRef,
            })
            return { experimentId: input.experimentId, unit: text(experiment.unit_slug), state: input.state, revision: nextRevision }
        },
    })
}

function clampInteger(value, fallback, minimum, maximum) {
    if (value == null || value === '') return fallback
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw analyticsError('COMMERCIAL_ANALYTICS_QUERY_INVALID', 400)
    return parsed
}

function optionalDate(value, code = 'COMMERCIAL_ANALYTICS_DATE_INVALID') {
    if (value == null || value === '') return null
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) throw analyticsError(code, 400)
    return parsed.toISOString()
}

function optionalUuid(value, code) {
    if (value == null || value === '') return null
    return assertUuid(value, code)
}

function optionalHash(value, code = 'COMMERCIAL_ANALYTICS_POLICY_VERSION_INVALID') {
    if (value == null || value === '') return null
    const hash = text(value).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(hash)) throw analyticsError(code, 400)
    return hash
}

function optionalOwner(value) {
    if (value == null || value === '') return null
    const owner = text(value)
    if (!OWNER_RE.test(owner) || owner.includes('@')) throw analyticsError('COMMERCIAL_ANALYTICS_OWNER_INVALID', 400)
    return owner
}

async function scopedUnits(db, scope) {
    const params = []
    const where = scopeClause(scope, params, 'unit.slug')
    const result = await db.query(`select unit.id::text,unit.slug from crm_atendimento.units unit
        where ${where} order by unit.slug`, params)
    if (!(result.rows || []).length) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    return result.rows.map((row) => ({ id: assertUuid(row.id, 'COMMERCIAL_ANALYTICS_UNIT_INVALID'), slug: normalizeUnit(row.slug) }))
}

async function coverageSummary(db, units) {
    const output = []
    for (const unit of units) {
        const candidates = await segmentCandidates(db, unit.id)
        output.push({
            unit: unit.slug,
            identities: candidates.length,
            confirmedIdentityCount: candidates.filter((candidate) => candidateIdentityQuality(candidate) === 'confirmed_multi_source').length,
            permissionCount: candidates.filter((candidate) => bool(candidate.has_permission)).length,
            phoneCorrelatedCount: candidates.filter((candidate) => bool(candidate.phone_correlated)).length,
            salesClassifiedCount: candidates.filter((candidate) => number(candidate.sale_count) === 0 || number(candidate.unmapped_sale_items) === 0).length,
        })
    }
    return output
}

function mapQualityRow(row = {}) {
    return {
        key: text(row.finding_key), severity: text(row.severity), status: text(row.status), observedCount: number(row.observed_count),
        firstDetectedAt: row.first_detected_at || null, lastObservedAt: row.last_observed_at || null,
        acknowledgedAt: row.acknowledged_at || null, resolvedAt: row.resolved_at || null, slaDueAt: row.sla_due_at || null,
        startedAt: row.started_at || null,
        ageHours: number(row.age_hours), recognitionHours: row.recognition_hours == null ? null : number(row.recognition_hours),
        startHours: row.start_hours == null ? null : number(row.start_hours), resolutionHours: row.resolution_hours == null ? null : number(row.resolution_hours),
        reopenCount: number(row.reopen_count), reopenRate: number(row.reopen_rate), ownerAssigned: bool(row.owner_assigned), slaBreached: bool(row.sla_breached),
    }
}

async function qualityAnalytics(db, query, actor) {
    const scope = requestedScope(actor, query)
    const units = await scopedUnits(db, scope)
    const days = clampInteger(query?.days, 30, 1, 366)
    const coverage = await coverageSummary(db, units)
    // Findings and source-operation ledgers are not unit-keyed.  A limited
    // manager receives only the independently derived aggregate coverage of
    // their declared units, never a global queue count by accident.
    if (!scope.global) {
        return {
            scope: { units: units.map((unit) => unit.slug), global: false }, days, coverage,
            findings: [], series: [], events: [], freshness: [],
            partial: true,
            partialReason: 'GLOBAL_QUALITY_AND_SOURCE_LEDGERS_NOT_UNIT_MATERIALIZED',
            safety: commercialAnalyticsSafety(),
        }
    }
    const [findings, series, history, freshness] = await Promise.all([
        db.query(`with lifecycle as (
                select finding_id,
                    min(created_at) filter(where status='in_progress') as started_at,
                    count(*) filter(where event_type='reopened')::int as reopen_count,
                    count(*)::int as event_count
                from crm_atendimento.commercial_data_quality_finding_events group by finding_id
            )
            select finding.finding_key,finding.severity,finding.status,finding.observed_count,finding.first_detected_at,
                finding.last_observed_at,finding.acknowledged_at,finding.resolved_at,finding.sla_due_at,
                extract(epoch from now()-coalesce(finding.first_detected_at,finding.created_at))/3600 as age_hours,
                case when finding.acknowledged_at is null then null else extract(epoch from finding.acknowledged_at-coalesce(finding.first_detected_at,finding.created_at))/3600 end as recognition_hours,
                case when lifecycle.started_at is null then null else extract(epoch from lifecycle.started_at-coalesce(finding.first_detected_at,finding.created_at))/3600 end as start_hours,
                case when finding.resolved_at is null then null else extract(epoch from finding.resolved_at-coalesce(finding.first_detected_at,finding.created_at))/3600 end as resolution_hours,
                lifecycle.started_at,coalesce(lifecycle.reopen_count,0)::int as reopen_count,
                case when coalesce(lifecycle.event_count,0)=0 then 0 else round(coalesce(lifecycle.reopen_count,0)::numeric/lifecycle.event_count,4) end as reopen_rate,
                (finding.owner is not null) as owner_assigned,
                (finding.sla_due_at is not null and finding.sla_due_at < now() and finding.status not in ('resolved','suppressed')) as sla_breached
            from crm_atendimento.commercial_data_quality_findings finding
            left join lifecycle on lifecycle.finding_id=finding.id
            order by finding.severity, finding.last_observed_at desc nulls last`),
        db.query(`select finding.finding_key,date_trunc('day',event.created_at) as observed_on,
                max(event.observed_count)::int as observed_count,count(*)::int as event_count
            from crm_atendimento.commercial_data_quality_finding_events event
            join crm_atendimento.commercial_data_quality_findings finding on finding.id=event.finding_id
            where event.created_at >= now() - make_interval(days => $1)
            group by finding.finding_key,date_trunc('day',event.created_at)
            order by observed_on asc,finding.finding_key asc`, [days]),
        db.query(`select finding.finding_key,event.event_type,event.status,event.observed_count,event.created_at
            from crm_atendimento.commercial_data_quality_finding_events event
            join crm_atendimento.commercial_data_quality_findings finding on finding.id=event.finding_id
            where event.created_at >= now() - make_interval(days => $1)
            order by event.event_order desc limit 250`, [days]),
        db.query(`select source_id,last_status,validated_snapshot_complete,validated_at,applied_at,last_read_at,
                last_records_read,last_records_applied,last_divergences,retry_count,consecutive_failures,last_error_code,
                extract(epoch from now()-coalesce(validated_at,last_read_at,last_attempt_at))/3600 as freshness_hours
            from crm_atendimento.clientes_source_operation_checkpoints order by source_id`),
    ])
    return {
        scope: { units: units.map((unit) => unit.slug), global: true }, days, coverage,
        findings: (findings.rows || []).map(mapQualityRow),
        series: (series.rows || []).map((row) => ({ key: text(row.finding_key), observedOn: row.observed_on, observedCount: number(row.observed_count), eventCount: number(row.event_count) })),
        events: (history.rows || []).map((row) => ({ key: text(row.finding_key), eventType: text(row.event_type), status: text(row.status), observedCount: number(row.observed_count), createdAt: row.created_at || null })),
        freshness: (freshness.rows || []).map((row) => ({
            sourceId: text(row.source_id), status: text(row.last_status), snapshotComplete: bool(row.validated_snapshot_complete),
            validatedAt: row.validated_at || null, appliedAt: row.applied_at || null, lastReadAt: row.last_read_at || null,
            recordsRead: number(row.last_records_read), recordsApplied: number(row.last_records_applied), divergences: number(row.last_divergences),
            retries: number(row.retry_count), consecutiveFailures: number(row.consecutive_failures), errorCode: text(row.last_error_code) || null,
            freshnessHours: row.freshness_hours == null ? null : number(row.freshness_hours),
        })),
        partial: false,
        safety: commercialAnalyticsSafety(),
    }
}

async function listSegments(db, query, actor) {
    const scope = requestedScope(actor, query)
    const params = []
    const where = scopeClause(scope, params, 'unit.slug')
    const result = await db.query(`select definition.id::text,unit.slug as unit_slug,definition.segment_key,definition.name,
            definition.criteria,definition.status,definition.revision,definition.updated_at,
            version.id::text as current_version_id,version.version as current_version,version.population_count,version.snapshot_at
        from crm_atendimento.commercial_segment_definitions definition
        join crm_atendimento.units unit on unit.id=definition.unit_id
        left join lateral (
            select id,version,population_count,snapshot_at from crm_atendimento.commercial_segment_versions
            where definition_id=definition.id order by version desc limit 1
        ) version on true
        where ${where}
        order by unit.slug,definition.segment_key`, params)
    return {
        scope: { units: (await scopedUnits(db, scope)).map((unit) => unit.slug), global: scope.global },
        segments: (result.rows || []).map(mapSegment), safety: commercialAnalyticsSafety(),
    }
}

async function listAttributionWindows(db, query, actor) {
    const scope = requestedScope(actor, query)
    const params = []
    const where = scopeClause(scope, params, 'unit.slug')
    const result = await db.query(`select window.id::text,unit.slug as unit_slug,window.window_key,window.revision,window.state,
            window.starts_at,window.ends_at,window.response_days,window.scheduled_days,window.attended_days,
            window.purchased_days,window.returned_days,window.updated_at
        from crm_atendimento.commercial_attribution_windows window
        join crm_atendimento.units unit on unit.id=window.unit_id
        where ${where}
        order by unit.slug,window.window_key,window.revision desc`, params)
    return {
        scope: { units: (await scopedUnits(db, scope)).map((unit) => unit.slug), global: scope.global },
        windows: (result.rows || []).map(mapWindow), safety: commercialAnalyticsSafety(),
    }
}

async function listExperiments(db, query, actor) {
    const scope = requestedScope(actor, query)
    const params = []
    const where = scopeClause(scope, params, 'unit.slug')
    const result = await db.query(`select experiment.id::text,unit.slug as unit_slug,experiment.name,experiment.state,experiment.revision,
            experiment.segment_version_id::text,experiment.attribution_window_id::text,experiment.control_group_percent,
            experiment.starts_at,experiment.ends_at,experiment.policy_version,experiment.updated_at,
            count(assignment.id)::int as assignment_count,
            count(assignment.id) filter(where assignment.variant='treatment')::int as treatment_assignments,
            count(assignment.id) filter(where assignment.variant='control')::int as control_assignments,
            count(assignment.id) filter(where assignment.variant='excluded')::int as excluded_assignments
        from crm_atendimento.commercial_experiments experiment
        join crm_atendimento.units unit on unit.id=experiment.unit_id
        left join crm_atendimento.commercial_experiment_assignments assignment on assignment.experiment_id=experiment.id
        where ${where}
        group by experiment.id,unit.slug
        order by experiment.starts_at desc,experiment.id`, params)
    return {
        scope: { units: (await scopedUnits(db, scope)).map((unit) => unit.slug), global: scope.global },
        experiments: (result.rows || []).map(mapExperiment), safety: commercialAnalyticsSafety(),
    }
}

function normalizeFunnelQuery(query = {}) {
    const startAt = optionalDate(query.startAt || query.start)
    const endAt = optionalDate(query.endAt || query.end)
    if (startAt && endAt && endAt <= startAt) throw analyticsError('COMMERCIAL_ANALYTICS_DATE_RANGE_INVALID', 400)
    const segment = query.segment == null || query.segment === '' ? null : text(query.segment)
    if (segment && !/^[A-Za-z0-9._-]{1,120}$/.test(segment)) throw analyticsError('COMMERCIAL_ANALYTICS_SEGMENT_INVALID', 400)
    const channel = query.channel == null || query.channel === '' ? null : text(query.channel).toLowerCase()
    if (channel && channel !== 'whatsapp') throw analyticsError('COMMERCIAL_ANALYTICS_CHANNEL_INVALID', 400)
    return {
        campaignId: optionalUuid(query.campaignId || query.campaign, 'COMMERCIAL_ANALYTICS_CAMPAIGN_INVALID'),
        segmentVersionId: optionalUuid(query.segmentVersionId, 'COMMERCIAL_ANALYTICS_SEGMENT_VERSION_INVALID'),
        attributionWindowId: optionalUuid(query.attributionWindowId, 'COMMERCIAL_ANALYTICS_WINDOW_INVALID'),
        offerId: optionalUuid(query.offerId || query.offer, 'COMMERCIAL_ANALYTICS_OFFER_INVALID'),
        policyVersion: optionalHash(query.policyVersion),
        owner: optionalOwner(query.owner), channel, segment, startAt, endAt,
    }
}

function funnelStages(row = {}, prefix = '') {
    return {
        eligible: number(row[`${prefix}eligible`]), selected: number(row[`${prefix}selected`]),
        action_created: number(row[`${prefix}action_created`]), contacted: number(row[`${prefix}contacted`]),
        // There is deliberately no delivery provider in this tranche.  Keeping
        // this at zero prevents a human click/attempt from being misreported
        // as delivered.
        delivered: 0,
        responded: number(row[`${prefix}responded`]), scheduled: number(row[`${prefix}scheduled`]),
        attended: number(row[`${prefix}attended`]), purchased: number(row[`${prefix}purchased`]), returned: number(row[`${prefix}returned`]),
    }
}

async function selectedAttributionWindow(db, unitIds, id) {
    if (!id) return null
    const result = await db.query(`select id::text,unit_id::text,window_key,revision,state,starts_at,ends_at,response_days,scheduled_days,attended_days,purchased_days,returned_days,updated_at
        from crm_atendimento.commercial_attribution_windows
        where id=$1::uuid and unit_id=any($2::uuid[]) and state='active'`, [id, unitIds])
    if (!result.rows[0]) throw analyticsError('COMMERCIAL_ANALYTICS_WINDOW_NOT_FOUND', 404)
    return result.rows[0]
}

async function commercialFunnel(db, query, actor) {
    const scope = requestedScope(actor, query)
    const filters = normalizeFunnelQuery(query)
    const units = await scopedUnits(db, scope)
    const unitIds = units.map((unit) => unit.id)
    const window = await selectedAttributionWindow(db, unitIds, filters.attributionWindowId)
    if (window && units.length !== 1) {
        throw analyticsError('COMMERCIAL_ANALYTICS_WINDOW_UNIT_SCOPE_REQUIRED', 400)
    }
    const params = [unitIds]
    const campaignWhere = ['campaign.unit_id=any($1::uuid[])']
    const actionWhere = ['action.unit_id=any($1::uuid[])']
    if (filters.campaignId) {
        params.push(filters.campaignId)
        campaignWhere.push(`campaign.id=$${params.length}::uuid`)
    }
    if (filters.segment) {
        params.push(filters.segment)
        campaignWhere.push(`campaign.segment_key=$${params.length}`)
    }
    if (filters.offerId) {
        params.push(filters.offerId)
        campaignWhere.push(`campaign.offer_id=$${params.length}::uuid`)
    }
    if (filters.owner) {
        params.push(filters.owner)
        campaignWhere.push(`campaign.owner=$${params.length}`)
        actionWhere.push(`action.owner=$${params.length}`)
    }
    if (filters.channel) {
        params.push(filters.channel)
        actionWhere.push(`action.contact_channel=$${params.length}`)
    }
    if (filters.startAt) {
        params.push(filters.startAt)
        actionWhere.push(`action.created_at >= $${params.length}::timestamptz`)
    }
    if (filters.endAt) {
        params.push(filters.endAt)
        actionWhere.push(`action.created_at < $${params.length}::timestamptz`)
    }
    const policyParam = params.push(filters.policyVersion) 
    const segmentVersionParam = params.push(filters.segmentVersionId)
    const windowParams = window
        ? [window.response_days, window.scheduled_days, window.attended_days, window.purchased_days, window.returned_days]
        : [null, null, null, null, null]
    const responseDays = params.push(windowParams[0])
    const scheduledDays = params.push(windowParams[1])
    const attendedDays = params.push(windowParams[2])
    const purchasedDays = params.push(windowParams[3])
    const returnedDays = params.push(windowParams[4])
    const result = await db.query(`with cohort as (
            select member.identity_id,member.action_id
            from crm_atendimento.commercial_campaign_members member
            join crm_atendimento.commercial_campaigns campaign on campaign.id=member.campaign_id
            where $${policyParam}::text is null and ${campaignWhere.join(' and ')}
            union
            select assignment.identity_id,null::uuid as action_id
            from crm_atendimento.commercial_experiment_assignments assignment
            join crm_atendimento.commercial_experiments experiment on experiment.id=assignment.experiment_id
            where $${policyParam}::text is not null and experiment.unit_id=any($1::uuid[])
              and experiment.policy_version=$${policyParam}::text and assignment.variant <> 'excluded'
        ), eligible_population as (
            select membership.identity_id from crm_atendimento.commercial_segment_memberships membership
            where membership.unit_id=any($1::uuid[]) and membership.eligible is true
              and $${policyParam}::text is null
              and ($${segmentVersionParam}::uuid is null or membership.segment_version_id=$${segmentVersionParam}::uuid)
            union
            select assignment.identity_id
            from crm_atendimento.commercial_experiment_assignments assignment
            join crm_atendimento.commercial_experiments experiment on experiment.id=assignment.experiment_id
            where $${policyParam}::text is not null and experiment.unit_id=any($1::uuid[])
              and experiment.policy_version=$${policyParam}::text and assignment.variant <> 'excluded'
        ), action_rows as (
            select distinct action.id,action.identity_id,action.status,action.outcome_code,action.created_at,
                coalesce(action.outcome_recorded_at,action.updated_at) as outcome_at
            from crm_atendimento.commercial_actions action
            join cohort on cohort.identity_id=action.identity_id and (cohort.action_id is null or cohort.action_id=action.id)
            where ${actionWhere.join(' and ')}
        )
        select (select count(distinct identity_id)::int from eligible_population) as eligible,
            (select count(distinct identity_id)::int from cohort) as selected,
            (select count(distinct identity_id)::int from action_rows) as action_created,
            (select count(distinct identity_id)::int from action_rows where status in ('contacted','responded','scheduled','won_sale','returned','closed') or outcome_code is not null) as contacted,
            (select count(distinct identity_id)::int from action_rows where status in ('responded','scheduled','won_sale','returned') or outcome_code in ('requested_follow_up','scheduled','attended','sale','clinical_return','opt_out_requested')) as responded,
            (select count(distinct identity_id)::int from action_rows where status='scheduled' or outcome_code='scheduled') as scheduled,
            (select count(distinct identity_id)::int from action_rows where outcome_code='attended') as attended,
            (select count(distinct identity_id)::int from action_rows where status='won_sale' or outcome_code='sale') as purchased,
            (select count(distinct identity_id)::int from action_rows where status='returned' or outcome_code='clinical_return') as returned,
            case when $${responseDays}::int is null then null else (select count(distinct identity_id)::int from action_rows where (status in ('responded','scheduled','won_sale','returned') or outcome_code in ('requested_follow_up','scheduled','attended','sale','clinical_return','opt_out_requested')) and outcome_at <= created_at + make_interval(days=>$${responseDays}::int)) end as attributed_responded,
            case when $${scheduledDays}::int is null then null else (select count(distinct identity_id)::int from action_rows where (status='scheduled' or outcome_code='scheduled') and outcome_at <= created_at + make_interval(days=>$${scheduledDays}::int)) end as attributed_scheduled,
            case when $${attendedDays}::int is null then null else (select count(distinct identity_id)::int from action_rows where outcome_code='attended' and outcome_at <= created_at + make_interval(days=>$${attendedDays}::int)) end as attributed_attended,
            case when $${purchasedDays}::int is null then null else (select count(distinct identity_id)::int from action_rows where (status='won_sale' or outcome_code='sale') and outcome_at <= created_at + make_interval(days=>$${purchasedDays}::int)) end as attributed_purchased,
            case when $${returnedDays}::int is null then null else (select count(distinct identity_id)::int from action_rows where (status='returned' or outcome_code='clinical_return') and outcome_at <= created_at + make_interval(days=>$${returnedDays}::int)) end as attributed_returned`, params)
    const row = result.rows[0] || {}
    const observed = funnelStages(row)
    const attributed = window
        ? {
            ...observed,
            responded: number(row.attributed_responded), scheduled: number(row.attributed_scheduled),
            attended: number(row.attributed_attended), purchased: number(row.attributed_purchased), returned: number(row.attributed_returned),
        }
        : null
    return {
        scope: { units: units.map((unit) => unit.slug), global: scope.global }, filters: {
            campaignId: filters.campaignId, segmentVersionId: filters.segmentVersionId, offerId: filters.offerId,
            policyVersion: filters.policyVersion, channel: filters.channel, startAt: filters.startAt, endAt: filters.endAt,
        },
        observed, attributed, attributionWindow: window ? mapWindow({ ...window, unit_slug: units.length === 1 ? units[0].slug : 'multiple' }) : null,
        incremental: null,
        caveats: [
            'DELIVERY_NOT_RECORDED_WITHOUT_A_PROVIDER',
            ...(window ? [] : ['ATTRIBUTION_WINDOW_REQUIRED_FOR_ATTRIBUTED_CONVERSION']),
            'INCREMENTAL_CONVERSION_IS_REPORTED_BY_EXPERIMENT_METRICS',
        ],
        safety: commercialAnalyticsSafety(),
    }
}

async function experimentMetrics(db, experimentId, actor) {
    const id = assertUuid(experimentId, 'COMMERCIAL_EXPERIMENT_ID_INVALID')
    const experimentResult = await db.query(`select experiment.id::text,unit.id::text as unit_id,unit.slug as unit_slug,
            experiment.name,experiment.state,experiment.revision,experiment.segment_version_id::text,
            experiment.attribution_window_id::text,experiment.control_group_percent,experiment.starts_at,experiment.ends_at,
            experiment.policy_version,experiment.updated_at,window.window_key,window.purchased_days
        from crm_atendimento.commercial_experiments experiment
        join crm_atendimento.units unit on unit.id=experiment.unit_id
        join crm_atendimento.commercial_attribution_windows window on window.id=experiment.attribution_window_id
        where experiment.id=$1::uuid`, [id])
    const experiment = experimentResult.rows[0]
    if (!experiment) throw analyticsError('COMMERCIAL_EXPERIMENT_NOT_FOUND', 404)
    const scope = commercialOperationsUnitScope(actor)
    if (scope !== null && !scope.includes(text(experiment.unit_slug))) throw analyticsError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    const result = await db.query(`with selected as (
            select experiment.id,experiment.unit_id,experiment.starts_at,experiment.ends_at,window.purchased_days
            from crm_atendimento.commercial_experiments experiment
            join crm_atendimento.commercial_attribution_windows window on window.id=experiment.attribution_window_id
            where experiment.id=$1::uuid
        ), assignments as (
            select assignment.identity_id,assignment.variant,selected.unit_id,selected.starts_at,selected.ends_at,selected.purchased_days
            from crm_atendimento.commercial_experiment_assignments assignment
            join selected on selected.id=assignment.experiment_id
            where assignment.variant in ('treatment','control')
        ), outcomes as (
            select assignment.identity_id,
                bool_or(action.status='won_sale' or action.outcome_code='sale') as observed_conversion,
                bool_or((action.status='won_sale' or action.outcome_code='sale')
                    and coalesce(action.outcome_recorded_at,action.updated_at) <= action.created_at + make_interval(days=>assignment.purchased_days)) as attributed_conversion
            from assignments assignment
            left join crm_atendimento.commercial_actions action on action.identity_id=assignment.identity_id and action.unit_id=assignment.unit_id
                and action.created_at >= assignment.starts_at and action.created_at < least(now(),assignment.ends_at)
            group by assignment.identity_id
        ), sales_rows as (
            select distinct assignment.identity_id,sale.id as sale_id,sale.total,sale.occurred_on,
                assignment.starts_at,assignment.ends_at,assignment.purchased_days
            from assignments assignment
            left join crm_atendimento.global_client_identity_members member on member.identity_id=assignment.identity_id
                and member.source_type='caixa_customer' and member.source_id ~ '^[0-9a-fA-F-]{36}$'
            left join crm_caixa.sales sale on sale.customer_id=member.source_id::uuid and sale.unit_id=assignment.unit_id
        ), revenues as (
            select assignment.identity_id,
                coalesce(sum(sales_rows.total) filter(where sales_rows.occurred_on >= assignment.starts_at::date and sales_rows.occurred_on < least(current_date + 1,assignment.ends_at::date + 1)),0)::numeric as observed_revenue,
                coalesce(sum(sales_rows.total) filter(where sales_rows.occurred_on >= assignment.starts_at::date and sales_rows.occurred_on < least(current_date + 1,assignment.ends_at::date + 1,(assignment.starts_at + make_interval(days=>assignment.purchased_days))::date + 1)),0)::numeric as attributed_revenue
            from assignments assignment
            left join sales_rows on sales_rows.identity_id=assignment.identity_id
            group by assignment.identity_id
        )
        select assignment.variant,count(*)::int as population,
            count(*) filter(where outcomes.observed_conversion)::int as observed_conversions,
            count(*) filter(where outcomes.attributed_conversion)::int as attributed_conversions,
            coalesce(sum(revenues.observed_revenue),0)::numeric as observed_revenue,
            coalesce(sum(revenues.attributed_revenue),0)::numeric as attributed_revenue
        from assignments assignment
        left join outcomes on outcomes.identity_id=assignment.identity_id
        left join revenues on revenues.identity_id=assignment.identity_id
        group by assignment.variant`, [id])
    const rows = result.rows || []
    const observed = calculateExperimentLift(rows.map((row) => ({
        variant: row.variant, population: row.population, conversions: row.observed_conversions, revenue: row.observed_revenue,
    })))
    const attributed = calculateExperimentLift(rows.map((row) => ({
        variant: row.variant, population: row.population, conversions: row.attributed_conversions, revenue: row.attributed_revenue,
    })))
    return {
        experiment: mapExperiment({ ...experiment, assignment_count: 0, treatment_assignments: 0, control_assignments: 0, excluded_assignments: 0 }),
        attribution: { windowId: text(experiment.attribution_window_id), key: text(experiment.window_key), purchasedDays: number(experiment.purchased_days) },
        observed, attributed,
        incremental: {
            conversionLift: attributed.observedLift,
            incrementalConversions: attributed.incrementalConversions,
            incrementalRevenue: attributed.incrementalRevenue,
            confidenceInterval95: attributed.confidenceInterval95,
            adequateSample: attributed.adequateSample,
            warning: attributed.warning,
        },
        safety: commercialAnalyticsSafety(),
    }
}

export function createCommercialAnalyticsStore({ pool, databaseUrl } = {}) {
    const pgPool = pool || createPgPool(databaseUrl || process.env.DATABASE_URL)
    const assertReadAccess = async (actor) => {
        requirePool(pgPool)
        assertAnalyticsManager(actor)
        await assertReady(pgPool)
    }
    const assertMutationAccess = (actor) => {
        requirePool(pgPool)
        assertAnalyticsManager(actor)
    }
    return {
        async readiness(actor) {
            requirePool(pgPool)
            assertAnalyticsManager(actor)
            return commercialAnalyticsReadiness(pgPool)
        },
        async quality(query, actor) {
            await assertReadAccess(actor)
            return qualityAnalytics(pgPool, query, actor)
        },
        async funnel(query, actor) {
            await assertReadAccess(actor)
            return commercialFunnel(pgPool, query, actor)
        },
        async segments(query, actor) {
            await assertReadAccess(actor)
            return listSegments(pgPool, query, actor)
        },
        async attributionWindows(query, actor) {
            await assertReadAccess(actor)
            return listAttributionWindows(pgPool, query, actor)
        },
        async experiments(query, actor) {
            await assertReadAccess(actor)
            return listExperiments(pgPool, query, actor)
        },
        async experimentMetrics(experimentId, actor) {
            await assertReadAccess(actor)
            return experimentMetrics(pgPool, experimentId, actor)
        },
        async createSegment(payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => createSegmentDefinition(client, payload, actor))
        },
        async createSegmentVersion(definitionId, payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => createSegmentVersion(client, definitionId, payload, actor))
        },
        async snapshotSegment(versionId, payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => materializeSegmentSnapshot(client, versionId, payload, actor))
        },
        async upsertAttributionWindow(payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => upsertAttributionWindow(client, payload, actor))
        },
        async createExperiment(payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => createExperiment(client, payload, actor))
        },
        async updateExperimentState(experimentId, payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => updateExperimentState(client, experimentId, payload, actor))
        },
    }
}

export const __testables = {
    actorPrincipal,
    candidateMatchesCriteria,
    commercialFunnel,
    createExperiment,
    createSegmentDefinition,
    experimentMetrics,
    lockExperimentIdentity,
    mapReadiness,
    normalizeFunnelQuery,
    requestedScope,
    runAnalyticsMutation,
}
