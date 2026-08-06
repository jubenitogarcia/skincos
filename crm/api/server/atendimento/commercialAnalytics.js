import { createHash } from 'node:crypto'

export const COMMERCIAL_ANALYTICS_VERSION = 'commercial-analytics/v1'
export const COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW_VERSION = 'v1'
export const COMMERCIAL_ANALYTICS_FUNNEL_STAGES = Object.freeze([
    'eligible', 'selected', 'action_created', 'contacted', 'delivered',
    'responded', 'scheduled', 'attended', 'purchased', 'returned',
])
export const COMMERCIAL_ANALYTICS_EVENT_TYPES = Object.freeze([
    ...COMMERCIAL_ANALYTICS_FUNNEL_STAGES,
])
export const COMMERCIAL_ANALYTICS_DEFAULT_WINDOWS = Object.freeze({
    responseDays: 7,
    appointmentDays: 14,
    attendanceDays: 60,
    saleDays: 60,
    returnDays: 180,
})

const PII_KEYS = new Set([
    'name', 'canonicalName', 'canonical_name', 'phone', 'phoneRaw', 'phone_raw',
    'email', 'emailRaw', 'email_raw', 'cpf', 'address', 'rawEvidence', 'evidence',
])

function finiteNumber(value, fallback = 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function nonNegative(value) {
    return Math.max(0, finiteNumber(value))
}

function asDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value
    const parsed = new Date(String(value || ''))
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isoDay(value) {
    const parsed = asDate(value)
    return parsed ? parsed.toISOString().slice(0, 10) : null
}

function hoursBetween(start, end) {
    const from = asDate(start)
    const to = asDate(end)
    if (!from || !to || to < from) return null
    return Math.round(((to.getTime() - from.getTime()) / 3600000) * 100) / 100
}

function boundedDays(value, fallback, maximum = 730) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 0) return fallback
    return Math.min(parsed, maximum)
}

export function normalizeAttributionWindows(value = {}, defaults = COMMERCIAL_ANALYTICS_DEFAULT_WINDOWS) {
    const source = value && typeof value === 'object' ? value : {}
    return {
        responseDays: boundedDays(source.responseDays ?? source.response_days, defaults.responseDays),
        appointmentDays: boundedDays(source.appointmentDays ?? source.appointment_days, defaults.appointmentDays),
        attendanceDays: boundedDays(source.attendanceDays ?? source.attendance_days, defaults.attendanceDays),
        saleDays: boundedDays(source.saleDays ?? source.sale_days, defaults.saleDays),
        returnDays: boundedDays(source.returnDays ?? source.return_days, defaults.returnDays),
    }
}

export function normalizeAnalyticsFilters(query = {}) {
    const source = query && typeof query === 'object' ? query : {}
    const dateValue = (key) => {
        const raw = String(source[key] || '').trim()
        if (!raw) return null
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            const error = new Error(`INVALID_ANALYTICS_${key.toUpperCase()}`)
            error.statusCode = 400
            throw error
        }
        return raw
    }
    const list = (key, max = 50) => {
        const raw = source[key]
        const values = Array.isArray(raw)
            ? raw
            : String(raw || '').split(',')
        return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))].slice(0, max)
    }
    const periodStart = dateValue('from') || dateValue('periodStart')
    const periodEnd = dateValue('to') || dateValue('periodEnd')
    if (periodStart && periodEnd && periodStart > periodEnd) {
        const error = new Error('INVALID_ANALYTICS_PERIOD')
        error.statusCode = 400
        throw error
    }
    const dimensions = list('dimensions')
    const allowedDimensions = new Set(['unit', 'campaign', 'segment', 'owner', 'channel', 'offer', 'policyVersion'])
    if (dimensions.some((dimension) => !allowedDimensions.has(dimension))) {
        const error = new Error('INVALID_ANALYTICS_DIMENSION')
        error.statusCode = 400
        throw error
    }
    return {
        from: periodStart,
        to: periodEnd,
        unit: String(source.unit || '').trim() || null,
        units: list('units'),
        campaign: String(source.campaign || '').trim() || null,
        segment: String(source.segment || '').trim() || null,
        owner: String(source.owner || '').trim() || null,
        channel: String(source.channel || '').trim() || null,
        offer: String(source.offer || '').trim() || null,
        policyVersion: String(source.policyVersion || '').trim() || null,
        findingKey: String(source.findingKey || '').trim() || null,
        sourceKey: String(source.sourceKey || '').trim() || null,
        granularity: ['day', 'week', 'month'].includes(String(source.granularity || 'day'))
            ? String(source.granularity || 'day')
            : 'day',
        attributionState: ['observed', 'attributed', 'incremental'].includes(String(source.attributionState || 'attributed'))
            ? String(source.attributionState || 'attributed')
            : 'attributed',
        dimensions,
        limit: Math.min(365, Math.max(1, Number.isInteger(Number(source.limit)) ? Number(source.limit) : 90)),
    }
}

