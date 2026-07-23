-- Target schema for the independent Inventory D1.
-- It deliberately excludes users, sessions, invitations and password recovery.
CREATE TABLE IF NOT EXISTS insumos_items (
  registro TEXT PRIMARY KEY, codigo_barras TEXT NOT NULL, produto TEXT NOT NULL, categoria TEXT, marca TEXT,
  especificacao TEXT, concentracao TEXT, volume TEXT, calibre TEXT, tipo_unidade TEXT, fonte TEXT,
  preco_custo REAL, estoque_minimo INTEGER NOT NULL DEFAULT 0, lote TEXT, data_validade TEXT,
  policy_requires_lot INTEGER, policy_requires_expiry INTEGER, policy_fefo INTEGER,
  data_cadastro TEXT NOT NULL, data_atualizacao TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_items_codigo ON insumos_items(codigo_barras);
CREATE TABLE IF NOT EXISTS insumos_stocks (registro TEXT NOT NULL, unidade TEXT NOT NULL, quantidade INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (registro, unidade), FOREIGN KEY (registro) REFERENCES insumos_items(registro) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS insumos_movements (id TEXT PRIMARY KEY, data_hora TEXT NOT NULL, tipo TEXT NOT NULL, codigo_barras TEXT, registro_insumo TEXT, lote TEXT, data_validade TEXT, produto TEXT, quantidade INTEGER, estoque_anterior INTEGER, estoque_novo INTEGER, unidade TEXT, unidade_origem TEXT, unidade_destino TEXT, id_transferencia TEXT, actor_subject TEXT, motivo TEXT, observacoes TEXT);
CREATE INDEX IF NOT EXISTS inventory_movements_unit_type_date ON insumos_movements(unidade, tipo, data_hora);
CREATE TABLE IF NOT EXISTS insumos_categories (slug TEXT PRIMARY KEY, label TEXT, requires_lot INTEGER NOT NULL DEFAULT 0, requires_expiry INTEGER NOT NULL DEFAULT 0, fefo INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS insumos_barcodes (registro TEXT NOT NULL, codigo_barras TEXT NOT NULL, created_at TEXT, PRIMARY KEY (registro, codigo_barras));
CREATE TABLE IF NOT EXISTS inventory_audit_events (id TEXT PRIMARY KEY, ts TEXT NOT NULL, actor_subject TEXT, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT, unidade TEXT, request_id TEXT, before_json TEXT, after_json TEXT);
CREATE TABLE IF NOT EXISTS inventory_jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', unidade TEXT, payload_json TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS inventory_backup_snapshots (id TEXT PRIMARY KEY, ts TEXT NOT NULL, actor_subject TEXT, kind TEXT NOT NULL, metadata_json TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE);
