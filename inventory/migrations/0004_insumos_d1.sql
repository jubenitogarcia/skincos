-- D1 schema for Insumos data (no Google Sheets dependency)

CREATE TABLE IF NOT EXISTS insumos_users (
  username TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'CONSULTOR',
  photo_url TEXT,
  allowed_units_json TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insumos_users_email ON insumos_users(email);
CREATE INDEX IF NOT EXISTS idx_insumos_users_role ON insumos_users(role);

-- Each row is a lot/registro for a given barcode (supports multi-lotes).
CREATE TABLE IF NOT EXISTS insumos_items (
  registro TEXT PRIMARY KEY,
  codigo_barras TEXT NOT NULL,
  produto TEXT NOT NULL,
  categoria TEXT,
  marca TEXT,
  especificacao TEXT,
  concentracao TEXT,
  volume TEXT,
  calibre TEXT,
  tipo_unidade TEXT,
  fonte TEXT,
  preco_custo REAL,
  estoque_minimo INTEGER NOT NULL DEFAULT 0,
  lote TEXT,
  data_validade TEXT,
  data_cadastro TEXT NOT NULL,
  data_atualizacao TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insumos_items_codigo ON insumos_items(codigo_barras);
CREATE INDEX IF NOT EXISTS idx_insumos_items_produto ON insumos_items(produto);
CREATE INDEX IF NOT EXISTS idx_insumos_items_validade ON insumos_items(data_validade);

CREATE TABLE IF NOT EXISTS insumos_stocks (
  registro TEXT NOT NULL,
  unidade TEXT NOT NULL,
  quantidade INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (registro, unidade),
  FOREIGN KEY (registro) REFERENCES insumos_items(registro) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_insumos_stocks_unidade ON insumos_stocks(unidade);

CREATE TABLE IF NOT EXISTS insumos_movements (
  id TEXT PRIMARY KEY,
  data_hora TEXT NOT NULL,
  tipo TEXT NOT NULL,
  codigo_barras TEXT,
  registro_insumo TEXT,
  lote TEXT,
  data_validade TEXT,
  produto TEXT,
  quantidade INTEGER,
  estoque_anterior INTEGER,
  estoque_novo INTEGER,
  unidade TEXT,
  unidade_origem TEXT,
  unidade_destino TEXT,
  id_transferencia TEXT,
  usuario TEXT,
  motivo TEXT,
  observacoes TEXT
);

CREATE INDEX IF NOT EXISTS idx_insumos_movements_data ON insumos_movements(data_hora);
CREATE INDEX IF NOT EXISTS idx_insumos_movements_unidade ON insumos_movements(unidade, data_hora);
CREATE INDEX IF NOT EXISTS idx_insumos_movements_codigo ON insumos_movements(codigo_barras, data_hora);
CREATE INDEX IF NOT EXISTS idx_insumos_movements_registro ON insumos_movements(registro_insumo, data_hora);

