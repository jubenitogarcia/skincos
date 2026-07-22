-- Finance v6: retain a controlled EF collector delivery without changing the generic staging pipeline.
ALTER TABLE finance_import_batches ADD COLUMN source_adapter TEXT NOT NULL DEFAULT 'generic';
ALTER TABLE finance_import_batches ADD COLUMN source_payload_json TEXT;
ALTER TABLE finance_import_batches ADD COLUMN source_identity TEXT;
CREATE INDEX IF NOT EXISTS finance_import_batches_source_adapter_idx ON finance_import_batches(scope_id, source_adapter, created_at DESC);
