import { createHmac, randomUUID } from 'node:crypto'

import { createPgPool, withPgTransaction } from '../harmonia/store/pg.js'
import { requiredClientesSources } from '../clientes/sourceCatalog.js'
import {
    COMMERCIAL_CAMPAIGN_STATES,
    COMMERCIAL_OPERATION_FLAGS,
    actionQueueFlags,
    campaignMemberState,
    commercialOperationError,
    computeAverageStageDurations,
    normalizeCampaignFilters,
    normalizeCampaignPayload,
    normalizeOutcomeCode,
    normalizeOperationMutation,
    planWalletBalance,
    projectCommercialTimelineEvent,
    stableControlGroup,
    stableOperationFingerprint,
} from './commercialOperations.js'
import { COMMERCIAL_OPERATIONS_MIGRATION_ID } from './commercialOperationsMigration.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UNIT_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/i
const OWNER_RE = /^[A-Za-zÀ-ÿ0-9._:+\- ]{1,160}$/
const ACTIVE_ACTION_STATUSES = Object.freeze(['open', 'contacted', 'responded', 'scheduled'])
const ACTION_STATUSES = Object.freeze([...ACTIVE_ACTION_STATUSES, 'won_sale', 'returned', 'closed', 'cancelled'])
const ABSENCE_TYPES = new Set(['vacation', 'absence', 'leave'])
const COMMERCIAL_REQUIRED_SOURCE_IDS = Object.freeze(requiredClientesSources().map((source) => source.id).sort())
// This is intentionally a literal contract rather than an import from the
// analytics module: Operations v2 must remain deployable before Analytics,
// while cohort/owner-assignment mutations fail closed until that additive
// migration is active.
const COMMERCIAL_ANALYTICS_EXPERIMENT_MIGRATION_ID = '20260807_commercial_analytics_v2'
const EXPERIMENT_CROSSOVER_BLOCKING_VARIANTS = Object.freeze(['control', 'excluded'])
const OUTCOME_STATUSES = Object.freeze({
    no_response: 'contacted',
    wrong_number: 'closed',
    requested_follow_up: 'responded',
    not_interested: 'closed',
    completed_elsewhere: 'closed',
    scheduled: 'scheduled',
    attended: 'closed',
    cancelled: 'cancelled',
    sale: 'won_sale',
    clinical_return: 'returned',
    opt_out_requested: 'responded',
})
const WALLET_SORTS = Object.freeze({
    dueDate: 'action.due_date',
    updatedAt: 'action.updated_at',
    createdAt: 'action.created_at',
    status: 'action.status',
    owner: "coalesce(action.owner, '')",
})

// This is deliberately a hard boundary, not an environment-controlled flag.
// The operation layer can create internal work and audit it, but cannot write
// consent, schedule a send, enqueue delivery or turn a campaign into outbound
// communication.
export const COMMERCIAL_OPERATIONS_SAFETY_FLAGS = Object.freeze({
    commercialContactWritesEnabled: false,
    messagesEnabled: false,
    automationEnabled: false,
    consentWritesEnabled: false,
    outboundDispatchEnabled: false,
})

function text(value) {
    return String(value ?? '').trim()
}

function operationalError(code, statusCode = 409) {
    const error = commercialOperationError(code, statusCode)
    error.code = code
    error.statusCode = statusCode
    return error
}

function requirePool(pgPool) {
    if (!pgPool) throw operationalError('DATABASE_URL_not_configured', 503)
}

function bool(value) {
    return value === true
}

function count(value) {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

function dateOnly(value) {
    const raw = text(value).slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
}

function iso(value) {
    const timestamp = Date.parse(value || '')
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function containsPiiLikeValue(value) {
    const raw = text(value)
    return /@/.test(raw) || /\d{7,}/.test(raw)
}

function safeOwner(value, { required = false } = {}) {
    const owner = text(value)
    if (!owner && required) throw operationalError('COMMERCIAL_OPERATION_OWNER_REQUIRED', 400)
    if (owner && (!OWNER_RE.test(owner) || containsPiiLikeValue(owner))) {
        throw operationalError('INVALID_COMMERCIAL_OPERATION_OWNER', 400)
    }
    return owner || null
}

function projectOwner(value) {
    const owner = text(value)
    return owner && OWNER_RE.test(owner) && !containsPiiLikeValue(owner) ? owner : null
}

function actorPrincipal(actor) {
    const value = text(actor?.id || actor?.username || actor?.email)
    if (!value) throw operationalError('ACTOR_IDENTITY_REQUIRED', 401)
    return value
}

function auditSecret() {
    const secret = text(
        process.env.ATENDIMENTO_ACTOR_HMAC_KEY ||
        process.env.ESCALA_ACTOR_HMAC_KEY ||
        process.env.CRM_ESCALA_HMAC_KEY,
    )
    if (secret.length < 32) throw operationalError('COMMERCIAL_OPERATIONS_AUDIT_KEY_REQUIRED', 503)
    return secret
}

function digest(purpose, value) {
    return createHmac('sha256', auditSecret())
        .update(`${purpose}:${stableOperationFingerprint(value)}`)
        .digest('hex')
}

function actorReference(actor) {
    return `actor:${digest('commercial-operations-actor', { actor: actorPrincipal(actor) })}`
}

function isGlobalCommercialActor(actor) {
    return actor?.isGlobalAdmin === true || text(actor?.role).toUpperCase() === 'ADMIN'
}

export function commercialOperationsUnitScope(actor) {
    if (isGlobalCommercialActor(actor)) return null
    // A commercial actor without an explicit unit claim is never silently
    // promoted to a cross-unit reader.  The signed-actor parser carries
    // `allowedUnitsDeclared`, but accepting a direct store caller must remain
    // equally fail-closed.
    if (!Array.isArray(actor?.allowedUnits)) return []
    return [...new Set(actor.allowedUnits.map((unit) => text(unit).toLowerCase()).filter((unit) => UNIT_RE.test(unit)))].sort()
}

export function assertCommercialOperationsManager(actor) {
    const role = text(actor?.role).toUpperCase()
    if (role === 'GESTOR' || role === 'ADMIN' || actor?.isGlobalAdmin === true) return
    throw operationalError('FORBIDDEN', 403)
}

function requestedUnitScope(actor, requested) {
    const actorScope = commercialOperationsUnitScope(actor)
    const unit = text(requested).toLowerCase()
    if (actorScope === null) {
        if (unit && unit !== 'all' && !UNIT_RE.test(unit)) throw operationalError('INVALID_COMMERCIAL_UNIT', 400)
        return { unit: unit && unit !== 'all' ? unit : null, unitSlugs: null }
    }
    if (!actorScope.length) throw operationalError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    if (!unit || unit === 'all') return { unit: null, unitSlugs: actorScope }
    if (!UNIT_RE.test(unit)) throw operationalError('INVALID_COMMERCIAL_UNIT', 400)
    if (!actorScope.includes(unit)) throw operationalError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    return { unit, unitSlugs: [unit] }
}

function assertUnitAllowed(actor, unit) {
    const value = text(unit).toLowerCase()
    if (!UNIT_RE.test(value)) throw operationalError('INVALID_COMMERCIAL_UNIT', 400)
    const scope = commercialOperationsUnitScope(actor)
    if (scope !== null && (!scope.length || !scope.includes(value))) throw operationalError('COMMERCIAL_UNIT_FORBIDDEN', 403)
    return value
}

function assertUuid(value, code = 'INVALID_COMMERCIAL_OPERATION_ID') {
    const id = text(value).toLowerCase()
    if (!UUID_RE.test(id)) throw operationalError(code, 400)
    return id
}

function normalizeLimit(value, fallback = 50, maximum = 100) {
    const number = Number(value)
    if (!Number.isInteger(number) || number < 1) return fallback
    return Math.min(number, maximum)
}

function normalizeOffset(value) {
    const number = Number(value)
    return Number.isInteger(number) && number > 0 ? number : 0
}

function normalizeDateRange(startValue, endValue, code = 'INVALID_COMMERCIAL_OPERATION_DATE_RANGE') {
    const startsAt = dateOnly(startValue)
    const endsAt = dateOnly(endValue)
    if (!startsAt || !endsAt || endsAt < startsAt) throw operationalError(code, 400)
    return { startsAt, endsAt }
}

function normalizeCapacities(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw operationalError('COMMERCIAL_REBALANCE_CAPACITIES_REQUIRED', 400)
    }
    const entries = Object.entries(value)
    if (!entries.length || entries.length > 100) throw operationalError('COMMERCIAL_REBALANCE_CAPACITIES_REQUIRED', 400)
    const capacities = {}
    for (const [rawOwner, rawCapacity] of entries) {
        const owner = safeOwner(rawOwner, { required: true })
        const capacity = Number(rawCapacity)
        if (!Number.isInteger(capacity) || capacity < 0 || capacity > 10_000) {
            throw operationalError('INVALID_COMMERCIAL_REBALANCE_CAPACITY', 400)
        }
        capacities[owner] = capacity
    }
    return Object.fromEntries(Object.entries(capacities).sort(([left], [right]) => left.localeCompare(right)))
}

function normalizeExpectedRevisions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw operationalError('COMMERCIAL_REBALANCE_EXPECTED_REVISIONS_REQUIRED', 400)
    }
    const revisions = {}
    for (const [rawId, rawRevision] of Object.entries(value)) {
        const id = assertUuid(rawId, 'INVALID_COMMERCIAL_ACTION')
        const revision = Number(rawRevision)
        if (!Number.isInteger(revision) || revision < 1) throw operationalError('COMMERCIAL_EXPECTED_REVISION_INVALID', 400)
        revisions[id] = revision
    }
    return revisions
}

function normalizeActionFlags(value) {
    const candidates = Array.isArray(value) ? value : text(value).split(',')
    const flags = [...new Set(candidates.map((item) => text(item)).filter(Boolean))]
    if (flags.length > 10 || flags.some((flag) => !COMMERCIAL_OPERATION_FLAGS.includes(flag))) {
        throw operationalError('INVALID_COMMERCIAL_OPERATION_FLAG', 400)
    }
    return flags
}

function operationSafety() {
    return { ...COMMERCIAL_OPERATIONS_SAFETY_FLAGS }
}

