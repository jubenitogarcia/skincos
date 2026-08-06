-- Apply with migrate-atendimento-commercial-analytics.mjs --apply.
-- The runner validates the private local/staging destination and only grants
-- append-only aggregate analytics access to the dedicated runtime role.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_attribution_window_versions (
  version text PRIMARY KEY,
  response_days integer NOT NULL CHECK (response_days BETWEEN 0 AND 730),
  appointment_days integer NOT NULL CHECK (appointment_days BETWEEN 0 AND 730),
  attendance_days integer NOT NULL CHECK (attendance_days BETWEEN 0 AND 730),
  sale_days integer NOT NULL CHECK (sale_days BETWEEN 0 AND 730),
  return_days integer NOT NULL CHECK (return_days BETWEEN 0 AND 1095),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  created_by text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_segment_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_segment_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES crm_atendimento.commercial_segment_definitions(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  percentiles jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  author text NOT NULL,
  population integer NOT NULL DEFAULT 0,
  distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  post_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(definition_id, version)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_segment_membership_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_version_id uuid NOT NULL REFERENCES crm_atendimento.commercial_segment_versions(id) ON DELETE RESTRICT,
  unit_id uuid REFERENCES crm_atendimento.units(id) ON DELETE RESTRICT,
  snapshot_date date NOT NULL,
  population integer NOT NULL DEFAULT 0,
  included integer NOT NULL DEFAULT 0,
  distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  drift jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(segment_version_id, unit_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_segment_members (
  snapshot_id uuid NOT NULL REFERENCES crm_atendimento.commercial_segment_membership_snapshots(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL REFERENCES crm_atendimento.global_client_identities(id) ON DELETE RESTRICT,
  included boolean NOT NULL DEFAULT true,
  reason text NOT NULL DEFAULT '',
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(snapshot_id, identity_id)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_analytics_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  unit_id uuid REFERENCES crm_atendimento.units(id) ON DELETE RESTRICT,
  segment_version_id uuid REFERENCES crm_atendimento.commercial_segment_versions(id) ON DELETE RESTRICT,
  policy_version text NOT NULL,
  attribution_window_version text NOT NULL REFERENCES crm_atendimento.commercial_attribution_window_versions(version) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  control_percent numeric(5,2) NOT NULL CHECK (control_percent > 0 AND control_percent < 100),
  seed text NOT NULL,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','running','paused','completed','rolled_back')),
  author text NOT NULL,
  reason text NOT NULL,
  eligibility_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(experiment_key, version)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_analytics_assignments (
  experiment_id uuid NOT NULL REFERENCES crm_atendimento.commercial_analytics_experiments(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL REFERENCES crm_atendimento.global_client_identities(id) ON DELETE RESTRICT,
  unit_id uuid REFERENCES crm_atendimento.units(id) ON DELETE RESTRICT,
  variant text NOT NULL CHECK (variant IN ('control','treatment','excluded')),
  eligible boolean NOT NULL DEFAULT true,
  eligibility_reason text NOT NULL DEFAULT '',
  eligibility_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_blocked_until timestamptz,
  crossover_detected boolean NOT NULL DEFAULT false,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(experiment_id, identity_id)
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  experiment_id uuid REFERENCES crm_atendimento.commercial_analytics_experiments(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL REFERENCES crm_atendimento.global_client_identities(id) ON DELETE RESTRICT,
  unit_id uuid REFERENCES crm_atendimento.units(id) ON DELETE RESTRICT,
  action_id uuid REFERENCES crm_atendimento.commercial_actions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('eligible','selected','action_created','contacted','delivered','responded','scheduled','attended','purchased','returned')),
  occurred_at timestamptz NOT NULL,
  channel text,
  offer_key text,
  campaign_key text,
  segment_key text,
  policy_version text,
  observed boolean NOT NULL DEFAULT true,
  attributed boolean NOT NULL DEFAULT false,
  incremental boolean NOT NULL DEFAULT false,
  revenue numeric(14,2) CHECK (revenue IS NULL OR revenue >= 0),
  source text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_atendimento.commercial_data_quality_metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_date date NOT NULL,
  unit_id uuid REFERENCES crm_atendimento.units(id) ON DELETE RESTRICT,
  finding_key text,
  source_key text,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL,
  UNIQUE(bucket_date, unit_id, finding_key, source_key)
);

CREATE INDEX IF NOT EXISTS commercial_analytics_events_lookup_idx
  ON crm_atendimento.commercial_analytics_events(unit_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS commercial_analytics_assignments_variant_idx
  ON crm_atendimento.commercial_analytics_assignments(experiment_id, variant, unit_id);
CREATE INDEX IF NOT EXISTS commercial_segment_membership_snapshots_lookup_idx
  ON crm_atendimento.commercial_segment_membership_snapshots(segment_version_id, unit_id, snapshot_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS commercial_segment_membership_snapshots_scope_uidx
  ON crm_atendimento.commercial_segment_membership_snapshots(
    segment_version_id, COALESCE(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), snapshot_date);
CREATE INDEX IF NOT EXISTS commercial_data_quality_metric_snapshots_lookup_idx
  ON crm_atendimento.commercial_data_quality_metric_snapshots(unit_id, bucket_date DESC, finding_key, source_key);
CREATE UNIQUE INDEX IF NOT EXISTS commercial_data_quality_metric_snapshots_scope_uidx
  ON crm_atendimento.commercial_data_quality_metric_snapshots(
    COALESCE(unit_id, '00000000-0000-0000-0000-000000000000'::uuid), bucket_date,
    COALESCE(finding_key, ''), COALESCE(source_key, ''));

CREATE OR REPLACE FUNCTION crm_atendimento.prevent_commercial_analytics_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'commercial analytics evidence is append-only';
END $$;

-- The canonical JS migration also installs row and TRUNCATE guards for every
-- evidence table and applies least-privilege grants for local/staging roles.
