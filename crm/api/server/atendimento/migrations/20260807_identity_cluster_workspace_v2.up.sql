-- Execute through migrate-atendimento-identity-clusters.mjs --apply.
-- This ledger contains only opaque cluster keys, HMAC-derived actor references,
-- request/reason digests and aggregate outcomes. It never stores contacts.

CREATE TABLE IF NOT EXISTS crm_atendimento.identity_cluster_review_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_key text NOT NULL UNIQUE CHECK (char_length(operation_key) BETWEEN 8 AND 320),
  cluster_key text NOT NULL CHECK (cluster_key ~ '^[a-f0-9]{32}$'),
  cluster_version text NOT NULL CHECK (cluster_version ~ '^[a-f0-9]{64}$'),
  operation text NOT NULL CHECK (operation IN ('bulk_confirm')),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_reference text NOT NULL CHECK (actor_reference ~ '^[a-f0-9]{64}$'),
  actor_role text NOT NULL CHECK (actor_role IN ('GESTOR','ADMIN')),
  unit_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm_atendimento.identity_cluster_reveal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_key text NOT NULL CHECK (cluster_key ~ '^[a-f0-9]{32}$'),
  cluster_version text NOT NULL CHECK (cluster_version ~ '^[a-f0-9]{64}$'),
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'array'),
  reason_digest text NOT NULL CHECK (reason_digest ~ '^[a-f0-9]{64}$'),
  actor_reference text NOT NULL CHECK (actor_reference ~ '^[a-f0-9]{64}$'),
  actor_role text NOT NULL CHECK (actor_role IN ('GESTOR','ADMIN')),
  unit_scope jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS identity_cluster_review_operations_cluster_idx
  ON crm_atendimento.identity_cluster_review_operations(cluster_key, created_at DESC);
CREATE INDEX IF NOT EXISTS identity_cluster_reveal_events_cluster_idx
  ON crm_atendimento.identity_cluster_reveal_events(cluster_key, created_at DESC);

CREATE OR REPLACE FUNCTION crm_atendimento.prevent_identity_cluster_workspace_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity cluster workspace ledger is append-only';
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'crm_atendimento.identity_cluster_review_operations'::regclass
      AND tgname = 'identity_cluster_review_operations_immutable'
  ) THEN
    EXECUTE 'CREATE TRIGGER identity_cluster_review_operations_immutable
      BEFORE UPDATE OR DELETE ON crm_atendimento.identity_cluster_review_operations
      FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_identity_cluster_workspace_ledger_mutation()';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'crm_atendimento.identity_cluster_review_operations'::regclass
      AND tgname = 'identity_cluster_review_operations_no_truncate'
  ) THEN
    EXECUTE 'CREATE TRIGGER identity_cluster_review_operations_no_truncate
      BEFORE TRUNCATE ON crm_atendimento.identity_cluster_review_operations
      FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_identity_cluster_workspace_ledger_mutation()';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'crm_atendimento.identity_cluster_reveal_events'::regclass
      AND tgname = 'identity_cluster_reveal_events_immutable'
  ) THEN
    EXECUTE 'CREATE TRIGGER identity_cluster_reveal_events_immutable
      BEFORE UPDATE OR DELETE ON crm_atendimento.identity_cluster_reveal_events
      FOR EACH ROW EXECUTE FUNCTION crm_atendimento.prevent_identity_cluster_workspace_ledger_mutation()';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'crm_atendimento.identity_cluster_reveal_events'::regclass
      AND tgname = 'identity_cluster_reveal_events_no_truncate'
  ) THEN
    EXECUTE 'CREATE TRIGGER identity_cluster_reveal_events_no_truncate
      BEFORE TRUNCATE ON crm_atendimento.identity_cluster_reveal_events
      FOR EACH STATEMENT EXECUTE FUNCTION crm_atendimento.prevent_identity_cluster_workspace_ledger_mutation()';
  END IF;
END $$;
