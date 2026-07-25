-- Per-unit department and reporting relationships. Existing single-manager
-- profile remains compatibility-only and is not inferred into this table.
CREATE TABLE IF NOT EXISTS workforce_departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  normalized_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS workforce_department_routes (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  department_id TEXT NOT NULL,
  employee_profile TEXT NOT NULL,
  manager_employee_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE(unit_id, department_id, employee_profile),
  FOREIGN KEY(department_id) REFERENCES workforce_departments(id),
  FOREIGN KEY(manager_employee_id) REFERENCES workforce_employees(id)
);
CREATE TABLE IF NOT EXISTS workforce_employee_unit_hierarchy (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  department_id TEXT,
  employee_profile TEXT NOT NULL,
  manager_employee_id TEXT,
  source TEXT NOT NULL DEFAULT 'IDENTITY_ONBOARDING',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  UNIQUE(employee_id, unit_id),
  FOREIGN KEY(employee_id) REFERENCES workforce_employees(id),
  FOREIGN KEY(department_id) REFERENCES workforce_departments(id),
  FOREIGN KEY(manager_employee_id) REFERENCES workforce_employees(id)
);
CREATE INDEX IF NOT EXISTS idx_workforce_hierarchy_manager ON workforce_employee_unit_hierarchy(manager_employee_id, unit_id);
