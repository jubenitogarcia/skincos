// Source-owned membership state and deterministic change planning for the
// CRM Core projection delta feed.  This module deliberately knows only opaque
// identity UUIDs and canonical unit slugs; customer attributes never cross the
// boundary.

export const CRM_CORE_PROJECTION_DELTA_VERSION = 'atendimento/crm-core/projection-delta/v1'
export const CRM_CORE_PROJECTION_DELTA_OPERATION_UPSERT = 'upsert'
export const CRM_CORE_PROJECTION_DELTA_OPERATION_REVOKE = 'revoke'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const UNIT_SLUG_PATTERN = /^(?!all$|unknown$)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function fail(code) {
    const error = new Error(code)
    error.code = code
    throw error
}

function object(value, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
    return value
}

function text(value, code) {
    const normalized = String(value ?? '').trim()
    if (!normalized) fail(code)
    return normalized
}

function timestamp(value, code) {
    const parsed = value instanceof Date ? value : new Date(String(value ?? '').trim())
    if (Number.isNaN(parsed.getTime())) fail(code)
    return parsed.toISOString()
}

function identityId(value, code) {
    const normalized = text(value, code).toLowerCase()
    if (!UUID_PATTERN.test(normalized)) fail(code)
    return normalized
}

function unitSlug(value, code) {
    const normalized = text(value, code)
    if (normalized !== normalized.toLowerCase() || !UNIT_SLUG_PATTERN.test(normalized)) fail(code)
    return normalized
}

function revision(value, code) {
    const normalized = Number(value)
    if (!Number.isSafeInteger(normalized) || normalized < 1) fail(code)
    return normalized
}

function membershipKey(identity, unit) {
    return `${identity}\u0000${unit}`
}

/**
 * Normalizes one row from the owner-defined canonical membership query.  The
 * accepted shape intentionally contains no name, phone, email, source id or
 * payload field.
 */
export function assertAtendimentoProjectionMembershipRow(value) {
    const row = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_MEMBERSHIP_ROW_INVALID')
    const keys = Object.keys(row)
    const snakeShape = keys.length === 3 && ['identity_id', 'unit_slug', 'observed_at'].every((key) => keys.includes(key))
    const camelShape = keys.length === 3 && ['identityId', 'unitSlug', 'observedAt'].every((key) => keys.includes(key))
    if (!snakeShape && !camelShape) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_MEMBERSHIP_ROW_INVALID')
    const identity = row.identity_id ?? row.identityId
    const unit = row.unit_slug ?? row.unitSlug
    const observed = row.observed_at ?? row.observedAt
    return Object.freeze({
        identityId: identityId(identity, 'ATENDIMENTO_CRM_PROJECTION_DELTA_MEMBERSHIP_ROW_INVALID'),
        unitSlug: unitSlug(unit, 'ATENDIMENTO_CRM_PROJECTION_DELTA_MEMBERSHIP_ROW_INVALID'),
        observedAt: timestamp(observed, 'ATENDIMENTO_CRM_PROJECTION_DELTA_MEMBERSHIP_ROW_INVALID'),
    })
}

function assertExistingMembership(value) {
    const row = object(value, 'ATENDIMENTO_CRM_PROJECTION_DELTA_STATE_INVALID')
    const keys = Object.keys(row)
    const snakeShape = keys.length === 5 && ['identity_id', 'unit_slug', 'active', 'revision', 'observed_at'].every((key) => keys.includes(key))
    const camelShape = keys.length === 5 && ['identityId', 'unitSlug', 'active', 'revision', 'observedAt'].every((key) => keys.includes(key))
    if (!snakeShape && !camelShape) fail('ATENDIMENTO_CRM_PROJECTION_DELTA_STATE_INVALID')
    const identity = row.identity_id ?? row.identityId
    const unit = row.unit_slug ?? row.unitSlug
    const observed = row.observed_at ?? row.observedAt
    const active = row.active
    if (typeof active !== 'boolean') fail('ATENDIMENTO_CRM_PROJECTION_DELTA_STATE_INVALID')
    return Object.freeze({
        identityId: identityId(identity, 'ATENDIMENTO_CRM_PROJECTION_DELTA_STATE_INVALID'),
        unitSlug: unitSlug(unit, 'ATENDIMENTO_CRM_PROJECTION_DELTA_STATE_INVALID'),
        active,
        revision: revision(row.revision, 'ATENDIMENTO_CRM_PROJECTION_DELTA_STATE_INVALID'),
        observedAt: timestamp(observed, 'ATENDIMENTO_CRM_PROJECTION_DELTA_STATE_INVALID'),
    })
}

