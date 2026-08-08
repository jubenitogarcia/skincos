import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UNIT_RE = /^[a-z0-9][a-z0-9._-]{0,119}$/i
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/
const TEMPLATE_KEY_RE = /^[a-z0-9][a-z0-9._-]{1,95}$/
const WEBHOOK_EVENT_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$/
const TEMPLATE_PLACEHOLDERS = new Set(['cliente', 'oferta', 'preco', 'condicoes'])
const WEBHOOK_EVENT_TYPES = new Set(['delivered', 'read', 'replied', 'failed', 'stop'])
const ASSISTED_HMAC_NAMESPACE = ['commercial', 'assisted'].join('-')
const ASSISTED_HMAC_PURPOSE_SUFFIX_RE = /^[a-z][a-z0-9-]{1,95}-v[1-9][0-9]*$/

// This must stay a compile-time safety contract. No environment variable can
// turn a confirmation, a handoff or a webhook into provider dispatch.
export const COMMERCIAL_ASSISTED_SAFETY_FLAGS = Object.freeze({
    providerSend: false,
    automationEnabled: false,
    bulkDispatchEnabled: false,
    commercialContactWritesEnabled: false,
    externalDispatch: false,
})

export const COMMERCIAL_ASSISTED_CONFIRMATION = 'CONFIRMAR_CONTATO_ASSISTIDO'
export const COMMERCIAL_ASSISTED_REVEAL_CONFIRMATION = 'REVELAR_DESTINATARIO_ASSISTIDO'
export const COMMERCIAL_ASSISTED_MIGRATION_ID = '20260807_commercial_assisted_whatsapp_v2'

function error(code, statusCode = 409) {
    const value = new Error(code)
    value.code = code
    value.statusCode = statusCode
    return value
}

function text(value) {
    return String(value ?? '').trim()
}

function canonical(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw error('COMMERCIAL_ASSISTED_CANONICAL_VALUE_INVALID', 400)
        return Object.is(value, -0) ? 0 : value
    }
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.keys(value).sort().map((key) => {
            if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key) || value[key] === undefined) {
                throw error('COMMERCIAL_ASSISTED_CANONICAL_VALUE_INVALID', 400)
            }
            return [key, canonical(value[key])]
        }))
    }
    throw error('COMMERCIAL_ASSISTED_CANONICAL_VALUE_INVALID', 400)
}

const DIRECT_PII_KEYS = new Set(['phone', 'email', 'telefone', 'recipient', 'rawphone', 'message', 'secret', 'token', 'cpf'])

function normalizedMetadataKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function directPiiInText(value) {
    const source = String(value || '')
    return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(source) || /(?:\+?\d[\s().-]*){8,}\d/.test(source)
}

export function containsDirectPii(value, seen = new WeakSet()) {
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return false
    if (typeof value === 'string') return directPiiInText(value)
    if (typeof value !== 'object') return true
    if (seen.has(value)) return true
    seen.add(value)
    if (Array.isArray(value)) return value.some((entry) => containsDirectPii(entry, seen))
    return Object.entries(value).some(([key, entry]) => DIRECT_PII_KEYS.has(normalizedMetadataKey(key)) || containsDirectPii(entry, seen))
}

export function assertNoDirectPii(value, code = 'COMMERCIAL_ASSISTED_PII_REJECTED') {
    if (containsDirectPii(value)) throw error(code, 400)
    return value
}

export function stableAssistedFingerprint(value) {
    assertNoDirectPii(value, 'COMMERCIAL_ASSISTED_PII_REJECTED')
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export function assistedHmac(secret, purpose, value) {
    const key = text(secret)
    if (Buffer.byteLength(key, 'utf8') < 32) throw error('COMMERCIAL_ASSISTED_HMAC_KEY_REQUIRED', 503)
    return createHmac('sha256', key).update(`${purpose}:${JSON.stringify(canonical(value))}`).digest('hex')
}

export function assistedHmacPurpose(suffix) {
    const normalizedSuffix = text(suffix).toLowerCase()
    if (!ASSISTED_HMAC_PURPOSE_SUFFIX_RE.test(normalizedSuffix)) throw error('COMMERCIAL_ASSISTED_HMAC_PURPOSE_INVALID', 400)
    return `${ASSISTED_HMAC_NAMESPACE}-${normalizedSuffix}`
}

export function actorReference(secret, actor) {
    const subject = text(actor?.actorSubject)
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/|-]{0,159}$/.test(subject)) throw error('ACTOR_IDENTITY_REQUIRED', 401)
    return `actor:${assistedHmac(secret, assistedHmacPurpose('actor-v1'), { subject })}`
}

