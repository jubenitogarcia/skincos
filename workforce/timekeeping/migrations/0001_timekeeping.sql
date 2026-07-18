PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workforce_employees (
  id TEXT PRIMARY KEY,
  canonical_employee_id TEXT NOT NULL UNIQUE,
  login_email TEXT UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEAVE','TERMINATED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  terminated_at TEXT
);

CREATE TABLE IF NOT EXISTS workforce_employee_aliases (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES workforce_employees(id),
  source TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source, legacy_id)
);

CREATE TABLE IF NOT EXISTS timekeeping_employee_units (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES workforce_employees(id),
  unit_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tk_employee_units_scope ON timekeeping_employee_units(employee_id, unit_id, effective_from);

CREATE TABLE IF NOT EXISTS timekeeping_rule_versions (
  id TEXT PRIMARY KEY,
  employee_id TEXT REFERENCES workforce_employees(id),
  unit_id TEXT,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  rules_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tk_rules_effective ON timekeeping_rule_versions(employee_id, unit_id, effective_from);

CREATE TABLE IF NOT EXISTS timekeeping_devices (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tk_devices_unit_active ON timekeeping_devices(unit_id, active);

CREATE TABLE IF NOT EXISTS timekeeping_pin_credentials (
  employee_id TEXT PRIMARY KEY REFERENCES workforce_employees(id),
  algorithm TEXT NOT NULL,
  salt_b64 TEXT NOT NULL,
  hash_b64 TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timekeeping_biometric_templates (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES workforce_employees(id),
  encrypted_template TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  consented_by TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  revoked_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tk_biometrics_employee_active ON timekeeping_biometric_templates(employee_id, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS timekeeping_events (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES workforce_employees(id),
  unit_id TEXT NOT NULL,
  device_id TEXT REFERENCES timekeeping_devices(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('WORK_START','BREAK_START','BREAK_END','WORK_END')),
  source TEXT NOT NULL CHECK (source IN ('FACE','PIN','MANUAL','IMPORT','SYSTEM')),
  occurred_at_utc TEXT NOT NULL,
  idempotency_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  superseded_by TEXT,
  UNIQUE(idempotency_scope, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_tk_events_employee_date ON timekeeping_events(employee_id, occurred_at_utc);
CREATE INDEX IF NOT EXISTS idx_tk_events_unit_date ON timekeeping_events(unit_id, occurred_at_utc);
CREATE INDEX IF NOT EXISTS idx_tk_events_device_date ON timekeeping_events(device_id, occurred_at_utc);

CREATE TABLE IF NOT EXISTS timekeeping_corrections (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES timekeeping_events(id),
  requested_at TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  proposed_at_utc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  decided_at TEXT,
  decided_by TEXT,
  decision_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_tk_corrections_event ON timekeeping_corrections(event_id, status);

CREATE TABLE IF NOT EXISTS timekeeping_period_closures (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES workforce_employees(id),
  unit_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CLOSED','REOPENED')),
  revision INTEGER NOT NULL,
  rules_snapshot_json TEXT NOT NULL,
  input_checksum TEXT NOT NULL,
  calculation_version TEXT NOT NULL,
  closed_by TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  reopened_by TEXT,
  reopened_at TEXT,
  reopen_reason TEXT,
  UNIQUE(employee_id, unit_id, period_start, period_end, revision)
);
CREATE INDEX IF NOT EXISTS idx_tk_closures_period ON timekeeping_period_closures(unit_id, period_start, period_end);

CREATE TABLE IF NOT EXISTS timekeeping_audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  unit_id TEXT,
  reason TEXT,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  prev_hash TEXT,
  hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tk_audit_entity ON timekeeping_audit_events(entity_type, entity_id, occurred_at);

CREATE TABLE IF NOT EXISTS timekeeping_request_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
