CREATE TABLE IF NOT EXISTS ponto_employees (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  login_email TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  last_enrolled_at TEXT,
  pin_alg TEXT,
  pin_salt TEXT,
  pin_hash TEXT,
  pin_iters INTEGER,
  consent_obtained_at TEXT,
  consent_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_ponto_employees_login_email ON ponto_employees(login_email);

CREATE TABLE IF NOT EXISTS ponto_face_templates (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  template_json TEXT NOT NULL,
  FOREIGN KEY(employee_id) REFERENCES ponto_employees(id)
);

CREATE INDEX IF NOT EXISTS idx_ponto_face_templates_employee ON ponto_face_templates(employee_id);

CREATE TABLE IF NOT EXISTS ponto_devices (
  id TEXT PRIMARY KEY,
  label TEXT,
  unit TEXT,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ponto_devices_token_hash ON ponto_devices(token_hash);
CREATE INDEX IF NOT EXISTS idx_ponto_devices_revoked ON ponto_devices(revoked_at);

CREATE TABLE IF NOT EXISTS ponto_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_name TEXT,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  unit TEXT,
  device_id TEXT,
  device_label TEXT,
  method TEXT,
  match_distance REAL,
  note TEXT,
  idempotency_key TEXT,
  ip TEXT,
  user_agent TEXT,
  client_time TEXT,
  tz_offset_minutes INTEGER,
  locale TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ponto_records_employee_at ON ponto_records(employee_id, at);
CREATE INDEX IF NOT EXISTS idx_ponto_records_created_at ON ponto_records(created_at);
CREATE INDEX IF NOT EXISTS idx_ponto_records_idempotency ON ponto_records(idempotency_key);

CREATE TABLE IF NOT EXISTS ponto_audit (
  id TEXT PRIMARY KEY,
  v INTEGER NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  data_json TEXT NOT NULL,
  prev_hash TEXT,
  hash TEXT NOT NULL,
  hmac TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ponto_audit_created_at ON ponto_audit(created_at);

CREATE TABLE IF NOT EXISTS ponto_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
