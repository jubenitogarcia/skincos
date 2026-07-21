-- Finance v2: additive operational state, split allocation and reversible postings.
ALTER TABLE finance_movements ADD COLUMN operational_status TEXT NOT NULL DEFAULT 'confirmed' CHECK(operational_status IN ('pending','confirmed','reconciled','cancelled'));
ALTER TABLE finance_movements ADD COLUMN base_currency TEXT NOT NULL DEFAULT 'BRL';
ALTER TABLE finance_movements ADD COLUMN base_amount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finance_movements ADD COLUMN exchange_rate_ppm INTEGER NOT NULL DEFAULT 1000000 CHECK(exchange_rate_ppm > 0);
ALTER TABLE finance_movements ADD COLUMN submitted_at TEXT;
ALTER TABLE finance_movements ADD COLUMN reversed_at TEXT;
ALTER TABLE finance_movements ADD COLUMN reversed_by TEXT;
UPDATE finance_movements SET operational_status=CASE WHEN status='draft' THEN 'pending' WHEN status='cancelled' THEN 'cancelled' ELSE 'confirmed' END, base_currency=currency, base_amount_minor=amount_minor WHERE base_amount_minor=0;

CREATE TABLE IF NOT EXISTS finance_movement_splits (
  id TEXT PRIMARY KEY, movement_id TEXT NOT NULL REFERENCES finance_movements(id), scope_id TEXT NOT NULL REFERENCES finance_scopes(id),
  category_id TEXT NOT NULL REFERENCES finance_categories(id), cost_center_id TEXT REFERENCES finance_cost_centers(id),
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), base_amount_minor INTEGER NOT NULL CHECK(base_amount_minor > 0), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_movement_splits_movement_idx ON finance_movement_splits(movement_id);

CREATE TABLE IF NOT EXISTS finance_movement_revisions (
  id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES finance_scopes(id), movement_id TEXT NOT NULL REFERENCES finance_movements(id),
  kind TEXT NOT NULL CHECK(kind IN ('submitted','confirmed','reconciled','reversed')), reason TEXT, actor TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS finance_reversal_entries (
  id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES finance_scopes(id), movement_id TEXT NOT NULL REFERENCES finance_movements(id),
  reason TEXT NOT NULL, actor TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL, UNIQUE(movement_id)
);
CREATE TABLE IF NOT EXISTS finance_reversal_lines (
  id TEXT PRIMARY KEY, reversal_entry_id TEXT NOT NULL REFERENCES finance_reversal_entries(id), ledger_account_id TEXT NOT NULL REFERENCES finance_ledger_accounts(id),
  direction TEXT NOT NULL CHECK(direction IN ('debit','credit')), amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), currency TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_movements_scope_status_period_idx ON finance_movements(scope_id, operational_status, competence_date DESC);

CREATE TRIGGER IF NOT EXISTS finance_movement_splits_scope_match BEFORE INSERT ON finance_movement_splits
BEGIN SELECT CASE WHEN (SELECT scope_id FROM finance_movements WHERE id=NEW.movement_id) != NEW.scope_id THEN RAISE(ABORT, 'split scope mismatch') END; END;
CREATE TRIGGER IF NOT EXISTS finance_movement_splits_category_scope_match BEFORE INSERT ON finance_movement_splits
BEGIN SELECT CASE WHEN (SELECT scope_id FROM finance_categories WHERE id=NEW.category_id) != NEW.scope_id THEN RAISE(ABORT, 'split category scope mismatch') END; END;
