import { createPgPool, withPgTransaction } from '../harmonia/store/pg.js'
import { COMMERCIAL_DATA_QUALITY_MIGRATION_ID } from './commercialDataQualityMigration.js'
import { actorSubject } from './actorSubject.js'

export const COMMERCIAL_DATA_QUALITY_SOURCE_STALE_THRESHOLD_HOURS = 48
export const COMMERCIAL_DATA_QUALITY_REFRESH_LOCK_KEY = 'commercial-data-quality:refresh'
export const COMMERCIAL_DATA_QUALITY_SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low'])
export const COMMERCIAL_DATA_QUALITY_STATUSES = Object.freeze(['open', 'acknowledged', 'in_progress', 'resolved', 'suppressed'])

const severitySet = new Set(COMMERCIAL_DATA_QUALITY_SEVERITIES)
const statusSet = new Set(COMMERCIAL_DATA_QUALITY_STATUSES)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const COMMERCIAL_DATA_QUALITY_DEFINITIONS = Object.freeze([
    { key: 'identity.attendance_membership_gap', severity: 'critical', slaHours: 24 },
    { key: 'sales.unclassified_items', severity: 'high', slaHours: 48 },
    { key: 'attendance.future_dates', severity: 'medium', slaHours: 48 },
    { key: 'identity_review.name_merge_pending', severity: 'medium', slaHours: 168 },
    { key: 'identity_review.attendance_caixa_pending', severity: 'medium', slaHours: 168 },
    { key: 'identity_review.app_attendance_pending', severity: 'medium', slaHours: 168 },
    { key: 'identity_review.app_caixa_pending', severity: 'medium', slaHours: 168 },
    { key: 'identity_review.lead_app_pending', severity: 'medium', slaHours: 168 },
    { key: 'identity_review.lead_caixa_pending', severity: 'medium', slaHours: 168 },
    { key: 'commercial.permission_coverage_missing', severity: 'high', slaHours: 72 },
    { key: 'commercial.contact_controls_unready', severity: 'high', slaHours: 24 },
    // This is a coverage discrepancy, not a deletion instruction. It is
    // active only after the source run explicitly proves a complete snapshot.
    { key: 'source.app_registration_snapshot_residual', severity: 'high', slaHours: 24 },
    { key: 'source.app_registration_snapshot_unverified', severity: 'medium', slaHours: 24 },
    // The freshness row is persisted even while healthy so operators retain its
    // aggregate age metrics. It is reopened automatically only when stale.
    { key: 'source.local_mirror_stale', severity: 'high', slaHours: 24, persistWhenHealthy: true },
])

const definitionByKey = new Map(COMMERCIAL_DATA_QUALITY_DEFINITIONS.map((definition) => [definition.key, definition]))

// These queries deliberately return counts and age values only. They do not
// select a customer name, phone, email, raw source evidence, source path or ID.
// The runtime role may intentionally lack SELECT on contact-governance tables.
// Keep the row-level observation in a replaceable fragment so the aggregate
// refresh can fail closed without attempting an unauthorized read.
const CONTACT_PERMISSION_OBSERVATION_SQL = `(case when has_table_privilege(current_user, 'crm_atendimento.commercial_contact_permissions', 'SELECT') then
            (select count(*)::int
               from crm_atendimento.global_client_identities identity
              where exists (select 1 from crm_atendimento.global_client_identity_members member where member.identity_id = identity.id)
                and not exists (
                    select 1 from crm_atendimento.commercial_contact_permissions permission
                     where permission.identity_id = identity.id and permission.channel = 'whatsapp'
                ))
            else 0 end) as identities_without_permission`

const CONTACT_PERMISSION_OBSERVATION_UNAVAILABLE_SQL = '0::int as identities_without_permission'
const CONTACT_PERMISSION_PRIVILEGE_QUERY = `select has_table_privilege(current_user, 'crm_atendimento.commercial_contact_permissions', 'SELECT') as can_read_contact_permissions`

