-- Guided physical counts are an auditable workflow around the immutable
-- movements ledger. Session/line state is mutable; every scanner/manual read
-- is append-only so a recount never erases what was observed.

CREATE TABLE IF NOT EXISTS insumos_count_sessions (
  id TEXT PRIMARY KEY,
  unidade TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'CLOSING', 'CONFLICT', 'CLOSED', 'CANCELLED')),
  snapshot_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  started_by TEXT NOT NULL,
  closed_at TEXT,
  closed_by TEXT,
  conflict_at TEXT,
  conflict_reason TEXT,
  observacoes TEXT
);

CREATE INDEX IF NOT EXISTS idx_insumos_count_sessions_unit_status
  ON insumos_count_sessions(unidade, status, snapshot_at);

-- A unit can have only one active count. CLOSING is included so a concurrent
-- start cannot race a close and create a second snapshot.
CREATE UNIQUE INDEX IF NOT EXISTS uq_insumos_count_sessions_active_unit
  ON insumos_count_sessions(unidade)
  WHERE status IN ('OPEN', 'CLOSING', 'CONFLICT');

CREATE TABLE IF NOT EXISTS insumos_count_lines (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  registro TEXT NOT NULL,
  codigo_barras TEXT,
  produto TEXT,
  lote TEXT,
  data_validade TEXT,
  snapshot_quantity INTEGER NOT NULL DEFAULT 0,
  physical_quantity INTEGER,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'COUNTED', 'ADJUSTED')),
  counted_at TEXT,
  counted_by TEXT,
  adjustment_movement_id TEXT,
  FOREIGN KEY (session_id) REFERENCES insumos_count_sessions(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_insumos_count_lines_session_registro
  ON insumos_count_lines(session_id, registro);

CREATE INDEX IF NOT EXISTS idx_insumos_count_lines_session_status
  ON insumos_count_lines(session_id, status, registro);

CREATE INDEX IF NOT EXISTS idx_insumos_count_lines_code_lot
  ON insumos_count_lines(session_id, codigo_barras, lote);

CREATE TABLE IF NOT EXISTS insumos_count_reads (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  line_id TEXT NOT NULL,
  registro TEXT NOT NULL,
  quantidade INTEGER NOT NULL CHECK (quantidade >= 0),
  origem TEXT NOT NULL DEFAULT 'MANUAL',
  observacoes TEXT,
  read_at TEXT NOT NULL,
  read_by TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES insumos_count_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (line_id) REFERENCES insumos_count_lines(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_insumos_count_reads_session
  ON insumos_count_reads(session_id, read_at, id);

CREATE INDEX IF NOT EXISTS idx_insumos_count_reads_line
  ON insumos_count_reads(line_id, read_at, id);

-- Reads are evidence, not editable state. Session/line state can advance, but
-- a read must never be rewritten or deleted from the audit trail.
CREATE TRIGGER IF NOT EXISTS trg_insumos_count_reads_append_only_update
BEFORE UPDATE ON insumos_count_reads
BEGIN
  SELECT RAISE(ABORT, 'INSUMOS_COUNT_READS_APPEND_ONLY');
END;

CREATE TRIGGER IF NOT EXISTS trg_insumos_count_reads_append_only_delete
BEFORE DELETE ON insumos_count_reads
BEGIN
  SELECT RAISE(ABORT, 'INSUMOS_COUNT_READS_APPEND_ONLY');
END;

