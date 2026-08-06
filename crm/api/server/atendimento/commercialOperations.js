import { createHash } from 'node:crypto'

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

export const COMMERCIAL_CAMPAIGN_STATES = Object.freeze(['draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled'])
export const COMMERCIAL_CAMPAIGN_MEMBER_STATES = Object.freeze(['eligible', 'blocked', 'review', 'control', 'assigned', 'completed', 'cancelled'])
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

const ACTIVE_STATUSES = new Set(['open', 'contacted', 'responded', 'scheduled'])
const OWNER_ID_PATTERN = /^[a-z0-9._:@+\- ]{1,200}$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CAMPAIGN_FILTER_KEYS = new Set(['segment', 'segmentKey', 'priority', 'source', 'status', 'unit', 'stale', 'identityReview', 'permission', 'owner', 'actionFlag'])

function text(value) {
    return String(value ?? '').trim()
}

function dateOnly(value) {
    const raw = text(value).slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : ''
}

function dateTime(value) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

function asObject(value, maxBytes = 20000) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    const json = JSON.stringify(value)
    return json.length <= maxBytes ? value : null
}

function normalizeCampaignFilters(value) {
    const input = asObject(value)
    if (!input) return null
    const output = {}
    for (const [key, raw] of Object.entries(input)) {
        if (!CAMPAIGN_FILTER_KEYS.has(key)) throw operationError('COMMERCIAL_CAMPAIGN_FILTER_INVALID')
        if (typeof raw === 'string' && (raw.length > 160 || /@/.test(raw) || /\d{7,}/.test(raw))) throw operationError('COMMERCIAL_CAMPAIGN_FILTER_INVALID')
        if (!['string', 'number', 'boolean'].includes(typeof raw) && !Array.isArray(raw)) throw operationError('COMMERCIAL_CAMPAIGN_FILTER_INVALID')
        output[key] = Array.isArray(raw) ? raw.map((item) => String(item).slice(0, 80)).slice(0, 20) : raw
    }
    return output
}

export function normalizeOutcomeCode(value) {
    const normalized = text(value).toLowerCase().replace(/[\s-]+/g, '_')
    return COMMERCIAL_OUTCOME_CODES.includes(normalized) ? normalized : ''
}

export function normalizeOperationMutation(payload = {}, { requireIdempotency = true } = {}) {
    const idempotencyKey = text(payload.idempotencyKey)
    const expectedRevision = payload.expectedRevision == null || payload.expectedRevision === ''
        ? null
        : Number(payload.expectedRevision)
    if (requireIdempotency && (!idempotencyKey || idempotencyKey.length > 200)) throw operationError('COMMERCIAL_IDEMPOTENCY_KEY_REQUIRED')
    if (idempotencyKey && !OWNER_ID_PATTERN.test(idempotencyKey)) throw operationError('INVALID_COMMERCIAL_IDEMPOTENCY_KEY')
    if (expectedRevision != null && (!Number.isInteger(expectedRevision) || expectedRevision < 1)) throw operationError('COMMERCIAL_EXPECTED_REVISION_REQUIRED')
    const reason = text(payload.reason)
    if (reason && (reason.length < 3 || reason.length > 1000)) throw operationError('COMMERCIAL_OPERATION_REASON_INVALID')
    const outcomeCode = normalizeOutcomeCode(payload.outcomeCode)
    if (payload.outcomeCode != null && !outcomeCode) throw operationError('INVALID_COMMERCIAL_OUTCOME')
    return { idempotencyKey, expectedRevision, reason, outcomeCode }
}