export function normalizeUuid(value, code = 'COMMERCIAL_ASSISTED_ID_INVALID') {
    const id = text(value).toLowerCase()
    if (!UUID_RE.test(id)) throw error(code, 400)
    return id
}

export function normalizeUnit(value) {
    const unit = text(value).toLowerCase()
    if (!UNIT_RE.test(unit)) throw error('COMMERCIAL_ASSISTED_UNIT_INVALID', 400)
    return unit
}

export function normalizeIdempotencyKey(value) {
    const key = text(value)
    if (!IDEMPOTENCY_RE.test(key)) throw error('COMMERCIAL_ASSISTED_IDEMPOTENCY_KEY_INVALID', 400)
    return key
}

export function normalizeReason(value, code = 'COMMERCIAL_ASSISTED_REASON_INVALID') {
    const reason = text(value)
    if (reason.length < 8 || reason.length > 500 || containsDirectPii(reason)) throw error(code, 400)
    return reason
}

export function maskPhone(value) {
    const digits = String(value || '').replace(/\D/g, '')
    if (digits.length < 8) return 'Contato mascarado'
    return `•••• •••• ${digits.slice(-4)}`
}

export function normalizeTemplatePayload(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw error('COMMERCIAL_ASSISTED_TEMPLATE_PAYLOAD_INVALID', 400)
    const allowed = new Set(['templateKey', 'bodyTemplate', 'unit', 'status', 'validFrom', 'validUntil', 'reason', 'idempotencyKey'])
    if (Object.keys(payload).some((key) => !allowed.has(key))) throw error('COMMERCIAL_ASSISTED_TEMPLATE_PAYLOAD_INVALID', 400)
    assertNoDirectPii(payload, 'COMMERCIAL_ASSISTED_TEMPLATE_PII_REJECTED')
    const templateKey = text(payload.templateKey).toLowerCase()
    const bodyTemplate = String(payload.bodyTemplate || '').trim()
    const unit = normalizeUnit(payload.unit)
    const status = text(payload.status || 'draft').toLowerCase()
    if (!TEMPLATE_KEY_RE.test(templateKey)) throw error('COMMERCIAL_ASSISTED_TEMPLATE_KEY_INVALID', 400)
    if (!['draft', 'approved', 'disabled'].includes(status)) throw error('COMMERCIAL_ASSISTED_TEMPLATE_STATUS_INVALID', 400)
    if (bodyTemplate.length < 1 || bodyTemplate.length > 2_000 || containsDirectPii(bodyTemplate)) {
        throw error('COMMERCIAL_ASSISTED_TEMPLATE_BODY_INVALID', 400)
    }
    const placeholders = [...bodyTemplate.matchAll(/{{\s*([a-z_]+)\s*}}/g)].map((match) => match[1])
    if (placeholders.some((placeholder) => !TEMPLATE_PLACEHOLDERS.has(placeholder))) {
        throw error('COMMERCIAL_ASSISTED_TEMPLATE_PLACEHOLDER_INVALID', 400)
    }
    const validFrom = normalizeDate(payload.validFrom, 'COMMERCIAL_ASSISTED_TEMPLATE_VALID_FROM_INVALID')
    const validUntil = normalizeDate(payload.validUntil, 'COMMERCIAL_ASSISTED_TEMPLATE_VALID_UNTIL_INVALID')
    if (validFrom && validUntil && validUntil < validFrom) throw error('COMMERCIAL_ASSISTED_TEMPLATE_VALIDITY_INVALID', 400)
    return {
        templateKey,
        bodyTemplate,
        unit,
        status,
        validFrom,
        validUntil,
        reason: normalizeReason(payload.reason, 'COMMERCIAL_ASSISTED_TEMPLATE_REASON_INVALID'),
    }
}

function normalizeDate(value, code) {
    if (value === null || value === undefined || value === '') return null
    const date = text(value).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw error(code, 400)
    return date
}

