-- Additive workforce identity bridge. No professional is linked by name alone.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE crm_atendimento.professionals
  ADD COLUMN IF NOT EXISTS workforce_employee_id text;

CREATE UNIQUE INDEX IF NOT EXISTS crm_atendimento_professionals_workforce_employee_uq
  ON crm_atendimento.professionals(workforce_employee_id)
  WHERE workforce_employee_id IS NOT NULL AND btrim(workforce_employee_id) <> '';

CREATE TABLE IF NOT EXISTS crm_atendimento.professional_workforce_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES crm_atendimento.professionals(id) ON DELETE RESTRICT,
  workforce_employee_id text NOT NULL,
  source text NOT NULL,
  match_method text NOT NULL,
  confidence text NOT NULL,
  review_status text NOT NULL DEFAULT 'PENDING_REVIEW',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(professional_id),
  UNIQUE(workforce_employee_id)
);

CREATE INDEX IF NOT EXISTS crm_atendimento_professional_workforce_review_idx
  ON crm_atendimento.professional_workforce_links(review_status, created_at DESC);

-- Rollback is intentionally handled by the guarded migration runner. Keeping
-- this bridge avoids deleting evidence or invalidating historical references.
