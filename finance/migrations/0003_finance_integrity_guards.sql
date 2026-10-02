-- Finance v3: database-level scope and evidence guards for all domain writers.
CREATE TRIGGER IF NOT EXISTS finance_category_parent_scope_match BEFORE INSERT ON finance_categories
WHEN NEW.parent_id IS NOT NULL
BEGIN SELECT CASE WHEN (SELECT scope_id FROM finance_categories WHERE id=NEW.parent_id) != NEW.scope_id THEN RAISE(ABORT, 'category parent scope mismatch') END; END;

CREATE TRIGGER IF NOT EXISTS finance_movement_scope_match BEFORE INSERT ON finance_movements
BEGIN
  SELECT CASE WHEN (SELECT scope_id FROM finance_accounts WHERE id=NEW.account_id) != NEW.scope_id THEN RAISE(ABORT, 'movement account scope mismatch') END;
  SELECT CASE WHEN NEW.destination_account_id IS NOT NULL AND (SELECT scope_id FROM finance_accounts WHERE id=NEW.destination_account_id) != NEW.scope_id THEN RAISE(ABORT, 'movement destination scope mismatch') END;
  SELECT CASE WHEN NEW.category_id IS NOT NULL AND (SELECT scope_id FROM finance_categories WHERE id=NEW.category_id) != NEW.scope_id THEN RAISE(ABORT, 'movement category scope mismatch') END;
  SELECT CASE WHEN NEW.payee_id IS NOT NULL AND (SELECT scope_id FROM finance_payees WHERE id=NEW.payee_id) != NEW.scope_id THEN RAISE(ABORT, 'movement payee scope mismatch') END;
  SELECT CASE WHEN NEW.cost_center_id IS NOT NULL AND (SELECT scope_id FROM finance_cost_centers WHERE id=NEW.cost_center_id) != NEW.scope_id THEN RAISE(ABORT, 'movement cost center scope mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS finance_movement_tag_scope_match BEFORE INSERT ON finance_movement_tags
BEGIN SELECT CASE WHEN (SELECT scope_id FROM finance_movements WHERE id=NEW.movement_id) != (SELECT scope_id FROM finance_tags WHERE id=NEW.tag_id) THEN RAISE(ABORT, 'movement tag scope mismatch') END; END;
CREATE TRIGGER IF NOT EXISTS finance_journal_line_scope_match BEFORE INSERT ON finance_journal_lines
BEGIN SELECT CASE WHEN (SELECT scope_id FROM finance_journal_entries WHERE id=NEW.entry_id) != (SELECT scope_id FROM finance_ledger_accounts WHERE id=NEW.ledger_account_id) THEN RAISE(ABORT, 'journal line scope mismatch') END; END;
CREATE TRIGGER IF NOT EXISTS finance_reversal_line_scope_match BEFORE INSERT ON finance_reversal_lines
BEGIN SELECT CASE WHEN (SELECT scope_id FROM finance_reversal_entries WHERE id=NEW.reversal_entry_id) != (SELECT scope_id FROM finance_ledger_accounts WHERE id=NEW.ledger_account_id) THEN RAISE(ABORT, 'reversal line scope mismatch') END; END;

CREATE TRIGGER IF NOT EXISTS finance_movement_revisions_no_update BEFORE UPDATE ON finance_movement_revisions
BEGIN SELECT RAISE(ABORT, 'finance revisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_movement_revisions_no_delete BEFORE DELETE ON finance_movement_revisions
BEGIN SELECT RAISE(ABORT, 'finance revisions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_reversal_entries_no_update BEFORE UPDATE ON finance_reversal_entries
BEGIN SELECT RAISE(ABORT, 'finance reversals are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_reversal_entries_no_delete BEFORE DELETE ON finance_reversal_entries
BEGIN SELECT RAISE(ABORT, 'finance reversals are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_reversal_lines_no_update BEFORE UPDATE ON finance_reversal_lines
BEGIN SELECT RAISE(ABORT, 'finance reversal lines are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_reversal_lines_no_delete BEFORE DELETE ON finance_reversal_lines
BEGIN SELECT RAISE(ABORT, 'finance reversal lines are append-only'); END;
