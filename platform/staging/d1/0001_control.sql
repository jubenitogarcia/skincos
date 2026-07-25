CREATE TABLE IF NOT EXISTS staging_fixtures (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  contains_personal_data INTEGER NOT NULL CHECK (contains_personal_data = 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staging_queue_receipts (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

INSERT OR IGNORE INTO staging_fixtures (id, label, contains_personal_data, created_at)
VALUES ('synthetic-control-fixture', 'Synthetic control fixture only', 0, '2026-07-24T00:00:00.000Z');
