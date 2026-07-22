-- Finance v7: prevent silent evidence mutation and require balanced posted journals.
-- Additive only. Existing posted entries remain valid; all new entries start draft
-- and may be posted only after the same D1 batch has inserted balanced lines.

CREATE TRIGGER IF NOT EXISTS finance_movements_no_delete BEFORE DELETE ON finance_movements
BEGIN SELECT RAISE(ABORT, 'finance movements cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS finance_movements_immutable_fields BEFORE UPDATE OF scope_id,type,account_id,destination_account_id,category_id,payee_id,cost_center_id,description,amount_minor,currency,base_currency,base_amount_minor,exchange_rate_ppm,competence_date,due_date,paid_date,source,external_id,created_by,created_at,submitted_at ON finance_movements
BEGIN SELECT RAISE(ABORT, 'submitted finance movement fields are immutable'); END;

CREATE TRIGGER IF NOT EXISTS finance_movement_status_transition BEFORE UPDATE OF operational_status ON finance_movements
WHEN NOT (
  (OLD.operational_status='pending' AND NEW.operational_status='confirmed') OR
  (OLD.operational_status='confirmed' AND NEW.operational_status IN ('reconciled','cancelled')) OR
  (OLD.operational_status='reconciled' AND NEW.operational_status='cancelled')
)
BEGIN SELECT RAISE(ABORT, 'invalid finance movement status transition'); END;

CREATE TRIGGER IF NOT EXISTS finance_movement_record_status_transition BEFORE UPDATE OF status ON finance_movements
WHEN NOT (OLD.status='draft' AND NEW.status='posted')
BEGIN SELECT RAISE(ABORT, 'invalid finance movement record status transition'); END;

CREATE TRIGGER IF NOT EXISTS finance_journal_entries_start_draft BEFORE INSERT ON finance_journal_entries
WHEN NEW.status != 'draft'
BEGIN SELECT RAISE(ABORT, 'journal entries must start draft'); END;

CREATE TRIGGER IF NOT EXISTS finance_journal_entries_post_balanced BEFORE UPDATE OF status ON finance_journal_entries
WHEN OLD.status='draft' AND NEW.status='posted'
BEGIN
  SELECT CASE WHEN
    (SELECT COALESCE(SUM(CASE WHEN direction='debit' THEN amount_minor ELSE 0 END),0) FROM finance_journal_lines WHERE entry_id=NEW.id) !=
    (SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount_minor ELSE 0 END),0) FROM finance_journal_lines WHERE entry_id=NEW.id)
    OR (SELECT COUNT(*) FROM finance_journal_lines WHERE entry_id=NEW.id) < 2
  THEN RAISE(ABORT, 'journal entry must be balanced before posting') END;
END;

CREATE TRIGGER IF NOT EXISTS finance_journal_entries_status_immutable BEFORE UPDATE OF status ON finance_journal_entries
WHEN NOT (OLD.status='draft' AND NEW.status='posted')
BEGIN SELECT RAISE(ABORT, 'journal entry status is immutable'); END;

CREATE TRIGGER IF NOT EXISTS finance_journal_entries_immutable_fields BEFORE UPDATE OF id,scope_id,movement_id,created_at ON finance_journal_entries
BEGIN SELECT RAISE(ABORT, 'journal entry evidence is immutable'); END;

CREATE TRIGGER IF NOT EXISTS finance_journal_lines_draft_only BEFORE INSERT ON finance_journal_lines
WHEN (SELECT status FROM finance_journal_entries WHERE id=NEW.entry_id) != 'draft'
BEGIN SELECT RAISE(ABORT, 'journal lines may be added only to draft entries'); END;
CREATE TRIGGER IF NOT EXISTS finance_journal_lines_no_update BEFORE UPDATE ON finance_journal_lines
BEGIN SELECT RAISE(ABORT, 'journal lines are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_journal_lines_no_delete BEFORE DELETE ON finance_journal_lines
BEGIN SELECT RAISE(ABORT, 'journal lines are append-only'); END;

CREATE TRIGGER IF NOT EXISTS finance_movement_splits_no_update BEFORE UPDATE ON finance_movement_splits
BEGIN SELECT RAISE(ABORT, 'movement splits are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_movement_splits_no_delete BEFORE DELETE ON finance_movement_splits
BEGIN SELECT RAISE(ABORT, 'movement splits are append-only'); END;

CREATE TRIGGER IF NOT EXISTS finance_installments_immutable_fields BEFORE UPDATE OF movement_id,sequence,due_date,amount_minor,created_at ON finance_installments
BEGIN SELECT RAISE(ABORT, 'installment evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS finance_installments_status_transition BEFORE UPDATE OF status ON finance_installments
WHEN NOT (
  (OLD.status='open' AND NEW.status='paid' AND NEW.paid_date IS NOT NULL) OR
  (OLD.status='open' AND NEW.status='cancelled')
)
BEGIN SELECT RAISE(ABORT, 'invalid installment status transition'); END;

CREATE TRIGGER IF NOT EXISTS finance_idempotency_keys_no_update BEFORE UPDATE ON finance_idempotency_keys
BEGIN SELECT RAISE(ABORT, 'idempotency records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS finance_idempotency_keys_no_delete BEFORE DELETE ON finance_idempotency_keys
BEGIN SELECT RAISE(ABORT, 'idempotency records are immutable'); END;
