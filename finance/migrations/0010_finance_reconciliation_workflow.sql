-- Finance v10: statement lines and reconciliation decisions are evidence.
-- The first workflow is deliberately 1:1; partial reconciliation belongs to
-- AP/AR settlement and must not be inferred by altering an operational record.

CREATE UNIQUE INDEX IF NOT EXISTS finance_reconciliation_lines_external_idx
ON finance_reconciliation_lines(scope_id,account_id,external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS finance_reconciliation_lines_scope_account_date_idx
ON finance_reconciliation_lines(scope_id,account_id,posted_date DESC);
CREATE INDEX IF NOT EXISTS finance_reconciliation_matches_movement_idx
ON finance_reconciliation_matches(movement_id,status);

CREATE TRIGGER IF NOT EXISTS finance_reconciliation_lines_no_update BEFORE UPDATE ON finance_reconciliation_lines
BEGIN SELECT RAISE(ABORT, 'statement lines are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_reconciliation_lines_no_delete BEFORE DELETE ON finance_reconciliation_lines
BEGIN SELECT RAISE(ABORT, 'statement lines are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_reconciliation_matches_scope_match BEFORE INSERT ON finance_reconciliation_matches
BEGIN
  SELECT CASE WHEN (SELECT scope_id FROM finance_reconciliation_lines WHERE id=NEW.statement_line_id) != (SELECT scope_id FROM finance_movements WHERE id=NEW.movement_id) THEN RAISE(ABORT, 'reconciliation scope mismatch') END;
  SELECT CASE WHEN (SELECT account_id FROM finance_reconciliation_lines WHERE id=NEW.statement_line_id) NOT IN (SELECT account_id FROM finance_movements WHERE id=NEW.movement_id UNION SELECT destination_account_id FROM finance_movements WHERE id=NEW.movement_id) THEN RAISE(ABORT, 'reconciliation account mismatch') END;
END;
CREATE TRIGGER IF NOT EXISTS finance_reconciliation_matches_no_delete BEFORE DELETE ON finance_reconciliation_matches
BEGIN SELECT RAISE(ABORT, 'reconciliation matches are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_reconciliation_matches_immutable_fields BEFORE UPDATE OF statement_line_id,movement_id,created_by,created_at ON finance_reconciliation_matches
BEGIN SELECT RAISE(ABORT, 'reconciliation match evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS finance_reconciliation_match_status_transition BEFORE UPDATE OF status ON finance_reconciliation_matches
WHEN NOT (OLD.status='suggested' AND NEW.status IN ('confirmed','rejected'))
BEGIN SELECT RAISE(ABORT, 'invalid reconciliation match transition'); END;
