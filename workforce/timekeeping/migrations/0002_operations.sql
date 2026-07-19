PRAGMA foreign_keys = ON;

ALTER TABLE workforce_employees ADD COLUMN employee_code TEXT;
ALTER TABLE workforce_employees ADD COLUMN cpf_hash TEXT;
ALTER TABLE workforce_employees ADD COLUMN phone_hash TEXT;
ALTER TABLE workforce_employees ADD COLUMN birth_date TEXT;
ALTER TABLE workforce_employees ADD COLUMN job_title TEXT;
ALTER TABLE workforce_employees ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS workforce_units (
  id TEXT PRIMARY KEY,
  canonical_unit_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timekeeping_schedule_assignments (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES workforce_employees(id),
  unit_id TEXT NOT NULL,
  work_date TEXT NOT NULL,
  start_at_utc TEXT,
  end_at_utc TEXT,
  expected_minutes INTEGER NOT NULL DEFAULT 0 CHECK (expected_minutes >= 0),
  source TEXT NOT NULL DEFAULT 'TIMEKEEPING',
  source_ref TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(employee_id, unit_id, work_date, source)
);
CREATE INDEX IF NOT EXISTS idx_tk_schedule_employee_period ON timekeeping_schedule_assignments(employee_id, work_date, unit_id);

CREATE TABLE IF NOT EXISTS timekeeping_holidays (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  holiday_date TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(unit_id, holiday_date, name)
);
CREATE INDEX IF NOT EXISTS idx_tk_holiday_unit_date ON timekeeping_holidays(unit_id, holiday_date);

CREATE TABLE IF NOT EXISTS timekeeping_absences (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES workforce_employees(id),
  unit_id TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('JUSTIFIED','UNJUSTIFIED','LEAVE')),
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tk_absence_employee_period ON timekeeping_absences(employee_id, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS timekeeping_pin_failures (
  employee_id TEXT PRIMARY KEY REFERENCES workforce_employees(id),
  device_id TEXT NOT NULL DEFAULT '',
  failure_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  locked_until TEXT,
  last_failed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timekeeping_daily_snapshots (
  id TEXT PRIMARY KEY,
  closure_id TEXT NOT NULL REFERENCES timekeeping_period_closures(id),
  employee_id TEXT NOT NULL REFERENCES workforce_employees(id),
  work_date TEXT NOT NULL,
  calculation_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(closure_id, employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS timekeeping_migration_runs (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('APPLYING','APPLIED','ROLLED_BACK','FAILED')),
  source_counts_json TEXT NOT NULL,
  result_counts_json TEXT,
  checkpoint_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(source_kind, source_checksum)
);

CREATE TABLE IF NOT EXISTS timekeeping_migration_items (
  migration_run_id TEXT NOT NULL REFERENCES timekeeping_migration_runs(id),
  entity_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(migration_run_id, entity_type, source_id)
);

CREATE TABLE IF NOT EXISTS workforce_identity_conflicts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  candidates_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','IGNORED')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_workforce_conflicts_status ON workforce_identity_conflicts(status, source);

CREATE INDEX IF NOT EXISTS idx_tk_events_unit_employee_date ON timekeeping_events(unit_id, employee_id, occurred_at_utc);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tk_employee_units_effective_unique ON timekeeping_employee_units(employee_id, unit_id, effective_from);
CREATE INDEX IF NOT EXISTS idx_tk_corrections_status_date ON timekeeping_corrections(status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workforce_employee_code_unique ON workforce_employees(employee_code) WHERE employee_code IS NOT NULL AND employee_code <> '';
CREATE INDEX IF NOT EXISTS idx_workforce_employee_cpf_hash ON workforce_employees(cpf_hash) WHERE cpf_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workforce_employee_phone_hash ON workforce_employees(phone_hash) WHERE phone_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tk_snapshots_employee_date ON timekeeping_daily_snapshots(employee_id, work_date);