function mapReadiness(row = {}, migrationReady = false) {
    const tables = ['actions', 'action_events', 'mutations', 'campaigns', 'members', 'campaign_events', 'absences']
    const triggers = [
        'action_event_immutable', 'action_event_no_truncate',
        'mutation_immutable', 'mutation_no_truncate', 'campaign_event_immutable', 'campaign_event_no_truncate',
    ]
    const relationsReady = tables.every((key) => bool(row[key]))
    const appendOnlyReady = triggers.every((key) => bool(row[key]))
    return {
        ready: relationsReady && appendOnlyReady && migrationReady,
        migrationId: COMMERCIAL_OPERATIONS_MIGRATION_ID,
        relationsReady,
        appendOnlyReady,
        migrationReady,
        safety: operationSafety(),
    }
}

export async function commercialOperationsReadiness(db) {
    const availability = await db.query(`select
        to_regclass('crm_atendimento.commercial_actions') is not null as actions,
        to_regclass('crm_atendimento.commercial_action_events') is not null as action_events,
        to_regclass('crm_atendimento.commercial_operation_mutations') is not null as mutations,
        to_regclass('crm_atendimento.commercial_campaigns') is not null as campaigns,
        to_regclass('crm_atendimento.commercial_campaign_members') is not null as members,
        to_regclass('crm_atendimento.commercial_campaign_events') is not null as campaign_events,
        to_regclass('crm_atendimento.commercial_owner_absences') is not null as absences,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_action_events')
            and tgname='commercial_action_events_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_ledger_mutation()')) as action_event_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_action_events')
            and tgname='commercial_action_events_no_truncate' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_ledger_mutation()')) as action_event_no_truncate,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_operation_mutations')
            and tgname='commercial_operation_mutations_v2_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()')) as mutation_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_operation_mutations')
            and tgname='commercial_operation_mutations_v2_no_truncate' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()')) as mutation_no_truncate,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_campaign_events')
            and tgname='commercial_campaign_events_v2_immutable' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()')) as campaign_event_immutable,
        exists(select 1 from pg_trigger where tgrelid=to_regclass('crm_atendimento.commercial_campaign_events')
            and tgname='commercial_campaign_events_v2_no_truncate' and tgenabled='O'
            and tgfoid=to_regprocedure('crm_atendimento.prevent_commercial_operations_evidence_mutation_v2()')) as campaign_event_no_truncate,
        to_regclass('crm_atendimento.schema_migrations') is not null as migration_registry`)
    const row = availability.rows[0] || {}
    if (!row.migration_registry) return mapReadiness(row, false)
    const migration = await db.query(`select id from crm_atendimento.schema_migrations
        where id=$1 and rolled_back_at is null`, [COMMERCIAL_OPERATIONS_MIGRATION_ID])
    return mapReadiness(row, !!migration.rows[0]?.id)
}

async function assertCommercialOperationsReady(db) {
    const readiness = await commercialOperationsReadiness(db)
    if (!readiness.ready) throw operationalError('COMMERCIAL_OPERATIONS_NOT_READY', 409)
    return readiness
}

async function operationalDependencies(db) {
    const result = await db.query(`select
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_contact_permissions'), 'SELECT'), false) as permissions,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.clientes_source_operation_checkpoints'), 'SELECT'), false) as source_checkpoints,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.global_client_identity_members'), 'SELECT'), false) as identity_members,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.client_caixa_links'), 'SELECT'), false) as attendance_caixa_links,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.app_registration_attendance_links'), 'SELECT'), false) as app_attendance_links,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.app_registration_caixa_links'), 'SELECT'), false) as app_caixa_links,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.supplemental_lead_profile_app_links'), 'SELECT'), false) as lead_app_links,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.supplemental_lead_profile_caixa_links'), 'SELECT'), false) as lead_caixa_links,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.identity_review_decisions'), 'SELECT'), false) as review_decisions`)
    const row = result.rows[0] || {}
    return {
        permissions: bool(row.permissions),
        sourceCheckpoints: bool(row.source_checkpoints),
        identityReview: bool(row.identity_members) && bool(row.review_decisions) && bool(row.attendance_caixa_links) &&
            bool(row.app_attendance_links) && bool(row.app_caixa_links) && bool(row.lead_app_links) && bool(row.lead_caixa_links),
    }
}

async function sourceStale(db, dependencies) {
    if (!dependencies.sourceCheckpoints) return true
    const result = await db.query(`select count(*)::int as checkpoint_count,
        bool_or(checkpoint.last_status <> 'complete' or checkpoint.validated_snapshot_complete is not true or
            checkpoint.reconciliation_required is true or checkpoint.validated_at is null or
            checkpoint.validated_at < now() - interval '48 hours') as stale
        from crm_atendimento.clientes_source_operation_checkpoints checkpoint
        where checkpoint.source_id=any($1::text[])`, [COMMERCIAL_REQUIRED_SOURCE_IDS])
    return count(result.rows[0]?.checkpoint_count) < COMMERCIAL_REQUIRED_SOURCE_IDS.length || bool(result.rows[0]?.stale)
}

function normalizedExperimentIdentityIds(identityIds) {
    return [...new Set((Array.isArray(identityIds) ? identityIds : [identityIds])
        .map((identityId) => assertUuid(identityId, 'INVALID_COMMERCIAL_EXPERIMENT_IDENTITY')))].sort()
}

async function experimentCrossoverGuardReadiness(db) {
    // `to_regclass` and explicit SELECT grants let Operations retain a safe
    // hook before Analytics is promoted.  Absence of either table, privilege
    // or active migration is an unsafe/unknown experiment state, never an
    // empty holdout set.
    const result = await db.query(`select
        to_regclass('crm_atendimento.commercial_experiment_assignments') is not null as assignments,
        to_regclass('crm_atendimento.commercial_experiments') is not null as experiments,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_experiment_assignments'), 'SELECT'), false) as assignments_read,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.commercial_experiments'), 'SELECT'), false) as experiments_read,
        exists(select 1 from crm_atendimento.schema_migrations
            where id=$1 and rolled_back_at is null) as migration_ready`, [COMMERCIAL_ANALYTICS_EXPERIMENT_MIGRATION_ID])
    const row = result.rows[0] || {}
    return {
        ready: bool(row.assignments) && bool(row.experiments) && bool(row.assignments_read) && bool(row.experiments_read) && bool(row.migration_ready),
        assignments: bool(row.assignments),
        experiments: bool(row.experiments),
        assignmentsRead: bool(row.assignments_read),
        experimentsRead: bool(row.experiments_read),
        migrationReady: bool(row.migration_ready),
    }
}

async function activeExperimentHoldouts(client, { unitId, identityIds }) {
    const unit = assertUuid(unitId, 'INVALID_COMMERCIAL_EXPERIMENT_UNIT')
    const identities = normalizedExperimentIdentityIds(identityIds)
    if (!identities.length) return []
    const readiness = await experimentCrossoverGuardReadiness(client)
    if (!readiness.ready) throw operationalError('COMMERCIAL_EXPERIMENT_GUARD_NOT_READY', 409)

    // Analytics must acquire this same deterministic namespace before writing
    // assignments.  Operations holds it across the check and mutation so a
    // second Operations request cannot turn a control/excluded identity into
    // a silent crossover.
    for (const identityId of identities) {
        await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
            `commercial-experiment-crossover:${unit}:${identityId}`,
        ])
    }
    const result = await client.query(`select assignment.identity_id::text,assignment.variant
        from crm_atendimento.commercial_experiment_assignments assignment
        join crm_atendimento.commercial_experiments experiment on experiment.id=assignment.experiment_id
        where assignment.identity_id=any($1::uuid[])
          and assignment.unit_id=$2::uuid
          and assignment.variant=any($3::text[])
          and experiment.state='active'
          and experiment.starts_at <= now()
          and experiment.ends_at > now()
        order by assignment.identity_id asc,assignment.variant asc
        for key share of assignment,experiment`, [identities, unit, EXPERIMENT_CROSSOVER_BLOCKING_VARIANTS])
    return (result.rows || []).map((row) => ({
        identityId: assertUuid(row.identity_id, 'COMMERCIAL_EXPERIMENT_ASSIGNMENT_INVALID'),
        variant: EXPERIMENT_CROSSOVER_BLOCKING_VARIANTS.includes(text(row.variant)) ? text(row.variant) : 'excluded',
    }))
}

async function assertNoActiveExperimentHoldout(client, context) {
    const holdouts = await activeExperimentHoldouts(client, context)
    if (holdouts.length) throw operationalError('COMMERCIAL_EXPERIMENT_HOLDOUT_ACTIVE', 409)
}

function scopeWhere(scope, params, unitColumn = 'unit.slug') {
    if (scope.unit) {
        params.push(scope.unit)
        return `${unitColumn} = $${params.length}`
    }
    if (scope.unitSlugs) {
        params.push(scope.unitSlugs)
        return `${unitColumn} = any($${params.length}::text[])`
    }
    return `${unitColumn} is not null`
}

function permissionSql(dependencies) {
    if (!dependencies.permissions) {
        return {
            join: '',
            status: "'review_required'::text",
            expiresAt: 'null::timestamptz',
        }
    }
    return {
        join: `left join crm_atendimento.commercial_contact_permissions permission
            on permission.identity_id=action.identity_id and permission.channel='whatsapp'`,
        status: `case when permission.status='granted' and (permission.expires_at is null or permission.expires_at >= now()) then 'eligible'
            when permission.status='denied' or (permission.expires_at is not null and permission.expires_at < now()) then 'blocked'
            else 'review_required' end`,
        expiresAt: 'permission.expires_at',
    }
}

function identityReviewSql(dependencies) {
    if (!dependencies.identityReview) return 'true'
    // The review lookup is an allowlisted existence projection: no member,
    // candidate, context or evidence column is selected or serialized.
    return `exists(
        select 1 from crm_atendimento.global_client_identity_members member
         where member.identity_id=action.identity_id and (
            (member.source_type='attendance_client' and exists(select 1 from crm_atendimento.client_caixa_links link
                where link.client_id=member.source_id::uuid and link.status in ('suggested','ambiguous')))
            or (member.source_type='app_registration' and (
                exists(select 1 from crm_atendimento.app_registration_attendance_links link
                    where link.app_registration_id=member.source_id and link.status in ('suggested','ambiguous'))
                or exists(select 1 from crm_atendimento.app_registration_caixa_links link
                    where link.app_registration_id=member.source_id and link.status in ('suggested','ambiguous'))
            ))
            or (member.source_type='lead_profile' and (
                exists(select 1 from crm_atendimento.supplemental_lead_profile_app_links link
                    where link.source_profile_id=member.source_id and link.status in ('suggested','ambiguous'))
                or exists(select 1 from crm_atendimento.supplemental_lead_profile_caixa_links link
                    where link.source_profile_id=member.source_id and link.status in ('suggested','ambiguous'))
            ))
        )
    )`
}

