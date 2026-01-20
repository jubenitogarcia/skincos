-- Invite tokens for self-service account creation

CREATE TABLE IF NOT EXISTS insumos_invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT,
  role TEXT NOT NULL,
  allowed_units_json TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_insumos_invites_token_hash ON insumos_invites(token_hash);
CREATE INDEX IF NOT EXISTS idx_insumos_invites_created_at ON insumos_invites(created_at);
