import { createHash } from 'node:crypto'

// Analytics is intentionally deterministic and explainable.  It consumes
// durable, unit-scoped records supplied by the store; it never scores a
// person, exposes contact data, or turns a measurement into a send.
export const COMMERCIAL_ANALYTICS_VERSION = 'commercial-analytics/v2'
export const COMMERCIAL_ANALYTICS_FUNNEL_STAGES = Object.freeze([
    'eligible', 'selected', 'action_created', 'contacted', 'delivered',
    'responded', 'scheduled', 'attended', 'purchased', 'returned',
])
export const COMMERCIAL_ANALYTICS_DEFAULT_WINDOWS = Object.freeze({
    version: 'v1', responseDays: 7, appointmentDays: 14, attendanceDays: 60,
    saleDays: 60, returnDays: 180,
})

const PII_KEY = /(?:^|_)(?:name|phone|email|cpf|address|message|body|payload|raw|evidence)(?:$|_)/i
const PII_VALUE = /@|\+?\d[\d\s().-]{6,}\d/
const KEY = /^[a-z][a-z0-9._-]{0,119}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const DIMENSIONS = new Set(['unit', 'campaign', 'segment', 'owner', 'channel', 'offer', 'policyVersion'])
const ATTRIBUTION_STATES = new Set(['observed', 'attributed', 'incremental'])
const STAGE_SET = new Set(COMMERCIAL_ANALYTICS_FUNNEL_STAGES)

function text(value) { return typeof value === 'string' ? value.trim() : String(value ?? '').trim() }
function finite(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback }
function nonNegative(value) { return Math.max(0, finite(value)) }
function round(value, places = 4) { const scale = 10 ** places; return Math.round(value * scale) / scale }
function identityOf(row) { return text(row?.identityId || row?.identity_id) }
function eventType(row) { return text(row?.type || row?.eventType || row?.event_type).toLowerCase() }
function occurredAt(row) { return row?.occurredAt || row?.occurred_at || row?.createdAt || row?.created_at || row?.date || null }

function asDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value
    const parsed = new Date(String(value || ''))
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

function stable(value) {
    if (Array.isArray(value)) return value.map(stable)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
}

function hash(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex') }

export function commercialAnalyticsError(code, statusCode = 400) {
    const error = new Error(code)
    error.code = code
    error.statusCode = statusCode
    return error
}

function containsPii(value) { return PII_VALUE.test(text(value)) }

export function sanitizeAnalyticsPayload(value, depth = 0) {
    if (depth > 4) return null
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAnalyticsPayload(item, depth + 1)).filter((item) => item !== undefined)
    if (value && typeof value === 'object') {
        const result = {}
        for (const [key, item] of Object.entries(value)) {
            if (Object.keys(result).length >= 40 || PII_KEY.test(key)) continue
            const sanitized = sanitizeAnalyticsPayload(item, depth + 1)
            if (sanitized !== undefined) result[key] = sanitized
        }
        return result
    }
    if (typeof value === 'string') return containsPii(value) ? undefined : value.slice(0, 500)
    return ['number', 'boolean'].includes(typeof value) || value === null ? value : undefined
}

export function normalizeAttributionWindows(value = {}, defaults = COMMERCIAL_ANALYTICS_DEFAULT_WINDOWS) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const normalizeDays = (key, fallback) => {
        const parsed = Number(source[key] ?? source[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] ?? fallback)
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 730) throw commercialAnalyticsError('COMMERCIAL_ATTRIBUTION_WINDOW_INVALID')
        return parsed
    }
    const version = text(source.version || defaults.version)
    if (!KEY.test(version)) throw commercialAnalyticsError('COMMERCIAL_ATTRIBUTION_WINDOW_VERSION_INVALID')
    return {
        version,
        responseDays: normalizeDays('responseDays', defaults.responseDays),
        appointmentDays: normalizeDays('appointmentDays', defaults.appointmentDays),
        attendanceDays: normalizeDays('attendanceDays', defaults.attendanceDays),
        saleDays: normalizeDays('saleDays', defaults.saleDays),
        returnDays: normalizeDays('returnDays', defaults.returnDays),
    }
}