function actionFlagSql(flag, { permissionStatus, permissionExpiresAt, sourceIsStale, identityReview, actorOwner }, params) {
    switch (flag) {
        case 'assigned_to_me':
            params.push(actorOwner)
            return `coalesce(action.owner,'') = $${params.length}`
        case 'due_today':
            return `action.status = any($${params.push(ACTIVE_ACTION_STATUSES)}::text[]) and action.due_date=current_date`
        case 'overdue':
            return `action.status = any($${params.push(ACTIVE_ACTION_STATUSES)}::text[]) and action.due_date < current_date`
        case 'awaiting_response': return `action.status='contacted'`
        case 'scheduled': return `action.status='scheduled'`
        case 'no_return': return `action.status='contacted' and action.due_date < current_date`
        case 'permission_expiring': return `${permissionExpiresAt} >= now() and ${permissionExpiresAt} <= now() + interval '7 days'`
        case 'ineligible': return `${permissionStatus} <> 'eligible'`
        case 'source_stale':
            params.push(sourceIsStale)
            return `$${params.length}::boolean`
        case 'identity_review': return identityReview
        default: throw operationalError('INVALID_COMMERCIAL_OPERATION_FLAG', 400)
    }
}

function mapWalletAction(row, actor) {
    const permission = { status: text(row.permission_status) || 'review_required', expiresAt: iso(row.permission_expires_at) }
    const queueFlags = actionQueueFlags({
        status: row.status,
        dueDate: row.due_date,
        owner: row.owner,
    }, {
        actorIds: [actorPrincipal(actor)],
        eligibility: permission,
        sourceStale: bool(row.source_stale),
        identityInReview: bool(row.identity_in_review),
    })
    return {
        actionId: text(row.id),
        unit: text(row.unit_slug) || null,
        segmentKey: text(row.segment_key),
        actionType: text(row.action_type),
        status: text(row.status),
        owner: projectOwner(row.owner),
        dueDate: dateOnly(row.due_date),
        revision: count(row.revision) || 1,
        outcomeCode: text(row.outcome_code) || null,
        permission,
        sourceStale: bool(row.source_stale),
        identityInReview: bool(row.identity_in_review),
        queueFlags,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    }
}

async function queryWallet(pgPool, query, actor) {
    const dependencies = await operationalDependencies(pgPool)
    const [globalSourceStale, scope] = await Promise.all([
        sourceStale(pgPool, dependencies),
        Promise.resolve(requestedUnitScope(actor, query?.unit)),
    ])
    const flags = normalizeActionFlags(query?.actionFlag || query?.actionFlags)
    const status = text(query?.status).toLowerCase()
    const owner = query?.owner == null || query?.owner === '' ? '' : safeOwner(query.owner)
    const sort = Object.prototype.hasOwnProperty.call(WALLET_SORTS, text(query?.sort)) ? text(query.sort) : 'dueDate'
    const direction = text(query?.direction).toLowerCase() === 'asc' ? 'asc' :
        (text(query?.direction).toLowerCase() === 'desc' ? 'desc' : (sort === 'dueDate' ? 'asc' : 'desc'))
    const limit = normalizeLimit(query?.limit)
    const offset = normalizeOffset(query?.offset)
    if (status && !ACTION_STATUSES.includes(status)) throw operationalError('INVALID_COMMERCIAL_ACTION_STATUS', 400)
    const permission = permissionSql(dependencies)
    const identityReview = identityReviewSql(dependencies)
    const params = []
    const where = [scopeWhere(scope, params)]
    if (status) {
        params.push(status)
        where.push(`action.status=$${params.length}`)
    }
    if (owner) {
        params.push(owner)
        where.push(`action.owner=$${params.length}`)
    }
    for (const flag of flags) {
        where.push(actionFlagSql(flag, {
            permissionStatus: permission.status,
            permissionExpiresAt: permission.expiresAt,
            sourceIsStale: globalSourceStale,
            identityReview,
            actorOwner: actorPrincipal(actor),
        }, params))
    }
    params.push(globalSourceStale, limit, offset)
    const rows = await pgPool.query(`select action.id::text, action.segment_key, action.action_type, action.status, action.owner,
            action.due_date, action.revision, action.outcome_code, action.created_at, action.updated_at,
            unit.slug as unit_slug, ${permission.status} as permission_status, ${permission.expiresAt} as permission_expires_at,
            $${params.length - 2}::boolean as source_stale, ${identityReview} as identity_in_review,
            count(*) over()::int as total_count
        from crm_atendimento.commercial_actions action
        join crm_atendimento.units unit on unit.id=action.unit_id
        ${permission.join}
        where ${where.join(' and ')}
        order by ${WALLET_SORTS[sort]} ${direction} nulls last, action.updated_at desc, action.id asc
        limit $${params.length - 1} offset $${params.length}`, params)
    const actions = (rows.rows || []).map((row) => mapWalletAction(row, actor))
    return {
        total: count(rows.rows?.[0]?.total_count),
        limit,
        offset,
        sort,
        direction,
        filters: { unit: scope.unit || null, status: status || null, owner: owner || null, actionFlags: flags },
        actions,
        pagination: { hasPrevious: offset > 0, hasNext: offset + actions.length < count(rows.rows?.[0]?.total_count) },
        safety: operationSafety(),
    }
}

function mapOwnerMetric(row) {
    return {
        owner: projectOwner(row.owner) || 'unassigned',
        total: count(row.total),
        active: count(row.active),
        overdue: count(row.overdue),
        completed: count(row.completed),
        responded: count(row.responded),
        scheduled: count(row.scheduled),
        attended: count(row.attended),
        sale: count(row.sale),
        returned: count(row.returned),
        cancelled: count(row.cancelled),
    }
}

async function queryStageDurations(pgPool, scope) {
    const params = []
    const where = scopeWhere(scope, params)
    const result = await pgPool.query(`select event.action_id::text,event.status,event.created_at
        from crm_atendimento.commercial_action_events event
        join crm_atendimento.commercial_actions action on action.id=event.action_id
        join crm_atendimento.units unit on unit.id=action.unit_id
        where ${where}
        order by event.action_id,event.event_order asc
        limit 10000`, params)
    return computeAverageStageDurations((result.rows || []).map((row) => ({
        actionId: row.action_id,
        status: row.status,
        createdAt: row.created_at,
    })))
}

async function queryTeam(pgPool, query, actor) {
    const scope = requestedUnitScope(actor, query?.unit)
    const params = []
    const where = scopeWhere(scope, params)
    const [owners, statuses, absences, stageDurations] = await Promise.all([
        pgPool.query(`select coalesce(action.owner,'') as owner,
                count(*)::int as total,
                count(*) filter (where action.status=any($${params.push(ACTIVE_ACTION_STATUSES)}::text[]))::int as active,
                count(*) filter (where action.status=any($${params.push(ACTIVE_ACTION_STATUSES)}::text[]) and action.due_date < current_date)::int as overdue,
                count(*) filter (where action.status in ('closed','cancelled','won_sale','returned') or action.outcome_code in ('attended','sale','clinical_return','cancelled'))::int as completed,
                count(*) filter (where action.status in ('responded','scheduled','won_sale','returned') or action.outcome_code in ('requested_follow_up','scheduled','attended','cancelled','sale','clinical_return','opt_out_requested'))::int as responded,
                count(*) filter (where action.status='scheduled' or action.outcome_code='scheduled')::int as scheduled,
                count(*) filter (where action.outcome_code='attended')::int as attended,
                count(*) filter (where action.status='won_sale' or action.outcome_code='sale')::int as sale,
                count(*) filter (where action.status='returned' or action.outcome_code='clinical_return')::int as returned,
                count(*) filter (where action.status='cancelled' or action.outcome_code='cancelled')::int as cancelled
            from crm_atendimento.commercial_actions action
            join crm_atendimento.units unit on unit.id=action.unit_id
            where ${where}
            group by coalesce(action.owner,'') order by active desc, owner asc`, params),
        pgPool.query(`select action.status, count(*)::int as count
            from crm_atendimento.commercial_actions action
            join crm_atendimento.units unit on unit.id=action.unit_id
            where ${where} group by action.status`, params.slice(0, -2)),
        pgPool.query(`select absence.id::text, absence.owner, unit.slug as unit, absence.absence_type,
                absence.starts_at, absence.ends_at, absence.substitute_owner, absence.revision
            from crm_atendimento.commercial_owner_absences absence
            join crm_atendimento.units unit on unit.id=absence.unit_id
            where ${scopeWhere(scope, [])}
              and absence.ends_at >= current_date
             order by absence.starts_at asc`, scope.unit ? [scope.unit] : scope.unitSlugs ? [scope.unitSlugs] : []),
        queryStageDurations(pgPool, scope),
    ])
    const byOwner = (owners.rows || []).map(mapOwnerMetric)
    const totals = byOwner.reduce((result, row) => Object.fromEntries(Object.keys(row).filter((key) => key !== 'owner').map((key) => [key, count(result[key]) + count(row[key])])), {})
    const total = count(totals.total)
    const rate = (key) => total ? Math.round((count(totals[key]) / total) * 10_000) / 100 : 0
    return {
        totals: {
            ...totals,
            completionRate: rate('completed'), responseRate: rate('responded'), schedulingRate: rate('scheduled'),
            attendanceRate: rate('attended'), saleRate: rate('sale'), returnRate: rate('returned'), cancellationRate: rate('cancelled'),
        },
        byOwner,
        byStatus: Object.fromEntries((statuses.rows || []).map((row) => [text(row.status), count(row.count)])),
        stageDurations,
        absences: (absences.rows || []).map((row) => ({
            absenceId: text(row.id), owner: projectOwner(row.owner) || 'unassigned', unit: text(row.unit),
            type: text(row.absence_type), startsAt: dateOnly(row.starts_at), endsAt: dateOnly(row.ends_at),
            substituteOwner: projectOwner(row.substitute_owner), revision: count(row.revision) || 1,
        })),
        safety: operationSafety(),
    }
}

function identityReviewFor(identityColumn, dependencies) {
    return identityReviewSql(dependencies).replaceAll('action.identity_id', identityColumn)
}

