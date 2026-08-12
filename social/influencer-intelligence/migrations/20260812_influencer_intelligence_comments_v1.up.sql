BEGIN;

SET LOCAL TIME ZONE 'UTC';

-- M9 is additive. The base comment relation remains append-only and the
-- existing immutable trigger also covers these new columns.
ALTER TABLE influencer_intelligence.creator_comment_sample
  ADD COLUMN IF NOT EXISTS sampling_version text,
  ADD COLUMN IF NOT EXISTS sampling_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS algorithm_version text,
  ADD COLUMN IF NOT EXISTS quality_score numeric(6,2),
  ADD COLUMN IF NOT EXISTS quality_confidence numeric(5,4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'creator_comment_sample_sampling_config_check'
      AND conrelid = 'influencer_intelligence.creator_comment_sample'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.creator_comment_sample
      ADD CONSTRAINT creator_comment_sample_sampling_config_check
      CHECK (jsonb_typeof(sampling_config) = 'object');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'creator_comment_sample_quality_fields_check'
      AND conrelid = 'influencer_intelligence.creator_comment_sample'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.creator_comment_sample
      ADD CONSTRAINT creator_comment_sample_quality_fields_check
      CHECK (
        (quality_score IS NULL AND quality_confidence IS NULL AND algorithm_version IS NULL)
        OR (quality_score IS NOT NULL AND quality_confidence IS NOT NULL AND algorithm_version IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'creator_comment_sample_quality_score_check'
      AND conrelid = 'influencer_intelligence.creator_comment_sample'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.creator_comment_sample
      ADD CONSTRAINT creator_comment_sample_quality_score_check
      CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 100);
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'creator_comment_sample_quality_confidence_check'
      AND conrelid = 'influencer_intelligence.creator_comment_sample'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.creator_comment_sample
      ADD CONSTRAINT creator_comment_sample_quality_confidence_check
      CHECK (quality_confidence IS NULL OR quality_confidence BETWEEN 0 AND 1);
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'creator_comment_sample_algorithm_version_check'
      AND conrelid = 'influencer_intelligence.creator_comment_sample'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.creator_comment_sample
      ADD CONSTRAINT creator_comment_sample_algorithm_version_check
      CHECK (algorithm_version IS NULL OR algorithm_version ~ '^[a-z][a-z0-9._/-]{0,79}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'creator_comment_sample_sampling_version_check'
      AND conrelid = 'influencer_intelligence.creator_comment_sample'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.creator_comment_sample
      ADD CONSTRAINT creator_comment_sample_sampling_version_check
      CHECK (sampling_version IS NULL OR sampling_version ~ '^[a-z][a-z0-9._/-]{0,79}$');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS creator_comment_sample_algorithm_observed_idx
  ON influencer_intelligence.creator_comment_sample (algorithm_version, observed_at DESC);

COMMIT;