export const COMMERCIAL_DATA_QUALITY_SOURCE_QUERIES = Object.freeze({
    core: `with latest_app_registration_run as (
        select id from crm_atendimento.app_registration_import_runs
        order by created_at desc limit 1
    )
    select
        (select count(distinct canonical_client.id)::int
           from crm_atendimento.canonical_clients canonical_client
          where canonical_client.merged_into_id is null
            and exists (
                select 1
                  from crm_atendimento.attendance_client_links attendance_link
                  join crm_atendimento.attendances attendance on attendance.id = attendance_link.attendance_id
                 where attendance_link.client_id = canonical_client.id
                   and attendance.deleted_at is null
            )
            and not exists (
                select 1 from crm_atendimento.global_client_identity_members member
                 where member.source_type = 'attendance_client' and member.source_id = canonical_client.id::text
            )) as attendance_membership_gap,
        (select count(*)::int from crm_caixa.sale_items where coalesce(mapping_status, 'pending') <> 'mapped') as unclassified_sale_items,
        (select count(*)::int from crm_atendimento.attendances where deleted_at is null and service_date > current_date) as future_attendances,
        ${CONTACT_PERMISSION_OBSERVATION_SQL},
        (select case when
            to_regclass('crm_atendimento.commercial_contact_permissions') is null or
            to_regclass('crm_atendimento.commercial_contact_permission_events') is null or
            to_regclass('crm_atendimento.commercial_actions') is null or
            to_regclass('crm_atendimento.commercial_action_events') is null or
            not has_table_privilege(current_user, 'crm_atendimento.commercial_contact_permissions', 'SELECT') or
            not has_table_privilege(current_user, 'crm_atendimento.commercial_contact_permission_events', 'SELECT') or
            not has_table_privilege(current_user, 'crm_atendimento.commercial_actions', 'SELECT') or
            not has_table_privilege(current_user, 'crm_atendimento.commercial_action_events', 'SELECT') or
            not has_table_privilege(current_user, 'crm_atendimento.commercial_policy_config', 'SELECT') or
            not exists(select 1 from information_schema.columns
                where table_schema = 'crm_atendimento' and table_name = 'commercial_contact_permission_events'
                  and column_name = 'trace_id') or
            not exists(select 1 from information_schema.columns
                where table_schema = 'crm_atendimento' and table_name = 'commercial_actions' and column_name = 'contact_channel') or
            not exists(select 1 from information_schema.columns
                where table_schema = 'crm_atendimento' and table_name = 'commercial_actions' and column_name = 'contacted_at') or
            not exists(select 1 from information_schema.columns
                where table_schema = 'crm_atendimento' and table_name = 'commercial_policy_config' and column_name = 'commercial_contact_writes_enabled') or
            not exists(select 1 from information_schema.columns
                where table_schema = 'crm_atendimento' and table_name = 'commercial_policy_config' and column_name = 'commercial_contact_canary_identity_ids') or
            not exists(select 1 from pg_trigger
                where tgrelid = to_regclass('crm_atendimento.commercial_contact_permission_events')
                  and tgname = 'commercial_contact_permission_events_immutable' and tgenabled = 'O'
                  and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_ledger_mutation()')
                  and (tgtype & 2) <> 0 and (tgtype & 8) <> 0 and (tgtype & 16) <> 0) or
            not exists(select 1 from pg_trigger
                where tgrelid = to_regclass('crm_atendimento.commercial_contact_permission_events')
                  and tgname = 'commercial_contact_permission_events_no_truncate' and tgenabled = 'O'
                  and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_ledger_mutation()')
                  and (tgtype & 2) <> 0 and (tgtype & 32) <> 0) or
            not exists(select 1 from pg_trigger
                where tgrelid = to_regclass('crm_atendimento.commercial_action_events')
                  and tgname = 'commercial_action_events_immutable' and tgenabled = 'O'
                  and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_ledger_mutation()')
                  and (tgtype & 2) <> 0 and (tgtype & 8) <> 0 and (tgtype & 16) <> 0) or
            not exists(select 1 from pg_trigger
                where tgrelid = to_regclass('crm_atendimento.commercial_action_events')
                  and tgname = 'commercial_action_events_no_truncate' and tgenabled = 'O'
                  and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_ledger_mutation()')
                  and (tgtype & 2) <> 0 and (tgtype & 32) <> 0)
          then 1 else 0 end) as contact_controls_unready,
        (select count(*)::int
           from crm_atendimento.app_client_registrations registration
          where exists (select 1 from latest_app_registration_run)
            and registration.last_run_id is distinct from (select id from latest_app_registration_run)) as app_registration_snapshot_residual,
        (select count(*)::int
           from crm_atendimento.app_client_registrations registration
          where registration.last_run_id = (select id from latest_app_registration_run)) as app_registration_current_snapshot_count,
        exists (select 1 from latest_app_registration_run) as app_registration_snapshot_available,
        coalesce((select (summary #>> '{sourceCoverage,snapshotComplete}')::boolean
                    from crm_atendimento.app_registration_import_runs
                   where id = (select id from latest_app_registration_run)), false) as app_registration_snapshot_verified`,
    review: `select finding_key, observed_count from (
        select 'identity_review.name_merge_pending'::text as finding_key, count(*)::int as observed_count
          from crm_atendimento.client_merge_suggestions where status = 'pending'
        union all
        select 'identity_review.attendance_caixa_pending', count(*)::int
          from crm_atendimento.client_caixa_links where status in ('suggested', 'ambiguous')
        union all
        select 'identity_review.app_attendance_pending', count(*)::int
          from crm_atendimento.app_registration_attendance_links where status in ('suggested', 'ambiguous')
        union all
        select 'identity_review.app_caixa_pending', count(*)::int
          from crm_atendimento.app_registration_caixa_links where status in ('suggested', 'ambiguous')
        union all
        select 'identity_review.lead_app_pending', count(*)::int
          from crm_atendimento.supplemental_lead_profile_app_links where status in ('suggested', 'ambiguous')
        union all
        select 'identity_review.lead_caixa_pending', count(*)::int
          from crm_atendimento.supplemental_lead_profile_caixa_links where status in ('suggested', 'ambiguous')
    ) observation order by finding_key`,
    freshness: `with mirror as (
        select synced_at from crm_atendimento.local_mirror_state where singleton = true
    ), latest_import as (
        select max(created_at) as created_at from crm_atendimento.import_batches
    )
    select
        case when (select synced_at from mirror) is null then null
             else greatest(0, floor(extract(epoch from now() - (select synced_at from mirror)) / 3600))::int end as mirror_synced_age_hours,
        case when (select created_at from latest_import) is null then null
             else greatest(0, floor(extract(epoch from now() - (select created_at from latest_import)) / 3600))::int end as latest_import_age_hours`,
})

