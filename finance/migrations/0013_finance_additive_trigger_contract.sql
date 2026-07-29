-- Finance v13: additive trigger-contract marker.
--
-- Existing staging databases that applied the former v8 trigger replacement
-- already have the same effective draft-aware guards.  New databases receive
-- those definitions from v7/v8 without destructive DDL.  These independently
-- named guards make the converged contract explicit and additive everywhere.

CREATE TRIGGER IF NOT EXISTS finance_movements_identity_immutable_v13
BEFORE UPDATE OF scope_id,source,external_id,created_by,created_at,submitted_at ON finance_movements
BEGIN SELECT RAISE(ABORT, 'submitted finance movement fields are immutable'); END;

CREATE TRIGGER IF NOT EXISTS finance_movement_splits_posted_no_delete_v13
BEFORE DELETE ON finance_movement_splits
WHEN NOT EXISTS(
  SELECT 1 FROM finance_movements m
  WHERE m.id=OLD.movement_id AND m.status='draft' AND m.operational_status='pending'
)
BEGIN SELECT RAISE(ABORT, 'movement splits are append-only'); END;

CREATE TRIGGER IF NOT EXISTS finance_installments_posted_immutable_v13
BEFORE UPDATE OF movement_id,sequence,due_date,amount_minor,created_at ON finance_installments
WHEN NOT EXISTS(
  SELECT 1 FROM finance_movements m
  WHERE m.id=OLD.movement_id AND m.status='draft' AND m.operational_status='pending'
)
BEGIN SELECT RAISE(ABORT, 'installment evidence is immutable'); END;
