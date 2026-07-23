-- Marketing projection consumer. No Marketing outbox is created in this phase.
CREATE TABLE IF NOT EXISTS marketing_event_inbox (
  consumer_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  projection_version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (consumer_name, event_id),
  UNIQUE (idempotency_key)
);

CREATE TABLE IF NOT EXISTS marketing_event_dead_letters (
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
CREATE INDEX IF NOT EXISTS marketing_event_dead_letters_open_idx ON marketing_event_dead_letters(resolved_at, failed_at);

CREATE TABLE IF NOT EXISTS marketing_event_reconciliation (
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
