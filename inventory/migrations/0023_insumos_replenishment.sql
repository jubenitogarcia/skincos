-- Server-side replenishment policy and suggestion ledger.
-- Suggestions are drafts only: generating one never dispatches a transfer,
-- creates a purchase order, or calls a financial/external service.

CREATE TABLE IF NOT EXISTS insumos_replenishment_policies (
  id TEXT PRIMARY KEY,
  unidade TEXT NOT NULL,
  registro_insumo TEXT NOT NULL,
  estoque_minimo INTEGER NOT NULL CHECK (estoque_minimo >= 0),
  estoque_alvo INTEGER NOT NULL CHECK (estoque_alvo >= estoque_minimo),
  estoque_seguranca INTEGER NOT NULL DEFAULT 0 CHECK (estoque_seguranca >= 0),
  lead_time_dias INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_dias >= 0),
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (unidade, registro_insumo),
  FOREIGN KEY (registro_insumo) REFERENCES insumos_items(registro)
);

CREATE INDEX IF NOT EXISTS idx_insumos_replenishment_policies_unit_active
  ON insumos_replenishment_policies(unidade, ativo, registro_insumo);

CREATE TABLE IF NOT EXISTS insumos_replenishment_suggestions (
  id TEXT PRIMARY KEY,
  unidade TEXT NOT NULL,
  registro_insumo TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('TRANSFER_DRAFT', 'PURCHASE_DRAFT')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'DISMISSED', 'CONVERTED')),
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  saldo_atual INTEGER NOT NULL CHECK (saldo_atual >= 0),
  saldo_projetado INTEGER NOT NULL CHECK (saldo_projetado >= 0),
  estoque_alvo INTEGER NOT NULL CHECK (estoque_alvo >= 0),
  estoque_seguranca INTEGER NOT NULL CHECK (estoque_seguranca >= 0),
  lead_time_dias INTEGER NOT NULL CHECK (lead_time_dias >= 0),
  unidade_origem TEXT,
  unidade_destino TEXT NOT NULL,
  codigo_barras TEXT NOT NULL,
  produto TEXT NOT NULL,
  lote TEXT,
  data_validade TEXT,
  suggestion_key TEXT NOT NULL UNIQUE,
  draft_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  dismissed_at TEXT,
  dismissed_by TEXT,
  dismiss_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_insumos_replenishment_suggestions_unit_status
  ON insumos_replenishment_suggestions(unidade, status, generated_at);
CREATE INDEX IF NOT EXISTS idx_insumos_replenishment_suggestions_item
  ON insumos_replenishment_suggestions(registro_insumo, status, generated_at);

-- A suggestion is evidence of a server-side recommendation. It may be
-- dismissed or converted through governed commands, but never physically
-- deleted from the history.
CREATE TRIGGER IF NOT EXISTS trg_insumos_replenishment_suggestions_append_only_delete
BEFORE DELETE ON insumos_replenishment_suggestions
BEGIN
  SELECT RAISE(ABORT, 'insumos_replenishment_suggestions is append-only');
END;