const COMMERCIAL_DATA_QUALITY_SOURCE_QUERY_WITHOUT_CONTACT_PERMISSION =
    COMMERCIAL_DATA_QUALITY_SOURCE_QUERIES.core.replace(
        CONTACT_PERMISSION_OBSERVATION_SQL,
        CONTACT_PERMISSION_OBSERVATION_UNAVAILABLE_SQL,
    )

function qualityError(code, statusCode = 409) {
    const error = new Error(code)
    error.code = code
    error.statusCode = statusCode
    return error
}

function requirePool(pool) {
    if (!pool) throw qualityError('DATABASE_URL_not_configured', 503)
}

function actorIdentity(actor) {
    const identity = actorSubject(actor)
    if (!identity) throw qualityError('ACTOR_IDENTITY_REQUIRED', 401)
    return identity
}

function assertCommercialQualityManager(actor) {
    const role = String(actor?.role || '').trim().toUpperCase()
    // A global ADMIN is explicitly exempt. A GESTOR who carries an allowed-unit
    // scope cannot safely receive global aggregate findings: a count from every
    // unit could disclose information outside that actor's scope. Older callers
    // without the attribute remain compatible until their scope is declared.
    if (role === 'ADMIN' || actor?.isGlobalAdmin === true) return
    if (role !== 'GESTOR') throw qualityError('FORBIDDEN', 403)
    const scopeWasDeclared = actor?.allowedUnitsDeclared === true || Array.isArray(actor?.allowedUnits) ||
        (actor?.allowedUnitsDeclared === undefined && Object.prototype.hasOwnProperty.call(actor || {}, 'allowedUnits'))
    if (scopeWasDeclared) throw qualityError('COMMERCIAL_DATA_QUALITY_UNIT_SCOPE_UNSUPPORTED', 403)
}

