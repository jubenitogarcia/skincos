-- Finance v4: CSV staging is retained and every import decision/compensation is evidence.
ALTER TABLE finance_movements ADD COLUMN notes TEXT;
ALTER TABLE finance_import_batches ADD COLUMN source_csv TEXT;
ALTER TABLE finance_import_batches ADD COLUMN source_encoding TEXT NOT NULL DEFAULT 'utf-8';
ALTER TABLE finance_import_batches ADD COLUMN delimiter TEXT NOT NULL DEFAULT ',';
ALTER TABLE finance_import_batches ADD COLUMN has_header INTEGER NOT NULL DEFAULT 1;
ALTER TABLE finance_import_batches ADD COLUMN date_format TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE finance_import_batches ADD COLUMN headers_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE finance_import_batches ADD COLUMN result_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE finance_import_batches ADD COLUMN undone_at TEXT;
ALTER TABLE finance_import_batches ADD COLUMN undone_by TEXT;

ALTER TABLE finance_import_rows ADD COLUMN decision TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE finance_import_rows ADD COLUMN account_id TEXT;
ALTER TABLE finance_import_rows ADD COLUMN category_id TEXT;
ALTER TABLE finance_import_rows ADD COLUMN payee_id TEXT;
ALTER TABLE finance_import_rows ADD COLUMN transfer_account_id TEXT;
ALTER TABLE finance_import_rows ADD COLUMN note TEXT;
ALTER TABLE finance_import_rows ADD COLUMN external_id TEXT;
ALTER TABLE finance_import_rows ADD COLUMN possible_transfer INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS finance_import_row_decisions (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES finance_import_batches(id), row_id TEXT NOT NULL REFERENCES finance_import_rows(id),
  scope_id TEXT NOT NULL REFERENCES finance_scopes(id), actor TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('import','skip','review')),
  account_id TEXT, category_id TEXT, payee_id TEXT, transfer_account_id TEXT, reason TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_import_row_decisions_row ON finance_import_row_decisions(row_id, created_at);
CREATE TRIGGER IF NOT EXISTS finance_import_row_decisions_no_update BEFORE UPDATE ON finance_import_row_decisions BEGIN SELECT RAISE(ABORT, 'import decisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_import_row_decisions_no_delete BEFORE DELETE ON finance_import_row_decisions BEGIN SELECT RAISE(ABORT, 'import decisions are append-only'); END;

CREATE TABLE IF NOT EXISTS finance_import_transfer_candidates (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES finance_import_batches(id), row_id TEXT NOT NULL REFERENCES finance_import_rows(id),
  account_id TEXT REFERENCES finance_accounts(id), reason TEXT NOT NULL, decision TEXT NOT NULL DEFAULT 'pending' CHECK(decision IN ('pending','transfer','not_transfer')), created_at TEXT NOT NULL,
  UNIQUE(row_id, account_id)
);

CREATE TABLE IF NOT EXISTS finance_import_operations (
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES finance_import_batches(id), scope_id TEXT NOT NULL REFERENCES finance_scopes(id),
  kind TEXT NOT NULL CHECK(kind IN ('commit','undo')), status TEXT NOT NULL CHECK(status IN ('completed','replayed')), actor TEXT NOT NULL, request_id TEXT NOT NULL,
  compensates_operation_id TEXT REFERENCES finance_import_operations(id), result_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_import_operations_batch ON finance_import_operations(batch_id, created_at);
CREATE TRIGGER IF NOT EXISTS finance_import_operations_no_update BEFORE UPDATE ON finance_import_operations BEGIN SELECT RAISE(ABORT, 'import operations are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_import_operations_no_delete BEFORE DELETE ON finance_import_operations BEGIN SELECT RAISE(ABORT, 'import operations are append-only'); END;
