CREATE TABLE IF NOT EXISTS broker_state (
  id TEXT PRIMARY KEY,
  latched INTEGER NOT NULL DEFAULT 0,
  changed_at TEXT,
  stop_run_id TEXT,
  emergency_run_id TEXT,
  control_state TEXT NOT NULL DEFAULT 'maintenance',
  control_changed_at TEXT
);
INSERT OR IGNORE INTO broker_state (id, latched, control_state) VALUES ('timekeeping', 0, 'maintenance');
CREATE TABLE IF NOT EXISTS broker_nonces (
  nonce TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS broker_mutex (
  name TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
