CREATE TABLE IF NOT EXISTS professionals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  status TEXT,
  role TEXT,
  shift TEXT,
  nickname TEXT,
  phone TEXT,
  email TEXT,
  instagram TEXT,
  units_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schedule_entries (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  unit TEXT NOT NULL,
  professional_name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (date, unit, professional_name)
);

CREATE TABLE IF NOT EXISTS closed_days (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  unit TEXT NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (date, unit)
);

CREATE TABLE IF NOT EXISTS holidays (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  unit TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (date, unit, name)
);

CREATE INDEX IF NOT EXISTS idx_schedule_entries_unit_date ON schedule_entries(unit, date);
CREATE INDEX IF NOT EXISTS idx_closed_days_unit_date ON closed_days(unit, date);
CREATE INDEX IF NOT EXISTS idx_holidays_unit_date ON holidays(unit, date);