function count(value) {
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function boundedNonNegativeInteger(value) {
    if (value === null || value === undefined || value === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null
}

function sanitizeMetrics(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const metrics = {}
    for (const key of ['thresholdHours', 'mirrorSyncedAgeHours', 'latestImportAgeHours', 'currentSnapshotCount', 'residualRegistrationCount']) {
        const numeric = boundedNonNegativeInteger(source[key])
        if (numeric !== null) metrics[key] = numeric
    }
    for (const key of ['controlsReady', 'snapshotVerified']) {
        if (typeof source[key] === 'boolean') metrics[key] = source[key]
    }
    return metrics
}

function normalizeLimit(value, fallback = 100, maximum = 250) {
    const numeric = Number(value)
    if (!Number.isInteger(numeric) || numeric < 1) return fallback
    return Math.min(numeric, maximum)
}

function normalizeOffset(value) {
    const numeric = Number(value)
    return Number.isInteger(numeric) && numeric > 0 ? numeric : 0
}

function normalizeFilter(value, allowed, errorCode) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (!allowed.has(raw)) throw qualityError(errorCode, 400)
    return raw
}

function normalizeOwner(value) {
    const raw = String(value ?? '').trim()
    if (raw.length > 160 || /[\u0000-\u001f\u007f]/.test(raw)) throw qualityError('INVALID_COMMERCIAL_DATA_QUALITY_OWNER', 400)
    return raw
}

function mapFinding(row) {
    return {
        id: row.id,
        findingKey: row.finding_key,
        severity: row.severity,
        status: row.status,
        owner: row.owner || '',
        observedCount: count(row.observed_count),
        metrics: sanitizeMetrics(row.metrics),
        slaDueAt: row.sla_due_at || null,
        firstDetectedAt: row.first_detected_at || null,
        lastObservedAt: row.last_observed_at || null,
        lastEvaluatedAt: row.last_evaluated_at || null,
        acknowledgedAt: row.acknowledged_at || null,
        resolvedAt: row.resolved_at || null,
        revision: count(row.revision),
        updatedAt: row.updated_at || null,
    }
}

function mapFindingEvent(row) {
    return {
        id: row.id,
        eventOrder: count(row.event_order),
        eventType: row.event_type,
        previousStatus: row.previous_status || null,
        status: row.status,
        previousOwner: row.previous_owner || '',
        owner: row.owner || '',
        observedCount: count(row.observed_count),
        actor: row.actor || '',
        createdAt: row.created_at || null,
    }
}

function definition(key) {
    const item = definitionByKey.get(key)
    if (!item) throw qualityError('COMMERCIAL_DATA_QUALITY_DEFINITION_UNKNOWN')
    return item
}

function observation(key, observedCount, metrics = {}) {
    const item = definition(key)
    return {
        ...item,
        observedCount: count(observedCount),
        metrics: sanitizeMetrics(metrics),
    }
}

export function buildCommercialDataQualityObservations({ core = {}, reviewRows = [], freshness = {} } = {}) {
    const reviewCounts = new Map((reviewRows || []).map((row) => [String(row?.finding_key || ''), count(row?.observed_count)]))
    const mirrorSyncedAgeHours = boundedNonNegativeInteger(freshness.mirror_synced_age_hours ?? freshness.mirrorSyncedAgeHours)
    const latestImportAgeHours = boundedNonNegativeInteger(freshness.latest_import_age_hours ?? freshness.latestImportAgeHours)
    const freshnessMetrics = {
        thresholdHours: COMMERCIAL_DATA_QUALITY_SOURCE_STALE_THRESHOLD_HOURS,
        mirrorSyncedAgeHours,
        latestImportAgeHours,
    }
    // A live Google Sheets import is a valid source checkpoint even when the
    // local mirror has never been materialized.  A recent local mirror is also
    // a valid fallback when no live import has been recorded.  Treat the source
    // as healthy when either checkpoint is recent, and stale only when both
    // checkpoints are absent or over the SLA.
    const mirrorFresh = mirrorSyncedAgeHours !== null &&
        mirrorSyncedAgeHours <= COMMERCIAL_DATA_QUALITY_SOURCE_STALE_THRESHOLD_HOURS
    const importFresh = latestImportAgeHours !== null &&
        latestImportAgeHours <= COMMERCIAL_DATA_QUALITY_SOURCE_STALE_THRESHOLD_HOURS
    const mirrorStale = !mirrorFresh && !importFresh
    const appRegistrationSnapshotAvailable = core.app_registration_snapshot_available === true || core.appRegistrationSnapshotAvailable === true
    const appRegistrationSnapshotVerified = core.app_registration_snapshot_verified === true || core.appRegistrationSnapshotVerified === true
    const appRegistrationSnapshotResidual = appRegistrationSnapshotVerified
        ? count(core.app_registration_snapshot_residual ?? core.appRegistrationSnapshotResidual)
        : 0
    const appRegistrationCurrentSnapshotCount = boundedNonNegativeInteger(
        core.app_registration_current_snapshot_count ?? core.appRegistrationCurrentSnapshotCount,
    )
    return [
        observation('identity.attendance_membership_gap', core.attendance_membership_gap ?? core.attendanceMembershipGap),
        observation('sales.unclassified_items', core.unclassified_sale_items ?? core.unclassifiedSaleItems),
        observation('attendance.future_dates', core.future_attendances ?? core.futureAttendances),
        observation('identity_review.name_merge_pending', reviewCounts.get('identity_review.name_merge_pending')),
        observation('identity_review.attendance_caixa_pending', reviewCounts.get('identity_review.attendance_caixa_pending')),
        observation('identity_review.app_attendance_pending', reviewCounts.get('identity_review.app_attendance_pending')),
        observation('identity_review.app_caixa_pending', reviewCounts.get('identity_review.app_caixa_pending')),
        observation('identity_review.lead_app_pending', reviewCounts.get('identity_review.lead_app_pending')),
        observation('identity_review.lead_caixa_pending', reviewCounts.get('identity_review.lead_caixa_pending')),
        observation('commercial.permission_coverage_missing', core.identities_without_permission ?? core.identitiesWithoutPermission),
        observation('commercial.contact_controls_unready', core.contact_controls_unready ?? core.contactControlsUnready, {
            controlsReady: count(core.contact_controls_unready ?? core.contactControlsUnready) === 0,
        }),
        observation('source.app_registration_snapshot_residual', appRegistrationSnapshotResidual, {
            currentSnapshotCount: appRegistrationCurrentSnapshotCount,
            residualRegistrationCount: appRegistrationSnapshotResidual,
            snapshotVerified: appRegistrationSnapshotVerified,
        }),
        observation('source.app_registration_snapshot_unverified', appRegistrationSnapshotAvailable && !appRegistrationSnapshotVerified ? 1 : 0, {
            currentSnapshotCount: appRegistrationCurrentSnapshotCount,
            snapshotVerified: appRegistrationSnapshotVerified,
        }),
        observation('source.local_mirror_stale', mirrorStale ? 1 : 0, freshnessMetrics),
    ]
}

async function assertQueueReady(pool) {
    const availability = await pool.query(`select
        to_regclass('crm_atendimento.commercial_data_quality_findings') as findings,
        to_regclass('crm_atendimento.commercial_data_quality_finding_events') as events,
        exists(select 1 from pg_trigger
            where tgrelid = to_regclass('crm_atendimento.commercial_data_quality_finding_events')
              and tgname = 'commercial_data_quality_finding_events_immutable' and tgenabled = 'O'
              and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_data_quality_event_mutation()')
              and (tgtype & 2) <> 0 and (tgtype & 8) <> 0 and (tgtype & 16) <> 0) as events_immutable,
        exists(select 1 from pg_trigger
            where tgrelid = to_regclass('crm_atendimento.commercial_data_quality_finding_events')
              and tgname = 'commercial_data_quality_finding_events_no_truncate' and tgenabled = 'O'
              and tgfoid = to_regprocedure('crm_atendimento.prevent_commercial_data_quality_event_mutation()')
              and (tgtype & 2) <> 0 and (tgtype & 32) <> 0) as events_no_truncate`)
    const row = availability.rows[0] || {}
    if (!row.findings || !row.events || !row.events_immutable || !row.events_no_truncate) {
        throw qualityError('COMMERCIAL_DATA_QUALITY_QUEUE_NOT_READY')
    }
    const migration = await pool.query(`select id from crm_atendimento.schema_migrations
        where id = $1 and rolled_back_at is null`, [COMMERCIAL_DATA_QUALITY_MIGRATION_ID])
    if (!migration.rows[0]?.id) throw qualityError('COMMERCIAL_DATA_QUALITY_QUEUE_NOT_READY')
}

async function querySourceObservations(client) {
    // A transaction leases one PostgreSQL client.  Querying it concurrently
    // produces a pg deprecation warning today and may become a hard failure in
    // the next driver major; the aggregate snapshot is intentionally read in a
    // single serial flow instead.
    const privilege = await client.query(CONTACT_PERMISSION_PRIVILEGE_QUERY)
    const canReadContactPermissions = privilege.rows[0]?.can_read_contact_permissions === true
    const coreQuery = canReadContactPermissions
        ? COMMERCIAL_DATA_QUALITY_SOURCE_QUERIES.core
        : COMMERCIAL_DATA_QUALITY_SOURCE_QUERY_WITHOUT_CONTACT_PERMISSION
    const core = await client.query(coreQuery)
    const review = await client.query(COMMERCIAL_DATA_QUALITY_SOURCE_QUERIES.review)
    const freshness = await client.query(COMMERCIAL_DATA_QUALITY_SOURCE_QUERIES.freshness)
    return buildCommercialDataQualityObservations({
        core: core.rows[0] || {},
        reviewRows: review.rows || [],
        freshness: freshness.rows[0] || {},
    })
}

// A session lock is deliberately acquired before beginning the repeatable-read
// transaction.  That makes a waiting refresh take its source snapshot only
// after the earlier materialization has completed, instead of later writing a
// stale pre-lock snapshot over a newer one.
async function withCommercialDataQualityRefreshTransaction(pool, fn) {
    const client = await pool.connect()
    let locked = false
    let inTransaction = false
    try {
        await client.query(`select pg_advisory_lock(hashtext($1))`, [COMMERCIAL_DATA_QUALITY_REFRESH_LOCK_KEY])
        locked = true
        await client.query('begin isolation level repeatable read')
        inTransaction = true
        const result = await fn(client)
        await client.query('commit')
        inTransaction = false
        return result
    } catch (error) {
        if (inTransaction) {
            try { await client.query('rollback') } catch { /* preserve the original error */ }
        }
        throw error
    } finally {
        if (locked) {
            try { await client.query(`select pg_advisory_unlock(hashtext($1))`, [COMMERCIAL_DATA_QUALITY_REFRESH_LOCK_KEY]) } catch { /* connection cleanup releases the lock too */ }
        }
        client.release()
    }
}

function commercialObservationTransition({ previousStatus, previousCount, observedCount }) {
    const priorCount = count(previousCount)
    const nextCount = count(observedCount)
    // A suppression only defers a cleared observation; it cannot hide a
    // condition that is still present in a later source snapshot.  Reopening
    // it also records the status transition in the immutable event ledger.
    const shouldReopen = nextCount > 0 && (previousStatus === 'resolved' || previousStatus === 'suppressed')
    // A finding that stayed open while its count cleared still needs a fresh
    // SLA if the underlying condition returns.  Otherwise it can immediately
    // appear overdue on recurrence.
    const shouldStartObservationWindow = nextCount > 0 && (priorCount === 0 || shouldReopen)
    // A positive observation is the actionable state; once that observation
    // clears, the queue should converge to resolved without waiting for an
    // operator to close a stale zero-count row.  This also repairs legacy
    // actionable rows that were already persisted with observed_count = 0.
    // Suppressed and already resolved findings retain their historical state.
    const shouldResolve = nextCount === 0
        && ['open', 'acknowledged', 'in_progress'].includes(previousStatus)
    const nextStatus = shouldReopen ? 'open' : shouldResolve ? 'resolved' : previousStatus
    const eventType = shouldReopen
        ? 'reopened'
        : shouldResolve
            ? 'cleared'
        : priorCount === 0 && nextCount > 0
            ? 'detected'
            : priorCount > 0 && nextCount === 0
                ? 'cleared'
                : 'observed'
    return {
        priorCount,
        shouldReopen,
        shouldResolve,
        shouldStartObservationWindow,
        nextStatus,
        shouldRecord: shouldReopen || shouldResolve || priorCount !== nextCount,
        eventType,
    }
}

async function recordEvent(client, {
    findingId,
    eventType,
    previousStatus = null,
    status,
    previousOwner = null,
    owner = null,
    observedCount,
    actor,
}) {
    await client.query(`insert into crm_atendimento.commercial_data_quality_finding_events(
        finding_id, event_type, previous_status, status, previous_owner, owner, observed_count, actor)
        values ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        findingId, eventType, previousStatus, status, previousOwner, owner, count(observedCount), actor,
    ])
}

async function materializeObservation(client, item, actor) {
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-data-quality:${item.key}`])
    const existingResult = await client.query(`select * from crm_atendimento.commercial_data_quality_findings
        where finding_key = $1 for update`, [item.key])
    const existing = existingResult.rows[0] || null
    const metrics = JSON.stringify(sanitizeMetrics(item.metrics))
    if (!existing) {
        if (!item.observedCount && !item.persistWhenHealthy) return null
        const initialStatus = item.observedCount > 0 ? 'open' : 'resolved'
        const created = await client.query(`insert into crm_atendimento.commercial_data_quality_findings(
            finding_key, severity, status, observed_count, metrics, sla_due_at, first_detected_at,
            last_observed_at, last_evaluated_at, resolved_at, created_by, updated_by)
            values ($1,$2,$3,$4,$5::jsonb,
                case when $4 > 0 then now() + ($6::int * interval '1 hour') else null end,
                case when $4 > 0 then now() else null end,
                case when $4 > 0 then now() else null end,
                now(), case when $4 = 0 then now() else null end, $7, $7)
            returning *`, [item.key, item.severity, initialStatus, item.observedCount, metrics, item.slaHours, actor])
        const row = created.rows[0]
        await recordEvent(client, {
            findingId: row.id,
            eventType: item.observedCount > 0 ? 'detected' : 'observed',
            status: row.status,
            owner: row.owner,
            observedCount: item.observedCount,
            actor,
        })
        return mapFinding(row)
    }

    const transition = commercialObservationTransition({
        previousStatus: existing.status,
        previousCount: existing.observed_count,
        observedCount: item.observedCount,
    })
    const updated = await client.query(`update crm_atendimento.commercial_data_quality_findings
        set severity = $2,
            status = $3,
            observed_count = $4,
            metrics = $5::jsonb,
            sla_due_at = case when $6 then now() + ($7::int * interval '1 hour') else sla_due_at end,
            first_detected_at = case when $6 then now() when $4 > 0 then coalesce(first_detected_at, now()) else first_detected_at end,
            last_observed_at = case when $4 > 0 then now() else last_observed_at end,
            last_evaluated_at = now(),
            acknowledged_at = case when $6 then null else acknowledged_at end,
            resolved_at = case when $10 then now() when $6 then null else resolved_at end,
            -- Background observation must not make an operator's optimistic
            -- status/owner patch stale on every refresh.  Only an automatic
            -- state transition (clear or reopen) advances it.
            revision = case when $9 or $10 then revision + 1 else revision end,
            updated_by = $8,
            updated_at = now()
        where id = $1
        returning *`, [
            existing.id,
            item.severity,
            transition.nextStatus,
            item.observedCount,
            metrics,
            transition.shouldStartObservationWindow,
            item.slaHours,
            actor,
            transition.shouldReopen,
            transition.shouldResolve,
        ])
    const row = updated.rows[0]
    if (transition.shouldRecord) {
        await recordEvent(client, {
            findingId: row.id,
            eventType: transition.eventType,
            previousStatus: existing.status,
            status: row.status,
            previousOwner: existing.owner,
            owner: row.owner,
            observedCount: item.observedCount,
            actor,
        })
    }
    return mapFinding(row)
}

