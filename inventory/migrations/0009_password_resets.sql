CREATE TABLE IF NOT EXISTS insumos_password_resets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL,
  username TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token ON insumos_password_resets(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON insumos_password_resets(username, created_at);