export function operationError(code, statusCode = 400) {
    const error = new Error(code)
    error.statusCode = statusCode
    error.code = code
    return error
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
    const active = ACTIVE_STATUSES.has(status)
    const dueDate = dateOnly(action.dueDate || action.due_date)
    const owner = text(action.owner)
    const normalizedActorIds = new Set(actorIds.map(text).filter(Boolean).map((value) => value.toLowerCase()))
    if (owner && normalizedActorIds.has(owner.toLowerCase())) flags.push('assigned_to_me')
    if (active && dueDate === today) flags.push('due_today')
    if (active && dueDate && dueDate < today) flags.push('overdue')
    if (status === 'contacted') flags.push('awaiting_response')
    if (status === 'scheduled') flags.push('scheduled')
    if (active && (status === 'responded' || (status === 'contacted' && !dueDate))) flags.push('no_return')
    const expiresAt = dateTime(eligibility?.expiresAt || eligibility?.expires_at)
    const now = dateTime(`${today}T00:00:00Z`) || new Date()
    const soon = expiresAt && expiresAt.getTime() >= now.getTime() && expiresAt.getTime() <= now.getTime() + 7 * 24 * 60 * 60 * 1000
    if (soon) flags.push('permission_expiring')
    if (eligibility && eligibility.status !== 'eligible') flags.push('ineligible')
    if (sourceStale) flags.push('source_stale')
    if (identityInReview) flags.push('identity_review')
    return flags
}

export function classifyCommercialAction(action = {}, options = {}) {
    const flags = actionQueueFlags(action, options)
    return {
        ...action,
        queueFlags: flags,
        queueReasons: flags.map((flag) => flag.replaceAll('_', ' ')),
        active: ACTIVE_STATUSES.has(text(action.status).toLowerCase()),
    }
}

function increment(target, key, value = 1) {
    target[key] = Number(target[key] || 0) + value
}

export function aggregateCommercialActionMetrics(actions = [], { today = new Date().toISOString().slice(0, 10) } = {}) {
    const byStatus = {}
    const byOwner = new Map()
    const totals = { total: 0, active: 0, dueToday: 0, overdue: 0, completed: 0, responded: 0, scheduled: 0, attended: 0, sale: 0, returned: 0, cancelled: 0 }
    for (const action of actions) {
        const status = text(action.status).toLowerCase() || 'open'
        const outcome = normalizeOutcomeCode(action.outcomeCode || action.outcome_code)
        const responded = ['responded', 'scheduled', 'won_sale', 'returned'].includes(status) ||
            ['requested_follow_up', 'scheduled', 'attended', 'cancelled', 'sale', 'clinical_return', 'opt_out_requested'].includes(outcome)
        const scheduled = status === 'scheduled' || outcome === 'scheduled'
        const attended = status === 'attended' || outcome === 'attended'
        const sale = status === 'won_sale' || outcome === 'sale'
        const returned = status === 'returned' || outcome === 'clinical_return'
        const cancelled = status === 'cancelled' || outcome === 'cancelled'
        const completed = ['closed', 'cancelled', 'won_sale', 'returned'].includes(status) ||
            ['attended', 'sale', 'clinical_return', 'cancelled'].includes(outcome)
        const flags = action.queueFlags || actionQueueFlags(action, { today })
        increment(byStatus, status)
        increment(totals, 'total')
        if (ACTIVE_STATUSES.has(status)) increment(totals, 'active')
        if (flags.includes('due_today')) increment(totals, 'dueToday')
        if (flags.includes('overdue')) increment(totals, 'overdue')
        if (completed) increment(totals, 'completed')
        if (responded) increment(totals, 'responded')
        if (scheduled) increment(totals, 'scheduled')
        if (attended) increment(totals, 'attended')
        if (sale) increment(totals, 'sale')
        if (returned) increment(totals, 'returned')
        if (cancelled) increment(totals, 'cancelled')
        const owner = text(action.owner) || 'unassigned'
        const current = byOwner.get(owner) || { owner, total: 0, active: 0, overdue: 0, completed: 0, responded: 0, scheduled: 0, attended: 0, sale: 0, returned: 0, cancelled: 0, statuses: {} }
        increment(current, 'total')
        if (ACTIVE_STATUSES.has(status)) increment(current, 'active')
        if (flags.includes('overdue')) increment(current, 'overdue')
        if (completed) increment(current, 'completed')
        if (responded) increment(current, 'responded')
        if (scheduled) increment(current, 'scheduled')
        if (attended) increment(current, 'attended')
        if (sale) increment(current, 'sale')
        if (returned) increment(current, 'returned')
        if (cancelled) increment(current, 'cancelled')
        increment(current.statuses, status)
        byOwner.set(owner, current)
    }
    const total = totals.total || 0
    return {
        totals: {
            ...totals,
            completionRate: total ? Math.round((totals.completed / total) * 10000) / 100 : 0,
            responseRate: total ? Math.round((totals.responded / total) * 10000) / 100 : 0,
            schedulingRate: total ? Math.round((totals.scheduled / total) * 10000) / 100 : 0,
            attendanceRate: total ? Math.round(((totals.attended || 0) / total) * 10000) / 100 : 0,
            saleRate: total ? Math.round((totals.sale / total) * 10000) / 100 : 0,
            returnRate: total ? Math.round((totals.returned / total) * 10000) / 100 : 0,
            cancellationRate: total ? Math.round((totals.cancelled / total) * 10000) / 100 : 0,
        },
        byStatus,
        byOwner: [...byOwner.values()].sort((left, right) => right.active - left.active || left.owner.localeCompare(right.owner)),
    }
}