export function normalizeAnalyticsFilters(query = {}) {
    const source = query && typeof query === 'object' && !Array.isArray(query) ? query : {}
    const date = (key) => {
        const value = text(source[key])
        if (!value) return null
        if (!DATE.test(value)) throw commercialAnalyticsError(`INVALID_ANALYTICS_${key.toUpperCase()}`)
        return value
    }
    const list = (key) => {
        const raw = Array.isArray(source[key]) ? source[key] : text(source[key]).split(',')
        const values = [...new Set(raw.map(text).filter(Boolean))]
        if (values.length > 50 || values.some((value) => !KEY.test(value) || containsPii(value))) throw commercialAnalyticsError('INVALID_ANALYTICS_FILTER')
        return values
    }
    const from = date('from') || date('periodStart')
    const to = date('to') || date('periodEnd')
    if (from && to && from > to) throw commercialAnalyticsError('INVALID_ANALYTICS_PERIOD')
    const dimensions = list('dimensions')
    if (dimensions.some((dimension) => !DIMENSIONS.has(dimension))) throw commercialAnalyticsError('INVALID_ANALYTICS_DIMENSION')
    const value = (key) => {
        const candidate = text(source[key])
        if (candidate && (!KEY.test(candidate) || containsPii(candidate))) throw commercialAnalyticsError('INVALID_ANALYTICS_FILTER')
        return candidate || null
    }
    const attributionState = text(source.attributionState || 'attributed')
    if (!ATTRIBUTION_STATES.has(attributionState)) throw commercialAnalyticsError('INVALID_ANALYTICS_ATTRIBUTION_STATE')
    const granularity = text(source.granularity || 'day')
    if (!['day', 'week', 'month'].includes(granularity)) throw commercialAnalyticsError('INVALID_ANALYTICS_GRANULARITY')
    const limit = Number(source.limit || 90)
    if (!Number.isInteger(limit) || limit < 1 || limit > 365) throw commercialAnalyticsError('INVALID_ANALYTICS_LIMIT')
    return { from, to, unit: value('unit'), units: list('units'), campaign: value('campaign'), segment: value('segment'), owner: value('owner'), channel: value('channel'), offer: value('offer'), policyVersion: value('policyVersion'), findingKey: value('findingKey'), sourceKey: value('sourceKey'), dimensions, attributionState, granularity, limit }
}

function bucket(value, granularity) {
    const parsed = asDate(value)
    if (!parsed) return null
    const day = parsed.toISOString().slice(0, 10)
    if (granularity === 'day') return day
    if (granularity === 'month') return `${day.slice(0, 7)}-01`
    const weekStart = new Date(`${day}T00:00:00.000Z`)
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7))
    return weekStart.toISOString().slice(0, 10)
}

function average(values) {
    const accepted = values.filter((value) => Number.isFinite(value))
    return accepted.length ? round(accepted.reduce((sum, value) => sum + value, 0) / accepted.length, 2) : null
}

function hoursBetween(left, right) {
    const start = asDate(left); const end = asDate(right)
    return !start || !end || end < start ? null : round((end.getTime() - start.getTime()) / 3_600_000, 2)
}

