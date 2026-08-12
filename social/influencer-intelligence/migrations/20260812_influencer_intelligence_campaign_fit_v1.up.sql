-- Campaign Fit v1 adds only audit metadata to the existing append-only fit
-- projection. It remains source-controlled and unapplied by this milestone.
BEGIN;
SET LOCAL TIME ZONE 'UTC';

DO $$
BEGIN
  IF to_regclass('influencer_intelligence.campaign_creator_fit') IS NULL THEN
    RAISE EXCEPTION 'influencer_intelligence.campaign_creator_fit must exist before campaign fit v1';
  END IF;
END
$$;

ALTER TABLE influencer_intelligence.campaign_creator_fit
  ADD COLUMN IF NOT EXISTS weights_version text,
  ADD COLUMN IF NOT EXISTS components jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'influencer_intelligence.campaign_creator_fit'::regclass
      AND conname = 'campaign_creator_fit_components_object_check'
  ) THEN
    ALTER TABLE influencer_intelligence.campaign_creator_fit
      ADD CONSTRAINT campaign_creator_fit_components_object_check
      CHECK (jsonb_typeof(components) = 'object');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = 'influencer_intelligence.campaign_creator_fit'::regclass
      AND conname = 'campaign_creator_fit_weights_version_check'
  ) THEN
    ALTER TABLE influencer_intelligence.campaign_creator_fit
      ADD CONSTRAINT campaign_creator_fit_weights_version_check
      CHECK (weights_version IS NULL OR weights_version ~ '^[a-z][a-z0-9._/-]{0,79}$');
  END IF;
END
$$;

COMMENT ON COLUMN influencer_intelligence.campaign_creator_fit.weights_version IS
  'Immutable identifier for the deterministic Campaign Fit weights configuration.';
COMMENT ON COLUMN influencer_intelligence.campaign_creator_fit.components IS
  'Bounded structured Campaign Fit components and explanations; no raw provider payloads.';

COMMIT;
