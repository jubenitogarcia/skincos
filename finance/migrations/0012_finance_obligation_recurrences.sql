-- Finance v12: recurrence rules are planning templates. They do not post cash
-- or ledger entries; explicit materialization creates auditable AP/AR titles.
CREATE TABLE IF NOT EXISTS finance_obligation_recurrences (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES finance_scopes(id),
  kind TEXT NOT NULL CHECK(kind IN ('payable','receivable')),
  frequency TEXT NOT NULL CHECK(frequency IN ('monthly')),
  category_id TEXT REFERENCES finance_categories(id),
  payee_id TEXT REFERENCES finance_payees(id),
  cost_center_id TEXT REFERENCES finance_cost_centers(id),
  description TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  base_amount_minor INTEGER NOT NULL CHECK(base_amount_minor > 0),
  exchange_rate_ppm INTEGER NOT NULL CHECK(exchange_rate_ppm > 0),
  competence_day INTEGER NOT NULL CHECK(competence_day BETWEEN 1 AND 31),
  due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  next_due_date TEXT NOT NULL,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_by TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS finance_obligation_recurrences_scope_next_idx ON finance_obligation_recurrences(scope_id,active,next_due_date);
CREATE TRIGGER IF NOT EXISTS finance_obligation_recurrences_no_delete BEFORE DELETE ON finance_obligation_recurrences
BEGIN SELECT RAISE(ABORT, 'finance recurrences cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS finance_obligation_recurrences_immutable BEFORE UPDATE OF scope_id,kind,frequency,category_id,payee_id,cost_center_id,description,amount_minor,currency,base_currency,base_amount_minor,exchange_rate_ppm,competence_day,due_day,starts_on,ends_on,notes,created_by,created_at ON finance_obligation_recurrences
BEGIN SELECT RAISE(ABORT, 'finance recurrence evidence is immutable'); END;