function mapCampaign(row = {}) {
    let filters = {}
    try { filters = normalizeCampaignFilters(row.filters_snapshot || {}) } catch { /* corrupt legacy snapshot stays hidden */ }
    return {
        campaignId: text(row.id),
        name: text(row.name),
        revision: count(row.revision) || 1,
        segmentKey: text(row.segment_key),
        segmentVersion: text(row.segment_version),
        filters,
        contextHash: /^[a-f0-9]{64}$/i.test(text(row.context_hash)) ? text(row.context_hash).toLowerCase() : null,
        cutoffAt: iso(row.cutoff_at),
        unit: text(row.unit_slug),
        owner: projectOwner(row.owner) || 'unassigned',
        offerId: UUID_RE.test(text(row.offer_id)) ? text(row.offer_id).toLowerCase() : null,
        assignmentWindowStart: iso(row.assignment_window_start),
        assignmentWindowEnd: iso(row.assignment_window_end),
        controlGroupPercent: count(row.control_group_percent),
        state: COMMERCIAL_CAMPAIGN_STATES.includes(text(row.state)) ? text(row.state) : 'draft',
        author: projectOwner(row.author) || null,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        members: {
            total: count(row.member_total),
            eligible: count(row.member_eligible),
            blocked: count(row.member_blocked),
            review: count(row.member_review),
            control: count(row.member_control),
            assigned: count(row.member_assigned),
            completed: count(row.member_completed),
            cancelled: count(row.member_cancelled),
        },
    }
}

function mapCampaignEvent(row = {}) {
    return {
        eventOrder: count(row.event_order),
        type: text(row.event_type),
        occurredAt: iso(row.created_at),
        actor: projectOwner(row.actor_id),
        correlationId: UUID_RE.test(text(row.trace_id)) ? text(row.trace_id).toLowerCase() : null,
        memberState: ['eligible', 'blocked', 'review', 'control', 'assigned', 'completed', 'cancelled'].includes(text(row.member_state))
            ? text(row.member_state) : null,
        outcomeCode: text(row.outcome_code) || null,
    }
}

function frozenCampaignContext(campaign) {
    return {
        name: campaign.name,
        segmentKey: campaign.segmentKey,
        segmentVersion: campaign.segmentVersion,
        filters: campaign.filters,
        identityIds: [...campaign.identityIds].sort(),
        cutoffAt: campaign.cutoffAt,
        unit: campaign.unit,
        owner: campaign.owner,
        offerId: campaign.offerId,
        assignmentWindowStart: campaign.assignmentWindowStart,
        assignmentWindowEnd: campaign.assignmentWindowEnd,
        controlGroupPercent: campaign.controlGroupPercent,
        state: campaign.state,
    }
}

async function campaignCohortDependencies(db) {
    const result = await db.query(`select
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.global_client_identities'), 'SELECT'), false) as identities,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.global_client_identity_members'), 'SELECT'), false) as members,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.attendance_client_links'), 'SELECT'), false) as attendance_links,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.attendances'), 'SELECT'), false) as attendances,
        coalesce(has_table_privilege(current_user, to_regclass('crm_caixa.sales'), 'SELECT'), false) as sales,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.app_client_registrations'), 'SELECT'), false) as app_registrations,
        coalesce(has_table_privilege(current_user, to_regclass('crm_atendimento.supplemental_lead_profiles'), 'SELECT'), false) as lead_profiles`)
    const row = result.rows[0] || {}
    return Object.values(row).every(bool)
}

async function resolveCampaignUnit(client, unitSlug) {
    const result = await client.query(`select id::text,slug from crm_atendimento.units where slug=$1`, [unitSlug])
    const unit = result.rows[0]
    if (!unit?.id) throw operationalError('COMMERCIAL_UNIT_NOT_FOUND', 404)
    return unit
}

async function readCampaignCohort(client, { identityIds, unitSlug, dependencies, globalSourceStale }) {
    if (!dependencies) throw operationalError('COMMERCIAL_CAMPAIGN_COHORT_SOURCE_UNAVAILABLE', 409)
    const permissions = await operationalDependencies(client)
    const permission = permissionSql(permissions)
    const review = identityReviewFor('identity.id', permissions)
    const result = await client.query(`select identity.id::text as identity_id,
            ${permission.status} as permission_status,
            ${review} as identity_in_review,
            exists(
                select 1 from crm_atendimento.global_client_identity_members member
                 where member.identity_id=identity.id and (
                    (member.source_type='attendance_client' and member.source_id ~ '^[0-9a-fA-F-]{36}$' and exists(
                        select 1 from crm_atendimento.attendance_client_links link
                        join crm_atendimento.attendances attendance on attendance.id=link.attendance_id and attendance.deleted_at is null
                        join crm_atendimento.units attendance_unit on attendance_unit.id=attendance.unit_id
                        where link.client_id=member.source_id::uuid and attendance_unit.slug=$2
                    ))
                    or (member.source_type='caixa_customer' and member.source_id ~ '^[0-9a-fA-F-]{36}$' and exists(
                        select 1 from crm_caixa.sales sale
                        join crm_atendimento.units sale_unit on sale_unit.id=sale.unit_id
                        where sale.customer_id=member.source_id::uuid and sale_unit.slug=$2
                    ))
                    or (member.source_type='app_registration' and exists(
                        select 1 from crm_atendimento.app_client_registrations registration
                        join lateral jsonb_array_elements_text(coalesce(registration.unit_slugs, '[]'::jsonb)) scope(slug) on true
                        where registration.source_client_id=member.source_id and scope.slug=$2
                    ))
                    or (member.source_type='lead_profile' and exists(
                        select 1 from crm_atendimento.supplemental_lead_profiles lead
                        join lateral jsonb_array_elements_text(coalesce(lead.unit_slugs, '[]'::jsonb)) scope(slug) on true
                        where lead.source_profile_id=member.source_id and scope.slug=$2
                    ))
                 )
            ) as unit_match
        from crm_atendimento.global_client_identities identity
        ${permission.join.replaceAll('action.identity_id', 'identity.id')}
        where identity.id=any($1::uuid[])`, [identityIds, unitSlug])
    const found = new Map((result.rows || []).map((row) => [text(row.identity_id).toLowerCase(), row]))
    if (found.size !== identityIds.length || identityIds.some((identityId) => !bool(found.get(identityId)?.unit_match))) {
        throw operationalError('COMMERCIAL_CAMPAIGN_IDENTITY_UNIT_FORBIDDEN', 403)
    }
    return identityIds.map((identityId) => {
        const row = found.get(identityId)
        const permissionStatus = text(row.permission_status) || 'review_required'
        const identityInReview = bool(row.identity_in_review)
        const eligible = permissionStatus === 'eligible'
        return {
            identityId,
            permissionStatus,
            sourceStale: globalSourceStale,
            identityInReview,
            eligible,
        }
    })
}

function mutationInput(actor, operation, payload, fingerprintPayload, { requireReason = true } = {}) {
    const mutation = normalizeOperationMutation(payload, { requireIdempotency: true, requireReason })
    const actorRef = actorReference(actor)
    const mutationKey = `co:${digest('commercial-operation-idempotency', {
        actorRef, operation, idempotencyKey: mutation.idempotencyKey,
    })}`
    const requestFingerprint = digest('commercial-operation-request', {
        actorRef,
        operation,
        payload: fingerprintPayload,
    })
    return { mutation, actorRef, mutationKey, requestFingerprint }
}

async function runCommercialOperationMutation(client, {
    actor,
    operation,
    payload,
    fingerprintPayload,
    requireReason = true,
    execute,
}) {
    const context = mutationInput(actor, operation, payload, fingerprintPayload, { requireReason })
    // Serialize every idempotency namespace before examining the operation
    // ledger or mutable rows. This makes a replay safe even when an earlier
    // successful mutation has changed its optimistic revision.
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [context.mutationKey])
    // Readiness is checked only after the idempotency lock.  A retry therefore
    // cannot observe a partially applied migration or race another request
    // while deciding whether the ledger already contains its result.
    await assertCommercialOperationsReady(client)
    const existing = await client.query(`select request_fingerprint,response
        from crm_atendimento.commercial_operation_mutations
        where mutation_key=$1 and operation=$2 for update`, [context.mutationKey, operation])
    if (existing.rows[0]) {
        if (text(existing.rows[0].request_fingerprint) !== context.requestFingerprint) {
            throw operationalError('COMMERCIAL_IDEMPOTENCY_CONFLICT', 409)
        }
        return { ...(existing.rows[0].response || {}), idempotent: true, safety: operationSafety() }
    }
    const response = await execute(context)
    await client.query(`insert into crm_atendimento.commercial_operation_mutations(
            mutation_key,operation,actor_id,request_fingerprint,response)
        values($1,$2,$3,$4,$5::jsonb)`, [
        context.mutationKey,
        operation,
        context.actorRef,
        context.requestFingerprint,
        JSON.stringify(response || {}),
    ])
    return { ...(response || {}), idempotent: false, safety: operationSafety() }
}

async function recordCampaignEvent(client, { campaignId, memberId = null, eventType, actorRef, traceId, payload = {} }) {
    await client.query(`insert into crm_atendimento.commercial_campaign_events(
            campaign_id,member_id,event_type,actor_id,trace_id,payload)
        values($1,$2,$3,$4,$5,$6::jsonb)`, [
        campaignId, memberId, eventType, actorRef, traceId, JSON.stringify(payload),
    ])
}

async function recordActionEvent(client, {
    actionId,
    identityId,
    previousStatus,
    status,
    outcomeCode = null,
    actorRef,
    traceId,
    details = {},
}) {
    // `details` is an explicit operational allowlist.  Do not pass an action
    // payload, note, customer object, identity context or source evidence here:
    // the action ledger is append-only and must therefore be safe to retain.
    const safeDetails = {
        operation: text(details.operation),
        ownerChanged: details.ownerChanged === true,
        rebalance: details.rebalance === true,
        reasonDigest: /^[a-f0-9]{64}$/i.test(text(details.reasonDigest)) ? text(details.reasonDigest) : null,
    }
    await client.query(`insert into crm_atendimento.commercial_action_events(
            action_id,identity_id,event_type,previous_status,status,trace_id,recorded_by,
            contact_eligibility_status,contact_eligibility_reason,details,outcome_code)
        values($1,$2,'updated',$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`, [
        actionId,
        identityId,
        previousStatus,
        status,
        traceId,
        actorRef,
        null,
        null,
        JSON.stringify(safeDetails),
        outcomeCode,
    ])
}

