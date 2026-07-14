-- Item-level policy flags (nullable means "inherit from category")
ALTER TABLE insumos_items ADD COLUMN policy_requires_lot INTEGER;
ALTER TABLE insumos_items ADD COLUMN policy_requires_expiry INTEGER;
ALTER TABLE insumos_items ADD COLUMN policy_fefo INTEGER;