async function queryMetrics(pool) {
    const scalar = await pool.query(`select
        count(*)::int as findings,
        count(*) filter (where observed_count > 0)::int as current_findings,
        count(*) filter (where observed_count > 0 and status in ('open','acknowledged','in_progress') and sla_due_at < now())::int as overdue,
        count(*) filter (where observed_count > 0 and status in ('open','acknowledged','in_progress') and nullif(owner, '') is null)::int as unassigned
        from crm_atendimento.commercial_data_quality_findings`)
    const [severity, status] = await Promise.all([
        pool.query(`select severity as key, count(*)::int as count
            from crm_atendimento.commercial_data_quality_findings group by severity`),
        pool.query(`select status as key, count(*)::int as count
            from crm_atendimento.commercial_data_quality_findings group by status`),
    ])
    const row = scalar.rows[0] || {}
    return {
        findings: count(row.findings),
        currentFindings: count(row.current_findings),
        overdue: count(row.overdue),
        unassigned: count(row.unassigned),
        bySeverity: Object.fromEntries((severity.rows || []).map((item) => [item.key, count(item.count)])),
        byStatus: Object.fromEntries((status.rows || []).map((item) => [item.key, count(item.count)])),
    }
}

function normalizeFindingPatch(payload = {}) {
    const hasOwner = Object.prototype.hasOwnProperty.call(payload, 'owner')
    const hasStatus = Object.prototype.hasOwnProperty.call(payload, 'status')
    const expectedRevision = Number(payload.expectedRevision)
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw qualityError('COMMERCIAL_DATA_QUALITY_REVISION_REQUIRED', 400)
    }
    if (!hasOwner && !hasStatus) throw qualityError('COMMERCIAL_DATA_QUALITY_CHANGE_REQUIRED', 400)
    const status = hasStatus ? String(payload.status || '').trim() : null
    if (hasStatus && !statusSet.has(status)) throw qualityError('INVALID_COMMERCIAL_DATA_QUALITY_STATUS', 400)
    return {
        expectedRevision,
        hasOwner,
        owner: hasOwner ? normalizeOwner(payload.owner) : null,
        hasStatus,
        status,
    }
}