function bucketDate(value, granularity) {
    const day = isoDay(value)
    if (!day) return null
    if (granularity === 'month') return `${day.slice(0, 7)}-01`
    if (granularity === 'week') {
        const date = new Date(`${day}T00:00:00Z`)
        const weekday = date.getUTCDay() || 7
        date.setUTCDate(date.getUTCDate() - weekday + 1)
        return date.toISOString().slice(0, 10)
    }
    return day
}

function sortByDate(rows, field = 'created_at') {
    return [...(rows || [])].sort((left, right) => {
        const a = asDate(left?.[field])?.getTime() || 0
        const b = asDate(right?.[field])?.getTime() || 0
        return a - b
    })
}

function currentFindingMap(findings) {
    return new Map((findings || []).map((row) => [String(row.finding_key || row.findingKey || ''), row]))
}

export function buildQualityTimeSeries({ findings = [], findingEvents = [], metricSnapshots = [], asOf = new Date(), granularity = 'day' } = {}) {
    const now = asDate(asOf) || new Date()
    const byFinding = new Map()
    const findingRows = currentFindingMap(findings)
    for (const event of sortByDate(findingEvents)) {
        const key = String(event.finding_key || event.findingKey || event.key || '')
        if (!key) continue
        const bucket = bucketDate(event.created_at || event.createdAt, granularity)
        if (!bucket) continue
        const series = byFinding.get(key) || new Map()
        const current = series.get(bucket)
        const observedCount = Math.round(nonNegative(event.observed_count ?? event.observedCount))
        series.set(bucket, {
            date: bucket,
            observedCount,
            events: (current?.events || 0) + 1,
            status: String(event.status || current?.status || 'open'),
        })
        byFinding.set(key, series)
    }
    // A current row without an event still contributes a point. This makes the
    // dashboard honest after a deployment that predates the append-only ledger.
    for (const [key, finding] of findingRows) {
        const bucket = bucketDate(finding.last_evaluated_at || finding.lastEvaluatedAt || now, granularity)
        if (!bucket) continue
        const series = byFinding.get(key) || new Map()
        if (!series.has(bucket)) series.set(bucket, {
            date: bucket,
            observedCount: Math.round(nonNegative(finding.observed_count ?? finding.observedCount)),
            events: 0,
            status: String(finding.status || 'open'),
        })
        byFinding.set(key, series)
    }

    const timing = []
    let reopened = 0
    let detected = 0
    let ownerCovered = 0
    let active = 0
    let overdueSla = 0
    const backlogAging = []
    for (const [key, finding] of findingRows) {
        const firstDetected = finding.first_detected_at || finding.firstDetectedAt
        const currentCount = Math.round(nonNegative(finding.observed_count ?? finding.observedCount))
        const status = String(finding.status || 'open')
        if (currentCount > 0) {
            active += 1
            const ageHours = hoursBetween(firstDetected, now)
            backlogAging.push({ findingKey: key, ageHours: ageHours === null ? 0 : ageHours, observedCount: currentCount })
            const due = asDate(finding.sla_due_at || finding.slaDueAt)
            if (due && due < now && ['open', 'acknowledged', 'in_progress'].includes(status)) overdueSla += 1
        }
        if (String(finding.owner || '').trim()) ownerCovered += 1
        const events = (findingEvents || []).filter((event) => String(event.finding_id || event.findingId || '') === String(finding.id || ''))
        const detectedEvent = sortByDate(events).find((event) => ['detected', 'reopened'].includes(event.event_type || event.eventType))
        const acknowledgement = sortByDate(events).find((event) => ['acknowledged', 'in_progress'].includes(event.status))
        const start = sortByDate(events).find((event) => String(event.status || '') === 'in_progress')
        const resolution = sortByDate(events).find((event) => ['cleared', 'resolved'].includes(event.event_type || event.eventType) || String(event.status || '') === 'resolved')
        if (events.some((event) => String(event.event_type || event.eventType) === 'reopened')) reopened += 1
        detected += events.filter((event) => ['detected', 'reopened'].includes(String(event.event_type || event.eventType))).length
        timing.push({
            findingKey: key,
            timeToRecognitionHours: hoursBetween(detectedEvent?.created_at || firstDetected, acknowledgement?.created_at || finding.acknowledged_at || finding.acknowledgedAt),
            timeToStartHours: hoursBetween(detectedEvent?.created_at || firstDetected, start?.created_at),
            timeToResolutionHours: hoursBetween(detectedEvent?.created_at || firstDetected, resolution?.created_at || finding.resolved_at || finding.resolvedAt),
        })
    }
    const aggregateMetricRows = (metricSnapshots || []).map((row) => ({
        date: bucketDate(row.bucket_date || row.bucketDate || row.recorded_at || row.recordedAt, granularity),
        sourceKey: row.source_key || row.sourceKey || null,
        findingKey: row.finding_key || row.findingKey || null,
        metrics: row.metrics && typeof row.metrics === 'object' ? row.metrics : {},
        unit: row.unit_slug || row.unitSlug || null,
    })).filter((row) => row.date)
    const latestByMetric = new Map()
    for (const row of aggregateMetricRows) latestByMetric.set(`${row.sourceKey || ''}:${row.findingKey || ''}:${row.unit || ''}`, row)
    const metrics = [...latestByMetric.values()]
    const average = (field) => {
        const values = timing.map((row) => row[field]).filter((value) => value !== null)
        return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null
    }
    return {
        granularity,
        byFinding: Object.fromEntries([...byFinding.entries()].map(([key, series]) => [key, [...series.values()].sort((a, b) => a.date.localeCompare(b.date))])),
        backlogAging: backlogAging.sort((a, b) => b.ageHours - a.ageHours),
        timing: {
            timeToRecognitionHours: average('timeToRecognitionHours'),
            timeToStartHours: average('timeToStartHours'),
            timeToResolutionHours: average('timeToResolutionHours'),
        },
        reopenRate: detected ? Math.round((reopened / detected) * 10000) / 10000 : 0,
        ownerCoverage: findingRows.size ? Math.round((ownerCovered / findingRows.size) * 10000) / 10000 : null,
        activeFindings: active,
        overdueSla,
        metrics,
        freshness: metrics.filter((row) => row.sourceKey && row.sourceKey.startsWith('freshness.')),
        lastValidExecution: metrics.filter((row) => row.sourceKey === 'source.last_valid_execution'),
    }
}

