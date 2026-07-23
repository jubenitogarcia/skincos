/**
 * Transport-neutral event contract. Domain events carry immutable references
 * and operational facts only; consumers must use their own authorised read
 * contracts when they need more detail. Do not add PII, credentials, cookies
 * or session material to `data`.
 */
export const EVENT_CONTRACT_VERSION = 'skincos-event/v1';

export const EVENT_TYPES = Object.freeze({
  ATTENDANCE_COMPLETED: 'attendance.completed.v1',
  CLIENT_IDENTITY_RECONCILED: 'client.identity-reconciled.v1',
  FINANCE_MOVEMENT_POSTED: 'finance.movement-posted.v1',
  INVENTORY_STOCK_CHANGED: 'inventory.stock-changed.v1',
  MARKETING_CONVERSION_REQUESTED: 'marketing.conversion-requested.v1',
});

const EVENT_TYPE_SET = new Set(Object.values(EVENT_TYPES));
const SENSITIVE_KEY = /(email|phone|cpf|password|secret|token|cookie|session|authorization)/i;
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

export class EventContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EventContractError';
  }
}

function assert(value, message) {
  if (!value) throw new EventContractError(message);
}

function assertNoSensitiveData(value, path = 'data') {
  if (value === null || value === undefined || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!SENSITIVE_KEY.test(key), `${path}.${key} is not allowed in a domain event`);
    assertNoSensitiveData(child, `${path}.${key}`);
  }
}

export function validateEvent(event) {
  assert(event && typeof event === 'object', 'event must be an object');
  assert(event.contractVersion === EVENT_CONTRACT_VERSION, `contractVersion must be ${EVENT_CONTRACT_VERSION}`);
  assert(nonEmpty(event.id), 'event.id is required');
  assert(EVENT_TYPE_SET.has(event.type), `event.type is not in the approved catalog: ${event.type}`);
  assert(event.version === 1, 'event.version must be 1');
  assert(event.type.endsWith('.v1'), 'event.type must match its version');
  assert(nonEmpty(event.occurredAt) && !Number.isNaN(Date.parse(event.occurredAt)), 'event.occurredAt must be an ISO timestamp');
  assert(nonEmpty(event.producer?.module) && nonEmpty(event.producer?.service), 'event.producer.module and service are required');
  assert(nonEmpty(event.subject?.type) && nonEmpty(event.subject?.id), 'event.subject.type and id are required');
  assert(nonEmpty(event.correlationId), 'event.correlationId is required');
  assert(nonEmpty(event.idempotencyKey), 'event.idempotencyKey is required');
  assert(event.data && typeof event.data === 'object' && !Array.isArray(event.data), 'event.data must be an object');
  assertNoSensitiveData(event.data);
  return event;
}

export function createEvent({ id, type, occurredAt, producer, subject, correlationId, idempotencyKey, data }) {
  return validateEvent({
    contractVersion: EVENT_CONTRACT_VERSION,
    id,
    type,
    version: 1,
    occurredAt,
    producer,
    subject,
    correlationId,
    idempotencyKey,
    data,
  });
}

export function retryDelaySeconds(attempt) {
  const normalized = Math.max(1, Math.min(8, Number(attempt) || 1));
  return Math.min(3600, 30 * (2 ** (normalized - 1)));
}

export function retryAt({ attempt, now = new Date() }) {
  return new Date(new Date(now).getTime() + retryDelaySeconds(attempt) * 1000).toISOString();
}

export function deliveryDecision({ attempts, error, now = new Date(), maxAttempts = 8 }) {
  const nextAttempt = Number(attempts || 0) + 1;
  if (nextAttempt >= maxAttempts || error?.retryable === false) {
    return { action: 'dead-letter', attempts: nextAttempt, availableAt: null };
  }
  return { action: 'retry', attempts: nextAttempt, availableAt: retryAt({ attempt: nextAttempt, now }) };
}

export function inboxClaim({ consumer, event }) {
  validateEvent(event);
  assert(nonEmpty(consumer), 'consumer is required');
  return { consumer, eventId: event.id, idempotencyKey: `${consumer}:${event.id}` };
}
