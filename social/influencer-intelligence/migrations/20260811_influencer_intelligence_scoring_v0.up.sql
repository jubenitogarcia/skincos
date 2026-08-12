-- Influencer Intelligence scoring v0 is an additive, unapplied artifact.
-- It records the exact weights configuration used for each score snapshot.
BEGIN;
SET LOCAL TIME ZONE 'UTC';

DO $$
begin
  if to_regclass('influencer_intelligence.creator_score') is null then
    raise exception 'influencer_intelligence.creator_score must exist before scoring v0';
  end if;
END
$$;

ALTER TABLE influencer_intelligence.creator_score
  ADD COLUMN IF NOT EXISTS weights_version text;

COMMENT ON COLUMN influencer_intelligence.creator_score.weights_version IS
  'Immutable identifier for the versioned deterministic scoring weights/configuration.';

COMMIT;