export function buildQualityTimeSeries({ findings = [], findingEvents = [], metricSnapshots = [], asOf = new Date(), granularity = 'day' } = {}) {
    const now = asDate(asOf) || new Date()
    const byFinding = new Map()
    const eventsByFinding = new Map()
    for (const event of [...findingEvents].sort((left, right) => String(occurredAt(left)).localeCompare(String(occurredAt(right))))) {
        const key = text(event.findingKey || event.finding_key)
        const date = bucket(occurredAt(event), granularity)
        if (!key || !date) continue
        const series = byFinding.get(key) || new Map()
        const current = series.get(date) || { date, observedCount: 0, events: 0, status: 'open' }
        current.observedCount = Math.round(nonNegative(event.observedCount ?? event.observed_count ?? current.observedCount))
        current.events += 1
        current.status = text(event.status || current.status) || 'open'
        series.set(date, current)
        byFinding.set(key, series)
        const history = eventsByFinding.get(key) || []
        history.push(event)
        eventsByFinding.set(key, history)
    }
    const activeAging = []
    const timings = []
    let reopened = 0; let detected = 0; let assigned = 0; let overdueSla = 0
    for (const finding of findings) {
        const key = text(finding.findingKey || finding.finding_key)
        if (!key) continue
        const count = Math.round(nonNegative(finding.observedCount ?? finding.observed_count))
        const status = text(finding.status || 'open')
        const date = bucket(finding.lastEvaluatedAt || finding.last_evaluated_at || now, granularity)
        const series = byFinding.get(key) || new Map()
        if (date && !series.has(date)) series.set(date, { date, observedCount: count, events: 0, status })
        byFinding.set(key, series)
        if (text(finding.owner)) assigned += 1
        const due = asDate(finding.slaDueAt || finding.sla_due_at)
        if (count > 0 && due && due < now && !['resolved', 'closed', 'cleared'].includes(status)) overdueSla += 1
        const history = eventsByFinding.get(key) || []
        const first = history.find((event) => ['detected', 'reopened'].includes(eventType(event))) || null
        const acknowledged = history.find((event) => ['acknowledged', 'in_progress'].includes(text(event.status))) || null
        const started = history.find((event) => text(event.status) === 'in_progress') || null
        const resolved = history.find((event) => ['resolved', 'cleared'].includes(eventType(event)) || ['resolved', 'closed'].includes(text(event.status))) || null
        const detectedAt = occurredAt(first) || finding.firstDetectedAt || finding.first_detected_at
        timings.push({ findingKey: key, timeToRecognitionHours: hoursBetween(detectedAt, occurredAt(acknowledged) || finding.acknowledgedAt || finding.acknowledged_at), timeToStartHours: hoursBetween(detectedAt, occurredAt(started)), timeToResolutionHours: hoursBetween(detectedAt, occurredAt(resolved) || finding.resolvedAt || finding.resolved_at) })
        const ageHours = hoursBetween(detectedAt, now)
        if (count > 0) activeAging.push({ findingKey: key, ageHours: ageHours ?? 0, observedCount: count, status })
        reopened += history.filter((event) => eventType(event) === 'reopened').length
        detected += history.filter((event) => ['detected', 'reopened'].includes(eventType(event))).length
    }
    const latestMetrics = new Map()
    for (const row of metricSnapshots) {
        const key = `${text(row.sourceKey || row.source_key)}:${text(row.findingKey || row.finding_key)}:${text(row.unitSlug || row.unit_slug)}`
        const current = latestMetrics.get(key)
        if (!current || String(occurredAt(row)).localeCompare(String(occurredAt(current))) > 0) latestMetrics.set(key, sanitizeAnalyticsPayload(row))
    }
    const metrics = [...latestMetrics.values()]
    const coverage = Object.fromEntries(metrics.flatMap((row) => Object.entries(row.metrics || {})).filter(([key, value]) => /^coverage[._]/i.test(key) && Number.isFinite(Number(value))).map(([key, value]) => [key, round(Number(value), 4)]))
    return {
        version: COMMERCIAL_ANALYTICS_VERSION,
        granularity,
        byFinding: Object.fromEntries([...byFinding.entries()].map(([key, values]) => [key, [...values.values()].sort((left, right) => left.date.localeCompare(right.date))])),
        backlogAging: activeAging.sort((left, right) => right.ageHours - left.ageHours),
        timing: { timeToRecognitionHours: average(timings.map((row) => row.timeToRecognitionHours)), timeToStartHours: average(timings.map((row) => row.timeToStartHours)), timeToResolutionHours: average(timings.map((row) => row.timeToResolutionHours)) },
        reopenRate: detected ? round(reopened / detected) : 0,
        ownerCoverage: findings.length ? round(assigned / findings.length) : null,
        overdueSla,
        coverage,
        freshness: metrics.filter((row) => text(row.sourceKey || row.source_key).startsWith('freshness.')),
        lastValidExecution: metrics.filter((row) => text(row.sourceKey || row.source_key) === 'source.last_valid_execution'),
    }
}

function dimensionMatches(row, filters) {
    const exact = (value, expected) => !expected || text(value) === text(expected)
    return exact(row.unitSlug || row.unit_slug, filters.unit)
        && exact(row.campaignKey || row.campaign_key || row.campaignId || row.campaign_id, filters.campaign)
        && exact(row.segmentKey || row.segment_key, filters.segment)
        && exact(row.owner, filters.owner)
        && exact(row.channel || row.contactChannel || row.contact_channel, filters.channel)
        && exact(row.offerKey || row.offer_key || row.offerId || row.offer_id, filters.offer)
        && exact(row.policyVersion || row.policy_version, filters.policyVersion)
}

