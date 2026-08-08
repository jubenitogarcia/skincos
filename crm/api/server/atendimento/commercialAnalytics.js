import { createHash } from 'node:crypto'

// This module is intentionally a narrow, PII-free analytics contract.  It
// accepts only explicit segment criteria and turns no observation into a
// communication, permission write, or clinical recommendation.
export const COMMERCIAL_ANALYTICS_MIGRATION_ID = '20260807_commercial_analytics_v2'

export const COMMERCIAL_ANALYTICS_SAFETY_FLAGS = Object.freeze({
    commercialContactWritesEnabled: false,
    messagesEnabled: false,
    autonomousMessagingEnabled: false,
    consentWritesEnabled: false,
})

export const COMMERCIAL_ANALYTICS_FUNNEL_STAGES = Object.freeze([
    'eligible', 'selected', 'action_created', 'contacted', 'delivered',
    'responded', 'scheduled', 'attended', 'purchased', 'returned',
])

export const COMMERCIAL_EXPERIMENT_STATES = Object.freeze(['draft', 'active', 'closed', 'disabled'])
export const COMMERCIAL_EXPERIMENT_VARIANTS = Object.freeze(['treatment', 'control', 'excluded'])
// These are explicit policy defaults, not an implicit indefinite attribution
// fallback.  Every persisted row remains versioned and may override them.
export const COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW = Object.freeze({
    responseDays: 7,
    scheduledDays: 14,
    attendedDays: 30,
    purchasedDays: 30,
    returnedDays: 60,
})
export const COMMERCIAL_SEGMENT_CRITERIA_KEYS = Object.freeze([
    'minimum_lifetime_sales',
    'minimum_visits',
    'minimum_recency_days',
    'maximum_recency_days',
    'minimum_lifetime_sales_percentile',
    'minimum_visits_percentile',
    'requires_permission',
    'requires_phone_correlation',
    'requires_fresh_sources',
    'source_freshness_max_hours',
    'identity_quality',
    'procedure_ids',
    'sales_classifications',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UNIT_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/
const KEY_RE = /^[a-z][a-z0-9_]{2,80}$/
const ID_RE = /^[A-Za-z0-9._:-]{8,200}$/
const PII_ALIAS_RE = /(email|e_?mail|phone|telefone|whatsapp|name|nome|cpf|address|endereco|contact|contato|pii|alias|raw|evidence|context)/i
const criterionKeys = new Set(COMMERCIAL_SEGMENT_CRITERIA_KEYS)
const salesClassifications = new Set(['mapped', 'unmapped'])
const identityQualities = new Set(['confirmed_multi_source', 'unresolved_single_source'])

function text(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

function containsPiiLikeValue(value) {
    const raw = text(value)
    return raw.includes('@') || /\d{7,}/.test(raw)
}

function plainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
        (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function boundedInteger(value, { minimum = 0, maximum = 1_000_000, code }) {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw commercialAnalyticsError(code)
    return parsed
}

function parseDateTime(value, code) {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) throw commercialAnalyticsError(code)
    return parsed.toISOString()
}

export function commercialAnalyticsError(code, statusCode = 400) {
    const error = new Error(code)
    error.code = code
    error.statusCode = statusCode
    return error
}

export function stableAnalyticsFingerprint(value) {
    const normalize = (candidate) => {
        if (candidate === null || typeof candidate !== 'object') return candidate
        if (Array.isArray(candidate)) return candidate.map(normalize)
        return Object.fromEntries(Object.keys(candidate).sort().map((key) => [key, normalize(candidate[key])]))
    }
    return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
}

/**
 * Validates a deliberately small DSL.  There is no generic JSON filter
 * language: camelCase, unknown keys, nested objects and contact-like aliases
 * are all rejected before criteria reaches storage or SQL.
 */
export function normalizeSegmentCriteria(value) {
    if (!plainObject(value)) throw commercialAnalyticsError('SEGMENT_CRITERIA_OBJECT_REQUIRED')
    const keys = Object.keys(value)
    if (!keys.length || keys.length > COMMERCIAL_SEGMENT_CRITERIA_KEYS.length) {
        throw commercialAnalyticsError('SEGMENT_CRITERIA_REQUIRED')
    }
    const normalized = {}
    for (const key of keys.sort()) {
        if (/[A-Z]/.test(key)) throw commercialAnalyticsError('SEGMENT_CRITERIA_CAMEL_CASE_FORBIDDEN')
        if (PII_ALIAS_RE.test(key)) throw commercialAnalyticsError('SEGMENT_CRITERIA_PII_ALIAS_FORBIDDEN')
        if (!criterionKeys.has(key)) throw commercialAnalyticsError('SEGMENT_CRITERIA_KEY_NOT_ALLOWED')
        const candidate = value[key]
        if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
            throw commercialAnalyticsError('SEGMENT_CRITERIA_NESTED_VALUE_FORBIDDEN')
        }
        if (key === 'minimum_lifetime_sales') {
            normalized[key] = Number(candidate)
            if (!Number.isFinite(normalized[key]) || normalized[key] < 0 || normalized[key] > 1_000_000_000) {
                throw commercialAnalyticsError('SEGMENT_CRITERIA_VALUE_INVALID')
            }
            continue
        }
        if (['minimum_visits', 'minimum_recency_days', 'maximum_recency_days', 'source_freshness_max_hours'].includes(key)) {
            normalized[key] = boundedInteger(candidate, {
                minimum: key === 'source_freshness_max_hours' ? 1 : 0,
                maximum: key === 'source_freshness_max_hours' ? 24 * 30 : 365 * 20,
                code: 'SEGMENT_CRITERIA_VALUE_INVALID',
            })
            continue
        }
        if (['minimum_lifetime_sales_percentile', 'minimum_visits_percentile'].includes(key)) {
            normalized[key] = boundedInteger(candidate, { minimum: 1, maximum: 100, code: 'SEGMENT_CRITERIA_VALUE_INVALID' })
            continue
        }
        if (['requires_permission', 'requires_phone_correlation', 'requires_fresh_sources'].includes(key)) {
            if (typeof candidate !== 'boolean') throw commercialAnalyticsError('SEGMENT_CRITERIA_VALUE_INVALID')
            normalized[key] = candidate
            continue
        }
        if (key === 'identity_quality') {
            const quality = text(candidate)
            if (!identityQualities.has(quality)) throw commercialAnalyticsError('SEGMENT_CRITERIA_VALUE_INVALID')
            normalized[key] = quality
            continue
        }
        if (key === 'procedure_ids') {
            if (!Array.isArray(candidate) || !candidate.length || candidate.length > 50) throw commercialAnalyticsError('SEGMENT_CRITERIA_VALUE_INVALID')
            const values = [...new Set(candidate.map(text))].sort()
            if (values.some((item) => !/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(item) || PII_ALIAS_RE.test(item))) {
                throw commercialAnalyticsError('SEGMENT_CRITERIA_VALUE_INVALID')
            }
            normalized[key] = values
            continue
        }
        if (key === 'sales_classifications') {
            if (!Array.isArray(candidate) || !candidate.length || candidate.length > salesClassifications.size) {
                throw commercialAnalyticsError('SEGMENT_CRITERIA_VALUE_INVALID')
            }
            const values = [...new Set(candidate.map((item) => text(item).toLowerCase()))].sort()
            if (values.some((item) => !salesClassifications.has(item))) throw commercialAnalyticsError('SEGMENT_CRITERIA_VALUE_INVALID')
            normalized[key] = values
        }
    }
    if (normalized.minimum_recency_days != null && normalized.maximum_recency_days != null &&
        normalized.minimum_recency_days > normalized.maximum_recency_days) {
        throw commercialAnalyticsError('SEGMENT_CRITERIA_RANGE_INVALID')
    }
    return normalized
}

export function normalizeAnalyticsMutation(payload = {}, { requireReason = true, allowCreateRevision = false } = {}) {
    const input = plainObject(payload) ? payload : {}
    const idempotencyKey = text(input.idempotencyKey)
    const reason = text(input.reason)
    const expectedRevision = input.expectedRevision == null || input.expectedRevision === '' ? null : Number(input.expectedRevision)
    if (!ID_RE.test(idempotencyKey) || containsPiiLikeValue(idempotencyKey)) {
        throw commercialAnalyticsError('COMMERCIAL_ANALYTICS_IDEMPOTENCY_KEY_REQUIRED')
    }
    if (requireReason && (reason.length < 3 || reason.length > 1_000 || containsPiiLikeValue(reason))) {
        throw commercialAnalyticsError('COMMERCIAL_ANALYTICS_REASON_INVALID')
    }
    if (expectedRevision != null && (!Number.isInteger(expectedRevision) || expectedRevision < (allowCreateRevision ? 0 : 1))) {
        throw commercialAnalyticsError('COMMERCIAL_ANALYTICS_EXPECTED_REVISION_INVALID')
    }
    return { idempotencyKey, reason, expectedRevision }
}

export function normalizeSegmentPayload(payload = {}) {
    const input = plainObject(payload) ? payload : {}
    const name = text(input.name)
    const key = text(input.key).toLowerCase()
    const unit = text(input.unit).toLowerCase()
    if (!name || name.length > 120 || containsPiiLikeValue(name)) throw commercialAnalyticsError('SEGMENT_NAME_INVALID')
    if (!KEY_RE.test(key)) throw commercialAnalyticsError('SEGMENT_KEY_INVALID')
    if (!UNIT_RE.test(unit)) throw commercialAnalyticsError('SEGMENT_UNIT_INVALID')
    return {
        name,
        key,
        unit,
        criteria: normalizeSegmentCriteria(input.criteria),
        mutation: normalizeAnalyticsMutation(input, { allowCreateRevision: true }),
    }
}

export function normalizeAttributionWindowPayload(payload = {}) {
    const input = plainObject(payload) ? payload : {}
    const key = text(input.key).toLowerCase()
    const unit = text(input.unit).toLowerCase()
    if (!KEY_RE.test(key)) throw commercialAnalyticsError('ATTRIBUTION_WINDOW_KEY_INVALID')
    if (!UNIT_RE.test(unit)) throw commercialAnalyticsError('ATTRIBUTION_WINDOW_UNIT_INVALID')
    const startsAt = parseDateTime(input.startsAt, 'ATTRIBUTION_WINDOW_RANGE_INVALID')
    const endsAt = input.endsAt ? parseDateTime(input.endsAt, 'ATTRIBUTION_WINDOW_RANGE_INVALID') : null
    if (endsAt && endsAt <= startsAt) throw commercialAnalyticsError('ATTRIBUTION_WINDOW_RANGE_INVALID')
    return {
        key,
        unit,
        startsAt,
        endsAt,
        responseDays: boundedInteger(input.responseDays ?? COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW.responseDays, { minimum: 1, maximum: 60, code: 'ATTRIBUTION_WINDOW_VALUE_INVALID' }),
        scheduledDays: boundedInteger(input.scheduledDays ?? COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW.scheduledDays, { minimum: 1, maximum: 120, code: 'ATTRIBUTION_WINDOW_VALUE_INVALID' }),
        attendedDays: boundedInteger(input.attendedDays ?? COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW.attendedDays, { minimum: 1, maximum: 180, code: 'ATTRIBUTION_WINDOW_VALUE_INVALID' }),
        purchasedDays: boundedInteger(input.purchasedDays ?? COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW.purchasedDays, { minimum: 1, maximum: 180, code: 'ATTRIBUTION_WINDOW_VALUE_INVALID' }),
        returnedDays: boundedInteger(input.returnedDays ?? COMMERCIAL_ANALYTICS_DEFAULT_ATTRIBUTION_WINDOW.returnedDays, { minimum: 1, maximum: 365, code: 'ATTRIBUTION_WINDOW_VALUE_INVALID' }),
        mutation: normalizeAnalyticsMutation(input, { allowCreateRevision: true }),
    }
}

export function normalizeExperimentPayload(payload = {}) {
    const input = plainObject(payload) ? payload : {}
    const name = text(input.name)
    const unit = text(input.unit).toLowerCase()
    const segmentVersionId = text(input.segmentVersionId).toLowerCase()
    const attributionWindowId = text(input.attributionWindowId).toLowerCase()
    const startsAt = parseDateTime(input.startsAt, 'COMMERCIAL_EXPERIMENT_RANGE_INVALID')
    const endsAt = parseDateTime(input.endsAt, 'COMMERCIAL_EXPERIMENT_RANGE_INVALID')
    const controlGroupPercent = boundedInteger(input.controlGroupPercent, { minimum: 1, maximum: 99, code: 'COMMERCIAL_EXPERIMENT_CONTROL_INVALID' })
    if (!name || name.length > 120 || containsPiiLikeValue(name)) throw commercialAnalyticsError('COMMERCIAL_EXPERIMENT_NAME_INVALID')
    if (!UNIT_RE.test(unit)) throw commercialAnalyticsError('COMMERCIAL_EXPERIMENT_UNIT_INVALID')
    if (!UUID_RE.test(segmentVersionId) || !UUID_RE.test(attributionWindowId)) throw commercialAnalyticsError('COMMERCIAL_EXPERIMENT_REFERENCE_INVALID')
    if (endsAt <= startsAt) throw commercialAnalyticsError('COMMERCIAL_EXPERIMENT_RANGE_INVALID')
    return {
        name,
        unit,
        segmentVersionId,
        attributionWindowId,
        startsAt,
        endsAt,
        controlGroupPercent,
        mutation: normalizeAnalyticsMutation(input, { allowCreateRevision: true }),
    }
}

export function deterministicExperimentVariant({ experimentId, identityId, controlGroupPercent }) {
    if (!UUID_RE.test(text(experimentId)) || !UUID_RE.test(text(identityId))) {
        throw commercialAnalyticsError('COMMERCIAL_EXPERIMENT_ASSIGNMENT_INVALID')
    }
    const percent = boundedInteger(controlGroupPercent, { minimum: 1, maximum: 99, code: 'COMMERCIAL_EXPERIMENT_CONTROL_INVALID' })
    const bucket = Number.parseInt(stableAnalyticsFingerprint({ experimentId: text(experimentId), identityId: text(identityId) }).slice(0, 8), 16) % 100
    return bucket < percent ? 'control' : 'treatment'
}

export function calculateExperimentLift(rows = []) {
    const groups = {
        treatment: { population: 0, conversions: 0, revenue: 0 },
        control: { population: 0, conversions: 0, revenue: 0 },
    }
    for (const row of Array.isArray(rows) ? rows : []) {
        const variant = text(row?.variant)
        if (!Object.hasOwn(groups, variant)) continue
        const population = Math.max(0, Number(row?.population || 0))
        const conversions = Math.max(0, Number(row?.conversions || 0))
        const revenue = Math.max(0, Number(row?.revenue || 0))
        groups[variant].population += population
        groups[variant].conversions += Math.min(population, conversions)
        groups[variant].revenue += revenue
    }
    const treatmentRate = groups.treatment.population ? groups.treatment.conversions / groups.treatment.population : null
    const controlRate = groups.control.population ? groups.control.conversions / groups.control.population : null
    const lift = treatmentRate == null || controlRate == null ? null : treatmentRate - controlRate
    const adequateSample = groups.treatment.population >= 30 && groups.control.population >= 30
    const standardError = adequateSample && lift != null
        ? Math.sqrt((treatmentRate * (1 - treatmentRate) / groups.treatment.population) +
            (controlRate * (1 - controlRate) / groups.control.population))
        : null
    return {
        treatment: { ...groups.treatment, conversionRate: treatmentRate },
        control: { ...groups.control, conversionRate: controlRate },
        observedLift: lift == null ? null : Math.round(lift * 10_000) / 10_000,
        incrementalConversions: lift == null ? null : Math.round(lift * groups.treatment.population * 10_000) / 10_000,
        incrementalRevenue: groups.control.population && groups.treatment.population
            ? Math.round((groups.treatment.revenue - (groups.control.revenue / groups.control.population) * groups.treatment.population) * 100) / 100
            : null,
        confidenceInterval95: standardError == null || lift == null
            ? null
            : { lower: lift - 1.96 * standardError, upper: lift + 1.96 * standardError },
        adequateSample,
        warning: adequateSample ? null : 'INSUFFICIENT_EXPERIMENT_SAMPLE',
    }
}

export function commercialAnalyticsSafety() {
    return { ...COMMERCIAL_ANALYTICS_SAFETY_FLAGS }
}
