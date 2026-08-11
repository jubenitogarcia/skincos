-- Influencer Intelligence scheduler opt-in metadata v1.
--
-- This is an additive, unapplied artifact. It gives the Orb selector an
-- explicit server-side opt-in instead of treating every registry candidate as
-- a monitored creator. The default is fail-closed (disabled).

BEGIN;
SET LOCAL TIME ZONE 'UTC';

DO $$
BEGIN
  IF to_regclass('influencer_intelligence.creator_registry') IS NULL
    OR to_regclass('influencer_intelligence.schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'influencer intelligence registry v1 is required before scheduler v1';
  END IF;
END
$$;

ALTER TABLE influencer_intelligence.creator_registry
  ADD COLUMN IF NOT EXISTS monitoring_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS monitoring_interval_hours integer NOT NULL DEFAULT 6;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'creator_registry_monitoring_interval_check'
      AND conrelid = 'influencer_intelligence.creator_registry'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.creator_registry
      ADD CONSTRAINT creator_registry_monitoring_interval_check
      CHECK (monitoring_interval_hours BETWEEN 6 AND 168);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS creator_registry_monitoring_queue_idx
  ON influencer_intelligence.creator_registry (monitoring_enabled, monitoring_interval_hours, updated_at)
  WHERE monitoring_enabled = true;

COMMIT;
