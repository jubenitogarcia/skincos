export const BOOKING_STATES = Object.freeze(['provisional', 'confirmed', 'failed', 'manual_review']);

const transitions = Object.freeze({
    provisional: new Set(['confirmed', 'failed', 'manual_review']),
    confirmed: new Set(),
    failed: new Set(['manual_review']),
    manual_review: new Set(['confirmed', 'failed']),
});

export function assertBookingState(value) {
    if (!BOOKING_STATES.includes(value)) throw new Error(`unknown_booking_state:${value}`);
    return value;
}

export function assertBookingTransition(from, to) {
    assertBookingState(from);
    assertBookingState(to);
    if (!transitions[from].has(to)) throw new Error(`invalid_booking_transition:${from}->${to}`);
    return to;
}

export function createLedgerInsert({ id, idempotencyKey, request, statusTokenHash, nowMs }) {
    if (!id || !idempotencyKey || !statusTokenHash) throw new Error('booking_ledger_identity_required');
    return {
        sql: `INSERT INTO booking_ledger
            (id, idempotency_key, state, request_json, status_token_hash, created_at_ms, updated_at_ms)
            VALUES (?, ?, 'provisional', ?, ?, ?, ?)`,
        values: [id, idempotencyKey, JSON.stringify(request), statusTokenHash, nowMs, nowMs],
    };
}

export function createOutboxInsert({ id, bookingId, payload, nowMs }) {
    if (!id || !bookingId) throw new Error('booking_outbox_identity_required');
    return {
        sql: `INSERT INTO booking_outbox
            (id, booking_id, topic, payload_json, available_at_ms, created_at_ms, updated_at_ms)
            VALUES (?, ?, 'booking.requested', ?, ?, ?, ?)`,
        values: [id, bookingId, JSON.stringify(payload), nowMs, nowMs, nowMs],
    };
}

export function createLeaseClaim({ workerId, nowMs, leaseMs = 60_000 }) {
    if (!workerId) throw new Error('booking_lease_owner_required');
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error('booking_lease_duration_invalid');
    return {
        sql: `UPDATE booking_outbox
            SET state = 'leased', lease_owner = ?, lease_until_ms = ?, attempts = attempts + 1, updated_at_ms = ?
            WHERE id = (
                SELECT id FROM booking_outbox
                WHERE (state = 'pending' AND available_at_ms <= ?)
                   OR (state = 'leased' AND lease_until_ms < ?)
                ORDER BY available_at_ms ASC, created_at_ms ASC
                LIMIT 1
            )`,
        values: [workerId, nowMs + leaseMs, nowMs, nowMs, nowMs],
    };
}
