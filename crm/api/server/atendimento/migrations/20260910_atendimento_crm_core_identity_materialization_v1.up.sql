-- Atendimento-only identity source for the CRM Core projection.
-- This additive schema contains stable UUID links and opaque evidence digests
-- only. It does not infer identities from names or copy customer attributes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS crm_atendimento;

CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_identity_clients (
  id uuid PRIMARY KEY,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'retired')),
  origin text NOT NULL DEFAULT 'atendimento/crm-core/identity-materialization/v2',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_attendance_client_links (
  attendance_id uuid PRIMARY KEY REFERENCES crm_atendimento.attendances(id) ON DELETE RESTRICT,
  canonical_client_id uuid NOT NULL REFERENCES crm_atendimento.crm_core_identity_clients(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('confirmed', 'rejected', 'unresolved')),
  method text NOT NULL CHECK (method IN ('operator_attested', 'stable_source_reference', 'reviewed_reconciliation')),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  source_revision integer NOT NULL CHECK (source_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_client_id uuid NOT NULL UNIQUE REFERENCES crm_atendimento.crm_core_identity_clients(id) ON DELETE RESTRICT,
  component_key text NOT NULL UNIQUE CHECK (component_key ~ '^attendance-client:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'retired')),
  policy_version text NOT NULL DEFAULT 'atendimento/crm-core/identity-materialization/v2',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_core_identities_id_canonical_client_key UNIQUE (id, canonical_client_id)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_identity_members (
  identity_id uuid PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type = 'attendance_client'),
  source_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id),
  CONSTRAINT crm_core_identity_members_identity_source_fk FOREIGN KEY (identity_id, source_id)
    REFERENCES crm_atendimento.crm_core_identities(id, canonical_client_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS crm_atendimento.crm_core_identity_materialization_runs (
  id uuid PRIMARY KEY,
  writer_contract text NOT NULL CHECK (writer_contract = 'atendimento/crm-core/identity-materialization-writer/v1'),
  policy_version text NOT NULL CHECK (policy_version = 'atendimento/crm-core/identity-materialization/v2'),
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[a-f0-9]{64}$'),
  output_digest text NOT NULL CHECK (output_digest ~ '^sha256:[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('prepared', 'applied', 'blocked')),
  confirmed_link_count integer NOT NULL CHECK (confirmed_link_count >= 0),
  identity_count integer NOT NULL CHECK (identity_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_core_attendance_client_links_confirmed_idx
  ON crm_atendimento.crm_core_attendance_client_links(canonical_client_id, attendance_id)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS crm_core_identity_members_identity_idx
  ON crm_atendimento.crm_core_identity_members(identity_id, source_id);

CREATE INDEX IF NOT EXISTS crm_atendimento_crm_core_identity_materialization_runs_created_idx
  ON crm_atendimento.crm_core_identity_materialization_runs(created_at DESC);

CREATE OR REPLACE FUNCTION crm_atendimento.prevent_crm_core_identity_materialization_run_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'crm core identity materialization ledger is append-only';
END $$;

DROP TRIGGER IF EXISTS crm_core_identity_materialization_runs_immutable ON crm_atendimento.crm_core_identity_materialization_runs;
CREATE TRIGGER crm_core_identity_materialization_runs_immutable
  BEFORE UPDATE OR DELETE ON crm_atendimento.crm_core_identity_materialization_runs
  FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_crm_core_identity_materialization_run_mutation();

DROP TRIGGER IF EXISTS crm_core_identity_materialization_runs_no_truncate ON crm_atendimento.crm_core_identity_materialization_runs;
CREATE TRIGGER crm_core_identity_materialization_runs_no_truncate
  BEFORE TRUNCATE ON crm_atendimento.crm_core_identity_materialization_runs
  FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_crm_core_identity_materialization_run_mutation();