function memberStateForAction(status, outcomeCode, currentState) {
    if (['control', 'blocked', 'review', 'completed', 'cancelled'].includes(text(currentState))) return text(currentState)
    if (text(status) === 'cancelled' || outcomeCode === 'cancelled') return 'cancelled'
    if (['won_sale', 'returned', 'closed'].includes(text(status)) || ['attended', 'sale', 'clinical_return'].includes(outcomeCode)) return 'completed'
    return 'assigned'
}

async function synchronizeCampaignMembershipForAction(client, {
    actionId,
    owner = null,
    status,
    outcomeCode = null,
    actorRef,
    reasonDigest,
}) {
    const memberships = await client.query(`select id::text,campaign_id::text,state
        from crm_atendimento.commercial_campaign_members
        where action_id=$1 for update`, [actionId])
    for (const member of memberships.rows || []) {
        const nextState = memberStateForAction(status, outcomeCode, member.state)
        await client.query(`update crm_atendimento.commercial_campaign_members
            set owner=coalesce($2,owner),state=$3,revision=revision+1,updated_at=now()
            where id=$1`, [member.id, owner, nextState])
        await recordCampaignEvent(client, {
            campaignId: member.campaign_id,
            memberId: member.id,
            eventType: outcomeCode ? 'member_outcome' : 'member_assigned',
            actorRef,
            traceId: randomUUID(),
            payload: outcomeCode
                ? { state: nextState, outcomeCode, reasonDigest }
                : { state: nextState, ownerChanged: owner !== null, reasonDigest },
        })
    }
}

async function campaignProjection(client, campaignId, actor) {
    const scope = requestedUnitScope(actor)
    const params = [campaignId]
    const where = ["campaign.id=$1", scopeWhere(scope, params)]
    const result = await client.query(`select campaign.id::text,campaign.name,campaign.revision,campaign.segment_key,campaign.segment_version,
            campaign.filters_snapshot,campaign.context_hash,campaign.cutoff_at,unit.slug as unit_slug,campaign.owner,campaign.offer_id::text,
            campaign.assignment_window_start,campaign.assignment_window_end,campaign.control_group_percent,campaign.state,campaign.author,
            campaign.created_at,campaign.updated_at,
            count(member.id)::int as member_total,
            count(member.id) filter(where member.state='eligible')::int as member_eligible,
            count(member.id) filter(where member.state='blocked')::int as member_blocked,
            count(member.id) filter(where member.state='review')::int as member_review,
            count(member.id) filter(where member.state='control')::int as member_control,
            count(member.id) filter(where member.state='assigned')::int as member_assigned,
            count(member.id) filter(where member.state='completed')::int as member_completed,
            count(member.id) filter(where member.state='cancelled')::int as member_cancelled
        from crm_atendimento.commercial_campaigns campaign
        join crm_atendimento.units unit on unit.id=campaign.unit_id
        left join crm_atendimento.commercial_campaign_members member on member.campaign_id=campaign.id
        where ${where.join(' and ')}
        group by campaign.id,unit.slug`, params)
    if (!result.rows[0]) throw operationalError('COMMERCIAL_CAMPAIGN_NOT_FOUND', 404)
    return mapCampaign(result.rows[0])
}

async function createCampaign(client, payload, actor) {
    const campaign = normalizeCampaignPayload(payload)
    const unitSlug = assertUnitAllowed(actor, campaign.unit)
    const contextHash = stableOperationFingerprint(frozenCampaignContext(campaign))
    return runCommercialOperationMutation(client, {
        actor,
        operation: 'campaign_create',
        payload,
        fingerprintPayload: { campaign: frozenCampaignContext(campaign), contextHash },
        execute: async ({ actorRef }) => {
            const unit = await resolveCampaignUnit(client, unitSlug)
            // Do this before the campaign/cohort write path.  A missing
            // Analytics migration is treated as unknown eligibility and is
            // rejected by the guard rather than allowing a silent crossover.
            await assertNoActiveExperimentHoldout(client, {
                unitId: unit.id,
                identityIds: campaign.identityIds,
            })
            await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`commercial-operations:campaign:${unit.id}:${contextHash}`])
            const existing = await client.query(`select id::text from crm_atendimento.commercial_campaigns
                where unit_id=$1 and context_hash=$2
                order by created_at asc,id asc limit 1 for update`, [unit.id, contextHash])
            if (existing.rows[0]?.id) {
                const persisted = await campaignProjection(client, existing.rows[0].id, actor)
                return { campaign: persisted, cohort: { ...persisted.members }, deduplicated: true }
            }
            const dependencies = await campaignCohortDependencies(client)
            const stale = await sourceStale(client, await operationalDependencies(client))
            if (campaign.offerId) {
                const offer = await client.query(`select id from crm_atendimento.commercial_offers where id=$1`, [campaign.offerId])
                if (!offer.rows[0]?.id) throw operationalError('COMMERCIAL_CAMPAIGN_OFFER_NOT_FOUND', 404)
            }
            const cohort = await readCampaignCohort(client, {
                identityIds: [...campaign.identityIds].sort(), unitSlug, dependencies, globalSourceStale: stale,
            })
            const created = await client.query(`insert into crm_atendimento.commercial_campaigns(
                    name,segment_key,segment_version,filters_snapshot,context_hash,cutoff_at,unit_id,owner,offer_id,
                    assignment_window_start,assignment_window_end,control_group_percent,state,author,reason)
                values($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                returning id::text`, [
                campaign.name, campaign.segmentKey, campaign.segmentVersion, JSON.stringify(campaign.filters), contextHash,
                campaign.cutoffAt, unit.id, campaign.owner, campaign.offerId, campaign.assignmentWindowStart,
                campaign.assignmentWindowEnd, campaign.controlGroupPercent, campaign.state, actorRef, `digest:${digest('campaign-reason', { reason: campaign.reason })}`,
            ])
            const campaignId = created.rows[0]?.id
            if (!campaignId) throw operationalError('COMMERCIAL_CAMPAIGN_CREATE_FAILED', 500)
            const traceId = randomUUID()
            await recordCampaignEvent(client, {
                campaignId, eventType: 'created', actorRef, traceId,
                payload: { contextHash, cohortCount: cohort.length, controlGroupPercent: campaign.controlGroupPercent },
            })
            const stateCounts = { eligible: 0, blocked: 0, review: 0, control: 0, assigned: 0, completed: 0, cancelled: 0 }
            for (const member of cohort) {
                const controlGroup = member.eligible && !member.sourceStale && !member.identityInReview && stableControlGroup({
                    campaignSeed: contextHash, identityId: member.identityId, percentage: campaign.controlGroupPercent,
                })
                const state = campaignMemberState({
                    eligible: member.eligible, controlGroup, identityInReview: member.identityInReview, sourceStale: member.sourceStale,
                })
                stateCounts[state] += 1
                const eligibilitySnapshot = {
                    permissionStatus: member.permissionStatus,
                    sourceStale: member.sourceStale,
                    identityInReview: member.identityInReview,
                    evaluatedAt: new Date().toISOString(),
                }
                const inserted = await client.query(`insert into crm_atendimento.commercial_campaign_members(
                        campaign_id,identity_id,unit_id,segment_key,segment_version,cutoff_at,owner,offer_id,control_group,state,eligibility_snapshot)
                    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) returning id::text`, [
                    campaignId, member.identityId, unit.id, campaign.segmentKey, campaign.segmentVersion, campaign.cutoffAt,
                    campaign.owner, campaign.offerId, controlGroup, state, JSON.stringify(eligibilitySnapshot),
                ])
                await recordCampaignEvent(client, {
                    campaignId, memberId: inserted.rows[0]?.id || null, eventType: 'member_added', actorRef, traceId: randomUUID(),
                    payload: { state, controlGroup },
                })
            }
            return {
                campaign: await campaignProjection(client, campaignId, actor),
                cohort: { total: cohort.length, ...stateCounts },
            }
        },
    })
}

async function listCampaigns(pgPool, query, actor) {
    const scope = requestedUnitScope(actor, query?.unit)
    const state = text(query?.state).toLowerCase()
    if (state && !COMMERCIAL_CAMPAIGN_STATES.includes(state)) throw operationalError('INVALID_COMMERCIAL_CAMPAIGN_STATE', 400)
    const limit = normalizeLimit(query?.limit)
    const offset = normalizeOffset(query?.offset)
    const params = []
    const where = [scopeWhere(scope, params)]
    if (state) { params.push(state); where.push(`campaign.state=$${params.length}`) }
    params.push(limit, offset)
    const result = await pgPool.query(`select campaign.id::text,campaign.name,campaign.revision,campaign.segment_key,campaign.segment_version,
            campaign.filters_snapshot,campaign.context_hash,campaign.cutoff_at,unit.slug as unit_slug,campaign.owner,campaign.offer_id::text,
            campaign.assignment_window_start,campaign.assignment_window_end,campaign.control_group_percent,campaign.state,campaign.author,
            campaign.created_at,campaign.updated_at,
            count(member.id)::int as member_total,
            count(member.id) filter(where member.state='eligible')::int as member_eligible,
            count(member.id) filter(where member.state='blocked')::int as member_blocked,
            count(member.id) filter(where member.state='review')::int as member_review,
            count(member.id) filter(where member.state='control')::int as member_control,
            count(member.id) filter(where member.state='assigned')::int as member_assigned,
            count(member.id) filter(where member.state='completed')::int as member_completed,
            count(member.id) filter(where member.state='cancelled')::int as member_cancelled,
            count(*) over()::int as total_count
        from crm_atendimento.commercial_campaigns campaign
        join crm_atendimento.units unit on unit.id=campaign.unit_id
        left join crm_atendimento.commercial_campaign_members member on member.campaign_id=campaign.id
        where ${where.join(' and ')}
        group by campaign.id,unit.slug
        order by campaign.updated_at desc,campaign.id asc
        limit $${params.length - 1} offset $${params.length}`, params)
    const campaigns = (result.rows || []).map(mapCampaign)
    return {
        total: count(result.rows?.[0]?.total_count), limit, offset, campaigns,
        pagination: { hasPrevious: offset > 0, hasNext: offset + campaigns.length < count(result.rows?.[0]?.total_count) },
        safety: operationSafety(),
    }
}

