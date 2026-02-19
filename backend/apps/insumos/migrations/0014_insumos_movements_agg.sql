CREATE INDEX IF NOT EXISTS idx_insumos_movements_unidade_tipo_data
  ON insumos_movements(unidade, tipo, data_hora);