function eventType(row) {
    return String(row?.event_type || row?.eventType || '').trim().toLowerCase()
}

function identityKey(row) {
    return String(row?.identity_id || row?.identityId || '').trim()
}

function attributionLimit(stage, windows) {
    if (stage === 'responded') return windows.responseDays
    if (stage === 'scheduled') return windows.appointmentDays
    if (stage === 'attended') return windows.attendanceDays
    if (stage === 'purchased') return windows.saleDays
    if (stage === 'returned') return windows.returnDays
    return null
}

export function isWithinAttributionWindow(anchor, occurredAt, stage, windows = COMMERCIAL_ANALYTICS_DEFAULT_WINDOWS) {
    const from = asDate(anchor)
    const to = asDate(occurredAt)
    const limit = attributionLimit(stage, normalizeAttributionWindows(windows))
    if (!from || !to || to < from) return false
    if (limit === null) return true
    return to.getTime() <= from.getTime() + (limit * 86400000)
}

function stageEvent(row) {
    const type = eventType(row)
    return COMMERCIAL_ANALYTICS_FUNNEL_STAGES.includes(type) ? type : null
}

function eventDate(row) {
    return row?.occurred_at || row?.occurredAt || row?.created_at || row?.createdAt || row?.date || null
}

function dimensionMatches(row, filters) {
    const matches = (value, expected) => !expected || String(value || '') === String(expected)
    return matches(row?.unit_slug || row?.unitSlug, filters.unit)
        && matches(row?.campaign_key || row?.campaignKey, filters.campaign)
        && matches(row?.segment_key || row?.segmentKey, filters.segment)
        && matches(row?.owner, filters.owner)
        && matches(row?.channel || row?.contact_channel || row?.contactChannel, filters.channel)
        && matches(row?.offer_key || row?.offerKey, filters.offer)
        && matches(row?.policy_version || row?.policyVersion, filters.policyVersion)
}

