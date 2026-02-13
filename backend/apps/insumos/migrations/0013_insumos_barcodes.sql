CREATE TABLE IF NOT EXISTS insumos_barcodes (
  registro TEXT NOT NULL,
  codigo_barras TEXT NOT NULL,
  created_at TEXT,
  PRIMARY KEY (registro, codigo_barras)
);

CREATE INDEX IF NOT EXISTS idx_insumos_barcodes_codigo ON insumos_barcodes (codigo_barras);

INSERT OR IGNORE INTO insumos_barcodes (registro, codigo_barras, created_at)
SELECT registro, codigo_barras, data_cadastro
FROM insumos_items
WHERE codigo_barras IS NOT NULL AND TRIM(codigo_barras) != '';
