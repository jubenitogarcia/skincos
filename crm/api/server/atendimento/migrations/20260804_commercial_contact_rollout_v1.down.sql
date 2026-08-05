-- Non-destructive rollback. Execute through
-- migrate-atendimento-commercial-contact-rollout.mjs --rollback.
-- Contact timestamps and disabled-by-default rollout settings remain recorded.

UPDATE crm_atendimento.commercial_policy_config
   SET commercial_contact_writes_enabled = false,
       commercial_contact_canary_identity_ids = '{}'::uuid[],
       updated_by = 'commercial-contact-rollout-rollback',
       updated_at = now()
 WHERE singleton = true;

DROP INDEX CONCURRENTLY IF EXISTS crm_atendimento.crm_atendimento_commercial_actions_contacted_idx;
