-- Finance v5: the source adapter is retained with the staged evidence.
ALTER TABLE finance_import_batches ADD COLUMN source_type TEXT NOT NULL DEFAULT 'generic' CHECK(source_type IN ('generic','moneywiz'));
ALTER TABLE finance_import_batches ADD COLUMN source_metadata_json TEXT NOT NULL DEFAULT '{}';
