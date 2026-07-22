-- Finance v9: registrations are never deleted.  Payees and tags gain the
-- same reversible active state already used by accounts, categories and cost
-- centers; historical foreign keys keep resolving after archival.

ALTER TABLE finance_payees ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
ALTER TABLE finance_tags ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1));
CREATE INDEX IF NOT EXISTS finance_payees_scope_active_name_idx ON finance_payees(scope_id,active,name);
CREATE INDEX IF NOT EXISTS finance_tags_scope_active_name_idx ON finance_tags(scope_id,active,name);

CREATE TRIGGER IF NOT EXISTS finance_accounts_no_delete BEFORE DELETE ON finance_accounts
BEGIN SELECT RAISE(ABORT, 'finance accounts must be archived, not deleted'); END;
CREATE TRIGGER IF NOT EXISTS finance_categories_no_delete BEFORE DELETE ON finance_categories
BEGIN SELECT RAISE(ABORT, 'finance categories must be archived, not deleted'); END;
CREATE TRIGGER IF NOT EXISTS finance_payees_no_delete BEFORE DELETE ON finance_payees
BEGIN SELECT RAISE(ABORT, 'finance payees must be archived, not deleted'); END;
CREATE TRIGGER IF NOT EXISTS finance_tags_no_delete BEFORE DELETE ON finance_tags
BEGIN SELECT RAISE(ABORT, 'finance tags must be archived, not deleted'); END;
CREATE TRIGGER IF NOT EXISTS finance_cost_centers_no_delete BEFORE DELETE ON finance_cost_centers
BEGIN SELECT RAISE(ABORT, 'finance cost centers must be archived, not deleted'); END;
