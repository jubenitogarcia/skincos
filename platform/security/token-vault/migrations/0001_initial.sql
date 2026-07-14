CREATE TABLE IF NOT EXISTS credential_tokens (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  unit TEXT,
  external_account_id TEXT NOT NULL,
  token_type TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  expires_at TEXT,
  last_refreshed_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(provider, external_account_id, token_type)
);

CREATE INDEX IF NOT EXISTS idx_credential_tokens_provider_active
  ON credential_tokens(provider, active);

CREATE INDEX IF NOT EXISTS idx_credential_tokens_unit
  ON credential_tokens(unit);

CREATE TABLE IF NOT EXISTS credential_token_audit (
  id TEXT PRIMARY KEY,
  token_id TEXT,
  event TEXT NOT NULL,
  provider TEXT,
  unit TEXT,
  token_type TEXT,
  status TEXT NOT NULL,
  request_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (token_id) REFERENCES credential_tokens(id)
);

CREATE INDEX IF NOT EXISTS idx_credential_token_audit_token_created
  ON credential_token_audit(token_id, created_at);

CREATE INDEX IF NOT EXISTS idx_credential_token_audit_event_created
  ON credential_token_audit(event, created_at);