async function campaignDetail(pgPool, campaignId, query, actor) {
    const id = assertUuid(campaignId, 'INVALID_COMMERCIAL_CAMPAIGN')
    if (query?.unit) assertUnitAllowed(actor, query.unit)
    const campaign = await campaignProjection(pgPool, id, actor)
    const events = await pgPool.query(`select event_order,event_type,actor_id,trace_id,created_at,
            case when payload->>'state' in ('eligible','blocked','review','control','assigned','completed','cancelled') then payload->>'state' else null end as member_state,
            case when payload->>'outcomeCode' ~ '^[a-z_]{2,80}$' then payload->>'outcomeCode' else null end as outcome_code
        from crm_atendimento.commercial_campaign_events
        where campaign_id=$1 order by event_order desc limit $2`, [id, normalizeLimit(query?.eventLimit, 50, 100)])
    return { campaign, events: (events.rows || []).map(mapCampaignEvent), safety: operationSafety() }
}

async function updateCampaign(client, campaignId, payload, actor) {
    const id = assertUuid(campaignId, 'INVALID_COMMERCIAL_CAMPAIGN')
    const stateProvided = Object.prototype.hasOwnProperty.call(payload || {}, 'state')
    const state = stateProvided ? text(payload.state).toLowerCase() : null
    if (Object.prototype.hasOwnProperty.call(payload || {}, 'owner') ||
        Object.prototype.hasOwnProperty.call(payload || {}, 'filters') ||
        Object.prototype.hasOwnProperty.call(payload || {}, 'segmentKey') ||
        Object.prototype.hasOwnProperty.call(payload || {}, 'segmentVersion') ||
        Object.prototype.hasOwnProperty.call(payload || {}, 'identityIds') ||
        Object.prototype.hasOwnProperty.call(payload || {}, 'offerId') ||
        Object.prototype.hasOwnProperty.call(payload || {}, 'unit')) {
        throw operationalError('COMMERCIAL_CAMPAIGN_FROZEN_CONTEXT', 409)
    }
    if (!stateProvided) throw operationalError('COMMERCIAL_CAMPAIGN_CHANGE_REQUIRED', 400)
    if (stateProvided && !COMMERCIAL_CAMPAIGN_STATES.includes(state)) throw operationalError('INVALID_COMMERCIAL_CAMPAIGN_STATE', 400)
    return runCommercialOperationMutation(client, {
        actor,
        operation: 'campaign_update',
        payload,
        fingerprintPayload: { campaignId: id, state, expectedRevision: payload?.expectedRevision, reason: text(payload?.reason) },
        execute: async ({ mutation, actorRef }) => {
            const current = await client.query(`select campaign.id::text,campaign.revision,campaign.state,unit.slug as unit_slug
                from crm_atendimento.commercial_campaigns campaign
                join crm_atendimento.units unit on unit.id=campaign.unit_id
                where campaign.id=$1 for update of campaign`, [id])
            const row = current.rows[0]
            if (!row?.id) throw operationalError('COMMERCIAL_CAMPAIGN_NOT_FOUND', 404)
            assertUnitAllowed(actor, row.unit_slug)
            if (mutation.expectedRevision == null || count(row.revision) !== mutation.expectedRevision) {
                throw operationalError('COMMERCIAL_CAMPAIGN_CONFLICT', 409)
            }
            if (state === row.state) throw operationalError('COMMERCIAL_CAMPAIGN_CHANGE_REQUIRED', 400)
            await client.query(`update crm_atendimento.commercial_campaigns
                set state=$2,revision=revision+1,updated_at=now()
                where id=$1`, [id, state])
            await recordCampaignEvent(client, {
                campaignId: id, eventType: 'state_changed', actorRef, traceId: randomUUID(),
                payload: { previousState: row.state, state,
                    reasonDigest: digest('campaign-update-reason', { reason: mutation.reason }) },
            })
            return { campaign: await campaignProjection(client, id, actor) }
        },
    })
}

async function actionProjection(client, actionId, actor) {
    const scope = requestedUnitScope(actor)
    const dependencies = await operationalDependencies(client)
    const [globalSourceStale] = await Promise.all([sourceStale(client, dependencies)])
    const permission = permissionSql(dependencies)
    const identityReview = identityReviewSql(dependencies)
    const params = [actionId]
    const where = ['action.id=$1', scopeWhere(scope, params)]
    params.push(globalSourceStale)
    const result = await client.query(`select action.id::text,action.segment_key,action.action_type,action.status,action.owner,
            action.due_date,action.revision,action.outcome_code,action.created_at,action.updated_at,
            unit.slug as unit_slug,${permission.status} as permission_status,${permission.expiresAt} as permission_expires_at,
            $${params.length}::boolean as source_stale,${identityReview} as identity_in_review
        from crm_atendimento.commercial_actions action
        join crm_atendimento.units unit on unit.id=action.unit_id
        ${permission.join}
        where ${where.join(' and ')}`, params)
    if (!result.rows[0]) throw operationalError('COMMERCIAL_ACTION_NOT_FOUND', 404)
    return mapWalletAction(result.rows[0], actor)
}

async function actionForMutation(client, actionId, actor) {
    const id = assertUuid(actionId, 'INVALID_COMMERCIAL_ACTION')
    const result = await client.query(`select action.id::text,action.identity_id::text,action.revision,action.status,action.owner,
            action.unit_id::text as unit_id,unit.slug as unit_slug
        from crm_atendimento.commercial_actions action
        join crm_atendimento.units unit on unit.id=action.unit_id
        where action.id=$1 for update of action`, [id])
    const action = result.rows[0]
    if (!action?.id) throw operationalError('COMMERCIAL_ACTION_NOT_FOUND', 404)
    assertUnitAllowed(actor, action.unit_slug)
    return action
}

async function reassignAction(client, actionId, payload, actor) {
    const id = assertUuid(actionId, 'INVALID_COMMERCIAL_ACTION')
    const owner = safeOwner(payload?.owner, { required: true })
    return runCommercialOperationMutation(client, {
        actor,
        operation: 'action_reassign',
        payload,
        fingerprintPayload: { actionId: id, owner, expectedRevision: payload?.expectedRevision, reason: text(payload?.reason) },
        execute: async ({ mutation, actorRef }) => {
            const action = await actionForMutation(client, id, actor)
            if (mutation.expectedRevision == null || count(action.revision) !== mutation.expectedRevision) {
                throw operationalError('COMMERCIAL_ACTION_CONFLICT', 409)
            }
            if (owner === action.owner) throw operationalError('COMMERCIAL_ACTION_REASSIGNMENT_UNCHANGED', 400)
            await assertNoActiveExperimentHoldout(client, {
                unitId: action.unit_id,
                identityIds: [action.identity_id],
            })
            await client.query(`update crm_atendimento.commercial_actions
                set owner=$2,revision=revision+1,updated_by=$3,updated_at=now()
                where id=$1`, [id, owner, actorRef])
            const reasonDigest = digest('action-reassign-reason', { reason: mutation.reason })
            await recordActionEvent(client, {
                actionId: id, identityId: action.identity_id, previousStatus: action.status, status: action.status,
                actorRef, traceId: randomUUID(),
                details: { operation: 'reassign', ownerChanged: true, reasonDigest },
            })
            await synchronizeCampaignMembershipForAction(client, {
                actionId: id, owner, status: action.status, actorRef, reasonDigest,
            })
            return { action: await actionProjection(client, id, actor) }
        },
    })
}

async function recordActionOutcome(client, actionId, payload, actor) {
    const id = assertUuid(actionId, 'INVALID_COMMERCIAL_ACTION')
    const outcomeCode = normalizeOutcomeCode(payload?.outcomeCode)
    if (!outcomeCode) throw operationalError('INVALID_COMMERCIAL_OUTCOME', 400)
    const nextStatus = OUTCOME_STATUSES[outcomeCode]
    return runCommercialOperationMutation(client, {
        actor,
        // The migration deliberately keeps structured outcomes under the
        // existing audited action-update operation; it does not create a send
        // operation or consent mutation.
        operation: 'action_update',
        payload,
        fingerprintPayload: { actionId: id, outcomeCode, expectedRevision: payload?.expectedRevision, reason: text(payload?.reason) },
        execute: async ({ mutation, actorRef }) => {
            const action = await actionForMutation(client, id, actor)
            if (mutation.expectedRevision == null || count(action.revision) !== mutation.expectedRevision) {
                throw operationalError('COMMERCIAL_ACTION_CONFLICT', 409)
            }
            await client.query(`update crm_atendimento.commercial_actions
                set status=$2,outcome_code=$3,outcome_recorded_at=now(),
                    completed_at=case when $2 in ('won_sale','returned','closed','cancelled') then now() else completed_at end,
                    revision=revision+1,updated_by=$4,updated_at=now()
                where id=$1`, [id, nextStatus, outcomeCode, actorRef])
            const reasonDigest = digest('action-outcome-reason', { reason: mutation.reason })
            await recordActionEvent(client, {
                actionId: id, identityId: action.identity_id, previousStatus: action.status, status: nextStatus,
                outcomeCode, actorRef, traceId: randomUUID(),
                details: { operation: 'outcome', reasonDigest },
            })
            await synchronizeCampaignMembershipForAction(client, {
                actionId: id, status: nextStatus, outcomeCode, actorRef, reasonDigest,
            })
            return {
                action: await actionProjection(client, id, actor),
                // This is an operational signal only. A distinct consent flow
                // must review the request; this module never records it.
                requiresSeparateConsentWorkflow: outcomeCode === 'opt_out_requested',
            }
        },
    })
}

function normalizeAbsencePayload(payload) {
    const unit = text(payload?.unit).toLowerCase()
    const owner = safeOwner(payload?.owner, { required: true })
    const absenceType = text(payload?.absenceType || payload?.type).toLowerCase()
    const substituteOwner = payload?.substituteOwner == null || payload?.substituteOwner === ''
        ? null : safeOwner(payload.substituteOwner, { required: true })
    const absenceId = payload?.absenceId ? assertUuid(payload.absenceId, 'INVALID_COMMERCIAL_ABSENCE') : null
    if (!UNIT_RE.test(unit)) throw operationalError('INVALID_COMMERCIAL_UNIT', 400)
    if (!ABSENCE_TYPES.has(absenceType)) throw operationalError('INVALID_COMMERCIAL_ABSENCE_TYPE', 400)
    const range = normalizeDateRange(payload?.startsAt, payload?.endsAt, 'INVALID_COMMERCIAL_ABSENCE_RANGE')
    return { absenceId, unit, owner, absenceType, substituteOwner, ...range }
}

