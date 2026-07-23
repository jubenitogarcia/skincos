-- Finance v11: AP/AR titles are planning records, not a second cash ledger.
-- Every settlement references an existing confirmed/reconciled movement and
-- remains append-only.  A cancelled title may not have a settlement.

CREATE TABLE IF NOT EXISTS finance_obligations (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES finance_scopes(id),
  kind TEXT NOT NULL CHECK(kind IN ('payable','receivable')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','partially_settled','settled','cancelled')),
  category_id TEXT REFERENCES finance_categories(id),
  payee_id TEXT REFERENCES finance_payees(id),
  cost_center_id TEXT REFERENCES finance_cost_centers(id),
  description TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
  currency TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  base_amount_minor INTEGER NOT NULL CHECK(base_amount_minor > 0),
  exchange_rate_ppm INTEGER NOT NULL CHECK(exchange_rate_ppm > 0),
  competence_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  planned_date TEXT,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  external_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancellation_reason TEXT,
  CHECK((status='cancelled') = (cancelled_at IS NOT NULL)),
  CHECK((status='cancelled') = (cancelled_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS finance_obligations_scope_due_idx ON finance_obligations(scope_id,status,due_date);
CREATE UNIQUE INDEX IF NOT EXISTS finance_obligations_external_idx ON finance_obligations(scope_id,source,external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance_obligation_settlements (
  id TEXT PRIMARY KEY,
  scope_id TEXT NOT NULL REFERENCES finance_scopes(id),
  obligation_id TEXT NOT NULL REFERENCES finance_obligations(id),
  movement_id TEXT NOT NULL REFERENCES finance_movements(id),
  principal_amount_minor INTEGER NOT NULL CHECK(principal_amount_minor > 0),
  interest_minor INTEGER NOT NULL DEFAULT 0 CHECK(interest_minor >= 0),
  penalty_minor INTEGER NOT NULL DEFAULT 0 CHECK(penalty_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK(discount_minor >= 0),
  allowance_minor INTEGER NOT NULL DEFAULT 0 CHECK(allowance_minor >= 0),
  paid_date TEXT NOT NULL,
  created_by TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(movement_id)
);
CREATE INDEX IF NOT EXISTS finance_obligation_settlements_obligation_idx ON finance_obligation_settlements(obligation_id,created_at);

CREATE TRIGGER IF NOT EXISTS finance_obligations_scope_match BEFORE INSERT ON finance_obligations
BEGIN
  SELECT CASE WHEN NEW.category_id IS NOT NULL AND (SELECT scope_id FROM finance_categories WHERE id=NEW.category_id) != NEW.scope_id THEN RAISE(ABORT, 'obligation category scope mismatch') END;
  SELECT CASE WHEN NEW.payee_id IS NOT NULL AND (SELECT scope_id FROM finance_payees WHERE id=NEW.payee_id) != NEW.scope_id THEN RAISE(ABORT, 'obligation payee scope mismatch') END;
  SELECT CASE WHEN NEW.cost_center_id IS NOT NULL AND (SELECT scope_id FROM finance_cost_centers WHERE id=NEW.cost_center_id) != NEW.scope_id THEN RAISE(ABORT, 'obligation cost center scope mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS finance_obligations_no_delete BEFORE DELETE ON finance_obligations
BEGIN SELECT RAISE(ABORT, 'finance obligations cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS finance_obligations_immutable_fields BEFORE UPDATE OF scope_id,kind,category_id,payee_id,cost_center_id,description,amount_minor,currency,base_currency,base_amount_minor,exchange_rate_ppm,competence_date,due_date,planned_date,notes,source,external_id,created_by,created_at ON finance_obligations
BEGIN SELECT RAISE(ABORT, 'finance obligation evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS finance_obligation_status_transition BEFORE UPDATE OF status ON finance_obligations
WHEN NOT (
  (OLD.status='open' AND NEW.status IN ('partially_settled','settled','cancelled')) OR
  (OLD.status='partially_settled' AND NEW.status='settled')
)
BEGIN SELECT RAISE(ABORT, 'invalid obligation status transition'); END;
CREATE TRIGGER IF NOT EXISTS finance_obligation_cancellation_metadata BEFORE UPDATE OF cancelled_at,cancelled_by,cancellation_reason ON finance_obligations
WHEN NOT (OLD.status='open' AND NEW.status='cancelled' AND NEW.cancelled_at IS NOT NULL AND NEW.cancelled_by IS NOT NULL AND NEW.cancellation_reason IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'obligation cancellation metadata is immutable'); END;

CREATE TRIGGER IF NOT EXISTS finance_obligation_settlements_scope_match BEFORE INSERT ON finance_obligation_settlements
BEGIN
  SELECT CASE WHEN (SELECT scope_id FROM finance_obligations WHERE id=NEW.obligation_id) != NEW.scope_id THEN RAISE(ABORT, 'obligation settlement scope mismatch') END;
  SELECT CASE WHEN (SELECT scope_id FROM finance_movements WHERE id=NEW.movement_id) != NEW.scope_id THEN RAISE(ABORT, 'settlement movement scope mismatch') END;
  SELECT CASE WHEN (SELECT status FROM finance_obligations WHERE id=NEW.obligation_id) NOT IN ('open','partially_settled') THEN RAISE(ABORT, 'settled or cancelled obligation cannot be settled') END;
  SELECT CASE WHEN (SELECT operational_status FROM finance_movements WHERE id=NEW.movement_id) NOT IN ('confirmed','reconciled') THEN RAISE(ABORT, 'settlement requires confirmed movement') END;
END;
CREATE TRIGGER IF NOT EXISTS finance_obligation_settlements_no_update BEFORE UPDATE ON finance_obligation_settlements
BEGIN SELECT RAISE(ABORT, 'obligation settlements are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_obligation_settlements_no_delete BEFORE DELETE ON finance_obligation_settlements
BEGIN SELECT RAISE(ABORT, 'obligation settlements are append-only'); END;
