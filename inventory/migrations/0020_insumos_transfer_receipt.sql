-- Two-phase transfer lifecycle. Movement rows remain append-only; mutable
-- lifecycle state is kept in its own transfer aggregate.

CREATE TABLE IF NOT EXISTS insumos_transfers (
  id TEXT PRIMARY KEY,
  registro_insumo TEXT NOT NULL,
  codigo_barras TEXT,
  lote TEXT,
  data_validade TEXT,
  produto TEXT,
  quantidade INTEGER NOT NULL CHECK (quantidade > 0),
  unidade_origem TEXT NOT NULL,
  unidade_destino TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_RECEIPT'
    CHECK (status IN ('PENDING_RECEIPT', 'RECEIVED', 'CANCELLED')),
  dispatched_at TEXT NOT NULL,
  dispatched_by TEXT NOT NULL,
  received_at TEXT,
  received_by TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  reason TEXT,
  dispatch_movement_id TEXT,
  receipt_movement_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_insumos_transfers_destination_status
  ON insumos_transfers(unidade_destino, status, dispatched_at);

CREATE INDEX IF NOT EXISTS idx_insumos_transfers_origin_status
  ON insumos_transfers(unidade_origem, status, dispatched_at);

CREATE INDEX IF NOT EXISTS idx_insumos_transfers_registro
  ON insumos_transfers(registro_insumo, status, dispatched_at);

-- Preserve transfers already committed by the one-phase implementation as
-- received aggregates. No movement row is rewritten.
INSERT OR IGNORE INTO insumos_transfers (
  id, registro_insumo, codigo_barras, lote, data_validade, produto, quantidade,
  unidade_origem, unidade_destino, status, dispatched_at, dispatched_by,
  received_at, received_by, dispatch_movement_id, receipt_movement_id
)
SELECT
  m.id_transferencia,
  MAX(m.registro_insumo),
  MAX(m.codigo_barras),
  MAX(m.lote),
  MAX(m.data_validade),
  MAX(m.produto),
  MAX(m.quantidade),
  MAX(m.unidade_origem),
  MAX(m.unidade_destino),
  CASE WHEN SUM(CASE WHEN UPPER(m.tipo) IN ('ENTRADA', 'ENTRADA ') AND COALESCE(m.status, 'COMPLETED') = 'COMPLETED' THEN 1 ELSE 0 END) > 0
       THEN 'RECEIVED' ELSE 'PENDING_RECEIPT' END,
  MIN(m.data_hora),
  COALESCE(MAX(CASE WHEN UPPER(m.tipo) IN ('SAÍDA', 'SAIDA') THEN m.usuario END), 'system:legacy'),
  MAX(CASE WHEN UPPER(m.tipo) IN ('ENTRADA', 'ENTRADA ') AND COALESCE(m.status, 'COMPLETED') = 'COMPLETED' THEN m.data_hora END),
  MAX(CASE WHEN UPPER(m.tipo) IN ('ENTRADA', 'ENTRADA ') AND COALESCE(m.status, 'COMPLETED') = 'COMPLETED' THEN m.usuario END),
  MAX(CASE WHEN UPPER(m.tipo) IN ('SAÍDA', 'SAIDA') THEN m.id END),
  MAX(CASE WHEN UPPER(m.tipo) IN ('ENTRADA', 'ENTRADA ') AND COALESCE(m.status, 'COMPLETED') = 'COMPLETED' THEN m.id END)
FROM insumos_movements m
WHERE m.id_transferencia IS NOT NULL
GROUP BY m.id_transferencia;