export function offerContext(row = {}) {
    const procedures = Array.isArray(row.procedures) ? row.procedures.map((procedure) => ({
        id: text(procedure.id),
        name: text(procedure.name),
        quantity: Number(procedure.quantity || 1),
        quantityUnit: text(procedure.quantityUnit || procedure.quantity_unit || 'unidade'),
    })) : []
    const context = {
        schemaVersion: 'crm-commercial-offer-snapshot/v1',
        offerId: normalizeUuid(row.offerId || row.id, 'COMMERCIAL_ASSISTED_OFFER_INVALID'),
        offerKey: text(row.offerKey || row.offer_key),
        revision: Number(row.revision || 0),
        unit: normalizeUnit(row.unit || row.unitSlug || row.unit_slug),
        title: text(row.title),
        description: text(row.description),
        priceCents: row.priceCents ?? row.price_cents ?? null,
        currency: text(row.currency || 'BRL'),
        priceQualifier: text(row.priceQualifier || row.price_qualifier),
        installmentCount: row.installmentCount ?? row.installment_count ?? null,
        installmentValueCents: row.installmentValueCents ?? row.installment_value_cents ?? null,
        discountPercent: row.discountPercent ?? row.discount_percent ?? null,
        conditions: text(row.conditions),
        validityStart: normalizeDate(row.validityStart ?? row.validity_start, 'COMMERCIAL_ASSISTED_OFFER_VALIDITY_INVALID'),
        validityEnd: normalizeDate(row.validityEnd ?? row.validity_end, 'COMMERCIAL_ASSISTED_OFFER_VALIDITY_INVALID'),
        procedures,
    }
    assertNoDirectPii(context, 'COMMERCIAL_ASSISTED_OFFER_PII_REJECTED')
    if (!context.offerKey || !Number.isInteger(context.revision) || context.revision < 1 || !context.title || !context.priceQualifier || !procedures.length) {
        throw error('COMMERCIAL_ASSISTED_OFFER_INVALID', 400)
    }
    return { context, contextHash: stableAssistedFingerprint(context) }
}

export function templateContext(row = {}) {
    const context = {
        schemaVersion: 'crm-commercial-template-snapshot/v1',
        templateId: normalizeUuid(row.id || row.templateId, 'COMMERCIAL_ASSISTED_TEMPLATE_INVALID'),
        templateKey: text(row.template_key || row.templateKey),
        revision: Number(row.revision || 0),
        unit: normalizeUnit(row.unit_slug || row.unit || row.unitSlug),
        bodyTemplate: String(row.body_template || row.bodyTemplate || '').trim(),
        validFrom: normalizeDate(row.valid_from ?? row.validFrom, 'COMMERCIAL_ASSISTED_TEMPLATE_VALID_FROM_INVALID'),
        validUntil: normalizeDate(row.valid_until ?? row.validUntil, 'COMMERCIAL_ASSISTED_TEMPLATE_VALID_UNTIL_INVALID'),
    }
    assertNoDirectPii(context, 'COMMERCIAL_ASSISTED_TEMPLATE_PII_REJECTED')
    if (!TEMPLATE_KEY_RE.test(context.templateKey) || !Number.isInteger(context.revision) || context.revision < 1 ||
        !context.bodyTemplate || context.bodyTemplate.length > 2_000 || containsDirectPii(context.bodyTemplate)) {
        throw error('COMMERCIAL_ASSISTED_TEMPLATE_INVALID', 400)
    }
    return { context, contextHash: stableAssistedFingerprint(context) }
}

function formatOfferPrice(context) {
    if (context.priceCents === null || context.priceCents === undefined) return 'Condições aprovadas disponíveis'
    const amount = Number(context.priceCents) / 100
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: context.currency || 'BRL' }).format(amount)
}

export function renderMaskedPreview(template, offer) {
    const rendered = String(template.bodyTemplate || '')
        .replace(/{{\s*cliente\s*}}/g, 'Cliente')
        .replace(/{{\s*oferta\s*}}/g, offer.title)
        .replace(/{{\s*preco\s*}}/g, formatOfferPrice(offer))
        .replace(/{{\s*condicoes\s*}}/g, offer.conditions || 'Condições aprovadas')
    return rendered.slice(0, 4_096)
}

export function confirmationRequired(value) {
    if (text(value) !== COMMERCIAL_ASSISTED_CONFIRMATION) throw error('COMMERCIAL_ASSISTED_HUMAN_CONFIRMATION_REQUIRED', 409)
    return true
}

