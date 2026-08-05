-- Internal procurement domain for Insumos.
-- All amounts are integer cents; no payment, billing or external integration
-- is represented here. Receipts are append-only evidence of stock intake.

CREATE TABLE IF NOT EXISTS insumos_suppliers (
  id TEXT PRIMARY KEY,
  unidade TEXT NOT NULL,
  nome TEXT NOT NULL,
  documento TEXT,
  email TEXT,
  telefone TEXT,
  observacoes TEXT,
  archived_at TEXT,
  archived_by TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insumos_suppliers_unit_active
  ON insumos_suppliers(unidade, archived_at, nome);

CREATE TABLE IF NOT EXISTS insumos_purchase_orders (
  id TEXT PRIMARY KEY,
  unidade TEXT NOT NULL,
  fornecedor_id TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED')),
  expected_at TEXT,
  observacoes TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_by TEXT,
  cancel_reason TEXT,
  FOREIGN KEY (fornecedor_id) REFERENCES insumos_suppliers(id)
);

CREATE INDEX IF NOT EXISTS idx_insumos_purchase_orders_unit_status
  ON insumos_purchase_orders(unidade, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_insumos_purchase_orders_supplier
  ON insumos_purchase_orders(fornecedor_id, status, updated_at);

CREATE TABLE IF NOT EXISTS insumos_purchase_order_lines (
  id TEXT PRIMARY KEY,
  pedido_id TEXT NOT NULL,
  registro_insumo TEXT NOT NULL,
  codigo_barras TEXT NOT NULL,
  produto TEXT NOT NULL,
  lote TEXT,
  data_validade TEXT,
  quantidade_pedida INTEGER NOT NULL CHECK (quantidade_pedida > 0),
  quantidade_recebida INTEGER NOT NULL DEFAULT 0
    CHECK (quantidade_recebida >= 0 AND quantidade_recebida <= quantidade_pedida),
  custo_unitario_centavos INTEGER NOT NULL CHECK (custo_unitario_centavos >= 0),
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (pedido_id) REFERENCES insumos_purchase_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_insumos_purchase_order_lines_order
  ON insumos_purchase_order_lines(pedido_id, registro_insumo);
CREATE INDEX IF NOT EXISTS idx_insumos_purchase_order_lines_item
  ON insumos_purchase_order_lines(registro_insumo, pedido_id);

CREATE TABLE IF NOT EXISTS insumos_purchase_receipts (
  id TEXT PRIMARY KEY,
  pedido_id TEXT NOT NULL,
  linha_id TEXT NOT NULL,
  unidade TEXT NOT NULL,
  registro_insumo TEXT NOT NULL,
  codigo_barras TEXT NOT NULL,
  lote TEXT,
  data_validade TEXT,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  custo_unitario_centavos INTEGER NOT NULL CHECK (custo_unitario_centavos >= 0),
  movement_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  received_by TEXT NOT NULL,
  observacoes TEXT,
  FOREIGN KEY (pedido_id) REFERENCES insumos_purchase_orders(id),
  FOREIGN KEY (linha_id) REFERENCES insumos_purchase_order_lines(id)
);

CREATE INDEX IF NOT EXISTS idx_insumos_purchase_receipts_order
  ON insumos_purchase_receipts(pedido_id, received_at);
CREATE INDEX IF NOT EXISTS idx_insumos_purchase_receipts_line
  ON insumos_purchase_receipts(linha_id, received_at);
CREATE INDEX IF NOT EXISTS idx_insumos_purchase_receipts_movement
  ON insumos_purchase_receipts(movement_id);

-- Receipts are historical stock evidence. Corrections use a compensating
-- ledger entry, never an UPDATE/DELETE of a receipt row.
CREATE TRIGGER IF NOT EXISTS trg_insumos_purchase_receipts_append_only_update
BEFORE UPDATE ON insumos_purchase_receipts
BEGIN
  SELECT RAISE(ABORT, 'insumos_purchase_receipts is append-only');
END;

CREATE TRIGGER IF NOT EXISTS trg_insumos_purchase_receipts_append_only_delete
BEFORE DELETE ON insumos_purchase_receipts
BEGIN
  SELECT RAISE(ABORT, 'insumos_purchase_receipts is append-only');
END;
