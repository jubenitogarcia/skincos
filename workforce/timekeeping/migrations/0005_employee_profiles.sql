PRAGMA foreign_keys = ON;

-- The canonical employee remains workforce_employees. This table holds the
-- temporal HR/profile attributes that must not become a second employee
-- registry. Sensitive document, family and address fields are stored only in
-- private_data_encrypted (AES-GCM, key supplied outside version control).
CREATE TABLE IF NOT EXISTS workforce_employee_profiles (
  employee_id TEXT PRIMARY KEY REFERENCES workforce_employees(id),
  social_name TEXT,
  personal_email TEXT,
  group_name TEXT,
  department_name TEXT,
  manager_employee_id TEXT REFERENCES workforce_employees(id),
  manager_cpf_hash TEXT,
  admitted_at TEXT,
  dismissed_at TEXT,
  birth_place TEXT,
  education_level TEXT,
  city TEXT,
  state TEXT,
  private_data_encrypted TEXT,
  private_data_key_version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'CRM',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workforce_profile_department ON workforce_employee_profiles(department_name, group_name);
CREATE INDEX IF NOT EXISTS idx_workforce_profile_manager ON workforce_employee_profiles(manager_employee_id);
CREATE INDEX IF NOT EXISTS idx_workforce_profile_admitted ON workforce_employee_profiles(admitted_at, dismissed_at);
CREATE INDEX IF NOT EXISTS idx_workforce_profile_manager_cpf_hash ON workforce_employee_profiles(manager_cpf_hash) WHERE manager_cpf_hash IS NOT NULL;

-- CNPJ is a legal attribute of the employer/unit, never a personal employee
-- attribute. It is kept separately so a person can work in several units.
CREATE TABLE IF NOT EXISTS workforce_unit_legal_profiles (
  unit_id TEXT PRIMARY KEY REFERENCES workforce_units(id),
  legal_name TEXT,
  cnpj_encrypted TEXT,
  cnpj_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workforce_unit_legal_cnpj_hash ON workforce_unit_legal_profiles(cnpj_hash) WHERE cnpj_hash IS NOT NULL;
