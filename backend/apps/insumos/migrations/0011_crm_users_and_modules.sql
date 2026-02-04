-- 0011_crm_users_and_modules.sql
-- Objetivo: transformar as tabelas de usuários/convites do antigo "Insumos" em tabelas core do CRM (crm_*),
--           adicionando permissões por módulo (allowed_modules_json) para usuários e convites.
--
-- Assumptions:
-- - Previous migrations already created: insumos_users, insumos_invites, insumos_password_resets, insumos_user_prefs.
-- - This migration runs once in order.

-- 1) Rename legacy tables to CRM core tables
ALTER TABLE insumos_users RENAME TO crm_users;
ALTER TABLE insumos_invites RENAME TO crm_invites;
ALTER TABLE insumos_password_resets RENAME TO crm_password_resets;
ALTER TABLE insumos_user_prefs RENAME TO crm_user_prefs;

-- 2) Add per-module permissions columns
ALTER TABLE crm_users ADD COLUMN allowed_modules_json TEXT;
ALTER TABLE crm_invites ADD COLUMN allowed_modules_json TEXT;

-- 3) Compatibility views for legacy names (read-only)
CREATE VIEW IF NOT EXISTS insumos_users AS
SELECT
  username,
  email,
  display_name,
  password_hash,
  role,
  photo_url,
  allowed_units_json,
  ativo,
  created_at,
  updated_at,
  allowed_modules_json
FROM crm_users;

CREATE VIEW IF NOT EXISTS insumos_invites AS
SELECT
  id,
  token_hash,
  token_hint,
  role,
  allowed_units_json,
  max_uses,
  uses_count,
  expires_at,
  revoked,
  note,
  created_by,
  created_at,
  allowed_modules_json
FROM crm_invites;

CREATE VIEW IF NOT EXISTS insumos_password_resets AS
SELECT
  id,
  token_hash,
  username,
  email,
  created_at,
  expires_at,
  used_at
FROM crm_password_resets;

CREATE VIEW IF NOT EXISTS insumos_user_prefs AS
SELECT
  username,
  prefs_json,
  updated_at
FROM crm_user_prefs;
