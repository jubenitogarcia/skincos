-- D1 schema for audit + notifications + jobs

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT,
  role TEXT,
  action TEXT,
  entity TEXT,
  entity_id TEXT,
  unidade TEXT,
  ip TEXT,
  user_agent TEXT,
  idempotency_key TEXT,
  before_json TEXT,
  after_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_unidade ON audit_log(unidade);

CREATE TABLE IF NOT EXISTS notification_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  unidade TEXT NOT NULL,
  low_stock INTEGER NOT NULL DEFAULT 0,
  expiring_soon INTEGER NOT NULL DEFAULT 0,
  expired_with_stock INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_notif_ts ON notification_snapshot(ts);
CREATE INDEX IF NOT EXISTS idx_notif_unidade ON notification_snapshot(unidade, ts);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  unidade TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