function mapAbsence(row = {}) {
    return {
        absenceId: text(row.id),
        unit: text(row.unit_slug || row.unit),
        owner: projectOwner(row.owner) || 'unassigned',
        type: text(row.absence_type),
        startsAt: dateOnly(row.starts_at),
        endsAt: dateOnly(row.ends_at),
        substituteOwner: projectOwner(row.substitute_owner),
        revision: count(row.revision) || 1,
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    }
}

async function upsertAbsence(client, payload, actor) {
    const absence = normalizeAbsencePayload(payload)
    const unitSlug = assertUnitAllowed(actor, absence.unit)
    return runCommercialOperationMutation(client, {
        actor,
        operation: 'absence_upsert',
        payload,
        fingerprintPayload: { ...absence, expectedRevision: payload?.expectedRevision, reason: text(payload?.reason) },
        execute: async ({ mutation, actorRef }) => {
            const unit = await resolveCampaignUnit(client, unitSlug)
            const current = await client.query(`select absence.id::text,absence.owner,absence.absence_type,absence.starts_at,absence.ends_at,
                    absence.substitute_owner,absence.revision,unit.slug as unit_slug,absence.created_at,absence.updated_at
                from crm_atendimento.commercial_owner_absences absence
                join crm_atendimento.units unit on unit.id=absence.unit_id
                where ${absence.absenceId ? 'absence.id=$1' : 'absence.owner=$1 and absence.unit_id=$2 and absence.starts_at=$3 and absence.ends_at=$4'}
                for update of absence`, absence.absenceId
                ? [absence.absenceId]
                : [absence.owner, unit.id, absence.startsAt, absence.endsAt])
            const row = current.rows[0]
            if (row) {
                assertUnitAllowed(actor, row.unit_slug)
                if (text(row.unit_slug).toLowerCase() !== unitSlug) {
                    throw operationalError('COMMERCIAL_ABSENCE_UNIT_CONFLICT', 409)
                }
                if (mutation.expectedRevision == null || count(row.revision) !== mutation.expectedRevision) {
                    throw operationalError('COMMERCIAL_ABSENCE_CONFLICT', 409)
                }
                await client.query(`update crm_atendimento.commercial_owner_absences
                    set owner=$2,absence_type=$3,starts_at=$4,ends_at=$5,substitute_owner=$6,
                        reason=$7,revision=revision+1,updated_by=$8,updated_at=now()
                    where id=$1`, [
                    row.id, absence.owner, absence.absenceType, absence.startsAt, absence.endsAt, absence.substituteOwner,
                    `digest:${digest('absence-reason', { reason: mutation.reason })}`, actorRef,
                ])
                const updated = await client.query(`select absence.id::text,absence.owner,absence.absence_type,absence.starts_at,absence.ends_at,
                        absence.substitute_owner,absence.revision,unit.slug as unit_slug,absence.created_at,absence.updated_at
                    from crm_atendimento.commercial_owner_absences absence
                    join crm_atendimento.units unit on unit.id=absence.unit_id where absence.id=$1`, [row.id])
                return { absence: mapAbsence(updated.rows[0]) }
            }
            if (mutation.expectedRevision != null) throw operationalError('COMMERCIAL_ABSENCE_NOT_FOUND', 404)
            const inserted = await client.query(`insert into crm_atendimento.commercial_owner_absences(
                    owner,unit_id,absence_type,starts_at,ends_at,substitute_owner,reason,created_by,updated_by)
                values($1,$2,$3,$4,$5,$6,$7,$8,$8)
                returning id::text,owner,absence_type,starts_at,ends_at,substitute_owner,revision,created_at,updated_at`, [
                absence.owner, unit.id, absence.absenceType, absence.startsAt, absence.endsAt, absence.substituteOwner,
                `digest:${digest('absence-reason', { reason: mutation.reason })}`, actorRef,
            ])
            return { absence: mapAbsence({ ...inserted.rows[0], unit_slug: unitSlug }) }
        },
    })
}

async function rebalanceActions(client, scope, { lock = false } = {}) {
    const params = []
    const where = [scopeWhere(scope, params), `action.status=any($${params.push(ACTIVE_ACTION_STATUSES)}::text[])`]
    const result = await client.query(`select action.id::text,action.identity_id::text,action.unit_id::text as unit_id,action.owner,action.status,action.revision,
            unit.slug as unit_slug,
            exists(select 1 from crm_atendimento.commercial_owner_absences absence
                where absence.unit_id=action.unit_id and absence.owner=action.owner
                  and current_date between absence.starts_at and absence.ends_at) as absent_owner
        from crm_atendimento.commercial_actions action
        join crm_atendimento.units unit on unit.id=action.unit_id
        where ${where.join(' and ')}
        order by action.due_date asc nulls last,action.id asc${lock ? ' for update of action' : ''}`, params)
    return (result.rows || []).map((row) => ({ ...row, absentOwner: bool(row.absent_owner) }))
}

function projectRebalancePlan(actions, capacities) {
    const normalizedActions = actions.map((action) => ({
        ...action,
        absentOwner: action.absentOwner === true || action.absent_owner === true,
    }))
    const moves = planWalletBalance(normalizedActions, capacities)
    const byId = new Map(actions.map((action) => [text(action.id).toLowerCase(), action]))
    return moves.map((move) => {
        const action = byId.get(text(move.actionId).toLowerCase())
        return {
            actionId: text(move.actionId).toLowerCase(),
            fromOwner: projectOwner(move.fromOwner),
            toOwner: projectOwner(move.toOwner),
            expectedRevision: count(action?.revision) || 1,
            unit: text(action?.unit_slug) || null,
        }
    }).filter((move) => UUID_RE.test(move.actionId) && move.toOwner)
}

async function previewRebalance(pgPool, payload, actor) {
    const capacities = normalizeCapacities(payload?.capacities)
    const scope = requestedUnitScope(actor, payload?.unit)
    const actions = await rebalanceActions(pgPool, scope)
    const moves = projectRebalancePlan(actions, capacities)
    return {
        unit: scope.unit || null,
        capacities,
        totalEligibleActions: actions.length,
        moves,
        safety: operationSafety(),
    }
}

async function applyRebalance(client, payload, actor) {
    const capacities = normalizeCapacities(payload?.capacities)
    const expectedRevisions = normalizeExpectedRevisions(payload?.expectedRevisions)
    const scope = requestedUnitScope(actor, payload?.unit)
    return runCommercialOperationMutation(client, {
        actor,
        operation: 'rebalance',
        payload,
        fingerprintPayload: {
            unit: scope.unit || scope.unitSlugs || 'all', capacities, expectedRevisions,
            reason: text(payload?.reason),
        },
        execute: async ({ mutation, actorRef }) => {
            // A scope-specific lock establishes a single plan writer.  The
            // action rows are then locked before their revisions are compared.
            await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [
                `commercial-operations:rebalance:${scope.unit || (scope.unitSlugs || ['all']).join(',')}`,
            ])
            const actions = await rebalanceActions(client, scope, { lock: true })
            const moves = projectRebalancePlan(actions, capacities)
            const plannedIds = new Set(moves.map((move) => move.actionId))
            const expectedIds = Object.keys(expectedRevisions)
            if (plannedIds.size !== expectedIds.length || expectedIds.some((id) => !plannedIds.has(id))) {
                throw operationalError('COMMERCIAL_REBALANCE_PLAN_CONFLICT', 409)
            }
            if (moves.some((move) => expectedRevisions[move.actionId] !== move.expectedRevision)) {
                throw operationalError('COMMERCIAL_REBALANCE_CONFLICT', 409)
            }
            const byId = new Map(actions.map((action) => [text(action.id).toLowerCase(), action]))
            const identitiesByUnit = new Map()
            for (const move of moves) {
                const action = byId.get(move.actionId)
                if (!action) continue
                const unitId = assertUuid(action.unit_id, 'INVALID_COMMERCIAL_EXPERIMENT_UNIT')
                const identities = identitiesByUnit.get(unitId) || []
                identities.push(action.identity_id)
                identitiesByUnit.set(unitId, identities)
            }
            for (const [unitId, identityIds] of [...identitiesByUnit.entries()].sort(([left], [right]) => left.localeCompare(right))) {
                await assertNoActiveExperimentHoldout(client, { unitId, identityIds })
            }
            const applied = []
            for (const move of moves) {
                const action = byId.get(move.actionId)
                if (!action || count(action.revision) !== move.expectedRevision) {
                    throw operationalError('COMMERCIAL_REBALANCE_CONFLICT', 409)
                }
                await client.query(`update crm_atendimento.commercial_actions
                    set owner=$2,revision=revision+1,updated_by=$3,updated_at=now()
                    where id=$1`, [move.actionId, move.toOwner, actorRef])
                await recordActionEvent(client, {
                    actionId: move.actionId,
                    identityId: action.identity_id,
                    previousStatus: action.status,
                    status: action.status,
                    actorRef,
                    traceId: randomUUID(),
                    details: { operation: 'rebalance', ownerChanged: true, rebalance: true,
                        reasonDigest: digest('rebalance-reason', { reason: mutation.reason }) },
                })
                const memberships = await client.query(`update crm_atendimento.commercial_campaign_members
                    set owner=$2,revision=revision+1,updated_at=now()
                    where action_id=$1
                    returning id::text,campaign_id::text`, [move.actionId, move.toOwner])
                for (const member of memberships.rows || []) {
                    await recordCampaignEvent(client, {
                        campaignId: member.campaign_id,
                        memberId: member.id,
                        eventType: 'rebalanced',
                        actorRef,
                        traceId: randomUUID(),
                        payload: { fromOwner: move.fromOwner, toOwner: move.toOwner },
                    })
                }
                applied.push({ ...move, revision: move.expectedRevision + 1 })
            }
            return { moves: applied, moved: applied.length }
        },
    })
}

function opaqueTimelineId(source, id) {
    const prefix = /^[a-z_]{2,40}$/i.test(text(source)) ? text(source).toLowerCase() : 'event'
    return `${prefix}:${stableOperationFingerprint({ prefix, id: text(id) }).slice(0, 24)}`
}

function timelineActionType(row) {
    const outcome = normalizeOutcomeCode(row.outcome_code)
    if (outcome === 'opt_out_requested') return 'opt_out'
    if (text(row.status) === 'contacted' || outcome === 'no_response' || outcome === 'wrong_number') return 'contact'
    if (text(row.status) === 'responded' || outcome === 'requested_follow_up') return 'response'
    if (text(row.status) === 'scheduled' || outcome === 'scheduled') return 'appointment'
    return 'action'
}