export function computeAverageStageDurations(events = []) {
    const grouped = new Map()
    for (const event of events) {
        const id = text(event.actionId || event.action_id)
        const status = text(event.status)
        const at = dateTime(event.occurredAt || event.createdAt || event.created_at)
        if (!id || !status || !at) continue
        if (!grouped.has(id)) grouped.set(id, [])
        grouped.get(id).push({ status, at })
    }
    const durations = new Map()
    for (const rows of grouped.values()) {
        rows.sort((left, right) => left.at - right.at)
        for (let index = 0; index < rows.length - 1; index += 1) {
            const current = rows[index]
            const next = rows[index + 1]
            const hours = Math.max(0, (next.at.getTime() - current.at.getTime()) / 3600000)
            const entry = durations.get(current.status) || { totalHours: 0, samples: 0 }
            entry.totalHours += hours
            entry.samples += 1
            durations.set(current.status, entry)
        }
    }
    return Object.fromEntries([...durations.entries()].map(([status, value]) => [status, {
        hours: Math.round((value.totalHours / Math.max(1, value.samples)) * 100) / 100,
        samples: value.samples,
    }]))
}

export function normalizeCampaignPayload(payload = {}) {
    const name = text(payload.name)
    const segmentKey = text(payload.segmentKey)
    const segmentVersion = text(payload.segmentVersion)
    const unit = text(payload.unit || payload.unitSlug).toLowerCase()
    const owner = text(payload.owner)
    const reason = text(payload.reason)
    const cutoffAt = dateTime(payload.cutoffAt || payload.cutoff_at)
    const assignmentWindowStart = dateTime(payload.assignmentWindowStart || payload.assignment_window_start)
    const assignmentWindowEnd = dateTime(payload.assignmentWindowEnd || payload.assignment_window_end)
    const controlGroupPercent = Number(payload.controlGroupPercent ?? payload.control_group_percent ?? 0)
    const identityIds = [...new Set((Array.isArray(payload.identityIds) ? payload.identityIds : []).map(text).filter(Boolean))]
    const offerId = text(payload.offerId)
    const filters = normalizeCampaignFilters(payload.filters)
    if (!name || name.length > 160) throw operationError('INVALID_COMMERCIAL_CAMPAIGN_NAME')
    if (!segmentKey || segmentKey.length > 120 || !segmentVersion || segmentVersion.length > 120) throw operationError('COMMERCIAL_CAMPAIGN_SEGMENT_REQUIRED')
    if (!unit || unit.length > 120) throw operationError('COMMERCIAL_CAMPAIGN_UNIT_REQUIRED')
    if (!owner || !OWNER_ID_PATTERN.test(owner)) throw operationError('COMMERCIAL_CAMPAIGN_OWNER_REQUIRED')
    if (reason.length < 3 || reason.length > 1000) throw operationError('COMMERCIAL_CAMPAIGN_REASON_REQUIRED')
    if (!cutoffAt || !assignmentWindowStart || !assignmentWindowEnd || assignmentWindowEnd < assignmentWindowStart) throw operationError('INVALID_COMMERCIAL_CAMPAIGN_WINDOW')
    if (!Number.isInteger(controlGroupPercent) || controlGroupPercent < 0 || controlGroupPercent > 100) throw operationError('INVALID_COMMERCIAL_CONTROL_GROUP')
    if (!filters || identityIds.length < 1 || identityIds.length > 500) throw operationError('COMMERCIAL_CAMPAIGN_COHORT_REQUIRED')
    if (identityIds.some((identityId) => !UUID_PATTERN.test(identityId))) throw operationError('COMMERCIAL_CAMPAIGN_IDENTITY_INVALID')
    if (offerId && !UUID_PATTERN.test(offerId)) throw operationError('COMMERCIAL_CAMPAIGN_OFFER_INVALID')
    const state = text(payload.state).toLowerCase() || 'draft'
    if (!COMMERCIAL_CAMPAIGN_STATES.includes(state)) throw operationError('INVALID_COMMERCIAL_CAMPAIGN_STATE')
    return {
        name, segmentKey, segmentVersion, unit, owner, reason, filters, identityIds,
        cutoffAt: cutoffAt.toISOString(), assignmentWindowStart: assignmentWindowStart.toISOString(), assignmentWindowEnd: assignmentWindowEnd.toISOString(),
        controlGroupPercent,
        offerId: offerId || null,
        state,
    }
}

