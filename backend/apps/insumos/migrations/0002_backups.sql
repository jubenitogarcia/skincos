-- D1 schema for backups (Insumos)

CREATE TABLE IF NOT EXISTS backup_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT,
  role TEXT,
  unidade TEXT,
  kind TEXT NOT NULL DEFAULT 'FULL',
  metadata_json TEXT,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_backup_ts ON backup_snapshots(ts);
CREATE INDEX IF NOT EXISTS idx_backup_unidade ON backup_snapshots(unidade, ts);