function windowDays(stage, windows) {
    if (stage === 'responded') return windows.responseDays
    if (stage === 'scheduled') return windows.appointmentDays
    if (stage === 'attended') return windows.attendanceDays
    if (stage === 'purchased') return windows.saleDays
    if (stage === 'returned') return windows.returnDays
    return null
}

export function isWithinAttributionWindow(anchor, eventAt, stage, windows = COMMERCIAL_ANALYTICS_DEFAULT_WINDOWS) {
    const start = asDate(anchor); const end = asDate(eventAt)
    const days = windowDays(stage, normalizeAttributionWindows(windows))
    if (!start || !end || end < start) return false
    return days === null || end.getTime() <= start.getTime() + days * 86_400_000
}

function addStage(stages, stage, identity, state) {
    if (!STAGE_SET.has(stage) || !identity || !ATTRIBUTION_STATES.has(state)) return
    stages[stage][state].add(identity)
}

export function buildCommercialFunnel({ eligibleIdentities = [], campaignMembers = [], actions = [], events = [], attendances = [], sales = [], assignments = [], windows = COMMERCIAL_ANALYTICS_DEFAULT_WINDOWS, filters = {} } = {}) {
    const normalizedWindows = normalizeAttributionWindows(windows)
    const stages = Object.fromEntries(COMMERCIAL_ANALYTICS_FUNNEL_STAGES.map((stage) => [stage, { observed: new Set(), attributed: new Set(), incremental: new Set() }]))
    const eligible = new Set(eligibleIdentities.map(identityOf).filter(Boolean))
    const treatment = new Set(assignments.filter((row) => text(row.variant) === 'treatment').map(identityOf))
    for (const identity of eligible) { addStage(stages, 'eligible', identity, 'observed'); addStage(stages, 'eligible', identity, 'attributed'); if (treatment.has(identity)) addStage(stages, 'eligible', identity, 'incremental') }
    const candidates = [...campaignMembers, ...actions].filter((row) => dimensionMatches(row, filters))
    const actionByIdentity = new Map()
    for (const row of actions.filter((item) => dimensionMatches(item, filters))) {
        const identity = identityOf(row); if (!identity) continue
        const rows = actionByIdentity.get(identity) || []; rows.push(row); actionByIdentity.set(identity, rows)
        const anchor = row.contactedAt || row.contacted_at || row.createdAt || row.created_at
        for (const state of ['observed', 'attributed']) addStage(stages, 'action_created', identity, state)
        if (treatment.has(identity)) addStage(stages, 'action_created', identity, 'incremental')
        if (row.contactedAt || row.contacted_at || ['contacted', 'responded', 'scheduled', 'won_sale', 'returned'].includes(text(row.status))) {
            for (const state of ['observed', 'attributed']) addStage(stages, 'contacted', identity, state)
            if (treatment.has(identity)) addStage(stages, 'contacted', identity, 'incremental')
        }
        const statusStage = ({ responded: 'responded', scheduled: 'scheduled', won_sale: 'purchased', returned: 'returned' })[text(row.status)]
        if (statusStage) {
            addStage(stages, statusStage, identity, 'observed')
            if (isWithinAttributionWindow(anchor, row.updatedAt || row.updated_at, statusStage, normalizedWindows)) {
                addStage(stages, statusStage, identity, 'attributed'); if (treatment.has(identity)) addStage(stages, statusStage, identity, 'incremental')
            }
        }
    }
    for (const row of candidates) {
        const identity = identityOf(row); if (!identity) continue
        addStage(stages, 'selected', identity, 'observed'); addStage(stages, 'selected', identity, 'attributed'); if (treatment.has(identity)) addStage(stages, 'selected', identity, 'incremental')
    }
    const allEvents = [...events, ...attendances.map((row) => ({ ...row, type: 'attended' })), ...sales.map((row) => ({ ...row, type: 'purchased' }))]
    for (const event of allEvents.filter((row) => dimensionMatches(row, filters))) {
        const identity = identityOf(event); const stage = eventType(event)
        if (!identity || !STAGE_SET.has(stage)) continue
        addStage(stages, stage, identity, 'observed')
        const anchors = actionByIdentity.get(identity) || []
        if (anchors.some((action) => isWithinAttributionWindow(action.contactedAt || action.contacted_at || action.createdAt || action.created_at, occurredAt(event), stage, normalizedWindows))) {
            addStage(stages, stage, identity, 'attributed'); if (treatment.has(identity)) addStage(stages, stage, identity, 'incremental')
        }
    }
    return {
        version: COMMERCIAL_ANALYTICS_VERSION,
        windows: normalizedWindows,
        stages: Object.fromEntries(COMMERCIAL_ANALYTICS_FUNNEL_STAGES.map((stage) => [stage, Object.fromEntries(ATTRIBUTION_STATES.values().map((state) => [state, stages[stage][state].size]))])),
        availability: { eligible: eligible.size, selectedRows: candidates.length, actionRows: actions.length, eventRows: allEvents.length, treatmentAssignments: treatment.size },
    }
}

