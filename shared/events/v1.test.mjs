import test from 'node:test';
import assert from 'node:assert/strict';
import { EventContractError, EVENT_TYPES, createEvent, deliveryDecision, inboxClaim, retryDelaySeconds } from './v1.js';
import { d1InboxClaim, d1OutboxInsert, outboxEnabled } from './d1.js';

const base = () => ({
  id: 'evt-001', type: EVENT_TYPES.FINANCE_MOVEMENT_POSTED, occurredAt: '2026-07-23T12:00:00.000Z',
  producer: { module: 'finance', service: 'finance-worker' }, subject: { type: 'finance-movement', id: 'mov-001' },
  correlationId: 'req-001', idempotencyKey: 'finance:movement-posted:mov-001:1', data: { scopeId: 'unit-001', amountMinor: 1000, currency: 'BRL' },
});

test('creates only catalogued, versioned, reference-only events', () => {
  const event = createEvent(base());
  assert.equal(event.version, 1);
  assert.deepEqual(inboxClaim({ consumer: 'marketing-conversion-projector', event }), {
    consumer: 'marketing-conversion-projector', eventId: 'evt-001', idempotencyKey: 'marketing-conversion-projector:evt-001',
  });
});

test('rejects sensitive data and unknown event types', () => {
  assert.throws(() => createEvent({ ...base(), data: { customerEmail: 'person@example.com' } }), EventContractError);
  assert.throws(() => createEvent({ ...base(), type: 'finance.unapproved.v1' }), EventContractError);
});

test('uses bounded controlled retries then dead-letters', () => {
  assert.equal(retryDelaySeconds(1), 30);
  assert.equal(retryDelaySeconds(99), 3600);
  assert.deepEqual(deliveryDecision({ attempts: 7, error: { retryable: true }, now: '2026-07-23T12:00:00.000Z' }), {
    action: 'dead-letter', attempts: 8, availableAt: null,
  });
  assert.deepEqual(deliveryDecision({ attempts: 0, error: { retryable: true }, now: '2026-07-23T12:00:00.000Z' }), {
    action: 'retry', attempts: 1, availableAt: '2026-07-23T12:00:30.000Z',
  });
});

test('builds only whitelisted D1 statements and keeps dispatch out of the mutation batch', () => {
  const calls = [];
  const db = { prepare(sql) { calls.push(sql); return { bind: (...values) => ({ sql, values }) }; } };
  const event = createEvent(base());
  const outbox = d1OutboxInsert({ db, table: 'finance_event_outbox', event });
  const inbox = d1InboxClaim({ db, table: 'marketing_event_inbox', consumer: 'marketing', event, receivedAt: '2026-07-23T12:00:00.000Z' });
  assert.match(outbox.sql, /INSERT OR IGNORE INTO finance_event_outbox/);
  assert.match(inbox.sql, /INSERT OR IGNORE INTO marketing_event_inbox/);
  assert.equal(calls.some((sql) => /fetch|queue|dispatch/i.test(sql)), false);
  assert.equal(outboxEnabled({ EVENTS_OUTBOX_ENABLED: 'true' }), true);
  assert.equal(outboxEnabled({ EVENTS_OUTBOX_ENABLED: 'false' }), false);
  assert.throws(() => d1OutboxInsert({ db, table: 'skincos-db', event }), /Unapproved outbox/);
});
