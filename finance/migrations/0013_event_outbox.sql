-- Finance v13: disabled-by-default transactional event outbox foundation.
-- This is additive. A Finance mutation may write an outbox row only after the
-- staging migration and EVENTS_OUTBOX_ENABLED release gate are approved.
CREATE TABLE IF NOT EXISTS finance_event_outbox (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL CHECK(event_version = 1),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','dispatched','dead-letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  available_at TEXT NOT NULL,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  dispatched_at TEXT
);
CREATE INDEX IF NOT EXISTS finance_event_outbox_dispatch_idx ON finance_event_outbox(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS finance_event_outbox_aggregate_idx ON finance_event_outbox(aggregate_type, aggregate_id, occurred_at);

CREATE TABLE IF NOT EXISTS finance_event_inbox (
  consumer_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  projection_version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (consumer_name, event_id),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS finance_event_dead_letters (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  consumer_name TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  failed_at TEXT NOT NULL,
  last_error TEXT NOT NULL,
  resolved_at TEXT,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS finance_event_dead_letters_open_idx ON finance_event_dead_letters(resolved_at, failed_at);

CREATE TABLE IF NOT EXISTS finance_event_reconciliation (
  id TEXT PRIMARY KEY,
  producer_module TEXT NOT NULL,
  consumer_name TEXT NOT NULL,
  range_start TEXT NOT NULL,
  range_end TEXT NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  projected_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('pending','matched','mismatch','replayed')),
  details_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