export function deterministicExperimentVariant(identityId, experimentKey, seed, controlPercent = 10) {
    const identity = text(identityId); const key = text(experimentKey); const runSeed = text(seed); const percent = Number(controlPercent)
    if (!identity || !KEY.test(key) || !KEY.test(runSeed) || !Number.isInteger(percent) || percent < 1 || percent > 99) throw commercialAnalyticsError('COMMERCIAL_EXPERIMENT_ASSIGNMENT_INVALID')
    const bucketValue = Number.parseInt(hash({ identity, key, runSeed }).slice(0, 8), 16) % 10_000
    return bucketValue < percent * 100 ? 'control' : 'treatment'
}

export function buildExperimentAssignments(identities = [], { experimentKey, seed, controlPercent = 10, existingAssignments = [] } = {}) {
    const existing = new Map(existingAssignments.map((row) => [identityOf(row), row]).filter(([identity]) => identity))
    const seen = new Set()
    return identities.map((row) => {
        const identityId = identityOf(row)
        if (!identityId || seen.has(identityId)) return null
        seen.add(identityId)
        const previous = existing.get(identityId)
        const eligible = row.eligible !== false
        if (previous) {
            if (text(previous.unitSlug || previous.unit_slug) !== text(row.unitSlug || row.unit_slug)) throw commercialAnalyticsError('COMMERCIAL_EXPERIMENT_SCOPE_CONFLICT', 409)
            return { identityId, unitSlug: text(row.unitSlug || row.unit_slug) || null, variant: text(previous.variant), eligible: previous.eligible !== false, preserved: true, exclusionReason: previous.exclusionReason || previous.exclusion_reason || null }
        }
        return { identityId, unitSlug: text(row.unitSlug || row.unit_slug) || null, variant: eligible ? deterministicExperimentVariant(identityId, experimentKey, seed, controlPercent) : 'excluded', eligible, preserved: false, exclusionReason: eligible ? null : text(row.exclusionReason || row.exclusion_reason || 'criteria_not_met') }
    }).filter(Boolean)
}

function confidenceIntervalDifference(controlRate, controlSample, treatmentRate, treatmentSample) {
    if (controlSample < 30 || treatmentSample < 30) return null
    const error = 1.96 * Math.sqrt((controlRate * (1 - controlRate)) / controlSample + (treatmentRate * (1 - treatmentRate)) / treatmentSample)
    const difference = treatmentRate - controlRate
    return [round(difference - error), round(difference + error)]
}