export function buildCommercialFunnel({ actions = [], events = [], attendances = [], sales = [], eligibleIdentities = [], windows = COMMERCIAL_ANALYTICS_DEFAULT_WINDOWS, filters = {}, assignments = [] } = {}) {
    const attributionWindows = normalizeAttributionWindows(windows)
    const actionRows = (actions || []).filter((row) => dimensionMatches(row, filters))
    const eventRows = (events || []).filter((row) => dimensionMatches(row, filters))
    const identitySet = new Set(eligibleIdentities.map(identityKey).filter(Boolean))
    const stages = Object.fromEntries(COMMERCIAL_ANALYTICS_FUNNEL_STAGES.map((stage) => [stage, { observed: new Set(), attributed: new Set(), incremental: new Set() }]))
    const add = (stage, identity, observed, attributed = observed, incremental = false) => {
        if (!stage || !identity) return
        if (observed) stages[stage].observed.add(identity)
        if (attributed) stages[stage].attributed.add(identity)
        if (incremental) stages[stage].incremental.add(identity)
    }
    for (const identity of identitySet) add('eligible', identity, true, true)
    for (const action of actionRows) {
        const identity = identityKey(action)
        if (!identity) continue
        const createdAt = action.created_at || action.createdAt
        const anchor = action.contacted_at || action.contactedAt || createdAt
        add('selected', identity, true, true)
        add('action_created', identity, true, true)
        if (action.contacted_at || action.contactedAt || ['contacted', 'responded', 'scheduled', 'won_sale', 'returned'].includes(String(action.status || ''))) {
            add('contacted', identity, true, true)
        }
        const related = eventRows.filter((event) => identityKey(event) === identity && (!event.action_id || String(event.action_id) === String(action.id)))
        for (const event of related) {
            const stage = stageEvent(event)
            if (!stage) continue
            const observed = true
            const attributed = isWithinAttributionWindow(anchor, eventDate(event), stage, attributionWindows)
            const incremental = assignments.some((assignment) => String(assignment.identity_id || assignment.identityId) === identity && assignment.variant === 'treatment') && attributed
            add(stage, identity, observed, attributed, incremental)
        }
        // Existing action status/event ledger is the durable source until an
        // integration starts emitting the richer analytics event stream.
        const statusStage = {
            responded: 'responded', scheduled: 'scheduled', won_sale: 'purchased', returned: 'returned',
        }[String(action.status || '')]
        if (statusStage) add(statusStage, identity, true, isWithinAttributionWindow(anchor, action.updated_at || action.updatedAt, statusStage, attributionWindows))
    }
    const sourceRows = [
        ...(attendances || []).map((row) => ({ ...row, sourceStage: 'attended' })),
        ...(sales || []).map((row) => ({ ...row, sourceStage: 'purchased' })),
    ]
    for (const row of sourceRows) {
        const identity = identityKey(row)
        if (!identity) continue
        const matchingActions = actionRows.filter((action) => identityKey(action) === identity)
        for (const action of matchingActions) {
            const anchor = action.contacted_at || action.contactedAt || action.created_at || action.createdAt
            const stage = row.sourceStage
            add(stage, identity, true, isWithinAttributionWindow(anchor, eventDate(row), stage, attributionWindows))
        }
    }
    // Return is a subsequent attendance after a purchase, not an unbounded
    // future event. The explicit return window is applied by the source event
    // callers or by the richer event stream.
    const result = Object.fromEntries(COMMERCIAL_ANALYTICS_FUNNEL_STAGES.map((stage) => [stage, {
        observed: stages[stage].observed.size,
        attributed: stages[stage].attributed.size,
        incremental: stages[stage].incremental.size,
    }]))
    return {
        version: COMMERCIAL_ANALYTICS_VERSION,
        windows: { version: windows.version || COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW_VERSION, ...attributionWindows },
        filters,
        stages: result,
        dataAvailability: {
            observedEvents: eventRows.length,
            actionRows: actionRows.length,
            eligibleIdentities: identitySet.size,
            attribution: actionRows.length > 0,
        },
    }
}

export function deterministicExperimentVariant(identityId, experimentKey, seed, controlPercent = 10) {
    const key = `${String(experimentKey || '').trim()}|${String(seed || '').trim()}|${String(identityId || '').trim()}`
    const digest = createHash('sha256').update(key).digest()
    const value = digest.readUInt32BE(0) % 10000
    const control = Math.min(9900, Math.max(1, Math.round(Number(controlPercent) * 100)))
    return value < control ? 'control' : 'treatment'
}

