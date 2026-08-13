-- Governed, idempotent authority for the private Meta Ads Publish
-- configuration.  Credential ciphertext remains in credential_tokens and is
-- never copied into these records.
CREATE TABLE IF NOT EXISTS meta_ads_publish_config_operations (
  id TEXT PRIMARY KEY,
  operation_key TEXT NOT NULL UNIQUE,
  target_token_ids_json TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  expected_tracking_binding_revision TEXT NOT NULL,
  resulting_tracking_binding_revision TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'applied')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_publish_config_operations_updated
  ON meta_ads_publish_config_operations(updated_at);

CREATE TABLE IF NOT EXISTS meta_ads_publish_config_locks (
  resource_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_meta_ads_publish_config_locks_expires
  ON meta_ads_publish_config_locks(expires_at);
