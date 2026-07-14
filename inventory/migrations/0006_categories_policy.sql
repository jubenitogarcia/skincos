-- Category policy table for Insumos (D1)

CREATE TABLE IF NOT EXISTS insumos_categories (
  slug TEXT PRIMARY KEY,
  label TEXT,
  requires_lot INTEGER NOT NULL DEFAULT 0,
  requires_expiry INTEGER NOT NULL DEFAULT 0,
  fefo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insumos_categories_label ON insumos_categories(label);