function projectTimeline(row) {
    const event = projectCommercialTimelineEvent(row)
    return { ...event, id: opaqueTimelineId(event.source || event.type, row.id || row.event_id) }
}

async function assertCustomer360Scope(pgPool, identityId, query, actor) {
    const scope = requestedUnitScope(actor, query?.unit)
    // Customer 360 must always be anchored to one unit.  Even a global actor
    // cannot accidentally request an unbounded identity timeline.
    if (!scope.unit) throw operationalError('COMMERCIAL_CUSTOMER_360_UNIT_REQUIRED', 400)
    const dependencies = await campaignCohortDependencies(pgPool)
    const permissions = await operationalDependencies(pgPool)
    const stale = await sourceStale(pgPool, permissions)
    await readCampaignCohort(pgPool, {
        identityIds: [identityId],
        unitSlug: scope.unit,
        dependencies,
        globalSourceStale: stale,
    })
    return { unit: scope.unit, dependencies: permissions, sourceStale: stale }
}

async function customer360(pgPool, identityId, query, actor) {
    const id = assertUuid(identityId, 'INVALID_COMMERCIAL_IDENTITY')
    const { unit, dependencies, sourceStale } = await assertCustomer360Scope(pgPool, id, query, actor)
    const limit = normalizeLimit(query?.limit, 100, 200)
    const eventLimit = Math.max(20, Math.min(100, limit))
    const [actions, campaigns, permissions, attendance, sales, decisions] = await Promise.all([
        pgPool.query(`select event.id::text,event.status,event.outcome_code,event.trace_id,event.recorded_by as actor,
                event.created_at,unit.slug as unit_slug
            from crm_atendimento.commercial_action_events event
            join crm_atendimento.commercial_actions action on action.id=event.action_id
            join crm_atendimento.units unit on unit.id=action.unit_id
            where event.identity_id=$1 and unit.slug=$2
            order by event.event_order desc limit $3`, [id, unit, eventLimit]),
        pgPool.query(`select event.id::text,event.event_type,event.trace_id,event.actor_id as actor,event.created_at,
                unit.slug as unit_slug,campaign.id::text as campaign_id,campaign.offer_id::text as offer_id
            from crm_atendimento.commercial_campaign_members member
            join crm_atendimento.commercial_campaigns campaign on campaign.id=member.campaign_id
            join crm_atendimento.units unit on unit.id=campaign.unit_id
            join crm_atendimento.commercial_campaign_events event on event.campaign_id=campaign.id and (event.member_id=member.id or event.member_id is null)
            where member.identity_id=$1 and unit.slug=$2
            order by event.event_order desc limit $3`, [id, unit, eventLimit]),
        dependencies.permissions
            ? pgPool.query(`select event.id::text,event.status,event.trace_id,event.recorded_by as actor,event.created_at
                from crm_atendimento.commercial_contact_permission_events event
                where event.identity_id=$1
                order by event.created_at desc limit $2`, [id, eventLimit])
            : Promise.resolve({ rows: [] }),
        pgPool.query(`select attendance.id::text,attendance.service_date as occurred_at,unit.slug as unit_slug
            from crm_atendimento.global_client_identity_members member
            join crm_atendimento.attendance_client_links link on link.client_id=member.source_id::uuid
            join crm_atendimento.attendances attendance on attendance.id=link.attendance_id and attendance.deleted_at is null
            join crm_atendimento.units unit on unit.id=attendance.unit_id
            where member.identity_id=$1 and member.source_type='attendance_client' and member.source_id ~ '^[0-9a-fA-F-]{36}$' and unit.slug=$2
            order by attendance.service_date desc limit $3`, [id, unit, eventLimit]),
        pgPool.query(`select sale.id::text,sale.occurred_on as occurred_at,unit.slug as unit_slug
            from crm_atendimento.global_client_identity_members member
            join crm_caixa.sales sale on sale.customer_id=member.source_id::uuid
            join crm_atendimento.units unit on unit.id=sale.unit_id
            where member.identity_id=$1 and member.source_type='caixa_customer' and member.source_id ~ '^[0-9a-fA-F-]{36}$' and unit.slug=$2
            order by sale.occurred_on desc limit $3`, [id, unit, eventLimit]),
        dependencies.identityReview
            ? pgPool.query(`select decision.id::text,decision.decision as status,decision.created_at
                from crm_atendimento.identity_review_decisions decision
                where exists(select 1 from crm_atendimento.global_client_identity_members member
                    where member.identity_id=$1 and (member.source_id=decision.source_id or member.source_id=decision.target_id))
                order by decision.event_order desc limit $2`, [id, eventLimit])
            : Promise.resolve({ rows: [] }),
    ])
    const events = [
        ...(actions.rows || []).map((row) => projectTimeline({
            id: row.id, type: timelineActionType(row), occurredAt: row.created_at, source: 'CRM ação', unit: row.unit_slug,
            actor: row.actor, correlationId: row.trace_id, status: row.status,
        })),
        ...(campaigns.rows || []).map((row) => projectTimeline({
            id: row.id, type: 'campaign', occurredAt: row.created_at, source: 'CRM campanha', unit: row.unit_slug,
            actor: row.actor, correlationId: row.trace_id, campaignId: row.campaign_id, offerId: row.offer_id,
            status: row.event_type,
        })),
        ...(permissions.rows || []).map((row) => projectTimeline({
            id: row.id, type: 'permission', occurredAt: row.created_at, source: 'Governança de permissão', unit,
            actor: row.actor, correlationId: row.trace_id, consentReview: row.status, status: row.status,
        })),
        ...(attendance.rows || []).map((row) => projectTimeline({
            id: row.id, type: 'attendance', occurredAt: row.occurred_at, source: 'Atendimento', unit: row.unit_slug, status: 'confirmed',
        })),
        ...(sales.rows || []).map((row) => projectTimeline({
            id: row.id, type: 'sale', occurredAt: row.occurred_at, source: 'Caixa', unit: row.unit_slug, status: 'confirmed',
        })),
        ...(decisions.rows || []).map((row) => projectTimeline({
            id: row.id, type: 'identity_decision', occurredAt: row.created_at, source: 'Revisão de identidade', unit, status: row.status,
        })),
    ]
    if (sourceStale) {
        events.push(projectTimeline({
            id: `source-freshness:${unit}`, type: 'quality_finding', occurredAt: new Date().toISOString(),
            source: 'Clientes fontes', unit, status: 'source_stale',
        }))
    }
    events.sort((left, right) => String(right.occurredAt || '').localeCompare(String(left.occurredAt || '')) || left.id.localeCompare(right.id))
    return {
        unit,
        events: events.slice(0, limit),
        partial: !dependencies.permissions || !dependencies.identityReview,
        safety: operationSafety(),
    }
}

export function createCommercialOperationsStore({ pool, databaseUrl } = {}) {
    const pgPool = pool || createPgPool(databaseUrl || process.env.DATABASE_URL)

    const assertReadAccess = async (actor) => {
        requirePool(pgPool)
        assertCommercialOperationsManager(actor)
        await assertCommercialOperationsReady(pgPool)
    }
    const assertMutationAccess = (actor) => {
        requirePool(pgPool)
        assertCommercialOperationsManager(actor)
    }

    return {
        async readiness(actor) {
            requirePool(pgPool)
            assertCommercialOperationsManager(actor)
            const readiness = await commercialOperationsReadiness(pgPool)
            // Analytics is an explicit write-guard dependency rather than a
            // prerequisite for the read-only Operations surface.  Report it
            // separately so an operator can see why cohort/assignment writes
            // remain fail-closed before the Analytics migration is promoted.
            const experimentCrossoverGuard = readiness.ready
                ? await experimentCrossoverGuardReadiness(pgPool)
                : { ready: false, assignments: false, experiments: false, assignmentsRead: false, experimentsRead: false, migrationReady: false }
            return { ...readiness, experimentCrossoverGuard }
        },

        async wallet(query, actor) {
            await assertReadAccess(actor)
            return queryWallet(pgPool, query, actor)
        },

        async team(query, actor) {
            await assertReadAccess(actor)
            return queryTeam(pgPool, query, actor)
        },

        async campaigns(query, actor) {
            await assertReadAccess(actor)
            return listCampaigns(pgPool, query, actor)
        },

        async campaign(campaignId, query, actor) {
            await assertReadAccess(actor)
            return campaignDetail(pgPool, campaignId, query, actor)
        },

        async customer360(identityId, query, actor) {
            await assertReadAccess(actor)
            return customer360(pgPool, identityId, query, actor)
        },

        async previewRebalance(payload, actor) {
            await assertReadAccess(actor)
            return previewRebalance(pgPool, payload, actor)
        },

        async createCampaign(payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => createCampaign(client, payload, actor))
        },

        async updateCampaign(campaignId, payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => updateCampaign(client, campaignId, payload, actor))
        },

        async reassignAction(actionId, payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => reassignAction(client, actionId, payload, actor))
        },

        async recordOutcome(actionId, payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => recordActionOutcome(client, actionId, payload, actor))
        },

        async upsertAbsence(payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => upsertAbsence(client, payload, actor))
        },

        async applyRebalance(payload, actor) {
            assertMutationAccess(actor)
            return withPgTransaction(pgPool, (client) => applyRebalance(client, payload, actor))
        },
    }
}

export const __testables = {
    ABSENCE_TYPES,
    ACTION_STATUSES,
    COMMERCIAL_ANALYTICS_EXPERIMENT_MIGRATION_ID,
    COMMERCIAL_REQUIRED_SOURCE_IDS,
    COMMERCIAL_OPERATIONS_SAFETY_FLAGS,
    EXPERIMENT_CROSSOVER_BLOCKING_VARIANTS,
    activeExperimentHoldouts,
    activeActionStatuses: ACTIVE_ACTION_STATUSES,
    actionFlagSql,
    assertNoActiveExperimentHoldout,
    commercialOperationsUnitScope,
    experimentCrossoverGuardReadiness,
    mapWalletAction,
    mutationInput,
    normalizeCapacities,
    normalizeExpectedRevisions,
    opaqueTimelineId,
    operationSafety,
    projectRebalancePlan,
    projectTimeline,
    requestedUnitScope,
    runCommercialOperationMutation,
    sourceStale,
    timelineActionType,
}