function assertFindingId(value) {
    const id = String(value || '').trim()
    if (!UUID_RE.test(id)) throw qualityError('INVALID_COMMERCIAL_DATA_QUALITY_FINDING', 400)
    return id
}

export function createCommercialDataQualityStore(options = {}) {
    const pgPool = options.pool || createPgPool(options.databaseUrl || process.env.DATABASE_URL)

    return {
        async refresh(actor) {
            requirePool(pgPool)
            assertCommercialQualityManager(actor)
            const actorId = actorIdentity(actor)
            await assertQueueReady(pgPool)
            return withCommercialDataQualityRefreshTransaction(pgPool, async (client) => {
                const observations = await querySourceObservations(client)
                const findings = []
                for (const item of observations) {
                    const materialized = await materializeObservation(client, item, actorId)
                    if (materialized) findings.push(materialized)
                }
                const sourceFreshness = findings.find((item) => item.findingKey === 'source.local_mirror_stale')?.metrics || {}
                return {
                    refreshed: findings.length,
                    findings,
                    sourceFreshness,
                }
            })
        },

        async list(query = {}, actor) {
            requirePool(pgPool)
            assertCommercialQualityManager(actor)
            await assertQueueReady(pgPool)
            const status = normalizeFilter(query.status, statusSet, 'INVALID_COMMERCIAL_DATA_QUALITY_STATUS')
            const severity = normalizeFilter(query.severity, severitySet, 'INVALID_COMMERCIAL_DATA_QUALITY_SEVERITY')
            const limit = normalizeLimit(query.limit)
            const offset = normalizeOffset(query.offset)
            const where = []
            const params = []
            if (status) {
                params.push(status)
                where.push(`status = $${params.length}`)
            }
            if (severity) {
                params.push(severity)
                where.push(`severity = $${params.length}`)
            }
            params.push(limit, offset)
            const rows = await pgPool.query(`select id, finding_key, severity, status, owner, observed_count, metrics,
                sla_due_at, first_detected_at, last_observed_at, last_evaluated_at, acknowledged_at, resolved_at,
                revision, updated_at
                from crm_atendimento.commercial_data_quality_findings
                ${where.length ? `where ${where.join(' and ')}` : ''}
                order by (observed_count > 0) desc,
                    case severity when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end desc,
                    sla_due_at nulls last, updated_at desc
                limit $${params.length - 1} offset $${params.length}`, params)
            const findings = rows.rows.map(mapFinding)
            const metrics = await queryMetrics(pgPool)
            const [total, freshness] = await Promise.all([
                pgPool.query(`select count(*)::int as count
                    from crm_atendimento.commercial_data_quality_findings ${where.length ? `where ${where.join(' and ')}` : ''}`, params.slice(0, -2)),
                pgPool.query(`select metrics from crm_atendimento.commercial_data_quality_findings
                    where finding_key = 'source.local_mirror_stale' limit 1`),
            ])
            return {
                total: count(total.rows[0]?.count),
                limit,
                offset,
                metrics,
                sourceFreshness: sanitizeMetrics(freshness.rows[0]?.metrics),
                findings,
            }
        },

        async update(id, payload, actor) {
            requirePool(pgPool)
            assertCommercialQualityManager(actor)
            const actorId = actorIdentity(actor)
            const findingId = assertFindingId(id)
            const patch = normalizeFindingPatch(payload)
            await assertQueueReady(pgPool)
            return withPgTransaction(pgPool, async (client) => {
                const currentResult = await client.query(`select * from crm_atendimento.commercial_data_quality_findings
                    where id = $1 for update`, [findingId])
                const current = currentResult.rows[0]
                if (!current) throw qualityError('COMMERCIAL_DATA_QUALITY_FINDING_NOT_FOUND', 404)
                if (count(current.revision) !== patch.expectedRevision) throw qualityError('COMMERCIAL_DATA_QUALITY_FINDING_CONFLICT')
                const nextStatus = patch.hasStatus ? patch.status : current.status
                const nextOwner = patch.hasOwner ? patch.owner : (current.owner || '')
                if (nextStatus === 'resolved' && count(current.observed_count) > 0) {
                    throw qualityError('COMMERCIAL_DATA_QUALITY_FINDING_STILL_OBSERVED')
                }
                // Suppression is retained for backward-compatible history, but
                // an active observation must remain actionable.  The refresh
                // path independently reopens legacy suppressed findings when
                // they are still observed.
                if (patch.hasStatus && nextStatus === 'suppressed' && count(current.observed_count) > 0) {
                    throw qualityError('COMMERCIAL_DATA_QUALITY_SUPPRESSION_REQUIRES_CLEARED_FINDING')
                }
                if (nextStatus === current.status && nextOwner === (current.owner || '')) {
                    throw qualityError('COMMERCIAL_DATA_QUALITY_CHANGE_REQUIRED', 400)
                }
                const updated = await client.query(`update crm_atendimento.commercial_data_quality_findings
                    set status = $2, owner = nullif($3, ''),
                        acknowledged_at = case
                            when $2 in ('acknowledged','in_progress') then coalesce(acknowledged_at, now())
                            when $2 = 'open' then null else acknowledged_at end,
                        resolved_at = case
                            when $2 = 'resolved' then coalesce(resolved_at, now())
                            when $2 = 'open' then null else resolved_at end,
                        revision = revision + 1, updated_by = $4, updated_at = now()
                    where id = $1 returning *`, [findingId, nextStatus, nextOwner, actorId])
                const row = updated.rows[0]
                await recordEvent(client, {
                    findingId,
                    eventType: nextStatus !== current.status ? 'status_changed' : 'assignment_changed',
                    previousStatus: current.status,
                    status: row.status,
                    previousOwner: current.owner,
                    owner: row.owner,
                    observedCount: row.observed_count,
                    actor: actorId,
                })
                return { finding: mapFinding(row) }
            })
        },

        async events(id, query = {}, actor) {
            requirePool(pgPool)
            assertCommercialQualityManager(actor)
            const findingId = assertFindingId(id)
            await assertQueueReady(pgPool)
            const limit = normalizeLimit(query.limit, 100, 250)
            const rows = await pgPool.query(`select id, event_order, event_type, previous_status, status,
                previous_owner, owner, observed_count, actor, created_at
                from crm_atendimento.commercial_data_quality_finding_events
                where finding_id = $1 order by event_order desc limit $2`, [findingId, limit])
            return { events: rows.rows.map(mapFindingEvent) }
        },
    }
}

export const __testables = {
    actorIdentity,
    assertCommercialQualityManager,
    assertFindingId,
    commercialObservationTransition,
    normalizeFindingPatch,
    querySourceObservations,
    sanitizeMetrics,
    withCommercialDataQualityRefreshTransaction,
}