export function revealConfirmationRequired(value) {
    if (text(value) !== COMMERCIAL_ASSISTED_REVEAL_CONFIRMATION) throw error('COMMERCIAL_ASSISTED_REVEAL_CONFIRMATION_REQUIRED', 409)
    return true
}

export function previewContextHash(value) {
    return stableAssistedFingerprint({
        version: 'commercial-assisted-preview/v1',
        actionId: normalizeUuid(value.actionId, 'COMMERCIAL_ASSISTED_ACTION_INVALID'),
        identityId: normalizeUuid(value.identityId, 'COMMERCIAL_ASSISTED_IDENTITY_INVALID'),
        unit: normalizeUnit(value.unit),
        offerContextHash: text(value.offerContextHash),
        templateContextHash: text(value.templateContextHash),
        recipientPhoneHash: text(value.recipientPhoneHash),
        permissionRevision: Number(value.permissionRevision || 0),
        sourceFreshness: text(value.sourceFreshness),
        canaryValidation: text(value.canaryValidation),
        // These two revisions are deliberately part of the preview proof. A
        // confirmation cannot reuse a preview created before a policy or
        // emergency-control change was observed.
        policyVersion: text(value.policyVersion),
        emergencyRevision: text(value.emergencyRevision),
    })
}

const ALLOWED_TRANSITIONS = Object.freeze({
    confirmed: new Set(['delivered', 'failed', 'stop']),
    handed_off: new Set(['delivered', 'failed', 'stop']),
    delivered: new Set(['read', 'replied', 'stop']),
    read: new Set(['replied', 'stop']),
    replied: new Set(['stop']),
    failed: new Set(['stop']),
    stop: new Set(),
})

export function canAdvanceAssistedState(currentState, nextState) {
    const current = text(currentState || 'confirmed')
    const next = text(nextState)
    if (!WEBHOOK_EVENT_TYPES.has(next)) return false
    return ALLOWED_TRANSITIONS[current]?.has(next) === true
}

export function normalizeWebhookPayload(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('COMMERCIAL_ASSISTED_WEBHOOK_PAYLOAD_INVALID', 400)
    const allowed = new Set(['eventId', 'attemptId', 'eventType', 'occurredAt'])
    if (Object.keys(value).some((key) => !allowed.has(key))) throw error('COMMERCIAL_ASSISTED_WEBHOOK_PAYLOAD_INVALID', 400)
    assertNoDirectPii(value, 'COMMERCIAL_ASSISTED_WEBHOOK_PAYLOAD_INVALID')
    const eventId = text(value.eventId)
    const eventType = text(value.eventType).toLowerCase()
    const occurredAt = text(value.occurredAt)
    if (!WEBHOOK_EVENT_RE.test(eventId) || !WEBHOOK_EVENT_TYPES.has(eventType) || !Number.isFinite(Date.parse(occurredAt))) {
        throw error('COMMERCIAL_ASSISTED_WEBHOOK_PAYLOAD_INVALID', 400)
    }
    return { eventId, attemptId: normalizeUuid(value.attemptId, 'COMMERCIAL_ASSISTED_ATTEMPT_INVALID'), eventType, occurredAt: new Date(occurredAt).toISOString() }
}

export function verifyRawWebhookSignature({ rawBody, timestamp, signature, secret, now = Date.now(), maxAgeMs = 5 * 60_000 } = {}) {
    const key = text(secret)
    const ts = text(timestamp)
    const supplied = text(signature).replace(/^sha256=/i, '')
    if (Buffer.byteLength(key, 'utf8') < 32 || !Buffer.isBuffer(rawBody) || !ts || !supplied) return false
    const timestampNumber = Number(ts)
    if (!Number.isFinite(timestampNumber) || Math.abs(now - timestampNumber) > maxAgeMs) return false
    const expected = createHmac('sha256', key).update(Buffer.concat([Buffer.from(`${ts}.`, 'utf8'), rawBody])).digest('base64url')
    try {
        const left = Buffer.from(supplied)
        const right = Buffer.from(expected)
        return left.length === right.length && timingSafeEqual(left, right)
    } catch {
        return false
    }
}

export const __testables = {
    ALLOWED_TRANSITIONS,
    TEMPLATE_PLACEHOLDERS,
    WEBHOOK_EVENT_TYPES,
    canonical,
}
