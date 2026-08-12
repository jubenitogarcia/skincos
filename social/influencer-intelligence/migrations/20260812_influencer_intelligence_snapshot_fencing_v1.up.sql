BEGIN;
SET LOCAL TIME ZONE 'UTC';

DO $$
BEGIN
  IF to_regclass('influencer_intelligence.collector_run') IS NULL THEN
    RAISE EXCEPTION 'influencer_intelligence.collector_run must exist before snapshot fencing';
  END IF;
END
$$;

-- A nullable column keeps already-recorded runs readable. New collection
-- attempts always write a token and every snapshot write is fenced by it.
ALTER TABLE influencer_intelligence.collector_run
  ADD COLUMN IF NOT EXISTS attempt_token text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'collector_run_attempt_token_check'
      AND conrelid = 'influencer_intelligence.collector_run'::regclass
  ) THEN
    ALTER TABLE influencer_intelligence.collector_run
      ADD CONSTRAINT collector_run_attempt_token_check
      CHECK (attempt_token IS NULL OR attempt_token ~ '^[A-Za-z0-9._:-]{16,160}$');
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS collector_run_attempt_token_idx
  ON influencer_intelligence.collector_run (run_key, attempt_token);

COMMIT;
