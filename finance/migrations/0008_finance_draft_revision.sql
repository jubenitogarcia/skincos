-- Finance v8: a draft is operational input, not ledger evidence.  It may be
-- replaced atomically while it is still pending; every posted/reconciled or
-- reversed record remains immutable and must be corrected by reversal.
--
-- This migration replaces only overly-broad guards introduced by v7.  It does
-- not rewrite historical rows and preserves the append-only audit, journal and
-- reversal tables.

DROP TRIGGER IF EXISTS finance_movements_immutable_fields;
CREATE TRIGGER IF NOT EXISTS finance_movements_immutable_fields
BEFORE UPDATE OF scope_id,source,external_id,created_by,created_at,submitted_at ON finance_movements
BEGIN SELECT RAISE(ABORT, 'submitted finance movement fields are immutable'); END;

CREATE TRIGGER IF NOT EXISTS finance_movements_reversal_metadata_only
BEFORE UPDATE OF reversed_at,reversed_by ON finance_movements
WHEN NOT (OLD.operational_status IN ('confirmed','reconciled') AND NEW.operational_status='cancelled' AND NEW.reversed_at IS NOT NULL AND NEW.reversed_by IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'reversal metadata is immutable'); END;

CREATE TABLE IF NOT EXISTS finance_draft_revision_requests (
  id TEXT PRIMARY KEY, scope_id TEXT NOT NULL REFERENCES finance_scopes(id),
  movement_id TEXT NOT NULL REFERENCES finance_movements(id), expected_revision INTEGER NOT NULL CHECK(expected_revision > 0),
  new_revision INTEGER NOT NULL CHECK(new_revision > expected_revision), actor TEXT NOT NULL,
  request_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(movement_id,new_revision)
);
CREATE TRIGGER IF NOT EXISTS finance_draft_revision_requests_no_update BEFORE UPDATE ON finance_draft_revision_requests
BEGIN SELECT RAISE(ABORT, 'draft revision requests are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_draft_revision_requests_no_delete BEFORE DELETE ON finance_draft_revision_requests
BEGIN SELECT RAISE(ABORT, 'draft revision requests are append-only'); END;
CREATE TRIGGER IF NOT EXISTS finance_draft_revision_request_requires_current_draft
BEFORE INSERT ON finance_draft_revision_requests
WHEN NOT EXISTS(
  SELECT 1 FROM finance_movements m WHERE m.id=NEW.movement_id AND m.scope_id=NEW.scope_id
  AND m.status='draft' AND m.operational_status='pending' AND m.revision=NEW.expected_revision
)
 OR NEW.new_revision != NEW.expected_revision + 1
BEGIN SELECT RAISE(ABORT, 'draft revision is stale or movement is not editable'); END;
CREATE TRIGGER IF NOT EXISTS finance_movements_draft_revision_increment
BEFORE UPDATE OF revision ON finance_movements
WHEN NOT (OLD.status='draft' AND OLD.operational_status='pending' AND NEW.status='draft' AND NEW.operational_status='pending' AND NEW.revision=OLD.revision+1)
BEGIN SELECT RAISE(ABORT, 'invalid draft revision increment'); END;

CREATE TRIGGER IF NOT EXISTS finance_movements_draft_fields_only
BEFORE UPDATE OF type,account_id,destination_account_id,category_id,payee_id,cost_center_id,description,amount_minor,currency,base_currency,base_amount_minor,exchange_rate_ppm,competence_date,due_date,paid_date,notes,revision ON finance_movements
WHEN NOT (OLD.status='draft' AND OLD.operational_status='pending' AND NEW.status='draft' AND NEW.operational_status='pending')
BEGIN SELECT RAISE(ABORT, 'submitted finance movement fields are immutable; only pending drafts may be revised'); END;

CREATE TRIGGER IF NOT EXISTS finance_movement_scope_match_on_update
BEFORE UPDATE OF account_id,destination_account_id,category_id,payee_id,cost_center_id ON finance_movements
BEGIN
  SELECT CASE WHEN (SELECT scope_id FROM finance_accounts WHERE id=NEW.account_id) != NEW.scope_id THEN RAISE(ABORT, 'movement account scope mismatch') END;
  SELECT CASE WHEN NEW.destination_account_id IS NOT NULL AND (SELECT scope_id FROM finance_accounts WHERE id=NEW.destination_account_id) != NEW.scope_id THEN RAISE(ABORT, 'movement destination scope mismatch') END;
  SELECT CASE WHEN NEW.category_id IS NOT NULL AND (SELECT scope_id FROM finance_categories WHERE id=NEW.category_id) != NEW.scope_id THEN RAISE(ABORT, 'movement category scope mismatch') END;
  SELECT CASE WHEN NEW.payee_id IS NOT NULL AND (SELECT scope_id FROM finance_payees WHERE id=NEW.payee_id) != NEW.scope_id THEN RAISE(ABORT, 'movement payee scope mismatch') END;
  SELECT CASE WHEN NEW.cost_center_id IS NOT NULL AND (SELECT scope_id FROM finance_cost_centers WHERE id=NEW.cost_center_id) != NEW.scope_id THEN RAISE(ABORT, 'movement cost center scope mismatch') END;
END;

DROP TRIGGER IF EXISTS finance_movement_splits_no_delete;
CREATE TRIGGER IF NOT EXISTS finance_movement_splits_no_delete
BEFORE DELETE ON finance_movement_splits
WHEN NOT EXISTS(SELECT 1 FROM finance_movements m WHERE m.id=OLD.movement_id AND m.status='draft' AND m.operational_status='pending')
BEGIN SELECT RAISE(ABORT, 'movement splits are append-only'); END;

CREATE TRIGGER IF NOT EXISTS finance_movement_splits_draft_only
BEFORE INSERT ON finance_movement_splits
WHEN NOT EXISTS(SELECT 1 FROM finance_movements m WHERE m.id=NEW.movement_id AND m.status='draft' AND m.operational_status='pending')
 AND EXISTS(SELECT 1 FROM finance_journal_entries e WHERE e.movement_id=NEW.movement_id AND e.status='posted')
BEGIN SELECT RAISE(ABORT, 'movement splits may be added only to a pending draft'); END;

CREATE TRIGGER IF NOT EXISTS finance_movement_tags_draft_only
BEFORE INSERT ON finance_movement_tags
WHEN NOT EXISTS(SELECT 1 FROM finance_movements m WHERE m.id=NEW.movement_id AND m.status='draft' AND m.operational_status='pending')
 AND EXISTS(SELECT 1 FROM finance_journal_entries e WHERE e.movement_id=NEW.movement_id AND e.status='posted')
BEGIN SELECT RAISE(ABORT, 'movement tags may be added only to a pending draft'); END;
CREATE TRIGGER IF NOT EXISTS finance_movement_tags_no_delete
BEFORE DELETE ON finance_movement_tags
WHEN NOT EXISTS(SELECT 1 FROM finance_movements m WHERE m.id=OLD.movement_id AND m.status='draft' AND m.operational_status='pending')
BEGIN SELECT RAISE(ABORT, 'movement tags are append-only'); END;

CREATE TRIGGER IF NOT EXISTS finance_installments_draft_only
BEFORE INSERT ON finance_installments
WHEN NOT EXISTS(SELECT 1 FROM finance_movements m WHERE m.id=NEW.movement_id AND m.status='draft' AND m.operational_status='pending')
 AND EXISTS(SELECT 1 FROM finance_journal_entries e WHERE e.movement_id=NEW.movement_id AND e.status='posted')
BEGIN SELECT RAISE(ABORT, 'installments may be added only to a pending draft'); END;
CREATE TRIGGER IF NOT EXISTS finance_installments_no_delete
BEFORE DELETE ON finance_installments
WHEN NOT EXISTS(SELECT 1 FROM finance_movements m WHERE m.id=OLD.movement_id AND m.status='draft' AND m.operational_status='pending')
BEGIN SELECT RAISE(ABORT, 'installments are append-only'); END;
DROP TRIGGER IF EXISTS finance_installments_immutable_fields;
CREATE TRIGGER IF NOT EXISTS finance_installments_immutable_fields
BEFORE UPDATE OF movement_id,sequence,due_date,amount_minor,created_at ON finance_installments
WHEN NOT EXISTS(SELECT 1 FROM finance_movements m WHERE m.id=OLD.movement_id AND m.status='draft' AND m.operational_status='pending')
BEGIN SELECT RAISE(ABORT, 'installment evidence is immutable'); END;