export function buildExperimentResult(assignments = [], outcomes = []) {
    const outcomesByIdentity = new Map()
    for (const row of outcomes) {
        const identity = identityOf(row); if (!identity) continue
        const current = outcomesByIdentity.get(identity) || { converted: false, revenue: 0 }
        current.converted ||= row.converted === true || ['responded', 'scheduled', 'attended', 'purchased', 'returned'].includes(eventType(row))
        current.revenue += nonNegative(row.revenue ?? row.amount)
        outcomesByIdentity.set(identity, current)
    }
    const groups = { control: [], treatment: [] }
    for (const assignment of assignments) {
        const variant = text(assignment.variant); if (!groups[variant] || assignment.eligible === false) continue
        groups[variant].push(outcomesByIdentity.get(identityOf(assignment)) || { converted: false, revenue: 0 })
    }
    const summarize = (rows) => {
        const conversions = rows.filter((row) => row.converted).length
        const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
        return { sample: rows.length, conversions, conversionRate: rows.length ? round(conversions / rows.length) : null, revenue: round(revenue, 2), revenuePerMember: rows.length ? round(revenue / rows.length, 2) : null }
    }
    const control = summarize(groups.control); const treatment = summarize(groups.treatment)
    const sufficientSample = control.sample >= 30 && treatment.sample >= 30
    const lift = control.conversionRate && treatment.conversionRate != null ? round((treatment.conversionRate - control.conversionRate) / control.conversionRate) : null
    const incrementalRevenue = control.revenuePerMember != null && treatment.sample ? round(treatment.revenue - control.revenuePerMember * treatment.sample, 2) : null
    return { control, treatment, lift, incrementalRevenue, confidenceInterval95: control.conversionRate != null && treatment.conversionRate != null ? confidenceIntervalDifference(control.conversionRate, control.sample, treatment.conversionRate, treatment.sample) : null, sufficientSample, warning: sufficientSample ? null : 'INSUFFICIENT_SAMPLE' }
}

export function normalizeSegmentDefinition(input = {}) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const key = text(source.key || source.segmentKey); const version = text(source.version || source.segmentVersion)
    const criteria = sanitizeAnalyticsPayload(source.criteria)
    const thresholds = sanitizeAnalyticsPayload(source.thresholds || {})
    const percentiles = sanitizeAnalyticsPayload(source.percentiles || {})
    if (!KEY.test(key) || !KEY.test(version) || !criteria || Object.keys(criteria).length === 0) throw commercialAnalyticsError('COMMERCIAL_SEGMENT_DEFINITION_INVALID')
    return { key, version, criteria, thresholds, percentiles, effectiveFrom: text(source.effectiveFrom || source.effective_from) || null, author: containsPii(source.author) ? null : text(source.author).slice(0, 160) || null }
}

export function buildSegmentMembershipSnapshot(definition, members = [], { snapshotAt = new Date(), unitSlug = null } = {}) {
    const normalized = normalizeSegmentDefinition(definition)
    const unique = [...new Set(members.map(identityOf).filter(Boolean))].sort()
    const distribution = {}
    for (const row of members) {
        const key = text(row.bucket || row.segmentBucket || row.segment_bucket || 'unclassified')
        if (key && KEY.test(key)) distribution[key] = (distribution[key] || 0) + 1
    }
    const snapshotDate = bucket(snapshotAt, 'day')
    return { segmentKey: normalized.key, segmentVersion: normalized.version, snapshotDate, unitSlug: text(unitSlug) || null, memberCount: unique.length, membershipHash: hash({ segmentKey: normalized.key, segmentVersion: normalized.version, snapshotDate, unitSlug: text(unitSlug) || null, members: unique }), distribution, definition: normalized }
}

export function buildSegmentDrift(snapshots = []) {
    const ordered = [...snapshots].sort((left, right) => {
        const dateOrder = String(left.snapshotDate || left.snapshot_date).localeCompare(String(right.snapshotDate || right.snapshot_date))
        return dateOrder || String(left.createdAt || left.created_at || '').localeCompare(String(right.createdAt || right.created_at || ''))
    })
    const current = ordered.at(-1); const previous = ordered.at(-2)
    if (!current || !previous) return { available: false, reason: 'INSUFFICIENT_SNAPSHOTS', dimensions: [] }
    const currentDistribution = current.distribution || {}; const previousDistribution = previous.distribution || {}
    const keys = [...new Set([...Object.keys(currentDistribution), ...Object.keys(previousDistribution)])].sort()
    return { available: true, currentDate: current.snapshotDate || current.snapshot_date, previousDate: previous.snapshotDate || previous.snapshot_date, population: { current: Math.round(nonNegative(current.memberCount ?? current.member_count)), previous: Math.round(nonNegative(previous.memberCount ?? previous.member_count)) }, dimensions: keys.map((key) => { const before = nonNegative(previousDistribution[key]); const after = nonNegative(currentDistribution[key]); return { key, current: after, previous: before, delta: round(after - before), relativeDelta: before ? round((after - before) / before) : null } }) }
}

export const __testables = { asDate, bucket, dimensionMatches, hoursBetween, hash }
