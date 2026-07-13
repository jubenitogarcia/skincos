ALTER TABLE ingestion_runs ADD COLUMN phase TEXT NOT NULL DEFAULT 'received';
ALTER TABLE ingestion_runs ADD COLUMN last_successful_phase TEXT NOT NULL DEFAULT '';
ALTER TABLE ingestion_runs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ingestion_runs ADD COLUMN last_request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE ingestion_runs ADD COLUMN r2_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE ingestion_runs ADD COLUMN d1_status TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE ingestion_runs ADD COLUMN processing_warnings_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_idempotency_status
  ON ingestion_runs(idempotency_key, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_ingestion_runs_phase
  ON ingestion_runs(status, phase, last_successful_phase, updated_at);
