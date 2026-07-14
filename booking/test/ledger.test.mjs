import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBookingTransition, createLedgerInsert, createLeaseClaim, createOutboxInsert } from '../src/ledger.js';

test('reservation state transitions protect the durable lifecycle', () => {
    assert.equal(assertBookingTransition('provisional', 'confirmed'), 'confirmed');
    assert.equal(assertBookingTransition('failed', 'manual_review'), 'manual_review');
    assert.throws(() => assertBookingTransition('confirmed', 'provisional'), /invalid_booking_transition/);
    assert.throws(() => assertBookingTransition('unknown', 'failed'), /unknown_booking_state/);
});

test('ledger and outbox inserts persist one provisional request', () => {
    const ledger = createLedgerInsert({ id: 'booking-1', idempotencyKey: 'idem-1', request: { unit: 'nh' }, statusTokenHash: 'hash', nowMs: 1 });
    const outbox = createOutboxInsert({ id: 'outbox-1', bookingId: 'booking-1', payload: { bookingId: 'booking-1' }, nowMs: 1 });
    assert.match(ledger.sql, /'provisional'/);
    assert.deepEqual(ledger.values, ['booking-1', 'idem-1', '{"unit":"nh"}', 'hash', 1, 1]);
    assert.match(outbox.sql, /'booking.requested'/);
    assert.deepEqual(outbox.values, ['outbox-1', 'booking-1', '{"bookingId":"booking-1"}', 1, 1, 1]);
});

test('outbox lease includes expired work for retry recovery', () => {
    const claim = createLeaseClaim({ workerId: 'orb-1', nowMs: 100, leaseMs: 50 });
    assert.match(claim.sql, /state = 'leased'/);
    assert.match(claim.sql, /lease_until_ms < \?/);
    assert.deepEqual(claim.values, ['orb-1', 150, 100, 100, 100]);
});
