-- Influencer Intelligence snapshot collection metadata v1.
--
-- This is an additive extension of 20260811_influencer_intelligence_data_model_v1.
-- It makes collection coverage, freshness and failure cardinality durable without
-- putting raw provider payloads or comments into the historical tables.

BEGIN;
SET LOCAL TIME ZONE 'UTC';

DO $$
BEGIN
  IF to_regclass('influencer_intelligence.collector_run') IS NULL
    OR to_regclass('influencer_intelligence.creator_profile_snapshot') IS NULL
    OR to_regclass('influencer_intelligence.creator_media_snapshot') IS NULL THEN
    RAISE EXCEPTION 'influencer intelligence data model v1 is required before snapshot metadata v1';
  END IF;
END
$$;

ALTER TABLE influencer_intelligence.collector_run
  ADD COLUMN IF NOT EXISTS coverage_available integer,
  ADD COLUMN IF NOT EXISTS coverage_expected integer,
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freshness_status text,
  ADD COLUMN IF NOT EXISTS freshness_age_seconds integer;

ALTER TABLE influencer_intelligence.creator_profile_snapshot
  ADD COLUMN IF NOT EXISTS coverage_available integer,
  ADD COLUMN IF NOT EXISTS coverage_expected integer,
  ADD COLUMN IF NOT EXISTS freshness_status text,
  ADD COLUMN IF NOT EXISTS freshness_age_seconds integer;

ALTER TABLE influencer_intelligence.creator_media_snapshot
  ADD COLUMN IF NOT EXISTS coverage_available integer,
  ADD COLUMN IF NOT EXISTS coverage_expected integer,
  ADD COLUMN IF NOT EXISTS freshness_status text,
  ADD COLUMN IF NOT EXISTS freshness_age_seconds integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collector_run_coverage_check'
      AND conrelid = 'influencer_intelligence.collector_run'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.collector_run
      ADD CONSTRAINT collector_run_coverage_check
      CHECK (
        (coverage_available IS NULL AND coverage_expected IS NULL)
        OR (
          coverage_available IS NOT NULL
          AND coverage_expected IS NOT NULL
          AND coverage_available >= 0
          AND coverage_expected >= 0
          AND coverage_available <= coverage_expected
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collector_run_failure_count_check'
      AND conrelid = 'influencer_intelligence.collector_run'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.collector_run
      ADD CONSTRAINT collector_run_failure_count_check CHECK (failure_count >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collector_run_freshness_check'
      AND conrelid = 'influencer_intelligence.collector_run'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.collector_run
      ADD CONSTRAINT collector_run_freshness_check
      CHECK (freshness_status IS NULL OR freshness_status IN ('fresh', 'stale', 'unknown'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'collector_run_freshness_age_check'
      AND conrelid = 'influencer_intelligence.collector_run'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.collector_run
      ADD CONSTRAINT collector_run_freshness_age_check
      CHECK (freshness_age_seconds IS NULL OR freshness_age_seconds >= 0);
  END IF;
END
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['creator_profile_snapshot', 'creator_media_snapshot'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = table_name || '_coverage_check'
        AND conrelid = format('influencer_intelligence.%s', table_name)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE influencer_intelligence.%I ADD CONSTRAINT %I CHECK ((coverage_available IS NULL AND coverage_expected IS NULL) OR (coverage_available IS NOT NULL AND coverage_expected IS NOT NULL AND coverage_available >= 0 AND coverage_expected > 0 AND coverage_available <= coverage_expected))',
        table_name,
        table_name || '_coverage_check'
      );
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = table_name || '_freshness_check'
        AND conrelid = format('influencer_intelligence.%s', table_name)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE influencer_intelligence.%I ADD CONSTRAINT %I CHECK (freshness_status IS NULL OR freshness_status IN (''fresh'', ''stale'', ''unknown''))',
        table_name,
        table_name || '_freshness_check'
      );
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = table_name || '_freshness_age_check'
        AND conrelid = format('influencer_intelligence.%s', table_name)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE influencer_intelligence.%I ADD CONSTRAINT %I CHECK (freshness_age_seconds IS NULL OR freshness_age_seconds >= 0)',
        table_name,
        table_name || '_freshness_age_check'
      );
    END IF;
  END LOOP;
END
$$;

COMMIT;
