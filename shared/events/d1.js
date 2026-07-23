import { inboxClaim, validateEvent } from './v1.js';

const OUTBOX_TABLES = new Set(['finance_event_outbox', 'inventory_event_outbox']);
const INBOX_TABLES = new Set(['finance_event_inbox', 'inventory_event_inbox', 'marketing_event_inbox']);

function assertKnown(table, tables, kind) {
  if (!tables.has(table)) throw new Error(`Unapproved ${kind} table: ${table}`);
}

/**
 * Builds a statement to be included in the producer's existing D1 batch.
 * It does not execute dispatch or contact a consumer.
 */
export function d1OutboxInsert({ db, table, event }) {
  assertKnown(table, OUTBOX_TABLES, 'outbox');
  validateEvent(event);
  return db.prepare(`INSERT OR IGNORE INTO ${table} (
    id,event_type,event_version,aggregate_type,aggregate_id,payload_json,
    correlation_id,idempotency_key,status,attempts,available_at,occurred_at,created_at
  ) VALUES (?,?,?,?,?,?,?,?, 'pending',0,?,?,?)`).bind(
    event.id, event.type, event.version, event.subject.type, event.subject.id, JSON.stringify(event),
    event.correlationId, event.idempotencyKey, event.occurredAt, event.occurredAt, event.occurredAt,
  );
}

/**
 * Builds the first step of a consumer transaction. The caller must execute
 * its projection and mark processed_at in the same D1 batch before acking.
 */
export function d1InboxClaim({ db, table, consumer, event, receivedAt = new Date().toISOString() }) {
  assertKnown(table, INBOX_TABLES, 'inbox');
  const claim = inboxClaim({ consumer, event });
  return db.prepare(`INSERT OR IGNORE INTO ${table} (
    consumer_name,event_id,idempotency_key,received_at,projection_version
  ) VALUES (?,?,?,?,1)`).bind(claim.consumer, claim.eventId, claim.idempotencyKey, receivedAt);
}

export function outboxEnabled(env) {
  return String(env?.EVENTS_OUTBOX_ENABLED || '').toLowerCase() === 'true';
}