export function campaignMemberState({ eligible, controlGroup, identityInReview, sourceStale }) {
    if (controlGroup) return 'control'
    if (!eligible) return identityInReview || sourceStale ? 'review' : 'blocked'
    if (identityInReview || sourceStale) return 'review'
    return 'eligible'
}

export function stableOperationFingerprint(value) {
    const stable = (input) => {
        if (input === null || typeof input !== 'object') return input
        if (Array.isArray(input)) return input.map(stable)
        return Object.fromEntries(Object.keys(input).sort().map((key) => [key, stable(input[key])]))
    }
    const normalized = JSON.stringify(stable(value))
    return createHash('sha256').update(normalized).digest('hex')
}

export function planWalletBalance(actions = [], capacities = {}) {
    const open = actions.filter((action) => ['open', 'contacted', 'responded', 'scheduled'].includes(text(action.status)))
    const loads = new Map()
    for (const action of open.filter((item) => !item.absentOwner)) {
        const owner = text(action.owner) || 'unassigned'
        loads.set(owner, (loads.get(owner) || 0) + 1)
    }
    const targets = Object.entries(capacities).map(([owner, value]) => ({ owner: text(owner), capacity: Math.max(0, Number(value) || 0), load: loads.get(text(owner)) || 0 }))
        .filter((item) => item.owner)
        .sort((left, right) => (left.load / Math.max(1, left.capacity || 1)) - (right.load / Math.max(1, right.capacity || 1)) || left.owner.localeCompare(right.owner))
    if (!targets.length) return []
    const moves = []
    for (const action of open.filter((item) => !text(item.owner) || item.absentOwner || (loads.get(text(item.owner)) || 0) > (capacities[text(item.owner)] ?? Number.MAX_SAFE_INTEGER))) {
        const target = targets.find((item) => item.owner !== text(action.owner) && item.load < item.capacity)
        if (!target) continue
        moves.push({ actionId: action.id, fromOwner: text(action.owner) || null, toOwner: target.owner })
        target.load += 1
    }
    return moves
}

export function sanitizeTimelineEvent(row = {}) {
    const event = {
        id: text(row.event_id || row.id),
        type: text(row.event_type || row.type),
        occurredOn: row.occurred_on || row.occurredOn || null,
        title: text(row.title),
        detail: text(row.detail),
        unitName: text(row.unit_name || row.unitName),
        source: text(row.source_label || row.source),
        amount: row.amount == null ? null : Number(row.amount),
        status: text(row.event_status || row.status) || 'confirmed',
    }
    const actor = text(row.actor_label || row.actor)
    const correlationId = text(row.trace_id || row.correlation_id || row.correlationId)
    const campaignId = text(row.campaign_id || row.campaignId)
    const offerId = text(row.offer_id || row.offerId)
    const consentReview = text(row.consent_review || row.consentReview)
    if (actor && !actor.includes('@')) event.actor = actor
    if (correlationId) event.correlationId = correlationId
    if (campaignId) event.campaignId = campaignId
    if (offerId) event.offerId = offerId
    if (consentReview) event.consentReview = consentReview
    return event
}
