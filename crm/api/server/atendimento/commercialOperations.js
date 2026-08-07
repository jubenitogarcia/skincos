import { createHash } from 'node:crypto'

// This module deliberately contains only deterministic, PII-free domain
// contracts. Persistence, RBAC and contact eligibility are enforced by the
// store that consumes these values; no caller can turn an outcome into a send.
export const COMMERCIAL_OUTCOME_CODES = Object.freeze([
    'no_response',
    'wrong_number',
    'requested_follow_up',
    'not_interested',
    'completed_elsewhere',
    'scheduled',
    'attended',
    'cancelled',
    'sale',
    'clinical_return',
    'opt_out_requested',
])

export const COMMERCIAL_CAMPAIGN_STATES = Object.freeze([
    'draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled',
])

export const COMMERCIAL_CAMPAIGN_MEMBER_STATES = Object.freeze([
    'eligible', 'blocked', 'review', 'control', 'assigned', 'completed', 'cancelled',
])

export const COMMERCIAL_OPERATION_FLAGS = Object.freeze([
    'assigned_to_me',
    'due_today',
    'overdue',
    'awaiting_response',
    'scheduled',
    'no_return',
    'permission_expiring',
    'ineligible',
    'source_stale',
    'identity_review',
])

const ACTIVE_ACTION_STATUSES = new Set(['open', 'contacted', 'responded', 'scheduled'])
const ID_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OWNER_PATTERN = /^[A-Za-z0-9._:+\- ]{1,160}$/
const FILTER_KEYS = new Set(['segment', 'segmentKey', 'priority', 'source', 'status', 'unit', 'stale', 'identityReview', 'permission', 'owner', 'actionFlag'])

function text(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

function dateOnly(value) {
    const normalized = text(value).slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : ''
}

function dateTime(value) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

function safeObject(value, maximumBytes = 16_000) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const serialized = JSON.stringify(value)
    return serialized.length <= maximumBytes ? value : null
}

function containsPiiLikeValue(value) {
    const raw = text(value)
    return /@/.test(raw) || /\d{7,}/.test(raw)
}

function stableValue(value) {
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(stableValue)
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
}

export function commercialOperationError(code, statusCode = 400) {
    const error = new Error(code)
    error.code = code
    error.statusCode = statusCode
    return error
}