function normalizedRows(value, normalizer, code) {
    if (!Array.isArray(value)) fail(code)
    const rows = value.map(normalizer)
    const seen = new Set()
    for (const row of rows) {
        const key = membershipKey(row.identityId, row.unitSlug)
        if (seen.has(key)) fail(code)
        seen.add(key)
    }
    return rows.sort((left, right) => membershipKey(left.identityId, left.unitSlug).localeCompare(membershipKey(right.identityId, right.unitSlug)))
}

/**
 * Computes a transaction-safe plan from one canonical source snapshot and the
 * previously materialized source state.  A changed observed timestamp is a
 * new revision even when the membership remains active; a missing active row
 * becomes exactly one revoke and is retained as a tombstone.
 */
export function reconcileAtendimentoProjectionMembershipRows({ current, existing, observedAt } = {}) {
    const currentRows = normalizedRows(current, assertAtendimentoProjectionMembershipRow, 'ATENDIMENTO_CRM_PROJECTION_DELTA_SOURCE_INVALID')
    const existingRows = normalizedRows(existing, assertExistingMembership, 'ATENDIMENTO_CRM_PROJECTION_DELTA_STATE_INVALID')
    const observedNow = timestamp(observedAt ?? new Date(), 'ATENDIMENTO_CRM_PROJECTION_DELTA_OBSERVED_AT_INVALID')
    const currentByKey = new Map(currentRows.map((row) => [membershipKey(row.identityId, row.unitSlug), row]))
    const existingByKey = new Map(existingRows.map((row) => [membershipKey(row.identityId, row.unitSlug), row]))
    const changes = []

    for (const row of currentRows) {
        const key = membershipKey(row.identityId, row.unitSlug)
        const previous = existingByKey.get(key)
        if (!previous) {
            changes.push(Object.freeze({
                identityId: row.identityId,
                unitSlug: row.unitSlug,
                revision: 1,
                operation: CRM_CORE_PROJECTION_DELTA_OPERATION_UPSERT,
                observedAt: row.observedAt,
                reason: 'new_membership',
            }))
            continue
        }
        if (!previous.active || previous.observedAt !== row.observedAt) {
            changes.push(Object.freeze({
                identityId: row.identityId,
                unitSlug: row.unitSlug,
                revision: previous.revision + 1,
                operation: CRM_CORE_PROJECTION_DELTA_OPERATION_UPSERT,
                observedAt: row.observedAt,
                reason: previous.active ? 'membership_changed' : 'membership_restored',
            }))
        }
    }

    for (const previous of existingRows) {
        const key = membershipKey(previous.identityId, previous.unitSlug)
        if (previous.active && !currentByKey.has(key)) {
            changes.push(Object.freeze({
                identityId: previous.identityId,
                unitSlug: previous.unitSlug,
                revision: previous.revision + 1,
                operation: CRM_CORE_PROJECTION_DELTA_OPERATION_REVOKE,
                observedAt: observedNow,
                reason: 'membership_removed',
            }))
        }
    }

    changes.sort((left, right) => membershipKey(left.identityId, left.unitSlug).localeCompare(membershipKey(right.identityId, right.unitSlug))
        || left.revision - right.revision
        || left.operation.localeCompare(right.operation))

    return Object.freeze({
        version: CRM_CORE_PROJECTION_DELTA_VERSION,
        observedAt: observedNow,
        currentCount: currentRows.length,
        existingCount: existingRows.length,
        upsertCount: changes.filter((change) => change.operation === CRM_CORE_PROJECTION_DELTA_OPERATION_UPSERT).length,
        revokeCount: changes.filter((change) => change.operation === CRM_CORE_PROJECTION_DELTA_OPERATION_REVOKE).length,
        unchangedCount: currentRows.length - changes.filter((change) => change.operation === CRM_CORE_PROJECTION_DELTA_OPERATION_UPSERT).length,
        changes: Object.freeze(changes),
    })
}

export const __testables = Object.freeze({
    UUID_PATTERN,
    UNIT_SLUG_PATTERN,
    membershipKey,
})