export function buildExperimentAssignments(identities = [], { experimentKey, seed, controlPercent = 10, eligibility = {} } = {}) {
    const seen = new Set()
    return identities.map((identity) => {
        const identityId = identityKey(identity)
        if (!identityId || seen.has(identityId)) return null
        seen.add(identityId)
        const eligible = identity.eligible !== false
        return {
            identityId,
            unitSlug: identity.unit_slug || identity.unitSlug || null,
            variant: eligible ? deterministicExperimentVariant(identityId, experimentKey, seed, controlPercent) : 'excluded',
            eligible,
            eligibilityReason: eligible ? 'criteria_match' : String(identity.eligibilityReason || 'criteria_not_met'),
            eligibility,
        }
    }).filter(Boolean)
}

function normalApproximation(rate, sample) {
    if (!sample) return null
    return 1.96 * Math.sqrt((rate * (1 - rate)) / sample)
}

export function buildExperimentResult(assignments = [], outcomes = []) {
    const byIdentity = new Map()
    for (const outcome of outcomes || []) {
        const id = identityKey(outcome)
        if (!id) continue
        const current = byIdentity.get(id) || { converted: false, revenue: 0 }
        current.converted = current.converted || outcome.converted === true || ['responded', 'scheduled', 'attended', 'purchased', 'returned'].includes(eventType(outcome))
        current.revenue += nonNegative(outcome.revenue ?? outcome.amount)
        byIdentity.set(id, current)
    }
    const groups = { control: [], treatment: [] }
    for (const assignment of assignments || []) {
        if (!groups[assignment.variant]) continue
        const outcome = byIdentity.get(String(assignment.identity_id || assignment.identityId)) || { converted: false, revenue: 0 }
        groups[assignment.variant].push({ converted: !!outcome.converted, revenue: outcome.revenue })
    }
    const summarize = (rows) => {
        const conversions = rows.filter((row) => row.converted).length
        const rate = rows.length ? conversions / rows.length : 0
        const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
        const margin = normalApproximation(rate, rows.length)
        return { sample: rows.length, conversions, rate, revenue, confidenceInterval95: margin === null ? null : [Math.max(0, rate - margin), Math.min(1, rate + margin)] }
    }
    const control = summarize(groups.control)
    const treatment = summarize(groups.treatment)
    const lift = control.rate ? (treatment.rate - control.rate) / control.rate : null
    const incrementalRevenue = control.sample && treatment.sample
        ? treatment.revenue - (control.revenue / control.sample) * treatment.sample
        : null
    return {
        control,
        treatment,
        lift,
        incrementalRevenue,
        confidenceIntervalAdequate: control.sample >= 30 && treatment.sample >= 30,
        warning: control.sample < 30 || treatment.sample < 30 ? 'INSUFFICIENT_SAMPLE' : null,
    }
}

export function buildSegmentDrift(snapshots = []) {
    const ordered = [...(snapshots || [])].sort((a, b) => String(a.snapshot_date || a.snapshotDate || '').localeCompare(String(b.snapshot_date || b.snapshotDate || '')))
    const current = ordered.at(-1)
    const previous = ordered.at(-2)
    if (!current || !previous) return { available: false, reason: 'INSUFFICIENT_SNAPSHOTS', dimensions: [] }
    const currentDistribution = current.distribution || {}
    const previousDistribution = previous.distribution || {}
    const keys = [...new Set([...Object.keys(currentDistribution), ...Object.keys(previousDistribution)])].sort()
    return {
        available: true,
        currentDate: current.snapshot_date || current.snapshotDate,
        previousDate: previous.snapshot_date || previous.snapshotDate,
        dimensions: keys.map((key) => {
            const currentValue = nonNegative(currentDistribution[key])
            const previousValue = nonNegative(previousDistribution[key])
            return {
                key,
                current: currentValue,
                previous: previousValue,
                delta: Math.round((currentValue - previousValue) * 10000) / 10000,
                relativeDelta: previousValue ? Math.round(((currentValue - previousValue) / previousValue) * 10000) / 10000 : null,
            }
        }),
    }
}

export function sanitizeAnalyticsPayload(value) {
    if (Array.isArray(value)) return value.slice(0, 100).map(sanitizeAnalyticsPayload)
    if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0, 500) : value
    const result = {}
    for (const [key, item] of Object.entries(value)) {
        if (PII_KEYS.has(key) || /phone|email|cpf|address|raw/i.test(key)) continue
        if (Object.keys(result).length >= 40) break
        result[key] = sanitizeAnalyticsPayload(item)
    }
    return result
}

export const __testables = {
    asDate,
    bucketDate,
    hoursBetween,
    attributionLimit,
    dimensionMatches,
}