export function stableOperationFingerprint(value) {
    return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

export function normalizeOutcomeCode(value) {
    const normalized = text(value).toLowerCase().replace(/[\s-]+/g, '_')
    return COMMERCIAL_OUTCOME_CODES.includes(normalized) ? normalized : ''
}

export function normalizeOperationMutation(payload = {}, { requireIdempotency = true, requireReason = false } = {}) {
    const candidate = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    const idempotencyKey = text(candidate.idempotencyKey)
    const expectedRevision = candidate.expectedRevision == null || candidate.expectedRevision === ''
        ? null
        : Number(candidate.expectedRevision)
    const reason = text(candidate.reason)
    const outcomeCode = normalizeOutcomeCode(candidate.outcomeCode)

    if (requireIdempotency && !idempotencyKey) throw commercialOperationError('COMMERCIAL_IDEMPOTENCY_KEY_REQUIRED')
    if (idempotencyKey && (!ID_PATTERN.test(idempotencyKey) || containsPiiLikeValue(idempotencyKey))) {
        throw commercialOperationError('INVALID_COMMERCIAL_IDEMPOTENCY_KEY')
    }
    if (expectedRevision != null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) {
        throw commercialOperationError('COMMERCIAL_EXPECTED_REVISION_INVALID')
    }
    if ((requireReason || reason) && (reason.length < 3 || reason.length > 1_000 || containsPiiLikeValue(reason))) {
        throw commercialOperationError('COMMERCIAL_OPERATION_REASON_INVALID')
    }
    if (candidate.outcomeCode != null && !outcomeCode) throw commercialOperationError('INVALID_COMMERCIAL_OUTCOME')
    return { idempotencyKey, expectedRevision, reason, outcomeCode }
}

export function normalizeCampaignFilters(value) {
    const input = safeObject(value)
    if (input === null) throw commercialOperationError('COMMERCIAL_CAMPAIGN_FILTER_INVALID')
    const filters = {}
    for (const [key, raw] of Object.entries(input)) {
        if (!FILTER_KEYS.has(key)) throw commercialOperationError('COMMERCIAL_CAMPAIGN_FILTER_INVALID')
        const values = Array.isArray(raw) ? raw : [raw]
        if (values.length > 20 || values.some((entry) => {
            const candidate = text(entry)
            return candidate.length > 120 || containsPiiLikeValue(candidate)
        })) {
            throw commercialOperationError('COMMERCIAL_CAMPAIGN_FILTER_INVALID')
        }
        if (values.some((entry) => !['string', 'number', 'boolean'].includes(typeof entry))) {
            throw commercialOperationError('COMMERCIAL_CAMPAIGN_FILTER_INVALID')
        }
        filters[key] = Array.isArray(raw) ? [...values] : raw
    }
    return filters
}

export function normalizeCampaignPayload(payload = {}) {
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
    const name = text(input.name)
    const segmentKey = text(input.segmentKey)
    const segmentVersion = text(input.segmentVersion)
    const unit = text(input.unit || input.unitSlug).toLowerCase()
    const owner = text(input.owner)
    const reason = text(input.reason)
    const cutoffAt = dateTime(input.cutoffAt || input.cutoff_at)
    const assignmentWindowStart = dateTime(input.assignmentWindowStart || input.assignment_window_start)
    const assignmentWindowEnd = dateTime(input.assignmentWindowEnd || input.assignment_window_end)
    const controlGroupPercent = Number(input.controlGroupPercent ?? input.control_group_percent ?? 0)
    const offerId = text(input.offerId)
    const identityIds = [...new Set((Array.isArray(input.identityIds) ? input.identityIds : []).map(text).filter(Boolean))]
    const state = text(input.state).toLowerCase() || 'draft'
    const filters = normalizeCampaignFilters(input.filters)

    if (!name || name.length > 160 || containsPiiLikeValue(name)) throw commercialOperationError('INVALID_COMMERCIAL_CAMPAIGN_NAME')
    if (!segmentKey || segmentKey.length > 120 || !segmentVersion || segmentVersion.length > 120) throw commercialOperationError('COMMERCIAL_CAMPAIGN_SEGMENT_REQUIRED')
    if (!/^[a-z0-9._-]+$/i.test(segmentKey) || !/^[a-z0-9._-]+$/i.test(segmentVersion)) throw commercialOperationError('COMMERCIAL_CAMPAIGN_SEGMENT_REQUIRED')
    if (!unit || unit.length > 120 || !/^[a-z0-9._-]+$/i.test(unit)) throw commercialOperationError('COMMERCIAL_CAMPAIGN_UNIT_REQUIRED')
    if (!owner || !OWNER_PATTERN.test(owner) || containsPiiLikeValue(owner)) throw commercialOperationError('COMMERCIAL_CAMPAIGN_OWNER_REQUIRED')
    if (reason.length < 3 || reason.length > 1_000 || containsPiiLikeValue(reason)) throw commercialOperationError('COMMERCIAL_CAMPAIGN_REASON_REQUIRED')
    if (!cutoffAt || !assignmentWindowStart || !assignmentWindowEnd || assignmentWindowEnd < assignmentWindowStart) throw commercialOperationError('INVALID_COMMERCIAL_CAMPAIGN_WINDOW')
    if (!Number.isInteger(controlGroupPercent) || controlGroupPercent < 0 || controlGroupPercent > 100) throw commercialOperationError('INVALID_COMMERCIAL_CONTROL_GROUP')
    if (!identityIds.length || identityIds.length > 500 || identityIds.some((id) => !UUID_PATTERN.test(id))) throw commercialOperationError('COMMERCIAL_CAMPAIGN_COHORT_REQUIRED')
    if (offerId && !UUID_PATTERN.test(offerId)) throw commercialOperationError('COMMERCIAL_CAMPAIGN_OFFER_INVALID')
    if (!COMMERCIAL_CAMPAIGN_STATES.includes(state)) throw commercialOperationError('INVALID_COMMERCIAL_CAMPAIGN_STATE')

    return {
        name,
        segmentKey,
        segmentVersion,
        unit,
        owner,
        reason,
        filters,
        identityIds,
        cutoffAt: cutoffAt.toISOString(),
        assignmentWindowStart: assignmentWindowStart.toISOString(),
        assignmentWindowEnd: assignmentWindowEnd.toISOString(),
        controlGroupPercent,
        offerId: offerId || null,
        state,
    }
}

export function actionQueueFlags(action = {}, {
    today = new Date().toISOString().slice(0, 10),
    actorIds = [],
    eligibility = null,
    sourceStale = false,
    identityInReview = false,
} = {}) {
    const flags = []
    const status = text(action.status).toLowerCase()
    const dueDate = dateOnly(action.dueDate || action.due_date)
    const owner = text(action.owner)
    const active = ACTIVE_ACTION_STATUSES.has(status)
    const normalizedActors = new Set(actorIds.map(text).filter(Boolean).map((id) => id.toLowerCase()))
    if (owner && normalizedActors.has(owner.toLowerCase())) flags.push('assigned_to_me')
    if (active && dueDate === today) flags.push('due_today')
    if (active && dueDate && dueDate < today) flags.push('overdue')
    if (status === 'contacted') flags.push('awaiting_response')
    if (status === 'scheduled') flags.push('scheduled')
    // "Sem retorno" is deliberately a later operational condition than simply
    // awaiting a response: the declared return/follow-up deadline must have
    // elapsed.  We accept the legacy due date as the final fallback so existing
    // actions remain visible, but never infer it from contact content.
    const returnDueDate = dateOnly(action.returnDueAt || action.return_due_at || action.followUpDueAt || action.follow_up_due_at || action.dueDate || action.due_date)
    if (active && status === 'contacted' && returnDueDate && returnDueDate < today) flags.push('no_return')
    const expiry = dateTime(eligibility?.expiresAt || eligibility?.expires_at)
    const now = dateTime(`${today}T00:00:00.000Z`) || new Date()
    if (expiry && expiry >= now && expiry.getTime() <= now.getTime() + 7 * 86_400_000) flags.push('permission_expiring')
    if (eligibility && eligibility.status !== 'eligible') flags.push('ineligible')
    if (sourceStale) flags.push('source_stale')
    if (identityInReview) flags.push('identity_review')
    return flags
}

export function classifyCommercialAction(action = {}, options = {}) {
    const queueFlags = actionQueueFlags(action, options)
    return {
        ...action,
        queueFlags,
        active: ACTIVE_ACTION_STATUSES.has(text(action.status).toLowerCase()),
    }
}

function increment(record, key, amount = 1) {
    record[key] = Number(record[key] || 0) + amount
}

function outcomeTotals(action, status, outcome) {
    return {
        completed: ['closed', 'cancelled', 'won_sale', 'returned'].includes(status) || ['attended', 'sale', 'clinical_return', 'cancelled'].includes(outcome),
        responded: ['responded', 'scheduled', 'won_sale', 'returned'].includes(status) || ['requested_follow_up', 'scheduled', 'attended', 'cancelled', 'sale', 'clinical_return', 'opt_out_requested'].includes(outcome),
        scheduled: status === 'scheduled' || outcome === 'scheduled',
        attended: outcome === 'attended',
        sale: status === 'won_sale' || outcome === 'sale',
        returned: status === 'returned' || outcome === 'clinical_return',
        cancelled: status === 'cancelled' || outcome === 'cancelled',
    }
}

export function aggregateCommercialActionMetrics(actions = [], { today = new Date().toISOString().slice(0, 10) } = {}) {
    const totals = { total: 0, active: 0, dueToday: 0, overdue: 0, completed: 0, responded: 0, scheduled: 0, attended: 0, sale: 0, returned: 0, cancelled: 0 }
    const byStatus = {}
    const owners = new Map()
    for (const action of actions) {
        const status = text(action.status).toLowerCase() || 'open'
        const outcome = normalizeOutcomeCode(action.outcomeCode || action.outcome_code)
        const flags = action.queueFlags || actionQueueFlags(action, { today })
        const normalized = outcomeTotals(action, status, outcome)
        increment(totals, 'total')
        increment(byStatus, status)
        if (ACTIVE_ACTION_STATUSES.has(status)) increment(totals, 'active')
        if (flags.includes('due_today')) increment(totals, 'dueToday')
        if (flags.includes('overdue')) increment(totals, 'overdue')
        for (const [key, enabled] of Object.entries(normalized)) if (enabled) increment(totals, key)
        const owner = text(action.owner) || 'unassigned'
        const row = owners.get(owner) || { owner, total: 0, active: 0, overdue: 0, completed: 0, responded: 0, scheduled: 0, attended: 0, sale: 0, returned: 0, cancelled: 0, statuses: {} }
        increment(row, 'total')
        increment(row.statuses, status)
        if (ACTIVE_ACTION_STATUSES.has(status)) increment(row, 'active')
        if (flags.includes('overdue')) increment(row, 'overdue')
        for (const [key, enabled] of Object.entries(normalized)) if (enabled) increment(row, key)
        owners.set(owner, row)
    }
    const denominator = totals.total || 1
    const rate = (key) => Math.round((totals[key] / denominator) * 10_000) / 100
    return {
        totals: {
            ...totals,
            completionRate: rate('completed'),
            responseRate: rate('responded'),
            schedulingRate: rate('scheduled'),
            attendanceRate: rate('attended'),
            saleRate: rate('sale'),
            returnRate: rate('returned'),
            cancellationRate: rate('cancelled'),
        },
        byStatus,
        byOwner: [...owners.values()].sort((left, right) => right.active - left.active || left.owner.localeCompare(right.owner)),
    }
}

export function computeAverageStageDurations(events = []) {
    const byAction = new Map()
    for (const event of events) {
        const actionId = text(event.actionId || event.action_id)
        const status = text(event.status)
        const occurredAt = dateTime(event.occurredAt || event.createdAt || event.created_at)
        if (!actionId || !status || !occurredAt) continue
        const rows = byAction.get(actionId) || []
        rows.push({ status, occurredAt })
        byAction.set(actionId, rows)
    }
    const duration = new Map()
    for (const rows of byAction.values()) {
        rows.sort((left, right) => left.occurredAt - right.occurredAt)
        for (let index = 0; index < rows.length - 1; index += 1) {
            const current = rows[index]
            const next = rows[index + 1]
            const state = duration.get(current.status) || { totalHours: 0, samples: 0 }
            state.totalHours += Math.max(0, (next.occurredAt.getTime() - current.occurredAt.getTime()) / 3_600_000)
            state.samples += 1
            duration.set(current.status, state)
        }
    }
    return Object.fromEntries([...duration.entries()].map(([status, values]) => [status, {
        hours: Math.round((values.totalHours / Math.max(1, values.samples)) * 100) / 100,
        samples: values.samples,
    }]))
}

export function campaignMemberState({ eligible, controlGroup, identityInReview, sourceStale } = {}) {
    if (!eligible) return identityInReview || sourceStale ? 'review' : 'blocked'
    // A holdout is reproducible only within the same eligible population.  An
    // ineligible identity is never silently reclassified as control; it must
    // remain blocked/review until the underlying gate becomes healthy.
    if (controlGroup) return 'control'
    if (identityInReview || sourceStale) return 'review'
    return 'eligible'
}

export function stableControlGroup({ campaignSeed, identityId, percentage }) {
    const percent = Number(percentage)
    if (!UUID_PATTERN.test(text(identityId)) || !Number.isInteger(percent) || percent < 0 || percent > 100) {
        throw commercialOperationError('INVALID_COMMERCIAL_CONTROL_GROUP')
    }
    if (!text(campaignSeed) || text(campaignSeed).length > 200) throw commercialOperationError('INVALID_COMMERCIAL_CAMPAIGN_SEED')
    const bucket = Number.parseInt(stableOperationFingerprint({ campaignSeed: text(campaignSeed), identityId: text(identityId) }).slice(0, 8), 16) % 100
    return bucket < percent
}

export function planWalletBalance(actions = [], capacities = {}) {
    const loads = new Map()
    const active = actions.filter((action) => ACTIVE_ACTION_STATUSES.has(text(action.status).toLowerCase()))
    for (const action of active.filter((action) => !action.absentOwner)) {
        const owner = text(action.owner)
        if (owner) loads.set(owner, (loads.get(owner) || 0) + 1)
    }
    const targets = Object.entries(capacities)
        .map(([owner, capacity]) => ({ owner: text(owner), capacity: Math.max(0, Number(capacity) || 0), load: loads.get(text(owner)) || 0 }))
        .filter((entry) => entry.owner && OWNER_PATTERN.test(entry.owner))
        .sort((left, right) => (left.load / Math.max(1, left.capacity)) - (right.load / Math.max(1, right.capacity)) || left.owner.localeCompare(right.owner))
    const moves = []
    for (const action of active) {
        const current = text(action.owner)
        const capacity = capacities[current]
        const needsMove = !current || action.absentOwner || (capacity != null && (loads.get(current) || 0) > Number(capacity))
        if (!needsMove) continue
        const target = targets.find((entry) => entry.owner !== current && entry.load < entry.capacity)
        if (!target) continue
        moves.push({ actionId: text(action.id), fromOwner: current || null, toOwner: target.owner })
        target.load += 1
    }
    return moves.filter((move) => UUID_PATTERN.test(move.actionId))
}

// Presentation is intentionally explicit. Do not spread raw evidence/context
// into Customer 360; that is how technical identifiers and PII leak by drift.
export function projectCommercialTimelineEvent(row = {}) {
    const type = text(row.type || row.event_type)
    const allowedTypes = new Set(['attendance', 'sale', 'permission', 'opt_out', 'action', 'contact', 'response', 'appointment', 'campaign', 'offer', 'identity_decision', 'quality_finding', 'correction'])
    return {
        id: text(row.id || row.event_id),
        type: allowedTypes.has(type) ? type : 'correction',
        occurredAt: dateTime(row.occurredAt || row.occurred_on || row.created_at)?.toISOString() || null,
        source: text(row.source || row.source_label).slice(0, 80),
        unit: text(row.unit || row.unit_slug || row.unit_name).slice(0, 120),
        actor: containsPiiLikeValue(row.actor || row.actor_label) ? null : text(row.actor || row.actor_label).slice(0, 160) || null,
        correlationId: UUID_PATTERN.test(text(row.correlationId || row.trace_id)) ? text(row.correlationId || row.trace_id) : null,
        campaignId: UUID_PATTERN.test(text(row.campaignId || row.campaign_id)) ? text(row.campaignId || row.campaign_id) : null,
        offerId: UUID_PATTERN.test(text(row.offerId || row.offer_id)) ? text(row.offerId || row.offer_id) : null,
        consentReview: text(row.consentReview || row.consent_review).slice(0, 80) || null,
        status: text(row.status || row.event_status).slice(0, 80) || 'confirmed',
    }
}
