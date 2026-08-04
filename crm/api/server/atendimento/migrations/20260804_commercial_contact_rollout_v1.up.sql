-- Execute through migrate-atendimento-commercial-contact-rollout.mjs --apply.
-- The supplied runner accepts only local skincos_crm_local. Remote application
-- requires a controlled Postgres release with an explicit checkpoint.

ALTER TABLE crm_atendimento.commercial_actions
  ADD COLUMN IF NOT EXISTS contacted_at timestamptz;
ALTER TABLE crm_atendimento.commercial_policy_config
  ADD COLUMN IF NOT EXISTS commercial_contact_writes_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE crm_atendimento.commercial_policy_config
  ADD COLUMN IF NOT EXISTS commercial_contact_canary_identity_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- Only an explicit legacy `contacted` status is evidence of outbound contact.
-- Do not infer timestamps from responses, appointments, sales or returns: those
-- states can result from inbound activity and would distort consent metrics.
UPDATE crm_atendimento.commercial_actions
   SET contacted_at = COALESCE(completed_at, updated_at, created_at)
 WHERE contacted_at IS NULL
   AND status = 'contacted';

CREATE INDEX CONCURRENTLY IF NOT EXISTS crm_atendimento_commercial_actions_contacted_idx
  ON crm_atendimento.commercial_actions(identity_id, contacted_at DESC)
  WHERE contacted_at IS NOT NULL;
