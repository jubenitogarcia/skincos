-- Transactional guardrails for the Insumos ledger.
-- This migration is additive: historical rows are preserved and legacy stock
-- snapshots receive an explicit SALDO_INICIAL event when no movement exists.

ALTER TABLE insumos_items ADD COLUMN archived_at TEXT;

ALTER TABLE insumos_movements ADD COLUMN status TEXT NOT NULL DEFAULT 'COMPLETED';
ALTER TABLE insumos_movements ADD COLUMN estorno_de TEXT;
ALTER TABLE insumos_movements ADD COLUMN tipo_compensacao TEXT;

CREATE INDEX IF NOT EXISTS idx_insumos_items_archived
  ON insumos_items(archived_at, produto, registro);

CREATE INDEX IF NOT EXISTS idx_insumos_movements_transfer_status
  ON insumos_movements(id_transferencia, status, data_hora);

CREATE INDEX IF NOT EXISTS idx_insumos_movements_estorno
  ON insumos_movements(estorno_de, data_hora);

CREATE TABLE IF NOT EXISTS insumos_command_idempotency (
  command_hash TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  command_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  response_json TEXT,
  response_status INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insumos_command_idempotency_actor
  ON insumos_command_idempotency(actor, created_at);

CREATE INDEX IF NOT EXISTS idx_insumos_command_idempotency_expiry
  ON insumos_command_idempotency(status, expires_at);

-- The ledger is append-only. Corrections must be represented by compensating
-- rows (POST /movimentacoes/:id/estorno), never by rewriting history.
CREATE TRIGGER IF NOT EXISTS trg_insumos_movements_append_only_update
BEFORE UPDATE ON insumos_movements
BEGIN
  SELECT RAISE(ABORT, 'INSUMOS_MOVEMENTS_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_insumos_movements_append_only_delete
BEFORE DELETE ON insumos_movements
BEGIN
  SELECT RAISE(ABORT, 'INSUMOS_MOVEMENTS_APPEND_ONLY');
END;

-- Legacy baselines: one immutable opening balance per existing stock row when
-- that unit has no prior movement. Existing movement history remains intact.
INSERT OR IGNORE INTO insumos_movements (
  id, data_hora, tipo, codigo_barras, registro_insumo, lote, data_validade,
  produto, quantidade, estoque_anterior, estoque_novo, unidade, usuario,
  motivo, observacoes, status
)
SELECT
  lower(hex(randomblob(16))),
  COALESCE(s.updated_at, i.data_cadastro, datetime('now')),
  'SALDO_INICIAL',
  i.codigo_barras,
  s.registro,
  i.lote,
  i.data_validade,
  i.produto,
  s.quantidade,
  0,
  s.quantidade,
  s.unidade,
  'system:baseline',
  'Baseline legado materializado como movimentação',
  'SALDO_INICIAL legado',
  'COMPLETED'
FROM insumos_stocks s
JOIN insumos_items i ON i.registro = s.registro
WHERE NOT EXISTS (
  SELECT 1
  FROM insumos_movements m
  WHERE m.registro_insumo = s.registro
    AND m.unidade = s.unidade
);
